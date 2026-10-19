// Tab Quyền theo component (feature 013, US4, FR-042; admin-api §4): chọn màn hình → danh sách component và xem trước
// bằng chính `<mat-screen>` (chỉ đọc, lớp phủ bấm để chọn) → khung bên phải sửa "Ai được xem" và "Ai được thao tác"
// (chỉ component thao tác được) vào bản nháp chung, và bảng "Ai thấy, ai thao tác được" tính bằng
// `GET /api/v1/admin/effective?user=` cho từng người dùng (đúng luật của thiết bị, trên quyền đã lưu).
import type { EffectiveAccess } from '../access.ts';
import { viAdmin } from '../i18n/vi-admin.ts';
import type { AdminCtx, AdminTab } from './admin-page.ts';
import type { AccessResource, Level } from './api.ts';
import { defaultGrantees, effectiveCell, granteeOptions, itemIdOf, itemsOf } from './model.ts';
import { PreviewHost, ScreenPreview } from './preview.ts';
import { button, h, input, pill, roleBadge, toggleChips } from './ui.ts';

const C = viAdmin.comp;
const CAT_LABEL: Record<string, string> = {
  all: viAdmin.grantees.catAll,
  role: viAdmin.grantees.catRoles,
  group: viAdmin.grantees.catGroups,
  user: viAdmin.grantees.catUsers,
};

export class ComponentsTab implements AdminTab {
  readonly el: HTMLElement;
  readonly #c: AdminCtx;
  readonly #screenSel: HTMLSelectElement;
  readonly #search: HTMLInputElement;
  readonly #list: HTMLElement;
  readonly #inspector: HTMLElement;
  readonly #previewHead: HTMLElement;
  readonly #preview: ScreenPreview;
  #screen = '';
  #item: string | null = null;
  #effective = new Map<string, EffectiveAccess>();
  #effRev = -1;
  #effLoading: Promise<void> | null = null;
  #off: (() => void) | null = null;
  #shownScreen = '';

