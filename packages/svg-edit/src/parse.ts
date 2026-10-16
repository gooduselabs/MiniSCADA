// Đọc văn bản SVG thành `DrawDoc` (contracts/svg-editor.md §2, §7; research R24).
//
// Hai lớp:
//  1. Bộ đọc XML thuần TS (con trỏ chỉ tiến, ngăn xếp tường minh, không regex) giữ nguyên văn thẻ mở, thẻ đóng, chữ và
//     chú thích: nhờ đó tuần tự hóa cho cùng byte phần không sửa. Lọc allowlist ngay trên cây này bằng cùng bảng của
//     @mat/svg-renderer (allow.ts).
//  2. Cổng DOM (khi có `DOMParser`: trình duyệt, hoặc jsdom trong Node): `parseSvg` + `sanitizeSvg` của feature 008 là
//     trọng tài. Cây mô hình phải khớp cây DOM đã lọc (thẻ, tên và giá trị thuộc tính, chữ); lệch thì dựng lại mô hình
//     từ cây DOM đã lọc (mất nguyên văn nhưng an toàn), `report.rebuilt = true`.
// Kích thước được kiểm TRƯỚC khi phân tích; DOCTYPE bị từ chối (như `parseSvg`).
import {
  ALLOW_ELEMENTS,
  TEXT_ELEMENTS,
  UNWRAP_ELEMENTS,
  countEffective,
  hasDoctype,
  parseDataImage,
  parseSvg,
  sanitizeStyleAttr,
  sanitizeSvg,
  useLimitProblem,
} from '@mat/svg-renderer';
import { makeCryptoUid } from '@mat/svg-import';
import {
  MAX_FE,
  MAX_FILTERS,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  SVG_NS,
  XLINK_NS,
  checkAttr,
  elementProblem,
  placementProblem,
  structuralProblem,
} from './allow.ts';
import {
  SVG_MAX_BYTES,
  SVG_MAX_DEPTH,
  SVG_MAX_NODES,
  SVG_MAX_TEXT,
  SVG_MAX_TITLE,
  utf8Length,
} from './limits.ts';
import type { Box, DrawDoc, DrawNode, NodeId } from './node.ts';
import { COMMENT_NODE, TEXT_NODE, isElement } from './node.ts';

/** Một mục đã loại khi đọc (mã như bộ lọc của trang). */
export interface ParseIssue {
  kind: 'element' | 'attribute' | 'pi' | 'text';
  code: string;
  name: string;
  /** Đường dẫn kiểu `/svg/g[2]/rect[1]` của phần tử chứa. */
  path: string;
}

export interface ParseReport {
  removedElements: number;
  removedAttributes: number;
  issues: ParseIssue[];
  /** Mô hình dựng lại từ cây DOM đã lọc (không giữ nguyên văn). */
  rebuilt: boolean;
  /** Có chạy cổng DOM không. */
  domChecked: boolean;
}

export type ParseErrorCode = 'SVG_LIMIT' | 'SVG_PARSE' | 'SVG_UNSAFE';

export type ParseResult =
  | { ok: true; doc: DrawDoc; report: ParseReport }
  | { ok: false; code: ParseErrorCode; message: string };

export interface ParseOptions {
  /** Bộ sinh `data-mat-uid` cho nút mới (mặc định bộ sinh mật mã của @mat/svg-import). */
  uid?: () => string;
  /** Chạy cổng DOM. Mặc định: có khi `globalThis.DOMParser` tồn tại. `true` mà không có DOMParser: lỗi. */
  domCheck?: boolean;
}

const MAX_ISSUES = 500;
/** Trần phần tử thô trước lọc (như bộ nhập: rawNodeCap). */
const RAW_NODE_CAP = 100_000;

