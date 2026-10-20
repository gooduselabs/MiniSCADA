// Sinh token chủ đề của thư viện widget (feature 012, T039, research R3, contracts/ui-theme.md):
//   node tools/gen-theme-tokens.mjs          -> ghi packages/ui-components/src/styles/themes/{industrial,vivid,dark}.css
//                                               và chép phông Inter (woff2) vào packages/ui-components/src/styles/fonts/
//   node tools/gen-theme-tokens.mjs --check  -> chỉ so sánh, khác thì mã thoát 1 (dùng trong CI/test)
// Kết quả được commit; lúc chạy không phụ thuộc Radix (chỉ là devDependency lúc thiết kế).
//  - industrial: đúng giá trị token có từ trước (giao diện cũ không đổi, khớp apps/studio/src/theme/tokens.css), sáng và
//    tối theo :root[data-theme] và prefers-color-scheme như cũ; thêm token mới (chuỗi 9-12, nền nhạt, thang, bo góc lớn,
//    bóng card, chuyển động).
//  - vivid (Sáng đa sắc) và dark (Tối): thang 12 bậc của Radix Colors 3.0.0. Bậc 9 cho nét chuỗi, rơi xuống bậc 10, 11
//    khi bậc 9 không đạt 3:1 trên bề mặt; bậc 3 cho nền nhạt; chữ trên nền màu chọn trắng hoặc bậc tối nhất đạt 4,5:1.
// Chọn chủ đề: :root[data-mat-theme='vivid' | 'dark']; không đặt (hoặc 'industrial') là industrial. Mọi bộ chọn bọc :where()
// (độ ưu tiên 0) nên trang chủ đặt lại token trên :root luôn thắng; thứ tự nạp industrial, vivid, dark quyết định.
import * as radix from '@radix-ui/colors';
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
/** Bậc `step` của thang Radix `name` (sáng) hoặc `${name}Dark` (tối). */
const rx = (name, step, dark) => hex(radix[dark ? `${name}Dark` : name][`${name}${step}`]);
/** Bậc đầu tiên trong `steps` đạt `min` so với `against`. */
function pick(name, steps, against, min, dark) {
  for (const s of steps) {
    const c = rx(name, s, dark);
    if (contrast(c, against) >= min) return c;
  }
  throw new Error(`${name}${dark ? 'Dark' : ''}: không bậc nào trong ${steps} đạt ${min}:1`);
}
/** Màu chữ của hue: bậc 11, trộn dần về bậc 12 tới khi đạt 4,5:1 trên mọi nền trong `backs` (bậc 11 trên bậc 3 của
 * Radix không luôn đạt 4,5:1 theo WCAG 2). */
function textOn(name, backs, dark) {
  const s11 = rx(name, 11, dark);
  const s12 = rx(name, 12, dark);
  for (let a = 0; a <= 1.0001; a += 0.05) {
    const c = mix(s12, s11, a);
    if (backs.every((b) => contrast(c, b) >= 4.5)) return c;
  }
  throw new Error(`${name}: không đạt 4,5:1`);
}
/** Nền màu (≥ 3:1 trên bề mặt) + chữ trên nó (≥ 4,5:1): bậc 9, 10, 11 lần lượt, chữ trắng hoặc bậc tối. */
function solid(name, dark, darkInk, surface, minOnSurface = 3) {
  for (const s of [9, 10, 11]) {
    const bg = rx(name, s, dark);
    if (surface && contrast(bg, surface) < minOnSurface) continue;
    const inks = ['#ffffff', darkInk ?? rx(name, 12, false)];
    const best = inks
      .map((ink) => [ink, contrast(ink, bg)])
      .filter(([, r]) => r >= 4.5)
      .sort((a, b) => b[1] - a[1])[0];
    if (best) return { bg, ink: best[0] };
  }
  throw new Error(`${name}: không tìm được nền và chữ đạt 4,5:1`);
}

