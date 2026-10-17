// Tuần tự hóa chuẩn tắc (contracts/svg-editor.md §7; FR-111): nút không sửa ghi nguyên văn (cùng byte với tệp mở),
// nút đã sửa ghi dạng chuẩn tắc: thuộc tính theo thứ tự trong mô hình, nháy kép, thoát ký tự cố định (như `writeSvg`
// của feature 008). Nút mới được đặt trên dòng riêng với thụt đầu dòng của tệp; trong phần tử chữ không thêm khoảng
// trắng. Duyệt không đệ quy. Kết quả là `canonical(doc)` dùng cho so sánh trạng thái (hoàn tác, property test).
import { TEXT_ELEMENTS } from '@mat/svg-renderer';
import type { DrawDoc, DrawNode, NodeId } from './node.ts';
import { COMMENT_NODE, TEXT_NODE, isElement } from './node.ts';

export function escAttr(v: string): string {
  let out = '';
  let last = 0;
  for (let i = 0; i < v.length; i++) {
    let rep: string | null = null;
    switch (v.charCodeAt(i)) {
      case 38: rep = '&amp;'; break; // prettier-ignore
      case 60: rep = '&lt;'; break; // prettier-ignore
      case 62: rep = '&gt;'; break; // prettier-ignore
      case 34: rep = '&quot;'; break; // prettier-ignore
      case 9: rep = '&#9;'; break; // prettier-ignore
      case 10: rep = '&#10;'; break; // prettier-ignore
      case 13: rep = '&#13;'; break; // prettier-ignore
    }
    if (rep !== null) {
      out += v.slice(last, i) + rep;
      last = i + 1;
    }
  }
  return last === 0 ? v : out + v.slice(last);
}

export function escText(v: string): string {
  let out = '';
  let last = 0;
  for (let i = 0; i < v.length; i++) {
    let rep: string | null = null;
    switch (v.charCodeAt(i)) {
      case 38: rep = '&amp;'; break; // prettier-ignore
      case 60: rep = '&lt;'; break; // prettier-ignore
      case 62: rep = '&gt;'; break; // prettier-ignore
      case 13: rep = '&#13;'; break; // prettier-ignore
    }
    if (rep !== null) {
      out += v.slice(last, i) + rep;
      last = i + 1;
    }
  }
  return last === 0 ? v : out + v.slice(last);
}

/** Thẻ mở chuẩn tắc (không `>`). */
export function canonicalStart(n: DrawNode): string {
  let s = '<' + n.tag;
  for (const [k, v] of n.attrs) s += ` ${k}="${escAttr(v)}"`;
  return s;
}

function hasNewlineWs(n: DrawNode | undefined): boolean {
  return !!n && n.tag === TEXT_NODE && (n.text ?? '').indexOf('\n') >= 0 && isBlank(n.text ?? '');
}

function isBlank(t: string): boolean {
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13) return false;
  }
  return true;
}

/**
 * Nút mới (do lệnh tạo, chưa từng đọc từ tệp: `rawStart`/`raw` là `undefined`, khác `null` của nút đã sửa) được đặt
 * trên dòng riêng.
 */
function isFresh(n: DrawNode): boolean {
  if (isElement(n)) return n.rawStart === undefined;
  return n.tag === COMMENT_NODE && n.raw === undefined;
}

const XLINK_DECL = ' xmlns:xlink="http://www.w3.org/1999/xlink"';

/**
 * Cây từ `root` có thuộc tính `xlink:*` mà `root` không khai báo `xmlns:xlink` (khai báo ở phần tử con bị bỏ khi đọc, lệnh
 * đặt `xlink:href`, dán từ tài liệu khác): khi đó gốc phải được thêm khai báo, nếu không tệp ghi ra không phải XML hợp lệ
 * về namespace và màn hình không hiển thị (T202).
 */
function needsXlinkDecl(doc: DrawDoc, root: NodeId): boolean {
  const r = doc.nodes.get(root)!;
  if (!isElement(r) || r.attrs.has('xmlns:xlink')) return false;
  const stack: NodeId[] = [root];
  while (stack.length > 0) {
    const n = doc.nodes.get(stack.pop()!)!;
    if (!isElement(n)) continue;
    for (const k of n.attrs.keys()) if (k.startsWith('xlink:')) return true;
    for (const c of n.children) stack.push(c);
  }
  return false;
}

