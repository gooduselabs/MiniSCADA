// Kịch bản Chrome của feature 010 cho tools/web-it.ps1 (T091): `history-10`.
//   node tests/web-it/browser-010.mjs history-10 [--base https://host:port] [--rounds 3] [--out docs/reports/x.json]
// 10 phiên Chrome headless (mỗi phiên một ngữ cảnh, đã đăng nhập viewer) cùng F5 màn hình "bon-bieu-do" có 4 biểu đồ
// lịch sử và một card live: mọi biểu đồ có dữ liệu ≤ 10 s, 0 phiên mất live, 0 mất sequence (SC-009 phần x64).
// Không có --base: chạy trên runtime GIẢ (apps/runtime-web/tests/e2e/fake-runtime.mjs, cần dist-e2e) và ghi
// `*-fake.json`. Với runtime x64 thật dùng --base (project phải có màn hình bon-bieu-do; mật khẩu viewer ở
// MAT_IT_PW_XEM1, tài khoản MAT_IT_USER_XEM1 mặc định xem1) và ghi `010-history-10-x64.json`.
// In đúng một dòng JSON { scenario, checks, measures, pass }.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { startFakeRuntime } from '../../apps/runtime-web/tests/e2e/fake-runtime.mjs';
import { deepEval, sleep, until, waitDeep } from '../../apps/runtime-web/tests/e2e/util.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const scenario = args[0];
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const N = 10;
const ROUNDS = Number(opt('--rounds', '3'));
const DATA_LIMIT_MS = 10_000;
const checks = [];
const measures = {};
const check = (name, pass, detail = '') =>
  checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : String(detail) });

if (scenario !== 'history-10') {
  console.error(`kịch bản không biết: ${scenario}`);
  process.exit(2);
}

function chromePath() {
  const found = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p));
  if (!found) throw new Error('Không tìm thấy Chrome/Edge: đặt CHROME_PATH');
  return found;
}

const W = (id) => `.item[data-item-id="${id}"] > *`;
const chartReady = (page, id) =>
  deepEval(
    page,
    W(id),
    'const w = els[0]; if (!w || !w.shadowRoot) return false; return !w.shadowRoot.querySelector("[role=status]") && w.shadowRoot.querySelectorAll("canvas").length > 0;',
  );
const allReady = async (page) =>
  (await Promise.all(['t1', 't2', 't3', 't4'].map((id) => chartReady(page, id)))).every(Boolean);
const liveText = (page) => page.$eval('#app-live', (e) => e.textContent).catch(() => '');

async function login(page, user, pass) {
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', pass);
  await page.keyboard.press('Enter');
  await until(async () => !(await page.$eval('#app-user', (b) => b.hidden)), 'đăng nhập', 20000);
}

/** Theo dõi khung WebSocket của trang: mọi socket live, dãy sequence theo từng socket. */
async function trackSockets(page) {
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  const sockets = new Map();
  cdp.on('Network.webSocketCreated', (e) => sockets.set(e.requestId, { seqs: [], deltas: 0 }));
  cdp.on('Network.webSocketFrameReceived', (e) => {
    let m;
    try {
      m = JSON.parse(e.response.payloadData);
    } catch {
      return;
    }
    if (typeof m?.sequence !== 'number') return;
    const s = sockets.get(e.requestId) ?? { seqs: [], deltas: 0 };
    sockets.set(e.requestId, s);
    s.seqs.push(m.sequence);
    if (m.type === 'delta') s.deltas++;
  });
  return sockets;
}

/** Số lần dãy sequence của một socket không tăng đúng 1 (snapshot đặt lại về 1 khi đăng ký lại). */
function sequenceGaps(seqs) {
  let gaps = 0;
  for (let i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1] + 1 && seqs[i] !== 1) gaps++;
  return gaps;
}

