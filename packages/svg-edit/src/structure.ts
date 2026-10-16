// Thao tác cấu trúc trên "đơn vị" = phần tử cùng khoảng trắng đứng ngay trước nó (dòng và thụt của nó): chuyển, xóa,
// chèn mà không để lại dòng trống hay dồn hai phần tử lên một dòng. Kế hoạch lệnh tính trên bản mô phỏng danh sách con
// nên chỉ số của từng MoveNode đúng với trạng thái lúc nó chạy trong lô. Nhóm rỗng (không phải lớp) tự bị xóa.
import { buildSubtree, type NodeSpec } from './build.ts';
import { Batch, InsertNode, MoveNode, RemoveNode, type Command } from './command.ts';
import type { DrawDoc, NodeId } from './node.ts';
import { TEXT_NODE, isElement, isWhitespaceText, walk } from './node.ts';
import { topLevel } from './bake.ts';

/** Bản mô phỏng danh sách con và cha (sao chép khi chạm). */
export class Sim {
  private readonly doc: DrawDoc;
  private readonly kids = new Map<NodeId, NodeId[]>();
  private readonly parents = new Map<NodeId, NodeId | null>();
  private readonly extra = new Map<NodeId, { tag: string; text?: string }>();
  constructor(doc: DrawDoc) {
    this.doc = doc;
  }
  /** Khai báo nút chưa có trong tài liệu (ví dụ g mới chèn trong cùng lô). */
  declare(id: NodeId, parent: NodeId | null, tag: string, children: NodeId[] = []): void {
    this.extra.set(id, { tag });
    this.parents.set(id, parent);
    this.kids.set(id, [...children]);
  }
  children(id: NodeId): NodeId[] {
    let k = this.kids.get(id);
    if (!k) {
      k = [...(this.doc.nodes.get(id)?.children ?? [])];
      this.kids.set(id, k);
    }
    return k;
  }
  parent(id: NodeId): NodeId | null {
    if (this.parents.has(id)) return this.parents.get(id)!;
    return this.doc.nodes.get(id)?.parent ?? null;
  }
  setParent(id: NodeId, p: NodeId | null): void {
    this.parents.set(id, p);
  }
  tag(id: NodeId): string {
    return this.extra.get(id)?.tag ?? this.doc.nodes.get(id)!.tag;
  }
  isWs(id: NodeId): boolean {
    if (this.extra.has(id)) return false;
    return isWhitespaceText(this.doc.nodes.get(id));
  }
  isElement(id: NodeId): boolean {
    if (this.extra.has(id)) return this.extra.get(id)!.tag !== TEXT_NODE;
    return isElement(this.doc.nodes.get(id)!);
  }
  /** Khoảng trắng ngay trước nút (null nếu không có). */
  precedingWs(id: NodeId): NodeId | null {
    const p = this.parent(id);
    if (p === null) return null;
    const k = this.children(p);
    const i = k.indexOf(id);
    return i > 0 && this.isWs(k[i - 1]) ? k[i - 1] : null;
  }
  /** Chỉ số đầu của đơn vị (khoảng trắng trước hoặc chính nút). */
  unitStart(id: NodeId): number {
    const k = this.children(this.parent(id)!);
    const ws = this.precedingWs(id);
    return k.indexOf(ws ?? id);
  }
  /** Chỉ số sau con cuối không phải khoảng trắng (trước khoảng trắng cuối của cha). */
  endIndex(parent: NodeId): number {
    const k = this.children(parent);
    let i = k.length;
    while (i > 0 && this.isWs(k[i - 1])) i--;
    return i;
  }
  remove(id: NodeId): void {
    const p = this.parent(id);
    if (p === null) return;
    const k = this.children(p);
    const i = k.indexOf(id);
    if (i >= 0) k.splice(i, 1);
  }
  insert(id: NodeId, parent: NodeId, index: number): void {
    this.children(parent).splice(index, 0, id);
    this.parents.set(id, parent);
  }
  elementCount(parent: NodeId): number {
    return this.children(parent).filter((c) => this.isElement(c)).length;
  }
}

