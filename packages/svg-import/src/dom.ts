// Cấp DOMParser: trình duyệt dùng `window.DOMParser`; Node (CLI, test) gán `globalThis.DOMParser` từ jsdom
// trước khi gọi importSvg (như tools/svg-inspect). Module này không import jsdom để không vào gói trang.
import { SVG_NS } from '@mat/svg-renderer';

export type ParseXmlResult =
  | { ok: true; doc: Document; root: Element }
  | { ok: false; code: 'E_IMPORT_PARSE' | 'E_IMPORT_ROOT'; message: string };

export function getDomParser(): DOMParser {
  const Ctor = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Ctor)
    throw new Error('Không có DOMParser: trong Node hãy gán globalThis.DOMParser từ jsdom');
  return new Ctor();
}

export function parseXml(text: string): ParseXmlResult {
  let doc: Document;
  try {
    doc = getDomParser().parseFromString(text, 'image/svg+xml');
  } catch (e) {
    return {
      ok: false,
      code: 'E_IMPORT_PARSE',
      message: 'XML không hợp lệ: ' + String((e as Error).message).slice(0, 200),
    };
  }
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) {
    return {
      ok: false,
      code: 'E_IMPORT_PARSE',
      message: 'XML không hợp lệ: ' + (err.textContent ?? '').slice(0, 200),
    };
  }
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    return {
      ok: false,
      code: 'E_IMPORT_ROOT',
      message: 'Phần tử gốc phải là <svg> thuộc namespace SVG',
    };
  }
  return { ok: true, doc, root };
}
