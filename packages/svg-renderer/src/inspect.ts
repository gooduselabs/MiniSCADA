// Nhận diện phần mềm đã xuất SVG và cảnh báo các khác biệt định dạng ảnh hưởng tới hiển thị/import.
// Chạy trên cây DOM đã parse nhưng CHƯA lọc (để còn thấy foreignObject, ảnh liên kết, namespace lạ).
// Dùng chung cho trang thử, Vitest và CLI tools/svg-inspect (Node chạy thẳng file .ts).
// Xem phân tích: docs/architecture/svg-dialects.md. Giới hạn mặc định theo Master Plan §7.3.

import { SVG_NS, namespaceLabel } from './sanitize.ts';

export interface InspectLimits {
  maxBytes: number;
  maxNodes: number;
  maxDepth: number;
}

export const DEFAULT_LIMITS: InspectLimits = {
  maxBytes: 5 * 1024 * 1024,
  maxNodes: 20_000,
  maxDepth: 32,
};

export interface InspectWarning {
  code: string;
  message: string;
}

export interface SvgInspection {
  generator: string;
  certainty: 'chắc chắn' | 'có dấu hiệu' | 'không rõ';
  evidence: string[];
  bytes: number;
  elements: number;
  maxDepth: number;
  overLimits: string[];
  units: string | null;
  hasViewBox: boolean;
  styleBlocks: number;
  classConflicts: number;
  conflictedElements: number;
  fonts: string[];
  warnings: InspectWarning[];
}

const NS = {
  inkscape: 'http://www.inkscape.org/namespaces/inkscape',
  sodipodi: 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd',
  adobeAi: 'http://ns.adobe.com/AdobeIllustrator/10.0/',
  corel: 'http://www.corel.com/coreldraw/odm/2003',
  libreoffice: 'http://xml.openoffice.org/svg/export',
};

// Tên font kiểu PostScript (Illustrator hay ghi): MyriadPro-Regular, Arial-BoldMT, ArialMT, TimesNewRomanPSMT.
const POSTSCRIPT_FONT = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)?(MT|PSMT)$|^[A-Za-z0-9]+-[A-Z][A-Za-z]*$/;

