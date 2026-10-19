// Sinh phông Inter tĩnh cho báo cáo PDF (feature 012, T049, research R4/R6): pdfmake cần TTF tĩnh đủ glyph trong
// MỘT tệp mỗi kiểu (bản woff2 của trang chia ba tập con và là phông biến thiên, không dùng được). Lấy Inter 4.1
// (OFL-1.1, https://github.com/rsms/inter/releases/tag/v4.1, tệp extras/ttf/Inter-{Regular,SemiBold,Italic}.ttf) rồi
// cắt còn Latin, Latin mở rộng, tiếng Việt, dấu câu, đơn vị đo thường gặp; bỏ hinting (PDF không cần).
//
// Chạy (một lần, kết quả đã commit ở packages/report-export/src/pdf/fonts/):
//   mkdir C:\build\tmp-inter-tool && cd C:\build\tmp-inter-tool && npm i subset-font@2.9.0
//   node <repo>/tools/fonts/subset-inter-pdf.mjs <thư mục có 3 tệp TTF> <repo>/packages/report-export/src/pdf/fonts
// (subset-font được nạp từ thư mục hiện hành, không phải phụ thuộc của repo.)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('dùng: node subset-inter-pdf.mjs <thư mục TTF nguồn> <thư mục ra>');
  process.exit(2);
}
const subsetFont = createRequire(join(process.cwd(), 'x.js'))('subset-font');

const RANGES = [
  [0x20, 0x7e],
  [0xa0, 0x24f], // Latin-1, Latin mở rộng A, B
  [0x259, 0x259],
  [0x2bb, 0x2bc],
  [0x2c6, 0x2dd],
  [0x300, 0x36f], // dấu kết hợp
  [0x394, 0x394], // Δ
  [0x3a9, 0x3a9], // Ω
  [0x3bc, 0x3bc], // µ
  [0x1e00, 0x1eff], // Latin mở rộng bổ sung (đủ tiếng Việt)
  [0x2000, 0x206f], // dấu câu chung
  [0x20ab, 0x20ac], // ₫ €
  [0x2103, 0x2103], // ℃
  [0x2116, 0x2116],
  [0x2122, 0x2122],
  [0x2126, 0x2126],
  [0x2190, 0x2195],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
  [0x2248, 0x2248],
  [0x2260, 0x2265],
  [0x25b2, 0x25bc], // ▲ ▼ (xu hướng)
];
let text = '';
for (const [a, b] of RANGES) for (let c = a; c <= b; c++) text += String.fromCodePoint(c);

const KEEP = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'mark', 'mkmk', 'tnum', 'case'];
for (const name of ['Inter-Regular', 'Inter-SemiBold', 'Inter-Italic']) {
  const input = readFileSync(join(src, `${name}.ttf`));
  const buf = await subsetFont(input, text, {
    targetFormat: 'truetype',
    keepFeatures: KEEP,
    noHinting: true,
  });
  writeFileSync(join(out, `${name}.ttf`), buf);
  console.log(`${name}.ttf: ${input.length} -> ${buf.length} B`);
}