class ParseError extends Error {
  readonly code: ParseErrorCode;
  constructor(code: ParseErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------
// 1. Bộ đọc XML
// ---------------------------------------------------------------------------------------------

interface RawAttr {
  name: string;
  value: string;
}
interface RawElement {
  type: 'el';
  name: string;
  attrs: RawAttr[];
  rawStart: string;
  rawEnd: string | null;
  children: RawChild[];
  /** Ánh xạ tiền tố → namespace hiệu lực tại phần tử ('' là mặc định). */
  ns: Map<string, string>;
}
type RawChild =
  | RawElement
  | { type: 'text'; text: string; raw: string; cdata: boolean }
  | { type: 'comment'; text: string; raw: string }
  | { type: 'pi'; raw: string; target: string };

const isNameStart = (c: number): boolean =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 58 || c >= 0x80;
const isNameChar = (c: number): boolean =>
  isNameStart(c) || (c >= 48 && c <= 57) || c === 45 || c === 46;
const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13;

function isXmlChar(c: number): boolean {
  return c === 9 || c === 10 || c === 13 || (c >= 0x20 && c !== 0xfffe && c !== 0xffff);
}

class Reader {
  readonly s: string;
  i = 0;
  constructor(s: string) {
    this.s = s;
  }
  fail(msg: string): never {
    let line = 1;
    for (let k = 0; k < this.i && k < this.s.length; k++) if (this.s.charCodeAt(k) === 10) line++;
    throw new ParseError('SVG_PARSE', `SVG không phải XML hợp lệ (dòng ${line}): ${msg}`);
  }
  skipSpace(): void {
    while (this.i < this.s.length && isSpace(this.s.charCodeAt(this.i))) this.i++;
  }
  name(): string {
    const st = this.i;
    if (!isNameStart(this.s.charCodeAt(this.i))) this.fail('thiếu tên');
    this.i++;
    while (this.i < this.s.length && isNameChar(this.s.charCodeAt(this.i))) this.i++;
    return this.s.slice(st, this.i);
  }
}

/** Giải mã thực thể của chữ hoặc giá trị thuộc tính (`attr`: chuẩn hóa tab/xuống dòng thành dấu cách như XML). */
function decode(r: Reader, raw: string, attr: boolean): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (!isXmlChar(c) && !(c >= 0xd800 && c <= 0xdfff)) r.fail('ký tự không hợp lệ');
    if (c === 38) {
      const end = raw.indexOf(';', i + 1);
      if (end < 0 || end - i > 12) r.fail('thực thể không đóng');
      const ent = raw.slice(i + 1, end);
      let ch: string;
      if (ent === 'lt') ch = '<';
      else if (ent === 'gt') ch = '>';
      else if (ent === 'amp') ch = '&';
      else if (ent === 'quot') ch = '"';
      else if (ent === 'apos') ch = "'";
      else if (ent.charCodeAt(0) === 35) {
        const hex = ent.charCodeAt(1) === 120;
        const digits = ent.slice(hex ? 2 : 1);
        if (digits === '') r.fail('tham chiếu ký tự rỗng');
        let cp = 0;
        for (let k = 0; k < digits.length; k++) {
          const d = digits.charCodeAt(k);
          let v: number;
          if (d >= 48 && d <= 57) v = d - 48;
          else if (hex && d >= 97 && d <= 102) v = d - 87;
          else if (hex && d >= 65 && d <= 70) v = d - 55;
          else r.fail('tham chiếu ký tự hỏng');
          cp = cp * (hex ? 16 : 10) + v;
          if (cp > 0x10ffff) r.fail('tham chiếu ký tự ngoài miền');
        }
        if (!isXmlChar(cp) || (cp >= 0xd800 && cp <= 0xdfff)) r.fail('tham chiếu ký tự cấm');
        ch = String.fromCodePoint(cp);
      } else r.fail(`thực thể không khai báo &${ent.slice(0, 20)};`);
      out += ch;
      i = end;
    } else if (c === 13) {
      // CR LF và CR đơn thành LF (XML §2.11)
      if (raw.charCodeAt(i + 1) === 10) i++;
      out += attr ? ' ' : '\n';
    } else if (attr && (c === 9 || c === 10)) out += ' ';
    else if (c === 60 && attr) r.fail('ký tự < trong giá trị thuộc tính');
    else out += raw[i];
  }
  return out;
}

function nsOf(el: RawElement, qname: string, isAttr: boolean): string | null {
  const colon = qname.indexOf(':');
  if (colon < 0) return isAttr ? null : (el.ns.get('') ?? null);
  const prefix = qname.slice(0, colon);
  if (prefix === 'xml') return 'http://www.w3.org/XML/1998/namespace';
  if (prefix === 'xmlns') return 'http://www.w3.org/2000/xmlns/';
  return el.ns.get(prefix) ?? null;
}

interface Tokenized {
  prolog: string;
  prologPis: string[];
  root: RawElement;
  epilog: string;
}