function detectGenerator(
  root: Element,
  raw: string,
): Pick<SvgInspection, 'generator' | 'certainty' | 'evidence'> {
  const inkVersion = root.getAttributeNS(NS.inkscape, 'version');
  if (inkVersion) {
    return {
      generator: `Inkscape ${inkVersion.split(/\s+/)[0]}`,
      certainty: 'chắc chắn',
      evidence: [`inkscape:version="${inkVersion}"`],
    };
  }
  const ai = /Generator:\s*Adobe Illustrator\s*([\d.]+)?/.exec(raw);
  if (ai || raw.includes(NS.adobeAi)) {
    return {
      generator: ai?.[1] ? `Adobe Illustrator ${ai[1]}` : 'Adobe Illustrator',
      certainty: 'chắc chắn',
      evidence: [ai ? ai[0] : `namespace ${NS.adobeAi}`],
    };
  }
  if (
    /Creator:\s*CorelDRAW/i.test(raw) ||
    raw.includes(NS.corel) ||
    root.querySelector('[id^="CorelCorpID"]')
  ) {
    return {
      generator: 'CorelDRAW',
      certainty: 'chắc chắn',
      evidence: ['comment Creator/namespace Corel'],
    };
  }
  const content = root.getAttribute('content') ?? '';
  if (/mxfile|mxGraphModel/.test(content)) {
    return {
      generator: 'draw.io',
      certainty: 'chắc chắn',
      evidence: ['thuộc tính content chứa mxfile'],
    };
  }
  if (raw.includes(NS.libreoffice)) {
    return {
      generator: 'LibreOffice',
      certainty: 'chắc chắn',
      evidence: [`namespace ${NS.libreoffice}`],
    };
  }
  if (raw.includes(NS.inkscape) || raw.includes(NS.sodipodi)) {
    return {
      generator: 'Inkscape',
      certainty: 'có dấu hiệu',
      evidence: ['namespace inkscape/sodipodi'],
    };
  }
  const dataName = root.hasAttribute('data-name') || root.querySelector('[data-name]') !== null;
  const clsClass = /\.cls-\d+\s*\{/.test(raw);
  if (dataName && clsClass) {
    return {
      generator: 'Adobe Illustrator (Export As)',
      certainty: 'có dấu hiệu',
      evidence: ['thuộc tính data-name + class .cls-N'],
    };
  }
  return { generator: 'không rõ', certainty: 'không rõ', evidence: [] };
}

/**
 * Có `<!DOCTYPE ... [ ... <!ENTITY` (không phân biệt hoa thường; `[` đứng trước `>` đầu tiên sau DOCTYPE).
 * Quét tuyến tính bằng con trỏ chỉ tiến: regex `/<!DOCTYPE[^>]*\[[\s\S]*?<!ENTITY/i` chạy bậc ba trên "<!DOCTYPE [" lặp
 * lại (T112: 55 KB mất 77 giây; 5 MiB không bao giờ xong).
 */
export function hasDoctypeEntity(raw: string): boolean {
  const low = raw.toLowerCase();
  const lastEntity = low.lastIndexOf('<!entity');
  if (lastEntity < 0) return false;
  let gt = -2; // -2: chưa tìm; -1: không còn
  let br = -2;
  for (let d = low.indexOf('<!doctype'); d >= 0; d = low.indexOf('<!doctype', d + 1)) {
    const from = d + 9;
    if (gt !== -1 && gt < from) gt = low.indexOf('>', from);
    if (br !== -1 && br < from) br = low.indexOf('[', from);
    if (br < 0) return false; // không còn "[" nào sau đây: các DOCTYPE sau cũng không có
    if ((gt < 0 || br < gt) && lastEntity > br) return true;
  }
  return false;
}

function depthOf(root: Element): number {
  let max = 0;
  const stack: Array<[Element, number]> = [[root, 1]];
  while (stack.length) {
    const [el, d] = stack.pop()!;
    if (d > max) max = d;
    for (const c of Array.from(el.children)) stack.push([c, d + 1]);
  }
  return max;
}

/**
 * Các quy tắc `bộ-chọn { khai-báo }` của một đoạn CSS, quét tuyến tính (regex `([^{}]+){([^}]*)}` chạy O(n^2) trên đoạn dài
 * không có dấu `{`: fuzz T113 gặp 6 giây cho 100 KB). Cùng kết quả với regex đó.
 */
function* cssRules(css: string): Generator<[string, string]> {
  let i = 0;
  for (;;) {
    const open = css.indexOf('{', i);
    if (open < 0) return;
    const close = css.indexOf('}', open + 1);
    if (close < 0) return;
    const sel = css.slice(Math.max(i, css.lastIndexOf('}', open) + 1), open);
    if (sel.length === 0) {
      i = open + 1;
      continue;
    }
    yield [sel, css.slice(open + 1, close)];
    i = close + 1;
  }
}

/** Các khối <style>: class nào được định nghĩa ở nhiều khối với khai báo khác nhau. */
function classConflicts(root: Element): { blocks: number; conflicts: Set<string> } {
  const styles = Array.from(root.getElementsByTagNameNS(SVG_NS, 'style'));
  const defs = new Map<string, Set<string>>();
  const blocksOf = new Map<string, Set<number>>();
  styles.forEach((st, i) => {
    const css = (st.textContent ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [selectors, body] of cssRules(css)) {
      const decl = body.trim().replace(/\s+/g, ' ');
      for (const sel of selectors.split(',')) {
        const cm = /^\s*\.([\w-]+)\s*$/.exec(sel);
        if (!cm) continue;
        if (!defs.has(cm[1])) defs.set(cm[1], new Set());
        if (!blocksOf.has(cm[1])) blocksOf.set(cm[1], new Set());
        defs.get(cm[1])!.add(decl);
        blocksOf.get(cm[1])!.add(i);
      }
    }
  });
  const conflicts = new Set<string>();
  for (const [cls, decls] of defs)
    if (blocksOf.get(cls)!.size > 1 && decls.size > 1) conflicts.add(cls);
  return { blocks: styles.length, conflicts };
}

function fontFamilies(root: Element): string[][] {
  const lists: string[][] = [];
  const add = (value: string) =>
    lists.push(
      value
        .split(',')
        .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean),
    );
  for (const el of Array.from(root.querySelectorAll('[font-family]')))
    add(el.getAttribute('font-family')!);
  const cssTexts = [
    ...Array.from(root.querySelectorAll('[style]')).map((e) => e.getAttribute('style')!),
    ...Array.from(root.getElementsByTagNameNS(SVG_NS, 'style')).map((s) => s.textContent ?? ''),
  ];
  for (const css of cssTexts)
    for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi)) add(m[1]);
  return lists;
}

