// E2E tab ẩn và nền cho xem trước màn hình (feature 007, T135, FR-019, US6-5): khi tab ẩn widget không vẽ; hiện lại thì
// áp giá trị cuối trong <= 1 s. Trình duyệt headless không có tab thật, nên có hai nửa:
// - giả lập: ép `document.hidden` rồi phát `visibilitychange` (đúng điều kiện mà widget đọc);
// - vòng đời thật qua CDP `Page.setWebLifecycleState` (frozen -> active): trang sống lại và số tiếp tục chạy.
import { DASHBOARD_DEMO, openAndWait, readProject, setTheme, sleep, treeItem } from './util.mjs';

const widgetText = (page, id) =>
  page.evaluate((itemId) => {
    const ms = document.querySelector('mat-screen-canvas mat-screen');
    const w = ms?.shadowRoot?.querySelector(`.item[data-item-id="${itemId}"] > *`);
    return (w?.shadowRoot?.textContent ?? w?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }, id);

const setHidden = (page, hidden) =>
  page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (h ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);

/** Mô phỏng sinh số mới liên tục: đợi tới khi chữ của widget đổi khỏi `prev`; trả chữ mới hoặc null. */
async function changedFrom(page, id, prev, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await widgetText(page, id);
    if (t !== prev) return t;
    await sleep(100);
  }
  return null;
}

export default async function screenLifecycle({ page, check }) {
  await setTheme(page, 'light');
  await openAndWait(page, readProject(DASHBOARD_DEMO), 'D:/Projects/dashboard-demo');
  await treeItem(page, 'Tổng quan');
  await page.waitForSelector('mat-screen-canvas .vp');
  await page.$eval('mat-screen-toolbar [data-mode="sim"]', (b) => b.click());
  await sleep(1200);

  const id = 'gauge_temp';
  const live = await widgetText(page, id);
  const moving = await changedFrom(page, id, live, 6000);
  check(
    'Mô phỏng: số của đồng hồ đổi theo thời gian (điều kiện của phép thử)',
    moving !== null,
    live,
  );

  // ---------- Tab ẩn (giả lập) ----------
  await setHidden(page, true);
  await sleep(300);
  const frozen = await widgetText(page, id);
  await sleep(3000);
  const stillFrozen = await widgetText(page, id);
  check('tab ẩn: widget không vẽ lại', frozen === stillFrozen, `${frozen} / ${stillFrozen}`);

  const t0 = Date.now();
  await setHidden(page, false);
  const after = await changedFrom(page, id, stillFrozen, 1000);
  check(
    'hiện lại: áp giá trị cuối trong <= 1 s',
    after !== null,
    `${stillFrozen} -> ${after} sau ${Date.now() - t0} ms`,
  );

  // ---------- Vòng đời thật qua CDP ----------
  const cdp = await page.createCDPSession();
  await cdp.send('Page.enable').catch(() => undefined);
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
  await sleep(1500);
  await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  await sleep(300);
  const base = await widgetText(page, id);
  const resumed = await changedFrom(page, id, base, 6000);
  check(
    'đóng băng rồi hoạt động lại (CDP): trang sống lại, số tiếp tục chạy',
    resumed !== null,
    base,
  );
  await cdp.detach().catch(() => undefined);
}
