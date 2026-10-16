// Xếp lớp (contracts/svg-editor.md §5; FR-104): lên/xuống trên cùng, lên/xuống một bậc trong cùng cha (bỏ qua chữ và
// chú thích); chuyển sang cha khác bằng MoveNode và bù ma trận để giữ hiển thị.
import { applyLocal, topLevel, type TransformResult } from './bake.ts';
import { Batch, CommandError, type Command } from './command.ts';
import { invert, isIdentity, multiply } from './matrix.ts';
import type { DrawDoc, NodeId } from './node.ts';
import { documentOrder, isAncestorOrSelf } from './node.ts';
import { Sim, moveUnit, pruneEmpty } from './structure.ts';
import { ctm } from './transform.ts';

/** Nhóm vùng chọn theo cha, mỗi nhóm theo thứ tự tài liệu. */
function byParent(doc: DrawDoc, ids: readonly NodeId[]): Map<NodeId, NodeId[]> {
  const order = documentOrder(doc);
  const out = new Map<NodeId, NodeId[]>();
  for (const id of topLevel(doc, ids).sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
    const p = doc.nodes.get(id)!.parent!;
    if (!out.has(p)) out.set(p, []);
    out.get(p)!.push(id);
  }
  return out;
}

/** Phần tử anh em (bỏ chữ, chú thích) trong bản mô phỏng. */
const siblings = (sim: Sim, p: NodeId): NodeId[] => sim.children(p).filter((c) => sim.isElement(c));

export function bringToFront(doc: DrawDoc, ids: readonly NodeId[]): Batch {
  const sim = new Sim(doc);
  const cmds: Command[] = [];
  for (const [p, sel] of byParent(doc, ids))
    for (const id of sel) cmds.push(...moveUnit(sim, id, p, null));
  return new Batch(cmds, { label: 'Đưa lên trên cùng' });
}

export function sendToBack(doc: DrawDoc, ids: readonly NodeId[]): Batch {
  const sim = new Sim(doc);
  const cmds: Command[] = [];
  for (const [p, sel] of byParent(doc, ids)) {
    const first = siblings(sim, p).find((c) => !sel.includes(c));
    if (first === undefined) continue;
    for (const id of sel) cmds.push(...moveUnit(sim, id, p, first));
  }
  return new Batch(cmds, { label: 'Đưa xuống dưới cùng' });
}

export function bringForward(doc: DrawDoc, ids: readonly NodeId[]): Batch {
  const sim = new Sim(doc);
  const cmds: Command[] = [];
  for (const [p, sel] of byParent(doc, ids)) {
    for (let i = sel.length - 1; i >= 0; i--) {
      const sib = siblings(sim, p);
      const k = sib.indexOf(sel[i]);
      const next = sib[k + 1];
      if (next === undefined || sel.includes(next)) continue;
      const after = sib[k + 2];
      cmds.push(...moveUnit(sim, sel[i], p, after ?? null));
    }
  }
  return new Batch(cmds, { label: 'Lên một bậc' });
}

export function sendBackward(doc: DrawDoc, ids: readonly NodeId[]): Batch {
  const sim = new Sim(doc);
  const cmds: Command[] = [];
  for (const [p, sel] of byParent(doc, ids)) {
    for (const id of sel) {
      const sib = siblings(sim, p);
      const k = sib.indexOf(id);
      const prev = sib[k - 1];
      if (prev === undefined || sel.includes(prev)) continue;
      cmds.push(...moveUnit(sim, id, p, prev));
    }
  }
  return new Batch(cmds, { label: 'Xuống một bậc' });
}

/**
 * Chuyển phần tử sang cha khác (trước `before`, null: trên cùng), giữ hiển thị: bù K = CTM(cha mới)⁻¹ · CTM(cha cũ)
 * (bake khi chính xác). Nhóm cũ rỗng tự bị xóa.
 */
export function moveToParent(
  doc: DrawDoc,
  ids: readonly NodeId[],
  parent: NodeId,
  before: NodeId | null,
): TransformResult {
  const order = documentOrder(doc);
  const sel = topLevel(doc, ids).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const id of sel)
    if (isAncestorOrSelf(doc, id, parent))
      throw new CommandError('SVG_INVALID', 'Không chuyển nút vào chính cây con của nó');
  const sim = new Sim(doc);
  const cmds: Command[] = [];
  const Pi = invert(ctm(doc, parent));
  if (!Pi) throw new CommandError('SVG_INVALID', 'Cha có ma trận suy biến');
  const olds = new Set<NodeId>();
  for (const id of sel) {
    const op = sim.parent(id)!;
    if (op !== parent) {
      const K = multiply(Pi, ctm(doc, op));
      if (!isIdentity(K)) cmds.push(...applyLocal(doc, id, K, { noReplace: true }).commands);
      olds.add(op);
    }
    cmds.push(...moveUnit(sim, id, parent, before));
  }
  cmds.push(...pruneEmpty(doc, sim, olds));
  return { batch: new Batch(cmds, { label: 'Chuyển' }), replaced: new Map() };
}
