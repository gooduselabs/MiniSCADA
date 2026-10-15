/* global window, document */
// e2e màn hình "Điện năng" (feature 010, T113; SC-015) trên runtime GIẢ: history-bar và history-pie của
// projects/history-demo. Kiểm: chưa đăng nhập hiện "Đăng nhập để xem lịch sử"; sau đăng nhập số trên bar (delta mỗi
// ca của các ngày đã qua) khớp tham chiếu độc lập tools/history-ref VÀ ô báo cáo "Điện năng theo ca" cùng kỳ (trang
// #/report/dien-ca); số trên pie khớp tham chiếu cho kỳ "hôm nay"; BUSY (429) tự thử lại; axe sáng/tối.
import { demoReports } from './history-projects.mjs';
import { localParts, refReport, refWindow, tzMs, viNumber, DAY_MS, MIN_MS } from './report-ref.mjs';
import { periodRangeRef } from '../../../../tools/history-ref/widget-ref.mjs';
import { axeBoth, deepEval, until, waitDeep } from './util.mjs';

export const options = { project: 'reports', history: {} };

const W = (id) => `.item[data-item-id="${id}"] > *`;
const inW = (page, id, code) => deepEval(page, W(id), `const w = els[0]; ${code}`);
const statusText = (page, id) =>
  inW(
    page,
    id,
    'const s = w.shadowRoot.querySelector("[role=status]"); return s ? s.textContent.replace(/\\s+/g, " ").trim() : null;',
  );
const srRows = (page, id) =>
  inW(
    page,
    id,
    'return [...w.shadowRoot.querySelectorAll("table.sr-only tbody tr")].map((tr) => [...tr.cells].map((c) => c.textContent.replace(/\\s+/g, " ").trim()));',
  );
const p2 = (n) => String(n).padStart(2, '0');

async function login(ctx, user = 'xem1', pass = 'view-pass') {
  const { page } = ctx;
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', pass);
  await page.keyboard.press('Enter');
  await until(async () => !(await page.$eval('#app-user', (b) => b.hidden)), 'đăng nhập');
}

const hasData = async (page, id) =>
  (await statusText(page, id)) === null && (await srRows(page, id)).length > 0;

