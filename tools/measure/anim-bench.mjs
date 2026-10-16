// Đo hiệu năng hoạt ảnh trên Chrome thật (feature 008, T109, SC-008, D39): một màn hình SVG có 100 phần tử hoạt ảnh vô hạn
// (34 quay liên tục, 33 nhấp nháy, 33 dòng chảy) chạy trong trang runtime thật (bản build dist-e2e, runtime giả của e2e).
// Đo mỗi khung hình: thời gian luồng chính từ lúc callback requestAnimationFrame bắt đầu đến khi tác vụ tin nhắn xếp ngay
// trong callback được chạy = phần còn lại của bước "update the rendering" (style, layout, paint, commit), cộng khoảng
// cách giữa các khung (rAF). Bộ nhớ: JSHeapUsedSize (sau GC cưỡng bức) ở phút tham chiếu (5) và phút cuối (30),
// cộng số node DOM. Tab ẩn: mở tab khác lên trước, đếm callback rAF của trang và thời gian CPU của tiến trình trang.
// Dùng: npm run build -w @mat/runtime-web trước (hoặc `npx vite build --mode e2e` ở apps/runtime-web), rồi
//   node tools/measure/anim-bench.mjs [--minutes 30] [--count 100] [--out docs/reports/008-anim-x64.json] [--headful]
// Biến môi trường: CHROME_PATH. Mã thoát: 0 đạt (p95 <= 8 ms, bộ nhớ +<= 50 MB, tab ẩn 0 callback); 1 không đạt; 2 lỗi chạy.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { animDemo } from '../../apps/runtime-web/tests/e2e/anim-fixture.mjs';
import { startFakeRuntime } from '../../apps/runtime-web/tests/e2e/fake-runtime.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const minutes = Number(opt('--minutes', '30'));
const count = Number(opt('--count', '100'));
const out = opt('--out', resolve(root, 'docs/reports/008-anim-x64.json'));
const headful = args.includes('--headful');
const P95_LIMIT_MS = 8;
const MEM_LIMIT_MB = 50;
const refMinute = minutes >= 10 ? 5 : minutes / 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const percentile = (arr, p) => {
  if (!arr.length) return null;
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const maxOf = (arr) => arr.reduce((m, v) => (v > m ? v : m), 0);
const r2 = (n) => (n === null ? null : Math.round(n * 100) / 100);
const mb = (b) => Math.round((b / 1048576) * 10) / 10;

function chromePath() {
  const found = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p));
  if (!found) throw new Error('Không tìm thấy Chrome/Edge: đặt CHROME_PATH');
  return found;
}

/** Màn hình SVG lưới với `n` phần tử hoạt ảnh: 1/3 quay, 1/3 nhấp nháy (chu kỳ 400-1000 ms), 1/3 dòng chảy. */
function benchFixture(n) {
  const base = animDemo();
  const cols = 10;
  const cell = 100;
  const rows = Math.ceil(n / cols);
  const parts = [];
  const elements = [];
  const direct = { kind: 'direct' };
  const bind = (id, target, tagId, extra = {}) => ({
    id,
    target,
    source: { type: 'tag', tagId },
    transform: direct,
    ...extra,
  });
  for (let i = 0; i < n; i++) {
    const uid = `el_${String(i).padStart(3, '0')}`;
    const x = (i % cols) * cell + cell / 2;
    const y = Math.floor(i / cols) * cell + cell / 2;
    const kind = i % 3;
    if (kind === 0) {
      parts.push(
        `<g data-mat-uid="${uid}" transform="translate(${x} ${y})"><circle r="30" fill="none" stroke="#94a3b8" stroke-width="2"/><line x2="25" stroke="#e2e8f0" stroke-width="4"/></g>`,
      );
      elements.push({
        elementUid: uid,
        bindings: [bind(`b${i}`, 'transform.rotate', 'MOTOR01.SPEED', { animation: 'spin' })],
      });
    } else if (kind === 1) {
      parts.push(`<circle data-mat-uid="${uid}" cx="${x}" cy="${y}" r="22" fill="#ef4444"/>`);
      elements.push({
        elementUid: uid,
        bindings: [bind(`b${i}`, 'effect.blink', 'MOTOR01.RUN', { period: 400 + (i % 7) * 100 })],
      });
    } else {
      parts.push(
        `<path data-mat-uid="${uid}" d="M${x - 40} ${y} L ${x + 40} ${y}" stroke="#38bdf8" stroke-width="6" fill="none"/>`,
      );
      elements.push({
        elementUid: uid,
        bindings: [bind(`b${i}`, 'effect.flow', 'MOTOR01.RUN')],
      });
    }
  }
  const h = rows * cell;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * cell} ${h}">${parts.join('')}</svg>`;
  const bindings = {
    schemaVersion: '0.4.0',
    screenId: 'anim',
    itemId: 'svg1',
    elements,
  };
  const screen = structuredClone(base.files.get('screens/anim.screen.json').json);
  const item = screen.items[0];
  item.viewBox = [0, 0, cols * cell, h];
  item.elements = elements.map((e) => ({ elementUid: e.elementUid }));
  base.files.set('screens/anim.screen.json', { json: screen });
  base.files.set('screens/anim.svg', { text: svg, type: 'image/svg+xml' });
  base.files.set('screens/anim.bindings.json', { text: JSON.stringify(bindings) });
  return base;
}

