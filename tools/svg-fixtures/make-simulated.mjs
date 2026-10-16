// Sinh tất định 6 fixture MÔ PHỎNG Illustrator/CorelDRAW (feature 008, T034) từ khuôn src/*.tmpl.svg.
// Đây KHÔNG phải file do Illustrator hay CorelDRAW xuất: xem tests/fixtures/svg-import/README.md.
// Chạy: node tools/svg-fixtures/make-simulated.mjs [--check]   (--check: so với file đã có, không ghi)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'tests', 'fixtures', 'svg-import');

// PNG 48 x 32 do dự án tạo (ô bàn cờ), CC0.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAASElEQVR4nO3OMQ0AMAwDwcAJpqILuuIogXisPPgljy/5qs+su9PrfvcFCBCgOJDrWPWAAAHKA7mOVQ8IEKA8kOtY9YAAAYoDPV9kcHlY3QypAAAAAElFTkSuQmCC';

const SIM_NOTE =
  '<!-- MÔ PHỎNG viết tay đặc trưng cấu trúc đã biết của phần mềm; KHÔNG phải file do phần mềm thật xuất (feature 008, D23). -->';

// Khối dữ liệu giả cho i:pgf (tất định, ~2 KiB) để tái tạo "khối dữ liệu chỉnh sửa riêng".
const PGF_BLOB = Array.from(
  { length: 24 },
  (_, i) => `PGF-MOPHONG-${String(i).padStart(3, '0')}-${'A1B2C3D4'.repeat(8)}`,
).join('\n\t');

const NESTED_OPEN = Array.from({ length: 9 }, (_, i) => `<g id="Lop_${i + 1}">`).join('\n  ');
const NESTED_CLOSE = Array.from({ length: 9 }, () => '</g>').join('\n  ');

/** Tên file kết quả -> khuôn. */
export const OUTPUTS = [
  'illustrator-01-saveas-legacy',
  'illustrator-02-export-cls',
  'illustrator-03-export-screens',
  'corel-01-mm-css',
  'corel-02-curves-clip',
  'corel-03-blend-pattern',
];

export function render(name) {
  const tmpl = readFileSync(join(here, 'src', `${name}.tmpl.svg`), 'utf8').replace(/\r\n/g, '\n');
  return tmpl
    .split('{{SIM_NOTE}}')
    .join(SIM_NOTE)
    .split('{{PNG}}')
    .join(PNG_B64)
    .split('{{PGF_BLOB}}')
    .join(PGF_BLOB)
    .split('{{NESTED_OPEN}}')
    .join(NESTED_OPEN)
    .split('{{NESTED_CLOSE}}')
    .join(NESTED_CLOSE);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const name of OUTPUTS) {
    const text = render(name);
    const file = join(outDir, `${name}.svg`);
    if (check) {
      const same = existsSync(file) && readFileSync(file, 'utf8') === text;
      if (!same) bad++;
      console.log(`${same ? 'OK ' : 'LECH'} ${name}.svg`);
    } else {
      writeFileSync(file, text, 'utf8');
      console.log(`ghi ${name}.svg (${Buffer.byteLength(text)} byte)`);
    }
  }
  if (bad > 0) process.exit(1);
}
