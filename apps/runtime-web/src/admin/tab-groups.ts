// Tab Nhóm (feature 013, US2 AC6; admin-api §3): thẻ cho mỗi nhóm (tên, mã, thành viên dạng chip, số quy tắc), tạo
// (mã gợi ý từ tên), đổi tên, xóa (xác nhận lại). `409 IN_USE`: hộp liệt kê thành viên và quy tắc đang dùng nhóm.
import { viAdmin } from '../i18n/vi-admin.ts';
import type { AdminCtx, AdminTab } from './admin-page.ts';
import { AdminApiError, type AdminGroup } from './api.ts';
import { GROUP_ID, resourceTitle, slugify } from './model.ts';
import { Modal, button, chip, errorText, field, groupHue, h, input, reauthDialog } from './ui.ts';

const G = viAdmin.groups;
const GF = viAdmin.groupForm;

export class GroupsTab implements AdminTab {
  readonly el: HTMLElement;
  readonly #c: AdminCtx;
  readonly #list: HTMLElement;

  constructor(c: AdminCtx) {
    this.#c = c;
    const add = button(G.add, () => this.#create(), { kind: 'primary', icon: 'list' });
    add.setAttribute('data-add-group', '');
    this.#list = h('ul', { class: 'ad-cards', attrs: { 'aria-label': G.listLabel } });
    this.el = h(
      'div',
      { class: 'ad-tabbody' },
      h('div', { class: 'ad-toolbar' }, h('span', { class: 'grow' }), add),
      this.#list,
    );
  }

  render(): void {
    const d = this.#c.data;
    const ids = d.groups.map((g) => g.id);
    if (!d.groups.length) {
      this.#list.replaceChildren(h('li', { class: 'ad-empty', text: G.empty }));
      return;
    }
    this.#list.replaceChildren(
      ...d.groups.map((g) => {
        const hue = groupHue(ids, g.id);
        const members = h('div', { class: 'ad-chips' });
        if (g.members.length) for (const m of g.members) members.append(chip(m, 0, 'plain'));
        else members.append(h('span', { class: 'muted', text: G.noMembers }));
        return h(
          'li',
          { class: `ad-card hue-${hue}`, attrs: { 'data-group': g.id } },
          h(
            'div',
            { class: 'ad-card-head' },
            h('span', { class: `ad-card-dot hue-${hue}`, attrs: { 'aria-hidden': 'true' } }),
            h('h3', { text: g.name }),
            h('code', { class: 'ad-mono', text: g.id }),
          ),
          h(
            'p',
            { class: 'ad-card-meta' },
            h('span', { text: G.members(g.members.length) }),
            h('span', { text: '·', attrs: { 'aria-hidden': 'true' } }),
            h('span', { text: G.rules(g.rules) }),
          ),
          members,
          h(
            'div',
            { class: 'ad-card-actions' },
            button(G.rename, () => this.#rename(g), {
              small: true,
              kind: 'subtle',
              aria: G.renameLabel(g.name),
            }),
            button(G.delete, () => this.#delete(g), {
              small: true,
              kind: 'danger',
              aria: G.deleteLabel(g.name),
            }),
          ),
        );
      }),
    );
  }

  #create(): void {
    const c = this.#c;
    const m = new Modal(c.modalRoot, GF.addTitle);
    const name = input('text', { maxlength: '64', autocomplete: 'off' });
    const id = input('text', { maxlength: '32', autocomplete: 'off', spellcheck: 'false' });
    let touched = false;
    name.addEventListener('input', () => {
      if (!touched) id.value = slugify(name.value);
    });
    id.addEventListener('input', () => (touched = true));
    m.body.append(field(GF.name, name), field(GF.id, id, GF.idHint));
    const ok = button(GF.create, () => void submit(), { kind: 'primary' });
    ok.setAttribute('data-confirm', '');
    const submit = async () => {
      const n = name.value.trim();
      if (!n || n.length > 64) return m.showError(GF.nameBad);
      if (!GROUP_ID.test(id.value)) return m.showError(GF.idBad);
      ok.disabled = true;
      try {
        await c.api.createGroup({ rev: c.data.accessRev, id: id.value, name: n });
        m.close();
        c.toast(viAdmin.done.groupCreated(n));
        await c.reload('groups', 'access');
      } catch (e) {
        ok.disabled = false;
        if (e instanceof AdminApiError && (e.code === 'EXISTS' || e.code === 'BAD_REQUEST'))
          return m.showError(errorText(e));
        m.close();
        c.fail(e);
      }
    };
    m.footer.append(
      button(viAdmin.cancel, () => m.close(), { kind: 'subtle' }),
      ok,
    );
    m.open();
  }

  #rename(g: AdminGroup): void {
    const c = this.#c;
    const m = new Modal(c.modalRoot, GF.renameTitle(g.name));
    const name = input('text', { maxlength: '64', autocomplete: 'off' });
    name.value = g.name;
    m.body.append(field(GF.name, name));
    const ok = button(viAdmin.save, () => void submit(), { kind: 'primary' });
    ok.setAttribute('data-confirm', '');
    const submit = async () => {
      const n = name.value.trim();
      if (!n || n.length > 64) return m.showError(GF.nameBad);
      ok.disabled = true;
      try {
        await c.api.renameGroup(g.id, { rev: c.data.accessRev, name: n });
        m.close();
        c.toast(viAdmin.done.groupRenamed(n));
        await c.reload('groups', 'access');
      } catch (e) {
        m.close();
        c.fail(e);
      }
    };
    m.footer.append(
      button(viAdmin.cancel, () => m.close(), { kind: 'subtle' }),
      ok,
    );
    m.open();
    name.select();
  }

  #delete(g: AdminGroup): void {
    const c = this.#c;
    reauthDialog(c.modalRoot, {
      title: viAdmin.deleteGroup.title(g.name),
      body: viAdmin.deleteGroup.body,
      confirm: viAdmin.deleteGroup.submit,
      danger: true,
      run: async (reauth) => {
        await c.api.deleteGroup(g.id, { rev: c.data.accessRev, reauth });
        c.toast(viAdmin.done.groupDeleted(g.name));
        await c.reload('groups', 'access', 'users');
      },
      onError: (e) => {
        if (e instanceof AdminApiError && e.code === 'IN_USE') this.#inUse(g, e);
        else c.fail(e);
      },
    });
  }

  #inUse(g: AdminGroup, e: AdminApiError): void {
    const c = this.#c;
    const D = viAdmin.deleteGroup;
    const used = e.usedBy;
    const m = new Modal(c.modalRoot, D.inUseTitle(g.name), { danger: true });
    const resources = c.data.access?.resources ?? [];
    m.body.append(h('p', { class: 'ad-lead', text: D.inUseBody }));
    if (used.users.length)
      m.body.append(
        h('h3', { class: 'ad-sub', text: `${D.inUseUsers} (${used.users.length})` }),
        h(
          'ul',
          { class: 'ad-uselist', attrs: { 'data-inuse': 'users' } },
          ...used.users.map((u) => h('li', { text: u })),
        ),
      );
    if (used.rules.length)
      m.body.append(
        h('h3', { class: 'ad-sub', text: `${D.inUseRules} (${used.rules.length})` }),
        h(
          'ul',
          { class: 'ad-uselist', attrs: { 'data-inuse': 'rules' } },
          ...used.rules.map((r) =>
            h(
              'li',
              {},
              h('span', { text: resourceTitle(resources, r.resource) }),
              h('code', { class: 'ad-mono', text: ` ${r.resource} · ${r.level}` }),
            ),
          ),
        ),
      );
    m.footer.append(button(viAdmin.close, () => m.close(), { kind: 'primary' }));
    m.open();
  }
}
