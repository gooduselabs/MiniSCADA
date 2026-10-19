/* global document, location */
// e2e trang Quản trị (feature 013, T017, T018, T022, T027; US2–US4, FR-040 đến FR-044): mục Quản trị chỉ cho
// administrator; tab Người dùng (thêm với mật khẩu sinh một lần, sửa nhóm, tắt cần xác nhận lại, sai mật khẩu xác nhận,
// mở khóa, LAST_ADMIN, WEAK_PASSWORD, 409), Nhóm (tạo, đổi tên, xóa, IN_USE), Quyền theo trang (ma trận, đặt nhiều
// trang, sao chép, về mặc định, lưu theo lô, 409), Quyền theo component (xem trước bấm chọn, ai thấy/ai thao tác), Xem
// với tư cách (chỉ đọc), Nhật ký (lọc, tải thêm), kho hỏng → khôi phục, viewerLogin off, RATE_LIMITED; bàn phím trên
// thanh tab; axe sáng và tối. Ảnh: tests/e2e/out/admin-*.png.
import { PASS, accessDemo, accessSeed, loginPage } from './access-fixture.mjs';
import { axeBoth, setTheme, sleep, until } from './util.mjs';

export const options = {
  fixture: accessDemo,
  access: accessSeed({ auditSeed: 80 }),
  config: { viewerLogin: 'required' },
  drift: false,
};

const hash = (page) => page.evaluate(() => location.hash).catch(() => '?');
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const lastPost = (rt, path) => [...rt.access.log.posts].reverse().find((p) => p.path === path);
const toastText = (page) => text(page, '.ad-toast');
/** Bấm phần tử (thử lại khi bảng vừa dựng lại và nút cũ đã rời DOM). */
const press = (page, sel) =>
  until(() => page.$eval(sel, (e) => (e.click(), true)).catch(() => false), `bấm ${sel}`);

async function tab(page, id) {
  await page.evaluate((h) => (location.hash = h), `#/quan-tri/${id}`);
  await page.waitForSelector(`#ad-tab-${id}[aria-selected="true"]`);
  await sleep(250);
}

/** Chờ item `id` có trong mat-screen bên trong `host` (Shadow DOM). */
const inPreview = (page, host, id) =>
  page.waitForFunction(
    (h, i) =>
      Boolean(
        document
          .querySelector(h + ' mat-screen')
          ?.shadowRoot?.querySelector('.item[data-item-id="' + i + '"]'),
      ),
    { timeout: 10000 },
    host,
    id,
  );

/** Hộp thoại đang mở (cuối cùng). */
const dlg = (s = '') => `dialog.ad-dialog[open]${s ? ` ${s}` : ''}`;

async function reauth(page, pass) {
  const sel = dlg('input[autocomplete="current-password"]');
  await page.waitForSelector(sel);
  await page.type(sel, pass);
  await press(page, dlg('[data-confirm]'));
}

