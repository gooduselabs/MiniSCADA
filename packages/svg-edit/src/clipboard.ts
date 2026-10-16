// Clipboard (contracts/svg-editor.md §10; FR-109): sao chép cây con kèm định nghĩa được tham chiếu (gradient, clipPath,
// đích của `use`…); dán cấp `data-mat-uid` mới (không chép binding; `uidMap` để giao diện chép binding khi người dùng
// chọn "Dán kèm binding"), đổi `id` trùng (`-copy`, `-copy-2`…) và cập nhật `url(#id)`, `href="#id"` trong phần dán;
// định nghĩa giống hệt ở tài liệu đích được dùng lại. Dán văn bản SVG: kiểm 5 MB TRƯỚC khi phân tích, rồi đi qua bộ
// nhập của feature 008 (`importSvg`: DOM thật, allowlist, giới hạn nút/độ sâu/bom use) và báo những gì đã loại.
import { BINDABLE_ELEMENTS, isId } from '@mat/svg-renderer';
import { importSvg, type ImportReport } from '@mat/svg-import';
import { applyLocal, topLevel } from './bake.ts';
import { buildSubtree, specOf, type NodeSpec } from './build.ts';
import { Batch, type Command } from './command.ts';
import { invert, isIdentity, multiply, translateM, type Matrix } from './matrix.ts';
import type { DrawDoc, NodeId } from './node.ts';
import {
  DEFINITION_TAGS,
  documentOrder,
  elementChildren,
  isInDefinitions,
  isElement,
} from './node.ts';
import { emptyDoc, parseDrawDoc } from './parse.ts';
import { SVG_MAX_BYTES, utf8Length } from './limits.ts';
import { Sim, insertSpec } from './structure.ts';
import { ctm, parentCtm } from './transform.ts';
import { isDrawable } from './group.ts';

export interface ClipItem {
  spec: NodeSpec;
  /** Ma trận tích lũy của cha nguồn (để giữ vị trí khi dán vào cha khác). */
  parentCtm: Matrix;
}

export interface ClipData {
  items: ClipItem[];
  /** Định nghĩa được tham chiếu nằm ngoài các mục (theo thứ tự tài liệu nguồn). */
  defs: NodeSpec[];
}

export interface PasteResult {
  batch: Batch;
  /** Mã nút của các mục đã dán (theo thứ tự). */
  ids: NodeId[];
  /** uid nguồn → uid mới (cho "Dán kèm binding"). */
  uidMap: Map<string, string>;
  /** id đã đổi: cũ → mới. */
  idMap: Map<string, string>;
}

// --- tham chiếu -----------------------------------------------------------------------------------

/** Các vị trí `url(#id)` trong giá trị: [đầu, sau dấu `)`, id]. */
function urlRefs(v: string): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  const low = v.toLowerCase();
  for (let i = low.indexOf('url('); i >= 0; i = low.indexOf('url(', i + 4)) {
    let j = i + 4;
    while (j < v.length && (v[j] === ' ' || v[j] === '\t')) j++;
    const q = v[j] === '"' || v[j] === "'" ? v[j] : '';
    if (q) j++;
    if (v[j] !== '#') continue;
    const st = j + 1;
    let k = st;
    while (k < v.length && v[k] !== ')' && v[k] !== q && v[k] !== ' ') k++;
    const id = v.slice(st, k);
    const close = v.indexOf(')', k);
    if (close < 0 || !isId(id)) continue;
    out.push([i, close + 1, id]);
  }
  return out;
}

function hrefRef(name: string, v: string): string | null {
  if (name !== 'href' && name !== 'xlink:href') return null;
  const t = v.trim();
  return t.startsWith('#') && isId(t.slice(1)) ? t.slice(1) : null;
}

function refsOfSpec(spec: NodeSpec, out: Set<string>): void {
  for (const [k, v] of spec.attrs ?? []) {
    const h = hrefRef(k, v);
    if (h !== null) out.add(h);
    for (const [, , id] of urlRefs(v)) out.add(id);
  }
  for (const c of spec.children ?? []) refsOfSpec(c, out);
}

function idsOfSpec(spec: NodeSpec, out: Set<string>): void {
  for (const [k, v] of spec.attrs ?? []) if (k === 'id') out.add(v);
  for (const c of spec.children ?? []) idsOfSpec(c, out);
}

