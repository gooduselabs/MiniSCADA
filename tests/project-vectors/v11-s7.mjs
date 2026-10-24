// Ca `v11-s7-*` (feature 016, specs/016-driver-s7/contracts/s7-driver.md §1, §2; README-016.md): kênh `s7` và địa chỉ
// Tag S7 trong định dạng 1.1. Được v11.mjs gọi (`s7Cases`), base là base11(). Kết quả viết tay.
const C = 'connections.json';
const T = 'tags.json';

/** Kênh S7-1200 (rack 0, slot 1, PDU 480) với một CPU. */
export const s7Channel = () => ({
  id: 's7-1',
  name: 'PLC S7-1200',
  kind: 's7',
  tcp: { host: '192.168.0.10', port: 102 },
  s7: { rack: 0, slot: 1, pduSize: 480 },
  devices: [{ id: 'cpu1', name: 'CPU 1214C', timeoutMs: 200 }],
});

const ext = (id, type, address, extra = {}) => ({
  id,
  kind: 'external',
  type,
  source: { device: 'cpu1', address, ...(extra.source ?? {}) },
  ...(extra.access ? { access: extra.access } : {}),
  ...(extra.limits ? { limits: extra.limits } : {}),
});

/** Mỗi kiểu S7 một Tag (đọc), vài Tag ghi. */
export const s7Tags = () => [
  ext('S7.DB_BOOL', 'BOOL', 'DB1.DBX0.0'),
  ext('S7.DB_BYTE', 'UINT16', 'DB1.DBB1'),
  ext('S7.DB_INT', 'INT16', 'DB1.DBW2'),
  ext('S7.DB_WORD', 'UINT16', 'DB1.DBW4'),
  ext('S7.DB_DINT', 'INT32', 'DB1.DBD6'),
  ext('S7.DB_DWORD', 'UINT32', 'DB1.DBD10'),
  ext('S7.DB_REAL', 'FLOAT32', 'DB1.DBD14'),
  ext('S7.DB_LREAL', 'FLOAT64', 'DB1.LREAL18'),
  ext('S7.DB_CHAR', 'STRING', 'DB1.DBB26', { source: { stringLength: 1 } }),
  ext('S7.DB_STRING', 'STRING', 'DB1.STRING32', { source: { stringLength: 20 } }),
  ext('S7.M_BOOL', 'BOOL', 'M0.1', { source: { scanGroup: 'fast' } }),
  ext('S7.M_REAL', 'FLOAT32', 'MD20'),
  ext('S7.I_BOOL', 'BOOL', 'E0.1'),
  ext('S7.I_WORD', 'INT16', 'IW2'),
  ext('S7.Q_BOOL', 'BOOL', 'Q0.0', { access: 'RW' }),
  ext('S7.SP', 'FLOAT32', 'DB1.DBD64', { access: 'RW', limits: { min: 0, max: 100 } }),
  ext('S7.NAME', 'STRING', 'DB1.STRING70', { access: 'RW', source: { stringLength: 10 } }),
];

/** Thêm kênh S7 và các Tag của nó vào project 1.1. */
export function withS7(f, mutate) {
  f[C].channels.push(s7Channel());
  f[T].tags.push(...s7Tags());
  if (mutate) mutate(f[C].channels[f[C].channels.length - 1], f[T].tags, f);
}

const at = (code, path, file) => ({ code, file, path });
const iss = (...issues) => ({ issues });

/** Đặt địa chỉ (và rawType, stringLength, access) của Tag S7.DB_INT. */
const setTag = (tags, patch) => {
  const t = tags.find((x) => x.id === 'S7.DB_INT');
  Object.assign(t, patch.tag ?? {});
  Object.assign(t.source, patch.source ?? {});
};

