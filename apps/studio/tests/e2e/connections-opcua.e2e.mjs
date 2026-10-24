// E2E kênh OPC UA (feature 019, US5), lớp Tauri giả, project 1.1 mẫu (v11-valid-full):
// - Thêm kênh OPC UA bằng nút: kênh ua-1 có sẵn server srv1, form endpoint/bảo mật/xác thực, endpoint sai thì lỗi tại ô;
// - SignAndEncrypt với policy None: cảnh báo tại ô; username hiện ô secretId và ghi chú `mat-runtime --set-secret`;
// - server: không có Thử kết nối mà có ghi chú; không thêm server thứ hai;
// - Online (engineer): Lấy chứng chỉ (SHA-256, chủ thể, endpoint) → Tin chứng chỉ này; Duyệt node Objects › Tank → Thêm Tag;
// - Bảng Tag: Tag mới có NodeId và kiểu gợi ý; NodeId sai báo lỗi tiếng Việt kèm ví dụ; gợi ý namespace/loại id;
// - axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import { resolve } from 'node:path';
import {
  REPO,
  axeBoth,
  clickCell,
  goOnline,
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

async function choose(page, id, value) {
  await page.select(`${ED} #${id}`, value);
}

const fieldValue = (page, id) => page.$eval(`${ED} #${id}`, (e) => e.value).catch(() => null);
const attr = (page, sel, name) =>
  page.$eval(sel, (e, n) => e.getAttribute(n), name).catch(() => null);

export default async function connectionsOpcUa({ page, check, shot, axe }) {
  const files = readProject(V11);
  await openAndWait(page, files, 'D:\\Projects\\v11-full');

  // ---------- 1. Thêm kênh OPC UA ----------
  await treeNode(page, 'connections');
  await page.waitForSelector(`${ED} [data-act="add-channel-opcua"]`);
  check(
    'nút "Thêm kênh OPC UA" cạnh nút Modbus',
    /Thêm kênh OPC UA/.test((await text(page, `${ED} [data-act="add-channel-opcua"]`)) ?? ''),
  );
  await page.click(`${ED} [data-act="add-channel-opcua"]`);
  await waitFor(
    page,
    () => !!document.querySelector('mat-connections-editor [data-node="channel:ua-1"].sel'),
  );
  check(
    'kênh ua-1 được chọn, form kênh OPC UA (tiêu đề OPC UA, endpoint mặc định)',
    (await fieldValue(page, 'cn-channel-id')) === 'ua-1' &&
      /OPC UA/.test((await text(page, `${ED} .cn-form h3`)) ?? '') &&
      (await fieldValue(page, 'cn-channel-endpointUrl')) === 'opc.tcp://192.168.1.20:4840',
  );
  check(
    'kênh có sẵn server srv1; chữ phụ OPC UA và host:cổng trong danh sách',
    (await text(page, `${ED} [data-node="channel:ua-1"] .sub`)) === 'OPC UA' &&
      (await text(page, `${ED} [data-node="fdev:srv1"] .sub`)) === '192.168.1.20:4840',
  );
  check(
    'anonymous: không có ô tên đăng nhập; thẻ Chứng chỉ server và Duyệt node',
    !(await page.$(`${ED} #cn-channel-username`)) &&
      !!(await page.$(`${ED} .cn-ua-cert`)) &&
      !!(await page.$(`${ED} .cn-ua-browse`)),
  );

  // ---------- 2. Sửa tại chỗ ----------
  await setField(page, 'cn-channel-endpointUrl', 'http://10.0.0.5');
  const epErr = await text(page, `${ED} #cn-channel-endpointUrl-e`);
  check('endpoint http://: lỗi tại ô', /opc\.tcp:\/\//.test(epErr ?? ''), epErr);
  await setField(page, 'cn-channel-endpointUrl', 'opc.tcp://10.0.0.5:4840');
  await waitFor(
    page,
    () => !document.querySelector('mat-connections-editor #cn-channel-endpointUrl-e'),
  );
  await choose(page, 'cn-channel-securityMode', 'SignAndEncrypt');
  await waitFor(page, () =>
    /không khớp/.test(
      document.querySelector('mat-connections-editor #cn-channel-securityPolicy-w')?.textContent ??
        '',
    ),
  );
  check('SignAndEncrypt + policy None: cảnh báo tại ô policy', true);
  await choose(page, 'cn-channel-securityPolicy', 'Basic256Sha256');
  await waitFor(
    page,
    () => !document.querySelector('mat-connections-editor #cn-channel-securityPolicy-w'),
  );
  check(
    'chưa tin chứng chỉ: cảnh báo tại ô chứng chỉ server',
    /Chưa tin/.test((await text(page, `${ED} #cn-channel-serverCertSha256-w`)) ?? ''),
  );
  await choose(page, 'cn-channel-authMode', 'username');
  await page.waitForSelector(`${ED} #cn-channel-secretId`);
  await setField(page, 'cn-channel-username', 'operator');
  await setField(page, 'cn-channel-secretId', 'opcua-ua-1');
  await page.waitForSelector(`${ED} [data-role="opcua-secret"]`);
  check(
    'username: ghi chú đặt mật khẩu trên thiết bị bằng --set-secret',
    /mat-runtime --set-secret opcua-ua-1/.test(
      (await text(page, `${ED} [data-role="opcua-secret"]`)) ?? '',
    ),
  );
  await shot('1-kenh-opcua');
  await axeBoth(page, axe, 'form kênh OPC UA');

  // ---------- 3. Server: không Thử kết nối, một server mỗi kênh ----------
  await page.click(`${ED} [data-node="fdev:srv1"]`);
  await page.waitForSelector(`${ED} [data-role="probe-unsupported"]`);
  check(
    'server: ghi chú thay Thử kết nối, không có nút chạy',
    !(await page.$(`${ED} [data-role="probe-run"]`)),
  );
  check(
    'Thêm thiết bị khóa: một server mỗi kênh',
    (await attr(page, `${ED} [data-act="add-device"]`, 'aria-disabled')) === 'true' &&
      /một server/.test((await attr(page, `${ED} [data-act="add-device"]`, 'title')) ?? ''),
  );

  // ---------- 4. Online: Lấy chứng chỉ, Tin chứng chỉ này ----------
  await goOnline(page, 'kysu1', files);
  await page.click(`${ED} [data-node="channel:ua-1"]`);
  await page.waitForSelector(`${ED} [data-role="ua-cert-fetch"]`);
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-connections-editor [data-role="ua-cert-fetch"]')
        ?.getAttribute('aria-disabled') === null,
  );
  await page.click(`${ED} [data-role="ua-cert-fetch"]`);
  await page.waitForSelector(`${ED} [data-role="ua-cert-sha"]`);
  const sha = ((await text(page, `${ED} [data-role="ua-cert-sha"]`)) ?? '').replace(/\s/g, '');
  check('SHA-256 của chứng chỉ server (64 hex)', /^[0-9a-f]{64}$/.test(sha), sha);
  check(
    'chủ thể và 3 endpoint',
    /CN=mat-opcua-sim/.test((await text(page, `${ED} .cn-ua-cert`)) ?? '') &&
      (await page.$$(`${ED} .cn-ua-endpoints tbody tr`)).length === 3,
  );
  await page.click(`${ED} [data-role="ua-cert-trust"]`);
  await page.waitForSelector(`${ED} [data-role="ua-cert-trusted"]`);
  check(
    'Tin chứng chỉ này: SHA vào ô chứng chỉ server, hết cảnh báo',
    (await fieldValue(page, 'cn-channel-serverCertSha256')) === sha &&
      !(await page.$(`${ED} #cn-channel-serverCertSha256-w`)),
  );

  // ---------- 5. Duyệt node, Thêm Tag ----------
  await page.click(`${ED} [data-role="ua-browse"]`);
  await page.waitForSelector(`${ED} tr[data-node="ns=2;s=Tank"]`);
  await page.click(`${ED} tr[data-node="ns=2;s=Tank"] [data-act="ua-expand"]`);
  await page.waitForSelector(`${ED} tr[data-node="ns=2;s=Tank.Level"]`);
  check(
    'cây: Tank mở, Level là biến Double cấp 2',
    (await attr(page, `${ED} tr[data-node="ns=2;s=Tank"]`, 'aria-expanded')) === 'true' &&
      (await attr(page, `${ED} tr[data-node="ns=2;s=Tank.Level"]`, 'aria-level')) === '2' &&
      /Double/.test((await text(page, `${ED} tr[data-node="ns=2;s=Tank.Level"]`)) ?? ''),
  );
  await page.click(`${ED} tr[data-node="ns=2;s=Tank.Level"] [data-act="ua-add-tag"]`);
  await waitFor(page, () =>
    /Cập nhật/.test(
      document.querySelector(
        'mat-connections-editor tr[data-node="ns=2;s=Tank.Level"] [data-act="ua-add-tag"]',
      )?.textContent ?? '',
    ),
  );
  check('Thêm Tag: nút đổi thành Cập nhật Tag', true);
  await shot('2-duyet-node');
  await axeBoth(page, axe, 'Chứng chỉ server và Duyệt node');

  // ---------- 6. Bảng Tag: NodeId ----------
  await treeNode(page, 'tags');
  await page.waitForSelector(`${GRID} [role="gridcell"]`);
  await page.select(`${GRID} select[data-role="set"]`, 'external');
  // Tag vừa thêm ở cuối: chỉ số gốc theo store; tới dòng cuối bằng Ctrl+↓ (lưới chỉ vẽ dòng đang thấy).
  const row = await page.evaluate(() =>
    window.__matApp.store.state.outline.tags.tags.findIndex(
      (t) => t.source?.address === 'ns=2;s=Tank.Level' && t.source?.device === 'srv1',
    ),
  );
  await page.click(`${GRID} [role="gridcell"][data-c="address"]`);
  await page.keyboard.down('Control');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Control');
  await clickCell(page, GRID, row, 'address');
  check(
    'Tag Level vừa thêm có NodeId ns=2;s=Tank.Level, kiểu FLOAT64, thiết bị srv1',
    (await gridText(page, gridCell(GRID, row, 'address'))) === 'ns=2;s=Tank.Level' &&
      (await gridText(page, gridCell(GRID, row, 'type'))) === 'FLOAT64' &&
      (await gridText(page, gridCell(GRID, row, 'device'))) === 'srv1',
    await gridText(page, gridCell(GRID, row, 'address')),
  );
  await page.waitForSelector(`${GRID} [data-role="addr-hint"]`);
  check(
    'gợi ý namespace 2, id chuỗi; cột Mã hàm trống',
    /Namespace 2 · id chuỗi/.test((await text(page, `${GRID} [data-role="addr-hint"]`)) ?? '') &&
      ((await gridText(page, gridCell(GRID, row, 'fc'))) ?? '') === '',
  );
  await typeInCell(page, 'nsu=urn:x;s=A');
  await clickCell(page, GRID, row, 'address');
  await waitFor(page, () =>
    document.querySelector('mat-tag-grid [data-role="addr-hint"]')?.classList.contains('field-err'),
  );
  const bad = await text(page, `${GRID} [data-role="addr-hint"]`);
  check(
    'NodeId sai "nsu=…": lỗi tiếng Việt kèm ví dụ, giữ nguyên chữ thường',
    /NodeId không đúng cú pháp/.test(bad ?? '') &&
      (await gridText(page, gridCell(GRID, row, 'address'))) === 'nsu=urn:x;s=A',
    bad,
  );
  await typeInCell(page, 'ns=3;s="DB Data".Speed');
  await waitFor(
    page,
    (sel) => document.querySelector(sel)?.textContent.includes('"DB Data".Speed'),
    gridCell(GRID, row, 'address'),
  );
  check('NodeId có dấu cách và ngoặc kép giữ nguyên', true);
  await shot('3-bang-tag-nodeid');
  await axeBoth(page, axe, 'Bảng Tag với Tag OPC UA');
}
