// Spike T007 (feature 008, research R5, R6; ADR-023): mô phỏng bước Tối ưu (gộp phần tử liền kề) và gán UID
// trên file stress rồi đo số phần tử, kích thước và độ khác ảnh trên Chrome.
// Dùng: node tools/svg-import/spike-optimize.mjs [file.svg] [--out docs/reports/008-spike-optimize.json] [--keep <thư mục>]
// Mặc định đọc tests/fixtures/svg/factory-isometric-stress.svg (chỉ đọc, không sửa). Đây là mô phỏng chạy trong Chrome
// (DOM thật + getComputedStyle để "giải" cascade), KHÔNG phải mã sản phẩm optimizeSvg của @mat/svg-import (T047).
// Chrome lấy từ CHROME_PATH hoặc đường dẫn cài đặt mặc định. Mã thoát: 0 = có kịch bản đạt điều kiện; 1 = không có; 2 = lỗi chạy.
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { decodePng } from './png-decode.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : '';
};
const out = opt('--out');
const keepDir = opt('--keep');
const file = resolve(
  args[0] ?? resolve(import.meta.dirname, '../../tests/fixtures/svg/factory-isometric-stress.svg'),
);
const MAX_NODES = 20000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DIFF_PCT = 1;
const TOLERANCE = 16; // một điểm ảnh "khác" khi có kênh lệch hơn 16/255 (ghi cả ngưỡng 0 và 64)

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error('Không tìm thấy Chrome; đặt CHROME_PATH.');
  process.exit(2);
}
if (!existsSync(file)) {
  console.error(`Không thấy file: ${file}`);
  process.exit(2);
}

// Kịch bản: cách xử lý `id` (R5 viết "không id" nhưng Inkscape gán id cho mọi phần tử) và rào chắn hình học.
//  idMode none: phần tử có id không gộp (R5 nguyên văn)
//  idMode auto: id sinh tự động (mẫu "không nghĩa" của R6) và không bị tham chiếu thì bỏ id và cho gộp
//  idMode any: mọi id không bị tham chiếu thì cho gộp (cận trên)
//  safe: không gộp phần tử vừa có nền vừa có nét (nét vẽ sau nền của từng hình khác nét vẽ sau mọi nền của hình gộp)
const scenarios = [
  { name: 'R5 nguyên văn (không id)', idMode: 'none', safe: false },
  { name: 'id tự sinh, không bị tham chiếu', idMode: 'auto', safe: false },
  { name: 'id tự sinh + rào nền/nét', idMode: 'auto', safe: true },
  { name: 'mọi id không bị tham chiếu (cận trên)', idMode: 'any', safe: false },
];

