// Widget `pie` (FR-030; feature 012 FR-033, FR-037): biểu đồ tròn hoặc vành khuyên (`donut`, mặc định true) bằng ECharts
// lite, ≤ 8 Tag số ≥ 0. Phần tử âm hoặc BAD bị loại khỏi tổng và có dấu "bị loại" trong chú giải; tổng 0 hiện "Không có
// dữ liệu" (không chia cho 0, không nạp ECharts). Chú giải, phần trăm, tổng ở giữa và phần truy cập do Lit vẽ; ECharts chỉ
// vẽ cung (tooltip dựng bằng DOM).
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { tooltipContent, type ChartTheme } from '../chart/echarts-lite.ts';
import { pieSlices, type PieResult } from '../chart/pie-chart.ts';
import { fixed, formatValue, numberOf } from '../format/format-value.ts';
import { vi } from '../i18n/vi.ts';
import { MatEChartWidget } from './chart-base.ts';

const MAX = 8;

interface Row {
  i: number;
  label: string;
  value: number | null;
  text: string;
  unit: string;
}

export class MatPie extends MatEChartWidget {
  static override styles = [
    MatEChartWidget.styles,
    css`
      .w {
        padding: 6px 8px;
      }
      .pane,
      .framed > .pane {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: row;
        align-items: center;
        gap: 10px;
      }
      .pie {
        flex: 1 1 50%;
        min-width: 0;
        max-height: 100%;
        aspect-ratio: 1;
        position: relative;
        display: flex;
      }
      .none {
        flex: 1;
        margin: 4%;
        border-radius: 50%;
        background: var(--mat-surface-2);
        border: 1px solid var(--mat-border-strong);
      }
      .total {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        color: var(--mat-text);
        font-size: 13px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .legend {
        flex: 1 1 50%;
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 12px;
        min-width: 0;
      }
      .legend li {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .sw {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: 3px;
      }
      .pct {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        margin-left: auto;
      }
      .excl {
        color: var(--mat-bad);
        font-weight: 600;
      }
      .empty {
        text-align: center;
        color: var(--mat-text-muted);
        font-size: 11px;
      }
    `,
  ];

  #rows: Row[] = [];
  #res: PieResult = { total: 0, empty: true, slices: [] };

  #pct(f: number): string {
    return `${fixed(f * 100, this.decimals(undefined))}%`;
  }

  protected override renderWidget(): TemplateResult {
    const ids = this.tagsOf('series').slice(0, MAX);
    const labels = Array.isArray(this.item.props?.labels)
      ? (this.item.props!.labels as unknown[])
      : [];
    const qvs = ids.map((id) => this.qv(id));
    const rows: Row[] = ids.map((id, i) => {
      const info = this.source.info(id);
      const state = this.source.get(id);
      const n = numberOf(state.value);
      const usable =
        Number.isFinite(n) && (state.quality === 'GOOD' || state.quality === 'UNCERTAIN');
      const fmt = formatValue(state, info, { decimals: this.decimals(info) });
      const label = (typeof labels[i] === 'string' && labels[i]) || info?.description || id;
      return {
        i,
        label: label as string,
        value: usable ? n : null,
        text: fmt.text,
        unit: fmt.unit,
      };
    });
    const res = pieSlices(rows.map((r) => r.value));
    this.#rows = rows;
    this.#res = res;
    const donut = this.prop('donut', true);
    const decimals = this.decimals(undefined);
    const showPct = this.prop('showPercent', true);
    const units = new Set(rows.map((r) => r.unit));
    const unit = units.size === 1 ? [...units][0]! : '';
    const totalText = fixed(res.total, decimals) + (unit ? ` ${unit}` : '');
    const empty = rows.length === 0 || res.empty;

    const aria = empty
      ? `${vi.widget.pie}: ${vi.chart.noData}`
      : `${vi.widget.pie}: ${rows
          .map((r) => {
            const s = res.slices[r.i]!;
            return s.included
              ? `${r.label} ${this.#pct(s.fraction)}`
              : `${r.label} (${vi.chart.excluded})`;
          })
          .join(', ')}`;

    const title = this.titleText();
    return html`<div class="w ${title ? 'framed' : ''}">
      ${this.head()}
      <div class="pane ${title ? 'body' : ''}">
        <div class="pie" role="img" aria-label=${aria}>
          ${empty ? html`<div class="none"></div>` : html`<div class="ec" part="chart"></div>`}
          ${
            donut && !empty && this.prop('showTotal', false)
              ? html`<div class="total">${totalText}</div>`
              : nothing
          }
        </div>
        <ul class="legend">
          ${res.empty ? html`<li class="empty">${vi.chart.noData}</li>` : nothing}
          ${rows.map((r) => {
            const s = res.slices[r.i]!;
            return html`<li>
              <span
                class="sw"
                style=${styleMap({ background: `var(--mat-chart-${(r.i % 12) + 1})` })}
              ></span>
              <span class="ellipsis" title=${r.label}>${r.label}</span>
              ${
                s.included
                  ? html`<span class="val">${r.text}</span>${
                        showPct ? html`<span class="pct">${this.#pct(s.fraction)}</span>` : nothing
                      }`
                  : html`<span class="excl"
                      >${vi.chart.excluded}
                      (${s.reason === 'negative' ? vi.chart.negative : qvs[r.i]!.badge || 'BAD'})</span
                    >`
              }
            </li>`;
          })}
        </ul>
      </div>
      <table class="sr-only">
        <caption>
          ${vi.chart.seriesTable}
        </caption>
        <thead>
          <tr>
            <th scope="col">${vi.chart.series}</th>
            <th scope="col">${vi.chart.value}</th>
            <th scope="col">${vi.chart.percent}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => {
            const s = res.slices[r.i]!;
            return html`<tr>
              <td>${r.label}</td>
              <td>${r.text}${r.unit ? ' ' + r.unit : ''}</td>
              <td>${s.included ? this.#pct(s.fraction) : vi.chart.excluded}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
  }

  protected override chartOption(t: ChartTheme): Record<string, unknown> | null {
    const res = this.#res;
    if (res.empty) return null;
    const rows = this.#rows;
    const shown = rows.filter((r) => res.slices[r.i]!.included && res.slices[r.i]!.fraction > 0);
    const donut = this.prop('donut', true);
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const r = shown[p.dataIndex];
          if (!r) return this.ownerDocument.createElement('div');
          return tooltipContent(this.ownerDocument, '', [
            {
              color: t.colors[r.i % 12]!,
              name: r.label,
              value: `${r.text}${r.unit ? ' ' + r.unit : ''} · ${this.#pct(res.slices[r.i]!.fraction)}`,
            },
          ]);
        },
      },
      series: [
        {
          type: 'pie',
          radius: donut ? ['56%', '92%'] : [0, '92%'],
          center: ['50%', '50%'],
          startAngle: 90,
          clockwise: true,
          avoidLabelOverlap: false,
          label: { show: false },
          labelLine: { show: false },
          emphasis: { scale: true, scaleSize: 4, label: { show: false } },
          itemStyle: {
            borderColor: t.surface,
            borderWidth: shown.length > 1 ? 2 : 0,
            borderRadius: donut ? Math.min(t.radius, 6) : 0,
          },
          data: shown.map((r) => ({
            name: r.label,
            value: r.value,
            itemStyle: { color: t.colors[r.i % 12]! },
          })),
        },
      ],
    };
  }
}
