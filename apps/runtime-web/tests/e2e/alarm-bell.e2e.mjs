/* global document, window */
// e2e chuông cảnh báo và bảng thông báo (feature 026): bàn phím (Tab, Esc, focus về chuông), chủ đề vivid/industrial/dark,
// toast khẩn cấp, màn hẹp (bảng toàn chiều rộng), kiosk (chuông nổi), trạng thái trống; axe. Ảnh chụp: tests/e2e/out/ hoặc
// thư mục ở biến BELL_SHOTS_DIR (tên chuong-*.png).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { axeBoth, sleep, until } from './util.mjs';

export const options = { project: 'dashboard', config: { alarms: true }, drift: false };

const shotsDir = process.env.BELL_SHOTS_DIR || join(dirname(fileURLToPath(import.meta.url)), 'out');

async function shot(page, name, clip) {
  mkdirSync(shotsDir, { recursive: true });
  await sleep(250);
  await page.screenshot({ path: join(shotsDir, `chuong-${name}.png`), ...(clip ? { clip } : {}) });
}

async function theme(page, t) {
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: t === 'dark' ? 'dark' : 'light' },
    { name: 'prefers-reduced-motion', value: 'no-preference' },
  ]);
  await page.evaluate((x) => (document.documentElement.dataset.matTheme = x), t);
  await sleep(100);
}

const ago = (s) => Date.now() - s * 1000;
const seed = (rt) =>
  rt.alarm.reset([
    [
      'TANK_B1_LEVEL.HH',
      {
        class: 'critical',
        area: 'bon',
        name: 'Mức bồn B1',
        text: 'Bồn B1 mức rất cao: 91,2 % (ngưỡng 90)',
        valueActive: 91.2,
        tsActive: ago(40),
      },
    ],
    [
      'PUMP1_FAULT',
      { class: 'major', area: null, name: 'Bơm 1', text: 'Bơm 1 lỗi quá tải', tsActive: ago(150) },
    ],
    [
      'MINOR1',
      {
        class: 'minor',
        area: 'dien',
        name: 'Điện áp',
        text: 'Điện áp pha B thấp',
        tsActive: ago(620),
      },
    ],
    [
      'MINOR2',
      {
        class: 'minor',
        area: 'dien',
        name: 'Nhiệt độ tủ',
        text: 'Nhiệt độ tủ điện cao',
        tsActive: ago(3800),
        state: 'ACTIVE_ACK',
      },
    ],
  ]);

async function open(page, url) {
  await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );
}

