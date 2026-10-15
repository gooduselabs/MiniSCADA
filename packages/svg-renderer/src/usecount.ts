// Đếm phần tử hiệu dụng sau mở `use` (chống bom `use`; contract svg-import §10) và phát hiện vòng tham chiếu.
// Quy ước đếm khớp tests/fixtures/svg-import/limits.mjs: E(tài liệu) = số phần tử (kể cả defs, use) + tổng
// E(đích) của mọi `use` nằm ngoài `defs`; E(cây con) = số phần tử + tổng E(đích) của mọi `use` trong cây con.
// Duyệt không đệ quy, ghi nhớ từng nút; số được kẹp để không tràn.
// T112: nằm ở @mat/svg-renderer (không phải @mat/svg-import) để trang vận hành (mountScreen) và bộ kiểm project dùng
// chung với bộ nhập: gói bị sửa tay không qua bộ nhập vẫn bị chặn bom `use`.
import { SVG_NS } from './sanitize.ts';

/** Số phần tử hiệu dụng tối đa sau mở `use` (contract svg-import §10). */
export const MAX_USE_EXPANSION = 100_000;

export interface UseCount {
  /** Số phần tử hiệu dụng (kẹp ở 1e15). */
  total: number;
  /** Có vòng tham chiếu `use` (đích là tổ tiên hoặc chính nó, gián tiếp cũng tính). */
  cycle: boolean;
  /** Số phần tử của tài liệu. */
  elements: number;
}

const CLAMP = 1e15;

function hrefOf(el: Element): string | null {
  const v = el.getAttribute('href');
  if (v === null) return null;
  const s = v.trim();
  return s.charCodeAt(0) === 35 ? s.slice(1) : null;
}

export function countEffective(root: Element, cap: number): UseCount {
  // 1. thu thập phần tử, id đầu tiên, và `use` ngoài defs
  const all: Element[] = [];
  const ids = new Map<string, Element>();
  const outerUses: Element[] = [];
  const stack: Array<{ el: Element; inDefs: boolean }> = [{ el: root, inDefs: false }];
  while (stack.length > 0) {
    const { el, inDefs } = stack.pop()!;
    all.push(el);
    const id = el.getAttribute('id');
    if (id !== null && !ids.has(id)) ids.set(id, el);
    if (el.localName === 'use' && el.namespaceURI === SVG_NS && !inDefs) outerUses.push(el);
    const nextDefs = inDefs || el.localName === 'defs';
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ el: kids[i], inDefs: nextDefs });
  }

  const memo = new Map<Element, number>();
  const state = new Map<Element, 1 | 2>();
  const targetOf = (el: Element): Element | null => {
    if (el.localName !== 'use') return null;
    const h = hrefOf(el);
    return h === null ? null : (ids.get(h) ?? null);
  };

  /** E(cây con) của `start`; -1 nếu gặp vòng. */
  const eall = (start: Element): number => {
    if (memo.has(start)) return memo.get(start)!;
    interface Frame {
      el: Element;
      kids: Element[];
      i: number;
      sum: number;
    }
    const mk = (el: Element): Frame => {
      const kids = Array.from(el.children);
      const t = targetOf(el);
      if (t) kids.push(t);
      return { el, kids, i: 0, sum: 1 };
    };
    const frames: Frame[] = [mk(start)];
    state.set(start, 1);
    while (frames.length > 0) {
      const f = frames[frames.length - 1];
      if (f.i < f.kids.length) {
        const k = f.kids[f.i++];
        const m = memo.get(k);
        if (m !== undefined) f.sum = Math.min(CLAMP, f.sum + m);
        else if (state.get(k) === 1) return -1;
        else {
          state.set(k, 1);
          frames.push(mk(k));
        }
      } else {
        frames.pop();
        memo.set(f.el, f.sum);
        state.set(f.el, 2);
        if (frames.length > 0) {
          const p = frames[frames.length - 1];
          p.sum = Math.min(CLAMP, p.sum + f.sum);
        }
      }
    }
    return memo.get(start)!;
  };

  let total = all.length;
  for (const u of outerUses) {
    const t = targetOf(u);
    if (!t) continue;
    const e = eall(t);
    if (e < 0) return { total, cycle: true, elements: all.length };
    total = Math.min(CLAMP, total + e);
    if (total > cap) return { total, cycle: false, elements: all.length };
  }
  return { total, cycle: false, elements: all.length };
}
