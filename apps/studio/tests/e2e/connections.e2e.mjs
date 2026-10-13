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
  // Kết quả của lần thử trước vẫn đang hiện: chờ cho tới khi nó ĐỔI (hoặc, nếu hai lần cho cùng kết quả,
  // tới khi đã thấy trạng thái bận rồi xong), để không đọc nhầm kết quả cũ.
  const before = await page.evaluate(
    () =>
      document
        .querySelector('mat-connections-editor [data-role="probe-result"]')
        ?.textContent.trim() ?? '',
  );
  await page.click(`${ED} [data-role="probe-run"]`);
  await page
    .waitForFunction(
      (prev) => {
        const el = document.querySelector('mat-connections-editor [data-role="probe-result"]');
        const text = el?.textContent.trim() ?? '';
        return el?.getAttribute('aria-busy') === 'false' && text.length > 5 && text !== prev;
      },
      { timeout: 4000 },
      before,
    )
    .catch(() => undefined);
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

  // ---------- 5. Kênh Modbus RTU (T172, US3-1, US3-4, US3-5, US3-6) ----------
  await pick(page, 'channel:rs485-1');
  await page.waitForSelector(`${ED} #cn-channel-baud`);
  const baudOptions = await page.$$eval(`${ED} #cn-channel-baud option`, (o) =>
    o.map((x) => x.value).join(','),
  );
  check(
    'form kênh RTU: tốc độ 1.200–115.200, 7 hoặc 8 bit dữ liệu, parity, bit dừng, RS485, bỏ vọng lại, khoảng lặng',
    baudOptions === '1200,2400,4800,9600,19200,38400,57600,115200' &&
      (await page.$$eval(`${ED} #cn-channel-dataBits option`, (o) => o.length)) === 2,
    baudOptions,
  );
  const portsText = () => text(page, `${ED} .cn-ports`);
  await page.click(`${ED} [data-role="ports-load"]`);
  await page.waitForSelector(`${ED} tr[data-port]`);
  const ports = await page.$$eval(`${ED} tr[data-port]`, (r) =>
    r.map((x) => x.dataset.port).join(','),
  );
  check(
    'danh sách cổng của BL335: ttyAS2, ttyAS3, ttyAS0, ttyUSB0 (cổng dùng được trước)',
    ports === 'ttyAS2,ttyAS3,ttyAS0,ttyUSB0',
    ports,
  );
  const rowText = (name) => text(page, `${ED} tr[data-port="${name}"]`);
  const as0 = await rowText('ttyAS0');
  check(
    'ttyAS0: trên bo, đang là console của hệ điều hành',
    /trên bo/.test(as0 ?? '') && /console của hệ điều hành/.test(as0 ?? ''),
    as0,
  );
  const usb = await rowText('ttyUSB0');
  check(
    'ttyUSB0: USB, modem EC25, chưa được phép',
    /USB/.test(usb ?? '') && /EC25/.test(usb ?? ''),
    usb,
  );
  check(
    'ttyAS2 do kênh này dùng; RS485 chưa biết trước khi dò',
    /kênh này/.test((await rowText('ttyAS2')) ?? '') &&
      /chưa biết/.test((await rowText('ttyAS2')) ?? ''),
  );
  await page.click(`${ED} [data-role="ports-probe"]`);
  await waitFor(
    page,
    () =>
      /bật/.test(
        document.querySelector('mat-connections-editor tr[data-port="ttyAS2"] .pt-rs485')
          ?.textContent ?? '',
      ),
    undefined,
    5000,
  );
  check('Dò RS485 (?probe=1): ttyAS2 báo RS485 bật', true, (await portsText()) ?? '');
  const probeCall = await page.evaluate(
    () =>
      window.__matMock.device.calls
        .filter((c) => c.cmd === 'device_get' && c.args.path === '/api/v1/serial/ports')
        .at(-1)?.args.query,
  );
  check('lời gọi có query probe=1', probeCall?.probe === '1', JSON.stringify(probeCall));
  const disabled = await page.$eval(
    `${ED} tr[data-port="ttyAS0"] button[data-act="pick"]`,
    (b) => b.getAttribute('aria-disabled') + '|' + b.title,
  );
  check(
    'cổng console: nút Chọn khóa kèm lý do',
    disabled.startsWith('true') && /console/.test(disabled),
    disabled,
  );
  await shot('4-cong-serial');
  await axeBoth(page, axe, 'kênh RTU với danh sách cổng');
  await page.click(`${ED} tr[data-port="ttyAS3"] button[data-act="pick"]`);
  await waitFor(
    page,
    () =>
      document.querySelector('mat-connections-editor #cn-channel-serialPort')?.value === 'ttyAS3',
  );
  await waitFor(
    page,
    () =>
      /cần bộ chuyển tự đổi chiều/.test(
        document.querySelector('mat-connections-editor #cn-channel-rs485-w')?.textContent ?? '',
      ),
    undefined,
    3000,
  );
  check(
    'chọn cổng ttyAS3 (kernel không hỗ trợ RS485) khi bật RS485: gợi ý cần bộ chuyển tự đổi chiều',
    true,
  );
  await setField(page, 'cn-channel-serialPort', 'ttyAS9');
  await waitFor(
    page,
    () =>
      /không có trong danh sách cổng của BL335/.test(
        document.querySelector('mat-connections-editor #cn-channel-serialPort-w')?.textContent ??
          '',
      ),
    undefined,
    3000,
  );
  check('cổng ttyAS9 ngoài danh sách: Studio báo ngay dưới ô khi Online', true);
  await setField(page, 'cn-channel-serialPort', 'ttyAS2');
  await waitFor(
    page,
    () => !document.querySelector('mat-connections-editor #cn-channel-serialPort-w'),
  );

  // Thêm kênh RTU mới bằng nút
  await page.click(`${ED} [data-act="add-channel-rtu"]`);
  await waitFor(
    page,
    () => !!document.querySelector('mat-connections-editor [data-node="channel:rtu1"].sel'),
  );
  check(
    'Thêm kênh Modbus RTU: rtu1 được chọn, cổng trống',
    (await fieldValue(page, 'cn-channel-id')) === 'rtu1' &&
      (await fieldValue(page, 'cn-channel-serialPort')) === '',
  );
  await setField(page, 'cn-channel-serialPort', 'ttyAS3');
  await shot('5-kenh-rtu-moi');

  // Cảnh báo thời gian quét kèm số ms (US3-6): 1.200 bit/s, chu kỳ nhóm bình thường 100 ms.
  await pick(page, 'channel:rs485-1');
  await page.waitForSelector(`${ED} #cn-channel-baud`);
  await page.select(`${ED} #cn-channel-baud`, '1200');
  await treeNode(page, 'connections');
  await page.waitForSelector(`${ED} #cn-scan-normal`);
  await setField(page, 'cn-scan-normal', '100');
  await pick(page, 'channel:rs485-1');
  await waitFor(
    page,
    () =>
      /\d+ ms/.test(document.querySelector('mat-connections-editor .cn-issues')?.textContent ?? ''),
    undefined,
    6000,
  );
  const scan = await text(page, `${ED} .cn-issues`);
  check(
    'cảnh báo thời gian quét kèm số ms ước tính',
    /quét/.test(scan ?? '') && /\d+ ms/.test(scan ?? ''),
    scan,
  );
  await shot('6-canh-bao-thoi-gian-quet');
  await axeBoth(page, axe, 'kênh RTU có cảnh báo thời gian quét');
}
