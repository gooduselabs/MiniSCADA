// Widget `history-bar` (feature 010, FR-038; contracts/widget-catalog-010.md §2): biểu đồ cột theo giờ, ca hoặc ngày
// từ bảng tổng hợp. Cửa sổ và số tính bằng `barModel` của @mat/history-math (cùng hàm với báo cáo nên cùng kỳ cho cùng
// số, SC-015); widget chỉ gọi `aggregate` một lần mỗi lượt và vẽ SVG tự viết. Làm mới mỗi `refreshSec`.
import { css, html, nothing, svg, type TemplateResult } from 'lit';
import { barModel, parseUtcOffset, type BarModel, type AggFn } from '@mat/history-math';
import { fixed } from '../format/format-value.ts';
import type { HistoryCatalogGroup } from '../host/history-source.ts';
import { viHistory } from '../i18n/history-vi.ts';
import { historyBaseStyles, MatHistoryWidget } from './history-base.ts';

const MAX_SERIES = 4;
const W = 400;
const H = 220;
const ML = 40;
const MB = 34;
const MT = 14;
const MR = 8;

/** Mốc trục Y "đẹp": 1, 2, 5 × 10^n. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step)
    out.push(+t.toFixed(10));
  return out;
}

export class MatHistoryBar extends MatHistoryWidget {
  static override properties = { ...MatHistoryWidget.properties, _model: { state: true } };
  static override styles = [
    MatHistoryWidget.styles,
    historyBaseStyles,
    css`
      svg {
        flex: 1;
        width: 100%;
        min-height: 0;
      }
      .bar.c1 {
        fill: var(--mat-chart-1, #0b7285);
      }
      .bar.c2 {
        fill: var(--mat-chart-2, #c2410c);
      }
      .bar.c3 {
        fill: var(--mat-chart-3, #6f42c1);
      }
      .bar.c4 {
        fill: var(--mat-chart-4, #15703a);
      }
      text {
        fill: var(--mat-text, #1a2225);
        font-size: 9px;
        font-family: var(--mat-font);
      }
      text.val {
        font-size: 8px;
        text-anchor: middle;
      }
      text.cat {
        text-anchor: middle;
      }
      text.tick {
        text-anchor: end;
        fill: var(--mat-text-muted, #56646a);
      }
      .axis,
      .grid {
        stroke: var(--mat-border-strong, #b3bec3);
        stroke-width: 0.6;
      }
      .grid {
        stroke: var(--mat-border, #d2d9dc);
      }
      .legend {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 2px 12px;
        font-size: 12px;
      }
      .legend li {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .sw {
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
    `,
  ];

  declare _model: BarModel | null;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this._model = null;
  }

  #tags(): string[] {
    return this.tagsOf('series').slice(0, MAX_SERIES);
  }

  #labels(): string[] {
    const v = this.item?.props?.labels;
    return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : '')) : [];
  }

  #labelOf(i: number): string {
    return this.#labels()[i] || this.#tags()[i] || '';
  }

  #cfg() {
    return {
      fn: this.prop('fn', 'delta') as AggFn,
      bucket: this.prop('bucket', 'shift') as 'hour' | 'shift' | 'day',
      period: this.prop('period', 'last7d') as never,
      shiftCount: this.prop('shiftCount', 3),
      shiftStart: this.prop('shiftStart', '06:00'),
    };
  }

  #now(): number {
    return this.source ? this.source.now() : Date.now();
  }

  protected override hasData(): boolean {
    return !!this._model && this._model.series.some((s) => s.values.some((v) => v !== null));
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
    const now = this.#now();
    const tags = this.#tags();
    const labels = tags.map((_, i) => this.#labelOf(i));
    const cfg = this.#cfg();
    const m0 = barModel(cfg, now, tz, undefined, tags, labels, viHistory.shiftWord);
    const req = m0.request;
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
    this._model = barModel(cfg, now, tz, res.value, tags, labels, viHistory.shiftWord);
    if (!this.hasData()) this._status = 'empty';
  }

  // ---- vẽ ---------------------------------------------------------------------------------------------------

  #fmt(v: number | null): string {
    return v === null ? viHistory.noValue : fixed(v, this.decimalsProp());
  }

  private decimalsProp(): number {
    return Math.max(0, Math.min(6, Math.trunc(this.prop('decimals', 1))));
  }

  protected override renderWidget(): TemplateResult {
    const m = this._model;
    const label = `${viHistory.widget.bar}: ${this.#tags()
      .map((_, i) => this.#labelOf(i))
      .join(', ')}`;
    const nCat = m?.categories.length ?? 0;
    const nSer = m?.series.length ?? this.#tags().length;
    const vals = (m?.series ?? []).flatMap((s) => s.values).filter((v): v is number => v !== null);
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals, lo + 1e-9);
    const ticks = niceTicks(lo, hi);
    const y0 = Math.min(ticks[0] ?? lo, lo);
    const y1 = Math.max(ticks[ticks.length - 1] ?? hi, hi);
    const pw = W - ML - MR;
    const ph = H - MT - MB;
    const y = (v: number) => MT + ph * (1 - (v - y0) / (y1 - y0 || 1));
    const gw = nCat > 0 ? pw / nCat : pw;
    const bw = (gw * 0.8) / Math.max(1, nSer);
    const showVals = this.prop('showValues', true) && nCat * nSer <= 24;
    const rotate = nCat > 10;
    return html`<div class="w hw" role="group" aria-label=${label}>
      <svg
        viewBox="0 0 ${W} ${H}"
        role="img"
        aria-label=${label}
        preserveAspectRatio="xMidYMid meet"
      >
        ${ticks.map(
          (t) => svg`<line class="grid" x1=${ML} x2=${W - MR} y1=${y(t)} y2=${y(t)} />
            <text class="tick" x=${ML - 4} y=${y(t) + 3}>${fixed(t, Math.abs(t) < 10 && t % 1 !== 0 ? 1 : 0)}</text>`,
        )}
        <line class="axis" x1=${ML} x2=${ML} y1=${MT} y2=${H - MB} />
        <line class="axis" x1=${ML} x2=${W - MR} y1=${y(0)} y2=${y(0)} />
        ${(m?.categories ?? []).map((c, k) => {
          const cx = ML + gw * k + gw / 2;
          return svg`<text class="cat" x=${cx} y=${H - MB + 12} transform=${rotate ? `rotate(-40 ${cx} ${H - MB + 12})` : ''}>${c.label}</text>`;
        })}
        ${(m?.series ?? []).map((s, i) =>
          s.values.map((v, k) => {
            if (v === null) return nothing;
            const x = ML + gw * k + gw * 0.1 + bw * i;
            const top = y(Math.max(v, 0));
            const h = Math.abs(y(v) - y(0));
            return svg`<rect class="bar c${(i % 8) + 1}" x=${x} y=${top} width=${bw} height=${Math.max(h, 0.5)}><title>${this.#fmt(v)}</title></rect>
              ${showVals ? svg`<text class="val" x=${x + bw / 2} y=${top - 2}>${this.#fmt(v)}</text>` : nothing}`;
          }),
        )}
      </svg>
      ${
        nSer > 1 || this.#labels().length
          ? html`<ul class="legend">
              ${this.#tags().map(
                (_, i) =>
                  html`<li><span class="sw c${(i % 8) + 1}"></span>${this.#labelOf(i)}</li>`,
              )}
            </ul>`
          : nothing
      }
      <table class="sr-only">
        <caption>
          ${viHistory.seriesTable}
        </caption>
        <thead>
          <tr>
            <th scope="col">${viHistory.time}</th>
            ${this.#tags().map((_, i) => html`<th scope="col">${this.#labelOf(i)}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${(m?.categories ?? []).map(
            (c, k) =>
              html`<tr>
                <td>${c.label}</td>
                ${(m?.series ?? []).map((s) => html`<td>${this.#fmt(s.values[k] ?? null)}</td>`)}
              </tr>`,
          )}
        </tbody>
      </table>
      ${this.renderStatus()}
    </div>`;
  }
}
