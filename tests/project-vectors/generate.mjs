// Sinh bộ test vector dùng chung TS ↔ C++ (contracts/project-format.md).
// Mỗi case: một thư mục project + expected.json {valid, errors: [mã]}. Chạy lại khi đổi luật:
//   node tests/project-vectors/generate.mjs
// Kết quả được commit; Vitest và GoogleTest đọc thẳng các thư mục này.
// Vector hợp lệ có thêm `files` (tập file của project, data-model §8 của feature 005, sắp theo byte UTF-8)
// và `digest` (digest nội dung, specs/005-device-online/contracts/matscada-package.md §4) cho
// projectFiles(), packageDigest() (TS) và LoadedProject::files(), digest (C++).
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { base02, cases02, large02 } from './v02.mjs';
import { base03, cases03, large03 } from './v03.mjs';
import { base06, cases01 as cases01_010, cases06 } from './v06.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect data-mat-uid="el_aaa" x="10" y="10" width="30" height="80" fill="#38bdf8"/>
  <circle data-mat-uid="el_bbb" cx="70" cy="50" r="20" fill="#64748b"/>
  <text data-mat-uid="el_ccc" x="10" y="98">--</text>
</svg>
`;

function base() {
  return {
    'project.json': {
      format: 'matscada-project',
      schemaVersion: '0.1.0',
      projectId: 'vector',
      projectName: 'Vector',
      projectVersion: '0.1.0',
      minRuntimeVersion: '0.2.0',
      entryScreen: 'main',
      screens: ['main'],
      tagFile: 'tags.json',
      maxClients: 10,
    },
    'tags.json': {
      schemaVersion: '0.1.0',
      tags: [
        {
          id: 'T.LEVEL',
          type: 'FLOAT32',
          min: 0,
          max: 100,
          source: { kind: 'mock', signal: 'tank.level' },
        },
        { id: 'T.RUN', type: 'BOOL', source: { kind: 'mock', signal: 'motor.run' } },
        { id: 'T.NAME', type: 'STRING', source: { kind: 'mock', signal: 'x.name' } },
      ],
    },
    'screens/main.screen.json': {
      schemaVersion: '0.1.0',
      id: 'main',
      name: 'Main',
      svgFile: 'screens/main.svg',
      viewBox: [0, 0, 100, 100],
      fitMode: 'contain',
      bindingFile: 'screens/main.bindings.json',
      elements: [{ elementUid: 'el_aaa' }, { elementUid: 'el_bbb' }, { elementUid: 'el_ccc' }],
    },
    'screens/main.bindings.json': {
      schemaVersion: '0.1.0',
      screenId: 'main',
      elements: [
        {
          elementUid: 'el_aaa',
          bindings: [
            {
              id: 'b1',
              target: 'geometry.levelPercent',
              source: { type: 'tag', tagId: 'T.LEVEL' },
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
              source: { type: 'tag', tagId: 'T.RUN' },
              transform: {
                kind: 'discreteMap',
                cases: [
                  { equals: true, value: '#22c55e' },
                  { equals: false, value: '#64748b' },
                ],
              },
            },
          ],
        },
      ],
    },
    'screens/main.svg': SVG,
  };
}

const B = 'screens/main.bindings.json';
const S = 'screens/main.screen.json';
const L = 'logging.json';
const bindingOf = (f, i = 0, j = 0) => f[B].elements[i].bindings[j];
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Màn hình gắn đúng `total` Tag khác nhau (2 Tag của base + Tag M.Txxxx), JSON gọn cho nhẹ repo. */
function screenTags(f, total) {
  const extra = Array.from({ length: total - 2 }, (_, i) => String(i + 1).padStart(4, '0'));
  for (const n of extra) {
    f['tags.json'].tags.push({
      id: `M.T${n}`,
      type: 'FLOAT32',
      source: { kind: 'mock', signal: 'sim.load' },
    });
    f[S].elements.push({ elementUid: `el_m${n}` });
    f[B].elements.push({
      elementUid: `el_m${n}`,
      bindings: [
        {
          id: `m${n}`,
          target: 'text.content',
          source: { type: 'tag', tagId: `M.T${n}` },
          transform: { kind: 'direct' },
        },
      ],
    });
  }
  for (const k of ['tags.json', S, B]) f[k] = JSON.stringify(f[k]) + '\n';
}

/** logging.json hợp lệ, chỉ lưu trên thiết bị (specs/003-data-logging/contracts/logging-config.md). */
const LOG = () => ({
  schemaVersion: '0.1.0',
  groups: [
    {
      id: 'fast',
      name: 'Fast',
      mode: 'onChange',
      minIntervalMs: 1000,
      retentionDays: 7,
      tags: [
        { tagId: 'T.LEVEL', deadband: 0.5 },
        { tagId: 'T.RUN' },
        { tagId: 'T.NAME', maxLength: 32 },
      ],
    },
    {
      id: 'shift',
      name: 'Shift',
      mode: 'cyclic',
      periodMs: 60000,
      retentionDays: 365,
      tags: [{ tagId: 'T.LEVEL', column: 'LEVEL' }],
    },
  ],
});
/** Cấu hình đầy đủ: 2 nhóm gửi đi, đủ 4 loại kết nối và mọi tổ hợp `tls` hợp lệ. */
const LOG_ALL = () => {
  const cfg = LOG();
  cfg.timeZone = '+07:00';
  cfg.groups[0].destinations = ['my1', 'ms1', 'pg1', 'in1'];
  cfg.groups[1].destinations = ['my2', 'ms2', 'pg2', 'in2'];
  cfg.groups[1].tags.push({ tagId: 'T.NAME', column: 'TEN', maxLength: 4000 });
  cfg.connections = [
    {
      id: 'my1',
      type: 'mysql',
      host: '192.168.1.50',
      port: 3306,
      database: 'scada',
      user: 'writer',
      tls: 'prefer',
    },
    {
      id: 'my2',
      type: 'mysql',
      host: 'db.local',
      database: 'scada',
      user: 'writer',
      tls: 'verify-full',
      timeZone: '+00:00',
    },
    {
      id: 'ms1',
      type: 'mssql',
      host: 'sql.local',
      port: 1433,
      database: 'scada',
      schema: 'hist',
      user: 'writer',
      tls: 'require',
    },
    {
      id: 'ms2',
      type: 'mssql',
      host: '10.0.0.5',
      database: 'scada',
      user: 'writer',
      tls: 'disable',
    },
    {
      id: 'pg1',
      type: 'postgresql',
      host: 'pg.local',
      database: 'scada',
      user: 'writer',
      tls: 'verify-full',
    },
    {
      id: 'pg2',
      type: 'postgresql',
      host: '10.0.0.6',
      port: 5433,
      database: 'scada',
      schema: 'public',
      user: 'writer',
    },
    {
      id: 'in1',
      type: 'influxdb',
      url: 'https://influx.local:8086',
      org: 'atpro',
      bucket: 'scada',
      tls: 'require',
    },
    { id: 'in2', type: 'influxdb', url: 'http://10.0.0.7:8086', org: 'atpro', bucket: 'scada' },
  ];
  return cfg;
};
const withLogging = (f, cfg = LOG()) => {
  f['project.json'].loggingFile = L;
  f[L] = cfg;
  return f[L];
};

/** [tên, hàm sửa base, mã lỗi mong đợi, mã cảnh báo mong đợi (tùy chọn)] */
const CASES = [
  ['valid-minimal', () => {}, []],
  [
    'valid-all-targets',
    (f) => {
      f[B].elements.push({
        elementUid: 'el_ccc',
        bindings: [
          {
            id: 'c1',
            target: 'text.content',
            source: { type: 'tag', tagId: 'T.LEVEL' },
            transform: { kind: 'direct' },
            format: { decimals: 1, suffix: ' %' },
          },
          {
            id: 'c2',
            target: 'style.opacity',
            source: { type: 'tag', tagId: 'T.LEVEL' },
            transform: {
              kind: 'linearScale',
              inMin: 0,
              inMax: 100,
              outMin: 0.2,
              outMax: 1,
              clamp: true,
            },
          },
          {
            id: 'c3',
            target: 'style.visibility',
            source: { type: 'tag', tagId: 'T.RUN' },
            transform: { kind: 'direct' },
          },
          {
            id: 'c4',
            target: 'style.stroke',
            source: { type: 'tag', tagId: 'T.NAME' },
            transform: { kind: 'direct' },
            onBadQuality: { mode: 'override', value: '#8d99a3' },
          },
          {
            id: 'c5',
            target: 'transform.rotate',
            source: { type: 'tag', tagId: 'T.RUN' },
            transform: { kind: 'direct' },
            animation: 'spin',
          },
          {
            id: 'c6',
            target: 'transform.rotate',
            source: { type: 'tag', tagId: 'T.LEVEL' },
            transform: { kind: 'linearScale', inMin: 0, inMax: 100, outMin: 0, outMax: 270 },
          },
          {
            id: 'c7',
            target: 'style.fill',
            source: { type: 'tag', tagId: 'T.LEVEL' },
            transform: {
              kind: 'discreteMap',
              cases: [{ equals: 0, value: '#000000' }],
              default: '#ffffff',
            },
            onBadQuality: { mode: 'hold' },
          },
        ],
      });
    },
    [],
  ],
  [
    'valid-script-svg',
    (f) => {
      f['screens/main.svg'] = SVG.replace(
        '</svg>',
        '  <script>window.__pwned = 1</script>\n  <rect data-mat-uid="el_ddd" onload="window.__pwned = 2" width="1" height="1"/>\n</svg>',
      );
    },
    [],
  ],
  ['invalid-json', (f) => (f['tags.json'] = '{ "schemaVersion": "0.1.0", "tags": [ '), ['E_JSON']],
  ['invalid-schema', (f) => (f['project.json'].projectName = 42), ['E_SCHEMA']],
  ['invalid-schema-target', (f) => (bindingOf(f).target = 'attr.href'), ['E_SCHEMA']],
  ['invalid-schema-version', (f) => (f['tags.json'].schemaVersion = '0.2.0'), ['E_SCHEMA_VERSION']],
  [
    'invalid-runtime-too-old',
    (f) => (f['project.json'].minRuntimeVersion = '9.0.0'),
    ['E_RUNTIME_TOO_OLD'],
  ],
  ['invalid-file-missing', (f) => delete f['screens/main.svg'], ['E_FILE_MISSING']],
  ['invalid-file-missing-screen', (f) => delete f[S], ['E_FILE_MISSING']],
  ['invalid-path-dotdot', (f) => (f[S].svgFile = '../main.svg'), ['E_PATH']],
  ['invalid-path-absolute', (f) => (f[S].svgFile = '/etc/passwd.svg'), ['E_PATH']],
  ['invalid-path-drive', (f) => (f[S].svgFile = 'C:\\x.svg'), ['E_PATH']],
  ['invalid-path-tagfile', (f) => (f['project.json'].tagFile = '../tags.json'), ['E_PATH']],
  ['invalid-entry-screen', (f) => (f['project.json'].entryScreen = 'other'), ['E_SCREEN_ID']],
  ['invalid-screen-id', (f) => (f[S].id = 'other'), ['E_SCREEN_ID']],
  ['invalid-binding-screen-id', (f) => (f[B].screenId = 'other'), ['E_SCREEN_ID']],
  [
    'invalid-dup-tag',
    (f) => f['tags.json'].tags.push({ ...f['tags.json'].tags[0] }),
    ['E_DUP_TAG'],
  ],
  [
    'invalid-tag-range',
    (f) => Object.assign(f['tags.json'].tags[0], { min: 10, max: 5 }),
    ['E_TAG_RANGE'],
  ],
  [
    'invalid-tag-range-bool',
    (f) => Object.assign(f['tags.json'].tags[1], { min: 0 }),
    ['E_TAG_RANGE'],
  ],
  ['invalid-dup-uid', (f) => f[S].elements.push({ elementUid: 'el_aaa' }), ['E_DUP_UID']],
  [
    'invalid-dup-uid-bindings',
    (f) => f[B].elements.push({ elementUid: 'el_aaa', bindings: [{ ...bindingOf(f), id: 'b9' }] }),
    ['E_DUP_UID'],
  ],
  ['invalid-dup-binding', (f) => (bindingOf(f, 1).id = 'b1'), ['E_DUP_BINDING']],
  ['invalid-ref-uid', (f) => (f[B].elements[0].elementUid = 'el_zzz'), ['E_REF_UID']],
  ['invalid-ref-tag', (f) => (bindingOf(f).source.tagId = 'T.LEVL'), ['E_REF_TAG']],
  [
    'invalid-target-unsupported',
    (f) => (bindingOf(f).target = 'transform.scale'),
    ['E_TARGET_UNSUPPORTED'],
  ],
  [
    'invalid-transform-unsupported',
    (f) => (bindingOf(f).transform = { kind: 'expression', expr: 'T.LEVEL * 2' }),
    ['E_TRANSFORM_UNSUPPORTED'],
  ],
  [
    'invalid-type-scale-bool',
    (f) =>
      (bindingOf(f, 1).transform = {
        kind: 'linearScale',
        inMin: 0,
        inMax: 1,
        outMin: 0,
        outMax: 1,
      }),
    ['E_TYPE_MISMATCH'],
  ],
  [
    'invalid-type-equals',
    (f) => (bindingOf(f, 1).transform.cases[0].equals = 'yes'),
    ['E_TYPE_MISMATCH'],
  ],
  ['invalid-type-level-bool', (f) => (bindingOf(f).source.tagId = 'T.RUN'), ['E_TYPE_MISMATCH']],
  [
    'invalid-scale-range',
    (f) =>
      (bindingOf(f).transform = {
        kind: 'linearScale',
        inMin: 5,
        inMax: 5,
        outMin: 0,
        outMax: 100,
      }),
    ['E_SCALE_RANGE'],
  ],
  ['invalid-max-clients', (f) => (f['project.json'].maxClients = 11), ['E_MAX_CLIENTS']],
  ['invalid-max-clients-zero', (f) => (f['project.json'].maxClients = 0), ['E_MAX_CLIENTS']],
  // Review M2: 2^32 + 1 must not wrap to 1 in the C++ validator
  [
    'invalid-max-clients-overflow',
    (f) => (f['project.json'].maxClients = 4294967297),
    ['E_MAX_CLIENTS'],
  ],
  // Review M3: nesting deeper than 64 is refused before the (recursive) parser
  [
    'invalid-json-deep',
    (f) =>
      (f['tags.json'] =
        '{"schemaVersion":"0.1.0","tags":[],"x":' + '['.repeat(100) + ']'.repeat(100) + '}\n'),
    ['E_JSON'],
  ],
  // Review M1: strings longer than 1024 UTF-8 bytes are refused before regex matching
  [
    'invalid-schema-longstring',
    (f) => (f['project.json'].projectVersion = '0.1.0-' + 'a'.repeat(100000)),
    ['E_SCHEMA'],
  ],
  // Review minor-5: path length is counted in UTF-8 bytes on both sides
  [
    'invalid-path-utf8-length',
    (f) => (f[S].svgFile = 'screens/' + 'ệ'.repeat(40) + '.svg'),
    ['E_PATH'],
  ],
  // Audit FR-007: schemaVersion đúng ^0\.1\.\d+$, không nhận hậu tố pre-release
  [
    'invalid-schema-version-prerelease',
    (f) => (f['project.json'].schemaVersion = '0.1.0-dev'),
    ['E_SCHEMA_VERSION'],
  ],
  // Audit FR-008: mã hóa văn bản và cách viết số cho cùng kết luận ở hai bản
  // (contracts/project-format.md, "Kiểm tra trước schema")
  [
    'valid-json-bom', // một BOM UTF-8 đầu file được bỏ qua
    (f) => {
      f['project.json'] = Buffer.concat([BOM, Buffer.from(json(f['project.json']))]);
      f['tags.json'] = Buffer.concat([BOM, Buffer.from(json(f['tags.json']))]);
    },
    [],
  ],
  [
    'invalid-json-bom-twice',
    (f) => (f['tags.json'] = Buffer.concat([BOM, BOM, Buffer.from(json(f['tags.json']))])),
    ['E_JSON'],
  ],
  [
    'invalid-json-utf8', // "Bể" lưu bằng Windows-1258 (0x42 0xEA 0xD2): không phải UTF-8
    (f) => {
      f['tags.json'].tags[0].description = '@@';
      const t = json(f['tags.json']);
      const i = t.indexOf('@@');
      f['tags.json'] = Buffer.concat([
        Buffer.from(t.slice(0, i)),
        Buffer.from([0x42, 0xea, 0xd2]),
        Buffer.from(t.slice(i + 2)),
      ]);
    },
    ['E_JSON'],
  ],
  ['invalid-json-surrogate', (f) => (f['tags.json'].tags[0].description = '\ud800'), ['E_JSON']],
  [
    'invalid-json-number-overflow', // 1e400 vượt double: nlohmann báo lỗi parse, JSON.parse cho Infinity
    (f) =>
      (f['project.json'] = json(f['project.json']).replace(
        '"maxClients": 10',
        '"maxClients": 1e400',
      )),
    ['E_JSON'],
  ],
  [
    'valid-integral-float', // JSON Schema: integer là số không có phần lẻ (1e1, 120.0, 7.0, 1e3)
    (f) => {
      f[L] = json(withLogging(f))
        .replace('"retentionDays": 7', '"retentionDays": 7.0')
        .replace('"minIntervalMs": 1000', '"minIntervalMs": 1e3');
      f['project.json'].supportedBrowsers = [{ engine: 'chromium', minVersion: 120 }];
      f['project.json'] = json(f['project.json'])
        .replace('"maxClients": 10', '"maxClients": 1e1')
        .replace('"minVersion": 120', '"minVersion": 120.0');
    },
    [],
    [],
  ],
  ['invalid-schema-integer-fraction', (f) => (f['project.json'].maxClients = 10.5), ['E_SCHEMA']],
  [
    'invalid-max-clients-float-huge', // số nguyên vượt int64 viết dạng số thực: vẫn là integer
    (f) =>
      (f['project.json'] = json(f['project.json']).replace(
        '"maxClients": 10',
        '"maxClients": 1e19',
      )),
    ['E_MAX_CLIENTS'],
  ],
  // Audit FR-032: tagFile là .json như các file khác; tên file đúng chữ hoa/thường như ext4 trên
  // thiết bị (Windows/NTFS và Docker Desktop không phân biệt)
  [
    'invalid-schema-tagfile-extension',
    (f) => {
      f['project.json'].tagFile = 'tags.txt';
      f['tags.txt'] = f['tags.json'];
      delete f['tags.json'];
    },
    ['E_SCHEMA'],
  ],
  ['invalid-file-missing-case', (f) => (f[S].svgFile = 'screens/Main.svg'), ['E_FILE_MISSING']],
  // Audit C-04: một subscribe của giao thức live mang tối đa 1000 Tag (live_hub maxSubscribeTags)
  ['valid-screen-1000-tags', (f) => screenTags(f, 1000), []],
  ['invalid-screen-tags', (f) => screenTags(f, 1001), ['E_SCREEN_TAGS']],
  // Feature 003: nạp logging.json (luật E_LOG_* ở các vector logging-invalid-* của US5)
  ['logging-valid-local-only', (f) => withLogging(f), [], []],
  ['logging-invalid-schema', (f) => (withLogging(f).groups[0].mode = 'sometimes'), ['E_SCHEMA']],
  [
    'logging-invalid-path',
    (f) => {
      withLogging(f);
      f['project.json'].loggingFile = '../logging.json';
    },
    ['E_PATH'],
  ],
  [
    'logging-invalid-missing',
    (f) => {
      withLogging(f);
      delete f[L];
    },
    ['E_FILE_MISSING'],
  ],
  [
    'logging-invalid-version',
    (f) => (withLogging(f).schemaVersion = '0.2.0'),
    ['E_SCHEMA_VERSION'],
  ],
  // US5: luật E_LOG_* và cảnh báo W_LOG_* (contracts/logging-config.md)
  // LOG_ALL has connections that do not check the server (prefer, require, disable, https +
  // require, http to another host): W_LOG_TLS_UNVERIFIED (security review M2). pg2 has no tls:
  // verify-full by default (Constitution V), no warning.
  [
    'logging-valid',
    (f) => withLogging(f, LOG_ALL()),
    [],
    ['W_LOG_TLS_UNVERIFIED'],
    // both validators must point at the same connections, not only give the same code
    {
      W_LOG_TLS_UNVERIFIED: [
        '/connections/0',
        '/connections/2',
        '/connections/3',
        '/connections/6',
        '/connections/7',
      ],
    },
  ],
  [
    'logging-valid-verified', // every connection checks the server; SQL Server verify-full is allowed
    (f) => {
      const cfg = withLogging(f, LOG_ALL());
      for (const c of cfg.connections) if (c.type !== 'influxdb') c.tls = 'verify-full';
      delete cfg.connections[6].tls; // https, certificate checked
      cfg.connections[7].url = 'http://localhost:8086'; // the same machine: nothing on the wire
    },
    [],
    [],
  ],
  [
    'logging-valid-digit-group', // id starting with a digit, no table: table t_3pha (data-model §1)
    (f) => (withLogging(f).groups[1].id = '3pha'),
    [],
    [],
  ],
  [
    'logging-warn-budget', // 200 Tag FLOAT32 mỗi 100 ms: ~3,4 GB ghi/ngày
    (f) => {
      for (let i = 1; i <= 200; i++)
        f['tags.json'].tags.push({
          id: `W.T${String(i).padStart(3, '0')}`,
          type: 'FLOAT32',
          source: { kind: 'mock', signal: 'sim.load' },
        });
      withLogging(f, {
        schemaVersion: '0.1.0',
        groups: [
          {
            id: 'wide',
            name: 'Wide',
            mode: 'cyclic',
            periodMs: 100,
            retentionDays: 1,
            tags: f['tags.json'].tags
              .filter((t) => t.id.startsWith('W.'))
              .map((t) => ({ tagId: t.id })),
          },
        ],
      });
    },
    [],
    ['W_LOG_WRITE_BUDGET'],
  ],
  [
    'logging-warn-size-cap', // 3 Tag mỗi 1 s giữ 3650 ngày: ~32 GB
    (f) =>
      withLogging(f, {
        schemaVersion: '0.1.0',
        groups: [
          {
            id: 'decade',
            name: 'Decade',
            mode: 'cyclic',
            periodMs: 1000,
            retentionDays: 3650,
            tags: [{ tagId: 'T.LEVEL' }, { tagId: 'T.RUN' }, { tagId: 'T.NAME' }],
          },
        ],
      }),
    [],
    ['W_LOG_SIZE_CAP'],
  ],
  [
    'logging-invalid-secret', // quét trước schema: chỉ một mã
    (f) => {
      const cfg = withLogging(f, LOG_ALL());
      cfg.connections[0].password = 'hunter2';
    },
    ['E_LOG_SECRET'],
  ],
  [
    'logging-invalid-dup-id',
    (f) => {
      const cfg = withLogging(f);
      cfg.groups[1].id = 'fast';
      cfg.groups[1].table = 'shift_table'; // chỉ trùng id, không trùng bảng
    },
    ['E_LOG_DUP_ID'],
  ],
  [
    'logging-invalid-ref-tag',
    (f) => (withLogging(f).groups[0].tags[0].tagId = 'T.NOPE'),
    ['E_LOG_REF_TAG'],
  ],
  [
    'logging-invalid-dup-tag', // mục lặp không bị kiểm thêm E_LOG_COLUMN
    (f) => withLogging(f).groups[0].tags.push({ tagId: 'T.RUN' }),
    ['E_LOG_DUP_TAG'],
  ],
  [
    'logging-invalid-ref-dest',
    (f) => (withLogging(f).groups[0].destinations = ['nope']),
    ['E_LOG_REF_DEST'],
  ],
  [
    'logging-invalid-column-reserved',
    (f) => (withLogging(f).groups[0].tags[1].column = 'time'),
    ['E_LOG_COLUMN'],
  ],
  // reserved by the databases (review C2, I5): SQLite rowid, PostgreSQL system columns, the
  // InfluxDB tag source and names starting with _
  [
    'logging-invalid-column-rowid',
    (f) => (withLogging(f).groups[0].tags[1].column = 'RowId'),
    ['E_LOG_COLUMN'],
  ],
  [
    'logging-invalid-column-pg-system',
    (f) => (withLogging(f).groups[0].tags[1].column = 'XMAX'),
    ['E_LOG_COLUMN'],
  ],
  [
    'logging-invalid-column-influx',
    (f) => (withLogging(f).groups[0].tags[1].column = '_value'),
    ['E_LOG_COLUMN'],
  ],
  [
    'logging-invalid-column-source',
    (f) => (withLogging(f).groups[0].tags[1].column = 'Source'),
    ['E_LOG_COLUMN'],
  ],
  [
    'logging-invalid-column-dup', // khác hoa/thường vẫn là trùng
    (f) => {
      const g = withLogging(f).groups[0];
      g.tags[0].column = 'Level';
      g.tags[1].column = 'LEVEL';
    },
    ['E_LOG_COLUMN'],
  ],
  ['logging-invalid-table-dup', (f) => (withLogging(f).groups[1].table = 'fast'), ['E_LOG_TABLE']],
  [
    'logging-invalid-deadband',
    (f) => (withLogging(f).groups[0].tags[1].deadband = 1),
    ['E_LOG_DEADBAND'],
  ],
  [
    'logging-invalid-maxlen',
    (f) => (withLogging(f).groups[0].tags[0].maxLength = 10),
    ['E_LOG_MAXLEN'],
  ],
  ['logging-invalid-mode', (f) => delete withLogging(f).groups[1].periodMs, ['E_LOG_MODE']],
  [
    'logging-invalid-limit', // 65 Tag STRING trong một nhóm
    (f) => {
      for (let i = 1; i <= 65; i++)
        f['tags.json'].tags.push({
          id: `S.T${String(i).padStart(3, '0')}`,
          type: 'STRING',
          source: { kind: 'mock', signal: 'x.name' },
        });
      withLogging(f).groups[1].tags = f['tags.json'].tags
        .filter((t) => t.id.startsWith('S.'))
        .map((t) => ({ tagId: t.id }));
    },
    ['E_LOG_LIMIT'],
  ],
  [
    'logging-invalid-conn',
    (f) => delete withLogging(f, LOG_ALL()).connections[0].user,
    ['E_LOG_CONN'],
  ],
  [
    'logging-invalid-tls',
    (f) => (withLogging(f, LOG_ALL()).connections[7].tls = 'require'),
    ['E_LOG_TLS'],
  ],
  [
    'logging-invalid-url-credentials', // security review L4: user and password in the URL
    (f) =>
      (withLogging(f, LOG_ALL()).connections[6].url = 'https://admin:S3cret@influx.local:8086'),
    ['E_LOG_SECRET'],
  ],
  [
    'logging-invalid-url-query', // the URL is a base: no query or fragment (the runtime adds the path)
    (f) => (withLogging(f, LOG_ALL()).connections[6].url = 'https://influx.local:8086/?org=x'),
    ['E_SCHEMA'],
  ],
  [
    'logging-invalid-key-kelvin', // review S13: keys compare in ASCII (K is U+212A KELVIN SIGN)
    (f) => (withLogging(f, LOG_ALL()).connections[0]['to\u212Aen'] = 'x'),
    ['E_SCHEMA'],
  ],
];

// Feature 010 (T010): hai ca 0.1 của logging-010-* (logging 0.1 giữ kết luận; trường mới bị từ chối).
CASES.push(...cases01_010(LOG, withLogging));

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const byUtf8 = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const stripBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/**
 * Tập file và digest của project hợp lệ đã ghi trong `dir`: `project.json`, `tagFile`, `loggingFile` (nếu
 * có), mỗi màn hình `screens/<id>.screen.json`, `bindingFile`, `svgFile`; digest trên byte trên đĩa.
 */
function packageInfo(dir) {
  const read = (rel) => readFileSync(join(dir, rel));
  const parse = (rel) => JSON.parse(stripBom(read(rel).toString('utf8')));
  const p = parse('project.json');
  const set = new Set(['project.json', p.tagFile]);
  if (p.loggingFile !== undefined) set.add(p.loggingFile);
  if (p.reportsFile !== undefined) set.add(p.reportsFile); // định dạng 0.6 (feature 010)
  // Định dạng 0.2 (contracts/project-format-0.2.md §1)
  if (p.connectionFile !== undefined) set.add(p.connectionFile);
  for (const name of p.valueTables ?? []) set.add(`value-tables/${name}.json`);
  for (const id of p.watchTables ?? []) set.add(`watch-tables/${id}.json`);
  for (const id of p.screens) {
    const s = parse(`screens/${id}.screen.json`);
    set.add(`screens/${id}.screen.json`);
    if (Array.isArray(s.items)) {
      // Định dạng 0.3 (contracts/project-format-0.3.md §1): file của từng item svg
      for (const it of s.items) if (it.type === 'svg') set.add(it.bindingFile).add(it.svgFile);
    } else set.add(s.bindingFile).add(s.svgFile);
  }
  const files = [...set].sort(byUtf8);
  const text = files
    .map((rel) => {
      const b = read(rel);
      return `${sha256(b)} ${b.length} ${rel}\n`;
    })
    .join('');
  return { files, digest: 'sha256:' + sha256(Buffer.from(text, 'utf8')) };
}

const write = (dir, files, expected) => {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(dirname(p), { recursive: true });
    // Buffer: byte ghi nguyên văn (BOM, UTF-8 hỏng); chuỗi: văn bản viết tay; còn lại: JSON chuẩn.
    writeFileSync(
      p,
      Buffer.isBuffer(content) || typeof content === 'string' ? content : json(content),
    );
  }
  if (expected.valid) Object.assign(expected, packageInfo(dir));
  writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected) + '\n');
};

/** Ghi một ca 0.3: [tên, hàm sửa, mã lỗi, cảnh báo, { issues }]. */
const writeCase03 = (dir, [, mutate, errors, warnings, extra]) => {
  const files = base03();
  mutate(files);
  const expected = { valid: errors.length === 0, errors };
  if (warnings !== undefined) expected.warnings = warnings;
  if (extra?.issues !== undefined) expected.issues = extra.issues;
  write(dir, files, expected);
};

// `--out02`, `--out03`, `--out` (cả hai): chỉ sinh các ca lớn vào out/ (không commit; chạy trước test).
// Mỗi lần chỉ xóa thư mục cùng tiền tố (v02-, v03-) để hai bộ test chạy song song không giẫm lên nhau.
const outFlags = ['--out', '--out02', '--out03'].filter((a) => process.argv.includes(a));
if (outFlags.length > 0) {
  const outDir = join(here, 'out');
  mkdirSync(outDir, { recursive: true });
  const both = outFlags.includes('--out');
  const clear = (prefix) => {
    for (const d of readdirSync(outDir))
      if (d.startsWith(prefix)) rmSync(join(outDir, d), { recursive: true, force: true });
  };
  if (both || outFlags.includes('--out02')) {
    clear('v02-');
    const large = large02();
    for (const [name, mutate, errors] of large) {
      const files = base02();
      mutate(files);
      write(join(outDir, name), files, { valid: errors.length === 0, errors });
    }
    console.log(`${large.length} vector lớn 0.2 trong ${outDir}`);
  }
  if (both || outFlags.includes('--out03')) {
    clear('v03-');
    const large = large03();
    for (const c of large) writeCase03(join(outDir, c[0]), c);
    console.log(`${large.length} vector lớn 0.3 trong ${outDir}`);
  }
  process.exit(0);
}

for (const d of readdirSync(here)) {
  const p = join(here, d);
  if (statSync(p).isDirectory()) rmSync(p, { recursive: true });
}

for (const [name, mutate, errors, warnings, warningPaths] of CASES) {
  const files = base();
  mutate(files);
  const expected = { valid: errors.length === 0, errors };
  if (warnings !== undefined) expected.warnings = warnings;
  if (warningPaths !== undefined) expected.warningPaths = warningPaths;
  write(join(here, name), files, expected);
}

// Project mẫu thật cũng là một vector hợp lệ.
const demo = join(here, 'valid-tank-demo');
cpSync(resolve(root, 'projects/tank-demo'), demo, {
  recursive: true,
  filter: (s) => !s.endsWith('README.md'),
});
writeFileSync(
  join(demo, 'expected.json'),
  JSON.stringify({ valid: true, errors: [], warnings: [], ...packageInfo(demo) }) + '\n',
);

// Định dạng 0.2 (feature 006, T013): ca `v02-*`, mỗi mã lỗi và cảnh báo của §7 có ít nhất một ca.
const CASES02 = cases02(base);
for (const [name, mutate, errors, warnings, extra] of CASES02) {
  const files = base02();
  mutate(files);
  const expected = { valid: errors.length === 0, errors };
  if (warnings !== undefined) expected.warnings = warnings;
  if (extra?.spans !== undefined) expected.spans = extra.spans;
  write(join(here, name), files, expected);
}

// Định dạng 0.3 (feature 007, T009): ca `v03-*`, mỗi mã lỗi và cảnh báo của §7 có ít nhất một ca.
const CASES03 = cases03();
for (const c of CASES03) writeCase03(join(here, c[0]), c);

// Định dạng 0.6 (feature 010, T010, T095): ca `v06-*` (logging-010-*, report-*), mô tả ở README-010.md.
const CASES06 = cases06();
for (const [name, mutate, errors, warnings, extra] of CASES06) {
  const files = base06();
  mutate(files);
  const expected = { valid: errors.length === 0, errors };
  if (warnings !== undefined) expected.warnings = warnings;
  if (extra?.issues !== undefined) expected.issues = extra.issues;
  if (extra?.estimate !== undefined) expected.estimate = extra.estimate;
  write(join(here, name), files, expected);
}

console.log(
  `${CASES.length + 1 + CASES02.length + CASES03.length + CASES06.length} vector trong ${here}`,
);
