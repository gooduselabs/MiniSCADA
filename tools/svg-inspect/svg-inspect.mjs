// Kiểm tra SVG từ nhiều phần mềm vẽ: nhận diện phần mềm xuất, cảnh báo khác biệt định dạng,
// liệt kê những gì bộ lọc sẽ loại. Dùng chung inspect.ts/sanitize.ts với trang thử (Node ≥ 24 chạy thẳng .ts).
// Dùng: node tools/svg-inspect/svg-inspect.mjs <file.svg|thư mục>... [--json kết-quả.json]
// Mã thoát: 0 = đã phân tích hết; 1 = có file không đọc/parse được.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { inspectSvg } = await import('../../packages/svg-renderer/src/inspect.ts');
const { parseSvg, sanitizeSvg } = await import('../../packages/svg-renderer/src/sanitize.ts');

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args.splice(jsonIdx, 2)[1] : '';
if (!args.length) {
  console.error(
    'Usage: node tools/svg-inspect/svg-inspect.mjs <file.svg|thư mục>... [--json out.json]',
  );
  process.exit(2);
}

const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) walk(join(p, f));
  else if (p.toLowerCase().endsWith('.svg')) files.push(p);
};
for (const a of args) walk(resolve(a));

const results = [];
let failed = 0;
for (const file of files) {
  try {
    const text = readFileSync(file, 'utf8');
    const inspection = inspectSvg(parseSvg(text), text);
    const removed = sanitizeSvg(parseSvg(text)); // trên bản sao: chỉ để biết bộ lọc sẽ loại gì
    results.push({
      file,
      ...inspection,
      removed: removed.removedElements,
      removedAttributes: removed.removedAttributes,
    });

    console.log(`\n■ ${file}`);
    console.log(
      `  Nguồn: ${inspection.generator} (${inspection.certainty})` +
        ` · ${(inspection.bytes / 1024).toFixed(1)} KB · ${inspection.elements} phần tử · sâu ${inspection.maxDepth}` +
        ` · viewBox: ${inspection.hasViewBox ? 'có' : 'KHÔNG'}${inspection.units ? ` · đơn vị ${inspection.units}` : ''}`,
    );
    if (inspection.fonts.length) console.log(`  Font: ${inspection.fonts.slice(0, 8).join(', ')}`);
    const rm = Object.entries(removed.removedElements).map(([k, v]) => `${k}×${v}`);
    if (removed.removedAttributes) rm.push(`thuộc tính×${removed.removedAttributes}`);
    console.log(`  Bộ lọc sẽ loại: ${rm.join(', ') || '—'}`);
    if (!inspection.warnings.length) console.log('  Không có cảnh báo định dạng.');
    for (const w of inspection.warnings) console.log(`  ⚠ [${w.code}] ${w.message}`);
  } catch (e) {
    failed++;
    console.log(`\n■ ${file}\n  ✗ Không phân tích được: ${e instanceof Error ? e.message : e}`);
  }
}

console.log(
  `\n${files.length} file, ${failed} lỗi, ${results.filter((r) => r.warnings.length).length} có cảnh báo.`,
);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log('Đã ghi', jsonOut);
}
process.exitCode = failed ? 1 : 0;
