// Tương phản của tám màu alarm ở cả hai theme (contracts/ui-alarm.md §5.3, §10: chữ ≥ 4,5:1, SC-012).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Giá trị industrial (mặc định) nằm ở themes/industrial.css từ feature 012 (tokens.css chỉ còn @import).
const TOKENS_CSS = readFileSync(resolve(__dirname, '../styles/themes/industrial.css'), 'utf8');

const COLORS = ['red', 'orange', 'amber', 'blue', 'purple', 'teal', 'gray', 'green'] as const;

/** Lấy khối khai báo của một bộ chọn (đủ cho tokens.css: không lồng ngoài @media). */
function block(css: string, start: string): Record<string, string> {
  const i = css.indexOf(start);
  if (i < 0) throw new Error(`thiếu ${start}`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    out[m[1]!] = m[2]!.trim();
  return out;
}

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

describe('token màu alarm', () => {
  const themes: Array<[string, Record<string, string>]> = [
    ['sáng', block(TOKENS_CSS, ':where(:root) {')],
    ['tối', block(TOKENS_CSS, ":where(:root[data-theme='dark']) {")],
  ];
  it('contrast() đúng ở hai đầu', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5);
  });
  for (const [name, t] of themes) {
    describe(`theme ${name}`, () => {
      for (const c of COLORS) {
        it(`${c}: đủ ba biến thể`, () => {
          for (const suf of ['', '-soft', '-ink'])
            expect(t[`--mat-alarm-${c}${suf}`]).toMatch(/^#[0-9a-f]{6}$/i);
        });
        it(`${c}: chữ trên nền màu ≥ 4,5:1 và chữ thường trên nền nhạt ≥ 4,5:1`, () => {
          expect(
            contrast(t[`--mat-alarm-${c}-ink`]!, t[`--mat-alarm-${c}`]!),
          ).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t['--mat-text']!, t[`--mat-alarm-${c}-soft`]!)).toBeGreaterThanOrEqual(
            4.5,
          );
        });
        it(`${c}: viền (màu đậm) trên nền bề mặt ≥ 3:1`, () => {
          expect(contrast(t[`--mat-alarm-${c}`]!, t['--mat-surface']!)).toBeGreaterThanOrEqual(3);
        });
      }
    });
  }
  it('khối theme tối theo prefers-color-scheme giống [data-theme=dark]', () => {
    const dark = themes[1]![1];
    const media = block(
      TOKENS_CSS.slice(TOKENS_CSS.indexOf('@media (prefers-color-scheme: dark)')),
      ":where(:root:not([data-theme='light'])) {",
    );
    for (const c of COLORS)
      for (const suf of ['', '-soft', '-ink'])
        expect(media[`--mat-alarm-${c}${suf}`]).toBe(dark[`--mat-alarm-${c}${suf}`]);
  });
});
