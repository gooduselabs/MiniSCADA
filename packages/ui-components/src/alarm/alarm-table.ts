// <mat-alarm-table> (feature 009, FR-056, FR-058, FR-062, FR-064, FR-066; contracts/ui-alarm.md §4, §7.2, §8, §10):
// thành phần bảng alarm dùng chung cho trang Alarm, widget `alarm-list` và panel "Thử alarm" của Studio.
//  - Dựng bằng `repeat` theo id instance: chỉ hàng đổi mới dựng lại; thay đổi gom bằng một requestAnimationFrame.
//  - Chuỗi của project (text, name, khu vực, lớp, reason, ackUser) chỉ vào DOM bằng nội suy văn bản của Lit (textContent).
//  - Màu lấy từ bảng liệt kê (`AlarmColor`), không ghép chuỗi của project vào lớp CSS hay `style`.
//  - Chế độ `edit` (Studio): không gọi host, không nhấp nháy, không khóa.
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { alarmErrorText, alarmStatusNote, alarmVi } from '../i18n/alarm-vi.ts';
import type {
  ActionHost,
  AlarmAckOutcome,
  AlarmActionOutcome,
  AlarmClassInfo,
  AlarmColor,
  AlarmInstance,
  AlarmSource,
} from '../host/types.ts';
import { installTokens } from '../styles/tokens.ts';
import { alarmLock, type AlarmLock } from './alarm-lock.ts';
import { alarmIcon } from './alarm-icons.ts';
import {
  ALARM_COLUMNS,
  filterInstances,
  formatAlarmClock,
  formatAlarmValue,
  formatRemaining,
  inTab,
  priorityIcon,
  priorityLabel,
  shelvedRemaining,
  sharedBlinkClock,
  sortInstances,
  stateIcon,
  stateKind,
  stateLabel,
  type AlarmColumn,
  type AlarmQuery,
  type AlarmSort,
} from './alarm-format.ts';
import { NO_ALARM_SOURCE } from './alarm-source.ts';

export type AlarmTab = 'active' | 'shelved';

/** Tám màu thiết kế (D24): chỉ giá trị trong bảng này vào thuộc tính `data-color`. */
const COLORS: ReadonlySet<string> = new Set<AlarmColor>([
  'red',
  'orange',
  'amber',
  'blue',
  'purple',
  'teal',
  'gray',
  'green',
]);
const colorOf = (c: AlarmClassInfo | undefined): AlarmColor =>
  c && COLORS.has(c.color) ? c.color : 'gray';

const DEFAULT_COLUMNS: readonly AlarmColumn[] = [
  'time',
  'priority',
  'area',
  'text',
  'value',
  'state',
  'ackUser',
];
const OK_MS = 3000;
const ERR_MS = 8000;

interface Message {
  kind: 'ok' | 'error';
  lines: string[];
}

const raf = (cb: () => void): number => {
  const g = globalThis as { requestAnimationFrame?: (cb: () => void) => number };
  return g.requestAnimationFrame
    ? g.requestAnimationFrame(cb)
    : (setTimeout(cb, 16) as unknown as number);
};
const cancelRaf = (h: number): void => {
  const g = globalThis as { cancelAnimationFrame?: (h: number) => void };
  if (g.cancelAnimationFrame) g.cancelAnimationFrame(h);
  else clearTimeout(h);
};

export class MatAlarmTable extends LitElement {
  static override properties = {
    alarms: { attribute: false },
    host: { attribute: false },
    mode: { reflect: true },
    columns: { attribute: false },
    filter: { attribute: false },
    tab: { reflect: true },
    sort: { attribute: false },
    maxRows: { attribute: false },
    selectable: { type: Boolean },
    showAck: { type: Boolean },
    showShelve: { type: Boolean },
    _selection: { state: true },
    _focusId: { state: true },
    _message: { state: true },
  };

