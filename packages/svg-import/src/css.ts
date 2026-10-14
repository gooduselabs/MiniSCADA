// CSS thành thuộc tính trình bày (research R4; contract svg-import §4). Bộ tách từ vựng và bộ chọn tự viết:
// không regex, không CSSOM, không đệ quy. Kết quả ghi thẳng thành thuộc tính; `<style>`, `class`, `style` bị bỏ.
import { CSS_PROPS, PRESENTATION, SVG_NS, isTransform, parseDeclarations } from '@mat/svg-renderer';
import type { CssDeclaration } from '@mat/svg-renderer';
import type { ReportBuilder } from './report.ts';

const MAX_SHEET_CHARS = 1024 * 1024;
const MAX_RULES = 100_000;

export interface Selector {
  tag: string | null;
  id: string | null;
  classes: string[];
  /** Độ đặc hiệu (id, lớp, thẻ). */
  spec: [number, number, number];
}

export interface CssRule {
  selectors: Selector[];
  decls: CssDeclaration[];
  order: number;
}

export interface Stylesheet {
  rules: CssRule[];
  /** Tên các at-rule đã bỏ (không gồm `@`). */
  atRules: string[];
  /** Số bộ chọn không hỗ trợ (đã bỏ). */
  unsupportedSelectors: number;
}

const isWs = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
const isIdentChar = (c: number): boolean =>
  (c >= 97 && c <= 122) ||
  (c >= 65 && c <= 90) ||
  (c >= 48 && c <= 57) ||
  c === 45 ||
  c === 95 ||
  c > 127;

/** Chỉ số sau nháy đóng (i trỏ nháy mở); n nếu không đóng. */
function skipString(s: string, i: number): number {
  const q = s.charCodeAt(i);
  let j = i + 1;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c === 92) j += 2;
    else if (c === q) return j + 1;
    else j++;
  }
  return s.length;
}

/** i trỏ `{`: chỉ số sau `}` tương ứng (có tính chuỗi, chú thích, lồng); -1 nếu không đóng. */
function skipBlock(s: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (c === 34 || c === 39) j = skipString(s, j);
    else if (c === 47 && s.charCodeAt(j + 1) === 42) {
      const e = s.indexOf('*/', j + 2);
      j = e < 0 ? s.length : e + 2;
    } else if (c === 92) j += 2;
    else if (c === 123) {
      depth++;
      j++;
    } else if (c === 125) {
      depth--;
      j++;
      if (depth === 0) return j;
    } else j++;
  }
  return -1;
}

function parseCompound(text: string): Selector | null {
  const s = text.trim();
  if (s === '') return null;
  let tag: string | null = null;
  let id: string | null = null;
  const classes: string[] = [];
  let i = 0;
  const readIdent = (): string => {
    const st = i;
    while (i < s.length && isIdentChar(s.charCodeAt(i))) i++;
    return s.slice(st, i);
  };
  const first = s.charCodeAt(0);
  if (first === 42) {
    i = 1;
  } else if (first !== 46 && first !== 35) {
    tag = readIdent();
    if (tag === '' || (s.charCodeAt(0) >= 48 && s.charCodeAt(0) <= 57)) return null;
  }
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 46) {
      i++;
      const n = readIdent();
      if (n === '') return null;
      classes.push(n);
    } else if (c === 35) {
      i++;
      const n = readIdent();
      if (n === '' || id !== null) return null;
      id = n;
    } else return null; // khoảng trắng, >, +, ~, [, :, ... không hỗ trợ
  }
  return { tag, id, classes, spec: [id !== null ? 1 : 0, classes.length, tag !== null ? 1 : 0] };
}

/** Tách danh sách bộ chọn; trả bộ chọn hỗ trợ và số bộ chọn bỏ. */
function parseSelectorList(prelude: string): { selectors: Selector[]; unsupported: number } {
  const selectors: Selector[] = [];
  let unsupported = 0;
  let cur = '';
  const flush = (): void => {
    const sel = parseCompound(cur);
    if (sel) selectors.push(sel);
    else unsupported++;
    cur = '';
  };
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude.charCodeAt(i);
    if (c === 44) flush();
    else cur += prelude[i];
  }
  flush();
  return { selectors, unsupported };
}

