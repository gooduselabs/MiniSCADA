// Widget `multi-state` (feature 037): nhãn đa trạng thái. Giá trị Tag (số hoặc BOOL = 0/1) tra bảng `states` của widget
// (giá trị → chữ, màu, nhấp nháy); bảng rỗng thì dùng Bảng giá trị của Tag; không khớp thì hiện giá trị định dạng, màu
// xám đá. Khối màu đặc (chữ trắng) hoặc nhạt (vạch màu), biểu tượng tùy chọn. Chữ luôn có (không chỉ màu).
import { lookupValueTable } from '@mat/expression';
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { formatValue, numberOf } from '../format/format-value.ts';
import { safeColor } from '../format/color.ts';
import type { TagState } from '../host/types.ts';
import { MatWidget } from './base.ts';
import { dashIcon } from './icons.ts';
import { vi } from '../i18n/vi.ts';

export interface StateEntry {
  value: number;
  text: string;
  color: string;
  blink?: boolean;
}

/** Mục của bảng `states` khớp giá trị (BOOL là 0/1); bảng sai dạng được bỏ qua từng mục. */
export function matchState(states: unknown, v: unknown): StateEntry | undefined {
  if (!Array.isArray(states) || v === null || v === undefined) return undefined;
  const n = typeof v === 'boolean' ? (v ? 1 : 0) : numberOf(v as Parameters<typeof numberOf>[0]);
  if (!Number.isFinite(n)) return undefined;
  for (const s of states as unknown[]) {
    if (!s || typeof s !== 'object') continue;
    const e = s as Partial<StateEntry>;
    if (typeof e.value === 'number' && e.value === n && typeof e.text === 'string')
      return e as StateEntry;
  }
  return undefined;
}

