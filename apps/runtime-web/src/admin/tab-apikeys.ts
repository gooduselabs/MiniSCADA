// Tab "API key" (feature 025, specs/025-data-api US1, FR-007): bảng key (tên, quyền, nguồn cho phép, hạn, lần dùng
// cuối, số gọi), tạo key (token hiện đúng một lần, có nút sao chép), sửa quyền/nguồn/hạn/giới hạn, thu hồi (xác nhận).
// Key ghi được Tag cần xác nhận lại mật khẩu (máy chủ trả REAUTH_REQUIRED nếu thiếu). Hướng dẫn gọi API ở đầu tab.
// Máy chủ kiểm lại mọi thứ (rev, CSRF, administrator). Mọi chữ qua textContent; token không giữ sau khi đóng hộp.
import { viAdmin } from '../i18n/vi-admin.ts';
import type { AdminCtx, AdminTab } from './admin-page.ts';
import type { ApiKeyInfo, ApiKeyList, ApiKeySettings } from './api.ts';
import {
  type ApiKeyDraft,
  type DraftProblem,
  RATE_MAX,
  RATE_MIN,
  curlExample,
  dateFromExpiry,
  draftProblem,
  emptyDraft,
  expiryFromDate,
  needsReauth,
  splitAllowFrom,
} from './apikeys-model.ts';
import { fmtTime } from './model.ts';
import {
  Modal,
  button,
  chip,
  field,
  groupHue,
  h,
  input,
  pill,
  reauthDialog,
  roleBadge,
} from './ui.ts';

const K = viAdmin.apikeys;

function problemText(p: DraftProblem): string {
  switch (p.field) {
    case 'name':
      return K.bad.name;
    case 'allowFrom':
      return K.bad.allowFrom(p.value);
    case 'allowFromCount':
      return K.bad.allowFromCount;
    case 'rate':
      return K.bad.rate;
    case 'expires':
      return K.bad.expires;
  }
}

export class ApiKeysTab implements AdminTab {
  readonly el: HTMLElement;
  readonly #c: AdminCtx;
  #list: ApiKeyList | null = null;
  readonly #body: HTMLElement;
  readonly #count: HTMLElement;
  readonly #store: HTMLElement;

  constructor(c: AdminCtx) {
    this.#c = c;
    const add = button(K.add, () => this.#edit(null), { kind: 'primary', icon: 'lock' });
    add.setAttribute('data-add-apikey', '');
    this.#count = h('span', { class: 'ad-count', attrs: { role: 'status' } });
    this.#store = h('p', { class: 'ad-error', attrs: { role: 'alert' }, hidden: true });
    const C = K.cols;
    const table = h(
      'table',
      { class: 'ad-table', attrs: { 'data-apikeys': '' } },
      h('caption', { class: 'sr-only', text: viAdmin.tabs['api-key'] ?? 'API key' }),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...[C.name, C.rights, C.sources, C.expires, C.used, C.calls, C.actions].map((t) =>
            h('th', { text: t, attrs: { scope: 'col' } }),
          ),
        ),
      ),
    );
    this.#body = h('tbody');
    table.append(this.#body);
    const origin = typeof location !== 'undefined' ? location.origin : 'https://192.0.2.10:8443';
    const help = h(
      'section',
      { class: 'ad-email-card ad-apikey-help', attrs: { 'aria-labelledby': 'ad-apikey-help' } },
      h('h3', { id: 'ad-apikey-help', text: K.exampleTitle }),
      h('pre', { class: 'ad-mono ad-code' }, h('code', { text: curlExample(origin) })),
      h('p', { class: 'ad-hint', text: K.docs }),
    );
    this.el = h(
      'div',
      { class: 'ad-tabbody ad-apikeys' },
      h('p', { class: 'ad-hint', text: K.intro }),
      this.#store,
      h('div', { class: 'ad-toolbar' }, this.#count, h('span', { class: 'grow' }), add),
      h('div', { class: 'ad-tablewrap' }, table),
      h('p', { class: 'ad-hint', text: K.usageNote }),
      help,
    );
  }

  render(): void {
    void this.#load();
  }

  async #load(): Promise<void> {
    try {
      this.#list = await this.#c.api.apiKeys();
      this.#draw();
    } catch (e) {
      this.#c.fail(e);
    }
  }

