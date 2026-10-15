// Luật 0.4 phụ thuộc NỘI DUNG SVG (feature 008, T060, FR-024; contracts/project-format-0.4.md §6). Chỉ ở bản TS:
// `core/` không parse SVG (Constitution II). Chạy khi `checkSvg` (có DOMParser) trên mọi item `svg` có file SVG đọc
// được: E_SVG_UNSAFE (còn phần ngoài allowlist), E_SVG_LIMIT (> 5 MiB, > 20.000 phần tử, sâu > 32),
// W_SVG_HEAVY (>= 1 MiB hoặc >= 10.000 phần tử), W_BIND_ELEMENT_KIND, W_BIND_CLIP_EXISTS.
// `W_UID_NOT_IN_SVG` cho sự kiện nằm sẵn ở rules-03.ts (mọi `elementUid` khai ở item, kể cả phần tử chỉ có `events`).
import { MAX_USE_EXPANSION, countEffective, sanitizeSvg, useLimitProblem } from '@mat/svg-renderer';
import type { Issue, WarningCode } from './codes.ts';
import { MAX_SVG_BYTES } from './codes.ts';
import type { BindingSet04 } from './types-04.ts';

export const SVG_LIMITS_04 = {
  bytes: MAX_SVG_BYTES,
  elements: 20_000,
  depth: 32,
  /** Phần tử hiệu dụng sau mở `use` (contract svg-import §10). */
  useExpansion: MAX_USE_EXPANSION,
  heavyBytes: 1024 * 1024,
  heavyElements: 10_000,
} as const;

export interface SvgRuleItem {
  /** File SVG của item (đường dẫn trong project) và nội dung (đã bỏ BOM). */
  svgFile: string;
  svgText: string;
  /** File binding và nội dung đã qua schema (nếu có). */
  bindingFile: string;
  bindings?: BindingSet04;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function hasStroke(el: Element): boolean {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const attr = cur.getAttribute('stroke');
    if (attr !== null) return attr.trim() !== '' && attr.trim().toLowerCase() !== 'none';
    const m = /(?:^|;)\s*stroke\s*:\s*([^;]*)/i.exec(cur.getAttribute('style') ?? '');
    if (m) return m[1].trim() !== '' && m[1].trim().toLowerCase() !== 'none';
  }
  return false;
}

/** E_SVG_LIMIT cho file SVG mà nguồn từ chối đọc vì quá 5 MiB. */
export function svgTooLargeIssue(svgFile: string): Issue {
  return {
    code: 'E_SVG_LIMIT',
    file: svgFile,
    path: '',
    message: `SVG '${svgFile}' lớn hơn 5 MiB`,
  };
}