/** Đọc cả văn bản. Ném ParseError. */
function tokenize(text: string): Tokenized {
  const r = new Reader(text);
  const s = text;
  // phần mở đầu: BOM, khai báo XML (chỉ ở đầu tệp), chú thích, khoảng trắng; chỉ thị xử lý khác bị bỏ (báo R_PI)
  const start = s.charCodeAt(0) === 0xfeff ? 1 : 0;
  r.i = start;
  let prolog = s.slice(0, start);
  const prologPis: string[] = [];
  let root: RawElement | null = null;
  const stack: RawElement[] = [];
  let count = 0;
  for (;;) {
    const st = r.i;
    r.skipSpace();
    if (s.startsWith('<?', r.i)) {
      const e = s.indexOf('?>', r.i + 2);
      if (e < 0) r.fail('chỉ thị xử lý không đóng');
      let k = r.i + 2;
      while (k < e && !isSpace(s.charCodeAt(k))) k++;
      const target = s.slice(r.i + 2, k);
      if (target.toLowerCase() === 'xml') {
        if (r.i !== start || target !== 'xml') r.fail('khai báo XML không ở đầu tệp');
        prolog += s.slice(st, e + 2);
      } else {
        prolog += s.slice(st, r.i);
        prologPis.push(target);
      }
      r.i = e + 2;
    } else if (s.startsWith('<!--', r.i)) {
      readComment(r);
      prolog += s.slice(st, r.i);
    } else {
      prolog += s.slice(st, r.i);
      break;
    }
  }
  if (s.charCodeAt(r.i) !== 60 || !isNameStart(s.charCodeAt(r.i + 1)))
    r.fail('không tìm thấy phần tử gốc');

  // thân
  for (;;) {
    if (r.i >= s.length) r.fail('tài liệu kết thúc khi phần tử chưa đóng');
    const c = s.charCodeAt(r.i);
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    if (c === 60) {
      const c1 = s.charCodeAt(r.i + 1);
      if (c1 === 47) {
        // thẻ đóng
        const st = r.i;
        r.i += 2;
        const name = r.name();
        r.skipSpace();
        if (s.charCodeAt(r.i) !== 62) r.fail('thẻ đóng hỏng');
        r.i++;
        const el = stack.pop();
        if (!el || el.name !== name) r.fail(`thẻ đóng </${name}> không khớp`);
        el!.rawEnd = s.slice(st, r.i);
        if (stack.length === 0) break;
      } else if (c1 === 33) {
        if (s.startsWith('<!--', r.i)) {
          const cm = readComment(r);
          if (!parent) r.fail('chú thích ngoài phần tử');
          parent!.children.push(cm);
        } else if (s.startsWith('<![CDATA[', r.i)) {
          const e = s.indexOf(']]>', r.i + 9);
          if (e < 0) r.fail('CDATA không đóng');
          const raw = s.slice(r.i, e + 3);
          const inner = s.slice(r.i + 9, e);
          for (let k = 0; k < inner.length; k++)
            if (
              !isXmlChar(inner.charCodeAt(k)) &&
              !(inner.charCodeAt(k) >= 0xd800 && inner.charCodeAt(k) <= 0xdfff)
            )
              r.fail('ký tự không hợp lệ trong CDATA');
          let norm = '';
          for (let k = 0; k < inner.length; k++) {
            if (inner.charCodeAt(k) === 13) {
              if (inner.charCodeAt(k + 1) === 10) k++;
              norm += '\n';
            } else norm += inner[k];
          }
          parent!.children.push({ type: 'text', text: norm, raw, cdata: true });
          r.i = e + 3;
        } else r.fail('khai báo <! không được chấp nhận (DOCTYPE, ENTITY)');
      } else if (c1 === 63) {
        const e = s.indexOf('?>', r.i + 2);
        if (e < 0) r.fail('chỉ thị xử lý không đóng');
        const raw = s.slice(r.i, e + 2);
        let k = r.i + 2;
        while (k < e && !isSpace(s.charCodeAt(k))) k++;
        const target = s.slice(r.i + 2, k);
        if (target.toLowerCase() === 'xml') r.fail('khai báo XML không ở đầu tệp');
        parent!.children.push({ type: 'pi', raw, target });
        r.i = e + 2;
      } else {
        // thẻ mở
        const st = r.i;
        r.i++;
        const name = r.name();
        const attrs: RawAttr[] = [];
        const seen = new Set<string>();
        let selfClose = false;
        for (;;) {
          const before = r.i;
          r.skipSpace();
          const d = s.charCodeAt(r.i);
          if (d === 62) {
            r.i++;
            break;
          }
          if (d === 47) {
            if (s.charCodeAt(r.i + 1) !== 62) r.fail('thẻ mở hỏng');
            r.i += 2;
            selfClose = true;
            break;
          }
          if (r.i === before) r.fail('thiếu khoảng trắng giữa các thuộc tính');
          const an = r.name();
          r.skipSpace();
          if (s.charCodeAt(r.i) !== 61) r.fail(`thuộc tính ${an} thiếu =`);
          r.i++;
          r.skipSpace();
          const q = s.charCodeAt(r.i);
          if (q !== 34 && q !== 39) r.fail(`giá trị thuộc tính ${an} thiếu nháy`);
          const e = s.indexOf(q === 34 ? '"' : "'", r.i + 1);
          if (e < 0) r.fail(`giá trị thuộc tính ${an} không đóng`);
          const value = decode(r, s.slice(r.i + 1, e), true);
          r.i = e + 1;
          if (seen.has(an)) r.fail(`thuộc tính ${an} lặp`);
          seen.add(an);
          attrs.push({ name: an, value });
        }
        const ns = new Map(parent ? parent.ns : []);
        for (const a of attrs) {
          if (a.name === 'xmlns') ns.set('', a.value);
          else if (a.name.startsWith('xmlns:')) ns.set(a.name.slice(6), a.value);
        }
        const el: RawElement = {
          type: 'el',
          name,
          attrs,
          rawStart: s.slice(st, r.i),
          rawEnd: null,
          children: [],
          ns,
        };
        if (++count > RAW_NODE_CAP)
          throw new ParseError('SVG_LIMIT', `Quá ${RAW_NODE_CAP} phần tử thô`);
        if (stack.length + 1 > SVG_MAX_DEPTH)
          throw new ParseError('SVG_LIMIT', `Độ sâu vượt ${SVG_MAX_DEPTH}`);
        if (parent) parent.children.push(el);
        else root = el;
        if (selfClose) {
          if (!parent) break;
        } else stack.push(el);
      }
    } else {
      // chữ
      const e = s.indexOf('<', r.i);
      const end = e < 0 ? s.length : e;
      const raw = s.slice(r.i, end);
      if (raw.indexOf(']]>') >= 0) r.fail(']]> trong chữ');
      const text = decode(r, raw, false);
      if (!parent) r.fail('chữ ngoài phần tử');
      parent!.children.push({ type: 'text', text, raw, cdata: false });
      r.i = end;
    }
  }
  // phần sau gốc: khoảng trắng, chú thích
  const epStart = r.i;
  for (;;) {
    r.skipSpace();
    if (r.i >= s.length) break;
    if (s.startsWith('<!--', r.i)) readComment(r);
    else r.fail('nội dung sau phần tử gốc');
  }
  return { prolog, root: root!, epilog: s.slice(epStart), prologPis };
}

