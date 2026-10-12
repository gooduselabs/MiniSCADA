// Ca `v02-*` của bộ vector project (feature 006, contracts/project-format-0.2.md §7, §10; research R4).
// Được generate.mjs nạp: `cases02(base01)` trả các ca nhỏ (commit), `large02()` trả các ca lớn (chỉ sinh vào
// out/ lúc chạy test: `node tests/project-vectors/generate.mjs --out`).
//
// Mỗi ca: [tên, hàm sửa base, mã lỗi (tập), cảnh báo (tập, tùy chọn), thêm { spans }].
// Mọi ca `valid` ghi `warnings` rõ ràng (kể cả []): so với tập cảnh báo của bộ kiểm tra.
// Thứ tự kiểm theo contract: cú pháp, tên, số tham số, kiểu, giới hạn (biểu thức); `spans` là vị trí
// [đầu, cuối) theo ký tự Unicode của lỗi biểu thức.

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect data-mat-uid="el_aaa" x="10" y="10" width="30" height="80" fill="#38bdf8"/>
  <circle data-mat-uid="el_bbb" cx="70" cy="50" r="20" fill="#64748b"/>
  <text data-mat-uid="el_ccc" x="10" y="98">--</text>
</svg>
`;

const V = '0.2.0';
const B = 'screens/main.bindings.json';
const S = 'screens/main.screen.json';
const L = 'logging.json';
const CONN = 'connections.json';
const TAGS = 'tags.json';
const VT = 'value-tables/TrangThaiBom.json';
const WT = 'watch-tables/van-hanh.json';

/** Project 0.2 hợp lệ, đủ bốn loại Tag, kênh TCP và RTU, bảng giá trị, bảng theo dõi, binding `valueTable`. */
export function base02() {
  return {
    'project.json': {
      format: 'matscada-project',
      schemaVersion: V,
      projectId: 'vector02',
      projectName: 'Vector 0.2',
      projectVersion: '0.1.0',
      minRuntimeVersion: '0.5.0',
      entryScreen: 'main',
      screens: ['main'],
      tagFile: TAGS,
      connectionFile: CONN,
      valueTables: ['TrangThaiBom'],
      watchTables: ['van-hanh'],
      maxClients: 10,
    },
    [TAGS]: {
      schemaVersion: V,
      tags: [
        {
          id: 'TANK01.LEVEL',
          kind: 'external',
          type: 'FLOAT32',
          description: 'Mức nước bồn',
          unit: '%',
          min: 0,
          max: 100,
          deadband: 0.5,
          source: { device: 'plc1', address: 'HR100', rawType: 'INT16' },
          scaling: { rawMin: 0, rawMax: 27648, engMin: 0, engMax: 100, clamp: true },
        },
        {
          id: 'TANK01.SP',
          kind: 'external',
          type: 'FLOAT32',
          unit: '%',
          access: 'RW',
          limits: { min: 0, max: 90 },
          source: { device: 'plc1', address: 'HR200', byteOrder: 'CDAB' },
        },
        {
          id: 'PUMP01.RUN_CMD',
          kind: 'external',
          type: 'BOOL',
          access: 'RW',
          source: { device: 'plc1', address: 'C10', readback: false },
        },
        {
          id: 'PUMP01.STATE',
          kind: 'external',
          type: 'INT16',
          valueTable: 'TrangThaiBom',
          source: { device: 'plc1', address: 'HR10' },
        },
        {
          id: 'METER1.P',
          kind: 'external',
          type: 'FLOAT32',
          unit: 'kW',
          source: { device: 'meter1', address: '30013' },
        },
        {
          id: 'PUMP01.FAULT',
          kind: 'external',
          type: 'BOOL',
          source: { device: 'plc1', address: 'HR12.3' },
        },
        {
          id: 'PUMP01.NAME',
          kind: 'external',
          type: 'STRING',
          source: { device: 'plc1', address: 'HR300', stringLength: 16 },
        },
        {
          id: 'TANK01.SP_HI',
          kind: 'internal',
          type: 'FLOAT32',
          unit: '%',
          access: 'RW',
          limits: { min: 0, max: 100 },
          initial: 85,
          retain: true,
        },
        {
          id: 'TANK01.VOLUME',
          kind: 'calculated',
          type: 'FLOAT32',
          unit: 'm3',
          expression: 'TANK01.LEVEL * 12.5',
        },
        {
          id: 'TANK01.HIGH',
          kind: 'calculated',
          type: 'BOOL',
          expression: 'TANK01.LEVEL > TANK01.SP_HI',
        },
        {
          id: 'PUMP01.STATE_TEXT',
          kind: 'calculated',
          type: 'STRING',
          expression: 'text(PUMP01.STATE, TrangThaiBom)',
        },
        {
          id: 'DEMO.WAVE',
          kind: 'simulation',
          type: 'FLOAT64',
          sim: { kind: 'sine', center: 50, amplitude: 25, periodMs: 20000 },
        },
        {
          id: 'DEMO.SET',
          kind: 'simulation',
          type: 'INT16',
          access: 'RW',
          limits: { min: -100, max: 100 },
          sim: { kind: 'manual', initial: 0 },
        },
      ],
    },
    [CONN]: {
      schemaVersion: V,
      scanGroups: { fast: 250, normal: 1000, slow: 5000 },
      channels: [
        {
          id: 'plc1',
          name: 'PLC trạm bơm',
          kind: 'modbus-tcp',
          tcp: { host: '192.168.10.5', port: 502 },
          devices: [
            {
              id: 'plc1',
              name: 'PLC trạm bơm',
              unitId: 1,
              byteOrder: 'ABCD',
              write: { registerBit: 'mask' },
            },
          ],
        },
        {
          id: 'rs485-1',
          name: 'RS485 đồng hồ điện',
          kind: 'modbus-rtu',
          serial: {
            port: 'ttyAS2',
            baud: 9600,
            dataBits: 8,
            parity: 'even',
            stopBits: 1,
            rs485: true,
          },
          devices: [
            { id: 'meter1', name: 'Đồng hồ 1', slave: 1, addressBase: 1, timeoutMs: 400 },
            { id: 'meter2', name: 'Đồng hồ 2', slave: 2, addressBase: 1, enabled: false },
          ],
        },
      ],
    },
    [VT]: {
      schemaVersion: V,
      name: 'TrangThaiBom',
      entries: [
        { value: 0, text: 'Dừng', color: '#808080' },
        { value: 1, text: 'Chạy', color: '#2E7D32' },
        { value: 2, text: 'Lỗi', color: '#C62828' },
        { from: 10, to: 20, text: 'Bảo trì' },
      ],
      default: { text: 'Không rõ', color: '#B26A00' },
    },
    [WT]: {
      schemaVersion: V,
      id: 'van-hanh',
      name: 'Vận hành',
      rows: [
        { tag: 'TANK01.SP', decimals: 1, writeValue: '75' },
        { tag: 'PUMP01.STATE', format: 'dec' },
        { tag: 'PUMP01.RUN_CMD', format: 'bool', writeValue: 'true' },
      ],
    },
    [S]: {
      schemaVersion: V,
      id: 'main',
      name: 'Main',
      svgFile: 'screens/main.svg',
      viewBox: [0, 0, 100, 100],
      fitMode: 'contain',
      bindingFile: B,
      elements: [{ elementUid: 'el_aaa' }, { elementUid: 'el_bbb' }, { elementUid: 'el_ccc' }],
    },
    [B]: {
      schemaVersion: V,
      screenId: 'main',
      elements: [
        {
          elementUid: 'el_aaa',
          bindings: [
            {
              id: 'b1',
              target: 'geometry.levelPercent',
              source: { type: 'tag', tagId: 'TANK01.LEVEL' },
              transform: { kind: 'direct' },
            },
          ],
        },
        {
          elementUid: 'el_bbb',
          bindings: [
            {
              id: 'b2',
              target: 'style.fill',
              source: { type: 'tag', tagId: 'PUMP01.FAULT' },
              transform: {
                kind: 'discreteMap',
                cases: [
                  { equals: true, value: '#ef4444' },
                  { equals: false, value: '#64748b' },
                ],
              },
            },
          ],
        },
        {
          elementUid: 'el_ccc',
          bindings: [
            {
              id: 'b3',
              target: 'text.content',
              source: { type: 'tag', tagId: 'PUMP01.STATE' },
              transform: { kind: 'valueTable', output: 'text' },
            },
            {
              id: 'b4',
              target: 'style.fill',
              source: { type: 'tag', tagId: 'PUMP01.STATE' },
              transform: { kind: 'valueTable', table: 'TrangThaiBom', output: 'color' },
            },
          ],
        },
      ],
    },
    'screens/main.svg': SVG,
  };
}

// ---- Trợ giúp sửa base ----
const tagsOf = (f) => f[TAGS].tags;
const tag = (f, id) => tagsOf(f).find((t) => t.id === id);
const addTag = (f, t) => tagsOf(f).push(t);
const chan = (f, i = 0) => f[CONN].channels[i];
const dev = (f, id) => f[CONN].channels.flatMap((c) => c.devices).find((d) => d.id === id);
const calc = (id, expression, type = 'FLOAT64') => ({ id, kind: 'calculated', type, expression });
const ext = (id, type, address, device = 'plc1', more = {}) => ({
  id,
  kind: 'external',
  type,
  source: { device, address, ...(more.source ?? {}) },
  ...Object.fromEntries(Object.entries(more).filter(([k]) => k !== 'source')),
});
/** Bỏ mọi tham chiếu tới Tag khỏi bindings và bảng theo dõi, để thay toàn bộ Tag của project. */
function replaceTags(f, tags, bindingTag) {
  f[TAGS].tags = tags;
  f[B].elements = [
    {
      elementUid: 'el_aaa',
      bindings: [
        {
          id: 'b1',
          target: 'geometry.levelPercent',
          source: { type: 'tag', tagId: bindingTag },
          transform: { kind: 'direct' },
        },
      ],
    },
  ];
  f[WT].rows = [];
}
const withLogging = (f) => {
  f['project.json'].loggingFile = L;
  f[L] = {
    schemaVersion: V,
    groups: [
      {
        id: 'fast',
        name: 'Fast',
        mode: 'onChange',
        minIntervalMs: 1000,
        retentionDays: 7,
        tags: [{ tagId: 'TANK01.LEVEL', deadband: 0.5 }, { tagId: 'PUMP01.RUN_CMD' }],
      },
    ],
  };
  return f[L];
};

/** Thêm `n` thiết bị TCP vào kênh `c` (id `<prefix>NN`). */
const manyDevices = (n, prefix) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${String(i + 1).padStart(2, '0')}`,
    name: `Thiết bị ${i + 1}`,
    unitId: (i % 247) + 1,
  }));