  constructor(c: AdminCtx) {
    this.#c = c;
    this.#screenSel = h('select', { id: 'ad-comp-screen' });
    this.#screenSel.addEventListener('change', () => {
      this.#screen = this.#screenSel.value;
      this.#item = null;
      void this.#renderAll();
    });
    this.#search = input('search', { placeholder: C.itemsFilter, 'aria-label': C.itemsFilter });
    this.#search.className = 'ad-search';
    this.#search.addEventListener('input', () => this.#renderList());
    this.#list = h('ul', { class: 'ad-itemlist', attrs: { 'aria-label': C.items } });
    this.#inspector = h('aside', { class: 'ad-inspector', attrs: { 'aria-live': 'polite' } });
    this.#previewHead = h('h3', { class: 'ad-sub', text: C.preview });
    this.#preview = new ScreenPreview(c.deps, {
      host: new PreviewHost({
        session: () => c.deps.session.info,
        message: viAdmin.comp.preview,
      }),
      label: C.preview,
      onPick: (id) => this.#pick(id),
      pickLabel: (t) => C.pick(t),
    });
    this.el = h(
      'div',
      { class: 'ad-tabbody ad-comp' },
      h(
        'section',
        { class: 'ad-comp-side' },
        h(
          'div',
          { class: 'ad-field' },
          h('label', { text: C.screen, attrs: { for: 'ad-comp-screen' } }),
          this.#screenSel,
        ),
        h('h3', { class: 'ad-sub', text: C.items }),
        this.#search,
        this.#list,
      ),
      h('section', { class: 'ad-comp-main' }, this.#previewHead, this.#preview.el),
      this.#inspector,
    );
  }

  render(params: URLSearchParams): void {
    this.#off ??= this.#c.draft.onChange(() => {
      this.#renderList();
      this.#renderInspector();
    });
    const screens = this.#screens();
    const want = params.get('s');
    if (want && screens.some((s) => s.screen === want)) this.#screen = want;
    if (!this.#screen || !screens.some((s) => s.screen === this.#screen))
      this.#screen = screens[0]?.screen ?? '';
    this.#screenSel.replaceChildren(
      ...screens.map((s) => {
        const o = h('option', { text: s.title, attrs: { value: s.screen } });
        if (s.screen === this.#screen) o.selected = true;
        return o;
      }),
    );
    const item = params.get('i');
    if (item) this.#item = item;
    void this.#renderAll();
  }

  hide(): void {
    this.#off?.();
    this.#off = null;
  }

  #screens(): { screen: string; title: string }[] {
    return (this.#c.data.access?.resources ?? [])
      .filter((r) => r.kind === 'screen' || r.kind === 'popup')
      .map((r) => ({ screen: r.id.slice(r.id.indexOf(':') + 1), title: r.title }));
  }

  #items(): AccessResource[] {
    return itemsOf(this.#c.data.access?.resources ?? [], this.#screen);
  }

  async #renderAll(): Promise<void> {
    this.#renderList();
    this.#renderInspector();
    await this.#renderPreview();
  }

  async #renderPreview(): Promise<void> {
    const id = this.#screen;
    if (!id) return;
    const title = this.#screens().find((s) => s.screen === id)?.title ?? id;
    this.#previewHead.textContent = C.preview;
    this.#preview.screenEl.setAttribute('aria-label', C.previewLabel(title));
    if (this.#shownScreen === id) {
      this.#preview.select(this.#item);
      return;
    }
    try {
      const model = await this.#c.deps.store.screen(id);
      if (this.#screen !== id) return;
      this.#shownScreen = id;
      const titles = new Map(this.#items().map((r) => [itemIdOf(r), r.title]));
      await this.#preview.show(model, titles);
      this.#preview.select(this.#item);
    } catch (e) {
      this.#c.fail(e);
    }
  }

  #pick(id: string): void {
    this.#item = id;
    this.#preview.select(id);
    this.#renderList();
    this.#renderInspector();
    this.#inspector.querySelector<HTMLElement>('h3')?.focus();
  }

  #renderList(): void {
    const q = this.#search.value.trim().toLowerCase();
    const items = this.#items().filter(
      (r) => !q || r.title.toLowerCase().includes(q) || r.id.includes(q),
    );
    if (!items.length) {
      this.#list.replaceChildren(h('li', { class: 'ad-empty', text: C.empty }));
      return;
    }
    const d = this.#c.draft;
    this.#list.replaceChildren(
      ...items.map((r) => {
        const id = itemIdOf(r);
        const v = d.get(r.id, 'view');
        const o = r.levels.includes('operate') ? d.get(r.id, 'operate') : null;
        const b = h(
          'button',
          {
            type: 'button',
            class: 'ad-itembtn',
            attrs: { 'aria-pressed': String(id === this.#item), 'data-item': id },
            on: { click: () => this.#pick(id) },
          },
          h('span', { class: 'ad-itemtitle', text: r.title }),
          h('span', { class: 'ad-mono', text: `${id} · ${r.widget ?? ''}` }),
          h(
            'span',
            { class: 'ad-itembadges' },
            v.grantees !== null ? pill(C.badgeHidden, 'info') : null,
            o && o.grantees !== null ? pill(C.badgeLocked, 'warn') : null,
            v.dirty || o?.dirty ? pill(viAdmin.matrix.stateChanged, 'warn') : null,
          ),
        );
        return h('li', {}, b);
      }),
    );
  }

  #levelEditor(r: AccessResource, level: Level, label: string): HTMLElement {
    const d = this.#c.draft;
    const st = d.get(r.id, level);
    const def = r.defaults[level];
    const current = new Set(st.grantees ?? defaultGrantees(def));
    const opts = granteeOptions(
      this.#c.data.groups,
      this.#c.data.users.filter((u) => u.role !== 'administrator'),
    );
    const state = st.dirty
      ? pill(viAdmin.matrix.stateChanged, 'warn')
      : st.grantees === null
        ? pill(
            viAdmin.matrix.stateDefault(def ?? (level === 'view' ? 'viewer' : 'operator')),
            'muted',
          )
        : pill(viAdmin.matrix.stateSet, 'info');
    const reset = button(viAdmin.matrix.resetRow, () => d.set(r.id, level, null), {
      kind: 'subtle',
      small: true,
    });
    reset.disabled = st.grantees === null && d.saved(r.id, level) === null;
    return h(
      'div',
      { class: 'ad-level', attrs: { 'data-level': level } },
      h(
        'div',
        { class: 'ad-level-head' },
        h('h4', { text: label }),
        state,
        h('span', { class: 'grow' }),
        reset,
      ),
      toggleChips(
        `${label}: ${r.title}`,
        opts,
        current,
        (id) => d.toggle(r.id, level, id, def),
        (cat) => CAT_LABEL[cat] ?? cat,
      ),
      current.size === 0 ? h('p', { class: 'ad-hint', text: viAdmin.grantees.nobody }) : null,
    );
  }

  #renderInspector(): void {
    const r = this.#items().find((x) => itemIdOf(x) === this.#item);
    if (!r) {
      this.#inspector.replaceChildren(h('p', { class: 'ad-hint', text: C.noneSelected }));
      return;
    }
    const operable = r.levels.includes('operate');
    const who = h('div', { class: 'ad-who' });
    // Giữ focus trên chip vừa bấm (dựng lại sau mỗi thay đổi của bản nháp).
    const f = document.activeElement as HTMLElement | null;
    const keep = this.#inspector.contains(f)
      ? {
          g: f?.getAttribute('data-grantee'),
          lv: f?.closest('[data-level]')?.getAttribute('data-level'),
        }
      : null;
    queueMicrotask(() => {
      if (keep?.g && keep.lv)
        this.#inspector
          .querySelector<HTMLElement>(
            `[data-level="${keep.lv}"] [data-grantee="${CSS.escape(keep.g)}"]`,
          )
          ?.focus();
    });
    this.#inspector.replaceChildren(
      h('h3', { class: 'ad-insp-title', text: r.title, attrs: { tabindex: '-1' } }),
      h('p', { class: 'ad-mono', text: r.id }),
      h('p', { class: 'ad-hint', text: C.widget(r.widget ?? '') }),
      this.#levelEditor(r, 'view', C.view),
      operable
        ? this.#levelEditor(r, 'operate', C.operate)
        : h('p', { class: 'ad-note', text: C.displayOnly, attrs: { 'data-display-only': '' } }),
      h('h3', { class: 'ad-sub', text: C.who }),
      h('p', { class: 'ad-hint', text: this.#c.draft.count ? C.whoDirty : C.whoNote }),
      who,
    );
    void this.#renderWho(who, r, operable);
  }

  async #ensureEffective(): Promise<void> {
    const rev = this.#c.data.accessRev;
    if (this.#effRev === rev && !this.#effLoading) return;
    if (this.#effLoading && this.#effRev === rev) return this.#effLoading;
    this.#effRev = rev;
    this.#effective = new Map();
    const users = this.#c.data.users;
    this.#effLoading = (async () => {
      // 4 yêu cầu song song (thiết bị nhỏ; tối đa 200 người dùng).
      let i = 0;
      const worker = async () => {
        while (i < users.length) {
          const u = users[i++]!;
          try {
            this.#effective.set(u.name, await this.#c.api.effective(u.name));
          } catch {
            /* bỏ người này; hàng hiện "—" */
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    })();
    await this.#effLoading;
    this.#effLoading = null;
  }

  async #renderWho(host: HTMLElement, r: AccessResource, operable: boolean): Promise<void> {
    host.replaceChildren(h('p', { class: 'ad-loading', text: C.whoLoading }));
    await this.#ensureEffective();
    if (!host.isConnected) return;
    const item = itemIdOf(r);
    const yes = (v: boolean | null, label: string) =>
      v === null
        ? h('span', { class: 'muted', text: C.na })
        : h('span', {
            class: `ad-yn ${v ? 'yes' : 'no'}`,
            text: v ? C.yes : C.no,
            attrs: { 'aria-label': `${label}: ${v ? C.yes : C.no}` },
          });
    const rows = this.#c.data.users.map((u) => {
      const e = this.#effective.get(u.name);
      const cell = e ? effectiveCell(e, this.#screen, item, operable) : null;
      return h(
        'tr',
        { attrs: { 'data-who': u.name } },
        h(
          'th',
          { attrs: { scope: 'row' } },
          h('span', { text: u.name }),
          u.enabled ? null : h('span', { class: 'muted', text: ` (${C.disabledUser})` }),
        ),
        h('td', {}, roleBadge(u.role)),
        h('td', {}, cell ? yes(cell.sees, C.colSees) : h('span', { text: viAdmin.none })),
        h('td', {}, cell ? yes(cell.operates, C.colOperates) : h('span', { text: viAdmin.none })),
      );
    });
    host.replaceChildren(
      h(
        'table',
        { class: 'ad-table compact' },
        h('caption', { class: 'sr-only', text: C.who }),
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { text: C.colUser, attrs: { scope: 'col' } }),
            h('th', { text: viAdmin.users.col.role, attrs: { scope: 'col' } }),
            h('th', { text: C.colSees, attrs: { scope: 'col' } }),
            h('th', { text: C.colOperates, attrs: { scope: 'col' } }),
          ),
        ),
        h('tbody', {}, ...rows),
      ),
    );
  }
}
