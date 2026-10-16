// Feature 011 (T211, T212, T216, T217): các mục Low F7, F8, F12, F13 của docs/reports/008-security-review.md.
// Viết trước, phải đỏ.
import { describe, expect, it } from 'vitest';
import { isName, parseDataImage } from './css-value.ts';
import { namespaceLabel, parseSvg, sanitizeSvg } from './sanitize.ts';

const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');
const u32be = (n: number): number[] => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const u16le = (n: number): number[] => [n & 255, (n >>> 8) & 255];
const u24le = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

/** Đầu PNG: chữ ký + IHDR (xám 8 bit) + 4 byte CRC giả + phần đệm. */
const png = (w: number, h: number): string =>
  b64([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32be(13),
    ...ascii('IHDR'),
    ...u32be(w),
    ...u32be(h),
    8,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
const gif = (w: number, h: number): string =>
  b64([...ascii('GIF89a'), ...u16le(w), ...u16le(h), 0, 0, 0, 0]);
const riff = (chunk: number[]): number[] => [
  ...ascii('RIFF'),
  ...u32be(0),
  ...ascii('WEBP'),
  ...chunk,
];
const webpX = (w: number, h: number): string =>
  b64(riff([...ascii('VP8X'), 10, 0, 0, 0, 0, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1), 0, 0]));
const webpLossy = (w: number, h: number): string =>
  b64(riff([...ascii('VP8 '), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h)]));
const webpLossless = (w: number, h: number): string => {
  const bits = (w - 1) | ((h - 1) << 14);
  return b64(riff([...ascii('VP8L'), 0, 0, 0, 0, 0x2f, ...u24le(bits & 0xffffff), bits >>> 24, 0]));
};
/** JPEG: SOI, APP0 dài `app` byte, SOF0 với kích thước, EOI. */
const jpeg = (w: number, h: number, app = 16): string => {
  const appBody = new Array<number>(app - 2).fill(0);
  return b64([
    0xff,
    0xd8,
    0xff,
    0xe0,
    (app >> 8) & 255,
    app & 255,
    ...appBody,
    0xff,
    0xc0,
    0,
    17,
    8,
    (h >> 8) & 255,
    h & 255,
    (w >> 8) & 255,
    w & 255,
    3,
    ...new Array<number>(9).fill(0),
    0xff,
    0xd9,
  ]);
};
const uri = (mime: string, data: string): string => `data:image/${mime};base64,${data}`;

