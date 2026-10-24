// Ca `v11-fins-*` của bộ vector project (feature 018: driver Omron FINS; specs/018-driver-fins/spec.md FR-011). Được
// v11.mjs gọi (finsCases); mô tả ở README-018.md. Dùng chung TS (vectors-11.test.ts) và C++ (vectors_11_test.cpp).
//
// Mỗi ca thêm kênh `omron1` (FINS/UDP, thiết bị `cj2`) và các Tag FINS vào base11, rồi sửa.
import { base11 } from './v11.mjs';

const CF = 'connections.json';
const TF = 'tags.json';

const finsChannel = () => ({
  id: 'omron1',
  name: 'PLC Omron CJ2',
  kind: 'fins',
  fins: { host: '192.168.10.20', port: 9600, transport: 'udp', sourceNode: 0 },
  devices: [{ id: 'cj2', name: 'CJ2M', node: 20, unit: 0 }],
});

const finsTags = () => [
  {
    id: 'OMRON.LEVEL',
    kind: 'external',
    type: 'INT16',
    source: { device: 'cj2', address: 'D100' },
  },
  {
    id: 'OMRON.FLOW',
    kind: 'external',
    type: 'FLOAT32',
    source: { device: 'cj2', address: 'D200', scanGroup: 'slow' },
  },
  {
    id: 'OMRON.RUN',
    kind: 'external',
    type: 'BOOL',
    access: 'RW',
    source: { device: 'cj2', address: 'W5.00' },
  },
  {
    id: 'OMRON.IN3',
    kind: 'external',
    type: 'BOOL',
    source: { device: 'cj2', address: 'CIO10.03' },
  },
  {
    id: 'OMRON.EM',
    kind: 'external',
    type: 'UINT32',
    source: { device: 'cj2', address: 'E0_100' },
  },
  { id: 'OMRON.T5_DONE', kind: 'external', type: 'BOOL', source: { device: 'cj2', address: 'T5' } },
  {
    id: 'OMRON.C12',
    kind: 'external',
    type: 'UINT16',
    access: 'RW',
    limits: { min: 0, max: 9999 },
    source: { device: 'cj2', address: 'C12', bcd: true },
  },
  {
    id: 'OMRON.NAME',
    kind: 'external',
    type: 'STRING',
    source: { device: 'cj2', address: 'D500', stringLength: 10 },
  },
];

const withFins = (f) => {
  f[CF].channels.push(finsChannel());
  f[TF].tags.push(...finsTags());
  return f;
};
const tag = (f, id) => f[TF].tags.find((t) => t.id === id);
const at = (code, path, file = TF) => ({ code, file, path });

