// Widget `multi-state` (feature 037): nhãn đa trạng thái. Giá trị Tag (số hoặc BOOL = 0/1) tra bảng `states` của widget
// (giá trị → chữ, màu, nhấp nháy); bảng rỗng thì dùng Bảng giá trị của Tag; không khớp thì hiện giá trị định dạng, màu
// xám đá. Khối màu đặc (chữ trắng) hoặc nhạt (vạch màu), biểu tượng tùy chọn. Chữ luôn có (không chỉ màu).
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { formatValue, numberOf } from '../format/format-value.ts';
import { safeColor } from '../format/color.ts';
import type { TagState } from '../host/types.ts';
import { MatWidget } from './base.ts';
import { dashIcon } from './icons.ts';

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
      .solid .badge {
        color: #1f2933;
      }
    `,
  ];

  protected override renderWidget(): TemplateResult {
    const id = this.tagOf('value');
    const state: TagState = id ? this.source.get(id) : { value: null, quality: 'GOOD' };
    const info = id ? this.source.info(id) : undefined;
    const qv = this.qv(id);
    const good = state.quality === 'GOOD' || state.quality === 'UNCERTAIN';
    const hit = good ? matchState(this.item.props?.states, state.value) : undefined;
    const fmt = hit
      ? { text: hit.text, color: hit.color }
      : formatValue(state, info, {
          decimals: this.decimals(info),
          ...(info?.valueTable ? { table: this.source.valueTable(info.valueTable) } : {}),
        });
    const color = good ? safeColor(fmt.color) : undefined;
    const fill = this.prop('fill', 'solid') === 'soft' ? 'soft' : 'solid';
    const label = this.prop('label', '');
    const ico = dashIcon(this.item.props?.icon, 'ico');
    const blink = !!hit?.blink && this.mode !== 'edit';
    return html`<div
      class="w ${fill} ${qv.cls}"
      role="status"
      aria-label=${[`${this.nameOf(id)}: ${fmt.text}`, qv.aria].filter(Boolean).join(', ')}
      style=${styleMap({ '--c': color })}
    >
      ${ico ?? nothing}
      <div class="texts">
        ${label ? html`<span class="label ellipsis">${label}</span>` : nothing}
        <span class="state ellipsis ${qv.dim ? 'dim' : ''} ${blink ? 'blink' : ''}"
          >${fmt.text}</span
        >
      </div>
      ${this.badge(qv)}
    </div>`;
  }
}
