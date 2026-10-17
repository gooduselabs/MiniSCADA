// Rà soát bảo mật lần hai (T202): N-SVG2 (trần tổng điểm ảnh của tài liệu, cùng bộ lọc trang) và mục thông tin
// "lưu làm mất khai báo xmlns:xlink" (tệp ghi ra có `xlink:href` mà không khai báo tiền tố: màn hình không hiển thị).
import { describe, expect, it } from 'vitest';
import { makeSeededUid } from '@mat/svg-import';
import { parseDrawDoc } from './parse.ts';
import { serialize } from './serialize.ts';
import { structuralProblem } from './allow.ts';
import { applyCommand, SetAttr } from './command.ts';
import { isElement, type DrawDoc } from './node.ts';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XL = 'xmlns:xlink="http://www.w3.org/1999/xlink"';

function open(text: string): DrawDoc {
  const r = parseDrawDoc(text, { uid: makeSeededUid(1) });
  if (!r.ok) throw new Error(r.code + ' ' + r.message);
  return r.doc;
}

const u32be = (n: number): number[] => [
  (n >>> 24) & 255,
  (n >>> 16) & 255,
  (n >>> 8) & 255,
  n & 255,
];
const png = (w: number, h: number): string =>
  'data:image/png;base64,' +
  Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32be(13),
    0x49,
    0x48,
    0x44,
    0x52,
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
  ]).toString('base64');

/** XML hợp lệ về namespace: jsdom báo lỗi bằng <parsererror>. */
function wellFormed(text: string): boolean {
  const d = new DOMParser().parseFromString(text, 'image/svg+xml');
  return d.getElementsByTagName('parsererror').length === 0;
}

describe('N-SVG2: tổng điểm ảnh ≤ 32 triệu', () => {
  const img = `<image href="${png(4000, 3000)}" width="10" height="10"/>`;

  it('khi đọc: ảnh thứ ba (tổng 36 triệu) bị loại với R_IMAGE_LIMIT', () => {
    const r = parseDrawDoc(`<svg ${NS}>${img}${img}${img}</svg>`, { uid: makeSeededUid(1) });
    if (!r.ok) throw new Error(r.message);
    const images = [...r.doc.nodes.values()].filter((n) => n.tag === 'image');
    expect(images.length).toBe(2);
    expect(JSON.stringify(r.report)).toContain('R_IMAGE_LIMIT');
  });

  it('structuralProblem (trước mỗi lệnh) từ chối tổng vượt trần', () => {
    const doc = open(
      `<svg ${NS}>${img}${img}<image href="${png(10, 10)}" width="1" height="1"/></svg>`,
    );
    expect(structuralProblem(doc)).toBeNull();
    const small = [...doc.nodes.values()].find((n) => n.attrs.get('href') === png(10, 10))!;
    small.attrs.set('href', png(4000, 3000));
    expect(structuralProblem(doc)).toBe('vượt giới hạn ảnh');
  });
});

describe('lưu giữ khai báo xmlns:xlink khi còn xlink:href', () => {
  it('xmlns:xlink khai ở phần tử con (bị bỏ khi đọc): gốc được khai báo khi ghi', () => {
    const text = `<svg ${NS}><defs><rect id="a" width="1" height="1"/></defs><g ${XL}><use xlink:href="#a"/></g></svg>`;
    const out = serialize(open(text));
    expect(out).toContain('xlink:href="#a"');
    expect(wellFormed(out)).toBe(true);
    // lưu lần hai ổn định
    expect(serialize(open(out))).toBe(out);
  });

  it('lệnh đặt xlink:href trên tài liệu chưa khai báo xlink', () => {
    const doc = open(
      `<svg ${NS}><defs><rect id="a" width="1" height="1"/></defs><use href="#a"/></svg>`,
    );
    const use = [...doc.nodes.values()].find((n) => isElement(n) && n.tag === 'use')!;
    applyCommand(doc, new SetAttr(use.id, 'href', null));
    applyCommand(doc, new SetAttr(use.id, 'xlink:href', '#a'));
    const out = serialize(doc);
    expect(out).toContain('xlink:href="#a"');
    expect(wellFormed(out)).toBe(true);
  });

  it('tài liệu không có xlink: không thêm khai báo', () => {
    const text = `<svg ${NS}><rect width="1" height="1"/></svg>`;
    expect(serialize(open(text))).toBe(text);
  });
});