// Mã đo trong trang (chuỗi để evaluateOnNewDocument chạy trước mã trang).
const PAGE_PROBE = `
(() => {
  const B = (window.__bench = { rafCount: 0, last: 0, intervals: [], work: [] });
  const ch = new MessageChannel();
  let t0 = 0;
  ch.port1.onmessage = () => { B.work.push(performance.now() - t0); };
  const loop = () => {
    B.rafCount++;
    const now = performance.now();
    if (B.last) B.intervals.push(now - B.last);
    B.last = now;
    t0 = now;
    ch.port2.postMessage(0);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  B.take = () => { const r = { work: B.work, intervals: B.intervals }; B.work = []; B.intervals = []; return r; };
})();
`;

const rt = await startFakeRuntime({
  staticDir: resolve(root, 'apps/runtime-web/dist-e2e'),
  fixture: () => benchFixture(count),
  drift: false,
});
let browser;
let exit = 2;
try {
  browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: !headful,
    args: ['--no-first-run', '--no-default-browser-check', '--lang=vi-VN'],
    defaultViewport: { width: 1366, height: 768 },
  });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.evaluateOnNewDocument(PAGE_PROBE);
  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');
  const metric = async (name) =>
    (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === name)?.value ?? null;
  const settledHeap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    return { heap: await metric('JSHeapUsedSize'), nodes: await metric('Nodes') };
  };
  const rendererCpu = async () => {
    const info = (
      await browser
        .target()
        .createCDPSession()
        .then((s) => s.send('SystemInfo.getProcessInfo').finally(() => s.detach()))
    ).processInfo;
    return info.filter((p) => p.type === 'renderer').reduce((a, p) => a + p.cpuTime, 0);
  };

  await page.goto(rt.httpUrl, { waitUntil: 'domcontentloaded' });
  rt.setValue('MOTOR01.RUN', true);
  rt.setValue('MOTOR01.SPEED', 600);
  const animCount = () =>
    page
      .evaluate(() => document.querySelector('mat-screen')?.animationCount?.() ?? -1)
      .catch(() => -1);
  const t0 = Date.now();
  while ((await animCount()) !== count) {
    if (Date.now() - t0 > 60000)
      throw new Error(`animationCount = ${await animCount()}, cần ${count}`);
    await sleep(250);
  }
  console.log(
    `${count} hoạt ảnh đang chạy; đo ${minutes} phút (tham chiếu bộ nhớ phút ${refMinute}).`,
  );

  const work = [];
  const intervals = [];
  const perMinute = [];
  const heapSamples = [];
  let refMem = null;
  let lastFrames = 0;
  let lastTask = await metric('TaskDuration');
  let lastLog = Date.now();
  const taskPerFrame = [];
  const start = Date.now();
  await page.evaluate(() => window.__bench.take());
  let nextMinute = 1;
  while (Date.now() - start < minutes * 60000) {
    await sleep(1000);
    const frames = await page.evaluate(() => window.__bench.rafCount);
    const task = await metric('TaskDuration');
    if (frames > lastFrames) taskPerFrame.push(((task - lastTask) * 1000) / (frames - lastFrames));
    lastFrames = frames;
    lastTask = task;
    const elapsedMin = (Date.now() - start) / 60000;
    if (elapsedMin >= nextMinute || Date.now() - start >= minutes * 60000) {
      const got = await page.evaluate(() => window.__bench.take());
      work.push(...got.work);
      intervals.push(...got.intervals);
      perMinute.push({
        minute: nextMinute,
        frames: got.work.length,
        workP50Ms: r2(percentile(got.work, 50)),
        workP95Ms: r2(percentile(got.work, 95)),
        workMaxMs: r2(maxOf(got.work)),
        intervalP95Ms: r2(percentile(got.intervals, 95)),
        jsHeapMB: mb(await metric('JSHeapUsedSize')),
      });
      nextMinute++;
      if (Date.now() - lastLog > 55000 || nextMinute % 5 === 0) {
        const m = perMinute[perMinute.length - 1];
        console.log(
          `  phút ${m.minute}: p50 ${m.workP50Ms} ms, p95 ${m.workP95Ms} ms, max ${m.workMaxMs} ms, khoảng cách p95 ${m.intervalP95Ms} ms, heap ${m.jsHeapMB} MB`,
        );
        lastLog = Date.now();
      }
    }
    if (refMem === null && elapsedMin >= refMinute) {
      refMem = await settledHeap();
      heapSamples.push({ minute: Math.round(elapsedMin * 10) / 10, ...refMem });
      console.log(
        `  bộ nhớ tham chiếu (phút ${refMinute}): ${mb(refMem.heap)} MB, ${refMem.nodes} node`,
      );
    }
  }
  const tail = await page.evaluate(() => window.__bench.take());
  work.push(...tail.work);
  intervals.push(...tail.intervals);
  const finalMem = await settledHeap();
  heapSamples.push({ minute: minutes, ...finalMem });
  const finalAnim = await animCount();

  // --- tab ẩn: mở tab khác lên trước ---
  const other = await context.newPage();
  await other.bringToFront();
  await sleep(1500);
  const vis = await page.evaluate(() => document.visibilityState);
  const rafBefore = await page.evaluate(() => window.__bench.rafCount);
  const cpuBefore = await rendererCpu();
  await sleep(10000);
  const rafAfter = await page.evaluate(() => window.__bench.rafCount);
  const cpuAfter = await rendererCpu();
  const states = await page.evaluate(() => {
    const root = document
      .querySelector('mat-screen')
      .shadowRoot.querySelector('.svg-host').shadowRoot;
    const c = {};
    for (const el of root.querySelectorAll('[data-mat-uid]'))
      for (const a of el.getAnimations()) c[a.playState] = (c[a.playState] ?? 0) + 1;
    return c;
  });
  await other.close();
  await page.bringToFront();
  const hidden = {
    visibilityState: vis,
    rafCallbacksWhileHidden: rafAfter - rafBefore,
    animationStates: states,
    rendererCpuSecondsIn10s: r2(cpuAfter - cpuBefore),
  };

  const p95 = percentile(work, 95);
  const memDelta = refMem ? (finalMem.heap - refMem.heap) / 1048576 : null;
  const report = {
    measuredAt: new Date().toISOString(),
    browserVersion: await browser.version(),
    minutes,
    animations: {
      total: count,
      spin: Math.ceil(count / 3),
      blink: Math.ceil((count - 1) / 3),
      flow: Math.floor(count / 3),
    },
    method:
      'work = rAF callback start -> next message task (style, layout, paint of the same frame); interval = rAF to rAF; heap = JSHeapUsedSize after forced GC',
    frames: work.length,
    framesPerSecond: r2(work.length / (minutes * 60)),
    workMs: {
      p50: r2(percentile(work, 50)),
      p95: r2(p95),
      p99: r2(percentile(work, 99)),
      max: r2(maxOf(work)),
    },
    intervalMs: {
      p50: r2(percentile(intervals, 50)),
      p95: r2(percentile(intervals, 95)),
      p99: r2(percentile(intervals, 99)),
    },
    taskDurationPerFrameMs: {
      p50: r2(percentile(taskPerFrame, 50)),
      p95: r2(percentile(taskPerFrame, 95)),
    },
    memory: {
      refMinute,
      refHeapMB: refMem ? mb(refMem.heap) : null,
      finalHeapMB: mb(finalMem.heap),
      deltaMB: memDelta === null ? null : r2(memDelta),
      refNodes: refMem?.nodes ?? null,
      finalNodes: finalMem.nodes,
      samples: heapSamples,
    },
    animationCountAtEnd: finalAnim,
    hidden,
    perMinute,
    consoleErrors: errors.slice(0, 5),
    limits: { p95Ms: P95_LIMIT_MS, memoryDeltaMB: MEM_LIMIT_MB },
  };
  report.checks = [
    {
      name: `p95 thời gian khung <= ${P95_LIMIT_MS} ms`,
      pass: p95 <= P95_LIMIT_MS,
      detail: `${r2(p95)} ms`,
    },
    {
      name: `bộ nhớ phút ${minutes} không hơn phút ${refMinute} quá ${MEM_LIMIT_MB} MB`,
      pass: memDelta !== null && memDelta <= MEM_LIMIT_MB,
      detail: `${memDelta === null ? 'n/a' : r2(memDelta)} MB`,
    },
    { name: 'số hoạt ảnh không đổi sau đo', pass: finalAnim === count, detail: String(finalAnim) },
    {
      name: 'tab ẩn: 0 callback rAF của trang',
      pass: vis === 'hidden' && hidden.rafCallbacksWhileHidden === 0,
      detail: `${vis}, ${hidden.rafCallbacksWhileHidden} callback`,
    },
    {
      name: 'tab ẩn: mọi hoạt ảnh paused',
      pass: Object.keys(states).length === 1 && states.paused === count,
      detail: JSON.stringify(states),
    },
    {
      name: 'không có lỗi console',
      pass: errors.length === 0,
      detail: errors.slice(0, 2).join(' | '),
    },
  ];
  report.pass = report.checks.every((c) => c.pass);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  for (const c of report.checks) console.log(`${c.pass ? '✔' : '✘'} ${c.name}: ${c.detail}`);
  console.log(`Đã ghi ${out}: ${report.pass ? 'ĐẠT' : 'KHÔNG ĐẠT'}`);
  exit = report.pass ? 0 : 1;
} catch (e) {
  console.error(e?.stack ?? String(e));
} finally {
  await browser?.close();
  await rt.close();
}
process.exit(exit);