  static override styles = css`
    :host {
      display: block;
      font: 13px/1.35 var(--mat-font, system-ui, sans-serif);
      color: var(--mat-text, #1a2225);
      min-width: 0;
    }
    .wrap {
      overflow: auto;
      max-height: 100%;
    }
    .wrap[data-stale] table {
      opacity: 0.55;
    }
    .note,
    .msg,
    .lock-note {
      margin: 0;
      padding: 6px 10px;
      font-size: 12px;
    }
    .note {
      color: var(--mat-warn, #8f5e00);
      background: var(--mat-warn-soft, #fbefcf);
    }
    .lock-note {
      color: var(--mat-text-muted, #56646a);
    }
    .msg[data-kind='ok'] {
      background: var(--mat-good-soft, #dcf1e3);
      color: var(--mat-text, #1a2225);
    }
    .msg[data-kind='error'] {
      background: var(--mat-bad-soft, #fbe1e1);
      color: var(--mat-text, #1a2225);
    }
    .msg ul {
      margin: 0;
      padding-left: 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      text-align: left;
      padding: 5px 10px;
      border-bottom: 1px solid var(--mat-border, #d2d9dc);
      vertical-align: middle;
    }
    td.text {
      min-width: 160px;
    }
    td.time,
    td.value,
    td.remain {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--mat-surface-2, #f5f7f8);
      color: var(--mat-text-muted, #56646a);
      font-weight: 600;
      white-space: nowrap;
    }
    th button {
      all: unset;
      cursor: pointer;
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }
    th button:focus-visible,
    button.act:focus-visible,
    tr:focus-visible {
      outline: 2px solid var(--mat-accent, #0b7285);
      outline-offset: -2px;
    }
    td.sel,
    th.sel {
      width: 28px;
      padding-right: 0;
    }
    .al-ic {
      vertical-align: -3px;
      margin-right: 4px;
    }
    .sub {
      color: var(--mat-text-muted, #56646a);
      font-size: 11px;
    }
    .empty {
      padding: 14px 12px;
      color: var(--mat-text-muted, #56646a);
    }
    .more {
      padding: 6px 10px;
      color: var(--mat-text-muted, #56646a);
      font-size: 12px;
    }
    button.act {
      font: inherit;
      font-size: 12px;
      cursor: pointer;
      padding: 2px 10px;
      border-radius: var(--mat-radius, 4px);
      border: 1px solid var(--mat-border-strong, #b3bec3);
      background: var(--mat-surface, #fff);
      color: var(--mat-text, #1a2225);
    }
    button.act.primary {
      background: var(--mat-accent, #0b7285);
      border-color: var(--mat-accent, #0b7285);
      color: var(--mat-accent-ink, #fff);
    }
    button.act[aria-disabled='true'] {
      opacity: 0.55;
      cursor: not-allowed;
    }
    td.act {
      white-space: nowrap;
      display: table-cell;
    }
    td.act button + button {
      margin-left: 6px;
    }
    /* Colour classes: fixed whitelist, never built from project strings. */
    tr[data-color='red'] {
      --c: var(--mat-alarm-red);
      --c-soft: var(--mat-alarm-red-soft);
      --c-ink: var(--mat-alarm-red-ink);
    }
    tr[data-color='orange'] {
      --c: var(--mat-alarm-orange);
      --c-soft: var(--mat-alarm-orange-soft);
      --c-ink: var(--mat-alarm-orange-ink);
    }
    tr[data-color='amber'] {
      --c: var(--mat-alarm-amber);
      --c-soft: var(--mat-alarm-amber-soft);
      --c-ink: var(--mat-alarm-amber-ink);
    }
    tr[data-color='blue'] {
      --c: var(--mat-alarm-blue);
      --c-soft: var(--mat-alarm-blue-soft);
      --c-ink: var(--mat-alarm-blue-ink);
    }
    tr[data-color='purple'] {
      --c: var(--mat-alarm-purple);
      --c-soft: var(--mat-alarm-purple-soft);
      --c-ink: var(--mat-alarm-purple-ink);
    }
    tr[data-color='teal'] {
      --c: var(--mat-alarm-teal);
      --c-soft: var(--mat-alarm-teal-soft);
      --c-ink: var(--mat-alarm-teal-ink);
    }
    tr[data-color='gray'] {
      --c: var(--mat-alarm-gray);
      --c-soft: var(--mat-alarm-gray-soft);
      --c-ink: var(--mat-alarm-gray-ink);
    }
    tr[data-color='green'] {
      --c: var(--mat-alarm-green);
      --c-soft: var(--mat-alarm-green-soft);
      --c-ink: var(--mat-alarm-green-ink);
    }
    tbody tr {
      --c: var(--mat-alarm-gray);
      --c-soft: var(--mat-alarm-gray-soft);
      --c-ink: var(--mat-alarm-gray-ink);
    }
    tr[data-state='ACTIVE_UNACK'] {
      background: var(--c);
      color: var(--c-ink);
    }
    tr[data-state='ACTIVE_UNACK'] .sub {
      color: inherit;
    }
    tr[data-state='ACTIVE_UNACK'] button.act:not(.primary) {
      color: inherit;
      background: transparent;
      border-color: currentColor;
    }
    tr[data-state='ACTIVE_ACK'] {
      box-shadow: inset 4px 0 0 var(--c);
      background: var(--c-soft);
    }
    tr[data-state='RTN_UNACK'] {
      outline: 2px dashed var(--c);
      outline-offset: -2px;
    }
    tr[data-state='shelved'],
    tr[data-state='disabled'] {
      color: var(--mat-text-muted, #56646a);
    }
    tr[data-attn] {
      box-shadow: inset 0 0 0 3px var(--mat-warn, #8f5e00);
    }
    /* ADR 056: blink follows the project motion setting, not prefers-reduced-motion. */
    :host([data-blink-phase='off']) tr.blink {
      background: var(--c-soft);
      color: var(--mat-text, #1a2225);
    }
    :host([data-blink-phase='off']) tr.blink .sub,
    :host([data-blink-phase='off']) tr.blink button.act:not(.primary) {
      color: var(--mat-text-muted, #56646a);
    }
    :host([data-blink-still]) tr.blink {
      outline: 3px solid var(--mat-text, #1a2225);
      outline-offset: -3px;
    }
  `;

