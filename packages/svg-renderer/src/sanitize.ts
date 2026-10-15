// Bộ lọc SVG theo ALLOWLIST (Constitution V, FR-013, FR-014, FR-023; ADR-023): chạy trên DOM đã
// parse cho mọi màn hình ở trang runtime, Studio Xem trước và CLI (mountScreen gọi nó).
//
// - Phần tử: chỉ giữ phần tử thuộc namespace SVG có trong ALLOW_ELEMENTS (tra bảng, phân biệt hoa thường);
//   phần tử khác bị bỏ cùng cây con; `a` được "mở vỏ" (bỏ phần tử, giữ con).
// - Thuộc tính: tra ATTR_RULES / PRESENTATION / COMMON_ATTRS, giá trị qua hàm kiểm của css-value.ts;
//   `style` đi qua bộ tách từ vựng CSS; `xlink:href` chuẩn hóa thành `href`.
// - Duyệt bằng vòng lặp với ngăn xếp tường minh (không đệ quy), đếm phần tử và độ sâu trong cùng lượt.
// - Không dùng biểu thức chính quy trong quyết định giữ/bỏ.
//
// Hợp đồng cũ giữ nguyên: chữ ký `sanitizeSvg(root, opts): SanitizeReport`, xuất SVG_NS, namespaceLabel,
// parseSvg. Khác với bản denylist Sprint 1: `<style>`/`class` bị bỏ ở trang (importer chuyển CSS thành
// thuộc tính trước khi lưu), `switch`, SMIL, `desc`, `metadata` bị bỏ.

import {
  META_ELEMENTS,
  ALLOW_ELEMENTS,
  BINDABLE_ELEMENTS,
  SMIL_ELEMENTS,
  TEXT_ELEMENTS,
  UNWRAP_ELEMENTS,
  ATTR_RULES,
  ruleFor,
  sanitizeStyleAttr,
} from './allowlist.ts';
import { isHref, isName, isTransform, isUid, parseDataImage } from './css-value.ts';
import { isWs, scanNumberList } from './scan.ts';

export interface SanitizeReport {
  /** Phần tử đã bỏ theo tên (chữ thường; phần tử ngoài namespace SVG: `nhãn:tên`). Chỉ tính gốc cây con. */
  removedElements: Record<string, number>;
  /** Thuộc tính đã gỡ (on*, href ngoài, giá trị không hợp lệ, ngoài danh sách, style có khai báo bị bỏ). */
  removedAttributes: number;
  /** Thuộc tính data-* ngoài danh sách giữ lại (ADR-003: data-mat-uid, data-mat-name). */
  removedDataAttributes: number;
  elementCount: number;
  maxDepth: number;
  /** Số lần theo mã lý do (`R_SCRIPT`, `R_EVENT_ATTR`, … của contract svg-import §6). */
  codes: Record<string, number>;
  /** Số phần tử `a` đã mở vỏ. */
  unwrapped: number;
  /**
   * Thuộc tính đã gỡ theo (mã, tên đầy đủ như `onclick`, `xlink:href`, `data-foo`): số lần và tối đa 3 đường dẫn ví dụ
   * (`/svg/g[2]/rect[1]`, chỉ số theo cây đã lọc tới lúc gặp). Không gồm khai báo trong `style`. FR-020, US1-7.
   */
  attributeDetails: Array<{ code: string; name: string; count: number; paths: string[] }>;
}

const MAX_ATTR_PATHS = 3;
const MAX_ATTR_DETAILS = 200;

/** Đường dẫn dạng `/svg/g[2]/rect[1]`: chỉ số tính trong các anh em cùng tên (từ 1); gốc không có chỉ số. */
function elementPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let guard = 0; cur && guard < 256; guard++) {
    let idx = 1;
    for (let p = cur.previousElementSibling; p; p = p.previousElementSibling)
      if (p.localName === cur.localName && p.namespaceURI === cur.namespaceURI) idx++;
    parts.push(cur.parentElement ? `${cur.localName}[${idx}]` : cur.localName);
    cur = cur.parentElement;
  }
  return '/' + parts.reverse().join('/');
}