function readComment(r: Reader): { type: 'comment'; text: string; raw: string } {
  const s = r.s;
  const e = s.indexOf('-->', r.i + 4);
  if (e < 0) r.fail('chú thích không đóng');
  const inner = s.slice(r.i + 4, e);
  if (inner.indexOf('--') >= 0 || inner.endsWith('-')) r.fail('-- trong chú thích');
  for (let k = 0; k < inner.length; k++) {
    const c = inner.charCodeAt(k);
    if (!isXmlChar(c) && !(c >= 0xd800 && c <= 0xdfff))
      r.fail('ký tự không hợp lệ trong chú thích');
  }
  const raw = s.slice(r.i, e + 3);
  r.i = e + 3;
  return { type: 'comment', text: inner, raw };
}

// ---------------------------------------------------------------------------------------------
// 2. Lọc allowlist và dựng mô hình
// ---------------------------------------------------------------------------------------------

function newReport(): ParseReport {
  return {
    removedElements: 0,
    removedAttributes: 0,
    issues: [],
    rebuilt: false,
    domChecked: false,
  };
}

function issue(rep: ParseReport, it: ParseIssue): void {
  if (it.kind === 'element') rep.removedElements++;
  else if (it.kind === 'attribute') rep.removedAttributes++;
  if (rep.issues.length < MAX_ISSUES) rep.issues.push(it);
}

/** Tài liệu rỗng để điền nút. */
export function emptyDoc(uid?: () => string): DrawDoc {
  return {
    root: 0,
    nodes: new Map(),
    viewBox: { x: 0, y: 0, width: 300, height: 150 },
    version: 0,
    nextId: 1,
    prolog: '',
    epilog: '\n',
    indent: '  ',
    newline: '\n',
    pretty: true,
    elementCount: 0,
    uid: uid ?? makeCryptoUid(),
  };
}

function addNode(doc: DrawDoc, n: Omit<DrawNode, 'id'>): DrawNode {
  const node: DrawNode = { id: doc.nextId++, ...n };
  doc.nodes.set(node.id, node);
  if (isElement(node)) doc.elementCount++;
  return node;
}

interface Limits {
  images: number;
  imageBytes: number;
  filters: number;
  fe: number;
}

