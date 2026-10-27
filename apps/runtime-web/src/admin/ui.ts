// Tiện ích DOM của trang Quản trị (feature 013): dựng phần tử bằng createElement/textContent (không HTML thô), hộp
// thoại <dialog> modal (focus giữ trong hộp, Esc đóng, focus về nút đã mở), hộp xác nhận lại bằng mật khẩu, chip màu,
// thông báo ngắn (aria-live).
import { createIcon } from '../icons.ts';
import { viAdmin } from '../i18n/vi-admin.ts';
import { adminErrorText } from '@mat/admin-model';
import { AdminApiError } from './api.ts';

type Child = Node | string | null | undefined | false;
export interface HProps {
  class?: string;
  text?: string;
  id?: string;
  type?: string;
  title?: string;
  hidden?: boolean;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  p: HProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (p.class) e.className = p.class;
  if (p.id) e.id = p.id;
  if (p.text !== undefined) e.textContent = p.text;
  if (p.title) e.title = p.title;
  if (p.hidden) e.hidden = true;
  if (p.type) e.setAttribute('type', p.type);
  for (const [k, v] of Object.entries(p.attrs ?? {})) e.setAttribute(k, v);
  for (const [k, fn] of Object.entries(p.on ?? {})) if (fn) e.addEventListener(k, fn);
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

export function button(
  label: string,
  onClick: () => void,
  opts: {
    kind?: 'primary' | 'danger' | 'ghost' | 'subtle';
    icon?: Parameters<typeof createIcon>[0];
    aria?: string;
    small?: boolean;
  } = {},
): HTMLButtonElement {
  const b = h('button', {
    type: 'button',
    class: `ad-btn${opts.kind ? ` ${opts.kind}` : ''}${opts.small ? ' small' : ''}`,
    on: { click: () => onClick() },
  });
  if (opts.icon) b.append(createIcon(opts.icon));
  b.append(h('span', { text: label }));
  if (opts.aria) b.setAttribute('aria-label', opts.aria);
  return b;
}

const ROLE_HUE: Record<string, number> = { viewer: 8, operator: 2, engineer: 9, administrator: 6 };
export const roleBadge = (role: string): HTMLElement =>
  h('span', { class: `ad-role hue-${ROLE_HUE[role] ?? 8}`, text: viAdmin.roleName(role) });

export const chip = (label: string, hue: number, extra = ''): HTMLElement =>
  h('span', {
    class: `ad-chip hue-${((hue % 12) + 12) % 12}${extra ? ` ${extra}` : ''}`,
    text: label,
  });

export const pill = (
  text: string,
  tone: 'ok' | 'off' | 'warn' | 'bad' | 'info' | 'muted',
): HTMLElement => h('span', { class: `ad-pill ${tone}`, text });

/** Màu chip của nhóm theo vị trí trong danh sách nhóm (ổn định giữa các tab). */
export const groupHue = (ids: readonly string[], id: string): number =>
  (4 + Math.max(0, ids.indexOf(id))) % 12;

/** Câu lỗi tiếng Việt cho lỗi của API quản trị. */
export const errorText = (e: unknown): string => adminErrorText(e, viAdmin.banner.conflict);

let dialogSeq = 0;

/** Hộp thoại modal: `body` và nút do người gọi dựng; `close()` trả focus về phần tử đã mở. */
export class Modal {
  readonly dialog: HTMLDialogElement;
  readonly body: HTMLElement;
  readonly footer: HTMLElement;
  readonly error: HTMLElement;
  #opener: Element | null = null;
  #onClose: (() => void) | null = null;

  constructor(root: HTMLElement, title: string, opts: { danger?: boolean; wide?: boolean } = {}) {
    const id = `ad-dlg-${++dialogSeq}`;
    this.dialog = h('dialog', {
      class: `ad-dialog${opts.danger ? ' danger' : ''}${opts.wide ? ' wide' : ''}`,
      attrs: { 'aria-labelledby': `${id}-t` },
    });
    const head = h(
      'div',
      { class: 'ad-dialog-head' },
      h('h2', { id: `${id}-t`, text: title }),
      button('', () => this.close(), { kind: 'ghost', icon: 'close', aria: viAdmin.close }),
    );
    this.error = h('p', { class: 'ad-error', attrs: { role: 'alert' }, hidden: true });
    this.body = h('div', { class: 'ad-dialog-body' });
    this.footer = h('div', { class: 'ad-dialog-foot' });
    this.dialog.append(head, this.body, this.error, this.footer);
    this.dialog.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      this.close();
    });
    root.append(this.dialog);
  }

  open(onClose?: () => void): this {
    this.#opener = document.activeElement;
    this.#onClose = onClose ?? null;
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    const first = this.body.querySelector<HTMLElement>(
      'input:not([type=hidden]):not([disabled]), select, textarea, button',
    );
    (first ?? this.footer.querySelector<HTMLElement>('button'))?.focus();
    return this;
  }

  showError(text: string | null): void {
    this.error.textContent = text ?? '';
    this.error.hidden = text === null;
  }

  close(): void {
    if (this.dialog.open) {
      if (typeof this.dialog.close === 'function') this.dialog.close();
      else this.dialog.removeAttribute('open');
    }
    for (const i of this.dialog.querySelectorAll('input[type=password]'))
      (i as HTMLInputElement).value = '';
    this.dialog.remove();
    const o = this.#opener;
    this.#opener = null;
    if (o instanceof HTMLElement && o.isConnected) o.focus();
    const cb = this.#onClose;
    this.#onClose = null;
    cb?.();
  }
}

