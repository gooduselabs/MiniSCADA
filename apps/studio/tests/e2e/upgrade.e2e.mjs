// E2E nâng cấp project 0.1 đến 0.5 → 0.6 và cây project (feature 006, T091, FR-003, FR-004, FR-005, FR-043, R3), lớp Tauri giả:
// - mở tank-demo 0.1 → hộp thoại Nâng cấp / Mở chỉ đọc / Hủy kèm các thay đổi và nơi giữ bản sao lưu; axe hai theme;
// - Nâng cấp rồi Ctrl+S → có thư mục sao lưu (lớp giả) trước khi ghi, project ghi ở định dạng 0.2;
// - Mở chỉ đọc → mọi lệnh sửa khóa kèm lý do, Bảng Tag không nhận chữ;
// - project 0.7.0 → từ chối, nêu phiên bản Studio cần, không ghi gì;
// - cây theo FR-043: Kết nối, Tag, Bảng giá trị, Bảng theo dõi, Chẩn đoán driver; thêm, đổi tên, nhân bản, xóa bằng phím
//   (Insert, F2, Ctrl+Shift+D, Delete) và bằng menu chuột phải;
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import {
  FULL_02,
  TANK_DEMO,
  axeBoth,
  clickButton,
  readProject,
  setTheme,
  sleep,
  text,
  treeNode,
  waitFor,
} from './util.mjs';

/** Kịch bản này cần cổng phiên bản bật (các kịch bản khác chạy với `?gate=off`). */
export const gate = true;

const UP = 'mat-upgrade-dialog';
const dialogOpen = (page, tag) => page.$(`${tag} [role="dialog"]`).then(Boolean);
const treeLabels = (page) =>
  page.$$eval('mat-tree [role="treeitem"] .lbl', (els) => els.map((e) => e.textContent.trim()));
const matMock = (page, fn) => page.evaluate(fn);

async function openDefault(page) {
  await page.waitForSelector('mat-start-page .start-hero');
  await page.$eval('mat-start-page .start-hero .btn.primary', (b) => b.click());
}

