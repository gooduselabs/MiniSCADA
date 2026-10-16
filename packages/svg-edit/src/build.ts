// Dựng cây con tách rời (chưa gắn vào tài liệu) cho lệnh InsertNode, và chụp cây con có sẵn (để đảo RemoveNode,
// sao chép). Mã nút cấp từ `doc.nextId` ngay lúc dựng nên làm lại (redo) dùng đúng mã cũ.
import type { DrawDoc, DrawNode, NodeId } from './node.ts';
import { COMMENT_NODE, TEXT_NODE, isElement } from './node.ts';

/** Mô tả một nút để dựng: phần tử (thuộc tính theo thứ tự) hoặc `#text`/`#comment` (dùng `text`). */
export interface NodeSpec {
  tag: string;
  attrs?: ReadonlyArray<readonly [string, string]>;
  children?: readonly NodeSpec[];
  /** Với phần tử: nội dung chữ (một nút `#text` con, trước `children`). Với `#text`/`#comment`: nội dung. */
  text?: string;
}

/** Cây con tách rời: gốc và mọi nút (theo thứ tự tài liệu, gốc đầu tiên). */
export interface Subtree {
  root: NodeId;
  nodes: DrawNode[];
}

/** Dựng cây con mới từ mô tả (không ném lỗi allowlist: InsertNode kiểm khi áp dụng). */
export function buildSubtree(doc: DrawDoc, spec: NodeSpec): Subtree {
  const nodes: DrawNode[] = [];
  const mk = (s: NodeSpec, parent: NodeId | null): DrawNode => {
    const n: DrawNode = { id: doc.nextId++, tag: s.tag, attrs: new Map(), children: [], parent };
    if (s.tag === TEXT_NODE || s.tag === COMMENT_NODE) n.text = s.text ?? '';
    else for (const [k, v] of s.attrs ?? []) n.attrs.set(k, v);
    nodes.push(n);
    return n;
  };
  const root = mk(spec, null);
  const stack: Array<[NodeSpec, DrawNode]> = [[spec, root]];
  while (stack.length > 0) {
    const [s, n] = stack.pop()!;
    if (n.tag === TEXT_NODE || n.tag === COMMENT_NODE) continue;
    const kids: NodeSpec[] = [];
    if (s.text !== undefined && s.text !== '') kids.push({ tag: TEXT_NODE, text: s.text });
    kids.push(...(s.children ?? []));
    const made: Array<[NodeSpec, DrawNode]> = [];
    for (const k of kids) {
      const c = mk(k, n.id);
      n.children.push(c.id);
      made.push([k, c]);
    }
    for (let i = made.length - 1; i >= 0; i--) stack.push(made[i]);
  }
  return { root: root.id, nodes };
}

function cloneNode(n: DrawNode): DrawNode {
  const c: DrawNode = { ...n, attrs: new Map(n.attrs), children: [...n.children] };
  return c;
}

/** Chụp cây con có sẵn (bản sao sâu, cùng mã nút, giữ nguyên văn). */
export function snapshotSubtree(doc: DrawDoc, id: NodeId): Subtree {
  const nodes: DrawNode[] = [];
  const stack: NodeId[] = [id];
  while (stack.length > 0) {
    const n = doc.nodes.get(stack.pop()!)!;
    nodes.push(cloneNode(n));
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  return { root: id, nodes };
}

/** Mô tả của một cây con có sẵn (bỏ nguyên văn): để sao chép sang tài liệu khác. */
export function specOf(doc: DrawDoc, id: NodeId): NodeSpec {
  const n = doc.nodes.get(id)!;
  if (!isElement(n)) return { tag: n.tag, text: n.text ?? '' };
  return {
    tag: n.tag,
    attrs: [...n.attrs],
    children: n.children.map((c) => specOf(doc, c)),
  };
}

/** Số phần tử và độ sâu của cây con tách rời. */
export function subtreeShape(sub: Subtree): { elements: number; depth: number } {
  const byId = new Map(sub.nodes.map((n) => [n.id, n]));
  let elements = 0;
  let depth = 0;
  const stack: Array<[NodeId, number]> = [[sub.root, 1]];
  while (stack.length > 0) {
    const [id, d] = stack.pop()!;
    const n = byId.get(id)!;
    if (!isElement(n)) continue;
    elements++;
    if (d > depth) depth = d;
    for (const c of n.children) stack.push([c, d + 1]);
  }
  return { elements, depth };
}
