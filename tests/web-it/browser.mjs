// Kịch bản trình duyệt của web-it (feature 007, T049, T073, T133; quickstart §3): Chrome thật (puppeteer-core) trên máy dev
// vào runtime x64 trong Docker qua cổng loopback do tests/web-it/compose.yaml mở (https://127.0.0.1:18443).
//   node tests/web-it/browser.mjs <screens|widgets|chrome-control|f5x10|open|cert-ui> [--base https://127.0.0.1:18443]
// In đúng một dòng JSON { scenario, checks, measures, pass }. Mật khẩu: MAT_IT_PW_VH1, MAT_IT_PW_XEM1.
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import {
  audit,
  deployPackage,
  fetchPackage,
  login as bearerLogin,
  waitOperation,
} from '../../tools/measure/device-api.mjs';
import { buildPackage, readProjectDir } from '../device-it/pack.mjs';
import {
  bodyText,
  deepClick,
  deepCount,
  deepEval,
  deepText,
  sleep,
  until,
  waitDeep,
} from '../../apps/runtime-web/tests/e2e/util.mjs';

const args = process.argv.slice(2);
const scenario = args[0];
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const BASE = opt('--base', 'https://127.0.0.1:18443');
const HTTP_BASE = opt('--http', 'http://127.0.0.1:18080');

const checks = [];
const measures = {};
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : String(detail) });
  return Boolean(pass);
};

function chromePath() {
  const found = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ]
    .filter(Boolean)
    .find((p) => existsSync(p));
  if (!found) throw new Error('Không tìm thấy Chrome/Edge: đặt CHROME_PATH');
  return found;
}

const W = (id) => `.item[data-item-id="${id}"] > *`;
const inW = (page, id, code, arg) => deepEval(page, W(id), `const w = els[0]; ${code}`, arg);
const wText = (page, id) => inW(page, id, 'return fullText(w).replace(/\\s+/g, " ").trim();');
const hash = (page) => page.evaluate(() => location.hash);
const live = (page) => page.$eval('#app-live', (e) => e.textContent).catch(() => '');
const current = (page) =>
  page.$eval('#app-nav button[aria-current="page"]', (b) => b.textContent.trim()).catch(() => null);

async function openApp(page, url, wait = 'mat-w-card') {
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitDeep(page, wait, 1, 20000);
}
const hasNumber = async (page) =>
  /\d/.test((await deepText(page, 'mat-w-card').catch(() => '')) ?? '');

async function newPage(browser) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  return { ctx, page };
}

// ------------------------------------------------------------------------------------ screens

