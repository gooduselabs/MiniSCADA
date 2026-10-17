// Lệnh đảo ngược được (contracts/svg-editor.md §3; FR-098, FR-110; research R26). Lệnh nguyên tử: SetAttr, SetText,
// InsertNode, RemoveNode, MoveNode; `Batch` là một thao tác người dùng (một bước hoàn tác); `ExternalCommand` cho dữ
// liệu ngoài SVG đi cùng lô (ví dụ bản ghi binding khi xóa phần tử, FR-110).
//
// Quy ước: `invert(doc)` gọi TRƯỚC `apply(doc)` (chụp giá trị cũ, không chụp cả cây). Dùng `applyCommand` (kiểm, đảo,
// áp, kiểm sau, tăng `doc.version`) thay vì gọi `apply` trực tiếp. Lệnh bị từ chối ném `CommandError` và không đổi
// tài liệu (lô lỗi giữa chừng được cuộn lại).
import { ATTR_RULES, TEXT_ELEMENTS } from '@mat/svg-renderer';
import {
  checkAttr,
  elementProblem,
  hasInvalidXmlChar,
  placementProblem,
  structuralProblem,
} from './allow.ts';
import type { Subtree } from './build.ts';
import { snapshotSubtree, subtreeShape } from './build.ts';
import {
  SVG_MAX_BYTES,
  SVG_MAX_DEPTH,
  SVG_MAX_NODES,
  SVG_MAX_TEXT,
  SVG_MAX_TITLE,
} from './limits.ts';
import type { DrawDoc, DrawNode, NodeId } from './node.ts';
import {
  COMMENT_NODE,
  OPAQUE_TAGS,
  TEXT_NODE,
  depthOf,
  isAncestorOrSelf,
  isElement,
  isInsideOpaque,
  isWhitespaceText,
  subtreeStats,
} from './node.ts';
import { rootViewBox } from './parse.ts';

/**
 * Lý do từ chối: `SVG_LIMIT` (5 MB, 20.000 nút, độ sâu 32, ảnh, bộ lọc, bom use), `SVG_UNSAFE` (ngoài allowlist),
 * `SVG_LOCKED` (bên trong phần tử giữ nguyên: mask, filter, pattern, marker, svg lồng), `SVG_INVALID` (nút không có,
 * vị trí sai, uid/id trùng, vòng cha con).
 */
export type CommandErrorCode = 'SVG_LIMIT' | 'SVG_UNSAFE' | 'SVG_LOCKED' | 'SVG_INVALID';

/** Mã danh mục (schemas/error-codes.json) để hiện cho người dùng. */
export const CATALOG_CODE: Readonly<Record<CommandErrorCode, string | null>> = {
  SVG_LIMIT: 'E_SVG_LIMIT',
  SVG_UNSAFE: 'E_SVG_UNSAFE',
  SVG_LOCKED: null,
  SVG_INVALID: null,
};

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  /** Mã lý do của allowlist (`R_*`) khi `code` là SVG_UNSAFE. */
  readonly reason?: string;
  constructor(code: CommandErrorCode, message: string, reason?: string) {
    super(message);
    this.code = code;
    this.reason = reason;
  }
}

export interface Command {
  kind: string;
  apply(doc: DrawDoc): void;
  invert(doc: DrawDoc): Command;
  mergeKey?: string;
  /** Nút bị ảnh hưởng (giao diện chỉ vẽ lại các nút này). */
  targets(): NodeId[];
}

/** Lệnh nguyên tử: kiểm trước khi áp và kiểm sau (giới hạn cấu trúc). */
interface Atomic extends Command {
  validate(doc: DrawDoc): void;
  needsStructuralCheck(doc: DrawDoc): boolean;
}

const fail = (code: CommandErrorCode, msg: string, reason?: string): never => {
  throw new CommandError(code, msg, reason);
};

function elementOrFail(doc: DrawDoc, id: NodeId): DrawNode {
  const n = doc.nodes.get(id);
  if (!n) return fail('SVG_INVALID', `Không có nút ${id}`);
  if (!isElement(n)) return fail('SVG_INVALID', `Nút ${id} không phải phần tử`);
  return n;
}

