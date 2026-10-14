// T042: test Tối ưu (research R5; spike T007). Viết TRƯỚC, phải đỏ.
import { isPathData } from '@mat/svg-renderer';
import { describe, expect, it } from 'vitest';
import { optimizeSvg } from './optimize.ts';
import { parseBody } from './test-helpers.ts';

const line = (x: number, extra = '') => `<line x1="${x}" y1="0" x2="${x + 1}" y2="1" stroke="#000" ${extra}/>`;

describe('optimizeSvg: gộp', () => {
  it('gộp các line liền kề cùng thuộc tính thành một path hợp lệ', () => {
    const root = parseBody(line(0) + line(2) + line(4));
    const res = optimizeSvg(root);
    expect(res).toMatchObject({ merged: 1, elementsSaved: 2 });
    const paths = root.querySelectorAll('path');
    expect(paths).toHaveLength(1);
    expect(root.querySelectorAll('line')).toHaveLength(0);
    const d = paths[0].getAttribute('d')!;
    expect(isPathData(d)).toBe(true);
    expect(d).toBe('M0 0L1 1M2 0L3 1M4 0L5 1');
    expect(paths[0].getAttribute('stroke')).toBe('#000');
  });
  it('polyline, polygon, path nối thành một d; polygon đóng bằng Z; m đầu thành M', () => {
    const root = parseBody(
      '<polyline points="0,0 1,1 2,0" fill="none" stroke="#000"/><polygon points="5,5 6,5 6,6" fill="none" stroke="#000"/><path d="m 9 9 l 1 1" fill="none" stroke="#000"/>',
    );
    optimizeSvg(root);
    const d = root.querySelector('path')!.getAttribute('d')!;
    expect(d).toBe('M0 0L1 1L2 0M5 5L6 5L6 6ZM 9 9 l 1 1');
    expect(isPathData(d)).toBe(true);
  });
  it('giữ thứ tự vẽ: phần tử khác loại chen giữa chặn gộp', () => {
    const root = parseBody(line(0) + line(2) + '<rect width="1" height="1"/>' + line(4) + line(6));
    const res = optimizeSvg(root);
    expect(res.merged).toBe(2);
    expect(Array.from(root.children).map((e) => e.localName)).toEqual(['path', 'rect', 'path']);
  });
  it('thuộc tính trình bày hoặc transform khác nhau: không gộp', () => {
    const a = parseBody(line(0) + '<line x1="2" y1="0" x2="3" y2="1" stroke="#f00"/>');
    expect(optimizeSvg(a).merged).toBe(0);
    const b = parseBody(line(0, 'transform="translate(1 1)"') + line(2, 'transform="translate(2 2)"'));
    expect(optimizeSvg(b).merged).toBe(0);
    const c = parseBody(line(0, 'transform="translate(1 1)"') + line(2, 'transform="translate(1 1)"'));
    expect(optimizeSvg(c).merged).toBe(1);
  });
  it('độ mờ < 1, filter, mask, marker: không gộp', () => {
    for (const extra of ['opacity="0.5"', 'stroke-opacity="0.5"', 'filter="url(#f)"', 'mask="url(#m)"', 'marker-end="url(#k)"']) {
      const root = parseBody(
        '<defs><filter id="f"/><mask id="m"/><marker id="k"/></defs>' + line(0, extra) + line(2, extra),
      );
      expect(optimizeSvg(root).merged, extra).toBe(0);
    }
  });
  it('id có nghĩa hoặc bị tham chiếu hoặc data-*: không gộp; id tự sinh không bị tham chiếu: gộp', () => {
    expect(optimizeSvg(parseBody(line(0, 'id="valve_1"') + line(2))).merged).toBe(0);
    expect(optimizeSvg(parseBody(line(0, 'data-x="1"') + line(2))).merged).toBe(0);
    expect(optimizeSvg(parseBody(line(0, 'id="line12"') + line(2, 'id="line13"'))).merged).toBe(1);
    const ref = parseBody(line(0, 'id="line12"') + line(2) + '<use href="#line12"/>');
    expect(optimizeSvg(ref).merged).toBe(0);
  });
  it('không gộp phần tử vừa có nền vừa có nét (kể cả kế thừa từ nhóm)', () => {
    const a = parseBody(
      '<polygon points="0,0 1,0 1,1" fill="#f00" stroke="#000"/><polygon points="3,0 4,0 4,1" fill="#f00" stroke="#000"/>',
    );
    expect(optimizeSvg(a).merged).toBe(0);
    const b = parseBody(
      '<g fill="none"><polygon points="0,0 1,0 1,1" stroke="#000"/><polygon points="3,0 4,0 4,1" stroke="#000"/></g>',
    );
    expect(optimizeSvg(b).merged).toBe(1);
  });
  it('không gộp một phần tử đơn; không đi vào defs, clipPath, mask, pattern, marker', () => {
    const root = parseBody('<defs><clipPath id="c">' + line(0) + line(2) + '</clipPath></defs>' + line(5));
    expect(optimizeSvg(root).merged).toBe(0);
    expect(root.querySelectorAll('clipPath line')).toHaveLength(2);
  });
});