async function screens(browser) {
  const { ctx, page } = await newPage(browser);
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') problems.push(m.text());
  });
  const t0 = Date.now();
  await openApp(page, `${BASE}/`);
  measures.firstScreenMs = Date.now() - t0;
  check(
    `màn hình đầu hiện trong ≤ 2 s (đo ${measures.firstScreenMs} ms)`,
    measures.firstScreenMs <= 2000,
  );
  const menu = await page.$$eval('#app-nav button', (bs) => bs.map((b) => b.textContent.trim()));
  check(
    'menu theo navigation: Tổng quan, Bồn nước, Giám sát',
    JSON.stringify(menu) === JSON.stringify(['Tổng quan', 'Bồn nước', 'Giám sát']),
    JSON.stringify(menu),
  );
  check('URL tự đặt #/tong-quan', (await hash(page)) === '#/tong-quan', await hash(page));
  await until(async () => (await live(page)) === 'Trực tuyến', 'Trực tuyến', 15000);
  check('trạng thái kết nối: Trực tuyến', true);
  await until(() => hasNumber(page), 'card có số', 15000);
  check('giá trị sống từ runtime thật hiện trên card', true);
  check('HTTPS: không có dải chỉ xem', await page.$eval('#app-viewonly', (e) => e.hidden));
  await waitDeep(page, '[data-mat-uid]', 1, 10000);
  check(
    'item svg dựng đồ họa từ SVG và binding do runtime phục vụ',
    (await deepCount(page, '[data-mat-uid]')) > 0,
  );
  for (const [name, id, sel] of [
    ['Bồn nước', 'bon-nuoc', 'mat-w-level'],
    ['Giám sát', 'giam-sat', 'mat-w-line'],
  ]) {
    await page.$$eval(
      '#app-nav button',
      (bs, n) => bs.find((b) => b.textContent.includes(n)).click(),
      name,
    );
    await until(async () => (await hash(page)) === `#/${id}`, `URL #/${id}`);
    await waitDeep(page, sel, 1, 10000);
    check(`${name}: mở được, URL #/${id}, mục menu được tô`, (await current(page)) === name);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitDeep(page, sel, 1, 15000);
    check(
      `F5 ở ${name} giữ màn hình và URL`,
      (await hash(page)) === `#/${id}` && (await current(page)) === name,
    );
  }
  await page.goBack();
  await until(async () => (await hash(page)) === '#/bon-nuoc', 'Back về #/bon-nuoc');
  check('Back quay lại màn hình trước', true);
  await openApp(page, `${BASE}/#/khong-co`);
  check(
    'id lạ: về màn hình đầu kèm thông báo',
    (await hash(page)) === '#/tong-quan' &&
      (await page.$eval('#app-notice', (e) => !e.hidden && e.textContent.includes('khong-co'))),
  );
  await openApp(page, `${BASE}/#/tong-quan`);
  await deepEval(
    page,
    'mat-w-button',
    'els.find(e => e.shadowRoot.textContent.includes("Chi tiết bơm 1")).shadowRoot.querySelector("button").click();',
  );
  await waitDeep(page, '[role="dialog"]', 1);
  check('popup mở, hash không đổi', (await hash(page)) === '#/tong-quan');
  await page.keyboard.press('Escape');
  await until(async () => (await deepCount(page, '[role="dialog"]')) === 0, 'Esc đóng popup');
  check('Esc đóng popup', true);
  await openApp(page, `${BASE}/?kiosk=1#/bon-nuoc`, '[data-mat-uid], mat-w-level');
  check(
    'kiosk: ẩn thanh trên và menu',
    await page.$eval('#app-bar', (b) => getComputedStyle(b).display === 'none'),
  );
  const bad = problems.filter((t) => !/status of (401|404)/.test(t));
  check(
    'không có cảnh báo hay lỗi trong console (trừ 401 của web/session khi là khách)',
    bad.length === 0,
    bad.join(' | '),
  );
  await ctx.close();
  // HTTP: chỉ xem
  const h = await newPage(browser);
  await openApp(h.page, `${HTTP_BASE}/`);
  check(
    'HTTP: dải "Chế độ chỉ xem" và không có nút đăng nhập',
    (await bodyText(h.page)).includes('Chế độ chỉ xem') &&
      (await h.page.$eval('#app-login-btn', (b) => b.hidden)),
  );
  await h.ctx.close();
}

// ------------------------------------------------------------------------------------ widgets

async function widgets(browser) {
  const { ctx, page } = await newPage(browser);
  await openApp(page, `${BASE}/#/tong-quan`);
  await until(() => hasNumber(page), 'card có số', 15000);
  const types = [
    'card',
    'label',
    'lamp',
    'gauge',
    'level',
    'panel',
    'line',
    'bar',
    'pie',
    'tag-table',
    'button',
    'switch',
    'setpoint',
    'slider',
    'select',
  ];
  for (const t of types)
    check(`widget ${t} có trên màn hình Tổng quan`, (await deepCount(page, `mat-w-${t}`)) >= 1);
  const errs = await page.$$eval('#app-notice, .screen-failed', (es) =>
    es.filter((e) => !e.hidden).map((e) => e.textContent),
  );
  check('không có thông báo lỗi trên trang', errs.length === 0, errs.join('|'));
  const table = await deepText(page, 'mat-w-tag-table');
  check('bảng Tag hiện giá trị sống', /\d/.test(table ?? ''), table?.slice(0, 80));
  const csp = await page.evaluate(async () =>
    (await fetch('/')).headers.get('content-security-policy'),
  );
  check(
    "CSP không cho phép script nội tuyến ('unsafe-inline' không có ở script-src)",
    !/script-src[^;]*unsafe-inline/.test(csp ?? ''),
    csp,
  );
  await ctx.close();
}

