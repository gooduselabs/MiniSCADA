// Ca `v11-bacnet-*` của bộ vector project (feature 020: driver BACnet/IP; specs/020-driver-bacnet/spec.md FR-005..FR-007,
// FR-011). Được v11.mjs gọi (bacnetCases); mô tả ở README-020.md. Dùng chung TS (vectors-11.test.ts) và C++
// (vectors_11_test.cpp).
//
// Mỗi ca thêm kênh `bms` (BACnet/IP, thiết bị `ahu1`) và các Tag BACnet vào base11, rồi sửa.
import { base11 } from './v11.mjs';

const CF = 'connections.json';
const TF = 'tags.json';

const bacnetChannel = () => ({
  id: 'bms',
  name: 'BMS tòa nhà',
  kind: 'bacnet',
  bacnet: { localPort: 47808 },
  devices: [{ id: 'ahu1', name: 'AHU tầng 1', deviceInstance: 1001, host: '192.168.20.50' }],
});

const bacnetTags = () => [
  {
    id: 'AHU1.NHIET_DO',
    kind: 'external',
    type: 'FLOAT32',
    unit: '°C',
    source: { device: 'ahu1', address: 'AI:1' },
  },
  {
    id: 'AHU1.DAT',
    kind: 'external',
    type: 'FLOAT32',
    access: 'RW',
    limits: { min: 16, max: 30 },
    source: { device: 'ahu1', address: 'AV:5@8' },
  },
  {
    id: 'AHU1.CHAY',
    kind: 'external',
    type: 'BOOL',
    access: 'RW',
    source: { device: 'ahu1', address: 'BO:2' },
  },
  {
    id: 'AHU1.CHE_DO',
    kind: 'external',
    type: 'UINT16',
    source: { device: 'ahu1', address: 'MSV:3', scanGroup: 'slow' },
  },
  {
    id: 'AHU1.CO',
    kind: 'external',
    type: 'UINT16',
    source: { device: 'ahu1', address: 'AI:1:status-flags' },
  },
  {
    id: 'AHU1.TEN',
    kind: 'external',
    type: 'STRING',
    source: {
      device: 'ahu1',
      address: 'DEV:1001:object-name',
      stringLength: 32,
      scanGroup: 'slow',
    },
  },
  {
    id: 'AHU1.NHA_8',
    kind: 'external',
    type: 'BOOL',
    access: 'RW',
    source: { device: 'ahu1', address: 'AV:5:relinquish@8', readback: false },
  },
];

const withBacnet = (f) => {
  f[CF].channels.push(bacnetChannel());
  f[TF].tags.push(...bacnetTags());
  return f;
};
const tag = (f, id) => f[TF].tags.find((t) => t.id === id);
const ch = (f) => f[CF].channels.at(-1);
const at = (code, path, file = TF) => ({ code, file, path });

