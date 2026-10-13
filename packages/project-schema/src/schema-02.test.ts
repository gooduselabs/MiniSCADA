// Schema 0.2.0 (T032; contracts/project-format-0.2.md §1–§8, data-model §1–§5): mỗi ràng buộc trích từ
// data-model có ít nhất một ca đạt và một ca hỏng (E_SCHEMA). Nền: vector `v02-valid-full`.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors/v02-valid-full');
const FILES = [
  'project.json',
  'tags.json',
  'connections.json',
  'value-tables/TrangThaiBom.json',
  'watch-tables/van-hanh.json',
  'screens/main.screen.json',
  'screens/main.bindings.json',
  'screens/main.svg',
];

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON tùy ý của project

function load(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FILES) out[f] = readFileSync(join(DIR, f), 'utf8');
  return out;
}

/** Sửa file `file` (JSON) bằng `mutate`, kiểm project và trả mã lỗi (tập, đã sắp). */
async function codesAfter(file: string, mutate: (j: Json) => void): Promise<string[]> {
  const files = load();
  const j = JSON.parse(files[file]!);
  mutate(j);
  files[file] = JSON.stringify(j);
  const r = await validateProject(new MemorySource(files), {
    checkSvg: false,
    runtimeVersion: '0.5.0',
  });
  return [...new Set(r.errors.map((e) => e.code))].sort();
}

const tag = (j: Json, id: string): Json => j.tags.find((t: Json) => t.id === id);
const dev = (j: Json, id: string): Json =>
  j.channels.flatMap((c: Json) => c.devices).find((d: Json) => d.id === id);

interface Row {
  name: string;
  file: string;
  /** Đặt giá trị vào vị trí cần kiểm. */
  set: (j: Json, v: unknown) => void;
  ok: unknown[];
  bad: unknown[];
}

