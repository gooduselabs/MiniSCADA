// E2E kênh Omron FINS (feature 018, US3), lớp Tauri giả, project 1.1 có kênh FINS (vector v11-fins-valid-udp):
// - danh sách kênh hiện FINS/UDP; "Thêm kênh Omron FINS" tạo omron2 với form FINS (địa chỉ PLC, giao thức, cổng 9600);
// - đổi giao thức sang TCP, thêm thiết bị: nút đích ngoài 0–254 báo lỗi tại ô, nút 7 hiện ở danh sách;
// - Bảng Tag: dán Tag FINS lên thiết bị cj2, một địa chỉ sai (D2002.16) thành 1 lỗi E_ADDR_SYNTAX, dòng gợi ý của ô địa
//   chỉ là cú pháp FINS, cột Mã hàm của Tag FINS là lệnh và mã vùng (0101/0102 · 82);
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import { resolve } from 'node:path';
import {
  REPO,
  axeBoth,
  openAndWait,
  pasteInto,
  readProject,
  text,
  treeItem,
  treeNode,
  waitFor,
} from './util.mjs';

const ED = 'mat-connections-editor';
const GRID = 'mat-tag-grid';

async function setField(page, id, value) {
  await page.click(`${ED} #${id}`);
  await page.$eval(`${ED} #${id}`, (i) => i.select());
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}
const fieldValue = (page, id) => page.$eval(`${ED} #${id}`, (e) => e.value).catch(() => null);
const subOf = (page, node) =>
  page.$eval(`${ED} [data-node="${node}"] .sub`, (e) => e.textContent.trim()).catch(() => null);
const count = (page) => text(page, `${GRID} [data-role="count"]`);

