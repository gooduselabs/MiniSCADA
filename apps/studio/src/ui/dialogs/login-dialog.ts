// Hộp thoại đăng nhập (feature 005, US1, FR-012, FR-013, FR-031, spec US1-5, US1-6, US1-8; theo drawLogin
// của mockup đã duyệt). Thông báo không cho biết sai tên hay sai mật khẩu; đang khóa thì hiện thời gian còn
// lại, đếm ngược; ô mật khẩu xóa ngay khi gửi, mật khẩu không giữ ở đâu (chuyển thẳng xuống Rust);
// `setup-required` hướng dẫn lệnh trên thiết bị. Phiên hết hạn: "Đăng nhập lại", tài khoản điền sẵn, "Để
// sau" giữ theo dõi (thay đổi chưa lưu không bị đụng tới).
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { deviceErrorText, duration } from '../../app/device-errors.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { LoginErrorCode } from '../../model/device-session.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';

const USER_ID = 'lg-user';
const PASS_ID = 'lg-pass';
const ERR_ID = 'lg-err';
const FORM_ID = 'lg-form';

const LOGIN_ERROR: Readonly<Record<Exclude<LoginErrorCode, 'locked' | 'failed'>, MessageKey>> = {
  'auth-failed': 'login.err.auth-failed',
  'auth-busy': 'login.err.auth-busy',
  'audit-unavailable': 'login.err.audit-unavailable',
  'setup-required': 'login.err.setup-required',
  unreachable: 'login.err.unreachable',
  timeout: 'login.err.timeout',
};

export class MatLoginDialog extends OnlineDialog {
  protected readonly kind = 'login';
  private user = '';
  private formError: MessageKey | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  protected override opened(): void {
    const s = this.app.session;
    this.user = s.auth?.user ?? s.device?.lastUser ?? '';
    this.formError = null;
  }

  protected override initialFocus(): HTMLElement | null {
    return this.querySelector<HTMLElement>(this.user ? `#${PASS_ID}` : `#${USER_ID}`);
  }

  protected override detached(): void {
    this.stopTicker();
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Giây còn khóa (≤ 0: hết khóa); `null` khi không bị khóa. */
  private lockLeft(): number | null {
    const e = this.app.session.loginError;
    if (e?.code !== 'locked') return null;
    return Math.ceil((e.retryAfterS ?? 0) - (Date.now() - e.at) / 1000);
  }

  protected override updated(): void {
    super.updated();
    // Đang khóa: vẽ lại mỗi giây để đếm ngược.
    const left = this.isOpen ? this.lockLeft() : null;
    if (left !== null && left > 0) {
      if (!this.ticker) this.ticker = setInterval(() => this.requestUpdate(), 1000);
    } else this.stopTicker();
  }

  private message(): string {
    if (this.formError) return t(this.formError);
    const e = this.app.session.loginError;
    if (!e) return '';
    if (e.code === 'locked') {
      const left = this.lockLeft() ?? 0;
      return left > 0 ? t('login.err.locked', { time: duration(left) }) : t('login.err.unlocked');
    }
    if (e.code === 'failed')
      return t('login.err.failed', {
        reason: deviceErrorText(e.cause ?? { error: e.detail ?? '' }),
      });
    return t(LOGIN_ERROR[e.code]);
  }

  private readonly onSubmit = (e: Event): void => {
    e.preventDefault();
    const app = this.app;
    if (app.session.busy) return;
    const userEl = this.querySelector<HTMLInputElement>(`#${USER_ID}`);
    const passEl = this.querySelector<HTMLInputElement>(`#${PASS_ID}`);
    if (!userEl || !passEl) return;
    const user = userEl.value.trim();
    const password = passEl.value;
    // Xóa ngay khi gửi; mật khẩu chỉ đi qua lời gọi đăng nhập, không lưu vào trạng thái nào.
    passEl.value = '';
    this.user = user;
    this.formError = !user ? 'login.needUser' : !password ? 'login.needPassword' : null;
    if (this.formError) {
      this.requestUpdate();
      (user ? passEl : userEl).focus();
      return;
    }
    this.requestUpdate();
    void app.login(user, password).then(() => {
      if (this.isOpen) this.querySelector<HTMLInputElement>(`#${PASS_ID}`)?.focus();
    });
  };

  protected override render() {
    if (!this.isOpen) return nothing;
    const app = this.app;
    const s = app.session;
    // Hộp thoại chỉ mở ở bước đăng nhập lần đầu (`login`) hoặc khi phiên hết hạn (cả lúc đang kết nối lại).
    const relogin = s.state !== 'login';
    const name = s.device?.name ?? '';
    const busy = s.busy;
    const msg = this.message();
    const body = html`<form class="form narrow" id=${FORM_ID} novalidate @submit=${this.onSubmit}>
      ${relogin ? html`<p class="banner warn ld-note">${icon('warn', 'warn')}${t('login.relogin')}</p>` : nothing}
      <div class="field">
        <label for=${USER_ID}>${t('login.user')}</label>
        <input
          id=${USER_ID}
          name="user"
          class="input"
          type="text"
          autocomplete="username"
          spellcheck="false"
          .value=${live(this.user)}
          @input=${(e: Event) => (this.user = (e.target as HTMLInputElement).value)}
        />
      </div>
      <div class="field">
        <label for=${PASS_ID}>${t('login.password')}</label>
        <input
          id=${PASS_ID}
          name="password"
          class="input"
          type="password"
          autocomplete="current-password"
          placeholder=${t('login.passwordPlaceholder')}
          aria-describedby=${msg ? ERR_ID : nothing}
          aria-invalid=${msg && !this.formError ? 'true' : nothing}
        />
        <p class="err-text" id=${ERR_ID} role="alert">${msg}</p>
      </div>
      <p class="help">${t('login.help')}</p>
      <p class="help">${t('login.remember')}</p>
    </form>`;
    const foot = html`${
        relogin
          ? html`<button class="btn" type="button" @click=${() => this.close()}>
              ${t('login.later')}
            </button>`
          : html`<button class="btn" type="button" @click=${() => app.cancelOnline(true)}>
              ${t('login.back')}
            </button>`
      }
      <span class="grow"></span>
      <button class="btn primary" type="submit" form=${FORM_ID} ?disabled=${busy}>
        ${icon('lock')}${busy ? t('login.busy') : t('login.submit')}
      </button>`;
    return this.frame({
      title: relogin ? t('login.reloginTitle', { name }) : t('login.title', { name }),
      icon: 'lock',
      body,
      foot,
      busy,
    });
  }
}

customElements.define('mat-login-dialog', MatLoginDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-login-dialog': MatLoginDialog;
  }
}
