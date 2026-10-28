// E2E vào đồ họa SVG trên màn hình bố cục LƯỚI (feature 012 + 008): projects/grid-demo, thêm vào màn hình lưới "Bảng điều
// khiển" một hàng chứa item SVG (bồn nước của svg-fixture), nhấp đúp ô để vào đồ họa, nhấp chọn phần tử chữ "Số mức", gắn
// "Chữ hiển thị giá trị" với TANK01.LEVEL qua Gợi ý, Esc thoát, Lưu (Ctrl+S) rồi đọc file binding đã ghi. Kiểm thêm nút
// "Gắn Tag cho phần tử…" ở tab Đồ họa và thanh công cụ gọn (Ô:/Hàng: chỉ khi chọn ô). Lớp Tauri giả, Chrome headless.
import { resolve } from 'node:path';
import { BON_SVG, UIDS } from './svg-fixture.mjs';
import {
  REPO,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeItem,
  waitFor,
} from './util.mjs';

const SCREEN = 'screens/bang-dieu-khien.screen.json';
const BIND = 'screens/bang-dieu-khien.so_do.bindings.json';

function project() {
  const files = readProject(resolve(REPO, 'projects/grid-demo'));
  const s = JSON.parse(files[SCREEN]);
  s.items.push({
    id: 'so_do',
    name: 'Sơ đồ bồn',
    type: 'svg',
    svgFile: 'graphics/bon.svg',
    bindingFile: BIND,
    viewBox: [0, 0, 400, 300],
    fit: 'contain',
    elements: Object.values(UIDS).map((elementUid) => ({ elementUid })),
  });
  s.layout.rows.unshift({
    id: 'r_svg',
    height: 360,
    cells: [{ id: 'c_svg', span: 12, item: 'so_do' }],
  });
  files[SCREEN] = JSON.stringify(s, null, 2);
  files['graphics/bon.svg'] = BON_SVG;
  files[BIND] = JSON.stringify({
    schemaVersion: '1.1.0',
    screenId: 'bang-dieu-khien',
    itemId: 'so_do',
    elements: [],
  });
  return files;
}

