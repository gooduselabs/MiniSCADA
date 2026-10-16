// Mô hình tài liệu `DrawDoc` của trình vẽ SVG (contracts/svg-editor.md §2): cây nút thuần TS, không DOM.
//
// Ngoài các trường của contract, mỗi nút mang phần "nguyên văn" (raw) đọc từ tệp để tuần tự hóa giữ byte phần không
// sửa (§7): thẻ mở và thẻ đóng nguyên văn của phần tử, nguyên văn của nút chữ và chú thích. Lệnh sửa thuộc tính xóa
// `rawStart` của chính nút đó (nút được ghi lại dạng chuẩn tắc) và khôi phục nó khi hoàn tác.

/** Mã nội bộ của phiên soạn thảo (không lưu vào tệp). */
export type NodeId = number;

/** Thẻ phần tử (trong allowlist của @mat/svg-renderer) hoặc nút giả `#text`, `#comment`. */
export type NodeTag = string;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DrawNode {
  id: NodeId;
  tag: NodeTag;
  /** Giá trị đã giải mã thực thể, theo thứ tự trong tệp (Map giữ thứ tự chèn). Rỗng với `#text`, `#comment`. */
  attrs: Map<string, string>;
  children: NodeId[];
  parent: NodeId | null;
  /** Nội dung của `#text` (đã giải mã) hoặc của `#comment` (bên trong `<!--` `-->`). */
  text?: string;
  /**
   * Thẻ mở nguyên văn (kể cả `<`, `>` hoặc `/>`); `null`: đọc từ tệp nhưng đã sửa thuộc tính; `undefined`: nút mới
   * (bộ ghi đặt nút mới trên dòng riêng).
   */
  rawStart?: string | null;
  /** Thẻ đóng nguyên văn; null khi thẻ mở tự đóng hoặc nút mới. */
  rawEnd?: string | null;
  /** Nguyên văn của `#text` (thực thể, CDATA) hoặc `#comment`; null khi đã sửa; undefined khi mới. */
  raw?: string | null;
}

export interface DrawDoc {
  root: NodeId;
  nodes: Map<NodeId, DrawNode>;
  viewBox: Box;
  /** Tăng sau mỗi lô áp dụng, hoàn tác hay làm lại. */
  version: number;
  /** Mã nút kế tiếp (tăng dần, không dùng lại). */
  nextId: NodeId;
  /** Phần trước phần tử gốc (BOM, khai báo XML, chú thích, khoảng trắng), nguyên văn. */
  prolog: string;
  /** Phần sau thẻ đóng của gốc, nguyên văn. */
  epilog: string;
  /** Đơn vị thụt đầu dòng phát hiện từ tệp ('' cho tệp do bộ nhập ghi), dùng cho nút mới. */
  indent: string;
  /** Kiểu xuống dòng của tệp. */
  newline: '\n' | '\r\n';
  /** Tệp có xuống dòng giữa các phần tử (nút mới được đặt trên dòng riêng). */
  pretty: boolean;
  /** Số phần tử (kể cả gốc). */
  elementCount: number;
  /** Bộ sinh `data-mat-uid` (của @mat/svg-import). */
  uid: () => string;
}

export const TEXT_NODE = '#text';
export const COMMENT_NODE = '#comment';

export function isElement(n: DrawNode): boolean {
  return n.tag !== TEXT_NODE && n.tag !== COMMENT_NODE;
}

export function getNode(doc: DrawDoc, id: NodeId): DrawNode {
  const n = doc.nodes.get(id);
  if (!n) throw new Error(`Không có nút ${id}`);
  return n;
}

/** Con là phần tử (bỏ chữ và chú thích), theo thứ tự tài liệu. */
export function elementChildren(doc: DrawDoc, id: NodeId): NodeId[] {
  return getNode(doc, id).children.filter((c) => isElement(doc.nodes.get(c)!));
}

/** Độ sâu (gốc là 1). */
export function depthOf(doc: DrawDoc, id: NodeId): number {
  let d = 0;
  for (let cur: NodeId | null = id; cur !== null; cur = doc.nodes.get(cur)!.parent) d++;
  return d;
}

/** Tổ tiên từ cha lên gốc. */
export function ancestors(doc: DrawDoc, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  for (let cur = getNode(doc, id).parent; cur !== null; cur = doc.nodes.get(cur)!.parent)
    out.push(cur);
  return out;
}

