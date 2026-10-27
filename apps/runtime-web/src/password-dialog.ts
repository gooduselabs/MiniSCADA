// Hộp "Đổi mật khẩu của tôi" (feature 013, US2 AC7, FR-005; admin-api §1 `POST /api/v1/web/password`): <dialog> modal
// gốc (focus giữ trong hộp, Esc đóng), ba ô mật khẩu với autocomplete đúng, chỉ báo độ dài 15–128 (progressbar có nhãn),
// kiểm khớp trước khi gửi. Mật khẩu bị xóa khỏi DOM ngay khi gửi; trang không lưu gì. Mọi chữ qua textContent.
import { viAccount as T } from './i18n/vi-account.ts';
import type { PasswordResult } from './session.ts';

import { PW_MAX, PW_MIN } from '@mat/admin-model';
export { PW_MAX, PW_MIN };

export interface PasswordDialogDeps {
  changePassword(oldPassword: string, newPassword: string): Promise<PasswordResult>;
}

/** Chỉ báo độ dài (đếm theo điểm mã Unicode, như máy chủ đếm ký tự). */
export function passwordHint(n: number): { ok: boolean; text: string } {
  if (n > PW_MAX) return { ok: false, text: T.pwTooLong };
  if (n < PW_MIN) return { ok: false, text: T.pwShort(n) };
  return { ok: true, text: T.pwOk };
}

const len = (s: string) => [...s.normalize('NFC')].length;

function field(id: string, label: string, autocomplete: string): [HTMLElement, HTMLInputElement] {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;
  const input = document.createElement('input');
  input.type = 'password';
  input.id = id;
  input.autocomplete = autocomplete as AutoFill;
  input.maxLength = 256;
  input.required = true;
  wrap.append(l, input);
  return [wrap, input];
}

export class PasswordDialog {
  readonly dialog: HTMLDialogElement;
  readonly #old: HTMLInputElement;
  readonly #new: HTMLInputElement;
  readonly #repeat: HTMLInputElement;
  readonly #error: HTMLElement;
  readonly #done: HTMLElement;
  readonly #form: HTMLFormElement;
  readonly #submit: HTMLButtonElement;
  readonly #bar: HTMLElement;
  readonly #fill: HTMLElement;
  readonly #meterText: HTMLElement;
  #opener: Element | null = null;
  #busy = false;

