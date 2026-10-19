// Tab Quyền theo trang (feature 013, US3, FR-041; admin-api §4): ma trận hàng = màn hình, popup, trang hệ thống, nhóm
// lưu trữ, mẫu báo cáo; cột = Mọi người, vai trò, nhóm, người dùng. Ô tích là người nhận của quy tắc `view`; hàng chưa
// có quy tắc hiện "Mặc định (theo project)" (ô mờ, tích theo tập tương đương), hàng có quy tắc hiện "Đã đặt", hàng đổi
// chưa lưu hiện "Chưa lưu". Chọn nhiều hàng → "Đặt quyền cho N trang…" (chọn người nhận, sao chép từ trang khác, về mặc
// định). Thay đổi gom vào bản nháp chung (RuleDraft), lưu theo lô với `rev` ở thanh dưới.
import { viAdmin } from '../i18n/vi-admin.ts';
import type { AdminCtx, AdminTab } from './admin-page.ts';
import type { AccessResource } from './api.ts';
import { defaultGrantees, granteeOptions, type GranteeOption } from './model.ts';
import { Modal, button, h, input, pill, toggleChips } from './ui.ts';

const M = viAdmin.matrix;
const PAGE_KINDS = ['screen', 'popup', 'page', 'history', 'report'] as const;
const CAT_LABEL: Record<string, string> = {
  all: viAdmin.grantees.catAll,
  role: viAdmin.grantees.catRoles,
  group: viAdmin.grantees.catGroups,
  user: viAdmin.grantees.catUsers,
};

export class PagesTab implements AdminTab {
  readonly el: HTMLElement;
  readonly #c: AdminCtx;
  readonly #filter: HTMLInputElement;
  readonly #kind: HTMLSelectElement;
  readonly #bulk: HTMLButtonElement;
  readonly #wrap: HTMLElement;
  readonly #selected = new Set<string>();
  #off: (() => void) | null = null;

  constructor(c: AdminCtx) {
    this.#c = c;
    this.#filter = input('search', { placeholder: M.filterPlaceholder, 'aria-label': M.filter });
    this.#filter.className = 'ad-search';
    this.#filter.addEventListener('input', () => this.#renderTable());
    this.#kind = h('select', { attrs: { 'aria-label': M.allKinds } });
    this.#kind.append(h('option', { text: M.allKinds, attrs: { value: '' } }));
    for (const k of PAGE_KINDS)
      this.#kind.append(h('option', { text: M.kinds[k] ?? k, attrs: { value: k } }));
    this.#kind.addEventListener('change', () => this.#renderTable());
    this.#bulk = button(M.bulk(0), () => this.#bulkDialog(), { kind: 'primary', icon: 'list' });
    this.#bulk.setAttribute('data-bulk', '');
    this.#wrap = h('div', { class: 'ad-tablewrap ad-matrixwrap' });
    this.el = h(
      'div',
      { class: 'ad-tabbody' },
      h(
        'div',
        { class: 'ad-toolbar' },
        this.#filter,
        this.#kind,
        h('span', { class: 'grow' }),
        this.#bulk,
      ),
      h('p', { class: 'ad-hint', text: M.adminNote }),
      this.#wrap,
    );
  }

  render(): void {
    this.#off ??= this.#c.draft.onChange(() => this.#renderTable());
    this.#renderTable();
  }

  hide(): void {
    this.#off?.();
    this.#off = null;
  }