export default async function run(ctx) {
  const { page, rt, httpsUrl } = ctx;
  if (!httpsUrl) {
    ctx.check('máy có openssl (bỏ qua kịch bản HTTPS)', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push(
    'status of 400',
    'status of 401',
    'status of 403',
    'status of 409',
    'status of 429',
    'status of 503',
    'status of 404',
  );
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${httpsUrl}/#/quan-tri`, { waitUntil: 'domcontentloaded' });
  await loginPage(page, 'quantri', PASS.quantri);
  await page.waitForSelector('.ad-page');
  await page.waitForSelector('[data-user="vh1"]');
  ctx.check('#/quan-tri về tab Người dùng', (await hash(page)) === '#/quan-tri/nguoi-dung');
  ctx.check(
    'menu có mục Quản trị',
    (await page.$('#app-nav button[data-screen="@quan-tri"]')) !== null,
  );
  const rows = await page.$$eval('[data-user]', (r) => r.map((x) => x.dataset.user));
  ctx.check('bảng có 6 người dùng', rows.length === 6, rows.join(','));
  const vh1Row = await text(page, '[data-user="qd1"]');
  ctx.check(
    'hàng qd1: vai trò, nhóm dạng chip',
    vh1Row.includes('Vận hành') && vh1Row.includes('Quản đốc') && vh1Row.includes('Vận hành ca A'),
    vh1Row,
  );
  const kt1Row = await text(page, '[data-user="kt1"]');
  ctx.check(
    'kt1 đang khóa tạm: có giờ và nút Mở khóa',
    kt1Row.includes('đến') && kt1Row.includes('Mở khóa'),
    kt1Row,
  );
  ctx.check('thẻ số liệu: 6 người dùng', (await text(page, '.ad-stats')).includes('6'));
  ctx.check(
    'dải quy tắc mồ côi (screen:da-xoa)',
    (await page.$('[data-banner="orphans"]')) !== null,
  );
  await setTheme(page, 'light');
  await ctx.shot('nguoi-dung');
  await axeBoth(ctx, 'tab Người dùng');
  await setTheme(page, 'dark');
  await sleep(150);
  await ctx.shot('nguoi-dung-toi');
  await setTheme(page, 'light');

  // tìm kiếm
  await page.type('.ad-page input[type=search]', 'vh');
  await until(async () => (await page.$$('[data-user]')).length === 2, 'lọc còn 2');
  ctx.check('tìm "vh" còn vh1, vh2', true);
  await page.$eval('.ad-page input[type=search]', (e) => {
    e.value = '';
    e.dispatchEvent(new Event('input'));
  });

  // ---- Thêm người dùng, mật khẩu sinh ngẫu nhiên hiện một lần ----
  await press(page, '[data-add-user]');
  await page.waitForSelector(dlg());
  await page.type(dlg('input[type=text]'), 'vh3');
  await press(page, dlg('[data-confirm]'));
  await page.waitForSelector(dlg('[data-otp]'));
  const otp = await text(page, dlg('[data-otp]'));
  ctx.check(
    'thêm vh3: mật khẩu sinh hiện một lần, đúng mật khẩu máy chủ',
    otp.length >= 15 && rt.access.users.get('vh3')?.password === otp,
    otp,
  );
  ctx.check('hộp mật khẩu một lần có nút Chép', (await page.$(dlg('[data-copy]'))) !== null);
  await ctx.shot('mat-khau-mot-lan');
  await axeBoth(ctx, 'hộp mật khẩu một lần');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-user="vh3"]');
  ctx.check('vh3 xuất hiện trong bảng', true);

  // WEAK_PASSWORD (máy chủ: mật khẩu chứa tên)
  await press(page, '[data-add-user]');
  await page.waitForSelector(dlg());
  await page.type(dlg('input[type=text]'), 'vh4');
  await press(page, dlg('input[value=own]'));
  const pws = await page.$$(dlg('.ad-pwfields input[type=password]'));
  await pws[0].type('vh4-mat-khau-rat-dai-2026');
  await pws[1].type('vh4-mat-khau-rat-dai-2026');
  await press(page, dlg('[data-confirm]'));
  await until(
    async () => await page.$eval(dlg('.ad-error'), (e) => !e.hidden).catch(() => false),
    'lỗi WEAK_PASSWORD',
  );
  const weak = await text(page, dlg('.ad-error'));
  ctx.check(
    'WEAK_PASSWORD: lý do "không được chứa tên tài khoản"',
    weak.includes('không được chứa tên tài khoản'),
    weak,
  );
  await page.keyboard.press('Escape');

  // ---- Sửa nhóm (không cần xác nhận lại) ----
  await press(page, '[data-edit="vh1"]');
  await page.waitForSelector(dlg('[data-grantee="quan-doc"]'));
  await press(page, dlg('[data-grantee="quan-doc"]'));
  await ctx.shot('sua-nguoi-dung');
  await press(page, dlg('[data-confirm]'));
  await until(
    async () => rt.access.users.get('vh1').groups.includes('quan-doc'),
    'vh1 vào Quản đốc',
  );
  ctx.check(
    'sửa nhóm vh1: POST groups, không có reauth',
    !('reauth' in (lastPost(rt, '/api/v1/admin/users/vh1')?.body ?? {})) ||
      lastPost(rt, '/api/v1/admin/users/vh1').body.reauth === undefined,
  );

  // ---- Tắt vh2: cần xác nhận lại; sai mật khẩu báo lỗi, giữ hộp; đúng thì tắt ----
  await page.waitForSelector('[data-edit="vh2"]');
  await press(page, '[data-edit="vh2"]');
  await page.waitForSelector(dlg('input[type=checkbox]'));
  await press(page, dlg('.ad-check input'));
  await press(page, dlg('[data-confirm]'));
  await page.waitForSelector(dlg('.ad-reauth-note'));
  ctx.check('tắt tài khoản: mở hộp xác nhận lại bằng mật khẩu', true);
  await ctx.shot('xac-nhan-lai');
  await axeBoth(ctx, 'hộp xác nhận lại');
  await reauth(page, 'sai-mat-khau-quan-tri');
  await until(
    async () => await page.$eval(dlg('.ad-error'), (e) => !e.hidden).catch(() => false),
    'lỗi REAUTH',
  );
  ctx.check(
    'sai mật khẩu xác nhận: "Mật khẩu xác nhận không đúng", hộp còn mở',
    (await text(page, dlg('.ad-error'))).includes('Mật khẩu xác nhận không đúng'),
  );
  await reauth(page, PASS.quantri);
  await until(async () => rt.access.users.get('vh2').enabled === false, 'vh2 bị tắt');
  ctx.check(
    'đúng mật khẩu: vh2 bị tắt, thân có reauth',
    lastPost(rt, '/api/v1/admin/users/vh2')?.body.reauth === '***',
  );

  await until(
    async () => (await text(page, '[data-user="vh2"]')).includes('Đã tắt'),
    'bảng tải lại sau khi tắt vh2',
  );
  // ---- Mở khóa kt1 ----
  await page.waitForSelector('[data-user="kt1"] button[aria-label="Mở khóa kt1"]');
  await press(page, '[data-user="kt1"] button[aria-label="Mở khóa kt1"]');
  await until(async () => rt.access.users.get('kt1').locked === null, 'kt1 mở khóa');
  ctx.check('mở khóa kt1', true);
  await until(
    async () => !(await text(page, '[data-user="kt1"]')).includes('Mở khóa'),
    'bảng tải lại sau mở khóa',
  );

  // ---- LAST_ADMIN: hạ vai trò chính mình (admin duy nhất) ----
  await page.waitForSelector('[data-edit="quantri"]');
  await press(page, '[data-edit="quantri"]');
  await page.waitForSelector(dlg('select'));
  await page.select(dlg('select'), 'engineer');
  await press(page, dlg('[data-confirm]'));
  await reauth(page, PASS.quantri);
  await until(async () => (await toastText(page)).includes('quản trị viên'), 'toast LAST_ADMIN');
  ctx.check(
    'LAST_ADMIN: "Phải còn ít nhất một quản trị viên đang bật."',
    (await toastText(page)).includes('Phải còn ít nhất một quản trị viên'),
  );
  ctx.check(
    'quantri vẫn là administrator',
    rt.access.users.get('quantri').role === 'administrator',
  );
  await sleep(300);

  // ---- 409: admin khác vừa sửa ----
  rt.access.bumpRev('users');
  await press(page, '[data-edit="xem1"]');
  await page.waitForSelector(dlg('select'));
  await page.select(dlg('select'), 'operator');
  await press(page, dlg('[data-confirm]'));
  await page.waitForSelector('[data-banner="conflict"]');
  ctx.check(
    '409: dải "Dữ liệu đã đổi bởi người khác, tải lại"',
    (await text(page, '[data-banner="conflict"]')).includes('Dữ liệu đã đổi bởi người khác'),
  );
  await ctx.shot('xung-dot-409');
  await press(page, '[data-banner="conflict"] button');
  await until(async () => (await page.$('[data-banner="conflict"]')) === null, 'tải lại hết dải');
  ctx.check('Tải lại: hết dải xung đột', true);

  // ---- Đặt lại mật khẩu (xác nhận lại, sinh ngẫu nhiên) ----
  await press(page, '[data-edit="vh3"]');
  await page.waitForSelector(dlg('.ad-more'));
  const more = await page.$$(dlg('.ad-more-actions button'));
  await more[0].click();
  await reauth(page, PASS.quantri);
  await page.waitForSelector(dlg('[data-otp]'));
  const otp2 = await text(page, dlg('[data-otp]'));
  ctx.check(
    'đặt lại mật khẩu vh3: mật khẩu mới hiện một lần',
    otp2 !== otp && rt.access.users.get('vh3').password === otp2,
  );
  await page.keyboard.press('Escape');

  // ---- Xóa vh3 ----
  await press(page, '[data-edit="vh3"]');
  await page.waitForSelector(dlg('.ad-more'));
  await (await page.$$(dlg('.ad-more-actions button'))).at(-1).click();
  await reauth(page, PASS.quantri);
  await until(async () => !rt.access.users.has('vh3'), 'vh3 bị xóa');
  ctx.check('xóa vh3 (xác nhận lại)', true);

  // ---- Bàn phím trên thanh tab ----
  await page.focus('#ad-tab-nguoi-dung');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('#ad-tab-nhom[aria-selected="true"]');
  ctx.check(
    'mũi tên phải chuyển sang tab Nhóm, focus theo',
    await page.evaluate(() => document.activeElement?.id === 'ad-tab-nhom'),
  );

  // ---- Nhóm ----
  await page.waitForSelector('[data-group="ca-a"]');
  await press(page, '[data-add-group]');
  await page.waitForSelector(dlg());
  await page.type(dlg('input'), 'Vận hành ca B');
  ctx.check(
    'mã nhóm gợi ý từ tên: van-hanh-ca-b',
    (await page.$$eval(dlg('input'), (i) => i[1].value)) === 'van-hanh-ca-b',
  );
  await press(page, dlg('[data-confirm]'));
  await page.waitForSelector('[data-group="van-hanh-ca-b"]');
  ctx.check(
    'tạo nhóm Vận hành ca B',
    rt.access.store.groups.some((g) => g.id === 'van-hanh-ca-b'),
  );
  await press(page, '[data-group="van-hanh-ca-b"] button[aria-label="Đổi tên nhóm Vận hành ca B"]');
  await page.waitForSelector(dlg('input'));
  await page.$eval(dlg('input'), (e) => (e.value = ''));
  await page.type(dlg('input'), 'Ca B');
  await press(page, dlg('[data-confirm]'));
  await until(
    async () => rt.access.store.groups.find((g) => g.id === 'van-hanh-ca-b')?.name === 'Ca B',
    'đổi tên',
  );
  ctx.check('đổi tên nhóm thành Ca B', true);
  await page.waitForSelector('[data-group="bao-tri"]');
  await press(page, '[data-group="bao-tri"] button[aria-label="Xóa nhóm Bảo trì"]');
  await reauth(page, PASS.quantri);
  await page.waitForSelector(dlg('[data-inuse="users"]'));
  const inuse = await text(page, dlg());
  ctx.check(
    'IN_USE: hiện thành viên kt1 và quy tắc Bồn nước',
    inuse.includes('kt1') && inuse.includes('screen:bon-nuoc'),
    inuse,
  );
  await ctx.shot('nhom-dang-dung');
  await page.keyboard.press('Escape');
  await press(page, '[data-group="trong"] button[aria-label="Xóa nhóm Nhóm trống"]');
  await reauth(page, PASS.quantri);
  await until(async () => !rt.access.store.groups.some((g) => g.id === 'trong'), 'xóa nhóm trống');
  ctx.check('xóa nhóm không dùng (xác nhận lại)', true);
  await sleep(300);
  await ctx.shot('nhom');
  await axeBoth(ctx, 'tab Nhóm');

  // ---- Quyền theo trang ----
  await tab(page, 'quyen-trang');
  await page.waitForSelector('tr[data-resource="screen:bon-nuoc"]');
  const bon = await page.$eval('tr[data-resource="screen:bon-nuoc"]', (r) => ({
    cls: r.className,
    baoTri: r.querySelector('[data-grantee="group:bao-tri"]').checked,
    caA: r.querySelector('[data-grantee="group:ca-a"]').checked,
  }));
  ctx.check(
    'Bồn nước: "Đã đặt", Bảo trì tích, Ca A không',
    bon.cls.includes('is-set') && bon.baoTri && !bon.caA,
    JSON.stringify(bon),
  );
  const tq = await page.$eval('tr[data-resource="screen:tong-quan"]', (r) => ({
    cls: r.className,
    all: r.querySelector('[data-grantee="*"]').checked,
    state: r.querySelector('.state').textContent,
  }));
  ctx.check(
    'Tổng quan: "Mặc định", tương đương Mọi người',
    tq.cls.includes('is-default') && tq.all && tq.state.includes('Mặc định'),
    JSON.stringify(tq),
  );
  ctx.check(
    'có hàng trang hệ thống (Alarm)',
    (await page.$('tr[data-resource="page:alarms"]')) !== null,
  );
  await press(page, 'tr[data-resource="screen:bon-nuoc"] [data-grantee="group:ca-a"]');
  await page.waitForSelector('.ad-pending:not([hidden])');
  ctx.check(
    'thanh "1 thay đổi chưa lưu"',
    (await text(page, '.ad-pending')).includes('1 thay đổi chưa lưu'),
  );
  // Đặt cho nhiều trang + sao chép từ trang khác
  await press(page, 'tr[data-resource="screen:tong-quan"] td.sel input');
  await press(page, 'tr[data-resource="screen:hong"] td.sel input');
  await press(page, '[data-bulk]');
  await page.waitForSelector(dlg('select'));
  await page.select(dlg('select'), 'screen:bon-nuoc');
  await sleep(100);
  const pressed = await page.$$eval(dlg('[data-grantee][aria-pressed="true"]'), (b) =>
    b.map((x) => x.dataset.grantee),
  );
  ctx.check(
    'sao chép từ Bồn nước: chọn sẵn Bảo trì + Ca A',
    pressed.includes('group:bao-tri') && pressed.includes('group:ca-a'),
    pressed.join(','),
  );
  await ctx.shot('dat-nhieu-trang');
  await axeBoth(ctx, 'hộp đặt quyền nhiều trang');
  await press(page, dlg('[data-confirm]'));
  await sleep(200);
  ctx.check(
    'thanh "3 thay đổi chưa lưu"',
    (await text(page, '.ad-pending')).includes('3 thay đổi chưa lưu'),
  );
  await setTheme(page, 'light');
  await ctx.shot('quyen-theo-trang');
  await axeBoth(ctx, 'tab Quyền theo trang');
  await setTheme(page, 'dark');
  await sleep(150);
  await ctx.shot('quyen-theo-trang-toi');
  await setTheme(page, 'light');
  await press(page, '[data-save]');
  await until(async () => lastPost(rt, '/api/v1/admin/access') !== undefined, 'POST access');
  const set = lastPost(rt, '/api/v1/admin/access').body.set;
  ctx.check(
    'lưu theo lô: 3 phần tử, có rev',
    set.length === 3 && typeof lastPost(rt, '/api/v1/admin/access').body.rev === 'number',
    JSON.stringify(set),
  );
  ctx.check(
    'Tổng quan và Màn hình hỏng nhận [Bảo trì, Ca A]',
    rt.access.store.rules
      .find((r) => r.resource === 'screen:hong')
      ?.grantees.sort()
      .join() === 'group:bao-tri,group:ca-a',
  );
  await page.waitForSelector('.ad-pending[hidden]');
  // Về mặc định
  await press(page, 'tr[data-resource="screen:hong"] td.acts button');
  await press(page, '[data-save]');
  await until(
    async () => !rt.access.store.rules.some((r) => r.resource === 'screen:hong'),
    'hong về mặc định',
  );
  ctx.check('Về mặc định: grantees null, quy tắc bị xóa', true);
  await page.waitForSelector('.ad-pending[hidden]');
  await until(
    async () =>
      (await page.$eval('tr[data-resource="screen:hong"]', (r) => r.className)).includes(
        'is-default',
      ),
    'ma trận tải lại',
  );
  await sleep(300);
  // 409 trên ma trận
  rt.access.bumpRev();
  await press(page, 'tr[data-resource="page:reports"] [data-grantee="role:engineer"]');
  await press(page, '[data-save]');
  await page.waitForSelector('[data-banner="conflict"]');
  ctx.check('409 khi lưu quyền: dải xung đột', true);
  await press(page, '[data-banner="conflict"] button');
  await until(async () => (await page.$('[data-banner="conflict"]')) === null, 'tải lại');

  // RATE_LIMITED
  rt.access.cfg.rateLimit = 0;
  await press(page, 'tr[data-resource="page:reports"] [data-grantee="role:engineer"]');
  await press(page, '[data-save]');
  await until(async () => (await toastText(page)).includes('quá nhanh'), 'toast RATE_LIMITED');
  ctx.check('RATE_LIMITED: báo "Thao tác quá nhanh"', true);
  rt.access.cfg.rateLimit = 30;
  await press(page, '.ad-pending button');

  // ---- Quyền theo component ----
  await tab(page, 'quyen-thanh-phan');
  await page.waitForSelector('#ad-comp-screen');
  await page.select('#ad-comp-screen', 'bom1');
  await inPreview(page, '.ad-comp', 'run');
  await page.waitForSelector('.ad-pick[data-pick="run"]');
  await press(page, '.ad-pick[data-pick="run"]');
  await page.waitForSelector('.ad-inspector [data-level="operate"]');
  ctx.check('bấm Chạy bơm trên xem trước: khung bên phải có "Ai được thao tác"', true);
  const op = await page.$$eval('.ad-inspector [data-level="operate"] [aria-pressed="true"]', (b) =>
    b.map((x) => x.dataset.grantee),
  );
  ctx.check('Ai được thao tác: Quản đốc', op.join() === 'group:quan-doc', op.join());
  await page.waitForSelector('.ad-who [data-who="vh2"]');
  const who = await page.$$eval('.ad-who tr[data-who]', (r) =>
    Object.fromEntries(
      r.map((x) => [
        x.dataset.who,
        [...x.querySelectorAll('.ad-yn')].map((y) => y.classList.contains('yes')),
      ]),
    ),
  );
  ctx.check(
    'ai thấy/ai thao tác: qd1 thao tác được, vh2 thấy nhưng không thao tác',
    who.qd1?.[1] === true && who.vh2?.[0] === true && who.vh2?.[1] === false,
    JSON.stringify(who),
  );
  ctx.check(
    'một lần gọi /admin/effective?users= theo lô cho mọi người',
    rt.access.log.batches === 1 && rt.access.log.effective.length >= 5,
    `${rt.access.log.batches} lô`,
  );
  await sleep(300);
  await ctx.shot('quyen-component');
  await axeBoth(ctx, 'tab Quyền theo component');
  // component chỉ hiển thị: không có Ai được thao tác
  await press(page, '.ad-itembtn[data-item="lvl"]');
  await page.waitForSelector('.ad-inspector [data-display-only]');
  ctx.check(
    'thẻ Mức bồn (chỉ hiển thị): không cho đặt quyền thao tác',
    (await page.$('.ad-inspector [data-level="operate"]')) === null,
  );
  // sửa Ai được xem bằng bàn phím
  await page.focus('.ad-inspector [data-level="view"] [data-grantee="group:quan-doc"]');
  await page.keyboard.press('Space');
  await page.waitForSelector('.ad-pending:not([hidden])');
  ctx.check(
    'Space trên chip: thêm vào bản nháp, focus giữ trên chip',
    await page.evaluate(
      () => document.activeElement?.getAttribute('data-grantee') === 'group:quan-doc',
    ),
  );
  await press(page, '.ad-pending button');

  // ---- Xem với tư cách ----
  await tab(page, 'xem-voi-tu-cach');
  await page.select('#ad-viewas-user', 'vh2');
  await press(page, '[data-viewas-start]');
  await page.waitForSelector('[data-banner="view-as"]');
  ctx.check(
    'banner "Đang xem với tư cách vh2 … Chỉ đọc"',
    (await text(page, '[data-banner="view-as"]')).includes('Đang xem với tư cách vh2'),
  );
  const vs = await page.$$eval('.ad-viewas-screens [data-screen]', (b) =>
    b.map((x) => x.dataset.screen),
  );
  // Ca A vừa được cấp Bồn nước ở tab Quyền theo trang: danh sách phải đúng như máy chủ tính.
  const want = rt.access.effectiveOf({ user: 'vh2', role: 'operator', groups: ['ca-a'] }).effective
    .screens;
  ctx.check(
    'danh sách màn hình của vh2 đúng như máy chủ tính',
    vs.join() === want.join(),
    `${vs} / ${want}`,
  );
  await inPreview(page, '.ad-viewas-main', 'muc');
  await sleep(500);
  const cells = await page.$eval('.ad-viewas-main mat-screen', (s) =>
    Object.fromEntries(
      [...s.shadowRoot.querySelectorAll('.cell')].map((c) => [
        c.dataset.cellId,
        c.querySelectorAll('.item').length,
      ]),
    ),
  );
  ctx.check(
    'xem như vh2: ô Tốc độ bơm trống',
    cells.c3 === 0 && cells.c1 === 1,
    JSON.stringify(cells),
  );
  await ctx.shot('xem-voi-tu-cach');
  await press(page, '.ad-viewas-screens [data-screen="bom1"]');
  await inPreview(page, '.ad-viewas-main', 'run');
  await sleep(400);
  const lk = await page.$eval('.ad-viewas-main mat-screen', (s) => {
    const w = s.shadowRoot.querySelector('.item[data-item-id="run"] > *');
    const l = w?.shadowRoot?.querySelector('[data-lock]');
    const a = s.shadowRoot
      .querySelector('.item[data-item-id="auto"] > *')
      ?.shadowRoot?.querySelector('[data-lock]');
    return [l?.getAttribute('data-lock'), a?.getAttribute('data-lock')];
  });
  ctx.check(
    'xem như vh2: Chạy bơm "Cần quyền thao tác", widget khác khóa "xem trước"',
    lk[0] === 'NO_PERMISSION' && lk[1] === 'PREVIEW',
    JSON.stringify(lk),
  );
  const writesBefore = rt.log.writes.length;
  await page.evaluate(() => {
    const s = document.querySelector('.ad-viewas-main mat-screen');
    s.shadowRoot
      .querySelector('.item[data-item-id="start"] > *')
      ?.shadowRoot?.querySelector('[data-main]')
      ?.click();
  });
  await sleep(300);
  ctx.check('xem với tư cách: không gửi lệnh ghi nào', rt.log.writes.length === writesBefore);
  ctx.check(
    'máy chủ ghi admin.view-as',
    rt.access.audit.some((r) => r.action === 'admin.view-as' && r.target === 'vh2'),
  );
  await ctx.shot('xem-voi-tu-cach-bom');
  await axeBoth(ctx, 'tab Xem với tư cách');

  // ---- Nhật ký ----
  await tab(page, 'nhat-ky');
  await page.waitForSelector('[data-audit]');
  const n0 = (await page.$$('[data-audit]')).length;
  ctx.check('nhật ký có dòng (50 dòng đầu)', n0 === 50, n0);
  ctx.check('có nút Tải thêm', await page.$eval('[data-more]', (b) => !b.hidden));
  await press(page, '[data-more]');
  await until(async () => (await page.$$('[data-audit]')).length > n0, 'tải thêm');
  ctx.check('Tải thêm (beforeId) nối thêm dòng', true);
  const selects = await page.$$('.ad-filters select');
  await selects[1].select('account.');
  await press(page, '[data-filter]');
  await sleep(400);
  const actions = await page.$$eval('[data-audit]', (r) => r.map((x) => x.dataset.action));
  ctx.check(
    'lọc loại Tài khoản: chỉ account.*',
    actions.length > 0 && actions.every((a) => a.startsWith('account.')),
    actions.join(','),
  );
  const detail = await text(page, '.ad-audit tbody');
  ctx.check('nhật ký không có mật khẩu', !detail.includes(PASS.quantri) && !detail.includes(otp));
  await ctx.shot('nhat-ky');
  await axeBoth(ctx, 'tab Nhật ký');

  // ---- Kho hỏng → Khôi phục bản trước; viewerLogin off ----
  rt.access.breakStore();
  rt.access.cfg.viewerLogin = 'off';
  await press(page, '.ad-head .ad-btn');
  await page.waitForSelector('[data-banner="store"]');
  ctx.check(
    'kho hỏng: dải "Kho quyền bị hỏng" + nút Khôi phục bản trước',
    (await text(page, '[data-banner="store"]')).includes('Khôi phục bản trước'),
  );
  ctx.check(
    'viewerLogin off: cảnh báo "Xem không cần đăng nhập"',
    (await text(page, '[data-banner="viewer-off"]')).includes('Xem không cần đăng nhập'),
  );
  await ctx.shot('kho-hong');
  await axeBoth(ctx, 'dải cảnh báo kho hỏng');
  await press(page, '[data-banner="store"] button');
  await reauth(page, PASS.quantri);
  await until(async () => (await page.$('[data-banner="store"]')) === null, 'khôi phục');
  ctx.check('Khôi phục bản trước (xác nhận lại): hết dải', rt.access.store.invalid === false);
  rt.access.cfg.viewerLogin = 'required';

  // ---- Vai trò khác không vào được Quản trị ----
  const c2 = await ctx.browser.createBrowserContext();
  const p2 = await c2.newPage();
  await p2.goto(`${httpsUrl}/#/quan-tri`, { waitUntil: 'domcontentloaded' });
  await loginPage(p2, 'qd1', PASS.qd1);
  await p2.waitForSelector('.access-panel:not([hidden])');
  ctx.check(
    'qd1 mở #/quan-tri: "Không có quyền xem trang này"',
    (await p2.$eval('.access-panel', (e) => e.textContent)).includes('Không có quyền'),
  );
  const st = await p2.evaluate(async () => (await fetch('/api/v1/admin/users')).status);
  ctx.check('qd1 gọi thẳng API quản trị → 403', st === 403, st);
  await c2.close();
}
