// So ảnh nghiệm thu nhập SVG (feature 008, T051/T052, FR-061, SC-001, SC-002).
// Với mỗi fixture trong manifest.json: nhập bằng importSvg, dựng bản gốc và bản đã nhập trong Chrome headless
// (1200 x 800, nền trắng) và đếm điểm ảnh khác (kênh lệch lớn nhất > 64/255, trừ vùng `allowedDiff`).
// Ngưỡng: <= 0,5 % giữa bản gốc và bản đã nhập; với 4 fixture Inkscape thêm <= 3 % giữa PNG của Inkscape
// (`*.ref.png`) và ảnh Chrome của bản đã nhập.
// Dùng: node tools/svg-import/compare-images.mjs [--dir tests/fixtures/svg-import] [--out docs/reports/008-fixtures.json]
//       [--keep <thư mục ghi SVG>] [--only <tên file>] [--optimize]
//       [--file <svg lẻ> --max-pct 1 --gate-tol 16]   (file stress T054: không dùng manifest)
// Mã thoát: 0 = mọi fixture đạt; 1 = có fixture không đạt; 2 = lỗi chạy.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { dataUrl, diffImages, installDom, launchChrome, shoot, H, W } from './chrome-util.mjs';

installDom();
const { importSvg } = await import('../../packages/svg-import/src/index.ts');

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args.splice(i, 2)[1] : '';
};
const flag = (n) => {
  const i = args.indexOf(n);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const optimize = flag('--optimize');
const dir = resolve(
  opt('--dir') || resolve(import.meta.dirname, '../../tests/fixtures/svg-import'),
);
const out = opt('--out');
const keep = opt('--keep');
const only = opt('--only');
const single = opt('--file'); // một file lẻ (ví dụ file stress của T054), không cần manifest
const maxPctOpt = opt('--max-pct');
const gateTolOpt = opt('--gate-tol');

/** Tỉ lệ điểm ảnh không trắng (kiểm ảnh có nội dung, tránh "giống nhau vì cùng trống"). */
function inkPct(img) {
  let n = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const o = i * img.bpp;
    if (img.px[o] < 250 || img.px[o + 1] < 250 || img.px[o + 2] < 250) n++;
  }
  return Math.round((n / (img.w * img.h)) * 10000) / 100;
}

const MAX_VS_ORIGINAL = maxPctOpt ? Number(maxPctOpt) : 0.5;
const GATE_TOL = gateTolOpt ? Number(gateTolOpt) : 64;
const MAX_VS_INKSCAPE = 3;

const manifest = single
  ? { fixtures: [{ file: basename(single), generator: 'file lẻ', real: false }] }
  : JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const base = single ? dirname(resolve(single)) : dir;
const { browser, version } = await launchChrome();
const results = [];
try {
  const page = await browser.newPage();
  for (const fx of manifest.fixtures) {
    if (only && fx.file !== only) continue;
    const bytes = readFileSync(join(base, fx.file));
    const r = importSvg(bytes, { fileName: fx.file, optimize });
    const row = {
      file: fx.file,
      generator: fx.generator,
      real: fx.real,
      importOk: r.ok,
      allowedDiff: fx.allowedDiff ?? [],
    };
    results.push(row);
    if (!r.ok) {
      row.error = r.error;
      row.pass = false;
      continue;
    }
    const skip = row.allowedDiff.map((d) => d.rect);
    row.codes = [
      ...new Set([
        ...r.report.removed.map((x) => x.code),
        ...r.report.converted.map((x) => x.code),
        ...r.report.warnings.map((x) => x.code),
      ]),
    ].sort();
    row.optimize = r.report.optimize;
    row.bytesImported = Buffer.byteLength(r.svg);
    row.elements = { before: r.report.counts.elementsBefore, after: r.report.counts.elementsAfter };
    try {
      const orig = await shoot(page, dataUrl(bytes));
      const imp = await shoot(page, dataUrl(Buffer.from(r.svg, 'utf8')));
      const d64 = diffImages(orig, imp, skip, GATE_TOL);
      row.vsOriginal = {
        gate: d64,
        tol64: diffImages(orig, imp, skip, 64),
        tol16: diffImages(orig, imp, skip, 16),
        tol0: diffImages(orig, imp, skip, 0),
      };
      row.vsOriginal.pct = d64.pct;
      row.inkPct = inkPct(orig); // đối chứng: ảnh gốc không trống
      let pass = d64.pct <= MAX_VS_ORIGINAL && row.inkPct > 1;
      if (fx.refPng) {
        const ref = await shoot(page, dataUrl(readFileSync(join(dir, fx.refPng)), 'image/png'));
        const v = diffImages(ref, imp, skip, 64);
        row.vsInkscape = {
          ...v,
          tol16: diffImages(ref, imp, skip, 16),
          origVsInkscape: diffImages(ref, orig, skip, 64),
        };
        pass = pass && v.pct <= MAX_VS_INKSCAPE;
      }
      row.pass = pass;
      if (keep) {
        mkdirSync(resolve(keep), { recursive: true });
        const stem = fx.file.replace(/\.svg$/, '');
        writeFileSync(join(resolve(keep), `${stem}.imported.svg`), r.svg);
      }
    } catch (e) {
      row.pass = false;
      row.error = { message: String(e instanceof Error ? e.message : e) };
    }
    const vi = row.vsInkscape ? ` | vs Inkscape ${row.vsInkscape.pct.toFixed(3)} %` : '';
    console.log(
      `${row.pass ? 'ĐẠT ' : 'LỖI '} ${fx.file}: vs bản gốc ${row.vsOriginal?.pct.toFixed(3) ?? '?'} %${vi}`,
    );
  }
} finally {
  await browser.close();
}

const summary = {
  feature: '008-svg-import-binding',
  task: 'T051/T052',
  chrome: version,
  size: [W, H],
  optimize,
  thresholds: {
    vsOriginalPct: MAX_VS_ORIGINAL,
    vsInkscapePct: MAX_VS_INKSCAPE,
    channelDelta: GATE_TOL,
  },
  note: 'Illustrator và CorelDRAW là file MÔ PHỎNG viết tay: kết quả là "đạt trên mô phỏng", không phải trên file do phần mềm thật xuất.',
  pass: results.length > 0 && results.every((x) => x.pass),
  fixtures: results,
};
if (out) {
  mkdirSync(resolve(out, '..'), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(summary, null, 2) + '\n');
  console.log('Đã ghi', out);
}
console.log(summary.pass ? 'TẤT CẢ ĐẠT' : 'CÓ FIXTURE KHÔNG ĐẠT');
process.exit(summary.pass ? 0 : 1);