function rewriteSpec(spec: NodeSpec, f: (k: string, v: string) => string | null): NodeSpec {
  const attrs: Array<[string, string]> = [];
  for (const [k, v] of spec.attrs ?? []) {
    const nv = f(k, v);
    if (nv !== null) attrs.push([k, nv]);
  }
  return { ...spec, attrs, children: spec.children?.map((c) => rewriteSpec(c, f)) };
}

function renameRefs(v: string, k: string, map: Map<string, string>): string {
  const h = hrefRef(k, v);
  if (h !== null) return map.has(h) ? '#' + map.get(h) : v;
  const refs = urlRefs(v);
  if (refs.length === 0) return v;
  let out = '';
  let last = 0;
  for (const [a, b, id] of refs) {
    out += v.slice(last, a) + (map.has(id) ? `url(#${map.get(id)})` : v.slice(a, b));
    last = b;
  }
  return out + v.slice(last);
}

// --- sao chép -------------------------------------------------------------------------------------

/** Sao chép các phần tử (vẽ được) kèm định nghĩa được tham chiếu. */
export function copyNodes(doc: DrawDoc, ids: readonly NodeId[]): ClipData {
  const order = documentOrder(doc);
  const sel = topLevel(doc, ids)
    .filter((id) => isDrawable(doc, id))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const items = sel.map((id) => ({ spec: specOf(doc, id), parentCtm: parentCtm(doc, id) }));
  const have = new Set<string>();
  for (const it of items) idsOfSpec(it.spec, have);
  const byIdAttr = new Map<string, NodeId>();
  for (const id of order) {
    const v = doc.nodes.get(id)!.attrs.get('id');
    if (v !== undefined && !byIdAttr.has(v)) byIdAttr.set(v, id);
  }
  const need = new Set<string>();
  for (const it of items) refsOfSpec(it.spec, need);
  const defNodes: NodeId[] = [];
  const todo = [...need];
  while (todo.length > 0) {
    const ref = todo.pop()!;
    if (have.has(ref)) continue;
    const nid = byIdAttr.get(ref);
    if (nid === undefined) continue;
    have.add(ref);
    defNodes.push(nid);
    const spec = specOf(doc, nid);
    idsOfSpec(spec, have);
    const more = new Set<string>();
    refsOfSpec(spec, more);
    todo.push(...more);
  }
  defNodes.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { items, defs: defNodes.map((id) => specOf(doc, id)) };
}

// --- dán ------------------------------------------------------------------------------------------

function specKey(spec: NodeSpec): string {
  return JSON.stringify(spec, (k, v) => (k === 'data-mat-uid' ? undefined : v));
}

/** Đổi uid: mọi phần tử gắn được ngoài vùng định nghĩa nhận uid mới; uid trong định nghĩa bị bỏ. */
function reUid(
  doc: DrawDoc,
  spec: NodeSpec,
  used: Set<string>,
  map: Map<string, string>,
  inDefs: boolean,
): NodeSpec {
  if (spec.tag === '#text' || spec.tag === '#comment') return spec;
  const defs = inDefs || DEFINITION_TAGS.has(spec.tag);
  const attrs: Array<[string, string]> = [];
  let had = false;
  for (const [k, v] of spec.attrs ?? []) {
    if (k !== 'data-mat-uid') {
      attrs.push([k, v]);
      continue;
    }
    had = true;
    if (defs) continue;
    let u = doc.uid();
    while (used.has(u)) u = doc.uid();
    used.add(u);
    map.set(v, u);
    attrs.push([k, u]);
  }
  if (!had && !defs && BINDABLE_ELEMENTS.has(spec.tag)) {
    let u = doc.uid();
    while (used.has(u)) u = doc.uid();
    used.add(u);
    // thứ tự: sau id (như bảng ưu tiên)
    const at = attrs.length > 0 && attrs[0][0] === 'id' ? 1 : 0;
    attrs.splice(at, 0, ['data-mat-uid', u]);
  }
  return {
    ...spec,
    attrs,
    children: spec.children?.map((c) => reUid(doc, c, used, map, defs)),
  };
}