function lockedFail(doc: DrawDoc, id: NodeId): void {
  if (isInsideOpaque(doc, id))
    fail(
      'SVG_LOCKED',
      'Phần tử nằm trong khối giữ nguyên (mask, filter, pattern, marker, svg lồng)',
    );
}

// --- thứ tự thuộc tính mới (§7) -----------------------------------------------------------------

function rankOf(tag: string, name: string): [number, string] {
  if (name === 'xmlns' || name === 'xmlns:xlink') return [-1, ''];
  if (name === 'id') return [0, ''];
  if (name.startsWith('data-mat-')) return [1, ''];
  if (ATTR_RULES.get(tag)?.has(name) || name === 'xlink:href') return [2, ''];
  if (name === 'transform') return [3, ''];
  if (name === 'fill') return [4, ''];
  if (name === 'stroke') return [5, ''];
  if (name.startsWith('stroke-')) return [6, ''];
  if (name === 'opacity') return [7, ''];
  return [8, name];
}

function keyLe(a: [number, string], b: [number, string]): boolean {
  return a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
}

/** Vị trí chèn thuộc tính mới: sau thuộc tính cuối cùng có hạng ≤ hạng của nó. */
function insertIndex(n: DrawNode, name: string): number {
  const k = rankOf(n.tag, name);
  let idx = 0;
  let i = 0;
  for (const existing of n.attrs.keys()) {
    i++;
    if (keyLe(rankOf(n.tag, existing), k)) idx = i;
  }
  return idx;
}

function setAt(n: DrawNode, name: string, value: string, index: number): void {
  const entries = [...n.attrs].filter(([k]) => k !== name);
  entries.splice(Math.min(index, entries.length), 0, [name, value]);
  n.attrs = new Map(entries);
}

// --- SetAttr ------------------------------------------------------------------------------------

interface AttrRestore {
  index: number;
  rawStart: string | null | undefined;
}

/**
 * `xlink:href` chỉ ghi được khi gốc khai báo `xmlns:xlink` (không đổi được bằng lệnh): thiếu thì văn bản ghi ra có tiền
 * tố không khai báo, không phải XML hợp lệ (fuzz T165, src/fuzz-regress.test.ts). Dùng `href`.
 */
function xlinkDeclaredOrFail(doc: DrawDoc): void {
  if (!doc.nodes.get(doc.root)!.attrs.has('xmlns:xlink'))
    fail('SVG_INVALID', 'xlink:href cần khai báo xmlns:xlink ở gốc; dùng href');
}

export class SetAttr implements Atomic {
  readonly kind = 'SetAttr';
  readonly node: NodeId;
  readonly name: string;
  value: string | null;
  mergeKey?: string;
  private readonly restore?: AttrRestore;

  constructor(node: NodeId, name: string, value: string | null, restore?: AttrRestore) {
    this.node = node;
    this.name = name;
    this.value = value;
    this.restore = restore;
  }

  targets(): NodeId[] {
    return [this.node];
  }

  validate(doc: DrawDoc): void {
    const n = elementOrFail(doc, this.node);
    lockedFail(doc, this.node);
    if (OPAQUE_TAGS.has(n.tag) && this.name !== 'data-mat-name')
      fail('SVG_LOCKED', `Không sửa thuộc tính của ${n.tag} (giữ nguyên)`);
    if (this.name === 'xmlns' || this.name === 'xmlns:xlink')
      fail('SVG_INVALID', 'Không đổi khai báo namespace');
    if (this.value === null) return;
    if (this.name === 'xlink:href') xlinkDeclaredOrFail(doc);
    if (this.value.length > SVG_MAX_BYTES) fail('SVG_LIMIT', 'Giá trị thuộc tính quá dài');
    const v = checkAttr(n.tag, this.name, this.value, this.node === doc.root);
    if (!v.ok)
      fail(
        'SVG_UNSAFE',
        `Thuộc tính ${this.name}="${this.value.slice(0, 40)}" ngoài allowlist`,
        v.code,
      );
    else this.value = v.value;
    if (this.name === 'data-mat-uid' || this.name === 'id') {
      for (const o of doc.nodes.values())
        if (o.id !== this.node && o.attrs.get(this.name) === this.value)
          fail('SVG_INVALID', `${this.name} "${this.value}" đã có`);
    }
  }

