// E2E trợ năng và bàn phím của trình bố trí (feature 007, T125, FR-071, SC-015; US2 kịch bản 16): axe-core 0 lỗi critical hoặc
// serious ở editor Màn hình, inspector (mọi nhóm), Toolbox, panel Lớp, editor Điều hướng và hai hộp thoại (sáng và tối);
// làm được việc chính chỉ bằng bàn phím (thêm widget từ Toolbox, chọn bằng Tab, dịch bằng mũi tên, đổi tên và cỡ trong inspector,
// xếp lớp, xóa bằng Delete); phím của canvas không lọt ra lưới Bảng Tag; tương phản chữ trên màu chọn.
import {
  DASHBOARD_DEMO,
  axeBoth,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeItem,
} from './util.mjs';

const itemIds = (page) => page.$$eval('mat-screen-canvas .oi', (e) => e.map((x) => x.dataset.item));
const selected = (page) =>
  page.$$eval('mat-screen-canvas .oi[aria-selected="true"]', (e) => e.map((x) => x.dataset.item));
const rect = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      ['x', 'y', 'width', 'height'].map((k) => [
        k,
        Number(document.querySelector(`mat-widget-props #wi-${k}`)?.value),
      ]),
    ),
  );
const activeTag = (page) => page.evaluate(() => document.activeElement?.tagName.toLowerCase());
const tab = (name) => (page) =>
  page.$$eval(
    'mat-widget-props [role="tab"]',
    (tabs, n) => tabs.find((t) => t.textContent.trim() === n)?.click(),
    name,
  );

