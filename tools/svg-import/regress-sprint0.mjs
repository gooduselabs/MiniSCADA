// Hồi quy fixture Sprint 0 (feature 008, T023; FR-023, SC-016): dựng 19 file tests/fixtures/svg/*.svg
// bằng bản `sanitizeSvg` CŨ (denylist, đóng băng ở legacy-sanitize.mjs) và bản MỚI (allowlist, gói
// @mat/svg-renderer), vẽ cả hai trên Chrome headless (cùng khung 512×512, contain), so từng điểm ảnh.
// Mong đợi khác ≤ 0,5 % trừ khi fixture có khai báo khác có chủ ý (ALLOWED_DIFF bên dưới: phần bị loại
// theo allowlist như <style>, <switch>, flowRoot). Ghi kết quả vào docs/reports/008-fixtures.json (mục
// `sprint0`). Dùng: node tools/svg-import/regress-sprint0.mjs [--out docs/reports/008-fixtures.json]
// Mã thoát: 0 = mọi file trong ngưỡng; 1 = có file vượt ngưỡng hoặc không vẽ được; 2 = không chạy được.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import puppeteer from 'puppeteer-core';
import { legacySanitizeSvg } from './legacy-sanitize.mjs';

const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
const XMLSerializer = dom.window.XMLSerializer;
const { parseSvg, sanitizeSvg } = await import('../../packages/svg-renderer/src/sanitize.ts');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = outIdx >= 0 ? args[outIdx + 1] : 'docs/reports/008-fixtures.json';
const DIR = resolve('tests/fixtures/svg');
const SIZE = 512;
const DEFAULT_MAX = 0.5; // %

/** Khác có chủ ý (%): phần tử bị allowlist loại mà bản denylist còn giữ. Lý do ghi ở tasks.md T022. */
const ALLOWED_DIFF = {
  'synthetic-illustrator-saveas.svg': {
    max: 100,
    why: '<switch> bị loại cả cây (hình trong switch mất)',
  },
  'synthetic-illustrator-export.svg': { max: 100, why: '<style> .cls-N bị loại: màu từ class mất' },
  'synthetic-coreldraw.svg': { max: 100, why: '<style> CDATA .fil/.str bị loại: màu từ class mất' },
  'factory-isometric-stress.svg': {
    max: 100,
    why: '8 khối <style> .cls-N bị loại: màu từ class mất',
  },
  'synthetic-inkscape-features.svg': {
    max: DEFAULT_MAX,
    why: 'flowRoot bị loại (Chrome vốn không vẽ flowRoot nên ảnh không đổi)',
  },
  'synthetic-drawio.svg': {
    max: 100,
    why: '<switch>/<foreignObject> bị loại cả cây; <style> bị loại',
  },
  'real-libreoffice-draw.svg': {
    max: DEFAULT_MAX,
    why: '<font> SVG nhúng bị loại (Chrome không dùng font SVG nên ảnh không đổi)',
  },
};

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Không tìm thấy Chrome; đặt CHROME_PATH.');
  process.exit(2);
}

const serialize = (el) => new XMLSerializer().serializeToString(el);
const toDataUrl = (svg) =>
  'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');

const files = readdirSync(DIR)
  .filter((f) => f.toLowerCase().endsWith('.svg'))
  .sort();
const browser = await puppeteer.launch({ executablePath, headless: true });
const results = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: SIZE, height: SIZE });
  await page.setContent('<!doctype html><html><body></body></html>');
  for (const name of files) {
    const text = readFileSync(join(DIR, name), 'utf8');
    const legacyRoot = parseSvg(text);
    const legacyReport = legacySanitizeSvg(legacyRoot);
    const newRoot = parseSvg(text);
    const newReport = sanitizeSvg(newRoot);
    const r = {
      file: name,
      legacyRemoved: legacyReport.removedElements,
      newRemoved: newReport.removedElements,
      newCodes: newReport.codes,
      diffPercent: null,
      drawnPercent: null,
      max: ALLOWED_DIFF[name]?.max ?? DEFAULT_MAX,
      intentional: ALLOWED_DIFF[name]?.why ?? null,
      pass: false,
      error: null,
    };
    try {
      const cmp = await page.evaluate(
        async (a, b, size) => {
          const load = (src) =>
            new Promise((res, rej) => {
              const img = new Image();
              img.onload = () => res(img);
              img.onerror = () => rej(new Error('không vẽ được SVG'));
              img.src = src;
            });
          const draw = async (src) => {
            const img = await load(src);
            const c = document.createElement('canvas');
            c.width = size;
            c.height = size;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            return ctx.getImageData(0, 0, size, size).data;
          };
          const [pa, pb] = await Promise.all([draw(a), draw(b)]);
          let diff = 0;
          let drawn = 0;
          const n = size * size;
          for (let i = 0; i < n; i++) {
            const o = i * 4;
            if (pb[o + 3] > 0) drawn++;
            if (
              Math.abs(pa[o] - pb[o]) > 16 ||
              Math.abs(pa[o + 1] - pb[o + 1]) > 16 ||
              Math.abs(pa[o + 2] - pb[o + 2]) > 16 ||
              Math.abs(pa[o + 3] - pb[o + 3]) > 16
            )
              diff++;
          }
          return { diffPercent: (diff / n) * 100, drawnPercent: (drawn / n) * 100 };
        },
        toDataUrl(serialize(legacyRoot)),
        toDataUrl(serialize(newRoot)),
        SIZE,
      );
      r.diffPercent = Number(cmp.diffPercent.toFixed(3));
      r.drawnPercent = Number(cmp.drawnPercent.toFixed(2));
      r.pass = r.diffPercent <= r.max;
    } catch (e) {
      r.error = String(e.message ?? e);
    }
    results.push(r);
    const verdict = r.pass ? 'đạt' : 'VƯỢT';
    const note = r.intentional ? ` (có chủ ý: ${r.intentional})` : '';
    console.log(
      name.padEnd(36),
      r.error
        ? `LỖI ${r.error}`
        : `khác ${String(r.diffPercent).padStart(7)} %  vẽ ${String(r.drawnPercent).padStart(6)} %  ${verdict}${note}`,
    );
  }
} finally {
  await browser.close();
}

const summary = {
  measuredAt: new Date().toISOString(),
  size: SIZE,
  defaultMaxPercent: DEFAULT_MAX,
  files: results.length,
  passed: results.filter((r) => r.pass).length,
  results,
};
let doc = {};
if (existsSync(out)) {
  try {
    doc = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    doc = {};
  }
}
doc.sprint0 = summary;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log(`${summary.passed}/${summary.files} đạt. Đã ghi ${out}`);
process.exitCode = summary.passed === summary.files && summary.files > 0 ? 0 : 1;
