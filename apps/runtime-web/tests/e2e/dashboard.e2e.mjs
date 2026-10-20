/* global document */
// E2E dashboard của projects/grid-demo (feature 014, phản hồi 2026-10-20): hai hàng 4 thẻ chỉ số màu cùng chiều cao 116 px,
// hàng ba khung biểu đồ có thanh tiêu đề và đường ngưỡng (mục chú giải "Ngưỡng cao/thấp"), các ô cùng hàng cao bằng nhau,
// widget mới (KPI, tiến độ, đồng hồ ngày giờ, ghi chú, danh sách trạng thái) có giá trị sống; axe 0 critical/serious ở
// chủ đề vivid và dark; ảnh 1366 và 1920 px ở cả hai chủ đề: tests/e2e/out/dashboard-*.png.
import { deepEval, sleep, until, waitDeep } from './util.mjs';
import { gridDemoProject } from './grid-demo-fixture.mjs';

export const options = { fixture: () => gridDemoProject() };

/** Hộp (y, cao) của mọi ô theo hàng, và số widget theo loại. */
const layout = (page) =>
  deepEval(
    page,
    'mat-screen',
    `const s = els[0].shadowRoot; const rows = {};
     for (const r of s.querySelectorAll('.row')) rows[r.dataset.rowId] = [...r.querySelectorAll('.cell')].map((c) => {
       const b = c.getBoundingClientRect(); const it = c.querySelector('.item')?.firstElementChild;
       const w = it?.getBoundingClientRect();
       return [Math.round(b.y), Math.round(b.height), w ? Math.round(w.height) : -1];
     });
     return rows;`,
  );

const textIn = (page, sel, inner) =>
  deepEval(
    page,
    sel,
    `return els.map((e) => (e.shadowRoot.querySelector(${JSON.stringify(inner)})?.textContent ?? '').replace(/\\s+/g, ' ').trim());`,
  );

async function open(ctx, width) {
  const { page } = ctx;
  await page.setViewport({ width, height: width === 1920 ? 1080 : 768 });
  await page.goto('about:blank');
  await page.goto(ctx.url + '/#/bang-dieu-khien', { waitUntil: 'domcontentloaded' });
  await waitDeep(page, 'mat-w-stat-tile', 8);
  await until(
    async () => (await page.$eval('#app-live', (e) => e.textContent)) === 'Trực tuyến',
    'Trực tuyến',
  );
}

export default async function run(ctx) {
  const { page } = ctx;
  await open(ctx, 1366);
  await sleep(1500);
  const rows = await layout(page);
  for (const id of ['r1', 'r2']) {
    const r = rows[id];
    ctx.check(
      `${id}: 4 thẻ chỉ số cùng hàng, cao 116 px, thẻ phủ kín ô`,
      r.length === 4 && r.every(([y, h, w]) => y === r[0][0] && h === 116 && w === 116),
      JSON.stringify(r),
    );
  }
  for (const [id, h] of Object.entries(rows)) {
    ctx.check(
      `${id}: các ô cùng hàng cao bằng nhau, widget cao bằng ô`,
      h.every(([y, hh, w]) => y === h[0][0] && hh === h[0][1] && w === hh),
      JSON.stringify(h),
    );
  }
  const values = await textIn(page, 'mat-w-stat-tile', '.value');
  ctx.check(
    '8 thẻ có số sống (không "?")',
    values.length === 8 && values.every((v) => /\d/.test(v)),
    values.join(' | '),
  );
  const status = await textIn(page, 'mat-w-stat-tile', '.status');
  ctx.check('thẻ có dòng "Trạng thái: Tốt"', status[0] === 'Trạng thái: Tốt', status[0]);
  const heads = await textIn(page, 'mat-w-line', '.head');
  ctx.check(
    'ba biểu đồ đường có thanh tiêu đề',
    heads.join('|') === 'Biểu đồ nhiệt độ|Biểu đồ áp suất|Biểu đồ lưu lượng',
    heads.join('|'),
  );
  const limits = await deepEval(
    page,
    'mat-w-line',
    `return els[0].shadowRoot.querySelectorAll('.legend li.limit').length;`,
  );
  ctx.check('chú giải có ngưỡng cao và thấp', limits === 2, limits);
  for (const [sel, inner, re, name] of [
    ['mat-w-kpi', '.goal .t', /^Mục tiêu: /, 'KPI có mục tiêu'],
    ['mat-w-progress', '.big', /\d+ %$/, 'vòng tiến độ có phần trăm'],
    ['mat-w-clock', '.big', /^\d\d:\d\d:\d\d$/, 'đồng hồ ngày giờ chạy'],
    ['mat-w-text', '.txt', /van xả/, 'ghi chú hiện chữ'],
    ['mat-w-status-list', 'li .state', /^(Chạy|Dừng)$/, 'danh sách trạng thái'],
  ]) {
    const t = (await textIn(page, sel, inner))[0] ?? '';
    ctx.check(name, re.test(t), t);
  }
  await ctx.axe('dashboard, chủ đề vivid');
  await sleep(20000); // biểu đồ thời gian thực cần dữ liệu cho ảnh
  await ctx.shot('vivid-1366');
  await page.evaluate(() => (document.documentElement.dataset.matTheme = 'dark'));
  await sleep(800);
  await ctx.axe('dashboard, chủ đề dark');
  await ctx.shot('dark-1366');
  await open(ctx, 1920);
  await sleep(20000);
  await ctx.shot('vivid-1920');
  await page.evaluate(() => (document.documentElement.dataset.matTheme = 'dark'));
  await sleep(800);
  await ctx.shot('dark-1920');
}