  needsStructuralCheck(doc: DrawDoc): boolean {
    const n = doc.nodes.get(this.node)!;
    return (
      this.name === 'href' ||
      this.name === 'xlink:href' ||
      this.name === 'id' ||
      n.tag === 'image' ||
      n.tag === 'use'
    );
  }

  invert(doc: DrawDoc): Command {
    const n = doc.nodes.get(this.node)!;
    const old = n.attrs.get(this.name) ?? null;
    const index = [...n.attrs.keys()].indexOf(this.name);
    return new SetAttr(this.node, this.name, old, {
      index: index < 0 ? 0 : index,
      rawStart: n.rawStart,
    });
  }

  apply(doc: DrawDoc): void {
    const n = doc.nodes.get(this.node)!;
    if (this.value === null) n.attrs.delete(this.name);
    else if (n.attrs.has(this.name)) n.attrs.set(this.name, this.value);
    else
      setAt(
        n,
        this.name,
        this.value,
        this.restore ? this.restore.index : insertIndex(n, this.name),
      );
    if (this.restore) n.rawStart = this.restore.rawStart;
    else if (n.rawStart !== undefined) n.rawStart = null;
    if (this.node === doc.root) doc.viewBox = rootViewBox(doc);
  }
}

// --- SetText ------------------------------------------------------------------------------------

export class SetText implements Atomic {
  readonly kind = 'SetText';
  readonly node: NodeId;
  readonly text: string;
  mergeKey?: string;
  /** Mã nút chữ tạo mới (cấp lần đầu áp dụng, dùng lại khi làm lại). */
  private created: NodeId | null = null;

  constructor(node: NodeId, text: string) {
    this.node = node;
    this.text = text;
  }

  targets(): NodeId[] {
    return [this.node];
  }

  validate(doc: DrawDoc): void {
    const n = doc.nodes.get(this.node);
    if (!n) fail('SVG_INVALID', `Không có nút ${this.node}`);
    lockedFail(doc, this.node);
    if (hasInvalidXmlChar(this.text))
      fail('SVG_UNSAFE', 'Chữ có ký tự không hợp lệ', 'R_VALUE_INVALID');
    const owner = n!.tag === TEXT_NODE ? doc.nodes.get(n!.parent!)! : n!;
    if (n!.tag === COMMENT_NODE) fail('SVG_INVALID', 'Không đặt chữ cho chú thích');
    if (!TEXT_ELEMENTS.has(owner.tag)) {
      if (n!.tag === TEXT_NODE && isWhitespaceText({ ...n!, text: this.text })) return;
      fail('SVG_INVALID', `Phần tử ${owner.tag} không chứa chữ`);
    }
    const limit = owner.tag === 'title' ? SVG_MAX_TITLE : SVG_MAX_TEXT;
    if (this.text.length > limit) fail('SVG_LIMIT', `Chữ dài quá ${limit} ký tự`);
    if (n!.tag !== TEXT_NODE)
      for (const c of n!.children)
        if (doc.nodes.get(c)!.tag !== TEXT_NODE)
          fail('SVG_INVALID', 'Phần tử có phần tử con: đặt chữ cho tspan hoặc nút chữ');
  }

  needsStructuralCheck(): boolean {
    return false;
  }

  invert(doc: DrawDoc): Command {
    const n = doc.nodes.get(this.node)!;
    if (n.tag === TEXT_NODE) return new RestoreText(this.node, null, [{ ...n, attrs: new Map() }]);
    return new RestoreText(
      this.node,
      [...n.children],
      n.children.map((c) => ({ ...doc.nodes.get(c)!, attrs: new Map() })),
    );
  }

