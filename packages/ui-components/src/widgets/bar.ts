// Widget `bar` (FR-030): biểu đồ cột dọc hoặc ngang bằng SVG tự viết, ≤ 12 Tag, giá trị hiện tại.
// Cột BAD/STALE/UNKNOWN không vẽ mà có chữ BAD/STALE/? tại chỗ (không chỉ màu).
import { css, html, nothing, svg, type TemplateResult } from 'lit';
import { barLayout } from '../chart/bar-chart.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
import { vi } from '../i18n/vi.ts';
import { MatWidget } from './base.ts';

const MAX = 12;

export class MatBar extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        padding: 4px;
        justify-content: stretch;
      }
      svg {
        flex: 1;
        width: 100%;
        height: 100%;
        min-height: 0;
      }
      .bar.c1 {
        fill: var(--mat-chart-1);
      }
      .bar.c2 {
        fill: var(--mat-chart-2);
      }
      .bar.c3 {
        fill: var(--mat-chart-3);
      }
      .bar.c4 {
        fill: var(--mat-chart-4);
      }
      .bar.c5 {
        fill: var(--mat-chart-5);
      }
      .bar.c6 {
        fill: var(--mat-chart-6);
      }
      .bar.c7 {
        fill: var(--mat-chart-7);
      }
      .bar.c8 {
        fill: var(--mat-chart-8);
      }
      .bar.dim {
        opacity: 0.45;
      }
      .axis {
        stroke: var(--mat-border-strong);
        stroke-width: 1;
      }
      text {
        fill: var(--mat-text);
        font-size: 11px;
        font-family: var(--mat-font);
      }
      .cat {
        fill: var(--mat-text-muted);
      }
      .val {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .mark {
        fill: var(--mat-bad);
        font-weight: 700;
      }
      .mark.q-stale,
      .mark.q-unknown {
        fill: var(--mat-text-muted);
      }
      .mark.q-uncertain {
        fill: var(--mat-warn);
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

  protected override renderWidget(): TemplateResult {
    const ids = this.tagsOf('series').slice(0, MAX);
    const horizontal = this.prop('orientation', 'vertical') === 'horizontal';
    const W = Math.max(this.item.width || 400, 40);
    const H = Math.max(this.item.height || 260, 40);
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
      return { id, i, info, state, qv, value: usable ? n : null, fmt, label: label as string };
    });

    const rule = (x: unknown): number | undefined =>
      typeof x === 'number' && Number.isFinite(x) ? x : undefined;
    const area = horizontal
      ? { x: 96, y: 6, width: Math.max(W - 96 - 56, 10), height: Math.max(H - 12, 10) }
      : { x: 8, y: 20, width: Math.max(W - 16, 10), height: Math.max(H - 20 - 26, 10) };
    const layout = barLayout(
      rows.map((r) => r.value),
      {
        min: rule(this.item.props?.min),
        max: rule(this.item.props?.max),
        orientation: horizontal ? 'horizontal' : 'vertical',
        area,
      },
    );
    const showValues = this.prop('showValues', true);
    const band = rows.length > 0 ? (horizontal ? area.height : area.width) / rows.length : 0;
    const maxChars = horizontal ? 14 : Math.max(3, Math.floor(band / 6));
    const cut = (s: string) =>
      s.length > maxChars ? `${s.slice(0, Math.max(1, maxChars - 1))}…` : s;

    const summary = rows
      .map(
        (r) =>
          `${r.label} ${r.value === null ? r.qv.aria || vi.noValue : r.fmt.text + (r.fmt.unit ? ' ' + r.fmt.unit : '')}`,
      )
      .join(', ');
    const aria =
      rows.length === 0 ? `${vi.widget.bar}: ${vi.chart.noData}` : `${vi.widget.bar}: ${summary}`;

    if (rows.length === 0)
      return html`<div
        class="w ${horizontal ? 'horizontal' : 'vertical'}"
        role="img"
        aria-label=${aria}
      >
        <div class="empty">${vi.chart.noData}</div>
      </div>`;

    return html`<div class="w ${horizontal ? 'horizontal' : 'vertical'}">
      <svg
        role="img"
        aria-label=${aria}
        viewBox="0 0 ${W} ${H}"
        preserveAspectRatio="xMidYMid meet"
      >
        ${svg`<line class="axis" x1=${horizontal ? layout.zero : area.x} y1=${horizontal ? area.y : layout.zero}
          x2=${horizontal ? layout.zero : area.x + area.width} y2=${horizontal ? area.y + area.height : layout.zero} />`}
        ${layout.bars.map((b) => {
          const r = rows[b.index]!;
          const cx = b.x + b.width / 2;
          const cy = b.y + b.height / 2;
          const slotW = horizontal ? 0 : band;
          void slotW;
          const catX = horizontal ? area.x - 6 : cx;
          const catY = horizontal ? cy + 4 : area.y + area.height + 16;
          const anchor = horizontal ? 'end' : 'middle';
          const valX = horizontal ? Math.max(b.x + b.width, layout.zero) + 4 : cx;
          const valY = horizontal ? cy + 4 : Math.min(b.y, layout.zero) - 4;
          return svg`<g class="col">
            <rect class="bar c${(b.index % 8) + 1} ${r.qv.dim ? 'dim' : ''}" x=${b.x} y=${b.y} width=${b.width} height=${b.height}
              data-value=${b.value ?? ''} />
            <g class="catg"><title>${r.label}</title>
              <text class="cat" x=${catX} y=${catY} text-anchor=${anchor}>${cut(r.label)}</text></g>
            ${
              r.value === null
                ? svg`<text class="mark ${r.qv.cls}" x=${horizontal ? area.x + 4 : cx} y=${horizontal ? cy + 4 : area.y + area.height - 6} text-anchor=${horizontal ? 'start' : 'middle'}>${r.qv.badge || vi.noValue}</text>`
                : showValues
                  ? svg`<text class="val" x=${valX} y=${valY} text-anchor=${horizontal ? 'start' : 'middle'}>${r.fmt.text}</text>`
                  : nothing
            }
            ${r.value !== null && r.qv.badge ? svg`<text class="mark ${r.qv.cls}" x=${cx} y=${b.y + 12} text-anchor="middle">${r.qv.badge}</text>` : nothing}
          </g>`;
        })}
      </svg>
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
                <td>
                  ${r.fmt.text}${r.fmt.unit ? ' ' + r.fmt.unit : ''}${r.qv.aria ? ' ' + r.qv.aria : ''}
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }
}
