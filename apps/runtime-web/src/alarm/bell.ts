// Chuông cảnh báo, bảng thông báo và toast khẩn cấp của trang vận hành (feature 026; thay banner ngang của feature 009).
//  - `bellModel`, `bellItems`, `relativeTime` thuần (test được); `AlarmBell` dựng DOM bằng createElement/textContent (chuỗi
//    project không bao giờ vào innerHTML).
//  - Chuông: badge số alarm chưa xác nhận (`counts.unack`, 99+), màu theo mức cao nhất; rung nhẹ khi có alarm mới
//    (chỉ khi không bật `prefers-reduced-motion`, CSS).
//  - Bảng thông báo: hộp thoại không chặn (role="dialog") neo dưới chuông, đóng bằng Esc/bấm ra ngoài, focus về chuông.
//  - Toast: alarm khẩn cấp MỚI chưa xác nhận, tự ẩn, bấm để mở bảng. Không phải vùng đọc (AlarmAnnouncer đã báo role="alert").
import {
  PRIORITY_RANK,
  alarmErrorText,
  alarmLock,
  alarmVi,
  createAlarmIcon,
  formatAlarmClock,
  formatAlarmValue,
  priorityIcon,
  priorityLabel,
  type ActionHost,
  type AlarmAckOutcome,
  type AlarmInstance,
  type AlarmLock,
  type AlarmPriority,
  type AlarmSnapshot,
  type AlarmSource,
  type AlarmSourceStatus,
} from '@mat/ui-components';
import { vi } from '../i18n/vi.ts';
import { badgeText } from './badge.ts';

export type BellFilter = 'unack' | 'all';

export interface BellModel {
  kind: 'live' | 'lost' | 'unsupported';
  /** Số alarm chưa xác nhận (không tính tạm ẩn). */
  n: number;
  /** Chữ trên badge ('' khi 0). */
  text: string;
  /** Mức cao nhất trong các alarm chưa xác nhận. */
  priority: AlarmPriority | null;
  aria: string;
}

/** null: không có chuông (project không có alarm, hoặc chưa từng có dữ liệu). */
export function bellModel(snap: AlarmSnapshot, status: AlarmSourceStatus): BellModel | null {
  if (status === 'none' || status === 'offline') return null;
  if (status === 'unsupported')
    return {
      kind: 'unsupported',
      n: 0,
      text: '',
      priority: null,
      aria: vi.alarm.bell.labelUnsupported,
    };
  const n = snap.counts.unack;
  const by = snap.counts.byPriority;
  const priority =
    n > 0
      ? ((['critical', 'major', 'minor', 'advisory'] as const).find((p) => by[p].unack > 0) ?? null)
      : null;
  return {
    kind: status === 'stale' ? 'lost' : 'live',
    n,
    text: n > 0 ? badgeText(n) : '',
    priority,
    aria: status === 'stale' ? vi.alarm.bell.labelLost : vi.alarm.bell.label(n),
  };
}

const isUnack = (i: AlarmInstance): boolean =>
  i.state === 'ACTIVE_UNACK' || i.state === 'RTN_UNACK';

/**
 * Hàng của bảng: bỏ tạm ẩn và NORMAL; 'unack' chỉ giữ chưa xác nhận. Thứ tự: chưa xác nhận trước, rồi mức cao
 * (khẩn cấp trước), rồi mới nhất.
 */
export function bellItems(snap: AlarmSnapshot, filter: BellFilter): AlarmInstance[] {
  return snap.instances
    .filter((i) => !i.shelved && i.state !== 'NORMAL' && (filter === 'all' || isUnack(i)))
    .sort(
      (a, b) =>
        Number(isUnack(b)) - Number(isUnack(a)) ||
        PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
        b.tsActive - a.tsActive,
    );
}

/** "vừa xong", "12 giây trước", "2 phút trước", "3 giờ trước", "2 ngày trước". */
export function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  const t = vi.alarm.bell;
  if (s < 10) return t.justNow;
  if (s < 60) return t.secondsAgo(s);
  if (s < 3600) return t.minutesAgo(Math.floor(s / 60));
  if (s < 86400) return t.hoursAgo(Math.floor(s / 3600));
  return t.daysAgo(Math.floor(s / 86400));
}