export function s7Cases(ok, bad, to10, base) {
  const n = base()[T].tags.length; // Tag S7 bắt đầu ở chỉ số n
  const s7At = (id) => n + s7Tags().findIndex((t) => t.id === id);
  // ---------- hợp lệ ----------
  ok('v11-s7-valid-channel', (f) => withS7(f));
  ok('v11-s7-valid-tsap', (f) =>
    withS7(f, (ch) => (ch.s7 = { localTsap: '1000', remoteTsap: '0301', pduSize: 960 })),
  );
  ok(
    'v11-s7-valid-defaults',
    (f) =>
      withS7(f, (ch) => {
        delete ch.s7;
        ch.tcp = { host: 'plc-s7.local' };
        ch.devices = [{ id: 'cpu1', name: 'CPU' }];
      }),
    ['W_DETECT_SLOW'], // timeoutMs mặc định 1000 > nhóm fast 250
  );
  ok('v11-s7-valid-no-device', (f) => {
    f[C].channels.push({ ...s7Channel(), devices: [] });
  });
  ok('v11-s7-valid-pdu-240-limits', (f) =>
    withS7(f, (ch, tags) => {
      ch.s7.pduSize = 240;
      // đọc 222 byte = 240 - 18; ghi 212 byte = 240 - 28
      tags.push(ext('S7.LONG_R', 'STRING', 'DB2.STRING0', { source: { stringLength: 220 } }));
      tags.push(
        ext('S7.LONG_W', 'STRING', 'DB2.DBB300', { access: 'RW', source: { stringLength: 212 } }),
      );
    }),
  );
  ok('v11-s7-valid-max-address', (f) =>
    withS7(f, (_, tags) => tags.push(ext('S7.MAX', 'BOOL', 'db65535.dbx65535.7'))),
  );
  ok('v11-s7-valid-german-mnemonics', (f) =>
    withS7(f, (_, tags) => {
      tags.push(ext('S7.E_BYTE', 'UINT16', 'EB0'));
      tags.push(ext('S7.A_WORD', 'UINT16', 'AW2', { access: 'RW', limits: { min: 0, max: 100 } }));
    }),
  );
  ok('v11-s7-valid-detect-slow', (f) => withS7(f, (ch) => (ch.devices[0].timeoutMs = 2000)), [
    'W_DETECT_SLOW',
  ]);

  // ---------- phiên bản, kết nối ----------
  bad(
    'v11-s7-version-in-1.0',
    (f) => {
      to10(f);
      withS7(f);
      f[C].schemaVersion = f['project.json'].schemaVersion;
      f[T].schemaVersion = f['project.json'].schemaVersion;
    },
    ['E_DRIVER_VERSION'],
    undefined,
    iss(at('E_DRIVER_VERSION', '/channels/2/kind', C)),
  );
  bad(
    'v11-s7-version-in-1.0-no-tags',
    (f) => {
      to10(f);
      f[C].channels.push({ ...s7Channel(), devices: [] });
    },
    ['E_DRIVER_VERSION'],
  );
  bad(
    'v11-s7-tsap-with-rack',
    (f) => withS7(f, (ch) => (ch.s7 = { rack: 0, remoteTsap: '0301' })),
    ['E_S7_TSAP'],
    undefined,
    iss(at('E_S7_TSAP', '/channels/2/s7/remoteTsap', C)),
  );
  bad('v11-s7-tsap-with-slot', (f) => withS7(f, (ch) => (ch.s7.remoteTsap = '0102')), [
    'E_S7_TSAP',
  ]);
  bad(
    'v11-s7-schema-two-devices',
    (f) => withS7(f, (ch) => ch.devices.push({ id: 'cpu2', name: 'CPU 2' })),
    ['E_SCHEMA'],
  );
  bad('v11-s7-schema-pdu-too-small', (f) => withS7(f, (ch) => (ch.s7.pduSize = 200)), ['E_SCHEMA']);
  bad('v11-s7-schema-pdu-too-large', (f) => withS7(f, (ch) => (ch.s7.pduSize = 1024)), [
    'E_SCHEMA',
  ]);
  bad('v11-s7-schema-tsap-not-hex', (f) => withS7(f, (ch) => (ch.s7 = { remoteTsap: '01G0' })), [
    'E_SCHEMA',
  ]);
  bad('v11-s7-schema-slot-32', (f) => withS7(f, (ch) => (ch.s7.slot = 32)), ['E_SCHEMA']);
  bad('v11-s7-schema-modbus-field', (f) => withS7(f, (ch) => (ch.devices[0].unitId = 1)), [
    'E_SCHEMA',
  ]);
  bad('v11-s7-schema-serial', (f) => withS7(f, (ch) => (ch.serial = { port: 'ttyAS2' })), [
    'E_SCHEMA',
  ]);
  bad('v11-s7-schema-no-tcp', (f) => withS7(f, (ch) => delete ch.tcp), ['E_SCHEMA']);

  // ---------- địa chỉ ----------
  bad(
    'v11-s7-addr-syntax-modbus',
    (f) => withS7(f, (_, tags) => setTag(tags, { source: { address: 'HR100' } })),
    ['E_ADDR_SYNTAX'],
    undefined,
    iss(at('E_ADDR_SYNTAX', `/tags/${s7At('S7.DB_INT')}/source/address`, T)),
  );
  bad(
    'v11-s7-addr-syntax-db-no-bit',
    (f) =>
      withS7(f, (_, tags) =>
        setTag(tags, { tag: { type: 'BOOL' }, source: { address: 'DB1.DBX0' } }),
      ),
    ['E_ADDR_SYNTAX'],
  );
  bad(
    'v11-s7-addr-range-db0',
    (f) => withS7(f, (_, tags) => setTag(tags, { source: { address: 'DB0.DBW0' } })),
    ['E_ADDR_RANGE'],
  );
  bad(
    'v11-s7-addr-range-bit8',
    (f) =>
      withS7(f, (_, tags) => setTag(tags, { tag: { type: 'BOOL' }, source: { address: 'M0.8' } })),
    ['E_ADDR_RANGE'],
  );
  bad(
    'v11-s7-addr-range-past-end',
    (f) => withS7(f, (_, tags) => setTag(tags, { source: { address: 'DB1.DBW65535' } })),
    ['E_ADDR_RANGE'],
  );
  bad(
    'v11-s7-addr-type-word-real',
    (f) =>
      withS7(f, (_, tags) =>
        setTag(tags, { tag: { type: 'FLOAT32' }, source: { address: 'MW10' } }),
      ),
    ['E_ADDR_AREA'],
  );
  bad(
    'v11-s7-addr-type-int64',
    (f) =>
      withS7(f, (_, tags) =>
        setTag(tags, { tag: { type: 'INT64' }, source: { address: 'DB1.DBD0' } }),
      ),
    ['E_ADDR_AREA'],
  );
  bad(
    'v11-s7-addr-input-rw',
    (f) =>
      withS7(f, (_, tags) =>
        setTag(tags, {
          tag: { access: 'RW', limits: { min: 0, max: 10 } },
          source: { address: 'IW4' },
        }),
      ),
    ['E_ADDR_AREA'],
  );
  bad(
    'v11-s7-addr-modbus-device-s7-address',
    (f) => withS7(f, () => (f[T].tags[0].source.address = 'DB1.DBW2')),
    ['E_ADDR_SYNTAX'],
  );
  bad(
    'v11-s7-read-limit-string',
    (f) =>
      withS7(f, (ch, tags) => {
        ch.s7.pduSize = 240;
        tags.push(ext('S7.LONG', 'STRING', 'DB2.STRING0', { source: { stringLength: 250 } }));
      }),
    ['E_ADDR_READ_LIMIT'],
    undefined,
    iss(at('E_ADDR_READ_LIMIT', `/tags/${n + s7Tags().length}/source`, T)),
  );
  bad(
    'v11-s7-read-limit-chars',
    (f) =>
      withS7(f, (ch, tags) => {
        ch.s7.pduSize = 240;
        tags.push(ext('S7.LONG', 'STRING', 'DB2.DBB0', { source: { stringLength: 223 } }));
      }),
    ['E_ADDR_READ_LIMIT'],
  );
  bad(
    'v11-s7-write-limit-string',
    (f) =>
      withS7(f, (ch, tags) => {
        ch.s7.pduSize = 240;
        tags.push(
          ext('S7.LONG', 'STRING', 'DB2.STRING0', { access: 'RW', source: { stringLength: 212 } }),
        );
      }),
    ['E_ADDR_WRITE_LIMIT'],
  );
  bad(
    'v11-s7-write-limit-chars',
    (f) =>
      withS7(f, (ch, tags) => {
        ch.s7.pduSize = 240;
        tags.push(
          ext('S7.LONG', 'STRING', 'DB2.DBB0', { access: 'RW', source: { stringLength: 213 } }),
        );
      }),
    ['E_ADDR_WRITE_LIMIT'],
  );
  bad(
    'v11-s7-byte-order',
    (f) => withS7(f, (_, tags) => setTag(tags, { source: { byteOrder: 'CDAB' } })),
    ['E_SCHEMA'],
  );
  bad(
    'v11-s7-string-byte-order',
    (f) =>
      withS7(
        f,
        (_, tags) => (tags.find((t) => t.id === 'S7.DB_STRING').source.stringByteOrder = 'BA'),
      ),
    ['E_SCHEMA'],
  );
  bad(
    'v11-s7-string-no-length',
    (f) =>
      withS7(f, (_, tags) => delete tags.find((t) => t.id === 'S7.DB_STRING').source.stringLength),
    ['E_SCHEMA'],
  );
}
