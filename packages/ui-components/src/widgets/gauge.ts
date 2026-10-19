// Widget `gauge` (FR-027; feature 012 FR-033, FR-037): đồng hồ nửa vòng bằng ECharts lite: thang min–max, vùng màu
// (≤ 4), kim; nhãn, giá trị, đơn vị và nhãn quality do Lit vẽ (role=meter). Không có vùng màu thì cung tiến độ theo màu
// chuỗi 1. Giá trị ngoài thang: kim kẹp ở đầu thang; UNKNOWN hoặc không có số: không có kim.
import { css, html, nothing, type TemplateResult } from 'lit';
import type { ChartTheme } from '../chart/echarts-lite.ts';
import { fraction, gaugeStops, resolveRange, zoneSegments } from '../chart/geometry.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
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
        margin-top: -6px;
      }
      .value {
        font-size: 20px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .unit {
        font-size: 12px;
        color: var(--mat-text-muted);
      }
    `,
  ];

  #state = { min: 0, max: 100, known: false, value: 0, dim: false };

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
    const ariaLabel = label || this.nameOf(id);
    return html`<div
      class="w ${qv.cls}"
      role="meter"
      aria-label=${ariaLabel}
      aria-valuemin=${min}
      aria-valuemax=${max}
      aria-valuenow=${known ? n : nothing}
      aria-valuetext=${[valueText, qv.aria].filter(Boolean).join(', ')}
    >
      ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
      <div class="ec" part="chart" aria-hidden="true"></div>
      ${
        this.prop('showValue', true)
          ? html`<div class="readout">
              <span class="value ${qv.dim ? 'dim' : ''}">${fmt.text}</span>
              ${fmt.unit ? html`<span class="unit">${fmt.unit}</span>` : nothing}
            </div>`
          : nothing
      }
      ${this.badge(qv)}
    </div>`;
  }

  protected override chartOption(t: ChartTheme): Record<string, unknown> {
    const { min, max, known, value, dim } = this.#state;
    const zones = zoneSegments(this.item.props?.zones, min, max);
    const clamped = min + fraction(value, min, max) * (max - min);
    const width = 12;
    const ends = new Set([min, max]);
    return {
      series: [
        {
          type: 'gauge',
          min,
          max,
          startAngle: 180,
          endAngle: 0,
          radius: '92%',
          center: ['50%', '72%'],
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
