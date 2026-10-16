// Tham chiếu nội bộ của tài liệu: tập id bị nhắc tới bởi `url(#id)` hoặc `href="#id"` (không regex).
import { parseLocalUrl } from '@mat/svg-renderer';

/** Mọi id được nhắc tới trong thuộc tính của `root` và hậu duệ (duyệt không đệ quy). */
export function collectReferences(root: Element): Set<string> {
  const refs = new Set<string>();
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    for (const a of Array.from(el.attributes)) {
      const v = a.value;
      if (a.localName === 'href') {
        if (v.charCodeAt(0) === 35) refs.add(v.slice(1).trim());
      } else if (v.length >= 7) {
        let from = 0;
        for (;;) {
          const k = v.indexOf('url(', from);
          if (k < 0) break;
          const p = parseLocalUrl(v.slice(k));
          if (p) refs.add(p.id);
          from = k + 4;
        }
      }
    }
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return refs;
}

/** Thuộc tính kế thừa gần nhất (chính phần tử rồi tổ tiên); null nếu không đặt hoặc `inherit` hết cây. */
export function inheritedAttr(el: Element, name: string): string | null {
  let cur: Element | null = el;
  while (cur) {
    const v = cur.getAttribute(name);
    if (v !== null && v.trim() !== 'inherit') return v.trim();
    cur = cur.parentElement;
  }
  return null;
}
