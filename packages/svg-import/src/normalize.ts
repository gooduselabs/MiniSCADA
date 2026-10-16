// Chuẩn hóa (research R5; contract svg-import §6): chạy luôn, tất định. Hai pha:
//  - normalizePre  (trước allowlist): font SVG, xlink, `switch`, `flowRoot`, những thứ allowlist sẽ vứt mất;
//  - normalizePost (sau allowlist): kích thước và viewBox, id trùng, tham chiếu treo, font, làm tròn số,
//    phần tử rỗng và định nghĩa không dùng.
// Không regex, không đệ quy, không XMLSerializer.
import { SVG_NS, scanNumber, scanNumberList } from '@mat/svg-renderer';
import fonts from './data/fonts.json' with { type: 'json' };
import { collectReferences } from './refs.ts';
import type { ReportBuilder } from './report.ts';

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const FONT_ELEMENTS: ReadonlySet<string> = new Set([
  'font',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'glyph',
  'missing-glyph',
  'hkern',
  'vkern',
]);

function allElements(root: Element): Element[] {
  const out: Element[] = [];
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    out.push(el);
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

const fmt = (x: number): string => {
  const r = Math.round(x * 1000) / 1000;
  return String(r === 0 ? 0 : r);
};

function leadingNumber(v: string | null, fallback: number): number {
  if (v === null) return fallback;
  const s = v.trim();
  const n = scanNumber(s, 0);
  return n ? n.value : fallback;
}

// --- Pha trước allowlist -------------------------------------------------------------------------------

export function normalizePre(root: Element, rep: ReportBuilder): void {
  const all = allElements(root);
  const switches: Element[] = [];
  const flows: Element[] = [];
  const fontEls: Element[] = [];
  let xlink = 0;
  for (const el of all) {
    if (el.namespaceURI === SVG_NS) {
      const n = el.localName;
      if (n === 'switch') switches.push(el);
      else if (n === 'flowRoot') flows.push(el);
      else if (FONT_ELEMENTS.has(n)) fontEls.push(el);
    }
    for (const a of Array.from(el.attributes))
      if (a.namespaceURI === XLINK_NS && a.localName === 'href') xlink++;
  }
  if (xlink > 0) rep.converted('C_XLINK', 'xlink:href thành href', '', xlink);

  for (const f of fontEls) {
    if (!f.isConnected) continue;
    f.parentNode?.removeChild(f);
    rep.removed('font', 'R_FONT_SVG', f.localName);
  }

  for (const sw of switches) {
    if (!sw.isConnected) continue;
    const parent = sw.parentNode;
    if (!parent) continue;
    let chosen: Element | null = null;
    for (const c of Array.from(sw.children)) {
      if (
        chosen === null &&
        c.localName !== 'foreignObject' &&
        !c.hasAttribute('requiredExtensions') &&
        !c.hasAttribute('requiredFeatures')
      ) {
        chosen = c;
      } else if (c.localName === 'foreignObject')
        rep.removed('element', 'R_FOREIGN', 'foreignObject');
      else rep.removed('element', 'R_ELEMENT_NOT_ALLOWED', c.localName + ' (nhánh switch)');
    }
    if (chosen) {
      parent.insertBefore(chosen, sw);
      rep.converted('C_SWITCH', 'switch thay bằng nhánh dự phòng');
    } else rep.removed('element', 'R_ELEMENT_NOT_ALLOWED', 'switch');
    parent.removeChild(sw);
  }

  for (const fr of flows) {
    if (!fr.isConnected) continue;
    const doc = fr.ownerDocument;
    const paras: string[] = [];
    for (const p of Array.from(fr.getElementsByTagName('flowPara'))) {
      const t = (p.textContent ?? '').trim();
      if (t !== '') paras.push(t);
    }
    const rect = fr.getElementsByTagName('rect')[0];
    const x = leadingNumber(rect?.getAttribute('x') ?? null, 0);
    const y = leadingNumber(rect?.getAttribute('y') ?? null, 0);
    const size = leadingNumber(fr.getAttribute('font-size'), 16);
    if (paras.length === 0) {
      fr.parentNode?.removeChild(fr);
      rep.removed('element', 'R_EMPTY', 'flowRoot');
      continue;
    }
    const t = doc.createElementNS(SVG_NS, 'text');
    for (const a of Array.from(fr.attributes))
      if (a.namespaceURI === null) t.setAttribute(a.name, a.value);
    t.setAttribute('x', fmt(x));
    t.setAttribute('y', fmt(y + size));
    t.appendChild(doc.createTextNode(paras.join(' ')));
    fr.parentNode?.insertBefore(t, fr);
    fr.parentNode?.removeChild(fr);
    rep.converted('C_FLOWROOT', 'flowRoot thành text một dòng');
    rep.warn('W_IMPORT_FLOWTEXT_NOWRAP');
  }
}

// --- Kích thước ------------------------------------------------------------------------------------------

const UNIT_PX: ReadonlyMap<string, number> = new Map([
  ['', 1],
  ['px', 1],
  ['pt', 96 / 72],
  ['pc', 16],
  ['mm', 96 / 25.4],
  ['cm', 96 / 2.54],
  ['in', 96],
  ['em', 16],
  ['ex', 8],
]);

/** Độ dài sang px; null nếu đơn vị không đổi được (%, lạ). */
function lengthToPx(v: string): number | null {
  const s = v.trim();
  const n = scanNumber(s, 0);
  if (!n) return null;
  const k = UNIT_PX.get(s.slice(n.end).trim());
  return k === undefined ? null : n.value * k;
}

export type NormalizePostResult =
  | { ok: true; viewBox: [number, number, number, number] }
  | { ok: false; code: 'E_IMPORT_SIZE'; message: string };

function normalizeSize(root: Element, rep: ReportBuilder): NormalizePostResult {
  let changed = false;
  const px: Record<string, number | null> = {};
  for (const name of ['x', 'y', 'width', 'height']) {
    const v = root.getAttribute(name);
    if (v === null) continue;
    const p = lengthToPx(v);
    px[name] = p;
    if (p === null) {
      root.removeAttribute(name);
      changed = true;
      continue;
    }
    const s = fmt(p);
    if (s !== v.trim()) {
      root.setAttribute(name, s);
      changed = true;
    }
  }
  if (changed) rep.converted('C_UNITS', 'đơn vị của gốc svg về px');

  const vbList = root.hasAttribute('viewBox')
    ? scanNumberList(root.getAttribute('viewBox')!)
    : null;
  let vb: [number, number, number, number] | null = null;
  if (vbList && vbList.length === 4 && vbList[2] > 0 && vbList[3] > 0)
    vb = [vbList[0], vbList[1], vbList[2], vbList[3]];
  const w = px.width ?? null;
  const h = px.height ?? null;
  if (vb === null) {
    if (w === null || h === null || !(w > 0) || !(h > 0))
      return {
        ok: false,
        code: 'E_IMPORT_SIZE',
        message: 'Thiếu viewBox và kích thước width/height hợp lệ',
      };
    vb = [0, 0, Number(fmt(w)), Number(fmt(h))];
    root.setAttribute('viewBox', vb.map(fmt).join(' '));
  } else if (!root.hasAttribute('viewBox') || vbList === null) {
    root.setAttribute('viewBox', vb.map(fmt).join(' '));
  }
  if (!root.hasAttribute('width')) root.setAttribute('width', fmt(vb[2]));
  if (!root.hasAttribute('height')) root.setAttribute('height', fmt(vb[3]));
  return { ok: true, viewBox: vb };
}

// --- Font ---------------------------------------------------------------------------------------------

const FAMILIES = new Map<string, string>(
  Object.entries(fonts.families).map(([k, v]) => [k.toLowerCase(), v]),
);
const FAMILY_NAME = new Map<string, string>(
  Object.keys(fonts.families).map((k) => [k.toLowerCase(), k]),
);
const COMPACT = new Map<string, string>(Object.keys(fonts.families).map((k) => [compact(k), k]));
const ALIASES = new Map<string, string>(Object.entries(fonts.aliases));
const GENERIC = new Set<string>(fonts.generic);

function compact(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) out += s[i];
    else if (c >= 65 && c <= 90) out += String.fromCharCode(c + 32);
  }
  return out;
}