type Task = { kind: 'node'; id: NodeId; depth: number } | { kind: 'str'; s: string };

/** Văn bản SVG của tài liệu. */
export function serialize(doc: DrawDoc): string {
  const out: string[] = [doc.prolog];
  const nl = doc.newline;
  const ind = (depth: number): string => (doc.indent === '' ? '' : doc.indent.repeat(depth - 1));
  const stack: Task[] = [{ kind: 'node', id: doc.root, depth: 1 }];
  const addXlink = needsXlinkDecl(doc, doc.root);
  /** Thẻ mở của gốc kèm khai báo `xmlns:xlink` khi cần (chèn ngay sau tên thẻ). */
  const rootStart = (n: DrawNode, s: string): string =>
    addXlink && n.id === doc.root
      ? s.slice(0, n.tag.length + 1) + XLINK_DECL + s.slice(n.tag.length + 1)
      : s;
  while (stack.length > 0) {
    const t = stack.pop()!;
    if (t.kind === 'str') {
      out.push(t.s);
      continue;
    }
    const n = doc.nodes.get(t.id)!;
    if (n.tag === TEXT_NODE) {
      out.push(n.raw ?? escText(n.text ?? ''));
      continue;
    }
    if (n.tag === COMMENT_NODE) {
      out.push(n.raw ?? `<!--${n.text ?? ''}-->`);
      continue;
    }
    const kids = n.children;
    let start: string;
    let end: string;
    if (n.rawStart != null) {
      const selfClosed = n.rawEnd == null;
      if (kids.length === 0) {
        out.push(rootStart(n, n.rawStart) + (n.rawEnd ?? ''));
        continue;
      }
      if (selfClosed) {
        // thẻ tự đóng nay có con: bỏ `/>` (và khoảng trắng trước nó), thêm thẻ đóng
        let s = n.rawStart.slice(0, -2);
        while (s.length > 0 && isBlank(s[s.length - 1])) s = s.slice(0, -1);
        start = s + '>';
        end = `</${n.tag}>`;
      } else {
        start = n.rawStart;
        end = n.rawEnd!;
      }
    } else {
      const s = rootStart(n, canonicalStart(n));
      if (kids.length === 0) {
        out.push(s + '/>');
        continue;
      }
      start = s + '>';
      end = n.rawEnd ?? `</${n.tag}>`;
    }
    out.push(n.rawStart != null ? rootStart(n, start) : start);
    const layout = doc.pretty && !TEXT_ELEMENTS.has(n.tag);
    // phần tử mới: mọi con là phần tử/chú thích (kể cả con chuyển vào từ chỗ khác) đặt trên dòng riêng
    const freshParent = n.rawStart === undefined;
    const placed = (c: DrawNode): boolean => isFresh(c) || (freshParent && c.tag !== TEXT_NODE);
    const tasks: Task[] = [];
    for (let i = 0; i < kids.length; i++) {
      const c = doc.nodes.get(kids[i])!;
      if (layout && placed(c)) {
        const prev = i > 0 ? doc.nodes.get(kids[i - 1]) : undefined;
        const want = ind(t.depth + 1);
        if (!hasNewlineWs(prev)) tasks.push({ kind: 'str', s: nl + want });
        else {
          // sau khoảng trắng cuối của cha (thụt theo cha): bù phần thụt còn thiếu
          const ws = prev!.text ?? '';
          const have = ws.slice(ws.lastIndexOf('\n') + 1);
          if (want.length > have.length && want.startsWith(have))
            tasks.push({ kind: 'str', s: want.slice(have.length) });
        }
      }
      tasks.push({ kind: 'node', id: c.id, depth: t.depth + 1 });
    }
    if (layout && placed(doc.nodes.get(kids[kids.length - 1])!))
      tasks.push({ kind: 'str', s: nl + ind(t.depth) });
    tasks.push({ kind: 'str', s: end });
    for (let i = tasks.length - 1; i >= 0; i--) stack.push(tasks[i]);
  }
  out.push(doc.epilog);
  return out.join('');
}

/** Dạng chuẩn tắc để so trạng thái (bằng `serialize`). */
export const canonical = serialize;

/** Văn bản của một cây con (để sao chép, so sánh định nghĩa trùng). */
export function serializeSubtree(doc: DrawDoc, id: NodeId): string {
  const sub: DrawDoc = { ...doc, root: id, prolog: '', epilog: '' };
  return serialize(sub);
}
