// Widget `button` (FR-028, FR-033): một hành động `click`. write/toggle/pulse đi qua ControlController;
// navigate/popup/closePopup gọi thẳng ActionHost (không cần phiên, không hộp xác nhận).
import type { Action } from '@mat/project-schema';
import { css, html, nothing, type TemplateResult } from 'lit';
import { ControlWidget, controlStyles } from '../control/control-widget.ts';
import { popupLock, type Lock } from '../control/lock-reasons.ts';
import { widgetStyles } from '../styles/widget-styles.ts';

const WRITE = new Set(['write', 'toggle', 'pulse']);

export class MatWButton extends ControlWidget {
  static override styles = [
    widgetStyles,
    controlStyles,
    css`
      .btn {
        width: 100%;
        height: 100%;
        min-height: 28px;
        padding: 4px 10px;
        border-radius: var(--mat-radius, 4px);
        border: 1px solid var(--mat-border-strong, #b3bec3);
        background: var(--mat-surface-2, #f5f7f8);
        font-weight: 600;
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .btn.primary {
        background: var(--mat-accent, #0b7285);
        border-color: var(--mat-accent, #0b7285);
        color: var(--mat-accent-ink, #fff);
      }
      .btn.active {
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
      }
      .btn.danger {
        background: var(--mat-bad, #c42b2b);
        border-color: var(--mat-bad, #c42b2b);
        color: var(--mat-surface, #fff);
      }
    `,
  ];

  #action(): Action | undefined {
    return this.item?.events?.click;
  }

  protected override needsController(): boolean {
    const a = this.#action();
    return !!a && WRITE.has(a.action);
  }

  /** Feature 013: hành động mở popup mà người dùng không được xem popup đó. */
  #popupLock(): Lock | null {
    const a = this.#action();
    return a?.action === 'popup' && this.mode === 'run' ? popupLock(this.host, a.screen) : null;
  }

  /**
   * Feature 029: trạng thái phản hồi từ Tag `feedback` (tùy chọn): đang tác động khi giá trị bằng `activeValue` (so dạng chữ;
   * rỗng: Tag bool `true` hoặc số khác 0). null khi không gắn Tag phản hồi hoặc chưa có giá trị.
   */
  #active(): boolean | null {
    const id = this.tagOf('feedback');
    if (!id || !this.source) return null;
    const v = this.source.get(id).value;
    if (v === null || v === undefined) return null;
    const want = this.prop('activeValue', '');
    if (want === '') return v === true || (typeof v === 'number' && v !== 0);
    return String(v) === want;
  }

  #click = (): void => {
    const a = this.#action();
    if (!a || this.mode !== 'run' || !this.host) return;
    if (this.#popupLock()) return;
    switch (a.action) {
      case 'navigate':
        this.host.navigate(a.screen);
        break;
      case 'popup':
        if (a.args) this.host.openPopup(a.screen, a.args);
        else this.host.openPopup(a.screen);
        break;
      case 'closePopup':
        this.host.closePopup();
        break;
      case 'write':
        this.ctl?.propose('write', a.value);
        break;
      case 'toggle':
        this.ctl?.propose('toggle', true);
        break;
      case 'pulse':
        this.ctl?.propose('pulse', a.value, { pulseMs: a.durationMs });
        break;
    }
  };

  protected override renderWidget(): TemplateResult | typeof nothing {
    const a = this.#action();
    const variant = this.prop<string>('variant', 'primary');
    const name = this.nameOf(this.tagId);
    const label = this.prop('label', '') || name;
    const write = !!a && WRITE.has(a.action);
    const plock = this.#popupLock();
    const active = this.#active();
    const bg =
      active === null ? undefined : this.colorProp(active ? 'activeColor' : 'inactiveColor');
    const disabled = this.mode !== 'run' || !a || (write && !this.ready) || plock !== null;
    return this.frame(
      html`<button
          type="button"
          data-main
          class="btn ${variant} ${active === null ? '' : active ? 'active' : 'inactive'}"
          style=${bg ? `background:${bg};border-color:${bg};color:#fff` : nothing}
          aria-pressed=${active === null ? nothing : active ? 'true' : 'false'}
          aria-label=${name}
          aria-describedby=${plock ? 'lock' : (this.describedBy() ?? nothing)}
          ?disabled=${disabled}
          @click=${this.#click}
        >
          ${label}
        </button>
        ${
          plock
            ? html`<div
                class="lockmsg ellipsis"
                id="lock"
                title=${plock.message}
                data-lock=${plock.code}
              >
                🔒 ${plock.message}
              </div>`
            : nothing
        }`,
    );
  }
}

if (!customElements.get('mat-w-button')) customElements.define('mat-w-button', MatWButton);