  constructor(root: HTMLElement, deps: PasswordDialogDeps) {
    const d = document.createElement('dialog');
    d.className = 'login-dialog pw-dialog';
    const title = document.createElement('h2');
    title.id = 'pw-title';
    title.textContent = T.pwTitle;
    d.setAttribute('aria-labelledby', title.id);

    const form = document.createElement('form');
    form.noValidate = true;
    const [fo, old] = field('pw-old', T.pwOld, 'current-password');
    const [fn, nw] = field('pw-new', T.pwNew, 'new-password');
    const [fr, rep] = field('pw-repeat', T.pwRepeat, 'new-password');
    const rule = document.createElement('p');
    rule.className = 'pw-rule';
    rule.id = 'pw-rule';
    rule.textContent = T.pwRule;
    nw.setAttribute('aria-describedby', 'pw-rule pw-meter-text');

    const meter = document.createElement('div');
    meter.className = 'pw-meter';
    const bar = document.createElement('div');
    bar.className = 'pw-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', T.pwNew);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(PW_MIN));
    bar.setAttribute('aria-valuenow', '0');
    const fill = document.createElement('span');
    bar.append(fill);
    const meterText = document.createElement('span');
    meterText.className = 'pw-meter-text';
    meterText.id = 'pw-meter-text';
    meterText.setAttribute('aria-live', 'polite');
    meter.append(bar, meterText);
    fn.append(rule, meter);

    const error = document.createElement('p');
    error.className = 'login-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const done = document.createElement('p');
    done.className = 'pw-done';
    done.setAttribute('role', 'status');
    done.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'login-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = T.pwCancel;
    cancel.addEventListener('click', () => this.close());
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'primary';
    submit.textContent = T.pwSubmit;
    actions.append(cancel, submit);
    form.append(fo, fn, fr, error, done, actions);
    d.append(title, form);

    this.dialog = d;
    this.#old = old;
    this.#new = nw;
    this.#repeat = rep;
    this.#error = error;
    this.#done = done;
    this.#form = form;
    this.#submit = submit;
    this.#bar = bar;
    this.#fill = fill;
    this.#meterText = meterText;

    nw.addEventListener('input', () => this.#meter());
    d.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      this.close();
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (this.#busy) return;
      if (!this.#done.hidden) {
        this.close();
        return;
      }
      const o = old.value;
      const n = nw.value;
      const r = rep.value;
      const bad = (text: string, focus: HTMLInputElement) => {
        this.#showError(text);
        focus.focus();
      };
      if (!o) return bad(T.pwEmptyOld, old);
      const hint = passwordHint(len(n));
      if (!hint.ok) return bad(hint.text, nw);
      if (n !== r) return bad(T.pwMismatch, rep);
      if (n === o) return bad(T.pwSame, nw);
      this.#busy = true;
      submit.disabled = true;
      submit.textContent = T.pwBusy;
      error.hidden = true;
      const p = deps.changePassword(o, n);
      old.value = nw.value = rep.value = ''; // xóa khỏi DOM ngay khi gửi
      this.#meter();
      void p.then(
        (res) => this.#finish(res),
        () => this.#finish({ ok: false, code: 'NETWORK' }),
      );
    });
    root.append(d);
    this.#meter();
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    if (this.dialog.open) return;
    this.#opener = document.activeElement;
    this.#reset();
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    this.#old.focus();
  }

  close(): void {
    this.#reset();
    if (this.dialog.open) {
      if (typeof this.dialog.close === 'function') this.dialog.close();
      else this.dialog.removeAttribute('open');
    }
    const o = this.#opener;
    this.#opener = null;
    if (o instanceof HTMLElement && o.isConnected) o.focus();
  }

  #reset(): void {
    this.#old.value = this.#new.value = this.#repeat.value = '';
    this.#error.hidden = true;
    this.#done.hidden = true;
    this.#busy = false;
    this.#submit.disabled = false;
    this.#submit.textContent = T.pwSubmit;
    for (const i of [this.#old, this.#new, this.#repeat]) i.parentElement!.hidden = false;
    this.#meter();
  }

  #showError(text: string): void {
    this.#error.textContent = text;
    this.#error.hidden = false;
  }

  #meter(): void {
    const n = len(this.#new.value);
    const h = passwordHint(n);
    this.#bar.setAttribute('aria-valuenow', String(Math.min(n, PW_MIN)));
    this.#bar.setAttribute('aria-valuetext', `${T.pwCount(n)}. ${h.text}`);
    this.#fill.style.width = `${Math.min(100, (n / PW_MIN) * 100)}%`;
    this.#bar.dataset.state = n === 0 ? 'empty' : h.ok ? 'ok' : n > PW_MAX ? 'bad' : 'short';
    this.#meterText.textContent = n === 0 ? T.pwCount(0) : `${T.pwCount(n)} · ${h.text}`;
  }

  #finish(r: PasswordResult): void {
    this.#busy = false;
    this.#submit.disabled = false;
    if (r.ok) {
      this.#done.textContent = T.pwDone;
      this.#done.hidden = false;
      for (const i of [this.#old, this.#new, this.#repeat]) i.parentElement!.hidden = true;
      this.#submit.textContent = T.pwClose;
      this.#submit.focus();
      return;
    }
    this.#submit.textContent = T.pwSubmit;
    this.#showError(T.pwError(r.code, r.reason, r.message, r.retryAfterS));
    (r.code === 'WEAK_PASSWORD' ? this.#new : this.#old).focus();
  }

  /** Cho test: form bên trong. */
  get form(): HTMLFormElement {
    return this.#form;
  }
}