// -------------------------------------------------------------------------------- chrome-control

async function chromeControl(browser) {
  const { ctx, page } = await newPage(browser);
  await page.setViewport({ width: 1600, height: 900 });
  await openApp(page, `${BASE}/#/tong-quan`, 'mat-w-switch');
  await until(async () => (await live(page)) === 'Trực tuyến', 'Trực tuyến', 15000);
  const lockOf = (id) =>
    inW(
      page,
      id,
      'const l = w.shadowRoot.querySelector("[data-lock]"); return l ? l.getAttribute("data-lock") : null;',
    );
  check(
    'khách: công tắc khóa (NO_SESSION)',
    (await lockOf('sw_fan')) === 'NO_SESSION',
    await lockOf('sw_fan'),
  );
  const login = async (user, pass) => {
    await page.click('#app-login-btn');
    await page.waitForSelector('dialog[open] input[autocomplete="username"]');
    await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = ''));
    await page.type('dialog[open] input[autocomplete="username"]', user);
    await page.type('dialog[open] input[autocomplete="current-password"]', pass);
    await page.keyboard.press('Enter');
  };
  await login('xem1', process.env.MAT_IT_PW_XEM1 ?? '');
  await until(
    async () => await page.$eval('#app-user', (e) => !e.hidden && e.textContent.includes('xem1')),
    'viewer đăng nhập',
    15000,
  );
  check(
    'viewer đăng nhập: công tắc vẫn khóa theo role',
    (await lockOf('sw_fan')) === 'ROLE',
    await lockOf('sw_fan'),
  );
  await page.click('#app-logout-btn');
  await until(async () => await page.$eval('#app-user', (e) => e.hidden), 'đăng xuất');
  const t0 = Date.now();
  await login('vh1', process.env.MAT_IT_PW_VH1 ?? '');
  await until(
    async () => (await page.$eval('#app-user', (e) => e.textContent)) === 'vh1 (operator)',
    'operator đăng nhập',
    15000,
  );
  measures.loginMs = Date.now() - t0;
  check(
    'operator đăng nhập: công tắc mở khóa',
    (await lockOf('sw_fan')) === null,
    await lockOf('sw_fan'),
  );
  const cookies = await page.cookies();
  const sid = cookies.find((c) => c.name === '__Host-mat_sid');
  check(
    'cookie phiên: HttpOnly, Secure, SameSite=Strict, Path=/',
    sid && sid.httpOnly && sid.secure && sid.sameSite === 'Strict' && sid.path === '/',
    JSON.stringify(sid && { ...sid, value: '…' }),
  );
  check(
    'trang JS không đọc được cookie phiên',
    !(await page.evaluate(() => document.cookie)).includes('mat_sid'),
  );
  // ghi công tắc
  const before = await wText(page, 'sw_fan');
  const tw = Date.now();
  await inW(page, 'sw_fan', 'w.shadowRoot.querySelector("[data-main]").click();');
  await waitDeep(page, '[role="alertdialog"]', 1, 8000);
  const dlg = await deepText(page, '[role="alertdialog"]');
  check(
    'hộp xác nhận hiện Tag, giá trị và tài khoản',
    /SIM\.FAN_ON|FAN/i.test(dlg ?? '') && (dlg ?? '').includes('vh1'),
    dlg,
  );
  await deepClick(page, '[data-ok]');
  await until(
    async () => /Đã ghi và xác nhận/.test(await wText(page, 'sw_fan')),
    'kết quả CONFIRMED',
    15000,
  );
  measures.writeFromChromeMs = Date.now() - tw;
  check(`ghi từ Chrome: CONFIRMED (đo ${measures.writeFromChromeMs} ms, từ lúc bấm)`, true);
  check('giá trị công tắc đổi sau khi ghi', (await wText(page, 'sw_fan')) !== before);
  // F5: phiên còn
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-switch', 1, 15000);
  await until(
    async () => (await page.$eval('#app-user', (e) => e.textContent)) === 'vh1 (operator)',
    'phiên còn sau F5',
    15000,
  );
  check('F5: phiên còn (khôi phục bằng web/session)', true);
  const store = await page.evaluate(() =>
    JSON.stringify([localStorage, sessionStorage, location.href]),
  );
  check('không có token hay CSRF trong localStorage/sessionStorage/URL', !store.includes('matw_'));
  await page.click('#app-logout-btn');
  await until(async () => await page.$eval('#app-user', (e) => e.hidden), 'đăng xuất');
  check('đăng xuất: công tắc khóa lại', (await lockOf('sw_fan')) === 'NO_SESSION');
  await ctx.close();
}

