// Lớp phủ popup (FR-016, ADR-013 điểm 6): role=dialog, aria-modal, bẫy focus bằng Tab, Esc đóng.
// Phần tử widget nằm trong Shadow DOM lồng nhau nên tìm phần tử focus được bằng duyệt sâu.
// Faceplate (feature 011, FR-125; contracts/project-format-1.0.md §5): `substitutePopup` thay `{param}` của popup bằng
// `args` khi mở, dùng đúng hàm thuần `substituteParams` của validator TS.
import {
  substituteParams,
  type Item,
  type ParamDecl,
  type ParamProblem,
  type ScreenModel,
} from '@mat/project-schema';

const FOCUSABLE =
  'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function usable(el: Element): boolean {
  const h = el as HTMLElement & { disabled?: boolean };
  if (h.disabled) return false;
  if (el.getAttribute('tabindex') === '-1') return false;
  if (el.closest('[inert]')) return false;
  return true;
}

/** Phần tử focus được trong `root`, theo thứ tự DOM, đi xuyên Shadow DOM mở. */
export function deepFocusables(root: ParentNode): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (node: ParentNode): void => {
    for (const child of Array.from(node.children)) {
      if (child.matches(FOCUSABLE) && usable(child)) out.push(child as HTMLElement);
      if (child.shadowRoot) walk(child.shadowRoot);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/** Phần tử đang có focus, đi xuyên Shadow DOM. */
export function deepActiveElement(doc: Document): Element | null {
  let a: Element | null = doc.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

/** Chỉ số focus kế tiếp trong vòng `count` phần tử; `current` = -1 khi focus đang ngoài danh sách. */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}

/** Xử lý Tab (bẫy focus trong `dialog`); trả true nếu đã xử lý. */
export function trapTab(e: KeyboardEvent, dialog: HTMLElement): boolean {
  if (e.key !== 'Tab') return false;
  const list = deepFocusables(dialog);
  const active = deepActiveElement(dialog.ownerDocument);
  const idx = active ? list.indexOf(active as HTMLElement) : -1;
  e.preventDefault();
  const next = nextFocusIndex(list.length, idx, e.shiftKey);
  (next < 0 ? dialog : list[next]!).focus();
  return true;
}

// ---- Faceplate: thay tham số lúc mở popup ---------------------------------------------------------------------

/** Item của popup đã thay: `missingTags` là các Tag sau khi thay không có trong project (widget hiện lỗi, không đăng ký). */
export type PopupItem = Item & { missingTags?: string[] };

export type PopupSubstitution =
  { ok: true; model: ScreenModel } | { ok: false; problems: ParamProblem[]; message: string };

/** Tag sau khi thay không có trong project của item (chỉ có ở item do `substitutePopup` đánh dấu). */
export function missingTagsOf(item: Item): string[] | undefined {
  const m = (item as PopupItem).missingTags;
  return Array.isArray(m) && m.length ? m : undefined;
}

const tagStrings = (tags: unknown): string[] => {
  if (tags === null || typeof tags !== 'object') return [];
  const out: string[] = [];
  for (const v of Object.values(tags as Record<string, unknown>)) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
  }
  return out;
};

/**
 * Thay `{param}` ở mọi item của popup bằng `args` (thiếu thì `default`), cùng luật với validator (`substituteParams`).
 * `args` sai (thiếu, thừa, sai kiểu) hoặc chỗ đặt sai: `ok: false`, không mở popup. Popup không có `params` và không có
 * `args`: trả nguyên mô hình. `knownTag`: tập Tag đã công bố của project; item có Tag đã thay ngoài tập bị bỏ khe `tags`
 * (không đăng ký) và mang `missingTags` để `<mat-screen>` hiện "Tag không có" thay cho widget. Không sửa `model`.
 */
export function substitutePopup(
  model: ScreenModel,
  args: unknown,
  knownTag?: (id: string) => boolean,
): PopupSubstitution {
  const params: readonly ParamDecl[] = (model as { params?: ParamDecl[] }).params ?? [];
  const noArgs =
    args === undefined ||
    (args !== null &&
      typeof args === 'object' &&
      !Array.isArray(args) &&
      Object.keys(args).length === 0);
  if (params.length === 0 && noArgs) return { ok: true, model };

  const problems: ParamProblem[] = [];
  const items: Item[] = [];
  model.items.forEach((item, i) => {
    const r = substituteParams(item, params, args);
    if (!r.ok) {
      // Lỗi `args` giống nhau ở mọi item: báo một lần; lỗi chỗ đặt kèm đường dẫn item.
      for (const p of r.problems) {
        if (p.kind === 'args') {
          if (!problems.some((q) => q.kind === 'args' && q.path === p.path)) problems.push(p);
        } else problems.push({ ...p, path: `/items/${i}${p.path}` });
      }
      return;
    }
    items.push(markMissing(r.value, knownTag));
  });
  if (model.items.length === 0) {
    const r = substituteParams({}, params, args);
    if (!r.ok) problems.push(...r.problems);
  }
  if (problems.length)
    return { ok: false, problems, message: problems.map((p) => p.message).join('; ') };
  return { ok: true, model: { ...model, items } };
}

function markMissing(item: Item, knownTag?: (id: string) => boolean): Item {
  if (!knownTag || item.type !== 'widget' || !item.tags) return item;
  const missing = [...new Set(tagStrings(item.tags).filter((t) => !knownTag(t)))];
  if (!missing.length) return item;
  const out: PopupItem = { ...item, missingTags: missing };
  delete (out as { tags?: unknown }).tags;
  return out;
}