export interface AlarmBellOptions {
  source: AlarmSource;
  host: ActionHost;
  /** Mở trang Alarm; mặc định `location.hash = '#/alarms'`. */
  navigate?: () => void;
  /** Phần tử âm thanh (bật/tắt, chỉ báo) đặt ở đầu bảng thông báo. */
  soundEl?: HTMLElement;
  /** Thời gian hiện toast (ms). */
  toastMs?: number;
  /** Thời gian cho bước xác nhận lần hai của "Xác nhận tất cả" (ms). */
  confirmMs?: number;
  doc?: Document;
}

const MAX_ROWS = 50;
const MSG_MS = 6000;
const TICK_MS = 15000;

const SVG = 'http://www.w3.org/2000/svg';
function bellIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('al-bell-ic');
  for (const d of ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0']) {
    const p = doc.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
function closeIcon(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS(SVG, 'path');
  p.setAttribute('d', 'M6 6l12 12M18 6L6 18');
  svg.append(p);
  return svg;
}

const keyOf = (i: AlarmInstance): string => `${i.id}#${i.occurrence}`;

export class AlarmBell {
  /** Gốc đặt ở thanh trên: chuông và bảng neo dưới nó. */
  readonly el: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
  readonly toast: HTMLElement;
  readonly #o: AlarmBellOptions;
  readonly #doc: Document;
  readonly #badge: HTMLElement;
  readonly #count: HTMLElement;
  readonly #tabs: Record<BellFilter, HTMLButtonElement>;
  readonly #notice: HTMLElement;
  readonly #lockEl: HTMLElement;
  readonly #list: HTMLElement;
  readonly #msg: HTMLElement;
  readonly #ackAll: HTMLButtonElement;
  readonly #toastText: HTMLElement;
  readonly #unsub: () => void;
  #filter: BellFilter = 'unack';
  #seeded = false;
  #seen = new Set<string>();
  #busy = new Set<string>();
  #allBusy = false;
  #confirmAll = false;
  #confirmTimer: ReturnType<typeof setTimeout> | null = null;
  #msgTimer: ReturnType<typeof setTimeout> | null = null;
  #toastTimer: ReturnType<typeof setTimeout> | null = null;
  #ringTimer: ReturnType<typeof setTimeout> | null = null;
  #tick: ReturnType<typeof setInterval> | null = null;
  #listKey = '';

  constructor(o: AlarmBellOptions) {
    this.#o = o;
    const d = (this.#doc = o.doc ?? document);
    const t = vi.alarm.bell;
    const mk = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      cls: string,
    ): HTMLElementTagNameMap[K] => {
      const e = d.createElement(tag);
      e.className = cls;
      return e;
    };

    this.el = mk('span', 'al-bell');
    this.el.id = 'app-alarm-bell';
    this.el.hidden = true;

    this.button = mk('button', 'al-bell-btn');
    this.button.type = 'button';
    this.button.id = 'app-alarm-bell-btn';
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-controls', 'app-alarm-panel');
    this.#badge = mk('span', 'al-bell-badge');
    this.#badge.setAttribute('aria-hidden', 'true');
    this.#badge.hidden = true;
    this.button.append(bellIcon(d), this.#badge);
    this.button.addEventListener('click', () => (this.isOpen ? this.close(true) : this.open()));

    // ---- bảng thông báo ----
    this.panel = mk('div', 'al-panel');
    this.panel.id = 'app-alarm-panel';
    this.panel.setAttribute('aria-label', t.panel);
    this.panel.tabIndex = -1;
    this.panel.hidden = true;

    const head = mk('div', 'al-panel-head');
    const h = mk('h2', 'al-panel-title');
    h.textContent = t.title;
    this.#count = mk('span', 'al-panel-count');
    h.append(this.#count);
    const close = mk('button', 'al-panel-x');
    close.type = 'button';
    close.setAttribute('aria-label', t.close);
    close.title = t.close;
    close.append(closeIcon(d));
    close.addEventListener('click', () => this.close(true));
    head.append(h);
    if (o.soundEl) {
      o.soundEl.classList.add('al-panel-sound');
      head.append(o.soundEl);
    }
    head.append(close);

    const tabs = mk('div', 'al-panel-tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', t.filterLabel);
    const tab = (f: BellFilter): HTMLButtonElement => {
      const b = mk('button', 'al-panel-tab');
      b.type = 'button';
      b.dataset.filter = f;
      b.addEventListener('click', () => {
        this.#filter = f;
        this.#render(true);
      });
      tabs.append(b);
      return b;
    };
    this.#tabs = { unack: tab('unack'), all: tab('all') };

    this.#notice = mk('p', 'al-panel-notice');
    this.#notice.hidden = true;
    this.#lockEl = mk('p', 'al-panel-lock');
    this.#lockEl.hidden = true;
    this.#list = mk('ul', 'al-panel-list');
    this.#list.setAttribute('aria-label', t.panel);
    this.#msg = mk('p', 'al-panel-msg');
    this.#msg.hidden = true;

    const foot = mk('div', 'al-panel-foot');
    this.#ackAll = mk('button', 'al-panel-ackall');
    this.#ackAll.type = 'button';
    this.#ackAll.addEventListener('click', () => void this.#onAckAll());
    const all = mk('a', 'al-panel-viewall');
    all.href = '#/alarms';
    all.textContent = t.viewAll;
    all.addEventListener('click', (e) => {
      e.preventDefault();
      this.close(false);
      this.#navigate();
    });
    foot.append(this.#ackAll, all);

    this.panel.append(head, tabs, this.#notice, this.#lockEl, this.#list, this.#msg, foot);
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close(true);
      }
    });
    this.el.append(this.button, this.panel);

    // ---- toast khẩn cấp ----
    this.toast = mk('div', 'al-toast');
    this.toast.id = 'app-alarm-toast';
    this.toast.hidden = true;
    const tb = mk('button', 'al-toast-body');
    tb.type = 'button';
    tb.title = t.toastOpen;
    const ti = mk('span', 'al-toast-ic');
    ti.append(createAlarmIcon(priorityIcon('critical'), 20, d));
    const tx = mk('span', 'al-toast-txt');
    const tt = mk('strong', 'al-toast-title');
    this.#toastText = mk('span', 'al-toast-text');
    tx.append(tt, this.#toastText);
    tb.append(ti, tx);
    tb.addEventListener('click', () => {
      this.#hideToast();
      this.#filter = 'unack';
      this.open();
    });
    const tc = mk('button', 'al-toast-x');
    tc.type = 'button';
    tc.setAttribute('aria-label', t.toastClose);
    tc.append(closeIcon(d));
    tc.addEventListener('click', () => this.#hideToast());
    this.toast.append(tb, tc);
    d.body.append(this.toast);

    this.#unsub = o.source.subscribe(() => this.refresh());
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  dispose(): void {
    this.#unsub();
    this.#stopOutside();
    for (const h of [this.#confirmTimer, this.#msgTimer, this.#toastTimer, this.#ringTimer])
      if (h) clearTimeout(h);
    if (this.#tick) clearInterval(this.#tick);
    this.toast.remove();
  }

  open(): void {
    if (!this.isOpen) {
      this.panel.hidden = false;
      // role chỉ khi mở: bảng ẩn không lẫn với hộp thoại khác của trang (truy vấn [role=dialog]).
      this.panel.setAttribute('role', 'dialog');
      this.button.setAttribute('aria-expanded', 'true');
      this.#doc.addEventListener('pointerdown', this.#outside, true);
      this.#doc.addEventListener('keydown', this.#esc, true);
      this.#tick = setInterval(() => this.#render(true), TICK_MS);
    }
    this.#render(true);
    // Màn hẹp: bảng cố định toàn chiều rộng ngay dưới chuông (thanh trên có thể xuống dòng).
    const r = this.button.getBoundingClientRect();
    this.panel.style.setProperty('--al-top', `${Math.round(r.bottom + 8)}px`);
    this.panel.focus();
  }

  /** `focusBell`: đưa focus về chuông (Esc, nút Đóng, bấm lại chuông); bấm ra ngoài thì không giành focus. */
  close(focusBell: boolean): void {
    if (!this.isOpen) return;
    this.panel.hidden = true;
    this.panel.removeAttribute('role');
    this.button.setAttribute('aria-expanded', 'false');
    this.#stopOutside();
    if (this.#tick) clearInterval(this.#tick);
    this.#tick = null;
    this.#resetConfirm();
    if (focusBell) this.button.focus();
  }

  readonly #outside = (e: Event): void => {
    const t = e.target as Node | null;
    if (t && (this.el.contains(t) || this.toast.contains(t))) return;
    this.close(false);
  };
  readonly #esc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.isOpen) {
      e.preventDefault();
      this.close(true);
    }
  };
  #stopOutside(): void {
    this.#doc.removeEventListener('pointerdown', this.#outside, true);
    this.#doc.removeEventListener('keydown', this.#esc, true);
  }

  #navigate(): void {
    if (this.#o.navigate) this.#o.navigate();
    else location.hash = '#/alarms';
  }

  #lock(): AlarmLock | null {
    return alarmLock(this.#o.source, this.#o.host);
  }

  /** Tính lại từ nguồn (tự động khi nguồn đổi; nơi chứa gọi khi phiên đổi). */
  refresh(): void {
    const src = this.#o.source;
    const snap = src.snapshot();
    const status = src.status();
    const m = bellModel(snap, status);
    this.el.hidden = m === null;
    if (!m) {
      this.close(false);
      this.#hideToast();
      return;
    }
    this.button.setAttribute('aria-label', m.aria);
    this.button.title = m.aria;
    this.button.dataset.kind = m.kind;
    this.#badge.hidden = m.kind === 'live' ? m.n === 0 : false;
    this.#badge.textContent = m.kind === 'live' ? m.text : m.kind === 'lost' ? '!' : '?';
    this.button.dataset.priority = m.priority ?? 'none';
    if (status === 'live') this.#detectNew(snap);
    if (this.isOpen) this.#render(false);
  }

  #detectNew(snap: AlarmSnapshot): void {
    const fresh: AlarmInstance[] = [];
    const now = new Set<string>();
    for (const i of snap.instances) {
      if (i.state !== 'ACTIVE_UNACK' || i.shelved) continue;
      const k = keyOf(i);
      now.add(k);
      if (!this.#seen.has(k) && this.#seeded) fresh.push(i);
    }
    this.#seen = now;
    if (!this.#seeded) {
      this.#seeded = true;
      return;
    }
    if (fresh.length === 0) return;
    this.#ring();
    const crit = fresh.filter((i) => i.priority === 'critical');
    if (crit.length > 0) this.#showToast(crit);
  }

  #ring(): void {
    this.button.dataset.ring = '';
    // Gỡ rồi đặt lại để hoạt ảnh chạy lại khi có alarm mới liên tiếp.
    if (this.#ringTimer) clearTimeout(this.#ringTimer);
    this.#ringTimer = setTimeout(() => {
      delete this.button.dataset.ring;
      this.#ringTimer = null;
    }, 1200);
  }

  #showToast(list: AlarmInstance[]): void {
    const t = vi.alarm.bell;
    const title = this.toast.querySelector('.al-toast-title')!;
    title.textContent = list.length === 1 ? t.toastTitle : t.toastMany(list.length);
    this.#toastText.textContent = list[0]!.text;
    this.toast.hidden = false;
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => this.#hideToast(), this.#o.toastMs ?? 8000);
  }

  #hideToast(): void {
    this.toast.hidden = true;
    if (this.#toastTimer) clearTimeout(this.#toastTimer);
    this.#toastTimer = null;
  }

  // ---- dựng bảng ----

  #render(force: boolean): void {
    const t = vi.alarm.bell;
    const src = this.#o.source;
    const snap = src.snapshot();
    const status = src.status();
    const lock = this.#lock();
    const unack = bellItems(snap, 'unack');
    const all = bellItems(snap, 'all');
    this.#count.textContent = unack.length > 0 ? String(snap.counts.unack) : '';
    this.#count.hidden = snap.counts.unack === 0;
    for (const f of ['unack', 'all'] as const) {
      const b = this.#tabs[f];
      const n = f === 'unack' ? unack.length : all.length;
      b.replaceChildren(f === 'unack' ? t.tabUnack : t.tabAll);
      const c = this.#doc.createElement('span');
      c.className = 'al-panel-tabn';
      c.textContent = String(n);
      b.append(c);
      b.setAttribute('aria-pressed', String(this.#filter === f));
    }
    const notice = status === 'stale' ? t.lost : status === 'unsupported' ? t.unsupported : '';
    this.#notice.hidden = !notice;
    this.#notice.textContent = notice;
    this.#notice.dataset.tone = status === 'stale' ? 'bad' : 'warn';
    const items = this.#filter === 'unack' ? unack : all;
    const showLock = lock !== null && unack.length > 0 && status !== 'unsupported';
    this.#lockEl.hidden = !showLock;
    this.#lockEl.textContent = showLock ? lock.message : '';
    const nUnack = unack.length;
    this.#ackAll.hidden = nUnack === 0;
    this.#ackAll.textContent = this.#allBusy
      ? t.ackBusy
      : this.#confirmAll
        ? t.ackAllConfirm(nUnack)
        : t.ackAll;
    this.#ackAll.dataset.confirm = String(this.#confirmAll);
    this.#ackAll.setAttribute('aria-disabled', String(lock !== null || this.#allBusy));
    if (lock) this.#ackAll.title = lock.message;
    else this.#ackAll.removeAttribute('title');

    const now = src.now();
    const key = JSON.stringify([
      this.#filter,
      items
        .slice(0, MAX_ROWS)
        .map((i) => [keyOf(i), i.state, i.text, i.name, i.valueActive, i.rev]),
      items.length,
      lock?.code,
      [...this.#busy],
      Math.floor(now / TICK_MS),
    ]);
    if (!force && key === this.#listKey) return;
    this.#listKey = key;
    const focusKey = (this.#doc.activeElement as HTMLElement | null)?.closest?.<HTMLElement>(
      '.al-n-item',
    )?.dataset.key;
    this.#list.replaceChildren();
    if (items.length === 0) {
      const li = this.#doc.createElement('li');
      li.className = 'al-panel-empty';
      const ic = this.#doc.createElement('span');
      ic.className = 'al-panel-empty-ic';
      ic.append(bellIcon(this.#doc));
      const s = this.#doc.createElement('strong');
      s.textContent = this.#filter === 'unack' && all.length > 0 ? t.emptyUnack : t.empty;
      const p = this.#doc.createElement('span');
      p.textContent = t.emptyHint;
      li.append(ic, s, p);
      this.#list.append(li);
      return;
    }
    for (const i of items.slice(0, MAX_ROWS)) this.#list.append(this.#row(i, lock, now));
    if (items.length > MAX_ROWS) {
      const li = this.#doc.createElement('li');
      li.className = 'al-panel-more';
      li.textContent = t.more(items.length - MAX_ROWS);
      this.#list.append(li);
    }
    if (focusKey) {
      const row = [...this.#list.querySelectorAll<HTMLElement>('.al-n-item')].find(
        (r) => r.dataset.key === focusKey,
      );
      (row?.querySelector<HTMLElement>('button') ?? null)?.focus();
    }
  }

  #row(i: AlarmInstance, lock: AlarmLock | null, now: number): HTMLElement {
    const d = this.#doc;
    const t = vi.alarm.bell;
    const li = d.createElement('li');
    li.className = 'al-n-item';
    li.dataset.key = keyOf(i);
    li.dataset.id = i.id;
    li.dataset.priority = i.priority;
    li.dataset.state = i.state;
    const prio = d.createElement('span');
    prio.className = 'al-n-prio';
    prio.title = priorityLabel(i.priority);
    prio.append(createAlarmIcon(priorityIcon(i.priority), 18, d));
    const label = d.createElement('span');
    label.className = 'sr-only';
    label.textContent = priorityLabel(i.priority);
    prio.append(label);

    const body = d.createElement('div');
    body.className = 'al-n-body';
    const text = d.createElement('div');
    text.className = 'al-n-text';
    text.textContent = i.text;
    const meta = d.createElement('div');
    meta.className = 'al-n-meta';
    const parts: string[] = [];
    if (i.name && i.name !== i.text) parts.push(i.name);
    parts.push(i.alarmId);
    if (i.valueActive !== null && i.valueActive !== undefined)
      parts.push(t.value(formatAlarmValue(i.valueActive)));
    const tag = d.createElement('span');
    tag.className = 'al-n-tag';
    tag.textContent = parts.join(' · ');
    const time = d.createElement('time');
    time.className = 'al-n-time';
    time.dateTime = new Date(i.tsActive).toISOString();
    time.textContent = relativeTime(i.tsActive, now);
    time.title = i.clockOk
      ? formatAlarmClock(i.tsActive, now)
      : `${formatAlarmClock(i.tsActive, now)} (${alarmVi.clockUnsynced})`;
    meta.append(tag, time);
    const st = d.createElement('span');
    st.className = 'al-n-state';
    st.dataset.state = i.state;
    st.textContent = t.state[i.state];
    body.append(text, meta, st);
    li.append(prio, body);

    if (isUnack(i)) {
      const busy = this.#busy.has(keyOf(i));
      const b = d.createElement('button');
      b.type = 'button';
      b.className = 'al-n-ack';
      b.textContent = busy ? t.ackBusy : t.ack;
      b.setAttribute('aria-label', t.ackRow(i.text));
      b.setAttribute('aria-disabled', String(lock !== null || busy));
      if (lock) b.title = lock.message;
      b.addEventListener('click', () => void this.#ackOne(i));
      li.append(b);
    }
    return li;
  }

  // ---- xác nhận ----

  #blocked(lock: AlarmLock | null): boolean {
    if (!lock) return false;
    if (lock.code === 'NO_SESSION') this.#o.host.requestLogin();
    return true;
  }

  async #ackOne(i: AlarmInstance): Promise<void> {
    const k = keyOf(i);
    if (this.#blocked(this.#lock()) || this.#busy.has(k)) return;
    this.#busy.add(k);
    this.#render(true);
    const r = await this.#send({ items: [{ id: i.id, occurrence: i.occurrence }] }, true);
    this.#busy.delete(k);
    this.#render(true);
    this.#showMsg(r.text, r.error);
  }

  async #onAckAll(): Promise<void> {
    if (this.#blocked(this.#lock()) || this.#allBusy) return;
    if (!this.#confirmAll) {
      this.#confirmAll = true;
      this.#confirmTimer = setTimeout(() => {
        this.#resetConfirm();
        this.#render(false);
      }, this.#o.confirmMs ?? 4000);
      this.#render(false);
      return;
    }
    this.#resetConfirm();
    this.#allBusy = true;
    this.#render(false);
    const snap = this.#o.source.snapshot();
    const r = await this.#send({ all: true, upToRevision: snap.revision, filter: {} }, false);
    this.#allBusy = false;
    this.#render(true);
    this.#showMsg(r.text, r.error);
  }

  #resetConfirm(): void {
    this.#confirmAll = false;
    if (this.#confirmTimer) clearTimeout(this.#confirmTimer);
    this.#confirmTimer = null;
  }

  async #send(
    req: Parameters<ActionHost['ackAlarms']>[0],
    single: boolean,
  ): Promise<{ text: string; error: boolean }> {
    let o: AlarmAckOutcome;
    try {
      o = await this.#o.host.ackAlarms(req);
    } catch {
      return { text: alarmVi.err.NETWORK, error: true };
    }
    if (!o.ok && o.error) return { text: alarmErrorText(o.error), error: true };
    const r = single ? o.results[0]?.result : undefined;
    if (r && r !== 'ACKED') return { text: alarmVi.ackResult[r], error: r !== 'ALREADY_ACKED' };
    return { text: alarmVi.ackResult.ACKED, error: false };
  }

  #showMsg(text: string, error: boolean): void {
    this.#msg.textContent = text;
    this.#msg.setAttribute('role', error ? 'alert' : 'status');
    this.#msg.dataset.tone = error ? 'bad' : 'ok';
    this.#msg.hidden = false;
    if (this.#msgTimer) clearTimeout(this.#msgTimer);
    this.#msgTimer = setTimeout(() => {
      this.#msg.hidden = true;
      this.#msg.textContent = '';
    }, MSG_MS);
  }
}
