// Trang lịch sử `#/history` (feature 010, FR-036; T087): chọn nhóm lưu trữ, tối đa 16 Tag và khoảng; biểu đồ
// (`history-trend`, ≤ 8 đường số/bool) và bảng (`history-table`) dùng chung lựa chọn. Lựa chọn nằm trong đường dẫn
// (`#/history?g=…&t=…&r=…`, ghi bằng replace) nên F5 và liên kết dán lại cho cùng hình. Mọi chữ do DOM API đặt
// bằng textContent (tên nhóm, Tag có thể chứa mã HTML).
import {
  isRangeKey,
  type ActionHost,
  type HistoryCatalog,
  type HistoryCatalogGroup,
  type HistorySource,
  type TagSource,
  type RangeKey,
} from '@mat/ui-components';
import type { WidgetItem } from '@mat/project-schema';
import { viHist } from './i18n/vi-history.ts';

export const HISTORY_MAX_TAGS = 16;
const TREND_MAX = 8;
const DEFAULT_PICK = 4;

export interface HistoryPageOptions {
  container: HTMLElement;
  history: HistorySource;
  tags: TagSource;
  host: ActionHost;
  /** Ghi đường dẫn mới (replaceState); không thêm mục lịch sử. */
  onUrl: (hash: string) => void;
}

interface Selection {
  group: string;
  tags: string[];
  range: RangeKey;
}

