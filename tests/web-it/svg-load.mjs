// L5 của contracts/test-protocols.md §1 (feature 011, T071, FR-038): màn hình 300 đến 500 phần tử SVG, 50 hoạt ảnh, FPS trên
// Chrome headless. Ngưỡng ≥ 30 FPS với 50 hoạt ảnh (Master Plan §6.4).
//   node tests/web-it/svg-load.mjs [--elements 400] [--animations 50] [--pages 1] [--seconds 60] [--min-fps 30]
//        [--out docs/reports/011-load-x64-l5.json] [--headful] [--dry-run]
// Chạy trang runtime thật (bản build dist-e2e: `npx vite build --mode e2e` ở apps/runtime-web) trên runtime GIẢ của e2e
// (apps/runtime-web/tests/e2e/fake-runtime.mjs), không kết nối thiết bị. Mỗi trang (--pages, ngữ cảnh riêng) đếm callback
// requestAnimationFrame trong --seconds giây: FPS = số khung / giây; trang chậm nhất quyết định.
// Dùng lại, không chép: tools/measure/svg-load.mjs đo THỜI GIAN HIỂN THỊ tệp SVG (SC-005, lab.html), không đo FPS;
// tools/measure/anim-bench.mjs đo thời gian khung với MỌI phần tử đều có hoạt ảnh trong 30 phút và là script (không nhập được).
// Ở đây dùng chung runtime giả, project nền animDemo() và cách dựng màn hình lưới của anim-bench, nhưng chỉ `--animations`
// trong `--elements` phần tử có hoạt ảnh.
// Chưa đo ở đây (ghi trong notMeasured): RSS của tab (CDP chỉ cho JS heap, có ghi `jsHeapMB`), 10 client vào runtime thật
// (runtime giả không phải runtime; tải 10 client của L5 chạy bằng tools/load-tester cùng lúc, CPU/RSS do mat-sample).
// --dry-run: chỉ in cấu hình (không mở Chrome). In đúng một dòng JSON. Mã thoát: 0 đã chạy (xem `pass`), 2 dùng sai/lỗi chạy.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

