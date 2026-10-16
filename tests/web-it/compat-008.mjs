// Tương thích 0.1–0.3 của trang với bản trước feature 008 (T107, SC-011): cùng project, cùng giá trị Tag cố định, hai bản trang
// (bản trước 008 build từ commit cuối của 007, và bản hiện tại) trên runtime giả; so phần tử đích, giá trị binding, kiểu hiển thị và
// ảnh chụp (≤ 0,5 % điểm ảnh khác).
//   node tests/web-it/compat-008.mjs --project <tên trong projects/> --old-dist <thư mục dist-device bản cũ> --base <https://127.0.0.1:cổng>
//        [--new-dist apps/runtime-web/dist-device] [--out <thư mục ảnh>]
// `--base` là runtime x64 đang chạy project đó (tests/web-it: tools/web-it.ps1 -Scenario compat): từ đó lấy tài liệu
// `/api/v1/projects/active` (đúng như runtime phục vụ) và giá trị Tag mà trang nhận qua WebSocket; hai trang chạy trên runtime giả
// (apps/runtime-web/tests/e2e/fake-runtime.mjs) với CÙNG tài liệu và CÙNG giá trị (hằng), nên mọi khác biệt là do mã trang.
// In đúng một dòng JSON { scenario, checks, measures, pass }.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startFakeRuntime } from '../../apps/runtime-web/tests/e2e/fake-runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const project = opt('--project', '');
const oldDist = resolve(opt('--old-dist', ''));
const newDist = resolve(opt('--new-dist', join(REPO, 'apps/runtime-web/dist-device')));
const BASE = opt('--base', 'https://127.0.0.1:18443');
const outDir = resolve(opt('--out', join(here, 'out', 'compat-008')));
const checks = [];
const measures = {};
const check = (name, pass, detail = '') =>
  checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : String(detail) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
  .filter(Boolean)
  .find((p) => existsSync(p));

const WS_HOOK = `(function(){
  const L = (window.__live = { tags: {} });
  const Orig = window.WebSocket;
  const Hooked = function (url, protocols) {
    const ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
    let ids = [];
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'snapshot') {
        ids = m.tags.map((t) => t.id);
        for (const t of m.tags) L.tags[t.id] = { value: t.value, quality: t.quality, reason: t.reason };
      } else if (m.type === 'delta') {
        for (const [i, v, q, r] of m.tags) L.tags[ids[i]] = { value: v, quality: q, reason: r };
      }
    });
    return ws;
  };
  Hooked.prototype = Orig.prototype;
  Object.assign(Hooked, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Hooked;
})()`;

/** Mọi phần tử có data-mat-uid ở mọi cấp Shadow DOM: thuộc tính, chữ, kiểu tính toán, hoạt ảnh. */
const SNAP = `(function(){
  const out = {};
  const seen = {};
  const walk = (root) => {
    for (const e of root.querySelectorAll('*')) {
      if (e.hasAttribute('data-mat-uid')) {
        const uid = e.getAttribute('data-mat-uid');
        seen[uid] = (seen[uid] || 0) + 1;
        const key = seen[uid] > 1 ? uid + '#' + seen[uid] : uid;
        const cs = getComputedStyle(e);
        const tn = e.tagName.toLowerCase();
        out[key] = {
          tag: tn,
          attrs: [...e.getAttributeNames()].sort().map((n) => [n, e.getAttribute(n)]),
          text: tn === 'text' || tn === 'tspan' ? e.textContent : null,
          cs: ['fill', 'stroke', 'opacity', 'visibility', 'transform', 'strokeDasharray', 'display'].map((k) => cs[k]),
          anims: e.getAnimations().filter((a) => a.playState === 'running').length,
        };
        // Tâm hộp bao trên màn hình: quay quanh tâm không đổi tâm này, nên so được dù hai bản quay lệch pha
        const rc = e.getBoundingClientRect();
        out[key].ctr = [rc.x + rc.width / 2, rc.y + rc.height / 2];
        // Giá trị tính toán của thuộc tính đang chạy hoạt ảnh đổi theo thời gian: ghi 'anim'
        if (out[key].anims) for (const i of [2, 4]) out[key].cs[i] = 'anim';
      }
      if (e.shadowRoot) walk(e.shadowRoot);
    }
  };
  walk(document);
  return out;
})()`;

