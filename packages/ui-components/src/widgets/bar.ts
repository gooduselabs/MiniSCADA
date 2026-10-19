// Widget `bar` (FR-030; feature 012 FR-033, FR-037): biểu đồ cột dọc hoặc ngang bằng ECharts lite, ≤ 12 Tag, giá trị
// hiện tại. Thuộc tính giữ nguyên ý nghĩa: orientation, min, max (thang tự co từ 0 khi vắng), decimals, showValues,
// labels. Cột BAD/STALE/UNKNOWN không vẽ mà có chữ BAD/STALE/? tại chỗ (không chỉ màu); UNCERTAIN vẽ kèm dấu ●.
// Phần truy cập (role=img, aria-label, bảng ẩn) do Lit vẽ; ECharts chỉ vẽ hình (chuỗi thuần, tooltip dựng bằng DOM).
import { css, html, type TemplateResult } from 'lit';
import { resolveScale } from '../chart/bar-chart.ts';
import { tooltipContent, type ChartTheme } from '../chart/echarts-lite.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
import type { QualityView } from '../format/quality.ts';
import { vi } from '../i18n/vi.ts';
import { MatEChartWidget } from './chart-base.ts';

const MAX = 12;

interface Row {
  label: string;
  qv: QualityView;
  value: number | null;
  text: string;
  unit: string;
}

export class MatBar extends MatEChartWidget {
  static override styles = [
    MatEChartWidget.styles,
    css`
      .w {
        padding: 4px;
        justify-content: stretch;
      }
      .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        color: var(--mat-text-muted);
      }
    `,
  ];

  #rows: Row[] = [];
  #horizontal = false;

  protected override renderWidget(): TemplateResult {
    const ids = this.tagsOf('series').slice(0, MAX);
    const horizontal = this.prop('orientation', 'vertical') === 'horizontal';
    const labels = Array.isArray(this.item.props?.labels)
      ? (this.item.props!.labels as unknown[])
      : [];
    const rows: Row[] = ids.map((id, i) => {
      const info = this.source.info(id);
      const state = this.source.get(id);
      const n = numberOf(state.value);
      const usable =
        Number.isFinite(n) && (state.quality === 'GOOD' || state.quality === 'UNCERTAIN');
      const fmt = formatValue(state, info, { decimals: this.decimals(info) });
      const label = (typeof labels[i] === 'string' && labels[i]) || info?.description || id;
      return {
        label: label as string,
        qv: this.qv(id),
        value: usable ? n : null,
        text: fmt.text,
        unit: fmt.unit,
      };
    });
    this.#rows = rows;
    this.#horizontal = horizontal;

    const summary = rows
      .map(
        (r) =>
          `${r.label} ${r.value === null ? r.qv.aria || vi.noValue : r.text + (r.unit ? ' ' + r.unit : '')}`,
      )
      .join(', ');
    const aria =
      rows.length === 0 ? `${vi.widget.bar}: ${vi.chart.noData}` : `${vi.widget.bar}: ${summary}`;
    const cls = `w ${horizontal ? 'horizontal' : 'vertical'}`;

    if (rows.length === 0)
      return html`<div class=${cls} role="img" aria-label=${aria}>
        <div class="empty">${vi.chart.noData}</div>
      </div>`;

    return html`<div class=${cls}>
      <div class="ec" part="chart" role="img" aria-label=${aria}></div>
      <table class="sr-only">
        <caption>
          ${vi.chart.seriesTable}
        </caption>
        <thead>
          <tr>
            <th scope="col">${vi.chart.series}</th>
            <th scope="col">${vi.chart.value}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (r) =>
              html`<tr>
                <td>${r.label}</td>
                <td>${r.text}${r.unit ? ' ' + r.unit : ''}${r.qv.aria ? ' ' + r.qv.aria : ''}</td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  protected override chartOption(t: ChartTheme): Record<string, unknown> | null {
    const rows = this.#rows;
    if (rows.length === 0) return null;
    const horizontal = this.#horizontal;
    const rule = (x: unknown): number | undefined =>
      typeof x === 'number' && Number.isFinite(x) ? x : undefined;
    // Thang: min/max đặt tay thì dùng (cặp suy biến sửa như trước qua resolveScale); vắng thì để ECharts tự co với số
    // tròn, luôn gồm 0 (trục giá trị không bật `scale`) như thang tự co từ 0 trước đây.
    const pMin = rule(this.item.props?.min);
    const pMax = rule(this.item.props?.max);
    const fixedScale =
      pMin !== undefined && pMax !== undefined
        ? resolveScale([], { min: pMin, max: pMax })
        : { min: pMin, max: pMax };
    const { min, max } = fixedScale;
    const showValues = this.prop('showValues', true);
    const W = Math.max(this.item.width || 400, 40);
    const band = Math.max((W - 16) / rows.length, 12);
    const markColor = (qv: QualityView) =>
      qv.cls === 'q-bad' ? t.bad : qv.cls === 'q-uncertain' ? t.warn : t.muted;
    const radius = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
    const position = horizontal ? 'right' : 'top';

    const data = rows.map((r, i) => {
      if (r.value === null)
        return {
          value: 0,
          // Cột rỗng trong suốt (không dùng opacity 0: nhãn của phần tử cũng mờ theo), chữ ngay trên đường 0.
          itemStyle: { color: 'transparent', opacity: 1 },
          label: {
            show: true,
            formatter: r.qv.badge || vi.noValue,
            position,
            color: markColor(r.qv),
            fontWeight: 700,
          },
        };
      return {
        value: r.value,
        itemStyle: { color: t.colors[i % 12]!, opacity: 1, borderRadius: radius },
        ...(!showValues && r.qv.badge
          ? {
              label: {
                show: true,
                formatter: r.qv.badge,
                position,
                color: markColor(r.qv),
                fontWeight: 700,
              },
            }
          : {}),
      };
    });

    const category = {
      type: 'category',
      data: rows.map((r) => r.label),
      inverse: horizontal,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: t.borderStrong } },
      axisLabel: {
        color: t.muted,
        interval: 0,
        overflow: 'truncate',
        width: horizontal ? 84 : Math.max(band - 6, 18),
      },
    };
    const value = {
      type: 'value',
      min,
      max,
      axisLabel: { color: t.muted },
      splitLine: { lineStyle: { color: t.border, type: 'dashed' } },
    };
    return {
      // ECharts 6: outerBounds mặc định giữ nhãn trục trong khung (thay containLabel cũ, cần mô-đun riêng).
      grid: {
        left: 8,
        right: horizontal ? (showValues ? 48 : 16) : 8,
        top: horizontal ? 8 : 20,
        bottom: 4,
      },
      xAxis: horizontal ? value : category,
      yAxis: horizontal ? category : value,
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const r = rows[p.dataIndex];
          if (!r) return this.ownerDocument.createElement('div');
          return tooltipContent(this.ownerDocument, '', [
            {
              color: t.colors[p.dataIndex % 12]!,
              name: r.label,
              value:
                r.value === null
                  ? r.qv.badge || vi.noValue
                  : `${r.text}${r.unit ? ' ' + r.unit : ''}${r.qv.badge ? ' ' + r.qv.badge : ''}`,
            },
          ]);
        },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 56,
          data,
          label: {
            show: showValues,
            position,
            color: t.text,
            fontWeight: 600,
            formatter: (p: { dataIndex: number }) => {
              const r = rows[p.dataIndex];
              return r ? (r.qv.badge ? `${r.text} ${r.qv.badge}` : r.text) : '';
            },
          },
        },
      ],
    };
  }
}