const tcpChannel = (id, devices) => ({
  id,
  name: id,
  kind: 'modbus-tcp',
  tcp: { host: '10.0.0.1' },
  devices,
});

/** [tên, hàm sửa base, mã lỗi, mã cảnh báo (tùy chọn), thêm (tùy chọn)] */
export function cases02(base01) {
  const C = [];
  const ok = (name, mutate, warnings = []) => C.push([name, mutate, [], warnings]);
  const bad = (name, mutate, errors, warnings, extra) =>
    C.push([name, mutate, errors, warnings, extra]);
  const list = (n, f) => Array.from({ length: n }, (_, i) => f(i));

  // ---------------- Hợp lệ ----------------
  ok('v02-valid-full', () => {});
  ok('v02-valid-no-connections', (f) => {
    delete f['project.json'].connectionFile;
    delete f[CONN];
    replaceTags(
      f,
      [
        { id: 'A.SET', kind: 'internal', type: 'FLOAT32', initial: 5 },
        calc('A.DOUBLE', 'A.SET * 2', 'FLOAT32'),
        {
          id: 'A.WAVE',
          kind: 'simulation',
          type: 'FLOAT32',
          sim: { kind: 'ramp', from: 0, to: 100, periodMs: 10000 },
        },
      ],
      'A.WAVE',
    );
  });
  ok('v02-valid-modicon-addresses', (f) => {
    const d = dev(f, 'meter1');
    d.addressBase = 1;
    addTag(f, ext('M.HR5', 'UINT16', '40010', 'meter1'));
    addTag(f, ext('M.HR6', 'UINT16', '400010', 'meter1'));
    addTag(f, ext('M.IR5', 'INT16', '30001', 'meter1'));
    addTag(f, ext('M.IR6', 'INT16', '300001', 'meter1'));
    addTag(f, ext('M.C5', 'BOOL', '00012', 'meter1'));
    addTag(f, ext('M.C6', 'BOOL', '000012', 'meter1'));
    addTag(f, ext('M.DI5', 'BOOL', '10003', 'meter1'));
    addTag(f, ext('M.DI6', 'BOOL', '100003', 'meter1'));
    addTag(f, ext('M.BIT', 'BOOL', '40010.15', 'meter1'));
    addTag(f, ext('M.LOWER', 'UINT16', 'hr15', 'meter1'));
  });
  ok('v02-valid-expr-depth-16', (f) => {
    addTag(f, calc('D1', 'TANK01.LEVEL * 1'));
    for (let i = 2; i <= 16; i++) addTag(f, calc(`D${i}`, `D${i - 1} + 1`));
  });
  ok('v02-valid-calculated-functions', (f) => {
    addTag(f, calc('K.MIN', 'min(TANK01.LEVEL, TANK01.SP, 50)'));
    addTag(f, calc('K.MAX', 'max(TANK01.LEVEL, 1)'));
    addTag(f, calc('K.ABS', 'abs(TANK01.LEVEL - 50)'));
    addTag(f, calc('K.ROUND', 'round(TANK01.LEVEL / 3, 2)'));
    addTag(f, calc('K.CLAMP', 'clamp(TANK01.LEVEL - 5, 0, 100)'));
    addTag(f, calc('K.TERN', 'PUMP01.FAULT ? 0 : TANK01.LEVEL'));
    addTag(f, calc('K.AND', 'PUMP01.RUN_CMD && !PUMP01.FAULT', 'BOOL'));
    addTag(f, calc('K.TEXT', 'MODE == "AUTO" ? "Tự động" : "Tay"', 'STRING'));
    addTag(f, { id: 'MODE', kind: 'internal', type: 'STRING', initial: 'AUTO' });
  });
  ok('v02-valid-simulation-kinds', (f) => {
    const s = (id, type, sim, more = {}) =>
      addTag(f, { id, kind: 'simulation', type, sim, ...more });
    s('S.CONST', 'INT16', { kind: 'const', value: 7 });
    s('S.CONSTB', 'BOOL', { kind: 'const', value: true });
    s('S.CONSTS', 'STRING', { kind: 'const', value: 'abc' });
    s('S.RAMP', 'FLOAT32', { kind: 'ramp', from: 0, to: 10, periodMs: 1000 });
    s('S.RAND', 'UINT16', { kind: 'random', min: 0, max: 10, periodMs: 2000, seed: 42 });
    s('S.RANDB', 'BOOL', { kind: 'random', periodMs: 2000 });
    s('S.SQ', 'BOOL', { kind: 'square', periodMs: 10000, duty: 0.25 });
    s('S.SQN', 'INT32', { kind: 'square', periodMs: 10000 });
    s('S.MAN', 'STRING', { kind: 'manual', initial: 'x' }, { access: 'RW' });
    s('S.LEGACY', 'FLOAT32', { kind: 'legacy', signal: 'tank.level' });
  });
  ok('v02-valid-string-write-246', (f) => {
    addTag(f, {
      ...ext('W.TXT', 'STRING', 'HR400'),
      access: 'RW',
      source: { device: 'plc1', address: 'HR400', stringLength: 246 },
    });
  });
  // METER1.P dùng địa chỉ Modicon trên thiết bị a01 (addressBase 0): cảnh báo W_ADDR_MODICON_BASE0
  ok(
    'v02-valid-limits-edge',
    (f) => {
      f[CONN].channels = [
        tcpChannel('a', manyDevices(32, 'a')),
        tcpChannel('b', manyDevices(32, 'b')),
      ];
      tagsOf(f).forEach((t) => {
        if (t.kind === 'external') t.source.device = 'a01';
      });
      dev(f, 'a01').write = { registerBit: 'mask' };
      f[VT].entries = list(256, (i) => ({ value: i, text: `M${i}` }));
      f[WT].rows = list(200, () => ({ tag: 'TANK01.LEVEL' }));
    },
    ['W_ADDR_MODICON_BASE0'],
  );
  ok('v02-valid-logging', (f) => withLogging(f));
  ok('v02-valid-rtu-scan-ok', (f) => {
    // 20 thanh ghi nhóm nhanh ở 115.200: rất nhanh
    const ch = chan(f, 1);
    ch.serial.baud = 115200;
    dev(f, 'meter1').timeoutMs = 100; // 100 x (1 + 1) = 200 <= 250 (nhóm fast)
    for (let i = 0; i < 10; i++)
      addTag(
        f,
        ext(`R.F${i}`, 'FLOAT32', `30${String(100 + 2 * i).padStart(3, '0')}`, 'meter1', {
          source: { scanGroup: 'fast' },
        }),
      );
  });
  ok('v02-valid-write-with-limits', (f) => {
    addTag(f, { ...ext('W.A', 'INT16', 'HR20'), access: 'RW', limits: { min: -5, max: 5 } });
    addTag(f, { ...ext('W.B', 'UINT32', 'HR22'), access: 'RW', limits: { max: 100000 } });
  });
  ok('v02-valid-bit-write-mask', (f) => {
    addTag(f, { ...ext('W.BIT', 'BOOL', 'HR50.7'), access: 'RW' });
  });

  // ---------------- Cảnh báo ----------------
  ok(
    'v02-warn-write-no-limits',
    (f) => addTag(f, { ...ext('W.NOLIM', 'INT16', 'HR20'), access: 'RW' }),
    ['W_WRITE_NO_LIMITS'],
  );
  ok(
    'v02-warn-write-no-limits-simulation',
    (f) =>
      addTag(f, {
        id: 'W.SIM',
        kind: 'simulation',
        type: 'FLOAT32',
        access: 'RW',
        sim: { kind: 'manual', initial: 0 },
      }),
    ['W_WRITE_NO_LIMITS'],
  );
  ok(
    'v02-warn-detect-slow',
    (f) => addTag(f, ext('F.FAST', 'INT16', 'HR30', 'plc1', { source: { scanGroup: 'fast' } })),
    ['W_DETECT_SLOW'],
  );
  ok(
    'v02-warn-detect-slow-rtu-retries',
    (f) => {
      const d = dev(f, 'meter1');
      d.timeoutMs = 600; // 600 x (1 + 1) = 1200 > 1000 (nhóm normal)
    },
    ['W_DETECT_SLOW'],
  );
  ok(
    'v02-warn-rtu-scan-time',
    (f) => {
      // US3-6: 200 thanh ghi nhóm nhanh, 9.600 8E1: hai yêu cầu (125 + 75) khoảng 520 ms, so với 250 ms
      for (let i = 0; i < 100; i++)
        addTag(
          f,
          ext(`R.T${String(i).padStart(3, '0')}`, 'UINT32', `HR${1000 + 2 * i}`, 'meter1', {
            source: { scanGroup: 'fast' },
          }),
        );
      dev(f, 'meter1').timeoutMs = 100;
      dev(f, 'meter1').retries = 0;
    },
    ['W_RTU_SCAN_TIME'],
  );
  ok(
    'v02-warn-bit-rmw',
    (f) => {
      dev(f, 'plc1').write = { registerBit: 'rmw' };
      addTag(f, { ...ext('W.BIT', 'BOOL', 'HR50.7'), access: 'RW' });
    },
    ['W_BIT_RMW'],
  );
  ok(
    'v02-warn-expr-int64',
    (f) => {
      addTag(f, ext('BIG', 'INT64', 'HR600'));
      addTag(f, calc('BIG.PLUS', 'BIG + 1'));
    },
    ['W_EXPR_INT64'],
  );
  ok('v02-warn-watch-ref', (f) => f[WT].rows.push({ tag: 'KHONG.CO', format: 'auto' }), [
    'W_WATCH_REF',
  ]);
  ok('v02-warn-modicon-base0', (f) => addTag(f, ext('M.BASE0', 'UINT16', '40010', 'plc1')), [
    'W_ADDR_MODICON_BASE0',
  ]);

  // ---------------- Phiên bản ----------------
  bad(
    'v02-invalid-schema-version-0.3',
    (f) => {
      // dùng project 0.1 (bộ kiểm tra 0.1), mọi file 0.3.0: FR-002, runtime từ chối phiên bản không hiểu
      for (const k of Object.keys(f)) delete f[k];
      Object.assign(f, base01());
      for (const v of Object.values(f)) if (typeof v === 'object') v.schemaVersion = '0.3.0';
    },
    ['E_SCHEMA_VERSION'],
  );
  bad(
    'v02-invalid-schema-version-1.0',
    (f) => {
      for (const k of Object.keys(f)) delete f[k];
      Object.assign(f, base01());
      for (const v of Object.values(f)) if (typeof v === 'object') v.schemaVersion = '1.0.0';
    },
    ['E_SCHEMA_VERSION'],
  );
  bad('v02-invalid-schema-version-mixed-tags', (f) => (f[TAGS].schemaVersion = '0.1.0'), [
    'E_SCHEMA_VERSION',
  ]);
  bad('v02-invalid-schema-version-mixed-patch', (f) => (f[CONN].schemaVersion = '0.2.1'), [
    'E_SCHEMA_VERSION',
  ]);
  bad('v02-invalid-schema-version-mixed-logging', (f) => (withLogging(f).schemaVersion = '0.1.0'), [
    'E_SCHEMA_VERSION',
  ]);
  bad('v02-invalid-schema-version-mixed-screen', (f) => (f[S].schemaVersion = '0.1.0'), [
    'E_SCHEMA_VERSION',
  ]);
  bad('v02-invalid-min-runtime', (f) => (f['project.json'].minRuntimeVersion = '0.4.0'), [
    'E_MIN_RUNTIME',
  ]);

  // ---------------- E_LIMIT ----------------
  bad(
    'v02-invalid-limit-channels-17',
    (f) => {
      f[CONN].channels = list(17, (i) =>
        tcpChannel(`c${i}`, [{ id: `d${i}`, name: `d${i}`, unitId: 1 }]),
      );
      tagsOf(f).forEach((t) => t.kind === 'external' && (t.source.device = 'd0'));
      dev(f, 'd0').write = { registerBit: 'mask' };
    },
    ['E_LIMIT'],
  );
  bad(
    'v02-invalid-limit-devices-65',
    (f) => {
      f[CONN].channels = [
        tcpChannel('a', manyDevices(32, 'a')),
        tcpChannel('b', manyDevices(32, 'b')),
        tcpChannel('c', manyDevices(1, 'c')),
      ];
      tagsOf(f).forEach((t) => t.kind === 'external' && (t.source.device = 'a01'));
      dev(f, 'a01').write = { registerBit: 'mask' };
    },
    ['E_LIMIT'],
  );
  bad(
    'v02-invalid-limit-devices-per-channel-33',
    (f) => {
      f[CONN].channels = [tcpChannel('a', manyDevices(33, 'a'))];
      tagsOf(f).forEach((t) => t.kind === 'external' && (t.source.device = 'a01'));
      dev(f, 'a01').write = { registerBit: 'mask' };
    },
    ['E_LIMIT'],
  );
  bad(
    'v02-invalid-limit-entries-257',
    (f) => (f[VT].entries = list(257, (i) => ({ value: i, text: `M${i}` }))),
    ['E_LIMIT'],
  );
  bad(
    'v02-invalid-limit-rows-201',
    (f) => (f[WT].rows = list(201, () => ({ tag: 'TANK01.LEVEL' }))),
    ['E_LIMIT'],
  );
  bad(
    'v02-invalid-limit-watch-tables-33',
    (f) => {
      const ids = list(33, (i) => `w${String(i).padStart(2, '0')}`);
      f['project.json'].watchTables = ids;
      delete f[WT];
      for (const id of ids)
        f[`watch-tables/${id}.json`] = { schemaVersion: V, id, name: id, rows: [] };
    },
    ['E_LIMIT'],
  );

  // ---------------- E_DUP_ID, E_DUP_TAG ----------------
  bad('v02-invalid-dup-id-channel', (f) => (chan(f, 1).id = 'plc1'), ['E_DUP_ID']);
  bad(
    'v02-invalid-dup-id-device',
    (f) => chan(f, 1).devices.push({ id: 'plc1', name: 'dup', slave: 5 }),
    ['E_DUP_ID'],
  );
  bad(
    'v02-invalid-dup-id-table-case',
    (f) => (f['project.json'].valueTables = ['TrangThaiBom', 'TRANGTHAIBOM']),
    ['E_DUP_ID'],
  );
  bad(
    'v02-invalid-dup-id-watch',
    (f) => (f['project.json'].watchTables = ['van-hanh', 'van-hanh']),
    ['E_DUP_ID'],
  );
  bad('v02-invalid-dup-id-table-name-differs-from-file', (f) => (f[VT].name = 'Khac'), [
    'E_DUP_ID',
  ]);
  bad('v02-invalid-dup-id-watch-id-differs-from-file', (f) => (f[WT].id = 'khac'), ['E_DUP_ID']);
  bad(
    'v02-invalid-dup-tag',
    (f) => addTag(f, { id: 'TANK01.SP_HI', kind: 'internal', type: 'BOOL' }),
    ['E_DUP_TAG'],
  );

  // ---------------- Tham chiếu ----------------
  bad('v02-invalid-ref-device', (f) => (tag(f, 'TANK01.LEVEL').source.device = 'khong-co'), [
    'E_REF_DEVICE',
  ]);
  bad(
    'v02-invalid-ref-device-no-connection-file',
    (f) => {
      delete f['project.json'].connectionFile;
      delete f[CONN];
    },
    ['E_REF_DEVICE'],
  );
  bad('v02-invalid-ref-table-tag', (f) => (tag(f, 'PUMP01.STATE').valueTable = 'KhongCo'), [
    'E_REF_TABLE',
  ]);
  bad(
    'v02-invalid-ref-table-binding',
    (f) => (f[B].elements[2].bindings[1].transform.table = 'KhongCo'),
    ['E_REF_TABLE'],
  );
  bad(
    'v02-invalid-ref-table-binding-none',
    (f) => {
      // Tag nguồn không có valueTable và binding không có table
      f[B].elements[2].bindings[0].source.tagId = 'TANK01.LEVEL';
    },
    ['E_REF_TABLE'],
  );
  bad(
    'v02-invalid-ref-tag-in-binding',
    (f) => (f[B].elements[0].bindings[0].source.tagId = 'KHONG.CO'),
    ['E_REF_TAG'],
  );

  // ---------------- Địa chỉ ----------------
  bad('v02-invalid-addr-syntax', (f) => (tag(f, 'TANK01.LEVEL').source.address = 'HR'), [
    'E_ADDR_SYNTAX',
  ]);
  bad('v02-invalid-addr-syntax-bit16', (f) => (tag(f, 'PUMP01.FAULT').source.address = 'HR12.16'), [
    'E_ADDR_SYNTAX',
  ]);
  bad('v02-invalid-addr-syntax-spaces', (f) => (tag(f, 'TANK01.LEVEL').source.address = ' HR100'), [
    'E_ADDR_SYNTAX',
  ]);
  bad('v02-invalid-addr-area-bool-hr', (f) => (tag(f, 'PUMP01.FAULT').source.address = 'HR12'), [
    'E_ADDR_AREA',
  ]);
  bad('v02-invalid-addr-area-number-coil', (f) => (tag(f, 'PUMP01.STATE').source.address = 'C10'), [
    'E_ADDR_AREA',
  ]);
  bad(
    'v02-invalid-addr-area-bit-on-coil',
    (f) => (tag(f, 'PUMP01.RUN_CMD').source.address = 'C10.1'),
    ['E_ADDR_AREA'],
  );
  bad(
    'v02-invalid-addr-area-rw-input-register',
    (f) => {
      addTag(f, { ...ext('X.RW', 'INT16', 'IR5'), access: 'RW' });
    },
    ['E_ADDR_AREA'],
  );
  bad(
    'v02-invalid-addr-area-rw-discrete-input',
    (f) => {
      addTag(f, { ...ext('X.RWDI', 'BOOL', 'DI5'), access: 'RW' });
    },
    ['E_ADDR_AREA'],
  );
  bad('v02-invalid-addr-range-int32-end', (f) => addTag(f, ext('X.END', 'INT32', 'HR65535')), [
    'E_ADDR_RANGE',
  ]);
  bad(
    'v02-invalid-addr-range-offset-negative',
    (f) => addTag(f, ext('X.NEG', 'UINT16', 'HR0', 'meter1')),
    ['E_ADDR_RANGE'],
  );
  bad(
    'v02-invalid-addr-range-modicon-6-digits',
    (f) => addTag(f, ext('X.BIG', 'UINT16', '499999', 'meter1')),
    ['E_ADDR_RANGE'],
  );
  bad(
    'v02-invalid-addr-read-limit',
    (f) => {
      dev(f, 'plc1').maxReadRegisters = 10;
      tag(f, 'PUMP01.NAME').source.stringLength = 40;
    },
    ['E_ADDR_READ_LIMIT'],
  );
  bad(
    'v02-invalid-addr-write-limit',
    (f) => {
      addTag(f, {
        ...ext('X.TXT', 'STRING', 'HR400'),
        access: 'RW',
        source: { device: 'plc1', address: 'HR400', stringLength: 248 },
      });
    },
    ['E_ADDR_WRITE_LIMIT'],
  );
  bad(
    'v02-invalid-bit-write',
    (f) => {
      dev(f, 'plc1').write = { registerBit: 'none' };
      addTag(f, { ...ext('X.BIT', 'BOOL', 'HR50.7'), access: 'RW' });
    },
    ['E_BIT_WRITE'],
  );
  bad(
    'v02-invalid-bit-write-default-none',
    (f) => {
      delete dev(f, 'plc1').write;
      addTag(f, { ...ext('X.BIT', 'BOOL', 'HR50.7'), access: 'RW' });
    },
    ['E_BIT_WRITE'],
  );

  // ---------------- Scaling, deadband, giới hạn ----------------
  bad('v02-invalid-scaling-type-int', (f) => (tag(f, 'TANK01.LEVEL').type = 'INT16'), [
    'E_SCALING',
  ]);
  bad(
    'v02-invalid-scaling-on-bool',
    (f) => (tag(f, 'PUMP01.RUN_CMD').scaling = { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 }),
    ['E_SCALING'],
  );
  bad('v02-invalid-scaling-raw-equal', (f) => (tag(f, 'TANK01.LEVEL').scaling.rawMax = 0), [
    'E_SCALING',
  ]);
  bad('v02-invalid-scaling-eng-equal', (f) => (tag(f, 'TANK01.LEVEL').scaling.engMax = 0), [
    'E_SCALING',
  ]);
  bad(
    'v02-invalid-scaling-raw-type-string',
    (f) => {
      addTag(f, {
        ...ext('X.SC', 'FLOAT32', 'HR700'),
        source: { device: 'plc1', address: 'HR700', rawType: 'STRING', stringLength: 4 },
        scaling: { rawMin: 0, rawMax: 1, engMin: 0, engMax: 1 },
      });
    },
    ['E_SCALING'],
  );
  bad('v02-invalid-deadband-bool', (f) => (tag(f, 'PUMP01.FAULT').deadband = 1), ['E_DEADBAND']);
  bad('v02-invalid-deadband-negative', (f) => (tag(f, 'TANK01.LEVEL').deadband = -0.1), [
    'E_DEADBAND',
  ]);
  bad('v02-invalid-limits-bool', (f) => (tag(f, 'PUMP01.RUN_CMD').limits = { min: 0, max: 1 }), [
    'E_LIMITS',
  ]);
  bad('v02-invalid-limits-min-gt-max', (f) => (tag(f, 'TANK01.SP').limits = { min: 90, max: 0 }), [
    'E_LIMITS',
  ]);
  bad(
    'v02-invalid-limits-maxlength-on-number',
    (f) => (tag(f, 'TANK01.SP').limits.maxLength = 10),
    ['E_LIMITS'],
  );
  bad(
    'v02-invalid-limits-outside-type-range',
    (f) => {
      addTag(f, { ...ext('X.LIM', 'INT16', 'HR20'), access: 'RW', limits: { max: 40000 } });
    },
    ['E_LIMITS'],
  );
  bad(
    'v02-invalid-limits-maxlength-zero',
    (f) => {
      addTag(f, {
        id: 'X.STR',
        kind: 'internal',
        type: 'STRING',
        access: 'RW',
        limits: { maxLength: 0 },
      });
    },
    ['E_LIMITS'],
  );
  bad('v02-invalid-tag-range-reversed', (f) => (tag(f, 'TANK01.LEVEL').min = 100), ['E_TAG_RANGE']);
  bad('v02-invalid-tag-range-bool', (f) => (tag(f, 'PUMP01.FAULT').min = 0), ['E_TAG_RANGE']);
  bad('v02-invalid-tag-access-calculated', (f) => (tag(f, 'TANK01.VOLUME').access = 'RW'), [
    'E_TAG_ACCESS',
  ]);
  bad(
    'v02-invalid-tag-access-simulation',
    (f) => {
      addTag(f, {
        id: 'X.SIM',
        kind: 'simulation',
        type: 'FLOAT64',
        access: 'RW',
        limits: { min: 0, max: 1 },
        sim: { kind: 'sine', center: 0, amplitude: 1, periodMs: 1000 },
      });
    },
    ['E_TAG_ACCESS'],
  );

  // ---------------- Mô phỏng, giá trị đầu, giữ qua mất điện ----------------
  const simTag =
    (sim, type = 'FLOAT64') =>
    (f) =>
      addTag(f, { id: 'X.SIM', kind: 'simulation', type, sim });
  bad(
    'v02-invalid-sim-sine-on-bool',
    simTag({ kind: 'sine', center: 0, amplitude: 1, periodMs: 1000 }, 'BOOL'),
    ['E_SIM'],
  );
  bad(
    'v02-invalid-sim-ramp-on-string',
    simTag({ kind: 'ramp', from: 0, to: 1, periodMs: 1000 }, 'STRING'),
    ['E_SIM'],
  );
  bad(
    'v02-invalid-sim-random-min-ge-max',
    simTag({ kind: 'random', min: 5, max: 5, periodMs: 1000 }),
    ['E_SIM'],
  );
  bad(
    'v02-invalid-sim-random-on-string',
    simTag({ kind: 'random', min: 0, max: 5, periodMs: 1000 }, 'STRING'),
    ['E_SIM'],
  );
  bad('v02-invalid-sim-square-on-string', simTag({ kind: 'square', periodMs: 1000 }, 'STRING'), [
    'E_SIM',
  ]);
  bad('v02-invalid-sim-ramp-missing-to', simTag({ kind: 'ramp', from: 0, periodMs: 1000 }), [
    'E_SIM',
  ]);
  bad('v02-invalid-sim-const-wrong-type', simTag({ kind: 'const', value: 'x' }), ['E_SIM']);
  bad('v02-invalid-sim-manual-wrong-type', simTag({ kind: 'manual', initial: true }), ['E_SIM']);
  bad('v02-invalid-sim-legacy-missing-signal', simTag({ kind: 'legacy' }), ['E_SIM']);
  bad(
    'v02-invalid-sim-on-calculated',
    (f) => (tag(f, 'TANK01.VOLUME').sim = { kind: 'const', value: 1 }),
    ['E_SIM'],
  );
  bad('v02-invalid-initial-wrong-type', (f) => (tag(f, 'TANK01.SP_HI').initial = 'abc'), [
    'E_INITIAL',
  ]);
  bad(
    'v02-invalid-initial-out-of-range',
    (f) => addTag(f, { id: 'X.I', kind: 'internal', type: 'INT16', initial: 40000 }),
    ['E_INITIAL'],
  );
  bad(
    'v02-invalid-initial-fraction-on-integer',
    (f) => addTag(f, { id: 'X.I', kind: 'internal', type: 'INT16', initial: 2.5 }),
    ['E_INITIAL'],
  );
  bad(
    'v02-invalid-initial-string-over-256-retained',
    (f) =>
      addTag(f, {
        id: 'X.S',
        kind: 'internal',
        type: 'STRING',
        initial: 'a'.repeat(257),
        retain: true,
      }),
    ['E_INITIAL'],
  );
  bad(
    'v02-invalid-initial-string-over-maxlength',
    (f) =>
      addTag(f, {
        id: 'X.S',
        kind: 'internal',
        type: 'STRING',
        initial: 'abcdef',
        limits: { maxLength: 5 },
      }),
    ['E_INITIAL'],
  );
  bad('v02-invalid-retain-external', (f) => (tag(f, 'TANK01.LEVEL').retain = true), ['E_RETAIN']);
  bad('v02-invalid-retain-calculated', (f) => (tag(f, 'TANK01.VOLUME').retain = true), [
    'E_RETAIN',
  ]);

  // ---------------- Biểu thức ----------------
  const expr =
    (src, type = 'FLOAT64') =>
    (f) =>
      addTag(f, calc('X.CALC', src, type));
  bad('v02-invalid-expr-syntax', expr('(TANK01.LEVEL + 1'), ['E_EXPR_SYNTAX'], undefined, {
    spans: [{ code: 'E_EXPR_SYNTAX', span: [17, 17] }],
  });
  bad(
    'v02-invalid-expr-syntax-chain',
    expr('TANK01.LEVEL < 1 < 2', 'BOOL'),
    ['E_EXPR_SYNTAX'],
    undefined,
    { spans: [{ code: 'E_EXPR_SYNTAX', span: [17, 18] }] },
  );
  bad('v02-invalid-expr-unknown-tag', expr('TANK9.LEVEL'), ['E_EXPR_UNKNOWN_TAG'], undefined, {
    spans: [{ code: 'E_EXPR_UNKNOWN_TAG', span: [0, 11] }],
  });
  bad(
    'v02-invalid-expr-unknown-table',
    expr('text(PUMP01.STATE, KhongCo)', 'STRING'),
    ['E_EXPR_UNKNOWN_TABLE'],
    undefined,
    { spans: [{ code: 'E_EXPR_UNKNOWN_TABLE', span: [19, 26] }] },
  );
  bad(
    'v02-invalid-expr-unknown-func',
    expr('sqrt(TANK01.LEVEL)'),
    ['E_EXPR_UNKNOWN_FUNC'],
    undefined,
    { spans: [{ code: 'E_EXPR_UNKNOWN_FUNC', span: [0, 4] }] },
  );
  bad('v02-invalid-expr-arity', expr('abs(TANK01.LEVEL, 1)'), ['E_EXPR_ARITY'], undefined, {
    spans: [{ code: 'E_EXPR_ARITY', span: [0, 20] }],
  });
  bad(
    'v02-invalid-expr-type-result',
    expr('TANK01.LEVEL + 1', 'BOOL'),
    ['E_EXPR_TYPE'],
    undefined,
    { spans: [{ code: 'E_EXPR_TYPE', span: [0, 16] }] },
  );
  bad('v02-invalid-expr-type-operand', expr('PUMP01.NAME + 1'), ['E_EXPR_TYPE'], undefined, {
    spans: [{ code: 'E_EXPR_TYPE', span: [0, 11] }],
  });
  bad('v02-invalid-expr-limit-chars', expr('1' + '+1'.repeat(500)), ['E_EXPR_LIMIT'], undefined, {
    spans: [{ code: 'E_EXPR_LIMIT', span: [1000, 1001] }],
  });
  bad(
    'v02-invalid-expr-limit-4097-bytes',
    expr(`"${'x'.repeat(4095)}"`, 'STRING'),
    ['E_EXPR_LIMIT'],
    undefined,
    { spans: [{ code: 'E_EXPR_LIMIT', span: [1000, 1001] }] },
  );
  bad(
    'v02-invalid-expr-limit-nesting-33',
    expr('('.repeat(33) + '1' + ')'.repeat(33)),
    ['E_EXPR_LIMIT'],
    undefined,
    { spans: [{ code: 'E_EXPR_LIMIT', span: [32, 33] }] },
  );
  bad(
    'v02-invalid-expr-limit-tags-33',
    (f) => {
      const ids = list(33, (i) => `P${i}`);
      for (const id of ids) addTag(f, { id, kind: 'internal', type: 'FLOAT64' });
      addTag(f, calc('X.CALC', ids.join(' + ')));
    },
    ['E_EXPR_LIMIT'],
  );
  bad(
    'v02-invalid-expr-cycle',
    (f) => {
      addTag(f, calc('C1', 'C2 + 1'));
      addTag(f, calc('C2', 'C1 + 1'));
    },
    ['E_EXPR_CYCLE'],
  );
  bad('v02-invalid-expr-cycle-self', (f) => addTag(f, calc('C1', 'C1 + 1')), ['E_EXPR_CYCLE']);
  bad(
    'v02-invalid-expr-cycle-indirect',
    (f) => {
      addTag(f, calc('C1', 'C3 + 1'));
      addTag(f, calc('C2', 'C1 + 1'));
      addTag(f, calc('C3', 'C2 + 1'));
    },
    ['E_EXPR_CYCLE'],
  );
  bad(
    'v02-invalid-expr-depth',
    (f) => {
      addTag(f, calc('D1', 'TANK01.LEVEL * 1'));
      for (let i = 2; i <= 17; i++) addTag(f, calc(`D${i}`, `D${i - 1} + 1`));
    },
    ['E_EXPR_DEPTH'],
  );
  bad(
    'v02-invalid-expr-missing-keeps-others',
    (f) => {
      // lỗi ở một Tag tính toán không che lỗi ở Tag khác
      addTag(f, calc('E1', 'KHONG.CO + 1'));
      addTag(f, calc('E2', '"a" + 1'));
    },
    ['E_EXPR_UNKNOWN_TAG', 'E_EXPR_TYPE'],
  );

  // ---------------- Bảng giá trị ----------------
  bad('v02-invalid-vt-overlap', (f) => f[VT].entries.push({ value: 1, text: 'Trùng' }), [
    'E_VT_OVERLAP',
  ]);
  bad(
    'v02-invalid-vt-overlap-range',
    (f) => f[VT].entries.push({ from: 15, to: 25, text: 'Chồng' }),
    ['E_VT_OVERLAP'],
  );
  bad('v02-invalid-vt-range-empty', (f) => f[VT].entries.push({ from: 30, to: 30, text: 'Rỗng' }), [
    'E_VT_RANGE',
  ]);
  bad(
    'v02-invalid-vt-range-reversed',
    (f) => f[VT].entries.push({ from: 40, to: 30, text: 'Ngược' }),
    ['E_VT_RANGE'],
  );
  bad('v02-invalid-vt-text-65', (f) => (f[VT].entries[0].text = 'ệ'.repeat(65)), ['E_VT_TEXT']);

  // ---------------- Cổng serial ----------------
  bad('v02-invalid-serial-port-windows', (f) => (chan(f, 1).serial.port = 'COM1'), [
    'E_SERIAL_PORT',
  ]);
  bad('v02-invalid-serial-port-path', (f) => (chan(f, 1).serial.port = '/dev/ttyAS2'), [
    'E_SERIAL_PORT',
  ]);
  bad(
    'v02-invalid-serial-port-by-id-space',
    (f) => (chan(f, 1).serial.port = '/dev/serial/by-id/usb ftdi'),
    ['E_SERIAL_PORT'],
  );
  bad(
    'v02-invalid-serial-shared',
    (f) => {
      f[CONN].channels.push({
        id: 'rs485-2',
        name: 'Trùng cổng',
        kind: 'modbus-rtu',
        serial: { port: 'ttyAS2' },
        devices: [{ id: 'meter9', name: 'Đồng hồ 9', slave: 9 }],
      });
    },
    ['E_SERIAL_SHARED'],
  );
  ok(
    'v02-valid-serial-by-id',
    (f) => (chan(f, 1).serial.port = '/dev/serial/by-id/usb-FTDI_FT232R-if00-port0'),
  );
  ok(
    'v02-valid-serial-by-path',
    (f) => (chan(f, 1).serial.port = '/dev/serial/by-path/platform-xhci-hcd.1-usb-0:1:1.0-port0'),
  );

  // ---------------- Binding ----------------
  bad(
    'v02-invalid-binding-valuetable-on-string',
    (f) => {
      const b = f[B].elements[2].bindings[0];
      b.source.tagId = 'PUMP01.NAME';
      b.transform = { kind: 'valueTable', table: 'TrangThaiBom', output: 'text' };
    },
    ['E_TYPE_MISMATCH'],
  );
  bad(
    'v02-invalid-binding-valuetable-on-string-no-table',
    (f) => (f[B].elements[2].bindings[0].source.tagId = 'PUMP01.NAME'),
    ['E_TYPE_MISMATCH', 'E_REF_TABLE'],
  );
  bad(
    'v02-invalid-binding-output-text-to-fill',
    (f) => {
      f[B].elements[2].bindings[1].transform = {
        kind: 'valueTable',
        table: 'TrangThaiBom',
        output: 'text',
      };
    },
    ['E_TYPE_MISMATCH'],
  );
  bad(
    'v02-invalid-binding-output-color-to-text',
    (f) => {
      f[B].elements[2].bindings[0].transform = { kind: 'valueTable', output: 'color' };
    },
    ['E_TYPE_MISMATCH'],
  );
  bad(
    'v02-invalid-binding-output-color-to-opacity',
    (f) => {
      f[B].elements[0].bindings[0] = {
        id: 'b1',
        target: 'style.opacity',
        source: { type: 'tag', tagId: 'PUMP01.STATE' },
        transform: { kind: 'valueTable', output: 'color' },
      };
    },
    ['E_TYPE_MISMATCH'],
  );
  bad(
    'v02-invalid-binding-rangemap',
    (f) => {
      f[B].elements[0].bindings[0].transform = { kind: 'rangeMap' };
    },
    ['E_TRANSFORM_UNSUPPORTED'],
  );
  bad(
    'v02-invalid-binding-expression',
    (f) => {
      f[B].elements[0].bindings[0].transform = { kind: 'expression' };
    },
    ['E_TRANSFORM_UNSUPPORTED'],
  );
  bad(
    'v02-invalid-binding-format',
    (f) => {
      f[B].elements[0].bindings[0].transform = { kind: 'format' };
    },
    ['E_TRANSFORM_UNSUPPORTED'],
  );

  // ---------------- Schema, JSON, đường dẫn, file thiếu ----------------
  bad('v02-invalid-schema-tag-no-kind', (f) => delete tag(f, 'TANK01.SP_HI').kind, ['E_SCHEMA']);
  bad('v02-invalid-schema-external-no-source', (f) => delete tag(f, 'TANK01.LEVEL').source, [
    'E_SCHEMA',
  ]);
  bad(
    'v02-invalid-schema-calculated-no-expression',
    (f) => delete tag(f, 'TANK01.VOLUME').expression,
    ['E_SCHEMA'],
  );
  bad('v02-invalid-schema-simulation-no-sim', (f) => delete tag(f, 'DEMO.WAVE').sim, ['E_SCHEMA']);
  bad('v02-invalid-schema-unknown-tag-key', (f) => (tag(f, 'TANK01.LEVEL').color = 'red'), [
    'E_SCHEMA',
  ]);
  bad(
    'v02-invalid-schema-0.1-source',
    (f) => (tag(f, 'TANK01.LEVEL').source = { kind: 'mock', signal: 'tank.level' }),
    ['E_SCHEMA'],
  );
  bad(
    'v02-invalid-schema-string-no-length',
    (f) => delete tag(f, 'PUMP01.NAME').source.stringLength,
    ['E_SCHEMA'],
  );
  bad('v02-invalid-schema-baud', (f) => (chan(f, 1).serial.baud = 1234), ['E_SCHEMA']);
  bad('v02-invalid-schema-timeout', (f) => (dev(f, 'plc1').timeoutMs = 50), ['E_SCHEMA']);
  bad('v02-invalid-schema-tcp-device-with-slave', (f) => (dev(f, 'plc1').slave = 3), ['E_SCHEMA']);
  bad('v02-invalid-schema-rtu-device-with-unitid', (f) => (dev(f, 'meter1').unitId = 3), [
    'E_SCHEMA',
  ]);
  bad('v02-invalid-schema-channel-id', (f) => (chan(f, 0).id = 'PLC 1'), ['E_SCHEMA']);
  bad('v02-invalid-schema-sim-period', (f) => (tag(f, 'DEMO.WAVE').sim.periodMs = 50), [
    'E_SCHEMA',
  ]);
  bad(
    'v02-invalid-schema-sim-duty',
    (f) =>
      addTag(f, {
        id: 'X.SQ',
        kind: 'simulation',
        type: 'BOOL',
        sim: { kind: 'square', periodMs: 1000, duty: 1.5 },
      }),
    ['E_SCHEMA'],
  );
  bad('v02-invalid-schema-color', (f) => (f[VT].entries[0].color = 'red'), ['E_SCHEMA']);
  bad('v02-invalid-schema-entry-without-value', (f) => f[VT].entries.push({ text: 'x' }), [
    'E_SCHEMA',
  ]);
  bad(
    'v02-invalid-schema-entry-value-and-range',
    (f) => f[VT].entries.push({ value: 5, from: 1, text: 'x' }),
    ['E_SCHEMA'],
  );
  bad('v02-invalid-schema-watch-format', (f) => (f[WT].rows[0].format = 'octal'), ['E_SCHEMA']);
  bad('v02-invalid-schema-watch-decimals', (f) => (f[WT].rows[0].decimals = 10), ['E_SCHEMA']);
  bad(
    'v02-invalid-schema-project-value-table-name',
    (f) => (f['project.json'].valueTables = ['1bad']),
    ['E_SCHEMA'],
  );
  bad(
    'v02-invalid-json-connections',
    (f) => (f[CONN] = '{ "schemaVersion": "0.2.0", "channels": [ '),
    ['E_JSON'],
  );
  bad(
    'v02-invalid-path-connection-file',
    (f) => (f['project.json'].connectionFile = '../connections.json'),
    ['E_PATH'],
  );
  bad('v02-invalid-file-missing-connection', (f) => delete f[CONN], ['E_FILE_MISSING']);
  bad('v02-invalid-file-missing-value-table', (f) => delete f[VT], ['E_FILE_MISSING']);
  bad('v02-invalid-file-missing-watch-table', (f) => delete f[WT], ['E_FILE_MISSING']);
  ok('v02-valid-expr-over-1024-bytes', (f) => {
    // trường expression được miễn trần 1.024 byte chung của chuỗi JSON: 1.802 byte vẫn hợp lệ
    addTag(f, calc('X.LONG', `"${'ệ'.repeat(600)}"`, 'STRING'));
  });

  return C;
}

