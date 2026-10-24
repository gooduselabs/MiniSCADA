// E2E kênh Siemens S7 (feature 016, US4, FR-007), lớp Tauri giả, project 1.1 mẫu (v11-valid-full):
// - Thêm kênh Siemens S7 bằng nút: kênh s7-1 có sẵn CPU cpu1, form theo khuôn Modbus (rack, slot, PDU, TSAP), cổng gợi ý 102;
// - sửa rack, slot, PDU tại chỗ: ngoài khoảng thì lỗi tại ô, không ghi; TSAP sai thì lỗi; TSAP đích cùng slot thì cảnh báo;
// - CPU: không có Thử kết nối mà có ghi chú; không thêm CPU thứ hai;
// - Bảng Tag: Tag của cpu1, địa chỉ S7 sai báo lỗi tiếng Việt kèm ví dụ S7, địa chỉ đúng được chuẩn hóa, gợi ý vùng/kiểu/byte;
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import { resolve } from 'node:path';
import {
  REPO,
  axeBoth,
  clickCell,
  gridCell,
  gridText,
  openAndWait,
  readProject,
  text,
  treeNode,
  typeInCell,
  waitFor,
} from './util.mjs';

const ED = 'mat-connections-editor';
const GRID = 'mat-tag-grid';
const V11 = resolve(REPO, 'tests/project-vectors/v11-valid-full');

async function setField(page, id, value) {
  await page.click(`${ED} #${id}`);
  await page.$eval(`${ED} #${id}`, (i) => i.select());
  if (value) await page.keyboard.type(value);
  else await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
}

const fieldValue = (page, id) => page.$eval(`${ED} #${id}`, (e) => e.value).catch(() => null);
const attr = (page, sel, name) =>
  page.$eval(sel, (e, n) => e.getAttribute(n), name).catch(() => null);

