// E2E Bảng theo dõi có ghi (feature 006, T155, US2, FR-050, FR-040, FR-039, quickstart §5 bước 8–11), lớp Tauri giả:
// - Offline: lệnh Ghi khóa kèm lý do; engineer (từ operator trở lên) ghi TANK01.SP = 75: hộp xác nhận liệt kê Tag, thiết bị
//   trường, giới hạn 0–90; Enter không ghi; bấm Ghi → ACCEPTED rồi CONFIRMED ≤ 2 s, giá trị sống đổi;
// - 95 ngoài giới hạn 0–90 và "12,5": dòng bị khóa kèm lý do, không gửi; NO_READBACK; mất mạng sau khi gửi → hỏi lại theo mã,
//   thiết bị chỉ nhận MỘT lệnh; phiên hết hạn → đăng nhập lại, không tự gửi lại;
// - viewer: lệnh Ghi khóa kèm lý do; administrator: Audit lọc theo Tag với kênh, thiết bị trường, giá trị cũ và mới;
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import {
  FULL_02,
  axeBoth,
  clickButton,
  clickCell,
  expandNode,
  goOnline,
  gridCell,
  openAndWait,
  press,
  readProject,
  sleep,
  text,
  typeInto,
  treeNode,
  waitFor,
} from './util.mjs';

const WT = 'mat-watch-table-editor';
const WC = 'mat-write-confirm-dialog';
const result = (r) => `${WT} [role="gridcell"][data-r="${r}"][data-c="result"]`;
const writeLog = (page) => page.evaluate(() => window.__matMock.device.writeLog('BL335-01'));
const dialogOpen = (page) => page.$(`${WC} [role="dialog"]`).then(Boolean);

async function openMenuItem(page, label) {
  await page.click('mat-menubar .menubar-btn:nth-child(4)');
  await page.waitForSelector('.menu-pop [role="menuitem"]');
  const ok = await page.evaluate((l) => {
    const item = [...document.querySelectorAll('.menu-pop [role="menuitem"]')].find((e) =>
      e.textContent.includes(l),
    );
    item?.click();
    return Boolean(item);
  }, label);
  if (!ok) throw new Error(`không thấy mục menu "${label}"`);
}

async function selectRow(page, r) {
  await clickCell(page, WT, r, 'tag');
}

