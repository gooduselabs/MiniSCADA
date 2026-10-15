// Sinh src/symbols-data.ts từ manifest.json và svg/*.svg (tất định: sắp xếp theo đường dẫn).
// Chạy: node packages/symbol-library/scripts/gen-data.mjs  (test kiểm dữ liệu khớp tệp).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));

const files = new Set();
for (const s of manifest.symbols) {
  files.add(s.file);
  for (const v of s.variants ?? []) files.add(v.file);
}

const svg = {};
for (const f of [...files].sort()) svg[f] = readFileSync(resolve(root, f), 'utf8');

const out =
  '// TỆP SINH TỰ ĐỘNG bởi scripts/gen-data.mjs từ manifest.json và svg/*.svg. KHÔNG sửa tay.\n' +
  `export const MANIFEST_DATA = ${JSON.stringify(manifest, null, 2)};\n\n` +
  `export const SVG_DATA: Record<string, string> = ${JSON.stringify(svg, null, 2)};\n`;

writeFileSync(resolve(root, 'src/symbols-data.ts'), out);
console.log(`symbols-data.ts: ${manifest.symbols.length} ký hiệu, ${files.size} tệp SVG`);
