// Lớp phủ popup (FR-016, ADR-013 điểm 6): role=dialog, aria-modal, bẫy focus bằng Tab, Esc đóng.
// Phần tử widget nằm trong Shadow DOM lồng nhau nên tìm phần tử focus được bằng duyệt sâu.

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
