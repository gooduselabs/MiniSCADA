/* global document, window, location, getComputedStyle */
// e2e alarm trên trang vận hành (feature 009, T052; US1 kịch bản 1 đến 12; SC-003, SC-007, SC-012, SC-015): chuông và bảng thông báo (026),
// trang Alarm, huy hiệu, tiêu đề tab, Xác nhận một hàng và "tất cả", viewer khóa, âm thanh (AudioContext giả), mất kết nối,
// hai tab, project không alarm, thiết bị 1.2.0, giảm chuyển động; axe sáng và tối. Cần HTTPS (đăng nhập operator).
import { axeBoth, deepCount, deepEval, deepText, sleep, until, waitDeep } from './util.mjs';

export const options = { project: 'dashboard', config: { alarms: true }, drift: false };

const FAKE_AUDIO = `
  window.__ac = { created: 0, osc: 0, stopped: 0, resumes: 0 };
  class FakeParam { setValueAtTime() {} linearRampToValueAtTime() {} cancelScheduledValues() {} get value() { return 0; } set value(v) {} }
  class FakeAudioContext {
    constructor() { window.__ac.created++; this.state = 'suspended'; this.destination = {}; }
    get currentTime() { return performance.now() / 1000; }
    resume() { window.__ac.resumes++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() { window.__ac.osc++; return { type: 'sine', frequency: new FakeParam(), connect() {}, disconnect() {}, start() {}, stop() { window.__ac.stopped++; } }; }
    createGain() { return { gain: new FakeParam(), connect() {}, disconnect() {} }; }
    close() { return Promise.resolve(); }
  }
  window.AudioContext = FakeAudioContext;
`;

const bell = (page) =>
  page.$eval('#app-alarm-bell', (e) => {
    const b = e.querySelector('#app-alarm-bell-btn');
    const badge = e.querySelector('.al-bell-badge');
    return {
      hidden: e.hidden,
      aria: b.getAttribute('aria-label'),
      expanded: b.getAttribute('aria-expanded'),
      n: badge.hidden ? '' : badge.textContent,
      priority: b.dataset.priority,
      kind: b.dataset.kind,
      anim: getComputedStyle(badge).animationName,
    };
  });
const panelOpen = (page) => page.$eval('#app-alarm-panel', (e) => !e.hidden);
async function openPanel(page) {
  if (!(await panelOpen(page))) await page.click('#app-alarm-bell-btn');
  await page.waitForSelector('#app-alarm-panel:not([hidden])');
}
async function closePanel(page) {
  if (await panelOpen(page)) {
    await page.keyboard.press('Escape');
    await page.waitForSelector('#app-alarm-panel[hidden]', { hidden: true });
  }
}
const panelRows = (page) =>
  page.$$eval('#app-alarm-panel .al-n-item', (r) =>
    r.map((x) => ({ id: x.dataset.id, text: x.querySelector('.al-n-text').textContent })),
  );
const badge = (page) =>
  page.$eval('#app-nav [data-badge="alarms"]', (b) => ({
    hidden: b.hidden,
    text: b.textContent,
    aria: b.getAttribute('aria-label'),
  }));
const menuTexts = (page) =>
  page.$$eval('#app-nav button', (bs) => bs.map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
const rowIds = (page) => deepEval(page, 'tr[data-id]', 'return els.map((e) => e.dataset.id);');
const rowState = (page, id) =>
  deepEval(page, `tr[data-id="${id}"]`, 'return els[0] ? els[0].dataset.state : null;');
const unackIds = (rt) =>
  ['TANK_B1_LEVEL.HH', 'PUMP1_FAULT', 'MINOR1', 'NEW1', 'LATE', 'BON2'].filter(
    (id) => rt.alarm.get(id)?.state === 'ACTIVE_UNACK',
  );

async function open(ctx, base, hash = '') {
  const { page } = ctx;
  await page.goto('about:blank');
  await page.goto(`${base}/${hash}`, { waitUntil: 'domcontentloaded' });
  await until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );
}

