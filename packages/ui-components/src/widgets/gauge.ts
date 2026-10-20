// Widget `gauge` (FR-027; feature 012 FR-033, FR-037): đồng hồ nửa vòng bằng ECharts lite: thang min–max, vùng màu
// (≤ 4), kim; nhãn, giá trị, đơn vị và nhãn quality do Lit vẽ (role=meter). Không có vùng màu thì cung tiến độ theo màu
// chuỗi 1. Giá trị ngoài thang: kim kẹp ở đầu thang; UNKNOWN hoặc không có số: không có kim.
import { css, html, nothing, type TemplateResult } from 'lit';
import type { ChartTheme } from '../chart/echarts-lite.ts';
import { fraction, gaugeStops, resolveRange, zoneSegments } from '../chart/geometry.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
import { vi } from '../i18n/vi.ts';
import { MatEChartWidget } from './chart-base.ts';

export class MatGauge extends MatEChartWidget {
  static override styles = [
    MatEChartWidget.styles,
    css`
      .w {
        padding: 6px 8px;
        align-items: stretch;
      }
      .label {
        font-size: 12px;
        color: var(--mat-text-muted);
        text-align: center;
        padding-right: 30px;
      }
      .readout {
        display: flex;
        justify-content: center;
        align-items: baseline;
        gap: 4px;
        margin-top: 0;
      }
      .value {
        font-size: 24px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .unit {
        font-size: 12px;
        color: var(--mat-text-muted);
      }
    `,
  ];

  #state = { min: 0, max: 100, known: false, value: 0, dim: false };
  protected override sizeDependent = true;

  protected override renderWidget(): TemplateResult {
    const id = this.tagOf('value');
    const info = id ? this.source.info(id) : undefined;
    const state = id ? this.source.get(id) : { value: null, quality: 'GOOD' as const };
    const qv = this.qv(id);
    const { min, max } = resolveRange(
      this.item.props?.min,
      this.item.props?.max,
      info?.min,
      info?.max,
    );
    const unitProp = this.item.props?.unit;
    const fmt = formatValue(state, info, {
      decimals: this.decimals(info),
      unit: typeof unitProp === 'string' ? unitProp : undefined,
    });
    const n = numberOf(state.value);
    const known = Number.isFinite(n) && state.quality !== 'UNKNOWN';
    this.#state = { min, max, known, value: known ? n : min, dim: qv.dim };
    const label = this.prop('label', '');
    const valueText = fmt.unit ? `${fmt.text} ${fmt.unit}` : fmt.text;
    const ariaLabel = label || this.nameOf(id) || vi.widget.gauge!;
    const title = this.titleText();
    const readout = this.prop('showValue', true)
      ? html`<div class="readout">
          <span class="value ${qv.dim ? 'dim' : ''}">${fmt.text}</span>
          ${fmt.unit ? html`<span class="unit">${fmt.unit}</span>` : nothing}
        </div>`
      : nothing;
    if (title)
      return html`<div
        class="w framed ${qv.cls}"
        role="meter"
        aria-label=${[title, label].filter(Boolean).join(': ') || ariaLabel}
        aria-valuemin=${min}
        aria-valuemax=${max}
        aria-valuenow=${known ? n : min}
        aria-valuetext=${[valueText, qv.aria].filter(Boolean).join(', ')}
      >
        ${this.head()}
        <div class="body">
          ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
          <div class="ec" part="chart" aria-hidden="true"></div>
          ${readout}
        </div>
        ${this.badge(qv)}
      </div>`;
    return html`<div
      class="w ${qv.cls}"
      role="meter"
      aria-label=${ariaLabel}
      aria-valuemin=${min}
      aria-valuemax=${max}
      aria-valuenow=${known ? n : min}
      aria-valuetext=${[valueText, qv.aria].filter(Boolean).join(', ')}
    >
      ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
      <div class="ec" part="chart" aria-hidden="true"></div>
      ${readout} ${this.badge(qv)}
    </div>`;
  }

  protected override chartOption(t: ChartTheme): Record<string, unknown> {
    const { min, max, known, value, dim } = this.#state;
    const zones = zoneSegments(this.item.props?.zones, min, max);
    const clamped = min + fraction(value, min, max) * (max - min);
    const width = 12;
    const ends = new Set([min, max]);
    // Nửa vòng: bán kính bị chặn bởi nửa bề rộng và bởi chiều cao (tâm sát đáy), tính bằng px; '92%' của ECharts tính
    // theo nửa cạnh ngắn nên khung rộng thấp chỉ dùng nửa chiều cao.
    const { width: w, height: h } = this.chartSize();
    // Feature 014: bán kính vừa phải (≤ 38 % bề rộng, ≤ 150 px) để đồng hồ gọn trong khung rộng; nửa vòng nằm giữa
    // vùng vẽ theo chiều dọc, tâm cách đáy ít nhất 10 px (núm kim không đè số đọc bên dưới).
    const radius = Math.max(10, Math.min(w / 2 - 10, h - 18, w * 0.38, 150));
    const cy = Math.min(h - 10, (h + radius) / 2 + 4);
    return {
      // Không tooltip: số đọc đã hiện dưới đồng hồ; tooltip mặc định của ECharts dựng HTML từ chuỗi (cổng SC-020).
      tooltip: { show: false },
      series: [
        {
          type: 'gauge',
          min,
          max,
          startAngle: 180,
          endAngle: 0,
          radius,
          center: ['50%', cy],
          splitNumber: 4,
          progress: {
            show: zones.length === 0 && known,
            width,
            roundCap: false,
            itemStyle: { color: t.colors[0], opacity: dim ? 0.45 : 1 },
          },
          axisLine: {
            lineStyle: { width, color: gaugeStops(zones, min, max, t.border) },
          },
          axisTick: { show: true, distance: 2, length: 4, lineStyle: { color: t.borderStrong } },
          splitLine: { show: true, distance: 2, length: 8, lineStyle: { color: t.borderStrong } },
          axisLabel: {
            distance: width + 6,
            color: t.muted,
            fontSize: 10,
            formatter: (v: number) => (ends.has(v) ? String(v) : ''),
          },
          pointer: {
            show: known,
            length: '62%',
            width: 4,
            itemStyle: { color: t.text, opacity: dim ? 0.45 : 1 },
          },
          anchor: {
            show: true,
            size: 10,
            itemStyle: { color: t.text },
          },
          title: { show: false },
          detail: { show: false },
          data: [{ value: clamped }],
        },
      ],
    };
  }
}