const T = 'tags.json';
const C = 'connections.json';
const V = 'value-tables/TrangThaiBom.json';
const W = 'watch-tables/van-hanh.json';
const P = 'project.json';
const rows: Row[] = [
  // định danh
  {
    name: 'id kênh',
    file: C,
    set: (j, v) => (j.channels[0].id = v),
    ok: ['a', 'a-b', 'a'.repeat(32), '0x'],
    bad: ['A', '-a', 'a'.repeat(33), 'a_b', ''],
  },
  {
    name: 'id thiết bị trường',
    file: C,
    set: (j, v) => (dev(j, 'meter2').id = v),
    ok: ['m2', 'a'.repeat(32)],
    bad: ['M2', 'a'.repeat(33), 'a b'],
  },
  {
    name: 'tên bảng giá trị (project)',
    file: P,
    set: (j, v) => (j.valueTables = [v]),
    ok: ['A', 'A_1', 'a'.repeat(64)],
    bad: ['1A', 'A-B', 'A'.repeat(65), ''],
  },
  {
    name: 'id bảng theo dõi (project)',
    file: P,
    set: (j, v) => (j.watchTables = [v]),
    ok: ['a', 'a-b', 'a'.repeat(48)],
    bad: ['A', '-a', 'a'.repeat(49), 'a_b'],
  },
  {
    name: 'tên Tag của bảng theo dõi',
    file: W,
    set: (j, v) => (j.rows[0].tag = v),
    ok: ['A', 'A.B_1'],
    bad: ['1A', 'A..B', 'x'.repeat(65)],
  },
  // văn bản
  {
    name: 'description',
    file: T,
    set: (j, v) => (tag(j, 'TANK01.LEVEL').description = v),
    ok: ['x'.repeat(200)],
    bad: ['x'.repeat(201)],
  },
  {
    name: 'unit',
    file: T,
    set: (j, v) => (tag(j, 'TANK01.LEVEL').unit = v),
    ok: ['x'.repeat(16)],
    bad: ['x'.repeat(17)],
  },
  {
    name: 'tên kênh',
    file: C,
    set: (j, v) => (j.channels[0].name = v),
    ok: ['x'.repeat(64)],
    bad: ['x'.repeat(65)],
  },
  {
    name: 'tên bảng theo dõi',
    file: W,
    set: (j, v) => (j.name = v),
    ok: ['x'.repeat(80)],
    bad: ['x'.repeat(81), ''],
  },
  // serial
  {
    name: 'serial.baud',
    file: C,
    set: (j, v) => (j.channels[1].serial.baud = v),
    ok: [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200],
    bad: [1000, 0, 230400, '9600'],
  },
  {
    name: 'serial.dataBits',
    file: C,
    set: (j, v) => (j.channels[1].serial.dataBits = v),
    ok: [7, 8],
    bad: [6, 9],
  },
  {
    name: 'serial.parity',
    file: C,
    set: (j, v) => (j.channels[1].serial.parity = v),
    ok: ['none', 'even', 'odd'],
    bad: ['mark', 'EVEN'],
  },
  {
    name: 'serial.stopBits',
    file: C,
    set: (j, v) => (j.channels[1].serial.stopBits = v),
    ok: [1, 2],
    bad: [0, 3],
  },
  {
    name: 'serial.silenceMs',
    file: C,
    set: (j, v) => (j.channels[1].serial.silenceMs = v),
    ok: [0, 5, 1000],
    bad: [-1, 1001],
  },
  // thiết bị trường và kênh
  {
    name: 'unitId',
    file: C,
    set: (j, v) => (dev(j, 'plc1').unitId = v),
    ok: [0, 1, 255],
    bad: [-1, 256, 1.5],
  },
  {
    name: 'slave',
    file: C,
    set: (j, v) => (dev(j, 'meter1').slave = v),
    ok: [1, 247],
    bad: [0, 248],
  },
  {
    name: 'timeoutMs',
    file: C,
    set: (j, v) => (dev(j, 'plc1').timeoutMs = v),
    ok: [100, 10000],
    bad: [99, 10001],
  },
  {
    name: 'retries',
    file: C,
    set: (j, v) => (dev(j, 'plc1').retries = v),
    ok: [0, 5],
    bad: [-1, 6],
  },
  {
    name: 'writeDeadlineMs',
    file: C,
    set: (j, v) => (dev(j, 'plc1').writeDeadlineMs = v),
    ok: [1000, 60000],
    bad: [999, 60001],
  },
  {
    name: 'requestGapMs',
    file: C,
    set: (j, v) => (j.channels[0].requestGapMs = v),
    ok: [0, 1000],
    bad: [-1, 1001],
  },
  {
    name: 'tcp.connectTimeoutMs',
    file: C,
    set: (j, v) => (j.channels[0].tcp.connectTimeoutMs = v),
    ok: [500, 30000],
    bad: [499, 30001],
  },
  {
    name: 'tcp.reconnectMaxS',
    file: C,
    set: (j, v) => (j.channels[0].tcp.reconnectMaxS = v),
    ok: [1, 60],
    bad: [0, 61],
  },
  {
    name: 'tcp.port',
    file: C,
    set: (j, v) => (j.channels[0].tcp.port = v),
    ok: [1, 502, 65535],
    bad: [0, 65536],
  },
  {
    name: 'tcp.host',
    file: C,
    set: (j, v) => (j.channels[0].tcp.host = v),
    ok: ['a', 'x'.repeat(253)],
    bad: ['', 'x'.repeat(254)],
  },
  {
    name: 'addressBase',
    file: C,
    set: (j, v) => (dev(j, 'plc1').addressBase = v),
    ok: [0, 1],
    bad: [2, -1],
  },
  {
    name: 'maxReadRegisters',
    file: C,
    set: (j, v) => (dev(j, 'plc1').maxReadRegisters = v),
    ok: [1, 125],
    bad: [0, 126],
  },
  {
    name: 'maxReadBits',
    file: C,
    set: (j, v) => (dev(j, 'plc1').maxReadBits = v),
    ok: [1, 2000],
    bad: [0, 2001],
  },
  {
    name: 'byteOrder của thiết bị',
    file: C,
    set: (j, v) => (dev(j, 'plc1').byteOrder = v),
    ok: ['ABCD', 'CDAB', 'BADC', 'DCBA'],
    bad: ['abcd', 'AB'],
  },
  {
    name: 'write.singleRegister',
    file: C,
    set: (j, v) => (dev(j, 'plc1').write.singleRegister = v),
    ok: ['fc06', 'fc16'],
    bad: ['fc05'],
  },
  {
    name: 'write.singleCoil',
    file: C,
    set: (j, v) => (dev(j, 'plc1').write.singleCoil = v),
    ok: ['fc05', 'fc15'],
    bad: ['fc06'],
  },
  {
    name: 'write.registerBit',
    file: C,
    set: (j, v) => (dev(j, 'plc1').write.registerBit = v),
    ok: ['none', 'mask', 'rmw'],
    bad: ['fc22'],
  },
  {
    name: 'nhóm quét fast',
    file: C,
    set: (j, v) => (j.scanGroups.fast = v),
    ok: [100, 60000],
    bad: [99, 60001, 1.5],
  },
  {
    name: 'nhóm quét normal',
    file: C,
    set: (j, v) => (j.scanGroups.normal = v),
    ok: [100, 60000],
    bad: [99, 60001],
  },
  {
    name: 'nhóm quét slow',
    file: C,
    set: (j, v) => (j.scanGroups.slow = v),
    ok: [100, 60000],
    bad: [99, 60001],
  },
  {
    name: 'kind của kênh',
    file: C,
    set: (j, v) => (j.channels[0].kind = v),
    ok: ['modbus-tcp'],
    bad: ['modbus-ascii', 'modbus-rtu'],
  },
  // Tag
  {
    name: 'stringLength',
    file: T,
    set: (j, v) => (tag(j, 'PUMP01.NAME').source.stringLength = v),
    ok: [1, 250],
    bad: [0, 251, 1.5],
  },
  {
    name: 'source.scanGroup',
    file: T,
    set: (j, v) => (tag(j, 'TANK01.LEVEL').source.scanGroup = v),
    ok: ['fast', 'normal', 'slow'],
    bad: ['medium'],
  },
  {
    name: 'source.stringByteOrder',
    file: T,
    set: (j, v) => (tag(j, 'PUMP01.NAME').source.stringByteOrder = v),
    ok: ['AB', 'BA'],
    bad: ['ABCD'],
  },
  {
    name: 'access',
    file: T,
    set: (j, v) => (tag(j, 'TANK01.LEVEL').access = v),
    ok: ['R', 'RW'],
    bad: ['W', 'rw'],
  },
  {
    name: 'kind của Tag',
    file: T,
    set: (j, v) => (tag(j, 'TANK01.SP_HI').kind = v),
    ok: ['internal'],
    bad: ['mock', 'virtual'],
  },
  {
    name: 'valueTable của Tag (mẫu tên)',
    file: T,
    set: (j, v) => (tag(j, 'PUMP01.STATE').valueTable = v),
    ok: ['TrangThaiBom'],
    bad: ['1x', 'a-b'],
  },
  // mô phỏng
  {
    name: 'sim.periodMs',
    file: T,
    set: (j, v) => (tag(j, 'DEMO.WAVE').sim.periodMs = v),
    ok: [100, 86400000],
    bad: [99, 86400001, 100.5],
  },
  {
    name: 'sim.phase',
    file: T,
    set: (j, v) => (tag(j, 'DEMO.WAVE').sim.phase = v),
    ok: [0, 0.25, 1],
    bad: [-0.1, 1.1],
  },
  {
    name: 'sim.duty',
    file: T,
    set: (j, v) => (tag(j, 'DEMO.WAVE').sim = { kind: 'square', periodMs: 1000, duty: v }),
    ok: [0, 0.5, 1],
    bad: [-0.1, 1.5],
  },
  {
    name: 'sim.seed',
    file: T,
    set: (j, v) =>
      (tag(j, 'DEMO.WAVE').sim = { kind: 'random', min: 0, max: 1, periodMs: 1000, seed: v }),
    ok: [0, 1, 4294967295],
    bad: [-1, 4294967296, 1.5],
  },
  {
    name: 'sim.kind',
    file: T,
    set: (j, v) => (tag(j, 'DEMO.WAVE').sim.kind = v),
    ok: ['sine'],
    bad: ['triangle'],
  },
  {
    name: 'sim.signal (legacy)',
    file: T,
    set: (j, v) => (tag(j, 'DEMO.WAVE').sim = { kind: 'legacy', signal: v }),
    ok: ['tank.level', 'a'],
    bad: ['Tank', '1a', ''],
  },
  // bảng giá trị
  {
    name: 'màu của mục',
    file: V,
    set: (j, v) => (j.entries[0].color = v),
    ok: ['#000000', '#AbCdEf'],
    bad: ['#00000', '#GGGGGG', 'red', '000000'],
  },
  {
    name: 'màu mặc định',
    file: V,
    set: (j, v) => (j.default.color = v),
    ok: ['#112233'],
    bad: ['#1122'],
  },
  {
    name: 'value của mục',
    file: V,
    set: (j, v) => (j.entries[0].value = v),
    ok: [0, -1.5, true, false],
    bad: ['0', null],
  },
  {
    name: 'description của bảng giá trị',
    file: V,
    set: (j, v) => (j.description = v),
    ok: ['x'.repeat(200)],
    bad: ['x'.repeat(201)],
  },
  // bảng theo dõi
  {
    name: 'rows[].format',
    file: W,
    set: (j, v) => (j.rows[0].format = v),
    ok: ['auto', 'dec', 'hex', 'bin', 'bool'],
    bad: ['octal', 'AUTO'],
  },
  {
    name: 'rows[].decimals',
    file: W,
    set: (j, v) => (j.rows[0].decimals = v),
    ok: [0, 9],
    bad: [-1, 10, 1.5],
  },
  {
    name: 'rows[].writeValue',
    file: W,
    set: (j, v) => (j.rows[0].writeValue = v),
    ok: ['75', '', 'x'.repeat(64)],
    bad: [75, 'x'.repeat(65)],
  },
];

