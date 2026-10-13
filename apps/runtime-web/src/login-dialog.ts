// Hộp Đăng nhập của trang vận hành (feature 007, FR-039, FR-049, SC-015): <dialog> modal gốc của trình duyệt
// (focus bị giữ trong hộp, Esc đóng, nền phía sau vô hiệu), dùng được bằng bàn phím. Khi đóng, focus về nút đã mở.
import { vi } from './i18n/vi.ts';
import { createLoginForm, type LoginForm } from './login-form.ts';
import type { WebSession } from './session.ts';

export class LoginDialog {
  readonly dialog: HTMLDialogElement;
  readonly #form: LoginForm;
  #opener: Element | null = null;

  constructor(root: HTMLElement, session: WebSession, onSuccess: () => void = () => undefined) {
    this.#form = createLoginForm({
      login: (u, p) => session.login(u, p),
      onSuccess: () => {
        this.close();
        onSuccess();
      },
      onCancel: () => this.close(),
      idPrefix: 'dlg-login',
    });
    const d = document.createElement('dialog');
    d.className = 'login-dialog';
    const title = document.createElement('h2');
    title.id = 'dlg-login-title';
    title.textContent = vi.loginTitle;
    d.setAttribute('aria-labelledby', title.id);
    d.append(title, this.#form.form);
    // Esc: `cancel` của <dialog>; đóng bằng đường của mình để xóa mật khẩu và trả focus.
    d.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      this.close();
    });
    this.dialog = d;
    root.append(d);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    if (this.dialog.open) return;
    this.#opener = document.activeElement;
    this.#form.reset();
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    this.#form.focus();
  }

  close(): void {
    this.#form.reset();
    if (this.dialog.open) {
      if (typeof this.dialog.close === 'function') this.dialog.close();
      else this.dialog.removeAttribute('open');
    }
    const o = this.#opener;
    this.#opener = null;
    if (o instanceof HTMLElement && o.isConnected) o.focus();
  }
}
