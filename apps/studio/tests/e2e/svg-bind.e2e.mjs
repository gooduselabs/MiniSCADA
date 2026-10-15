// E2E canvas vào item SVG, cây phần tử, inspector Gắn Tag (feature 008, T070 đến T074, T076, T081, T085). Lớp Tauri giả, Chrome headless.
import { UIDS, bonProject } from './svg-fixture.mjs';
import { axeBoth, designToPage, openAndWait, setTheme, sleep, treeItem, waitFor } from './util.mjs';

/** Hộp bao (toạ độ client) của phần tử SVG `uid` trong item `svg1` của canvas. */
const rectOf = (page, uid) =>
  page.evaluate((u) => {
    const ms = document.querySelector('mat-screen-canvas mat-screen');
    const root = ms?.shadowRoot?.querySelector('.item[data-item-id="svg1"] .svg-host')?.shadowRoot;
    const r = root?.querySelector(`[data-mat-uid="${u}"]`)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  }, uid);

/** Khung chọn của lớp phủ (toạ độ client) theo UID. */
const selBoxes = (page) =>
  page.$$eval('mat-svg-overlay .svo-sel', (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { uid: e.dataset.uid, x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );

const near = (a, b, tol = 2.5) =>
  a !== null &&
  b !== null &&
  Math.abs(a.x - b.x) <= tol &&
  Math.abs(a.y - b.y) <= tol &&
  Math.abs(a.w - b.w) <= tol &&
  Math.abs(a.h - b.h) <= tol;

const clickEl = async (page, uid, opts = {}) => {
  const r = await rectOf(page, uid);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2, opts);
  return r;
};

const entered = (page) => page.$('mat-screen-canvas .vp.entered').then((e) => e !== null);

export default async function svgBind({ page, check, shot, axe }) {
  void axe;
  await setTheme(page, 'light');
  await openAndWait(page, bonProject(), 'D:\\Projects\\bon-nuoc');
  await treeItem(page, 'Bồn nước');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(600);
  await shot('1-man-hinh');

  // ---------- T070: nhấp đúp vào item, khung chọn, Esc ----------
  const at = await designToPage(page, 440, 340);
  await page.mouse.click(at.x, at.y);
  await page.mouse.click(at.x, at.y, { count: 2 });
  await waitFor(page, () => document.querySelector('mat-screen-canvas .vp.entered') !== null);
  check('nhấp đúp item svg: canvas vào đồ họa', true);
  const cursor = await page.$eval('mat-screen-canvas .vp', (e) => getComputedStyle(e).cursor);
  check('đang vào: con trỏ chuột chữ thập', cursor === 'crosshair', cursor);
  await waitFor(page, () => document.querySelector('mat-svg-overlay .svo-item') !== null);
  const crumb = await page.$eval('mat-screen-status [data-role="crumb"]', (e) =>
    e.textContent.trim(),
  );
  check(
    'thanh trạng thái hiện đường dẫn Màn hình › Item',
    crumb.includes('Bồn nước') && crumb.includes('Sơ đồ bồn'),
    crumb,
  );
  await sleep(500);
  await shot('2-da-vao');

  await clickEl(page, UIDS.liquid);
  await waitFor(page, () => document.querySelector('mat-svg-overlay .svo-sel') !== null);
  let boxes = await selBoxes(page);
  check(
    'nhấp phần tử: khung chọn bám phần tử có UID',
    boxes.length === 1 &&
      boxes[0].uid === UIDS.liquid &&
      near(boxes[0], await rectOf(page, UIDS.liquid)),
    JSON.stringify(boxes),
  );
  const crumb2 = await page.$eval('mat-screen-status [data-role="crumb"]', (e) =>
    e.textContent.trim(),
  );
  check('đường dẫn thêm tên phần tử đang chọn', crumb2.includes('Nước'), crumb2);
  await shot('3-chon-phan-tu');

  // Khung chọn bám theo zoom (phím + khi canvas có focus).
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('=');
  await sleep(300);
  boxes = await selBoxes(page);
  check(
    'phóng to: khung chọn vẫn bám phần tử',
    boxes.length === 1 && near(boxes[0], await rectOf(page, UIDS.liquid)),
    JSON.stringify([boxes[0], await rectOf(page, UIDS.liquid)]),
  );
  await page.keyboard.press('-');
  await sleep(300);

  // Shift+nhấp thêm phần tử; Alt+nhấp chọn cha.
  await clickEl(page, UIDS.value);
  await page.keyboard.down('Shift');
  await clickEl(page, UIDS.lamp);
  await page.keyboard.up('Shift');
  await sleep(200);
  boxes = await selBoxes(page);
  check(
    'Shift+nhấp: thêm phần tử vào vùng chọn',
    boxes.map((b) => b.uid).join() === `${UIDS.value},${UIDS.lamp}`,
    boxes.map((b) => b.uid).join(),
  );
  await clickEl(page, UIDS.liquid);
  await sleep(150);
  await page.keyboard.down('Alt');
  await clickEl(page, UIDS.liquid);
  await page.keyboard.up('Alt');
  await sleep(200);
  boxes = await selBoxes(page);
  check(
    'Alt+nhấp: chọn phần tử cha (nhóm Bồn)',
    boxes.length === 1 && boxes[0].uid === UIDS.tank,
    boxes.map((b) => b.uid).join(),
  );

  // ---------- T071: cây phần tử ----------
  const tab = await page.$eval('mat-shell #dt-tab-elements', (e) =>
    e.getAttribute('aria-selected'),
  );
  check('vào item: tab Phần tử của Details mở sẵn', tab === 'true', tab);
  const tree = await page.$eval('mat-svg-tree [role="tree"]', (e) => ({
    items: e.querySelectorAll('[role="treeitem"]').length,
    level1: e.querySelectorAll('[role="treeitem"][aria-level="1"]').length,
  }));
  check(
    'cây phần tử: role=tree có treeitem, cấp trên cùng đủ 7 phần tử',
    tree.items >= 7 && tree.level1 === 7,
    JSON.stringify(tree),
  );
  const selRow = await page.$eval('mat-svg-tree [aria-selected="true"]', (e) => e.dataset.uid);
  check('chọn trên canvas đồng bộ sang cây', selRow === UIDS.tank, selRow);
  // Nhấp dòng cây chọn phần tử trên canvas.
  await page.click(`mat-svg-tree [data-uid="${UIDS.value}"]`);
  await sleep(200);
  boxes = await selBoxes(page);
  check(
    'nhấp dòng của cây: canvas chọn phần tử đó',
    boxes.length === 1 &&
      boxes[0].uid === UIDS.value &&
      near(boxes[0], await rectOf(page, UIDS.value)),
    JSON.stringify(boxes),
  );
  // Gập bằng phím ←, mở lại bằng →; → lần nữa vào con đầu, ↓ sang con kế.
  await page.click(`mat-svg-tree [data-uid="${UIDS.tank}"]`);
  await page.keyboard.press('ArrowLeft');
  await sleep(150);
  const folded = await page.$$eval(
    'mat-svg-tree [role="treeitem"][aria-level="2"]',
    (e) => e.length,
  );
  check('phím ←: gập nhóm (con biến mất khỏi cây)', folded === 0, folded);
  await page.keyboard.press('ArrowRight');
  await sleep(150);
  const kids = await page.$$eval(`mat-svg-tree [role="treeitem"][aria-level="2"]`, (e) =>
    e.map((x) => x.dataset.uid).join(),
  );
  check('phím →: mở nhóm, hiện hai phần tử con', kids === `${UIDS.shell},${UIDS.liquid}`, kids);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await sleep(150);
  boxes = await selBoxes(page);
  check(
    'phím ↓ trong cây: chọn phần tử kế (đồng bộ canvas)',
    boxes.length === 1 && boxes[0].uid === UIDS.liquid,
    boxes.map((b) => b.uid).join(),
  );
  // Lọc theo tên không dấu.
  await page.type('mat-svg-tree .filt input', 'bon');
  await sleep(150);
  const filtered = await page.$$eval('mat-svg-tree [role="treeitem"]', (e) =>
    e.map((x) => x.dataset.uid).join(),
  );
  check(
    'lọc "bon" (không dấu): Bồn và Vỏ bồn',
    filtered === `${UIDS.tank},${UIDS.shell}`,
    filtered,
  );
  await page.$eval('mat-svg-tree .filt input', (e) => {
    e.value = '';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(100);
  await shot('4-cay-phan-tu');
  await axeBoth(page, axe, 'vào item, canvas, cây phần tử');

  // Esc thoát item.
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc: thoát item', !(await entered(page)));
  const tab2 = await page.$('mat-shell #dt-tab-elements');
  check('thoát item: tab Phần tử biến mất', tab2 === null);
}
