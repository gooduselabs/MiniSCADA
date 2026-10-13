// Widget `history-trend` (feature 010, FR-032…FR-039; contracts/widget-catalog-010.md §5): biểu đồ đường lịch sử từ
// HistorySource. uPlot tải lười (chỉ vẽ); mọi tương tác do widget xử lý: kéo chọn = phóng, cuộn = phóng/thu quanh
// con trỏ (±25 %), Shift+kéo = dịch, bấm đúp = về khoảng ban đầu, bàn phím (mũi tên, +/-, Home). Khoảng đổi → sau
// 250 ms hủy yêu cầu cũ và hỏi lại với maxPoints = min(2000, 2 × bề rộng vùng vẽ); giữ hình cũ khi chờ.
import { css, html, nothing, unsafeCSS, type TemplateResult } from 'lit';
import uplotCss from 'uplot/dist/uPlot.min.css?raw';
import { axisTime, localTime } from '../chart/history-fmt.ts';
import { fixed } from '../format/format-value.ts';
import {
  alignSeries,
  loadHistoryPlot,
  nearestIndex,
  panRange,
  pxToTime,
  tzOffsetMs,
  zoomRange,
  type AlignedData,
  type HistoryPlotAdapter,
  type HistoryPlotFactory,
  type TimeRange,
} from '../chart/history-plot.ts';
import {
  baseRange,
  endsNow,
  isRangeKey,
  RANGE_KEYS,
  type RangeKey,
} from '../chart/history-range.ts';
import { autoYRange, FALLBACK_SERIES_COLORS, SERIES_DASHES } from '../chart/line-chart.ts';
import type { HistoryCatalogGroup, SeriesResult } from '../host/history-source.ts';
import { viHistory } from '../i18n/history-vi.ts';
import { historyBaseStyles, MatHistoryWidget } from './history-base.ts';

const MAX_SERIES = 8;
const DEBOUNCE_MS = 250;
const FOLLOW_MS = 10_000;

/** Phần phụ thuộc môi trường, thay được trong test. */
export interface HistoryEnv {
  loadPlot: () => Promise<HistoryPlotFactory>;
  ResizeObserver: typeof ResizeObserver | undefined;
}
export const historyEnv: HistoryEnv = {
  loadPlot: loadHistoryPlot,
  ResizeObserver: globalThis.ResizeObserver,
};

export class MatHistoryTrend extends MatHistoryWidget {
  static override properties = {
    ...MatHistoryWidget.properties,
    _cursor: { state: true },
    _sel: { state: true },
    _hidden: { state: true },
    _rangeKey: { state: true },
    _following: { state: true },
    _rev: { state: true },
  };
  static override styles = [
    MatHistoryWidget.styles,
    historyBaseStyles,
    unsafeCSS(uplotCss),
    css`
      .controls {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }
      .controls .sp {
        flex: 1;
      }
      .imgwrap {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        gap: 4px;
      }
      .plot {
        position: relative;
        flex: 1;
        min-height: 40px;
        min-width: 0;
        touch-action: none;
        cursor: crosshair;
      }
      .plot:focus-visible {
        outline: 2px solid var(--mat-accent, #0b7285);
        outline-offset: 1px;
      }
      .plot-host {
        position: absolute;
        inset: 0;
      }
      .sel {
        position: absolute;
        top: 0;
        bottom: 24px;
        background: var(--mat-accent-soft, rgba(11, 114, 133, 0.18));
        border-left: 1px solid var(--mat-accent, #0b7285);
        border-right: 1px solid var(--mat-accent, #0b7285);
        pointer-events: none;
      }
      .cursor {
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: var(--mat-text-muted, #56646a);
        min-height: 16px;
      }
      .legend {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 2px 8px;
        font-size: 12px;
      }
      .legend button {
        font: inherit;
        color: inherit;
        background: none;
        border: 1px solid transparent;
        border-radius: 3px;
        padding: 0 4px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .legend button[aria-pressed='false'] {
        opacity: 0.45;
        text-decoration: line-through;
      }
      .legend button:focus-visible {
        outline: 2px solid var(--mat-accent, #0b7285);
      }
      .legend svg {
        width: 26px;
        height: 8px;
        flex: none;
      }
    `,
  ];

