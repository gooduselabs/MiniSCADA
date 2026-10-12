// Tương phản chữ/nền của token theme (feature 004, FR-012): ≥ 4,5:1 ở cả sáng và tối (WCAG AA).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Prettier của repo (singleQuote) đổi nháy trong CSS; đưa về nháy kép để tìm bộ chọn theo một kiểu.
const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8').replace(/'/g, '"');

/** Token màu `--tên: #rrggbb` trong khối có bộ chọn `selector` (lấy khối đầu tiên khớp). */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`không thấy ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let end = open;
  for (; end < css.length; end++) {
    if (css[end] === '{') depth++;
    else if (css[end] === '}' && --depth === 0) break;
  }
  const body = css.slice(open + 1, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Cặp chữ trên nền thật sự xuất hiện trong khung (mockup): chữ thường, chữ phụ, nút chính, chip trạng thái,
// dòng đang chọn, thanh trạng thái khi online.
const PAIRS: Array<[string, string]> = [
  ['fg', 'bg'],
  ['fg', 'panel'],
  ['fg', 'panel-2'],
  ['fg', 'hover'],
  ['fg', 'sel'],
  ['muted', 'panel'],
  ['muted', 'panel-2'],
  ['muted', 'bg'],
  // Chữ phụ trên dòng đang chọn và dòng rê chuột (lưới, Details, lưu trữ; axe 2026-10-11)
  ['muted', 'sel'],
  ['muted', 'hover'],
  ['muted', 'accent-soft'],
  ['accent', 'panel'],
  ['accent-ink', 'accent'],
  ['ok', 'ok-soft'],
  ['warn', 'warn-soft'],
  ['err', 'err-soft'],
  ['info', 'info-soft'],
  ['online-ink', 'online-soft'],
  ['err', 'panel'],
  ['warn', 'panel'],
];

describe.each([
  ['sáng', ':root {'],
  ['tối', ':root[data-theme="dark"] {'],
])('theme %s', (_name, selector) => {
  const t = tokens(selector);
  it.each(PAIRS)('%s trên %s ≥ 4,5:1', (fg, bg) => {
    expect(t[fg], `thiếu --${fg}`).toBeDefined();
    expect(t[bg], `thiếu --${bg}`).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('khai báo token', () => {
  it('khối tối theo hệ thống và khối data-theme="dark" giống nhau', () => {
    const media = css.indexOf('@media (prefers-color-scheme: dark)');
    expect(media).toBeGreaterThan(0);
    const inMedia = tokens(':root:not([data-theme="light"]) {');
    expect(inMedia).toEqual(tokens(':root[data-theme="dark"] {'));
  });

  it('màu nhấn chỉ khai báo trong token, không viết cứng trong base.css', () => {
    const base = readFileSync(resolve(__dirname, 'base.css'), 'utf8');
    expect(base).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
