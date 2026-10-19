/* global document, location */
// e2e đăng nhập bắt buộc (feature 013, T011; US1, FR-001 đến FR-005, SC-002): chưa phiên → trang đăng nhập, đăng nhập về
// đúng trang đã định mở; 22 dạng `next` độc hại không chuyển ra ngoài; hết phiên (live 4401, 401 của một yêu cầu, đăng
// xuất) quay lại đăng nhập rồi về đúng chỗ cũ; HTTP chỉ thông báo và liên kết HTTPS; khóa tạm có giờ; Đổi mật khẩu
// của tôi. axe trang đăng nhập và hộp đổi mật khẩu ở theme sáng và tối. Ảnh: tests/e2e/out/login-required-*.png.
import { PASS, accessDemo, accessSeed, loginPage } from './access-fixture.mjs';
import { axeBoth, bodyText, setTheme, sleep, until, waitDeep } from './util.mjs';

export const options = {
  fixture: accessDemo,
  access: accessSeed(),
  config: { viewerLogin: 'required' },
  drift: false,
};

const EVIL = [
  '//evil.example',
  'https://evil.example',
  'http://evil.example/#/bom1',
  'javascript:alert(1)',
  'JaVaScRiPt:alert(document.domain)',
  'data:text/html,<script>alert(1)</script>',
  '#/../bom1',
  '#/./bom1',
  '#/a//bom1',
  '%23%2Fbom1',
  '%2523%252Fbom1',
  '\\\\evil.example',
  '/\\evil.example',
  ' #/bom1',
  '#/bom1 ',
  '#/bom1\n',
  '#/bom1\r\nSet-Cookie: x=1',
  '#/' + 'a'.repeat(201),
  '#//evil.example',
  '#/bom1?x=1',
  'https:%2F%2Fevil.example',
  '#@evil.example',
];

// Trang có thể đang chuyển (ngữ cảnh bị hủy): coi như chưa biết.
const hash = (page) => page.evaluate(() => location.hash).catch(() => '?');
const path = (page) => page.evaluate(() => location.pathname).catch(() => '?');

async function waitScreen(page, id, n = 1) {
  await until(async () => (await hash(page)) === `#/${id}`, `hash #/${id}`, 10000);
  await waitDeep(page, '.item[data-item-id]', n, 10000);
}