  #rows(): AccessResource[] {
    const all = (this.#c.data.access?.resources ?? []).filter((r) =>
      (PAGE_KINDS as readonly string[]).includes(r.kind),
    );
    const q = this.#filter.value.trim().toLowerCase();
    const k = this.#kind.value;
    return all.filter(
      (r) => (!k || r.kind === k) && (!q || r.title.toLowerCase().includes(q) || r.id.includes(q)),
    );
  }

  #options(): GranteeOption[] {
    return granteeOptions(
      this.#c.data.groups,
      this.#c.data.users.filter((u) => u.role !== 'administrator'),
    );
  }

  #renderTable(): void {
    const rows = this.#rows();
    const opts = this.#options();
    const draft = this.#c.draft;
    for (const id of [...this.#selected])
      if (!rows.some((r) => r.id === id)) this.#selected.delete(id);
    this.#bulk.querySelector('span')!.textContent = M.bulk(this.#selected.size);
    this.#bulk.disabled = this.#selected.size === 0;
    if (!rows.length) {
      this.#wrap.replaceChildren(h('p', { class: 'ad-empty', text: M.empty }));
      return;
    }
    const table = h(
      'table',
      { class: 'ad-table ad-matrix' },
      h('caption', { class: 'sr-only', text: M.caption }),
    );
    // Hai hàng tiêu đề: loại người nhận (gộp cột) rồi từng người nhận.
    const cats: { cat: string; n: number }[] = [];
    for (const o of opts) {
      const last = cats.at(-1);
      if (last && last.cat === o.cat) last.n++;
      else cats.push({ cat: o.cat, n: 1 });
    }
    const all = input('checkbox', { 'aria-label': M.selectAll });
    all.checked = rows.every((r) => this.#selected.has(r.id));
    all.addEventListener('change', () => {
      for (const r of rows) {
        if (all.checked) this.#selected.add(r.id);
        else this.#selected.delete(r.id);
      }
      this.#renderTable();
    });
    table.append(
      h(
        'thead',
        {},
        h(
          'tr',
          { class: 'ad-cathead' },
          h('td', { attrs: { colspan: '3' } }),
          ...cats.map((x) =>
            h('th', {
              text: CAT_LABEL[x.cat] ?? x.cat,
              attrs: { colspan: String(x.n), scope: 'colgroup', class: `cat-${x.cat}` },
            }),
          ),
          h('td'),
        ),
        h(
          'tr',
          {},
          h('th', { class: 'sel', attrs: { scope: 'col' } }, all),
          h('th', { class: 'page', text: M.colPage, attrs: { scope: 'col' } }),
          h('th', { text: M.colState, attrs: { scope: 'col' } }),
          ...opts.map((o) =>
            h(
              'th',
              { class: `gcol hue-${o.hue}`, attrs: { scope: 'col', title: o.label } },
              h('span', { text: o.short }),
            ),
          ),
          h('th', { text: M.colActions, attrs: { scope: 'col' } }),
        ),
      ),
    );
    const body = h('tbody');
    let lastKind = '';
    for (const r of rows) {
      if (r.kind !== lastKind) {
        lastKind = r.kind;
        body.append(
          h(
            'tr',
            { class: 'ad-kindrow' },
            h('th', {
              text: M.kinds[r.kind] ?? r.kind,
              attrs: { colspan: String(opts.length + 4), scope: 'rowgroup' },
            }),
          ),
        );
      }
      const st = draft.get(r.id, 'view');
      const def = r.defaults.view;
      const current = new Set(st.grantees ?? defaultGrantees(def));
      const isDefault = st.grantees === null;
      const sel = input('checkbox', { 'aria-label': M.select(r.title) });
      sel.checked = this.#selected.has(r.id);
      sel.addEventListener('change', () => {
        if (sel.checked) this.#selected.add(r.id);
        else this.#selected.delete(r.id);
        this.#bulk.querySelector('span')!.textContent = M.bulk(this.#selected.size);
        this.#bulk.disabled = this.#selected.size === 0;
      });
      const state = st.dirty
        ? pill(M.stateChanged, 'warn')
        : isDefault
          ? pill(M.stateDefaultShort, 'muted')
          : pill(M.stateSet, 'info');
      if (isDefault && !st.dirty) state.title = M.stateDefault(def ?? 'viewer');
      const reset = button('', () => draft.set(r.id, 'view', null), {
        kind: 'ghost',
        icon: 'close',
        aria: M.resetRowLabel(r.title),
        small: true,
      });
      reset.title = M.resetRow;
      reset.disabled = isDefault && draft.saved(r.id, 'view') === null;
      const tr = h(
        'tr',
        {
          class: `${isDefault ? 'is-default' : 'is-set'}${st.dirty ? ' is-dirty' : ''}`,
          attrs: { 'data-resource': r.id },
        },
        h('td', { class: 'sel' }, sel),
        h(
          'th',
          { class: 'page', attrs: { scope: 'row' } },
          h('span', { class: 'ad-pagetitle', text: r.title }),
          h('code', { class: 'ad-mono', text: r.id }),
        ),
        h('td', { class: 'state' }, state),
        ...opts.map((o) => {
          const cb = input('checkbox', {
            'aria-label': M.cell(o.label, r.title),
            'data-grantee': o.id,
          });
          cb.checked = current.has(o.id);
          cb.addEventListener('change', () => draft.toggle(r.id, 'view', o.id, def));
          return h('td', { class: `cell hue-${o.hue}` }, cb);
        }),
        h('td', { class: 'acts' }, reset),
      );
      if (isDefault) tr.title = M.stateDefault(def ?? 'viewer');
      body.append(tr);
    }
    table.append(body);
    const focus = document.activeElement as HTMLElement | null;
    const key = focus?.closest('tr')?.getAttribute('data-resource');
    const grantee = focus?.getAttribute('data-grantee');
    this.#wrap.replaceChildren(table);
    // Giữ focus trên ô vừa bấm sau khi dựng lại (bàn phím: Space liên tiếp).
    if (key && grantee)
      table
        .querySelector<HTMLElement>(
          `tr[data-resource="${CSS.escape(key)}"] [data-grantee="${CSS.escape(grantee)}"]`,
        )
        ?.focus();
  }

  #bulkDialog(): void {
    const c = this.#c;
    const ids = [...this.#selected];
    if (!ids.length) return;
    const all = (c.data.access?.resources ?? []).filter((r) =>
      (PAGE_KINDS as readonly string[]).includes(r.kind),
    );
    const m = new Modal(c.modalRoot, M.bulkTitle(ids.length), { wide: true });
    let chosen = new Set<string>();
    let toDefault = false;
    const opts = this.#options();
    const chipsHost = h('div');
    const renderChips = () =>
      chipsHost.replaceChildren(
        toggleChips(
          M.bulkTitle(ids.length),
          opts,
          chosen,
          (id, on) => {
            toDefault = false;
            if (on) chosen.add(id);
            else chosen.delete(id);
          },
          (cat) => CAT_LABEL[cat] ?? cat,
        ),
      );
    renderChips();
    const copy = h('select', { attrs: { 'aria-label': M.bulkCopy } });
    copy.append(h('option', { text: M.bulkCopyNone, attrs: { value: '' } }));
    for (const r of all)
      copy.append(
        h('option', { text: `${r.title} (${M.kinds[r.kind] ?? r.kind})`, attrs: { value: r.id } }),
      );
    copy.addEventListener('change', () => {
      const src = all.find((r) => r.id === copy.value);
      if (!src) return;
      const st = c.draft.get(src.id, 'view');
      toDefault = st.grantees === null;
      chosen = new Set(st.grantees ?? defaultGrantees(src.defaults.view));
      renderChips();
    });
    m.body.append(
      h('p', { class: 'ad-lead', text: M.bulkHint }),
      h(
        'div',
        { class: 'ad-field' },
        h('label', { text: M.bulkCopy, attrs: { for: (copy.id = 'ad-bulk-copy') } }),
        copy,
      ),
      chipsHost,
    );
    const apply = button(
      viAdmin.apply,
      () => {
        for (const id of ids) c.draft.set(id, 'view', toDefault ? null : [...chosen]);
        m.close();
      },
      { kind: 'primary' },
    );
    apply.setAttribute('data-confirm', '');
    m.footer.append(
      button(
        M.bulkDefault,
        () => {
          for (const id of ids) c.draft.set(id, 'view', null);
          m.close();
        },
        { kind: 'subtle' },
      ),
      h('span', { class: 'grow' }),
      button(viAdmin.cancel, () => m.close(), { kind: 'subtle' }),
      apply,
    );
    m.open();
  }
}
