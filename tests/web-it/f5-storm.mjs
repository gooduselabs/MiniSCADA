// L4 của contracts/test-protocols.md §1 (feature 011, T071, FR-038): F5 đồng loạt. 10 trang Chrome headless (mỗi trang một
// ngữ cảnh riêng, cache tắt) mở màn hình 250 item (`tong-quan` của projects/bench-1000 hoặc projects/soak-standard, sinh bằng
// tools/gen-bench-projects.mjs), rồi cùng F5 50 vòng; đo thời gian từ F5 tới dữ liệu sống đầu tiên của TỪNG trang (trạng thái
// "Trực tuyến" và card có số). Ngưỡng: mọi trang ≤ 5 s (007 SC-003). Mở rộng kịch bản f5x10 của tests/web-it/browser.mjs
// (3 vòng, màn hình tổng quan) lên 50 vòng và màn hình 250 item.
//   node tests/web-it/f5-storm.mjs [--base https://127.0.0.1:18443] [--pages 10] [--rounds 50] [--screen tong-quan]
//        [--items 250] [--limit-ms 5000] [--login] [--out docs/reports/011-load-x64-l4.json] [--dry-run]
// --base mặc định là runtime x64 trong Docker qua loopback (cổng MAT_IT_HTTPS_PORT). --login: đăng nhập từng trang bằng
// tài khoản xem<i> (MAT_IT_USER_PREFIX, mặc định "xem"), mật khẩu MAT_IT_PW_XEM1. Chrome: CHROME_PATH.
// --dry-run: chỉ in cấu hình đã hiểu (không mở Chrome, không kết nối). In đúng một dòng JSON { scenario, checks, measures,
// notMeasured, pass }. Mã thoát: 0 đã chạy (xem `pass`), 2 dùng sai hoặc không chạy được.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const num = (name, v, min) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name}: số nguyên ≥ ${min}`);
  return n;
};

/** Đối số dòng lệnh -> cấu hình; ném Error khi sai. */
export function parseArgs(argv, env = process.env) {
  const cfg = {
    base: `https://127.0.0.1:${env.MAT_IT_HTTPS_PORT ?? 18443}`,
    pages: 10,
    rounds: 50,
    screen: 'tong-quan',
    items: 250,
    limitMs: 5000,
    login: false,
    out: '',
    dryRun: false,
  };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`thiếu giá trị của ${name}`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') cfg.dryRun = true;
    else if (a === '--login') cfg.login = true;
    else if (a === '--base') {
      cfg.base = value(i++, a);
      if (!/^https?:\/\/[^/]+$/.test(cfg.base)) throw new Error('--base: http(s)://host:port');
    } else if (a === '--pages') cfg.pages = num(a, value(i++, a), 1);
    else if (a === '--rounds') cfg.rounds = num(a, value(i++, a), 1);
    else if (a === '--items') cfg.items = num(a, value(i++, a), 1);
    else if (a === '--limit-ms') cfg.limitMs = num(a, value(i++, a), 1);
    else if (a === '--screen') {
      cfg.screen = value(i++, a);
      if (!/^[a-z0-9][a-z0-9-]*$/.test(cfg.screen)) throw new Error('--screen: id màn hình');
    } else if (a === '--out') cfg.out = value(i++, a);
    else throw new Error(`đối số không biết: ${a}`);
  }
  return cfg;
}

const pct = (sorted, p) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
    : null;