describe('schema 0.2: ràng buộc của data-model', () => {
  it('nền v02-valid-full không có lỗi', async () => {
    expect(await codesAfter(T, () => {})).toEqual([]);
  });

  for (const r of rows) {
    describe(r.name, () => {
      for (const v of r.ok)
        it(`đạt: ${JSON.stringify(v).slice(0, 40)}`, async () => {
          expect(
            await codesAfter(r.file, (j) => r.set(j, v)),
            'không được có E_SCHEMA',
          ).not.toContain('E_SCHEMA');
        });
      for (const v of r.bad)
        it(`hỏng: ${JSON.stringify(v).slice(0, 40)}`, async () => {
          expect(await codesAfter(r.file, (j) => r.set(j, v))).toContain('E_SCHEMA');
        });
    });
  }
});

describe('schema 0.2: cấu trúc', () => {
  it('mục bảng giá trị có đúng một trong `value` hoặc (`from` và/hoặc `to`)', async () => {
    const entry = (e: Json) => codesAfter(V, (j) => j.entries.push(e));
    expect(await entry({ from: 100, to: 200, text: 'x' })).not.toContain('E_SCHEMA');
    expect(await entry({ from: 100, text: 'x' })).not.toContain('E_SCHEMA');
    expect(await entry({ to: 100, text: 'x' })).not.toContain('E_SCHEMA');
    expect(await entry({ value: 100, text: 'x' })).not.toContain('E_SCHEMA');
    expect(await entry({ text: 'x' })).toContain('E_SCHEMA'); // cả hai vắng
    expect(await entry({ value: 100, from: 1, text: 'x' })).toContain('E_SCHEMA');
    expect(await entry({ value: 100 })).toContain('E_SCHEMA'); // thiếu text
  });

  it('`text` của mục không giới hạn ký tự ở schema (E_VT_TEXT báo ở luật)', async () => {
    const codes = await codesAfter(V, (j) => (j.entries[0].text = 'x'.repeat(65)));
    expect(codes).toEqual(['E_VT_TEXT']);
  });

  it('`expression` không có pattern và không có trần ký tự ở schema', async () => {
    const schema = JSON.parse(
      readFileSync(resolve(DIR, '../../../schemas/0.2/tag.schema.json'), 'utf8'),
    );
    const expr = schema.definitions.calculated.properties.expression;
    expect(expr).toEqual({ type: 'string' });
  });

  it('khóa lạ ở mọi cấp là E_SCHEMA', async () => {
    expect(await codesAfter(T, (j) => (j.extra = 1))).toContain('E_SCHEMA');
    expect(await codesAfter(T, (j) => (tag(j, 'TANK01.LEVEL').source.extra = 1))).toContain(
      'E_SCHEMA',
    );
    expect(await codesAfter(C, (j) => (j.channels[0].extra = 1))).toContain('E_SCHEMA');
    expect(await codesAfter(C, (j) => (dev(j, 'plc1').extra = 1))).toContain('E_SCHEMA');
    expect(await codesAfter(V, (j) => (j.extra = 1))).toContain('E_SCHEMA');
    expect(await codesAfter(W, (j) => (j.rows[0].extra = 1))).toContain('E_SCHEMA');
    expect(await codesAfter(P, (j) => (j.extra = 1))).toContain('E_SCHEMA');
  });

  it('thiết bị trường: `unitId` chỉ ở kênh TCP, `slave` chỉ ở kênh RTU', async () => {
    expect(await codesAfter(C, (j) => (dev(j, 'plc1').slave = 1))).toContain('E_SCHEMA');
    expect(await codesAfter(C, (j) => (dev(j, 'meter1').unitId = 1))).toContain('E_SCHEMA');
  });

  it('kênh: `tcp` theo kind modbus-tcp, `serial` theo kind modbus-rtu', async () => {
    expect(await codesAfter(C, (j) => delete j.channels[0].tcp)).toContain('E_SCHEMA');
    expect(await codesAfter(C, (j) => delete j.channels[1].serial)).toContain('E_SCHEMA');
    expect(await codesAfter(C, (j) => (j.channels[0].serial = { port: 'ttyAS2' }))).toContain(
      'E_SCHEMA',
    );
  });

  it('binding: transform valueTable có `table` tùy chọn và `output` text | color', async () => {
    const B = 'screens/main.bindings.json';
    const set = (tr: Json) => codesAfter(B, (j) => (j.elements[2].bindings[0].transform = tr));
    expect(await set({ kind: 'valueTable', output: 'text' })).not.toContain('E_SCHEMA');
    expect(await set({ kind: 'valueTable', table: 'TrangThaiBom', output: 'text' })).not.toContain(
      'E_SCHEMA',
    );
    expect(await set({ kind: 'valueTable', table: '1x', output: 'text' })).toContain('E_SCHEMA');
    expect(await set({ kind: 'valueTable', output: 'icon' })).toContain('E_SCHEMA');
    expect(await set({ kind: 'valueTable' })).toContain('E_SCHEMA');
  });

  it('transform rangeMap, format, expression của binding vẫn là E_TRANSFORM_UNSUPPORTED', async () => {
    const B = 'screens/main.bindings.json';
    for (const kind of ['rangeMap', 'format', 'expression'])
      expect(await codesAfter(B, (j) => (j.elements[2].bindings[0].transform = { kind }))).toEqual([
        'E_TRANSFORM_UNSUPPORTED',
      ]);
  });

  it('project.json 0.2: connectionFile, valueTables, watchTables tùy chọn', async () => {
    expect(await codesAfter(P, (j) => (j.valueTables = []))).not.toContain('E_SCHEMA');
    expect(await codesAfter(P, (j) => (j.connectionFile = 'x'))).toContain('E_SCHEMA'); // quá ngắn, không .json
  });
});
