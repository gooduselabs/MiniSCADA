// T040: test tên phần tử (contract §5). Viết TRƯỚC, phải đỏ.
import { describe, expect, it } from 'vitest';
import { cleanName, decodeIdEscapes, deriveName, isMeaninglessId } from './name.ts';

describe('isMeaninglessId', () => {
  it('id tự sinh là không nghĩa', () => {
    for (const id of [
      'path1234',
      'rect12',
      'g5',
      'circle1',
      'ellipse2',
      'line3',
      'polygon4',
      'polyline5',
      'text6',
      'use7',
      'image8',
      'tspan9',
      'SVGID_1_',
      'SVGID_12_',
      'Layer_1',
      'Layer_12',
      '_0_',
      '_12',
      '12345',
      'path1234-5',
    ])
      expect(isMeaninglessId(id), id).toBe(true);
  });
  it('id đặt tay là có nghĩa', () => {
    for (const id of ['tank_01', 'Bom1', 'pump', 'path', 'rect_a', 'Layer_main', 'g5x', 'SVGID_x_'])
      expect(isMeaninglessId(id), id).toBe(false);
  });
  it('id chỉ gồm _x0020_ (giải thành trắng) là không nghĩa', () => {
    expect(isMeaninglessId('_x0020_')).toBe(true);
  });
});

describe('decodeIdEscapes', () => {
  it('_x0020_ thành khoảng trắng, _x002F_ thành /', () => {
    expect(decodeIdEscapes('Text_x0020_T101')).toBe('Text T101');
    expect(decodeIdEscapes('a_x002F_b')).toBe('a/b');
    expect(decodeIdEscapes('plain')).toBe('plain');
  });
});

describe('cleanName', () => {
  it('bỏ ký tự điều khiển, cắt 80 ký tự, cắt khoảng trắng hai đầu', () => {
    expect(cleanName('  a\u0001b\u0007c  ')).toBe('abc');
    expect(cleanName('x'.repeat(100))).toHaveLength(80);
    expect(cleanName('   ')).toBe('');
  });
});

describe('deriveName', () => {
  const base = { tag: 'rect', index: 3 };
  it('ưu tiên inkscape:label, rồi data-name, rồi id có nghĩa, rồi "<thẻ> <số>"', () => {
    expect(deriveName({ ...base, label: 'Nhãn', dataName: 'DN', id: 'tank' })).toEqual({ name: 'Nhãn', labelled: true });
    expect(deriveName({ ...base, dataName: 'DN', id: 'tank' })).toEqual({ name: 'DN', labelled: true });
    expect(deriveName({ ...base, id: 'tank_01' })).toEqual({ name: 'tank_01', labelled: true });
    expect(deriveName({ ...base, id: 'rect123' })).toEqual({ name: 'rect 3', labelled: false });
    expect(deriveName(base)).toEqual({ name: 'rect 3', labelled: false });
  });
  it('nhãn rỗng thì rơi xuống mức sau', () => {
    expect(deriveName({ ...base, label: '  ', id: 'pump' })).toEqual({ name: 'pump', labelled: true });
  });
  it('giải _x0020_ trong id có nghĩa; cắt 80 ký tự', () => {
    expect(deriveName({ ...base, id: 'Text_x0020_T101' }).name).toBe('Text T101');
    expect(deriveName({ ...base, label: 'y'.repeat(120) }).name).toHaveLength(80);
  });
  it('id chỉ là _x0020_: rơi về "<thẻ> <số>"', () => {
    expect(deriveName({ ...base, id: '_x0020_' })).toEqual({ name: 'rect 3', labelled: false });
  });
});