/** Lọc cây thô và dựng mô hình (ngăn xếp tường minh). */
function buildModel(tok: Tokenized, rep: ParseReport, uid: () => string, text: string): DrawDoc {
  const doc = emptyDoc(uid);
  doc.prolog = tok.prolog;
  doc.epilog = tok.epilog;
  for (const t of tok.prologPis)
    issue(rep, { kind: 'pi', code: 'R_PI', name: t.slice(0, 40), path: '' });
  doc.newline = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const root = tok.root;
  if (root.name !== 'svg' || nsOf(root, root.name, false) !== SVG_NS)
    throw new ParseError(
      'SVG_PARSE',
      root.name.indexOf(':') < 0 && root.name === 'svg'
        ? 'Phần tử gốc <svg> không thuộc namespace SVG'
        : 'Phần tử gốc không phải <svg>: ' + root.name.slice(0, 40),
    );
  const lim: Limits = { images: 0, imageBytes: 0, filters: 0, fe: 0 };

  const makeElement = (raw: RawElement, parent: NodeId | null, path: string): DrawNode => {
    const isRoot = parent === null;
    const attrs = new Map<string, string>();
    let dirty = false;
    const hasHref = raw.attrs.some((a) => a.name === 'href');
    for (const a of raw.attrs) {
      const ans = nsOf(raw, a.name, true);
      if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) {
        // khai báo namespace: chỉ gốc giữ xmlns (SVG) và xmlns:xlink; còn lại bỏ im lặng như bộ lọc của trang
        const v = checkAttr(raw.name, a.name, a.value, isRoot);
        if (v.ok) attrs.set(a.name, a.value);
        else dirty = true;
        continue;
      }
      if (a.name.indexOf(':') >= 0) {
        const local = a.name.slice(a.name.indexOf(':') + 1);
        if (ans === XLINK_NS && local === 'href') {
          if (hasHref) {
            dirty = true; // như bộ lọc: đã có href thì bỏ xlink:href
            continue;
          }
          const v = checkAttr(raw.name, 'xlink:href', a.value);
          if (v.ok && a.name === 'xlink:href') {
            attrs.set('xlink:href', v.value);
            if (v.value !== a.value) dirty = true;
          } else if (v.ok) {
            attrs.set('href', v.value); // tiền tố khác tên cho cùng namespace xlink: ghi lại `href`
            dirty = true;
          } else {
            issue(rep, { kind: 'attribute', code: 'R_HREF_EXTERNAL', name: a.name, path });
            dirty = true;
          }
          continue;
        }
        if (ans === 'http://www.w3.org/XML/1998/namespace' && local === 'space') {
          const v = checkAttr(raw.name, 'xml:space', a.value);
          if (v.ok) attrs.set('xml:space', v.value);
          else issue(rep, { kind: 'attribute', code: 'R_ATTR_NOT_ALLOWED', name: a.name, path });
          if (!v.ok || v.value !== a.value) dirty = true;
          continue;
        }
        issue(rep, {
          kind: 'attribute',
          code: local === 'href' ? 'R_HREF_EXTERNAL' : 'R_ATTR_NOT_ALLOWED',
          name: a.name,
          path,
        });
        dirty = true;
        continue;
      }
      if (a.name === 'style') {
        const v = checkAttr(raw.name, 'style', a.value);
        if (v.ok) {
          attrs.set('style', v.value);
          if (v.value !== a.value) dirty = true;
          continue;
        }
        // có khai báo bị bỏ: viết lại như bộ lọc (giữ phần hợp lệ, chuyển transform)
        dirty = true;
        issue(rep, { kind: 'attribute', code: v.code, name: 'style', path });
        continue; // xử lý ở bước sau (cần sanitizeStyleAttr đầy đủ)
      }
      const v = checkAttr(raw.name, a.name, a.value, isRoot);
      if (v.ok) {
        attrs.set(a.name, v.value);
        if (v.value !== a.value) dirty = true;
      } else {
        issue(rep, { kind: 'attribute', code: v.code, name: a.name, path });
        dirty = true;
      }
    }
    // style có khai báo bị bỏ: dùng kết quả của bộ lọc
    const styleRaw = raw.attrs.find((a) => a.name === 'style');
    if (styleRaw && !attrs.has('style')) {
      const res = sanitizeStyleAttr(styleRaw.value);
      if (res.transform !== null && !attrs.has('transform')) {
        const tv = checkAttr(raw.name, 'transform', res.transform);
        if (tv.ok) attrs.set('transform', tv.value);
      }
      if (res.css !== '') attrs.set('style', res.css);
    }
    return addNode(doc, {
      tag: raw.name,
      attrs,
      children: [],
      parent,
      rawStart: dirty ? null : raw.rawStart,
      rawEnd: raw.rawEnd,
    });
  };

  const rootNode = makeElement(root, null, '/svg');
  doc.root = rootNode.id;
  interface Frame {
    raw: RawElement;
    node: DrawNode;
    path: string;
  }
  const frames: Frame[] = [{ raw: root, node: rootNode, path: '/svg' }];
  while (frames.length > 0) {
    const f = frames.pop()!;
    const tag = f.node.tag;
    const inText = TEXT_ELEMENTS.has(tag);
    const textLimit = tag === 'title' ? SVG_MAX_TITLE : SVG_MAX_TEXT;
    const counts = new Map<string, number>();
    const todo = [...f.raw.children].reverse();
    const childFrames: Frame[] = [];
    let run = 0;
    while (todo.length > 0) {
      const c = todo.pop()!;
      if (c.type === 'el') {
        run = 0;
        const local = c.name;
        const ns = nsOf(c, c.name, false);
        const idx = (counts.get(local) ?? 0) + 1;
        const path = `${f.path}/${local}[${idx}]`;
        if (ns !== SVG_NS || local.indexOf(':') >= 0) {
          issue(rep, { kind: 'element', code: 'R_NAMESPACE', name: local, path: f.path });
          continue;
        }
        if (UNWRAP_ELEMENTS.has(local)) {
          issue(rep, { kind: 'element', code: 'R_ELEMENT_NOT_ALLOWED', name: 'a', path: f.path });
          for (let k = c.children.length - 1; k >= 0; k--) {
            const g = c.children[k];
            if (g.type === 'el') {
              // con của `a` kế thừa namespace của `a`
              g.ns = new Map([...c.ns, ...g.ns]);
            }
            todo.push(g);
          }
          continue;
        }
        const prob = elementProblem(local) ?? placementProblem(tag, local) ?? limitProblem(c, lim);
        if (prob !== null) {
          issue(rep, { kind: 'element', code: prob, name: local, path: f.path });
          continue;
        }
        counts.set(local, idx);
        const node = makeElement(c, f.node.id, path);
        f.node.children.push(node.id);
        childFrames.push({ raw: c, node, path });
      } else if (c.type === 'text') {
        if (inText) {
          let t = c.text;
          let raw: string | null = c.raw;
          if (run + t.length > textLimit) {
            t = t.slice(0, Math.max(0, textLimit - run));
            raw = null;
            issue(rep, { kind: 'text', code: 'R_TEXT_LONG', name: tag, path: f.path });
          }
          run += t.length;
          if (t === '' && raw === null) continue;
          const n = addNode(doc, {
            tag: TEXT_NODE,
            attrs: new Map(),
            children: [],
            parent: f.node.id,
            text: t,
            raw,
          });
          f.node.children.push(n.id);
        } else if (isBlank(c.text)) {
          const n = addNode(doc, {
            tag: TEXT_NODE,
            attrs: new Map(),
            children: [],
            parent: f.node.id,
            text: c.text,
            raw: c.raw,
          });
          f.node.children.push(n.id);
        } else {
          issue(rep, { kind: 'text', code: 'R_TEXT_OUTSIDE', name: tag, path: f.path });
        }
      } else if (c.type === 'comment') {
        const n = addNode(doc, {
          tag: COMMENT_NODE,
          attrs: new Map(),
          children: [],
          parent: f.node.id,
          text: c.text,
          raw: c.raw,
        });
        f.node.children.push(n.id);
      } else {
        issue(rep, { kind: 'pi', code: 'R_PI', name: c.target.slice(0, 40), path: f.path });
      }
    }
    for (let k = childFrames.length - 1; k >= 0; k--) frames.push(childFrames[k]);
  }
  finishDoc(doc);
  return doc;
}