// ---------- chạy trong trang: gộp, gán UID, đo ----------
function inPage(sc) {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const root = document.documentElement;
  const AUTO_ID =
    /^(path|rect|g|circle|ellipse|line|polygon|polyline|text|use|image|tspan)[0-9]+(-[0-9]+)?$/;
  const MERGE_TAGS = new Set(['line', 'polyline', 'polygon', 'path']);
  const NO_DESCEND = new Set([
    'defs',
    'clipPath',
    'mask',
    'symbol',
    'pattern',
    'marker',
    'style',
    'metadata',
    'filter',
    'linearGradient',
    'radialGradient',
  ]);
  const ATTACHABLE = new Set([
    'g',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'path',
    'text',
    'use',
    'image',
  ]);
  const INHERITED = [
    'fill',
    'fill-rule',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'clip-rule',
    'shape-rendering',
    'visibility',
  ];
  const OWN = [
    'opacity',
    'fill-opacity',
    'stroke-opacity',
    'clip-path',
    'mask',
    'filter',
    'display',
    'marker-start',
    'marker-mid',
    'marker-end',
    'mix-blend-mode',
    'vector-effect',
    'paint-order',
  ];
  const countAll = () => document.querySelectorAll('*').length;
  const countNode = () =>
    [...document.querySelectorAll('*')].filter(
      (e) => !['style', 'metadata', 'title', 'desc', 'namedview'].includes(e.localName),
    ).length;
  const before = { all: countAll(), node: countNode() };

  // Tập id bị tham chiếu (url(#id), href="#id", bộ chọn #id trong <style>)
  const referenced = new Set();
  const scanText = (t) => {
    for (const m of t.matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)) referenced.add(m[1]);
    for (const m of t.matchAll(/#([A-Za-z_][\w-]*)\s*[{,]/g)) referenced.add(m[1]);
  };
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (a.name === 'href' || a.name === 'xlink:href') {
        if (a.value.startsWith('#')) referenced.add(a.value.slice(1));
      } else scanText(a.value);
    }
    if (el.localName === 'style') scanText(el.textContent);
  }

  const idOk = (el) => {
    const id = el.getAttribute('id');
    if (id === null) return true;
    if (referenced.has(id)) return false;
    if (sc.idMode === 'none') return false;
    if (sc.idMode === 'auto') return AUTO_ID.test(id);
    return true;
  };
  const hasData = (el) => [...el.attributes].some((a) => a.name.startsWith('data-'));
  const numOne = (s) => s === '1' || s === '';
  const cs = (el) => getComputedStyle(el);
  const mergeable = (el) => {
    if (!MERGE_TAGS.has(el.localName) || !idOk(el) || hasData(el)) return null;
    const st = cs(el);
    if (!numOne(st.opacity) || !numOne(st.fillOpacity) || !numOne(st.strokeOpacity)) return null;
    if (st.display === 'none' || st.visibility !== 'visible') return null;
    if (
      st.filter !== 'none' ||
      st.mask !== 'none' ||
      st.markerStart !== 'none' ||
      st.markerMid !== 'none' ||
      st.markerEnd !== 'none'
    )
      return null;
    if (sc.safe && st.fill !== 'none' && st.stroke !== 'none') return null;
    const key = [
      el.getAttribute('transform') ?? '',
      ...INHERITED.map((p) => st.getPropertyValue(p)),
      ...OWN.map((p) => st.getPropertyValue(p)),
    ].join('|');
    return key;
  };
  const toD = (el) => {
    const g = (n) => el.getAttribute(n) ?? '0';
    switch (el.localName) {
      case 'line':
        return `M${g('x1')} ${g('y1')}L${g('x2')} ${g('y2')}`;
      case 'polyline':
      case 'polygon': {
        const n = (el.getAttribute('points') ?? '').split(/[\s,]+/).filter(Boolean);
        if (n.length < 4) return '';
        let d = `M${n[0]} ${n[1]}`;
        for (let i = 2; i + 1 < n.length; i += 2) d += `L${n[i]} ${n[i + 1]}`;
        return el.localName === 'polygon' ? `${d}Z` : d;
      }
      default:
        // `m` đầu tiên của một path độc lập là tuyệt đối; khi nối phía sau phải đổi thành `M`
        return (el.getAttribute('d') ?? '').trim().replace(/^m/, 'M');
    }
  };
  const mergeRun = (parent, run) => {
    const first = run[0];
    const st = cs(first);
    const ps = cs(parent);
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', run.map(toD).join(''));
    for (const prop of INHERITED) {
      const v = st.getPropertyValue(prop);
      if (v !== ps.getPropertyValue(prop)) p.setAttribute(prop, v.replace(/^(-?[\d.]+)px$/, '$1'));
    }
    const t = first.getAttribute('transform');
    if (t) p.setAttribute('transform', t);
    parent.insertBefore(p, first);
    for (const e of run) e.remove();
  };
  let runs = 0;
  let removed = 0;
  const walk = (parent) => {
    if (NO_DESCEND.has(parent.localName)) return;
    let run = [];
    let key = null;
    const flush = () => {
      if (run.length >= 2) {
        mergeRun(parent, run);
        runs++;
        removed += run.length - 1;
      }
      run = [];
      key = null;
    };
    for (const ch of [...parent.children]) {
      const k = mergeable(ch);
      if (k !== null && k === key) run.push(ch);
      else {
        flush();
        if (k !== null) {
          run = [ch];
          key = k;
        } else walk(ch);
      }
    }
    flush();
  };
  walk(root);
  const after = { all: countAll(), node: countNode() };

  // Gán UID cho phần tử gắn được (R6) và đo kích thước
  const b32 = 'abcdefghijklmnopqrstuvwxyz234567';
  const uid = () => {
    const b = crypto.getRandomValues(new Uint8Array(10));
    return `el_${[...b].map((x) => b32[x & 31]).join('')}`;
  };
  const inDefs = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement)
      if (NO_DESCEND.has(p.localName)) return true;
    return false;
  };
  const attachable = [...document.querySelectorAll('*')].filter(
    (e) => e.namespaceURI === SVGNS && ATTACHABLE.has(e.localName) && !inDefs(e),
  );
  const ser = () =>
    new TextEncoder().encode(new XMLSerializer().serializeToString(document)).length;
  const sizeMerged = ser();
  for (const e of attachable) e.setAttribute('data-mat-uid', uid());
  const sizeUid = ser();
  // Tên: chỉ phần tử có nhãn (inkscape:label, data-name, id có nghĩa)
  let named = 0;
  for (const e of attachable) {
    const id = e.getAttribute('id');
    const name =
      e.getAttribute('inkscape:label') ||
      e.getAttribute('data-name') ||
      (id && !AUTO_ID.test(id) && !/^SVGID_\d+_$|^Layer_\d+$|^_\d+_?$/.test(id) ? id : '');
    if (name) {
      e.setAttribute('data-mat-name', name.slice(0, 80));
      named++;
    }
  }
  const sizeUidName = ser();
  // Xấp xỉ đầu ra importer: bỏ thuộc tính inkscape:/sodipodi:, namedview, metadata, id tự sinh không bị tham chiếu
  for (const e of document.querySelectorAll('namedview, metadata')) e.remove();
  for (const e of document.querySelectorAll('*')) {
    for (const a of [...e.attributes]) {
      if (a.name.startsWith('inkscape:') || a.name.startsWith('sodipodi:'))
        e.removeAttribute(a.name);
    }
    const id = e.getAttribute('id');
    if (id && AUTO_ID.test(id) && !referenced.has(id)) e.removeAttribute('id');
  }
  const sizeNormalized = ser();
  return {
    before,
    after,
    runs,
    removed,
    attachable: attachable.length,
    named,
    sizeMerged,
    sizeUid,
    sizeUidName,
    sizeNormalized,
    svgText: new XMLSerializer().serializeToString(document),
  };
}