export class MatMultiState extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        --c: var(--mat-tile-slate, #2d353c);
        flex-direction: row;
        align-items: center;
        justify-content: flex-start;
        gap: 10px;
        border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
        transition: background-color 0.25s;
      }
      .solid {
        color: #fff;
        border-color: transparent;
        background: linear-gradient(
          135deg,
          var(--c) 0%,
          color-mix(in srgb, var(--c) 80%, #000) 100%
        );
      }
      .soft {
        background: color-mix(in srgb, var(--c) 10%, var(--mat-surface, #fff));
        border-left: 4px solid var(--c);
      }
      /* 037: cùng bộ kiểu nền với Thẻ giá trị */
      .outline {
        border: 2px solid var(--c);
      }
      .outline .ico,
      .plain .ico {
        color: var(--c);
      }
      .outline .state,
      .plain .state {
        color: color-mix(in srgb, var(--c) 85%, #000);
      }
      .outline .label,
      .plain .label {
        color: var(--mat-text-muted);
      }
      .ico {
        flex: none;
        width: 28px;
        height: 28px;
      }
      .soft .ico {
        color: var(--c);
      }
      .texts {
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.2;
      }
      .label {
        font-size: 12px;
        opacity: 0.9;
      }
      .soft .label {
        color: var(--mat-text-muted);
      }
      .state {
        font-size: 18px;
        font-weight: 700;
      }
      .soft .state {
        color: color-mix(in srgb, var(--c) 85%, #000);
      }
      /* Kiểu đèn (gộp Đèn báo, feature 037) */
      :host {
        container-type: size;
      }
      .w.lamp {
        flex-direction: column;
        align-items: stretch;
        justify-content: center;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .dot {
        flex: none;
        width: clamp(22px, 70cqh, 56px);
        height: clamp(22px, 70cqh, 56px);
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--lc) 75%, #000);
        background: radial-gradient(
          circle at 35% 30%,
          color-mix(in srgb, var(--lc) 35%, #fff) 0%,
          var(--lc) 55%,
          color-mix(in srgb, var(--lc) 80%, #000) 100%
        );
      }
      .dot.square {
        border-radius: 4px;
      }
      .dot.off {
        background: color-mix(in srgb, var(--lc) 30%, #3a4247);
        border-color: color-mix(in srgb, var(--lc) 40%, #2a3034);
      }
      .dot.inactive {
        background: transparent;
        border: 2px dashed var(--mat-border-strong);
      }
      .dot.glow {
        box-shadow:
          0 0 0 3px color-mix(in srgb, var(--lc) 22%, transparent),
          0 0 10px 1px color-mix(in srgb, var(--lc) 60%, transparent);
      }
      .state-text {
        font-weight: 600;
      }
      .solid .badge {
        color: #1f2933;
      }
    `,
  ];

  /**
   * Chữ, màu, sáng/tắt của giá trị hiện tại. Thứ tự: bảng `states` của widget; Bảng giá trị của Tag (`useValueTable`);
   * còn lại bật/tắt như Đèn báo cũ (khác 0 = bật, `invert`, `onColor`/`offColor`, `onText`/`offText`).
   */
  resolve(): { text: string; color?: string; on: boolean; blink: boolean; known: boolean } {
    const id = this.tagOf('value');
    const state: TagState = id ? this.source.get(id) : { value: null, quality: 'GOOD' };
    const info = id ? this.source.info(id) : undefined;
    const good = state.quality === 'GOOD' || state.quality === 'UNCERTAIN';
    const v = state.value;
    const n = typeof v === 'boolean' ? (v ? 1 : 0) : numberOf(v as Parameters<typeof numberOf>[0]);
    const known = good && v !== null && v !== undefined && !Number.isNaN(n);
    let on = known && n !== 0;
    const hit = good ? matchState(this.item.props?.states, v) : undefined;
    if (hit) return { text: hit.text, color: safeColor(hit.color), on, blink: !!hit.blink, known };
    const table =
      this.prop('useValueTable', true) && info?.valueTable
        ? this.source.valueTable(info.valueTable)
        : undefined;
    if (!known || info?.type === 'STRING') {
      const fmt = formatValue(state, info, { decimals: this.decimals(info) });
      return { text: fmt.text, on, blink: false, known };
    }
    if (table) {
      const t = lookupValueTable(table, typeof v === 'boolean' ? v : n);
      if (t.entry !== null) {
        const c = safeColor(t.color ?? undefined);
        return { text: t.text, ...(c ? { color: c } : {}), on, blink: false, known };
      }
    }
    // Kiểu chữ, Tag số không khớp bảng: hiện số (không đoán bật/tắt). Kiểu đèn và Tag BOOL: bật/tắt như Đèn báo cũ.
    if (
      !this.prop('shape', 'text').startsWith('lamp') &&
      info?.type !== 'BOOL' &&
      typeof v !== 'boolean'
    )
      return {
        text: formatValue(state, info, { decimals: this.decimals(info) }).text,
        on,
        blink: false,
        known,
      };
    if (this.prop('invert', false)) on = !on;
    const text = on ? this.prop('onText', '') || vi.on : this.prop('offText', '') || vi.off;
    const color = safeColor(this.item.props?.[on ? 'onColor' : 'offColor']);
    return {
      text,
      color:
        color ??
        (on || this.prop('shape', 'text').startsWith('lamp')
          ? (safeColor(this.item.props?.onColor) ?? 'var(--mat-tile-green, #268426)') // đèn tắt = màu của nó tối đi
          : 'var(--mat-tile-slate, #6f7f88)'),
      on,
      blink: on && this.prop('blinkOn', false),
      known,
    };
  }

  protected override renderWidget(): TemplateResult {
    const id = this.tagOf('value');
    const qv = this.qv(id);
    const r = this.resolve();
    const shape = this.prop('shape', 'text');
    const label = this.prop('label', '');
    const aria = [`${this.nameOf(id)}: ${r.text}`, qv.aria].filter(Boolean).join(', ');
    if (shape === 'lamp' || shape === 'lamp-square') {
      // Kiểu đèn (gộp Đèn báo cũ): chấm đèn nổi khối, quầng khi sáng (`glow`), nhãn, chữ trạng thái.
      const dot = {
        dot: true,
        square: shape === 'lamp-square',
        on: r.known && r.on,
        off: r.known && !r.on,
        inactive: !r.known,
        glow: r.known && r.on && this.prop('glow', false),
        blink: r.known && r.blink,
      };
      return html`<div class="w lamp ${qv.cls}" role="status" aria-label=${aria}>
        <div class="row">
          <span
            class=${Object.entries(dot)
              .filter(([, b]) => b)
              .map(([k]) => k)
              .join(' ')}
            style=${styleMap({ '--lc': r.color })}
          ></span>
          <span class="texts ${qv.dim ? 'dim' : ''}">
            ${label ? html`<span class="label ellipsis">${label}</span>` : nothing}
            ${
              this.prop('showText', true)
                ? html`<span class="state-text ellipsis">${r.text}</span>`
                : nothing
            }
          </span>
        </div>
        ${this.badge(qv)}
      </div>`;
    }
    const fp = this.prop('fill', 'solid');
    const fill = ['soft', 'solid', 'outline', 'plain'].includes(fp) ? fp : 'solid';
    const ico = dashIcon(this.item.props?.icon, 'ico');
    return html`<div
      class="w ${fill} ${qv.cls}"
      role="status"
      aria-label=${aria}
      style=${styleMap({ '--c': r.color })}
    >
      ${ico ?? nothing}
      <div class="texts">
        ${label ? html`<span class="label ellipsis">${label}</span>` : nothing}
        <span class="state ellipsis ${qv.dim ? 'dim' : ''} ${r.blink ? 'blink' : ''}"
          >${r.text}</span
        >
      </div>
      ${this.badge(qv)}
    </div>`;
  }
}