/** Đối số dòng lệnh -> cấu hình; ném Error khi sai. */
export function parseArgs(argv) {
  const cfg = {
    elements: 400,
    animations: 50,
    pages: 1,
    seconds: 60,
    minFps: 30,
    out: '',
    headful: false,
    dryRun: false,
  };
  const int = (i, name, min, max) => {
    const v = argv[i + 1];
    const n = Number(v);
    if (v === undefined || !Number.isInteger(n) || n < min || n > max)
      throw new Error(`${name}: số nguyên ${min} đến ${max}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') cfg.dryRun = true;
    else if (a === '--headful') cfg.headful = true;
    else if (a === '--elements') cfg.elements = int(i++, a, 300, 500);
    else if (a === '--animations') cfg.animations = int(i++, a, 1, 500);
    else if (a === '--pages') cfg.pages = int(i++, a, 1, 10);
    else if (a === '--seconds') cfg.seconds = int(i++, a, 5, 86400);
    else if (a === '--min-fps') cfg.minFps = int(i++, a, 1, 240);
    else if (a === '--out') {
      cfg.out = argv[++i];
      if (!cfg.out || cfg.out.startsWith('--')) throw new Error('thiếu giá trị của --out');
    } else throw new Error(`đối số không biết: ${a}`);
  }
  if (cfg.animations > cfg.elements) throw new Error('--animations không quá --elements');
  return cfg;
}

/**
 * Màn hình SVG lưới `n` phần tử có `data-mat-uid`; `a` phần tử đầu có hoạt ảnh (lần lượt quay liên tục, nhấp nháy, dòng chảy;
 * như tools/measure/anim-bench.mjs), còn lại là hình tĩnh không binding.
 */
export function buildSvgScreen(n, a) {
  const cols = 25;
  const cell = 60;
  const parts = [];
  const elements = [];
  const bind = (id, target, tagId, extra = {}) => ({
    id,
    target,
    source: { type: 'tag', tagId },
    transform: { kind: 'direct' },
    ...extra,
  });
  for (let i = 0; i < n; i++) {
    const uid = `el_${String(i).padStart(3, '0')}`;
    const x = (i % cols) * cell + cell / 2;
    const y = Math.floor(i / cols) * cell + cell / 2;
    if (i >= a) {
      parts.push(
        i % 2
          ? `<rect data-mat-uid="${uid}" x="${x - 20}" y="${y - 20}" width="40" height="40" fill="#334155"/>`
          : `<circle data-mat-uid="${uid}" cx="${x}" cy="${y}" r="18" fill="#475569"/>`,
      );
      continue;
    }
    const kind = i % 3;
    if (kind === 0) {
      parts.push(
        `<g data-mat-uid="${uid}" transform="translate(${x} ${y})"><circle r="20" fill="none" stroke="#94a3b8" stroke-width="2"/><line x2="16" stroke="#e2e8f0" stroke-width="3"/></g>`,
      );
      elements.push({
        elementUid: uid,
        bindings: [bind(`b${i}`, 'transform.rotate', 'MOTOR01.SPEED', { animation: 'spin' })],
      });
    } else if (kind === 1) {
      parts.push(`<circle data-mat-uid="${uid}" cx="${x}" cy="${y}" r="16" fill="#ef4444"/>`);
      elements.push({
        elementUid: uid,
        bindings: [bind(`b${i}`, 'effect.blink', 'MOTOR01.RUN', { period: 400 + (i % 7) * 100 })],
      });
    } else {
      parts.push(
        `<path data-mat-uid="${uid}" d="M${x - 25} ${y} L ${x + 25} ${y}" stroke="#38bdf8" stroke-width="5" fill="none"/>`,
      );
      elements.push({ elementUid: uid, bindings: [bind(`b${i}`, 'effect.flow', 'MOTOR01.RUN')] });
    }
  }
  const w = cols * cell;
  const h = Math.ceil(n / cols) * cell;
  return {
    width: w,
    height: h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`,
    bindings: { schemaVersion: '0.4.0', screenId: 'anim', itemId: 'svg1', elements },
  };
}

/** samples[i] = { frames, seconds } của trang i. */
export function summarizeFps(samples, minFps) {
  const fps = samples.map((s) => Math.round((s.frames / s.seconds) * 10) / 10);
  const min = fps.length ? Math.min(...fps) : null;
  return { fpsPerPage: fps, minFps: min, limitFps: minFps, pass: min !== null && min >= minFps };
}

function chromePath() {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p));
}