/** Áp ma trận L (hệ của cha đích) cho mô tả bằng tài liệu nháp (cùng luật bake với di chuyển). */
function transformSpec(spec: NodeSpec, L: Matrix): NodeSpec {
  if (isIdentity(L)) return spec;
  const scratch = emptyDoc(() => 'el_scratch000');
  const root = buildSubtree(scratch, {
    tag: 'svg',
    attrs: [['xmlns', 'http://www.w3.org/2000/svg']],
  });
  for (const n of root.nodes) scratch.nodes.set(n.id, n);
  scratch.root = root.root;
  const sub = buildSubtree(scratch, spec);
  // chèn thẳng (không kiểm allowlist ở bản nháp; lệnh InsertNode thật kiểm khi dán)
  for (const n of sub.nodes) scratch.nodes.set(n.id, n);
  scratch.nodes.get(sub.root)!.parent = scratch.root;
  scratch.nodes.get(scratch.root)!.children.push(sub.root);
  const r = applyLocal(scratch, sub.root, L);
  for (const c of r.commands) c.apply(scratch);
  return specOf(scratch, r.replacedBy ?? sub.root);
}

export interface PasteOptions {
  /** Cha đích (mặc định gốc). */
  parent?: NodeId;
  /** Dán trước đơn vị này (null: trên cùng). */
  before?: NodeId | null;
  /** Lệch trong hệ tài liệu (Ctrl+D: 20, 20). */
  offset?: { dx: number; dy: number };
}

export function pasteClip(doc: DrawDoc, clip: ClipData, opts: PasteOptions = {}): PasteResult {
  const parent = opts.parent ?? doc.root;
  const existingIds = new Map<string, NodeId>();
  const usedUids = new Set<string>();
  for (const id of documentOrder(doc)) {
    const n = doc.nodes.get(id)!;
    const v = n.attrs.get('id');
    if (v !== undefined && !existingIds.has(v)) existingIds.set(v, id);
    const u = n.attrs.get('data-mat-uid');
    if (u !== undefined) usedUids.add(u);
  }
  const taken = new Set(existingIds.keys());
  const idMap = new Map<string, string>();
  const fresh = (id: string): string => {
    let k = 1;
    let cand = `${id}-copy`;
    while (taken.has(cand) || !isId(cand)) {
      k++;
      cand = `${id}-copy-${k}`;
      if (cand.length > 128) cand = `c${k}-${taken.size}`;
    }
    taken.add(cand);
    return cand;
  };
  // định nghĩa: giống hệt thì dùng lại, trùng id khác nội dung thì đổi tên, chưa có thì chép
  const defsToInsert: NodeSpec[] = [];
  for (const d of clip.defs) {
    const own = (d.attrs ?? []).find(([k]) => k === 'id')?.[1];
    const ex = own !== undefined ? existingIds.get(own) : undefined;
    if (own !== undefined && ex !== undefined && specKey(specOf(doc, ex)) === specKey(d)) continue;
    const ids = new Set<string>();
    idsOfSpec(d, ids);
    for (const i of ids) if (taken.has(i)) idMap.set(i, fresh(i));
    for (const i of ids) taken.add(i);
    defsToInsert.push(d);
  }
  for (const it of clip.items) {
    const ids = new Set<string>();
    idsOfSpec(it.spec, ids);
    for (const i of ids) if (taken.has(i) && !idMap.has(i)) idMap.set(i, fresh(i));
    for (const i of ids) taken.add(i);
  }
  const rename = (s: NodeSpec): NodeSpec =>
    rewriteSpec(s, (k, v) => (k === 'id' ? (idMap.get(v) ?? v) : renameRefs(v, k, idMap)));

  const uidMap = new Map<string, string>();
  const sim = new Sim(doc);
  const cmds: Command[] = [];
  if (defsToInsert.length > 0) {
    const defsId =
      elementChildren(doc, doc.root).find((c) => doc.nodes.get(c)!.tag === 'defs') ?? null;
    if (defsId === null) {
      const first =
        elementChildren(doc, doc.root).find((c) => doc.nodes.get(c)!.tag !== 'title') ?? null;
      const ins = insertSpec(
        doc,
        doc.root,
        {
          tag: 'defs',
          children: defsToInsert.map((d) => reUid(doc, rename(d), usedUids, uidMap, true)),
        },
        first,
        sim,
      );
      cmds.push(ins.command);
    } else {
      for (const d of defsToInsert)
        cmds.push(
          insertSpec(doc, defsId, reUid(doc, rename(d), usedUids, uidMap, true), null, sim).command,
        );
    }
  }
  const P = ctm(doc, parent);
  const Pi = invert(P) ?? [1, 0, 0, 1, 0, 0];
  const T = translateM(opts.offset?.dx ?? 0, opts.offset?.dy ?? 0);
  const ids: NodeId[] = [];
  for (const it of clip.items) {
    const L = multiply(multiply(Pi, T), it.parentCtm);
    const spec = transformSpec(reUid(doc, rename(it.spec), usedUids, uidMap, false), L);
    const ins = insertSpec(doc, parent, spec, opts.before ?? null, sim);
    cmds.push(ins.command);
    ids.push(ins.id);
  }
  return { batch: new Batch(cmds, { label: 'Dán' }), ids, uidMap, idMap };
}