export default async function connectionsFins({ page, check, shot, axe }) {
  const files = readProject(resolve(REPO, 'tests/project-vectors/v11-fins-valid-udp'));
  await openAndWait(page, files, 'D:\\Projects\\fins-11');

  // ---------- 1. Kênh FINS ----------
  await treeNode(page, 'connections');
  await page.waitForSelector(`${ED} [data-act="add-channel-fins"]`);
  check(
    'kênh omron1 hiện FINS/UDP',
    (await subOf(page, 'channel:omron1')) === 'FINS/UDP',
    await subOf(page, 'channel:omron1'),
  );
  check(
    'thiết bị cj2 hiện nút 20',
    (await subOf(page, 'fdev:cj2')) === 'nút 20',
    await subOf(page, 'fdev:cj2'),
  );
  await page.click(`${ED} [data-act="add-channel-fins"]`);
  await waitFor(
    page,
    () => !!document.querySelector('mat-connections-editor [data-node="channel:omron2"].sel'),
  );
  check(
    'Thêm kênh Omron FINS: omron2 được chọn, form FINS với địa chỉ PLC mặc định',
    (await fieldValue(page, 'cn-channel-finsHost')) === '192.168.250.1' &&
      (await fieldValue(page, 'cn-channel-transport')) === 'udp',
    `${await fieldValue(page, 'cn-channel-finsHost')} ${await fieldValue(page, 'cn-channel-transport')}`,
  );
  const portPh = await page.$eval(`${ED} #cn-channel-finsPort`, (e) => e.placeholder);
  check('cổng FINS mặc định 9600', portPh === '9600', portPh);
  await setField(page, 'cn-channel-finsHost', '192.168.250.7');
  await page.select(`${ED} #cn-channel-transport`, 'tcp');
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-connections-editor [data-node="channel:omron2"] .sub')
        ?.textContent.trim() === 'FINS/TCP',
  );
  check(
    'đổi giao thức: danh sách hiện FINS/TCP',
    (await subOf(page, 'channel:omron2')) === 'FINS/TCP',
  );

  await page.click(`${ED} [data-act="add-device"]`);
  await waitFor(page, () => !!document.querySelector('mat-connections-editor #cn-device-node'));
  const devId = await fieldValue(page, 'cn-device-id');
  check('thiết bị mới của kênh FINS: form có nút, mạng, unit', !!devId);
  await setField(page, 'cn-device-node', '300');
  const nodeErr = await text(page, `${ED} #cn-device-node-e`);
  check('nút 300: lỗi tại ô', /Ngoài khoảng/.test(nodeErr ?? ''), nodeErr);
  await setField(page, 'cn-device-node', '7');
  await waitFor(page, () => !document.querySelector('mat-connections-editor #cn-device-node-e'));
  await waitFor(
    page,
    (id) =>
      document
        .querySelector(`mat-connections-editor [data-node="fdev:${id}"] .sub`)
        ?.textContent.trim() === 'nút 7',
    devId,
  );
  check('nút 7 hiện ở danh sách', (await subOf(page, `fdev:${devId}`)) === 'nút 7');
  const probeHelp = await text(page, `${ED} .cn-probe .help`);
  check(
    'Thử kết nối của thiết bị FINS: đọc model CPU khi để trống địa chỉ',
    /0501/.test(probeHelp ?? ''),
    probeHelp,
  );
  check(
    'ô địa chỉ của Thử kết nối mặc định D100',
    (await page.$eval(`${ED} #cn-probe-address`, (e) => e.value)) === 'D100',
  );
  await shot('fins-kenh');
  await axeBoth(page, axe, 'Kết nối Omron FINS');

  // ---------- 2. Bảng Tag với địa chỉ FINS ----------
  await treeItem(page, 'Bảng Tag mặc định');
  await page.waitForSelector(`${GRID} [role="gridcell"]`);
  await page.select(`${GRID} select[data-role="set"]`, 'external');
  const before = Number(/(\d+)\//.exec((await count(page)) ?? '')?.[1] ?? 0);
  await page.click(`${GRID} [data-act="add"]`);
  await waitFor(
    page,
    (n) =>
      new RegExp(`${n}/${n} Tag`).test(
        document.querySelector('mat-tag-grid [data-role="count"]')?.textContent ?? '',
      ),
    before + 1,
  );
  await page.keyboard.press('Escape');
  const lines = [
    ['FINS_A', 'Đọc D2000', 'INT16', '', 'cj2', 'D2000'],
    ['FINS_B', 'Bit 5 của D2001', 'BOOL', '', 'cj2', 'D2001.05'],
    ['FINS_C', 'Bit sai', 'BOOL', '', 'cj2', 'D2002.16'],
  ].map((l) => l.join('\t'));
  await pasteInto(page, GRID, lines.join('\n'));
  await waitFor(
    page,
    (n) =>
      new RegExp(`${n}/${n} Tag`).test(
        document.querySelector('mat-tag-grid [data-role="count"]')?.textContent ?? '',
      ),
    before + 3,
  );
  await waitFor(
    page,
    () =>
      [...document.querySelectorAll('mat-statusbar button')].some((b) =>
        /^\s*1 lỗi/.test(b.textContent.replace(/\s+/g, ' ')),
      ),
    undefined,
    4000,
  );
  check('địa chỉ FINS sai (D2002.16) → "1 lỗi" trên thanh trạng thái', true);
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
    'tab Thông tin có 1 lỗi E_ADDR_SYNTAX',
    issues.filter((x) => /E_ADDR_SYNTAX/.test(x)).length === 1,
    issues.join(' | ').slice(0, 300),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('mat-inspector .issue')]
      .find((r) => /E_ADDR_SYNTAX/.test(r.textContent))
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })),
  );
  await waitFor(page, () => !!document.querySelector('mat-tag-grid [role="gridcell"].mg-err'));
  await waitFor(page, () => !!document.querySelector('mat-tag-grid [data-role="addr-hint"]'));
  const hint = await text(page, `${GRID} [data-role="addr-hint"]`);
  check(
    'dòng gợi ý của ô địa chỉ FINS: cú pháp FINS (D100, CIO10.03, E0_100…)',
    /D100/.test(hint ?? '') && /E0_100/.test(hint ?? ''),
    hint,
  );
  const fc = await page.$$eval(`${GRID} [role="gridcell"][data-c="fc"]`, (cells) =>
    cells.map((c) => c.textContent.trim()),
  );
  check(
    'cột Mã hàm của Tag FINS: lệnh và mã vùng',
    fc.includes('0101/0102 · 82'),
    fc.join('|').slice(0, 200),
  );
  await page.keyboard.press('Escape');
  await shot('fins-bang-tag');
  await axeBoth(page, axe, 'Bảng Tag có Tag FINS');
}
