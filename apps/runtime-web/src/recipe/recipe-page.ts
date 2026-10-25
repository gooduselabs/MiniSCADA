// Trang Recipe của trang vận hành (feature 024, specs/024-recipes/spec.md US2, US3): `#/recipes[/<loại>]`. Tải lười
// (chunk riêng). Bố cục: danh sách loại bên trái; bảng hàng = tham số, cột = giá trị hiện tại trên PLC (hỏi 2 s/lần khi
// trang mở và tab hiện) rồi mỗi bản recipe (huy hiệu Project/Thiết bị). Chọn một bản tô các ô khác PLC; Tải xuống mở
// hộp xác nhận liệt kê thay đổi, rồi theo dõi tiến trình từng tham số (300 ms/lần). Đọc từ PLC, Sửa (bản thiết bị),
// Sao chép, Xóa theo quyền `can` máy chủ trả. Mọi chữ qua textContent; máy chủ kiểm lại mọi thứ.
import { viRecipe as T } from '../i18n/vi-recipe.ts';
import {
  RecipeApiError,
  changesOf,
  formatValue,
  limitText,
  parseInput,
  sameValue,
  valueIssue,
  type CurrentValue,
  type Job,
  type RecipeApi,
  type RecipeItem,
  type RecipeList,
  type RecipeType,
  type RecipeValue,
} from './model.ts';
import './recipe.css';