export const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export interface SanitizeOptions {
  /** Thuộc tính data-* được giữ; mặc định data-mat-uid và data-mat-name (ADR-003 điểm 4). */
  keepDataAttributes?: string[];
}
const DEFAULT_KEEP_DATA = ['data-mat-uid', 'data-mat-name'];

/** Giới hạn của contract svg-import §10, áp ở trang. */
const MAX_FILTERS = 8;
const MAX_FE = 64;
const MAX_IMAGES = 16;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_NODE = 4096;
const MAX_TITLE = 200;

// Tên ngắn cho namespace hay gặp trong file của các phần mềm vẽ (để báo cáo dễ đọc).
const NS_LABELS: Record<string, string> = {
  'http://www.w3.org/1999/xhtml': 'xhtml',
  'http://www.inkscape.org/namespaces/inkscape': 'inkscape',
  'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd': 'sodipodi',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://creativecommons.org/ns#': 'cc',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://ns.adobe.com/AdobeIllustrator/10.0/': 'adobe-ai',
  'http://www.corel.com/coreldraw/odm/2003': 'corel',
};

export function namespaceLabel(uri: string | null): string {
  if (!uri) return 'no-ns';
  return NS_LABELS[uri] ?? `ns(${uri})`;
}

export function parseSvg(text: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error('SVG không phải XML hợp lệ: ' + (err.textContent ?? '').slice(0, 200));
  const root = doc.documentElement;
  if (root.localName !== 'svg') throw new Error('Phần tử gốc không phải <svg>: ' + root.localName);
  if (root.namespaceURI !== SVG_NS)
    throw new Error('Phần tử gốc <svg> không thuộc namespace SVG: ' + root.namespaceURI);
  return root as unknown as SVGSVGElement;
}

function isBlank(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (!isWs(text.charCodeAt(i))) return false;
  return true;
}

/** Giá trị `href` của phần tử (không namespace hoặc xlink); null nếu không có. */
function hrefValue(el: Element): string | null {
  for (const a of Array.from(el.attributes)) {
    if (a.localName === 'href' && (a.namespaceURI === null || a.namespaceURI === XLINK_NS))
      return a.value;
  }
  return null;
}

type Verdict =
  { kind: 'keep' } | { kind: 'unwrap' } | { kind: 'remove'; key: string; code: string };