// ------------------------------------------------------------------------------------ compat

/** Bản chụp cấu trúc của màn hình đầu: uid và tên thuộc tính của mọi phần tử SVG có gắn binding (không có giá trị sống). */
async function compat(browser) {
  const out = opt('--out', '');
  const { ctx, page } = await newPage(browser);
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'warning' || m.type() === 'error') problems.push(m.text());
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await waitDeep(page, '[data-mat-uid]', 1, 20000);
  await until(async () => (await live(page)) === 'Trực tuyến', 'Trực tuyến', 15000);
  await sleep(2500); // vài chu kỳ để binding áp giá trị
  const snap = await deepEval(
    page,
    '[data-mat-uid]',
    'return els.map(e => ({ uid: e.getAttribute("data-mat-uid"), tag: e.tagName.toLowerCase(), attrs: [...e.getAttributeNames()].sort() })).sort((a, b) => a.uid.localeCompare(b.uid));',
  );
  const items = await page.$$eval('#app-nav button', (bs) => bs.length);
  const bad = problems.filter((t) => !/status of (401|404)/.test(t));
  check('màn hình dựng được: có phần tử SVG gắn binding', snap.length > 0, snap.length);
  check('không có cảnh báo hay lỗi trong console', bad.length === 0, bad.join(' | '));
  check('project một màn hình: không có menu (FR-016)', items === 0, items);
  measures.elements = snap.length;
  measures.snapshot = snap;
  if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(snap));
  await ctx.close();
}

// ----------------------------------------------------------------------------------- charts

