// Đệm hộp bao và chỉ mục của trình vẽ SVG (feature 011, T164; FR-114; contracts/svg-editor.md §11): tài liệu tới 20.000 nút
// mà mỗi lần tra bằng hàm thuần của @mat/svg-edit là O(n) (findByUid, documentOrder) hoặc O(độ sâu × cây con) (bbox). Đệm
// theo `NodeId`, chỉ xóa phần bị ảnh hưởng sau mỗi lô (nút đích, tổ tiên và cây con của nó), nên chọn bằng khung, bắt dính
// và vẽ lớp phủ không tính lại cả tài liệu. Chỉ mục toàn tài liệu (thứ tự, uid) dựng lại theo `doc.version` khi cần.
import {
  Batch,
  InsertNode,
  MoveNode,
  RemoveNode,
  SetAttr,
  bbox,
  documentOrder,
  isElement,
  type BBoxOptions,
  type Command,
  type Box,
  type DrawDoc,
  type NodeId,
} from '@mat/svg-edit';

/** Thuộc tính chỉ đổi hộp của chính nút (không đổi hệ tọa độ hay giá trị kế thừa của con). */
const LEAF_ATTRS: ReadonlySet<string> = new Set([
  'x',
  'y',
  'width',
  'height',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'd',
  'fill',
  'fill-opacity',
  'opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'visibility',
  'id',
  'data-mat-uid',
  'data-mat-name',
  'data-mat-layer',
]);

export class BoxCache {
  private boxes = new Map<NodeId, Box | null>();
  private orderVersion = -1;
  private order: NodeId[] = [];
  private orderIndex = new Map<NodeId, number>();
  private uidVersion = -1;
  private uids = new Map<string, NodeId>();
  /** Số lần tính hộp bao thật (đo hiệu năng, test). */
  computed = 0;

  private doc: DrawDoc;
  private readonly opts: BBoxOptions;

  constructor(doc: DrawDoc, opts: BBoxOptions = {}) {
    this.doc = doc;
    this.opts = opts;
  }

  /** Tài liệu mới (nạp lại): bỏ hết. */
  reset(doc: DrawDoc): void {
    this.doc = doc;
    this.boxes.clear();
    this.orderVersion = -1;
    this.uidVersion = -1;
  }

  /** Bỏ mọi hộp (sau hoàn tác, làm lại: lần tra sau tính lại theo nhu cầu). */
  clear(): void {
    this.boxes.clear();
  }

  private dropUp(id: NodeId | null | undefined): void {
    for (let cur = id ?? null; cur !== null; cur = this.doc.nodes.get(cur)?.parent ?? null)
      this.boxes.delete(cur);
  }

  private dropDown(id: NodeId): void {
    const stack = [id];
    while (stack.length) {
      const c = stack.pop()!;
      this.boxes.delete(c);
      const n = this.doc.nodes.get(c);
      if (n) for (const k of n.children) stack.push(k);
    }
  }

  /**
   * Sau khi áp một lệnh hoặc lô: bỏ hộp của nút đích và tổ tiên; cây con chỉ khi lệnh đổi hệ tọa độ hay thuộc tính kế thừa
   * của nó (transform, nét, phông, style…) hoặc chuyển/chèn cả cây con. Chèn vào gốc không làm tính lại cả tài liệu.
   */
  invalidateFor(cmd: Command): void {
    if (cmd instanceof Batch) {
      for (const c of cmd.commands) this.invalidateFor(c);
      return;
    }
    if (cmd instanceof SetAttr) {
      this.dropUp(cmd.node);
      if (!LEAF_ATTRS.has(cmd.name)) this.dropDown(cmd.node);
      return;
    }
    if (cmd instanceof InsertNode) {
      this.dropUp(cmd.parent);
      this.dropDown(cmd.subtree.root);
      return;
    }
    if (cmd instanceof MoveNode) {
      for (const t of cmd.targets()) this.dropUp(t);
      this.dropDown(cmd.node);
      return;
    }
    for (const t of cmd.targets()) {
      this.dropUp(t);
      if (cmd instanceof RemoveNode && t === cmd.node) this.dropDown(t);
    }
  }

  /** Hộp bao trong hệ tài liệu (đệm). */
  box(id: NodeId): Box | null {
    if (this.boxes.has(id)) return this.boxes.get(id)!;
    const n = this.doc.nodes.get(id);
    const b = n && isElement(n) ? bbox(this.doc, id, this.opts) : null;
    this.computed++;
    this.boxes.set(id, b);
    return b;
  }

  /** Mọi phần tử theo thứ tự tài liệu (dựng lại khi `doc.version` đổi). */
  documentOrder(): readonly NodeId[] {
    if (this.orderVersion !== this.doc.version) {
      this.order = documentOrder(this.doc);
      this.orderIndex = new Map(this.order.map((id, i) => [id, i]));
      this.orderVersion = this.doc.version;
    }
    return this.order;
  }

  /** Vị trí trong thứ tự tài liệu (so sánh nhanh để sắp vùng chọn). */
  indexOf(id: NodeId): number {
    this.documentOrder();
    return this.orderIndex.get(id) ?? -1;
  }

  byUid(uid: string): NodeId | null {
    if (this.uidVersion !== this.doc.version) {
      this.uids.clear();
      for (const n of this.doc.nodes.values()) {
        const u = n.attrs.get('data-mat-uid');
        if (u !== undefined) this.uids.set(u, n.id);
      }
      this.uidVersion = this.doc.version;
    }
    return this.uids.get(uid) ?? null;
  }
}

/** Hai hộp có giao nhau (kể cả chạm cạnh). */
export const intersects = (a: Box, b: Box): boolean =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/** Hộp `a` nằm trọn trong `b`. */
export const contains = (b: Box, a: Box): boolean =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;

/** Hộp chuẩn từ hai góc bất kỳ. */
export function boxOf(x1: number, y1: number, x2: number, y2: number): Box {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}
