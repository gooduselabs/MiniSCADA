// E2E editor Kết nối và Thử kết nối (feature 006, T135, US1, FR-030, FR-044, SC-014, quickstart §5 bước 3–4), lớp Tauri giả:
// - thêm kênh Modbus TCP và thiết bị trường bằng nút, sửa máy chủ và cổng tại chỗ (Enter xác nhận), lỗi tại ô;
// - Online (engineer): Thử kết nối đọc HR100, 2 thanh ghi → kết nối được, thời gian, hex, bảng cách hiểu 4 thứ tự byte;
// - mọi mã kết quả: REFUSED, TIMEOUT, UNREACHABLE, DNS, BAD_FRAME, exception 02 kèm nghĩa, TEST_BUSY, TEST_RATE_LIMITED;
// - viewer: nút Thử kết nối khóa kèm lý do; axe 0 lỗi critical hoặc serious ở theme sáng và tối; 0 lỗi console.
import {
  FULL_02,
  axeBoth,
  goOnline,
  openAndWait,
  readProject,
  text,
  treeNode,
  waitFor,
} from './util.mjs';

const ED = 'mat-connections-editor';

/** Chọn kênh hoặc thiết bị trường bằng danh sách ngay trong editor. */
const pick = (page, id) => page.click(`${ED} [data-node="${id}"]`);

async function setField(page, id, value) {
  await page.click(`${ED} #${id}`);
  await page.$eval(`${ED} #${id}`, (i) => i.select());
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

const fieldValue = (page, id) => page.$eval(`${ED} #${id}`, (e) => e.value).catch(() => null);

async function probe(page, { host, address = 'HR100', count = 2 } = {}) {
  if (host !== undefined) await setHost(page, host);
  for (const [id, v] of [
    ['cn-probe-address', address],
    ['cn-probe-count', String(count)],
  ]) {
    await page.click(`${ED} #${id}`);
    await page.$eval(`${ED} #${id}`, (i) => i.select());
    await page.keyboard.type(v);
  }
  await page.click(`${ED} [data-role="probe-run"]`);
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-connections-editor [data-role="probe-result"]')
        ?.getAttribute('aria-busy') === 'false' &&
      (document
        .querySelector('mat-connections-editor [data-role="probe-result"]')
        ?.textContent.trim().length ?? 0) > 5,
  );
}

async function setHost(page, host) {
  // Host của kênh nằm ở form kênh: chọn nút kênh, sửa, rồi chọn lại thiết bị trường.
  await pick(page, 'channel:plc1');
  await page.waitForSelector(`${ED} #cn-channel-host`);
  await setField(page, 'cn-channel-host', host);
  await pick(page, 'fdev:plc1');
  await page.waitForSelector(`${ED} .cn-probe`);
}