function limitProblem(c: RawElement, lim: Limits): string | null {
  const local = c.name;
  if (local === 'image') {
    let href: string | null = null;
    for (const a of c.attrs) {
      const colon = a.name.indexOf(':');
      const ln = colon < 0 ? a.name : a.name.slice(colon + 1);
      if (ln === 'href' && (colon < 0 || nsOf(c, a.name, true) === XLINK_NS)) {
        href = a.value;
        if (colon < 0) break;
      }
    }
    if (href === null) return 'R_IMAGE_BAD';
    const img = parseDataImage(href);
    if (img === null) {
      const t = href.trim();
      return t.toLowerCase().startsWith('data:') || t.startsWith('#')
        ? 'R_IMAGE_BAD'
        : 'R_IMAGE_LINKED';
    }
    if (lim.images + 1 > MAX_IMAGES || lim.imageBytes + img.bytes > MAX_IMAGE_BYTES)
      return 'R_IMAGE_LIMIT';
    lim.images++;
    lim.imageBytes += img.bytes;
  }
  if (local === 'filter') {
    if (lim.filters + 1 > MAX_FILTERS) return 'R_FILTER_LIMIT';
    lim.filters++;
  }
  if (local.startsWith('fe') && ALLOW_ELEMENTS.has(local)) {
    if (lim.fe + 1 > MAX_FE) return 'R_FILTER_LIMIT';
    lim.fe++;
  }
  return null;
}