  apply(doc: DrawDoc): void {
    const n = doc.nodes.get(this.node)!;
    if (n.tag === TEXT_NODE) {
      n.text = this.text;
      n.raw = null;
      return;
    }
    for (const c of n.children.slice(1)) doc.nodes.delete(c);
    const first = n.children.length > 0 ? doc.nodes.get(n.children[0])! : null;
    if (this.text === '') {
      if (first) doc.nodes.delete(first.id);
      n.children = [];
      return;
    }
    if (first) {
      first.text = this.text;
      first.raw = null;
      n.children = [first.id];
      return;
    }
    if (this.created === null) this.created = doc.nextId++;
    doc.nodes.set(this.created, {
      id: this.created,
      tag: TEXT_NODE,
      attrs: new Map(),
      children: [],
      parent: n.id,
      text: this.text,
      raw: null,
    });
    n.children = [this.created];
  }
}

/** Đảo của SetText: khôi phục đúng các nút chữ cũ (mã, nội dung, nguyên văn). */
class RestoreText implements Atomic {
  readonly kind = 'SetText';
  private readonly node: NodeId;
  private readonly children: NodeId[] | null;
  private readonly saved: DrawNode[];
  constructor(node: NodeId, children: NodeId[] | null, saved: DrawNode[]) {
    this.node = node;
    this.children = children;
    this.saved = saved;
  }
  targets(): NodeId[] {
    return [this.node];
  }
  validate(doc: DrawDoc): void {
    if (!doc.nodes.has(this.node)) fail('SVG_INVALID', `Không có nút ${this.node}`);
  }
  needsStructuralCheck(): boolean {
    return false;
  }
  invert(doc: DrawDoc): Command {
    const n = doc.nodes.get(this.node)!;
    if (n.tag === TEXT_NODE) return new RestoreText(this.node, null, [{ ...n, attrs: new Map() }]);
    return new RestoreText(
      this.node,
      [...n.children],
      n.children.map((c) => ({ ...doc.nodes.get(c)!, attrs: new Map() })),
    );
  }
  apply(doc: DrawDoc): void {
    const n = doc.nodes.get(this.node)!;
    if (this.children === null) {
      const s = this.saved[0];
      n.text = s.text;
      n.raw = s.raw;
      return;
    }
    for (const c of n.children) doc.nodes.delete(c);
    for (const s of this.saved) doc.nodes.set(s.id, { ...s, attrs: new Map() });
    n.children = [...this.children];
  }
}

// --- InsertNode, RemoveNode, MoveNode -------------------------------------------------------------

function checkPlacementTree(doc: DrawDoc, parent: DrawNode, sub: Subtree): void {
  const byId = new Map(sub.nodes.map((n) => [n.id, n]));
  const uids = new Set<string>();
  const ids = new Set<string>();
  for (const o of doc.nodes.values()) {
    const u = o.attrs.get('data-mat-uid');
    if (u !== undefined) uids.add(u);
    const i = o.attrs.get('id');
    if (i !== undefined) ids.add(i);
  }
  const stack: Array<[NodeId, DrawNode]> = [[sub.root, parent]];
  while (stack.length > 0) {
    const [id, p] = stack.pop()!;
    const n = byId.get(id);
    if (!n) return fail('SVG_INVALID', `Cây con thiếu nút ${id}`);
    if (doc.nodes.has(id)) fail('SVG_INVALID', `Mã nút ${id} đã có trong tài liệu`);
    if (n.tag === TEXT_NODE) {
      const t = n.text ?? '';
      if (hasInvalidXmlChar(t)) fail('SVG_UNSAFE', 'Chữ có ký tự không hợp lệ', 'R_VALUE_INVALID');
      if (!TEXT_ELEMENTS.has(p.tag) && !isWhitespaceText(n))
        fail('SVG_UNSAFE', `Chữ ngoài phần tử chữ (${p.tag})`, 'R_ELEMENT_NOT_ALLOWED');
      if (t.length > (p.tag === 'title' ? SVG_MAX_TITLE : SVG_MAX_TEXT))
        fail('SVG_LIMIT', 'Chữ quá dài');
      continue;
    }
    if (n.tag === COMMENT_NODE) {
      const t = n.text ?? '';
      if (hasInvalidXmlChar(t) || t.indexOf('--') >= 0 || t.endsWith('-'))
        fail('SVG_UNSAFE', 'Chú thích không hợp lệ', 'R_VALUE_INVALID');
      continue;
    }
    const prob =
      (n.tag === 'a' ? 'R_ELEMENT_NOT_ALLOWED' : elementProblem(n.tag)) ??
      placementProblem(p.tag, n.tag);
    if (prob !== null) fail('SVG_UNSAFE', `Phần tử <${n.tag.slice(0, 40)}> ngoài allowlist`, prob);
    for (const [k, v] of [...n.attrs]) {
      if (k === 'xlink:href') xlinkDeclaredOrFail(doc);
      if (v.length > SVG_MAX_BYTES) fail('SVG_LIMIT', 'Giá trị thuộc tính quá dài');
      const verdict = checkAttr(n.tag, k, v, false);
      if (!verdict.ok)
        fail('SVG_UNSAFE', `Thuộc tính ${k.slice(0, 40)} ngoài allowlist`, verdict.code);
      else if (verdict.value !== v) n.attrs.set(k, verdict.value);
      if (k === 'data-mat-uid') {
        if (uids.has(v)) fail('SVG_INVALID', `data-mat-uid "${v}" đã có`);
        uids.add(v);
      }
      if (k === 'id') {
        if (ids.has(v)) fail('SVG_INVALID', `id "${v}" đã có`);
        ids.add(v);
      }
    }
    for (const c of n.children) stack.push([c, n]);
  }
}