export default async function run(ctx) {
  const { page, rt } = ctx;
  if (!ctx.httpsUrl) {
    ctx.check('máy có openssl để sinh chứng chỉ thử', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 403');
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  seed(rt);
  await open(page, ctx.httpsUrl);
  // operator: nút Xác nhận mở khóa
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = ''));
  await page.type('dialog[open] input[autocomplete="username"]', 'vanhanh1');
  await page.type('dialog[open] input[autocomplete="current-password"]', 'op-pass');
  await page.keyboard.press('Enter');
  await until(async () => await page.$eval('#app-user', (e) => !e.hidden), 'đăng nhập');
  await theme(page, 'vivid');
  await until(
    async () => (await page.$eval('.al-bell-badge', (e) => e.textContent)) !== '',
    'badge',
  );
  const bar = { x: 766, y: 0, width: 600, height: 52 };
  await shot(page, 'badge', bar);

  // ---- bàn phím ----
  await page.focus('#app-alarm-bell-btn');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#app-alarm-panel:not([hidden])');
  ctx.check(
    'Enter trên chuông mở bảng, aria-expanded=true',
    (await page.$eval('#app-alarm-bell-btn', (e) => e.getAttribute('aria-expanded'))) === 'true',
  );
  await page.keyboard.press('Tab');
  ctx.check(
    'Tab di chuyển trong bảng',
    await page.evaluate(() => !!document.activeElement?.closest('#app-alarm-panel')),
  );
  await shot(page, 'bang-vivid');
  await axeBoth(ctx, 'bảng thông báo (vivid)');
  await theme(page, 'vivid');
  await page.click('#app-alarm-panel [data-filter="all"]');
  await shot(page, 'bang-tatca-vivid');
  await page.click('#app-alarm-panel [data-filter="unack"]');
  await theme(page, 'dark');
  await shot(page, 'bang-dark');
  await ctx.axe('bảng thông báo (dark)');
  await theme(page, 'industrial');
  await shot(page, 'bang-industrial');
  await ctx.axe('bảng thông báo (industrial)');
  await theme(page, 'vivid');
  await page.keyboard.press('Escape');
  ctx.check(
    'Esc đóng, focus về chuông',
    (await page.$eval('#app-alarm-panel', (e) => e.hidden)) &&
      (await page.evaluate(() => document.activeElement?.id)) === 'app-alarm-bell-btn',
  );
  await page.click('#app-alarm-bell-btn');
  await page.mouse.click(400, 500);
  ctx.check('bấm ra ngoài thì đóng', await page.$eval('#app-alarm-panel', (e) => e.hidden));

  // ---- toast khẩn cấp ----
  rt.alarm.set('PRESS_HH', {
    class: 'critical',
    area: 'bon',
    name: 'Áp suất',
    text: 'Áp suất đường ống rất cao: 8,4 bar',
    tsActive: Date.now(),
  });
  await until(async () => !(await page.$eval('#app-alarm-toast', (e) => e.hidden)), 'toast');
  ctx.check(
    'toast khẩn cấp có nội dung alarm mới',
    (await page.$eval('#app-alarm-toast', (e) => e.textContent)).includes('Áp suất đường ống'),
  );
  ctx.check(
    'chuông rung khi có alarm mới',
    await page.$eval('#app-alarm-bell-btn', (e) => 'ring' in e.dataset),
  );
  await shot(page, 'toast');
  await page.click('#app-alarm-toast .al-toast-body');
  await page.waitForSelector('#app-alarm-panel:not([hidden])');
  ctx.check('bấm toast mở bảng thông báo', await page.$eval('#app-alarm-toast', (e) => e.hidden));
  await page.keyboard.press('Escape');

  // ---- màn hẹp ----
  await page.setViewport({ width: 390, height: 800 });
  await sleep(150);
  await page.click('#app-alarm-bell-btn');
  await page.waitForSelector('#app-alarm-panel:not([hidden])');
  const w = await page.$eval('#app-alarm-panel', (e) => e.getBoundingClientRect().width);
  ctx.check('màn hẹp: bảng gần toàn chiều rộng', w >= 370, String(w));
  ctx.check(
    'màn hẹp: không cuộn ngang',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  );
  await shot(page, 'hep');
  await theme(page, 'dark');
  await shot(page, 'hep-dark');
  await theme(page, 'vivid');
  await page.keyboard.press('Escape');
  await page.setViewport({ width: 1366, height: 768 });

  // ---- trạng thái trống ----
  for (const id of ['TANK_B1_LEVEL.HH', 'PUMP1_FAULT', 'MINOR1', 'MINOR2', 'PRESS_HH'])
    rt.alarm.remove(id);
  await until(async () => await page.$eval('.al-bell-badge', (e) => e.hidden), 'badge ẩn');
  await page.click('#app-alarm-bell-btn');
  await page.waitForSelector('#app-alarm-panel:not([hidden])');
  ctx.check(
    'trống: "Không có cảnh báo"',
    (await page.$eval('.al-panel-empty strong', (e) => e.textContent)) === 'Không có cảnh báo',
  );
  await shot(page, 'trong');
  await page.keyboard.press('Escape');

  // ---- kiosk ----
  seed(rt);
  await open(page, `${ctx.httpsUrl}/?kiosk=1`);
  await until(
    async () =>
      (await page.$('.al-bell-float:not([hidden]) #app-alarm-bell:not([hidden])')) !== null,
    'chuông nổi ở kiosk',
  );
  ctx.check('kiosk: chuông nổi ở góc khi thanh trên ẩn', true);
}
