// Tab Xem với tư cách (feature 013, US4 AC6, FR-043): chọn người dùng X → `GET /api/v1/admin/effective?user=X` (máy chủ
// ghi audit `admin.view-as`) → banner rõ "đang xem với tư cách X, chỉ đọc", danh sách màn hình và trang hệ thống X xem
// được, xem trước màn hình đúng như X thấy: item bị ẩn bỏ khỏi mô hình (ô lưới trống), item bị khóa hiện "Cần quyền
// thao tác"; mọi widget khác khóa "xem trước". PreviewHost không gửi lệnh nào.
import { filterScreen, type EffectiveAccess } from '../access.ts';
import { createIcon } from '../icons.ts';
import { viAdmin } from '../i18n/vi-admin.ts';
import type { AdminCtx, AdminTab } from './admin-page.ts';
import { PreviewHost, ScreenPreview } from './preview.ts';
import { button, chip, h, roleBadge } from './ui.ts';

const V = viAdmin.viewAs;

export class ViewAsTab implements AdminTab {
  readonly el: HTMLElement;
  readonly #c: AdminCtx;
  readonly #user: HTMLSelectElement;
  readonly #content: HTMLElement;
  #eff: EffectiveAccess | null = null;
  #screen = '';
  #preview: ScreenPreview | null = null;

  constructor(c: AdminCtx) {
    this.#c = c;
    this.#user = h('select', { id: 'ad-viewas-user' });
    const start = button(V.start, () => void this.#start(this.#user.value), {
      kind: 'primary',
      icon: 'user',
    });
    start.setAttribute('data-viewas-start', '');
    this.#content = h('div', { class: 'ad-viewas' });
    this.el = h(
      'div',
      { class: 'ad-tabbody' },
      h(
        'div',
        { class: 'ad-toolbar' },
        h('label', { text: V.pick, attrs: { for: 'ad-viewas-user' } }),
        this.#user,
        start,
      ),
      this.#content,
    );
  }

  render(params: URLSearchParams): void {
    const users = this.#c.data.users;
    const cur = this.#user.value;
    this.#user.replaceChildren(
      h('option', { text: V.pickPlaceholder, attrs: { value: '' } }),
      ...users.map((u) =>
        h('option', { text: `${u.name} (${viAdmin.roleName(u.role)})`, attrs: { value: u.name } }),
      ),
    );
    const want = params.get('u') ?? cur;
    if (want && users.some((u) => u.name === want)) this.#user.value = want;
    if (!this.#eff) this.#content.replaceChildren(h('p', { class: 'ad-hint', text: V.hint }));
  }

  hide(): void {
    this.#preview?.dispose();
  }

  #exit(): void {
    this.#eff = null;
    this.#preview?.dispose();
    this.#preview = null;
    this.#content.replaceChildren(h('p', { class: 'ad-hint', text: V.hint }));
    this.#user.focus();
  }

  async #start(name: string): Promise<void> {
    if (!name) {
      this.#user.focus();
      return;
    }
    try {
      this.#eff = await this.#c.api.effective(name);
    } catch (e) {
      this.#c.fail(e);
      return;
    }
    const e = this.#eff;
    const screens = (this.#c.data.access?.resources ?? []).filter(
      (r) =>
        (r.kind === 'screen' || r.kind === 'popup') &&
        e.screens.includes(r.id.slice(r.id.indexOf(':') + 1)),
    );
    this.#screen = screens[0]?.id.slice(screens[0].id.indexOf(':') + 1) ?? '';
    this.#preview?.dispose();
    const role = e.role;
    this.#preview = new ScreenPreview(this.#c.deps, {
      host: new PreviewHost({
        session: () => ({ user: name, role }),
        locked: (s, i) => (e.lockedItems[s] ?? []).includes(i),
        popupDenied: (p) => !e.admin && !e.screens.includes(p),
        message: V.banner(name, role),
      }),
      label: V.banner(name, role),
    });
    const banner = h(
      'div',
      { class: 'ad-banner info viewas', attrs: { role: 'status', 'data-banner': 'view-as' } },
      h(
        'span',
        { class: 'ad-banner-icon', attrs: { 'aria-hidden': 'true' } },
        createIcon('user', 20),
      ),
      h('div', { class: 'ad-banner-text' }, h('strong', { text: V.banner(name, role) })),
      button(V.exit, () => this.#exit(), { kind: 'subtle' }),
    );
    const list = h('ul', { class: 'ad-viewas-screens', attrs: { 'aria-label': V.screens } });
    const select = (id: string) => {
      this.#screen = id;
      for (const b of list.querySelectorAll<HTMLElement>('button'))
        b.setAttribute('aria-pressed', String(b.dataset.screen === id));
      void this.#show();
    };
    for (const r of screens) {
      const id = r.id.slice(r.id.indexOf(':') + 1);
      list.append(
        h(
          'li',
          {},
          h('button', {
            type: 'button',
            class: 'ad-itembtn',
            text: r.title,
            attrs: { 'data-screen': id, 'aria-pressed': String(id === this.#screen) },
            on: { click: () => select(id) },
          }),
        ),
      );
    }
    const pages = h('div', { class: 'ad-chips' });
    if (e.pages.length) e.pages.forEach((p, i) => pages.append(chip(V.pageNames[p] ?? p, 2 + i)));
    else pages.append(h('span', { class: 'muted', text: V.noPages }));
    const groupName = new Map(this.#c.data.groups.map((g) => [g.id, g.name]));
    this.#content.replaceChildren(
      banner,
      h(
        'div',
        { class: 'ad-viewas-grid' },
        h(
          'aside',
          { class: 'ad-viewas-side' },
          h(
            'div',
            { class: 'ad-userhead' },
            roleBadge(role),
            ...e.groups.map((g) => chip(groupName.get(g) ?? g, 4)),
          ),
          h('h3', { class: 'ad-sub', text: V.screens }),
          screens.length ? list : h('p', { class: 'ad-hint', text: V.noScreens }),
          h('h3', { class: 'ad-sub', text: V.pages }),
          pages,
        ),
        h('section', { class: 'ad-viewas-main' }, this.#preview.el),
      ),
    );
    await this.#show();
  }

  async #show(): Promise<void> {
    const e = this.#eff;
    const p = this.#preview;
    if (!e || !p || !this.#screen) return;
    try {
      const model = filterScreen(
        await this.#c.deps.store.screen(this.#screen),
        e.hiddenItems[this.#screen] ?? [],
      );
      await p.show(model);
    } catch (err) {
      this.#c.fail(err);
    }
  }
}
