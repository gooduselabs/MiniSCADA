// Sinh token giao diện của thư viện widget (feature 012 R3; feature 029: giao diện duy nhất kiểu ATSCADA FastWeb):
//   node tools/gen-theme-tokens.mjs          -> ghi packages/ui-components/src/styles/themes/atscada.css
//                                               và chép phông Inter (woff2) vào packages/ui-components/src/styles/fonts/
//   node tools/gen-theme-tokens.mjs --check  -> chỉ so sánh, khác thì mã thoát 1 (dùng trong CI/test)
// Feature 029 bỏ cơ chế nhiều chủ đề (industrial/vivid/dark): chỉ còn một bộ token sáng áp lên :where(:root). Màu gốc lấy
// "tương đối" theo FastWeb (Bootstrap 3 + mẫu Color Admin): nền xám xanh nhạt, khung trắng, tiêu đề khung xám nhạt,
// thanh điều hướng #2d353c, màu chủ đạo teal #00acac, xanh #348fe2, cam #f59c1a, đỏ #ff5b57, tím #727cb6. Màu gốc được
// làm tối dần (trộn với đen) tới khi đạt ngưỡng tương phản WCAG, nên giữ sắc độ FastWeb mà vẫn đọc được.
// Bộ chọn bọc :where() (độ ưu tiên 0) nên trang chủ đặt lại token trên :root luôn thắng.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import * as prettier from 'prettier';

const root = resolve(import.meta.dirname, '..');
const stylesDir = join(root, 'packages/ui-components/src/styles');
const check = process.argv.includes('--check');

// ---- màu và tương phản (WCAG 2.x) ----
const lin = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
export const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const hex = (h) => {
  if (!/^#[0-9a-f]{6}$/i.test(h)) throw new Error(`không phải #rrggbb: ${h}`);
  return h.toLowerCase();
};
/** Trộn `fg` lên `bg` với độ phủ `a`. */
function mix(fg, bg, a) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [f, b] = [p(fg), p(bg)];
  return `#${f
    .map((c, i) => Math.round(c * a + b[i] * (1 - a)))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}
/** Làm tối `c` từng bước 4 % tới khi đạt `min` trên mọi nền trong `backs`. */
function ensure(c, backs, min) {
  let x = hex(c);
  for (let i = 0; i < 80; i++) {
    if (backs.every((b) => contrast(x, b) >= min)) return x;
    x = mix('#000000', x, 0.04);
  }
  throw new Error(`${c}: không đạt ${min}:1`);
}

const BASE = {
  bg: '#e4e9ed',
  surface: '#ffffff',
  'surface-2': '#f2f3f4',
  text: '#2d353c',
  'text-muted': '#56616b',
  border: '#d5dbe0',
  'border-strong': '#b6c2c9',
};
const SEED = {
  accent: '#00acac',
  good: '#00acac',
  warn: '#f59c1a',
  bad: '#ff5b57',
  info: '#348fe2',
  online: '#f59c1a',
  offline: '#929ba1',
};
// 12 màu chuỗi: thứ tự bảng màu biểu đồ của Color Admin.
const CHART = [
  '#348fe2',
  '#00acac',
  '#f59c1a',
  '#ff5b57',
  '#727cb6',
  '#90ca4b',
  '#49b6d6',
  '#8753de',
  '#2d353c',
  '#fb5597',
  '#8a6d3b',
  '#c9a400',
];
const ALARM = {
  red: '#ff5b57',
  orange: '#f57c1a',
  amber: '#f5b01a',
  blue: '#348fe2',
  purple: '#727cb6',
  teal: '#00acac',
  gray: '#929ba1',
  green: '#90ca4b',
};
// Thẻ chỉ số (widget-stats của FastWeb): nền đặc, chữ trắng ≥ 4,5:1. Tên là giá trị `color` của stat-tile.
export const TILE_COLORS = {
  teal: '#00acac',
  blue: '#348fe2',
  rose: '#ff5b57',
  violet: '#727cb6',
  olive: '#90ca4b',
  indigo: '#8753de',
  orange: '#f59c1a',
  cyan: '#49b6d6',
  green: '#32a932',
  slate: '#2d353c',
};

export function atscada() {
  const t = { ...BASE };
  const S = t.surface;
  t.accent = ensure(SEED.accent, [S, BASE['surface-2'], BASE.bg], 4.5);
  t['accent-ink'] = '#ffffff';
  for (const k of ['good', 'warn', 'bad']) {
    t[`${k}-soft`] = mix(SEED[k], S, 0.16);
    t[k] = ensure(SEED[k], [S, t.bg, t[`${k}-soft`]], 4.5);
  }
  t.info = ensure(SEED.info, [S, t.bg], 4.5);
  t.online = ensure(SEED.online, [S], 3);
  t.offline = ensure(SEED.offline, [S], 4.5);
  t.scrim = 'rgba(45, 53, 60, 0.45)';
  t.shadow = '0 10px 30px rgba(45, 53, 60, 0.2), 0 2px 6px rgba(45, 53, 60, 0.1)';
  t['shadow-card'] = '0 1px 2px rgba(45, 53, 60, 0.12)';
  t.radius = '3px';
  t['radius-lg'] = '4px';
  t.font = `'Inter Variable', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`;
  t['font-mono'] = `'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, Menlo, monospace`;
  t.motion = '150ms';
  CHART.forEach((c, i) => {
    t[`chart-${i + 1}`] = ensure(c, [S], 3);
    t[`chart-${i + 1}-soft`] = mix(c, S, 0.14);
  });
  for (let i = 1; i <= 9; i++) t[`seq-${i}`] = mix('#007a7a', '#ffffff', 0.08 + (i - 1) * 0.115);
  [
    '#c9302c',
    mix('#ff5b57', S, 0.85),
    mix('#ff5b57', S, 0.5),
    mix('#ff5b57', S, 0.25),
    t['surface-2'],
    mix('#348fe2', S, 0.25),
    mix('#348fe2', S, 0.5),
    mix('#348fe2', S, 0.85),
    '#1f5f99',
  ].forEach((c, i) => (t[`div-${i + 1}`] = c));
  for (const [c, seed] of Object.entries(ALARM)) {
    t[`alarm-${c}`] = ensure(seed, [S], 4.5);
    t[`alarm-${c}-soft`] = mix(seed, S, 0.16);
    t[`alarm-${c}-ink`] = '#ffffff';
  }
  for (const [k, v] of Object.entries(TILE_COLORS)) t[`tile-${k}`] = ensure(v, ['#ffffff'], 4.5);
  t['tile-ink'] = '#ffffff';
  // Thanh điều hướng, tiêu đề khung, bảng, công tắc kiểu FastWeb.
  t['nav-bg'] = '#2d353c';
  t['nav-text'] = '#e8ecf0';
  t['nav-active'] = t.accent;
  t['header-bg'] = '#ffffff';
  t['card-head-bg'] = t['surface-2'];
  t['table-head-bg'] = t['surface-2'];
  t['table-stripe'] = '#f9fafb';
  t['switch-on'] = t.accent;
  t['switch-off'] = '#b6c2c9';
  return t;
}

