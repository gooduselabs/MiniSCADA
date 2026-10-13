/* global document, window, location */
// e2e điều khiển trên trang vận hành (feature 007, T074; US3, SC-009, SC-015): khách bị khóa, đăng nhập sai và khóa tạm,
// viewer bị khóa, operator ghi mọi loại widget và mọi kết quả (CONFIRMED, REJECTED, FAILED, TIMEOUT), F5 giữ phiên, hết
// phiên giữa chừng, đăng xuất, HTTP chỉ xem, XSS trong confirmText, cookie HttpOnly. axe cho hộp Đăng nhập và hộp xác nhận.
// Cần HTTPS (chứng chỉ tự ký do openssl sinh; Chrome chạy với --ignore-certificate-errors).
import {
  axeBoth,
  bodyText,
  deepClick,
  deepCount,
  deepEval,
  deepText,
  sleep,
  until,
  waitDeep,
} from './util.mjs';

export const options = { project: 'dashboard', writeDelayMs: 150 };

const W = (id) => `.item[data-item-id="${id}"] > *`;
const inW = (page, id, code, arg) => deepEval(page, W(id), `const w = els[0]; ${code}`, arg);
const wText = (page, id) => inW(page, id, 'return fullText(w).replace(/\\s+/g, " ").trim();');
const lockCode = (page, id) =>
  inW(
    page,
    id,
    'const l = w.shadowRoot.querySelector("[data-lock]"); return l ? l.getAttribute("data-lock") : null;',
  );
const clickMain = (page, id) => inW(page, id, 'w.shadowRoot.querySelector("[data-main]").click();');
const dialogText = (page) => deepText(page, '[role="alertdialog"]');

async function open(ctx, base, path = '/#/bom1') {
  await ctx.page.goto('about:blank');
  await ctx.page.goto(base + path, { waitUntil: 'domcontentloaded' });
  await waitDeep(ctx.page, 'mat-w-setpoint', 1);
  await until(
    async () => (await ctx.page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );
}

async function login(ctx, user, pass) {
  const { page } = ctx;
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = '')); // hộp giữ tên của lần trước
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', pass);
  await page.keyboard.press('Enter');
}

/** Ghi qua ô setpoint: nhập `text`, bấm Ghi. */
const typeSetpoint = (page, id, text) =>
  inW(
    page,
    id,
    'const i = w.shadowRoot.querySelector("[data-main]"); i.value = arg; i.dispatchEvent(new Event("input", { bubbles: true })); w.shadowRoot.querySelector("[data-write]").click();',
    text,
  );

async function confirmDialog(ctx, label) {
  await waitDeep(ctx.page, '[role="alertdialog"]', 1);
  const t = await dialogText(ctx.page);
  ctx.check(
    `${label}: hộp xác nhận hiện đủ Tag, giá trị và tài khoản`,
    t.includes('Xác nhận ghi giá trị') && t.includes('vanhanh1'),
    t,
  );
  return t;
}
const ok = (ctx) => deepClick(ctx.page, '[data-ok]');
const resultOf = async (ctx, id, re, label) => {
  try {
    await until(async () => re.test(await wText(ctx.page, id)), `${label}: kết quả`, 8000);
  } catch (e) {
    throw new Error(
      `${e.message}; widget "${id}" đang hiện: ${await wText(ctx.page, id)}; ghi: ${JSON.stringify(ctx.rt.log.writes.at(-1))}`,
      { cause: e },
    );
  }
  ctx.check(`${label}: ${re}`, true);
};

