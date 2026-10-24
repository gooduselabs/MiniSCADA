// E2E kênh BACnet/IP (feature 020, US3), lớp Tauri giả, project 1.1 có kênh BACnet (vector v11-bacnet-valid):
// - danh sách kênh hiện BACnet/IP, thiết bị hiện #instance; "Thêm kênh BACnet/IP" tạo bms1 với form BACnet (cổng 47808);
// - thiết bị: instance ngoài 0–4194302 báo lỗi tại ô;
// - Online (engineer): Tìm thiết bị (Who-Is giả) liệt kê 2 thiết bị, "Thêm" tạo thiết bị dev7 sau router (mạng 5, MAC 07);
// - Thử kết nối đọc tên thiết bị; Duyệt đối tượng liệt kê object-list, chọn hết, "Thêm Tag" thêm Tag vào Bảng Tag;
// - Bảng Tag: dòng gợi ý của ô địa chỉ BACnet; axe 0 lỗi critical hoặc serious ở theme sáng và tối.
import { resolve } from 'node:path';
import {
  REPO,
  axeBoth,
  goOnline,
  openAndWait,
  readProject,
  text,
  treeNode,
  waitFor,
} from './util.mjs';

const ED = 'mat-connections-editor';
const PANEL = 'mat-bacnet-panel';

async function setField(page, id, value) {
  await page.click(`${ED} #${id}`);
  await page.$eval(`${ED} #${id}`, (i) => i.select());
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}
const fieldValue = (page, id) => page.$eval(`${ED} #${id}`, (e) => e.value).catch(() => null);
const subOf = (page, node) =>
  page.$eval(`${ED} [data-node="${node}"] .sub`, (e) => e.textContent.trim()).catch(() => null);

async function runAndWait(page, role, out) {
  await page.click(`${PANEL} [data-role="${role}"]`);
  await waitFor(
    page,
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && el.textContent.trim().length > 5 && !/Đang thử/.test(el.textContent);
    },
    `${PANEL} [data-role="${out}"]`,
  );
}

