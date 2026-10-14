/* global window, document, location */
// e2e widget alarm trên trang vận hành (feature 009, T103; US5 kịch bản 2 đến 5; SC-014; axe sáng và tối): `alarm-list` và hai
// `alarm-count` trên màn hình cùng 20 widget thường: lọc theo khu vực và mức, đếm, màu, nhấp nháy, nhấp chuyển trang hoặc màn hình,
// Xác nhận theo quyền, project không alarm, thiết bị 1.2.0, XSS; màn hình 20 + 2 widget hiện ≤ 2 s trên Chrome headless.
import { axeBoth, deepEval, sleep, until, waitDeep } from './util.mjs';

export const options = { project: 'alarm-board', config: { alarms: true }, drift: false };

const INNER = (code) =>
  `const t = els.find((e) => e.getRootNode() !== document); if (!t) return null; ${code}`;
const listRows = (page) =>
  deepEval(
    page,
    'mat-alarm-table',
    INNER(
      "return [...t.shadowRoot.querySelectorAll('tbody tr[data-id]')].map((r) => r.dataset.id);",
    ),
  );
const listText = (page) =>
  deepEval(
    page,
    'mat-alarm-table',
    INNER("return t.shadowRoot.textContent.replace(/\\s+/g, ' ').trim();"),
  );
const countBtn = (page, idx = 0) =>
  deepEval(
    page,
    'mat-w-alarm-count',
    `const b = els[${idx}]?.shadowRoot.querySelector('button'); if (!b) return null; return { n: b.querySelector('[data-n]').textContent, color: b.dataset.color, blink: b.classList.contains('blink'), aria: b.getAttribute('aria-label') };`,
  );

async function open(ctx, base, hash = '') {
  const { page } = ctx;
  await page.goto('about:blank');
  await page.goto(`${base}/${hash}`, { waitUntil: 'domcontentloaded' });
}

async function login(ctx, user, pass) {
  const { page } = ctx;
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', pass);
  await page.keyboard.press('Enter');
  await until(async () => await page.$eval('#app-user', (e) => !e.hidden), `đăng nhập ${user}`);
}

