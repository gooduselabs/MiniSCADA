// Trang Lịch sử alarm `#/alarm-history` (feature 009, FR-060, FR-061; contracts/ui-alarm.md §12).
//  - Khoảng nhanh (1 giờ, 8 giờ, 24 giờ mặc định, 7 ngày, 30 ngày) theo GIỜ THIẾT BỊ (`AlarmSource.now()`), hoặc từ–đến (giờ trình
//    duyệt, tối đa 366 ngày; vượt thì hiện lý do, không gửi).
//  - Bộ lọc như `GET /api/v1/alarms/history`; phân trang bằng `beforeId` (100 dòng mỗi lần, không OFFSET); sắp xếp cột chỉ trên
//    các trang đã tải; "Theo dõi" tải lại trang đầu khi nguồn alarm đổi (gộp ≤ 1 lần/2 s), mặc định tắt.
//  - Xuất CSV theo bộ lọc hiện hành (csv.ts); mọi chuỗi vào DOM bằng textContent.
import {
  PRIORITY_RANK,
  alarmVi,
  createAlarmIcon,
  formatAlarmValue,
  formatRemaining,
  priorityIcon,
  priorityLabel,
  type AlarmPriority,
  type AlarmSource,
} from '@mat/ui-components';
import { vi } from '../i18n/vi.ts';
import {
  CsvCancelled,
  csvFileName,
  downloadBlob,
  exportHistoryCsv,
  type HistoryItem,
  type HistoryPage as HistoryResult,
} from './csv.ts';

const PAGE = 100;
const MAX_RANGE_MS = 366 * 86_400_000;
const FOLLOW_MS = 2000;
const RANGES = {
  '1h': 3_600_000,
  '8h': 8 * 3_600_000,
  '24h': 24 * 3_600_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
} as const;
type RangeKey = keyof typeof RANGES;

export interface HistoryQuery {
  from: number;
  to: number;
  limit: number;
  beforeId?: number;
  area?: string;
  priority?: string;
  state?: string;
  alarmId?: string;
  q?: string;
}

/** Chuỗi truy vấn theo thứ tự cố định; khóa trống bị bỏ. */
export function buildHistoryQuery(q: HistoryQuery): string {
  const p = new URLSearchParams();
  p.set('from', String(q.from));
  p.set('to', String(q.to));
  p.set('limit', String(q.limit));
  if (q.beforeId !== undefined) p.set('beforeId', String(q.beforeId));
  for (const k of ['area', 'priority', 'state', 'alarmId', 'q'] as const) {
    const v = q[k];
    if (v) p.set(k, v);
  }
  return p.toString();
}

class HistoryApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type Col =
  'tsActive' | 'ack' | 'tsReturn' | 'duration' | 'value' | 'priority' | 'area' | 'text' | 'state';
const COLS: readonly Col[] = [
  'tsActive',
  'ack',
  'tsReturn',
  'duration',
  'value',
  'priority',
  'area',
  'text',
  'state',
];

export interface HistoryPageOptions {
  source: AlarmSource;
  fetch?: typeof fetch;
  doc?: Document;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  download?: (blob: Blob, name: string) => void;
}

const p2 = (n: number): string => String(n).padStart(2, '0');
const localInput = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
const full = (ms: number): string => {
  const d = new Date(ms);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};
const clock = (ms: number): string => {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
};

export class HistoryPage {
  readonly el: HTMLElement;
  readonly #o: HistoryPageOptions;
  readonly #doc: Document;
  readonly #fetch: typeof fetch;
  readonly #set: (fn: () => void, ms: number) => unknown;
  readonly #clear: (h: unknown) => void;
  readonly #download: (blob: Blob, name: string) => void;
  readonly #rangeBtns = new Map<RangeKey, HTMLButtonElement>();
  readonly #from: HTMLInputElement;
  readonly #to: HTMLInputElement;
  readonly #area: HTMLSelectElement;
  readonly #prio: HTMLSelectElement;
  readonly #state: HTMLSelectElement;
  readonly #alarmId: HTMLInputElement;
  readonly #q: HTMLInputElement;
  readonly #follow: HTMLInputElement;
  readonly #err: HTMLElement;
  readonly #body: HTMLTableSectionElement;
  readonly #heads = new Map<Col, HTMLTableCellElement>();
  readonly #more: HTMLButtonElement;
  readonly #loadedText: HTMLElement;
  readonly #csvBtn: HTMLButtonElement;
  readonly #progress: HTMLElement;
  #progressBar: HTMLProgressElement;
  #progressText: HTMLElement;
  #range: RangeKey | null = '24h';
  #items: HistoryItem[] = [];
  #hasMore = false;
  #next: number | null = null;
  #seq = 0;
  #sort: { col: Col; dir: 'asc' | 'desc' } | null = null;
  #unsub: (() => void) | null = null;
  #followTimer: unknown = null;
  #lastLoad = 0;
  #abort: AbortController | null = null;
  #shown = false;