function diffImages(a, b) {
  const res = { total: a.w * a.h, w: a.w, h: a.h };
  if (a.w !== b.w || a.h !== b.h) return { ...res, error: 'kích thước ảnh khác nhau' };
  const th = [0, TOLERANCE, 64];
  const cnt = th.map(() => 0);
  const bpp = a.bpp;
  for (let i = 0; i < a.w * a.h; i++) {
    const o = i * bpp;
    const d = Math.max(
      Math.abs(a.px[o] - b.px[o]),
      Math.abs(a.px[o + 1] - b.px[o + 1]),
      Math.abs(a.px[o + 2] - b.px[o + 2]),
    );
    for (let k = 0; k < th.length; k++) if (d > th[k]) cnt[k]++;
  }
  return {
    ...res,
    diffTol0: cnt[0],
    diffTol0Pct: (cnt[0] / res.total) * 100,
    diffTolPct: (cnt[1] / res.total) * 100,
    diffTolCount: cnt[1],
    diffTol64Pct: (cnt[2] / res.total) * 100,
  };
}

const workDir = keepDir ? resolve(keepDir) : mkdtempSync(join(tmpdir(), 'svg-optimize-'));
mkdirSync(workDir, { recursive: true });
const report = {
  file,
  fileBytes: statSync(file).size,
  limits: {
    maxNodes: MAX_NODES,
    maxBytes: MAX_BYTES,
    maxDiffPct: MAX_DIFF_PCT,
    tolerance: TOLERANCE,
  },
  scenarios: [],
};
const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  report.browserVersion = await browser.version();
  report.measuredAt = new Date().toISOString();
  console.log(`${report.browserVersion} | ${file} | ${report.fileBytes} byte`);
  const page = await browser.newPage();
  const shotOf = async (url) => {
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'load', timeout: 120000 });
    await page.evaluate(() => document.documentElement.pauseAnimations?.());
    return decodePng(Buffer.from(await page.screenshot({ type: 'png', timeout: 120000 })));
  };
  const fileUrl = pathToFileURL(file).href;
  const original = await shotOf(fileUrl);
  // Hai lần chụp liên tiếp phải giống nhau (tách nhiễu của chính Chrome ra khỏi phép so)
  report.baseNoise = diffImages(original, await shotOf(fileUrl));
  console.log(`Nhiễu nền (chụp lại bản gốc): ${report.baseNoise.diffTol0} điểm khác ở ngưỡng 0`);

  for (const [i, sc] of scenarios.entries()) {
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 120000 });
    const r = await page.evaluate(inPage, sc);
    const outFile = join(workDir, `optimized-${i}.svg`);
    writeFileSync(outFile, r.svgText);
    const m = { ...r };
    delete m.svgText;
    const img = diffImages(original, await shotOf(pathToFileURL(outFile).href));
    const nodes = m.after.node;
    const row = {
      ...sc,
      ...m,
      image: img,
      okNodes: nodes <= MAX_NODES,
      okImage: img.diffTolPct <= MAX_DIFF_PCT,
      okSize: m.sizeUidName <= MAX_BYTES,
    };
    row.pass = row.okNodes && row.okImage && row.okSize;
    report.scenarios.push(row);
    console.log(
      `${row.pass ? 'ĐẠT ' : 'LỖI '} [${sc.name}] phần tử ${m.before.all} -> ${m.after.all} (node ${m.before.node} -> ${nodes}; ${m.runs} nhóm gộp, bớt ${m.removed}); ` +
        `ảnh khác ${img.diffTolPct.toFixed(3)} % (ngưỡng ${TOLERANCE}), ${img.diffTol0Pct.toFixed(3)} % (ngưỡng 0), ${img.diffTol64Pct.toFixed(3)} % (ngưỡng 64); ` +
        `byte: gộp ${m.sizeMerged}, +UID ${m.sizeUid} (${m.attachable} phần tử gắn được, ${((m.sizeUid - m.sizeMerged) / m.attachable).toFixed(1)} byte/phần tử), +tên ${m.sizeUidName} (${m.named} tên), xấp xỉ chuẩn hóa ${m.sizeNormalized}`,
    );
  }
  report.anyPass = report.scenarios.some((s) => s.pass);
  report.workDir = workDir;
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  }
  process.exitCode = report.anyPass ? 0 : 1;
} catch (err) {
  console.error(err);
  process.exitCode = 2;
} finally {
  await browser.close();
}
