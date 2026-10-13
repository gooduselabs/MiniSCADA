// Dải trạng thái/kết quả của widget điều khiển (FR-036): vùng aria-live="polite" luôn có trong cây,
// để trình đọc màn hình đọc khi nội dung đổi. Màu kèm biểu tượng và chữ.
import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { DIALOG, SENDING_TEXT, resultView } from '../i18n/control-vi.ts';
import type { ControlState } from './controller.ts';

export class MatResultBanner extends LitElement {
  static override properties = {
    state: { attribute: false },
    canDismiss: { attribute: false },
    onDismiss: { attribute: false },
  };

  declare state: ControlState | null;
  declare canDismiss: boolean;
  declare onDismiss: (() => void) | null;

  constructor() {
    super();
    this.state = null;
    this.canDismiss = true;
    this.onDismiss = null;
  }

  static override styles = css`
    :host {
      display: block;
      font-family: var(--mat-font, system-ui, sans-serif);
      font-size: 12px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 6px;
      border-radius: var(--mat-radius, 4px);
      border: 1px solid transparent;
    }
    .sev-ok {
      background: var(--mat-good-soft, #dcf1e3);
      color: var(--mat-good, #15703a);
      border-color: var(--mat-good, #15703a);
    }
    .sev-pending {
      background: var(--mat-surface-2, #f5f7f8);
      color: var(--mat-info, #0b5cad);
      border-color: var(--mat-info, #0b5cad);
    }
    .sev-warn {
      background: var(--mat-warn-soft, #fbefcf);
      color: var(--mat-warn, #8f5e00);
      border-color: var(--mat-warn, #8f5e00);
    }
    .sev-error {
      background: var(--mat-bad-soft, #fbe1e1);
      color: var(--mat-bad, #c42b2b);
      border-color: var(--mat-bad, #c42b2b);
    }
    .msg {
      flex: 1;
      overflow-wrap: anywhere;
    }
    button {
      font: inherit;
      border: 1px solid currentColor;
      background: transparent;
      color: inherit;
      border-radius: var(--mat-radius, 4px);
      padding: 1px 8px;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  protected override render(): TemplateResult {
    return html`<div aria-live="polite" aria-atomic="true">${this.#body()}</div>`;
  }

  #body(): TemplateResult | typeof nothing {
    const s = this.state;
    if (!s) return nothing;
    if (s.phase === 'sending') {
      const text = s.accepted ? resultView({ status: 'ACCEPTED' }).title : SENDING_TEXT;
      return html`<div class="row sev-pending">
        <span class="icon" aria-hidden="true">⏳</span><span class="msg">${text}</span>
      </div>`;
    }
    if (s.phase !== 'result') return nothing;
    const v = resultView(s.outcome);
    return html`<div class="row sev-${v.severity}">
      <span class="icon" aria-hidden="true">${v.icon}</span>
      <span class="msg"
        >${v.title}${v.detail ? html` <span class="detail">${v.detail}</span>` : nothing}</span
      >
      ${
        s.outcome.status === 'CONFIRMED'
          ? nothing
          : html`<button
              type="button"
              ?disabled=${!this.canDismiss}
              @click=${() => this.onDismiss?.()}
            >
              ${DIALOG.dismiss}
            </button>`
      }
    </div>`;
  }
}

if (!customElements.get('mat-result-banner'))
  customElements.define('mat-result-banner', MatResultBanner);