/** Nhân bản (Ctrl+D): sao chép rồi dán lệch 20 ngay trên phần tử trên cùng của vùng chọn, cùng cha. */
export function duplicateNodes(doc: DrawDoc, ids: readonly NodeId[], offset = 20): PasteResult {
  const clip = copyNodes(doc, ids);
  const order = documentOrder(doc);
  const sel = topLevel(doc, ids).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const top = sel[sel.length - 1];
  const parent = top !== undefined ? doc.nodes.get(top)!.parent! : doc.root;
  const sibs = elementChildren(doc, parent);
  const before = top !== undefined ? (sibs[sibs.indexOf(top) + 1] ?? null) : null;
  return pasteClip(doc, clip, { parent, before, offset: { dx: offset, dy: offset } });
}

// --- dán văn bản SVG ---------------------------------------------------------------------------------

export interface PasteTextReport {
  removedElements: number;
  removedAttributes: number;
  /** Danh sách đã loại của bộ nhập (tên, số lần, mã R_*, lý do tiếng Việt). */
  removed: ImportReport['removed'];
}

export type PasteTextResult =
  | (PasteResult & { ok: true; report: PasteTextReport })
  | {
      ok: false;
      code: 'SVG_LIMIT' | 'SVG_PARSE' | 'SVG_EMPTY';
      message: string;
      importCode?: string;
    };

/** Văn bản trông như SVG (bắt đầu bằng `<svg` hoặc `<?xml`, bỏ BOM và khoảng trắng). */
export function looksLikeSvg(text: string): boolean {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (
    i < text.length &&
    i < 4096 &&
    (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t')
  )
    i++;
  return text.startsWith('<svg', i) || text.startsWith('<?xml', i);
}

export function pasteSvgText(doc: DrawDoc, text: string, opts: PasteOptions = {}): PasteTextResult {
  // 1. kích thước TRƯỚC mọi phân tích
  if (text.length > SVG_MAX_BYTES || utf8Length(text) > SVG_MAX_BYTES)
    return {
      ok: false,
      code: 'SVG_LIMIT',
      message: `Nội dung dán lớn hơn ${SVG_MAX_BYTES} byte (5 MiB)`,
    };
  if (!looksLikeSvg(text))
    return { ok: false, code: 'SVG_PARSE', message: 'Clipboard không chứa SVG' };
  // 2. bộ nhập của feature 008 (DOM thật, allowlist, giới hạn)
  const r = importSvg(text, { uid: doc.uid, fileName: 'clipboard.svg' });
  if (!r.ok) {
    const limit = r.error.code === 'E_IMPORT_LIMIT' || r.error.code === 'E_IMPORT_USE_BOMB';
    return {
      ok: false,
      code: limit ? 'SVG_LIMIT' : 'SVG_PARSE',
      message: r.error.message,
      importCode: r.error.code,
    };
  }
  const parsed = parseDrawDoc(r.svg, { uid: doc.uid });
  if (!parsed.ok)
    return {
      ok: false,
      code: parsed.code === 'SVG_LIMIT' ? 'SVG_LIMIT' : 'SVG_PARSE',
      message: parsed.message,
    };
  const tmp = parsed.doc;
  const items = elementChildren(tmp, tmp.root).filter(
    (id) => !isInDefinitions(tmp, id) && isElement(tmp.nodes.get(id)!),
  );
  const report: PasteTextReport = {
    removedElements: 0,
    removedAttributes: 0,
    removed: r.report.removed,
  };
  for (const x of r.report.removed) {
    if (x.kind === 'element' || x.kind === 'image' || x.kind === 'namespace')
      report.removedElements += x.count;
    else report.removedAttributes += x.count;
  }
  if (items.length === 0)
    return { ok: false, code: 'SVG_EMPTY', message: 'Sau khi lọc không còn phần tử nào để dán' };
  return { ok: true, ...pasteClip(doc, copyNodes(tmp, items), opts), report };
}
