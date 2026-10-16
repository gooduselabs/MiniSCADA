/* global document, location */
// e2e sự kiện nhấp của phần tử SVG trên trang vận hành (feature 008, T082; US3, SC-013, SC-015; contract svg-events.md):
// khách và viewer bị khóa kèm lý do (data-mat-lock, vùng role="status", <title>), operator: nhấp mở popup, chuyển màn hình,
// ghi có xác nhận (Hủy không gửi, Đồng ý gửi kèm context.widget = elementUid) và kết quả, đảo không xác nhận; phần tử
// fill="none" nhận nhấp thật bằng chuột; phần tử ẩn không nhấp; Tab và Enter; axe hai theme. Cần HTTPS (đăng nhập).
import { axeBoth, deepCount, deepEval, deepText, sleep, until, waitDeep } from './util.mjs';
import { svgEventsDemo } from './svg-events-fixture.mjs';

export const options = { fixture: svgEventsDemo, writeDelayMs: 120 };

const U = (uid) => `[data-mat-uid="${uid}"]`;

/** Thuộc tính lúc chạy và hộp màn hình của phần tử SVG theo `data-mat-uid`. */
const info = (page, uid) =>
  deepEval(
    page,
    U(uid),
    `const e = els[0]; if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
     const t = [...e.children].find((c) => c.localName === 'title' && c.hasAttribute('data-mat-runtime'));
     return { role: e.getAttribute('role'), tabindex: e.getAttribute('tabindex'), label: e.getAttribute('aria-label'),
       lock: e.getAttribute('data-mat-lock'), disabled: e.getAttribute('aria-disabled'), clickable: e.hasAttribute('data-mat-clickable'),
       cursor: cs.cursor, pe: cs.pointerEvents, title: t ? t.textContent : null,
       cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height };`,
  );

/** Nhấp chuột thật vào giữa phần tử (kiểm cả pointer-events và vùng nhận nhấp). */
async function realClick(page, uid) {
  const i = await info(page, uid);
  await page.mouse.click(i.cx, i.cy);
}

const status = (page) => deepText(page, '.status-bar');
const dialogs = (page) => deepCount(page, '[role="dialog"]');
const confirmText = (page) => deepText(page, '[role="alertdialog"]');
const hash = (page) => page.evaluate(() => location.hash);

/** `data-mat-uid` của phần tử đang giữ focus (đi xuyên Shadow DOM), hoặc null. */
const activeUid = (page) =>
  page.evaluate(() => {
    let a = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return a?.getAttribute?.('data-mat-uid') ?? null;
  });

async function open(ctx, base) {
  await ctx.page.goto('about:blank');
  await ctx.page.goto(`${base}/#/ev`, { waitUntil: 'domcontentloaded' });
  await waitDeep(ctx.page, U('el_write'), 1);
  await until(
    async () => (await ctx.page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );
  await until(async () => (await info(ctx.page, 'el_write'))?.clickable === true, 'gắn sự kiện');
}

async function login(ctx, user, pass) {
  const { page } = ctx;
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = ''));
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', pass);
  await page.keyboard.press('Enter');
}