function splitFontList(v: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = 0;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (q !== 0) {
      if (c === q) q = 0;
      else cur += v[i];
    } else if (c === 34 || c === 39) q = c;
    else if (c === 44) {
      out.push(cur.trim());
      cur = '';
    } else cur += v[i];
  }
  out.push(cur.trim());
  return out.filter((s) => s !== '');
}

/** Họ font đã biết ứng với `name` (tên họ, tên PostScript theo bảng, hoặc dạng PostScript suy ra); null nếu lạ. */
function resolveFont(name: string): string | null {
  const lower = name.toLowerCase();
  const exact = FAMILY_NAME.get(lower);
  if (exact) return exact;
  const alias = ALIASES.get(lower);
  if (alias) return alias;
  const hasDash = lower.indexOf('-') >= 0;
  const endsMt = lower.endsWith('mt');
  if (!hasDash && !endsMt) return null;
  let base = hasDash ? lower.slice(0, lower.indexOf('-')) : lower;
  if (base.endsWith('psmt')) base = base.slice(0, -4);
  else if (base.endsWith('mt')) base = base.slice(0, -2);
  return COMPACT.get(compact(base)) ?? null;
}

function needsQuote(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const ok =
      (c >= 97 && c <= 122) ||
      (c >= 65 && c <= 90) ||
      c === 45 ||
      c === 95 ||
      (i > 0 && c >= 48 && c <= 57);
    if (!ok) return true;
  }
  return name === '';
}

