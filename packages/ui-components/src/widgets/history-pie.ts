// Widget `history-pie` (feature 010, FR-039; contracts/widget-catalog-010.md §2): biểu đồ tròn hoặc donut trên số
// tổng hợp của một kỳ. Một lần `aggregate` với một cửa sổ bao cả kỳ; số và phần trăm do `pieModel` của
// @mat/history-math (cùng hàm với báo cáo). Tag âm hoặc thiếu bị loại và có chữ "bị loại" ở chú giải.
import { css, html, nothing, svg, type TemplateResult } from 'lit';
import {
  isEmptyRequest,
  parseUtcOffset,
  pieModel,
  type AggFn,
  type PieModel,
} from '@mat/history-math';
import { sliceShape } from '../chart/geometry.ts';
import { fixed } from '../format/format-value.ts';
import type { HistoryCatalogGroup } from '../host/history-source.ts';
import { viHistory } from '../i18n/history-vi.ts';
import { historyBaseStyles, MatHistoryWidget } from './history-base.ts';

const MAX = 8;
const R = 46;
const R_IN = 28;

export class MatHistoryPie extends MatHistoryWidget {
  static override properties = { ...MatHistoryWidget.properties, _model: { state: true } };
  static override styles = [
    MatHistoryWidget.styles,
    historyBaseStyles,
    css`
      .row {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 0;
      }
      svg {
        flex: 1 1 50%;
        min-width: 0;
        max-height: 100%;
        aspect-ratio: 1;
      }
      .slice {
        stroke: var(--mat-surface, #fff);
        stroke-width: 1;
        fill-rule: evenodd;
      }
      .slice.c1 {
        fill: var(--mat-chart-1, #0b7285);
      }
      .slice.c2 {
        fill: var(--mat-chart-2, #c2410c);
      }
      .slice.c3 {
        fill: var(--mat-chart-3, #6f42c1);
      }
      .slice.c4 {
        fill: var(--mat-chart-4, #15703a);
      }
      .slice.c5 {
        fill: var(--mat-chart-5, #b4234a);
      }
      .slice.c6 {
        fill: var(--mat-chart-6, #1c64c4);
      }
      .slice.c7 {
        fill: var(--mat-chart-7, #8f5e00);
      }
      .slice.c8 {
        fill: var(--mat-chart-8, #56646a);
      }
      .none {
        fill: var(--mat-surface-2, #f5f7f8);
        stroke: var(--mat-border-strong, #b3bec3);
      }
      .total {
        fill: var(--mat-text, #1a2225);
        font-size: 9px;
        font-weight: 600;
        text-anchor: middle;
        font-family: var(--mat-font);
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
      }
      .sw {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: 2px;
      }
      .sw.c1 {
        background: var(--mat-chart-1, #0b7285);
      }
      .sw.c2 {
        background: var(--mat-chart-2, #c2410c);
      }
      .sw.c3 {
        background: var(--mat-chart-3, #6f42c1);
      }
      .sw.c4 {
        background: var(--mat-chart-4, #15703a);
      }
      .sw.c5 {
        background: var(--mat-chart-5, #b4234a);
      }
      .sw.c6 {
        background: var(--mat-chart-6, #1c64c4);
      }
      .sw.c7 {
        background: var(--mat-chart-7, #8f5e00);
      }
      .sw.c8 {
        background: var(--mat-chart-8, #56646a);
      }
      .pct {
        font-weight: 600;
        margin-left: auto;
        font-variant-numeric: tabular-nums;
      }
      .excl {
        color: var(--mat-bad, #c42b2b);
        font-weight: 600;
        margin-left: auto;
      }
    `,
  ];