  constructor(o: HistoryPageOptions) {
    this.#o = o;
    const d = (this.#doc = o.doc ?? document);
    this.#fetch = o.fetch ?? ((...a) => fetch(...a));
    this.#set = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clear = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.#download = o.download ?? ((b, n) => downloadBlob(b, n, d));
    const h = vi.alarm.history;
    this.el = d.createElement('section');
    this.el.className = 'al-page al-history';
    this.el.hidden = true;
    this.el.setAttribute('aria-labelledby', 'al-hist-title');
    const title = d.createElement('h2');
    title.id = 'al-hist-title';
    title.textContent = h.title;

    const bar = d.createElement('div');
    bar.className = 'al-filters';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', h.rangeLabel);
    for (const [k, label] of [
      ['1h', h.r1h],
      ['8h', h.r8h],
      ['24h', h.r24h],
      ['7d', h.r7d],
      ['30d', h.r30d],
    ] as const) {
      const b = d.createElement('button');
      b.type = 'button';
      b.className = 'al-btn';
      b.dataset.range = k;
      b.textContent = label;
      b.addEventListener('click', () => {
        this.#range = k;
        this.#applyRange();
        void this.#reload();
      });
      this.#rangeBtns.set(k, b);
      bar.append(b);
    }
    this.#from = this.#dtInput('from', h.from);
    this.#to = this.#dtInput('to', h.to);
    bar.append(this.#label(h.from, this.#from), this.#label(h.to, this.#to));

    const bar2 = d.createElement('div');
    bar2.className = 'al-filters';
    this.#area = this.#select(bar2, 'area', h.area, [['', h.allAreas]]);
    this.#prio = this.#select(bar2, 'priority', h.minPriority, [
      ['', h.minFrom(priorityLabel('advisory'))],
      ['minor', h.minFrom(priorityLabel('minor'))],
      ['major', h.minFrom(priorityLabel('major'))],
      ['critical', h.minFrom(priorityLabel('critical'))],
    ]);
    this.#state = this.#select(bar2, 'state', h.finalState, [
      ['', h.stateAll],
      ['active', h.stateActive],
      ['acked', h.stateAcked],
      ['closed', h.stateClosed],
    ]);
    this.#alarmId = d.createElement('input');
    this.#alarmId.type = 'text';
    this.#alarmId.dataset.f = 'alarmId';
    this.#alarmId.placeholder = h.alarmId;
    this.#alarmId.setAttribute('aria-label', h.alarmId);
    this.#alarmId.addEventListener('change', () => void this.#reload());
    this.#q = d.createElement('input');
    this.#q.type = 'search';
    this.#q.placeholder = vi.alarm.filters.searchPlaceholder;
    this.#q.setAttribute('aria-label', vi.alarm.filters.searchLabel);
    this.#q.addEventListener('change', () => void this.#reload());
    this.#follow = d.createElement('input');
    this.#follow.type = 'checkbox';
    this.#follow.dataset.f = 'follow';
    this.#follow.addEventListener('change', () => this.#setFollow(this.#follow.checked));
    const followLabel = d.createElement('label');
    followLabel.className = 'al-follow';
    followLabel.append(this.#follow, h.follow);
    this.#csvBtn = d.createElement('button');
    this.#csvBtn.type = 'button';
    this.#csvBtn.className = 'al-btn';
    this.#csvBtn.dataset.act = 'csv';
    this.#csvBtn.textContent = h.exportCsv;
    this.#csvBtn.addEventListener('click', () => void this.#exportCsv());
    bar2.append(this.#alarmId, this.#q, followLabel, this.#csvBtn);

    this.#err = d.createElement('div');
    this.#err.className = 'al-err';
    this.#err.dataset.err = '';
    this.#err.setAttribute('role', 'alert');

    this.#progress = d.createElement('div');
    this.#progress.className = 'al-progress';
    this.#progress.hidden = true;
    this.#progressBar = d.createElement('progress');
    this.#progressText = d.createElement('span');
    const cancel = d.createElement('button');
    cancel.type = 'button';
    cancel.className = 'al-btn';
    cancel.textContent = vi.alarm.csv.cancel;
    cancel.addEventListener('click', () => this.#abort?.abort());
    this.#progress.append(this.#progressBar, this.#progressText, cancel);

    const table = d.createElement('table');
    table.className = 'al-hist';
    table.setAttribute('aria-label', h.title);
    const thead = d.createElement('thead');
    const tr = d.createElement('tr');
    for (const c of COLS) {
      const th = d.createElement('th');
      th.scope = 'col';
      const b = d.createElement('button');
      b.type = 'button';
      b.dataset.col = c;
      b.textContent = h.col[c === 'duration' ? 'duration' : c === 'ack' ? 'ack' : c];
      b.addEventListener('click', () => this.#sortBy(c));
      th.append(b);
      this.#heads.set(c, th);
      tr.append(th);
    }
    thead.append(tr);
    this.#body = d.createElement('tbody');
    table.append(thead, this.#body);
    const wrap = d.createElement('div');
    wrap.className = 'al-hist-wrap';
    wrap.append(table);

    const foot = d.createElement('div');
    foot.className = 'al-actions';
    this.#more = d.createElement('button');
    this.#more.type = 'button';
    this.#more.className = 'al-btn';
    this.#more.dataset.act = 'more';
    this.#more.textContent = h.more(PAGE);
    this.#more.hidden = true;
    this.#more.addEventListener('click', () => void this.#loadMore());
    this.#loadedText = d.createElement('span');
    this.#loadedText.className = 'al-muted';
    this.#loadedText.dataset.loaded = '';
    foot.append(this.#more, this.#loadedText);

    this.el.append(title, bar, bar2, this.#err, this.#progress, wrap, foot);
    this.#fillAreas();
    this.#applyRange();
  }

  show(): void {
    this.el.hidden = false;
    if (!this.#shown) {
      this.#shown = true;
      void this.#reload();
    }
  }

  hide(): void {
    this.el.hidden = true;
  }

  dispose(): void {
    this.#setFollow(false);
    this.#abort?.abort();
  }

  // ---- dựng nhỏ ----------------------------------------------------------------------------------------------------

  #dtInput(name: string, label: string): HTMLInputElement {
    const i = this.#doc.createElement('input');
    i.type = 'datetime-local';
    i.dataset.f = name;
    i.setAttribute('aria-label', label);
    i.addEventListener('change', () => {
      this.#range = null;
      this.#syncRangeButtons();
      void this.#reload();
    });
    return i;
  }

  #label(text: string, input: HTMLElement): HTMLElement {
    const l = this.#doc.createElement('label');
    l.className = 'al-follow';
    l.append(`${text} `, input);
    return l;
  }

  #select(
    parent: HTMLElement,
    name: string,
    label: string,
    opts: Array<[string, string]>,
  ): HTMLSelectElement {
    const s = this.#doc.createElement('select');
    s.dataset.f = name;
    s.setAttribute('aria-label', label);
    for (const [v, t] of opts) s.append(this.#opt(v, t));
    s.addEventListener('change', () => void this.#reload());
    parent.append(s);
    return s;
  }

  #opt(v: string, t: string): HTMLOptionElement {
    const o = this.#doc.createElement('option');
    o.value = v;
    o.textContent = t;
    return o;
  }

  #fillAreas(): void {
    const cur = this.#area.value;
    this.#area.replaceChildren(
      this.#opt('', vi.alarm.history.allAreas),
      ...this.#o.source.areas().map((a) => this.#opt(a.id, a.name)),
      this.#opt('-', alarmVi.areaGeneral),
    );
    this.#area.value = cur;
  }

  // ---- khoảng và truy vấn ------------------------------------------------------------------------------------------

  #syncRangeButtons(): void {
    for (const [k, b] of this.#rangeBtns) b.setAttribute('aria-pressed', String(this.#range === k));
  }

  /** Khoảng nhanh theo giờ thiết bị; ghi vào hai ô từ–đến. */
  #applyRange(): void {
    if (this.#range) {
      const now = this.#o.source.now();
      this.#from.value = localInput(now - RANGES[this.#range]);
      this.#to.value = localInput(now);
    }
    this.#syncRangeButtons();
  }

  #span(): { from: number; to: number } | null {
    if (this.#range) {
      const now = this.#o.source.now();
      return { from: now - RANGES[this.#range], to: now };
    }
    const from = new Date(this.#from.value).getTime();
    const to = new Date(this.#to.value).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return { from, to };
  }

  #filters(): Omit<HistoryQuery, 'from' | 'to' | 'limit'> {
    const f: Omit<HistoryQuery, 'from' | 'to' | 'limit'> = {};
    if (this.#area.value) f.area = this.#area.value;
    if (this.#prio.value) f.priority = this.#prio.value;
    if (this.#state.value) f.state = this.#state.value;
    if (this.#alarmId.value.trim()) f.alarmId = this.#alarmId.value.trim();
    if (this.#q.value.trim()) f.q = this.#q.value.trim();
    return f;
  }

  #showError(code: string | null): void {
    const e = vi.alarm.history.err;
    this.#err.textContent =
      code === null
        ? ''
        : code === 'rangeTooLong'
          ? vi.alarm.history.rangeTooLong
          : code === 'rangeInvalid'
            ? vi.alarm.history.rangeInvalid
            : code === 'BAD_QUERY' ||
                code === 'ALARM_HISTORY_BUSY' ||
                code === 'ALARM_LOG_UNAVAILABLE' ||
                code === 'NETWORK'
              ? e[code]
              : e.unknown(code);
  }

  async #get(q: HistoryQuery): Promise<HistoryResult> {
    let res: Response;
    try {
      res = await this.#fetch(`/api/v1/alarms/history?${buildHistoryQuery(q)}`, {
        cache: 'no-store',
      });
    } catch {
      throw new HistoryApiError('NETWORK');
    }
    const body: unknown = await res.json().catch(() => null);
    const b = body as Record<string, unknown> | null;
    if (!res.ok) {
      throw new HistoryApiError(b && typeof b.error === 'string' ? b.error : `HTTP_${res.status}`);
    }
    if (!b || !Array.isArray(b.items)) throw new HistoryApiError('BAD_RESPONSE');
    return {
      items: b.items as HistoryItem[],
      hasMore: b.hasMore === true,
      nextBeforeId: typeof b.nextBeforeId === 'number' ? b.nextBeforeId : null,
    };
  }

  // ---- tải ---------------------------------------------------------------------------------------------------------

  async #reload(): Promise<void> {
    this.#applyRange();
    this.#fillAreas();
    const span = this.#span();
    if (!span) return;
    if (span.from >= span.to) return this.#showError('rangeInvalid');
    if (span.to - span.from > MAX_RANGE_MS) return this.#showError('rangeTooLong');
    this.#showError(null);
    const seq = ++this.#seq;
    this.#lastLoad = Date.now();
    try {
      const page = await this.#get({ ...span, limit: PAGE, ...this.#filters() });
      if (seq !== this.#seq) return;
      this.#items = page.items;
      this.#hasMore = page.hasMore;
      this.#next = page.nextBeforeId;
    } catch (e) {
      if (seq !== this.#seq) return;
      this.#items = [];
      this.#hasMore = false;
      this.#showError(e instanceof HistoryApiError ? e.code : 'NETWORK');
    }
    this.#render();
  }

  async #loadMore(): Promise<void> {
    const span = this.#span();
    if (!span || this.#next === null) return;
    const seq = this.#seq;
    try {
      const page = await this.#get({
        ...span,
        limit: PAGE,
        beforeId: this.#next,
        ...this.#filters(),
      });
      if (seq !== this.#seq) return;
      this.#items = [...this.#items, ...page.items];
      this.#hasMore = page.hasMore;
      this.#next = page.nextBeforeId;
    } catch (e) {
      this.#showError(e instanceof HistoryApiError ? e.code : 'NETWORK');
    }
    this.#render();
  }

  // ---- Theo dõi ----------------------------------------------------------------------------------------------------

  #setFollow(on: boolean): void {
    this.#unsub?.();
    this.#unsub = null;
    if (this.#followTimer !== null) this.#clear(this.#followTimer);
    this.#followTimer = null;
    if (!on) return;
    this.#unsub = this.#o.source.subscribe(() => {
      if (this.#followTimer !== null) return;
      const wait = Math.max(0, this.#lastLoad + FOLLOW_MS - Date.now());
      this.#followTimer = this.#set(() => {
        this.#followTimer = null;
        void this.#reload();
      }, wait);
    });
  }

  // ---- bảng --------------------------------------------------------------------------------------------------------

  #sortBy(c: Col): void {
    const s = this.#sort;
    this.#sort =
      s && s.col === c ? { col: c, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col: c, dir: 'asc' };
    this.#render();
  }

  #areaName(id: string | null): string {
    return id === null || id === ''
      ? alarmVi.areaGeneral
      : (this.#o.source.areas().find((a) => a.id === id)?.name ?? id);
  }

  #stateText(i: HistoryItem): string {
    const h = vi.alarm.history;
    if (i.closedBy === 'config') return h.closedConfig;
    if (i.closedBy === 'disabled') return h.closedDisabled;
    if (i.closedBy === 'restart-lost') return h.closedRestart;
    return i.tsReturn === null || i.state === 'active' ? h.stateOpen : h.stateReturned;
  }

  #key(i: HistoryItem, c: Col): number | string {
    switch (c) {
      case 'tsActive':
        return i.tsActive;
      case 'ack':
        return i.tsAck ?? -1;
      case 'tsReturn':
        return i.tsReturn ?? Number.MAX_SAFE_INTEGER;
      case 'duration':
        return i.tsReturn === null ? -1 : i.tsReturn - i.tsActive;
      case 'value':
        return typeof i.valueActive === 'number' ? i.valueActive : String(i.valueActive ?? '');
      case 'priority':
        return -PRIORITY_RANK[i.priority];
      case 'area':
        return this.#areaName(i.area);
      case 'text':
        return i.text;
      case 'state':
        return this.#stateText(i);
    }
  }

  #render(): void {
    const d = this.#doc;
    const s = this.#sort;
    let list = this.#items;
    if (s) {
      const dir = s.dir === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => {
        const x = this.#key(a, s.col);
        const y = this.#key(b, s.col);
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        if (typeof x === 'number') return -1;
        if (typeof y === 'number') return 1;
        return x.localeCompare(y, 'vi') * dir;
      });
    }
    for (const [c, th] of this.#heads) {
      if (s && s.col === c)
        th.setAttribute('aria-sort', s.dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    }
    const trs: HTMLElement[] = [];
    for (const i of list) {
      const tr = d.createElement('tr');
      const td = (text: string, cls?: string): HTMLTableCellElement => {
        const c = d.createElement('td');
        c.textContent = text;
        if (cls) c.className = cls;
        return c;
      };
      const prio = d.createElement('td');
      prio.append(
        createAlarmIcon(priorityIcon(i.priority as AlarmPriority), 14, d),
        d.createTextNode(` ${priorityLabel(i.priority as AlarmPriority)}`),
      );
      tr.append(
        td(
          i.clockOk ? full(i.tsActive) : `${full(i.tsActive)} (${vi.alarm.history.clockUnsynced})`,
        ),
        td(i.tsAck === null ? '' : `${clock(i.tsAck)}${i.ackUser ? ` · ${i.ackUser}` : ''}`),
        td(i.tsReturn === null ? '' : full(i.tsReturn)),
        td(i.tsReturn === null ? '' : formatRemaining(i.tsReturn - i.tsActive)),
        td(formatAlarmValue(i.valueActive)),
        prio,
        td(this.#areaName(i.area)),
        td(i.text),
        td(this.#stateText(i)),
      );
      trs.push(tr);
    }
    this.#body.replaceChildren(...trs);
    this.#more.hidden = !this.#hasMore;
    this.#loadedText.textContent = this.#items.length
      ? vi.alarm.history.loaded(this.#items.length)
      : '';
  }

  // ---- CSV ---------------------------------------------------------------------------------------------------------

  async #exportCsv(): Promise<void> {
    const span = this.#span();
    if (!span || span.from >= span.to || span.to - span.from > MAX_RANGE_MS || this.#abort) return;
    this.#showError(null);
    const ac = new AbortController();
    this.#abort = ac;
    this.#csvBtn.disabled = true;
    this.#progress.hidden = false;
    this.#progressBar.removeAttribute('value');
    const filters = this.#filters();
    const c = vi.alarm.csv;
    try {
      const r = await exportHistoryCsv({
        names: {
          area: (id) => this.#areaName(id),
          cls: (id) => this.#o.source.classes().find((x) => x.id === id)?.name ?? id,
        },
        signal: ac.signal,
        onProgress: (n) => {
          this.#progressText.textContent = c.progress(n);
        },
        fetchPage: (beforeId) =>
          this.#get({
            ...span,
            limit: 500,
            ...(beforeId !== undefined ? { beforeId } : {}),
            ...filters,
          }),
      });
      this.#download(r.blob, csvFileName(span.from, span.to));
      this.#progressText.textContent = r.truncated ? c.truncated(r.rows, '') : c.done(r.rows);
      if (r.truncated) this.#err.textContent = c.truncated(r.rows, '');
    } catch (e) {
      if (e instanceof CsvCancelled) this.#progressText.textContent = c.cancelled;
      else this.#showError(e instanceof HistoryApiError ? e.code : 'NETWORK');
    } finally {
      this.#abort = null;
      this.#csvBtn.disabled = false;
      if (this.#err.textContent !== '' || this.#progressText.textContent === c.cancelled)
        this.#progress.hidden = true;
    }
  }
}