export class InsertNode implements Atomic {
  readonly kind = 'InsertNode';
  readonly parent: NodeId;
  readonly index: number;
  readonly subtree: Subtree;
  mergeKey?: string;

  constructor(parent: NodeId, index: number, subtree: Subtree) {
    this.parent = parent;
    this.index = index;
    this.subtree = subtree;
  }

  targets(): NodeId[] {
    return [this.parent, this.subtree.root];
  }

  validate(doc: DrawDoc): void {
    const p = elementOrFail(doc, this.parent);
    if (
      isInsideOpaque(doc, this.parent) ||
      OPAQUE_TAGS.has(p.tag) ||
      (p.tag === 'svg' && p.id !== doc.root)
    )
      fail('SVG_LOCKED', 'Không chèn vào khối giữ nguyên');
    if (this.index < 0 || this.index > p.children.length || !Number.isInteger(this.index))
      fail('SVG_INVALID', `Vị trí ${this.index} ngoài khoảng`);
    const shape = subtreeShape(this.subtree);
    if (doc.elementCount + shape.elements > SVG_MAX_NODES)
      fail('SVG_LIMIT', `Vượt ${SVG_MAX_NODES} phần tử`);
    if (depthOf(doc, this.parent) + shape.depth > SVG_MAX_DEPTH)
      fail('SVG_LIMIT', `Vượt độ sâu ${SVG_MAX_DEPTH}`);
    checkPlacementTree(doc, p, this.subtree);
  }

  needsStructuralCheck(): boolean {
    return true;
  }

  invert(): Command {
    return new RemoveNode(this.subtree.root);
  }

  apply(doc: DrawDoc): void {
    const p = doc.nodes.get(this.parent)!;
    for (const n of this.subtree.nodes) {
      const c: DrawNode = { ...n, attrs: new Map(n.attrs), children: [...n.children] };
      if (c.id === this.subtree.root) c.parent = this.parent;
      doc.nodes.set(c.id, c);
      if (isElement(c)) doc.elementCount++;
    }
    p.children.splice(this.index, 0, this.subtree.root);
  }
}

export class RemoveNode implements Atomic {
  readonly kind = 'RemoveNode';
  readonly node: NodeId;
  mergeKey?: string;
  private parentId: NodeId | null = null;

  constructor(node: NodeId) {
    this.node = node;
  }

  targets(): NodeId[] {
    return this.parentId === null ? [this.node] : [this.node, this.parentId];
  }