type WidgetEl = HTMLElement & Record<string, unknown>;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class HistoryPage {
  readonly #o: HistoryPageOptions;
  #params = new URLSearchParams();
  #cat: HistoryCatalog | null = null;
  #sel: Selection = { group: '', tags: [], range: '24h' };
  #trend: WidgetEl | null = null;
  #table: WidgetEl | null = null;
  #unsub: (() => void) | null = null;
  #disposed = false;
  #seq = 0;
  #ac: AbortController | null = null;
  #loading = false;
  #state: 'ok' | 'login' | 'other' = 'other';
  #boxes: HTMLInputElement[] = [];
  #hint: HTMLElement | null = null;
  #chart: HTMLElement | null = null;
  #tableBox: HTMLElement | null = null;

  constructor(o: HistoryPageOptions) {
    this.#o = o;
    this.#unsub = o.history.onState((s) => {
      if (this.#disposed || o.container.hidden) return;
      if (s === 'ready' && this.#state !== 'ok' && !this.#loading) void this.#load();
    });
  }

  async show(params: URLSearchParams): Promise<void> {
    this.#params = params;
    this.#o.container.hidden = false;
    await this.#load();
  }

  #abort(): void {
    this.#ac?.abort();
    this.#ac = null;
  }

  hide(): void {
    this.#seq++; // kết quả muộn của lần tải bị hủy không được vẽ vào trang đã ẩn
    this.#loading = false;
    this.#abort();
    this.#o.container.hidden = true;
  }

  dispose(): void {
    this.#abort();
    this.#disposed = true;
    this.#unsub?.();
    this.#unsub = null;
    this.#o.container.replaceChildren();
    this.#trend = this.#table = null;
  }

  // ---- tải danh mục ------------------------------------------------------------------------------------------

  async #load(): Promise<void> {
    const seq = ++this.#seq;
    this.#abort();
    const ac = new AbortController();
    this.#ac = ac;
    this.#loading = true;
    this.#o.container.replaceChildren(this.#heading(), el('p', 'hint', '…'));
    this.#trend = this.#table = null;
    let cat: HistoryCatalog;
    try {
      cat = await this.#o.history.catalog(ac.signal);
    } catch (e) {
      if (seq !== this.#seq || this.#disposed) return;
      this.#loading = false;
      this.#fail(e);
      return;
    }
    if (seq !== this.#seq || this.#disposed) return;
    this.#loading = false;
    this.#cat = cat;
    if (!cat.enabled) return this.#message(viHist.disabled, 'other');
    if (cat.groups.length === 0) return this.#message(viHist.noGroups, 'other');
    this.#state = 'ok';
    this.#build(cat);
  }

  #heading(): HTMLElement {
    return el('h2', 'hist-title', viHist.pageTitle);
  }

  #message(
    text: string,
    kind: 'login' | 'other',
    button?: { cls: string; label: string; fn: () => void },
  ): void {
    this.#state = kind;
    const p = el('p', 'hist-msg', text);
    p.setAttribute('role', 'status');
    const nodes: HTMLElement[] = [this.#heading(), p];
    if (button) {
      const b = el('button', `btn ${button.cls}`, button.label);
      b.type = 'button';
      b.addEventListener('click', button.fn);
      nodes.push(b);
    }
    this.#o.container.replaceChildren(...nodes);
  }

  #fail(e: unknown): void {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'HTTPS_REQUIRED') return this.#message(viHist.insecure, 'login');
    if (code === 'AUTH_REQUIRED' || code === 'SESSION_EXPIRED' || code === 'SESSION_INVALID') {
      return this.#message(viHist.loginRequired, 'login', {
        cls: 'login',
        label: viHist.loginButton,
        fn: () =>
          this.#o.history.requestLogin
            ? this.#o.history.requestLogin()
            : this.#o.host.requestLogin(),
      });
    }
    if (code === 'NO_HISTORY') return this.#message(viHist.disabled, 'other');
    if (code === 'BUSY') return this.#message(viHist.busy, 'other');
    this.#message(viHist.loadError, 'other', {
      cls: 'retry',
      label: viHist.retry,
      fn: () => void this.#load(),
    });
  }

  // ---- giao diện chọn ----------------------------------------------------------------------------------------

  #groupOf(id: string): HistoryCatalogGroup | undefined {
    return this.#cat?.groups.find((g) => g.id === id);
  }

  /** Lựa chọn ban đầu từ đường dẫn; phần không hợp lệ bị bỏ. */
  #initialSelection(cat: HistoryCatalog): Selection {
    const gq = this.#params.get('g') ?? '';
    const group = cat.groups.find((g) => g.id === gq) ?? cat.groups[0]!;
    const rq = this.#params.get('r') ?? '';
    const range: RangeKey = isRangeKey(rq) ? rq : '24h';
    const known = new Set(group.tags.map((t) => t.tagId));
    const asked = (this.#params.get('t') ?? '')
      .split(',')
      .filter((t, i, a) => t !== '' && known.has(t) && a.indexOf(t) === i)
      .slice(0, HISTORY_MAX_TAGS);
    return { group: group.id, tags: asked.length ? asked : this.#defaultTags(group), range };
  }

  #defaultTags(g: HistoryCatalogGroup): string[] {
    return g.tags
      .filter((t) => t.type !== 'STRING')
      .slice(0, DEFAULT_PICK)
      .map((t) => t.tagId);
  }

  #build(cat: HistoryCatalog): void {
    this.#sel = this.#initialSelection(cat);

    const select = el('select');
    select.id = 'hist-group';
    for (const g of cat.groups) {
      const o = el('option', undefined, g.name);
      o.value = g.id;
      select.append(o);
    }
    select.value = this.#sel.group;
    select.addEventListener('change', () => {
      const g = this.#groupOf(select.value);
      if (!g) return;
      this.#sel = { group: g.id, tags: this.#defaultTags(g), range: this.#sel.range };
      this.#renderTags();
      this.#apply();
    });
    const gl = el('label', 'hist-field', viHist.group + ' ');
    gl.htmlFor = 'hist-group';
    gl.append(select);

    const fs = el('fieldset', 'hist-tags');
    fs.append(el('legend', undefined, viHist.tags));
    const list = el('div', 'hist-taglist');
    fs.append(list);
    this.#hint = el('p', 'hint');
    this.#hint.setAttribute('aria-live', 'polite');
    fs.append(this.#hint);
    this.#chart = el('div', 'hist-chart');
    this.#tableBox = el('div', 'hist-table');
    const sec = el('section', 'hist-page');
    sec.setAttribute('aria-label', viHist.pageTitle);
    sec.append(gl, fs, this.#chart, this.#tableBox);
    this.#o.container.replaceChildren(this.#heading(), sec);
    this.#tagList = list;
    this.#renderTags();
    this.#apply();
  }

  #tagList: HTMLElement | null = null;

  #renderTags(): void {
    const g = this.#groupOf(this.#sel.group);
    if (!g || !this.#tagList) return;
    this.#boxes = [];
    const rows = g.tags.map((t) => {
      const lab = el('label', 'hist-tag');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.value = t.tagId;
      cb.checked = this.#sel.tags.includes(t.tagId);
      cb.addEventListener('change', () => this.#toggle(t.tagId, cb.checked));
      lab.append(cb, el('span', undefined, ` ${t.tagId}${t.unit ? ` (${t.unit})` : ''}`));
      this.#boxes.push(cb);
      return lab;
    });
    this.#tagList.replaceChildren(...rows);
    this.#syncLimit();
  }

  #toggle(tagId: string, on: boolean): void {
    const cur = this.#sel.tags.filter((t) => t !== tagId);
    if (on && cur.length < HISTORY_MAX_TAGS) cur.push(tagId);
    // giữ thứ tự theo danh sách của nhóm
    const order = this.#groupOf(this.#sel.group)?.tags.map((t) => t.tagId) ?? [];
    this.#sel = { ...this.#sel, tags: order.filter((t) => cur.includes(t)) };
    this.#syncLimit();
    this.#apply();
  }

  #syncLimit(): void {
    const n = this.#sel.tags.length;
    for (const b of this.#boxes) b.disabled = !b.checked && n >= HISTORY_MAX_TAGS;
    if (this.#hint) {
      this.#hint.textContent = n === 0 ? viHist.tagsNone : viHist.tagsHint(n, HISTORY_MAX_TAGS);
    }
  }

  // ---- widget ------------------------------------------------------------------------------------------------

  #item(
    id: string,
    widget: string,
    slot: string,
    tags: string[],
    props: WidgetItem['props'],
  ): WidgetItem {
    return {
      type: 'widget',
      id,
      widget,
      x: 0,
      y: 0,
      width: 900,
      height: 360,
      tags: { [slot]: tags },
      props,
    };
  }

  #make(tag: string, item: WidgetItem): WidgetEl {
    const w = document.createElement(tag) as WidgetEl;
    w.item = item;
    w.source = this.#o.tags;
    w.host = this.#o.host;
    w.history = this.#o.history;
    w.mode = 'run';
    w.context = { screen: 'history', widget: item.id };
    return w;
  }

  #apply(skipTrend = false): void {
    const { group, tags, range } = this.#sel;
    const numeric = tags
      .filter((id) => this.#groupOf(group)?.tags.find((t) => t.tagId === id)?.type !== 'STRING')
      .slice(0, TREND_MAX);
    // URL
    const p = new URLSearchParams({ g: group, t: tags.join(','), r: range });
    this.#o.onUrl(`#/history?${p.toString()}`);

    if (tags.length === 0) {
      this.#trend = this.#table = null;
      this.#chart?.replaceChildren();
      this.#tableBox?.replaceChildren();
      return;
    }
    const tprops = { group, range, follow: true, controls: true, legend: true, showBand: true };
    if (skipTrend) {
      // chỉ đổi khoảng do chính biểu đồ báo: biểu đồ đã tự áp, không dựng lại
    } else if (numeric.length === 0) {
      this.#trend = null;
      this.#chart?.replaceChildren();
    } else if (!this.#trend) {
      this.#trend = this.#make(
        'mat-w-history-trend',
        this.#item('hist-trend', 'history-trend', 'series', numeric, tprops),
      );
      this.#trend.addEventListener('mat-history-range', (e) => {
        const r = (e as CustomEvent<{ range: string }>).detail.range;
        if (!isRangeKey(r)) return;
        this.#sel = { ...this.#sel, range: r };
        this.#apply(true);
      });
      this.#chart?.replaceChildren(this.#trend);
    } else {
      this.#trend.item = this.#item('hist-trend', 'history-trend', 'series', numeric, tprops);
    }
    const bprops = { group, range, pageSize: 100, order: 'desc', controls: false };
    const bitem = this.#item('hist-table', 'history-table', 'columns', tags, bprops);
    if (!this.#table) {
      this.#table = this.#make('mat-w-history-table', bitem);
      this.#tableBox?.replaceChildren(this.#table);
    } else {
      this.#table.item = bitem;
    }
  }
}
