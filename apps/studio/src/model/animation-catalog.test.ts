// Danh sách 13 mục động hóa (feature 008, T064; contract studio-svg-editor §5).
import { describe, expect, it } from 'vitest';
import {
  ANIMATION_ROWS,
  defaultTransform,
  newBinding,
  rowAcceptsKind,
  rowAcceptsTag,
  rowBlock,
  rowById,
  rowOfBinding,
  tagRange,
  targetOf,
  transformsFor,
} from './animation-catalog.ts';
import type { TagInfo } from './screen-catalog.ts';

const tag = (id: string, type: string, extra: Partial<TagInfo> = {}): TagInfo => ({
  id,
  type,
  access: 'R',
  kind: 'simulation',
  ...extra,
});
const LEVEL = tag('TANK.LEVEL', 'FLOAT32', { unit: '%', min: 0, max: 200 });
const RUN = tag('PUMP.RUN', 'BOOL');
const NAME = tag('PUMP.NAME', 'STRING');

describe('13 mục', () => {
  it('đủ 13 id, đích khớp contract', () => {
    expect(ANIMATION_ROWS.map((r) => r.id)).toEqual([
      'text',
      'fill',
      'stroke',
      'level',
      'rotate',
      'spin',
      'translateX',
      'translateY',
      'scale',
      'blink',
      'flow',
      'visibility',
      'opacity',
    ]);
    expect(rowById('text')!.target).toBe('text.content');
    expect(rowById('spin')!.target).toBe('transform.rotate');
    expect(rowById('flow')!.target).toBe('effect.flow');
    expect(rowById('nope')).toBeUndefined();
  });

  it('phần tử hợp: chữ chỉ cho text; mức không cho text; dòng chảy cần hình có nét', () => {
    expect(rowAcceptsKind(rowById('text')!, 'text')).toBe(true);
    expect(rowAcceptsKind(rowById('text')!, 'rect')).toBe(false);
    expect(rowAcceptsKind(rowById('level')!, 'text')).toBe(false);
    expect(rowAcceptsKind(rowById('level')!, 'group')).toBe(true);
    expect(rowAcceptsKind(rowById('flow')!, 'line')).toBe(true);
    expect(rowAcceptsKind(rowById('flow')!, 'group')).toBe(false);
    expect(rowBlock(rowById('level')!, 'text')).toBe('element-kind');
    expect(rowBlock(rowById('level')!, 'rect', NAME)).toBe('tag-type');
    expect(rowBlock(rowById('level')!, 'rect', LEVEL)).toBeNull();
  });

  it('kiểu Tag hợp: mức cần số; quay liên tục nhận BOOL; chữ nhận mọi kiểu', () => {
    expect(rowAcceptsTag(rowById('level')!, RUN)).toBe(false);
    expect(rowAcceptsTag(rowById('spin')!, RUN)).toBe(true);
    expect(rowAcceptsTag(rowById('rotate')!, RUN)).toBe(false);
    for (const tg of [LEVEL, RUN, NAME]) expect(rowAcceptsTag(rowById('text')!, tg)).toBe(true);
  });

  it('phép biến đổi hợp theo Tag', () => {
    expect(transformsFor(rowById('level')!, LEVEL)).toEqual(['direct', 'linearScale']);
    expect(transformsFor(rowById('fill')!, RUN)).toEqual(['discreteMap', 'valueTable']);
    expect(transformsFor(rowById('fill')!, NAME)).toEqual(['discreteMap']);
    expect(transformsFor(rowById('text')!, NAME)).toEqual(['direct', 'discreteMap']);
    expect(transformsFor(rowById('blink')!, RUN)).toEqual(['direct', 'discreteMap']);
  });

  it('level: rect dùng levelPercent, hình khác dùng clipLevel; binding cũ nhận ra đúng mục', () => {
    const level = rowById('level')!;
    expect(targetOf(level, 'rect')).toBe('geometry.levelPercent');
    expect(targetOf(level, 'group')).toBe('geometry.clipLevel');
    expect(rowOfBinding({ target: 'geometry.levelPercent' })!.id).toBe('level');
    expect(rowOfBinding({ target: 'transform.rotate' })!.id).toBe('rotate');
    expect(rowOfBinding({ target: 'transform.rotate', animation: 'spin' })!.id).toBe('spin');
  });
});

describe('tham số mặc định lấy từ Tag', () => {
  it('khoảng vào lấy từ min/max hoặc limits; hai đầu bằng nhau thì mở rộng', () => {
    expect(tagRange(LEVEL)).toEqual([0, 200]);
    expect(tagRange({ limits: { min: 5, max: 9 }, min: 0, max: 100 })).toEqual([5, 9]);
    expect(tagRange(undefined)).toEqual([0, 100]);
    expect(tagRange({ min: 3, max: 3 })).toEqual([3, 4]);
  });

  it('tuyến tính: in theo Tag, out theo đích', () => {
    expect(defaultTransform(rowById('level')!, 'linearScale', LEVEL)).toEqual({
      kind: 'linearScale',
      inMin: 0,
      inMax: 200,
      outMin: 0,
      outMax: 100,
      clamp: true,
    });
    expect(defaultTransform(rowById('rotate')!, 'linearScale', LEVEL)).toMatchObject({
      outMin: 0,
      outMax: 360,
    });
    expect(defaultTransform(rowById('scale')!, 'linearScale', LEVEL)).toMatchObject({
      outMin: 0.01,
      outMax: 10,
    });
  });

  it('rời rạc BOOL có hai dòng true/false; khoảng màu chia ba theo khoảng của Tag, khoảng khác chia đôi', () => {
    expect(defaultTransform(rowById('fill')!, 'discreteMap', RUN)).toMatchObject({
      cases: [
        { equals: true, value: '#2e9e44' },
        { equals: false, value: '#9aa5b1' },
      ],
    });
    expect(defaultTransform(rowById('fill')!, 'rangeMap', LEVEL)).toMatchObject({
      ranges: [
        { to: 120, value: '#2e9e44' },
        { from: 120, to: 170, value: '#f39c12' },
        { from: 170, value: '#d64541' },
      ],
    });
    expect(defaultTransform(rowById('rotate')!, 'rangeMap', LEVEL)).toMatchObject({
      ranges: [
        { to: 100, value: 0 },
        { from: 100, value: 90 },
      ],
    });
  });

  it('chữ số: 1 số lẻ, đơn vị của Tag khi có', () => {
    expect(newBinding('text', 'text', LEVEL)).toMatchObject({
      target: 'text.content',
      source: { type: 'tag', tagId: 'TANK.LEVEL' },
      transform: { kind: 'direct' },
      format: { decimals: 1, unitFromTag: true },
    });
    const nounit = newBinding('text', 'text', tag('X', 'INT16'))!;
    expect(nounit.format).toEqual({ decimals: 1 });
  });

  it('newBinding: quay liên tục có animation spin; mục không hợp phép thì null', () => {
    expect(newBinding('spin', 'group', RUN)).toMatchObject({
      target: 'transform.rotate',
      animation: 'spin',
    });
    expect(newBinding('level', 'rect', LEVEL)!.target).toBe('geometry.levelPercent');
    expect(newBinding('level', 'rect', NAME)).toBeNull();
    expect(newBinding('nope' as never, 'rect', LEVEL)).toBeNull();
  });
});
