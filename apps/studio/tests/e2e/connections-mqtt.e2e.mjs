// E2E kênh MQTT (feature 022), lớp Tauri giả, project 1.1 mẫu (v11-valid-full):
// - Thêm kênh MQTT bằng nút: kênh mqtt1 có sẵn broker broker1, form host/cổng/client id/TLS/tài khoản; host sai lỗi tại ô;
// - TLS bật mà chưa ghim: cảnh báo tại ô; tài khoản không TLS: cảnh báo; secretId: ghi chú `mat-runtime --set-secret`;
// - broker: không có Thử kết nối mà có ghi chú Chẩn đoán; không thêm broker thứ hai;
// - Bảng Tag: Tag chuyển sang broker1 nhận topic và đường dẫn JSON (giữ chữ hoa/thường), gợi ý hướng/topic/trường; topic
//   pub có wildcard báo lỗi tiếng Việt;
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

export default async function connectionsMqtt({ page, check, shot, axe }) {
  const files = readProject(V11);
  await openAndWait(page, files, 'D:\\Projects\\v11-full');

  // ---------- 1. Thêm kênh MQTT ----------
  await treeNode(page, 'connections');
  await page.waitForSelector(`${ED} [data-act="add-channel-mqtt"]`);
  check(
    'nút "Thêm kênh MQTT"',
    /Thêm kênh MQTT/.test((await text(page, `${ED} [data-act="add-channel-mqtt"]`)) ?? ''),
  );
  await page.click(`${ED} [data-act="add-channel-mqtt"]`);
  await waitFor(
    page,
    () => !!document.querySelector('mat-connections-editor [data-node="channel:mqtt1"].sel'),
  );
  check(
    'kênh mqtt1 được chọn, form kênh MQTT (tiêu đề, host mặc định)',
    (await fieldValue(page, 'cn-channel-id')) === 'mqtt1' &&
      /MQTT/.test((await text(page, `${ED} .cn-form h3`)) ?? '') &&
      (await fieldValue(page, 'cn-channel-host')) === '192.0.2.30',
  );
  check(
    'kênh có sẵn broker1; chữ phụ MQTT và host:cổng',
    (await text(page, `${ED} [data-node="channel:mqtt1"] .sub`)) === 'MQTT' &&
      (await text(page, `${ED} [data-node="fdev:broker1"] .sub`)) === '192.0.2.30:1883',
  );
  check(
    'ghi chú nhóm publish và CA sửa trong tệp',
    /publishGroups/.test((await text(page, `${ED} [data-role="mqtt-note"]`)) ?? ''),
  );

  // ---------- 2. Sửa tại chỗ ----------
  await setField(page, 'cn-channel-host', 'broker có dấu');
  const hostErr = await text(page, `${ED} #cn-channel-host-e`);
  check('host có dấu cách: lỗi tại ô', /Host/.test(hostErr ?? ''), hostErr);
  await setField(page, 'cn-channel-host', 'broker.plant.local');
  await waitFor(page, () => !document.querySelector('mat-connections-editor #cn-channel-host-e'));
  await setField(page, 'cn-channel-mqttUsername', 'site7');
  await setField(page, 'cn-channel-mqttSecretId', 'mqtt-mqtt1');
  await waitFor(page, () =>
    /--set-secret mqtt-mqtt1/.test(
      document.querySelector('mat-connections-editor #cn-channel-mqttSecretId-w')?.textContent ??
        '',
    ),
  );
  check(
    'tài khoản không TLS: cảnh báo tại ô tên đăng nhập',
    /không mã hóa/.test((await text(page, `${ED} #cn-channel-mqttUsername-w`)) ?? ''),
  );
  await page.click(`${ED} #cn-channel-mqttTls`);
  await waitFor(page, () =>
    /chưa ghim/.test(
      document.querySelector('mat-connections-editor #cn-channel-mqttCertSha256-w')?.textContent ??
        '',
    ),
  );
  check('TLS bật mà chưa ghim chứng chỉ: cảnh báo tại ô SHA-256', true);
  await setField(page, 'cn-channel-mqttCertSha256', 'AB'.repeat(32));
  await waitFor(
    page,
    () => !document.querySelector('mat-connections-editor #cn-channel-mqttCertSha256-w'),
  );
  check(
    'SHA-256 ghi chữ thường; chữ phụ MQTT TLS, cổng 8883',
    (await fieldValue(page, 'cn-channel-mqttCertSha256')) === 'ab'.repeat(32) &&
      (await text(page, `${ED} [data-node="channel:mqtt1"] .sub`)) === 'MQTT TLS' &&
      (await text(page, `${ED} [data-node="fdev:broker1"] .sub`)) === 'broker.plant.local:8883',
  );
  await shot('1-kenh-mqtt');
  await axeBoth(page, axe, 'form kênh MQTT');

  // ---------- 3. Broker: không Thử kết nối, một broker mỗi kênh ----------
  await page.click(`${ED} [data-node="fdev:broker1"]`);
  await page.waitForSelector(`${ED} [data-role="mqtt-probe"]`);
  check(
    'broker: ghi chú Chẩn đoán thay Thử kết nối',
    !(await page.$(`${ED} [data-role="probe-run"]`)) &&
      /Chẩn đoán/.test((await text(page, `${ED} [data-role="mqtt-probe"]`)) ?? ''),
  );
  check(
    'Thêm thiết bị khóa: một broker mỗi kênh',
    (await attr(page, `${ED} [data-act="add-device"]`, 'aria-disabled')) === 'true' &&
      /broker/.test((await attr(page, `${ED} [data-act="add-device"]`, 'title')) ?? ''),
  );

  // ---------- 4. Bảng Tag: topic và đường dẫn JSON ----------
  await treeNode(page, 'tags');
  await page.waitForSelector(`${GRID} [role="gridcell"]`);
  await page.select(`${GRID} select[data-role="set"]`, 'external');
  const row = await page.evaluate(() =>
    window.__matApp.store.state.outline.tags.tags.findIndex(
      (t) => t.kind === 'external' && t.type === 'FLOAT32' && t.source?.device === 'plc1',
    ),
  );
  check('có Tag FLOAT32 của plc1 để chuyển sang broker', row >= 0, row);
  await clickCell(page, GRID, row, 'device');
  await typeInCell(page, 'broker1');
  await clickCell(page, GRID, row, 'address');
  await typeInCell(page, 'Plant/+/Data|$.temp');
  await clickCell(page, GRID, row, 'address');
  await page.waitForSelector(`${GRID} [data-role="addr-hint"]`);
  check(
    'topic giữ chữ hoa; gợi ý: nhận · topic · trường · QoS 0',
    (await gridText(page, gridCell(GRID, row, 'address'))) === 'Plant/+/Data|$.temp' &&
      /nhận · topic Plant\/\+\/Data · trường \$\.temp · QoS 0/.test(
        (await text(page, `${GRID} [data-role="addr-hint"]`)) ?? '',
      ),
    await text(page, `${GRID} [data-role="addr-hint"]`),
  );
  await typeInCell(page, 'pub:plant/+/sp');
  await clickCell(page, GRID, row, 'address');
  await waitFor(page, () =>
    document.querySelector('mat-tag-grid [data-role="addr-hint"]')?.classList.contains('field-err'),
  );
  check(
    'pub có wildcard: lỗi tiếng Việt kèm cú pháp',
    /Địa chỉ MQTT/.test((await text(page, `${GRID} [data-role="addr-hint"]`)) ?? ''),
  );
  await shot('2-bang-tag-mqtt');
  await axeBoth(page, axe, 'Bảng Tag với Tag MQTT');
}