/** Phân tích một khối `<style>`. Không ném lỗi; khối không đóng bị bỏ. */
export function parseStylesheet(cssIn: string): Stylesheet {
  const css = cssIn.length > MAX_SHEET_CHARS ? cssIn.slice(0, MAX_SHEET_CHARS) : cssIn;
  const out: Stylesheet = { rules: [], atRules: [], unsupportedSelectors: 0 };
  const n = css.length;
  let i = 0;
  let order = 0;
  while (i < n) {
    const c = css.charCodeAt(i);
    if (isWs(c)) {
      i++;
    } else if (c === 47 && css.charCodeAt(i + 1) === 42) {
      const e = css.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
    } else if (css.startsWith('<!--', i)) i += 4;
    else if (css.startsWith('-->', i)) i += 3;
    else if (c === 64) {
      let j = i + 1;
      while (j < n && isIdentChar(css.charCodeAt(j))) j++;
      out.atRules.push(css.slice(i + 1, j).toLowerCase());
      // bỏ phần còn lại: tới `;` hoặc hết khối `{…}`
      while (j < n) {
        const d = css.charCodeAt(j);
        if (d === 34 || d === 39) j = skipString(css, j);
        else if (d === 59) {
          j++;
          break;
        } else if (d === 123) {
          const e = skipBlock(css, j);
          j = e < 0 ? n : e;
          break;
        } else j++;
      }
      i = j;
    } else {
      let j = i;
      let open = -1;
      while (j < n) {
        const d = css.charCodeAt(j);
        if (d === 34 || d === 39) j = skipString(css, j);
        else if (d === 47 && css.charCodeAt(j + 1) === 42) {
          const e = css.indexOf('*/', j + 2);
          j = e < 0 ? n : e + 2;
        } else if (d === 123) {
          open = j;
          break;
        } else if (d === 59 || d === 125) break;
        else j++;
      }
      if (open < 0) {
        i = j + 1; // câu lệnh hỏng: bỏ
        continue;
      }
      const end = skipBlock(css, open);
      if (end < 0) break; // khối không đóng: bỏ phần còn lại
      const prelude = css.slice(i, open);
      const body = css.slice(open + 1, end - 1);
      i = end;
      const { selectors, unsupported } = parseSelectorList(prelude);
      out.unsupportedSelectors += unsupported;
      if (selectors.length === 0) continue;
      if (out.rules.length >= MAX_RULES) continue;
      out.rules.push({ selectors, decls: parseDeclarations(body), order: order++ });
    }
  }
  return out;
}

// --- Áp dụng lên cây ---------------------------------------------------------------------------------

interface ValidDecl {
  prop: string;
  value: string;
  important: boolean;
}

interface Entry {
  sel: Selector;
  decls: ValidDecl[];
  order: number;
}

interface Cand {
  value: string;
  important: boolean;
  inline: boolean;
  spec: [number, number, number];
  order: number;
}

function better(a: Cand, b: Cand): boolean {
  if (a.important !== b.important) return a.important;
  if (a.inline !== b.inline) return a.inline;
  for (let k = 0; k < 3; k++) if (a.spec[k] !== b.spec[k]) return a.spec[k] > b.spec[k];
  return a.order > b.order;
}

/** Kiểm một khai báo; trả giá trị chuẩn hóa hoặc ghi lý do loại. */
function validate(d: CssDeclaration, rep: ReportBuilder): ValidDecl | null {
  if (!CSS_PROPS.has(d.prop)) {
    rep.removed('css-property', 'R_CSS_PROP', d.prop);
    return null;
  }
  if (d.prop === 'transform') {
    if (isTransform(d.value))
      return { prop: d.prop, value: d.value.trim(), important: d.important };
    rep.removed('css-property', 'R_VALUE_INVALID', d.prop);
    return null;
  }
  const norm = PRESENTATION.get(d.prop)!(d.value);
  if (norm === null) {
    const code = d.value.toLowerCase().includes('url(') ? 'R_URL_EXTERNAL' : 'R_VALUE_INVALID';
    rep.removed('css-property', code, d.prop);
    return null;
  }
  return { prop: d.prop, value: norm, important: d.important };
}

function splitWords(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i <= s.length; i++) {
    if (i === s.length || isWs(s.charCodeAt(i))) {
      if (cur !== '') out.push(cur);
      cur = '';
    } else cur += s[i];
  }
  return out;
}

