// Bộ lọc SVG TỐI THIỂU cho trang thử Sprint 0 — KHÔNG phải SVG importer/sanitizer của sản phẩm
// (Constitution V: bản thật dùng allowlist, có giới hạn kích thước/node/độ sâu, làm ở Sprint 2).
// Ở đây dùng denylist + lọc namespace để trang thử không chạy script/không gọi ra ngoài khi mở fixture lạ.
// Chưa xử lý: giới hạn kích thước/node/độ sâu và `use` lồng đệ quy (inspect.ts chỉ cảnh báo);
// kiểm tra CSS dùng regex sau khi giải escape, chưa phải CSSOM.

export interface SanitizeReport {
  removedElements: Record<string, number>;
  /** Thuộc tính nguy hiểm đã gỡ (on*, href ngoài, style gọi ra ngoài). */
  removedAttributes: number;
  /** Thuộc tính data-* ngoài danh sách giữ lại (ADR-003: chỉ giữ data-mat-uid). */
  removedDataAttributes: number;
  elementCount: number;
  maxDepth: number;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SanitizeOptions {
  /** Thuộc tính data-* được giữ; mặc định chỉ data-mat-uid (ADR-003 điểm 4). */
  keepDataAttributes?: string[];
}
const DEFAULT_KEEP_DATA = ['data-mat-uid'];

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

const BLOCKED_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'canvas',
  'link',
]);
const SMIL_ELEMENTS = new Set(['animate', 'set']);
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,/i;

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

function isSafeHref(value: string): boolean {
  const v = value.trim();
  return v.startsWith('#') || SAFE_DATA_IMAGE.test(v);
}

/** Giải escape CSS (`\69` → `i`, `\(` → `(`) để regex không bị lách. */
export function cssUnescape(css: string): string {
  return css
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
    })
    .replace(/\\(.)/g, '$1');
}

/** CSS có kéo tài nguyên bên ngoài không: @import, image-set(), url() không trỏ tới #id. */
export function cssHasExternalRef(css: string): boolean {
  const text = cssUnescape(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  if (/@import|image-set\s*\(/i.test(text)) return true;
  for (const m of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!m[2].trim().startsWith('#')) return true;
  }
  return false;
}

function hrefOf(el: Element): string {
  // Khớp theo localName ở mọi namespace: `x:href` với x = xlink cũng là href (review I-1).
  return Array.from(el.attributes).find((a) => a.localName.toLowerCase() === 'href')?.value ?? '';
}

function stripAttributes(el: Element, report: SanitizeReport, keepData: Set<string>): void {
  for (const attr of Array.from(el.attributes)) {
    const local = attr.localName.toLowerCase();
    if (attr.namespaceURI === null && local.startsWith('data-')) {
      if (!keepData.has(local)) {
        el.removeAttributeNode(attr);
        report.removedDataAttributes++;
      }
      continue;
    }
    const bad =
      local.startsWith('on') ||
      (local === 'href' && !isSafeHref(attr.value)) ||
      (local === 'style' && attr.namespaceURI === null && cssHasExternalRef(attr.value));
    if (bad) {
      el.removeAttributeNode(attr);
      report.removedAttributes++;
    }
  }
}

function measureDepth(root: Element): number {
  let max = 0;
  const stack: Array<[Element, number]> = [[root, 1]];
  while (stack.length) {
    const [el, d] = stack.pop()!;
    if (d > max) max = d;
    for (const child of Array.from(el.children)) stack.push([child, d + 1]);
  }
  return max;
}

/** Sửa trực tiếp cây DOM; trả về thống kê những gì đã loại. */
export function sanitizeSvg(root: Element, opts: SanitizeOptions = {}): SanitizeReport {
  const keepData = new Set(
    (opts.keepDataAttributes ?? DEFAULT_KEEP_DATA).map((a) => a.toLowerCase()),
  );
  const report: SanitizeReport = {
    removedElements: {},
    removedAttributes: 0,
    removedDataAttributes: 0,
    elementCount: 0,
    maxDepth: 0,
  };
  const count = (name: string) => {
    report.removedElements[name] = (report.removedElements[name] ?? 0) + 1;
  };

  stripAttributes(root, report, keepData);
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!root.contains(el)) continue; // đã bị gỡ cùng cha
    const name = el.localName.toLowerCase();
    // Chỉ giữ phần tử thuộc namespace SVG (review I-2): XHTML <meta>/<img>, metadata Inkscape/Adobe…
    if (el.namespaceURI !== SVG_NS) {
      el.remove();
      count(`${namespaceLabel(el.namespaceURI)}:${el.localName}`);
      continue;
    }
    const badImage = name === 'image' && !isSafeHref(hrefOf(el));
    const badStyle = name === 'style' && cssHasExternalRef(el.textContent ?? '');
    const badSmil =
      SMIL_ELEMENTS.has(name) && /(^|:)href$/i.test(el.getAttribute('attributeName') ?? '');
    if (BLOCKED_ELEMENTS.has(name) || badImage || badStyle || badSmil) {
      el.remove();
      count(name);
      continue;
    }
    stripAttributes(el, report, keepData);
  }

  report.elementCount = root.querySelectorAll('*').length + 1;
  report.maxDepth = measureDepth(root);
  return report;
}