/** `ok`, `bad`: các hàm thêm ca của v11.mjs; `to10`: hạ project về 1.0 (bỏ phần chỉ có ở 1.1). */
export function finsCases(ok, bad, to10) {
  const fins = (mutate) => (f) => {
    withFins(f);
    mutate(f);
  };
  // vị trí Tag FINS: sau mọi Tag của base11
  const first = base11()[TF].tags.length;
  const tagIndex = (id) => first + finsTags().findIndex((t) => t.id === id);
  const bad1 = (name, mutate, code, id, rest, warnings) =>
    bad(name, fins(mutate), [code], warnings, {
      issues: [at(code, `/tags/${tagIndex(id)}${rest}`)],
    });

  // ================= hợp lệ =================
  ok(
    'v11-fins-valid-udp',
    fins(() => {}),
  );
  ok(
    'v11-fins-valid-tcp-routed',
    fins((f) => {
      const ch = f[CF].channels.at(-1);
      ch.fins = {
        host: 'plc-omron.local',
        transport: 'tcp',
        sourceNetwork: 1,
        connectTimeoutMs: 5000,
      };
      ch.devices = [
        { id: 'cj2', name: 'CJ2M', network: 2, node: 0, unit: 0, timeoutMs: 400, retries: 0 },
        { id: 'cs1', name: 'CS1 sau cầu nối', network: 3, node: 7, unit: 0, maxReadWords: 500 },
      ];
    }),
  );
  ok(
    'v11-fins-valid-all-areas',
    fins((f) => {
      f[TF].tags.push(
        {
          id: 'F.H',
          kind: 'external',
          type: 'UINT16',
          source: { device: 'cj2', address: 'H1535' },
        },
        { id: 'F.A', kind: 'external', type: 'UINT16', source: { device: 'cj2', address: 'A100' } },
        {
          id: 'F.A_RW',
          kind: 'external',
          type: 'UINT16',
          access: 'RW',
          limits: { min: 0, max: 10 },
          source: { device: 'cj2', address: 'A448' },
        },
        {
          id: 'F.EC',
          kind: 'external',
          type: 'FLOAT64',
          source: { device: 'cj2', address: 'EC_32764' },
        },
        { id: 'F.T', kind: 'external', type: 'INT16', source: { device: 'cj2', address: 'T4095' } },
        {
          id: 'F.D0',
          kind: 'external',
          type: 'BOOL',
          source: { device: 'cj2', address: 'D00000.15' },
        },
        {
          id: 'F.BCD32',
          kind: 'external',
          type: 'UINT32',
          source: { device: 'cj2', address: 'D600', bcd: true },
        },
        {
          id: 'F.SCALED',
          kind: 'external',
          type: 'FLOAT32',
          source: { device: 'cj2', address: 'D700', rawType: 'INT16' },
          scaling: { rawMin: 0, rawMax: 4000, engMin: 0, engMax: 100 },
        },
      );
    }),
  );
  ok(
    'v11-fins-valid-disabled',
    fins((f) => {
      f[CF].channels.at(-1).enabled = false;
    }),
  );

  // ================= địa chỉ =================
  bad1(
    'v11-fins-addr-syntax-bit16',
    (f) => (tag(f, 'OMRON.RUN').source.address = 'W5.16'),
    'E_ADDR_SYNTAX',
    'OMRON.RUN',
    '/source/address',
  );
  bad1(
    'v11-fins-addr-syntax-modbus',
    (f) => (tag(f, 'OMRON.LEVEL').source.address = 'HR100'),
    'E_ADDR_SYNTAX',
    'OMRON.LEVEL',
    '/source/address',
  );
  bad1(
    'v11-fins-addr-syntax-em-bank',
    (f) => (tag(f, 'OMRON.EM').source.address = 'ED_100'),
    'E_ADDR_SYNTAX',
    'OMRON.EM',
    '/source/address',
  );
  bad1(
    'v11-fins-addr-area-bool-word',
    (f) => (tag(f, 'OMRON.IN3').source.address = 'CIO10'),
    'E_ADDR_AREA',
    'OMRON.IN3',
    '/source/address',
  );
  bad1(
    'v11-fins-addr-area-flag-rw',
    (f) => (tag(f, 'OMRON.T5_DONE').access = 'RW'),
    'E_ADDR_AREA',
    'OMRON.T5_DONE',
    '/source/address',
  );
  bad1(
    'v11-fins-addr-area-aux-read-only',
    (f) => {
      const t = tag(f, 'OMRON.C12');
      t.source = { device: 'cj2', address: 'A100' };
    },
    'E_ADDR_AREA',
    'OMRON.C12',
    '/source/address',
  );
  bad1(
    'v11-fins-addr-area-timer-dint',
    (f) => (tag(f, 'OMRON.EM').source.address = 'T5'),
    'E_ADDR_AREA',
    'OMRON.EM',
    '/source/address',
  );
  bad1(
    'v11-fins-addr-range-dm',
    (f) => (tag(f, 'OMRON.FLOW').source.address = 'D32767'),
    'E_ADDR_RANGE',
    'OMRON.FLOW',
    '/source/address',
  );
  bad1(
    'v11-fins-addr-range-work',
    (f) => (tag(f, 'OMRON.LEVEL').source.address = 'W512'),
    'E_ADDR_RANGE',
    'OMRON.LEVEL',
    '/source/address',
  );
  bad1(
    'v11-fins-read-limit',
    (f) => {
      f[CF].channels.at(-1).devices[0].maxReadWords = 4;
    },
    'E_ADDR_READ_LIMIT',
    'OMRON.NAME',
    '/source',
  );
  bad1(
    'v11-fins-read-limit-string',
    (f) => {
      const t = tag(f, 'OMRON.NAME');
      t.source.stringLength = 250;
      f[CF].channels.at(-1).devices[0].maxReadWords = 100;
    },
    'E_ADDR_READ_LIMIT',
    'OMRON.NAME',
    '/source',
  );

  // ================= BCD =================
  bad1(
    'v11-fins-bcd-float',
    (f) => (tag(f, 'OMRON.FLOW').source.bcd = true),
    'E_SCHEMA',
    'OMRON.FLOW',
    '/source/bcd',
  );
  bad1(
    'v11-fins-bcd-int64',
    (f) => {
      const t = tag(f, 'OMRON.EM');
      t.type = 'INT64';
      t.source.bcd = true;
    },
    'E_SCHEMA',
    'OMRON.EM',
    '/source/bcd',
  );
  bad(
    'v11-fins-bcd-on-modbus',
    fins((f) => (f[TF].tags[0].source.bcd = true)),
    ['E_SCHEMA'],
    undefined,
    { issues: [at('E_SCHEMA', '/tags/0/source/bcd')] },
  );

  // ================= schema =================
  bad(
    'v11-fins-schema-transport',
    fins((f) => (f[CF].channels.at(-1).fins.transport = 'serial')),
    ['E_SCHEMA'],
  );
  bad(
    'v11-fins-schema-node-255',
    fins((f) => (f[CF].channels.at(-1).devices[0].node = 255)),
    ['E_SCHEMA'],
  );
  bad(
    'v11-fins-schema-network-128',
    fins((f) => (f[CF].channels.at(-1).devices[0].network = 128)),
    ['E_SCHEMA'],
  );
  bad(
    'v11-fins-schema-max-read-1000',
    fins((f) => (f[CF].channels.at(-1).devices[0].maxReadWords = 1000)),
    ['E_SCHEMA'],
  );
  bad(
    'v11-fins-schema-modbus-key',
    fins((f) => (f[CF].channels.at(-1).devices[0].unitId = 1)),
    ['E_SCHEMA'],
  );
  bad(
    'v11-fins-schema-no-host',
    fins((f) => delete f[CF].channels.at(-1).fins.host),
    ['E_SCHEMA'],
  );
  bad(
    'v11-fins-schema-bcd-type',
    fins((f) => (tag(f, 'OMRON.C12').source.bcd = 'yes')),
    ['E_SCHEMA'],
  );

  // ================= luật chung vẫn chạy =================
  bad(
    'v11-fins-ref-device',
    fins((f) => (tag(f, 'OMRON.LEVEL').source.device = 'cj9')),
    ['E_REF_DEVICE'],
  );
  bad(
    'v11-fins-dup-device-id',
    fins((f) => (f[CF].channels.at(-1).devices[0].id = 'plc1')),
    ['E_DUP_ID', 'E_REF_DEVICE'],
  );
  ok(
    'v11-fins-detect-slow',
    fins((f) => {
      f[CF].channels.at(-1).devices[0].timeoutMs = 1000;
    }),
    ['W_DETECT_SLOW'],
    { issues: [at('W_DETECT_SLOW', `/channels/2/devices/0`, CF)] },
  );
  ok(
    'v11-fins-tcp-default-no-retry',
    fins((f) => {
      f[CF].channels.at(-1).fins.transport = 'tcp';
      f[CF].channels.at(-1).devices[0].timeoutMs = 1000;
    }),
  );

  // ================= E_CHANNEL_VERSION =================
  bad(
    'v11-fins-version-channel-in-1.0',
    (f) => {
      withFins(f);
      to10(f);
      for (const t of f[TF].tags) if (t.source?.bcd !== undefined) delete t.source.bcd;
    },
    ['E_CHANNEL_VERSION'],
    undefined,
    { issues: [at('E_CHANNEL_VERSION', '/channels/2/kind', CF)] },
  );
  bad(
    'v11-fins-version-bcd-in-1.0',
    (f) => {
      withFins(f);
      to10(f);
    },
    ['E_CHANNEL_VERSION'],
    undefined,
    { issues: [at('E_CHANNEL_VERSION', `/tags/${tagIndex('OMRON.C12')}/source/bcd`)] },
  );
}
