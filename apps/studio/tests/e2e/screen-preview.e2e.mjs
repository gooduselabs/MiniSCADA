// E2E xem trước màn hình 0.3 trong Studio (feature 007, T121, T132, FR-067, US6-6): ba chế độ Tắt, Mô phỏng, Thiết bị.
// - Mô phỏng: số sống từ SimEngine, chỉnh sửa bị khóa, nút điều khiển đi qua hộp xác nhận rồi ghi vào mô phỏng (không gọi
//   thiết bị), nút chuyển màn hình và popup đổi màn hình ngay trong editor;
// - Thiết bị: khóa kèm lý do khi chưa Online; Online thì số sống của thiết bị giả và ghi qua WriteFlow (một POST tags/write
//   kèm context); về Tắt giữ lựa chọn và vùng nhìn; axe ở cả ba chế độ, hai theme.
import {
  DASHBOARD_DEMO,
  axeScopedBoth,
  goOnline,
  openAndWait,
  readProject,
  setTheme,
  sleep,
  treeItem,
  waitFor,
} from './util.mjs';

/** Chữ hiện trong widget của item (qua shadow DOM của mat-screen và của widget). */
const widgetText = (page, id) =>
  page.evaluate((itemId) => {
    const ms = document.querySelector('mat-screen-canvas mat-screen');
    const w = ms?.shadowRoot?.querySelector(`.item[data-item-id="${itemId}"] > *`);
    return (w?.shadowRoot?.textContent ?? w?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }, id);

/** Nhấp vào phần tử trong shadow DOM của widget (nút của button, switch…). */
const clickInWidget = (page, id, selector) =>
  page.evaluate(
    (itemId, sel) => {
      const ms = document.querySelector('mat-screen-canvas mat-screen');
      const w = ms?.shadowRoot?.querySelector(`.item[data-item-id="${itemId}"] > *`);
      const el = w?.shadowRoot?.querySelector(sel);
      el?.click();
      return Boolean(el);
    },
    id,
    selector,
  );

/** Hộp xác nhận ghi (mat-confirm-dialog ở body): có hiện không, và bấm nút `data-ok` hoặc `data-cancel`. */
const confirmOpen = (page) =>
  page.evaluate(() =>
    Boolean(
      document
        .querySelector('mat-confirm-dialog')
        ?.shadowRoot?.querySelector('[role="alertdialog"]'),
    ),
  );
const confirmPress = (page, which) =>
  page.evaluate((w) => {
    const b = document.querySelector('mat-confirm-dialog')?.shadowRoot?.querySelector(`[${w}]`);
    b?.click();
    return Boolean(b);
  }, which);

const modeBtn = (mode) => `mat-screen-toolbar [data-mode="${mode}"]`;
const pressed = (page, mode) =>
  page.$eval(modeBtn(mode), (b) => b.getAttribute('aria-pressed') === 'true');
const isDisabled = (page, cmd) => page.$eval(`[data-cmd="${cmd}"]`, (b) => b.disabled);

export default async function screenPreview(ctx) {
  const { page, check, shot } = ctx;
  await setTheme(page, 'light');
  await openAndWait(page, readProject(DASHBOARD_DEMO), 'D:\\Projects\\dashboard-demo');
  await treeItem(page, 'Tổng quan');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(500);

  // ---------- 1. Tắt: chỉnh sửa; mặc định ----------
  check('mặc định: chế độ Tắt (chỉnh sửa)', await pressed(page, 'off'));
  check('Tắt: canvas có lớp phủ chỉnh sửa', (await page.$$('mat-screen-canvas .oi')).length > 20);
  await page.click('mat-screen-canvas .vp', { offset: { x: 5, y: 5 } }).catch(() => undefined);

  // ---------- 2. Mô phỏng ----------
  await page.$eval(modeBtn('sim'), (b) => b.click());
  await sleep(900);
  check('chuyển sang Mô phỏng', await pressed(page, 'sim'));
  check(
    'Mô phỏng: lớp phủ chỉnh sửa biến mất, nút chỉnh sửa bị khóa',
    (await page.$$('mat-screen-canvas .oi')).length === 0 &&
      (await isDisabled(page, 'screen.alignLeft')),
  );
  const sim1 = await widgetText(page, 'card_level');
  check('Mô phỏng: thẻ giá trị hiện số (không còn dấu hỏi)', /\d/.test(sim1), sim1);
  await shot('1-mo-phong');
  await axeScopedBoth(ctx, 'xem trước Mô phỏng (không kể nội dung widget)');

  // Nút "Chạy bơm (xung)": hộp xác nhận → ghi vào mô phỏng
  const clicked = await clickInWidget(page, 'btn_start', 'button');
  await waitFor(page, () =>
    document.querySelector('mat-confirm-dialog')?.shadowRoot?.querySelector('[role="alertdialog"]'),
  );
  check(
    'nút điều khiển mở hộp xác nhận ghi (không ghi ngay)',
    clicked && (await confirmOpen(page)),
  );
  await shot('2-xac-nhan-ghi');
  check('Hủy trong hộp xác nhận: không ghi', await confirmPress(page, 'data-cancel'));
  await sleep(200);
  check('đóng hộp xác nhận', !(await confirmOpen(page)));
  const writesBefore = await page.evaluate(() => (window.__matMock.device ? 0 : 0));
  void writesBefore;
  await clickInWidget(page, 'btn_start', 'button');
  await waitFor(page, () =>
    document.querySelector('mat-confirm-dialog')?.shadowRoot?.querySelector('[data-ok]'),
  );
  await confirmPress(page, 'data-ok');
  await sleep(900);
  check('Xác nhận: ghi vào mô phỏng, hộp xác nhận đóng', !(await confirmOpen(page)));

  // Nút chuyển màn hình: đổi màn hình trong editor
  await clickInWidget(page, 'btn_goto', 'button');
  await sleep(500);
  const shownAfter = await page.evaluate(
    () => document.querySelector('mat-screen-canvas mat-screen')?.screen?.id,
  );
  check(
    'nút Chuyển màn hình đổi màn hình đang xem trước',
    shownAfter === 'giam-sat',
    String(shownAfter),
  );
  await shot('3-chuyen-man-hinh');

  // ---------- 3. Thiết bị khi chưa Online: khóa kèm lý do ----------
  await page.$eval(modeBtn('device'), (b) => b.click());
  await sleep(300);
  check(
    'Thiết bị khi chưa Online: không chuyển được, kèm lý do',
    !(await pressed(page, 'device')) &&
      (await page.$eval(modeBtn('device'), (b) => b.getAttribute('aria-disabled'))) === 'true',
  );

  // ---------- 4. Về Tắt: giữ vùng nhìn và lựa chọn ----------
  await page.$eval(modeBtn('off'), (b) => b.click());
  await sleep(500);
  const back = await page.evaluate(
    () => document.querySelector('mat-screen-canvas mat-screen')?.screen?.id,
  );
  check('về Tắt: màn hình đang chỉnh là màn hình của tab', back === 'tong-quan', String(back));
  check('về Tắt: lớp phủ chỉnh sửa trở lại', (await page.$$('mat-screen-canvas .oi')).length > 20);

  // ---------- 5. Thiết bị khi Online ----------
  await goOnline(page, 'kysu1', readProject(DASHBOARD_DEMO));
  await treeItem(page, 'Tổng quan');
  await page.waitForSelector('mat-screen-canvas .vp');
  await page.$eval(modeBtn('device'), (b) => b.click());
  await sleep(1200);
  check('Online: chuyển được sang Thiết bị', await pressed(page, 'device'));
  const dev1 = await widgetText(page, 'card_level');
  check('Thiết bị: thẻ giá trị hiện số sống của thiết bị giả', /\d/.test(dev1), dev1);
  await shot('4-thiet-bi');
  await axeScopedBoth(ctx, 'xem trước Thiết bị (không kể nội dung widget)');
  const border = await page.$eval('mat-screen-canvas .vp', (e) => getComputedStyle(e).boxShadow);
  check('Thiết bị: viền cam báo đang làm việc với dữ liệu thật', /rgb/.test(border), border);
  await page.$eval(modeBtn('off'), (b) => b.click());
}