/** `ok`, `bad`: các hàm thêm ca của v11.mjs; `to10`: hạ project về 1.0 (bỏ phần chỉ có ở 1.1). */
export function bacnetCases(ok, bad, to10) {
  const bac = (mutate) => (f) => {
    withBacnet(f);
    mutate(f);
  };
  const first = base11()[TF].tags.length;
  const chIndex = base11()[CF].channels.length;
  const tagIndex = (id) => first + bacnetTags().findIndex((t) => t.id === id);
  const badAddr = (name, id, address, code, more = {}) =>
    bad(
      name,
      bac((f) => {
        Object.assign(tag(f, id), more);
        tag(f, id).source.address = address;
      }),
      [code],
      undefined,
      { issues: [at(code, `/tags/${tagIndex(id)}/source/address`)] },
    );
  const badSchema = (name, mutate) => bad(name, bac(mutate), ['E_SCHEMA']);

  // ================= hợp lệ =================
  ok(
    'v11-bacnet-valid',
    bac(() => {}),
  );
  ok(
    'v11-bacnet-valid-bbmd-router',
    bac((f) => {
      ch(f).bacnet = {
        localPort: 47809,
        bindAddress: '192.168.20.2',
        broadcast: '192.168.20.255',
        bbmd: { host: 'bbmd.toa-nha.local', ttlS: 600 },
        reconnectMaxS: 30,
      };
      ch(f).devices.push({
        id: 'vav7',
        name: 'VAV sau router MS/TP',
        deviceInstance: 7,
        host: '192.168.20.10',
        network: 5,
        mac: '07',
        maxApdu: 480,
        timeoutMs: 400,
        retries: 1,
        writePriority: 10,
        useRpm: false,
        maxRpmProps: 16,
      });
      f[TF].tags.push({
        id: 'VAV7.GIO',
        kind: 'external',
        type: 'FLOAT32',
        access: 'RW',
        limits: { min: 0, max: 100 },
        source: { device: 'vav7', address: 'AO:1' },
      });
    }),
  );
  ok(
    'v11-bacnet-valid-property-number',
    bac((f) =>
      f[TF].tags.push({
        id: 'AHU1.P65',
        kind: 'external',
        type: 'FLOAT64',
        source: { device: 'ahu1', address: 'AI:1:65' },
      }),
    ),
  );
  // W_DETECT_SLOW: 3000 ms x (2 + 1) vượt chu kỳ normal 1000 ms
  ok(
    'v11-bacnet-detect-slow',
    bac((f) => Object.assign(ch(f).devices[0], { timeoutMs: 3000, retries: 2 })),
    ['W_DETECT_SLOW'],
  );

  // ================= địa chỉ =================
  badAddr('v11-bacnet-addr-syntax-type', 'AHU1.NHIET_DO', 'XX:1', 'E_ADDR_SYNTAX');
  badAddr('v11-bacnet-addr-syntax-property', 'AHU1.NHIET_DO', 'AI:1:gia-tri', 'E_ADDR_SYNTAX');
  badAddr('v11-bacnet-addr-syntax-modbus', 'AHU1.NHIET_DO', 'HR100', 'E_ADDR_SYNTAX');
  badAddr('v11-bacnet-addr-syntax-relinquish', 'AHU1.NHA_8', 'AV:5:relinquish', 'E_ADDR_SYNTAX');
  badAddr('v11-bacnet-addr-range-instance', 'AHU1.NHIET_DO', 'AI:4194303', 'E_ADDR_RANGE');
  badAddr('v11-bacnet-addr-range-priority', 'AHU1.DAT', 'AV:5@17', 'E_ADDR_RANGE');
  badAddr('v11-bacnet-addr-range-priority6', 'AHU1.DAT', 'AV:5@6', 'E_ADDR_RANGE');
  badAddr('v11-bacnet-addr-area-write-input', 'AHU1.NHIET_DO', 'AI:1', 'E_ADDR_AREA', {
    access: 'RW',
  });
  badAddr('v11-bacnet-addr-area-priority-input', 'AHU1.NHIET_DO', 'AI:1@8', 'E_ADDR_AREA');
  badAddr('v11-bacnet-addr-area-type', 'AHU1.CHAY', 'AV:1', 'E_ADDR_AREA');
  badAddr('v11-bacnet-addr-area-flags-type', 'AHU1.CO', 'AI:1:object-name', 'E_ADDR_AREA');
  badAddr('v11-bacnet-addr-area-device-pv', 'AHU1.CHE_DO', 'DEV:1001', 'E_ADDR_AREA');

  // ================= schema =================
  badSchema('v11-bacnet-schema-no-host', (f) => delete ch(f).devices[0].host);
  badSchema('v11-bacnet-schema-no-instance', (f) => delete ch(f).devices[0].deviceInstance);
  badSchema('v11-bacnet-schema-instance-range', (f) => (ch(f).devices[0].deviceInstance = 4194303));
  badSchema('v11-bacnet-schema-priority-6', (f) => (ch(f).devices[0].writePriority = 6));
  badSchema('v11-bacnet-schema-mac-no-network', (f) => (ch(f).devices[0].mac = '07'));
  badSchema('v11-bacnet-schema-mac-hex', (f) =>
    Object.assign(ch(f).devices[0], { network: 5, mac: '7' }),
  );
  badSchema('v11-bacnet-schema-max-apdu', (f) => (ch(f).devices[0].maxApdu = 2000));
  badSchema('v11-bacnet-schema-modbus-key', (f) => (ch(f).devices[0].unitId = 1));
  badSchema('v11-bacnet-schema-tcp-key', (f) => (ch(f).tcp = { host: '1.2.3.4' }));
  badSchema('v11-bacnet-schema-broadcast', (f) => (ch(f).bacnet.broadcast = 'tat-ca'));

  // ================= tham chiếu, phiên bản =================
  bad(
    'v11-bacnet-ref-device',
    bac((f) => (tag(f, 'AHU1.CHAY').source.device = 'ahu9')),
    ['E_REF_DEVICE'],
    undefined,
    { issues: [at('E_REF_DEVICE', `/tags/${tagIndex('AHU1.CHAY')}/source/device`)] },
  );
  bad(
    'v11-bacnet-version-channel-in-1.0',
    bac((f) => to10(f)),
    ['E_CHANNEL_VERSION'],
    undefined,
    { issues: [at('E_CHANNEL_VERSION', `/channels/${chIndex}/kind`, CF)] },
  );
}
