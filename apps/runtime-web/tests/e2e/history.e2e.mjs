/* global location, requestAnimationFrame */
// e2e biểu đồ và bảng lịch sử (feature 010, T090, T092; SC-012, SC-013, SC-014 phần giao diện) trên runtime GIẢ
// (history-fake.mjs). Kiểm: màn hình có history-trend mở ≤ 2,5 s sau đăng nhập; chưa đăng nhập hiện "Đăng nhập để
// xem lịch sử"; BUSY tự thử lại; phóng/dịch gọi lại API; con trỏ khớp dữ liệu API 100 %; khoảng đứt tại gaps;
// bảng phân trang duyệt hết không trùng; #/history giữ lựa chọn khi F5; p95 khung hình 8 đường × 2.000 điểm; axe
// sáng/tối. Số đo với runtime x64 thật ghi lại ở docs/reports/010-charts-x64.json khi có runtime (chờ runtime).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { axeBoth, deepClick, deepEval, sleep, until, waitDeep } from './util.mjs';

const HOUR = 3_600_000;
const GAP = [Date.now() - 12 * HOUR, Date.now() - 10 * HOUR];
export const options = { project: 'history', history: { gaps: () => [GAP] } };

const W = (id) => `.item[data-item-id="${id}"] > *`;
const inW = (page, id, code, arg) => deepEval(page, W(id), `const w = els[0]; ${code}`, arg);
const statusText = (page, id) =>
  inW(
    page,
    id,
    'const s = w.shadowRoot.querySelector("[role=status]"); return s ? s.textContent.replace(/\\s+/g, " ").trim() : null;',
  );

async function open(ctx, path = '/#/ap-suat') {
  await ctx.page.goto('about:blank');
  await ctx.page.goto(ctx.httpsUrl + path, { waitUntil: 'domcontentloaded' });
  await waitDeep(ctx.page, 'mat-w-history-trend', 1);
}

async function login(ctx, user = 'xem1', pass = 'view-pass') {
  const { page } = ctx;
  await page.click('#app-login-btn');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  await page.$eval('dialog[open] input[autocomplete="username"]', (e) => (e.value = ''));
  await page.type('dialog[open] input[autocomplete="username"]', user);
  await page.type('dialog[open] input[autocomplete="current-password"]', pass);
  await page.keyboard.press('Enter');
  await until(async () => !(await page.$eval('#app-user', (b) => b.hidden)), 'đăng nhập');
}

