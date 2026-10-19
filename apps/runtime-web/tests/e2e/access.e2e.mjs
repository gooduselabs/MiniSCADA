/* global window, location */
// e2e phân quyền trên trang vận hành (feature 013, T021, T026; US3, US4): menu chỉ gồm trang được xem, mở trang bị cấm
// ra "Không có quyền xem trang này" (máy chủ trả 403 cho cấu hình màn hình), component bị ẩn không dựng (ô lưới trống),
// component bị khóa hiện "Cần quyền thao tác", màn hình mọi component bị ẩn hiện "Không có nội dung bạn được xem",
// 0 giá trị Tag bị cấm tới trình duyệt, `access-changed` dựng lại menu và màn hình. axe theme sáng và tối.
import { PASS, accessDemo, accessSeed, loginPage } from './access-fixture.mjs';
import { axeBoth, bodyText, deepCount, deepEval, sleep, until, waitDeep } from './util.mjs';

export const options = {
  fixture: accessDemo,
  access: accessSeed(),
  config: { viewerLogin: 'required' },
  drift: false,
};

const menuScreens = (page) =>
  page.$$eval('#app-nav button[data-screen]', (bs) => bs.map((b) => b.dataset.screen));
const hash = (page) => page.evaluate(() => location.hash).catch(() => '?');
const W = (id) => `.item[data-item-id="${id}"] > *`;
const lockOf = (page, id) =>
  deepEval(
    page,
    W(id),
    'const w = els[0]; const l = w && w.shadowRoot.querySelector("[data-lock]"); return l ? [l.getAttribute("data-lock"), l.textContent.trim()] : null;',
  );

async function go(page, id) {
  await page.evaluate((h) => (location.hash = h), `#/${id}`);
  await until(async () => (await hash(page)) === `#/${id}`, `#/${id}`);
  await sleep(400);
}

