// Gợi ý gắn Tag (feature 008, T064; contract studio-svg-editor §6).
import { describe, expect, it } from 'vitest';
import { nameHas, suggest } from './svg-suggest.ts';
import type { TagInfo } from './screen-catalog.ts';

const tag = (id: string, type: string, extra: Partial<TagInfo> = {}): TagInfo => ({
  id,
  type,
  access: 'R',
  kind: 'simulation',
  ...extra,
});
const NUM = tag('T.LEVEL', 'FLOAT32', { unit: '%', min: 0, max: 100 });
const BOOL = tag('P.RUN', 'BOOL');
const TABLE = tag('M.STATE', 'UINT16', { valueTable: 'TrangThai' });
const rows = (kind: Parameters<typeof suggest>[0], name: string, t: TagInfo) =>
  suggest(kind, name, t).map((s) => s.rowId);

describe('suggest', () => {
  it('text + số: chữ trực tiếp, 1 số lẻ, đơn vị của Tag', () => {
    const [s] = suggest('text', 'value', NUM);
    expect(s).toMatchObject({
      rowId: 'text',
      tagId: 'T.LEVEL',
      reason: 'text-number',
      binding: {
        target: 'text.content',
        transform: { kind: 'direct' },
        format: { decimals: 1, unitFromTag: true },
      },
    });
  });

  it('text + Tag có bảng giá trị: Bảng giá trị', () => {
    const [s] = suggest('text', 'state', TABLE);
    expect(s!.binding.transform).toEqual({ kind: 'valueTable', output: 'text' });
  });

  it('hình/nhóm tên mức + số: level tuyến tính theo min-max của Tag; rect dùng levelPercent', () => {
    const g = suggest('group', 'Liquid', NUM)[0]!;
    expect(g.rowId).toBe('level');
    expect(g.binding).toMatchObject({
      target: 'geometry.clipLevel',
      transform: { kind: 'linearScale', inMin: 0, inMax: 100 },
    });
    expect(suggest('rect', 'water-fill', NUM)[0]!.binding.target).toBe('geometry.levelPercent');
    expect(rows('rect', 'khoi', NUM)).toEqual([]);
  });

  it('hình/nhóm + BOOL: màu nền rời rạc true xanh, false xám', () => {
    const [s] = suggest('shape', 'lamp', BOOL);
    expect(s).toMatchObject({ rowId: 'fill', reason: 'fill-bool' });
    expect(s!.binding.transform).toMatchObject({
      kind: 'discreteMap',
      cases: [
        { equals: true, value: '#2e9e44' },
        { equals: false, value: '#9aa5b1' },
      ],
    });
  });

  it('hình/nhóm + Tag có bảng: màu nền theo bảng giá trị', () => {
    expect(suggest('group', 'lamp', TABLE)[0]!.binding.transform).toEqual({
      kind: 'valueTable',
      output: 'color',
    });
  });

  it('tên quay + BOOL hoặc số: quay liên tục', () => {
    expect(rows('group', 'Rotor', BOOL)).toContain('spin');
    expect(rows('group', 'Impeller', NUM)).toContain('spin');
    expect(rows('group', 'cánh quạt', BOOL)[0]).toBe('spin');
  });

  it('đường + BOOL: dòng chảy', () => {
    expect(suggest('line', 'pipe', BOOL)[0]).toMatchObject({ rowId: 'flow', reason: 'flow' });
    expect(rows('line', 'pipe', NUM)).toEqual([]);
  });

  it('tên cảnh báo + BOOL: nhấp nháy kèm màu nền (không chỉ nhấp nháy)', () => {
    const r = suggest('shape', 'Báo động', BOOL);
    expect(r.map((s) => s.rowId)).toEqual(['blink', 'fill']);
    expect(r.every((s) => s.reason === 'alarm')).toBe(true);
  });

  it('không có gợi ý khi kiểu không hợp; không đụng đầu vào', () => {
    expect(rows('text', 'x', BOOL)).toEqual([]);
    expect(rows('group', 'rotor', tag('S', 'STRING'))).toEqual([]);
  });

  it('từ khóa không phân biệt hoa thường và dấu', () => {
    expect(nameHas('NƯỚC trong bồn', 'level')).toBe(true);
    expect(nameHas('nuoc', 'level')).toBe(true);
    expect(nameHas('Chat Long', 'level')).toBe(true);
    expect(nameHas('QUẠT', 'spin')).toBe(true);
    expect(nameHas('canh bao', 'alarm')).toBe(true);
    expect(nameHas('van', 'alarm')).toBe(false);
  });
});
