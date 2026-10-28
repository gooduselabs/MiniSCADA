// Widget `card` — "Thẻ giá trị" (FR-026; feature 037 hợp nhất với `stat-tile`): nhãn, giá trị (số lẻ, đơn vị), chấm
// quality. Danh mục 0.8.0 thêm: màu nhấn (`accent` trong bảng `--mat-tile-*` hoặc `accentColor` tự chọn), kiểu nền
// (`fill`: nhạt, đặc màu, viền, trơn = giao diện cũ), biểu tượng (`icon`), dòng "Trạng thái" (`statusText`), ngưỡng đổi
// màu (`warnAbove/Below` → cam, `alarmAbove/Below` hoặc khe `alarm` → đỏ), nháy nhẹ khi giá trị đổi (`flash`, chỉ ở
// chế độ chạy, một hoạt ảnh CSS 600 ms, tắt khi giảm chuyển động).
// Feature 012 (FR-035): `sparkline` (60 điểm gần nhất) và `trend` (mũi tên so với điểm trước); BAD, STALE, UNKNOWN và
// giá trị không phải số làm đứt đường.
import { css, html, nothing, svg, type PropertyValues, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { formatValue, numberOf } from '../format/format-value.ts';
import { safeColor } from '../format/color.ts';
import type { TagState } from '../host/types.ts';
import { vi } from '../i18n/vi.ts';
import { MatWidget } from './base.ts';
import { dashIcon } from './icons.ts';
import { LiveBuffer } from './live-buffer.ts';

const SW = 100;
const SH = 24;

/** Các đoạn liền (không NaN) của dãy, quy về khung SW × SH. */
export function sparkSegments(values: readonly number[]): string[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return [];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = hi - lo || 1;
  const n = values.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * SW : 0);
  const y = (v: number) => (hi === lo ? SH / 2 : SH - 1 - ((v - lo) / span) * (SH - 2));
  const out: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (Number.isFinite(v)) cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    else {
      if (cur.length >= 2) out.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length >= 2) out.push(cur.join(' '));
  return out;
}

/** Bảng màu nhấn chung (feature 037): tên → token `--mat-tile-*` của chủ đề (chữ trắng đọc được trên nền đặc). */
export const ACCENTS = [
  'blue',
  'teal',
  'green',
  'orange',
  'rose',
  'violet',
  'indigo',
  'cyan',
  'olive',
  'slate',
] as const;
export type Accent = (typeof ACCENTS)[number];

/** Biểu thức CSS của màu nhấn: màu tự chọn hợp lệ thắng tên trong bảng; tên lạ dùng `fallback`. */
export function accentCss(name: unknown, custom?: unknown, fallback: Accent = 'blue'): string {
  const c = safeColor(custom);
  if (c) return c;
  const n = (ACCENTS as readonly unknown[]).includes(name) ? (name as Accent) : fallback;
  return `var(--mat-tile-${n})`;
}

export type ThresholdLevel = 'ok' | 'warn' | 'alarm';

/**
 * Mức ngưỡng của số `v` theo `alarmAbove/Below` (ưu tiên) và `warnAbove/Below`; không phải số hoặc quality xấu là `ok`
 * (quality đã có dấu riêng).
 */
export function thresholdLevel(
  props: Readonly<Record<string, unknown>> | undefined,
  v: unknown,
  quality: string,
): ThresholdLevel {
  if (quality !== 'GOOD' && quality !== 'UNCERTAIN') return 'ok';
  if (v === null || v === undefined || typeof v === 'string') return 'ok';
  const n = numberOf(v as Parameters<typeof numberOf>[0]);
  if (!Number.isFinite(n)) return 'ok';
  const num = (k: string) => (typeof props?.[k] === 'number' ? (props[k] as number) : undefined);
  const over = (hi?: number, lo?: number) =>
    (hi !== undefined && n > hi) || (lo !== undefined && n < lo);
  if (over(num('alarmAbove'), num('alarmBelow'))) return 'alarm';
  if (over(num('warnAbove'), num('warnBelow'))) return 'warn';
  return 'ok';
}

const FILLS = ['soft', 'solid', 'outline', 'plain'] as const;