export default async function connectionsBacnet({ page, check, shot, axe }) {
  const files = readProject(resolve(REPO, 'tests/project-vectors/v11-bacnet-valid'));
  await openAndWait(page, files, 'D:\\Projects\\bacnet-11');

  // ---------- 1. Kênh BACnet ----------
  await treeNode(page, 'connections');
  await page.waitForSelector(`${ED} [data-act="add-channel-bacnet"]`);
  check(
    'kênh bms hiện BACnet/IP',
    (await subOf(page, 'channel:bms')) === 'BACnet/IP',
    await subOf(page, 'channel:bms'),
  );
  check(
    'thiết bị ahu1 hiện #1001',
    (await subOf(page, 'fdev:ahu1')) === '#1001',
    await subOf(page, 'fdev:ahu1'),
  );
  await page.click(`${ED} [data-act="add-channel-bacnet"]`);
  await waitFor(
    page,
    () => !!document.querySelector('mat-connections-editor [data-node="channel:bms1"].sel'),
  );
  const portPh = await page.$eval(`${ED} #cn-channel-bacnetLocalPort`, (e) => e.placeholder);
  check(
    'Thêm kênh BACnet/IP: bms1 được chọn, cổng cục bộ mặc định 47808',
    portPh === '47808',
    portPh,
  );
  await setField(page, 'cn-channel-bacnetBroadcast', '192.168.20.255');
  check(
    'broadcast ghi được',
    (await fieldValue(page, 'cn-channel-bacnetBroadcast')) === '192.168.20.255',
  );
  await page.click(`${ED} [data-act="add-device"]`);
  await waitFor(
    page,
    () => !!document.querySelector('mat-connections-editor #cn-device-bacnetInstance'),
  );
  await setField(page, 'cn-device-bacnetInstance', '4194303');
  const instErr = await text(page, `${ED} #cn-device-bacnetInstance-e`);
  check('instance 4194303: lỗi tại ô', /Ngoài khoảng/.test(instErr ?? ''), instErr);
  await setField(page, 'cn-device-bacnetInstance', '2001');
  await waitFor(
    page,
    () => !document.querySelector('mat-connections-editor #cn-device-bacnetInstance-e'),
  );
  check(
    'thiết bị mới hiện #2001',
    (await subOf(page, 'fdev:bms1-d1')) === '#2001',
    await subOf(page, 'fdev:bms1-d1'),
  );
  await shot('connections-bacnet-form');

  // ---------- 2. Online: Tìm thiết bị ----------
  await goOnline(page, 'kysu1', files);
  await page.evaluate(() =>
    window.__matMock.device.setProbe('BL335-01', (body) => {
      if (body.action === 'whois')
        return {
          body: {
            ok: true,
            code: 'OK',
            action: 'whois',
            connectMs: 0,
            responseMs: 3000,
            devices: [
              {
                instance: 7,
                host: '192.168.20.10',
                port: 47808,
                network: 5,
                mac: '07',
                maxApdu: 480,
                segmentation: 3,
                vendorId: 8,
              },
              {
                instance: 1001,
                host: '192.168.20.50',
                port: 47808,
                network: 0,
                mac: '',
                maxApdu: 1476,
                segmentation: 3,
                vendorId: 260,
              },
            ],
            truncated: false,
          },
        };
      if (body.action === 'objects')
        return {
          body: {
            ok: true,
            code: 'OK',
            action: 'objects',
            connectMs: 0,
            responseMs: 40,
            objects: [
              { type: 8, instance: 1001, address: 'DEV:1001', name: 'AHU-1' },
              { type: 0, instance: 7, address: 'AI:7', name: 'Nhiệt độ gió cấp' },
              { type: 4, instance: 9, address: 'BO:9', name: 'Lệnh bơm' },
              { type: 200, instance: 1 },
            ],
            truncated: false,
          },
        };
      return {
        body: {
          ok: true,
          code: 'OK',
          action: 'read',
          connectMs: 0,
          responseMs: 12,
          read: {
            address: body.read?.address ?? 'DEV:1001:object-name',
            value: 'AHU-1',
            kind: 'string',
          },
        },
      };
    }),
  );
  await page.click(`${ED} [data-node="channel:bms"]`);
  await page.waitForSelector(`${PANEL} [data-role="bac-whois"]`);
  await runAndWait(page, 'bac-whois', 'bac-whois-result');
  const rows = await page.$$eval(`${PANEL} tr[data-instance]`, (r) =>
    r.map((x) => x.dataset.instance),
  );
  check('Tìm thiết bị: 2 thiết bị trả lời', rows.join(',') === '7,1001', rows.join(','));
  const have = await text(page, `${PANEL} tr[data-instance="1001"] .chip`);
  check('thiết bị 1001 đã có trong kênh', have === 'Đã có', have);
  await page.click(`${PANEL} tr[data-instance="7"] [data-role="bac-add-device"]`);
  await waitFor(
    page,
    () => !!document.querySelector('mat-connections-editor [data-node="fdev:dev7"]'),
  );
  check('Thêm: thiết bị dev7 hiện #7', (await subOf(page, 'fdev:dev7')) === '#7');
  await shot('connections-bacnet-whois');

  // ---------- 3. Thử kết nối và Duyệt đối tượng ----------
  await page.click(`${ED} [data-node="fdev:ahu1"]`);
  await page.waitForSelector(`${PANEL} [data-role="probe-run"]`);
  await runAndWait(page, 'probe-run', 'probe-result');
  const val = await text(page, `${PANEL} [data-role="bac-value"]`);
  check('Thử kết nối: đọc tên thiết bị AHU-1', /AHU-1/.test(val ?? ''), val);
  await runAndWait(page, 'bac-browse', 'bac-objects');
  const objs = await page.$$eval(`${PANEL} tr[data-address]`, (r) => r.length);
  check('Duyệt đối tượng: 4 đối tượng', objs === 4, String(objs));
  await page.click(`${PANEL} [data-role="bac-pick-all"]`);
  const addText = await text(page, `${PANEL} [data-role="bac-add-tags"]`);
  check('chọn hết: 2 đối tượng đọc được', /Thêm 2 Tag/.test(addText ?? ''), addText);
  const before = await page.evaluate(
    () => window.__matApp.store.state.outline.tags?.tags?.length ?? -1,
  );
  await page.click(`${PANEL} [data-role="bac-add-tags"]`);
  await waitFor(
    page,
    (n) => (window.__matApp.store.state.outline.tags?.tags?.length ?? -1) !== n,
    before,
  ).catch(() => undefined);
  const ids = await page.evaluate(() =>
    (window.__matApp.store.state.outline.tags?.tags ?? [])
      .map((t) => t.id)
      .filter((id) => id.startsWith('AHU1.')),
  );
  check(
    'Thêm Tag: AHU1.AI_7 và AHU1.BO_9 vào Bảng Tag',
    ids.includes('AHU1.AI_7') && ids.includes('AHU1.BO_9'),
    ids.join(','),
  );
  await shot('connections-bacnet-objects');
  await axeBoth(page, axe, 'Kết nối BACnet');
}