  #draw(): void {
    const l = this.#list;
    if (!l) return;
    this.#count.textContent = K.count(l.keys.length, 32);
    this.#store.hidden = l.storeOk;
    this.#store.textContent = l.storeOk ? '' : K.storeBroken(l.storeError ?? '');
    if (!l.keys.length) {
      this.#body.replaceChildren(
        h('tr', {}, h('td', { class: 'ad-empty', text: K.empty, attrs: { colspan: '7' } })),
      );
      return;
    }
    const ids = l.groups.map((g) => g.id);
    const groupName = new Map(l.groups.map((g) => [g.id, g.name]));
    this.#body.replaceChildren(
      ...l.keys.map((k) => {
        const rights = h(
          'td',
          {},
          roleBadge(k.role),
          ' ',
          k.canWrite ? pill(K.canWrite, 'warn') : pill(K.readOnlyPill, 'info'),
        );
        if (k.groups.length) {
          const chips = h('div', { class: 'ad-chips' });
          for (const g of k.groups) chips.append(chip(groupName.get(g) ?? g, groupHue(ids, g)));
          rights.append(chips);
        }
        const expires = k.expired
          ? pill(K.expired, 'bad')
          : k.expiresAt
            ? h('span', { text: fmtTime(Date.parse(k.expiresAt)) })
            : h('span', { class: 'muted', text: K.noExpiry });
        const used = k.lastUsedAt
          ? h(
              'span',
              {},
              h('span', { text: fmtTime(Date.parse(k.lastUsedAt)) }),
              k.lastFrom ? h('span', { class: 'muted', text: ` · ${k.lastFrom}` }) : null,
            )
          : h('span', { class: 'muted', text: K.never });
        const edit = button(K.edit, () => this.#edit(k), {
          kind: 'subtle',
          small: true,
          aria: `${K.edit} ${k.name}`,
        });
        edit.setAttribute('data-edit-apikey', k.id);
        const revoke = button(K.revoke, () => this.#revoke(k), {
          kind: 'danger',
          small: true,
          aria: `${K.revoke} ${k.name}`,
        });
        revoke.setAttribute('data-revoke-apikey', k.id);
        return h(
          'tr',
          { attrs: { 'data-apikey': k.id } },
          h(
            'th',
            { attrs: { scope: 'row' } },
            h('span', { text: k.name }),
            h('code', { class: 'ad-mono muted', text: ` ${k.prefix}…` }),
          ),
          rights,
          h('td', {
            text: k.allowFrom.length ? k.allowFrom.join(', ') : K.anySource,
          }),
          h('td', {}, expires),
          h('td', {}, used),
          h('td', { text: K.callsSince(k.calls, k.denied) }),
          h('td', { class: 'ad-actions' }, edit, revoke),
        );
      }),
    );
  }

  // ---- tạo / sửa

  #edit(k: ApiKeyInfo | null): void {
    const l = this.#list;
    if (!l) return;
    const d: ApiKeyDraft = k
      ? {
          name: k.name,
          role: k.role,
          readOnly: k.readOnly,
          groups: [...k.groups],
          allowFrom: [...k.allowFrom],
          expiresAt: k.expiresAt,
          ratePerMin: k.ratePerMin,
        }
      : emptyDraft();
    const m = new Modal(this.#c.modalRoot, k ? K.editTitle(k.name) : K.createTitle, { wide: true });
    const name = input('text', { maxlength: '64', autocomplete: 'off', 'data-apikey-name': '' });
    name.value = d.name;
    const role = h('select', { attrs: { 'data-apikey-role': '' } });
    for (const r of ['viewer', 'operator'])
      role.append(h('option', { text: K.roleNames[r] ?? r, attrs: { value: r } }));
    role.value = d.role;
    const ro = input('checkbox', { 'data-apikey-readonly': '' });
    ro.checked = d.readOnly;
    const syncRo = () => {
      ro.disabled = role.value === 'viewer';
      if (role.value === 'viewer') ro.checked = true;
    };
    role.addEventListener('change', syncRo);
    syncRo();
    const groups = h('div', {
      class: 'ad-togglechips',
      attrs: { role: 'group', 'aria-label': K.groups },
    });
    const ids = l.groups.map((g) => g.id);
    const chosen = new Set(d.groups);
    for (const g of l.groups) {
      const b = h('button', {
        type: 'button',
        class: `ad-chip toggle hue-${groupHue(ids, g.id)}`,
        text: g.name,
        attrs: { 'aria-pressed': String(chosen.has(g.id)), 'data-apikey-group': g.id },
        on: {
          click: () => {
            const on = b.getAttribute('aria-pressed') !== 'true';
            b.setAttribute('aria-pressed', String(on));
            if (on) chosen.add(g.id);
            else chosen.delete(g.id);
          },
        },
      });
      groups.append(b);
    }
    if (!l.groups.length) groups.append(h('span', { class: 'muted', text: K.noGroups }));
    const allow = input('text', {
      autocomplete: 'off',
      spellcheck: 'false',
      'data-apikey-allow': '',
    });
    allow.value = d.allowFrom.join(', ');
    const expires = input('date', { 'data-apikey-expires': '' });
    expires.value = dateFromExpiry(d.expiresAt);
    const rate = input('number', {
      min: String(RATE_MIN),
      max: String(RATE_MAX),
      step: '1',
      'data-apikey-rate': '',
    });
    rate.value = String(d.ratePerMin);
    const groupsLabel = h('p', { class: 'ad-field-label', text: K.groups });
    m.body.append(
      field(K.name, name, K.nameHint),
      field(K.role, role),
      h('label', { class: 'ad-check' }, ro, h('span', { text: K.readOnly })),
      groupsLabel,
      groups,
      field(K.allowFrom, allow, K.allowFromHint),
      field(K.expires, expires, K.expiresHint),
      field(K.rate, rate),
    );
    const collect = (): ApiKeyDraft => ({
      name: name.value.trim(),
      role: role.value === 'operator' ? 'operator' : 'viewer',
      readOnly: role.value === 'viewer' || ro.checked,
      groups: l.groups.map((g) => g.id).filter((g) => chosen.has(g)),
      allowFrom: splitAllowFrom(allow.value),
      // a date kept as it was keeps the exact expiry of the key (no change of a few hours)
      expiresAt:
        k && expires.value === dateFromExpiry(k.expiresAt)
          ? k.expiresAt
          : expiryFromDate(expires.value),
      ratePerMin: Math.round(Number(rate.value)),
    });
    const ok = button(k ? K.save : K.create, () => submit(), { kind: 'primary' });
    ok.setAttribute('data-apikey-save', '');
    m.footer.append(
      button(viAdmin.cancel, () => m.close(), { kind: 'subtle' }),
      ok,
    );
    let busy = false;
    const submit = () => {
      if (busy) return;
      const next = collect();
      const p = draftProblem(next, Date.now());
      if (p) {
        m.showError(problemText(p));
        if (p.field === 'name') name.focus();
        else if (p.field === 'rate') rate.focus();
        else if (p.field === 'expires') expires.focus();
        else allow.focus();
        return;
      }
      m.showError(null);
      const body: ApiKeySettings = {
        name: next.name,
        role: next.role,
        readOnly: next.readOnly,
        groups: next.groups,
        allowFrom: next.allowFrom,
        expiresAt: next.expiresAt,
        ratePerMin: next.ratePerMin,
      };
      const send = async (reauth?: string) => {
        const extra = reauth ? { reauth } : {};
        if (k) {
          await this.#c.api.updateApiKey(k.id, { ...body, ...extra, rev: l.rev });
          this.#c.toast(K.updated(next.name));
        } else {
          const r = await this.#c.api.createApiKey({
            ...body,
            ...extra,
            name: next.name,
            rev: l.rev,
          });
          this.#showToken(next.name, r.token);
        }
        await this.#load();
      };
      if (needsReauth(next, k ?? undefined)) {
        m.close();
        reauthDialog(this.#c.modalRoot, {
          title: viAdmin.reauth.title,
          body: K.writeReauth,
          confirm: k ? K.save : K.create,
          run: (secret) => send(secret),
          onError: (e) => this.#c.fail(e),
        });
        return;
      }
      busy = true;
      ok.disabled = true;
      send().then(
        () => m.close(),
        (e: unknown) => {
          busy = false;
          ok.disabled = false;
          m.close();
          this.#c.fail(e);
        },
      );
    };
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    m.open();
  }

  /** Token của key vừa tạo: hiện một lần, sao chép, rồi bỏ khi đóng hộp. */
  #showToken(keyName: string, token: string): void {
    const m = new Modal(this.#c.modalRoot, K.tokenTitle, { wide: true });
    const t = input('text', { readonly: '', 'data-apikey-token': '', spellcheck: 'false' });
    t.value = token;
    t.className = 'ad-mono ad-token';
    const status = h('p', { class: 'ad-hint', attrs: { role: 'status', 'aria-live': 'polite' } });
    const copy = button(
      K.copy,
      () => {
        t.select();
        const done = () => (status.textContent = K.copied);
        const fail = () => (status.textContent = K.copyFail);
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(token).then(done, fail);
        else fail();
      },
      { kind: 'subtle' },
    );
    copy.setAttribute('data-apikey-copy', '');
    m.body.append(
      h('p', { class: 'ad-lead', text: K.tokenBody }),
      field(K.tokenLabel, t),
      copy,
      status,
    );
    const done = button(K.done, () => m.close(), { kind: 'primary' });
    done.setAttribute('data-apikey-done', '');
    m.footer.append(done);
    m.open(() => {
      t.value = '';
    });
    t.focus();
    t.select();
    this.#c.toast(K.created(keyName));
  }

  #revoke(k: ApiKeyInfo): void {
    const l = this.#list;
    if (!l) return;
    const m = new Modal(this.#c.modalRoot, K.revokeTitle(k.name), { danger: true });
    m.body.append(h('p', { class: 'ad-lead', text: K.revokeBody }));
    const ok = button(K.revoke, () => go(), { kind: 'danger' });
    ok.setAttribute('data-confirm', '');
    m.footer.append(
      button(viAdmin.cancel, () => m.close(), { kind: 'subtle' }),
      ok,
    );
    const go = () => {
      ok.disabled = true;
      this.#c.api.revokeApiKey(k.id, l.rev).then(
        async () => {
          m.close();
          this.#c.toast(K.revoked(k.name));
          await this.#load();
        },
        (e: unknown) => {
          m.close();
          this.#c.fail(e);
        },
      );
    };
    m.open();
  }
}