  validate(doc: DrawDoc): void {
    const n = doc.nodes.get(this.node);
    if (!n) fail('SVG_INVALID', `Không có nút ${this.node}`);
    if (this.node === doc.root) fail('SVG_INVALID', 'Không xóa phần tử gốc');
    lockedFail(doc, this.node);
  }

  needsStructuralCheck(): boolean {
    return false;
  }

  invert(doc: DrawDoc): Command {
    const n = doc.nodes.get(this.node)!;
    const p = doc.nodes.get(n.parent!)!;
    const snap = snapshotSubtree(doc, this.node);
    snap.nodes[0].parent = null;
    return new InsertNode(p.id, p.children.indexOf(this.node), snap);
  }

  apply(doc: DrawDoc): void {
    const n = doc.nodes.get(this.node)!;
    const p = doc.nodes.get(n.parent!)!;
    this.parentId = p.id;
    p.children.splice(p.children.indexOf(this.node), 1);
    const stats = subtreeStats(doc, this.node);
    const stack = [this.node];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const m = doc.nodes.get(id)!;
      doc.nodes.delete(id);
      stack.push(...m.children);
    }
    doc.elementCount -= stats.elements;
  }
}

export class MoveNode implements Atomic {
  readonly kind = 'MoveNode';
  readonly node: NodeId;
  readonly newParent: NodeId;
  /** Vị trí trong `children` của cha mới SAU khi đã gỡ nút khỏi cha cũ. */
  readonly newIndex: number;
  mergeKey?: string;
  private oldParent: NodeId | null = null;

  constructor(node: NodeId, newParent: NodeId, newIndex: number) {
    this.node = node;
    this.newParent = newParent;
    this.newIndex = newIndex;
  }

  targets(): NodeId[] {
    return this.oldParent === null
      ? [this.node, this.newParent]
      : [this.node, this.newParent, this.oldParent];
  }

  validate(doc: DrawDoc): void {
    const n = doc.nodes.get(this.node);
    if (!n) fail('SVG_INVALID', `Không có nút ${this.node}`);
    if (this.node === doc.root) fail('SVG_INVALID', 'Không chuyển phần tử gốc');
    const p = elementOrFail(doc, this.newParent);
    lockedFail(doc, this.node);
    if (
      isInsideOpaque(doc, this.newParent) ||
      OPAQUE_TAGS.has(p.tag) ||
      (p.tag === 'svg' && p.id !== doc.root)
    )
      fail('SVG_LOCKED', 'Không chuyển vào khối giữ nguyên');
    if (isAncestorOrSelf(doc, this.node, this.newParent))
      fail('SVG_INVALID', 'Không chuyển nút vào chính cây con của nó');
    const len = p.children.length - (n!.parent === this.newParent ? 1 : 0);
    if (this.newIndex < 0 || this.newIndex > len || !Number.isInteger(this.newIndex))
      fail('SVG_INVALID', `Vị trí ${this.newIndex} ngoài khoảng`);
    if (n!.tag === TEXT_NODE && !TEXT_ELEMENTS.has(p.tag) && !isWhitespaceText(n))
      fail('SVG_UNSAFE', 'Chữ ngoài phần tử chữ', 'R_ELEMENT_NOT_ALLOWED');
    if (isElement(n!)) {
      const prob = placementProblem(p.tag, n!.tag);
      if (prob !== null) fail('SVG_UNSAFE', `Không đặt <${n!.tag}> trong <${p.tag}>`, prob);
      if (depthOf(doc, this.newParent) + subtreeStats(doc, this.node).depth > SVG_MAX_DEPTH)
        fail('SVG_LIMIT', `Vượt độ sâu ${SVG_MAX_DEPTH}`);
    }
  }

  needsStructuralCheck(doc: DrawDoc): boolean {
    // `use` trong/ngoài defs đổi cách đếm bom use
    let has = false;
    const stack = [this.node];
    while (stack.length > 0 && !has) {
      const m = doc.nodes.get(stack.pop()!)!;
      if (m.tag === 'use') has = true;
      stack.push(...m.children);
    }
    return has;
  }