function readFiles(dir) {
  const files = new Map();
  const walk = (rel) => {
    for (const n of readdirSync(join(dir, rel))) {
      const r = rel ? `${rel}/${n}` : n;
      const full = join(dir, r);
      if (statSync(full).isDirectory()) walk(r);
      else if (n.endsWith('.svg'))
        files.set(r, { text: readFileSync(full, 'utf8'), type: 'image/svg+xml' });
      else if (n.endsWith('.screen.json'))
        files.set(r, { json: JSON.parse(readFileSync(full, 'utf8')) });
      else if (n.endsWith('.json')) files.set(r, { text: readFileSync(full, 'utf8') });
    }
  };
  walk('');
  return files;
}

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-first-run', '--ignore-certificate-errors', '--lang=vi-VN'],
  defaultViewport: { width: 1366, height: 768 },
});

async function newPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  return { ctx, page };
}

try {
  // ---- 1. Lấy tài liệu và giá trị Tag từ runtime x64 thật
  const real = await newPage();
  await real.page.evaluateOnNewDocument(WS_HOOK);
  // Rig vừa khởi động lại có thể chưa nhận kết nối: thử lại tới 30 s
  for (let i = 0; ; i++) {
    try {
      await real.page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      break;
    } catch (e) {
      if (i >= 30) throw e;
      await sleep(1000);
    }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const s = await real.page.$eval('#app-live', (e) => e.textContent).catch(() => '');
    if (s === 'Trực tuyến') break;
    await sleep(200);
  }
  await sleep(3000);
  const live = await real.page.evaluate('window.__live.tags');
  await sleep(1500);
  let active;
  for (let i = 0; ; i++) {
    try {
      active = await real.page.evaluate(
        `(async () => await (await fetch('/api/v1/projects/active')).json())()`,
      );
      break;
    } catch (e) {
      if (i >= 10) throw e;
      await sleep(1500);
    }
  }
  await real.ctx.close();
  measures.liveTags = Object.keys(live).length;
  check(
    `runtime x64 phục vụ project ${project} và giao ${Object.keys(live).length} Tag`,
    Object.keys(live).length > 0 && Boolean(active?.project),
  );
  const files = readFiles(join(REPO, 'projects', project));

  // ---- 2. Hai bản trang trên runtime giả với cùng tài liệu và giá trị hằng
  const snaps = {};
  const shots = {};
  for (const [label, dist] of [
    ['cũ', oldDist],
    ['mới', newDist],
  ]) {
    const fake = await startFakeRuntime({
      staticDir: dist,
      drift: false,
      fixture: () => ({ active, files }),
    });
    for (const [id, v] of Object.entries(live)) fake.setValue(id, v.value, v.quality, v.reason);
    const { ctx, page } = await newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    const problems = [];
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') problems.push(m.text());
    });
    await page.goto(`${fake.httpsUrl}/`, { waitUntil: 'domcontentloaded' });
    const t1 = Date.now();
    while (Date.now() - t1 < 25000) {
      const s = await page.$eval('#app-live', (e) => e.textContent).catch(() => '');
      if (s === 'Trực tuyến') break;
      await sleep(200);
    }
    await sleep(2500);
    snaps[label] = await page.evaluate(SNAP);
    // Đóng băng mọi hoạt ảnh ở khung đầu để ảnh chụp tất định (hai bản quay cùng tốc độ nhưng khác pha)
    await page.evaluate(
      `document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 0; })`,
    );
    await sleep(300);
    const box = await page.evaluate(`(function(){
      const el = document.querySelector('mat-screen') || document.querySelector('#app-main') || document.body;
      const r = el.getBoundingClientRect();
      return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
    })()`);
    shots[label] = (await page.screenshot({ clip: box, encoding: 'base64' })).toString();
    writeFileSync(join(outDir, `${project}-${label}.png`), Buffer.from(shots[label], 'base64'));
    measures[`${label}Console`] = problems
      .filter((t) => !/status of (401|404)/.test(t))
      .slice(0, 4);
    await ctx.close();
    await fake.close();
  }

  // ---- 3. So phần tử đích, giá trị, kiểu hiển thị
  const o = snaps['cũ'];
  const n = snaps['mới'];
  const ko = Object.keys(o).sort();
  const kn = Object.keys(n).sort();
  measures.elements = ko.length;
  check(
    `cùng tập phần tử đích (data-mat-uid): bản cũ ${ko.length}, bản mới ${kn.length}`,
    JSON.stringify(ko) === JSON.stringify(kn) && ko.length > 0,
    JSON.stringify(ko.filter((k) => !(k in n)).concat(kn.filter((k) => !(k in o)))).slice(0, 200),
  );
  const same = [];
  const diff = [];
  for (const k of ko) {
    if (!(k in n)) continue;
    const strip = (r) => ({ ...r, ctr: undefined });
    if (JSON.stringify(strip(o[k])) === JSON.stringify(strip(n[k]))) same.push(k);
    else diff.push(k);
  }
  // Ngoại lệ có chủ ý (ADR-024): phần tử có transform gốc và binding quay giữ transform gốc ở bản mới
  const intended = [];
  const equivalent = [];
  const unexpected = [];
  for (const k of diff) {
    const a = Object.fromEntries(o[k].attrs);
    const b = Object.fromEntries(n[k].attrs);
    const onlyTransform =
      JSON.stringify({ ...a, transform: 0, style: 0 }) ===
        JSON.stringify({ ...b, transform: 0, style: 0 }) && o[k].text === n[k].text;
    // Phần tử không có transform gốc (M0 = đơn vị): bản 0.2 ghi rotate() với tâm fill-box, bản 0.4 ghi
    // translate(tâm) rotate() translate(-tâm); chuỗi style khác nhưng hình học như nhau (cùng tâm trên màn hình)
    const ra = { ...a, style: undefined };
    const rb = { ...b, style: undefined };
    const styleOnly =
      JSON.stringify(ra) === JSON.stringify(rb) &&
      o[k].text === n[k].text &&
      JSON.stringify(o[k].cs) === JSON.stringify(n[k].cs) &&
      o[k].anims === n[k].anims &&
      !a.transform &&
      Math.abs(o[k].ctr[0] - n[k].ctr[0]) <= 0.5 &&
      Math.abs(o[k].ctr[1] - n[k].ctr[1]) <= 0.5;
    if (styleOnly) equivalent.push(k);
    else if (onlyTransform && a.transform !== b.transform) intended.push(k);
    else unexpected.push(k);
  }
  measures.sameElements = same.length;
  measures.differentElements = diff.length;
  measures.intendedTransformDiffs = intended;
  measures.equivalentStyleDiffs = equivalent;
  measures.unexpectedDiffs = unexpected;
  measures.unexpectedDiffDetail = unexpected.slice(0, 5).map((k) => {
    const a = Object.fromEntries(o[k].attrs);
    const b = Object.fromEntries(n[k].attrs);
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((x) => a[x] !== b[x]);
    return {
      uid: k,
      attrDiff: Object.fromEntries(keys.map((x) => [x, [a[x], b[x]]])),
      csOld: o[k].cs,
      csNew: n[k].cs,
      animsOld: o[k].anims,
      animsNew: n[k].anims,
    };
  });
  check(
    `cùng giá trị binding và kiểu hiển thị ở ${same.length}/${ko.length} phần tử (khác ${diff.length}: ${intended.length} do ADR-024 giữ transform gốc, ${equivalent.length} chuỗi style quay khác nhưng cùng tâm và cùng hoạt ảnh, ${unexpected.length} không dự kiến)`,
    unexpected.length === 0,
    unexpected.slice(0, 8).join(', '),
  );

  // ---- 4. Ảnh chụp: tỷ lệ điểm ảnh khác
  const cmp = await browser.newPage();
  await cmp.goto('about:blank');
  const pct = await cmp.evaluate(
    `(async (a, b) => {
      const load = (b64) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + b64; });
      const [x, y] = await Promise.all([load(a), load(b)]);
      if (x.width !== y.width || x.height !== y.height) return { sizeMismatch: [x.width, x.height, y.width, y.height] };
      const g = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const t = c.getContext('2d'); t.drawImage(i, 0, 0); return t.getImageData(0, 0, i.width, i.height).data; };
      const p = g(x), q = g(y);
      let d = 0;
      for (let k = 0; k < p.length; k += 4)
        if (Math.abs(p[k] - q[k]) > 8 || Math.abs(p[k + 1] - q[k + 1]) > 8 || Math.abs(p[k + 2] - q[k + 2]) > 8) d++;
      return { diffPct: (d / (p.length / 4)) * 100, pixels: p.length / 4 };
    })(${JSON.stringify(shots['cũ'])}, ${JSON.stringify(shots['mới'])})`,
  );
  await cmp.close();
  measures.screenshot = pct;
  check(
    pct.sizeMismatch
      ? 'ảnh chụp cùng kích thước'
      : `ảnh chụp khác ≤ 0,5 % điểm ảnh (đo ${pct.diffPct.toFixed(3)} % trên ${pct.pixels} điểm ảnh, ngưỡng lệch kênh > 8/255)`,
    !pct.sizeMismatch && pct.diffPct <= 0.5,
    pct.sizeMismatch ? JSON.stringify(pct.sizeMismatch) : '',
  );
} catch (e) {
  check('chạy hết kịch bản', false, e.stack ?? String(e));
} finally {
  await browser.close();
}
console.log(
  JSON.stringify({
    scenario: `compat-008-${project}`,
    checks,
    measures,
    pass: checks.every((c) => c.pass),
  }),
);
process.exit(0);