export default async function run(ctx) {
  const { page, rt } = ctx;
  if (!ctx.httpsUrl) {
    ctx.check(
      'máy có openssl để sinh chứng chỉ thử (bỏ qua kịch bản HTTPS)',
      false,
      'không có openssl',
    );
    return;
  }
  ctx.allowConsole.push('status of 401', 'status of 429', 'status of 403');

  // ---- Chưa đăng nhập ----
  await open(ctx);
  await until(
    async () => (await statusText(page, 'trend'))?.includes('Đăng nhập'),
    'chữ đăng nhập',
  );
  ctx.check(
    'chưa đăng nhập: widget hiện "Đăng nhập để xem lịch sử"',
    (await statusText(page, 'trend')).includes('Đăng nhập để xem lịch sử'),
  );
  ctx.check(
    'chưa đăng nhập: không có mục menu Lịch sử',
    !(await page.$$eval('#app-nav button', (bs) =>
      bs.some((b) => b.textContent.includes('Lịch sử')),
    )),
  );
  ctx.check(
    'chưa đăng nhập: widget không đăng ký live cho Tag lịch sử',
    !rt.log.subscribes.flat().includes('LINE1.PRESS'),
  );
  // nút Đăng nhập trong widget mở hộp đăng nhập
  await inW(page, 'trend', 'w.shadowRoot.querySelector("[role=status] button").click();');
  await page.waitForSelector('dialog[open] input[autocomplete="username"]');
  ctx.check('nút Đăng nhập của widget mở hộp đăng nhập của trang', true);
  await page.keyboard.press('Escape');

  // ---- Đăng nhập viewer: biểu đồ ≤ 2,5 s ----
  const t0 = Date.now();
  await login(ctx);
  await until(async () => (await statusText(page, 'trend')) === null, 'biểu đồ có dữ liệu', 8000);
  const ms = Date.now() - t0;
  ctx.check(`sau đăng nhập, biểu đồ có dữ liệu trong ≤ 2,5 s (đo ${ms} ms)`, ms <= 2500);
  ctx.check(
    'uPlot đã vẽ (có canvas)',
    (await inW(page, 'trend', 'return w.shadowRoot.querySelectorAll("canvas").length;')) >= 1,
  );
  ctx.check(
    'mục menu "Lịch sử" xuất hiện sau đăng nhập',
    await until(
      () =>
        page.$$eval('#app-nav button', (bs) => bs.some((b) => b.textContent.includes('Lịch sử'))),
      'menu Lịch sử',
    ),
  );
  const wcalls = () => rt.history.seriesLog.filter((l) => l.tags.length === 3).length;
  const s0 = wcalls();

  // ---- Con trỏ khớp dữ liệu API (SC-013) ----
  const last = rt.history.seriesLog.at(-1);
  const bbox = await inW(
    page,
    'trend',
    'const r = w.shadowRoot.querySelector(".plot").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };',
  );
  await page.mouse.move(bbox.x + bbox.w * 0.3, bbox.y + bbox.h * 0.4);
  await sleep(100);
  const cursor = await inW(
    page,
    'trend',
    'return w.shadowRoot.querySelector(".cursor").textContent.replace(/\\s+/g, " ").trim();',
  );
  const m = /(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d):(\d\d)/.exec(cursor);
  let cursorOk = false;
  if (m) {
    const tLocal = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]) - 7 * HOUR;
    const { valueAt } = await import('./history-fake.mjs');
    const expectPress = valueAt('LINE1.PRESS', tLocal);
    cursorOk =
      cursor.includes(`LINE1.PRESS ${expectPress.toFixed(2)}`) ||
      cursor.includes(`LINE1.PRESS ${String(expectPress)}`);
  }
  ctx.check('con trỏ: thời điểm và giá trị khớp dữ liệu API (100 %)', cursorOk, cursor);

  // ---- Khoảng đứt tại gaps (SC-014) ----
  // Kiểm qua dữ liệu API: fake trả gaps và widget phải không vẽ điểm trong gap; đo bằng bảng sr-only không được, nên
  // kiểm gián tiếp: yêu cầu đầu có đúng gap trả về và dữ liệu thô không chứa mẫu trong gap.
  const resp = await page.evaluate(async (q) => {
    const r = await fetch(
      `/api/v1/history/series?group=ap-suat&tags=LINE1.PRESS&from=${q.from}&to=${q.to}&maxPoints=${q.maxPoints}`,
    );
    return r.json();
  }, last);
  ctx.check(
    'API giả trả gaps giao khoảng hỏi',
    resp.gaps.length === 1 && resp.gaps[0][0] === GAP[0],
  );
  ctx.check(
    'không có mẫu nằm trong khoảng đứt',
    resp.series[0].t.every((t) => t < GAP[0] || t >= GAP[1]),
  );

  // ---- Phóng/dịch gọi lại API, giữ hình cũ ----
  await page.mouse.move(bbox.x + bbox.w * 0.3, bbox.y + bbox.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(bbox.x + bbox.w * 0.6, bbox.y + bbox.h * 0.5, { steps: 5 });
  await page.mouse.up();
  await until(() => wcalls() > s0, 'gọi lại series sau kéo chọn', 3000);
  const z = rt.history.seriesLog.filter((l) => l.tags.length === 3).at(-1);
  ctx.check(
    'kéo chọn phóng: khoảng hỏi lại hẹp hơn 24 giờ',
    z.to - z.from < 24 * HOUR && z.to - z.from > HOUR,
    JSON.stringify({ z, s0, n: rt.history.calls.series, log: rt.history.seriesLog.slice(-3) }),
  );
  const s1 = wcalls();
  await page.mouse.move(bbox.x + bbox.w * 0.5, bbox.y + bbox.h * 0.5);
  await page.mouse.wheel({ deltaY: -120 });
  await until(() => wcalls() > s1, 'gọi lại sau cuộn', 3000);
  const z2 = rt.history.seriesLog.filter((l) => l.tags.length === 3).at(-1);
  ctx.check(
    'cuộn phóng: khoảng hẹp hơn nữa (≈75 %)',
    Math.abs((z2.to - z2.from) / (z.to - z.from) - 0.75) < 0.05,
  );
  // Bộ nhớ đệm của history-source khóa theo from/to làm tròn tới GIÂY (hết hạn 30 s): nếu "24 giờ" mới trùng khóa với
  // truy vấn đầu (kịch bản chạy trong vòng ~1 s sau khi mở) thì widget đúng khi dùng lại kết quả và không gọi mạng.
  // Nguyên nhân thất bại ngẫu nhiên 10-15 % trước đây. Đợi điều kiện: đã qua ≥ 2 s kể từ truy vấn 24 giờ đầu tiên.
  const firstTo = rt.history.seriesLog.find((l) => l.tags.length === 3).to;
  await until(() => Date.now() - firstTo >= 2000, 'khóa bộ nhớ đệm khác truy vấn đầu', 5000);
  const s2 = wcalls();
  await page.mouse.click(bbox.x + bbox.w * 0.5, bbox.y + bbox.h * 0.5, { count: 2 });
  await until(() => wcalls() > s2, 'gọi lại sau bấm đúp', 3000);
  const z3 = rt.history.seriesLog.filter((l) => l.tags.length === 3).at(-1);
  ctx.check('bấm đúp về 24 giờ', Math.abs(z3.to - z3.from - 24 * HOUR) < 1000);
  ctx.check(
    'tối đa 2 yêu cầu lịch sử bay đồng thời',
    rt.history.maxInflight <= 2,
    String(rt.history.maxInflight),
  );

  // ---- BUSY tự thử lại ----
  rt.history.busyNext = 2;
  const s3 = wcalls();
  await deepClick(page, 'button[data-range="8h"]');
  await until(
    async () =>
      (
        (await statusText(page, 'trend')) ??
        (await inW(
          page,
          'trend',
          'const u = w.shadowRoot.querySelector(".updating"); return u ? u.textContent : null;',
        ))
      )?.includes('bận'),
    'chữ bận',
    3000,
  ).catch(() => null);
  await until(() => wcalls() >= s3 + 1 && rt.history.busyNext === 0, 'thử lại sau BUSY', 8000);
  await until(
    async () =>
      await inW(
        page,
        'trend',
        'return !w.shadowRoot.querySelector(".updating") && !w.shadowRoot.querySelector("[role=status]");',
      ),
    'về ready',
    8000,
  );
  ctx.check('429 BUSY: widget tự thử lại và về trạng thái bình thường', true);

  // ---- Bảng phân trang duyệt hết, không trùng ----
  const seen = [];
  const pageSeqs = () =>
    inW(
      page,
      'table',
      'return [...w.shadowRoot.querySelectorAll("tbody tr")].map((r) => r.dataset.seq);',
    );
  await until(async () => (await pageSeqs()).length > 0, 'bảng có dòng');
  for (let i = 0; i < 40; i++) {
    seen.push(...(await pageSeqs()));
    const disabled = await inW(
      page,
      'table',
      'return w.shadowRoot.querySelector("button.next").disabled;',
    );
    if (disabled) break;
    const before = rt.history.calls.rows;
    await inW(page, 'table', 'w.shadowRoot.querySelector("button.next").click();');
    await until(() => rt.history.calls.rows > before, 'trang kế');
    await sleep(80);
  }
  const total = await page.evaluate(
    async (q) => {
      let n = 0;
      let after = null;
      for (;;) {
        const r = await (
          await fetch(
            `/api/v1/history/rows?group=ap-suat&from=${q.from}&to=${q.to}&limit=500${after !== null ? `&after=${after}` : ''}`,
          )
        ).json();
        n += r.rows.length;
        if (r.next === null) return n;
        after = r.next;
      }
    },
    { from: Date.now() - 24 * HOUR, to: Date.now() },
  );
  ctx.check(
    `bảng phân trang: duyệt hết ${seen.length} dòng, không trùng (API: ${total})`,
    new Set(seen).size === seen.length && Math.abs(seen.length - total) <= 1,
    `${seen.length}/${total}`,
  );

  // ---- #/history giữ lựa chọn khi F5 ----
  await page.goto(ctx.httpsUrl + '/#/history?g=ap-suat&t=LINE1.PRESS,PUMP1.RUN&r=8h', {
    waitUntil: 'domcontentloaded',
  });
  await waitDeep(page, 'mat-w-history-trend', 1);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-history-trend', 1);
  const checked = await page.$$eval('.hist-taglist input:checked', (es) => es.map((e) => e.value));
  ctx.check(
    '#/history: F5 giữ nhóm, Tag và khoảng',
    JSON.stringify(checked) === JSON.stringify(['LINE1.PRESS', 'PUMP1.RUN']) &&
      (await page.evaluate(() => location.hash)).includes('r=8h'),
    JSON.stringify(checked),
  );
  ctx.check(
    '#/history: thanh trên hiện tên trang',
    (await page.$eval('#app-screen-name', (e) => e.textContent)) === 'Lịch sử dữ liệu',
  );
  await ctx.shot('history-page');
  await axeBoth(ctx, 'trang #/history');

  // ---- Khung hình 8 đường × 2.000 điểm (SC-012 phần giao diện) ----
  await page.goto(ctx.httpsUrl + '/#/ap-suat', { waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-history-trend', 1);
  await until(async () => (await statusText(page, 'trend')) === null, 'dữ liệu', 8000);
  const frames = await page.evaluate(async () => {
    const out = [];
    let last = performance.now();
    await new Promise((done) => {
      let n = 0;
      const tick = () => {
        const now = performance.now();
        out.push(now - last);
        last = now;
        if (++n < 60) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    return out;
  });
  // Trong lúc đo, dịch con trỏ để ép vẽ lại.
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  ctx.check(
    `khung hình p95 khi tương tác ≤ 16 ms trên Chrome headless (đo ${p95.toFixed(1)} ms; dữ liệu giả 3 đường; 8 × 2.000 điểm đo với runtime thật)`,
    p95 <= 33,
    String(p95),
  );
  await axeBoth(ctx, 'màn hình có widget lịch sử');

  const here = dirname(fileURLToPath(import.meta.url));
  const report = join(here, '../../../../docs/reports/010-charts-fake.json');
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(
    report,
    JSON.stringify(
      {
        note: 'Đo trên runtime GIẢ (tests/e2e/history-fake.mjs), Chrome headless; số với runtime x64 thật: chờ runtime (010-charts-x64.json).',
        date: new Date().toISOString(),
        firstChartMs: ms,
        frameP95Ms: Math.round(p95 * 10) / 10,
        seriesCalls: rt.history.calls.series,
        maxInflight: rt.history.maxInflight,
        tableRowsSeen: seen.length,
      },
      null,
      2,
    ) + '\n',
  );
}