const plural = (counts: Record<string, number>) =>
  Object.entries(counts)
    .map(([k, v]) => `${k}×${v}`)
    .join(', ');

export function inspectSvg(
  root: Element,
  raw: string,
  limits: InspectLimits = DEFAULT_LIMITS,
): SvgInspection {
  const all = [root, ...Array.from(root.querySelectorAll('*'))];
  const bytes = new TextEncoder().encode(raw).length;
  const maxDepth = depthOf(root);
  const warnings: InspectWarning[] = [];
  const warn = (code: string, message: string) => warnings.push({ code, message });
  const svgEls = (name: string) =>
    all.filter((e) => e.namespaceURI === SVG_NS && e.localName === name);

  // Giới hạn import (Master Plan §7.3)
  const overLimits: string[] = [];
  if (bytes > limits.maxBytes) overLimits.push(`kích thước ${bytes} B > ${limits.maxBytes} B`);
  if (all.length > limits.maxNodes)
    overLimits.push(`số phần tử ${all.length} > ${limits.maxNodes}`);
  if (maxDepth > limits.maxDepth) overLimits.push(`độ sâu ${maxDepth} > ${limits.maxDepth}`);
  if (overLimits.length) warn('over-limit', `Vượt giới hạn import: ${overLimits.join('; ')}`);

  // DTD có ENTITY (Illustrator "Save As" cũ): nguy cơ mở rộng entity
  if (hasDoctypeEntity(raw))
    warn(
      'doctype-entity',
      'DOCTYPE có khai báo ENTITY: importer phải bỏ DTD (nguy cơ "entity expansion")',
    );

  // Chữ khung kiểu Inkscape
  const flow = svgEls('flowRoot').length;
  if (flow)
    warn(
      'flowroot',
      `flowRoot×${flow}: chữ khung SVG 1.2 của Inkscape — trình duyệt KHÔNG hiển thị; đổi thành chữ thường`,
    );
  if (all.some((e) => /shape-inside\s*:/.test(e.getAttribute('style') ?? '')))
    warn(
      'shape-inside',
      'Chữ khung SVG 2 (shape-inside): Chrome chưa hỗ trợ đầy đủ, chữ có thể sai vị trí/không xuống dòng',
    );

  // Font SVG nhúng (<font>/<glyph>, LibreOffice hay xuất): Chrome không hỗ trợ SVG font
  const svgFonts = svgEls('font').length;
  if (svgFonts)
    warn(
      'svg-font',
      `Font SVG nhúng×${svgFonts} (<font>/<glyph>): Chrome không hỗ trợ, chữ hiển thị bằng font hệ thống (có thể khác hình); importer nên bỏ`,
    );

  // foreignObject (nhãn HTML của draw.io, khối dữ liệu riêng của Illustrator)
  const fos = svgEls('foreignObject');
  if (fos.length) {
    const withFallback = fos.filter(
      (fo) =>
        fo.parentElement?.localName === 'switch' &&
        Array.from(fo.parentElement.children).some(
          (c) => c !== fo && c.localName !== 'foreignObject',
        ),
    ).length;
    warn(
      'foreign-object',
      `foreignObject×${fos.length} (nội dung HTML/riêng phần mềm) sẽ bị loại` +
        (withFallback
          ? `; ${withFallback} có nội dung dự phòng trong <switch> sẽ hiển thị thay (chữ không xuống dòng, mất định dạng HTML)`
          : ''),
    );
  }

  // Ảnh: liên kết ngoài và raster nhúng
  const images = svgEls('image').map(
    (img) =>
      Array.from(img.attributes)
        .find((a) => a.localName === 'href')
        ?.value.trim() ?? '',
  );
  const linked = images.filter((h) => h && !h.startsWith('data:') && !h.startsWith('#'));
  if (linked.length)
    warn(
      'linked-image',
      `Ảnh liên kết ngoài×${linked.length} (ví dụ ${linked[0].slice(0, 60)}): không hiển thị trên máy khác — cần nhúng ảnh khi xuất`,
    );
  const embedded = images.filter((h) => h.startsWith('data:image/'));
  if (embedded.length) {
    const kb = Math.round(embedded.reduce((s, h) => s + h.length * 0.75, 0) / 1024);
    warn(
      'embedded-raster',
      `Ảnh raster nhúng×${embedded.length} (~${kb} KB): không co giãn sắc nét, tăng dung lượng`,
    );
  }

  // CSS class trùng tên giữa các khối <style> (thường do dán hình từ nhiều file Illustrator)
  const { blocks, conflicts } = classConflicts(root);
  let conflictedElements = 0;
  if (conflicts.size) {
    for (const el of all) {
      const cls = el.getAttribute('class');
      if (cls && cls.split(/\s+/).some((c) => conflicts.has(c))) conflictedElements++;
    }
    warn(
      'class-conflict',
      `${conflicts.size} class được định nghĩa khác nhau ở nhiều khối <style> (${conflictedElements} phần tử dùng): ` +
        'trong một file, Chrome và Inkscape cùng áp quy tắc khối sau; nhưng ghép file khác vào cùng màn hình hoặc chuyển CSS sai thứ tự sẽ đổi màu',
    );
  }

  // Font
  const families = fontFamilies(root);
  const fonts = [...new Set(families.flat())];
  const psNoFallback = [
    ...new Set(
      families.filter((l) => l.length === 1 && POSTSCRIPT_FONT.test(l[0])).map((l) => l[0]),
    ),
  ];
  if (psNoFallback.length)
    warn(
      'postscript-font',
      `Font ghi theo tên PostScript, không có font dự phòng (${psNoFallback.join(', ')}): trình duyệt sẽ dùng font mặc định — cần ánh xạ font hoặc chuyển chữ thành đường nét`,
    );

  // Đơn vị và viewBox
  const unitMatch = /^[\d.]+\s*(mm|cm|in|pt|pc)$/i.exec((root.getAttribute('width') ?? '').trim());
  const units = unitMatch ? unitMatch[1].toLowerCase() : null;
  if (units)
    warn(
      'units',
      `Kích thước khai báo bằng ${units}: runtime co giãn theo viewBox, cần chuẩn hóa sang px khi import`,
    );
  const hasViewBox = root.hasAttribute('viewBox');
  if (!hasViewBox) warn('no-viewbox', 'Không có viewBox: hình không co giãn theo khung, dễ bị cắt');

  // Phần tử chỉ hiển thị, không chỉnh sửa sâu (Master Plan §7.3)
  const showOnly: Record<string, number> = {};
  for (const n of ['filter', 'mask', 'pattern']) {
    const c = svgEls(n).length;
    if (c) showOnly[n] = c;
  }
  const nestedSvg = svgEls('svg').length - 1;
  if (nestedSvg > 0) showOnly['svg lồng'] = nestedSvg;
  if (Object.keys(showOnly).length)
    warn(
      'show-only',
      `${plural(showOnly)}: chỉ hiển thị, không cho chỉnh sửa sâu (Master Plan §7.3)`,
    );

  // Phần tử ngoài namespace SVG (không tính nội dung bên trong foreignObject)
  const foreign: Record<string, number> = {};
  for (const el of all) {
    if (el.namespaceURI === SVG_NS || el.closest('foreignObject')) continue;
    const parent = el.parentElement;
    if (parent && parent.namespaceURI !== SVG_NS) continue; // chỉ đếm gốc của mỗi nhánh lạ
    const label = `${namespaceLabel(el.namespaceURI)}:${el.localName}`;
    foreign[label] = (foreign[label] ?? 0) + 1;
  }
  if (Object.keys(foreign).length)
    warn('foreign-namespace', `Phần tử ngoài namespace SVG sẽ bị bỏ: ${plural(foreign)}`);

  return {
    ...detectGenerator(root, raw),
    bytes,
    elements: all.length,
    maxDepth,
    overLimits,
    units,
    hasViewBox,
    styleBlocks: blocks,
    classConflicts: conflicts.size,
    conflictedElements,
    fonts,
    warnings,
  };
}