function isBlank(t: string): boolean {
  for (let i = 0; i < t.length; i++) if (!isSpace(t.charCodeAt(i))) return false;
  return true;
}

function parseNumbers(v: string | undefined): number[] | null {
  if (v === undefined) return null;
  const out: number[] = [];
  let cur = '';
  for (let i = 0; i <= v.length; i++) {
    const c = i < v.length ? v.charCodeAt(i) : 32;
    if (isSpace(c) || c === 44) {
      if (cur !== '') {
        const n = Number(cur);
        if (!Number.isFinite(n)) return null;
        out.push(n);
      }
      cur = '';
    } else cur += v[i];
  }
  return out;
}

/** Hộp `viewBox` của gốc (hoặc từ width/height số thuần; mặc định 300 × 150 như trình duyệt). */
export function rootViewBox(doc: DrawDoc): Box {
  const r = doc.nodes.get(doc.root)!;
  const vb = parseNumbers(r.attrs.get('viewBox'));
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0)
    return { x: vb[0], y: vb[1], width: vb[2], height: vb[3] };
  const w = Number(r.attrs.get('width') ?? '');
  const h = Number(r.attrs.get('height') ?? '');
  return { x: 0, y: 0, width: w > 0 ? w : 300, height: h > 0 ? h : 150 };
}

/** Thông tin suy ra sau khi dựng: viewBox, thụt đầu dòng, có xuống dòng giữa phần tử. */
function finishDoc(doc: DrawDoc): void {
  doc.viewBox = rootViewBox(doc);
  const root = doc.nodes.get(doc.root)!;
  let pretty = false;
  let indent: string | null = null;
  for (let i = 0; i < root.children.length; i++) {
    const n = doc.nodes.get(root.children[i])!;
    if (n.tag !== TEXT_NODE || !isBlank(n.text ?? '')) continue;
    const t = n.text ?? '';
    const nl = t.lastIndexOf('\n');
    if (nl < 0) continue;
    pretty = true;
    // thụt đầu dòng lấy từ khoảng trắng đứng trước một phần tử/chú thích (khoảng trắng cuối không nói gì)
    if (indent === null && i + 1 < root.children.length) indent = t.slice(nl + 1);
  }
  doc.pretty = pretty || root.children.length === 0;
  doc.indent = indent ?? '  ';
}

// ---------------------------------------------------------------------------------------------
// 3. Cổng DOM
// ---------------------------------------------------------------------------------------------

function hasDomParser(): boolean {
  return typeof (globalThis as { DOMParser?: unknown }).DOMParser === 'function';
}

/** Chữ ký so sánh: thẻ, thuộc tính (tên → giá trị đã cắt), chữ trong phần tử chữ; theo thứ tự tài liệu. */
function modelSignature(doc: DrawDoc): string[] {
  const out: string[] = [];
  const stack: NodeId[] = [doc.root];
  while (stack.length > 0) {
    const n = doc.nodes.get(stack.pop()!)!;
    if (!isElement(n)) continue;
    const items: string[] = [];
    for (const [k, v] of n.attrs) {
      if (k === 'xmlns' || k === 'xmlns:xlink') continue;
      const name = k === 'xlink:href' ? 'href' : k;
      items.push(name + '=' + (name === 'style' ? squashWs(v) : v.trim()));
    }
    items.sort();
    let text = '';
    if (TEXT_ELEMENTS.has(n.tag))
      for (const c of n.children) {
        const t = doc.nodes.get(c)!;
        if (t.tag === TEXT_NODE) text += t.text ?? '';
      }
    out.push(n.tag + '|' + items.join('|') + '|' + text);
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }
  return out;
}