  declare _cursor: number | null;
  declare _sel: { x0: number; x1: number } | null;
  declare _hidden: ReadonlySet<number>;
  declare _rangeKey: RangeKey;
  declare _following: boolean;
  declare _rev: number;

  #data: AlignedData = { x: new Float64Array(0), y: [], lo: [], hi: [] };
  #view: TimeRange = { from: 0, to: 1 };
  #base: TimeRange = { from: 0, to: 1 };
  #plot: HistoryPlotAdapter | null = null;
  #plotLoading: Promise<void> | null = null;
  #ro: ResizeObserver | null = null;
  #debounce: ReturnType<typeof setTimeout> | null = null;
  #follow: ReturnType<typeof setInterval> | null = null;
  #drag: { mode: 'select' | 'pan'; x0: number; view: TimeRange } | null = null;
  #lastWidth = 0;

  constructor() {
    super();
    this._cursor = null;
    this._sel = null;
    this._hidden = new Set();
    this._rangeKey = '24h';
    this._following = true;
    this._rev = 0;
  }

  // ---- cấu hình ----------------------------------------------------------------------------------------------

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

  #tz(): string {
    return this.group?.timeZone ?? '+00:00';
  }

  #now(): number {
    return this.source ? this.source.now() : Date.now();
  }

  #stepFlags(): boolean[] {
    const mode = this.prop('step', 'auto');
    const stepped =
      mode === 'on' ||
      (mode === 'auto' && (this.group?.mode === 'onChange' || this.group?.mode === 'trigger'));
    return this.#tags().map(() => stepped);
  }

  #axes(): ('left' | 'right')[] {
    const v = this.item?.props?.axes;
    return this.#tags().map((_, i) => (Array.isArray(v) && v[i] === 'right' ? 'right' : 'left'));
  }

  #baseRange(key: RangeKey): TimeRange {
    return baseRange(key, this.#now(), tzOffsetMs(this.#tz()));
  }

  #endsNow(key: RangeKey): boolean {
    return endsNow(key);
  }

  // ---- lớp nền ------------------------------------------------------------------------------------------------

  protected override hasData(): boolean {
    return this.#data.x.length > 0;
  }

  protected override async onGroupReady(g: HistoryCatalogGroup): Promise<void> {
    void g;
    const raw = this.prop('range', '24h');
    this._rangeKey = isRangeKey(raw) ? raw : '24h';
    this.#base = this.#baseRange(this._rangeKey);
    this.#view = { ...this.#base };
    this._following = this.prop('follow', true) && this.#endsNow(this._rangeKey);
    await this.#ensurePlot();
    this.#startFollow();
    this.#schedule(true, 'user');
  }

  protected override onDispose(): void {
    if (this.#debounce !== null) clearTimeout(this.#debounce);
    this.#debounce = null;
    if (this.#follow !== null) clearInterval(this.#follow);
    this.#follow = null;
    this.#ro?.disconnect();
    this.#ro = null;
    this.#plot?.destroy();
    this.#plot = null;
    this.#plotLoading = null;
    this.cancelRun();
    this.#data = { x: new Float64Array(0), y: [], lo: [], hi: [] };
  }

  // ---- bộ vẽ -------------------------------------------------------------------------------------------------

  async #ensurePlot(): Promise<void> {
    if (this.#plot) return;
    if (!this.#plotLoading) {
      this.#plotLoading = (async () => {
        let factory: HistoryPlotFactory;
        try {
          factory = await historyEnv.loadPlot();
        } catch (e) {
          console.warn('không tải được uPlot:', e);
          this.handleError(new Error(viHistory.state.error));
          return;
        }
        await this.updateComplete;
        const host = this.renderRoot.querySelector<HTMLElement>('.plot-host');
        if (!host || !this.isConnected || this.#plot) return;
        const w = host.clientWidth || this.item.width || 640;
        const h = host.clientHeight || Math.max(80, (this.item.height || 320) - 90);
        const colors = this.#colors();
        this.#plot = factory(
          host,
          {
            width: w,
            height: h,
            series: this.#tags().map((_, i) => ({
              label: this.#labelOf(i),
              color: colors[i]!,
              dash: SERIES_DASHES[i] ?? [],
              width: 2,
              show: true,
              step: this.#stepFlags()[i]!,
              axis: this.#axes()[i]!,
            })),
            grid: this.prop('grid', true),
            showBand: this.prop('showBand', true),
            offsetMs: tzOffsetMs(this.#tz()),
            xRange: () => this.#view,
            yRange: (_s, min, max) =>
              autoYRange(
                min,
                max,
                numProp(this.item?.props?.yMin),
                numProp(this.item?.props?.yMax),
              ),
            xLabel: (ms, span) => axisTime(ms, span, this.#tz()),
            onCursor: (idx) => {
              this._cursor = idx;
            },
            axisColor: cssVar(this, '--mat-text-muted', '#56646a'),
            gridColor: cssVar(this, '--mat-border', '#d2d9dc'),
            bandColors: colors.map((c) => hexAlpha(c, 0.18)),
          },
          this.#data,
        );
        const RO = historyEnv.ResizeObserver;
        if (RO) {
          this.#ro = new RO((entries) => {
            const r = entries[entries.length - 1]?.contentRect;
            if (!r || !this.#plot) return;
            this.#plot.setSize(r.width, r.height);
            if (this.#lastWidth && Math.abs(r.width - this.#lastWidth) / this.#lastWidth > 0.08) {
              this.#schedule(false, 'background');
            }
            this.#lastWidth = r.width;
          });
          this.#ro.observe(host);
        }
      })();
    }
    await this.#plotLoading;
  }

  #colors(): string[] {
    return this.#tags().map((_, i) =>
      cssVar(this, `--mat-chart-${i + 1}`, FALLBACK_SERIES_COLORS[i]!),
    );
  }

  #plotWidth(): number {
    const w = this.#plot?.plotBox().width || 0;
    return w || this.clientWidth || this.item?.width || 640;
  }

  // ---- gọi API -----------------------------------------------------------------------------------------------

  #schedule(immediate: boolean, priority: 'user' | 'background'): void {
    if (this.#debounce !== null) clearTimeout(this.#debounce);
    this.#debounce = null;
    if (immediate) {
      void this.#fetch(priority);
      return;
    }
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      void this.#fetch(priority);
    }, DEBOUNCE_MS);
  }

  async #fetch(priority: 'user' | 'background'): Promise<void> {
    const g = this.group;
    const history = this.history;
    if (!g || !history) return;
    const v = { ...this.#view };
    const maxPoints = Math.max(10, Math.min(2000, Math.round(2 * this.#plotWidth())));
    const res = await this.run((signal) =>
      history.series(
        { group: g.id, tags: this.#tags(), from: v.from, to: v.to, maxPoints, priority },
        signal,
      ),
    );
    if (res) this.#apply(res.value);
  }

  #apply(r: SeriesResult): void {
    const steps = this.#stepFlags();
    this.#data = alignSeries(r.series, r.gaps, { step: steps });
    if (this.#plot) {
      this.#plot.setData(this.#data);
    }
    this._cursor = null;
    this._rev++;
    if (this.#data.x.length === 0) this._status = 'empty';
  }

  #startFollow(): void {
    if (this.#follow !== null) clearInterval(this.#follow);
    this.#follow = setInterval(() => {
      if (!this._following || this.ownerDocument.hidden) return;
      const span = this.#view.to - this.#view.from;
      const now = this.#now();
      this.#view = { from: now - span, to: now };
      this.#plot?.redraw();
      this.#schedule(true, 'background');
    }, FOLLOW_MS);
  }

  // ---- thay đổi khoảng ---------------------------------------------------------------------------------------

  #setView(r: TimeRange, immediate = false): void {
    this.#view = r;
    this._following =
      this.prop('follow', true) &&
      this.#endsNow(this._rangeKey) &&
      Math.abs(r.to - this.#now()) < 1000;
    this.#plot?.redraw();
    this.#schedule(immediate, 'user');
  }

  #reset(): void {
    this.#base = this.#baseRange(this._rangeKey);
    this.#setView({ ...this.#base });
  }

  #chooseRange(k: RangeKey): void {
    this._rangeKey = k;
    this.#reset();
  }

  #toggleFollow(): void {
    this._following = !this._following;
    if (this._following) {
      const span = this.#view.to - this.#view.from;
      const now = this.#now();
      this.#view = { from: now - span, to: now };
      this.#plot?.redraw();
      this.#schedule(false, 'user');
    }
  }

  // ---- tương tác ---------------------------------------------------------------------------------------------

  #area(): { left: number; width: number } {
    const rect = this.renderRoot.querySelector('.plot')?.getBoundingClientRect();
    const box = this.#plot?.plotBox() ?? { left: 0, width: rect?.width ?? 0 };
    return { left: (rect?.left ?? 0) + box.left, width: box.width || rect?.width || 0 };
  }

  #px(clientX: number): number {
    const a = this.#area();
    return Math.max(0, Math.min(a.width, clientX - a.left));
  }

  #onPointerDown = (e: MouseEvent & { pointerId?: number }): void => {
    if (e.button !== 0 || !this.#plot) return;
    const a = this.#area();
    this.#drag = { mode: e.shiftKey ? 'pan' : 'select', x0: e.clientX, view: { ...this.#view } };
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId ?? 0);
    } catch {
      /* không bắt buộc */
    }
    if (!e.shiftKey) this._sel = { x0: this.#px(e.clientX), x1: this.#px(e.clientX) };
    void a;
  };

  #onPointerMove = (e: MouseEvent): void => {
    const d = this.#drag;
    const a = this.#area();
    if (!d) {
      const t = pxToTime(this.#px(e.clientX), this.#view, a.width);
      const idx = nearestIndex(this.#data.x, t);
      this._cursor = idx >= 0 ? idx : null;
      return;
    }
    if (d.mode === 'select') {
      this._sel = { x0: this._sel?.x0 ?? this.#px(d.x0), x1: this.#px(e.clientX) };
    } else {
      const span = d.view.to - d.view.from;
      const dt = a.width > 0 ? ((d.x0 - e.clientX) / a.width) * span : 0;
      this.#setView(panRange(d.view, dt));
    }
  };

  #onPointerUp = (e: MouseEvent): void => {
    const d = this.#drag;
    this.#drag = null;
    if (!d) return;
    const a = this.#area();
    if (d.mode === 'select') {
      const x0 = this.#px(d.x0);
      const x1 = this.#px(e.clientX);
      this._sel = null;
      if (Math.abs(x1 - x0) < 4) return; // bấm thường, không phóng
      const t0 = pxToTime(Math.min(x0, x1), d.view, a.width);
      const t1 = pxToTime(Math.max(x0, x1), d.view, a.width);
      this.#setView({ from: t0, to: t1 });
    }
  };

  #onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const a = this.#area();
    const anchor = pxToTime(this.#px(e.clientX), this.#view, a.width);
    this.#setView(zoomRange(this.#view, anchor, e.deltaY < 0 ? 0.75 : 1.25));
  };

  #onKey = (e: KeyboardEvent): void => {
    const span = this.#view.to - this.#view.from;
    const mid = this.#view.from + span / 2;
    const n = this.#data.x.length;
    switch (e.key) {
      case '+':
      case '=':
        this.#setView(zoomRange(this.#view, mid, 0.75));
        break;
      case '-':
      case '_':
        this.#setView(zoomRange(this.#view, mid, 1.25));
        break;
      case 'Home':
        this.#reset();
        break;
      case 'ArrowRight':
        if (e.shiftKey) this.#setView(panRange(this.#view, span * 0.25));
        else this._cursor = Math.min(n - 1, (this._cursor ?? -1) + 1);
        break;
      case 'ArrowLeft':
        if (e.shiftKey) this.#setView(panRange(this.#view, -span * 0.25));
        else this._cursor = Math.max(0, (this._cursor ?? n) - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  #toggleSeries(i: number): void {
    const next = new Set(this._hidden);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    this._hidden = next;
    this.#plot?.setSeriesShow(i, !next.has(i));
  }

  // ---- giao diện ---------------------------------------------------------------------------------------------

  #fmtValue(i: number, v: number | undefined): string {
    if (v === undefined || Number.isNaN(v)) return viHistory.noValue;
    const tag = this.group?.tags.find((t) => t.tagId === this.#tags()[i]);
    const int = tag && /^U?INT/.test(tag.type);
    return `${fixed(v, int ? 0 : 2)}${tag?.unit ? ' ' + tag.unit : ''}`;
  }

  #cursorView(): TemplateResult | typeof nothing {
    const idx = this._cursor;
    const x = this.#data.x;
    if (idx === null || idx < 0 || idx >= x.length) {
      return html`<div class="cursor">${viHistory.cursorHint}</div>`;
    }
    return html`<div class="cursor">
      ${localTime(x[idx]!, this.#tz())}${this.#tags().map((_, i) =>
        this._hidden.has(i)
          ? nothing
          : html` · ${this.#labelOf(i)} ${this.#fmtValue(i, this.#data.y[i]?.[idx])}`,
      )}
    </div>`;
  }

  protected override renderWidget(): TemplateResult {
    const tags = this.#tags();
    const label = `${viHistory.widget.trend}: ${tags.map((_, i) => this.#labelOf(i)).join(', ')}`;
    const sel = this._sel;
    const box = this.#plot?.plotBox() ?? { left: 0, width: 0 };
    return html`<div class="w hw" role="group" aria-label=${label}>
      ${
        this.prop('controls', true)
          ? html`<div class="controls" role="group" aria-label=${viHistory.rangeLabel}>
              ${RANGE_KEYS.map(
                (k) =>
                  html`<button
                    type="button"
                    class="hbtn"
                    data-range=${k}
                    aria-pressed=${this._rangeKey === k ? 'true' : 'false'}
                    @click=${() => this.#chooseRange(k)}
                  >
                    ${viHistory.range[k]}
                  </button>`,
              )}
              <span class="sp"></span>
              ${
                this.#endsNow(this._rangeKey)
                  ? html`<button
                      type="button"
                      class="hbtn follow"
                      aria-pressed=${this._following ? 'true' : 'false'}
                      @click=${() => this.#toggleFollow()}
                    >
                      ${viHistory.follow}
                    </button>`
                  : nothing
              }
            </div>`
          : nothing
      }
      <div class="imgwrap">
        <div
          class="plot"
          role="img"
          tabindex="0"
          aria-label=${label}
          aria-describedby="hint"
          @pointerdown=${this.#onPointerDown}
          @pointermove=${this.#onPointerMove}
          @pointerup=${this.#onPointerUp}
          @pointerleave=${() => {
            if (!this.#drag) this._cursor = null;
          }}
          @wheel=${this.#onWheel}
          @dblclick=${() => this.#reset()}
          @keydown=${this.#onKey}
        >
          <div class="plot-host"></div>
          ${
            sel
              ? html`<div
                  class="sel"
                  style="left:${box.left + Math.min(sel.x0, sel.x1)}px;width:${Math.abs(sel.x1 - sel.x0)}px"
                ></div>`
              : nothing
          }
        </div>
        <span id="hint" class="sr-only">${viHistory.cursorHint}</span>
        ${this.#cursorView()}
        ${
          this.prop('legend', true)
            ? html`<ul class="legend" aria-label=${viHistory.legend}>
                ${tags.map(
                  (_, i) =>
                    html`<li>
                      <button
                        type="button"
                        data-i=${i}
                        aria-pressed=${this._hidden.has(i) ? 'false' : 'true'}
                        title=${viHistory.toggleSeries}
                        @click=${() => this.#toggleSeries(i)}
                      >
                        <svg viewBox="0 0 26 8" aria-hidden="true">
                          <line
                            x1="0"
                            y1="4"
                            x2="26"
                            y2="4"
                            stroke=${`var(--mat-chart-${i + 1})`}
                            stroke-width="2.5"
                            stroke-dasharray=${(SERIES_DASHES[i] ?? []).join(' ')}
                          />
                        </svg>
                        <span>${this.#labelOf(i)}</span>
                      </button>
                    </li>`,
                )}
              </ul>`
            : nothing
        }
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
          ${tags.map(
            (_, i) =>
              html`<tr>
                <td>${this.#labelOf(i)}</td>
                <td>${this.#fmtValue(i, lastFinite(this.#data.y[i]))}</td>
              </tr>`,
          )}
        </tbody>
      </table>
      ${this.renderStatus()}
    </div>`;
  }
}

function lastFinite(a: Float64Array | undefined): number | undefined {
  if (!a) return undefined;
  for (let i = a.length - 1; i >= 0; i--) if (!Number.isNaN(a[i]!)) return a[i];
  return undefined;
}

function numProp(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** `#rrggbb` → rgba(...); chuỗi màu khác giữ nguyên. */
function hexAlpha(c: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return c;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