async function run(cfg) {
  const { default: puppeteer } = await import('puppeteer-core');
  const { animDemo } = await import('../../apps/runtime-web/tests/e2e/anim-fixture.mjs');
  const { startFakeRuntime } = await import('../../apps/runtime-web/tests/e2e/fake-runtime.mjs');
  const executablePath = chromePath();
  if (!executablePath) throw new Error('Không tìm thấy Chrome: đặt CHROME_PATH');
  const staticDir = resolve(root, 'apps/runtime-web/dist-e2e');
  if (!existsSync(staticDir))
    throw new Error('Chưa có apps/runtime-web/dist-e2e (vite build --mode e2e)');
  const screen = buildSvgScreen(cfg.elements, cfg.animations);
  const fixture = () => {
    const base = animDemo();
    const s = structuredClone(base.files.get('screens/anim.screen.json').json);
    s.items[0].viewBox = [0, 0, screen.width, screen.height];
    s.items[0].elements = screen.bindings.elements.map((e) => ({ elementUid: e.elementUid }));
    base.files.set('screens/anim.screen.json', { json: s });
    base.files.set('screens/anim.svg', { text: screen.svg, type: 'image/svg+xml' });
    base.files.set('screens/anim.bindings.json', { text: JSON.stringify(screen.bindings) });
    return base;
  };
  const rt = await startFakeRuntime({ staticDir, fixture, drift: false });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const measures = {};
  const browser = await puppeteer.launch({
    executablePath,
    headless: !cfg.headful,
    args: ['--no-first-run', '--no-default-browser-check', '--lang=vi-VN'],
    defaultViewport: { width: 1366, height: 768 },
  });
  try {
    const pages = [];
    for (let i = 0; i < cfg.pages; i++) {
      const page = await (await browser.createBrowserContext()).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
      await page.evaluateOnNewDocument(
        '(() => { const B = (window.__fps = { n: 0 }); const f = () => { B.n++; requestAnimationFrame(f); }; requestAnimationFrame(f); })();',
      );
      await page.goto(rt.httpUrl, { waitUntil: 'domcontentloaded' });
      pages.push({ page, errors });
    }
    rt.setValue('MOTOR01.RUN', true);
    rt.setValue('MOTOR01.SPEED', 600);
    const animCount = (page) =>
      page
        .evaluate(() => document.querySelector('mat-screen')?.animationCount?.() ?? -1)
        .catch(() => -1);
    for (const { page } of pages) {
      const t0 = Date.now();
      while ((await animCount(page)) !== cfg.animations) {
        if (Date.now() - t0 > 60000)
          throw new Error(`animationCount = ${await animCount(page)}, cần ${cfg.animations}`);
        await sleep(250);
      }
    }
    const before = await Promise.all(pages.map(({ page }) => page.evaluate(() => window.__fps.n)));
    const t0 = performance.now();
    await sleep(cfg.seconds * 1000);
    const after = await Promise.all(pages.map(({ page }) => page.evaluate(() => window.__fps.n)));
    const seconds = (performance.now() - t0) / 1000;
    const fps = summarizeFps(
      after.map((n, i) => ({ frames: n - before[i], seconds })),
      cfg.minFps,
    );
    const heap = [];
    for (const { page } of pages) {
      const cdp = await page.createCDPSession();
      await cdp.send('Performance.enable');
      const m = (await cdp.send('Performance.getMetrics')).metrics;
      heap.push(
        Math.round((m.find((x) => x.name === 'JSHeapUsedSize')?.value ?? 0) / 104857.6) / 10,
      );
    }
    const elems = await pages[0].page.evaluate(() => {
      const host = document.querySelector('mat-screen')?.shadowRoot?.querySelector('.svg-host');
      return host?.shadowRoot?.querySelectorAll('[data-mat-uid]').length ?? -1;
    });
    Object.assign(measures, {
      fps,
      jsHeapMB: heap,
      svgElements: elems,
      animations: cfg.animations,
      browserVersion: await browser.version(),
    });
    checks.push({
      name: `màn hình có ${cfg.elements} phần tử SVG`,
      pass: elems === cfg.elements,
      detail: String(elems),
    });
    checks.push({
      name: `≥ ${cfg.minFps} FPS với ${cfg.animations} hoạt ảnh (trang chậm nhất)`,
      pass: fps.pass,
      detail: `${fps.minFps} FPS`,
    });
    const errs = pages.flatMap((p) => p.errors);
    checks.push({
      name: 'không có lỗi trang',
      pass: errs.length === 0,
      detail: errs.slice(0, 2).join(' | '),
    });
  } finally {
    await browser.close();
    await rt.close();
  }
  return {
    checks,
    measures,
    notMeasured: ['tabRssMB', 'tenClientsOnRealRuntime'],
    runtime: 'fake (apps/runtime-web/tests/e2e/fake-runtime.mjs)',
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let cfg;
  try {
    cfg = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (cfg.dryRun) {
    console.log(JSON.stringify({ scenario: 'L5', dryRun: true, config: cfg }));
    process.exit(0);
  }
  let result;
  try {
    result = await run(cfg);
  } catch (e) {
    console.error(e?.stack ?? String(e));
    process.exit(2);
  }
  const doc = {
    scenario: 'L5',
    measuredAt: new Date().toISOString(),
    config: cfg,
    ...result,
    pass: result.checks.every((c) => c.pass),
  };
  if (cfg.out) {
    mkdirSync(dirname(resolve(cfg.out)), { recursive: true });
    writeFileSync(resolve(cfg.out), JSON.stringify(doc, null, 2) + '\n');
  }
  console.log(JSON.stringify(doc));
  process.exit(0);
}