export class MatCard extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      :host {
        container-type: inline-size;
      }
      .w {
        --c: var(--mat-tile-blue, #2c7ac0);
        --ink: color-mix(in srgb, var(--c) 82%, #000000);
        border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
        box-shadow: var(--mat-shadow-card, none);
        gap: 1px;
      }
      .w.lv-warn {
        --c: var(--mat-tile-orange, #a36810);
      }
      .w.lv-alarm {
        --c: var(--mat-tile-rose, #c84845);
      }
      /* nhạt: nền pha màu nhấn, vạch màu bên trái, số màu nhấn đậm */
      .fill-soft {
        background: color-mix(in srgb, var(--c) 9%, var(--mat-surface, #fff));
        border-color: color-mix(in srgb, var(--c) 28%, var(--mat-border, #d2d9dc));
        border-left: 4px solid var(--c);
      }
      .fill-soft .value,
      .fill-outline .value {
        color: var(--ink);
      }
      /* viền: nền trắng, viền màu nhấn */
      .fill-outline {
        border: 2px solid var(--c);
      }
      /* đặc: nền màu nhấn chuyển sắc, chữ trắng (như thẻ chỉ số cũ) */
      .fill-solid {
        color: var(--mat-tile-ink, #fff);
        border-color: transparent;
        background: linear-gradient(
          135deg,
          var(--c) 0%,
          color-mix(in srgb, var(--c) 78%, #000000) 100%
        );
      }
      .fill-solid .label,
      .fill-solid .unit,
      .fill-solid .trend,
      .fill-solid .stat,
      .fill-solid .status2 {
        color: inherit;
        opacity: 0.92;
      }
      .fill-solid .badge {
        color: #1f2933;
      }
      .label {
        font-size: 12.5px;
        font-weight: 500;
        color: var(--mat-text-muted);
        margin-bottom: 2px;
        padding-right: 40px;
        position: relative;
        z-index: 1;
      }
      .main {
        display: flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
        position: relative;
        z-index: 1;
      }
      .value {
        font-weight: 700;
        line-height: 1.15;
        letter-spacing: -0.01em;
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        border-radius: 4px;
      }
      .unit {
        color: var(--mat-text-muted);
        font-weight: 500;
        white-space: nowrap;
      }
      .trend {
        font-weight: 700;
        color: var(--mat-text-muted);
      }
      .ico {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 34px;
        height: 34px;
        padding: 6px;
        border-radius: 50%;
        color: var(--c);
        background: color-mix(in srgb, var(--c) 16%, transparent);
        pointer-events: none;
      }
      .fill-solid .ico {
        top: 50%;
        right: -2%;
        width: auto;
        height: min(96%, 120px);
        aspect-ratio: 1;
        padding: 0;
        transform: translateY(-50%);
        color: inherit;
        background: none;
        opacity: 0.2;
        stroke-width: 1.6;
      }
      .has-ico .main {
        padding-right: 40px;
      }
      .fill-solid.has-ico .main {
        padding-right: 18%;
      }
      .stat {
        font-size: 12px;
        color: var(--mat-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        position: relative;
        z-index: 1;
      }
      .pill {
        display: inline-block;
        padding: 0 8px;
        border-radius: 999px;
        font-weight: 700;
        line-height: 18px;
        color: #fff;
        background: var(--c);
      }
      .fill-solid .pill {
        background: #fff;
        color: var(--ink);
      }
      .spark {
        display: block;
        width: 100%;
        height: 24px;
        margin-top: 4px;
        overflow: visible;
      }
      .fill-solid .spark {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 4px;
        height: 26%;
        margin: 0;
        opacity: 0.35;
        pointer-events: none;
      }
      .spark polyline {
        fill: none;
        stroke: var(--c);
        stroke-width: 1.8;
        stroke-linejoin: round;
        stroke-linecap: round;
      }
      /* 037: chưa đủ dữ liệu: đường chờ nét đứt */
      .spark .wait {
        stroke: var(--c);
        stroke-width: 1.5;
        stroke-dasharray: 4 4;
        opacity: 0.5;
      }
      .fill-solid .spark .wait {
        stroke: currentColor;
      }
      .fill-solid .spark polyline {
        stroke: currentColor;
      }
      /* nháy nhẹ khi giá trị đổi: hai tên hoạt ảnh luân phiên để chạy lại mỗi lần */
      .fl-a {
        animation: mat-flash-a 0.6s ease-out;
      }
      .fl-b {
        animation: mat-flash-b 0.6s ease-out;
      }
      @keyframes mat-flash-a {
        from {
          background: color-mix(in srgb, var(--c) 30%, transparent);
        }
      }
      @keyframes mat-flash-b {
        from {
          background: color-mix(in srgb, var(--c) 30%, transparent);
        }
      }
      .fill-solid .fl-a {
        animation-name: mat-flash-a-solid;
      }
      .fill-solid .fl-b {
        animation-name: mat-flash-b-solid;
      }
      @keyframes mat-flash-a-solid {
        from {
          background: rgba(255, 255, 255, 0.32);
        }
      }
      @keyframes mat-flash-b-solid {
        from {
          background: rgba(255, 255, 255, 0.32);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .fl-a,
        .fl-b {
          animation: none;
        }
      }
      .fs-s .value {
        font-size: 20px;
      }
      .fs-m .value {
        font-size: 28px;
      }
      .fs-l .value {
        font-size: clamp(24px, 13cqw, 40px);
      }
      .fs-xl .value {
        font-size: clamp(28px, 18cqw, 56px);
      }
      .fs-s .unit,
      .fs-s .trend {
        font-size: 12px;
      }
      .fs-m .unit,
      .fs-m .trend {
        font-size: 14px;
      }
      .fs-l .unit,
      .fs-l .trend {
        font-size: 16px;
      }
      .fs-xl .unit,
      .fs-xl .trend {
        font-size: 22px;
      }
    `,
  ];

  #buf = new LiveBuffer();
  #lastText: string | null = null;
  #flash = 0;

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (!this.item || !this.source) return;
    if (!this.prop('sparkline', false) && !this.prop('trend', false)) return;
    const id = this.tagOf('value');
    this.#buf.record(id, id ? this.source.get(id) : { value: null, quality: 'GOOD' });
  }

  /** Lớp nháy của số: đổi chữ ở chế độ chạy thì đổi lớp (a/b) để hoạt ảnh chạy lại; lần vẽ đầu không nháy. */
  #flashClass(text: string): string {
    const prev = this.#lastText;
    this.#lastText = text;
    if (this.mode === 'edit' || !this.prop('flash', false)) return '';
    if (prev !== null && prev !== text) this.#flash++;
    return this.#flash === 0 ? '' : this.#flash % 2 ? 'fl-a' : 'fl-b';
  }

  protected override renderWidget(): TemplateResult {
    const p = this.item.props;
    const id = this.tagOf('value');
    const state: TagState = id ? this.source.get(id) : { value: null, quality: 'GOOD' };
    const info = id ? this.source.info(id) : undefined;
    const tableName = info?.valueTable;
    const unitProp = p?.unit;
    const fmt = formatValue(state, info, {
      decimals: this.decimals(info),
      unit: typeof unitProp === 'string' ? unitProp : undefined,
      table: tableName ? this.source.valueTable(tableName) : undefined,
    });
    const qv = this.qv(id);
    const label = this.prop('label', '');
    const size = this.prop('fontSize', 'm');
    const fs = ['s', 'm', 'l', 'xl'].includes(size) ? size : 'm';
    const fillProp = this.prop('fill', 'plain');
    const fill = (FILLS as readonly string[]).includes(fillProp) ? fillProp : 'plain';
    const alarmId = this.tagOf('alarm');
    const alarmOn =
      alarmId !== undefined && this.source.get(alarmId).value === true && state.quality === 'GOOD';
    const lv = alarmOn ? 'alarm' : thresholdLevel(p, state.value, state.quality);
    const color = safeColor(p?.valueColor) ?? (fill === 'solid' ? undefined : safeColor(fmt.color));
    const bg = safeColor(p?.background);
    // showQuality=false chỉ ẩn nhãn của GOOD/UNCERTAIN: lỗi nặng luôn có chữ (FR-018).
    const showBadge = this.prop('showQuality', true) || qv.dim || qv.locked;
    const dir = this.prop('trend', false) ? this.#buf.direction() : null;
    const segs = this.prop('sparkline', false) ? sparkSegments(this.#buf.values) : null;
    const ico = dashIcon(p?.icon, 'ico');
    const showUnit = this.prop('showUnit', true) && !!fmt.unit;
    const word =
      lv === 'alarm'
        ? vi.dash.alarm
        : lv === 'warn'
          ? vi.dash.warn
          : vi.dash.statusWord[state.quality];
    const pill = lv !== 'ok' || state.quality !== 'GOOD';
    const aria = [
      `${this.nameOf(id)}: ${fmt.text}${fmt.unit ? ' ' + fmt.unit : ''}`,
      qv.aria,
      lv !== 'ok' ? word : '',
      dir ? vi.trend[dir] : '',
    ]
      .filter(Boolean)
      .join(', ');
    const spark = (cls: string) =>
      html`<svg
        class="spark ${cls}"
        viewBox="0 0 ${SW} ${SH}"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        ${
          segs!.length
            ? segs!.map(
                (s) => svg`<polyline points=${s} vector-effect="non-scaling-stroke"></polyline>`,
              )
            : svg`<line class="wait" x1="0" y1="${SH / 2}" x2="${SW}" y2="${SH / 2}" vector-effect="non-scaling-stroke"></line>`
        }
      </svg>`;
    return html`<div
      class="w fill-${fill} fs-${fs} lv-${lv} ${qv.cls} ${ico ? 'has-ico' : ''}"
      role="group"
      aria-label=${aria}
      title=${qv.tooltip || nothing}
      style=${styleMap({
        background: bg,
        '--c': lv === 'ok' ? accentCss(p?.accent, p?.accentColor) : undefined,
      })}
    >
      ${ico ?? nothing} ${segs && fill === 'solid' ? spark('bg') : nothing}
      ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
      <div class="main">
        <span
          class="value ${qv.dim ? 'dim' : ''} ${this.blinking(state.value, state.quality) ? 'blink' : ''} ${this.#flashClass(fmt.text)}"
          style=${styleMap({ color })}
          >${fmt.text}</span
        >
        ${showUnit ? html`<span class="unit">${fmt.unit}</span>` : nothing}
        ${
          dir
            ? html`<span class="trend ${dir}" aria-hidden="true" title=${vi.trend[dir]}
                >${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'}</span
              >`
            : nothing
        }
      </div>
      ${segs && fill !== 'solid' ? spark('') : nothing}
      ${
        this.prop('statusText', false)
          ? html`<div class="stat" aria-hidden="true">
              ${vi.dash.status}:
              ${pill ? html`<span class="pill">${word}</span>` : html`<b>${word}</b>`}
            </div>`
          : nothing
      }
      ${this.statusLine()} ${showBadge ? this.badge(qv) : nothing}
    </div>`;
  }
}
