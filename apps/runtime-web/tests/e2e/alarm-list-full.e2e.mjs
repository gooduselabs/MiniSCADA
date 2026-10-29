/* global location */
// e2e feature 041: Bảng alarm kiểu Đầy đủ trong lưới (tab Tạm ẩn, lọc, tìm, Xác nhận tất cả, cao ≥ 360 px), kiểu Gọn,
// kiểu Lịch sử; chuông "Xem tất cả alarm" mở màn hình có Bảng alarm Đầy đủ và tô mục menu đó.
import {
  ALARMS,
  alarmListProject,
  bellViewAll,
  currentMenu,
  historyRows,
  open,
} from './alarm-list-fixture.mjs';
import { deepEval, sleep, until, waitDeep } from './util.mjs';

export const options = {
  fixture: () => alarmListProject(),
  config: { alarms: true },
  drift: false,
};

/** Chạy `code` trên shadow root của widget alarm-list thứ `i` (biến `r`). */
const W = (page, code, i = 0) =>
  deepEval(
    page,
    'mat-w-alarm-list',
    `const r = els[${i}]?.shadowRoot; if (!r) return null; ${code}`,
  );
const ROWS = `const t = r.querySelector('mat-alarm-table'); return t ? [...t.shadowRoot.querySelectorAll('tbody tr[data-id]')].map((x) => x.dataset.id).sort() : null;`;

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
  rt.alarm.reset(ALARMS());
  rt.alarm.setHistory(historyRows(Date.now()));

  // ---- Kiểu Đầy đủ ----
  await open(ctx, '#/bang-full');
  await waitDeep(page, 'mat-w-alarm-list', 1);
  await login(ctx, 'vanhanh1', 'op-pass');
  await until(
    async () => JSON.stringify(await W(page, ROWS)) === '["PUMP.F","TANK.HH","VOLT.L"]',
    'bảng đủ 3 hàng',
  );
  ctx.check('Đầy đủ: tab Đang có hiện 3 alarm (không tính tạm ẩn)', true);
  const tabs = await W(
    page,
    "return [...r.querySelectorAll('.al-tabs button')].map((b) => b.textContent);",
  );
  ctx.check(
    'Đầy đủ: tab Đang có (3) / Tạm ẩn (1)',
    JSON.stringify(tabs) === '["Đang có (3)","Tạm ẩn (1)"]',
    JSON.stringify(tabs),
  );
  const btns = await W(
    page,
    "return [...r.querySelectorAll('.al-actions .al-btn, .al-filters .al-btn')].map((b) => b.dataset.act).join(',');",
  );
  ctx.check(
    'Đầy đủ: có Xóa lọc, Xác nhận, Xác nhận tất cả, Tạm ẩn…',
    btns === 'clear,ack,ackall,shelve',
    String(btns),
  );
  const h = await deepEval(
    page,
    'mat-w-alarm-list',
    'return els[0].getBoundingClientRect().height;',
  );
  ctx.check(`Đầy đủ: trong hàng auto cao ≥ 360 px (đo ${h})`, h >= 359, String(h));

  // lọc theo khu vực
  await W(
    page,
    "const s = r.querySelector('select[data-f=area]'); s.value = 'dien'; s.dispatchEvent(new Event('change')); return true;",
  );
  await until(async () => JSON.stringify(await W(page, ROWS)) === '["VOLT.L"]', 'lọc khu vực Điện');
  ctx.check('Đầy đủ: lọc khu vực', true);
  // tìm chữ bỏ dấu
  await W(
    page,
    "r.querySelector('[data-act=clear]').click(); const q = r.querySelector('input[type=search]'); q.value = 'bom loi'; q.dispatchEvent(new Event('input')); return true;",
  );
  await until(async () => JSON.stringify(await W(page, ROWS)) === '["PUMP.F"]', 'tìm bỏ dấu');
  ctx.check('Đầy đủ: tìm chữ bỏ dấu', true);
  await W(page, "r.querySelector('[data-act=clear]').click(); return true;");
  // tab Tạm ẩn
  await W(page, "r.querySelector('.al-tabs button[data-tab=shelved]').click(); return true;");
  await until(async () => JSON.stringify(await W(page, ROWS)) === '["FAN.S"]', 'tab Tạm ẩn');
  ctx.check('Đầy đủ: tab Tạm ẩn liệt kê alarm tạm ẩn', true);
  await W(page, "r.querySelector('.al-tabs button[data-tab=active]').click(); return true;");
  await sleep(200);
  // Xác nhận tất cả: hộp thoại trong widget
  await W(page, "r.querySelector('[data-act=ackall]').click(); return true;");
  await until(
    async () => (await W(page, "return !!r.querySelector('[role=dialog]');")) === true,
    'hộp Xác nhận tất cả',
  );
  const body = await W(page, "return r.querySelector('[role=dialog]').textContent;");
  ctx.check(
    'Đầy đủ: hộp Xác nhận tất cả nêu số lượng (2)',
    /Xác nhận 2 alarm/.test(body ?? ''),
    String(body),
  );
  await W(page, "r.querySelector('[role=dialog] [data-act=confirm]').click(); return true;");
  await until(async () => rt.alarm.acks.length >= 1, 'POST ack all');
  ctx.check(
    'Đầy đủ: Xác nhận tất cả gửi all + upToRevision',
    rt.alarm.acks[0]?.all === true,
    JSON.stringify(rt.alarm.acks[0]),
  );

  // ---- Kiểu Gọn ----
  await page.evaluate(() => (location.hash = '#/tq-gon'));
  await until(
    async () => (await W(page, "return !!r.querySelector('.bar');")) === true,
    'bảng gọn',
  );
  const compact = await W(
    page,
    "return { tabs: !!r.querySelector('.al-tabs'), ackAll: !!r.querySelector('[data-act=ack-all]') };",
  );
  ctx.check(
    'Gọn: không có tab/bộ lọc của trang, có Xác nhận tất cả',
    compact && !compact.tabs && compact.ackAll,
    JSON.stringify(compact),
  );

  // ---- Kiểu Lịch sử ----
  await page.evaluate(() => (location.hash = '#/lich-su'));
  await until(
    async () =>
      ((await W(page, "return r.querySelectorAll('.al-hist tbody tr').length;")) ?? 0) === 30,
    'lịch sử 30 dòng',
  );
  const hist = await W(
    page,
    "return { range: !!r.querySelector('[data-range=\"24h\"]'), csv: !!r.querySelector('[data-act=csv]') };",
  );
  ctx.check(
    'Lịch sử: có khoảng thời gian, Xuất CSV, 30 dòng',
    hist && hist.range && hist.csv,
    JSON.stringify(hist),
  );
  await W(
    page,
    "const s = r.querySelector('select[data-f=area]'); s.value = 'dien'; s.dispatchEvent(new Event('change')); return true;",
  );
  await until(
    async () => (await W(page, "return r.querySelectorAll('.al-hist tbody tr').length;")) === 10,
    'lọc lịch sử',
  );
  ctx.check(
    'Lịch sử: lọc khu vực gửi API (10 dòng Điện)',
    rt.alarm.historyCalls.some((q) => q.includes('area=dien')),
  );

  // ---- Chuông: màn hình có Bảng alarm Đầy đủ ----
  await page.evaluate(() => (location.hash = '#/tong-quan'));
  await sleep(300);
  const hash = await bellViewAll(ctx, until);
  ctx.check('Chuông: Xem tất cả mở màn hình có Bảng alarm Đầy đủ', hash === '#/bang-full', hash);
  await sleep(200);
  const cur = await currentMenu(page);
  ctx.check('Chuông: mục menu "Bảng alarm" được tô', cur === 'Bảng alarm', String(cur));
}