function normalizeFonts(all: Element[], rep: ReportBuilder): void {
  let mappedCount = 0;
  for (const el of all) {
    const v = el.getAttribute('font-family');
    if (v === null) continue;
    const names = splitFontList(v);
    const out: string[] = [];
    let generic: string | null = null;
    let unknown = false;
    let boldHint = false;
    let italicHint = false;
    for (const n of names) {
      if (GENERIC.has(n)) {
        out.push(n);
        generic = generic ?? n;
        rep.font(n);
        continue;
      }
      const fam = resolveFont(n);
      if (fam === null) {
        unknown = true;
        out.push(n);
        rep.font(n, undefined, true);
        continue;
      }
      if (fam !== n) {
        mappedCount++;
        const low = n.toLowerCase();
        if (low.includes('bold')) boldHint = true;
        if (low.includes('italic') || low.includes('oblique')) italicHint = true;
      }
      out.push(fam);
      rep.font(n, fam);
      if (generic === null) generic = FAMILIES.get(fam.toLowerCase()) ?? null;
    }
    if (!out.some((n) => GENERIC.has(n))) {
      out.push(generic ?? 'sans-serif');
      if (unknown) rep.warn('W_IMPORT_FONT_FALLBACK');
    }
    const next = out.map((n) => (needsQuote(n) ? `'${n}'` : n)).join(', ');
    if (next !== v) el.setAttribute('font-family', next);
    if (boldHint && !el.hasAttribute('font-weight')) el.setAttribute('font-weight', 'bold');
    if (italicHint && !el.hasAttribute('font-style')) el.setAttribute('font-style', 'italic');
  }
  if (mappedCount > 0) rep.converted('C_FONT_MAP', 'tên font PostScript', '', mappedCount);
}

// --- Làm tròn -------------------------------------------------------------------------------------------

const ROUND_ATTRS: ReadonlySet<string> = new Set([
  'd', 'points', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'dx', 'dy',
  'stroke-width', 'font-size',
]); // prettier-ignore

/** Làm tròn số có hơn 4 chữ số thập phân về 3; giữ nguyên mọi ký tự khác. */
export function roundNumbers(s: string): string {
  let out = '';
  let i = 0;
  let changed = false;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    const numStart = (c >= 48 && c <= 57) || c === 46 || c === 45 || c === 43;
    const n = numStart ? scanNumber(s, i) : null;
    if (!n) {
      out += s[i++];
      continue;
    }
    const tok = s.slice(i, n.end);
    let frac = 0;
    const dot = tok.indexOf('.');
    if (dot >= 0 && tok.indexOf('e') < 0 && tok.indexOf('E') < 0) frac = tok.length - dot - 1;
    if (frac > 4) {
      out += fmt(n.value);
      changed = true;
    } else out += tok;
    i = n.end;
  }
  return changed ? out : s;
}

function hasArc(d: string): boolean {
  for (let i = 0; i < d.length; i++) {
    const c = d.charCodeAt(i);
    if (c === 97 || c === 65) return true;
  }
  return false;
}

function normalizeRounding(all: Element[], rep: ReportBuilder): void {
  let count = 0;
  for (const el of all) {
    for (const a of Array.from(el.attributes)) {
      if (!ROUND_ATTRS.has(a.name) || a.namespaceURI !== null) continue;
      if (a.name === 'd' && hasArc(a.value)) continue; // cờ cung nén ("a1 1 0 00.5.5") dễ bị đọc sai
      const r = roundNumbers(a.value);
      if (r !== a.value) {
        el.setAttribute(a.name, r);
        count++;
      }
    }
  }
  if (count > 0) rep.converted('C_ROUND', 'số làm tròn còn 3 chữ số thập phân', '', count);
}

// --- Id trùng, tham chiếu treo, rỗng, không dùng --------------------------------------------------------