  declare alarms: AlarmSource | undefined;
  declare host: ActionHost | undefined;
  declare mode: 'run' | 'edit';
  declare columns: readonly AlarmColumn[];
  declare filter: AlarmQuery;
  declare tab: AlarmTab;
  declare sort: AlarmSort | null;
  declare maxRows: number | null;
  declare selectable: boolean;
  declare showAck: boolean;
  declare showShelve: boolean;
  declare _selection: ReadonlySet<string>;
  declare _focusId: string | null;
  declare _message: Message | null;

  #unsub: (() => void) | null = null;
  #rafId = 0;
  #blinkOff: (() => void) | null = null;
  #tick: ReturnType<typeof setInterval> | null = null;
  #msgTimer: ReturnType<typeof setTimeout> | null = null;
  #busy = new Set<string>();
  #attn = new Set<string>();
  #rows: AlarmInstance[] = [];
  #seen = new WeakMap<AlarmInstance, number>();

  constructor() {
    super();
    this.mode = 'run';
    this.columns = DEFAULT_COLUMNS;
    this.filter = {};
    this.tab = 'active';
    this.sort = null;
    this.maxRows = null;
    this.selectable = false;
    this.showAck = false;
    this.showShelve = false;
    this._selection = new Set();
    this._focusId = null;
    this._message = null;
  }

  /** Id instance đang chọn. */
  get selection(): ReadonlySet<string> {
    return this._selection;
  }

  /** Hàng đang hiện sau lọc, theo thứ tự hiển thị (cho "Xác nhận tất cả" của banner và trang). */
  visibleRows(): readonly AlarmInstance[] {
    return this.#compute().rows;
  }

  /** Bỏ mọi hàng đang chọn (sau khi trang xác nhận xong). */
  clearSelection(): void {
    if (this._selection.size > 0) this.#setSelection(new Set());
  }