  invert(doc: DrawDoc): Command {
    const n = doc.nodes.get(this.node)!;
    const p = doc.nodes.get(n.parent!)!;
    return new MoveNode(this.node, p.id, p.children.indexOf(this.node));
  }

  apply(doc: DrawDoc): void {
    const n = doc.nodes.get(this.node)!;
    const old = doc.nodes.get(n.parent!)!;
    this.oldParent = old.id;
    old.children.splice(old.children.indexOf(this.node), 1);
    const p = doc.nodes.get(this.newParent)!;
    p.children.splice(this.newIndex, 0, this.node);
    n.parent = p.id;
  }
}

// --- Batch, ExternalCommand -----------------------------------------------------------------------

export class Batch implements Command {
  readonly kind = 'Batch';
  readonly commands: Command[];
  mergeKey?: string;
  /** Nhãn cho menu Hoàn tác ("Di chuyển", "Đổi màu"…). */
  label?: string;

  constructor(commands: Command[], opts: { mergeKey?: string; label?: string } = {}) {
    this.commands = commands;
    this.mergeKey = opts.mergeKey;
    this.label = opts.label;
  }

  targets(): NodeId[] {
    const s = new Set<NodeId>();
    for (const c of this.commands) for (const t of c.targets()) s.add(t);
    return [...s];
  }

  /** Lô chỉ đảo được trong lúc áp dụng (mỗi lệnh con chụp trạng thái ngay trước nó): dùng `applyCommand`. */
  invert(): Command {
    throw new Error('Batch.invert: dùng applyCommand (trả lô đảo)');
  }

  apply(doc: DrawDoc): void {
    runCommand(doc, this);
  }
}

/** Lệnh cho dữ liệu ngoài SVG (binding, sự kiện) đi cùng lô: không đụng tài liệu. */
export class ExternalCommand implements Command {
  readonly kind: string;
  private readonly doFn: () => void;
  private readonly undoFn: () => void;
  mergeKey?: string;

  constructor(kind: string, doFn: () => void, undoFn: () => void) {
    this.kind = kind;
    this.doFn = doFn;
    this.undoFn = undoFn;
  }

  targets(): NodeId[] {
    return [];
  }

  invert(): Command {
    return new ExternalCommand(this.kind, this.undoFn, this.doFn);
  }

  apply(): void {
    this.doFn();
  }
}

function isAtomic(c: Command): c is Atomic {
  return typeof (c as Partial<Atomic>).validate === 'function';
}

/** Chạy một lệnh (không tăng version); trả lệnh đảo. Lỗi: tài liệu như trước. */
function runCommand(doc: DrawDoc, cmd: Command): Command {
  if (cmd instanceof Batch) {
    const done: Command[] = [];
    try {
      for (const c of cmd.commands) done.push(runCommand(doc, c));
    } catch (e) {
      for (let i = done.length - 1; i >= 0; i--) runCommand(doc, done[i]);
      throw e;
    }
    const inv = new Batch(done.reverse(), { label: cmd.label });
    return inv;
  }
  if (!isAtomic(cmd)) {
    const inv = cmd.invert(doc);
    cmd.apply(doc);
    return inv;
  }
  cmd.validate(doc);
  const inv = cmd.invert(doc);
  cmd.apply(doc);
  if (cmd.needsStructuralCheck(doc)) {
    const prob = structuralProblem(doc);
    if (prob !== null) {
      runInverse(doc, inv);
      fail('SVG_LIMIT', `Vượt giới hạn: ${prob}`);
    }
  }
  return inv;
}

function runInverse(doc: DrawDoc, inv: Command): void {
  if (isAtomic(inv)) {
    inv.apply(doc);
  } else runCommand(doc, inv);
}

/**
 * Áp một lệnh hoặc lô lên tài liệu: kiểm allowlist và giới hạn trước, cuộn lại nếu lỗi, tăng `doc.version`.
 * Trả lệnh đảo (áp nó để hoàn tác).
 */
export function applyCommand(doc: DrawDoc, cmd: Command): Command {
  const inv = runCommand(doc, cmd);
  doc.version++;
  return inv;
}
