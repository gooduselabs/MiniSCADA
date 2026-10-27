// Vùng đọc cho trình đọc màn hình của alarm (feature 009, FR-058; contracts/ui-alarm.md §10). Tách khỏi banner cũ khi
// banner ngang được thay bằng chuông và bảng thông báo (feature 026, bell.ts).
import type { AlarmInstance, AlarmSnapshot, AlarmSourceStatus } from '@mat/ui-components';
import { vi } from '../i18n/vi.ts';

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