export default async function run(ctx) {
  const { page, rt } = ctx;
  if (!ctx.httpsUrl) {
    ctx.check('máy có openssl để sinh chứng chỉ thử', false, 'không có openssl');
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 429', 'status of 403');

  // ---- Chưa đăng nhập ----
  await page.goto(`${ctx.httpsUrl}/#/dien-nang`, { waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-history-bar', 1);
  await waitDeep(page, 'mat-w-history-pie', 1);
  for (const id of ['bar', 'pie']) {
    await until(
      async () => (await statusText(page, id))?.includes('Đăng nhập'),
      `${id}: chữ đăng nhập`,
    );
    ctx.check(
      `chưa đăng nhập: ${id} hiện "Đăng nhập để xem lịch sử"`,
      (await statusText(page, id)).includes('Đăng nhập để xem lịch sử'),
    );
  }
  ctx.check(
    'chưa đăng nhập: không gọi API lịch sử có dữ liệu',
    rt.history.calls.aggregate === 0,
    String(rt.history.calls.aggregate),
  );

  // ---- Đăng nhập: có số trên bar và pie ----
  await login(ctx);
  await until(() => hasData(page, 'bar'), 'bar có dữ liệu', 15000);
  await until(() => hasData(page, 'pie'), 'pie có dữ liệu', 15000);
  ctx.check('sau đăng nhập: bar và pie có dữ liệu', true);

  // ---- Bar: ca của các ngày đã qua khớp tham chiếu độc lập và báo cáo "Điện năng theo ca" ----
  const tpl = demoReports().reports.find((r) => r.id === 'dien-ca');
  const barRows = await srRows(page, 'bar');
  const now = Date.now();
  let compared = 0;
  let bad = 0;
  const detail = [];
  // Ngày làm việc đã qua hẳn trong 7 ngày gần nhất: ít nhất hôm kia và hôm kìa (bắt đầu 06:00, đủ ba ca).
  const days = [2, 3, 4].map((k) => {
    const p = localParts(now - k * DAY_MS, tzMs);
    return { d: `${p.y}-${p2(p.m)}-${p2(p.d)}`, dd: `${p2(p.d)}/${p2(p.m)}` };
  });
  for (const day of days) {
    await page.evaluate((h) => {
      window.location.hash = h;
    }, `#/report/dien-ca?d=${day.d}`);
    await until(
      () => page.evaluate(() => document.querySelectorAll('table.rpt tbody tr').length >= 3),
      `báo cáo ${day.d}`,
      15000,
    );
    const rep = await page.$$eval('table.rpt tbody tr', (trs) =>
      trs.map((tr) => [...tr.cells].map((c) => c.textContent)),
    );
    // cột 1 của mẫu dien-ca (rep[i][1]): Điện năng - chênh lệch
    const ref = refReport(tpl, { d: day.d }, now);
    ref.table.rows.forEach((r, i) => {
      const label = `${day.dd} Ca ${i + 1}`;
      const barRow = barRows.find((b) => b[0] === label);
      compared++;
      const repText = rep[i]?.[1];
      const ok =
        barRow !== undefined &&
        repText !== undefined &&
        Math.abs(Number(barRow[1]) - r.cells[0]) <= 0.05 + 1e-9 &&
        Number(barRow[1]) === viNumber(repText);
      if (!ok) {
        bad++;
        detail.push(`${label}: bar=${barRow?.[1]} báo cáo=${repText} ref=${r.cells[0]}`);
      }
    });
  }
  ctx.check(
    `bar: ${compared} số (ca của ${days.length} ngày) khớp tham chiếu độc lập và ô báo cáo cùng kỳ`,
    compared === 9 && bad === 0,
    detail.join(' | '),
  );

  // ---- Pie: kỳ "hôm nay" khớp tham chiếu ----
  await page.evaluate(() => {
    window.location.hash = '#/dien-nang';
  });
  await waitDeep(page, 'mat-w-history-pie', 1);
  await until(() => hasData(page, 'pie'), 'pie có dữ liệu (quay lại)', 15000);
  const pieRows = await srRows(page, 'pie');
  const expectPie = (t) => {
    const [from, to] = periodRangeRef('today', t, tzMs, 3, '06:00');
    return ['METER1.KWH', 'METER1.KW'].map((id) => refWindow(id, 'avg', from, to));
  };
  // Phút có thể chuyển giữa lúc widget gọi và lúc đối chiếu: chấp nhận khớp với một trong hai phút kề nhau.
  const candidates = [expectPie(Date.now()), expectPie(Date.now() - MIN_MS)];
  const gotVals = pieRows.map((r) => Number(r[1].split(' ')[0]));
  const pieOk = candidates.some((c) => c.every((v, i) => Math.abs(gotVals[i] - v) <= 0.05 + 1e-9));
  ctx.check(
    'pie: số mỗi phần khớp tham chiếu độc lập cho kỳ "hôm nay"',
    pieOk && pieRows.length === 2,
    JSON.stringify({ pieRows, candidates }),
  );
  const total = gotVals.reduce((s, v) => s + v, 0);
  const pct = pieRows.map((r) => Number(/\(([\d.]+)%\)/.exec(r[1])?.[1]));
  ctx.check(
    'pie: phần trăm = giá trị / tổng (làm tròn 1 chữ số)',
    pct.every((p, i) => Math.abs(p - (gotVals[i] / total) * 100) <= 0.06),
    JSON.stringify(pct),
  );

  // ---- BUSY: 429 hai lần rồi tự thử lại ----
  rt.history.busyNext = 2;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-history-bar', 1);
  await until(() => hasData(page, 'bar'), 'bar sau BUSY', 40000);
  ctx.check('BUSY (429): bar tự thử lại và có dữ liệu', rt.history.busyNext === 0);

  await axeBoth(ctx, 'màn hình Điện năng');
}