function domSignature(root: Element): string[] {
  const out: string[] = [];
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    const items: string[] = [];
    for (const a of Array.from(el.attributes)) {
      if (a.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
      const name = a.prefix ? `${a.prefix}:${a.localName}` : a.localName;
      items.push(name + '=' + (name === 'style' ? squashWs(a.value) : a.value.trim()));
    }
    items.sort();
    let text = '';
    if (TEXT_ELEMENTS.has(el.localName))
      for (const c of Array.from(el.childNodes))
        if (c.nodeType === 3 || c.nodeType === 4) text += c.nodeValue ?? '';
    out.push(el.localName + '|' + items.join('|') + '|' + text);
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

function squashWs(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) if (!isSpace(s.charCodeAt(i))) out += s[i];
  while (out.endsWith(';')) out = out.slice(0, -1);
  return out;
}

/** Dựng mô hình từ cây DOM đã lọc (không nguyên văn). Dùng khi mô hình lệch cổng DOM. */
export function docFromDom(root: Element, uid?: () => string, prolog = ''): DrawDoc {
  const doc = emptyDoc(uid);
  doc.prolog = prolog;
  const mk = (el: Element, parent: NodeId | null): DrawNode => {
    const attrs = new Map<string, string>();
    if (parent === null) attrs.set('xmlns', SVG_NS);
    for (const a of Array.from(el.attributes)) {
      if (a.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
      attrs.set(a.prefix ? `${a.prefix}:${a.localName}` : a.localName, a.value);
    }
    return addNode(doc, {
      tag: el.localName,
      attrs,
      children: [],
      parent,
      rawStart: null,
      rawEnd: null,
    });
  };
  const r = mk(root, null);
  doc.root = r.id;
  const stack: Array<[Element, DrawNode]> = [[root, r]];
  while (stack.length > 0) {
    const [el, node] = stack.pop()!;
    const pending: Array<[Element, DrawNode]> = [];
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 1) {
        const n = mk(c as Element, node.id);
        node.children.push(n.id);
        pending.push([c as Element, n]);
      } else if (c.nodeType === 3 || c.nodeType === 4) {
        const n = addNode(doc, {
          tag: TEXT_NODE,
          attrs: new Map(),
          children: [],
          parent: node.id,
          text: c.nodeValue ?? '',
          raw: null,
        });
        node.children.push(n.id);
      }
    }
    for (let i = pending.length - 1; i >= 0; i--) stack.push(pending[i]);
  }
  finishDoc(doc);
  return doc;
}

// ---------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------

/** Đọc văn bản (hoặc byte UTF-8) SVG thành `DrawDoc`. Không ném lỗi cho đầu vào xấu. */
export function parseDrawDoc(input: string | Uint8Array, opts: ParseOptions = {}): ParseResult {
  try {
    return parseInner(input, opts);
  } catch (e) {
    if (e instanceof ParseError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

function parseInner(input: string | Uint8Array, opts: ParseOptions): ParseResult {
  let text: string;
  if (typeof input === 'string') {
    // kiểm kích thước TRƯỚC khi phân tích (độ dài UTF-16 đã vượt thì khỏi đếm byte)
    if (input.length > SVG_MAX_BYTES || utf8Length(input) > SVG_MAX_BYTES)
      return { ok: false, code: 'SVG_LIMIT', message: `SVG lớn hơn ${SVG_MAX_BYTES} byte (5 MiB)` };
    text = input;
  } else {
    if (input.length > SVG_MAX_BYTES)
      return { ok: false, code: 'SVG_LIMIT', message: `SVG lớn hơn ${SVG_MAX_BYTES} byte (5 MiB)` };
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input);
    } catch {
      return { ok: false, code: 'SVG_PARSE', message: 'SVG không phải UTF-8 hợp lệ' };
    }
  }
  if (hasDoctype(text))
    return {
      ok: false,
      code: 'SVG_UNSAFE',
      message: 'SVG có khai báo DOCTYPE (DTD/ENTITY không được chấp nhận)',
    };
  const uid = opts.uid ?? makeCryptoUid();
  const rep = newReport();
  const tok = tokenize(text);
  let doc = buildModel(tok, rep, uid, text);
  if (doc.elementCount > SVG_MAX_NODES)
    return {
      ok: false,
      code: 'SVG_LIMIT',
      message: `SVG có ${doc.elementCount} phần tử, vượt ${SVG_MAX_NODES}`,
    };
  const useProb = structuralProblem(doc);
  if (useProb !== null)
    return { ok: false, code: 'SVG_LIMIT', message: `SVG vượt giới hạn: ${useProb}` };

  const wantDom = opts.domCheck ?? hasDomParser();
  if (wantDom) {
    if (!hasDomParser()) throw new Error('Không có DOMParser cho cổng DOM');
    let dom: Element;
    try {
      dom = parseSvg(text) as unknown as Element;
    } catch (e) {
      return { ok: false, code: 'SVG_PARSE', message: String((e as Error).message).slice(0, 300) };
    }
    sanitizeSvg(dom);
    const p = useLimitProblem(countEffective(dom, 100_000));
    if (p !== null) return { ok: false, code: 'SVG_LIMIT', message: `SVG có bom use: ${p}` };
    rep.domChecked = true;
    const a = modelSignature(doc);
    const b = domSignature(dom);
    let same = a.length === b.length;
    for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
    if (!same) {
      doc = docFromDom(dom, uid, doc.prolog);
      rep.rebuilt = true;
    }
  }
  return { ok: true, doc, report: rep };
}