// ---- industrial: giá trị có từ trước (feature 004, 007, 009), không đổi ----
const INDUSTRIAL_LIGHT = {
  bg: '#edf0f1',
  surface: '#ffffff',
  'surface-2': '#f5f7f8',
  text: '#1a2225',
  'text-muted': '#56646a',
  accent: '#0b7285',
  'accent-ink': '#ffffff',
  border: '#d2d9dc',
  'border-strong': '#b3bec3',
  good: '#15703a',
  'good-soft': '#dcf1e3',
  warn: '#8f5e00',
  'warn-soft': '#fbefcf',
  bad: '#c42b2b',
  'bad-soft': '#fbe1e1',
  info: '#0b5cad',
  online: '#e8590c',
  offline: '#6b777c',
  scrim: 'rgba(12, 22, 26, 0.36)',
  shadow: '0 12px 32px rgba(16, 34, 42, 0.18), 0 2px 6px rgba(16, 34, 42, 0.08)',
};
const INDUSTRIAL_DARK = {
  bg: '#131718',
  surface: '#191e20',
  'surface-2': '#1e2427',
  text: '#e1e8ea',
  'text-muted': '#9aa9af',
  accent: '#3ab1c1',
  'accent-ink': '#04191d',
  border: '#2d363a',
  'border-strong': '#435055',
  good: '#52c672',
  'good-soft': '#15321e',
  warn: '#e4b545',
  'warn-soft': '#372b10',
  bad: '#ff7070',
  'bad-soft': '#3b1919',
  info: '#70b2f6',
  online: '#ff8a3d',
  offline: '#8d9a9f',
  scrim: 'rgba(0, 0, 0, 0.55)',
  shadow: '0 12px 32px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4)',
};
const INDUSTRIAL_FONT = `'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`;
const FONT_MONO = `'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, Menlo, monospace`;
// 8 màu chuỗi cũ + 4 màu thêm (bậc 11 sáng / bậc 11 tối của indigo, brown, plum, lime: trầm như 8 màu cũ).
const INDUSTRIAL_CHART_LIGHT = [
  '#0b7285',
  '#c2410c',
  '#6f42c1',
  '#15703a',
  '#b4234a',
  '#1c64c4',
  '#8f5e00',
  '#56646a',
  ...['indigo', 'brown', 'plum', 'lime'].map((n) => rx(n, 11, false)),
];
const INDUSTRIAL_CHART_DARK = [
  '#3ab1c1',
  '#ff9a5c',
  '#b794f4',
  '#52c672',
  '#f27a9b',
  '#70b2f6',
  '#e4b545',
  '#9aa9af',
  ...['indigo', 'brown', 'plum', 'lime'].map((n) => rx(n, 11, true)),
];
const ALARMS = ['red', 'orange', 'amber', 'blue', 'purple', 'teal', 'gray', 'green'];
// Bảng màu thẻ chỉ số `stat-tile` (feature 014): nền đặc, chữ trắng ≥ 4,5:1, cùng giá trị ở mọi chủ đề (thẻ là điểm nhấn
// màu cả trên nền sáng lẫn nền tối). Tên là giá trị `color` của widget trong danh mục.
export const TILE_COLORS = {
  teal: '#0f7f75',
  blue: '#2563eb',
  rose: '#e11d48',
  violet: '#7c3aed',
  olive: '#4d7c0f',
  indigo: '#4f46e5',
  orange: '#c2410c',
  cyan: '#0e7490',
  green: '#15803d',
  slate: '#475569',
};
const tiles = (t) => {
  for (const [k, v] of Object.entries(TILE_COLORS)) t[`tile-${k}`] = v;
  t['tile-ink'] = '#ffffff';
  return t;
};
const INDUSTRIAL_ALARM_LIGHT = {
  red: ['#b3261e', '#fbe1e1', '#ffffff'],
  orange: ['#a63f00', '#fde6d3', '#ffffff'],
  amber: ['#7a5200', '#fbefcf', '#ffffff'],
  blue: ['#0b5cad', '#dcebfb', '#ffffff'],
  purple: ['#6f42c1', '#ece3fa', '#ffffff'],
  teal: ['#0b6b73', '#d6f0f2', '#ffffff'],
  gray: ['#56646a', '#e6eaec', '#ffffff'],
  green: ['#15703a', '#dcf1e3', '#ffffff'],
};
const INDUSTRIAL_ALARM_DARK = {
  red: ['#ff7070', '#3b1919', '#2b0505'],
  orange: ['#ff9a5c', '#3a2312', '#2e1200'],
  amber: ['#e4b545', '#372b10', '#2e2000'],
  blue: ['#70b2f6', '#14283f', '#041a33'],
  purple: ['#b794f4', '#2a2040', '#1d0a3a'],
  teal: ['#3ab1c1', '#12333a', '#04191d'],
  gray: ['#a5b3b8', '#2a3236', '#10181b'],
  green: ['#52c672', '#15321e', '#052010'],
};

