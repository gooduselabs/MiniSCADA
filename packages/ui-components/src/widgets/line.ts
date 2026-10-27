// Widget `line` (FR-029; ADR-020, research R11): biểu đồ đường thời gian thực. Nối TagSource → ChartWindow → uPlot
// (tải lười bằng import(), CSS của uPlot nằm trong styles của Shadow DOM). Lấy mẫu theo `sampleMs` bằng giờ của
// TagSource.now(); BAD/STALE/UNKNOWN thành khoảng đứt; tab ẩn thì ngừng vẽ nhưng vẫn lấy mẫu theo giờ thật, hiện lại
// thì vẽ một lần. Mỗi lần lấy mẫu vẽ tối đa một lần mỗi khung hình.
import { css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit';
import { safeColor } from '../format/color.ts';
import uplotCss from 'uplot/dist/uPlot.min.css?raw';
import {
  autoYRange,
  FALLBACK_SERIES_COLORS,
  loadUPlot,
  rangeWithLimits,
  SERIES_DASHES,
  singleSeriesFill,
  type PlotAdapter,
  type PlotFactory,
  type PlotLimit,
  type PlotOptions,
} from '../chart/line-chart.ts';
import { ChartWindow } from '../chart/window.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
import { vi } from '../i18n/vi.ts';
import { styleMap } from 'lit/directives/style-map.js';
import { MatWidget } from './base.ts';

const MAX_SERIES = 8;
const CAPACITY = 3600;

/** Phần phụ thuộc môi trường, thay được trong test. */
export interface LineEnv {
  loadPlot: () => Promise<PlotFactory>;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  raf: (cb: () => void) => unknown;
  cancelRaf: (handle: unknown) => void;
  ResizeObserver: typeof ResizeObserver | undefined;
}

export const lineEnv: LineEnv = {
  loadPlot: loadUPlot,
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
  raf: (cb) =>
    typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame(cb)
      : globalThis.setTimeout(cb, 16),
  cancelRaf: (h) =>
    typeof globalThis.cancelAnimationFrame === 'function'
      ? globalThis.cancelAnimationFrame(h as number)
      : globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  ResizeObserver: globalThis.ResizeObserver,
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const clock = (sec: number) => {
  const d = new Date(sec * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

export class MatLine extends MatWidget {
  static override properties = {
    ...MatWidget.properties,
    _cursor: { state: true },
    _failed: { state: true },
  };
  static override styles = [
    MatWidget.styles,
    unsafeCSS(uplotCss),
    css`
      .w {
        padding: 6px;
        gap: 4px;
        justify-content: flex-start;
      }
      .imgwrap {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        gap: 4px;
      }
      .badge-inline {
        font: 600 10px/1 var(--mat-font-mono, monospace);
        padding: 1px 3px;
        border: 1px solid currentColor;
        border-radius: 3px;
      }
      .badge-inline.q-bad {
        color: var(--mat-bad);
      }
      .badge-inline.q-stale,
      .badge-inline.q-unknown {
        color: var(--mat-text-muted);
      }
      .badge-inline.q-uncertain {
        color: var(--mat-warn);
      }
      .plot {
        position: relative;
        flex: 1;
        min-height: 40px;
        min-width: 0;
      }
      .plot-error {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--mat-text-muted);
      }
      .legend {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 3px 6px;
        font-size: 11.5px;
      }
      .legend li {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
      }
      .legend svg {
        flex: none;
        width: 18px;
        height: 8px;
      }
      .legend .val {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      .legend .gone {
        color: var(--mat-text-muted);
      }
      .cursor {
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: var(--mat-text-muted);
        min-height: 16px;
      }
      .u-wrap,
      .uplot {
        font-family: var(--mat-font);
      }
      /* Giao diện mới (feature 012): chú giải dạng thẻ nền nhạt theo màu đường, con trỏ dạng ô có chấm màu, đường
         gióng nét đứt màu viền. */
      .legend li {
        padding: 1px 7px 1px 5px;
        border-radius: 999px;
        background: var(--soft, transparent);
      }
      .cursor {
        align-self: flex-start;
        padding: 2px 8px;
        border-radius: var(--mat-radius, 4px);
        background: var(--mat-surface-2);
        color: var(--mat-text);
        box-shadow: var(--mat-shadow-card, none);
      }
      .cursor .dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 2px;
        margin: 0 3px 0 6px;
        background: var(--c);
      }
      .u-cursor-x,
      .u-cursor-y {
        border-color: var(--mat-border-strong) !important;
      }
    `,
  ];

  declare _cursor: number | null;
  declare _failed: boolean;

  #win: ChartWindow | null = null;
  #cfgKey = '';
  #timer: unknown = null;
  #plot: PlotAdapter | null = null;
  #plotPromise: Promise<void> | null = null;
  #plotSeq = 0;
  #ro: ResizeObserver | null = null;
  #drawHandle: unknown = null;
  #drawQueued = false;
  #hiddenDirty = false;
  #visHandler: (() => void) | null = null;
  #data: Float64Array[] = [];
  #nowSec = 0;
  #plotKey = '';

  constructor() {
    super();
    this._cursor = null;
    this._failed = false;
  }

  // ---- cấu hình ----------------------------------------------------------------------------------------------

  #ids(): string[] {
    return this.tagsOf('series').slice(0, MAX_SERIES);
  }

  #windowSec(): number {
    return Math.min(3600, Math.max(10, Math.trunc(this.prop('windowSec', 60))));
  }

  #sampleMs(): number {
    return Math.min(60000, Math.max(250, Math.trunc(this.prop('sampleMs', 1000))));
  }

  #labels(): string[] {
    const v = this.item?.props?.labels;
    return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : '')) : [];
  }

  #labelOf(i: number): string {
    const ids = this.#ids();
    return this.#labels()[i] || this.source.info(ids[i]!)?.description || ids[i] || '';
  }

  /** Ngưỡng cao, thấp (feature 014): số hữu hạn ở props. */
  /** Feature 029: màu riêng của chuỗi `i` (prop `colors`); `auto` hoặc thiếu thì undefined. */
  #ownColor(i: number): string | undefined {
    const own = this.item?.props?.['colors'];
    return Array.isArray(own) ? safeColor(own[i]) : undefined;
  }

  #limits(): Array<Omit<PlotLimit, 'color'>> {
    const out: Array<Omit<PlotLimit, 'color'>> = [];
    for (const [kind, name] of [
      ['high', 'highLimit'],
      ['low', 'lowLimit'],
    ] as const) {
      const v = this.item?.props?.[name];
      if (typeof v === 'number' && Number.isFinite(v)) out.push({ kind, value: v });
    }
    return out;
  }

  #limitColor(kind: PlotLimit['kind']): string {
    return kind === 'high'
      ? this.#cssColor('--mat-alarm-red', '#c42b2b')
      : this.#cssColor('--mat-alarm-teal', '#0b6b73');
  }

  #axisText(name: 'xLabel' | 'yLabel'): string {
    return this.prop(name, '');
  }

  #yFixed(): { yMin?: number; yMax?: number } {
    const a = this.item?.props?.yMin;
    const b = this.item?.props?.yMax;
    return typeof a === 'number' && typeof b === 'number' ? { yMin: a, yMax: b } : {};
  }

  // ---- vòng đời ----------------------------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.#configure();
  }

  override disconnectedCallback(): void {
    this.#stop();
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues): void {
    if (!this.isConnected || !this.item || !this.source) return;
    if (changed.has('item') || changed.has('source') || !this.#win) this.#configure();
  }

  /** Dựng lại cửa sổ, bộ lấy mẫu và đồ thị khi cấu hình đổi. */
  #configure(): void {
    if (!this.isConnected || !this.item || !this.source) return;
    const ids = this.#ids();
    const key = [ids.join('\u0000'), this.#windowSec(), this.#sampleMs()].join('|');
    if (key !== this.#cfgKey || !this.#win) {
      this.#cfgKey = key;
      this.#win = new ChartWindow({
        series: ids.length,
        capacity: CAPACITY,
        windowSec: this.#windowSec(),
        sampleMs: this.#sampleMs(),
      });
      this.#data = [];
      if (this.#timer !== null) lineEnv.clearInterval(this.#timer);
      this.#timer = lineEnv.setInterval(() => this.#sampleNow(), this.#sampleMs());
    }
    const plotKey = [
      key,
      this.prop('grid', true),
      JSON.stringify(this.#yFixed()),
      JSON.stringify(this.#labels()),
      JSON.stringify(this.#limits()),
      this.#axisText('xLabel'),
      this.#axisText('yLabel'),
    ].join('|');
    if (plotKey !== this.#plotKey) {
      this.#plotKey = plotKey;
      this.#destroyPlot();
      this.#startPlot();
    }
  }

  #stop(): void {
    if (this.#timer !== null) lineEnv.clearInterval(this.#timer);
    this.#timer = null;
    if (this.#drawQueued && this.#drawHandle !== null) lineEnv.cancelRaf(this.#drawHandle);
    this.#drawHandle = null;
    this.#drawQueued = false;
    this.#destroyPlot();
    this.#clearVis();
    this.#win = null;
    this.#cfgKey = '';
    this.#plotKey = '';
  }

  #destroyPlot(): void {
    this.#plotSeq++; // vô hiệu hóa lần tải đang chờ
    this.#ro?.disconnect();
    this.#ro = null;
    this.#plot?.destroy();
    this.#plot = null;
    this.#plotPromise = null;
  }

  /** Resolve khi đồ thị đã dựng (hoặc tải lỗi); cho test. */
  whenPlotReady(): Promise<void> {
    return this.#plotPromise ?? Promise.resolve();
  }

  #cssColor(name: string, fallback: string): string {
    const v =
      typeof getComputedStyle === 'function'
        ? getComputedStyle(this).getPropertyValue(name).trim()
        : '';
    return v || fallback;
  }

  #startPlot(): void {
    const seq = this.#plotSeq;
    this._failed = false;
    this.#plotPromise = lineEnv
      .loadPlot()
      .then((factory) => {
        if (seq !== this.#plotSeq || !this.isConnected) return;
        const host = this.renderRoot.querySelector<HTMLElement>('.plot');
        if (!host) return;
        const ids = this.#ids();
        const fixed = this.#yFixed();
        const series = ids.map((id, i) => ({
          label: this.#labelOf(i),
          color:
            this.#ownColor(i) ?? this.#cssColor(`--mat-chart-${i + 1}`, FALLBACK_SERIES_COLORS[i]!),
          dash: SERIES_DASHES[i]!,
          width: 2,
          show: this.source.info(id) !== undefined,
        }));
        const fills = singleSeriesFill(series);
        const limits = this.#limits().map((l) => ({ ...l, color: this.#limitColor(l.kind) }));
        const limitValues = limits.map((l) => l.value);
        const opts: PlotOptions = {
          width: host.clientWidth || this.item.width || 300,
          height: host.clientHeight || Math.max(60, (this.item.height || 200) - 60),
          series: series.map((s, i) => (fills[i] ? { ...s, fill: fills[i] } : s)),
          font: this.#cssColor('--mat-font', "'Segoe UI', system-ui, sans-serif"),
          surfaceColor: this.#cssColor('--mat-surface', '#ffffff'),
          grid: this.prop('grid', true),
          xRange: () => [this.#nowSec - this.#windowSec(), this.#nowSec],
          yRange: (min, max) => {
            const [a, b] = rangeWithLimits(min, max, limitValues);
            return autoYRange(a, b, fixed.yMin, fixed.yMax);
          },
          limits,
          xLabel: this.#axisText('xLabel'),
          yLabel: this.#axisText('yLabel'),
          onCursor: (idx) => {
            this._cursor = idx;
          },
          axisColor: this.#cssColor('--mat-text-muted', '#56646a'),
          gridColor: this.#cssColor('--mat-border', '#d2d9dc'),
        };
        this.#nowSec = this.source.now() / 1000;
        const first = this.#win?.snapshot(this.source.now()) ?? [
          new Float64Array(0),
          ...ids.map(() => new Float64Array(0)),
        ];
        this.#plot = factory(host, opts, first);
        this.#data = first;
        const RO = lineEnv.ResizeObserver;
        if (RO) {
          this.#ro = new RO((entries) => {
            const r = entries[entries.length - 1]?.contentRect;
            if (r && r.width > 0 && r.height > 0)
              this.#plot?.setSize(Math.floor(r.width), Math.floor(r.height));
          });
          this.#ro.observe(host);
        }
      })
      .catch((e: unknown) => {
        if (seq !== this.#plotSeq) return;
        console.warn('không tải được uPlot:', e);
        this._failed = true;
      });
  }

  // ---- lấy mẫu và vẽ -----------------------------------------------------------------------------------------

  #sampleNow(): void {
    const win = this.#win;
    if (!win || !this.source) return;
    const values = this.#ids().map((id) => {
      if (!this.source.info(id)) return null;
      const s = this.source.get(id);
      if (s.quality !== 'GOOD' && s.quality !== 'UNCERTAIN') return null;
      const n = numberOf(s.value);
      return Number.isFinite(n) ? n : null;
    });
    win.sample(this.source.now(), values);
    this.#scheduleDraw();
  }

  #scheduleDraw(): void {
    if (this.ownerDocument.hidden) {
      // Tab ẩn: không vẽ; hiện lại thì lấy mẫu một lần và vẽ với dữ liệu đúng giờ (FR-019).
      this.#hiddenDirty = true;
      if (!this.#visHandler) {
        this.#visHandler = () => {
          if (this.ownerDocument.hidden) return;
          this.#clearVis();
          if (this.#hiddenDirty) {
            this.#hiddenDirty = false;
            this.#sampleNow();
          }
        };
        this.ownerDocument.addEventListener('visibilitychange', this.#visHandler);
      }
      return;
    }
    if (this.#drawQueued) return;
    this.#drawQueued = true;
    const h = lineEnv.raf(() => {
      this.#drawQueued = false;
      this.#drawHandle = null;
      this.#draw();
    });
    if (this.#drawQueued) this.#drawHandle = h;
  }

  #clearVis(): void {
    if (this.#visHandler)
      this.ownerDocument.removeEventListener('visibilitychange', this.#visHandler);
    this.#visHandler = null;
  }

  #draw(): void {
    if (!this.#plot || !this.#win) return;
    const now = this.source.now();
    this.#nowSec = now / 1000;
    this.#data = this.#win.snapshot(now);
    this.#plot.setData(this.#data);
  }

  // ---- giao diện ---------------------------------------------------------------------------------------------

  protected override renderWidget(): TemplateResult {
    const ids = this.#ids();
    const rows = ids.map((id, i) => {
      const info = this.source.info(id);
      const state = this.source.get(id);
      const fmt = formatValue(state, info, { decimals: this.decimals(info) });
      const qv = this.qv(id);
      return { id, i, info, state, fmt, qv, label: this.#labelOf(i), gone: info === undefined };
    });
    const summary = rows
      .map((r) =>
        r.gone
          ? `${r.label} (${vi.chart.noTag})`
          : `${r.label} ${r.fmt.text}${r.fmt.unit ? ' ' + r.fmt.unit : ''}${r.qv.aria ? ' ' + r.qv.aria : ''}`,
      )
      .join('; ');
    const ariaLabel = `${vi.widget.line}: ${summary}`;
    const idx = this._cursor;
    const cursor =
      idx !== null && this.#data[0] && idx >= 0 && idx < this.#data[0].length
        ? html`<div class="cursor">
            ${clock(this.#data[0][idx]!)}${rows.map((r) => {
              const v = this.#data[r.i + 1]?.[idx];
              const text =
                v === undefined || Number.isNaN(v)
                  ? vi.noValue
                  : formatValue({ value: v, quality: 'GOOD' }, r.info, {
                      decimals: this.decimals(r.info),
                    }).text;
              return html`<span
                  class="dot"
                  style=${styleMap({ '--c': `var(--mat-chart-${r.i + 1})` })}
                ></span
                >${r.label} ${text}${r.fmt.unit ? ' ' + r.fmt.unit : ''}`;
            })}
          </div>`
        : nothing;
    const title = this.titleText();
    const limits = this.#limits();
    // Số của ngưỡng viết gọn (không thêm số lẻ thừa): 80, 5.5.
    const limitText = (l: Omit<PlotLimit, 'color'>) =>
      `${l.kind === 'high' ? vi.dash.highLimit : vi.dash.lowLimit} ${String(Number(l.value.toFixed(6)))}`;
    return html`<div class="w ${title ? 'framed' : ''}">
      ${this.head()}
      <div
        class="imgwrap ${title ? 'body' : ''}"
        role="img"
        aria-label=${[ariaLabel, ...limits.map(limitText)].join('; ')}
      >
        <div class="plot">
          ${this._failed ? html`<div class="plot-error">${vi.chart.loadFailed}</div>` : nothing}
        </div>
        ${cursor}
        ${
          this.prop('legend', true)
            ? html`<ul class="legend" aria-hidden="true">
                ${rows.map(
                  (r) =>
                    html`<li style=${styleMap({ '--soft': `var(--mat-chart-${r.i + 1}-soft)` })}>
                      <svg viewBox="0 0 26 8" aria-hidden="true">
                        <line
                          x1="0"
                          y1="4"
                          x2="26"
                          y2="4"
                          stroke=${`var(--mat-chart-${r.i + 1})`}
                          stroke-width="2.5"
                          stroke-dasharray=${SERIES_DASHES[r.i]!.join(' ')}
                        />
                      </svg>
                      <span class="name ellipsis ${r.gone ? 'gone' : ''}">${r.label}</span>
                      ${
                        r.gone
                          ? html`<span class="gone">(${vi.chart.noTag})</span>`
                          : html`<span class="val ${r.qv.dim ? 'dim' : ''}">${r.fmt.text}</span>${
                                r.fmt.unit
                                  ? html`<span class="muted">${r.fmt.unit}</span>`
                                  : nothing
                              }${
                                r.qv.badge
                                  ? html`<span
                                      class="badge-inline ${r.qv.cls}"
                                      title=${r.qv.tooltip}
                                      >${r.qv.badge}</span
                                    >`
                                  : nothing
                              }`
                      }
                    </li>`,
                )}
                ${limits.map(
                  (l) =>
                    html`<li
                      class="limit"
                      style=${styleMap({
                        '--soft': `var(--mat-alarm-${l.kind === 'high' ? 'red' : 'teal'}-soft)`,
                      })}
                    >
                      <svg viewBox="0 0 26 8" aria-hidden="true">
                        <line
                          x1="0"
                          y1="4"
                          x2="26"
                          y2="4"
                          stroke=${`var(--mat-alarm-${l.kind === 'high' ? 'red' : 'teal'})`}
                          stroke-width="2"
                          stroke-dasharray="6 4"
                        />
                      </svg>
                      <span class="name">${limitText(l)}</span>
                    </li>`,
                )}
              </ul>`
            : nothing
        }
      </div>
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
                  ${
                    r.gone
                      ? vi.chart.noTag
                      : `${r.fmt.text}${r.fmt.unit ? ' ' + r.fmt.unit : ''}${r.qv.aria ? ' ' + r.qv.aria : ''}`
                  }
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }
}
