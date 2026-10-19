// E2E trình soạn bố cục lưới (feature 012, T032; US1, SC-001): mở projects/grid-demo (định dạng 1.1), mở màn hình lưới,
// thêm hàng 4+4+4, kéo ba widget từ Toolbox vào ba ô trống, đổi chiều rộng xem trước, Lưu, đọc tệp đã ghi: hàng mới có ba
// ô trỏ ba item mới không có tọa độ. Lớp Tauri giả, Chrome headless. Ảnh chụp: tests/e2e/out/grid-editor-*.png.
import { resolve } from 'node:path';
import {
  REPO,
  dragAndDrop,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeItem,
  waitFor,
} from './util.mjs';

const written = (page) =>
  page.evaluate(() => window.__matMock.writes.map((w) => ({ rel: w.rel, content: w.content })));
const cellCount = (page) => page.$$eval('mat-grid-editor .ge-cell', (e) => e.length);

export default async function gridEditor({ page, check, shot }) {
  await setTheme(page, 'light');
  await openAndWait(
    page,
    readProject(resolve(REPO, 'projects/grid-demo')),
    'D:/Projects/grid-demo',
  );
  await treeItem(page, 'Bảng điều khiển');
  await page.waitForSelector('mat-grid-editor .ge-cell');
  await sleep(500);
  const t0 = Date.now();
  check(
    'mở màn hình lưới: trình soạn lưới, 9 ô',
    (await cellCount(page)) === 9,
    String(await cellCount(page)),
  );
  check('không có canvas tự do', (await page.$$eval('mat-screen-canvas', (e) => e.length)) === 0);
  await shot('1-mo');

  // thêm hàng 4+4+4
  await page.click('mat-grid-editor [data-act="add-row"]');
  await page.waitForSelector('mat-grid-editor [data-preset="4+4+4"]');
  await page.click('mat-grid-editor [data-preset="4+4+4"]');
  await waitFor(page, () => document.querySelectorAll('mat-grid-editor .ge-cell').length === 12);
  check('Thêm hàng 4+4+4: thêm ba ô', (await cellCount(page)) === 12);

  // kéo ba widget từ Toolbox vào ba ô trống mới
  const empty = await page.$$eval('mat-grid-editor .ge-cell.empty', (e) =>
    e.map((x) => x.dataset.cell),
  );
  const kinds = ['card', 'gauge', 'lamp'];
  for (let i = 0; i < 3; i++) {
    const box = await page.$eval(`mat-grid-editor .ge-cell[data-cell="${empty[i]}"]`, (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const r = await dragAndDrop(
      page,
      `mat-taskcards .tool[data-widget="${kinds[i]}"]`,
      `mat-grid-editor .ge-cell[data-cell="${empty[i]}"]`,
      box.x,
      box.y,
    );
    check(`kéo ${kinds[i]} vào ô ${empty[i]}`, r !== 'missing', r);
    await sleep(150);
  }
  const filled = await page.$$eval('mat-grid-editor .ge-cell.empty', (e) => e.length);
  check('ba ô mới đã có component', filled === empty.length - 3, String(filled));
  const secs = (Date.now() - t0) / 1000;
  check(
    'dựng hàng mới 3 component nhanh (SC-001: cả màn hình ≤ 3 phút)',
    secs < 180,
    `${secs.toFixed(1)} s`,
  );
  await sleep(300);
  await shot('2-hang-moi');

  // xem trước 600 px: xếp chồng
  await page.click('mat-grid-editor [data-width="600"]');
  await sleep(400);
  const narrow = await page.$eval('mat-grid-editor mat-screen', (s) =>
    s.shadowRoot.querySelector('.grid').classList.contains('narrow'),
  );
  check('xem trước 600 px: các ô xếp chồng', narrow);
  await shot('3-600');
  await page.click('mat-grid-editor [data-width="1366"]');

  // Lưu và đọc tệp đã ghi
  await press(page, 'Control+s');
  await waitFor(page, () =>
    window.__matMock.writes.some((w) => w.rel.endsWith('bang-dieu-khien.screen.json')),
  );
  const file = (await written(page))
    .filter((w) => w.rel === 'screens/bang-dieu-khien.screen.json')
    .at(-1);
  const doc = JSON.parse(file.content);
  const last = doc.layout.rows.at(-1);
  check('tệp đã ghi: hàng mới 4+4+4', last.cells.map((c) => c.span).join('+') === '4+4+4');
  const ids = last.cells.map((c) => c.item);
  const items = ids.map((id) => doc.items.find((x) => x.id === id));
  check('ba ô trỏ ba item mới', items.every(Boolean), ids.join(','));
  check(
    'item lưới không có tọa độ',
    items.every((x) => x && x.x === undefined && x.width === undefined),
  );
  check('tệp 1.1.0', doc.schemaVersion === '1.1.0', doc.schemaVersion);
}
