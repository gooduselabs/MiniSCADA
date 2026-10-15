// Kiểm tra SVG từ nhiều phần mềm vẽ: nhận diện phần mềm xuất, cảnh báo khác biệt định dạng,
// liệt kê những gì bộ lọc sẽ loại. Dùng chung inspect.ts/sanitize.ts với trang thử (Node ≥ 24 chạy thẳng .ts).
// Dùng: node tools/svg-inspect/svg-inspect.mjs <file.svg|thư mục>... [--json kết-quả.json]
//       [--import [--optimize] [--report-dir <thư mục>] [--out <thư mục>]]   (feature 008, FR-025)
// --import chạy importSvg của @mat/svg-import trên từng file (thư mục: bỏ qua malicious/ và out/), in tóm tắt,
// ghi báo cáo <tên>.report.md/.json vào --report-dir và SVG đã nhập vào --out.
// Mã thoát: 0 = đã phân tích (nhập) hết; 1 = có file không đọc/parse được (bị từ chối).
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { inspectSvg } = await import('../../packages/svg-renderer/src/inspect.ts');
const { parseSvg, sanitizeSvg } = await import('../../packages/svg-renderer/src/sanitize.ts');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const takeOpt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : '';
};
const doImport = flag('--import');
const doOptimize = flag('--optimize');
const reportDir = takeOpt('--report-dir');
const outDir = takeOpt('--out');
const jsonOut = takeOpt('--json');
if (!args.length) {
  console.error(
    'Usage: node tools/svg-inspect/svg-inspect.mjs <file.svg|thư mục>... [--json out.json]' +
      ' [--import [--optimize] [--report-dir d] [--out d]]',
  );
  process.exit(2);
}

const files = [];
const SKIP_DIRS = new Set(['malicious', 'out']);
const walk = (p) => {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) {
      if (doImport && SKIP_DIRS.has(f) && statSync(join(p, f)).isDirectory()) continue;
      walk(join(p, f));
    }
  } else if (p.toLowerCase().endsWith('.svg')) files.push(p);
};
for (const a of args) walk(resolve(a));

if (doImport) {
  const { importSvg, reportToMarkdown } = await import('../../packages/svg-import/src/index.ts');
  for (const d of [reportDir, outDir]) if (d) mkdirSync(resolve(d), { recursive: true });
  let bad = 0;
  const summary = [];
  for (const file of files) {
    const name = basename(file);
    const stem = name.replace(/\.svg$/i, '');
    const r = importSvg(readFileSync(file), { fileName: name, optimize: doOptimize });
    const rep = r.report;
    summary.push({ file, ok: r.ok, error: r.ok ? undefined : r.error, report: rep });
    if (reportDir) {
      writeFileSync(join(resolve(reportDir), `${stem}.report.json`), JSON.stringify(rep, null, 2));
      writeFileSync(join(resolve(reportDir), `${stem}.report.md`), reportToMarkdown(rep));
    }
    if (r.ok) {
      if (outDir) writeFileSync(join(resolve(outDir), name), r.svg);
      console.log(
        `✓ ${name}: ${rep.generator.name}, ${rep.counts.elementsBefore} -> ${rep.counts.elementsAfter} phần tử,` +
          ` ${rep.counts.uidAssigned} UID, loại ${rep.removed.length} mục, chuyển ${rep.converted.length}, cảnh báo ${rep.warnings.length}`,
      );
    } else {
      bad++;
      console.log(`✗ ${name}: [${r.error.code}] ${r.error.message}`);
    }
  }
  console.log(`\n${files.length} file, ${bad} lỗi.`);
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(summary, null, 2));
  process.exit(bad ? 1 : 0);
}

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