async function setWriteValue(page, r, value) {
  await clickCell(page, WT, r, 'writeValue');
  await page.keyboard.press('F2');
  await press(page, 'Control+a');
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

async function openWriteDialog(page, all = false) {
  await page.click(`${WT} [data-act="${all ? 'writeAll' : 'write'}"]`);
  await page.waitForSelector(`${WC} [role="dialog"]`);
  await sleep(60);
}

async function confirmWrite(page) {
  await page.click(`${WC} [data-role="confirm"]`);
  await waitFor(page, () => !document.querySelector('mat-write-confirm-dialog [role="dialog"]'));
}

async function cancelDialog(page) {
  await page.keyboard.press('Escape');
  await waitFor(page, () => !document.querySelector('mat-write-confirm-dialog [role="dialog"]'));
}

export default async function watch({ page, check, shot, axe }) {
  const files = readProject(FULL_02);
  await openAndWait(page, files, 'D:\\Projects\\full-02');
  await expandNode(page, 'watchTables');
  await treeNode(page, 'watch:van-hanh');
  await page.waitForSelector(`${WT} [role="gridcell"]`);

  // ---------- 1. Offline: Ghi khóa ----------
  const off = await page.$eval(
    `${WT} [data-act="writeAll"]`,
    (b) => b.getAttribute('aria-disabled') + '|' + b.title,
  );
  check(
    'Offline: Ghi tất cả khóa kèm lý do Online',
    off.startsWith('true') && /Online/.test(off),
    off,
  );

  // ---------- 2. Online (engineer): ghi TANK01.SP = 75 ----------
  const pwEng = await goOnline(page, 'kysu1', files);
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-watch-table-editor [data-act="writeAll"]')
        ?.getAttribute('aria-disabled') === null,
  );
  await waitFor(page, () =>
    /GOOD|BAD|UNCERTAIN/.test(
      document.querySelector('mat-watch-table-editor [role="gridcell"][data-c="quality"]')
        ?.textContent ?? '',
    ),
  );
  await selectRow(page, 0);
  await openWriteDialog(page);
  const row = await text(page, `${WC} tr[data-tag="TANK01.SP"]`);
  check(
    'hộp xác nhận: Tag, thiết bị trường, giá trị mới 75, giới hạn 0 đến 90',
    /plc1 · HR200/.test(row ?? '') && /75/.test(row ?? '') && /0 đến 90/.test(row ?? ''),
    row,
  );
  const focus = await page.evaluate(() => document.activeElement?.getAttribute('data-role'));
  check('focus ban đầu ở nút Hủy (ghi phải là việc chủ động)', focus === 'cancel', focus);
  // Enter khi focus ở Hủy chỉ hủy (không ghi); mở lại hộp thoại để xác nhận thật.
  await page.keyboard.press('Enter');
  await sleep(300);
  check('Enter (focus ở Hủy) không ghi: 0 lệnh tới thiết bị', (await writeLog(page)).length === 0);
  if (!(await dialogOpen(page))) await openWriteDialog(page);
  await shot('1-xac-nhan-ghi');
  await axeBoth(page, axe, 'hộp thoại Xác nhận ghi');
  const t0 = Date.now();
  await confirmWrite(page);
  await waitFor(
    page,
    (sel) => /Đã xác nhận/.test(document.querySelector(sel)?.textContent ?? ''),
    result(0),
    4000,
  );
  const ms = Date.now() - t0;
  const res0 = await text(page, result(0));
  check(
    `ACCEPTED rồi CONFIRMED ≤ 2 s (đo ${ms} ms)`,
    ms <= 2000 && /đọc lại 75/.test(res0 ?? ''),
    res0,
  );
  const log = await writeLog(page);
  check(
    'thiết bị nhận đúng 1 lệnh TANK01.SP = 75',
    log.length === 1 && log[0].tag === 'TANK01.SP' && log[0].value === 75,
    JSON.stringify(log),
  );
  await waitFor(
    page,
    (sel) => /75/.test(document.querySelector(sel)?.textContent ?? ''),
    gridCell(WT, 0, 'value'),
    3000,
  );
  check('giá trị sống của TANK01.SP đổi sang 75', true);
  await shot('2-ghi-xong');
  await axeBoth(page, axe, 'Bảng theo dõi có kết quả ghi');

  // ---------- 3. 95 ngoài giới hạn và "12,5" ----------
  await setWriteValue(page, 0, '95');
  await selectRow(page, 0);
  await openWriteDialog(page);
  const over = await text(page, `${WC} tr[data-tag="TANK01.SP"]`);
  check(
    '95: dòng bị khóa, nêu giới hạn 0 đến 90',
    /Không gửi/.test(over ?? '') && /0 đến 90/.test(over ?? ''),
    over,
  );
  check('95: nút Ghi khóa', await page.$eval(`${WC} [data-role="confirm"]`, (b) => b.disabled));
  await cancelDialog(page);
  await setWriteValue(page, 0, '12,5');
  await selectRow(page, 0);
  await openWriteDialog(page);
  const comma = await text(page, `${WC} tr[data-tag="TANK01.SP"]`);
  check(
    '"12,5": báo dùng dấu chấm thập phân, gợi ý 12.5',
    /dấu chấm thập phân/.test(comma ?? '') && /12\.5/.test(comma ?? ''),
    comma,
  );
  await cancelDialog(page);
  check(
    'hủy hộp thoại: vẫn chỉ 1 lệnh trong nhật ký thiết bị',
    (await writeLog(page)).length === 1,
  );
  await setWriteValue(page, 0, '80');

  // ---------- 4. NO_READBACK ----------
  await page.evaluate(() =>
    window.__matMock.device.setWriteBehavior('BL335-01', {
      status: 'CONFIRMED',
      code: 'NO_READBACK',
      delayMs: 100,
    }),
  );
  await selectRow(page, 2);
  await openWriteDialog(page);
  await confirmWrite(page);
  await waitFor(
    page,
    (sel) => /không đọc lại/.test(document.querySelector(sel)?.textContent ?? ''),
    result(2),
    4000,
  );
  check('NO_READBACK: "thiết bị xác nhận, không đọc lại"', true, await text(page, result(2)));
  await page.evaluate(() =>
    window.__matMock.device.setWriteBehavior('BL335-01', {
      status: 'CONFIRMED',
      code: 'CONFIRMED',
      delayMs: 150,
    }),
  );

  // ---------- 5. Mất mạng sau khi gửi: hỏi lại theo mã, không gửi lại ----------
  const before = (await writeLog(page)).length;
  await page.evaluate(() => window.__matMock.device.loseNextWriteReply('BL335-01'));
  await selectRow(page, 0);
  await openWriteDialog(page);
  await confirmWrite(page);
  await waitFor(
    page,
    (sel) => /chưa rõ/i.test(document.querySelector(sel)?.textContent ?? ''),
    result(0),
    4000,
  );
  const unk = await text(page, result(0));
  check(
    'mất mạng sau khi gửi: "chưa rõ kết quả… không gửi lại"',
    /không gửi lại/.test(unk ?? ''),
    unk,
  );
  check('thiết bị đã nhận đúng 1 lệnh mới', (await writeLog(page)).length === before + 1);
  await page.click(`${WT} [data-act="recheck"]`);
  await waitFor(
    page,
    (sel) => /Đã xác nhận/.test(document.querySelector(sel)?.textContent ?? ''),
    result(0),
    4000,
  );
  check(
    'hỏi lại theo mã: có kết quả, thiết bị vẫn chỉ nhận 1 lệnh (không gửi lại)',
    (await writeLog(page)).length === before + 1,
  );

  // ---------- 6. Phiên hết hạn ----------
  const before2 = (await writeLog(page)).length;
  await selectRow(page, 0);
  await openWriteDialog(page);
  // Phiên hết hạn ngay giữa lúc người dùng đang đọc hộp xác nhận.
  await page.evaluate(() => window.__matMock.device.endSession('BL335-01'));
  await sleep(300);
  if (await dialogOpen(page)) await page.click(`${WC} [data-role="confirm"]`);
  await page.waitForSelector('mat-login-dialog [role="dialog"]', { timeout: 5000 });
  check('phiên hết hạn: hỏi đăng nhập lại', true);
  check('không có lệnh nào tới thiết bị', (await writeLog(page)).length === before2);
  await shot('3-het-han');
  // Đăng nhập lại: không tự gửi lại lệnh nào; phải xác nhận lại mới ghi.
  const relog = await page.$('mat-login-dialog input[name="user"]');
  if (relog) {
    await page.$eval('mat-login-dialog input[name="user"]', (i) => {
      i.value = '';
    });
    await page.type('mat-login-dialog input[name="user"]', 'kysu1');
    await page.type('mat-login-dialog input[name="password"]', `${pwEng}-kysu1`);
    await clickButton(page, 'mat-login-dialog .dlg-f', 'Đăng nhập');
    await waitFor(page, () => !document.querySelector('mat-login-dialog [role="dialog"]'));
  }
  await sleep(500);
  check(
    'đăng nhập lại: không tự gửi lại lệnh nào (phải xác nhận lại)',
    (await writeLog(page)).length === before2 && !(await dialogOpen(page)),
  );

  // ---------- 7. Viewer: Ghi khóa ----------
  await openMenuItem(page, 'Đăng xuất');
  await sleep(200);
  await openMenuItem(page, 'Đăng nhập');
  await page.waitForSelector('mat-login-dialog [role="dialog"]');
  const pwViewer = await page.evaluate(() => {
    const c = window.__matMock.device;
    const p = `thu-e2e-${Math.random().toString(16).slice(2, 14)}-xem`;
    c.setPassword('xem1', p);
    c.setPassword('admin', `${p}-admin`);
    return p;
  });
  await typeInto(page, 'mat-login-dialog input[name="user"]', 'xem1');
  await typeInto(page, 'mat-login-dialog input[name="password"]', pwViewer);
  await clickButton(page, 'mat-login-dialog .dlg-f', 'Đăng nhập');
  await waitFor(page, () =>
    /xem1 · /.test(document.querySelector('mat-statusbar')?.textContent ?? ''),
  );
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-watch-table-editor [data-act="writeAll"]')
        ?.getAttribute('aria-disabled') === 'true',
  );
  const viewer = await page.$eval(`${WT} [data-act="writeAll"]`, (b) => b.title);
  check('viewer: lệnh Ghi khóa, nêu cần operator', /operator/.test(viewer), viewer);
  await axeBoth(page, axe, 'Bảng theo dõi, viewer');

  // ---------- 8. Administrator: Audit lọc theo Tag ----------
  await openMenuItem(page, 'Đăng xuất');
  await sleep(200);
  await openMenuItem(page, 'Đăng nhập');
  await page.waitForSelector('mat-login-dialog [role="dialog"]');
  await typeInto(page, 'mat-login-dialog input[name="user"]', 'admin');
  await typeInto(page, 'mat-login-dialog input[name="password"]', `${pwViewer}-admin`);
  await clickButton(page, 'mat-login-dialog .dlg-f', 'Đăng nhập');
  await waitFor(page, () =>
    /admin · /.test(document.querySelector('mat-statusbar')?.textContent ?? ''),
  );
  await openMenuItem(page, 'Audit của thiết bị');
  await page.waitForSelector('mat-audit-view tr[data-id]');
  await page.type('mat-audit-view input[data-role="filter-target"]', 'TANK01.SP');
  await page.click('mat-audit-view [data-role="apply"]');
  await waitFor(page, () => {
    const rows = [...document.querySelectorAll('mat-audit-view tr[data-id]')];
    return (
      rows.length > 0 &&
      rows.every((r) => r.querySelectorAll('td')[5].textContent.trim() === 'TANK01.SP')
    );
  });
  const detail = await page.$$eval(
    'mat-audit-view tr[data-action="tag.write"] [data-role="write-detail"]',
    (d) => d.map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  );
  check('Audit lọc theo Tag TANK01.SP: chỉ lệnh của Tag đó', detail.length > 0);
  check(
    'lệnh ghi hiện kênh, thiết bị trường, giá trị cũ và mới',
    detail.some(
      (d) => /Kênh plc1/.test(d) && /Thiết bị trường plc1/.test(d) && /Cũ .+ → mới/.test(d),
    ),
    detail.join(' | ').slice(0, 300),
  );
  await shot('4-audit-theo-tag');
  await axeBoth(page, axe, 'Audit lọc theo Tag');
}