export function isAncestorOrSelf(doc: DrawDoc, anc: NodeId, id: NodeId): boolean {
  for (let cur: NodeId | null = id; cur !== null; cur = doc.nodes.get(cur)!.parent)
    if (cur === anc) return true;
  return false;
}

/** Duyệt cây con theo thứ tự tài liệu (không đệ quy). */
export function walk(doc: DrawDoc, id: NodeId, visit: (n: DrawNode, depth: number) => void): void {
  const stack: Array<[NodeId, number]> = [[id, 0]];
  while (stack.length > 0) {
    const [cur, d] = stack.pop()!;
    const n = doc.nodes.get(cur)!;
    visit(n, d);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push([n.children[i], d + 1]);
  }
}

/** Mọi phần tử theo thứ tự tài liệu. */
export function documentOrder(doc: DrawDoc, from: NodeId = doc.root): NodeId[] {
  const out: NodeId[] = [];
  walk(doc, from, (n) => {
    if (isElement(n)) out.push(n.id);
  });
  return out;
}

/** Số phần tử và độ sâu lớn nhất (tương đối, gốc cây con là 1) của một cây con. */
export function subtreeStats(doc: DrawDoc, id: NodeId): { elements: number; depth: number } {
  let elements = 0;
  let depth = 0;
  walk(doc, id, (n, d) => {
    if (!isElement(n)) return;
    elements++;
    if (d + 1 > depth) depth = d + 1;
  });
  return { elements, depth };
}

/** Phần tử "giữ nguyên, không sửa sâu" (§2): chọn và biến đổi như một khối, không sửa bên trong. */
export const OPAQUE_TAGS: ReadonlySet<string> = new Set(['mask', 'filter', 'pattern', 'marker']);

/** Khối giữ nguyên gần nhất chứa nút (kể cả chính nút); null nếu không có. `svg` lồng là khối. */
export function opaqueBlockOf(doc: DrawDoc, id: NodeId): NodeId | null {
  let found: NodeId | null = null;
  for (let cur: NodeId | null = id; cur !== null; cur = doc.nodes.get(cur)!.parent) {
    const n = doc.nodes.get(cur)!;
    if (OPAQUE_TAGS.has(n.tag) || (n.tag === 'svg' && cur !== doc.root)) found = cur;
  }
  return found;
}

/** Nút nằm TRONG một khối giữ nguyên (không phải chính khối): không sửa được. */
export function isInsideOpaque(doc: DrawDoc, id: NodeId): boolean {
  const b = opaqueBlockOf(doc, id);
  return b !== null && b !== id;
}

/** Phần tử chỉ để định nghĩa (không tự vẽ): con của chúng không chọn được trên canvas. */
export const DEFINITION_TAGS: ReadonlySet<string> = new Set([
  'defs',
  'clipPath',
  'mask',
  'symbol',
  'pattern',
  'marker',
  'filter',
  'linearGradient',
  'radialGradient',
  'title',
]);

/** Nút nằm trong vùng định nghĩa (defs, clipPath…) hoặc chính là phần tử định nghĩa. */
export function isInDefinitions(doc: DrawDoc, id: NodeId): boolean {
  for (let cur: NodeId | null = id; cur !== null; cur = doc.nodes.get(cur)!.parent)
    if (DEFINITION_TAGS.has(doc.nodes.get(cur)!.tag)) return true;
  return false;
}

/** Tìm phần tử theo `data-mat-uid`. */
export function findByUid(doc: DrawDoc, uid: string): NodeId | null {
  for (const n of doc.nodes.values()) if (n.attrs.get('data-mat-uid') === uid) return n.id;
  return null;
}

/** Tìm phần tử theo `id`. */
export function findById(doc: DrawDoc, idAttr: string): NodeId | null {
  for (const id of documentOrder(doc)) if (doc.nodes.get(id)!.attrs.get('id') === idAttr) return id;
  return null;
}

/** Nội dung chữ của phần tử (nối các `#text` con trực tiếp). */
export function textOf(doc: DrawDoc, id: NodeId): string {
  let s = '';
  for (const c of getNode(doc, id).children) {
    const n = doc.nodes.get(c)!;
    if (n.tag === TEXT_NODE) s += n.text ?? '';
  }
  return s;
}

/** Nút khoảng trắng thuần. */
export function isWhitespaceText(n: DrawNode | undefined): boolean {
  if (!n || n.tag !== TEXT_NODE) return false;
  const t = n.text ?? '';
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13) return false;
  }
  return true;
}