async function login(ctx, user, pass) {
  const { page } = ctx;
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = ''));
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', pass);
  await page.keyboard.press('Enter');
  await until(async () => await page.$eval('#app-user', (e) => !e.hidden), `đăng nhập ${user}`);
}

const seed = (rt) =>
  rt.alarm.reset([
    [
      'TANK_B1_LEVEL.HH',
      {
        class: 'critical',
        area: 'bon',
        name: 'Mức bồn B1',
        text: 'Bồn B1 mức rất cao: 91,2 % (ngưỡng 90)',
        tsActive: Date.now() - 5000,
      },
    ],
    [
      'PUMP1_FAULT',
      {
        class: 'major',
        area: null,
        name: 'Bơm 1 lỗi',
        text: 'Bơm 1 lỗi',
        tsActive: Date.now() - 20000,
      },
    ],
    [
      'MINOR1',
      {
        class: 'minor',
        area: 'dien',
        name: 'Điện áp thấp',
        text: 'Điện áp thấp',
        tsActive: Date.now() - 40000,
      },
    ],
  ]);

export default async function run(ctx) {
  const { page, rt } = ctx;
  if (!ctx.httpsUrl) {
    ctx.check('máy có openssl để sinh chứng chỉ thử', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 403', 'status of 503');
  const https = ctx.httpsUrl;
  await page.evaluateOnNewDocument(FAKE_AUDIO);
  // Windows có thể bật "giảm hiệu ứng": đặt rõ để kiểm nhấp nháy; kịch bản giảm chuyển động đặt riêng ở dưới.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  // ---- Kịch bản 7, 2, 8, 9: khách (chưa đăng nhập) ----
  seed(rt);
  await open(ctx, https);
  await until(async () => (await bell(page)).n === '3', 'chuông có badge 3');
  let b = await bell(page);
  ctx.check(
    'không còn banner alarm ngang ở đầu trang',
    (await page.$$('#app-alarm-banner, .al-banner')).length === 0,
  );
  ctx.check(
    'chuông: aria-label "Cảnh báo: 3 chưa xác nhận", aria-expanded=false, badge đỏ (khẩn cấp) nháy nhẹ',
    b.aria === 'Cảnh báo: 3 chưa xác nhận' &&
      b.expanded === 'false' &&
      b.priority === 'critical' &&
      b.anim === 'al-bell-pulse',
    JSON.stringify(b),
  );
  ctx.check('chuông nằm trên thanh trên cùng', (await page.$('#app-bar #app-alarm-bell')) !== null);
  await openPanel(page);
  ctx.check(
    'bảng thông báo: khẩn cấp lên đầu, đủ 3 hàng',
    JSON.stringify((await panelRows(page)).map((r) => r.id)) ===
      JSON.stringify(['TANK_B1_LEVEL.HH', 'PUMP1_FAULT', 'MINOR1']),
    JSON.stringify(await panelRows(page)),
  );
  ctx.check(
    'hàng có thời gian tương đối và trạng thái',
    (await page.$eval('#app-alarm-panel .al-n-time', (e) => e.textContent)) === 'vừa xong' &&
      (await page.$eval('#app-alarm-panel .al-n-state', (e) => e.textContent)) === 'Chưa xác nhận',
  );
  ctx.check(
    'aria-expanded=true khi mở; focus vào bảng',
    (await bell(page)).expanded === 'true' &&
      (await page.evaluate(() => !!document.activeElement?.closest('#app-alarm-panel'))),
  );
  await axeBoth(ctx, 'bảng thông báo alarm mở');
  await page.keyboard.press('Escape');
  ctx.check(
    'Esc đóng bảng, focus về chuông',
    !(await panelOpen(page)) &&
      (await page.evaluate(() => document.activeElement?.id)) === 'app-alarm-bell-btn',
  );
  ctx.check(
    'menu có mục Alarm và Lịch sử alarm',
    (await menuTexts(page)).some((t) => t.startsWith('Alarm')) &&
      (await menuTexts(page)).includes('Lịch sử alarm'),
    (await menuTexts(page)).join('|'),
  );
  const bd = await badge(page);
  ctx.check(
    'huy hiệu menu: số 3, aria-label đọc được',
    !bd.hidden && bd.text === '3' && bd.aria === '3 alarm chưa xác nhận',
    JSON.stringify(bd),
  );
  ctx.check(
    'tiêu đề tab có tiền tố (3)',
    (await page.title()).startsWith('(3) '),
    await page.title(),
  );
  await openPanel(page);
  ctx.check(
    'viewer: nút Xác nhận trong bảng thông báo khóa kèm lý do',
    (await page.$eval('#app-alarm-panel .al-n-ack', (e) => e.getAttribute('aria-disabled'))) ===
      'true' &&
      (await page.$eval('#app-alarm-panel .al-panel-lock', (e) => e.textContent)) ===
        'Cần đăng nhập với role operator',
  );
  ctx.check(
    'chỉ báo "Âm thanh đang tắt, bấm để bật" (chưa có thao tác)',
    (await page.$eval('#app-sound-hint', (e) => !e.hidden && e.textContent)) ===
      'Âm thanh đang tắt, bấm để bật',
  );
  ctx.check(
    'chưa tạo AudioContext trước thao tác người dùng',
    (await page.evaluate(() => window.__ac.created)) === 0,
  );

  await page.click('#app-alarm-panel .al-panel-viewall');
  await until(
    async () => (await page.evaluate(() => location.hash)) === '#/alarms',
    '"Xem tất cả alarm" → #/alarms',
  );
  ctx.check('mở trang Alarm thì bảng thông báo đóng', !(await panelOpen(page)));
  await waitDeep(page, 'tr[data-id]', 3);
  ctx.check(
    'trang Alarm: đủ 3 hàng theo ưu tiên',
    JSON.stringify(await rowIds(page)) ===
      JSON.stringify(['TANK_B1_LEVEL.HH', 'PUMP1_FAULT', 'MINOR1']),
    JSON.stringify(await rowIds(page)),
  );
  ctx.check('chuông vẫn hiện trên trang Alarm', !(await bell(page)).hidden);
  ctx.check(
    'viewer: nút Xác nhận trên hàng khóa (aria-disabled)',
    (await deepEval(
      page,
      'button[data-act="ack"]',
      'return els.every((e) => e.getAttribute("aria-disabled") === "true");',
    )) === true,
  );
  const guest = await page.evaluate(
    async () =>
      (
        await fetch('/api/v1/alarms/ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ id: 'PUMP1_FAULT', occurrence: 1 }] }),
        })
      ).status,
  );
  ctx.check(
    'gọi thẳng API xác nhận khi chưa đăng nhập bị từ chối (SC-007)',
    guest === 401 || guest === 403,
    String(guest),
  );
  ctx.check('không có xác nhận nào lọt vào thiết bị', rt.alarm.acks.length === 0);
  await axeBoth(ctx, 'trang Alarm (alarm đang nhấp nháy)');

  // ---- Kịch bản 9: âm thanh (công tắc nằm trong bảng thông báo) ----
  await openPanel(page);
  await page.click('#app-sound-btn');
  await until(
    async () => (await page.evaluate(() => window.__ac.osc)) >= 1,
    'bộ phát âm thanh chạy',
  );
  ctx.check(
    'bật âm thanh bằng một nhấp: tạo AudioContext, resume, chỉ báo biến mất',
    (await page.evaluate(() => window.__ac.created)) === 1 &&
      (await page.$eval('#app-sound-hint', (e) => e.hidden)),
  );
  ctx.check(
    'công tắc có aria-pressed=true',
    (await page.$eval('#app-sound-btn', (e) => e.getAttribute('aria-pressed'))) === 'true',
  );
  await closePanel(page);
  const oscBefore = await page.evaluate(() => window.__ac.osc);
  await page.click('#app-sound-mute');
  await sleep(150);
  ctx.check(
    'Tắt tiếng dừng tiếng nhưng KHÔNG xác nhận alarm nào',
    (await page.evaluate(() => window.__ac.stopped)) >= 1 &&
      rt.alarm.acks.length === 0 &&
      unackIds(rt).length === 3,
  );
  const t0 = Date.now();
  rt.alarm.set('NEW1', {
    class: 'critical',
    area: 'bon',
    name: 'Mới',
    text: 'Alarm mới',
    tsActive: Date.now(),
  });
  await until(
    async () => (await page.evaluate(() => window.__ac.osc)) > oscBefore,
    'alarm mới bật tiếng lại',
  );
  ctx.check('alarm mới bật tiếng lại sau khi tắt tiếng', true);
  await until(async () => (await bell(page)).n === '4', 'chuông 4 chưa xác nhận');
  console.log(`  · đổi alarm → DOM chuông: ${Date.now() - t0} ms (SC-003)`);
  await until(async () => !(await page.$eval('#app-alarm-toast', (e) => e.hidden)), 'toast');
  ctx.check(
    'alarm khẩn cấp mới: toast ở góc với nội dung alarm',
    (await page.$eval('#app-alarm-toast', (e) => e.textContent)).includes('Alarm mới'),
  );
  ctx.check(
    'SC-003: từ lúc alarm đổi tới lúc DOM đổi ≤ 1 s',
    Date.now() - t0 <= 1000,
    String(Date.now() - t0),
  );

  // ---- Kịch bản 3, 7: operator xác nhận ----
  await login(ctx, 'vanhanh1', 'op-pass');
  await openPanel(page);
  await until(
    async () =>
      (await page.$eval('#app-alarm-panel .al-n-ack', (e) => e.getAttribute('aria-disabled'))) ===
      'false',
    'nút Xác nhận mở khóa',
  );
  ctx.check(
    'operator: nút trong bảng không còn khóa, không còn chú thích',
    await page.$eval('#app-alarm-panel .al-panel-lock', (e) => e.hidden),
  );
  ctx.check(
    'alarm mới nhất mức khẩn cấp ở đầu bảng',
    (await panelRows(page))[0]?.id === 'NEW1',
    JSON.stringify(await panelRows(page)),
  );
  await page.click('#app-alarm-panel .al-n-item[data-id="NEW1"] .al-n-ack');
  await until(async () => rt.alarm.acks.length >= 1, 'POST ack');
  const a0 = rt.alarm.acks[0];
  ctx.check(
    'Xác nhận một hàng gửi đúng MỘT {id, occurrence}',
    a0.items?.length === 1 && a0.items[0].id === 'NEW1',
    JSON.stringify(a0),
  );
  await until(async () => (await bell(page)).n === '3', 'chuông còn 3');
  ctx.check('sau xác nhận: tổng chưa xác nhận giảm còn 3', true);
  await closePanel(page);
  await until(async () => (await badge(page)).text === '3', 'huy hiệu 3');
  const ackedId = a0.items[0].id;
  await until(
    async () => (await rowState(page, ackedId)) === 'ACTIVE_ACK',
    'hàng đổi sang ACTIVE_ACK',
  );
  ctx.check(
    'hàng đã xác nhận hiện trạng thái bằng chữ',
    (await deepText(page, `tr[data-id="${ackedId}"] td.state`)).includes('Đã xác nhận') ||
      (await deepText(page, `tr[data-id="${ackedId}"] td.state`)).includes('đã xác nhận'),
  );

  // ---- Kịch bản 4: Xác nhận tất cả theo bộ lọc ----
  rt.alarm.set('BON2', {
    class: 'major',
    area: 'bon',
    name: 'Bồn 2',
    text: 'Bồn 2 cao',
    tsActive: Date.now(),
  });
  await until(async () => (await rowIds(page)).includes('BON2'), 'BON2 hiện');
  await page.select('select[data-f="area"]', 'bon');
  await sleep(150);
  const filtered = await rowIds(page);
  ctx.check(
    'lọc khu vực Bồn: chỉ alarm của khu vực',
    filtered.every((id) => ['TANK_B1_LEVEL.HH', 'NEW1', 'BON2'].includes(id)) &&
      !filtered.includes('MINOR1'),
    JSON.stringify(filtered),
  );
  await page.click('button[data-act="ackall"]');
  await page.waitForSelector('[role="dialog"]');
  ctx.check(
    'hộp Xác nhận tất cả nêu số lượng và bộ lọc',
    (await page.$eval('[role="dialog"]', (e) => e.textContent)).includes('(khu vực Bồn)'),
  );
  await axeBoth(ctx, 'hộp Xác nhận tất cả');
  rt.alarm.set('LATE', {
    class: 'major',
    area: 'bon',
    name: 'Muộn',
    text: 'Bật sau khi mở hộp',
    tsActive: Date.now(),
  });
  await sleep(500);
  const acksBefore = rt.alarm.acks.length;
  await page.click('[role="dialog"] button[data-act="confirm"]');
  await until(async () => rt.alarm.acks.length > acksBefore, 'POST ack all');
  const all = rt.alarm.acks.at(-1);
  ctx.check(
    'gửi {all, upToRevision, filter} với filter khu vực',
    all.all === true && typeof all.upToRevision === 'number' && all.filter?.areas?.[0] === 'bon',
    JSON.stringify(all),
  );
  await sleep(500);
  ctx.check(
    'alarm bật sau lúc mở hộp giữ nguyên chưa xác nhận',
    rt.alarm.get('LATE').state === 'ACTIVE_UNACK',
  );
  ctx.check(
    'alarm trong bộ lọc đã xác nhận; ngoài bộ lọc (MINOR1) giữ nguyên',
    rt.alarm.get('BON2').state === 'ACTIVE_ACK' && rt.alarm.get('MINOR1').state === 'ACTIVE_UNACK',
  );
  ctx.check(
    'thông báo kết quả theo mục và số alarm mới chưa xác nhận',
    (await deepText(page, '[data-msg]'))?.includes('alarm mới bật chưa được xác nhận') === true,
    await deepText(page, '[data-msg]'),
  );

  // ---- Lỗi AUDIT_UNAVAILABLE giữ bộ lọc ----
  rt.alarm.auditDown = true;
  await page.click('button[data-act="ackall"]');
  await page.waitForSelector('[role="dialog"]');
  await page.click('[role="dialog"] button[data-act="confirm"]');
  await until(
    async () => ((await deepText(page, '[data-msg]')) ?? '').includes('nhật ký kiểm toán'),
    'lỗi AUDIT_UNAVAILABLE bằng chữ tiếng Việt',
  );
  ctx.check(
    'lỗi audit: bộ lọc khu vực được giữ',
    (await page.$eval('select[data-f="area"]', (e) => e.value)) === 'bon',
  );
  rt.alarm.auditDown = false;
  await page.select('select[data-f="area"]', '');

  // ---- Tạm ẩn ----
  await page.evaluate(() =>
    document
      .querySelector('mat-alarm-table')
      .shadowRoot.querySelector('tr[data-id="MINOR1"] input[type="checkbox"]')
      .click(),
  );
  await page.click('button[data-act="shelve"]');
  await page.waitForSelector('[role="dialog"] input[data-f="reason"]');
  await page.type('[role="dialog"] input[data-f="reason"]', 'Đang hiệu chuẩn');
  await axeBoth(ctx, 'hộp Tạm ẩn');
  await page.click('[role="dialog"] button[data-act="confirm"]');
  await until(async () => rt.alarm.shelveCalls.length === 1, 'POST shelve');
  ctx.check(
    'Tạm ẩn gửi lý do và thời lượng mặc định 1 giờ',
    rt.alarm.shelveCalls[0].reason === 'Đang hiệu chuẩn' &&
      rt.alarm.shelveCalls[0].durationS === 3600,
  );
  await until(async () => !(await rowIds(page)).includes('MINOR1'), 'MINOR1 rời tab Đang có');
  ctx.check(
    'tab Tạm ẩn có (1)',
    (await page.$$eval('.al-tabs [role="tab"]', (t) => t[1].textContent)) === 'Tạm ẩn (1)',
  );
  await page.click('.al-tabs [role="tab"]:nth-child(2)');
  await waitDeep(page, 'tr[data-id="MINOR1"]', 1);
  await deepEval(page, 'button[data-act="unshelve"]', 'els[0].click();');
  await until(async () => !rt.alarm.get('MINOR1')?.shelved, 'gỡ tạm ẩn');
  await page.click('.al-tabs [role="tab"]:nth-child(1)');

  // ---- Kịch bản 8: viewer đăng nhập ----
  await page.click('#app-logout-btn');
  await until(async () => await page.$eval('#app-login-btn', (e) => !e.hidden), 'đăng xuất');
  await login(ctx, 'xem1', 'view-pass');
  ctx.check(
    'viewer đăng nhập: bảng đầy đủ, nút Xác nhận khóa với lý do',
    (await rowIds(page)).length >= 4 &&
      (await page.$eval('[data-lock]', (e) => e.textContent)) === 'Cần đăng nhập với role operator',
  );
  await page.click('#app-logout-btn');
  await until(async () => await page.$eval('#app-login-btn', (e) => !e.hidden), 'đăng xuất 2');
  await login(ctx, 'vanhanh1', 'op-pass');

  // ---- Kịch bản 11: hai tab ----
  seed(rt);
  const page2 = await ctx.context.newPage();
  page2.on('console', () => undefined);
  await page2.evaluateOnNewDocument(FAKE_AUDIO);
  await page2.goto(`${https}/#/alarms`, { waitUntil: 'domcontentloaded' });
  await until(
    async () => (await page2.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'tab 2 trực tuyến',
  );
  await open(ctx, https, '#/alarms');
  await waitDeep(page, 'tr[data-id]', 3);
  await waitDeep(page2, 'tr[data-id]', 3);
  const t1 = Date.now();
  await page.evaluate(() =>
    document
      .querySelector('mat-alarm-table')
      .shadowRoot.querySelector('tr[data-id="PUMP1_FAULT"] button[data-act="ack"]')
      .click(),
  );
  await until(
    async () => (await rowState(page2, 'PUMP1_FAULT')) === 'ACTIVE_ACK',
    'tab 2 cập nhật',
    3000,
  );
  ctx.check(
    `hai tab: tab kia cập nhật sau xác nhận (${Date.now() - t1} ms, ≤ 1000)`,
    Date.now() - t1 <= 1000,
  );
  const sameBefore = rt.alarm.acks.length;
  await Promise.all([
    page.evaluate(() =>
      document
        .querySelector('mat-alarm-table')
        .shadowRoot.querySelector('tr[data-id="MINOR1"] button[data-act="ack"]')
        .click(),
    ),
    page2.evaluate(() =>
      document
        .querySelector('mat-alarm-table')
        .shadowRoot.querySelector('tr[data-id="MINOR1"] button[data-act="ack"]')
        .click(),
    ),
  ]);
  await sleep(700);
  const msgs = [await deepText(page, '[data-msg]'), await deepText(page2, '[data-msg]')].join('|');
  ctx.check(
    'hai bên xác nhận cùng lúc: không lỗi, một bên nhận "Đã được xác nhận" hoặc cả hai thấy ACTIVE_ACK',
    rt.alarm.get('MINOR1').state === 'ACTIVE_ACK' && rt.alarm.acks.length >= sameBefore + 1,
    msgs,
  );
  await page2.close();

  // ---- Kịch bản 10: mất kết nối rồi snapshot mới thay hoàn toàn ----
  rt.holdAlarmSnapshot(true);
  rt.dropLive();
  await until(async () => (await bell(page)).kind === 'lost', 'chuông mất kết nối', 12000);
  ctx.check(
    'mất kết nối: chuông báo "!", nhãn mất kết nối, bảng mờ (data-stale)',
    (await bell(page)).aria === 'Cảnh báo: mất kết nối, danh sách có thể đã cũ' &&
      (await deepEval(page, '.wrap[data-stale]', 'return els.length;')) === 1,
  );
  rt.alarm.reset([
    ['ONLY_NEW', { class: 'major', name: 'Chỉ còn cái này', text: 'Chỉ còn cái này' }],
  ]);
  rt.holdAlarmSnapshot(false);
  rt.dropLive();
  await until(
    async () => JSON.stringify(await rowIds(page)) === JSON.stringify(['ONLY_NEW']),
    'snapshot mới thay hoàn toàn',
    15000,
  );
  ctx.check(
    'có lại kết nối: hàng cũ biến mất, bảng hết mờ, chuông trở lại bình thường',
    (await deepEval(page, '.wrap[data-stale]', 'return els.length;')) === 0 &&
      (await bell(page)).kind === 'live',
  );

  // ---- Kịch bản 2: giảm chuyển động ----
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await open(ctx, https, '#/alarms');
  await until(async () => (await bell(page)).n !== '', 'chuông (giảm chuyển động)');
  b = await bell(page);
  ctx.check('giảm chuyển động: badge không nháy', b.anim === 'none', JSON.stringify(b));
  const ph = new Set();
  for (let i = 0; i < 8; i++) {
    ph.add(await page.evaluate(() => document.documentElement.dataset.blinkPhase ?? 'none'));
    await sleep(150);
  }
  ctx.check('giảm chuyển động: đồng hồ nhấp nháy không chạy', !ph.has('off'), [...ph].join(','));
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  // ---- Kịch bản 12: project không có alarm ----
  rt.cfg.alarms = false;
  const subsBefore = rt.log.alarmSubs ?? 0;
  await open(ctx, https);
  await sleep(500);
  ctx.check(
    'không có alarm: không chuông, không mục Alarm trên menu, không subscribeAlarms',
    (await bell(page)).hidden &&
      !(await menuTexts(page)).some((t) => t.startsWith('Alarm')) &&
      (rt.log.alarmSubs ?? 0) === subsBefore,
    JSON.stringify(await menuTexts(page)),
  );
  ctx.check('không có alarm: tiêu đề tab không có tiền tố', !(await page.title()).startsWith('('));

  // ---- Thiết bị 1.2.0 ----
  rt.cfg.alarms = true;
  rt.cfg.protocol = '1.2.0';
  await open(ctx, https);
  await until(async () => (await bell(page)).kind === 'unsupported', 'chuông chưa hỗ trợ');
  await openPanel(page);
  ctx.check(
    'thiết bị 1.2.0: bảng thông báo "chưa hỗ trợ alarm", không nút xác nhận',
    (await page.$eval('#app-alarm-panel .al-panel-notice', (e) => e.textContent)) ===
      'Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)' &&
      (await page.$$('#app-alarm-panel .al-n-ack')).length === 0,
  );
  ctx.check(
    'thiết bị 1.2.0: mục Alarm có chú thích "chưa hỗ trợ", không huy hiệu',
    (await menuTexts(page)).some((t) => t.includes('(chưa hỗ trợ)')) &&
      (await page.$$('#app-nav [data-badge]')).length === 0,
    (await menuTexts(page)).join('|'),
  );
  ctx.check('thiết bị 1.2.0: không gửi subscribeAlarms', (rt.log.alarmSubs ?? 0) === subsBefore);
  await axeBoth(ctx, 'bảng thông báo chưa hỗ trợ');
  rt.cfg.protocol = '1.3.0';
  void deepCount;
}