// ---- xuất CSS ----
const ORDER = [
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
  'scrim',
  'shadow',
  'shadow-card',
  'radius',
  'radius-lg',
  'font',
  'font-mono',
  'motion',
];
function decls(t, indent) {
  const keys = [
    ...ORDER.filter((k) => k in t),
    ...Object.keys(t).filter((k) => !ORDER.includes(k)),
  ];
  return keys.map((k) => `${indent}--mat-${k}: ${t[k]};`).join('\n');
}
const rule = (sel, t, indent = '') => `${indent}${sel} {\n${decls(t, indent + '  ')}\n${indent}}`;
const reduced = (sel) =>
  `@media (prefers-reduced-motion: reduce) {\n  ${sel} {\n    --mat-motion: 0ms;\n  }\n}`;
const HEADER = (what) =>
  `/* ${what}\n   SINH TỰ ĐỘNG bởi tools/gen-theme-tokens.mjs (feature 012 R3, feature 029): không sửa tay, sửa script rồi chạy lại. */\n`;

function atscadaCss() {
  return [
    HEADER(
      'Giao diện ATSCADA (feature 029): giao diện duy nhất của trang vận hành và widget, kiểu ATSCADA FastWeb.\n   Không còn nhiều chủ đề; trường theme cũ của project được đọc nhưng bỏ qua.',
    ),
    rule(':where(:root)', atscada()),
    '',
    reduced(':where(:root)'),
    '',
  ].join('\n');
}

const outputs = {
  'themes/atscada.css': atscadaCss(),
};

// Phông Inter (OFL-1.1): latin + latin-ext + vietnamese (latin-ext thiếu U+1EA0-1EF1).
const require = createRequire(import.meta.url);
const fontDir = join(dirname(require.resolve('@fontsource-variable/inter/package.json')), 'files');
const FONTS = ['latin', 'latin-ext', 'vietnamese'].map((s) => `inter-${s}-wght-normal.woff2`);

let differ = 0;
for (const [rel, raw] of Object.entries(outputs)) {
  const file = join(stylesDir, rel);
  // Định dạng theo Prettier của repo để tệp sinh ổn định dù ai chạy prettier --write trên thư mục.
  const text = await prettier.format(raw, {
    ...(await prettier.resolveConfig(file)),
    filepath: file,
  });
  const old = existsSync(file) ? readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  if (old === text) continue;
  differ++;
  if (check) console.error(`khác: ${rel}`);
  else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`đã ghi ${rel}`);
  }
}
for (const f of FONTS) {
  const dst = join(stylesDir, 'fonts', f);
  const src = join(fontDir, f);
  if (existsSync(dst) && readFileSync(dst).equals(readFileSync(src))) continue;
  differ++;
  if (check) console.error(`khác: fonts/${f}`);
  else {
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    console.log(`đã chép fonts/${f}`);
  }
}
{
  const dst = join(stylesDir, 'fonts', 'LICENSE-Inter.txt');
  const src = join(fontDir, '..', 'LICENSE');
  if (!existsSync(dst) || !readFileSync(dst).equals(readFileSync(src))) {
    differ++;
    if (check) console.error('khác: fonts/LICENSE-Inter.txt');
    else copyFileSync(src, dst);
  }
}
if (check && differ) process.exit(1);