/** Sửa trực tiếp cây DOM; trả về thống kê những gì đã loại. */
export function sanitizeSvg(root: Element, opts: SanitizeOptions = {}): SanitizeReport {
  const keepData = new Set(opts.keepDataAttributes ?? DEFAULT_KEEP_DATA);
  const report: SanitizeReport = {
    removedElements: {},
    removedAttributes: 0,
    removedDataAttributes: 0,
    elementCount: 0,
    maxDepth: 0,
    codes: {},
    unwrapped: 0,
    attributeDetails: [],
  };
  const detailIndex = new Map<string, number>();
  const limits = { filters: 0, fe: 0, images: 0, imageBytes: 0 };

  const note = (code: string, n = 1): void => {
    report.codes[code] = (report.codes[code] ?? 0) + n;
  };
  const detail = (el: Element, attr: Attr, code: string): void => {
    const name = attr.name.length > 64 ? attr.name.slice(0, 64) + '…' : attr.name;
    const key = code + ' ' + name;
    let i = detailIndex.get(key);
    if (i === undefined) {
      if (report.attributeDetails.length >= MAX_ATTR_DETAILS) return; // phần dư vào dòng chung của importer
      i = report.attributeDetails.length;
      detailIndex.set(key, i);
      report.attributeDetails.push({ code, name, count: 0, paths: [] });
    }
    const d = report.attributeDetails[i];
    d.count++;
    if (d.paths.length < MAX_ATTR_PATHS) {
      const path = elementPath(el);
      if (!d.paths.includes(path)) d.paths.push(path);
    }
  };
  const dropAttr = (el: Element, attr: Attr, code: string): void => {
    detail(el, attr, code);
    el.removeAttributeNode(attr);
    report.removedAttributes++;
    note(code);
  };

  // --- Thuộc tính ---
  const cleanAttributes = (el: Element): void => {
    const local = el.localName;
    for (const attr of Array.from(el.attributes)) {
      const ns = attr.namespaceURI;
      const name = attr.localName;
      if (ns === XMLNS_NS) {
        el.removeAttributeNode(attr); // khai báo namespace: DOM đã mang namespace, không cần giữ
        continue;
      }
      if (ns === XLINK_NS && name === 'href') {
        const rule = ruleFor(local, 'href');
        const norm = rule ? rule(attr.value) : null;
        if (norm === null) detail(el, attr, 'R_HREF_EXTERNAL');
        el.removeAttributeNode(attr);
        if (norm === null) {
          report.removedAttributes++;
          note('R_HREF_EXTERNAL');
        } else if (!el.hasAttribute('href')) {
          el.setAttribute('href', norm);
        }
        continue;
      }
      if (ns === XML_NS && name === 'space') {
        const norm = ATTR_RULES.get(local)?.get('xml:space')?.(attr.value) ?? null;
        if (norm === null) dropAttr(el, attr, 'R_ATTR_NOT_ALLOWED');
        continue;
      }
      if (ns !== null) {
        dropAttr(el, attr, name === 'href' ? 'R_HREF_EXTERNAL' : 'R_ATTR_NOT_ALLOWED');
        continue;
      }
      if (name.startsWith('data-')) {
        if (!keepData.has(name)) {
          detail(el, attr, 'R_DATA_ATTR');
          el.removeAttributeNode(attr);
          report.removedDataAttributes++;
          note('R_DATA_ATTR');
        } else if (name === 'data-mat-uid' ? !isUid(attr.value) : !isName(attr.value)) {
          dropAttr(el, attr, 'R_VALUE_INVALID');
        }
        continue;
      }
      if (name === 'style') {
        const res = sanitizeStyleAttr(attr.value);
        for (const d of res.dropped) note(d.code);
        if (res.dropped.length > 0) report.removedAttributes++;
        if (res.transform !== null && !el.hasAttribute('transform') && isTransform(res.transform))
          el.setAttribute('transform', res.transform);
        if (res.css === '') el.removeAttributeNode(attr);
        else if (res.css !== attr.value) el.setAttribute('style', res.css);
        continue;
      }
      const rule = ruleFor(local, name);
      if (!rule) {
        dropAttr(
          el,
          attr,
          name.startsWith('on')
            ? 'R_EVENT_ATTR'
            : name === 'href'
              ? 'R_HREF_EXTERNAL'
              : 'R_ATTR_NOT_ALLOWED',
        );
        continue;
      }
      const norm = rule(attr.value);
      if (norm === null) {
        const code =
          name === 'href'
            ? 'R_HREF_EXTERNAL'
            : attr.value.toLowerCase().includes('url(')
              ? 'R_URL_EXTERNAL'
              : 'R_VALUE_INVALID';
        dropAttr(el, attr, code);
      } else if (norm !== attr.value) {
        if (name === 'stdDeviation' && scanNumberList(attr.value)?.some((x) => x > 30))
          note('R_FILTER_HEAVY'); // đã kẹp ≤ 30
        el.setAttribute(name, norm);
      }
    }
  };

  // --- Quyết định cho một phần tử con ---
  const classify = (c: Element, parent: Element): Verdict => {
    const local = c.localName;
    if (c.namespaceURI !== SVG_NS) {
      return {
        kind: 'remove',
        key: `${namespaceLabel(c.namespaceURI)}:${local}`,
        code: 'R_NAMESPACE',
      };
    }
    const key = local.toLowerCase();
    if (UNWRAP_ELEMENTS.has(local)) return { kind: 'unwrap' };
    if (!ALLOW_ELEMENTS.has(local)) {
      const code =
        local === 'script'
          ? 'R_SCRIPT'
          : local === 'foreignObject'
            ? 'R_FOREIGN'
            : SMIL_ELEMENTS.has(local)
              ? 'R_SMIL'
              : META_ELEMENTS.has(local)
                ? 'R_META'
                : 'R_ELEMENT_NOT_ALLOWED';
      return { kind: 'remove', key, code };
    }
    const parentLocal = parent.localName;
    if (parentLocal === 'title') return { kind: 'remove', key, code: 'R_ELEMENT_NOT_ALLOWED' };
    if (local === 'title' && !BINDABLE_ELEMENTS.has(parentLocal))
      return { kind: 'remove', key, code: 'R_ELEMENT_NOT_ALLOWED' };
    if (local === 'image') {
      const href = hrefValue(c);
      if (href === null) return { kind: 'remove', key, code: 'R_IMAGE_BAD' };
      const img = parseDataImage(href);
      if (img === null) {
        const linked = href.trim().toLowerCase().startsWith('data:') || href.trim().startsWith('#');
        return { kind: 'remove', key, code: linked ? 'R_IMAGE_BAD' : 'R_IMAGE_LINKED' };
      }
      if (limits.images + 1 > MAX_IMAGES || limits.imageBytes + img.bytes > MAX_IMAGE_BYTES)
        return { kind: 'remove', key, code: 'R_IMAGE_LIMIT' };
      limits.images++;
      limits.imageBytes += img.bytes;
    }
    if (local === 'filter') {
      if (limits.filters + 1 > MAX_FILTERS) return { kind: 'remove', key, code: 'R_FILTER_LIMIT' };
      limits.filters++;
    }
    if (local.startsWith('fe')) {
      if (limits.fe + 1 > MAX_FE) return { kind: 'remove', key, code: 'R_FILTER_LIMIT' };
      limits.fe++;
    }
    return { kind: 'keep' };
  };

  // --- Duyệt (ngăn xếp tường minh) ---
  const stack: Array<{ el: Element; depth: number }> = [{ el: root, depth: 1 }];
  while (stack.length > 0) {
    const { el, depth } = stack.pop()!;
    report.elementCount++;
    if (depth > report.maxDepth) report.maxDepth = depth;
    cleanAttributes(el);

    const textLimit = el.localName === 'title' ? MAX_TITLE : MAX_TEXT_NODE;
    const inText = TEXT_ELEMENTS.has(el.localName);
    const todo = Array.from(el.childNodes).reverse();
    const kept: Element[] = [];
    while (todo.length > 0) {
      const node = todo.pop()!;
      const type = node.nodeType;
      if (type === 1) {
        const c = node as Element;
        const v = classify(c, el);
        if (v.kind === 'keep') {
          kept.push(c);
        } else if (v.kind === 'remove') {
          report.removedElements[v.key] = (report.removedElements[v.key] ?? 0) + 1;
          note(v.code);
          el.removeChild(c);
        } else {
          // mở vỏ: con của `a` chuyển lên trước `a`, xử lý như con của `el`
          for (const attr of Array.from(c.attributes)) {
            if (attr.localName === 'href' && !isHref(attr.value)) {
              report.removedAttributes++;
              note('R_HREF_EXTERNAL');
            }
          }
          const moved = Array.from(c.childNodes);
          for (const m of moved) el.insertBefore(m, c);
          el.removeChild(c);
          report.unwrapped++;
          for (let i = moved.length - 1; i >= 0; i--) todo.push(moved[i]);
        }
      } else if (type === 3 || type === 4) {
        const text = node.nodeValue ?? '';
        if (inText) {
          if (text.length > textLimit) {
            node.nodeValue = text.slice(0, textLimit);
            note('R_TEXT_LONG');
          }
        } else if (!isBlank(text)) {
          el.removeChild(node);
        }
      } else {
        el.removeChild(node); // bình luận, chỉ thị xử lý
      }
    }
    if (inText) {
      // Bình luận, chỉ thị xử lý và phần tử bị bỏ làm các nút chữ liền nhau; bộ ghi và lần parse sau gộp chúng thành
      // một nút. Giới hạn vì thế tính theo tổng của dãy nút chữ/CDATA liền kề (fuzz T113: 10.009 + 25 ký tự).
      let run = 0;
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType !== 3 && n.nodeType !== 4) {
          run = 0;
          continue;
        }
        const v = n.nodeValue ?? '';
        if (run + v.length > textLimit) {
          if (run >= textLimit) el.removeChild(n);
          else n.nodeValue = v.slice(0, textLimit - run);
          run = textLimit;
          note('R_TEXT_LONG');
        } else run += v.length;
      }
    }
    for (let i = kept.length - 1; i >= 0; i--) stack.push({ el: kept[i], depth: depth + 1 });
  }
  return report;
}
