// Thông báo ngắn (feature 004, T052): role=status, đọc bởi trình đọc màn hình (aria-live polite), tự ẩn
// sau 4 s. Mỗi lần app báo (id mới) thì hiện lại và tính giờ lại, kể cả cùng chữ.
import { html } from 'lit';
import { AppElement } from './base.ts';

export const TOAST_MS = 4000;

export class MatToast extends AppElement {
  private shownId = 0;
  private off = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'status');
    this.setAttribute('aria-live', 'polite');
  }

  override disconnectedCallback(): void {
    if (this.timer) clearTimeout(this.timer);
    super.disconnectedCallback();
  }

  protected override render() {
    const toast = this.app.ui.toast;
    if (toast && toast.id !== this.shownId) {
      this.shownId = toast.id;
      this.off = false;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.off = true;
        this.requestUpdate();
      }, TOAST_MS);
    }
    return html`<div class="toast" ?hidden=${this.off || !toast}>${toast?.text ?? ''}</div>`;
  }
}

customElements.define('mat-toast', MatToast);

declare global {
  interface HTMLElementTagNameMap {
    'mat-toast': MatToast;
  }
}
