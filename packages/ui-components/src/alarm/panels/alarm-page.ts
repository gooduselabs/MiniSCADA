// Trang Alarm `#/alarms` (feature 009, FR-055 đến FR-058, FR-064, FR-065; contracts/ui-alarm.md §7, §10).
// Bố cục dọc: tiêu đề, tab (Đang có, Tạm ẩn), thanh lọc, thanh hành động, bảng dùng chung `<mat-alarm-table>`.
//  - Bộ lọc và sắp xếp giữ qua tải lại nhờ sessionStorage (bọc try/catch) và qua hộp đăng nhập (DOM của trang không bị dựng lại).
//  - Xác nhận hàng chọn: gửi ngay, không hộp. "Xác nhận tất cả": hộp nêu số lượng và bộ lọc; gửi `upToRevision` của lúc MỞ HỘP.
//  - Tạm ẩn: hộp có lý do (≤ 120, đếm ký tự) và thời lượng (mặc định 1 giờ); lỗi SHELVE_RANGE hiện ở đúng ô (`field`).
//  - Khóa (viewer, chưa đăng nhập, mất kết nối) không chặn xem; nút `aria-disabled` kèm lý do.
import { alarmErrorText, alarmVi } from '../../i18n/alarm-vi.ts';
import { alarmLock } from '../alarm-lock.ts';
import {
  filterInstances,
  priorityLabel,
  PRIORITY_RANK,
  type AlarmColumn,
  type AlarmQuery,
  type AlarmSort,
} from '../alarm-format.ts';
import { registerAlarmTable, type MatAlarmTable } from '../alarm-table.ts';
import type {
  ActionHost,
  AlarmFilter,
  AlarmInstance,
  AlarmPriority,
  AlarmSource,
} from '../../host/types.ts';
import type { ListState } from '../alarm-widget-props.ts';
import { alarmPanelVi as P } from '../../i18n/alarm-panel-vi.ts';

const KEY = 'mat.alarm.page';
const PRIORITIES = ['critical', 'major', 'minor', 'advisory'] as const;
const STATE_MAP = {
  unack: ['ACTIVE_UNACK'],
  ack: ['ACTIVE_ACK'],
  rtn: ['RTN_UNACK'],
} as const;
type StateKey = keyof typeof STATE_MAP;

interface PageState {
  tab: 'active' | 'shelved';
  area: string;
  cls: string;
  prio: string;
  state: '' | StateKey;
  q: string;
  sort: AlarmSort | null;
}
const DEFAULT: PageState = {
  tab: 'active',
  area: '',
  cls: '',
  prio: '',
  state: '',
  q: '',
  sort: null,
};

export interface AlarmPageOptions {
  source: AlarmSource;
  host: ActionHost;
  doc?: Document;
  storage?: () => Storage | null;
  /** Khóa lưu bộ lọc (sessionStorage). `null`: không lưu (widget). Mặc định khóa của trang hệ thống. */
  storageKey?: string | null;
  /** Tiêu đề h2. `null`: không có tiêu đề (widget). Mặc định "Alarm". */
  title?: string | null;
  /** Feature 041: bộ lọc cố định của widget alarm-list (luôn áp dụng, người dùng chỉ thu hẹp thêm). */
  fixed?: AlarmFixedFilter;
  /** Cột của bảng (widget); vắng: cột mặc định của bảng. */
  columns?: readonly AlarmColumn[];
  /** Nơi gắn hộp thoại (widget: trong shadow root để có CSS). Mặc định document.body. */
  dialogRoot?: HTMLElement;
}

/** Bộ lọc cố định (props `areas`, `classes`, `minPriority`, `states` của widget alarm-list). Mảng rỗng: không giới hạn. */
export interface AlarmFixedFilter {
  areas?: readonly string[];
  classes?: readonly string[];
  minPriority?: AlarmPriority;
  states?: readonly ListState[];
}

/** Giao hai giới hạn: chọn của người dùng (một giá trị hoặc rỗng) và tập cố định (rỗng = mọi). */
function narrow<T extends string>(pick: T | '', fixed: readonly T[] | undefined): T[] | undefined {
  const f = fixed && fixed.length ? fixed : null;
  if (pick) return f && !f.includes(pick) ? ([] as T[]) : [pick];
  return f ? [...f] : undefined;
}

const isAckable = (i: AlarmInstance): boolean =>
  (i.state === 'ACTIVE_UNACK' || i.state === 'RTN_UNACK') && !i.shelved;

