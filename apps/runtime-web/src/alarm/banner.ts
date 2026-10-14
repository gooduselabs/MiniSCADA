// Banner alarm và vùng đọc cho trình đọc màn hình (feature 009, FR-055, FR-057, FR-058; contracts/ui-alarm.md §6, §8, §10).
//  - `bannerModel` thuần: chọn nội dung theo trạng thái nguồn; `AlarmBanner` dựng DOM (không innerHTML, chuỗi project bằng textContent).
//  - Banner là phần dựng sẵn của trang (D26), nằm dưới thanh trạng thái và trên mọi màn hình, kiosk vẫn hiện.
//  - Nhấp nháy ≤ 1 Hz bằng đồng hồ chung (`data-blink-phase` ở gốc trang); `prefers-reduced-motion`: viền đậm tĩnh (`data-blink="static"`).
//  - `AlarmAnnouncer`: role="status" (polite) báo số lượng, gộp ≤ 1 lần/3 s; role="alert" chỉ cho alarm khẩn cấp mới.
import {
  PRIORITIES,
  alarmErrorText,
  alarmLock,
  alarmVi,
  createAlarmIcon,
  priorityIcon,
  priorityLabel,
  sharedBlinkClock,
  topUnacked,
  type ActionHost,
  type AlarmClassInfo,
  type AlarmColor,
  type AlarmInstance,
  type AlarmLock,
  type AlarmPriority,
  type AlarmSnapshot,
  type AlarmSource,
  type AlarmSourceStatus,
  type BlinkClock,
} from '@mat/ui-components';
import { vi } from '../i18n/vi.ts';

export type BannerModel =
  | { kind: 'unsupported' }
  | { kind: 'lost' }
  | {
      kind: 'unack';
      /** Alarm đang hiện ở banner (null chỉ khi dữ liệu không nhất quán với số đếm). */
      top: AlarmInstance | null;
      n: number;
      chips: Array<{ priority: AlarmPriority; n: number }>;
      canAck: boolean;
      lock: AlarmLock | null;
    }
  | { kind: 'returnOnly'; n: number; top: AlarmInstance | null };

/**
 * Nội dung banner theo §6. `offline` (chưa từng có dữ liệu) ẩn banner: thanh trên đã có chỉ báo kết nối, và trước `hello`
 * chưa biết project có alarm hay không. `lock`: khóa thao tác hiện hành (`alarmLock`), quyết định nút Xác nhận.
 */
export function bannerModel(
  snap: AlarmSnapshot,
  status: AlarmSourceStatus,
  lock: AlarmLock | null,
): BannerModel | null {
  if (status === 'none' || status === 'offline') return null;
  if (status === 'unsupported') return { kind: 'unsupported' };
  if (status === 'stale') return { kind: 'lost' };
  const c = snap.counts;
  if (c.unack > 0) {
    return {
      kind: 'unack',
      top: topUnacked(snap),
      n: c.unack,
      chips: PRIORITIES.filter((p) => c.byPriority[p].unack > 0).map((p) => ({
        priority: p,
        n: c.byPriority[p].unack,
      })),
      canAck: lock === null,
      lock,
    };
  }
  if (c.rtnUnack > 0) {
    let top: AlarmInstance | null = null;
    for (const i of snap.instances)
      if (i.state === 'RTN_UNACK' && !i.shelved) {
        if (!top || PRIORITIES.indexOf(i.priority) < PRIORITIES.indexOf(top.priority)) top = i;
      }
    return { kind: 'returnOnly', n: c.rtnUnack, top };
  }
  return null;
}

const DEFAULT_COLOR: Readonly<Record<AlarmPriority, AlarmColor>> = {
  critical: 'red',
  major: 'orange',
  minor: 'amber',
  advisory: 'blue',
};
const COLORS: ReadonlySet<string> = new Set([
  'red',
  'orange',
  'amber',
  'blue',
  'purple',
  'teal',
  'gray',
  'green',
]);

export interface AlarmBannerOptions {
  source: AlarmSource;
  host: ActionHost;
  /** Mở trang Alarm; mặc định đặt `location.hash = '#/alarms'`. */
  navigate?: () => void;
  reducedMotion?: () => boolean;
  clock?: BlinkClock;
  doc?: Document;
}

