// Tab Người dùng (feature 013, US2; admin-api §2): bảng (tên, vai trò, nhóm dạng chip, trạng thái, khóa tạm, đăng nhập
// cuối, số phiên), tìm kiếm và lọc vai trò, thêm người dùng (mật khẩu sinh ngẫu nhiên hiện một lần, có nút chép), sửa
// vai trò/nhóm/trạng thái, mở khóa, đặt lại mật khẩu, xóa. Hạ vai trò, tắt, đặt lại mật khẩu, xóa: xác nhận lại bằng
// mật khẩu của admin. Máy chủ chặn LAST_ADMIN, WEAK_PASSWORD, CONFLICT…: trang hiện lỗi rõ.
import { PW_MAX, PW_MIN, passwordHint } from '../password-dialog.ts';
import { viAdmin } from '../i18n/vi-admin.ts';
import type { AdminCtx, AdminTab } from './admin-page.ts';
import { ROLES, type AdminUser, type Role } from './api.ts';
import { USER_NAME, fmtTime, relativeTime, userEditPlan } from './model.ts';
import {
  Modal,
  button,
  chip,
  errorText,
  field,
  groupHue,
  h,
  input,
  pill,
  reauthDialog,
  roleBadge,
  toggleChips,
} from './ui.ts';

const T = viAdmin.users;
const F = viAdmin.userForm;
const len = (s: string) => [...s.normalize('NFC')].length;

/** Ô mật khẩu mới + nhập lại + chỉ báo độ dài 15–128. */
function passwordFields(): { el: HTMLElement; value(): string | null; error(): string | null } {
  const p1 = input('password', { autocomplete: 'new-password', maxlength: '256' });
  const p2 = input('password', { autocomplete: 'new-password', maxlength: '256' });
  const meter = h('span', { class: 'ad-meter-text', attrs: { 'aria-live': 'polite' } });
  const bar = h('span', { class: 'ad-meter-bar' }, h('span', {}));
  const sync = () => {
    const n = len(p1.value);
    const hint = passwordHint(n);
    meter.textContent = n ? `${n} / ${PW_MAX} · ${hint.text}` : `0 / ${PW_MAX}`;
    bar.dataset.state = n === 0 ? 'empty' : hint.ok ? 'ok' : 'short';
    (bar.firstElementChild as HTMLElement).style.width = `${Math.min(100, (n / PW_MIN) * 100)}%`;
  };
  p1.addEventListener('input', sync);
  sync();
  const el = h(
    'div',
    { class: 'ad-pwfields' },
    field(F.pw, p1),
    h('div', { class: 'ad-meter', attrs: { 'aria-hidden': 'true' } }, bar),
    meter,
    field(F.pw2, p2),
  );
  return {
    el,
    value: () => p1.value,
    error: () => {
      const hint = passwordHint(len(p1.value));
      if (!hint.ok) return hint.text;
      if (p1.value !== p2.value) return F.pwMismatch;
      return null;
    },
  };
}