  declare _model: PieModel | null;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this._model = null;
  }

  #tags(): string[] {
    return this.tagsOf('series').slice(0, MAX);
  }

  #labelOf(i: number): string {
    const l = this.item?.props?.labels;
    const v = Array.isArray(l) ? l[i] : undefined;
    return (typeof v === 'string' && v) || this.#tags()[i] || '';
  }

  #cfg() {
    return {
      fn: this.prop('fn', 'delta') as AggFn,
      period: this.prop('period', 'today') as never,
      shiftCount: this.prop('shiftCount', 3),
      shiftStart: this.prop('shiftStart', '06:00'),
    };
  }

  protected override hasData(): boolean {
    return !!this._model && this._model.slices.length > 0;
  }

  protected override onGroupReady(g: HistoryCatalogGroup): void {
    if (!g.aggregates) {
      this._errMsg = viHistory.state.noAggregates;
      this._status = 'error';
      return;
    }
    const sec = Math.max(30, Math.min(3600, Math.trunc(this.prop('refreshSec', 60))));
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = setInterval(() => {
      if (!this.ownerDocument.hidden) void this.#load();
    }, sec * 1000);
    void this.#load();
  }

  protected override onDispose(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this._model = null;
  }

  protected override retry(): void {
    if (this.group && this.group.aggregates) void this.#load();
    else super.retry();
  }

  async #load(): Promise<void> {
    const g = this.group;
    const history = this.history;
    if (!g || !history) return;
    const tz = parseUtcOffset(g.timeZone);
    const now = this.source ? this.source.now() : Date.now();
    const tags = this.#tags();
    const labels = tags.map((_, i) => this.#labelOf(i));
    const cfg = this.#cfg();
    const m0 = pieModel(cfg, now, tz, undefined, tags, labels);
    const req = m0.request;
    if (isEmptyRequest(req)) {
      // I2: khoảng rỗng/ngược không gọi API (máy chủ trả 400); hủy yêu cầu cũ và hiện trống.
      this.cancelRun();
      this._model = { ...m0, slices: [] };
      this._status = 'empty';
      return;
    }
    const res = await this.run((signal) =>
      history.aggregate(
        {
          group: g.id,
          tags,
          from: req.from,
          to: req.to,
          bucketMs: req.bucketMs,
          offsetMs: req.offsetMs,
          priority: 'background',
        },
        signal,
      ),
    );
    if (!res) return;
    this._model = pieModel(cfg, now, tz, res.value, tags, labels);
    if (this._model.slices.length === 0 || this._model.total === 0) {
      this._model = { ...this._model, slices: [] };
      this._status = 'empty';
    }
  }

  protected override renderWidget(): TemplateResult {
    const m = this._model;
    const tags = this.#tags();
    const decimals = Math.max(0, Math.min(6, Math.trunc(this.prop('decimals', 1))));
    const donut = this.prop('donut', true);
    const showPct = this.prop('showPercent', true);
    const label = `${viHistory.widget.pie}: ${tags.map((_, i) => this.#labelOf(i)).join(', ')}`;
    const slices = m?.slices ?? [];
    let acc = 0;
    const arcs = slices.map((s) => {
      const a0 = acc * 3.6;
      acc += s.percent;
      return { s, a0, a1: acc * 3.6 };
    });
    const shape = (a0: number, a1: number) =>
      sliceShape(50, 50, R, donut ? R_IN : 0, a0, Math.min(a1, a0 + 359.99));
    const idx = (id: string) => tags.indexOf(id);
    const total = m ? m.total : 0;
    const exclReason = (id: string) => m?.excluded.find((e) => e.tagId === id);
    return html`<div class="w hw" role="group" aria-label=${label}>
      <div class="row">
        <svg role="img" aria-label=${label} viewBox="0 0 100 100">
          ${
            slices.length === 0
              ? svg`<circle class="none" cx="50" cy="50" r=${R} />`
              : arcs.map(
                  ({ s, a0, a1 }) =>
                    svg`<path class="slice c${(idx(s.tagId) % 8) + 1}" d=${shape(a0, a1)}><title>${s.label} ${fixed(s.value, decimals)}</title></path>`,
                )
          }
          ${donut && slices.length > 0 && this.prop('showTotal', false) ? svg`<text class="total" x="50" y="53">${fixed(total, decimals)}</text>` : nothing}
        </svg>
        <ul class="legend">
          ${tags.map((id, i) => {
            const sl = slices.find((s) => s.tagId === id);
            const ex = exclReason(id);
            return html`<li>
              <span class="sw c${(i % 8) + 1}"></span>
              <span>${this.#labelOf(i)}</span>
              ${
                sl
                  ? html`<span class="val">${fixed(sl.value, decimals)}</span
                      >${showPct ? html`<span class="pct">${fixed(sl.percent, decimals)}%</span>` : nothing}`
                  : m
                    ? html`<span class="excl"
                        >${viHistory.pie.excluded}${ex?.reason === 'negative' ? ' (âm)' : ''}</span
                      >`
                    : nothing
              }
            </li>`;
          })}
        </ul>
      </div>
      <table class="sr-only">
        <caption>
          ${viHistory.seriesTable}
        </caption>
        <thead>
          <tr>
            <th scope="col">${viHistory.series}</th>
            <th scope="col">${viHistory.value}</th>
          </tr>
        </thead>
        <tbody>
          ${tags.map((id, i) => {
            const sl = slices.find((s) => s.tagId === id);
            return html`<tr>
              <td>${this.#labelOf(i)}</td>
              <td>
                ${sl ? `${fixed(sl.value, decimals)} (${fixed(sl.percent, decimals)}%)` : viHistory.pie.excluded}
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
      ${this.renderStatus()}
    </div>`;
  }
}
