// E2E Project mới (2026-10-20): tab Bắt đầu khi chưa mở project có hai nút lớn và danh sách gần đây; Ctrl+N mở hộp thoại
// Project mới, gõ tên thì mã tự sinh, tạo từ mẫu Trống thì cây đầy đủ và màn hình lưới Tổng quan mở sẵn (3 ô trống); tạo lần
// hai từ bảng lệnh với mẫu Trạm bơm, chủ đề Tối; trùng thư mục thì báo ngay. axe 0 critical/serious ở hai theme. Lớp Tauri
// giả, Chrome headless. Ảnh chụp: tests/e2e/out/new-project-*.png.
import { axeBoth, press, runCommand, setTheme, sleep, text, waitFor } from './util.mjs';

const treeLabels = (page) =>
  page.$$eval('mat-tree [role="treeitem"] .lbl', (e) => e.map((x) => x.textContent.trim()));

async function typeName(page, value) {
  await page.click('mat-new-project-dialog #np-name');
  await page.$eval('mat-new-project-dialog #np-name', (i) => i.select());
  await page.keyboard.type(value);
  await sleep(150);
}

export default async function newProject({ page, check, shot, axe }) {
  await setTheme(page, 'light');
  await page.waitForSelector('mat-start-page .start-actions');
  const actions = await page.$$eval('mat-start-page .start-action', (e) =>
    e.map((b) => b.dataset.cmd),
  );
  check(
    'tab Bắt đầu chưa mở project: hai nút lớn Tạo project mới, Mở project…',
    actions.join() === 'project.new,project.open',
    actions.join(),
  );
  check(
    'tab Bắt đầu: danh sách gần đây ngay dưới',
    (await page.$$eval('mat-start-page .list .li', (e) => e.length)) === 2,
  );
  await shot('1-bat-dau');
  await axeBoth(page, axe, 'tab Bắt đầu chưa mở project');

  // ---- Ctrl+N, mẫu Trống ----
  await press(page, 'Control+n');
  await page.waitForSelector('mat-new-project-dialog [role="dialog"]');
  await waitFor(page, () =>
    /mAT SCADA/.test(
      document.querySelector('mat-new-project-dialog .np-parent')?.textContent ?? '',
    ),
  );
  check(
    'Ctrl+N: hộp thoại Project mới, focus ô tên',
    await page.evaluate(() => document.activeElement?.id === 'np-name'),
  );
  await page.keyboard.type('Trạm bơm Số 1');
  await sleep(150);
  const id = await page.$eval('mat-new-project-dialog #np-id', (i) => i.value);
  check('mã tự sinh không dấu từ tên', id === 'tram-bom-so-1', id);
  await waitFor(page, () =>
    /sẽ được tạo/.test(
      document.querySelector('mat-new-project-dialog .np-target')?.textContent ?? '',
    ),
  );
  const target = await text(page, 'mat-new-project-dialog .np-target .np-path');
  check('đích là <thư mục chứa>\\<mã>', /mAT SCADA\\tram-bom-so-1$/.test(target ?? ''), target);
  await shot('2-hop-thoai');
  await axeBoth(page, axe, 'hộp thoại Project mới');

  await page.click('mat-new-project-dialog [data-role="ok"]');
  await page.waitForSelector('mat-new-project-dialog [role="dialog"]', { hidden: true });
  await page.waitForSelector('mat-tree [role="treeitem"]');
  await page.waitForSelector('mat-grid-editor .ge-cell');
  await sleep(400);
  const labels = await treeLabels(page);
  check('cây có tên project mới', labels.includes('Trạm bơm Số 1'), labels.slice(0, 6).join(' | '));
  const cells = await page.$$eval('mat-grid-editor .ge-cell', (e) => e.length);
  const empty = await page.$$eval('mat-grid-editor .ge-cell.empty', (e) => e.length);
  check(
    'màn hình lưới Tổng quan mở sẵn: một hàng 3 ô trống',
    cells === 3 && empty === 3,
    `${cells}/${empty}`,
  );
  const created = await page.evaluate(() => window.__matMock.created.map((c) => c.files.join(',')));
  check(
    'ghi đúng bộ file của mẫu Trống',
    created[0] === 'project.json,screens/tong-quan.screen.json,tags.json',
    created.join(' ; '),
  );
  const status = await text(page, 'mat-statusbar');
  check('kiểm tra: 0 lỗi', !/\d+ lỗi/.test(status ?? '') || /\b0 lỗi/.test(status ?? ''), status);
  await shot('3-da-tao');
  await axeBoth(page, axe, 'project mới vừa tạo, màn hình lưới');

  // ---- bảng lệnh, mẫu Trạm bơm, chủ đề Tối; trùng thư mục thì báo ----
  await runCommand(page, 'Project mới');
  await page.waitForSelector('mat-new-project-dialog [role="dialog"]');
  await waitFor(page, () => Boolean(document.querySelector('mat-new-project-dialog .np-parent')));
  await typeName(page, 'Trạm bơm Số 1');
  await waitFor(page, () =>
    Boolean(document.querySelector('mat-new-project-dialog .np-target.bad')),
  );
  check(
    'trùng thư mục đã có project: báo ngay',
    /đã có project/.test((await text(page, 'mat-new-project-dialog .np-target')) ?? ''),
  );
  await typeName(page, 'Trạm A');
  await page.click('mat-new-project-dialog .np-card[data-template="pump"]');
  await page.click('mat-new-project-dialog .np-theme[data-theme="dark"]');
  await sleep(100);
  await shot('4-mau-tram-bom');
  await page.click('mat-new-project-dialog [data-role="ok"]');
  await page.waitForSelector('mat-new-project-dialog [role="dialog"]', { hidden: true });
  await waitFor(page, () =>
    [...document.querySelectorAll('mat-tree [role="treeitem"] .lbl')].some(
      (e) => e.textContent.trim() === 'Trạm A',
    ),
  );
  await page.waitForSelector('mat-grid-editor .ge-cell');
  const project = await page.evaluate(() => JSON.parse(window.__matMock.fileText('project.json')));
  check(
    'mẫu Trạm bơm: mã, tên, chủ đề Tối',
    project.projectId === 'tram-a' && project.projectName === 'Trạm A' && project.theme === 'dark',
    JSON.stringify({ id: project.projectId, theme: project.theme }),
  );
  check(
    'mẫu Trạm bơm: màn hình đầu là lưới',
    (await page.$$eval('mat-grid-editor .ge-cell', (e) => e.length)) > 3,
  );
  await shot('5-tram-bom');
}