/** Ca lớn: sinh vào out/ khi chạy test, không commit. Trả [tên, hàm dựng base, mã lỗi]. */
export function large02() {
  const L2 = [];
  const manyTags = (n, make) => (f) => {
    for (let i = 0; i < n; i++) f[TAGS].tags.push(make(i));
    // JSON gọn cho nhẹ
    f[TAGS] = JSON.stringify(f[TAGS]) + '\n';
  };
  const pad = (i, w = 4) => String(i).padStart(w, '0');
  // 2.000 Tag hợp lệ (13 Tag của base + 1.987), 2.001 Tag là vượt
  L2.push([
    'v02-large-valid-tags-2000',
    manyTags(1987, (i) => ({ id: `L.T${pad(i)}`, kind: 'internal', type: 'INT16' })),
    [],
  ]);
  L2.push([
    'v02-invalid-limit-tags-2001',
    manyTags(1988, (i) => ({ id: `L.T${pad(i)}`, kind: 'internal', type: 'INT16' })),
    ['E_LIMIT'],
  ]);
  // 500 Tag tính toán (3 của base + 497), 501 là vượt
  L2.push([
    'v02-large-valid-calculated-500',
    manyTags(497, (i) => ({
      id: `L.C${pad(i)}`,
      kind: 'calculated',
      type: 'FLOAT64',
      expression: 'TANK01.LEVEL + 1',
    })),
    [],
  ]);
  L2.push([
    'v02-invalid-limit-calculated-501',
    manyTags(498, (i) => ({
      id: `L.C${pad(i)}`,
      kind: 'calculated',
      type: 'FLOAT64',
      expression: 'TANK01.LEVEL + 1',
    })),
    ['E_LIMIT'],
  ]);
  // 500 Tag giữ qua mất điện (1 của base + 499), 501 là vượt
  L2.push([
    'v02-large-valid-retain-500',
    manyTags(499, (i) => ({ id: `L.R${pad(i)}`, kind: 'internal', type: 'INT16', retain: true })),
    [],
  ]);
  L2.push([
    'v02-invalid-limit-retain-501',
    manyTags(500, (i) => ({ id: `L.R${pad(i)}`, kind: 'internal', type: 'INT16', retain: true })),
    ['E_LIMIT'],
  ]);
  // 256 bảng giá trị (1 của base + 255), 257 là vượt
  const tables = (n) => (f) => {
    for (let i = 0; i < n; i++) {
      const name = `Bang${pad(i)}`;
      f['project.json'].valueTables.push(name);
      f[`value-tables/${name}.json`] = { schemaVersion: V, name, entries: [] };
    }
  };
  L2.push(['v02-large-valid-value-tables-256', tables(255), []]);
  L2.push(['v02-invalid-limit-value-tables-257', tables(256), ['E_LIMIT']]);
  return L2;
}