/** rounds[k][i] = ms tới dữ liệu sống của trang i ở vòng k (Infinity = không có trong thời gian chờ). */
export function summarizeRounds(rounds, limitMs) {
  const all = rounds.flat();
  const ok = all.filter(Number.isFinite).sort((a, b) => a - b);
  const r = (v) => (v === null ? null : Math.round(v));
  return {
    rounds: rounds.length,
    samples: all.length,
    failed: all.length - ok.length,
    overLimit: all.filter((t) => !(t <= limitMs)).length,
    worstMsPerRound: rounds.map((t) =>
      t.every(Number.isFinite) ? Math.round(Math.max(...t)) : null,
    ),
    p50Ms: r(pct(ok, 50)),
    p95Ms: r(pct(ok, 95)),
    maxMs: r(ok.length ? ok[ok.length - 1] : null),
    pass: all.length > 0 && all.every((t) => t <= limitMs),
  };
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
  const { deepCount, deepText, sleep, until } =
    await import('../../apps/runtime-web/tests/e2e/util.mjs');
  const executablePath = chromePath();
  if (!executablePath) throw new Error('Không tìm thấy Chrome: đặt CHROME_PATH');
  const checks = [];
  const measures = { config: { ...cfg, dryRun: undefined } };
  const check = (name, pass, detail = '') => {
    checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : String(detail) });
  };
  const live = (page) => page.$eval('#app-live', (e) => e.textContent).catch(() => '');
  const hasNumber = async (page) =>
    /\d/.test((await deepText(page, 'mat-w-card').catch(() => '')) ?? '');
  const ready = async (page) => (await live(page)) === 'Trực tuyến' && (await hasNumber(page));
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--lang=vi-VN',
      '--ignore-certificate-errors',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });
  const url = `${cfg.base}/#/${cfg.screen}`;
  try {
    const pages = [];
    for (let i = 0; i < cfg.pages; i++) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setCacheEnabled(false); // L4: cache trống ở mọi lần tải
      pages.push({ ctx, page });
    }
    // Chuẩn bị (không tính vào số đo): mở màn hình, đăng nhập nếu cần, chờ dữ liệu sống lần đầu.
    for (const [i, { page }] of pages.entries()) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      if (cfg.login) {
        await page.click('#app-login-btn');
        await page.waitForSelector('dialog[open] input[autocomplete="username"]');
        await page.type(
          'dialog[open] input[autocomplete="username"]',
          `${process.env.MAT_IT_USER_PREFIX ?? 'xem'}${i + 1}`,
        );
        await page.type(
          'dialog[open] input[autocomplete="current-password"]',
          process.env.MAT_IT_PW_XEM1 ?? '',
        );
        await page.keyboard.press('Enter');
        await until(
          async () => !(await page.$eval('#app-user', (b) => b.hidden)),
          'đăng nhập',
          20000,
        );
      }
      await until(() => ready(page), 'dữ liệu sống lần đầu', 30000);
    }
    const items = await deepCount(pages[0].page, '.item[data-item-id]');
    measures.itemsOnScreen = items;
    check(`màn hình ${cfg.screen} có ≥ ${cfg.items} item`, items >= cfg.items, items);

    const rounds = [];
    for (let k = 0; k < cfg.rounds; k++) {
      await sleep(1500);
      const t0 = performance.now();
      const times = await Promise.all(
        pages.map(async ({ page }) => {
          await page.reload({ waitUntil: 'domcontentloaded' });
          try {
            await until(() => ready(page), 'dữ liệu sống sau F5', 3 * cfg.limitMs);
            return performance.now() - t0;
          } catch {
            return Infinity;
          }
        }),
      );
      rounds.push(times);
    }
    const s = summarizeRounds(rounds, cfg.limitMs);
    Object.assign(measures, { firstLiveMs: s });
    check(
      `${cfg.pages} trang F5 cùng lúc, ${cfg.rounds} vòng: mọi trang có dữ liệu sống ≤ ${cfg.limitMs} ms`,
      s.pass,
      `max ${s.maxMs} ms, ${s.overLimit} lần vượt, ${s.failed} lần không có`,
    );
    const banners = await Promise.all(
      pages.map(({ page }) => page.evaluate(() => document.body.innerText)),
    );
    const full = banners.filter((t) => /4429|Đã đủ/i.test(t)).length;
    check('0 trang báo đầy chỗ (4429)', full === 0, full);
    measures.browserVersion = await browser.version();
    for (const p of pages) await p.ctx.close();
  } finally {
    await browser.close();
  }
  // CPU, RSS của runtime trong lúc F5: đo bằng mat-sample hoặc tests/web-it/proc-sample.mjs, không phải ở đây.
  return { checks, measures, notMeasured: ['runtimeCpuPct', 'runtimeRssMB'] };
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
    console.log(JSON.stringify({ scenario: 'L4', dryRun: true, config: cfg }));
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
    scenario: 'L4',
    measuredAt: new Date().toISOString(),
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