  focusRow(id: string): void {
    this._focusId = id;
    void this.updateComplete.then(() => {
      this.renderRoot.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(id)}"]`)?.focus();
    });
  }

  /** Hiện kết quả của một thao tác do nơi khác gọi (trang: "Xác nhận tất cả", tạm ẩn). */
  report(outcome: AlarmAckOutcome | AlarmActionOutcome, kind: 'ack' | 'shelve' | 'unshelve'): void {
    if (!outcome.ok && outcome.error) {
      this.#setMessage({ kind: 'error', lines: [alarmErrorText(outcome.error)] }, ERR_MS);
      return;
    }
    if (kind === 'ack' && 'results' in outcome) {
      this.#reportAck(outcome);
      return;
    }
    this.#setMessage(
      { kind: 'ok', lines: [kind === 'shelve' ? alarmVi.state.shelved : alarmVi.unshelve] },
      OK_MS,
    );
  }

  // ---- vòng đời ----------------------------------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    installTokens(this.ownerDocument);
    this.#resubscribe();
    this.setAttribute('role', this.getAttribute('role') ?? 'region');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', alarmVi.tableLabel);
  }

  override disconnectedCallback(): void {
    this.#unsub?.();
    this.#unsub = null;
    this.#blinkOff?.();
    this.#blinkOff = null;
    if (this.#rafId) cancelRaf(this.#rafId);
    this.#rafId = 0;
    this.#stopTick();
    if (this.#msgTimer) clearTimeout(this.#msgTimer);
    this.#msgTimer = null;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('alarms') && this.isConnected) this.#resubscribe();
  }

  protected override updated(): void {
    // Nhấp nháy: chỉ ở chế độ run và khi có hàng nhấp nháy.
    const blink = this.mode !== 'edit' && this.#rows.some((r) => this.#blinks(r));
    if (blink && !this.#blinkOff) {
      this.#blinkOff = sharedBlinkClock(this.ownerDocument).acquire((p) => {
        this.dataset.blinkPhase = p;
        this.toggleAttribute('data-blink-still', sharedBlinkClock(this.ownerDocument).still);
      });
    } else if (!blink && this.#blinkOff) {
      this.#blinkOff();
      this.#blinkOff = null;
      delete this.dataset.blinkPhase;
      this.removeAttribute('data-blink-still');
    }
    // Đếm ngược hạn tạm ẩn mỗi giây (tab Tạm ẩn).
    if (this.tab === 'shelved' && this.#rows.length > 0) this.#startTick();
    else this.#stopTick();
  }

  #resubscribe(): void {
    this.#unsub?.();
    this.#unsub = this.alarms?.subscribe(() => this.#schedule()) ?? null;
  }

  #schedule(): void {
    if (this.#rafId) return;
    this.#rafId = raf(() => {
      this.#rafId = 0;
      this.requestUpdate();
    });
  }

  #startTick(): void {
    if (this.#tick !== null) return;
    this.#tick = setInterval(() => this.requestUpdate(), 1000);
  }
  #stopTick(): void {
    if (this.#tick !== null) clearInterval(this.#tick);
    this.#tick = null;
  }

  // ---- dữ liệu -----------------------------------------------------------------------------------------------------

  #classOf(i: AlarmInstance): AlarmClassInfo | undefined {
    return this.alarms?.classes().find((c) => c.id === i.class);
  }

  #blinks(i: AlarmInstance): boolean {
    return i.state === 'ACTIVE_UNACK' && !i.shelved && this.#classOf(i)?.blink === true;
  }

  #areaName = (id: string | null): string => {
    if (id === null) return alarmVi.areaGeneral;
    return this.alarms?.areas().find((a) => a.id === id)?.name ?? id;
  };

  #compute(): { rows: AlarmInstance[]; hidden: number } {
    const src = this.alarms;
    if (!src) return { rows: [], hidden: 0 };
    const snap = src.snapshot();
    const f: AlarmQuery = { ...this.filter };
    if (this.tab === 'shelved') delete f.states; // instance tạm ẩn có thể ở NORMAL
    let rows = filterInstances(
      snap.instances.filter((i) => inTab(i, this.tab)),
      f,
    );
    rows = sortInstances(rows, this.sort, this.#areaName);
    let hidden = 0;
    if (this.maxRows !== null && rows.length > this.maxRows) {
      hidden = rows.length - this.maxRows;
      rows = rows.slice(0, this.maxRows);
    }
    this.#rows = rows;
    return { rows, hidden };
  }

  // ---- thao tác ----------------------------------------------------------------------------------------------------

  #lock(): AlarmLock | null {
    if (this.mode === 'edit' || !this.host || !this.alarms) return null;
    return alarmLock(this.alarms, this.host);
  }

  #setMessage(m: Message | null, ms = OK_MS): void {
    if (this.#msgTimer) clearTimeout(this.#msgTimer);
    this.#msgTimer = null;
    this._message = m;
    if (m) {
      this.#msgTimer = setTimeout(() => {
        this._message = null;
        this.#attn.clear();
        this.requestUpdate();
      }, ms);
    }
  }

  #reportAck(o: AlarmAckOutcome): void {
    const by = new Map<string, number>();
    for (const r of o.results) {
      by.set(r.result, (by.get(r.result) ?? 0) + 1);
      if (r.result === 'STALE') this.#attn.add(r.id);
    }
    const lines: string[] = [];
    const single = o.results.length === 1;
    for (const [code, n] of by) {
      const text = alarmVi.ackResult[code as keyof typeof alarmVi.ackResult] ?? code;
      lines.push(single ? text : `${text}: ${n}`);
    }
    if (o.skippedNewer > 0) lines.push(alarmVi.skippedNewer(o.skippedNewer));
    if (lines.length === 0) lines.push(alarmVi.ackResult.ACKED);
    const bad = [...by.keys()].some((c) => c === 'STALE' || c === 'NOT_FOUND' || c === 'SHELVED');
    this.#setMessage({ kind: bad ? 'error' : 'ok', lines }, bad ? ERR_MS : OK_MS);
  }

  async #ack(items: readonly { id: string; occurrence: number }[]): Promise<void> {
    const host = this.host;
    if (this.mode === 'edit' || !host || items.length === 0) return;
    const lock = this.#lock();
    if (lock) {
      if (lock.code === 'NO_SESSION') host.requestLogin();
      return;
    }
    for (const i of items) this.#busy.add(i.id);
    this.requestUpdate();
    let outcome: AlarmAckOutcome;
    try {
      outcome = await host.ackAlarms({ items });
    } catch {
      outcome = {
        ok: false,
        error: { code: 'NETWORK', message: alarmVi.err.NETWORK },
        results: [],
        acked: 0,
        skippedNewer: 0,
      };
    }
    for (const i of items) this.#busy.delete(i.id);
    this.report(outcome, 'ack');
    this.dispatchEvent(
      new CustomEvent('mat-alarm-result', {
        detail: { kind: 'ack', outcome },
        bubbles: true,
        composed: true,
      }),
    );
  }

  async #unshelve(id: string): Promise<void> {
    const host = this.host;
    if (this.mode === 'edit' || !host) return;
    const lock = this.#lock();
    if (lock) {
      if (lock.code === 'NO_SESSION') host.requestLogin();
      return;
    }
    this.#busy.add(id);
    this.requestUpdate();
    let outcome: AlarmActionOutcome;
    try {
      outcome = await host.unshelveAlarm(id);
    } catch {
      outcome = { ok: false, error: { code: 'NETWORK', message: alarmVi.err.NETWORK } };
    }
    this.#busy.delete(id);
    this.report(outcome, 'unshelve');
    this.dispatchEvent(
      new CustomEvent('mat-alarm-result', {
        detail: { kind: 'unshelve', outcome },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #setSelection(next: Set<string>): void {
    this._selection = next;
    this.#emit('mat-alarm-selection', [...next]);
  }

  #toggle(id: string): void {
    const next = new Set(this._selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.#setSelection(next);
  }

  #sortBy(col: AlarmColumn): void {
    const cur = this.sort;
    this.sort =
      cur && cur.column === col
        ? { column: col, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { column: col, dir: 'asc' };
    this.#emit('mat-alarm-sort', this.sort);
  }

  /** Feature 040: xác nhận mọi hàng đang hiện còn chưa xác nhận (nút "Xác nhận tất cả" của widget alarm-list). */
  ackAllVisible(): void {
    const items = this.#rows
      .filter((r) => (r.state === 'ACTIVE_UNACK' || r.state === 'RTN_UNACK') && !r.shelved)
      .map((r) => ({ id: r.id, occurrence: r.occurrence }));
    void this.#ack(items);
  }

  /** Số hàng đang hiện còn chưa xác nhận. */
  get unackedVisible(): number {
    return this.#rows.filter(
      (r) => (r.state === 'ACTIVE_UNACK' || r.state === 'RTN_UNACK') && !r.shelved,
    ).length;
  }

  #ackSelectionOrFocus(): void {
    const byId = new Map(this.#rows.map((r) => [r.id, r]));
    let ids = [...this._selection].filter((id) => byId.has(id));
    if (ids.length === 0 && this._focusId && byId.has(this._focusId)) ids = [this._focusId];
    if (ids.length === 0 && this.#rows[0]) ids = [this.#rows[0].id];
    const items = ids
      .map((id) => byId.get(id)!)
      .filter((r) => (r.state === 'ACTIVE_UNACK' || r.state === 'RTN_UNACK') && !r.shelved)
      .map((r) => ({ id: r.id, occurrence: r.occurrence }));
    void this.#ack(items);
  }

  #onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement && e.key === ' ') return; // hộp chọn tự xử lý
    const rows = this.#rows;
    if (rows.length === 0) return;
    const idx = Math.max(
      0,
      rows.findIndex((r) => r.id === (this._focusId ?? rows[0]!.id)),
    );
    const go = (n: number): void => {
      e.preventDefault();
      this.focusRow(rows[Math.min(rows.length - 1, Math.max(0, n))]!.id);
    };
    const key = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if (key === 'ArrowDown') return go(idx + 1);
    if (key === 'ArrowUp') return go(idx - 1);
    if (key === 'Home') return go(0);
    if (key === 'End') return go(rows.length - 1);
    if (key === ' ' && this.selectable && !mod) {
      e.preventDefault();
      this.#toggle(rows[idx]!.id);
      return;
    }
    if (key === 'Escape') {
      if (this._selection.size > 0) this.#setSelection(new Set());
      return;
    }
    if (key.toLowerCase() === 'a' && mod && !e.shiftKey && this.selectable) {
      e.preventDefault();
      this.#setSelection(new Set(rows.map((r) => r.id)));
      return;
    }
    if (key.toLowerCase() === 'a' && mod && e.shiftKey) {
      e.preventDefault();
      this.#emit('mat-alarm-ackall', null);
      return;
    }
    if (key.toLowerCase() === 'a' && e.shiftKey && !mod && !e.altKey) {
      e.preventDefault();
      this.#ackSelectionOrFocus();
      return;
    }
    if (key.toLowerCase() === 's' && !mod && !e.shiftKey && !e.altKey && this.showShelve) {
      e.preventDefault();
      this.#emit('mat-alarm-shelve', { id: rows[idx]!.id });
    }
  }

  // ---- dựng --------------------------------------------------------------------------------------------------------

  protected override render(): TemplateResult {
    const src = this.alarms;
    if (!src) return html`<div class="empty">${alarmVi.emptyNoSource}</div>`;
    const status = src.status();
    const { rows, hidden } = this.#compute();
    // Hạn tạm ẩn: lấy mốc cục bộ khi thấy đối tượng instance lần đầu (instance không đổi giữ nguyên đối tượng).
    const nowLocal = Date.now();
    for (const r of rows) if (!this.#seen.has(r)) this.#seen.set(r, nowLocal);
    const cols = (this.columns.length ? this.columns : DEFAULT_COLUMNS).filter((c) =>
      (ALARM_COLUMNS as readonly string[]).includes(c),
    );
    const selectable = this.selectable && this.mode !== 'edit';
    const lock = this.#lock();
    const hasAckable = rows.some((r) => r.state === 'ACTIVE_UNACK' || r.state === 'RTN_UNACK');
    const focusId =
      this._focusId && rows.some((r) => r.id === this._focusId) ? this._focusId : rows[0]?.id;
    // Chọn chỉ giữ hàng còn hiện.
    if (this._selection.size > 0) {
      const alive = new Set(rows.map((r) => r.id));
      const kept = [...this._selection].filter((id) => alive.has(id));
      if (kept.length !== this._selection.size) {
        queueMicrotask(() => this.#setSelection(new Set(kept)));
      }
    }
    const note = alarmStatusNote(status);
    const stale = status === 'stale' || status === 'offline';
    const showLock = this.showAck && this.mode !== 'edit' && lock && hasAckable;
    const empty =
      rows.length === 0
        ? status === 'unsupported'
          ? alarmVi.unsupported
          : status === 'none'
            ? alarmVi.emptyNoConfig
            : this.tab === 'shelved'
              ? alarmVi.emptyShelved
              : alarmVi.empty
        : null;
    const msg = this._message;
    const withActions = this.mode !== 'edit' && (this.showAck || this.showShelve);
    return html`<div class="wrap" ?data-stale=${stale}>
      ${note && rows.length > 0 ? html`<p class="note" role="status">${note}</p>` : nothing}
      ${
        msg
          ? html`<div
              class="msg"
              data-msg
              data-kind=${msg.kind}
              role=${msg.kind === 'error' ? 'alert' : 'status'}
            >
              <ul>
                ${msg.lines.map((l) => html`<li>${l}</li>`)}
              </ul>
            </div>`
          : nothing
      }
      ${showLock ? html`<p class="lock-note">${lock.message}</p>` : nothing}
      <table
        role="table"
        aria-label=${alarmVi.tableLabel}
        @keydown=${(e: KeyboardEvent) => this.#onKey(e)}
      >
        <thead>
          <tr>
            ${
              selectable
                ? html`<th class="sel" scope="col">
                    <input
                      type="checkbox"
                      aria-label=${alarmVi.selectAll}
                      .checked=${rows.length > 0 && rows.every((r) => this._selection.has(r.id))}
                      @click=${(e: Event) =>
                        this.#setSelection(
                          (e.target as HTMLInputElement).checked
                            ? new Set(rows.map((r) => r.id))
                            : new Set(),
                        )}
                    />
                  </th>`
                : nothing
            }
            ${cols.map((c) => this.#head(c))}
            ${withActions ? html`<th scope="col">${alarmVi.actions}</th>` : nothing}
          </tr>
        </thead>
        <tbody>
          ${repeat(
            rows,
            (r) => r.id,
            (r) => this.#row(r, cols, selectable, withActions, r.id === focusId, lock),
          )}
        </tbody>
      </table>
      ${empty ? html`<div class="empty">${empty}</div>` : nothing}
      ${hidden > 0 ? html`<div class="more">${alarmVi.more(hidden)}</div>` : nothing}
      ${
        note && rows.length === 0 && status !== 'unsupported' && status !== 'none'
          ? html`<p class="note" role="status">${note}</p>`
          : nothing
      }
    </div>`;
  }

  #head(c: AlarmColumn): TemplateResult {
    const label =
      c === 'ackUser' && this.tab === 'shelved' ? alarmVi.col.remaining : alarmVi.col[c];
    const s = this.sort;
    const active = s && s.column === c;
    const aria = active ? (s.dir === 'asc' ? 'ascending' : 'descending') : nothing;
    return html`<th scope="col" aria-sort=${aria}>
      <button
        type="button"
        data-col=${c}
        title=${`${alarmVi.sortBy} ${label}`}
        @click=${() => this.#sortBy(c)}
      >
        ${label}${active ? html`<span aria-hidden="true">${s.dir === 'asc' ? '▲' : '▼'}</span>` : nothing}
      </button>
    </th>`;
  }

  #cell(c: AlarmColumn, r: AlarmInstance, kind: ReturnType<typeof stateKind>): TemplateResult {
    switch (c) {
      case 'time':
        return html`<td class="time">
          ${formatAlarmClock(r.tsActive, this.alarms?.now() ?? Date.now())}${
            r.clockOk ? nothing : html` <span class="sub">(${alarmVi.clockUnsynced})</span>`
          }
        </td>`;
      case 'priority':
        return html`<td class="prio">
          ${alarmIcon(priorityIcon(r.priority))}${priorityLabel(r.priority)}
        </td>`;
      case 'area':
        return html`<td class="area">${this.#areaName(r.area)}</td>`;
      case 'text':
        return html`<td class="text">${r.text}</td>`;
      case 'value':
        return html`<td class="value">${formatAlarmValue(r.valueActive)}</td>`;
      case 'state':
        return html`<td class="state">
          ${alarmIcon(stateIcon(kind))}${stateLabel(kind, r.inputBad)}${
            r.disabled && kind !== 'disabled'
              ? html` <span class="sub">· ${alarmVi.state.disabled}</span>`
              : nothing
          }
        </td>`;
      case 'ackUser':
        if (this.tab === 'shelved') {
          const since = this.#seen.get(r) ?? Date.now();
          return html`<td class="remain">
            ${formatRemaining(shelvedRemaining(r, Date.now() - since))}
          </td>`;
        }
        return html`<td class="ackUser">${r.ackUser ?? ''}</td>`;
    }
  }

  #row(
    r: AlarmInstance,
    cols: readonly AlarmColumn[],
    selectable: boolean,
    withActions: boolean,
    focus: boolean,
    lock: AlarmLock | null,
  ): TemplateResult {
    const kind = stateKind(r);
    const cls = this.#classOf(r);
    const blink = this.mode !== 'edit' && this.#blinks(r);
    const busy = this.#busy.has(r.id);
    return html`<tr
      data-id=${r.id}
      data-state=${kind}
      data-color=${colorOf(cls)}
      class=${blink ? 'blink' : ''}
      tabindex=${focus ? 0 : -1}
      aria-busy=${busy ? 'true' : nothing}
      ?data-attn=${this.#attn.has(r.id)}
      @focus=${() => {
        this._focusId = r.id;
      }}
    >
      ${
        selectable
          ? html`<td class="sel">
              <input
                type="checkbox"
                aria-label=${alarmVi.selectRow(r.name)}
                .checked=${this._selection.has(r.id)}
                @click=${() => this.#toggle(r.id)}
              />
            </td>`
          : nothing
      }
      ${cols.map((c) => this.#cell(c, r, kind))}
      ${withActions ? this.#actions(r, kind, busy, lock) : nothing}
    </tr>`;
  }

  #actions(
    r: AlarmInstance,
    kind: ReturnType<typeof stateKind>,
    busy: boolean,
    lock: AlarmLock | null,
  ): TemplateResult {
    const ackable = this.showAck && (kind === 'ACTIVE_UNACK' || kind === 'RTN_UNACK');
    const unshelvable = this.showShelve && kind === 'shelved';
    const shelvable = this.showShelve && !r.shelved && !r.disabled;
    const locked = lock !== null;
    return html`<td class="act">
      ${
        ackable
          ? html`<button
              type="button"
              class="act primary"
              data-act="ack"
              aria-disabled=${locked || busy ? 'true' : 'false'}
              title=${lock?.message ?? ''}
              @click=${() => void this.#ack([{ id: r.id, occurrence: r.occurrence }])}
            >
              ${busy ? alarmVi.ackSending : alarmVi.ack}
            </button>`
          : nothing
      }
      ${
        shelvable
          ? html`<button
              type="button"
              class="act"
              data-act="shelve"
              aria-disabled=${locked ? 'true' : 'false'}
              title=${lock?.message ?? ''}
              @click=${() => {
                if (lock) {
                  if (lock.code === 'NO_SESSION') this.host?.requestLogin();
                  return;
                }
                this.#emit('mat-alarm-shelve', { id: r.id });
              }}
            >
              ${alarmVi.shelve}
            </button>`
          : nothing
      }
      ${
        unshelvable
          ? html`<button
              type="button"
              class="act"
              data-act="unshelve"
              aria-disabled=${locked || busy ? 'true' : 'false'}
              title=${lock?.message ?? ''}
              @click=${() => void this.#unshelve(r.id)}
            >
              ${alarmVi.unshelve}
            </button>`
          : nothing
      }
    </td>`;
  }
}

/** Đăng ký `<mat-alarm-table>` (idempotent). */
export function registerAlarmTable(): void {
  if (!customElements.get('mat-alarm-table'))
    customElements.define('mat-alarm-table', MatAlarmTable);
}

export { NO_ALARM_SOURCE };
