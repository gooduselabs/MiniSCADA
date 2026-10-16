// Sao chép, dán, nhân bản item (feature 007, T102). Clipboard là biến của Studio (đối tượng thuần),
// không đọc hay ghi clipboard hệ thống.
import { LIMITS_03, type Item, type ScreenModel } from '@mat/project-schema';

export interface ClipboardData {
  /** Id màn hình nguồn (để biết đang dán sang màn hình khác). */
  sourceScreen: string;
  /** Bản sao sâu, theo thứ tự lớp. */
  items: Item[];
}

export type PasteRejection = 'max-items' | 'empty';

export interface PasteResult {
  /** Mảng `items` mới của màn hình đích (đúng mảng cũ khi bị từ chối). */
  items: readonly Item[];
  /** Id của các item vừa thêm, theo thứ tự lớp. */
  ids: string[];
  /** Màn hình mà hành động navigate/popup trỏ tới nhưng không có ở đích (UI cảnh báo). */
  missingTargets: string[];
  rejected?: PasteRejection;
  /** Số item `svg` bị bỏ qua (không nhân bản được); vắng khi không phải đường dán. */
  skippedSvg?: number;
}

export interface PasteOptions {
  /** Mặc định (+20, +20). */
  offset?: { x: number; y: number };
  /** Id các màn hình có ở đích; vắng thì không kiểm `missingTargets`. */
  knownScreens?: readonly string[];
  maxItems?: number;
}

export const PASTE_OFFSET = { x: 20, y: 20 } as const;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Loại để đặt id: id widget (gạch nối → gạch dưới cho khớp mẫu id item) hoặc `svg`. */
export const idKindOf = (item: Item): string =>
  item.type === 'svg' ? 'svg' : item.widget.replace(/-/g, '_');

/** `<loại>_<số nhỏ nhất chưa dùng>`; không thêm `id` vào `used`. */
export function nextItemId(kind: string, used: ReadonlySet<string>): string {
  let n = 1;
  while (used.has(`${kind}_${n}`)) n++;
  return `${kind}_${n}`;
}

/** Sao chép các item theo `ids` (thứ tự lớp); `null` khi không có item nào. */
export function copyItems(doc: ScreenModel, ids: readonly string[]): ClipboardData | null {
  const chosen = new Set(ids);
  const items = doc.items.filter((it) => chosen.has(it.id)).map((it) => clone(it));
  return items.length === 0 ? null : { sourceScreen: doc.id, items };
}

/** Dán vào cuối `doc.items`: id mới, lệch `offset`, giữ Tag và hành động. Không bao giờ trùng id. */
export function pasteItems(
  doc: ScreenModel,
  clip: ClipboardData,
  opts: PasteOptions = {},
): PasteResult {
  const max = opts.maxItems ?? LIMITS_03.items;
  // Item `svg` không nhân bản được: một file binding chỉ thuộc một item (E_SCHEMA); bản sao dùng chung file sẽ làm project lỗi.
  const pasteable = clip.items.filter((it) => it.type !== 'svg');
  const skippedSvg = clip.items.length - pasteable.length;
  if (pasteable.length === 0)
    return { items: doc.items, ids: [], missingTargets: [], rejected: 'empty', skippedSvg };
  if (doc.items.length + pasteable.length > max)
    return { items: doc.items, ids: [], missingTargets: [], rejected: 'max-items', skippedSvg };
  const off = opts.offset ?? PASTE_OFFSET;
  const used = new Set(doc.items.map((it) => it.id));
  const added: Item[] = [];
  const missing: string[] = [];
  for (const src of pasteable) {
    const id = nextItemId(idKindOf(src), used);
    used.add(id);
    const copy = clone(src);
    copy.id = id;
    copy.x = Math.round(src.x + off.x);
    copy.y = Math.round(src.y + off.y);
    added.push(copy);
    const act = src.type === 'widget' ? src.events?.click : undefined;
    if (
      opts.knownScreens !== undefined &&
      (act?.action === 'navigate' || act?.action === 'popup') &&
      !opts.knownScreens.includes(act.screen) &&
      !missing.includes(act.screen)
    )
      missing.push(act.screen);
  }
  return {
    items: [...doc.items, ...added],
    ids: added.map((it) => it.id),
    missingTargets: missing,
    ...(skippedSvg > 0 ? { skippedSvg } : {}),
  };
}

/** Nhân bản ngay trong màn hình (Ctrl+D): sao chép rồi dán lệch (+20, +20). */
export function duplicateItems(doc: ScreenModel, ids: readonly string[]): PasteResult {
  const clip = copyItems(doc, ids);
  if (clip === null) return { items: doc.items, ids: [], missingTargets: [], rejected: 'empty' };
  return pasteItems(doc, clip);
}

/** Clipboard nội bộ của Studio: một ô nhớ trong bộ nhớ. */
export class ClipboardStore {
  private data: ClipboardData | null = null;
  get(): ClipboardData | null {
    return this.data;
  }
  set(clip: ClipboardData | null): void {
    this.data = clip;
  }
  clear(): void {
    this.data = null;
  }
}