/** SC-017 bản rút gọn: 8 biểu đồ x 8 đường, cửa sổ 3.600 s, lấy mẫu 250 ms, chạy --seconds (mặc định 300). */
async function charts(browser) {
  const seconds = Number(opt('--seconds', '300'));
  const { ctx, page } = await newPage(browser);
  await page.setViewport({ width: 1920, height: 1080 });
  const cdp = await page.createCDPSession();
  await cdp.send('Performance.enable');
  const heap = async () =>
    (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize')
      .value;
  await page.goto(`${BASE}/#/graf`, { waitUntil: 'domcontentloaded' });
  await until(async () => (await deepCount(page, 'mat-w-line')) >= 8, '8 biểu đồ', 30000);
  await until(async () => (await live(page)) === 'Trực tuyến', 'Trực tuyến', 15000);
  await until(
    async () => (await deepCount(page, 'canvas')) >= 8,
    '8 canvas uPlot (tải lười)',
    30000,
  );
  check('8 biểu đồ đường dựng được, mỗi cái một canvas uPlot', true);
  const legends = await deepEval(
    page,
    'mat-w-line',
    'return els.map((e) => e.shadowRoot.textContent.replace(/\\s+/g, " ").length);',
  );
  check(
    'mỗi biểu đồ có chú giải 8 đường',
    legends.every((n) => n > 50),
    JSON.stringify(legends),
  );
  await page.evaluate(
    `window.__frames = []; (function () { let last = performance.now(); const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length > 200000) window.__frames.shift(); requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`,
  );
  const warm = Math.min(60, Math.floor(seconds / 3));
  await sleep(warm * 1000);
  const heapWarm = await heap();
  await sleep((seconds - warm) * 1000);
  const heapEnd = await heap();
  const frames = await page.evaluate('window.__frames.slice(30)');
  frames.sort((a, b) => a - b);
  const p95 = frames[Math.floor(frames.length * 0.95)] ?? 0;
  measures.seconds = seconds;
  measures.heapWarmMB = Math.round(heapWarm / 1048576);
  measures.heapEndMB = Math.round(heapEnd / 1048576);
  measures.heapGrowthMB = Math.round((heapEnd - heapWarm) / 1048576);
  measures.frameP95Ms = Math.round(p95 * 10) / 10;
  check(
    `bộ nhớ JS cuối không lớn hơn mốc sau ${warm} s quá 100 MB (+${measures.heapGrowthMB} MB trong ${seconds - warm} s)`,
    heapEnd - heapWarm <= 100 * 1048576,
  );
  check(
    `p95 thời gian khung hình ≤ 33 ms (đo ${measures.frameP95Ms} ms, ${frames.length} khung)`,
    p95 <= 33.4,
  );
  const dead = await bodyText(page);
  check(
    'trang không báo lỗi trong lúc chạy',
    !/Không tải được|lỗi/i.test(dead.slice(0, 400)),
    dead.slice(0, 120),
  );
  await ctx.close();
}

// -------------------------------------------------------------------------------------- full

/** Client thứ 11 (maxClients 10): banner "Đầy" có câu của máy chủ và nút thử lại; không dựng nửa chừng (US1). */
async function full(browser) {
  const pages = [];
  for (let i = 0; i < 10; i++) pages.push(await newPage(browser));
  await Promise.all(pages.map(({ page }) => openApp(page, `${BASE}/#/tong-quan`)));
  await Promise.all(
    pages.map(({ page }) =>
      until(async () => (await live(page)) === 'Trực tuyến', 'Trực tuyến', 20000),
    ),
  );
  check('10 trang đầu đều trực tuyến', true);
  const eleven = await newPage(browser);
  await eleven.page.goto(`${BASE}/#/tong-quan`, { waitUntil: 'domcontentloaded' });
  await until(async () => (await live(eleven.page)) === 'Đầy', 'trang thứ 11 báo Đầy', 20000);
  const banner = await eleven.page.$eval('#app-banner', (b) => ({
    hidden: b.hidden,
    text: b.textContent,
  }));
  check(
    'trang thứ 11: banner hiện, có câu "số kết nối tối đa" và nút Thử lại ngay',
    !banner.hidden && /tối đa/.test(banner.text) && /Thử lại ngay/.test(banner.text),
    banner.text.replace(/\s+/g, ' '),
  );
  const noData = await deepCount(eleven.page, 'mat-w-card');
  check(
    'trang thứ 11 không có giá trị sống nửa chừng (card không có số)',
    !/\d/.test((await deepText(eleven.page, 'mat-w-card').catch(() => '')) ?? ''),
    noData,
  );
  await pages[0].ctx.close(); // một chỗ trống
  await eleven.page.click('#app-banner-retry');
  await until(
    async () => (await live(eleven.page)) === 'Trực tuyến',
    'thử lại được khi có chỗ',
    20000,
  );
  check('có chỗ trống thì "Thử lại ngay" vào được', true);
  for (const p of pages.slice(1)) await p.ctx.close();
  await eleven.ctx.close();
}

// ------------------------------------------------------------------------------------ deploy-live

/** Nạp xuống khi 10 trang đang xem và 1 lệnh xung đang chờ (US6-2, US6-3; SC-021): trang tự tải lại giữ màn hình, phiên còn. */
async function deployLive(browser) {
  const fp = opt('--fp', '');
  const pw = process.env.MAT_IT_PW_KYSU1 ?? '';
  const lg = await bearerLogin(BASE, fp, 'kysu1', pw);
  check('kỹ sư đăng nhập Bearer (API kỹ thuật)', lg.status === 200, lg.status);
  const token = lg.json.token;
  const cur = await fetchPackage(BASE, fp, token);
  const baseDigest = cur.headers['x-mat-digest'];
  check(
    'đọc được gói đang chạy (digest nền)',
    cur.status === 200 && Boolean(baseDigest),
    cur.status,
  );
  const files = readProjectDir('projects/dashboard-demo');
  const pj = files['project.json']
    .toString('utf8')
    .replace(/("projectVersion"\s*:\s*")[^"]*(")/, (_m, a, b) => a + '9.9.9' + b);
  files['project.json'] = Buffer.from(pj);
  const pkg = buildPackage(files);

  const pages = [];
  for (let i = 0; i < 10; i++) pages.push(await newPage(browser));
  await Promise.all(
    pages.map(({ page }) => openApp(page, `${BASE}/#/bon-nuoc`, '[data-mat-uid], mat-w-level')),
  );
  await Promise.all(
    pages.map(({ page }) =>
      until(async () => (await live(page)) === 'Trực tuyến', 'Trực tuyến', 20000),
    ),
  );
  for (const { page } of pages) await page.evaluate('window.__before = 1');
  // Operator đăng nhập ở trang 0
  const p0 = pages[0].page;
  await p0.click('#app-login-btn');
  await p0.waitForSelector('dialog[open] input[autocomplete="username"]');
  await p0.type('dialog[open] input[autocomplete="username"]', 'vh1');
  await p0.type(
    'dialog[open] input[autocomplete="current-password"]',
    process.env.MAT_IT_PW_VH1 ?? '',
  );
  await p0.keyboard.press('Enter');
  await until(
    async () => (await p0.$eval('#app-user', (e) => e.textContent)) === 'vh1 (operator)',
    'operator đăng nhập',
    15000,
  );
  // Một lệnh xung 6 s đang chờ (gửi bằng fetch của chính trang: cookie, Origin và CSRF thật)
  const requestId = await p0.evaluate(`(async () => {
    const s = await (await fetch('/api/v1/web/session')).json();
    const id = crypto.randomUUID();
    const r = await fetch('/api/v1/tags/write', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-MAT-CSRF': s.csrfToken }, body: JSON.stringify({ requests: [{ requestId: id, tag: 'PUMP01.RUN_CMD', value: true, pulseMs: 6000, context: { screen: 'bon-nuoc', widget: 'deploy_live' } }] }) });
    const j = await r.json();
    window.__csrf = s.csrfToken;
    return j.results?.[0]?.status === 'ACCEPTED' ? id : 'REFUSED ' + JSON.stringify(j);
  })()`);
  check(
    'lệnh xung 6 s được nhận (ACCEPTED) trước khi nạp xuống',
    !String(requestId).startsWith('REFUSED'),
    requestId,
  );
  const t0 = performance.now();
  const dep = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, baseDigest);
  check('nạp xuống được nhận (202)', dep.status === 202, `${dep.status} ${dep.body.slice(0, 100)}`);
  const op = await waitOperation(BASE, fp, token, dep.json?.opId, { timeoutMs: 90000 });
  measures.deployMs = Math.round(performance.now() - t0);
  check(
    `nạp xuống hoàn tất (committed) trong ${measures.deployMs} ms`,
    op.op?.result === 'committed',
    JSON.stringify(op.op?.error ?? op.op?.result),
  );
  // 10 trang tự tải lại: dấu window.__before biến mất, hash giữ nguyên
  const reloaded = await Promise.all(
    pages.map(async ({ page }) => {
      try {
        await until(
          async () =>
            (await page.evaluate('window.__before === undefined')) &&
            (await live(page)) === 'Trực tuyến',
          'tải lại và trực tuyến',
          40000,
        );
        return true;
      } catch {
        return false;
      }
    }),
  );
  measures.reloadedPages = reloaded.filter(Boolean).length;
  check(
    '10/10 trang tự tải lại và trực tuyến sau khi nạp xuống',
    reloaded.every(Boolean),
    `${measures.reloadedPages}/10`,
  );
  const hashes = await Promise.all(pages.map(({ page }) => hash(page)));
  check(
    'mọi trang giữ màn hình (#/bon-nuoc)',
    hashes.every((h) => h === '#/bon-nuoc'),
    hashes.join(','),
  );
  const user = await p0.$eval('#app-user', (e) => e.textContent).catch(() => '');
  check(
    'phiên web còn sau khi nạp xuống (execv giữ phiên): trang 0 vẫn là vh1',
    user === 'vh1 (operator)',
    user,
  );
  const ver = await p0.evaluate(
    `(async () => (await (await fetch('/api/v1/projects/active')).json()).project.projectVersion)()`,
  );
  check('project mới (9.9.9) đang chạy', ver === '9.9.9', ver);
  // Lệnh xung dở: có dòng kết quả (ok hoặc interrupted), không bỏ mở (FR-042 của 006)
  await sleep(1500);
  // audit cần quyền administrator
  const q = { action: 'tag.write', target: 'PUMP01.RUN_CMD', limit: 100 };
  const adm = await bearerLogin(BASE, fp, 'admin', process.env.MAT_IT_PW_ADMIN ?? '');
  const au = await audit(BASE, fp, adm.json.token, q);
  measures.auditStatus = au.status;
  const rows = au.json?.records ?? [];
  const mine = rows.filter((r) => {
    try {
      const d = typeof r.detail === 'object' ? r.detail : JSON.parse(r.detail ?? '{}');
      return d.requestId === requestId;
    } catch {
      return false;
    }
  });
  const results = mine.map((r) => r.result);
  measures.pulseAuditRows = results;
  check(
    'lệnh xung đang chờ lúc nạp xuống: có dòng nhận và dòng kết quả (ok hoặc interrupted)',
    results.includes('started') &&
      (results.includes('ok') || results.includes('interrupted') || results.includes('failed')),
    results.join(','),
  );
  const st = await p0.evaluate(
    `(async (id) => (await (await fetch('/api/v1/tags/write/' + id)).json()))(${JSON.stringify(requestId)})`,
  );
  measures.pulseResultAfter = st?.results?.[0]?.status ?? st?.status ?? st?.error;
  for (const p of pages) await p.ctx.close();
}

// ------------------------------------------------------------------------------------- f5x10

async function f5x10(browser) {
  const N = 10;
  const pages = [];
  for (let i = 0; i < N; i++) pages.push(await newPage(browser));
  await Promise.all(pages.map(({ page }) => openApp(page, `${BASE}/#/tong-quan`)));
  await Promise.all(pages.map(({ page }) => until(() => hasNumber(page), 'số lần đầu', 20000)));
  const rounds = [];
  for (let k = 0; k < 3; k++) {
    await sleep(1500);
    const t0 = performance.now();
    const times = await Promise.all(
      pages.map(async ({ page }) => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        try {
          await until(
            async () => (await live(page)) === 'Trực tuyến' && (await hasNumber(page)),
            'giá trị sống sau F5',
            15000,
          );
          return performance.now() - t0;
        } catch {
          return Infinity;
        }
      }),
    );
    rounds.push(times);
  }
  const worst = rounds.map((t) => Math.round(Math.max(...t)));
  measures.f5x10WorstMs = worst;
  measures.f5x10Median = Math.round(
    rounds.flat().sort((a, b) => a - b)[Math.floor(rounds.flat().length / 2)],
  );
  check(
    `10 phiên F5 cùng lúc: mọi trang có giá trị sống ≤ 5 s (3 vòng, chậm nhất ${worst.join(', ')} ms)`,
    worst.every((w) => w <= 5000),
    JSON.stringify(worst),
  );
  const banners = await Promise.all(pages.map(({ page }) => bodyText(page)));
  check(
    '0 trang báo lỗi 4429 (đầy chỗ) do dựng phiên chậm',
    banners.every((t) => !/4429|đầy|Đã đủ/i.test(t)),
    banners.filter((t) => /4429|đầy|Đã đủ/i.test(t)).length,
  );
  for (const p of pages) await p.ctx.close();
}

// --------------------------------------------------------------------------------------- open

async function openScreens(browser) {
  const { ctx, page } = await newPage(browser);
  await page.setViewport({ width: 1920, height: 1080 });
  const t0 = performance.now();
  await page.goto(`${BASE}/#/chuan`, { waitUntil: 'domcontentloaded' });
  await until(async () => (await deepCount(page, 'mat-w-tag-table')) >= 10, '10 bảng Tag', 20000);
  await until(async () => (await live(page)) === 'Trực tuyến', 'Trực tuyến', 20000);
  await until(
    async () => /\d/.test((await deepText(page, 'mat-w-tag-table')) ?? ''),
    'giá trị trong bảng',
    20000,
  );
  measures.openStandardMs = Math.round(performance.now() - t0);
  check(
    `màn hình chuẩn (20 widget, 100 Tag) có giá trị sống ≤ 2 s kể từ mở trang (đo ${measures.openStandardMs} ms)`,
    measures.openStandardMs <= 2000,
  );
  const t1 = performance.now();
  await page.$$eval('#app-nav button', (bs) =>
    bs.find((b) => b.textContent.includes('250')).click(),
  );
  await until(
    async () =>
      (await deepCount(page, 'mat-w-card, mat-w-label, mat-w-lamp, mat-w-gauge, mat-w-level')) >=
      250,
    '250 item',
    20000,
  );
  await until(
    async () => /\d/.test((await deepText(page, 'mat-w-card')) ?? ''),
    'giá trị trên 250 item',
    20000,
  );
  measures.open250Ms = Math.round(performance.now() - t1);
  check(
    `màn hình 250 item dựng xong và có giá trị ≤ 2 s sau khi chọn (đo ${measures.open250Ms} ms)`,
    measures.open250Ms <= 2000,
  );
  const t2 = performance.now();
  await page.$$eval('#app-nav button', (bs) =>
    bs.find((b) => b.textContent.includes('Chuẩn')).click(),
  );
  await until(
    async () => (await deepCount(page, 'mat-w-tag-table')) >= 10,
    'quay lại chuẩn',
    10000,
  );
  measures.switchBackMs = Math.round(performance.now() - t2);
  check(
    `chuyển lại màn hình đã mở ≤ 500 ms (đo ${measures.switchBackMs} ms)`,
    measures.switchBackMs <= 500,
  );
  // F5 trên 250 item
  const t3 = performance.now();
  await page.goto('about:blank');
  await page.goto(`${BASE}/#/lon`, { waitUntil: 'domcontentloaded' });
  await until(
    async () =>
      (await deepCount(page, 'mat-w-card')) >= 50 &&
      /\d/.test((await deepText(page, 'mat-w-card')) ?? ''),
    '250 item sau mở lạnh',
    20000,
  );
  measures.open250ColdMs = Math.round(performance.now() - t3);
  check(
    `mở lạnh trực tiếp #/lon (250 item) ≤ 2 s (đo ${measures.open250ColdMs} ms)`,
    measures.open250ColdMs <= 2000,
  );
  await ctx.close();
}

const table = {
  'deploy-live': deployLive,
  full,
  charts,
  compat,
  screens,
  widgets,
  'chrome-control': chromeControl,
  f5x10,
  open: openScreens,
};
if (!table[scenario]) {
  console.error(`kịch bản không biết: ${scenario}`);
  process.exit(2);
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
  defaultViewport: { width: 1366, height: 768 },
});
let failed = false;
try {
  await table[scenario](browser);
} catch (e) {
  check('chạy hết kịch bản', false, e.stack ?? String(e));
  failed = true;
} finally {
  await browser.close();
}
const pass = !failed && checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario, checks, measures, pass }));
process.exit(0);