/** Ô nhập có nhãn (id duy nhất). */
export function field(
  label: string,
  input: HTMLInputElement | HTMLSelectElement,
  hint?: string,
): HTMLElement {
  const id = input.id || `ad-f-${++dialogSeq}`;
  input.id = id;
  const wrap = h(
    'div',
    { class: 'ad-field' },
    h('label', { text: label, attrs: { for: id } }),
    input,
  );
  if (hint) {
    const hi = h('p', { class: 'ad-hint', id: `${id}-hint`, text: hint });
    input.setAttribute('aria-describedby', hi.id);
    wrap.append(hi);
  }
  return wrap;
}

export function input(type: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const i = h('input', { type, attrs });
  return i;
}

/**
 * Xác nhận lại bằng mật khẩu của admin (admin-api: `reauth`). `run(reauth)` ném `REAUTH_REQUIRED` thì báo sai và giữ
 * hộp; lỗi khác đóng hộp và chuyển cho `onError`; thành công đóng hộp.
 */
export function reauthDialog(
  root: HTMLElement,
  o: {
    title: string;
    body: string;
    confirm: string;
    danger?: boolean;
    extra?: HTMLElement;
    run: (reauth: string) => Promise<void>;
    onError: (e: unknown) => void;
  },
): Modal {
  const m = new Modal(root, o.title, { danger: o.danger ?? false });
  const pw = input('password', { autocomplete: 'current-password', maxlength: '256' });
  m.body.append(h('p', { class: 'ad-lead', text: o.body }));
  if (o.extra) m.body.append(o.extra);
  m.body.append(
    h('p', { class: 'ad-reauth-note', text: viAdmin.reauth.body }),
    field(viAdmin.reauth.label, pw),
  );
  const ok = button(o.confirm, () => submit(), { kind: o.danger ? 'danger' : 'primary' });
  ok.setAttribute('data-confirm', '');
  m.footer.append(
    button(viAdmin.cancel, () => m.close(), { kind: 'subtle' }),
    ok,
  );
  let busy = false;
  const submit = () => {
    if (busy) return;
    const secret = pw.value;
    if (!secret) {
      m.showError(viAdmin.reauth.empty);
      pw.focus();
      return;
    }
    busy = true;
    ok.disabled = true;
    pw.value = '';
    m.showError(null);
    o.run(secret).then(
      () => m.close(),
      (e: unknown) => {
        busy = false;
        ok.disabled = false;
        if (e instanceof AdminApiError && e.code === 'REAUTH_REQUIRED') {
          m.showError(viAdmin.errors.REAUTH_REQUIRED);
          pw.focus();
          return;
        }
        m.close();
        o.onError(e);
      },
    );
  };
  pw.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  return m.open();
}

/** Vùng thông báo ngắn của trang (aria-live polite); tự ẩn sau vài giây. */
export class Toaster {
  readonly el: HTMLElement;
  #timer: ReturnType<typeof setTimeout> | null = null;
  constructor() {
    this.el = h('div', { class: 'ad-toast', attrs: { role: 'status', 'aria-live': 'polite' } });
  }
  show(text: string, tone: 'ok' | 'bad' = 'ok'): void {
    this.el.textContent = text;
    this.el.dataset.tone = tone;
    this.el.classList.add('show');
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.el.classList.remove('show'), 5000);
  }
}

/** Nhóm nút bật/tắt (chip, aria-pressed) cho chọn nhiều người nhận hoặc nhóm. */
export function toggleChips(
  label: string,
  options: readonly { id: string; label: string; hue: number; cat?: string }[],
  selected: ReadonlySet<string>,
  onChange: (id: string, on: boolean) => void,
  groupBy?: (cat: string) => string,
): HTMLElement {
  const wrap = h('div', { class: 'ad-togglechips', attrs: { role: 'group', 'aria-label': label } });
  let lastCat: string | undefined;
  for (const o of options) {
    if (groupBy && o.cat !== lastCat) {
      lastCat = o.cat;
      wrap.append(
        h('span', {
          class: 'ad-togglecat',
          text: groupBy(o.cat ?? ''),
          attrs: { 'aria-hidden': 'true' },
        }),
      );
    }
    const on = selected.has(o.id);
    const b = h('button', {
      type: 'button',
      class: `ad-chip toggle hue-${o.hue}`,
      text: o.label,
      attrs: { 'aria-pressed': String(on), 'data-grantee': o.id },
      on: {
        click: () => {
          const now = b.getAttribute('aria-pressed') !== 'true';
          b.setAttribute('aria-pressed', String(now));
          onChange(o.id, now);
        },
      },
    });
    wrap.append(b);
  }
  return wrap;
}
