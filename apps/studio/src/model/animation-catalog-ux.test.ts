// 033-animation-ux: nhóm theo mục đích, gợi ý theo kiểu Tag, tốc độ Quay khi chạy (preset ánh xạ sang phép sẵn có).
import { describe, expect, it } from 'vitest';
import { evaluateBinding, spinRps } from '@mat/binding-engine';
import { t, type MessageKey } from '../i18n/index.ts';
import {
  ANIMATION_ROWS,
  newBinding,
  recommendedRows,
  ROW_SECTIONS,
  rowUnit,
  SPIN_PRESETS,
  spinPresetTransform,
  spinSpeedOf,
} from './animation-catalog.ts';
import type { TagInfo } from './screen-catalog.ts';

const tag = (id: string, type: string): TagInfo => ({ id, type }) as TagInfo;
const RUN = tag('M.RUN', 'BOOL');
const SPD = tag('M.SPEED', 'FLOAT32');

describe('nhóm và nhãn', () => {
  it('mỗi mục thuộc đúng một nhóm', () => {
    const all = ROW_SECTIONS.flatMap((s) => s.rows);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(ANIMATION_ROWS.map((r) => r.id).sort());
  });
  it('mỗi mục có tên, dòng dùng khi nào và ví dụ', () => {
    for (const r of ANIMATION_ROWS)
      for (const k of ['svg.row.', 'svg.help.', 'svg.ex.'])
        expect(t(`${k}${r.id}` as MessageKey)).not.toBe(`${k}${r.id}`);
    expect(t('svg.row.rotate')).toBe('Xoay theo góc');
    expect(t('svg.row.spin')).toBe('Quay khi chạy');
  });
  it('gợi ý theo kiểu Tag', () => {
    expect(recommendedRows(RUN)).toContain('spin');
    expect(recommendedRows(RUN)).not.toContain('rotate');
    expect(recommendedRows(SPD)).toEqual(expect.arrayContaining(['text', 'level', 'rotate']));
  });
});

describe('tốc độ Quay khi chạy', () => {
  it('binding mới mặc định tốc độ Vừa, Tag BOOL: Bật quay, Tắt đứng', () => {
    const b = newBinding('spin', 'group', RUN)!;
    expect(b.animation).toBe('spin');
    expect(spinSpeedOf(b, RUN)).toBe('medium');
    const run = evaluateBinding(b as never, true, 'GOOD');
    const stop = evaluateBinding(b as never, false, 'GOOD');
    expect(run).toEqual({ hold: false, value: SPIN_PRESETS.medium });
    expect(stop).toEqual({ hold: false, value: 0 });
    expect(spinRps(SPIN_PRESETS.slow)).toBeGreaterThan(0.2); // thấy được chuyển động
  });
  it('Tag số: 0 đứng, khác 0 quay ở tốc độ preset', () => {
    const tr = spinPresetTransform('fast', SPD);
    const b = {
      target: 'transform.rotate',
      animation: 'spin',
      source: { type: 'tag', tagId: SPD.id },
      transform: tr,
    };
    expect(evaluateBinding(b as never, 0, 'GOOD')).toEqual({ hold: false, value: 0 });
    expect(evaluateBinding(b as never, 5, 'GOOD')).toEqual({
      hold: false,
      value: SPIN_PRESETS.fast,
    });
    expect(spinSpeedOf({ transform: tr }, SPD)).toBe('fast');
  });
  it('dự án cũ: direct theo Tag số là "tag", BOOL direct hoặc rời rạc tự đặt là "custom"', () => {
    expect(spinSpeedOf({ transform: { kind: 'direct' } }, SPD)).toBe('tag');
    expect(spinSpeedOf({ transform: { kind: 'direct' } }, RUN)).toBe('custom');
    expect(
      spinSpeedOf(
        { transform: { kind: 'discreteMap', cases: [{ equals: true, value: 60 }], default: 0 } },
        RUN,
      ),
    ).toBe('custom');
  });
  it('đơn vị thanh Thử giá trị', () => {
    expect(rowUnit('rotate', { transform: { kind: 'direct' } })).toBe('deg');
    expect(rowUnit('spin', { transform: { kind: 'direct' } })).toBe('rpm');
    expect(rowUnit('spin', { transform: spinPresetTransform('slow', RUN) })).toBeNull();
  });
});
