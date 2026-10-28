import { describe, expect, it } from 'vitest';
import { inspectorModelOf } from './screen-catalog.ts';
import { groupBySection, sectionOf } from './prop-sections.ts';

describe('nhóm thuộc tính (037)', () => {
  it('Thẻ giá trị chia đủ 4 nhóm theo thứ tự, không mất thuộc tính', () => {
    const fields = inspectorModelOf('card')!.groups.display;
    const g = groupBySection(fields);
    expect(g.map((x) => x.section)).toEqual(['data', 'look', 'color', 'threshold']);
    expect(g.flatMap((x) => x.fields).length).toBe(fields.length);
    expect(g[2]!.fields.map((f) => f.name)).toContain('accent');
    expect(g[3]!.fields.map((f) => f.name)).toEqual([
      'blinkAbove',
      'blinkBelow',
      'warnAbove',
      'warnBelow',
      'alarmAbove',
      'alarmBelow',
    ]);
  });
  it('tên lạ vào Hiển thị; nút của thiết bị vào Hành động', () => {
    expect(sectionOf('whatever')).toBe('look');
    expect(sectionOf('showButtons')).toBe('action');
  });
});
