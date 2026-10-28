// Phần dùng chung của việc "vào" một item `svg` (feature 008) cho canvas tự do (mat-screen-canvas) và trình soạn lưới
// (mat-grid-editor, feature 012): tìm gốc Shadow DOM của item trong <mat-screen>, cho phần tử SVG nhận con trỏ, hit-test
// phần tử dưới con trỏ, chọn (Shift/Ctrl, Alt đi lên phần tử cha), làm nóng hit-test, và đổi khóa file binding để item dựng
// lại khi binding đổi. Không sửa DOM của SVG.
import type { ScreenModel } from '@mat/project-schema';
import type { StudioApp as App } from '../../app/app.ts';
import { findByUid } from '../../model/svg-dom.ts';
import { applyPick } from '../../model/svg-select.ts';

/** Số lớp phần tử tối đa đọc tại một điểm (SC-018). */
const HIT_LIMIT = 32;

/** Gốc Shadow DOM của item `svg` `itemId` trong `<mat-screen>` `ms`; `null` khi chưa dựng. */
export function svgItemRoot(ms: Element | null | undefined, itemId: string): ShadowRoot | null {
  const wrappers = ms?.shadowRoot?.querySelectorAll<HTMLElement>('.item');
  if (!wrappers) return null;
  for (const w of wrappers)
    if (w.dataset.itemId === itemId)
      return w.querySelector<HTMLElement>('.svg-host')?.shadowRoot ?? null;
  return null;
}

const hitRoots = new WeakSet<ShadowRoot>();

/**
 * Ở chế độ chỉnh sửa item bị `pointer-events: none` nên hit-test không thấy phần tử SVG: trong Shadow DOM của item đang
 * vào, cho phần tử nhận con trỏ (kể cả hình `fill="none"`). Dùng stylesheet dựng sẵn, không sửa DOM của SVG.
 */
export function ensureHit(root: ShadowRoot): void {
  if (hitRoots.has(root)) return;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('svg *{pointer-events:all}');
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    hitRoots.add(root);
  } catch {
    // Môi trường không có stylesheet dựng sẵn (jsdom): hit-test dùng bản dự phòng của trình duyệt.
  }
}

/**
 * UID của các phần tử SVG dưới điểm client, trên cùng trước. Hình con không có UID quy về tổ tiên gần nhất có UID; mỗi UID
 * một lần. Dừng sớm sau vài lớp (SC-018).
 */
export function hitUids(root: ShadowRoot | null, x: number, y: number): string[] {
  if (root === null || typeof root.elementsFromPoint !== 'function') return [];
  ensureHit(root);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const el of root.elementsFromPoint(x, y)) {
    const uid = el.closest('[data-mat-uid]')?.getAttribute('data-mat-uid');
    if (uid && !seen.has(uid)) {
      seen.add(uid);
      out.push(uid);
      if (out.length >= HIT_LIMIT) break;
    }
  }
  return out;
}

/** UID của tổ tiên gần nhất có UID của phần tử `uid`; `null` khi là phần tử cấp trên cùng. */
export function parentUid(root: ShadowRoot | null, uid: string): string | null {
  if (root === null) return null;
  let el = findByUid(root, uid)?.parentElement ?? null;
  while (el !== null && !el.hasAttribute('data-mat-uid')) el = el.parentElement;
  return el?.getAttribute('data-mat-uid') ?? null;
}

/** Nhấp chọn phần tử SVG tại điểm client (Shift/Ctrl thêm bớt; Alt đi lên phần tử cha). */
export function pickAt(
  app: App,
  root: ShadowRoot | null,
  x: number,
  y: number,
  mods: { shift: boolean; alt: boolean },
): void {
  const sel = app.screens.selectedUids;
  const hit = hitUids(root, x, y);
  let uid: string | null = hit[0] ?? null;
  if (mods.alt) {
    // `elementsFromPoint` là thứ tự xếp lớp chứ không phải cây cha con: đi lên từ phần tử đang chọn nếu nó dưới con trỏ.
    const cur = sel.at(-1);
    const base = cur !== undefined && hit.includes(cur) ? cur : uid;
    uid = base === null ? null : (parentUid(root, base) ?? base);
  }
  app.screens.pickUids(applyPick(sel, uid, mods));
}

/**
 * Lần `elementsFromPoint` đầu trên một cây lớn dựng cây hit-test (spike T006d: ≈ 60 ms với 20.000 phần tử): làm nóng một lần
 * ngay sau khi dựng xong để cú nhấp đầu tiên không chịu giá đó (SC-018).
 */
export function warmHit(getRoot: () => ShadowRoot | null): void {
  requestAnimationFrame(() => {
    const root = getRoot();
    const host = root?.host.getBoundingClientRect();
    if (root && host) {
      ensureHit(root);
      root.elementsFromPoint(host.left + host.width / 2, host.top + host.height / 2);
    }
  });
}

/**
 * Khóa file binding cho `<mat-screen>`: item `svg` chỉ dựng lại khi khóa `bindingFile#<bản>` đổi, nên nội dung binding đổi
 * (gắn Tag, hoàn tác, giá trị thử) phải đổi khóa. Giữ nguyên đối tượng khi không đổi.
 */
export class BindingRevs {
  private readonly revs = new Map<string, { value: unknown; n: number }>();
  private cache: { doc: ScreenModel; sig: string; out: ScreenModel } | null = null;

  private readonly getApp: () => App;

  constructor(getApp: () => App) {
    this.getApp = getApp;
  }

  private get app(): App {
    return this.getApp();
  }

  /** Số thứ tự bản của file binding: đổi khi nội dung đổi. */
  rev(file: string): number {
    const v = this.app.store.state.docs[file]?.value;
    const cur = this.revs.get(file);
    if (cur !== undefined && cur.value === v) return cur.n;
    const n = (cur?.n ?? 0) + 1;
    this.revs.set(file, { value: v, n });
    return n;
  }

  /** Màn hình với `bindingFile#<bản>.<mode>.<testEpoch>` trên mỗi item `svg`. */
  viewDoc(doc: ScreenModel, mode: string): ScreenModel {
    if (!doc.items.some((i) => i.type === 'svg')) return doc;
    const tag = (file: string): string => `${this.rev(file)}.${mode}.${this.app.screens.testEpoch}`;
    const sig = doc.items.map((i) => (i.type === 'svg' ? tag(i.bindingFile) : '')).join(',');
    const c = this.cache;
    if (c !== null && c.doc === doc && c.sig === sig) return c.out;
    const out: ScreenModel = {
      ...doc,
      items: doc.items.map((i) =>
        i.type === 'svg' ? { ...i, bindingFile: `${i.bindingFile}#${tag(i.bindingFile)}` } : i,
      ),
    } as ScreenModel;
    this.cache = { doc, sig, out };
    return out;
  }
}
