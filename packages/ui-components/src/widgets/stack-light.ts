// Widget `stack-light` (feature 037): đèn tháp (đỏ, vàng, xanh lá, xanh dương) trên cột có đế. Mỗi tầng một khe Tag
// (BOOL hoặc số khác 0 = sáng); chỉ vẽ các tầng đã gắn (chưa gắn tầng nào thì vẽ đủ 4, dùng khi thiết kế). Tầng sáng
// có quầng tĩnh; tầng đỏ nhấp nháy khi sáng (`blinkRed`, CSS steps, tắt khi giảm chuyển động). Quality xấu: tầng
// viền đứt. Nhãn truy cập liệt kê tầng đang sáng (không chỉ màu).
import { css, html, nothing, type TemplateResult } from 'lit';
import { numberOf } from '../format/format-value.ts';
import { MatWidget } from './base.ts';

export const STACK_SLOTS = ['red', 'yellow', 'green', 'blue'] as const;
type Lvl = (typeof STACK_SLOTS)[number];

const COLORS: Record<Lvl, string> = {
  red: '#e5302a',
  yellow: '#f5a400',
  green: '#22a845',
  blue: '#2a7de1',
};
const NAMES: Record<Lvl, string> = {
  red: 'Đỏ',
  yellow: 'Vàng',
  green: 'Xanh lá',
  blue: 'Xanh dương',
};

export class MatStackLight extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        align-items: center;
        gap: 4px;
        padding: 6px;
        background: transparent;
        border-color: transparent;
        box-shadow: none;
      }
      .label {
        font-size: 12px;
        font-weight: 600;
        color: var(--mat-text-muted);
        text-align: center;
        max-width: 100%;
      }
      .tower {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
      }
      .stack {
        flex: 1;
        min-height: 0;
        width: min(70%, 56px);
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 3px;
        border-radius: 8px 8px 2px 2px;
        background: #3a4247;
      }
      .horizontal .tower {
        flex-direction: row;
        height: 100%;
      }
      .horizontal .stack {
        flex-direction: row;
        width: auto;
        height: min(70%, 56px);
        flex: 1;
        border-radius: 8px 2px 2px 8px;
      }
      .seg {
        flex: 1;
        min-height: 10px;
        min-width: 10px;
        border-radius: 5px;
        background: color-mix(in srgb, var(--k) 28%, #20262a);
        box-shadow: inset 0 -3px 6px rgba(0, 0, 0, 0.35);
      }
      .seg.on {
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--k) 80%, #000) 0%,
          color-mix(in srgb, var(--k) 70%, #fff) 45%,
          var(--k) 70%,
          color-mix(in srgb, var(--k) 80%, #000) 100%
        );
        box-shadow:
          0 0 10px 2px color-mix(in srgb, var(--k) 65%, transparent),
          inset 0 0 6px rgba(255, 255, 255, 0.35);
      }
      .seg.bad {
        outline: 2px dashed var(--mat-offline, #6b777c);
        outline-offset: -2px;
      }
      .pole {
        flex: none;
        width: 8px;
        height: 14%;
        min-height: 8px;
        background: linear-gradient(90deg, #6b777c, #b8c2c7, #6b777c);
      }
      .base {
        flex: none;
        width: min(90%, 72px);
        height: 8px;
        border-radius: 3px;
        background: #3a4247;
      }
      .horizontal .pole {
        width: 14%;
        height: 8px;
        min-width: 8px;
      }
      .horizontal .base {
        width: 8px;
        height: min(90%, 72px);
      }
    `,
  ];

  protected override renderWidget(): TemplateResult {
    const bound = STACK_SLOTS.filter((s) => this.tagOf(s));
    const levels: readonly Lvl[] = bound.length ? bound : STACK_SLOTS;
    const lit: string[] = [];
    const segs = levels.map((s) => {
      const id = this.tagOf(s);
      const st = id ? this.source.get(id) : undefined;
      const good = st && (st.quality === 'GOOD' || st.quality === 'UNCERTAIN');
      const v = st?.value;
      const on =
        !!good &&
        v !== null &&
        v !== undefined &&
        (typeof v === 'boolean' ? v : numberOf(v as Parameters<typeof numberOf>[0]) !== 0);
      if (on) lit.push(NAMES[s]);
      const blink = on && s === 'red' && this.prop('blinkRed', true) && this.mode !== 'edit';
      return html`<div
        class="seg ${on ? 'on' : ''} ${blink ? 'blink' : ''} ${st && !good ? 'bad' : ''}"
        data-level=${s}
        style="--k:${COLORS[s]}"
      ></div>`;
    });
    // Đỏ ở trên cùng (dọc) / bên phải (ngang): thứ tự thật của đèn tháp.
    const horizontal = this.prop('orientation', 'vertical') === 'horizontal';
    const label = this.prop('label', '');
    const name = label || this.nameOf(undefined);
    return html`<div
      class="w ${horizontal ? 'horizontal' : ''}"
      role="img"
      aria-label=${`${name ? name + ': ' : ''}${lit.length ? lit.join(', ') : 'tắt'}`}
    >
      ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
      <div class="tower">
        ${
          horizontal
            ? html`<div class="base"></div>
                <div class="pole"></div>`
            : nothing
        }
        <div class="stack">${horizontal ? segs.reverse() : segs}</div>
        ${
          horizontal
            ? nothing
            : html`<div class="pole"></div>
                <div class="base"></div>`
        }
      </div>
    </div>`;
  }
}