describe('F7 (T211): parseDataImage từ chối ảnh > 16 triệu điểm ảnh', () => {
  it.each([
    ['png', png(20000, 20000), false], // PNG 20.000² xám của báo cáo
    ['png', png(4000, 4000), true], // đúng 16 triệu
    ['png', png(4001, 4000), false],
    ['png', png(1, 16_000_001), false],
    ['png', png(0x7fffffff, 1), false],
    ['gif', gif(65535, 65535), false],
    ['gif', gif(4000, 4000), true],
    ['webp', webpX(16384, 16384), false],
    ['webp', webpX(4000, 4000), true],
    ['webp', webpLossy(16383, 16383), false],
    ['webp', webpLossy(640, 480), true],
    ['webp', webpLossless(16384, 16384), false],
    ['webp', webpLossless(640, 480), true],
    ['jpeg', jpeg(65535, 65535), false],
    ['jpeg', jpeg(4000, 4000), true],
    ['jpeg', jpeg(20000, 20000, 60000), false], // SOF sau APP0 dài
  ])('%s %#', (mime, data, ok) => {
    expect(parseDataImage(uri(mime, data)) !== null).toBe(ok);
  });

  it('JPEG có SOF nằm ngoài phần đầu đọc được bị từ chối (không lách bằng APP dài)', () => {
    // nhiều APP 64 KiB nối nhau đẩy SOF ra quá 256 KiB đầu
    const seg = [0xff, 0xe1, 0xff, 0xff, ...new Array<number>(0xfffd).fill(0)];
    const bytes = [0xff, 0xd8];
    for (let i = 0; i < 5; i++) bytes.push(...seg);
    bytes.push(0xff, 0xc0, 0, 17, 8, 0x4e, 0x20, 0x4e, 0x20, 3, ...new Array<number>(9).fill(0));
    bytes.push(0xff, 0xd9);
    expect(parseDataImage(uri('jpeg', b64(bytes)))).toBeNull();
  });

  it('bộ lọc bỏ <image> 20.000² với mã R_IMAGE_BAD', () => {
    const svg = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><image href="${uri('png', png(20000, 20000))}" width="10" height="10"/></svg>`,
    );
    const r = sanitizeSvg(svg);
    expect(svg.querySelector('image')).toBeNull();
    expect(r.codes.R_IMAGE_BAD).toBe(1);
  });
});

describe('F8 (T212): khóa removedElements không đụng prototype', () => {
  it('<__proto__/>, <constructor/>, <toString/> được đếm như tên thường', () => {
    const svg = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><__proto__/><constructor/><constructor/><toString/><hasOwnProperty/></svg>',
    );
    const r = sanitizeSvg(svg);
    expect(Object.keys(r.removedElements).sort()).toEqual([
      '__proto__',
      'constructor',
      'hasownproperty',
      'tostring',
    ]);
    expect(r.removedElements['__proto__']).toBe(1);
    expect(r.removedElements['constructor']).toBe(2);
    expect(r.removedElements['tostring']).toBe(1);
    expect(r.codes.R_ELEMENT_NOT_ALLOWED).toBe(5);
    expect(JSON.parse(JSON.stringify(r.removedElements))).toEqual({
      ['__proto__']: 1,
      constructor: 2,
      tostring: 1,
      hasownproperty: 1,
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('namespace có URI trùng tên thuộc tính Object vẫn ra nhãn chuỗi', () => {
    expect(namespaceLabel('__proto__')).toBe('ns(__proto__)');
    expect(namespaceLabel('constructor')).toBe('ns(constructor)');
    expect(namespaceLabel('toString')).toBe('ns(toString)');
    const svg = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:p="constructor"><p:x/></svg>',
    );
    expect(Object.keys(sanitizeSvg(svg).removedElements)).toEqual(['ns(constructor):x']);
  });
});

describe('F12 (T216): parseSvg từ chối DOCTYPE và ENTITY', () => {
  const body = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
  it.each([
    `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${body}`,
    `<!DOCTYPE svg [<!ATTLIST rect onclick CDATA "window.__pwned='p03b'">]>${body}`,
    `<?xml version="1.0"?>\n<!doctype svg>${body}`,
    `<!DOCTYPE svg [<!ENTITY a "x">]>${body}`,
    // m14: bom entity
    `<!DOCTYPE svg [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg"><text>&b;</text></svg>`,
  ])('%s', (text) => {
    expect(() => parseSvg(text)).toThrow(/DOCTYPE/);
  });

  it('chuỗi "<!DOCTYPE" trong CDATA/chữ không bị từ chối nhầm khi không phải khai báo (m39)', () => {
    const svg = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><text><![CDATA[<!DOCTYPE [x]]></text></svg>',
    );
    expect(svg.querySelector('text')?.textContent).toBe('<!DOCTYPE [x');
  });

  it('SVG thường vẫn parse', () => {
    expect(parseSvg(body).localName).toBe('svg');
  });
});

describe('F13 (T217): isName từ chối ký tự điều khiển hai chiều và ký tự rộng 0', () => {
  it.each([0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069])('U+%s', (c) => {
    expect(isName(`a${String.fromCharCode(c)}b`)).toBe(false);
  });
  it.each([0x200b, 0x200c, 0x200d, 0x200e, 0x200f])('U+%s (rộng 0, dấu hướng)', (c) => {
    expect(isName(`a${String.fromCharCode(c)}b`)).toBe(false);
  });
  it('tên tiếng Việt và ký hiệu thường vẫn hợp lệ', () => {
    expect(isName('Bơm số 2 – trạm Đông')).toBe(true);
    expect(isName('Van ‐ 1')).toBe(true); // U+2010
    expect(isName('a⁰b')).toBe(true);
  });
  it('bộ lọc gỡ data-mat-name chứa U+202E', () => {
    const svg = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect data-mat-name="‮evlis" width="1" height="1"/></svg>',
    );
    const r = sanitizeSvg(svg);
    expect(svg.querySelector('rect')?.hasAttribute('data-mat-name')).toBe(false);
    expect(r.codes.R_VALUE_INVALID).toBe(1);
  });
});