function normalizeIds(all: Element[], rep: ReportBuilder): void {
  const used = new Set<string>();
  for (const el of all) {
    const id = el.getAttribute('id');
    if (id !== null) used.add(id);
  }
  const seen = new Set<string>();
  let dup = 0;
  for (const el of all) {
    const id = el.getAttribute('id');
    if (id === null) continue;
    if (!seen.has(id)) {
      seen.add(id);
      continue;
    }
    let k = 2;
    while (used.has(`${id}-${k}`)) k++;
    const next = `${id}-${k}`;
    used.add(next);
    seen.add(next);
    el.setAttribute('id', next);
    dup++;
  }
  if (dup > 0) rep.converted('C_DUP_ID', 'id trùng được đổi tên', '', dup);
}

function normalizeDangling(all: Element[], rep: ReportBuilder): void {
  const ids = new Set<string>();
  for (const el of all) {
    const id = el.getAttribute('id');
    if (id !== null) ids.add(id);
  }
  for (const el of all) {
    if (!el.isConnected) continue;
    for (const a of Array.from(el.attributes)) {
      const v = a.value;
      if (a.localName === 'href' && v.charCodeAt(0) === 35) {
        if (ids.has(v.slice(1).trim())) continue;
        if (el.localName === 'use' || el.localName === 'textPath' || el.localName === 'image') {
          el.parentNode?.removeChild(el);
          rep.removed('reference', 'R_DANGLING_REF', el.localName);
          break;
        }
        el.removeAttribute(a.name);
        rep.removed('reference', 'R_DANGLING_REF', el.localName + '@href');
      } else if (v.indexOf('url(') >= 0) {
        // mọi url(#id) trong thuộc tính đã qua allowlist; chỉ một tham chiếu mỗi giá trị (kèm màu dự phòng)
        const refs = collectRefsOfValue(v);
        if (refs !== null && !ids.has(refs)) {
          el.removeAttribute(a.name);
          rep.removed('reference', 'R_DANGLING_REF', a.name);
        }
      }
    }
  }
}

function collectRefsOfValue(v: string): string | null {
  const s = v.trim();
  const k = s.indexOf('#');
  if (k < 0 || s.indexOf('url(') < 0) return null;
  let j = k + 1;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    const ok =
      (c >= 97 && c <= 122) ||
      (c >= 65 && c <= 90) ||
      (c >= 48 && c <= 57) ||
      c === 95 ||
      c === 46 ||
      c === 58 ||
      c === 45;
    if (!ok) break;
    j++;
  }
  return s.slice(k + 1, j);
}

const DEF_CANDIDATES: ReadonlySet<string> = new Set([
  'linearGradient',
  'radialGradient',
  'pattern',
  'clipPath',
  'mask',
  'marker',
  'filter',
  'symbol',
]);
const EMPTY_REMOVABLE: ReadonlySet<string> = new Set(['g', 'defs', 'text']);

function hasContent(el: Element): boolean {
  if (el.children.length > 0) return true;
  if (el.localName === 'text') return (el.textContent ?? '').trim() !== '';
  return false;
}

function cleanEmptyAndUnused(root: Element, rep: ReportBuilder): void {
  for (let pass = 0; pass < 8; pass++) {
    const all = allElements(root);
    const refs = collectReferences(root);
    const doomed: Array<{ el: Element; code: string }> = [];
    const marked = new Set<Element>();
    for (const el of all) {
      if (el === root) continue;
      const parent = el.parentElement;
      const id = el.getAttribute('id');
      const referenced = id !== null && refs.has(id);
      if (!referenced && (DEF_CANDIDATES.has(el.localName) || parent?.localName === 'defs')) {
        if (!(parent && marked.has(parent))) {
          doomed.push({ el, code: 'R_UNUSED_DEF' });
          marked.add(el);
        }
        continue;
      }
      if (EMPTY_REMOVABLE.has(el.localName) && !hasContent(el) && !(parent && marked.has(parent))) {
        doomed.push({ el, code: 'R_EMPTY' });
        marked.add(el);
      }
    }
    if (doomed.length === 0) break;
    for (const d of doomed) {
      d.el.parentNode?.removeChild(d.el);
      rep.removed(d.code === 'R_EMPTY' ? 'element' : 'definition', d.code, d.el.localName);
    }
  }
}

/** Chuẩn hóa sau allowlist. Trả viewBox cuối hoặc E_IMPORT_SIZE. */
export function normalizePost(root: Element, rep: ReportBuilder): NormalizePostResult {
  const size = normalizeSize(root, rep);
  if (!size.ok) return size;
  const all = allElements(root);
  normalizeIds(all, rep);
  normalizeDangling(all, rep);
  normalizeFonts(all, rep);
  normalizeRounding(all, rep);
  cleanEmptyAndUnused(root, rep);
  return size;
}
