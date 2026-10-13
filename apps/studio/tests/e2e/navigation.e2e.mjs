// E2E menu điều hướng, thuộc tính màn hình và xóa màn hình có chỗ trỏ tới (feature 007, T109, T117, T118, FR-065, FR-066):
// - editor Điều hướng: thêm mục và nhóm, đổi nhãn, đổi màn hình đích (chỉ màn hình thường), biểu tượng, vị trí menu, sắp xếp bằng
//   Alt+mũi tên và bằng kéo, xem trước menu, giới hạn nhóm một cấp; mỗi sửa là một bước hoàn tác;
// - hộp thoại Thuộc tính màn hình: cỡ mẫu, chế độ stretch cảnh báo, popup không làm màn hình đầu;
// - xóa màn hình đang được dùng: hộp thoại liệt kê chỗ trỏ (menu, nút, màn hình đầu), Hủy mặc định, chỗ trỏ thành lỗi kiểm tra.
import {
  DASHBOARD_DEMO,
  axeBoth,
  clickButton,
  openAndWait,
  press,
  readProject,
  setTheme,
  sleep,
  treeNode,
  waitFor,
} from './util.mjs';

const rows = (page) =>
  page.$$eval('mat-navigation-editor .ne-row .nm', (e) => e.map((x) => x.textContent.trim()));