/** Luật nội dung SVG cho một item `svg`. */
export function svgContentRules(item: SvgRuleItem): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (path: string, message: string, file = item.svgFile) =>
    errors.push({ code: 'E_SVG_LIMIT', file, path, message });
  const warn = (code: WarningCode, file: string, path: string, message: string) =>
    warnings.push({ code, file, path, message });

  const bytes = new TextEncoder().encode(item.svgText).length;
  if (bytes > SVG_LIMITS_04.bytes) {
    err('', `SVG '${item.svgFile}' lớn hơn ${SVG_LIMITS_04.bytes} byte (5 MiB)`);
    return { errors, warnings };
  }
  let heavy = bytes >= SVG_LIMITS_04.heavyBytes;

  let root: Element;
  try {
    const doc = new DOMParser().parseFromString(item.svgText, 'image/svg+xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return { errors, warnings };
    root = doc.documentElement;
  } catch {
    return { errors, warnings }; // SVG hỏng: trình hiển thị sẽ báo
  }

  // đếm phần tử và độ sâu (không đệ quy)
  let count = 0;
  let maxDepth = 0;
  const byUid = new Map<string, Element>();
  const stack: Array<[Element, number]> = [[root, 1]];
  while (stack.length > 0) {
    const [el, d] = stack.pop()!;
    count++;
    if (d > maxDepth) maxDepth = d;
    const uid = el.getAttribute('data-mat-uid');
    if (uid !== null && !byUid.has(uid)) byUid.set(uid, el);
    const kids = el.children;
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], d + 1]);
  }
  let limited = false;
  if (count > SVG_LIMITS_04.elements) {
    err('', `SVG '${item.svgFile}' có ${count} phần tử, vượt ${SVG_LIMITS_04.elements}`);
    limited = true;
  }
  if (maxDepth > SVG_LIMITS_04.depth) {
    err('', `SVG '${item.svgFile}' sâu ${maxDepth} cấp, vượt ${SVG_LIMITS_04.depth}`);
    limited = true;
  }
  if (count >= SVG_LIMITS_04.heavyElements) heavy = true;
  if (heavy && !limited)
    warn(
      'W_SVG_HEAVY',
      item.svgFile,
      '',
      `SVG '${item.svgFile}' nặng (${(bytes / 1048576).toFixed(2)} MiB, ${count} phần tử): tải và vẽ chậm trên máy yếu`,
    );

  // allowlist: chạy trên bản sao; còn gì bị loại là E_SVG_UNSAFE
  if (!limited) {
    try {
      const clone = root.cloneNode(true) as unknown as SVGSVGElement;
      const r = sanitizeSvg(clone);
      // bom `use` (T112): phần tử hiệu dụng, công việc của mọi use (kể cả trong defs) và độ sâu chuỗi use, sau lọc
      const useProblem = useLimitProblem(countEffective(clone, SVG_LIMITS_04.useExpansion));
      if (useProblem !== null) err('', `SVG '${item.svgFile}' có bom use: ${useProblem}`);
      const names = Object.keys(r.removedElements);
      if (
        root.namespaceURI !== SVG_NS ||
        root.localName !== 'svg' ||
        names.length > 0 ||
        r.removedAttributes > 0 ||
        r.removedDataAttributes > 0 ||
        r.unwrapped > 0 ||
        Object.keys(r.codes).length > 0
      ) {
        const why = [
          ...names.slice(0, 5),
          ...(r.removedAttributes ? [`${r.removedAttributes} thuộc tính`] : []),
          ...Object.keys(r.codes).slice(0, 5),
        ].join(', ');
        errors.push({
          code: 'E_SVG_UNSAFE',
          file: item.svgFile,
          path: '',
          message: `SVG '${item.svgFile}' còn phần ngoài allowlist (${why}); nhập lại bằng Studio`,
        });
      }
    } catch (e) {
      errors.push({
        code: 'E_SVG_UNSAFE',
        file: item.svgFile,
        path: '',
        message: `SVG '${item.svgFile}' không qua bộ lọc: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`,
      });
    }
  }

  // loại phần tử và clip-path theo đích của binding
  item.bindings?.elements.forEach((e, i) => {
    const el = byUid.get(e.elementUid);
    if (!el) return;
    const tag = el.localName;
    e.bindings?.forEach((b, j) => {
      const p = `/elements/${i}/bindings/${j}/target`;
      if (b.target === 'text.content' && tag !== 'text' && tag !== 'tspan')
        warn(
          'W_BIND_ELEMENT_KIND',
          item.bindingFile,
          p,
          `text.content cần phần tử text, gặp <${tag}>`,
        );
      else if (b.target === 'geometry.levelPercent' && tag !== 'rect')
        warn(
          'W_BIND_ELEMENT_KIND',
          item.bindingFile,
          p,
          `geometry.levelPercent cần rect, gặp <${tag}>`,
        );
      else if (b.target === 'effect.flow' && !hasStroke(el))
        warn(
          'W_BIND_ELEMENT_KIND',
          item.bindingFile,
          p,
          `effect.flow cần phần tử có nét (stroke), <${tag}> không có`,
        );
      else if (b.target === 'geometry.clipLevel' && el.hasAttribute('clip-path'))
        warn(
          'W_BIND_CLIP_EXISTS',
          item.bindingFile,
          p,
          `<${tag}> đã có clip-path gốc; clipLevel sẽ chồng lên`,
        );
    });
  });
  return { errors, warnings };
}