export default async function upgrade({ page, url, check, shot, axe }) {
  await setTheme(page, 'light');

  // ---------- 1. Hộp thoại Nâng cấp ----------
  await openDefault(page);
  await page.waitForSelector(`${UP} [role="dialog"]`);
  const body = await text(page, `${UP} .dlg-b`);
  check(
    'mở tank-demo 0.1: hộp thoại Nâng cấp nêu thay đổi và nơi giữ bản sao lưu',
    /định dạng 0\.1/i.test((await text(page, `${UP} .dlg-h`)) ?? '') &&
      /\.mat-backup/.test(body ?? '') &&
      /legacy|mô phỏng/i.test(body ?? ''),
    body?.slice(0, 160),
  );
  const buttons = await page.$$eval(`${UP} .dlg-f button`, (bs) =>
    bs.map((b) => b.textContent.trim()),
  );
  check(
    'ba nút: Hủy, Mở chỉ đọc, Nâng cấp',
    ['Hủy', 'Mở chỉ đọc', 'Nâng cấp'].every((l) => buttons.some((b) => b.includes(l))),
    buttons.join(' | '),
  );
  const writesBefore = await matMock(page, () => window.__matMock.writes.length);
  await shot('1-hop-thoai-nang-cap');
  await axeBoth(page, axe, 'hộp thoại Nâng cấp');

  // ---------- 2. Nâng cấp rồi lưu: có sao lưu trước khi ghi ----------
  await clickButton(page, `${UP} .dlg-f`, 'Nâng cấp');
  await waitFor(page, (tag) => !document.querySelector(`${tag} [role="dialog"]`), UP);
  check(
    'Nâng cấp: đĩa chưa đổi tới khi lưu',
    (await matMock(page, () => window.__matMock.writes.length)) === writesBefore,
  );
  const labels = await treeLabels(page);
  check(
    'cây 0.2: Kết nối, Tag, Bảng giá trị, Bảng theo dõi, Chẩn đoán driver',
    ['Kết nối', 'Bảng giá trị', 'Bảng theo dõi', 'Chẩn đoán driver'].every((l) =>
      labels.includes(l),
    ),
    labels.join(' | '),
  );
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyS');
  await page.keyboard.up('Control');
  await waitFor(page, () => window.__matMock.writes.length > 0);
  const saved = await matMock(page, () => ({
    backups: window.__matMock.backups.map((b) => ({ dir: b.dir, files: b.files })),
    writes: window.__matMock.writes.map((w) => w.rel),
    project: window.__matMock.writes.find((w) => w.rel === 'project.json')?.content ?? '',
  }));
  check(
    'lưu lần đầu: có bản sao lưu (project.json, tags.json…) rồi mới ghi 0.6 (0.1 nâng thẳng lên 0.6)',
    saved.backups.length === 1 &&
      saved.backups[0].files.includes('project.json') &&
      saved.writes.includes('project.json') &&
      /"schemaVersion": "0.6.0"/.test(saved.project),
    JSON.stringify(saved.backups),
  );
  const toast = await text(page, 'mat-toast .toast');
  check('thông báo nêu thư mục sao lưu', /\.mat-backup/.test(toast ?? ''), toast);
  await shot('2-sau-khi-nang-cap');

  // ---------- 3. Cây FR-043: phím và menu chuột phải ----------
  await treeNode(page, 'watchTables');
  await page.focus('mat-tree');
  await page.keyboard.press('Insert');
  await waitFor(page, () => !!document.querySelector('mat-tree [id^="ti-watch:"]'));
  const added = await page.$$eval('mat-tree [id^="ti-watch:"] .lbl', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  check(
    'Insert trên Bảng theo dõi: thêm bảng mới',
    added.length === 1 && /Bảng theo dõi 1/.test(added[0]),
    added.join('|'),
  );
  await page.keyboard.press('F2');
  await page.waitForSelector('mat-rename-dialog [role="dialog"]');
  await page.$eval('mat-rename-dialog input[name="name"]', (i) => i.select());
  await page.keyboard.type('Vận hành ca 1');
  await page.keyboard.press('Enter');
  await waitFor(page, () =>
    [...document.querySelectorAll('mat-tree [id^="ti-watch:"] .lbl')].some(
      (e) => e.textContent.trim() === 'Vận hành ca 1',
    ),
  );
  check('F2: đổi tên qua hộp thoại, Enter xác nhận', true);
  await page.focus('mat-tree');
  await page.keyboard.down('Control');
  await page.keyboard.down('Shift');
  await page.keyboard.press('KeyD');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await waitFor(page, () => document.querySelectorAll('mat-tree [id^="ti-watch:"]').length === 2);
  check('Ctrl+Shift+D: nhân bản bảng', true);
  await page.keyboard.press('Delete');
  await waitFor(page, () => document.querySelectorAll('mat-tree [id^="ti-watch:"]').length === 1);
  check('Delete: xóa bảng đang chọn', true);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Control');
  await waitFor(page, () => document.querySelectorAll('mat-tree [id^="ti-watch:"]').length === 2);
  check('Ctrl+Z: trả lại bảng vừa xóa', true);
  // Menu chuột phải
  await page.evaluate(() => {
    const el = document.querySelector('mat-tree [id^="ti-watch:"]');
    el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 90, clientY: 140 }),
    );
  });
  await page.waitForSelector('.tree-ctx [role="menu"]');
  const items = await page.$$eval('.tree-ctx [role="menuitem"]', (b) =>
    b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  );
  check(
    'menu chuột phải: Thêm, Đổi tên, Nhân bản, Xóa kèm phím tắt (project 0.5 thêm Tạo alarm cho Tag…)',
    items.length === 5 &&
      /Insert/.test(items[0]) &&
      /F2/.test(items[1]) &&
      /Ctrl\+Shift\+D/.test(items[2]) &&
      /Delete/.test(items[3]) &&
      /Tạo alarm cho Tag/.test(items[4]),
    items.join(' | '),
  );
  await axeBoth(page, axe, 'cây với menu chuột phải');
  await page.keyboard.press('Escape');
  await waitFor(page, () => !document.querySelector('.tree-ctx [role="menu"]'));
  await shot('3-cay');

  // ---------- 4. Mở chỉ đọc ----------
  await page.goto(url, { waitUntil: 'networkidle0' });
  await openDefault(page);
  await page.waitForSelector(`${UP} [role="dialog"]`);
  await clickButton(page, `${UP} .dlg-f`, 'Mở chỉ đọc');
  await waitFor(page, (tag) => !document.querySelector(`${tag} [role="dialog"]`), UP);
  const w0 = await matMock(page, () => window.__matMock.writes.length);
  await treeNode(page, 'tags');
  await page.waitForSelector('mat-tag-grid [role="gridcell"]');
  const bannerText = await text(page, 'mat-tag-grid .banner');
  check('Mở chỉ đọc: Bảng Tag hiện biểu ngữ chỉ đọc', /chỉ đọc/.test(bannerText ?? ''), bannerText);
  const addLocked = await page.$eval(
    'mat-tag-grid [data-act="add"]',
    (b) => b.getAttribute('aria-disabled') + '|' + b.title,
  );
  check(
    'nút Thêm Tag khóa kèm lý do',
    addLocked.startsWith('true') && /chỉ đọc/.test(addLocked),
    addLocked,
  );
  await page.click('mat-tag-grid [role="gridcell"][data-r="0"][data-c="description"]');
  await page.keyboard.type('không được sửa');
  await page.keyboard.press('Enter');
  const desc = await page.$eval(
    'mat-tag-grid [role="gridcell"][data-r="0"][data-c="description"]',
    (e) => e.textContent.trim(),
  );
  check('gõ vào ô khi chỉ đọc: không đổi', !/không được sửa/.test(desc), desc);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyS');
  await page.keyboard.up('Control');
  await sleep(200);
  check(
    'chỉ đọc: Ctrl+S không ghi gì',
    (await matMock(page, () => window.__matMock.writes.length)) === w0,
  );
  await axeBoth(page, axe, 'Bảng Tag chỉ đọc');

  // ---------- 5. Project mới hơn mức hiểu ----------
  await page.goto(url, { waitUntil: 'networkidle0' });
  const files = readProject(TANK_DEMO);
  const project = JSON.parse(files['project.json']);
  project.schemaVersion = '0.7.0';
  files['project.json'] = JSON.stringify(project, null, 2) + '\n';
  await page.waitForSelector('mat-start-page .start-hero');
  await page.evaluate((f) => window.__matMock.useProject(f, 'D:\\Projects\\moi-hon'), files);
  await page.$eval('mat-start-page .start-hero .btn.primary', (b) => b.click());
  await page.waitForSelector(`${UP} [role="dialog"]`);
  const refused = await text(page, `${UP} .dlg-b`);
  check(
    'project 0.7.0: từ chối, nêu phiên bản Studio cần',
    /0\.5/.test(refused ?? '') && /mới hơn|Studio/.test(refused ?? ''),
    refused,
  );
  await axeBoth(page, axe, 'hộp thoại từ chối project mới hơn');
  const w1 = await matMock(page, () => window.__matMock.writes.length);
  await clickButton(page, `${UP} .dlg-f`, 'Đóng');
  await sleep(150);
  check(
    'không ghi gì khi từ chối',
    (await matMock(page, () => window.__matMock.writes.length)) === w1 &&
      !(await dialogOpen(page, UP)),
  );

  // ---------- 6. Project 0.2 → 0.3 (feature 007, T108) ----------
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('mat-start-page .start-hero');
  await page.evaluate(
    (f) => window.__matMock.useProject(f, 'D:\\Projects\\hai-chin'),
    readProject(FULL_02),
  );
  await page.$eval('mat-start-page .start-hero .btn.primary', (b) => b.click());
  await page.waitForSelector(`${UP} [role="dialog"]`);
  await waitFor(page, (tag) => document.querySelectorAll(`${tag} .ud-changes li`).length > 0, UP);
  const body02 = await text(page, `${UP} .dlg-b`);
  check(
    'mở project 0.2: hộp thoại Nâng cấp lên 0.3 nêu việc chuyển màn hình sang nhiều mục',
    /0.2/.test(body02 ?? '') && /nhiều mục/.test(body02 ?? ''),
    body02?.slice(0, 200),
  );
  await shot('6-nang-cap-02');
  await axeBoth(page, axe, 'hộp thoại Nâng cấp 0.2');
  await clickButton(page, `${UP} .dlg-f`, 'Nâng cấp');
  await waitFor(page, (tag) => !document.querySelector(`${tag} [role="dialog"]`), UP);
  const labels03 = await treeLabels(page);
  check(
    'sau nâng cấp 0.3: cây có mục Điều hướng và màn hình',
    labels03.includes('Điều hướng'),
    labels03.join(' | '),
  );
  await page.$eval('mat-tree [id^="ti-screen:"]', (e) => e.click());
  await page.waitForSelector('mat-screen-canvas .vp');
  await sleep(500);
  check(
    'màn hình 0.2 mở trong trình bố trí: item svg có trên canvas',
    (await page.$$('mat-screen-canvas .oi')).length >= 1,
  );
  await shot('7-man-hinh-sau-nang-cap');
}