export default async function connections({ page, check, shot, axe }) {
  const files = readProject(FULL_02);
  await openAndWait(page, files, 'D:\\Projects\\full-02');

  // ---------- 1. Thêm kênh và thiết bị trường, sửa tại chỗ ----------
  await treeNode(page, 'connections');
  await page.waitForSelector(`${ED} [data-act="add-channel"]`);
  check(
    'mở Kết nối: danh sách 2 kênh, 3 thiết bị trường',
    (await page.$$(`${ED} [role="treeitem"] .cn-item`)).length === 5,
  );
  await page.click(`${ED} [data-act="add-channel"]`);
  await waitFor(
    page,
    () => !!document.querySelector('mat-connections-editor [data-node="channel:plc2"].sel'),
  );
  check(
    'Thêm kênh Modbus TCP: kênh plc2 được chọn, form hiện',
    (await fieldValue(page, 'cn-channel-id')) === 'plc2',
  );
  await setField(page, 'cn-channel-host', 'localhost');
  await setField(page, 'cn-channel-port', '1502');
  const hp = [await fieldValue(page, 'cn-channel-host'), await fieldValue(page, 'cn-channel-port')];
  check('máy chủ localhost, cổng 1502', hp[0] === 'localhost' && hp[1] === '1502', hp.join('|'));
  await setField(page, 'cn-channel-port', '70000');
  const portErr = await text(page, `${ED} #cn-channel-port-e`);
  check(
    'cổng 70000: lỗi tại ô, không ghi',
    /Ngoài khoảng/.test(portErr ?? '') &&
      (await page.$eval(`${ED} #cn-channel-port`, (e) => e.getAttribute('aria-invalid'))) ===
        'true',
    portErr,
  );
  await setField(page, 'cn-channel-port', '1502');
  await waitFor(page, () => !document.querySelector('mat-connections-editor #cn-channel-port-e'));
  await page.click(`${ED} [data-act="add-device"]`);
  await waitFor(page, () => !!document.querySelector('mat-connections-editor #cn-device-unitId'));
  const devId = await fieldValue(page, 'cn-device-id');
  check(
    'Thêm thiết bị trường vào kênh: mã tự sinh, Unit ID mặc định',
    /^plc2-d1$/.test(devId ?? '') && (await fieldValue(page, 'cn-device-unitId')) === '1',
    devId,
  );
  const help = await text(page, `${ED} #cn-device-timeoutMs-h`);
  check('trợ giúp ngay dưới ô (Chờ trả lời)', /100–10\.000 ms/.test(help ?? ''), help);
  await shot('1-ket-noi-form');
  await axeBoth(page, axe, 'editor Kết nối, form thiết bị trường');

  // ---------- 2. Thử kết nối: Offline bị khóa ----------
  await pick(page, 'fdev:plc1');
  await page.waitForSelector(`${ED} [data-role="probe-run"]`);
  const lockedOffline = await page.$eval(
    `${ED} [data-role="probe-run"]`,
    (b) => b.getAttribute('aria-disabled') + '|' + b.title,
  );
  check(
    'Offline: Thử kết nối khóa kèm lý do Online',
    lockedOffline.startsWith('true') && /Online/.test(lockedOffline),
    lockedOffline,
  );

  // ---------- 3. Online (engineer): Thử kết nối đọc HR100, 2 thanh ghi ----------
  await goOnline(page, 'kysu1', files);
  await pick(page, 'fdev:plc1');
  await page.waitForSelector(`${ED} [data-role="probe-run"]`);
  await waitFor(
    page,
    () =>
      document
        .querySelector('mat-connections-editor [data-role="probe-run"]')
        ?.getAttribute('aria-disabled') === null,
  );
  await probe(page, { host: '192.168.10.5' });
  check(
    'Thử kết nối thành công: "Kết nối được"',
    (await text(page, `${ED} [data-role="probe-status"]`)) === 'Kết nối được',
  );
  check(
    'mã OK, thời gian kết nối và trả lời',
    /OK/.test((await text(page, `${ED} [data-role="probe-code"]`)) ?? '') &&
      /\d+ ms/.test((await text(page, `${ED} .cn-probe-out`)) ?? ''),
  );
  check(
    'giá trị thô (hex) 42F6 E979',
    (await text(page, `${ED} [data-role="probe-hex"]`)) === '42F6 E979',
  );
  const table = await page.$$eval(`${ED} .cn-interp tbody tr`, (rows) =>
    rows.map((r) => [...r.cells].map((c) => c.textContent.trim())),
  );
  const f32 = table.find((r) => r[0] === 'FLOAT32') ?? [];
  check(
    'bảng cách hiểu: INT16, UINT16, INT32, UINT32, FLOAT32 × 4 thứ tự byte; FLOAT32 ABCD = 123.45…',
    table.length === 5 && f32.length === 5 && /^123\.45/.test(f32[1]),
    JSON.stringify(f32),
  );
  await shot('2-thu-ket-noi-ok');
  await axeBoth(page, axe, 'Thử kết nối có kết quả');

  // ---------- 4. Mọi mã kết quả ----------
  const cases = [
    ['refuse.local', 'REFUSED', /từ chối kết nối/],
    ['timeout.local', 'TIMEOUT', /không trả lời kịp/],
    ['unreach.local', 'UNREACHABLE', /không tới được/],
    ['dns.local', 'DNS', /không phân giải/],
    ['badframe.local', 'BAD_FRAME', /không đúng khuôn dạng/],
  ];
  for (const [host, code, re] of cases) {
    await probe(page, { host });
    const t = await text(page, `${ED} [data-role="probe-code"]`);
    check(
      `mã ${code}: đúng mã và đúng lý do`,
      new RegExp(code).test(t ?? '') && re.test(t ?? ''),
      t,
    );
  }
  await probe(page, { host: '192.168.10.5', address: 'HR9000', count: 1 });
  const ex = await text(page, `${ED} [data-role="probe-exception"]`);
  check(
    'exception 02 kèm nghĩa "địa chỉ không hợp lệ"',
    /02/.test(ex ?? '') && /địa chỉ không hợp lệ/.test(ex ?? ''),
    ex,
  );
  await shot('3-thu-ket-noi-exception');
  await page.evaluate(() => window.__matMock.device.setProbeError('BL335-01', 'TEST_BUSY'));
  await probe(page, { address: 'HR100', count: 2 });
  check(
    'TEST_BUSY: thông báo đang có lần thử khác',
    /đang có một lần thử khác/.test(
      (await text(page, `${ED} [data-role="probe-result"] .banner`)) ?? '',
    ),
  );
  await page.evaluate(() => window.__matMock.device.setProbeError('BL335-01', 'TEST_RATE_LIMITED'));
  await probe(page, { address: 'HR100', count: 2 });
  check(
    'TEST_RATE_LIMITED: thử lại sau 20 giây',
    /thử lại sau 20 giây/.test(
      (await text(page, `${ED} [data-role="probe-result"] .banner`)) ?? '',
    ),
  );
  await axeBoth(page, axe, 'Thử kết nối báo lỗi');
}
