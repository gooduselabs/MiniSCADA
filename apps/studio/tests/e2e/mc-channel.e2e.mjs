// E2E kênh Mitsubishi MC (feature 017, US4, FR-011, T042), lớp Tauri giả, project 1.1 (vector v11-valid-full):
// - editor Kết nối: nút "Thêm kênh Mitsubishi MC" thêm kênh mc1 (chữ phụ MC 3E), sửa máy tại chỗ, nhóm Khung;
// - thiết bị trường MC: nhóm Định tuyến, Gom yêu cầu, Ghi; module I/O nhập và hiện hex (03FF → 03E0);
// - Bảng Tag: Tag D100 trên thiết bị MC hợp lệ (gợi ý thiết bị, số, word); gõ Q100 → lỗi E_ADDR_SYNTAX tại ô;
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import { resolve } from 'node:path';
import {
  REPO,
  axeBoth,
  clickCell,
  gridCell,
  gridText,
  openAndWait,
  pasteInto,
  readProject,
  text,
  treeItem,
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
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

const fieldValue = (page, id) => page.$eval(`${ED} #${id}`, (e) => e.value).catch(() => null);
const count = (page) => text(page, `${GRID} [data-role="count"]`);

export default async function mcChannel({ page, check, shot, axe }) {
  await openAndWait(page, readProject(V11), 'D:\\Projects\\vector-11');

  // ---------- 1. Thêm kênh Mitsubishi MC ----------
  await treeNode(page, 'connections');
  await page.waitForSelector(`${ED} [data-act="add-channel-mc"]`);
  const btn = await page.$eval(`${ED} [data-act="add-channel-mc"]`, (b) => ({
    disabled: b.getAttribute('aria-disabled'),
    text: b.textContent.trim(),
  }));
  check(
    'project 1.1: nút "Thêm kênh Mitsubishi MC" bật',
    btn.disabled === null && btn.text === 'Thêm kênh Mitsubishi MC',
    JSON.stringify(btn),
  );
  await page.click(`${ED} [data-act="add-channel-mc"]`);
  await waitFor(
    page,
    () => !!document.querySelector('mat-connections-editor [data-node="channel:mc1"].sel'),
  );
  const legends = await page.$$eval(`${ED} .cn-form fieldset legend`, (l) =>
    l.map((x) => x.textContent.trim()),
  );
  check(
    'kênh mc1 được chọn; form Kết nối, Khung, Nâng cao',
    (await fieldValue(page, 'cn-channel-id')) === 'mc1' &&
      legends.join('|') === 'Kết nối|Khung|Nâng cao',
    legends.join('|'),
  );
  await setField(page, 'cn-channel-mcHost', '192.168.3.40');
  check('sửa máy tại chỗ', (await fieldValue(page, 'cn-channel-mcHost')) === '192.168.3.40');
  const treeSub = await text(page, 'mat-tree [id="ti-channel:mc1"]');
  check('cây: kênh mc1 có chữ phụ MC 3E', /MC 3E/.test(treeSub ?? ''), treeSub);

  // ---------- 2. Thiết bị trường MC ----------
  await page.click(`${ED} [data-act="add-device"]`);
  await waitFor(page, () => !!document.querySelector('mat-connections-editor #cn-device-moduleIo'));
  const devLegends = await page.$$eval(`${ED} .cn-form fieldset legend`, (l) =>
    l.map((x) => x.textContent.trim()),
  );
  const io = await page.$eval(`${ED} #cn-device-moduleIo`, (e) => e.placeholder);
  check(
    'thiết bị mc1-d1: Kết nối, Định tuyến, Gom yêu cầu, Ghi; module I/O mặc định 03FF',
    (await fieldValue(page, 'cn-device-id')) === 'mc1-d1' &&
      devLegends.join('|') === 'Kết nối|Định tuyến|Gom yêu cầu|Ghi' &&
      io === '03FF',
    `${devLegends.join('|')} ${io}`,
  );
  await setField(page, 'cn-device-moduleIo', '3e0');
  check(
    'module I/O nhập 3e0 → hiện 03E0',
    (await fieldValue(page, 'cn-device-moduleIo')) === '03E0',
  );
  check(
    'Thử kết nối cho MC: thông báo chưa có, không có nút chạy',
    !!(await page.$(`${ED} [data-role="probe-mc"]`)) &&
      !(await page.$(`${ED} [data-role="probe-run"]`)),
  );
  await shot('1-thiet-bi-mc');
  await axeBoth(page, axe, 'editor Kết nối, thiết bị trường MC');

  // ---------- 3. Bảng Tag: D100 hợp lệ, Q100 lỗi E_ADDR_SYNTAX tại ô ----------
  await treeItem(page, 'Bảng Tag mặc định');
  await page.waitForSelector(`${GRID} [role="gridcell"]`);
  await page.select(`${GRID} select[data-role="set"]`, 'external');
  const before = Number(/^(\d+)/.exec((await count(page)) ?? '')?.[1] ?? 0);
  await page.click(`${GRID} [data-act="add"]`);
  await waitFor(
    page,
    (n) =>
      (document.querySelector('mat-tag-grid [data-role="count"]')?.textContent ?? '').startsWith(
        `${n}/`,
      ),
    before + 1,
  );
  await page.keyboard.press('Escape');
  await pasteInto(page, GRID, ['MC_D100', 'Mức MC', 'INT16', '', 'mc1-d1', 'D100'].join('\t'));
  const row = before;
  await waitFor(
    page,
    (sel) => {
      const c = document.querySelector(sel);
      return !!c && /D100/.test(c.textContent);
    },
    gridCell(GRID, row, 'address'),
  );
  await clickCell(page, GRID, row, 'address');
  await waitFor(page, () =>
    /MC D/.test(document.querySelector('mat-tag-grid [data-role="addr-hint"]')?.textContent ?? ''),
  );
  const okHint = await text(page, `${GRID} [data-role="addr-hint"]`);
  check(
    'Tag D100 trên thiết bị MC: gợi ý thiết bị D, số 100, 1 word',
    /MC D .*số 100 · 1 word/.test(okHint ?? ''),
    okHint,
  );

  await typeInCell(page, 'Q100');
  await waitFor(
    page,
    (sel) => (document.querySelector(sel)?.textContent ?? '').includes('Q100'),
    gridCell(GRID, row, 'address'),
  );
  await waitFor(
    page,
    (sel) => document.querySelector(sel)?.classList.contains('mg-err') ?? false,
    gridCell(GRID, row, 'address'),
    8000,
  );
  const bad = await page.$eval(gridCell(GRID, row, 'address'), (c) => ({
    invalid: c.getAttribute('aria-invalid'),
    title: c.title,
  }));
  check(
    'gõ Q100: ô địa chỉ viền đỏ kèm lý do (bộ kiểm tra)',
    bad.invalid === 'true' && bad.title.length > 5,
    JSON.stringify(bad),
  );
  await clickCell(page, GRID, row, 'address');
  const errHint = await text(page, `${GRID} [data-role="addr-hint"]`);
  check(
    'dòng gợi ý: lỗi cú pháp MC kèm ví dụ',
    /Địa chỉ MC không đúng cú pháp/.test(errHint ?? ''),
    errHint,
  );
  await page.keyboard.press('Escape');
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-statusbar button')]
      .find((b) => /lỗi/.test(b.textContent))
      ?.click(),
  );
  await page.waitForSelector('mat-inspector .issue');
  const issues = await page.$$eval('mat-inspector .issue', (r) =>
    r.map((x) => x.textContent.replace(/\s+/g, ' ')),
  );
  check(
    'tab Thông tin có lỗi E_ADDR_SYNTAX của Tag MC_D100',
    issues.some((x) => /E_ADDR_SYNTAX/.test(x)),
    issues.join(' | ').slice(0, 300),
  );
  const cell = await gridText(page, gridCell(GRID, row, 'address'));
  check('ô giữ chữ hoa Q100 để sửa tiếp', cell === 'Q100', cell);
  await shot('2-bang-tag-q100');
  await axeBoth(page, axe, 'Bảng Tag, ô địa chỉ MC lỗi');
}
