// Huy hiệu menu và tiền tố tiêu đề tab (feature 009, FR-057, FR-066; contracts/ui-alarm.md §11).
//  - Huy hiệu = `counts.unack` (không tính shelved), ẩn khi 0, màu theo mức ưu tiên cao nhất trong các alarm chưa xác nhận,
//    số bằng chữ (màu không là tín hiệu duy nhất), `aria-label` đọc được.
//  - Tiêu đề tab `(n) <gốc>` khi unack > 0 (n > 99: `99+`), kể cả khi tab ẩn; nơi khác đổi tiêu đề (đổi màn hình) thì lấy làm gốc mới.
import {
  PRIORITIES,
  type AlarmPriority,
  type AlarmSnapshot,
  type AlarmSourceStatus,
} from '@mat/ui-components';
import { vi } from '../i18n/vi.ts';

export interface BadgeModel {
  n: number;
  /** Chữ hiện ra: số, hoặc `99+`. */
  text: string;
  aria: string;
  priority: AlarmPriority | null;
}

export const badgeText = (n: number): string => (n > 99 ? '99+' : String(n));

export function badgeModel(snap: AlarmSnapshot, status: AlarmSourceStatus): BadgeModel | null {
  if (status !== 'live' && status !== 'stale') return null;
  const n = snap.counts.unack;
  if (n <= 0) return null;
  const priority = PRIORITIES.find((p) => snap.counts.byPriority[p].unack > 0) ?? null;
  return { n, text: badgeText(n), aria: vi.alarm.announce.count(n), priority };
}

export function applyBadge(el: HTMLElement, m: BadgeModel | null): void {
  if (!m) {
    el.hidden = true;
    el.textContent = '';
    el.removeAttribute('aria-label');
    delete el.dataset.priority;
    return;
  }
  el.hidden = false;
  el.textContent = m.text;
  el.setAttribute('aria-label', m.aria);
  if (m.priority) el.dataset.priority = m.priority;
  else delete el.dataset.priority;
}

export const tabTitle = (base: string, n: number): string =>
  n > 0 ? `(${badgeText(n)}) ${base}` : base;

export class TabTitle {
  readonly #doc: Document;
  readonly #obs: MutationObserver | null;
  #base: string;
  #n = 0;
  #applied: string | null = null;

  constructor(doc: Document = document) {
    this.#doc = doc;
    this.#base = doc.title;
    const title = doc.querySelector('title');
    this.#obs =
      title && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => this.#onExternal())
        : null;
    this.#obs?.observe(title!, { childList: true, characterData: true, subtree: true });
  }

  set(n: number): void {
    this.#n = n;
    this.#apply();
  }

  dispose(): void {
    this.#obs?.disconnect();
  }

  #apply(): void {
    const t = tabTitle(this.#base, this.#n);
    this.#applied = t;
    if (this.#doc.title !== t) this.#doc.title = t;
  }

  #onExternal(): void {
    if (this.#doc.title === this.#applied) return; // thay đổi do chính mình
    this.#base = this.#doc.title;
    this.#apply();
  }
}
