// Ca `v11-mc-*` (feature 017, specs/017-driver-mc/plan.md "Hợp đồng định dạng"; README-017.md): kênh Mitsubishi MC
// (`kind: "mc"`), thiết bị MC và địa chỉ Tag MC. Kết quả viết tay.
const C = 'connections.json';
const T = 'tags.json';

/** Kênh MC hai thiết bị: FX5 (X/Y bát phân) và Q (mặc định). */
export const mcChannel = () => ({
  id: 'plc-mc',
  name: 'PLC Mitsubishi',
  kind: 'mc',
  tcp: { host: '192.168.3.39', port: 5007 },
  devices: [
    { id: 'fx5u', name: 'FX5U dây chuyền 1', xyNotation: 'octal', timeoutMs: 200 },
    { id: 'q03', name: 'Q03UDE', network: 0, station: 255, moduleIo: 1023, moduleStation: 0 },
  ],
});

const ext = (id, type, device, address, more = {}) => ({
  id,
  kind: 'external',
  type,
  ...more,
  source: { device, address, ...(more.source ?? {}) },
});

/** Tag của mọi thiết bị và kiểu ở FR-003, FR-004. */
export const mcTags = () => [
  ext('MC.D100', 'INT16', 'q03', 'D100'),
  ext('MC.D101', 'UINT16', 'q03', 'D101'),
  ext('MC.D200', 'FLOAT32', 'q03', 'D200'),
  ext('MC.D202', 'FLOAT64', 'q03', 'D202'),
  ext('MC.D300', 'INT32', 'q03', 'D300'),
  ext('MC.D302', 'UINT32', 'q03', 'D302'),
  ext('MC.D400', 'STRING', 'q03', 'D400', { source: { stringLength: 10 } }),
  ext('MC.D100_5', 'BOOL', 'q03', 'D100.5'),
  ext('MC.ZR1000', 'INT32', 'q03', 'ZR1000'),
  ext('MC.R10', 'INT16', 'q03', 'R10'),
  ext('MC.W1A', 'UINT16', 'q03', 'W1A'),
  ext('MC.SD210', 'UINT16', 'q03', 'SD210'),
  ext('MC.TN0', 'INT16', 'q03', 'TN0'),
  ext('MC.CN3', 'INT16', 'q03', 'CN3'),
  ext('MC.M10', 'BOOL', 'q03', 'M10', { access: 'RW' }),
  ext('MC.X1F', 'BOOL', 'q03', 'X1F'),
  ext('MC.Y20', 'BOOL', 'q03', 'Y20', { access: 'RW' }),
  ext('MC.B1F', 'BOOL', 'q03', 'B1F'),
  ext('MC.L5', 'BOOL', 'q03', 'L5'),
  ext('MC.SM400', 'BOOL', 'q03', 'SM400'),
  ext('MC.FX_X17', 'BOOL', 'fx5u', 'X17'),
  ext('MC.FX_D0', 'FLOAT32', 'fx5u', 'D0', {
    access: 'RW',
    limits: { min: 0, max: 100 },
    source: { byteOrder: 'ABCD', scanGroup: 'fast' },
  }),
];

const withMc = (f, tags = mcTags()) => {
  f[C].channels.push(mcChannel());
  f[T].tags.push(...tags);
};
const dev = (f, i) => f[C].channels[2].devices[i];
const lastTag = (f) => f[T].tags[f[T].tags.length - 1];
const at = (code, path, file = T) => ({ code, file, path });
const iss = (...issues) => ({ issues });