const MSG_MS = 6000;

export class AlarmBanner {
  readonly el: HTMLElement;
  readonly #o: AlarmBannerOptions;
  readonly #doc: Document;
  readonly #main: HTMLElement;
  readonly #msg: HTMLElement;
  #key = '';
  #busy = false;
  #off: (() => void) | null = null;
  #unsub: () => void;
  #msgTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(o: AlarmBannerOptions) {
    this.#o = o;
    this.#doc = o.doc ?? document;
    const d = this.#doc;
    this.el = d.createElement('div');
    this.el.className = 'al-banner';
    this.el.id = 'app-alarm-banner';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', vi.alarm.bannerLabel);
    this.el.hidden = true;
    this.#main = d.createElement('div');
    this.#main.className = 'al-banner-main';
    this.#msg = d.createElement('div');
    this.#msg.className = 'al-banner-msg';
    this.#msg.hidden = true;
    this.el.append(this.#main, this.#msg);
    this.#unsub = o.source.subscribe(() => this.refresh());
  }

  dispose(): void {
    this.#unsub();
    this.#off?.();
    this.#off = null;
    if (this.#msgTimer) clearTimeout(this.#msgTimer);
  }

  #reduced(): boolean {
    if (this.#o.reducedMotion) return this.#o.reducedMotion();
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  #classOf(i: AlarmInstance | null): AlarmClassInfo | undefined {
    return i ? this.#o.source.classes().find((c) => c.id === i.class) : undefined;
  }

  /** Tính lại từ nguồn và phiên (gọi khi nguồn đổi: tự động; khi phiên đổi: nơi chứa gọi). */
  refresh(): void {
    const src = this.#o.source;
    const lock = alarmLock(src, this.#o.host);
    const m = bannerModel(src.snapshot(), src.status(), lock);
    if (!m) {
      this.el.hidden = true;
      this.#key = '';
      this.#setBlink(false);
      this.#main.replaceChildren();
      return;
    }
    const top = m.kind === 'unack' || m.kind === 'returnOnly' ? m.top : null;
    const cls = this.#classOf(top);
    const color: AlarmColor = top
      ? cls && COLORS.has(cls.color)
        ? cls.color
        : DEFAULT_COLOR[top.priority]
      : 'gray';
    const wantsBlink = m.kind === 'unack' && cls?.blink === true;
    const blink = !wantsBlink ? 'off' : this.#reduced() ? 'static' : 'on';
    const tone =
      m.kind === 'unack'
        ? 'alarm'
        : m.kind === 'returnOnly'
          ? 'soft'
          : m.kind === 'lost'
            ? 'bad'
            : 'warn';
    const key = JSON.stringify([
      m.kind,
      top?.id,
      top?.occurrence,
      top?.text,
      m.kind === 'unack'
        ? [m.n, m.chips, m.canAck, m.lock?.code, m.lock?.message]
        : m.kind === 'returnOnly'
          ? m.n
          : 0,
      color,
      blink,
      this.#busy,
    ]);
    this.el.hidden = false;
    this.el.dataset.tone = tone;
    this.el.dataset.color = color;
    this.el.dataset.blink = blink;
    this.#setBlink(blink === 'on');
    if (key === this.#key) return;
    this.#key = key;
    this.#main.replaceChildren(...this.#build(m));
  }

  #setBlink(on: boolean): void {
    if (on && !this.#off) this.#off = (this.#o.clock ?? sharedBlinkClock(this.#doc)).acquire();
    else if (!on && this.#off) {
      this.#off();
      this.#off = null;
    }
  }

  #build(m: BannerModel): Node[] {
    const d = this.#doc;
    const clickable = m.kind === 'unack' || m.kind === 'returnOnly';
    const body = d.createElement(clickable ? 'button' : 'div');
    body.className = 'al-banner-body';
    if (body instanceof HTMLButtonElement) {
      body.type = 'button';
      body.title = vi.alarm.banner.open;
      body.addEventListener('click', () => this.#navigate());
    }
    const text = d.createElement('span');
    text.className = 'al-banner-text';
    if (m.kind === 'unsupported') text.textContent = vi.alarm.banner.unsupported;
    else if (m.kind === 'lost') text.textContent = vi.alarm.banner.lost;
    else if (m.kind === 'returnOnly') text.textContent = vi.alarm.banner.returnOnly(m.n);
    else
      text.textContent = m.top
        ? vi.alarm.banner.summary(priorityLabel(m.top.priority), m.top.text, m.n)
        : vi.alarm.banner.unackOnly(m.n);
    if (m.kind === 'unack' || m.kind === 'returnOnly') {
      const p = m.top?.priority ?? 'minor';
      body.append(createAlarmIcon(priorityIcon(p), 20, d), text);
    } else body.append(text);
    if (m.kind === 'unack' && m.chips.length > 0) {
      const chips = d.createElement('span');
      chips.className = 'al-chips';
      for (const c of m.chips) {
        const chip = d.createElement('span');
        chip.className = 'al-chip';
        chip.dataset.priority = c.priority;
        chip.setAttribute('aria-label', vi.alarm.banner.chip(priorityLabel(c.priority), c.n));
        chip.append(createAlarmIcon(priorityIcon(c.priority), 14, d));
        const n = d.createElement('span');
        n.textContent = String(c.n);
        chip.append(n);
        chips.append(chip);
      }
      body.append(chips);
    }
    const out: Node[] = [body];
    if (m.kind === 'unack') {
      const btn = d.createElement('button');
      btn.type = 'button';
      btn.className = 'al-banner-ack';
      btn.textContent = this.#busy ? vi.alarm.banner.ackBusy : vi.alarm.banner.ack;
      btn.setAttribute('aria-disabled', m.canAck && !this.#busy ? 'false' : 'true');
      if (m.lock) btn.title = m.lock.message;
      btn.addEventListener('click', () => void this.#ack(m));
      out.push(btn);
      if (m.lock) {
        const lock = d.createElement('span');
        lock.className = 'al-banner-lock';
        lock.textContent = m.lock.message;
        out.push(lock);
      }
    }
    return out;
  }

  #navigate(): void {
    if (this.#o.navigate) this.#o.navigate();
    else location.hash = '#/alarms';
  }

  async #ack(m: Extract<BannerModel, { kind: 'unack' }>): Promise<void> {
    const host = this.#o.host;
    if (m.lock) {
      if (m.lock.code === 'NO_SESSION') host.requestLogin();
      return;
    }
    if (!m.top || this.#busy) return;
    this.#busy = true;
    this.refresh();
    let text: string;
    let error = false;
    try {
      const o = await host.ackAlarms({ items: [{ id: m.top.id, occurrence: m.top.occurrence }] });
      const r = o.results[0]?.result;
      if (!o.ok && o.error) {
        text = alarmErrorText(o.error);
        error = true;
      } else if (r && r !== 'ACKED') {
        text = alarmVi.ackResult[r];
        error = r !== 'ALREADY_ACKED';
      } else text = alarmVi.ackResult.ACKED;
    } catch {
      text = alarmVi.err.NETWORK;
      error = true;
    }
    this.#busy = false;
    this.refresh();
    this.#showMsg(text, error);
  }

  #showMsg(text: string, error: boolean): void {
    this.#msg.textContent = text;
    this.#msg.setAttribute('role', error ? 'alert' : 'status');
    this.#msg.hidden = false;
    if (this.#msgTimer) clearTimeout(this.#msgTimer);
    this.#msgTimer = setTimeout(() => {
      this.#msg.hidden = true;
      this.#msg.textContent = '';
    }, MSG_MS);
  }
}

// ---- vùng đọc cho trình đọc màn hình (§10) -------------------------------------------------------------------------

export interface AnnouncerOptions {
  status: HTMLElement;
  alert: HTMLElement;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

const WINDOW_MS = 3000;

/**
 * Hai vùng ẩn thị giác: `status` (polite, atomic) báo số lượng và mất kết nối; `alert` (assertive) chỉ cho alarm khẩn cấp
 * MỚI. Một lần báo mỗi 3 giây: báo đầu tiên tức thì, phần sau trong cửa sổ được gộp và báo ở cuối cửa sổ.
 */
export class AlarmAnnouncer {
  readonly #status: HTMLElement;
  readonly #alert: HTMLElement;
  readonly #now: () => number;
  readonly #set: (fn: () => void, ms: number) => unknown;
  readonly #clear: (h: unknown) => void;
  #seeded = false;
  #seen = new Set<string>();
  #pendingCrit: string[] = [];
  #critTimer: unknown = null;
  #lastCrit = Number.NEGATIVE_INFINITY;
  #lastStatus = Number.NEGATIVE_INFINITY;
  #statusTimer: unknown = null;
  #unack = 0;
  #shownUnack = 0;
  #lost = false;

  constructor(o: AnnouncerOptions) {
    this.#status = o.status;
    this.#alert = o.alert;
    this.#now = o.now ?? (() => Date.now());
    this.#set = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clear = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.#status.setAttribute('role', 'status');
    this.#status.setAttribute('aria-live', 'polite');
    this.#status.setAttribute('aria-atomic', 'true');
    this.#alert.setAttribute('role', 'alert');
    this.#alert.setAttribute('aria-live', 'assertive');
    this.#alert.setAttribute('aria-atomic', 'true');
  }

  update(snap: AlarmSnapshot, status: AlarmSourceStatus): void {
    if (status === 'stale') {
      if (!this.#lost) {
        this.#lost = true;
        this.#status.textContent = vi.alarm.announce.lost;
      }
      return;
    }
    if (status !== 'live') return;
    this.#lost = false;
    const crit: AlarmInstance[] = [];
    for (const i of snap.instances) {
      if (i.state !== 'ACTIVE_UNACK' || i.shelved || i.priority !== 'critical') continue;
      const key = `${i.id}#${i.occurrence}`;
      if (this.#seen.has(key)) continue;
      this.#seen.add(key);
      if (this.#seeded) crit.push(i);
    }
    this.#unack = snap.counts.unack;
    if (!this.#seeded) {
      // Snapshot đầu: alarm có sẵn không phải "mới"; số lượng đầu tiên chỉ báo khi khác 0.
      this.#seeded = true;
      this.#shownUnack = 0;
      if (this.#unack > 0) this.#announceCount();
      return;
    }
    if (crit.length > 0) this.#announceCritical(crit.map((i) => i.text));
    this.#maybeCount();
  }

  dispose(): void {
    if (this.#critTimer !== null) this.#clear(this.#critTimer);
    if (this.#statusTimer !== null) this.#clear(this.#statusTimer);
  }

  #announceCritical(texts: string[]): void {
    const now = this.#now();
    this.#pendingCrit.push(...texts);
    if (now - this.#lastCrit >= WINDOW_MS) {
      this.#flushCritical();
      return;
    }
    if (this.#critTimer === null)
      this.#critTimer = this.#set(
        () => {
          this.#critTimer = null;
          this.#flushCritical();
        },
        this.#lastCrit + WINDOW_MS - now,
      );
  }

  #flushCritical(): void {
    const p = this.#pendingCrit;
    this.#pendingCrit = [];
    if (p.length === 0) return;
    this.#lastCrit = this.#now();
    this.#alert.textContent =
      p.length === 1
        ? vi.alarm.announce.newCritical(p[0]!)
        : vi.alarm.announce.newCriticalMany(p.length);
  }

  #maybeCount(): void {
    if (this.#unack === this.#shownUnack) return;
    const now = this.#now();
    if (now - this.#lastStatus >= WINDOW_MS) {
      this.#announceCount();
      return;
    }
    if (this.#statusTimer === null)
      this.#statusTimer = this.#set(
        () => {
          this.#statusTimer = null;
          if (this.#unack !== this.#shownUnack) this.#announceCount();
        },
        this.#lastStatus + WINDOW_MS - now,
      );
  }

  #announceCount(): void {
    this.#lastStatus = this.#now();
    this.#shownUnack = this.#unack;
    this.#status.textContent = vi.alarm.announce.count(this.#unack);
  }
}
