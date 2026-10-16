// T152 (SC-031): hộp bao trong hệ tài liệu. Sai số ≤ 0,001; văn bản là ước tính (ghi rõ dưới).
import { describe, expect, it } from 'vitest';
import { bbox, unionBoxes } from './bbox.ts';
import { body, byId, expectBox } from './test-helpers.ts';

const one = (inner: string, id = 'x', opts?: Parameters<typeof bbox>[2]) => {
  const doc = body(inner);
  return bbox(doc, byId(doc, id), opts);
};

describe('hình cơ bản', () => {
  it.each<[string, string, [number, number, number, number]]>([
    ['rect', '<rect id="x" x="10" y="20" width="30" height="40"/>', [10, 20, 30, 40]],
    ['rect thiếu x, y', '<rect id="x" width="5" height="6"/>', [0, 0, 5, 6]],
    ['rect đơn vị px', '<rect id="x" x="10px" y="0" width="5px" height="6"/>', [10, 0, 5, 6]],
    ['circle', '<circle id="x" cx="50" cy="50" r="10"/>', [40, 40, 20, 20]],
    ['ellipse', '<ellipse id="x" cx="50" cy="50" rx="20" ry="5"/>', [30, 45, 40, 10]],
    ['line', '<line id="x" x1="10" y1="50" x2="0" y2="20"/>', [0, 20, 10, 30]],
    ['polyline', '<polyline id="x" points="0,0 10,5 3,20"/>', [0, 0, 10, 20]],
    ['polygon', '<polygon id="x" points="5 5 15 5 10 -5"/>', [5, -5, 10, 10]],
    ['path đường thẳng', '<path id="x" d="M10 10 L20 30 H5 V0 Z"/>', [5, 0, 15, 30]],
    ['path tương đối', '<path id="x" d="m10 10 l10 0 v10 h-10 z"/>', [10, 10, 10, 10]],
    ['path bậc ba (cực trị)', '<path id="x" d="M0 0 C0 10 10 10 10 0"/>', [0, 0, 10, 7.5]],
    ['path bậc hai', '<path id="x" d="M0 0 Q5 10 10 0"/>', [0, 0, 10, 5]],
    ['path S nối', '<path id="x" d="M0 0 C0 10 10 10 10 0 S20 -10 20 0"/>', [0, -7.5, 20, 15]],
    ['path T nối', '<path id="x" d="M0 0 Q5 10 10 0 T20 0"/>', [0, -5, 20, 10]],
    ['path cung nửa tròn', '<path id="x" d="M0 0 A5 5 0 0 1 10 0"/>', [0, -5, 10, 5]],
    ['path cung nửa tròn chiều kia', '<path id="x" d="M0 0 A5 5 0 0 0 10 0"/>', [0, 0, 10, 5]],
    [
      'path cung bán kính quá nhỏ (phóng to)',
      '<path id="x" d="M0 0 A1 1 0 0 1 10 0"/>',
      [0, -5, 10, 5],
    ],
    ['path cung elip xoay', '<path id="x" d="M-10 0 A10 5 90 1 1 10 0"/>', [-10, -20, 20, 20]],
    [
      'image',
      '<image id="x" x="1" y="2" width="3" height="4" href="data:image/png;base64,iVBORw0KGgo="/>',
      [1, 2, 3, 4],
    ],
  ])('%s', (_l, inner, [x, y, w, h]) => expectBox(expect, one(inner), x, y, w, h));
});