/** `ok`, `bad` như cases11 (v11.mjs); `to10` hạ project về 1.0. */
export function mcCases(ok, bad, to10) {
  // ---------- hợp lệ ----------
  ok('v11-mc-valid', (f) => withMc(f));
  ok('v11-mc-valid-options', (f) => {
    withMc(f);
    f[C].channels[2].mc = { frame: '4E', code: 'ascii', transport: 'udp' };
    f[C].channels[2].tcp = {
      host: 'plc-mc.local',
      port: 1025,
      connectTimeoutMs: 2000,
      reconnectMaxS: 30,
    };
    f[C].channels[2].requestGapMs = 5;
    Object.assign(dev(f, 1), {
      network: 239,
      station: 0,
      moduleIo: 0x03e0,
      moduleStation: 255,
      xyNotation: 'hex',
      timeoutMs: 300,
      retries: 2,
      writeDeadlineMs: 2000,
      maxBatchWords: 480,
      maxGapWords: 0,
      randomRead: false,
      maxRandomPoints: 96,
      write: { registerBit: 'none' },
    });
  });
  ok(
    'v11-mc-bit-rmw',
    (f) => {
      withMc(f);
      dev(f, 1).write = { registerBit: 'rmw' };
      f[T].tags.push(ext('MC.D10_3', 'BOOL', 'q03', 'D10.3', { access: 'RW' }));
      f[T].tags.push(ext('MC.D10_4', 'BOOL', 'q03', 'D10.4', { access: 'RW' }));
    },
    ['W_BIT_RMW'],
    iss(at('W_BIT_RMW', '/channels/2/devices/1', C)),
  );
  ok(
    'v11-mc-detect-slow',
    (f) => {
      withMc(f);
      dev(f, 0).timeoutMs = 300; // nhóm fast 250 ms
    },
    ['W_DETECT_SLOW'],
    iss(at('W_DETECT_SLOW', '/channels/2/devices/0', C)),
  );

  // ---------- phiên bản ----------
  bad(
    'v11-mc-version-in-1.0',
    (f) => {
      to10(f);
      withMc(f);
    },
    ['E_CHANNEL_VERSION'],
    undefined,
    { ...iss(at('E_CHANNEL_VERSION', '/channels/2/kind', C)), runtimeVersion: '1.1.0' },
  );

  // ---------- schema ----------
  bad('v11-mc-schema-frame', (f) => (withMc(f), (f[C].channels[2].mc = { frame: '1E' })), [
    'E_SCHEMA',
  ]);
  bad('v11-mc-schema-modbus-key', (f) => (withMc(f), (dev(f, 1).unitId = 1)), ['E_SCHEMA']);
  bad('v11-mc-schema-network', (f) => (withMc(f), (dev(f, 1).network = 240)), ['E_SCHEMA']);
  bad('v11-mc-schema-batch-words', (f) => (withMc(f), (dev(f, 1).maxBatchWords = 961)), [
    'E_SCHEMA',
  ]);
  bad(
    'v11-mc-schema-register-bit-mask',
    (f) => (withMc(f), (dev(f, 1).write = { registerBit: 'mask' })),
    ['E_SCHEMA'],
  );
  bad('v11-mc-schema-no-tcp', (f) => (withMc(f), delete f[C].channels[2].tcp), ['E_SCHEMA']);

  // ---------- địa chỉ ----------
  const addr = (name, address, type, code, more = {}) =>
    bad(
      name,
      (f) => {
        withMc(f);
        f[T].tags.push(ext('MC.BAD', type, more.device ?? 'q03', address, more.tag ?? {}));
      },
      [code],
      undefined,
      { issues: [at(code, `/tags/${26 + mcTags().length}/source/address`)] },
    );
  addr('v11-mc-addr-unknown-device', 'Q100', 'INT16', 'E_ADDR_SYNTAX');
  addr('v11-mc-addr-modbus-on-mc', 'HR100', 'INT16', 'E_ADDR_SYNTAX');
  addr('v11-mc-addr-octal-8', 'X18', 'BOOL', 'E_ADDR_SYNTAX', { device: 'fx5u' });
  addr('v11-mc-addr-bit-device-int', 'M10', 'INT16', 'E_ADDR_AREA');
  addr('v11-mc-addr-word-bool', 'D100', 'BOOL', 'E_ADDR_AREA');
  addr('v11-mc-addr-x-rw', 'X10', 'BOOL', 'E_ADDR_AREA', { tag: { access: 'RW' } });
  addr('v11-mc-addr-range', 'D16777215', 'INT32', 'E_ADDR_RANGE');
  addr('v11-mc-bit-write', 'D10.3', 'BOOL', 'E_BIT_WRITE', { tag: { access: 'RW' } });
  bad(
    'v11-mc-addr-mc-on-modbus',
    (f) => {
      withMc(f);
      f[T].tags.push(ext('MC.BAD', 'INT16', 'plc1', 'D100'));
    },
    ['E_ADDR_SYNTAX'],
  );
  bad(
    'v11-mc-read-limit',
    (f) => {
      withMc(f);
      dev(f, 1).maxBatchWords = 4;
    },
    ['E_ADDR_READ_LIMIT'],
    undefined,
    iss(at('E_ADDR_READ_LIMIT', `/tags/${26 + 6}/source`)),
  );
  bad(
    'v11-mc-device-dup',
    (f) => {
      withMc(f);
      dev(f, 0).id = 'plc1';
      lastTag(f).source.device = 'plc1'; // thiết bị Modbus cùng id: Tag trỏ về thiết bị đầu tiên
      f[T].tags.splice(f[T].tags.length - 2, 1);
    },
    ['E_DUP_ID', 'E_ADDR_SYNTAX'],
  );
  bad('v11-mc-ref-device', (f) => (withMc(f), (lastTag(f).source.device = 'khong-co')), [
    'E_REF_DEVICE',
  ]);
}