export default async function run(ctx) {
  const { page, rt } = ctx;
  if (!ctx.httpsUrl) {
    ctx.check(
      'máy có openssl để sinh chứng chỉ thử (bỏ qua toàn bộ kịch bản HTTPS)',
      false,
      'không tìm thấy openssl',
    );
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 403', 'status of 429');
  const https = ctx.httpsUrl;

  // ---- Khách ----
  await open(ctx, https);
  ctx.check('HTTPS: không có dải chỉ xem', await page.$eval('#app-viewonly', (e) => e.hidden));
  ctx.check(
    'khách: nút Đăng nhập hiện, chưa có tên người dùng',
    !(await page.$eval('#app-login-btn', (b) => b.hidden)) &&
      (await page.$eval('#app-user', (b) => b.hidden)),
  );
  ctx.check(
    'khách: setpoint khóa "NO_SESSION"',
    (await lockCode(page, 'sp')) === 'NO_SESSION',
    String(await lockCode(page, 'sp')),
  );
  ctx.check(
    'khách: chữ khóa "Đăng nhập để điều khiển"',
    (await wText(page, 'sp')).includes('Đăng nhập để điều khiển'),
  );
  ctx.check(
    'khách: không gọi web/session khi chưa có cookie? (có gọi, trả 401, chỉ xem)',
    rt.log.requests.some((r) => r.startsWith('GET /api/v1/web/session')),
  );

  // ---- Hộp Đăng nhập: trợ năng, sai mật khẩu, khóa tạm ----
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  ctx.check(
    'hộp Đăng nhập: autocomplete username và current-password',
    (await page.$('dialog[open] input[autocomplete="current-password"][type="password"]')) !== null,
  );
  ctx.check(
    'hộp Đăng nhập: focus ở ô tài khoản',
    await page.evaluate(() => document.activeElement?.autocomplete === 'username'),
  );
  await axeBoth(ctx, 'hộp Đăng nhập');
  await page.type('dialog[open] input[autocomplete="username"]', 'vanhanh1');
  await page.type('dialog[open] input[autocomplete="current-password"]', 'sai');
  await page.keyboard.press('Enter');
  await until(
    async () =>
      await page.$eval(
        'dialog[open] .login-error',
        (e) => !e.hidden && e.textContent.includes('Sai tài khoản'),
      ),
    'lỗi đăng nhập sai',
  );
  ctx.check('đăng nhập sai: một câu chung "Sai tài khoản hoặc mật khẩu"', true);
  ctx.check(
    'mật khẩu bị xóa khỏi DOM sau khi gửi',
    (await page.$eval('dialog[open] input[type="password"]', (i) => i.value)) === '',
  );
  await page.keyboard.press('Escape');
  await sleep(100);
  ctx.check('Esc đóng hộp Đăng nhập', (await page.$('dialog[open]')) === null);
  // 5 lần sai cùng tên (kysu1) → khóa tạm
  for (let i = 0; i < 5; i++) {
    await page.click('#app-login-btn');
    await page.waitForSelector('dialog[open] input[autocomplete="username"]');
    await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = ''));
    await page.type('dialog[open] input[autocomplete="username"]', 'kysu1');
    await page.type('dialog[open] input[autocomplete="current-password"]', 'sai');
    await page.keyboard.press('Enter');
    await until(
      async () => await page.$eval('dialog[open] .login-error', (e) => !e.hidden),
      `lỗi lần ${i + 1}`,
    );
    await page.keyboard.press('Escape');
    await sleep(60);
  }
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open]');
  await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = ''));
  await page.type('dialog[open] input[autocomplete="username"]', 'kysu1');
  await page.type('dialog[open] input[autocomplete="current-password"]', 'eng-pass'); // đúng nhưng đang khóa
  await page.keyboard.press('Enter');
  await until(
    async () =>
      await page.$eval('dialog[open] .login-error', (e) => e.textContent.includes('khóa tạm')),
    'khóa tạm',
  );
  ctx.check(
    '5 lần sai: khóa tạm (kể cả mật khẩu đúng), nêu số phút',
    (await page.$eval('dialog[open] .login-error', (e) => e.textContent)).includes('phút'),
  );
  await page.keyboard.press('Escape');

  // ---- Viewer: đăng nhập được, ghi bị khóa ----
  await login(ctx, 'xem1', 'view-pass');
  await until(
    async () => await page.$eval('#app-user', (e) => !e.hidden && e.textContent.includes('xem1')),
    'chip viewer',
  );
  ctx.check(
    'viewer: thanh trên hiện "xem1 (viewer)" và nút Đăng xuất',
    (await page.$eval('#app-user', (e) => e.textContent)) === 'xem1 (viewer)' &&
      !(await page.$eval('#app-logout-btn', (b) => b.hidden)),
  );
  await until(async () => (await lockCode(page, 'sp')) === 'ROLE', 'khóa ROLE');
  ctx.check(
    'viewer: setpoint khóa ROLE "Cần quyền operator"',
    (await wText(page, 'sp')).includes('Cần quyền operator'),
  );
  await page.click('#app-logout-btn');
  await until(async () => await page.$eval('#app-user', (e) => e.hidden), 'đăng xuất viewer');
  ctx.check(
    'đăng xuất: nút Đăng nhập hiện lại, widget lại khóa NO_SESSION',
    !(await page.$eval('#app-login-btn', (b) => b.hidden)) &&
      (await until(async () => (await lockCode(page, 'sp')) === 'NO_SESSION', 'khóa lại')),
  );

  // ---- Operator ----
  await login(ctx, 'vanhanh1', 'op-pass');
  await until(
    async () => (await page.$eval('#app-user', (e) => e.textContent)) === 'vanhanh1 (operator)',
    'chip operator',
  );
  ctx.check(
    'operator: hộp đóng, thanh trên hiện "vanhanh1 (operator)"',
    (await page.$('dialog[open]')) === null,
  );
  await until(async () => (await lockCode(page, 'sp')) === null, 'mở khóa');
  ctx.check(
    'operator: widget điều khiển mở khóa',
    (await lockCode(page, 'run')) === null && (await lockCode(page, 'auto')) === null,
  );

  // Cookie và kho trình duyệt
  const cookie = (await page.cookies()).find((c) => c.name === '__Host-mat_sid');
  ctx.check(
    'cookie __Host-mat_sid: HttpOnly, Secure, SameSite=Strict, Path=/, không Domain',
    cookie &&
      cookie.httpOnly &&
      cookie.secure &&
      cookie.sameSite === 'Strict' &&
      cookie.path === '/' &&
      !cookie.domain?.startsWith('.'),
    JSON.stringify(cookie),
  );
  const store = await page.evaluate(() => ({
    cookie: document.cookie,
    ls: JSON.stringify({ ...localStorage }),
    ss: JSON.stringify({ ...sessionStorage }),
    href: location.href,
  }));
  const sess = [...rt.sessions.values()][0];
  ctx.check(
    'JS không đọc được cookie; không token/CSRF trong localStorage, sessionStorage, URL',
    !store.cookie.includes('matw_') &&
      ![store.ls, store.ss, store.href].some((s) => s.includes(sess.csrf) || s.includes('matw_')),
    JSON.stringify(store),
  );

  // ---- Ghi: setpoint ----
  await typeSetpoint(page, 'sp', '80');
  const t1 = await confirmDialog(ctx, 'setpoint');
  ctx.check(
    'hộp xác nhận: có mô tả, thiết bị trường PLC trạm bơm',
    t1.includes('TANK01.SP') && t1.includes('PLC trạm bơm') && t1.includes('Đặt mức bồn'),
    t1,
  );
  ctx.check(
    'hộp xác nhận: focus ban đầu ở nút Hủy',
    await deepEval(
      page,
      '[data-cancel]',
      'let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a === els[0];',
    ),
  );
  await axeBoth(ctx, 'hộp xác nhận');
  await ok(ctx);
  await resultOf(ctx, 'sp', /Đã ghi và xác nhận/, 'setpoint CONFIRMED');
  const w1 = rt.log.writes.at(-1);
  ctx.check(
    'yêu cầu ghi: Tag, giá trị, context, người dùng',
    w1.tag === 'TANK01.SP' &&
      w1.value === 80 &&
      w1.context.screen === 'bom1' &&
      w1.context.widget === 'sp' &&
      w1.user === 'vanhanh1',
    JSON.stringify(w1),
  );
  ctx.check(
    'yêu cầu ghi: requestId UUID v4',
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(w1.requestId),
  );
  // dấu phẩy → lỗi, không gửi (kết quả CONFIRMED tự xóa sau 4 s rồi mới nhập tiếp)
  await until(
    async () => !/Đã ghi và xác nhận/.test(await wText(page, 'sp')),
    'kết quả CONFIRMED tự xóa',
    8000,
  );
  const before = rt.log.writes.length;
  await typeSetpoint(page, 'sp', '75,5');
  await until(async () => /dấu chấm/.test(await wText(page, 'sp')), 'lỗi dấu phẩy').catch(
    async (e) => {
      throw new Error(`${e.message}; sp: ${await wText(page, 'sp')}`);
    },
  );
  ctx.check(
    'dấu phẩy: "Dùng dấu chấm thập phân", không gửi lệnh',
    rt.log.writes.length === before && (await deepCount(page, '[role="alertdialog"]')) === 0,
  );
  // ngoài giới hạn
  await typeSetpoint(page, 'sp', '150');
  await until(async () => /giới hạn|0.{1,3}100/i.test(await wText(page, 'sp')), 'lỗi giới hạn');
  ctx.check('ngoài giới hạn: báo lỗi ngay, không gửi lệnh', rt.log.writes.length === before);

  // ---- Ghi: nút write, nút pulse, switch, slider, select ----
  await clickMain(page, 'run');
  await confirmDialog(ctx, 'nút write');
  await ok(ctx);
  await resultOf(ctx, 'run', /Đã ghi và xác nhận/, 'nút write CONFIRMED');
  await clickMain(page, 'start');
  const tp = await confirmDialog(ctx, 'nút pulse');
  ctx.check('nút pulse: hộp nêu "Xung 500 ms"', tp.includes('500 ms'), tp);
  await ok(ctx);
  await resultOf(ctx, 'start', /Đã ghi và xác nhận|xác nhận/, 'nút pulse CONFIRMED');
  const wp = rt.log.writes.at(-1);
  ctx.check(
    'pulse: yêu cầu có pulseMs 500 và value true',
    wp.pulseMs === 500 && wp.value === true,
    JSON.stringify(wp),
  );
  await clickMain(page, 'auto');
  await confirmDialog(ctx, 'switch');
  await ok(ctx);
  await resultOf(ctx, 'auto', /Đã ghi và xác nhận/, 'switch CONFIRMED');
  const ws = rt.log.writes.at(-1);
  ctx.check(
    'switch: ghi giá trị đối lập kèm expect (giá trị lúc nhấn)',
    ws.tag === 'PUMP1.AUTO' && ws.value === true && ws.expect === false,
    JSON.stringify(ws),
  );
  await until(
    async () =>
      (await inW(
        page,
        'auto',
        'return w.shadowRoot.querySelector("[role=switch]").getAttribute("aria-checked");',
      )) === 'true',
    'switch đọc lại',
  );
  ctx.check('switch: hiện trạng thái mới sau khi đọc lại', true);
  await inW(
    page,
    'spd',
    'const i = w.shadowRoot.querySelector("[data-main]"); i.value = "500"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true }));',
  );
  await confirmDialog(ctx, 'slider');
  const n0 = rt.log.writes.length;
  await deepClick(page, '[data-cancel]');
  await sleep(300);
  ctx.check(
    'slider: Hủy không gửi lệnh',
    rt.log.writes.length === n0 && (await deepCount(page, '[role="alertdialog"]')) === 0,
  );
  await inW(
    page,
    'spd',
    'const i = w.shadowRoot.querySelector("[data-main]"); i.value = "500"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true }));',
  );
  await confirmDialog(ctx, 'slider');
  await ok(ctx);
  await until(async () => rt.log.writes.at(-1)?.tag === 'PUMP1.SPEED_SP', 'slider ghi');
  ctx.check('slider: thả xong và xác nhận mới ghi (500)', rt.log.writes.at(-1).value === 500);
  await inW(
    page,
    'mode',
    'const s = w.shadowRoot.querySelector("select"); s.value = "1"; s.dispatchEvent(new Event("change", { bubbles: true }));',
  );
  const tm = await confirmDialog(ctx, 'select');
  ctx.check('select: mục theo bảng giá trị ("Chạy tay")', tm.includes('Chạy tay'), tm);
  await ok(ctx);
  await until(async () => rt.log.writes.at(-1)?.tag === 'PUMP1.MODE', 'select ghi');
  ctx.check('select: ghi giá trị số của mục', rt.log.writes.at(-1).value === 1);

  // ---- Kết quả lỗi ----
  await clickMain(page, 'valve');
  await confirmDialog(ctx, 'REJECTED');
  await ok(ctx);
  await resultOf(ctx, 'valve', /Kết nối tới PLC trạm bơm đang mất/, 'REJECTED có lý do');
  ctx.check(
    'REJECTED: kết quả lỗi ở lại tới khi đóng',
    /Kết nối tới PLC/.test(await wText(page, 'valve')),
  );
  await typeSetpoint(page, 'sp2', '20');
  await confirmDialog(ctx, 'FAILED');
  await ok(ctx);
  await resultOf(ctx, 'sp2', /PLC báo lỗi 02/, 'FAILED có mã thiết bị');
  await typeSetpoint(page, 'sp3', '30');
  await confirmDialog(ctx, 'TIMEOUT');
  await ok(ctx);
  await resultOf(ctx, 'sp3', /Không chắc đã ghi/, 'TIMEOUT');
  ctx.check(
    'TIMEOUT: kèm câu "kiểm tra giá trị thực trước khi thử lại"',
    /giá trị thực/.test(await wText(page, 'sp3')),
    await wText(page, 'sp3'),
  );

  // ---- XSS trong confirmText ----
  await clickMain(page, 'xssbtn');
  const tx = await confirmDialog(ctx, 'confirmText');
  ctx.check(
    'confirmText chứa thẻ: hiện dạng chữ, không dựng <img>, không thực thi',
    tx.includes('<img') &&
      (await deepCount(page, 'img')) === 0 &&
      (await page.evaluate(() => window.__xss)) === undefined,
    tx,
  );
  await deepClick(page, '[data-cancel]');

  // ---- F5 giữ phiên ----
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-setpoint', 1);
  await until(
    async () => (await page.$eval('#app-user', (e) => e.textContent)) === 'vanhanh1 (operator)',
    'phiên sau F5',
  );
  ctx.check(
    'F5: phiên được khôi phục qua web/session, không phải đăng nhập lại',
    (await lockCode(page, 'sp')) === null ||
      (await until(async () => (await lockCode(page, 'sp')) === null, 'mở khóa sau F5')),
  );
  await until(async () => rt.log.wsCookie >= 1, 'live mang cookie');

  // ---- Hết phiên giữa chừng ----
  await typeSetpoint(page, 'sp', '55');
  await waitDeep(page, '[role="alertdialog"]', 1);
  rt.expireAll(); // đóng live bằng 4401, mọi yêu cầu sau 401
  await until(
    async () => !(await page.$eval('#app-session-banner', (e) => e.hidden)),
    'banner hết phiên',
    12000,
  );
  ctx.check(
    'hết phiên: banner "Phiên đã hết hạn, đăng nhập lại"',
    (await page.$eval('#app-session-banner', (e) => e.textContent)).includes('Phiên đã hết hạn'),
  );
  ctx.check(
    'hết phiên: màn hình giữ nguyên, thanh trên về chưa đăng nhập',
    (await deepCount(page, 'mat-w-setpoint')) >= 1 &&
      (await page.$eval('#app-user', (e) => e.hidden)),
  );
  await until(
    async () =>
      (await deepCount(page, '[role="alertdialog"]')) === 0 ||
      (await deepEval(page, '[data-ok]', 'return els[0].disabled;')),
    'hộp xác nhận bị hủy/khóa',
    6000,
  );
  ctx.check('hết phiên: hộp xác nhận đang mở bị hủy hoặc khóa nút Xác nhận', true);
  ctx.check(
    'hết phiên: hộp xác nhận hiện lý do khóa, nút Xác nhận tắt',
    (await dialogText(page)).includes('Phiên đã hết hạn'),
    await dialogText(page),
  );
  await deepClick(page, '[data-cancel]');
  await until(
    async () => (await lockCode(page, 'sp')) === 'SESSION_EXPIRED',
    'khóa SESSION_EXPIRED',
  ).catch(async (e) => {
    throw new Error(
      `${e.message}; khóa=${await lockCode(page, 'sp')}; sp: ${await wText(page, 'sp')}`,
    );
  });
  ctx.check(
    'hết phiên: widget khóa "Phiên đã hết hạn, đăng nhập lại"',
    (await wText(page, 'sp')).includes('Phiên đã hết hạn'),
  );
  await until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'live nối lại không cookie',
    12000,
  );
  ctx.check('hết phiên: live nối lại (vẫn xem được dữ liệu)', true);
  await page.click('#app-session-login');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = ''));
  await page.type('dialog[open] input[autocomplete="username"]', 'vanhanh1');
  await page.type('dialog[open] input[autocomplete="current-password"]', 'op-pass');
  await page.keyboard.press('Enter');
  await until(
    async () =>
      (await page.$eval('#app-session-banner', (e) => e.hidden)) &&
      (await lockCode(page, 'sp')) === null,
    'đăng nhập lại',
    10000,
  );
  ctx.check('đăng nhập lại từ banner: banner ẩn, widget mở khóa', true);

  // ---- Đăng xuất ----
  await page.click('#app-logout-btn');
  await until(async () => await page.$eval('#app-user', (e) => e.hidden), 'đăng xuất');
  ctx.check(
    'đăng xuất: cookie bị xóa, phiên bị hủy ở thiết bị',
    !(await page.cookies()).some((c) => c.name === '__Host-mat_sid') && rt.sessions.size === 0,
  );
  await until(async () => (await lockCode(page, 'sp')) === 'NO_SESSION', 'khóa sau đăng xuất');
  ctx.check('đăng xuất: widget khóa lại', true);

  // ---- HTTP: chỉ xem ----
  const httpReqBefore = rt.log.requests.length;
  await open(ctx, ctx.url);
  const band = await page.$eval('#app-viewonly', (e) => ({
    hidden: e.hidden,
    text: e.textContent,
    href: e.querySelector('a')?.href ?? null,
  }));
  ctx.check(
    'HTTP: dải "Chế độ chỉ xem. Mở bằng HTTPS để điều khiển" kèm liên kết HTTPS',
    !band.hidden &&
      band.text.includes('Chế độ chỉ xem') &&
      band.href?.startsWith('https://127.0.0.1:'),
    JSON.stringify(band),
  );
  await until(async () => (await lockCode(page, 'sp')) === 'INSECURE', 'khóa INSECURE');
  ctx.check(
    'HTTP: widget khóa "Mở bằng HTTPS để điều khiển"',
    (await wText(page, 'sp')).includes('Mở bằng HTTPS để điều khiển'),
  );
  ctx.check(
    'HTTP: không gọi web/session, không có nút Đăng nhập',
    !rt.log.requests.slice(httpReqBefore).some((r) => r.includes('/api/v1/web/session')) &&
      (await page.$eval('#app-login-btn', (b) => b.hidden)),
  );
  ctx.check('(HTTP) phần trang vẫn xem được dữ liệu sống', (await bodyText(page)).length > 0);
}