interface Dialog {
  root: HTMLElement;
  box: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close(): void;
}

export class AlarmPage {
  readonly el: HTMLElement;
  readonly #o: AlarmPageOptions;
  readonly #doc: Document;
  readonly #table: MatAlarmTable;
  readonly #tabs: HTMLButtonElement[] = [];
  readonly #selects = new Map<string, HTMLSelectElement>();
  readonly #q: HTMLInputElement;
  readonly #btn = new Map<string, HTMLButtonElement>();
  readonly #selText: HTMLElement;
  readonly #lockNote: HTMLElement;
  #st: PageState;
  #sel = new Set<string>();
  #unsub: () => void;
  #busy = false;
  get #key(): string | null {
    return this.#o.storageKey === undefined ? KEY : this.#o.storageKey;
  }

  constructor(o: AlarmPageOptions) {
    this.#o = o;
    const d = (this.#doc = o.doc ?? document);
    this.#st = this.#load();
    registerAlarmTable();
    this.el = d.createElement('section');
    this.el.className = 'al-page';
    this.el.hidden = true;
    const h = d.createElement('h2');
    if (o.title !== null) {
      this.el.setAttribute('aria-labelledby', 'al-page-title');
      h.id = 'al-page-title';
    } else this.el.setAttribute('aria-label', P.pageTitle);
    h.textContent = o.title ?? P.pageTitle;

    const tabs = d.createElement('div');
    tabs.className = 'al-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', P.tabsLabel);
    for (const key of ['active', 'shelved'] as const) {
      const b = d.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.tab = key;
      b.addEventListener('click', () => {
        this.#st.tab = key;
        this.#save();
        this.#sync();
      });
      this.#tabs.push(b);
      tabs.append(b);
    }

    const f = P.filters;
    const bar = d.createElement('div');
    bar.className = 'al-filters';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', f.label);
    const mkSelect = (name: string, label: string): HTMLSelectElement => {
      const s = d.createElement('select');
      s.dataset.f = name;
      s.setAttribute('aria-label', label);
      s.addEventListener('change', () => {
        (this.#st as unknown as Record<string, string>)[name] = s.value;
        this.#save();
        this.#sync();
      });
      this.#selects.set(name, s);
      bar.append(s);
      return s;
    };
    mkSelect('area', f.area);
    mkSelect('cls', f.cls);
    mkSelect('prio', f.priority);
    const stateSel = mkSelect('state', f.state);
    for (const [v, t] of [
      ['', f.allStates],
      ['unack', f.unack],
      ['ack', f.ack],
      ['rtn', f.rtn],
    ] as const)
      stateSel.append(this.#option(v, t));
    this.#q = d.createElement('input');
    this.#q.type = 'search';
    this.#q.placeholder = f.searchPlaceholder;
    this.#q.setAttribute('aria-label', f.searchLabel);
    this.#q.addEventListener('input', () => {
      this.#st.q = this.#q.value;
      this.#save();
      this.#sync();
    });
    const clear = this.#button('clear', f.clear, () => {
      this.#st = { ...DEFAULT, tab: this.#st.tab, sort: this.#st.sort };
      this.#applyControls();
      this.#save();
      this.#sync();
    });
    bar.append(this.#q, clear);

    const a = P.actions;
    const actions = d.createElement('div');
    actions.className = 'al-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', a.label);
    this.#selText = d.createElement('span');
    this.#selText.dataset.sel = '';
    this.#selText.className = 'al-muted';
    this.#lockNote = d.createElement('span');
    this.#lockNote.dataset.lock = '';
    this.#lockNote.className = 'al-lock';
    const hint = d.createElement('span');
    hint.className = 'al-muted al-hint';
    hint.textContent = a.keyHint;
    actions.append(
      this.#button('ack', a.ack, () => void this.#ackSelected()),
      this.#button('ackall', a.ackAll, () => this.#openAckAll()),
      this.#button('shelve', a.shelve, () => this.#shelveSelected()),
      this.#selText,
      this.#lockNote,
      hint,
    );

    this.#table = d.createElement('mat-alarm-table') as MatAlarmTable;
    this.#table.alarms = o.source;
    this.#table.host = o.host;
    this.#table.selectable = true;
    this.#table.showAck = true;
    this.#table.showShelve = true;
    this.#table.addEventListener('mat-alarm-selection', (e) => {
      this.#sel = new Set((e as CustomEvent<string[]>).detail);
      this.#sync();
    });
    this.#table.addEventListener('mat-alarm-sort', (e) => {
      this.#st.sort = (e as CustomEvent<AlarmSort>).detail;
      this.#save();
    });
    this.#table.addEventListener('mat-alarm-ackall', () => this.#openAckAll());
    this.#table.addEventListener('mat-alarm-shelve', (e) => {
      const id = (e as CustomEvent<{ id: string }>).detail.id;
      const row = o.source.snapshot().instances.find((i) => i.id === id);
      if (row) this.#openShelve(row);
    });

    if (o.columns?.length) this.#table.columns = o.columns;
    if (o.title === null) this.el.append(tabs, bar, actions, this.#table);
    else this.el.append(h, tabs, bar, actions, this.#table);
    this.#fillOptions();
    this.#applyControls();
    this.#unsub = o.source.subscribe(() => {
      this.#fillOptions();
      this.#sync();
    });
    this.#sync();
  }

  show(): void {
    this.el.hidden = false;
    this.#sync();
  }

  hide(): void {
    this.el.hidden = true;
  }

  /** Gọi khi phiên đổi (khóa nút tính lại). */
  refresh(): void {
    this.#sync();
  }

  dispose(): void {
    this.#unsub();
  }

  // ---- trạng thái lưu ----------------------------------------------------------------------------------------------

  #load(): PageState {
    try {
      const raw =
        this.#key === null
          ? null
          : (this.#o.storage ? this.#o.storage() : sessionStorage)?.getItem(this.#key);
      if (raw) {
        const v = JSON.parse(raw) as Partial<PageState>;
        const s: PageState = { ...DEFAULT };
        if (v.tab === 'shelved') s.tab = 'shelved';
        for (const k of ['area', 'cls', 'prio', 'q'] as const)
          if (typeof v[k] === 'string') s[k] = v[k]!;
        if (v.state && v.state in STATE_MAP) s.state = v.state;
        if (
          v.sort &&
          typeof v.sort.column === 'string' &&
          (v.sort.dir === 'asc' || v.sort.dir === 'desc')
        )
          s.sort = v.sort;
        return s;
      }
    } catch {
      /* cửa sổ riêng tư */
    }
    return { ...DEFAULT };
  }

  #save(): void {
    try {
      if (this.#key === null) return;
      (this.#o.storage ? this.#o.storage() : sessionStorage)?.setItem(
        this.#key,
        JSON.stringify(this.#st),
      );
    } catch {
      /* không lưu được: trang vẫn chạy */
    }
  }

  // ---- dựng điều khiển ---------------------------------------------------------------------------------------------

  #option(value: string, label: string): HTMLOptionElement {
    const o = this.#doc.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }

  #button(act: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = this.#doc.createElement('button');
    b.type = 'button';
    b.className = 'al-btn';
    b.dataset.act = act;
    b.textContent = label;
    b.addEventListener('click', onClick);
    this.#btn.set(act, b);
    return b;
  }

  /** Danh sách chọn theo khu vực và lớp của project (đổi khi snapshot mới). */
  #fillOptions(): void {
    const f = P.filters;
    const src = this.#o.source;
    const fill = (name: string, items: Array<[string, string]>): void => {
      const s = this.#selects.get(name)!;
      const cur = s.value || this.#st[name as 'area' | 'cls' | 'prio'];
      s.replaceChildren(...items.map(([v, t]) => this.#option(v, t)));
      s.value = items.some(([v]) => v === cur) ? cur : '';
    };
    const fx = this.#o.fixed ?? {};
    const okArea = (id: string): boolean => !fx.areas?.length || fx.areas.includes(id);
    const okCls = (id: string): boolean => !fx.classes?.length || fx.classes.includes(id);
    const minRank = fx.minPriority ? PRIORITY_RANK[fx.minPriority] : null;
    fill('area', [
      ['', f.allAreas],
      ...src
        .areas()
        .filter((x) => okArea(x.id))
        .map((x): [string, string] => [x.id, x.name]),
      ...(okArea('-') ? [['-', alarmVi.areaGeneral] as [string, string]] : []),
    ]);
    fill('cls', [
      ['', f.allClasses],
      ...src
        .classes()
        .filter((x) => okCls(x.id))
        .map((x): [string, string] => [x.id, x.name]),
    ]);
    fill('prio', [
      ['', f.allPriorities],
      ...PRIORITIES.filter((p) => minRank === null || PRIORITY_RANK[p] >= minRank).map(
        (p): [string, string] => [p, priorityLabel(p)],
      ),
    ]);
  }

  #applyControls(): void {
    for (const [name, s] of this.#selects)
      s.value = this.#st[name as 'area' | 'cls' | 'prio' | 'state'];
    this.#q.value = this.#st.q;
  }

  #query(): AlarmQuery {
    const q: AlarmQuery = {};
    const s = this.#st;
    const fx = this.#o.fixed ?? {};
    // Mảng rỗng sau khi giao = không alarm nào khớp; filterInstances coi [] là "mọi" nên dùng giá trị không tồn tại.
    const none = <T>(v: T[]): T[] => (v.length ? v : [' ' as T]);
    const areas = narrow(s.area, fx.areas);
    if (areas) q.areas = none(areas);
    const classes = narrow(s.cls, fx.classes);
    if (classes) q.classes = none(classes);
    const minRank = fx.minPriority ? PRIORITY_RANK[fx.minPriority] : null;
    const allowedPrio =
      minRank === null ? undefined : PRIORITIES.filter((p) => PRIORITY_RANK[p] >= minRank);
    const prios = narrow(s.prio as '' | AlarmPriority, allowedPrio);
    if (prios) q.priorities = none(prios);
    const fxStates = fx.states?.length ? fx.states : null;
    if (s.state || fxStates) {
      const picked: readonly ListState[] = s.state
        ? STATE_MAP[s.state]
        : ['ACTIVE_UNACK', 'ACTIVE_ACK', 'RTN_UNACK'];
      q.states = none(picked.filter((x) => !fxStates || fxStates.includes(x)));
    }
    if (s.q.trim()) q.q = s.q.trim();
    return q;
  }

  /** Đẩy trạng thái xuống bảng và cập nhật tab, số chọn, khóa. */
  #sync(): void {
    const src = this.#o.source;
    const c = src.counts();
    this.#tabs[0]!.textContent = P.tabActive(c.active);
    this.#tabs[1]!.textContent = P.tabShelved(c.shelved);
    this.#tabs.forEach((b, i) => {
      const on = this.#st.tab === (i === 0 ? 'active' : 'shelved');
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.#table.tab = this.#st.tab;
    this.#table.filter = this.#query();
    this.#table.sort = this.#st.sort;
    const rows = this.#table.visibleRows();
    const ackable = rows.some(isAckable);
    const lock = alarmLock(src, this.#o.host);
    for (const act of ['ack', 'ackall', 'shelve'] as const) {
      const b = this.#btn.get(act)!;
      b.setAttribute('aria-disabled', String(lock !== null || this.#busy));
      b.title = lock?.message ?? '';
    }
    this.#lockNote.textContent = lock && ackable ? lock.message : '';
    this.#selText.textContent = this.#sel.size > 0 ? P.actions.selected(this.#sel.size) : '';
  }

  // ---- thao tác ----------------------------------------------------------------------------------------------------

  /** Khóa chung: trả true nếu bị khóa (chưa đăng nhập thì mở hộp đăng nhập, không mất bộ lọc). */
  #locked(): boolean {
    const lock = alarmLock(this.#o.source, this.#o.host);
    if (!lock) return false;
    if (lock.code === 'NO_SESSION') this.#o.host.requestLogin();
    return true;
  }

  async #ackSelected(): Promise<void> {
    if (this.#locked() || this.#sel.size === 0) return;
    const byId = new Map(this.#table.visibleRows().map((r) => [r.id, r]));
    const items = [...this.#sel]
      .map((id) => byId.get(id))
      .filter((r): r is AlarmInstance => r !== undefined && isAckable(r))
      .map((r) => ({ id: r.id, occurrence: r.occurrence }));
    if (items.length === 0) return;
    const outcome = await this.#o.host.ackAlarms({ items });
    this.#table.report(outcome, 'ack');
    if (outcome.ok) this.#table.clearSelection();
  }

  #filterText(): string {
    const f = P.filters;
    const s = this.#st;
    const parts: string[] = [];
    if (s.area)
      parts.push(
        f.summaryArea(
          s.area === '-'
            ? alarmVi.areaGeneral
            : (this.#o.source.areas().find((a) => a.id === s.area)?.name ?? s.area),
        ),
      );
    if (s.cls)
      parts.push(
        f.summaryClass(this.#o.source.classes().find((c) => c.id === s.cls)?.name ?? s.cls),
      );
    if (s.prio) parts.push(f.summaryPriority(priorityLabel(s.prio as (typeof PRIORITIES)[number])));
    if (s.state) parts.push(f.summaryState({ unack: f.unack, ack: f.ack, rtn: f.rtn }[s.state]));
    if (s.q.trim()) parts.push(f.summaryText(s.q.trim()));
    return parts.length ? ` (${parts.join(', ')})` : '';
  }

  #openAckAll(): void {
    if (this.#locked()) return;
    const src = this.#o.source;
    const revision = src.snapshot().revision; // chỉ alarm đã hiện lúc mở hộp được xác nhận
    const q = this.#query();
    const wanted = (q.states ?? ['ACTIVE_UNACK', 'RTN_UNACK']).filter(
      (s): s is 'ACTIVE_UNACK' | 'RTN_UNACK' => s === 'ACTIVE_UNACK' || s === 'RTN_UNACK',
    );
    const rows = filterInstances(
      this.#table.visibleRows().filter((r) => isAckable(r)),
      { ...q, states: wanted.length ? wanted : ['ACTIVE_ACK'] },
    );
    const n = wanted.length ? rows.length : 0;
    const a = P.ackAll;
    const dlg = this.#dialog(a.title);
    const p = this.#doc.createElement('p');
    p.textContent = n > 0 ? a.body(n, this.#filterText()) : a.none;
    const note = this.#doc.createElement('p');
    note.className = 'al-muted';
    note.textContent = a.note;
    dlg.body.append(p, note);
    const cancel = this.#dlgButton(a.cancel, 'cancel', () => dlg.close());
    dlg.footer.append(cancel);
    if (n > 0) {
      const ok = this.#dlgButton(a.confirm(n), 'confirm', () => {
        void (async () => {
          ok.disabled = true;
          const filter: AlarmFilter = { states: wanted };
          if (q.areas) filter.areas = q.areas;
          if (q.classes) filter.classes = q.classes;
          if (q.priorities) filter.priorities = q.priorities;
          if (q.q) filter.q = q.q;
          const outcome = await this.#o.host.ackAlarms({
            all: true,
            upToRevision: revision,
            filter,
          });
          dlg.close();
          this.#table.report(outcome, 'ack');
          if (outcome.ok) this.#table.clearSelection();
        })();
      });
      ok.classList.add('primary');
      dlg.footer.append(ok);
    }
    this.#focusFirst(dlg);
  }

  #shelveSelected(): void {
    if (this.#locked() || this.#sel.size !== 1) return;
    const id = [...this.#sel][0]!;
    const row = this.#table.visibleRows().find((r) => r.id === id);
    if (row) this.#openShelve(row);
  }

  #openShelve(row: AlarmInstance): void {
    if (this.#locked()) return;
    const s = P.shelve;
    const d = this.#doc;
    const dlg = this.#dialog(s.title);
    const who = d.createElement('div');
    who.dataset.alarm = '';
    const nm = d.createElement('b');
    nm.textContent = row.name;
    const idEl = d.createElement('span');
    idEl.className = 'al-muted al-mono';
    idEl.textContent = ` ${row.id}`;
    const txt = d.createElement('div');
    txt.textContent = row.text;
    who.append(nm, idEl, txt);

    const rid = 'al-shelve-reason';
    const rl = d.createElement('label');
    rl.htmlFor = rid;
    rl.textContent = s.reason;
    const reason = d.createElement('input');
    reason.id = rid;
    reason.type = 'text';
    reason.maxLength = 120;
    reason.dataset.f = 'reason';
    const count = d.createElement('span');
    count.dataset.count = '';
    count.className = 'al-muted';
    count.textContent = s.count(0);
    const rerr = this.#err('reason');
    reason.addEventListener('input', () => {
      count.textContent = s.count([...reason.value].length);
      rerr.textContent = '';
    });

    const dl = d.createElement('div');
    dl.textContent = s.duration;
    const group = d.createElement('div');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', s.duration);
    let minutes = 60;
    const durBtns: HTMLButtonElement[] = [];
    const minIn = d.createElement('input');
    minIn.type = 'text';
    minIn.inputMode = 'numeric';
    minIn.dataset.f = 'minutes';
    minIn.placeholder = s.minutesPlaceholder;
    minIn.setAttribute('aria-label', s.minutesLabel);
    const merr = this.#err('minutes');
    for (const [m, label] of [
      [15, s.d15],
      [60, s.d60],
      [240, s.d240],
      [480, s.d480],
    ] as const) {
      const b = d.createElement('button');
      b.type = 'button';
      b.dataset.dur = String(m);
      b.textContent = label;
      b.setAttribute('aria-pressed', String(m === minutes));
      b.addEventListener('click', () => {
        minutes = m;
        minIn.value = '';
        merr.textContent = '';
        for (const x of durBtns) x.setAttribute('aria-pressed', String(x === b));
      });
      durBtns.push(b);
      group.append(b);
    }
    minIn.addEventListener('input', () => {
      merr.textContent = '';
      if (minIn.value.trim() !== '')
        for (const x of durBtns) x.setAttribute('aria-pressed', 'false');
    });
    const orL = d.createElement('div');
    orL.append(`${s.or} `, minIn, ` ${s.minutesUnit}`);
    const hint = d.createElement('p');
    hint.className = 'al-muted';
    hint.textContent = s.hint;
    const ferr = this.#err('form');
    dlg.body.append(who, rl, reason, count, rerr, dl, group, orL, merr, hint, ferr);

    const cancel = this.#dlgButton(s.cancel, 'cancel', () => dlg.close());
    const ok = this.#dlgButton(s.confirm, 'confirm', () => {
      void (async () => {
        rerr.textContent = merr.textContent = ferr.textContent = '';
        const text = reason.value.trim();
        let dur = minutes;
        let bad = false;
        if ([...text].length < 1 || [...text].length > 120) {
          rerr.textContent = s.reasonRequired;
          bad = true;
        }
        if (minIn.value.trim() !== '') {
          const n = Number(minIn.value.trim());
          if (!/^\d+$/.test(minIn.value.trim()) || n < 1 || n > 480) {
            merr.textContent = s.minutesRange;
            bad = true;
          } else dur = n;
        }
        if (bad) return;
        ok.disabled = true;
        const out = await this.#o.host.shelveAlarm({
          id: row.id,
          reason: text,
          durationS: dur * 60,
        });
        ok.disabled = false;
        if (out.ok) {
          dlg.close();
          this.#table.report(out, 'shelve');
          this.#table.clearSelection();
          return;
        }
        const e = out.error ?? { code: 'unknown', message: '' };
        const msg = alarmErrorText(e);
        if (e.code === 'SHELVE_RANGE' && e.field === 'reason') rerr.textContent = msg;
        else if (e.code === 'SHELVE_RANGE' && e.field === 'durationS') merr.textContent = msg;
        else ferr.textContent = msg;
      })();
    });
    ok.classList.add('primary');
    dlg.footer.append(cancel, ok);
    reason.focus();
  }

  #err(name: string): HTMLElement {
    const e = this.#doc.createElement('div');
    e.className = 'al-err';
    e.dataset.err = name;
    e.setAttribute('role', 'alert');
    return e;
  }

  #dlgButton(label: string, act: string, onClick: () => void): HTMLButtonElement {
    const b = this.#doc.createElement('button');
    b.type = 'button';
    b.className = 'al-btn';
    b.dataset.act = act;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  #focusFirst(dlg: Dialog): void {
    dlg.box.querySelector<HTMLElement>('button')?.focus();
  }

  /** Hộp thoại modal: role=dialog, aria-modal, bẫy focus, Esc đóng, trả focus về nút đã gọi. */
  #dialog(label: string): Dialog {
    const d = this.#doc;
    const opener = d.activeElement;
    const root = d.createElement('div');
    root.className = 'al-overlay';
    const box = d.createElement('div');
    box.className = 'al-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', label);
    const head = d.createElement('h3');
    head.textContent = label;
    const body = d.createElement('div');
    body.className = 'al-dialog-body';
    const footer = d.createElement('div');
    footer.className = 'al-dialog-footer';
    box.append(head, body, footer);
    root.append(box);
    const close = (): void => {
      root.remove();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const f = [...box.querySelectorAll<HTMLElement>('button, input, select')].filter(
        (x) => !x.hasAttribute('disabled'),
      );
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      const act = d.activeElement;
      if (e.shiftKey && act === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && act === last) {
        e.preventDefault();
        first.focus();
      }
    });
    root.addEventListener('mousedown', (e) => {
      if (e.target === root) close();
    });
    (this.#o.dialogRoot ?? d.body).append(root);
    return { root, box, body, footer, close };
  }
}