export default async function navigation({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await openAndWait(page, readProject(DASHBOARD_DEMO), 'D:\\Projects\\dashboard-demo');

  // ---------- 1. Editor Điều hướng ----------
  await treeNode(page, 'navigation');
  await page.waitForSelector('mat-navigation-editor .ne-row');
  const initial = await rows(page);
  check('menu của dashboard-demo hiện đủ mục và nhóm', initial.length >= 3, initial.join(' | '));
  await page.$eval('mat-navigation-editor [data-act="add-leaf"]', (b) => b.click());
  await sleep(200);
  const added = await rows(page);
  check(
    'Thêm mục: thêm một lá trỏ tới màn hình',
    added.length === initial.length + 1,
    added.join(' | '),
  );
  await page.$eval('#ne-label', (e) => {
    e.focus();
    e.select();
  });
  await page.keyboard.type('Bảng điều khiển phụ');
  await page.keyboard.press('Enter');
  await sleep(200);
  check('đổi nhãn mục', (await rows(page)).includes('Bảng điều khiển phụ'));
  check(
    'màn hình đích chỉ liệt kê màn hình thường (không popup)',
    await page.$$eval('#ne-screen option', (o) => !o.some((x) => /Bơm 1/.test(x.textContent))),
  );

  // vị trí menu và xem trước
  await page.select('#ne-pos', 'top');
  await sleep(200);
  check(
    'vị trí menu: phía trên, xem trước menu theo hàng ngang',
    await page.$eval('mat-navigation-editor .ne-menu', (e) => e.classList.contains('top')),
  );
  await page.select('#ne-pos', 'left');
  await sleep(100);

  // Alt+mũi tên đổi thứ tự
  await page.focus('mat-navigation-editor .ne-tree');
  const beforeOrder = await rows(page);
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.up('Alt');
  await sleep(200);
  const afterOrder = await rows(page);
  check(
    'Alt+↑ đưa mục lên một vị trí',
    afterOrder.join('|') !== beforeOrder.join('|'),
    afterOrder.join(' | '),
  );
  await press(page, 'Control+z');
  await sleep(150);
  check('Ctrl+Z hoàn tác một bước sắp xếp', (await rows(page)).join('|') === beforeOrder.join('|'));

  // kéo bằng chuột: đưa mục cuối lên đầu
  const last = await page.$$eval('mat-navigation-editor .ne-row', (r) => {
    const g = r[r.length - 1].querySelector('.grip').getBoundingClientRect();
    const f = r[0].getBoundingClientRect();
    return { gx: g.x + g.width / 2, gy: g.y + g.height / 2, fx: f.x + 40, fy: f.y + 2 };
  });
  await page.mouse.move(last.gx, last.gy);
  await page.mouse.down();
  await page.mouse.move(last.gx, last.gy - 20, { steps: 4 });
  await page.mouse.move(last.fx, last.fy, { steps: 8 });
  await page.mouse.up();
  await sleep(250);
  const dragged = await rows(page);
  check(
    'kéo mục cuối lên đầu danh sách',
    dragged[0] === beforeOrder[beforeOrder.length - 1],
    dragged.join(' | '),
  );
  await shot('1-dieu-huong');
  await axeBoth(page, axe, 'editor Điều hướng (sau khi sắp xếp)');
  await press(page, 'Control+z');
  await sleep(150);

  // ---------- 2. Thuộc tính màn hình ----------
  await treeNode(page, 'screen:bon-nuoc');
  await page.waitForSelector('mat-screen-canvas .vp');
  await page.evaluate(() =>
    document.querySelector('mat-widget-props [data-act="screen-props"]')?.click(),
  );
  await page.waitForSelector('mat-screen-props-dialog [role="dialog"]');
  await page.select('#spd-preset', '1');
  await page.select('#spd-fit', 'stretch');
  await sleep(150);
  const warn = await page
    .$eval('mat-screen-props-dialog .banner', (e) => e.textContent.replace(/\s+/g, ' ').trim())
    .catch(() => '');
  check('chọn stretch khi màn hình có widget: cảnh báo méo chữ', /méo/.test(warn), warn);
  const size = await page.$eval('#spd-w', (e) => e.value);
  check('cỡ mẫu 1366 × 768 điền vào ô rộng', size === '1366', size);
  await shot('2-thuoc-tinh-man-hinh');
  await clickButton(page, 'mat-screen-props-dialog .dlg-f', 'Áp dụng');
  await waitFor(page, () => !document.querySelector('mat-screen-props-dialog [role="dialog"]'));
  await sleep(200);
  const ctxText = await page.$eval('mat-widget-props', (e) => e.textContent.replace(/\s+/g, ' '));
  check(
    'áp dụng: inspector hiện cỡ mới 1366 × 768',
    /1366 × 768/.test(ctxText),
    ctxText.slice(0, 200),
  );

  // popup không làm màn hình đầu: mở lại hộp thoại của màn hình đầu và đổi thành popup
  await treeNode(page, 'screen:tong-quan');
  await page.waitForSelector('mat-screen-canvas .vp');
  await page.evaluate(() =>
    document.querySelector('mat-widget-props [data-act="screen-props"]')?.click(),
  );
  await page.waitForSelector('mat-screen-props-dialog [role="dialog"]');
  await page.$eval('mat-screen-props-dialog input[value="popup"]', (e) => e.click());
  await sleep(150);
  const entryWarn = await page
    .$eval('mat-screen-props-dialog .field-err', (e) => e.textContent.trim())
    .catch(() => '');
  check(
    'đổi màn hình đầu thành popup: cảnh báo không hợp lệ',
    /màn hình đầu/i.test(entryWarn),
    entryWarn,
  );
  await page.keyboard.press('Escape');
  await sleep(150);

  // ---------- 3. Xóa màn hình đang được dùng ----------
  await treeNode(page, 'screen:bom1');
  await page.focus('mat-tree');
  await page.keyboard.press('Delete');
  await page.waitForSelector('mat-delete-screen-dialog [role="dialog"]');
  const refsText = await page.$eval('mat-delete-screen-dialog .dlg-b', (e) =>
    e.textContent.replace(/\s+/g, ' '),
  );
  check(
    'hộp thoại Xóa liệt kê chỗ trỏ tới màn hình (nút mở popup)',
    /mở popup/.test(refsText),
    refsText.slice(0, 240),
  );
  const focusOk = await page.evaluate(
    () => document.activeElement?.getAttribute('data-role') === 'cancel',
  );
  check('Hủy là nút có focus ban đầu', focusOk);
  await axeBoth(page, axe, 'hộp thoại Xóa màn hình');
  await clickButton(page, 'mat-delete-screen-dialog .dlg-f', 'Xóa màn hình');
  await waitFor(page, () => !document.querySelector('mat-delete-screen-dialog [role="dialog"]'));
  await sleep(900);
  const labels = await page.$$eval('mat-tree [role="treeitem"] .lbl', (e) =>
    e.map((x) => x.textContent.trim()),
  );
  check('xóa: màn hình biến khỏi cây', !labels.includes('Bơm 1'), labels.join(' | '));
  const errors = await page.$eval('mat-statusbar', (e) => e.textContent.replace(/\s+/g, ' '));
  check(
    'chỗ trỏ tới màn hình đã xóa thành lỗi của bước kiểm tra (không tự sửa)',
    !/ 0 lỗi/.test(errors),
    errors.slice(0, 160),
  );
  await press(page, 'Control+z');
  await sleep(900);
  const back = await page.$$eval('mat-tree [role="treeitem"] .lbl', (e) =>
    e.map((x) => x.textContent.trim()),
  );
  check('Ctrl+Z khôi phục màn hình đã xóa', back.includes('Bơm 1'), back.join(' | '));
}
