// BẢN ĐÓNG BĂNG của `sanitizeSvg` kiểu denylist (packages/svg-renderer/src/sanitize.ts ở commit 34bfe16,
// trước feature 008 T022). CHỈ dùng cho tools/svg-import/regress-sprint0.mjs để so ảnh với bản allowlist;
// KHÔNG được import từ bất kỳ package nào và KHÔNG sửa (đây là mốc so sánh). Đã bỏ kiểu TypeScript, giữ
// nguyên logic.

export const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_KEEP_DATA = ['data-mat-uid'];

const NS_LABELS = {
  'http://www.w3.org/1999/xhtml': 'xhtml',
  'http://www.inkscape.org/namespaces/inkscape': 'inkscape',
  'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd': 'sodipodi',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://creativecommons.org/ns#': 'cc',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://ns.adobe.com/AdobeIllustrator/10.0/': 'adobe-ai',
  'http://www.corel.com/coreldraw/odm/2003': 'corel',
};

export function namespaceLabel(uri) {
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

function isSafeHref(value) {
  const v = value.trim();
  return v.startsWith('#') || SAFE_DATA_IMAGE.test(v);
}

function cssUnescape(css) {
  return css
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
    })
    .replace(/\\(.)/g, '$1');
}

function cssHasExternalRef(css) {
  const text = cssUnescape(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  if (/@import|image-set\s*\(/i.test(text)) return true;
  for (const m of text.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!m[2].trim().startsWith('#')) return true;
  }
  return false;
}

function hrefOf(el) {
  return Array.from(el.attributes).find((a) => a.localName.toLowerCase() === 'href')?.value ?? '';
}

function stripAttributes(el, report, keepData) {
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

function measureDepth(root) {
  let max = 0;
  const stack = [[root, 1]];
  while (stack.length) {
    const [el, d] = stack.pop();
    if (d > max) max = d;
    for (const child of Array.from(el.children)) stack.push([child, d + 1]);
  }
  return max;
}

export function legacySanitizeSvg(root, opts = {}) {
  const keepData = new Set(
    (opts.keepDataAttributes ?? DEFAULT_KEEP_DATA).map((a) => a.toLowerCase()),
  );
  const report = {
    removedElements: {},
    removedAttributes: 0,
    removedDataAttributes: 0,
    elementCount: 0,
    maxDepth: 0,
  };
  const count = (name) => {
    report.removedElements[name] = (report.removedElements[name] ?? 0) + 1;
  };

  stripAttributes(root, report, keepData);
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!root.contains(el)) continue;
    const name = el.localName.toLowerCase();
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
