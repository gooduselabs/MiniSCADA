// Đọc cây phần tử SVG đã dựng (feature 008, T070/T071; contract studio-svg-editor §10).
import { describe, expect, it } from 'vitest';
import {
  FILTER_LIMIT,
  elementKindOf,
  filterTree,
  findByUid,
  flattenTree,
  isSafeUid,
  uidAncestors,
  uidChildren,
} from './svg-dom.ts';

const NS = 'http://www.w3.org/2000/svg';
function parse(inner: string): Element {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${NS}" viewBox="0 0 10 10">${inner}</svg>`,
    'image/svg+xml',
  );
  return doc.documentElement;
}

const SAMPLE = `
<g data-mat-uid="el_tank" data-mat-name="Bồn nước">
  <rect data-mat-uid="el_liquid" data-mat-name="Nước"/>
  <g><text data-mat-uid="el_value">0</text></g>
</g>
<path data-mat-uid="el_pipe" d="M0 0 L5 5" stroke="#000" fill="none"/>
<circle data-mat-uid="el_lamp" r="2"/>`;

describe('loại phần tử', () => {
  const svg = parse(SAMPLE);
  const kind = (uid: string) => elementKindOf(findByUid(svg, uid)!);
  it('theo thẻ; path chỉ có nét là đường', () => {
    expect(kind('el_tank')).toBe('group');
    expect(kind('el_liquid')).toBe('rect');
    expect(kind('el_value')).toBe('text');
    expect(kind('el_pipe')).toBe('line');
    expect(kind('el_lamp')).toBe('shape');
  });
  it('path có nền là hình', () => {
    const s = parse('<path data-mat-uid="el_a" d="M0 0" fill="#f00" stroke="#000"/>');
    expect(elementKindOf(findByUid(s, 'el_a')!)).toBe('shape');
  });
});

describe('tìm theo UID', () => {
  it('chỉ nhận UID an toàn (không dựng bộ chọn từ chuỗi lạ)', () => {
    const svg = parse(SAMPLE);
    expect(findByUid(svg, 'el_lamp')?.localName).toBe('circle');
    expect(findByUid(svg, 'el_none')).toBeNull();
    expect(isSafeUid('el_a-1')).toBe(true);
    expect(isSafeUid('x"] , [a="')).toBe(false);
    expect(findByUid(svg, 'x"],svg[a="')).toBeNull();
  });
});

describe('cây phần tử', () => {
  it('cấp trên cùng; thẻ trung gian không UID được bỏ qua', () => {
    const svg = parse(SAMPLE);
    expect(uidChildren(svg).map((e) => e.getAttribute('data-mat-uid'))).toEqual([
      'el_tank',
      'el_pipe',
      'el_lamp',
    ]);
    const tank = findByUid(svg, 'el_tank')!;
    expect(uidChildren(tank).map((e) => e.getAttribute('data-mat-uid'))).toEqual([
      'el_liquid',
      'el_value',
    ]);
  });

  it('dựng lười: nút đóng không bung con; mở thì có con theo thứ tự tài liệu', () => {
    const svg = parse(SAMPLE);
    const closed = flattenTree(svg, new Set());
    expect(closed.map((r) => r.uid)).toEqual(['el_tank', 'el_pipe', 'el_lamp']);
    expect(closed[0]).toMatchObject({ hasChildren: true, expanded: false, name: 'Bồn nước' });
    expect(closed[1]).toMatchObject({ hasChildren: false });
    const open = flattenTree(svg, new Set(['el_tank']));
    expect(open.map((r) => `${r.depth}:${r.uid}`)).toEqual([
      '0:el_tank',
      '1:el_liquid',
      '1:el_value',
      '0:el_pipe',
      '0:el_lamp',
    ]);
  });

  it('tổ tiên có UID của một phần tử (mở cây tới phần tử được chọn)', () => {
    const svg = parse(SAMPLE);
    expect(uidAncestors(findByUid(svg, 'el_value')!, svg)).toEqual(['el_tank']);
    expect(uidAncestors(findByUid(svg, 'el_tank')!, svg)).toEqual([]);
  });

  it('cây sâu 600 cấp không tràn ngăn xếp', () => {
    let inner = '<rect data-mat-uid="el_leaf"/>';
    for (let i = 0; i < 600; i++) inner = `<g data-mat-uid="g${i}">${inner}</g>`;
    const svg = parse(inner);
    const rows = flattenTree(svg, new Set(['g599']));
    expect(rows.length).toBe(2);
    expect(findByUid(svg, 'el_leaf')).not.toBeNull();
  });
});

describe('lọc', () => {
  it('theo tên không dấu, thẻ hoặc UID', () => {
    const svg = parse(SAMPLE);
    expect(filterTree(svg, 'bon nuoc').rows.map((r) => r.uid)).toEqual(['el_tank']);
    expect(filterTree(svg, 'circle').rows.map((r) => r.uid)).toEqual(['el_lamp']);
    expect(filterTree(svg, 'EL_VAL').rows.map((r) => r.uid)).toEqual(['el_value']);
    expect(filterTree(svg, 'khong co').total).toBe(0);
  });

  it('kết quả bị chặn ở giới hạn nhưng báo đủ tổng số', () => {
    let inner = '';
    for (let i = 0; i < FILTER_LIMIT + 50; i++) inner += `<rect data-mat-uid="el_${i}"/>`;
    const r = filterTree(parse(inner), 'rect');
    expect(r.rows.length).toBe(FILTER_LIMIT);
    expect(r.total).toBe(FILTER_LIMIT + 50);
  });
});