export default async function run(ctx) {
  const { page, rt, httpsUrl } = ctx;
  if (!httpsUrl) {
    ctx.check('máy có openssl (bỏ qua kịch bản HTTPS)', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 403', 'status of 404');
  rt.setValue('ENERGY.COST', 125000);

  await page.goto(`${httpsUrl}/#/luoi`, { waitUntil: 'domcontentloaded' });
  await loginPage(page, 'vh1', PASS.vh1);
  await waitDeep(page, 'mat-w-card', 2, 10000);
  await until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );

  // ---- Menu lọc theo quyền ----
  const menu = await menuScreens(page);
  ctx.check(
    'menu của vh1 không có Bồn nước (chỉ nhóm Bảo trì)',
    !menu.includes('bon-nuoc'),
    menu.join(','),
  );
  ctx.check(
    'menu có Lưới, Tổng quan, Bơm 1, Chi phí điện',
    ['luoi', 'tong-quan', 'bom1', 'chi-phi'].every((s) => menu.includes(s)),
    menu.join(','),
  );
  ctx.check('không phải administrator: không có mục Quản trị', !menu.includes('@quan-tri'));

  // ---- Ô lưới của component bị ẩn để trống ----
  const cells = await deepEval(
    page,
    'mat-screen',
    'const r = els[0].shadowRoot; return [...r.querySelectorAll(".cell")].map((c) => [c.dataset.cellId, c.querySelectorAll(".item").length]);',
  );
  const byCell = Object.fromEntries(cells);
  ctx.check(
    'lưới: ô c3 (Tốc độ bơm, chỉ Quản đốc) để trống',
    byCell.c3 === 0,
    JSON.stringify(cells),
  );
  ctx.check(
    'lưới: các ô khác vẫn có widget',
    byCell.c1 === 1 && byCell.c2 === 1 && byCell.c4 === 1,
  );
  await ctx.shot('luoi-o-trong');

  // ---- Component bị khóa "Cần quyền thao tác" ----
  await go(page, 'bom1');
  await waitDeep(page, 'mat-w-setpoint', 1);
  await until(async () => (await lockOf(page, 'run')) !== null, 'khóa nút Chạy bơm');
  const lk = await lockOf(page, 'run');
  ctx.check(
    'nút Chạy bơm khóa NO_PERMISSION, chữ "Cần quyền thao tác"',
    lk?.[0] === 'NO_PERMISSION' && lk[1].includes('Cần quyền thao tác'),
    JSON.stringify(lk),
  );
  ctx.check('biểu tượng khóa ở chữ lý do', lk?.[1].includes('🔒'));
  const auto = await lockOf(page, 'auto');
  ctx.check(
    'công tắc Tự động (không có quy tắc) không bị khóa vì quyền',
    auto?.[0] !== 'NO_PERMISSION',
    JSON.stringify(auto),
  );
  await ctx.shot('nut-khoa-can-quyen');

  // ---- Trang bị cấm: "Không có quyền", máy chủ 403 ----
  await go(page, 'bon-nuoc');
  await page.waitForSelector('.access-panel:not([hidden])');
  const t = await page.$eval('.access-panel', (e) => e.textContent);
  ctx.check(
    'mở #/bon-nuoc: "Không có quyền xem trang này"',
    t.includes('Không có quyền xem trang này'),
    t,
  );
  ctx.check('hash giữ #/bon-nuoc (không bị đổi về trang đầu)', (await hash(page)) === '#/bon-nuoc');
  ctx.check('không dựng màn hình', await page.$eval('#app-screen > mat-screen', (e) => e.hidden));
  const direct = await page.evaluate(async () => {
    const r = await fetch('/project/screens/bon-nuoc.screen.json');
    return r.status;
  });
  ctx.check('gọi thẳng cấu hình màn hình bị cấm → 403', direct === 403, direct);
  await ctx.shot('khong-co-quyen');
  await axeBoth(ctx, 'trang không có quyền');
  await page.click('.access-panel button');
  await until(async () => (await hash(page)) === '#/luoi', 'Về trang đầu');
  ctx.check('nút "Về trang đầu" mở màn hình đầu', true);

  // ---- Màn hình được xem nhưng mọi component bị ẩn ----
  await go(page, 'chi-phi');
  await page.waitForSelector('.access-panel:not([hidden])');
  const t2 = await page.$eval('.access-panel', (e) => e.textContent);
  ctx.check(
    '#/chi-phi: "Không có nội dung bạn được xem"',
    t2.includes('Không có nội dung bạn được xem'),
    t2,
  );
  await ctx.shot('khong-co-noi-dung');

  // ---- Không nhận giá trị Tag bị cấm ----
  await sleep(600);
  const sent = rt.log.sentTags.get('vh1') ?? new Set();
  ctx.check(
    '0 giá trị ENERGY.COST (chỉ dùng ở component bị ẩn) tới trình duyệt của vh1',
    !sent.has('ENERGY.COST'),
    [...sent].join(','),
  );
  ctx.check(
    'trang không đăng ký Tag của component bị ẩn',
    !rt.log.subscribes.some((s) => s.includes('ENERGY.COST')),
    JSON.stringify(rt.log.subscribes.at(-1)),
  );

  // ---- access-changed: mở khóa nút Chạy bơm (không tải lại trang) ----
  await go(page, 'bom1');
  await waitDeep(page, 'mat-w-setpoint', 1);
  await page.evaluate(() => (window.__mark = 'cu'));
  const seed = accessSeed().rules;
  rt.access.setRules(seed.filter((r) => r.resource !== 'item:bom1/run'));
  await until(
    async () => (await lockOf(page, 'run'))?.[0] !== 'NO_PERMISSION',
    'nút Chạy bơm mở khóa',
    6000,
  );
  ctx.check('access-changed: nút Chạy bơm hết khóa "Cần quyền thao tác"', true);
  ctx.check(
    'access-changed: không tải lại trang',
    (await page.evaluate(() => window.__mark)) === 'cu',
  );

  // ---- access-changed: bị cấm màn hình đang xem → "Không có quyền", menu bớt mục ----
  rt.access.setRules([
    ...seed,
    { resource: 'screen:bom1', level: 'view', grantees: ['group:quan-doc'] },
  ]);
  await page.waitForSelector('.access-panel:not([hidden])', { timeout: 6000 });
  ctx.check(
    'bị cấm màn hình đang xem: hiện "Không có quyền"',
    (await page.$eval('.access-panel', (e) => e.textContent)).includes('Không có quyền'),
  );
  ctx.check('menu không còn Bơm 1', !(await menuScreens(page)).includes('bom1'));

  // ---- access-changed: được xem màn hình mới (Bồn nước) → tải lại, menu có mục mới ----
  rt.access.setRules([
    ...seed.filter((r) => r.resource !== 'screen:bon-nuoc'),
    { resource: 'screen:bon-nuoc', level: 'view', grantees: ['group:bao-tri', 'group:ca-a'] },
  ]);
  await until(
    async () => (await menuScreens(page).catch(() => [])).includes('bon-nuoc'),
    'menu có Bồn nước',
    10000,
  );
  ctx.check(
    'được cấp quyền: menu có Bồn nước (trang tải lại, hash giữ nguyên)',
    (await hash(page)) === '#/bom1',
  );
  await go(page, 'bon-nuoc');
  await waitDeep(page, '.item[data-item-id="svg1"]', 1);
  ctx.check('mở được Bồn nước', (await deepCount(page, '.item[data-item-id="svg1"]')) === 1);
  ctx.check('không có thông báo lỗi cụt', !(await bodyText(page)).includes('HTTP 403'));
  await axeBoth(ctx, 'màn hình có component bị khóa');
}