/** Hộp bao client của phần tử SVG `uid` trong item `so_do` của trình soạn lưới. */
const rectOf = (page, uid) =>
  page.evaluate((u) => {
    const ms = document.querySelector('mat-grid-editor mat-screen');
    const root = ms?.shadowRoot?.querySelector('.item[data-item-id="so_do"] .svg-host')?.shadowRoot;
    const r = root?.querySelector(`[data-mat-uid="${u}"]`)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, uid);

const cellCenter = (page) =>
  page.$eval('mat-grid-editor .ge-cell[data-cell="c_svg"]', (e) => {
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });

const entered = (page) =>
  page.$('mat-grid-editor .ge-cell.entered[data-cell="c_svg"]').then((e) => e !== null);

export default async function gridSvgEnter({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await openAndWait(page, project(), 'D:/Projects/grid-demo');
  await treeItem(page, 'Bảng điều khiển');
  await page.waitForSelector('mat-grid-editor .ge-cell[data-cell="c_svg"]');
  await sleep(600);

  // Thanh công cụ gọn: chưa chọn ô thì không có dòng Ô:/Hàng:; thanh không bị trang đè (trang cuộn trong .ge-stage).
  check(
    'chưa chọn ô: không có dòng thuộc tính Ô/Hàng',
    (await page.$('mat-grid-editor .ge-bar2')) === null,
  );
  const layout = await page.evaluate(() => {
    const bars = document.querySelector('mat-grid-editor .ge-bars').getBoundingClientRect();
    const stage = document.querySelector('mat-grid-editor .ge-stage');
    stage.scrollTop = 200;
    const st = stage.getBoundingClientRect();
    const hit = document.elementFromPoint(bars.x + 40, bars.y + bars.height / 2);
    return { below: st.top >= bars.bottom - 1, barOnTop: !!hit?.closest('.ge-bars') };
  });
  check(
    'thanh công cụ ở trên vùng cuộn, không bị lớp phủ ô che',
    layout.below && layout.barOnTop,
    JSON.stringify(layout),
  );
  await page.evaluate(() => (document.querySelector('mat-grid-editor .ge-stage').scrollTop = 0));

  // Chọn ô: tab Đồ họa có nút "Gắn Tag cho phần tử…"; dòng 2 có Ô: và Hàng:.
  let at = await cellCenter(page);
  await page.mouse.click(at.x, at.y);
  await page.waitForSelector('mat-grid-editor .ge-bar2');
  const bar2 = await page.$eval('mat-grid-editor .ge-bar2', (e) => e.textContent);
  check('chọn ô: dòng 2 có "Ô:" và "Hàng:"', bar2.includes('Ô:') && bar2.includes('Hàng:'));
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-widget-props [role="tab"]')]
      .find((x) => /Đồ họa/.test(x.textContent))
      ?.click(),
  );
  await page.waitForSelector('mat-widget-props [data-act="svg-enter"]');
  const hint = await page.$eval('mat-widget-props .wi-actions', (e) => e.textContent);
  check(
    'tab Đồ họa: nút Gắn Tag cho phần tử… kèm gợi ý nhấp đúp',
    /Gắn Tag cho phần tử/.test(hint) && /Nhấp đúp/.test(hint),
    hint,
  );
  await shot('1-tab-do-hoa');
  await axe('tab Đồ họa của item SVG trên màn hình lưới');

  // Nút vào đồ họa, Esc thoát.
  await page.$eval('mat-widget-props [data-act="svg-enter"]', (b) => b.click());
  await waitFor(page, () => document.querySelector('mat-grid-editor .ge-cell.entered') !== null);
  check('nút Gắn Tag cho phần tử…: vào đồ họa', await entered(page));
  await page.focus('mat-grid-editor .ge-cell[data-cell="c_svg"]');
  await press(page, 'Escape');
  await waitFor(page, () => document.querySelector('mat-grid-editor .ge-cell.entered') === null);
  check('Esc: thoát đồ họa', !(await entered(page)));

  // Nhấp đúp vào ô: vào đồ họa, cây phần tử hiện.
  at = await cellCenter(page);
  await page.mouse.click(at.x, at.y, { count: 2 });
  await waitFor(page, () => document.querySelector('mat-grid-editor .ge-cell.entered') !== null);
  check('nhấp đúp ô chứa item SVG: vào đồ họa', await entered(page));
  await waitFor(page, () => document.querySelector('mat-svg-overlay .svo-item') !== null);
  await waitFor(page, () => document.querySelector('mat-svg-tree') !== null);
  check('cây phần tử hiện', true);

  // Rê chuột: khung rê; nhấp: chọn phần tử chữ "Số mức".
  const r = await rectOf(page, UIDS.value);
  check('phần tử chữ đã dựng trong ô', r !== null && r.w > 0);
  await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2);
  await waitFor(page, () => document.querySelector('mat-svg-overlay .svo-hover') !== null);
  check('rê chuột trên phần tử: có khung rê', true);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  await waitFor(page, () => document.querySelector('mat-svg-overlay .svo-sel') !== null);
  const sel = await page.$eval('mat-svg-overlay .svo-sel', (e) => e.dataset.uid);
  check('nhấp phần tử: chọn đúng phần tử chữ', sel === UIDS.value, sel);
  await page.waitForSelector('mat-svg-bind [data-row="text"]');
  check('inspector có tab Gắn Tag với dòng Chữ', true);
  await shot('2-da-vao');

  // Gắn Chữ hiển thị giá trị với TANK01.LEVEL (Gợi ý).
  await page.$eval('mat-svg-bind [data-act="suggest"]', (b) => b.click());
  await page.waitForSelector('mat-svg-bind mat-tag-chooser input');
  await page.keyboard.type('TANK01.LEVEL');
  await page.keyboard.press('Enter');
  await page.waitForSelector('mat-svg-bind .sugg .sugg-r');
  await page.$eval('mat-svg-bind .sugg .btn.primary', (b) => b.click());
  await waitFor(page, () => document.querySelector('[data-row="text"]')?.dataset.bound === 'true');
  check('gắn Chữ hiển thị giá trị với TANK01.LEVEL', true);
  await shot('3-da-gan');

  // Esc thoát, Lưu, đọc file binding.
  await page.focus('mat-grid-editor .ge-cell[data-cell="c_svg"]');
  await press(page, 'Escape');
  await waitFor(page, () => document.querySelector('mat-grid-editor .ge-cell.entered') === null);
  await press(page, 'Control+s');
  await waitFor(page, () =>
    window.__matMock.writes.some((w) => w.rel.endsWith('so_do.bindings.json')),
  );
  const file = await page.evaluate(
    (rel) => window.__matMock.writes.filter((w) => w.rel.endsWith(rel)).at(-1)?.content,
    'so_do.bindings.json',
  );
  const set = JSON.parse(file);
  const el = set.elements.find((e) => e.elementUid === UIDS.value);
  const b = el?.bindings?.find((x) => x.source?.tagId === 'TANK01.LEVEL');
  check('Lưu: file binding có binding chữ của el_value với TANK01.LEVEL', b !== undefined, file);
}