describe('transform và lồng nhau', () => {
  it.each<[string, string, [number, number, number, number]]>([
    ['dịch', '<rect id="x" width="10" height="10" transform="translate(5 6)"/>', [5, 6, 10, 10]],
    [
      'co không đều',
      '<rect id="x" width="10" height="10" transform="scale(2 3)"/>',
      [0, 0, 20, 30],
    ],
    [
      'xoay 45 quanh tâm',
      '<rect id="x" x="-5" y="-5" width="10" height="10" transform="rotate(45)"/>',
      [-7.0711, -7.0711, 14.1421, 14.1421],
    ],
    [
      'ellipse xoay 90 (chính xác)',
      '<ellipse id="x" cx="0" cy="0" rx="20" ry="5" transform="rotate(90)"/>',
      [-5, -20, 10, 40],
    ],
    ['circle co không đều', '<circle id="x" r="1" transform="scale(4 2)"/>', [-4, -2, 8, 4]],
    [
      'ellipse xoay 30 (chính xác, không phải hộp xoay)',
      '<ellipse id="x" rx="2" ry="1" transform="rotate(30)"/>',
      [-1.8028, -1.3229, 3.6056, 2.6458],
    ],
    [
      'lồng 3 tầng',
      '<g transform="translate(100 0)"><g transform="rotate(90)"><g transform="scale(2 1)"><rect id="x" width="10" height="5"/></g></g></g>',
      [95, 0, 5, 20],
    ],
    ['nghiêng', '<rect id="x" width="10" height="10" transform="skewX(45)"/>', [0, 0, 20, 10]],
    [
      'cung xoay qua transform',
      '<path id="x" d="M0 0 A5 5 0 0 1 10 0" transform="rotate(90)"/>',
      [0, 0, 5, 10],
    ],
  ])('%s', (_l, inner, [x, y, w, h]) => expectBox(expect, one(inner), x, y, w, h, 3));

  it('nhóm: hợp hộp bao các con, bỏ defs và display=none', () => {
    const b = one(
      '<g id="x" transform="translate(10 10)"><rect width="10" height="10"/><circle cx="30" cy="5" r="5"/>' +
        '<defs><rect width="1000" height="1000"/></defs><rect display="none" width="999" height="999"/></g>',
    );
    expectBox(expect, b, 10, 10, 35, 10);
  });

  it('use: hộp của đích dịch theo x, y', () => {
    const b = one(
      '<defs><rect id="t" width="4" height="2"/></defs><use id="x" href="#t" x="10" y="20"/>',
    );
    expectBox(expect, b, 10, 20, 4, 2);
  });

  it('use symbol có viewBox và width/height: co theo viewBox', () => {
    const b = one(
      '<defs><symbol id="s" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol></defs><use id="x" href="#s" x="5" y="5" width="20" height="20"/>',
    );
    expectBox(expect, b, 5, 5, 20, 20);
  });

  it('svg lồng: hộp x, y, width, height', () => {
    expectBox(
      expect,
      one('<svg id="x" x="3" y="4" width="10" height="20"><rect width="100" height="100"/></svg>'),
      3,
      4,
      10,
      20,
    );
  });

  it('tính nét: nở nửa độ dày nét (có co theo transform)', () => {
    expectBox(
      expect,
      one('<rect id="x" width="10" height="10" stroke="#000" stroke-width="2"/>', 'x', {
        stroke: true,
      }),
      -1,
      -1,
      12,
      12,
    );
    expectBox(
      expect,
      one(
        '<rect id="x" width="10" height="10" stroke="#000" stroke-width="2" transform="scale(2)"/>',
        'x',
        { stroke: true },
      ),
      -2,
      -2,
      24,
      24,
    );
    expectBox(
      expect,
      one('<rect id="x" width="10" height="10" stroke-width="2"/>', 'x', { stroke: true }),
      0,
      0,
      10,
      10,
    );
  });

  it('phần tử không vẽ: null', () => {
    expect(one('<defs id="x"><rect width="1" height="1"/></defs>')).toBeNull();
    expect(one('<g id="x"/>')).toBeNull();
  });

  it('unionBoxes', () => {
    expectBox(
      expect,
      unionBoxes([{ x: 0, y: 0, width: 1, height: 1 }, null, { x: 5, y: -2, width: 1, height: 1 }]),
      0,
      -2,
      6,
      3,
    );
    expect(unionBoxes([])).toBeNull();
  });
});

describe('văn bản: ước tính (không đo được ngoài trình duyệt)', () => {
  // Ước tính: rộng = 0,6 × font-size × số ký tự, cao = font-size, đỉnh = y − 0,8 × font-size. Sai số so với Chrome có
  // thể tới ±30 % chiều rộng tùy phông; giao diện truyền `measure` đo trên canvas.
  it.each<[string, string, [number, number, number, number]]>([
    ['mặc định 16, start', '<text id="x" x="10" y="20">abcd</text>', [10, 7.2, 38.4, 16]],
    [
      'font-size 10, middle',
      '<text id="x" x="50" y="50" font-size="10" text-anchor="middle">ab</text>',
      [44, 42, 12, 10],
    ],
    [
      'font-size kế thừa từ g, end',
      '<g font-size="20"><text id="x" x="100" y="0" text-anchor="end">a</text></g>',
      [88, -16, 12, 20],
    ],
    [
      'font-size trong style',
      '<text id="x" style="font-size:10px" x="0" y="10">abc</text>',
      [0, 2, 18, 10],
    ],
  ])('%s', (_l, inner, [x, y, w, h]) => expectBox(expect, one(inner), x, y, w, h));

  it('measure do giao diện cung cấp được dùng', () => {
    const b = one('<text id="x" x="0" y="10">abc</text>', 'x', {
      measure: () => ({ width: 100, ascent: 8, descent: 2 }),
    });
    expectBox(expect, b, 0, 2, 100, 10);
  });
});
