// Đếm phần tử hiệu dụng sau mở `use` (chống bom `use`; contract svg-import §10), đo độ sâu chuỗi `use` và phát hiện vòng tham chiếu.
// Quy ước đếm `total` khớp tests/fixtures/svg-import/limits.mjs: E(tài liệu) = số phần tử (kể cả defs, use) + tổng
// E(đích) của mọi `use` nằm ngoài `defs`; E(cây con) = số phần tử + tổng E(đích) của mọi `use` trong cây con.
// Duyệt không đệ quy, ghi nhớ từng nút; số được kẹp để không tràn.
//
// T112 (rà soát bảo mật): `total` bỏ qua `use` nằm trong `defs`, nhưng Chrome dựng bóng (shadow tree) cho MỌI `use`, kể cả
// `use` không ai dùng và `use` trong `pattern`, `symbol`, `mask`. Hai số đo thêm, đều tính trên toàn tài liệu:
//  - `work` = E(gốc): tổng số nút Chrome phải dựng (mọi `use` ở đâu cũng được mở); bom nằm hết trong `defs` không lọt.
//  - `depth` = số `use` nối nhau dài nhất (use -> g chứa use -> ...): chuỗi 500 `use` mất 12 giây ở Chrome, 1.000 trở lên
//    treo hẳn dù chỉ 2.000 phần tử, nên đếm phần tử không đủ.
// T112: nằm ở @mat/svg-renderer (không phải @mat/svg-import) để trang vận hành (mountScreen) và bộ kiểm project dùng
// chung với bộ nhập: gói bị sửa tay không qua bộ nhập vẫn bị chặn.
import { SVG_NS } from './sanitize.ts';

/** Số phần tử hiệu dụng tối đa sau mở `use` ngoài `defs` (contract svg-import §10). */
export const MAX_USE_EXPANSION = 100_000;
/** Công việc dựng bóng tối đa của mọi `use` trong tài liệu (`work`); bộ ca biên 100.000 hiệu dụng dùng khoảng 136.000. */
export const MAX_USE_WORK = 300_000;
/** Số `use` nối nhau tối đa (đo ở Chrome: 50 tầng 60 ms, 200 tầng 0,5 giây, 500 tầng 12 giây). */
export const MAX_USE_DEPTH = 32;

export interface UseCount {
  /** Số phần tử hiệu dụng của `use` ngoài `defs` (kẹp ở 1e15); chỉ chính xác tới khi vượt `cap`. */
  total: number;
  /** Có vòng tham chiếu `use` (đích là tổ tiên hoặc chính nó, gián tiếp cũng tính). */
  cycle: boolean;
  /** Số phần tử của tài liệu. */
  elements: number;
  /** Công việc dựng bóng của mọi `use` (kể cả trong `defs`); 0 khi `total` đã vượt `cap` hoặc có vòng. */
  work: number;
  /** Số `use` nối nhau dài nhất; 0 khi `total` đã vượt `cap` hoặc có vòng. */
  depth: number;
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
  const memoHops = new Map<Element, number>();
  const state = new Map<Element, 1 | 2>();
  const targetOf = (el: Element): Element | null => {
    if (el.localName !== 'use') return null;
    const h = hrefOf(el);
    return h === null ? null : (ids.get(h) ?? null);
  };

  // Vòng tham chiếu: cạnh quay về nút đang duyệt bị bỏ qua (Chrome không dựng cạnh đó) và ghi `sawCycle`; vòng KHÔNG làm
  // dừng đo, nếu không thêm một vòng vô hại vào bom là qua mặt giới hạn.
  let sawCycle = false;

  /** E(cây con) của `start` (và số `use` nối nhau dài nhất trong `memoHops`). */
  const eall = (start: Element): number => {
    if (memo.has(start)) return memo.get(start)!;
    interface Frame {
      el: Element;
      kids: Element[];
      /** Chỉ số của đích `use` trong `kids` (-1 nếu không có). */
      tIdx: number;
      i: number;
      sum: number;
      hops: number;
    }
    const mk = (el: Element): Frame => {
      const kids = Array.from(el.children);
      const t = targetOf(el);
      const tIdx = t ? kids.length : -1;
      if (t) kids.push(t);
      return { el, kids, tIdx, i: 0, sum: 1, hops: 0 };
    };
    const frames: Frame[] = [mk(start)];
    state.set(start, 1);
    while (frames.length > 0) {
      const f = frames[frames.length - 1];
      if (f.i < f.kids.length) {
        const idx = f.i++;
        const k = f.kids[idx];
        const m = memo.get(k);
        if (m !== undefined) {
          f.sum = Math.min(CLAMP, f.sum + m);
          f.hops = Math.max(f.hops, memoHops.get(k)! + (idx === f.tIdx ? 1 : 0));
        } else if (state.get(k) === 1) {
          sawCycle = true;
        } else {
          state.set(k, 1);
          frames.push(mk(k));
        }
      } else {
        frames.pop();
        memo.set(f.el, f.sum);
        memoHops.set(f.el, f.hops);
        state.set(f.el, 2);
        if (frames.length > 0) {
          const p = frames[frames.length - 1];
          p.sum = Math.min(CLAMP, p.sum + f.sum);
          p.hops = Math.max(p.hops, f.hops + (p.i - 1 === p.tIdx ? 1 : 0));
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
    total = Math.min(CLAMP, total + e);
    if (total > cap) return { total, cycle: sawCycle, elements: all.length, work: 0, depth: 0 };
  }
  // Toàn tài liệu: E(gốc) mở cả `use` trong defs; cùng bộ nhớ đệm nên chi phí tuyến tính.
  const work = eall(root);
  return {
    total,
    cycle: sawCycle,
    elements: all.length,
    work,
    depth: memoHops.get(root) ?? 0,
  };
}

/** Lý do vượt giới hạn `use` (cho trang, bộ kiểm project, bộ nhập), hoặc null nếu trong giới hạn. Vòng tham chiếu không bị chặn ở đây. */
export function useLimitProblem(
  eff: UseCount,
  limits: { expansion?: number; work?: number; depth?: number } = {},
): string | null {
  const expansion = limits.expansion ?? MAX_USE_EXPANSION;
  const work = limits.work ?? MAX_USE_WORK;
  const depth = limits.depth ?? MAX_USE_DEPTH;
  if (eff.total > expansion) return `số phần tử hiệu dụng sau mở use vượt ${expansion}`;
  if (eff.work > work) return `công việc dựng bóng của use vượt ${work} phần tử`;
  if (eff.depth > depth) return `chuỗi use sâu hơn ${depth} tầng`;
  return null;
}