export default async function run(ctx) {
  const { page, rt, httpsUrl } = ctx;
  if (!httpsUrl) {
    ctx.check('máy có openssl (bỏ qua kịch bản HTTPS)', false, 'không tìm thấy openssl');
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 403', 'status of 429', 'status of 404');
  const origin = new URL(httpsUrl).origin;
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });

  // ---- 1. Liên kết trực tiếp khi chưa phiên → /login → đăng nhập → đúng màn hình ----
  await page.goto(`${httpsUrl}/#/bom1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.login-card form');
  ctx.check(
    'chưa phiên: mở /#/bom1 tới trang /login',
    (await path(page)) === '/login',
    await path(page),
  );
  ctx.check(
    'trang đăng nhập báo sẽ mở bom1 sau khi đăng nhập',
    (await bodyText(page)).includes('Sau khi đăng nhập sẽ mở /bom1'),
    await bodyText(page),
  );
  ctx.check(
    'không có dữ liệu Tag nào trước khi đăng nhập (không mở live)',
    rt.log.wsOpened === 0,
    rt.log.wsOpened,
  );
  await until(
    async () => (await bodyText(page)).includes('Trạm bơm e2e'),
    'tên project từ system/info',
    3000,
  ).catch(() => undefined);
  await page.setViewport({ width: 1366, height: 768 });
  await setTheme(page, 'light');
  await ctx.shot('trang-dang-nhap-sang');
  await axeBoth(ctx, 'trang đăng nhập');
  await setTheme(page, 'dark');
  await sleep(150);
  await ctx.shot('trang-dang-nhap-toi');
  await setTheme(page, 'light');
  await page.setViewport({ width: 400, height: 800 });
  await sleep(100);
  await ctx.shot('trang-dang-nhap-hep');
  await page.setViewport({ width: 1366, height: 768 });

  // Sai mật khẩu 5 lần → khóa tạm, câu có số phút và giờ mở lại.
  for (let i = 0; i < 5; i++) {
    await page.$eval('input[autocomplete="username"]', (e) => (e.value = ''));
    await page.type('input[autocomplete="username"]', 'xem1');
    await page.type('input[autocomplete="current-password"]', 'sai-mat-khau-' + i);
    await page.keyboard.press('Enter');
    await until(
      async () => !(await page.$eval('.login-actions button.primary', (b) => b.disabled)),
      'gửi xong',
    );
  }
  const lockText = await page.$eval('.login-error', (e) => e.textContent);
  ctx.check(
    'khóa tạm: câu rõ, có số phút và giờ mở lại',
    /khóa tạm/.test(lockText) && /5 phút/.test(lockText) && /lúc \d{2}:\d{2}/.test(lockText),
    lockText,
  );
  await ctx.shot('khoa-tam');

  await loginPage(page, 'vh1', PASS.vh1);
  await waitScreen(page, 'bom1');
  ctx.check('đăng nhập đúng: về /#/bom1 trong một bước', (await hash(page)) === '#/bom1');
  ctx.check(
    'thanh trên hiện tên người dùng',
    (await page.$eval('#app-user', (e) => e.textContent)).includes('vh1'),
  );

  // ---- 2. Hết phiên trên live (4401) → /login?next=#/bom1 → đăng nhập lại về đúng chỗ ----
  rt.expireAll();
  await until(async () => (await path(page)) === '/login', 'về /login sau 4401', 10000);
  const search = await page.evaluate(() => location.search);
  ctx.check('4401: /login?next=%23%2Fbom1', search === '?next=%23%2Fbom1', search);
  await loginPage(page, 'vh1', PASS.vh1);
  await waitScreen(page, 'bom1');
  ctx.check('đăng nhập lại về đúng trang cũ (#/bom1)', (await hash(page)) === '#/bom1');

  // ---- 3. 401 của một yêu cầu (không qua live): đổi màn hình khi phiên đã bị hủy phía máy chủ ----
  rt.sessions.clear();
  await page.evaluate(() => (location.hash = '#/tong-quan'));
  await until(async () => (await path(page)) === '/login', 'về /login sau 401 của /project', 10000);
  const s2 = await page.evaluate(() => location.search);
  ctx.check('401 khi tải màn hình: next là trang đang mở', s2 === '?next=%23%2Ftong-quan', s2);
  await loginPage(page, 'vh1', PASS.vh1);
  await waitScreen(page, 'tong-quan');

  // ---- 4. 22 dạng next độc hại: không rời thiết bị, không chạy mã, về trang đầu ----
  // Đã có phiên: trang /login tự chuyển ngay theo next (cùng hàm kiểm với lúc gửi biểu mẫu).
  let evilBad = [];
  for (const e of EVIL) {
    await page.goto(`${httpsUrl}/login?next=${encodeURIComponent(e)}`, {
      waitUntil: 'domcontentloaded',
    });
    await until(async () => (await path(page)) === '/', `rời /login (${JSON.stringify(e)})`, 8000);
    await until(async () => (await hash(page)) !== '', 'router đặt hash', 4000).catch(
      () => undefined,
    );
    await sleep(150);
    const u = await page.evaluate(() => ({
      origin: location.origin,
      path: location.pathname,
      hash: location.hash,
    }));
    if (u.origin !== origin || u.path !== '/' || u.hash !== '#/luoi')
      evilBad.push(`${JSON.stringify(e)} → ${JSON.stringify(u)}`);
  }
  ctx.check(
    `${EVIL.length} dạng next độc hại: về trang đầu của thiết bị`,
    evilBad.length === 0,
    evilBad.join('; '),
  );
  // Cùng các dạng đó qua biểu mẫu (phiên mới): lấy 4 dạng đại diện.
  const ctx2 = await ctx.browser.createBrowserContext();
  const p2 = await ctx2.newPage();
  p2.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });
  evilBad = [];
  for (const e of ['//evil.example', 'javascript:alert(1)', '#/../bom1', '%2523%252Fbom1']) {
    await p2.goto(`${httpsUrl}/login?next=${encodeURIComponent(e)}`, {
      waitUntil: 'domcontentloaded',
    });
    await loginPage(p2, 'vh2', PASS.vh2);
    await until(async () => (await p2.evaluate(() => location.hash)) !== '', 'hash', 6000).catch(
      () => undefined,
    );
    const u = await p2.evaluate(() => ({
      origin: location.origin,
      path: location.pathname,
      hash: location.hash,
    }));
    if (u.origin !== origin || u.path !== '/' || u.hash !== '#/luoi')
      evilBad.push(`${e} → ${JSON.stringify(u)}`);
    await p2.deleteCookie(...(await p2.cookies()));
  }
  ctx.check(
    'next độc hại qua biểu mẫu đăng nhập: về trang đầu',
    evilBad.length === 0,
    evilBad.join('; '),
  );
  ctx.check('không có hộp alert/confirm nào (javascript: không chạy)', dialogs === 0, dialogs);
  await ctx2.close();

  // ---- 5. Đăng xuất khi bắt buộc đăng nhập → trang đăng nhập (next là trang đang xem) ----
  await page.goto(`${httpsUrl}/#/bom1`, { waitUntil: 'domcontentloaded' });
  await waitScreen(page, 'bom1');
  await page.click('#app-logout-btn');
  await until(async () => (await path(page)) === '/login', 'đăng xuất → /login', 8000);
  ctx.check(
    'đăng xuất: /login?next=%23%2Fbom1',
    (await page.evaluate(() => location.search)) === '?next=%23%2Fbom1',
  );

  // ---- 6. Đổi mật khẩu của tôi ----
  await loginPage(page, 'vh2', PASS.vh2);
  await waitScreen(page, 'bom1');
  await page.click('#app-account-btn');
  await page.waitForSelector('#app-account-menu [role="menuitem"]');
  ctx.check(
    'menu tài khoản: focus ở mục đầu "Đổi mật khẩu của tôi"',
    await page.evaluate(() =>
      document.activeElement?.textContent?.includes('Đổi mật khẩu của tôi'),
    ),
  );
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog.pw-dialog[open]');
  const NEW = 'mot-cau-mat-khau-moi-rat-dai';
  await page.type('#pw-old', 'sai-mat-khau-hien-tai');
  await page.type('#pw-new', 'ngan');
  ctx.check(
    'chỉ báo độ dài: còn thiếu 11 ký tự',
    (await page.$eval('.pw-meter-text', (e) => e.textContent)).includes('Còn thiếu 11 ký tự'),
  );
  await page.$eval('#pw-new', (e) => (e.value = ''));
  await page.type('#pw-new', NEW);
  await page.type('#pw-repeat', NEW);
  await setTheme(page, 'light');
  await ctx.shot('doi-mat-khau');
  await axeBoth(ctx, 'hộp đổi mật khẩu');
  await page.keyboard.press('Enter');
  await until(
    async () =>
      (await page.$eval('dialog.pw-dialog .login-error', (e) =>
        e.hidden ? '' : e.textContent,
      )) !== '',
    'lỗi mật khẩu cũ',
  );
  ctx.check(
    'sai mật khẩu hiện tại: "Mật khẩu hiện tại không đúng"',
    (await page.$eval('dialog.pw-dialog .login-error', (e) => e.textContent)) ===
      'Mật khẩu hiện tại không đúng',
  );
  await page.type('#pw-old', PASS.vh2);
  await page.type('#pw-new', NEW);
  await page.type('#pw-repeat', NEW);
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog.pw-dialog .pw-done:not([hidden])');
  ctx.check('đổi xong: thông báo các phiên khác bị đăng xuất', true);
  ctx.check('máy chủ nhận mật khẩu mới', rt.access.users.get('vh2').password === NEW);
  await page.keyboard.press('Escape');
  ctx.check(
    'Esc đóng hộp, focus về nút tài khoản',
    await page.evaluate(() => document.activeElement?.id === 'app-account-btn'),
  );

  // ---- 7. HTTP khi bắt buộc đăng nhập: chỉ thông báo và liên kết HTTPS, không có dữ liệu ----
  const before = rt.log.wsOpened;
  await page.goto(`${ctx.url}/#/bom1`, { waitUntil: 'domcontentloaded' });
  ctx.check('HTTP /: chỉ thông báo cần HTTPS', (await bodyText(page)).includes('HTTPS'));
  await page.goto(`${ctx.url}/index.html#/bom1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app-errors:not([hidden])');
  await until(
    async () => (await page.$('#app-errors a.primary-link')) !== null,
    'liên kết HTTPS',
    5000,
  );
  const href = await page.$eval('#app-errors a.primary-link', (a) => a.href);
  ctx.check(
    'HTTP trang chính: liên kết tới /login (HTTPS) kèm next',
    href === `${httpsUrl}/login?next=%23%2Fbom1`,
    href,
  );
  ctx.check(
    'HTTP: không mở live, không có màn hình',
    rt.log.wsOpened === before && (await page.$$('mat-screen')).length <= 1,
  );
  await ctx.shot('http-can-https');
  await axeBoth(ctx, 'trang chính qua HTTP khi bắt buộc đăng nhập');
}