async function logout(page) {
  await page.click('#app-logout-btn');
  await until(async () => await page.$eval('#app-user', (e) => e.hidden), 'đăng xuất');
}

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

  // ---- Khách: thuộc tính lúc chạy, khóa NO_SESSION kèm lý do ----
  await open(ctx, https);
  const w0 = await info(page, 'el_write');
  ctx.check(
    'phần tử nhấp được: role=button, tabindex=0, aria-label theo nhãn, cursor pointer ở popup',
    w0.role === 'button' && w0.tabindex === '0' && w0.label === 'Đặt tốc độ bơm 750',
    JSON.stringify(w0),
  );
  ctx.check(
    'khách: phần tử ghi khóa NO_SESSION (aria-disabled, cursor not-allowed, lý do ở <title>)',
    w0.lock === 'NO_SESSION' &&
      w0.disabled === 'true' &&
      w0.cursor === 'not-allowed' &&
      /Đăng nhập/.test(w0.title ?? ''),
    JSON.stringify(w0),
  );
  const o0 = await info(page, 'el_open');
  ctx.check(
    'popup/chuyển màn hình không khóa (khách vẫn mở được cửa sổ)',
    o0.lock === null && o0.disabled === null && o0.cursor === 'pointer',
    JSON.stringify(o0),
  );
  await realClick(page, 'el_write');
  await until(async () => /Đăng nhập/.test((await status(page)) ?? ''), 'lý do khóa ở vùng status');
  ctx.check(
    'khách nhấp phần tử ghi: lý do hiện ở vùng role="status", không hộp xác nhận, không gửi gì',
    (await deepCount(page, '[role="alertdialog"]')) === 0 && rt.log.writes.length === 0,
    String(await status(page)),
  );
  await axeBoth(ctx, 'màn hình SVG có sự kiện, khách');

  // ---- Viewer: khóa ROLE ----
  await login(ctx, 'xem1', 'view-pass');
  await until(async () => (await info(page, 'el_write'))?.lock === 'ROLE', 'khóa ROLE của viewer');
  await realClick(page, 'el_write');
  await until(async () => /operator/.test((await status(page)) ?? ''), 'lý do ROLE ở status');
  ctx.check(
    'viewer: nhấp phần tử ghi hiện "Cần quyền operator", không gửi gì',
    rt.log.writes.length === 0 && (await deepCount(page, '[role="alertdialog"]')) === 0,
    String(await status(page)),
  );
  await logout(page);

  // ---- Operator: popup, nofill, ẩn, chuyển màn hình ----
  await login(ctx, 'vanhanh1', 'op-pass');
  await until(async () => (await info(page, 'el_write'))?.lock === null, 'mở khóa operator');
  ctx.check(
    'operator: phần tử ghi mở khóa, cursor pointer',
    (await info(page, 'el_write')).cursor === 'pointer',
  );

  await realClick(page, 'el_open');
  await until(async () => (await dialogs(page)) >= 1, 'popup mở');
  ctx.check('nhấp phần tử có sự kiện popup: cửa sổ pop-bom mở', true);
  await axeBoth(ctx, 'popup mở từ phần tử SVG');
  await page.keyboard.press('Escape');
  await until(async () => (await dialogs(page)) === 0, 'Esc đóng popup');

  const nf = await info(page, 'el_nofill');
  ctx.check(
    'phần tử fill="none" nhận nhấp (pointer-events: visible)',
    nf.pe === 'visible' && nf.w > 0,
    JSON.stringify(nf),
  );
  await realClick(page, 'el_nofill');
  await until(async () => (await dialogs(page)) >= 1, 'popup mở từ vùng trống');
  ctx.check('nhấp chuột thật vào giữa phần tử fill="none": popup mở', true);
  await page.keyboard.press('Escape');
  await until(async () => (await dialogs(page)) === 0, 'đóng popup');

  const hid = await info(page, 'el_hidden');
  ctx.check(
    'phần tử ẩn: pointer-events none, tabindex -1',
    hid.pe === 'none' && hid.tabindex === '-1',
    JSON.stringify(hid),
  );
  await deepEval(
    page,
    U('el_hidden'),
    'els[0].dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));',
  );
  await sleep(300);
  ctx.check('nhấp phần tử ẩn: không mở gì', (await dialogs(page)) === 0);

  ctx.check(
    'trước khi chuyển màn hình: màn hình ev còn nguyên',
    (await deepCount(page, U('el_gotobom'))) === 1,
    `${await hash(page)} ${await deepCount(page, 'mat-screen')} ${(await page.evaluate(() => document.body.innerText)).slice(0, 200)}`,
  );
  await realClick(page, 'el_gotobom');
  await until(async () => (await hash(page)) === '#/bom1', 'chuyển màn hình');
  ctx.check('nhấp phần tử navigate: chuyển sang màn hình bom1', true, await hash(page));
  await page.evaluate(() => (location.hash = '#/ev'));
  await until(
    async () => (await info(page, 'el_write'))?.clickable === true,
    'quay lại màn hình ev',
  );
  await until(
    async () => (await info(page, 'el_write'))?.lock === null,
    'mở khóa sau khi quay lại',
  );

  // ---- Ghi có xác nhận: Hủy rồi Đồng ý ----
  await realClick(page, 'el_write');
  await until(async () => (await deepCount(page, '[role="alertdialog"]')) === 1, 'hộp xác nhận');
  const t1 = await confirmText(page);
  ctx.check(
    'ghi: hộp xác nhận nêu Tag, giá trị và tài khoản',
    t1.includes('PUMP1.SPEED_SP') && t1.includes('750') && t1.includes('vanhanh1'),
    t1,
  );
  await axeBoth(ctx, 'hộp xác nhận của phần tử SVG');
  await deepEval(page, '[data-cancel]', 'els[0].click();');
  await until(async () => (await deepCount(page, '[role="alertdialog"]')) === 0, 'Hủy đóng hộp');
  ctx.check('Hủy: không gửi lệnh ghi', rt.log.writes.length === 0);

  await realClick(page, 'el_write');
  await until(
    async () => (await deepCount(page, '[role="alertdialog"]')) === 1,
    'hộp xác nhận lần 2',
  );
  await deepEval(page, '[data-ok]', 'els[0].click();');
  await until(
    async () => /Đã ghi và xác nhận/.test((await status(page)) ?? ''),
    'kết quả CONFIRMED',
  );
  const wr = rt.log.writes.at(-1);
  ctx.check(
    'Đồng ý: ghi đúng Tag và giá trị, context = màn hình và elementUid, kết quả hiện ở vùng status',
    rt.log.writes.length === 1 &&
      wr.tag === 'PUMP1.SPEED_SP' &&
      wr.value === 750 &&
      wr.context?.screen === 'ev' &&
      wr.context?.widget === 'el_write' &&
      wr.user === 'vanhanh1',
    JSON.stringify(wr),
  );

  // ---- Đảo không xác nhận ----
  await realClick(page, 'el_toggle');
  await until(async () => rt.log.writes.length === 2, 'lệnh đảo gửi ngay');
  const tg = rt.log.writes.at(-1);
  ctx.check(
    'toggle confirm none: gửi ngay, không hộp xác nhận, context.widget = el_toggle',
    tg.tag === 'PUMP1.RUN_CMD' &&
      tg.context?.widget === 'el_toggle' &&
      (await deepCount(page, '[role="alertdialog"]')) === 0,
    JSON.stringify(tg),
  );
  await until(async () => /Đã ghi và xác nhận/.test((await status(page)) ?? ''), 'kết quả đảo');
  await sleep(300);

  // ---- Bàn phím: Tab tới phần tử, Enter kích hoạt ----
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.mouse.click(5, 700); // đưa focus ra khỏi các phần tử
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = (await activeUid(page)) === 'el_write';
  }
  ctx.check('Tab: tới được phần tử el_write theo thứ tự tài liệu', reached);
  await page.keyboard.press('Enter');
  await until(
    async () => (await deepCount(page, '[role="alertdialog"]')) === 1,
    'Enter mở hộp xác nhận',
  );
  ctx.check('Enter trên phần tử có focus: hộp xác nhận mở', true);
  await deepEval(page, '[data-cancel]', 'els[0].click();');
  await until(async () => (await deepCount(page, '[role="alertdialog"]')) === 0, 'đóng hộp');
  await until(async () => (await activeUid(page)) === 'el_write', 'focus trả về phần tử');
  ctx.check('đóng hộp xác nhận: focus trả về phần tử', true);
  await page.keyboard.press('Space');
  await until(async () => (await deepCount(page, '[role="alertdialog"]')) === 1, 'Space mở hộp');
  ctx.check('Space cũng kích hoạt', true);
  await deepEval(page, '[data-cancel]', 'els[0].click();');
  await until(async () => (await deepCount(page, '[role="alertdialog"]')) === 0, 'đóng hộp lần 2');
  ctx.check('không gửi thêm lệnh nào khi Hủy bằng bàn phím', rt.log.writes.length === 2);

  await axeBoth(ctx, 'màn hình SVG có sự kiện, operator');
}
