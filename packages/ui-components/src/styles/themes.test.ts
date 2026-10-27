// Giao diện duy nhất atscada (feature 029, thay ba chủ đề của feature 012): đủ token, mọi cặp chữ/nền ≥ 4,5:1, nét biểu
// đồ và màu alarm trên bề mặt ≥ 3:1, Inter tự chứa, `--mat-motion` = 0ms khi giảm chuyển động, không còn data-mat-theme.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOKENS_CSS } from './tokens.ts';

const read = (p: string): string =>
  readFileSync(resolve(__dirname, p), 'utf8').replace(/"/g, "'").replace(/\r\n/g, '\n');
const THEMES = { atscada: read('themes/atscada.css') };
const TOKENS_FILE = read('tokens.css');

/** Khối khai báo đầu tiên có bộ chọn `selector` (tính cả ngoặc lồng), từ vị trí `from`. */
function block(css: string, selector: string, from = 0): Record<string, string> {
  const start = css.indexOf(selector, from);
  if (start < 0) throw new Error(`thiếu ${selector}`);
  const open = css.indexOf('{', start + selector.length - 1);
  let depth = 0;
  let end = open;
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    else if (css[end] === '}' && --depth === 0) break;
  }
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    out[m[1]!] = m[2]!.replace(/\s+/g, ' ').trim();
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
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const N12 = Array.from({ length: 12 }, (_, i) => i + 1);
const N9 = Array.from({ length: 9 }, (_, i) => i + 1);
const ALARMS = ['red', 'orange', 'amber', 'blue', 'purple', 'teal', 'gray', 'green'];
/** Màu thẻ chỉ số (feature 014): đúng tập `options` của thuộc tính `color` của stat-tile trong danh mục. */
const TILE_NAMES = [
  'teal',
  'blue',
  'rose',
  'violet',
  'olive',
  'indigo',
  'orange',
  'cyan',
  'green',
  'slate',
];

/** Token màu (giá trị #rrggbb) giao diện phải khai. */
const COLOR_TOKENS = [
  ...[
    'bg',
    'surface',
    'surface-2',
    'text',
    'text-muted',
    'accent',
    'accent-ink',
    'border',
    'border-strong',
    'good',
    'good-soft',
    'warn',
    'warn-soft',
    'bad',
    'bad-soft',
    'info',
    'online',
    'offline',
  ],
  ...N12.flatMap((i) => [`chart-${i}`, `chart-${i}-soft`]),
  ...N9.flatMap((i) => [`seq-${i}`, `div-${i}`]),
  ...ALARMS.flatMap((c) => [`alarm-${c}`, `alarm-${c}-soft`, `alarm-${c}-ink`]),
].map((t) => `--mat-${t}`);
/** Token khác màu; khai đủ. */
const OTHER_TOKENS = [
  'scrim',
  'shadow',
  'shadow-card',
  'radius',
  'radius-lg',
  'font',
  'font-mono',
  'motion',
].map((t) => `--mat-${t}`);

/** Cặp chữ/nền (contracts/ui-theme.md §2): ≥ 4,5:1. */
const TEXT_PAIRS: Array<[string, string]> = [
  ...['bg', 'surface', 'surface-2'].flatMap((b): Array<[string, string]> => [
    ['text', b],
    ['text-muted', b],
  ]),
  ['accent-ink', 'accent'],
  ['accent', 'surface'],
  ...['good', 'warn', 'bad'].flatMap((s): Array<[string, string]> => [
    ['text', `${s}-soft`],
    [s, `${s}-soft`],
    [s, 'surface'],
    [s, 'bg'],
  ]),
  ['info', 'surface'],
  ['info', 'bg'],
  ['offline', 'surface'],
  ...N12.map((i): [string, string] => ['text', `chart-${i}-soft`]),
  ...ALARMS.flatMap((c): Array<[string, string]> => [
    [`alarm-${c}-ink`, `alarm-${c}`],
    ['text', `alarm-${c}-soft`],
  ]),
];
/** Thành phần đồ họa (nét biểu đồ, viền alarm, chấm online) trên bề mặt: ≥ 3:1 (WCAG 1.4.11). */
const GRAPHIC_PAIRS: Array<[string, string]> = [
  ...N12.map((i): [string, string] => [`chart-${i}`, 'surface']),
  ...ALARMS.map((c): [string, string] => [`alarm-${c}`, 'surface']),
  ['online', 'surface'],
];

const VARIANTS: Array<[string, Record<string, string>, boolean]> = [
  ['atscada', block(THEMES.atscada, ':where(:root) {'), true],
];

describe('chủ đề: đủ token và tương phản (FR-032, SC-007)', () => {
  for (const [name, t, full] of VARIANTS) {
    describe(name, () => {
      it('đủ token màu (#rrggbb)', () => {
        const missing = COLOR_TOKENS.filter((k) => !/^#[0-9a-f]{6}$/i.test(t[k] ?? ''));
        expect(missing).toEqual([]);
      });
      if (full)
        it('đủ token không phải màu', () => {
          expect(OTHER_TOKENS.filter((k) => !t[k])).toEqual([]);
        });
      it('mọi cặp chữ/nền ≥ 4,5:1', () => {
        const bad = TEXT_PAIRS.map(([a, b]) => [a, b, contrast(t[`--mat-${a}`]!, t[`--mat-${b}`]!)])
          .filter(([, , r]) => (r as number) < 4.5)
          .map(([a, b, r]) => `${a}/${b} = ${(r as number).toFixed(2)}`);
        expect(bad).toEqual([]);
      });
      it('nét biểu đồ, viền alarm trên bề mặt ≥ 3:1', () => {
        const bad = GRAPHIC_PAIRS.map(([a, b]) => [
          a,
          b,
          contrast(t[`--mat-${a}`]!, t[`--mat-${b}`]!),
        ])
          .filter(([, , r]) => (r as number) < 3)
          .map(([a, b, r]) => `${a}/${b} = ${(r as number).toFixed(2)}`);
        expect(bad).toEqual([]);
      });
      it('12 màu chuỗi khác nhau từng đôi', () => {
        const colors = N12.map((i) => t[`--mat-chart-${i}`]!.toLowerCase());
        expect(new Set(colors).size).toBe(12);
      });
    });
  }

  // Feature 014: bảng màu của thẻ chỉ số (stat-tile), khai ở mọi chủ đề, chữ trắng đạt 4,5:1.
  it('thẻ chỉ số: đủ 10 màu ở mọi chủ đề, chữ trắng ≥ 4,5:1, khác nhau từng đôi', () => {
    for (const [name, t] of VARIANTS) {
      const colors = TILE_NAMES.map((c) => t[`--mat-tile-${c}`] ?? '');
      expect(
        colors.filter((c) => !/^#[0-9a-f]{6}$/i.test(c)),
        name,
      ).toEqual([]);
      expect(t['--mat-tile-ink'], name).toBe('#ffffff');
      const weak = TILE_NAMES.filter((c) => contrast('#ffffff', t[`--mat-tile-${c}`]!) < 4.5);
      expect(weak, name).toEqual([]);
      expect(new Set(colors).size, name).toBe(TILE_NAMES.length);
    }
  });

  it('atscada: màu chủ đạo teal và thanh điều hướng kiểu FastWeb', () => {
    const t = VARIANTS[0]![1];
    expect(t['--mat-nav-bg']).toBe('#2d353c');
    expect(t['--mat-surface']).toBe('#ffffff');
    expect(contrast(t['--mat-nav-text']!, t['--mat-nav-bg']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffffff', t['--mat-switch-on']!)).toBeGreaterThanOrEqual(3);
  });
});

describe('chọn chủ đề và nạp (contracts/ui-theme.md §1)', () => {
  it('themes/*.css và fonts/ khớp đầu ra của tools/gen-theme-tokens.mjs (không sửa tay)', () => {
    const script = resolve(__dirname, '../../../../tools/gen-theme-tokens.mjs');
    expect(() =>
      execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('chỉ một giao diện: áp lên :where(:root), không còn data-mat-theme hay biến thể tối', () => {
    expect(THEMES.atscada).toContain(':where(:root) {');
    expect(THEMES.atscada).not.toContain('data-mat-theme');
    expect(THEMES.atscada).not.toContain('prefers-color-scheme');
  });

  it('--mat-motion = 0ms khi prefers-reduced-motion: reduce, ', () => {
    const sel = { atscada: ':where(:root) {' } as const;
    for (const [name, css] of Object.entries(THEMES)) {
      const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
      expect(at, name).toBeGreaterThan(0);
      expect(block(css, sel[name as keyof typeof sel], at)['--mat-motion'], name).toBe('0ms');
      // khối giảm chuyển động nằm sau khối chính để thắng (cùng độ ưu tiên 0)
      expect(at).toBeGreaterThan(css.indexOf(sel[name as keyof typeof sel]));
    }
  });

  it('tokens.css nạp đúng một tệp giao diện atscada', () => {
    expect(TOKENS_FILE.match(/^@import/gm)).toHaveLength(1);
    expect(TOKENS_FILE).toContain("@import './themes/atscada.css';");
  });

  // latin-ext của Inter thiếu U+1EA0-1EF1 (ạ, ả, ấ, …): cần thêm tập vietnamese thì mới đủ dấu (FR-036).
  it('phông Inter tự chứa: @font-face latin, latin-ext, vietnamese, woff2 cục bộ, font-display swap, không URL ngoài', () => {
    for (const css of [TOKENS_FILE, TOKENS_CSS]) {
      const faces = [...css.matchAll(/@font-face\s*{[^}]*}/g)].map((m) => m[0]);
      expect(faces).toHaveLength(3);
      for (const f of faces) {
        expect(f).toContain("font-family: 'Inter Variable'");
        expect(f).toContain('font-display: swap');
        expect(f).toMatch(
          /url\([^)]*inter-(latin|latin-ext|vietnamese)-wght-normal[^)]*\.woff2[^)]*\) format\('woff2'\)/,
        );
        expect(f).toMatch(/unicode-range:/);
      }
      const all = faces.join('');
      expect(all).toContain('inter-latin-ext-wght-normal');
      expect(all).toContain('inter-vietnamese-wght-normal');
      expect(all).toContain('U+1EA0-1EF9');
      expect(css).not.toMatch(/url\(\s*'?(https?:)?\/\//);
    }
  });

  it('TOKENS_CSS (nạp bằng installTokens) có giao diện atscada và không có @import', () => {
    expect(TOKENS_CSS.replace(/"/g, "'")).toContain(':where(:root) {');
    expect(TOKENS_CSS).not.toContain('data-mat-theme');
    expect(TOKENS_CSS).not.toContain('@import');
  });
});