/** Trộn `fg` lên `bg` với độ phủ `a` (nền nhạt của chuỗi industrial). */
function mix(fg, bg, a) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [f, b] = [p(fg), p(bg)];
  return `#${f
    .map((c, i) => Math.round(c * a + b[i] * (1 - a)))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

function industrial(dark) {
  const base = dark ? INDUSTRIAL_DARK : INDUSTRIAL_LIGHT;
  const chart = dark ? INDUSTRIAL_CHART_DARK : INDUSTRIAL_CHART_LIGHT;
  const alarm = dark ? INDUSTRIAL_ALARM_DARK : INDUSTRIAL_ALARM_LIGHT;
  const t = { ...base };
  chart.forEach((c, i) => {
    t[`chart-${i + 1}`] = c;
    t[`chart-${i + 1}-soft`] = mix(c, base.surface, dark ? 0.22 : 0.14);
  });
  // Thang tuần tự teal (nhấn petrol), phân kỳ đỏ ↔ xanh, giữa là nền phụ.
  scales(t, 'teal', dark, base['surface-2']);
  for (const c of ALARMS) {
    const [bg, soft, ink] = alarm[c];
    t[`alarm-${c}`] = bg;
    t[`alarm-${c}-soft`] = soft;
    t[`alarm-${c}-ink`] = ink;
  }
  // Card industrial không có bóng (giữ giao diện cũ).
  t['shadow-card'] = 'none';
  return tiles(t);
}

function scales(t, seqHue, dark, mid) {
  for (let i = 1; i <= 9; i++) t[`seq-${i}`] = rx(seqHue, i + 2, dark);
  const div = [
    rx('red', 11, dark),
    rx('red', 9, dark),
    rx('red', 7, dark),
    rx('red', 5, dark),
    mid,
    rx('blue', 5, dark),
    rx('blue', 7, dark),
    rx('blue', 9, dark),
    rx('blue', 11, dark),
  ];
  div.forEach((c, i) => (t[`div-${i + 1}`] = c));
}

// ---- vivid và dark từ Radix ----
const CHART_HUES = [
  'blue',
  'teal',
  'green',
  'amber',
  'orange',
  'red',
  'crimson',
  'pink',
  'violet',
  'indigo',
  'cyan',
  'lime',
];
const ALARM_HUES = {
  red: 'red',
  orange: 'orange',
  amber: 'amber',
  blue: 'blue',
  purple: 'violet',
  teal: 'teal',
  gray: 'slate',
  green: 'green',
};

// Nền của chủ đề dark (feature 014, phản hồi 2026-10-20): xám xanh như dashboard tham khảo thay cho slate gần đen của
// Radix; khung (surface) sáng hơn nền trang, thanh tiêu đề khung (surface-2) sáng hơn khung một bậc, chữ phụ xám.
const DARK_BASE = {
  bg: '#1f2a33',
  surface: '#2b3640',
  'surface-2': '#33414d',
  text: '#e8eef3',
  'text-muted': '#a7b4be',
  border: '#3d4b57',
  'border-strong': '#5b6b78',
};

function radixTheme(dark) {
  const g = (s) => rx('slate', s, dark);
  const surface = dark ? DARK_BASE.surface : '#ffffff';
  const t = dark
    ? { ...DARK_BASE }
    : {
        bg: g(2),
        surface,
        'surface-2': g(3),
        text: g(12),
        'text-muted': g(11),
        border: g(6),
        'border-strong': g(8),
      };
  const accent = dark
    ? solid('blue', true, DARK_BASE.bg, surface, 4.5)
    : solid('indigo', false, undefined, surface);
  t.accent = accent.bg;
  t['accent-ink'] = accent.ink;
  for (const [k, hue] of [
    ['good', 'green'],
    ['warn', 'amber'],
    ['bad', 'red'],
  ]) {
    t[`${k}-soft`] = rx(hue, 3, dark);
    t[k] = textOn(hue, [t.bg, surface, t[`${k}-soft`]], dark);
  }
  t.info = textOn('blue', [t.bg, surface], dark);
  t.online = pick('orange', dark ? [9, 10, 11] : [9, 10, 11], surface, 3, dark);
  t.offline = g(11);
  CHART_HUES.forEach((hue, i) => {
    t[`chart-${i + 1}`] = pick(hue, [9, 10, 11], surface, 3, dark);
    t[`chart-${i + 1}-soft`] = rx(hue, 3, dark);
  });
  scales(t, 'blue', dark, t['surface-2']);
  for (const [c, hue] of Object.entries(ALARM_HUES)) {
    const s = solid(hue, dark, dark ? DARK_BASE.bg : undefined, surface);
    t[`alarm-${c}`] = s.bg;
    t[`alarm-${c}-soft`] = rx(hue, 3, dark);
    t[`alarm-${c}-ink`] = s.ink;
  }
  t.scrim = dark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(17, 17, 19, 0.4)';
  t.shadow = dark
    ? '0 12px 32px rgba(0, 0, 0, 0.6), 0 2px 6px rgba(0, 0, 0, 0.45)'
    : '0 12px 32px rgba(16, 24, 40, 0.16), 0 2px 6px rgba(16, 24, 40, 0.08)';
  t['shadow-card'] = dark
    ? '0 1px 2px rgba(0, 0, 0, 0.5), 0 4px 12px rgba(0, 0, 0, 0.35)'
    : '0 1px 2px rgba(16, 24, 40, 0.06), 0 4px 12px rgba(16, 24, 40, 0.08)';
  t.radius = '6px';
  t['radius-lg'] = '10px';
  t.font = `'Inter Variable', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`;
  t['font-mono'] = FONT_MONO;
  t.motion = '200ms';
  return tiles(t);
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
  `/* ${what}\n   SINH TỰ ĐỘNG bởi tools/gen-theme-tokens.mjs (feature 012, research R3): không sửa tay, sửa script rồi chạy lại. */\n`;

function industrialCss() {
  const light = {
    ...industrial(false),
    radius: '4px',
    'radius-lg': '4px',
    font: INDUSTRIAL_FONT,
    'font-mono': FONT_MONO,
    motion: '120ms',
  };
  const dark = industrial(true);
  return [
    HEADER(
      'Chủ đề industrial (Công nghiệp trầm): giá trị token có từ trước, mặc định khi không đặt data-mat-theme.\n   Sáng/tối theo :root[data-theme] và prefers-color-scheme như cũ; cùng giá trị với apps/studio/src/theme/tokens.css.',
    ),
    rule(':where(:root)', light),
    '',
    `@media (prefers-color-scheme: dark) {\n${rule(":where(:root:not([data-theme='light']))", dark, '  ')}\n}`,
    '',
    rule(":where(:root[data-theme='dark'])", dark),
    '',
    reduced(':where(:root)'),
    '',
  ].join('\n');
}
function radixCss(name, title, dark) {
  const sel = `:where(:root[data-mat-theme='${name}'])`;
  return [
    HEADER(
      `Chủ đề ${name} (${title}): Radix Colors 3.0.0 (MIT), áp khi :root[data-mat-theme='${name}']. Khai đủ mọi token\n   để không lẫn với industrial tối theo chế độ tối của hệ điều hành.`,
    ),
    rule(sel, radixTheme(dark)),
    '',
    reduced(sel),
    '',
  ].join('\n');
}

const outputs = {
  'themes/industrial.css': industrialCss(),
  'themes/vivid.css': radixCss('vivid', 'Sáng đa sắc', false),
  'themes/dark.css': radixCss('dark', 'Tối', true),
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
