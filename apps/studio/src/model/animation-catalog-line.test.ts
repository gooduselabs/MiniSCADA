// Đường chỉ có nét nhận Màu viền (feature 008, T072; contract binding-animation §2: `style.stroke` hợp mọi phần tử).
import { describe, expect, it } from 'vitest';
import { rowAcceptsKind, rowById } from './animation-catalog.ts';

describe('mục Màu viền và loại phần tử', () => {
  it('đường, đường gấp khúc, path chỉ có nét nhận Màu viền; Màu nền chỉ cho hình, nhóm, chữ', () => {
    expect(rowAcceptsKind(rowById('stroke')!, 'line')).toBe(true);
    expect(rowAcceptsKind(rowById('fill')!, 'line')).toBe(false);
    expect(rowAcceptsKind(rowById('flow')!, 'line')).toBe(true);
    expect(rowAcceptsKind(rowById('text')!, 'line')).toBe(false);
  });
});