/** Hộp hiện mật khẩu một lần, có nút chép. */
export function oneTimePassword(root: HTMLElement, user: string, password: string): Modal {
  const m = new Modal(root, viAdmin.oneTime.title(user));
  const code = h('code', { class: 'ad-otp', text: password, attrs: { 'data-otp': '' } });
  const status = h('p', { class: 'ad-hint', attrs: { role: 'status' } });
  const copy = button(
    viAdmin.oneTime.copy,
    () => {
      const ok = () => (status.textContent = viAdmin.oneTime.copied);
      const fail = () => {
        status.textContent = viAdmin.oneTime.copyFail;
        const r = document.createRange();
        r.selectNodeContents(code);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(password).then(ok, fail);
      else fail();
    },
    { kind: 'primary', icon: 'doc' },
  );
  copy.setAttribute('data-copy', '');
  m.body.append(
    h('p', { class: 'ad-lead', text: viAdmin.oneTime.body }),
    h('div', { class: 'ad-otp-row' }, code, copy),
    status,
  );
  m.footer.append(button(viAdmin.oneTime.done, () => m.close(), { kind: 'subtle' }));
  m.open();
  copy.focus();
  return m;
}

export class UsersTab implements AdminTab {
  readonly el: HTMLElement;
  readonly #c: AdminCtx;
  readonly #search: HTMLInputElement;
  readonly #role: HTMLSelectElement;
  readonly #count: HTMLElement;
  readonly #body: HTMLElement;

  constructor(c: AdminCtx) {
    this.#c = c;
    this.#search = input('search', { placeholder: T.searchPlaceholder, 'aria-label': T.search });
    this.#search.className = 'ad-search';
    this.#search.addEventListener('input', () => this.#renderRows());
    this.#role = h('select', { attrs: { 'aria-label': T.roleFilter } });
    this.#role.append(h('option', { text: T.allRoles, attrs: { value: '' } }));
    for (const r of ROLES)
      this.#role.append(h('option', { text: viAdmin.roleName(r), attrs: { value: r } }));
    this.#role.addEventListener('change', () => this.#renderRows());
    this.#count = h('span', { class: 'ad-count', attrs: { role: 'status' } });
    const add = button(T.add, () => this.#add(), { kind: 'primary', icon: 'user' });
    add.setAttribute('data-add-user', '');
    const C = T.col;
    const table = h(
      'table',
      { class: 'ad-table' },
      h('caption', { class: 'sr-only', text: T.caption }),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...[C.name, C.role, C.groups, C.status, C.locked, C.lastLogin, C.sessions, C.actions].map(
            (t) => h('th', { text: t, attrs: { scope: 'col' } }),
          ),
        ),
      ),
    );
    this.#body = h('tbody');
    table.append(this.#body);
    this.el = h(
      'div',
      { class: 'ad-tabbody' },
      h(
        'div',
        { class: 'ad-toolbar' },
        this.#search,
        this.#role,
        this.#count,
        h('span', { class: 'grow' }),
        add,
      ),
      h('div', { class: 'ad-tablewrap' }, table),
    );
  }

  render(params: URLSearchParams): void {
    const q = params.get('q');
    if (q !== null) this.#search.value = q;
    this.#renderRows();
  }

  #renderRows(): void {
    const d = this.#c.data;
    const q = this.#search.value.trim().toLowerCase();
    const role = this.#role.value;
    const groupName = new Map(d.groups.map((g) => [g.id, g.name]));
    const ids = d.groups.map((g) => g.id);
    const list = d.users.filter(
      (u) =>
        (!role || u.role === role) &&
        (!q ||
          u.name.includes(q) ||
          u.groups.some((g) => (groupName.get(g) ?? g).toLowerCase().includes(q))),
    );
    this.#count.textContent = T.count(list.length, d.users.length);
    const now = Date.now();
    if (!list.length) {
      this.#body.replaceChildren(
        h('tr', {}, h('td', { class: 'ad-empty', text: T.empty, attrs: { colspan: '8' } })),
      );
      return;
    }
    this.#body.replaceChildren(
      ...list.map((u, i) => {
        const locked = u.locked && u.locked.until > now ? u.locked : null;
        const nameCell = h(
          'td',
          { class: 'ad-namecell' },
          h('span', {
            class: `ad-avatar hue-${i % 12}`,
            text: u.name.slice(0, 1).toUpperCase(),
            attrs: { 'aria-hidden': 'true' },
          }),
          h('span', { class: 'ad-name', text: u.name }),
          u.name === this.#c.me ? h('span', { class: 'ad-you', text: `(${viAdmin.you})` }) : null,
        );
        const groups = h('td', { class: 'ad-chips' });
        if (u.groups.length)
          for (const g of u.groups) groups.append(chip(groupName.get(g) ?? g, groupHue(ids, g)));
        else groups.append(h('span', { class: 'muted', text: T.noGroup }));
        const lockCell = h('td');
        if (locked) {
          lockCell.append(
            pill(T.lockedUntil(fmtTime(locked.until)), 'warn'),
            button(T.unlock, () => void this.#unlock(u), {
              small: true,
              aria: T.unlockLabel(u.name),
              kind: 'subtle',
            }),
          );
        } else lockCell.append(h('span', { class: 'muted', text: viAdmin.none }));
        const last = h('td', {
          text: relativeTime(u.lastLoginAt, now),
          ...(u.lastLoginAt ? { title: fmtTime(u.lastLoginAt) } : {}),
        });
        const edit = button(T.edit, () => this.#edit(u), {
          small: true,
          aria: T.editLabel(u.name),
          icon: 'gear',
        });
        edit.setAttribute('data-edit', u.name);
        return h(
          'tr',
          { attrs: { 'data-user': u.name } },
          nameCell,
          h('td', {}, roleBadge(u.role)),
          groups,
          h('td', {}, pill(u.enabled ? T.enabled : T.disabled, u.enabled ? 'ok' : 'off')),
          lockCell,
          last,
          h('td', {
            class: 'num',
            text: String(u.sessions),
            attrs: { 'aria-label': T.sessionsLabel(u.sessions) },
          }),
          h('td', {}, edit),
        );
      }),
    );
  }

  async #unlock(u: AdminUser): Promise<void> {
    try {
      await this.#c.api.updateUser(u.name, { rev: this.#c.data.usersRev, unlock: true });
      this.#c.toast(viAdmin.done.unlocked(u.name));
      await this.#c.reload('users');
    } catch (e) {
      this.#c.fail(e);
    }
  }

  #roleSelect(value: Role): HTMLSelectElement {
    const s = h('select');
    for (const r of ROLES) {
      const o = h('option', { text: viAdmin.roleName(r), attrs: { value: r } });
      if (r === value) o.selected = true;
      s.append(o);
    }
    return s;
  }

  #groupPicker(selected: Set<string>): HTMLElement {
    const d = this.#c.data;
    if (!d.groups.length) return h('p', { class: 'ad-hint', text: F.noGroups });
    const ids = d.groups.map((g) => g.id);
    return toggleChips(
      F.groups,
      d.groups.map((g) => ({ id: g.id, label: g.name, hue: groupHue(ids, g.id) })),
      selected,
      (id, on) => {
        if (on) selected.add(id);
        else selected.delete(id);
      },
    );
  }

  #add(): void {
    const c = this.#c;
    const m = new Modal(c.modalRoot, F.addTitle, { wide: true });
    const name = input('text', {
      autocomplete: 'off',
      spellcheck: 'false',
      maxlength: '32',
      autocapitalize: 'none',
    });
    const role = this.#roleSelect('operator');
    const groups = new Set<string>();
    const gen = input('radio', { name: 'ad-pwmode', value: 'gen' });
    gen.checked = true;
    const own = input('radio', { name: 'ad-pwmode', value: 'own' });
    const pw = passwordFields();
    pw.el.hidden = true;
    const sync = () => (pw.el.hidden = !own.checked);
    gen.addEventListener('change', sync);
    own.addEventListener('change', sync);
    m.body.append(
      field(F.name, name, F.nameHint),
      field(F.role, role),
      h(
        'div',
        { class: 'ad-field' },
        h('span', { class: 'ad-label', text: F.groups }),
        this.#groupPicker(groups),
      ),
      h(
        'fieldset',
        { class: 'ad-fieldset' },
        h('legend', { text: F.password }),
        h('label', { class: 'ad-radio' }, gen, h('span', { text: F.genOption })),
        h('label', { class: 'ad-radio' }, own, h('span', { text: F.ownOption })),
        pw.el,
      ),
    );
    let busy = false;
    const submit = async () => {
      if (busy) return;
      const n = name.value.trim();
      if (!USER_NAME.test(n)) {
        m.showError(F.nameBad);
        name.focus();
        return;
      }
      if (own.checked) {
        const err = pw.error();
        if (err) {
          m.showError(err);
          return;
        }
      }
      busy = true;
      ok.disabled = true;
      m.showError(null);
      try {
        const r = await c.api.createUser({
          rev: c.data.usersRev,
          name: n,
          role: role.value as Role,
          groups: [...groups],
          ...(own.checked ? { password: pw.value() ?? '' } : { generate: true as const }),
        });
        m.close();
        c.toast(viAdmin.done.created(n));
        await c.reload('users', 'groups');
        if (r.password) oneTimePassword(c.modalRoot, n, r.password);
      } catch (e) {
        busy = false;
        ok.disabled = false;
        const code = (e as { code?: string }).code;
        if (
          code === 'EXISTS' ||
          code === 'WEAK_PASSWORD' ||
          code === 'BAD_REQUEST' ||
          code === 'NOT_FOUND'
        ) {
          m.showError(errorText(e));
          return;
        }
        m.close();
        c.fail(e);
      }
    };
    const ok = button(F.create, () => void submit(), { kind: 'primary' });
    ok.setAttribute('data-confirm', '');
    m.footer.append(
      button(viAdmin.cancel, () => m.close(), { kind: 'subtle' }),
      ok,
    );
    m.open();
    name.focus();
  }

  #edit(u: AdminUser): void {
    const c = this.#c;
    const m = new Modal(c.modalRoot, F.editTitle(u.name), { wide: true });
    const role = this.#roleSelect(u.role);
    const groups = new Set(u.groups);
    const enabled = input('checkbox');
    enabled.checked = u.enabled;
    const self = u.name === c.me;
    m.body.append(
      h(
        'div',
        { class: 'ad-userhead' },
        roleBadge(u.role),
        pill(u.enabled ? T.enabled : T.disabled, u.enabled ? 'ok' : 'off'),
        h('span', { class: 'muted', text: T.sessionsLabel(u.sessions) }),
      ),
      field(F.role, role),
      h(
        'div',
        { class: 'ad-field' },
        h('span', { class: 'ad-label', text: F.groups }),
        this.#groupPicker(groups),
      ),
      h('label', { class: 'ad-check' }, enabled, h('span', { text: F.enabled })),
      h('p', { class: 'ad-hint', text: self ? F.selfNote : F.sessionsNote }),
    );
    const more = h(
      'div',
      { class: 'ad-more' },
      h('h3', { text: F.more }),
      h(
        'div',
        { class: 'ad-more-actions' },
        u.locked && u.locked.until > Date.now()
          ? button(
              T.unlock,
              () => {
                m.close();
                void this.#unlock(u);
              },
              { kind: 'subtle' },
            )
          : null,
        button(
          F.resetPw,
          () => {
            m.close();
            this.#resetPassword(u);
          },
          { kind: 'subtle', icon: 'lock' },
        ),
        button(
          F.delete,
          () => {
            m.close();
            this.#delete(u);
          },
          { kind: 'danger', icon: 'close' },
        ),
      ),
    );
    m.body.append(more);
    const save = async () => {
      const plan = userEditPlan(u, {
        role: role.value as Role,
        groups: [...groups],
        enabled: enabled.checked,
      });
      if (plan.empty) {
        m.showError(F.noChange);
        return;
      }
      const send = async (reauth?: string) => {
        const r = await c.api.updateUser(u.name, {
          rev: c.data.usersRev,
          ...plan.body,
          ...(reauth ? { reauth } : {}),
        });
        c.toast(viAdmin.done.updated(u.name));
        if (r.signedOut) return c.signedOut();
        await c.reload('users', 'groups');
      };
      if (plan.reauth) {
        m.close();
        reauthDialog(c.modalRoot, {
          title: viAdmin.disableUser.title(u.name),
          body: F.demoteReauth,
          confirm: F.saveEdit,
          danger: true,
          run: send,
          onError: (e) => c.fail(e),
        });
        return;
      }
      try {
        ok.disabled = true;
        await send();
        m.close();
      } catch (e) {
        ok.disabled = false;
        m.close();
        c.fail(e);
      }
    };
    const ok = button(F.saveEdit, () => void save(), { kind: 'primary' });
    ok.setAttribute('data-confirm', '');
    m.footer.append(
      button(viAdmin.cancel, () => m.close(), { kind: 'subtle' }),
      ok,
    );
    m.open();
    role.focus();
  }

  #resetPassword(u: AdminUser): void {
    const c = this.#c;
    const gen = input('radio', { name: 'ad-rpmode', value: 'gen' });
    gen.checked = true;
    const own = input('radio', { name: 'ad-rpmode', value: 'own' });
    const pw = passwordFields();
    pw.el.hidden = true;
    const sync = () => (pw.el.hidden = !own.checked);
    gen.addEventListener('change', sync);
    own.addEventListener('change', sync);
    const extra = h(
      'fieldset',
      { class: 'ad-fieldset' },
      h('legend', { text: F.password }),
      h('label', { class: 'ad-radio' }, gen, h('span', { text: F.genOption })),
      h('label', { class: 'ad-radio' }, own, h('span', { text: F.ownOption })),
      pw.el,
    );
    reauthDialog(c.modalRoot, {
      title: viAdmin.resetPw.title(u.name),
      body: viAdmin.resetPw.body,
      confirm: viAdmin.resetPw.submit,
      danger: true,
      extra,
      run: async (reauth) => {
        if (own.checked) {
          const err = pw.error();
          if (err) throw Object.assign(new Error(err), { localMessage: err });
        }
        const r = await c.api.resetPassword(u.name, {
          rev: c.data.usersRev,
          reauth,
          ...(own.checked ? { password: pw.value() ?? '' } : { generate: true as const }),
        });
        c.toast(viAdmin.done.password(u.name));
        if (r.signedOut) return c.signedOut();
        await c.reload('users');
        if (r.password) oneTimePassword(c.modalRoot, u.name, r.password);
      },
      onError: (e) => {
        const local = (e as { localMessage?: string }).localMessage;
        if (local) c.toast(local, 'bad');
        else c.fail(e);
      },
    });
  }

  #delete(u: AdminUser): void {
    const c = this.#c;
    reauthDialog(c.modalRoot, {
      title: viAdmin.deleteUser.title(u.name),
      body: viAdmin.deleteUser.body,
      confirm: viAdmin.deleteUser.submit,
      danger: true,
      run: async (reauth) => {
        await c.api.deleteUser(u.name, { rev: c.data.usersRev, reauth });
        c.toast(viAdmin.done.deleted(u.name));
        if (u.name === c.me) return c.signedOut();
        await c.reload();
      },
      onError: (e) => c.fail(e),
    });
  }
}