export interface RecipePageDeps {
  container: HTMLElement;
  api: Pick<RecipeApi, 'list' | 'current' | 'job' | 'download' | 'save' | 'remove' | 'capture'>;
  /** Có phiên (API recipe cần đăng nhập). */
  signedIn: () => boolean;
  onLogin: () => void;
  /** Đổi hash khi chọn loại (không thêm lịch sử). */
  onUrl?: (hash: string) => void;
  currentMs?: number;
  jobMs?: number;
}

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  p: {
    class?: string;
    text?: string;
    attrs?: Record<string, string>;
    on?: Record<string, (e: Event) => void>;
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (p.class) e.className = p.class;
  if (p.text !== undefined) e.textContent = p.text;
  for (const [k, v] of Object.entries(p.attrs ?? {})) e.setAttribute(k, v);
  for (const [k, fn] of Object.entries(p.on ?? {})) e.addEventListener(k, fn);
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

function btn(
  label: string,
  onClick: () => void,
  kind = '',
  attrs: Record<string, string> = {},
): HTMLButtonElement {
  return h('button', {
    class: `rc-btn${kind ? ` ${kind}` : ''}`,
    text: label,
    attrs: { type: 'button', ...attrs },
    on: { click: () => onClick() },
  });
}

/** Câu lỗi tiếng Việt của lỗi API. */
export function recipeErrorText(e: unknown): string {
  if (!(e instanceof RecipeApiError))
    return T.errors.other('ERROR', e instanceof Error ? e.message : String(e));
  if (e.code === 'RECIPE_BAD_QUALITY') return T.errors.RECIPE_BAD_QUALITY(e.tags);
  const known = (T.errors as Record<string, unknown>)[e.code];
  if (typeof known === 'string') return known;
  return T.errors.other(e.code, e.message !== e.code ? e.message : undefined);
}

export class RecipePage {
  readonly #d: RecipePageDeps;
  readonly #root: HTMLElement;
  /** Nội dung dựng lại mỗi lần; hộp thoại nằm ngoài nó (không mất khi trang vẽ lại). */
  readonly #view: HTMLElement;
  #list: RecipeList | null = null;
  #typeId: string | null = null;
  #selected: string | null = null;
  #current: Record<string, CurrentValue> = {};
  #timer: ReturnType<typeof setInterval> | null = null;
  #editing: { id: string; values: Record<string, string> } | null = null;
  #bad = new Set<string>();
  #message: { text: string; tone: 'ok' | 'bad' } | null = null;
  #visible = false;
  #onVis = () => {
    if (document.hidden) this.#stopPoll();
    else if (this.#visible) this.#startPoll();
  };

  constructor(d: RecipePageDeps) {
    this.#d = d;
    this.#root = h('div', { class: 'rc-host' });
    this.#view = h('div', { class: 'rc-page' });
    this.#root.append(this.#view);
    d.container.append(this.#root);
  }

  get root(): HTMLElement {
    return this.#root;
  }

  async show(typeId: string | null): Promise<void> {
    this.#visible = true;
    document.addEventListener('visibilitychange', this.#onVis);
    if (!this.#d.signedIn()) {
      this.#renderLogin();
      return;
    }
    if (typeId !== null) this.#typeId = typeId;
    this.#view.replaceChildren(h('p', { class: 'rc-empty', text: T.loading }));
    await this.reload();
    this.#startPoll();
  }

  hide(): void {
    this.#visible = false;
    this.#stopPoll();
    document.removeEventListener('visibilitychange', this.#onVis);
    for (const d of this.#root.querySelectorAll('dialog')) d.remove();
  }

  /** Tải lại danh sách (sau thay đổi, CONFLICT). */
  async reload(): Promise<void> {
    try {
      this.#list = await this.#d.api.list();
    } catch (e) {
      this.#list = { rev: 0, types: [] };
      this.#message = { text: recipeErrorText(e), tone: 'bad' };
    }
    const types = this.#list.types;
    if (!types.some((t) => t.id === this.#typeId)) this.#typeId = types[0]?.id ?? null;
    const t = this.#type();
    if (t && !t.recipes.some((r) => r.id === this.#selected))
      this.#selected = t.recipes[0]?.id ?? null;
    await this.refreshCurrent();
  }

  async refreshCurrent(): Promise<void> {
    const t = this.#type();
    if (t) {
      try {
        this.#current = await this.#d.api.current(t.id);
      } catch {
        this.#current = {};
      }
    }
    this.render();
  }

  #type(): RecipeType | null {
    return this.#list?.types.find((t) => t.id === this.#typeId) ?? null;
  }
  #recipe(): RecipeItem | null {
    return this.#type()?.recipes.find((r) => r.id === this.#selected) ?? null;
  }

  #startPoll(): void {
    this.#stopPoll();
    if (!this.#visible || document.hidden) return;
    this.#timer = setInterval(() => void this.refreshCurrent(), this.#d.currentMs ?? 2000);
  }
  #stopPoll(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  #renderLogin(): void {
    this.#view.replaceChildren(
      h(
        'div',
        { class: 'rc-login' },
        h('p', { text: T.loginNeeded }),
        btn(T.login, () => this.#d.onLogin(), 'primary'),
      ),
    );
  }

  render(): void {
    if (
      this.#editing &&
      document.activeElement instanceof HTMLInputElement &&
      this.#root.contains(document.activeElement)
    )
      return this.#refreshCurrentCells(); // giữ ô đang gõ
    const list = this.#list;
    if (!list) return;
    if (!list.types.length) {
      this.#view.replaceChildren(h('p', { class: 'rc-empty', text: T.noTypes }));
      return;
    }
    const t = this.#type()!;
    const nav = h('nav', { class: 'rc-types', attrs: { 'aria-label': T.types } });
    const ul = h('ul');
    for (const ty of list.types) {
      const b = btn(ty.name, () => this.#selectType(ty.id), 'rc-type');
      if (ty.id === t.id) b.setAttribute('aria-current', 'true');
      b.append(h('span', { class: 'rc-count', text: String(ty.recipes.length) }));
      ul.append(h('li', {}, b));
    }
    nav.append(h('h2', { text: T.types }), ul);
    this.#view.replaceChildren(nav, this.#main(t));
  }

  #selectType(id: string): void {
    this.#typeId = id;
    this.#selected = null;
    this.#editing = null;
    this.#bad.clear();
    this.#message = null;
    this.#d.onUrl?.(`#/recipes/${encodeURIComponent(id)}`);
    void this.reload();
  }

  #main(t: RecipeType): HTMLElement {
    const r = this.#recipe();
    const diffs = r ? changesOf(t, r, this.#current) : [];
    const tools = h('div', { class: 'rc-tools', attrs: { role: 'toolbar', 'aria-label': t.name } });
    if (this.#editing) {
      tools.append(
        btn(T.save, () => void this.#saveEdit(), 'primary'),
        btn(T.cancel, () => {
          this.#editing = null;
          this.#bad.clear();
          this.render();
        }),
      );
    } else {
      if (t.can.operate && r)
        tools.append(
          btn(T.download, () => this.#confirmDownload(t, r), 'primary', { 'data-act': 'download' }),
        );
      if (t.can.edit)
        tools.append(btn(T.capture, () => this.#capture(t), '', { 'data-act': 'capture' }));
      if (t.can.edit && r?.origin === 'device')
        tools.append(
          btn(
            T.edit,
            () => {
              this.#editing = {
                id: r.id,
                values: Object.fromEntries(t.params.map((p) => [p.tag, editText(r.values[p.tag])])),
              };
              this.render();
              this.#root.querySelector<HTMLInputElement>('.rc-table input')?.focus();
            },
            '',
            { 'data-act': 'edit' },
          ),
        );
      if (t.can.edit && r)
        tools.append(btn(T.copy, () => this.#copy(t, r), '', { 'data-act': 'copy' }));
      if (t.can.edit && r?.origin === 'device')
        tools.append(btn(T.remove, () => this.#remove(t, r), 'danger', { 'data-act': 'remove' }));
    }
    const head = h(
      'header',
      { class: 'rc-head' },
      h(
        'div',
        {},
        h('h1', { text: t.name }),
        t.description ? h('p', { class: 'rc-desc', text: t.description }) : null,
      ),
      tools,
    );
    const status = h('p', { class: 'rc-status', attrs: { 'aria-live': 'polite' } });
    if (this.#message) {
      status.textContent = this.#message.text;
      status.dataset.tone = this.#message.tone;
    } else if (this.#editing) status.textContent = T.editHint;
    else if (r) {
      status.textContent = T.diffCount(diffs.length);
      status.dataset.tone = diffs.length ? 'warn' : 'ok';
    }
    return h(
      'section',
      { class: 'rc-main', attrs: { 'aria-label': t.name } },
      head,
      status,
      h('div', { class: 'rc-scroll' }, this.#table(t)),
    );
  }

  #table(t: RecipeType): HTMLTableElement {
    const table = h('table', { class: 'rc-table' });
    const hr = h(
      'tr',
      {},
      h('th', { text: T.param, attrs: { scope: 'col' } }),
      h('th', { text: T.tag, attrs: { scope: 'col' } }),
      h('th', { text: T.unit, attrs: { scope: 'col' } }),
      h('th', { text: T.limits, attrs: { scope: 'col' } }),
      h('th', { class: 'rc-cur', text: T.current, attrs: { scope: 'col' } }),
    );
    for (const r of t.recipes) {
      const sel = r.id === this.#selected;
      const b = h(
        'button',
        {
          class: 'rc-col',
          attrs: {
            type: 'button',
            'aria-pressed': String(sel),
            'aria-label': T.select(r.name),
            'data-recipe': r.id,
          },
          on: {
            click: () => {
              if (this.#editing) return;
              this.#selected = r.id;
              this.#message = null;
              this.render();
            },
          },
        },
        h('span', { class: 'rc-name', text: r.name }),
        h('span', {
          class: `rc-origin ${r.origin}`,
          text: r.origin === 'device' ? T.originDevice : T.originProject,
          attrs: {
            title:
              r.origin === 'device'
                ? T.originDeviceTitle(r.updatedBy ?? '', r.updatedAt ?? '')
                : T.originProjectTitle,
          },
        }),
      );
      hr.append(h('th', { class: sel ? 'rc-sel' : '', attrs: { scope: 'col' } }, b));
    }
    const body = h('tbody');
    for (const p of t.params) {
      const c = this.#current[p.tag];
      const cur = h('td', { class: 'rc-cur', attrs: { 'data-cur': p.tag } });
      this.#fillCurrent(cur, p.tag);
      const tr = h(
        'tr',
        { attrs: { 'data-tag': p.tag } },
        h('th', { attrs: { scope: 'row' }, text: p.label || p.tag, ...(p.description ? {} : {}) }),
        h('td', { class: 'rc-tagid', text: p.tag }),
        h('td', { text: p.unit ?? '' }),
        h('td', { class: 'rc-lim', text: limitText(p) }),
        cur,
      );
      for (const r of t.recipes) {
        const sel = r.id === this.#selected;
        const v = r.values[p.tag];
        const td = h('td', { class: `rc-val${sel ? ' rc-sel' : ''}` });
        if (this.#editing && this.#editing.id === r.id) {
          const inp = h('input', {
            attrs: {
              type: 'text',
              'aria-label': `${p.label || p.tag} — ${r.name}`,
              'data-edit': p.tag,
              inputmode: p.type === 'STRING' || p.type === 'BOOL' ? 'text' : 'decimal',
            },
          });
          inp.value = this.#editing.values[p.tag] ?? '';
          inp.addEventListener('input', () => {
            this.#editing!.values[p.tag] = inp.value;
            const issue = checkText(p, inp.value);
            inp.toggleAttribute('aria-invalid', issue !== null);
            inp.title = issue === 'type' ? T.badType : issue === 'limit' ? T.badLimit : '';
          });
          if (this.#bad.has(p.tag)) inp.setAttribute('aria-invalid', 'true');
          td.append(inp);
        } else {
          td.textContent = formatValue(p, v);
          if (sel && !sameValue(p, c && c.quality === 'GOOD' ? c.value : null, v))
            td.classList.add('rc-diff');
          if (sel && this.#bad.has(p.tag)) td.classList.add('rc-bad');
        }
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(h('thead', {}, hr), body);
    return table;
  }

  #fillCurrent(td: HTMLElement, tag: string): void {
    const t = this.#type();
    const p = t?.params.find((x) => x.tag === tag);
    const c = this.#current[tag];
    td.textContent = p ? formatValue(p, c?.value ?? null) : '';
    td.dataset.quality = c?.quality ?? 'BAD';
  }

  #refreshCurrentCells(): void {
    for (const td of this.#root.querySelectorAll<HTMLElement>('td[data-cur]'))
      this.#fillCurrent(td, td.dataset.cur!);
  }

  #modal(
    title: string,
    danger = false,
  ): {
    dialog: HTMLDialogElement;
    body: HTMLElement;
    foot: HTMLElement;
    error: HTMLElement;
    close: () => void;
  } {
    const opener = document.activeElement;
    const id = `rc-dlg-${Math.random().toString(36).slice(2, 8)}`;
    const dialog = h('dialog', {
      class: `rc-dialog${danger ? ' danger' : ''}`,
      attrs: { 'aria-labelledby': id },
    });
    const body = h('div', { class: 'rc-dialog-body' });
    const error = h('p', { class: 'rc-error', attrs: { role: 'alert' } });
    error.hidden = true;
    const foot = h('div', { class: 'rc-dialog-foot' });
    const close = () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      dialog.remove();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
    dialog.append(h('h2', { attrs: { id }, text: title }), body, error, foot);
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close();
    });
    // giữ focus trong hộp (Tab vòng)
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...dialog.querySelectorAll<HTMLElement>('button, input')].filter(
        (x) => !(x as HTMLButtonElement).disabled,
      );
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    this.#root.append(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return { dialog, body, foot, error, close };
  }

  #confirmDownload(t: RecipeType, r: RecipeItem): void {
    const changes = changesOf(t, r, this.#current);
    const m = this.#modal(T.confirmTitle(r.name));
    m.body.append(h('p', { text: T.confirmBody(changes.length) }));
    if (changes.length) {
      const tb = h('tbody');
      for (const c of changes)
        tb.append(
          h(
            'tr',
            { attrs: { 'data-tag': c.param.tag } },
            h('th', { attrs: { scope: 'row' }, text: c.param.label || c.param.tag }),
            h('td', { text: formatValue(c.param, c.from) }),
            h('td', {
              class: 'rc-to',
              text: `${formatValue(c.param, c.to)}${c.param.unit ? ` ${c.param.unit}` : ''}`,
            }),
          ),
        );
      m.body.append(
        h(
          'table',
          { class: 'rc-changes' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { text: T.param, attrs: { scope: 'col' } }),
              h('th', { text: T.from, attrs: { scope: 'col' } }),
              h('th', { text: T.to, attrs: { scope: 'col' } }),
            ),
          ),
          tb,
        ),
      );
    }
    const ok = btn(T.confirm, () => void go(), 'primary', { 'data-act': 'confirm' });
    const cancel = btn(T.cancel, () => m.close());
    m.foot.append(cancel, ok);
    cancel.focus();
    const go = async () => {
      ok.disabled = true;
      let job: Job;
      try {
        job = await this.#d.api.download(t.id, r.id);
      } catch (e) {
        ok.disabled = false;
        this.#apiError(e, m.error);
        if (e instanceof RecipeApiError && e.code === 'RECIPE_INVALID') {
          this.#bad = new Set(e.issues.map((i) => i.tag));
          this.render();
        }
        return;
      }
      m.close();
      await this.#progress(t, r, job);
    };
  }

  async #progress(t: RecipeType, r: RecipeItem, first: Job): Promise<void> {
    const m = this.#modal(T.progressTitle(r.name));
    m.dialog.classList.add('rc-progress');
    const list = h('ol', { class: 'rc-steps', attrs: { 'aria-live': 'polite' } });
    const closeBtn = btn(T.close, () => m.close());
    closeBtn.disabled = true;
    m.body.append(list);
    m.foot.append(closeBtn);
    const draw = (j: Job) => {
      list.replaceChildren(
        ...j.results.map((s) => {
          const p = t.params.find((x) => x.tag === s.tag);
          return h(
            'li',
            { attrs: { 'data-status': s.status, 'data-tag': s.tag } },
            h('span', { class: 'rc-step-name', text: p?.label || s.tag }),
            h('span', { class: 'rc-step-val', text: p ? formatValue(p, s.value) : '' }),
            h('span', {
              class: 'rc-step-st',
              text: `${T.status[s.status] ?? s.status}${s.code && s.status === 'failed' ? ` (${s.code})` : ''}`,
            }),
          );
        }),
      );
    };
    let j = first;
    draw(j);
    while (j.state === 'running') {
      await new Promise((res) => setTimeout(res, this.#d.jobMs ?? 300));
      if (!m.dialog.isConnected) break;
      try {
        j = await this.#d.api.job(j.jobId);
      } catch (e) {
        this.#apiError(e, m.error);
        break;
      }
      draw(j);
    }
    const title = m.dialog.querySelector('h2');
    if (title && j.state !== 'running')
      title.textContent = j.state === 'done' ? T.doneTitle(r.name) : T.failedTitle(r.name);
    m.dialog.dataset.state = j.state;
    closeBtn.disabled = false;
    closeBtn.focus();
    void this.refreshCurrent();
  }

  #apiError(e: unknown, el: HTMLElement): void {
    el.textContent = recipeErrorText(e);
    el.hidden = false;
    if (e instanceof RecipeApiError && e.code === 'CONFLICT') void this.reload();
  }

  #askName(title: string, initial: string, run: (name: string) => Promise<void>): void {
    const m = this.#modal(title);
    const id = `rc-name-${Math.random().toString(36).slice(2, 8)}`;
    const inp = h('input', { attrs: { id, type: 'text', maxlength: '80', 'data-field': 'name' } });
    inp.value = initial;
    m.body.append(h('label', { class: 'rc-field', attrs: { for: id }, text: T.namePrompt }), inp);
    const ok = btn(T.save, () => void submit(), 'primary', { 'data-act': 'confirm' });
    m.foot.append(
      btn(T.cancel, () => m.close()),
      ok,
    );
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void submit();
    });
    inp.focus();
    inp.select();
    const submit = async () => {
      const name = inp.value.trim();
      if (!name) {
        inp.setAttribute('aria-invalid', 'true');
        return;
      }
      ok.disabled = true;
      try {
        await run(name);
        m.close();
      } catch (e) {
        ok.disabled = false;
        this.#apiError(e, m.error);
      }
    };
  }

  #capture(t: RecipeType): void {
    this.#askName(T.captureTitle, '', async (name) => {
      await this.#d.api.capture(t.id, name, this.#list!.rev);
      this.#message = { text: T.captured, tone: 'ok' };
      await this.#reloadSelectNewest(t.id);
    });
  }

  #copy(t: RecipeType, r: RecipeItem): void {
    this.#askName(T.copyTitle(r.name), T.copyName(r.name), async (name) => {
      await this.#d.api.save({ type: t.id, name, values: { ...r.values }, rev: this.#list!.rev });
      this.#message = { text: T.saved, tone: 'ok' };
      await this.#reloadSelectNewest(t.id);
    });
  }

  async #reloadSelectNewest(typeId: string): Promise<void> {
    const before = new Set(this.#type()?.recipes.map((x) => x.id));
    await this.reload();
    const t = this.#list?.types.find((x) => x.id === typeId);
    const added = t?.recipes.find((x) => !before.has(x.id));
    if (added) {
      this.#selected = added.id;
      this.render();
    }
  }

  #remove(t: RecipeType, r: RecipeItem): void {
    const m = this.#modal(T.removeTitle(r.name), true);
    m.body.append(h('p', { text: T.removeBody }));
    const ok = btn(T.remove, () => void go(), 'danger', { 'data-act': 'confirm' });
    const cancel = btn(T.cancel, () => m.close());
    m.foot.append(cancel, ok);
    cancel.focus();
    const go = async () => {
      ok.disabled = true;
      try {
        await this.#d.api.remove(t.id, r.id, this.#list!.rev);
      } catch (e) {
        ok.disabled = false;
        this.#apiError(e, m.error);
        return;
      }
      m.close();
      this.#selected = null;
      this.#message = { text: T.removed, tone: 'ok' };
      await this.reload();
    };
  }

  async #saveEdit(): Promise<void> {
    const t = this.#type();
    const ed = this.#editing;
    const r = t?.recipes.find((x) => x.id === ed?.id);
    if (!t || !ed || !r) return;
    const values: Record<string, RecipeValue> = {};
    const bad = new Set<string>();
    for (const p of t.params) {
      const v = parseInput(p, ed.values[p.tag] ?? '');
      if (v === undefined || valueIssue(p, v) !== null) bad.add(p.tag);
      else values[p.tag] = v;
    }
    this.#bad = bad;
    if (bad.size) {
      this.#message = { text: T.errors.RECIPE_INVALID, tone: 'bad' };
      this.#editing = ed;
      this.#renderForce();
      return;
    }
    try {
      await this.#d.api.save({ type: t.id, id: r.id, name: r.name, values, rev: this.#list!.rev });
    } catch (e) {
      this.#message = { text: recipeErrorText(e), tone: 'bad' };
      if (e instanceof RecipeApiError && e.code === 'RECIPE_INVALID')
        this.#bad = new Set(e.issues.map((i) => i.tag));
      if (e instanceof RecipeApiError && e.code === 'CONFLICT') {
        this.#editing = null;
        await this.reload();
        this.#message = { text: recipeErrorText(e), tone: 'bad' };
      }
      this.#renderForce();
      return;
    }
    this.#editing = null;
    this.#bad.clear();
    this.#message = { text: T.saved, tone: 'ok' };
    await this.reload();
  }

  #renderForce(): void {
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.render();
  }
}

function editText(v: RecipeValue | undefined): string {
  if (v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return String(v);
}

function checkText(p: Parameters<typeof valueIssue>[0], text: string): 'type' | 'limit' | null {
  const v = parseInput(p, text);
  return v === undefined ? 'type' : valueIssue(p, v);
}
