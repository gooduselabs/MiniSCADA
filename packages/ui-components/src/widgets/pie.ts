// Widget `pie` (FR-030): biểu đồ tròn hoặc donut bằng SVG tự viết, ≤ 8 Tag số ≥ 0. Phần tử âm hoặc BAD bị loại khỏi
// tổng và có dấu "bị loại" trong chú giải; tổng 0 hiện "Không có dữ liệu" (không chia cho 0).
import { css, html, nothing, svg, type TemplateResult } from 'lit';
import { sliceShape } from '../chart/geometry.ts';
import { pieSlices } from '../chart/pie-chart.ts';
import { fixed, formatValue, numberOf } from '../format/format-value.ts';
import { vi } from '../i18n/vi.ts';
import { MatWidget } from './base.ts';

const MAX = 8;
const R = 46;
const R_IN = 28;

export class MatPie extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        flex-direction: row;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
      }
      svg {
        flex: 1 1 50%;
        min-width: 0;
        max-height: 100%;
        aspect-ratio: 1;
      }
      .slice {
        stroke: var(--mat-surface);
        stroke-width: 1;
        fill-rule: evenodd;
      }
      .slice.c1 {
        fill: var(--mat-chart-1);
      }
      .slice.c2 {
        fill: var(--mat-chart-2);
      }
      .slice.c3 {
        fill: var(--mat-chart-3);
      }
      .slice.c4 {
        fill: var(--mat-chart-4);
      }
      .slice.c5 {
        fill: var(--mat-chart-5);
      }
      .slice.c6 {
        fill: var(--mat-chart-6);
      }
      .slice.c7 {
        fill: var(--mat-chart-7);
      }
      .slice.c8 {
        fill: var(--mat-chart-8);
      }
      .none {
        fill: var(--mat-surface-2);
        stroke: var(--mat-border-strong);
        stroke-width: 1;
      }
      .total {
        fill: var(--mat-text);
        font-size: 9px;
        font-weight: 600;
        text-anchor: middle;
        font-family: var(--mat-font);
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
        border-radius: 2px;
      }
      .sw.c1 {
        background: var(--mat-chart-1);
      }
      .sw.c2 {
        background: var(--mat-chart-2);
      }
      .sw.c3 {
        background: var(--mat-chart-3);
      }
      .sw.c4 {
        background: var(--mat-chart-4);
      }
      .sw.c5 {
        background: var(--mat-chart-5);
      }
      .sw.c6 {
        background: var(--mat-chart-6);
      }
      .sw.c7 {
        background: var(--mat-chart-7);
      }
      .sw.c8 {
        background: var(--mat-chart-8);
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

  protected override renderWidget(): TemplateResult {
    const ids = this.tagsOf('series').slice(0, MAX);
    const labels = Array.isArray(this.item.props?.labels)
      ? (this.item.props!.labels as unknown[])
      : [];
    const rows = ids.map((id, i) => {
      const info = this.source.info(id);
      const state = this.source.get(id);
      const qv = this.qv(id);
      const n = numberOf(state.value);
      const usable =
        Number.isFinite(n) && (state.quality === 'GOOD' || state.quality === 'UNCERTAIN');
      const fmt = formatValue(state, info, { decimals: this.decimals(info) });
      const label = (typeof labels[i] === 'string' && labels[i]) || info?.description || id;
      return { id, i, info, qv, value: usable ? n : null, fmt, label: label as string };
    });
    const res = pieSlices(rows.map((r) => r.value));
    const donut = this.prop('donut', true);
    const decimals = this.decimals(undefined);
    const pct = (f: number) => `${fixed(f * 100, decimals)}%`;
    const showPct = this.prop('showPercent', true);
    const units = new Set(rows.map((r) => r.fmt.unit));
    const unit = units.size === 1 ? [...units][0]! : '';
    const totalText = fixed(res.total, decimals) + (unit ? ` ${unit}` : '');

    const aria =
      rows.length === 0 || res.empty
        ? `${vi.widget.pie}: ${vi.chart.noData}`
        : `${vi.widget.pie}: ${rows
            .map((r) => {
              const s = res.slices[r.i]!;
              return s.included
                ? `${r.label} ${pct(s.fraction)}`
                : `${r.label} (${vi.chart.excluded})`;
            })
            .join(', ')}`;

    return html`<div class="w">
      <svg role="img" aria-label=${aria} viewBox="0 0 100 100">
        ${
          res.empty
            ? svg`<circle class="none" cx="50" cy="50" r=${R} />`
            : res.slices.map((s) =>
                s.included && s.endDeg > s.startDeg
                  ? svg`<path class="slice c${(s.index % 8) + 1}" d=${sliceShape(50, 50, R, donut ? R_IN : 0, s.startDeg, s.endDeg)} data-fraction=${s.fraction} />`
                  : nothing,
              )
        }
        ${
          donut && !res.empty && this.prop('showTotal', false)
            ? svg`<text class="total" x="50" y="53">${totalText}</text>`
            : nothing
        }
      </svg>
      <ul class="legend">
        ${res.empty ? html`<li class="empty">${vi.chart.noData}</li>` : nothing}
        ${rows.map((r) => {
          const s = res.slices[r.i]!;
          return html`<li>
            <span class="sw c${(r.i % 8) + 1}"></span>
            <span class="ellipsis" title=${r.label}>${r.label}</span>
            ${
              s.included
                ? html`<span class="val">${r.fmt.text}</span
                    >${showPct ? html`<span class="pct">${pct(s.fraction)}</span>` : nothing}`
                : html`<span class="excl"
                    >${vi.chart.excluded}
                    (${s.reason === 'negative' ? vi.chart.negative : r.qv.badge || 'BAD'})</span
                  >`
            }
          </li>`;
        })}
      </ul>
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
              <td>${r.fmt.text}${r.fmt.unit ? ' ' + r.fmt.unit : ''}</td>
              <td>${s.included ? pct(s.fraction) : vi.chart.excluded}</td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
  }
}