/** Lệnh chuyển đơn vị (khoảng trắng trước + nút) tới cha mới, trước đơn vị `before` (null: cuối). */
export function moveUnit(sim: Sim, node: NodeId, parent: NodeId, before: NodeId | null): Command[] {
  const out: Command[] = [];
  const ws = sim.precedingWs(node);
  const target = (): number => (before === null ? sim.endIndex(parent) : sim.unitStart(before));
  if (ws !== null && ws !== before) {
    sim.remove(ws);
    const i = target();
    sim.insert(ws, parent, i);
    out.push(new MoveNode(ws, parent, i));
    sim.remove(node);
    const j = sim.children(parent).indexOf(ws) + 1;
    sim.insert(node, parent, j);
    out.push(new MoveNode(node, parent, j));
  } else {
    sim.remove(node);
    const i = target();
    sim.insert(node, parent, i);
    out.push(new MoveNode(node, parent, i));
  }
  return out;
}

/** Lệnh xóa đơn vị (nút rồi khoảng trắng trước nó). */
export function removeUnit(sim: Sim, node: NodeId): Command[] {
  const ws = sim.precedingWs(node);
  const out: Command[] = [new RemoveNode(node)];
  sim.remove(node);
  if (ws !== null) {
    out.push(new RemoveNode(ws));
    sim.remove(ws);
  }
  return out;
}

/** Lớp: `g` có `data-mat-layer` là con trực tiếp của gốc. */
export function isLayer(doc: DrawDoc, id: NodeId): boolean {
  const n = doc.nodes.get(id);
  return !!n && n.tag === 'g' && n.parent === doc.root && n.attrs.has('data-mat-layer');
}

/** Xóa các `g` (không phải gốc, không phải lớp) không còn phần tử con, lan lên tổ tiên. */
export function pruneEmpty(doc: DrawDoc, sim: Sim, candidates: Iterable<NodeId>): Command[] {
  const out: Command[] = [];
  const todo = [...candidates];
  const done = new Set<NodeId>();
  while (todo.length > 0) {
    const g = todo.pop()!;
    if (done.has(g) || g === doc.root || !doc.nodes.has(g)) continue;
    if (sim.tag(g) !== 'g' || isLayer(doc, g) || sim.elementCount(g) > 0) continue;
    const p = sim.parent(g);
    if (p === null) continue;
    done.add(g);
    out.push(...removeUnit(sim, g));
    todo.push(p);
  }
  return out;
}

/** Xóa phần tử (FR-110: trả uid trong các cây con bị xóa để giao diện cảnh báo binding). */
export function deleteNodes(
  doc: DrawDoc,
  ids: readonly NodeId[],
): { batch: Batch; uids: string[] } {
  const sim = new Sim(doc);
  const cmds: Command[] = [];
  const uids: string[] = [];
  const parents = new Set<NodeId>();
  for (const id of topLevel(doc, ids)) {
    walk(doc, id, (n) => {
      const u = n.attrs.get('data-mat-uid');
      if (u !== undefined) uids.push(u);
    });
    parents.add(sim.parent(id)!);
    cmds.push(...removeUnit(sim, id));
  }
  cmds.push(...pruneEmpty(doc, sim, parents));
  return { batch: new Batch(cmds, { label: 'Xóa' }), uids };
}

/** Chèn nút mới (từ mô tả) vào cha, trước đơn vị `before` hoặc cuối. */
export function insertSpec(
  doc: DrawDoc,
  parent: NodeId,
  spec: NodeSpec,
  before: NodeId | null = null,
  sim: Sim = new Sim(doc),
): { command: InsertNode; id: NodeId } {
  const sub = buildSubtree(doc, spec);
  const idx = before === null ? sim.endIndex(parent) : sim.unitStart(before);
  sim.declare(sub.root, null, spec.tag);
  sim.insert(sub.root, parent, idx);
  return { command: new InsertNode(parent, idx, sub), id: sub.root };
}