export default async function connectionsS7({ page, check, shot, axe }) {
  const files = readProject(V11);
  await openAndWait(page, files, 'D:\\Projects\\v11-full');

  // ---------- 1. Thêm kênh Siemens S7 ----------
  await treeNode(page, 'connections');
  await page.waitForSelector(`${ED} [data-act="add-channel-s7"]`);
  check(
    'nút "Thêm kênh Siemens S7" cạnh nút Modbus',
    /Thêm kênh Siemens S7/.test((await text(page, `${ED} [data-act="add-channel-s7"]`)) ?? ''),
  );
  await page.click(`${ED} [data-act="add-channel-s7"]`);
  await waitFor(
    page,
    () => !!document.querySelector('mat-connections-editor [data-node="channel:s7-1"].sel'),
  );
  check(
    'kênh s7-1 được chọn, form kênh S7 hiện (tiêu đề Siemens S7)',
    (await fieldValue(page, 'cn-channel-id')) === 's7-1' &&
      /Siemens S7/.test((await text(page, `${ED} .cn-form h3`)) ?? ''),
    await text(page, `${ED} .cn-form h3`),
  );
  check(
    'kênh có sẵn CPU cpu1; chữ phụ S7 và rack/slot trong danh sách',
    (await text(page, `${ED} [data-node="channel:s7-1"] .sub`)) === 'S7' &&
      (await text(page, `${ED} [data-node="fdev:cpu1"] .sub`)) === 'rack 0 · slot 1',
  );
  check(
    'cổng gợi ý 102; trợ giúp ngay dưới ô',
    (await attr(page, `${ED} #cn-channel-port`, 'placeholder')) === '102' &&
      /102/.test((await text(page, `${ED} #cn-channel-port-h`)) ?? ''),
  );
  check(
    'mục cây Kết nối có kênh S7 (icon PLC)',
    !!(await page.$('mat-tree [id="ti-channel:s7-1"]')),
  );

  // ---------- 2. Sửa rack, slot, PDU, TSAP tại chỗ ----------
  await setField(page, 'cn-channel-host', '192.168.0.10');
  await setField(page, 'cn-channel-rack', '9');
  const rackErr = await text(page, `${ED} #cn-channel-rack-e`);
  check(
    'rack 9: lỗi tại ô (0–7), aria-invalid',
    /Ngoài khoảng/.test(rackErr ?? '') &&
      (await attr(page, `${ED} #cn-channel-rack`, 'aria-invalid')) === 'true',
    rackErr,
  );
  await setField(page, 'cn-channel-rack', '0');
  await waitFor(page, () => !document.querySelector('mat-connections-editor #cn-channel-rack-e'));
  await setField(page, 'cn-channel-slot', '2');
  await setField(page, 'cn-channel-pduSize', '200');
  const pduErr = await text(page, `${ED} #cn-channel-pduSize-e`);
  check('PDU 200: lỗi tại ô (240–960)', /Ngoài khoảng/.test(pduErr ?? ''), pduErr);
  await setField(page, 'cn-channel-pduSize', '960');
  await waitFor(
    page,
    () => !document.querySelector('mat-connections-editor #cn-channel-pduSize-e'),
  );
  check(
    'slot 2, PDU 960 ghi vào kênh',
    (await fieldValue(page, 'cn-channel-slot')) === '2' &&
      (await fieldValue(page, 'cn-channel-pduSize')) === '960',
  );
  await setField(page, 'cn-channel-remoteTsap', 'xyz');
  const tsapErr = await text(page, `${ED} #cn-channel-remoteTsap-e`);
  check('TSAP "xyz": lỗi 4 chữ số hex', /4 chữ số hex/.test(tsapErr ?? ''), tsapErr);
  await setField(page, 'cn-channel-remoteTsap', '03c1');
  await waitFor(page, () =>
    /bỏ trống rack và slot/.test(
      document.querySelector('mat-connections-editor #cn-channel-slot-w')?.textContent ?? '',
    ),
  );
  check(
    'TSAP đích cùng slot: ghi chữ hoa, cảnh báo ngay tại ô slot',
    (await fieldValue(page, 'cn-channel-remoteTsap')) === '03C1',
  );
  await shot('1-kenh-s7');
  await axeBoth(page, axe, 'form kênh Siemens S7');
  await setField(page, 'cn-channel-remoteTsap', '');
  await waitFor(page, () => !document.querySelector('mat-connections-editor #cn-channel-slot-w'));

  // ---------- 3. CPU: không Thử kết nối, một CPU mỗi kênh ----------
  await page.click(`${ED} [data-node="fdev:cpu1"]`);
  await page.waitForSelector(`${ED} #cn-device-maxGapBytes`);
  check(
    'CPU: ghi chú Thử kết nối chưa hỗ trợ S7, không có nút chạy thử',
    /chưa hỗ trợ kênh Siemens S7/.test(
      (await text(page, `${ED} [data-role="probe-unsupported"]`)) ?? '',
    ) && !(await page.$(`${ED} [data-role="probe-run"]`)),
  );
  const addDev = await page.$eval(
    `${ED} [data-act="add-device"]`,
    (b) => `${b.getAttribute('aria-disabled')}|${b.title}`,
  );
  check(
    'Thêm thiết bị trường khóa kèm lý do một CPU mỗi kênh',
    addDev.startsWith('true') && /một CPU/.test(addDev),
    addDev,
  );
  await shot('2-cpu-s7');
  await axeBoth(page, axe, 'CPU của kênh S7');

  // ---------- 4. Bảng Tag: địa chỉ S7 ----------
  await treeNode(page, 'tags');
  await page.waitForSelector(`${GRID} [role="gridcell"]`);
  await page.select(`${GRID} select[data-role="set"]`, 'external');
  const before = (await text(page, `${GRID} [data-role="count"]`)) ?? '';
  const n = Number(/^(\d+)/.exec(before)?.[1] ?? '0');
  await page.click(`${GRID} [data-act="add"]`);
  await waitFor(
    page,
    (want) =>
      new RegExp(`^${want}/`).test(
        document.querySelector('mat-tag-grid [data-role="count"]')?.textContent.trim() ?? '',
      ),
    n + 1,
  );
  await page.keyboard.press('Escape');
  await clickCell(page, GRID, n, 'device');
  await typeInCell(page, 'cpu1');
  await waitFor(
    page,
    (sel) => document.querySelector(sel)?.textContent.includes('cpu1'),
    gridCell(GRID, n, 'device'),
  );
  await clickCell(page, GRID, n, 'address');
  const emptyHint = await text(page, `${GRID} [data-role="addr-hint"]`);
  check(
    'ô địa chỉ trống của Tag S7: gợi ý định dạng S7',
    /DB1\.DBX0\.0/.test(emptyHint ?? '') && /MW10/.test(emptyHint ?? ''),
    emptyHint,
  );
  await typeInCell(page, 'DB1.DBX4');
  await clickCell(page, GRID, n, 'address');
  await waitFor(page, () =>
    document.querySelector('mat-tag-grid [data-role="addr-hint"]')?.classList.contains('field-err'),
  );
  const bad = await text(page, `${GRID} [data-role="addr-hint"]`);
  check(
    'địa chỉ S7 sai "DB1.DBX4": lỗi tiếng Việt kèm ví dụ S7',
    /Địa chỉ S7 không đúng cú pháp/.test(bad ?? '') && /DB1\.DBW2/.test(bad ?? ''),
    bad,
  );
  await shot('3-tag-s7-loi');
  await typeInCell(page, 'db01.dbd004');
  await waitFor(
    page,
    (sel) => document.querySelector(sel)?.textContent.includes('DB1.DBD4'),
    gridCell(GRID, n, 'address'),
  );
  check(
    'địa chỉ đúng được chuẩn hóa: db01.dbd004 → DB1.DBD4',
    (await gridText(page, gridCell(GRID, n, 'address'))) === 'DB1.DBD4',
    await gridText(page, gridCell(GRID, n, 'address')),
  );
  await clickCell(page, GRID, n, 'address');
  const good = await text(page, `${GRID} [data-role="addr-hint"]`);
  check(
    'gợi ý của địa chỉ đúng: vùng DB, kiểu REAL, 4 byte; cột Mã hàm trống',
    good === 'Vùng DB · kiểu S7 REAL · 4 byte' &&
      ((await gridText(page, gridCell(GRID, n, 'fc'))) ?? '') === '',
    good,
  );
  await shot('4-tag-s7');
  await axeBoth(page, axe, 'Bảng Tag với Tag S7');
}