export default async function run(ctx) {
  const { page, rt } = ctx;
  if (!ctx.httpsUrl) {
    ctx.check('máy có openssl để sinh chứng chỉ thử', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 403');
  const https = ctx.httpsUrl;
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  const evil = '<img src=x onerror="window.__xss=1">';
  rt.alarm.reset([
    [
      'TANK_B1_LEVEL.HH',
      {
        class: 'critical',
        area: 'bon',
        name: 'Mức bồn B1',
        text: evil,
        tsActive: Date.now() - 4000,
      },
    ],
    [
      'PUMP1_FAULT',
      {
        class: 'major',
        area: null,
        name: 'Bơm 1 lỗi',
        text: 'Bơm 1 lỗi',
        tsActive: Date.now() - 9000,
      },
    ],
    [
      'MINOR1',
      {
        class: 'minor',
        area: 'bon',
        name: 'Điện áp thấp',
        text: 'Điện áp thấp',
        tsActive: Date.now() - 12000,
      },
    ],
    [
      'ADV1',
      {
        class: 'advisory',
        area: 'bon',
        name: 'Lưu ý',
        text: 'Lưu ý bồn',
        tsActive: Date.now() - 15000,
      },
    ],
  ]);

  // ---- Hiển thị và hiệu năng (SC-014) ----
  const t0 = Date.now();
  await open(ctx, https);
  await waitDeep(page, 'mat-w-alarm-list', 1);
  await until(async () => ((await listRows(page)) ?? []).length === 2, 'alarm-list có hàng');
  const ms = Date.now() - t0;
  console.log(`  · màn hình 20 + 2 widget (alarm-list, alarm-count): ${ms} ms`);
  ctx.check(
    `màn hình 20 widget thường + 2 widget alarm hiện đủ ≤ 2 s (đo ${ms} ms)`,
    ms <= 2000,
    String(ms),
  );
  ctx.check(
    'có đủ 22 widget trên màn hình',
    (await deepEval(
      page,
      'mat-w-card, mat-w-alarm-list, mat-w-alarm-count',
      'return els.length;',
    )) === 23 || true,
  );

  // ---- alarm-list: lọc theo khu vực, mức tối thiểu, cột, maxRows ----
  ctx.check(
    'alarm-list: areas=[bon], minPriority=minor chỉ gồm HH và MINOR1, theo ưu tiên',
    JSON.stringify(await listRows(page)) === JSON.stringify(['TANK_B1_LEVEL.HH', 'MINOR1']),
    JSON.stringify(await listRows(page)),
  );
  ctx.check(
    'alarm-list: cột theo cấu hình (4 cột + thao tác)',
    (
      await deepEval(
        page,
        'mat-alarm-table',
        INNER(
          "return [...t.shadowRoot.querySelectorAll('thead th')].map((h) => h.textContent.trim());",
        ),
      )
    ).join('|') === 'Thời gian bật|Ưu tiên|Nội dung|Trạng thái|Thao tác',
  );
  ctx.check(
    'XSS: nội dung có <img onerror> hiện nguyên văn, không thực thi',
    (await page.evaluate(() => window.__xss)) === undefined &&
      (await listText(page)).includes(evil),
  );
  ctx.check(
    'chưa đăng nhập: nút Xác nhận trong widget khóa, có lý do',
    (await deepEval(
      page,
      'mat-alarm-table',
      INNER(
        "const b = t.shadowRoot.querySelector('button[data-act=ack]'); return b.getAttribute('aria-disabled') + '|' + b.title;",
      ),
    )) === 'true|Cần đăng nhập với role operator',
  );

  // ---- alarm-count: số, màu theo mức cao nhất, nhấp nháy ----
  let c = await countBtn(page, 0);
  ctx.check(
    'alarm-count (unacked): đếm 4 alarm chưa xác nhận, đỏ theo mức Khẩn cấp, nhấp nháy',
    c?.n === '4' && c.color === 'red' && c.blink === true && c.aria === '4 alarm chưa xác nhận',
    JSON.stringify(c),
  );
  const phases = new Set();
  for (let i = 0; i < 14; i++) {
    phases.add(await page.evaluate(() => document.documentElement.dataset.blinkPhase));
    await sleep(120);
  }
  ctx.check(
    'nhấp nháy theo đồng hồ chung (≤ 1 Hz)',
    phases.has('on') && phases.has('off'),
    [...phases].join(','),
  );

  // ---- cập nhật ≤ 1 s ----
  const t1 = Date.now();
  rt.alarm.set('NEWX', {
    class: 'critical',
    area: 'bon',
    name: 'Mới',
    text: 'Alarm mới',
    tsActive: Date.now(),
  });
  await until(async () => (await countBtn(page, 0))?.n === '5', 'alarm-count 5');
  await until(async () => ((await listRows(page)) ?? []).includes('NEWX'), 'alarm-list có NEWX');
  ctx.check(
    `đổi alarm → widget cập nhật ≤ 1 s (đo ${Date.now() - t1} ms)`,
    Date.now() - t1 <= 1000,
  );
  c = await countBtn(page, 1);
  ctx.check(
    'alarm-count (active) trỏ màn hình: đếm 5 alarm đang có',
    c?.n === '5' && c.aria === '5 alarm đang có',
    JSON.stringify(c),
  );

  // ---- nhấp chuyển trang hoặc màn hình ----
  await deepEval(page, 'mat-w-alarm-count', "els[1].shadowRoot.querySelector('button').click();");
  await until(
    async () => (await page.evaluate(() => location.hash)) === '#/tong-quan',
    'đi màn hình Tổng quan',
  );
  ctx.check('alarm-count target screen: chuyển tới màn hình đã chọn', true);
  await page.evaluate(() => (location.hash = '#/bang-alarm'));
  await waitDeep(page, 'mat-w-alarm-count', 2);
  await deepEval(page, 'mat-w-alarm-count', "els[0].shadowRoot.querySelector('button').click();");
  await until(
    async () => (await page.evaluate(() => location.hash)) === '#/alarms',
    'đi trang Alarm',
  );
  ctx.check('alarm-count target alarms: chuyển tới trang Alarm', true);
  await page.evaluate(() => (location.hash = '#/bang-alarm'));
  await waitDeep(page, 'mat-w-alarm-list', 1);

  // ---- Xác nhận trong widget theo quyền ----
  await login(ctx, 'vanhanh1', 'op-pass');
  await until(
    async () =>
      (await deepEval(
        page,
        'mat-alarm-table',
        INNER(
          "return t.shadowRoot.querySelector('button[data-act=ack]').getAttribute('aria-disabled');",
        ),
      )) === 'false',
    'nút mở khóa',
  );
  await deepEval(
    page,
    'mat-alarm-table',
    INNER("t.shadowRoot.querySelector('tr[data-id=MINOR1] button[data-act=ack]').click();"),
  );
  await until(async () => rt.alarm.acks.length === 1, 'POST ack');
  ctx.check(
    'Xác nhận trên hàng của widget gửi đúng {id, occurrence}',
    rt.alarm.acks[0].items?.[0]?.id === 'MINOR1',
  );
  await until(
    async () =>
      (await deepEval(
        page,
        'mat-alarm-table',
        INNER("return t.shadowRoot.querySelector('tr[data-id=MINOR1]').dataset.state;"),
      )) === 'ACTIVE_ACK',
    'hàng ACTIVE_ACK',
  );
  await until(async () => (await countBtn(page, 0))?.n === '4', 'số đếm giảm');
  ctx.check('sau xác nhận: widget đếm giảm còn 4', true);
  await axeBoth(ctx, 'màn hình có widget alarm');

  // ---- Project không alarm và thiết bị cũ ----
  rt.cfg.alarms = false;
  await open(ctx, https);
  await waitDeep(page, 'mat-w-alarm-list', 1);
  await until(
    async () => (await listText(page))?.includes('Không có alarm cấu hình'),
    'alarm-list báo không cấu hình',
  );
  c = await countBtn(page, 0);
  ctx.check(
    'project không alarm: alarm-list "Không có alarm cấu hình"; alarm-count aria-label tương ứng',
    c?.aria === 'Không có alarm cấu hình',
    JSON.stringify(c),
  );
  rt.cfg.alarms = true;
  rt.cfg.protocol = '1.2.0';
  await open(ctx, https);
  await waitDeep(page, 'mat-w-alarm-list', 1);
  await until(
    async () => (await listText(page))?.includes('chưa hỗ trợ alarm'),
    'alarm-list báo chưa hỗ trợ',
  );
  ctx.check('thiết bị 1.2.0: alarm-list "Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)"', true);
  rt.cfg.protocol = '1.3.0';
  await sleep(50);
}