let rt = null;
let base = opt('--base', null);
const user = process.env.MAT_IT_USER_XEM1 ?? 'xem1';
const secret = process.env.MAT_IT_PW_XEM1 ?? 'view-pass';
if (!base) {
  rt = await startFakeRuntime({
    staticDir: join(root, 'apps/runtime-web/dist-e2e'),
    project: 'history10',
    history: {},
  });
  base = rt.httpsUrl;
  if (!base) {
    console.error('Máy không có openssl để sinh chứng chỉ thử cho runtime giả');
    process.exit(2);
  }
}
const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  args: [
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=vi-VN',
    '--ignore-certificate-errors',
  ],
  defaultViewport: { width: 1366, height: 800 },
});
let failed = false;
try {
  const sessions = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1366, height: 800 });
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    // API answers with an error status, by status and path (what a stuck chart was told)
    page.on('response', (r) => {
      if (r.status() < 400 || !r.url().includes('/api/')) return;
      const key = `${r.status()} ${new URL(r.url()).pathname}`;
      measures.apiErrors ??= {};
      measures.apiErrors[key] = (measures.apiErrors[key] ?? 0) + 1;
    });
    sessions.push({ ctx, page, consoleErrors });
  }
  // Mở màn hình và đăng nhập (tuần tự: chỉ chuẩn bị, không tính vào số đo).
  for (const s of sessions) {
    await s.page.goto(`${base}/#/bon-bieu-do`, { waitUntil: 'domcontentloaded' });
    await waitDeep(s.page, 'mat-w-history-trend', 4, 20000);
    // real runtime: one viewer account per session (a user may hold at most 8 sessions, contracts/web-session.md); the fake one has xem1 only
    await login(s.page, opt('--base', null) ? `xem${sessions.indexOf(s) + 1}` : user, secret);
    await until(() => allReady(s.page), 'bốn biểu đồ có dữ liệu', 30000);
    s.sockets = await trackSockets(s.page);
  }
  check(`${N} phiên đã đăng nhập, mỗi phiên có đủ 4 biểu đồ lịch sử`, true);

  const rounds = [];
  for (let k = 0; k < ROUNDS; k++) {
    await sleep(1500);
    for (const s of sessions) s.sockets.clear();
    const t0 = Date.now();
    const times = await Promise.all(
      sessions.map(async (s) => {
        await s.page.reload({ waitUntil: 'domcontentloaded' });
        try {
          await until(
            () => allReady(s.page),
            'bốn biểu đồ có dữ liệu sau F5',
            DATA_LIMIT_MS + 5000,
          );
          return Date.now() - t0;
        } catch {
          // what each chart shows when it does not come up (status text of the widget), kept in the report
          const state = await Promise.all(
            ['t1', 't2', 't3', 't4'].map((id) =>
              deepEval(
                s.page,
                W(id),
                'const w = els[0]; if (!w || !w.shadowRoot) return "no widget"; const st = w.shadowRoot.querySelector("[role=status]"); return st ? st.textContent.trim().slice(0, 80) : (w.shadowRoot.querySelectorAll("canvas").length ? "ok" : "no canvas");',
              ).catch(() => 'error'),
            ),
          );
          (measures.timeouts ??= []).push({ round: k, state });
          return Infinity;
        }
      }),
    );
    rounds.push(times);
    // quan sát live thêm 3 s sau khi biểu đồ lên: phải có delta đều và sequence liền
    await sleep(3000);
  }
  const worst = rounds.map((r) => Math.max(...r));
  const all = rounds.flat().sort((a, b) => a - b);
  measures.rounds = ROUNDS;
  measures.sessions = N;
  measures.chartsPerSession = 4;
  measures.firstDataWorstMsPerRound = worst;
  measures.firstDataMedianMs = all[Math.floor(all.length / 2)];
  measures.firstDataP95Ms = all[Math.min(all.length - 1, Math.ceil(all.length * 0.95) - 1)];
  check(
    `mọi biểu đồ của ${N} phiên có dữ liệu ≤ ${DATA_LIMIT_MS / 1000} s sau F5 cùng lúc (${ROUNDS} vòng, chậm nhất ${worst.join(', ')} ms)`,
    worst.every((w) => w <= DATA_LIMIT_MS),
    JSON.stringify(worst),
  );

  // Vòng cuối: live và sequence của từng phiên.
  let lostLive = 0;
  let seqGaps = 0;
  let noDelta = 0;
  for (const [i, s] of sessions.entries()) {
    const live = await liveText(s.page);
    if (live !== 'Trực tuyến') lostLive++;
    const socks = [...s.sockets.values()].filter((x) => x.seqs.length > 0);
    if (socks.length === 0) lostLive++;
    for (const sock of socks) {
      seqGaps += sequenceGaps(sock.seqs);
      if (sock.deltas === 0) noDelta++;
    }
    if (live !== 'Trực tuyến') measures[`session${i}Live`] = live;
  }
  measures.sessionsLostLive = lostLive;
  measures.sequenceGaps = seqGaps;
  measures.socketsWithoutDelta = noDelta;
  check('0 phiên mất live (trạng thái "Trực tuyến", có khung sequence)', lostLive === 0, lostLive);
  check('0 mất sequence trên mọi socket live (mỗi khung tăng đúng 1)', seqGaps === 0, seqGaps);
  check('mọi socket live nhận delta đều sau F5 (giá trị card đổi)', noDelta === 0, noDelta);
  check(
    '0 lỗi JavaScript trên trang',
    sessions.every((s) => s.consoleErrors.length === 0),
    sessions
      .flatMap((s) => s.consoleErrors)
      .slice(0, 3)
      .join(' | '),
  );
  if (rt) {
    measures.fakeHistoryCalls = rt.history.calls;
    measures.fakeMaxInflight = rt.history.maxInflight;
  }
  for (const s of sessions) await s.ctx.close();
} catch (e) {
  check('chạy hết kịch bản', false, e.stack ?? String(e));
  failed = true;
} finally {
  await browser.close();
  await rt?.close();
}
const pass = !failed && checks.every((c) => c.pass);
const result = { scenario, checks, measures, pass };
const out = opt(
  '--out',
  join(root, 'docs/reports', rt ? '010-history-10-fake.json' : '010-history-10-x64.json'),
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      note: rt
        ? 'Đo trên runtime GIẢ (apps/runtime-web/tests/e2e/fake-runtime.mjs), Chrome headless; số với runtime x64 thật: chờ runtime (010-history-10-x64.json).'
        : 'Đo trên runtime x64 thật.',
      date: new Date().toISOString(),
      ...result,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(result));
process.exit(pass ? 0 : 1);