/**
 * Đọc mọi `<style>` (thứ tự tài liệu) và thuộc tính `style`, áp cascade (độ đặc hiệu, thứ tự, `!important`,
 * `style` nội tuyến), ghi kết quả thành thuộc tính trình bày; bỏ `<style>`, `class`, `style`.
 */
export function applyCss(root: Element, rep: ReportBuilder): void {
  // Thu thập phần tử (duyệt không đệ quy) và khối <style>.
  const all: Element[] = [];
  const styles: Element[] = [];
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    all.push(el);
    if (el.localName === 'style' && el.namespaceURI === SVG_NS) styles.push(el);
    const kids = el.children;
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }

  // Chỉ mục luật.
  const byId = new Map<string, Entry[]>();
  const byClass = new Map<string, Entry[]>();
  const byTag = new Map<string, Entry[]>();
  const universal: Entry[] = [];
  let orderBase = 0;
  for (const st of styles) {
    const sheet = parseStylesheet(st.textContent ?? '');
    for (const a of sheet.atRules) rep.removed('css-at', 'R_CSS_AT', '@' + a);
    if (sheet.unsupportedSelectors > 0) {
      rep.removed('css-rule', 'R_CSS_RULE', 'selector', undefined, sheet.unsupportedSelectors);
      rep.warn('W_IMPORT_CSS_PARTIAL', '', sheet.unsupportedSelectors);
    }
    for (const rule of sheet.rules) {
      const decls: ValidDecl[] = [];
      for (const d of rule.decls) {
        const v = validate(d, rep);
        if (v) decls.push(v);
      }
      if (decls.length === 0) continue;
      for (const sel of rule.selectors) {
        const e: Entry = { sel, decls, order: orderBase + rule.order };
        const push = (m: Map<string, Entry[]>, key: string): void => {
          const arr = m.get(key);
          if (arr) arr.push(e);
          else m.set(key, [e]);
        };
        if (sel.id !== null) push(byId, sel.id);
        else if (sel.classes.length > 0) push(byClass, sel.classes[0]);
        else if (sel.tag !== null) push(byTag, sel.tag);
        else universal.push(e);
      }
    }
    orderBase += sheet.rules.length;
  }
  for (const st of styles) st.parentNode?.removeChild(st);

  let converted = 0;
  for (const el of all) {
    if (!el.isConnected && el !== root) continue; // <style> đã bỏ
    const classAttr = el.getAttribute('class');
    const styleAttr = el.getAttribute('style');
    const idAttr = el.getAttribute('id');
    const classes = classAttr === null ? [] : splitWords(classAttr);
    const cands: Entry[] = [];
    if (idAttr !== null) {
      const a = byId.get(idAttr);
      if (a) cands.push(...a);
    }
    for (const c of classes) {
      const a = byClass.get(c);
      if (a) cands.push(...a);
    }
    const t = byTag.get(el.localName);
    if (t) cands.push(...t);
    if (universal.length > 0) cands.push(...universal);
    if (cands.length === 0 && styleAttr === null) {
      if (classAttr !== null) el.removeAttribute('class');
      continue;
    }

    const best = new Map<string, Cand>();
    const consider = (
      d: ValidDecl,
      inline: boolean,
      spec: [number, number, number],
      order: number,
    ): void => {
      const cand: Cand = { value: d.value, important: d.important, inline, spec, order };
      const cur = best.get(d.prop);
      if (!cur || better(cand, cur)) best.set(d.prop, cand);
    };
    for (const e of cands) {
      const s = e.sel;
      if (s.tag !== null && s.tag !== el.localName) continue;
      if (s.id !== null && s.id !== idAttr) continue;
      let ok = true;
      for (const c of s.classes) if (!classes.includes(c)) ok = false;
      if (!ok) continue;
      for (const d of e.decls) consider(d, false, s.spec, e.order);
    }
    if (styleAttr !== null) {
      for (const d of parseDeclarations(styleAttr)) {
        const v = validate(d, rep);
        if (v) consider(v, true, [0, 0, 0], 0);
      }
    }
    for (const [prop, c] of best) {
      el.setAttribute(prop, c.value);
      converted++;
    }
    if (classAttr !== null) el.removeAttribute('class');
    if (styleAttr !== null) el.removeAttribute('style');
  }
  if (converted > 0 || styles.length > 0)
    rep.converted('C_CSS', 'khai báo CSS thành thuộc tính', '', Math.max(converted, 1));
}