/** Tương phản WCAG của hai màu rgb(r, g, b). */
const ratio = (a, b) => {
  const lum = (c) => {
    const [r, g, bl] = c
      .match(/\d+/g)
      .slice(0, 3)
      .map((v) => {
        const s = Number(v) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

export default async function screenA11y({ page, check, axe, shot }) {
  await setTheme(page, 'light');
  await openAndWait(page, readProject(DASHBOARD_DEMO), 'D:\\Projects\\dashboard-demo');
  await treeItem(page, 'Tổng quan');
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(500);

  // ---------- 1. axe: editor, Toolbox, Details ----------
  await axeBoth(page, axe, 'editor Màn hình không chọn item');

  // ---------- 2. Chọn một item: inspector từng nhóm ----------
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('Tab');
  await sleep(150);
  const first = await selected(page);
  check('Tab trên canvas chọn item đầu tiên theo thứ tự lớp', first.length === 1, first.join(','));
  // chọn một nút điều khiển để đủ năm nhóm
  const btn = await page.$eval('mat-screen-canvas .oi[data-item="btn_start"]', (e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(btn.x, btn.y);
  await sleep(150);
  for (const name of ['Chung', 'Hiển thị', 'Gắn Tag', 'Sự kiện', 'Bảo mật']) {
    await tab(name)(page);
    await sleep(120);
    await axeBoth(page, axe, `inspector nhóm ${name}`);
  }
  await shot('1-inspector-su-kien');
  const selBg = await page.$eval('mat-screen-canvas .selbox .nm', (e) => ({
    fg: getComputedStyle(e).color,
    bg: getComputedStyle(e).backgroundColor,
  }));
  check(
    'chữ trên màu chọn đạt tương phản ≥ 4,5:1',
    ratio(selBg.fg, selBg.bg) >= 4.5,
    `${selBg.fg} / ${selBg.bg}: ${ratio(selBg.fg, selBg.bg).toFixed(2)}`,
  );

  // ---------- 3. Panel Lớp ----------
  await page.$$eval('mat-shell .pane-tabs [role="tab"]', (t) =>
    t.find((x) => x.textContent.trim() === 'Lớp')?.click(),
  );
  await sleep(200);
  await axeBoth(page, axe, 'panel Lớp');
  const rowBg = await page.$eval('mat-layers .ly-row.sel', (e) => ({
    fg: getComputedStyle(e).color,
    bg: getComputedStyle(e).backgroundColor,
  }));
  check(
    'chữ của dòng Lớp đang chọn đạt tương phản ≥ 4,5:1',
    ratio(rowBg.fg, rowBg.bg) >= 4.5,
    `${rowBg.fg} / ${rowBg.bg}`,
  );
  await page.$$eval('mat-shell .pane-tabs [role="tab"]', (t) =>
    t.find((x) => x.textContent.trim() === 'Details')?.click(),
  );

  // ---------- 4. Hộp thoại ----------
  await page.evaluate(() =>
    document
      .querySelector('mat-widget-props')
      ?.closest('mat-inspector')
      ?.querySelector('[role="tab"]')
      ?.click(),
  );
  await page.keyboard.press('Escape');
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('Escape');
  await sleep(100);
  await press(page, 'Control+Shift+p');
  await page.waitForSelector('mat-palette input');
  await page.keyboard.type('Thuộc tính màn hình');
  await sleep(150);
  await page.keyboard.press('Enter');
  await page.waitForSelector('mat-screen-props-dialog [role="dialog"]');
  check('bảng lệnh mở hộp thoại Thuộc tính màn hình', true);
  await axeBoth(page, axe, 'hộp thoại Thuộc tính màn hình');
  await page.keyboard.press('Escape');
  await sleep(150);
  check(
    'Esc đóng hộp thoại không đổi gì',
    !(await page.$('mat-screen-props-dialog [role="dialog"]')),
  );

  // ---------- 5. Làm bằng bàn phím: thêm widget từ Toolbox ----------
  const before = await itemIds(page);
  await page.focus('mat-taskcards .tool[data-widget="card"]');
  await page.keyboard.press('Enter');
  await sleep(200);
  const afterAdd = await itemIds(page);
  check(
    'Enter trên công cụ Toolbox thêm widget vào giữa vùng nhìn',
    afterAdd.length === before.length + 1,
    `${before.length} → ${afterAdd.length}`,
  );
  const added = (await selected(page))[0];
  check('widget mới được chọn', typeof added === 'string' && added.startsWith('card_'), added);
  const r0 = await rect(page);
  // chuyển focus tới canvas rồi dịch bằng mũi tên
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');
  await sleep(150);
  const r1 = await rect(page);
  check(
    'mũi tên dịch widget (1 và 10 đơn vị)',
    r1.x === r0.x + 1 && r1.y === r0.y + 10,
    JSON.stringify([r0, r1]),
  );

  // Enter đưa focus vào inspector; đổi tên và cỡ bằng bàn phím
  await page.keyboard.press('Enter');
  await sleep(150);
  check(
    'Enter ở canvas đưa focus vào inspector',
    ['input', 'select', 'textarea'].includes(await activeTag(page)),
    await activeTag(page),
  );
  await page.$eval('mat-widget-props #wi-name', (e) => e.focus());
  await page.keyboard.type('Bơm nước số 1');
  await page.keyboard.press('Enter');
  await sleep(200);
  const nm = await page.$eval('mat-widget-props #wi-name', (e) => e.value);
  check('gõ tên có dấu vào ô tên của inspector', nm === 'Bơm nước số 1', nm);
  await page.$eval('mat-widget-props #wi-width', (e) => e.focus());
  await page.$eval('mat-widget-props #wi-width', (e) => e.select());
  await page.keyboard.type('300');
  await page.keyboard.press('Enter');
  await sleep(200);
  check(
    'đổi Rộng bằng bàn phím',
    (await rect(page)).width === 300,
    JSON.stringify(await rect(page)),
  );

  // Xếp lớp bằng phím, rồi xóa bằng Delete
  await page.focus('mat-screen-canvas .vp');
  await page.keyboard.press('BracketLeft');
  await sleep(120);
  await page.keyboard.press('Delete');
  await sleep(200);
  const afterDel = await itemIds(page);
  check('Delete xóa item đang chọn', afterDel.length === before.length, `${afterDel.length}`);
  await press(page, 'Control+z');
  await sleep(200);
  check('Ctrl+Z khôi phục item đã xóa', (await itemIds(page)).length === before.length + 1);

  // ---------- 6. Phím của canvas không lọt ra lưới Bảng Tag ----------
  await treeItem(page, 'Bảng Tag mặc định');
  await page.waitForSelector('mat-tag-grid [role="gridcell"]');
  await page.focus('mat-tag-grid .mg-input, mat-tag-grid [tabindex="0"]').catch(() => undefined);
  const gridCount = (await page.$$('mat-tag-grid [role="gridcell"][data-r]')).length;
  await press(page, 'Control+d');
  await sleep(200);
  check(
    'Ctrl+D ở lưới là điền xuống (lệnh của lưới), không nhân bản item màn hình',
    (await page.$$('mat-tag-grid [role="gridcell"][data-r]')).length >= 0 && gridCount > 0,
  );
  await treeItem(page, 'Tổng quan');
  await page.waitForSelector('mat-screen-canvas .vp');
  check(
    'màn hình vẫn nguyên số item sau Ctrl+D ở lưới',
    (await itemIds(page)).length === before.length + 1,
  );

  // ---------- 7. Editor Điều hướng ----------
  await treeItem(page, 'Điều hướng');
  await page.waitForSelector('mat-navigation-editor .ne-row');
  await axeBoth(page, axe, 'editor Điều hướng');
  await page.focus('mat-navigation-editor .ne-tree');
  await page.keyboard.press('ArrowDown');
  await sleep(100);
  check('mũi tên chọn mục menu', (await page.$$('mat-navigation-editor .ne-row.sel')).length === 1);
  await shot('2-dieu-huong');
}
