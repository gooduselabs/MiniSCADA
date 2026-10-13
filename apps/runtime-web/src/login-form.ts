// Biểu mẫu đăng nhập dùng chung cho hộp Đăng nhập của trang vận hành (login-dialog.ts) và trang `/login` (login.ts)
// (feature 007, FR-039, FR-049; contracts/web-session.md §4).
//  - `autocomplete` đúng (`username`, `current-password`) để trình quản lý mật khẩu của Chrome làm việc; trang không lưu gì.
//  - Mật khẩu bị xóa khỏi DOM ngay khi gửi (`value = ''`), không chờ kết quả.
//  - Mọi chữ qua `textContent`; không HTML thô.
import type { SessionInfo } from '@mat/ui-components';
import { vi } from './i18n/vi.ts';
import type { LoginResult } from './session.ts';

export interface LoginFormOptions {
  login: (username: string, password: string) => Promise<LoginResult>;
  onSuccess: (info: SessionInfo) => void;
  /** Có thì hiện nút Hủy (hộp thoại). */
  onCancel?: () => void;
  /** Tiền tố id để hai biểu mẫu trên một trang không trùng id. */
  idPrefix?: string;
}

export interface LoginForm {
  form: HTMLFormElement;
  user: HTMLInputElement;
  pass: HTMLInputElement;
  error: HTMLElement;
  submit: HTMLButtonElement;
  /** Xóa mật khẩu và thông báo lỗi (mở lại hộp). */
  reset(): void;
  focus(): void;
}

function field(id: string, label: string, input: HTMLInputElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;
  input.id = id;
  wrap.append(l, input);
  return wrap;
}

export function createLoginForm(o: LoginFormOptions): LoginForm {
  const p = o.idPrefix ?? 'login';
  const form = document.createElement('form');
  form.className = 'login-form';
  form.noValidate = true;
  form.method = 'post';

  const user = document.createElement('input');
  user.type = 'text';
  user.name = 'username';
  user.autocomplete = 'username';
  user.autocapitalize = 'none';
  user.spellcheck = false;
  user.required = true;
  user.maxLength = 64;

  const pass = document.createElement('input');
  pass.type = 'password';
  pass.name = 'password';
  pass.autocomplete = 'current-password';
  pass.required = true;
  pass.maxLength = 128;

  const error = document.createElement('p');
  error.className = 'login-error';
  error.setAttribute('role', 'alert');
  error.id = `${p}-error`;
  error.hidden = true;
  user.setAttribute('aria-describedby', error.id);
  pass.setAttribute('aria-describedby', error.id);

  const actions = document.createElement('div');
  actions.className = 'login-actions';
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary';
  submit.textContent = vi.loginSubmit;
  if (o.onCancel) {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = vi.loginCancel;
    cancel.addEventListener('click', () => o.onCancel?.());
    actions.append(cancel);
  }
  actions.append(submit);

  form.append(
    field(`${p}-user`, vi.loginUser, user),
    field(`${p}-pass`, vi.loginPass, pass),
    error,
    actions,
  );

  let busy = false;
  const showError = (text: string) => {
    error.textContent = text;
    error.hidden = false;
  };

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (busy) return;
    const name = user.value.trim();
    const secret = pass.value;
    if (!name || !secret) {
      showError(vi.loginEmpty);
      (name ? pass : user).focus();
      return;
    }
    busy = true;
    submit.disabled = true;
    submit.textContent = vi.loginBusy;
    error.hidden = true;
    const result = o.login(name, secret);
    pass.value = ''; // xóa khỏi DOM ngay sau khi gửi
    void result.then(
      (r) => {
        busy = false;
        submit.disabled = false;
        submit.textContent = vi.loginSubmit;
        if (r.ok) {
          user.value = '';
          o.onSuccess(r.info);
        } else {
          showError(vi.loginError(r.code, r.retryAfterS));
          pass.focus();
        }
      },
      () => {
        busy = false;
        submit.disabled = false;
        submit.textContent = vi.loginSubmit;
        showError(vi.loginError('NETWORK'));
        pass.focus();
      },
    );
  });

  return {
    form,
    user,
    pass,
    error,
    submit,
    reset() {
      pass.value = '';
      error.hidden = true;
      error.textContent = '';
    },
    focus() {
      (user.value ? pass : user).focus();
    },
  };
}
