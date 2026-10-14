// Hàm dùng chung cho test của @mat/svg-import (không vào gói: không khớp mẫu *.test.ts).
import { parseSvg } from '@mat/svg-renderer';

export const NS = 'http://www.w3.org/2000/svg';

/** Bọc phần thân thành tài liệu SVG hợp lệ. */
export function doc(body: string, attrs = 'width="100" height="100" viewBox="0 0 100 100"'): string {
  return `<svg xmlns="${NS}" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;
}

export function parse(text: string): SVGSVGElement {
  return parseSvg(text);
}

export function parseBody(body: string, attrs?: string): SVGSVGElement {
  return parseSvg(doc(body, attrs));
}
