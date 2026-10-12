// So sánh project trên máy với thiết bị (specs/005-device-online/research.md R15, data-model.md §11, FR-029):
// theo SHA-256 từng file trước, rồi theo đối tượng chỉ cho file ≠, +, -. Ký hiệu = ≠ + -.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  MemorySource,
  compareFiles,
  compareProjects,
  deviceReads,
  loggingImpact,
  packageDigest,
  packageFile,
  summarizeCompare,
  type CompareResult,
  type DeviceSide,
  type LocalSide,
  type ObjectDiff,
  type PackageFile,
  type ProjectSource,
  type ReadResult,
} from './index.ts';

const nodeSha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const sha = (text: string) => nodeSha256(new TextEncoder().encode(text));

/** Nội dung file: đối tượng JSON (ghi như Studio, 2 dấu cách) hoặc văn bản nguyên văn (SVG, JSON hỏng). */
type Files = Record<string, unknown>;
const textOf = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2) + '\n');
const clone = <T>(v: T): T => structuredClone(v);

interface Built {
  digest: string;
  files: PackageFile[];
  texts: Record<string, string>;
}

async function build(files: Files): Promise<Built> {
  const texts = Object.fromEntries(Object.entries(files).map(([p, v]) => [p, textOf(v)]));
  const list = await Promise.all(
    Object.entries(texts).map(([p, t]) => packageFile(p, t, nodeSha256)),
  );
  return { digest: await packageDigest(list, nodeSha256), files: list, texts };
}

/** Nguồn đọc có ghi lại đường dẫn đã đọc. */
class SpySource implements ProjectSource {
  readonly reads: string[] = [];
  private readonly inner: MemorySource;
  private readonly fail: Record<string, ReadResult>;
  constructor(texts: Record<string, string>, fail: Record<string, ReadResult> = {}) {
    this.inner = new MemorySource(texts);
    this.fail = fail;
  }
  async read(rel: string): Promise<ReadResult> {
    this.reads.push(rel);
    return this.fail[rel] ?? this.inner.read(rel);
  }
}

async function local(files: Files): Promise<LocalSide & { spy: SpySource }> {
  const b = await build(files);
  const spy = new SpySource(b.texts);
  return { digest: b.digest, files: b.files, source: spy, spy };
}

/** Bên thiết bị: manifest và gói chỉ được lấy khi cần (đếm số lần gọi). */
async function device(files: Files, fail: Record<string, ReadResult> = {}) {
  const b = await build(files);
  const spy = new SpySource(b.texts, fail);
  const side = {
    digest: b.digest,
    files: vi.fn(async () => b.files),
    source: vi.fn(async () => spy as ProjectSource),
  } satisfies DeviceSide;
  return { side, spy };
}

const run = async (l: Files, d: Files, fail: Record<string, ReadResult> = {}) => {
  const ls = await local(l);
  const ds = await device(d, fail);
  const result = await compareProjects(ls, ds.side);
  return { result, local: ls, device: ds };
};

const objectsOf = (r: CompareResult, kind?: ObjectDiff['kind']) =>
  r.objects.filter((o) => kind === undefined || o.kind === kind);
const find = (r: CompareResult, kind: ObjectDiff['kind'], key: string) =>
  r.objects.find((o) => o.kind === kind && o.key === key);
const changed = (r: CompareResult) => r.objects.filter((o) => o.status !== '=');
const statusOfFiles = (r: CompareResult) =>
  Object.fromEntries(r.files.map((f) => [f.path, f.status]));

// ---------- Project mẫu (thiết bị) ----------

const PROJECT = {
  format: 'matscada-project',
  schemaVersion: '0.1.0',
  projectId: 'tram-bom',
  projectName: 'Trạm bơm',
  projectVersion: '1.0.0',
  minRuntimeVersion: '0.4.0',
  entryScreen: 'overview',
  screens: ['overview', 'pump'],
  tagFile: 'tags.json',
  maxClients: 10,
  loggingFile: 'logging.json',
};
const TAGS = {
  schemaVersion: '0.1.0',
  tags: [
    {
      id: 'TANK01.LEVEL',
      type: 'FLOAT32',
      unit: '%',
      min: 0,
      max: 100,
      source: { kind: 'mock', signal: 'tank.level' },
    },
    { id: 'MOTOR01.RUN', type: 'BOOL', source: { kind: 'mock', signal: 'motor.run' } },
    {
      id: 'MOTOR01.SPEED',
      type: 'FLOAT32',
      min: 0,
      max: 1500,
      source: { kind: 'mock', signal: 'motor.speed' },
    },
  ],
};
const LOGGING = {
  schemaVersion: '0.1.0',
  timeZone: '+07:00',
  groups: [
    {
      id: 'van-hanh',
      name: 'Vận hành',
      mode: 'onChange',
      minIntervalMs: 1000,
      retentionDays: 30,
      tags: [{ tagId: 'TANK01.LEVEL', deadband: 0.5 }, { tagId: 'MOTOR01.RUN' }],
    },
    {
      id: 'bao-cao',
      name: 'Báo cáo',
      mode: 'cyclic',
      periodMs: 60000,
      retentionDays: 365,
      tags: [{ tagId: 'TANK01.LEVEL' }],
    },
  ],
  connections: [{ id: 'mysql1', type: 'mysql', host: '10.0.0.5', port: 3306, database: 'scada' }],
};
const screen = (id: string, name: string, elements: object[]) => ({
  schemaVersion: '0.1.0',
  id,
  name,
  svgFile: `screens/${id}.svg`,
  viewBox: [0, 0, 1280, 720],
  fitMode: 'contain',
  bindingFile: `screens/${id}.bindings.json`,
  elements,
});
const tagSource = (tagId: string) => ({ type: 'tag', tagId });
const BASE: Files = {
  'project.json': PROJECT,
  'tags.json': TAGS,
  'logging.json': LOGGING,
  'screens/overview.screen.json': screen('overview', 'Tổng quan', [
    { elementUid: 'el_tank_level', name: 'Mức nước', kind: 'shape' },
    { elementUid: 'el_pump_body', name: 'Bơm', kind: 'shape' },
  ]),
  'screens/overview.bindings.json': {
    schemaVersion: '0.1.0',
    screenId: 'overview',
    elements: [
      {
        elementUid: 'el_tank_level',
        bindings: [
          {
            id: 'level',
            target: 'geometry.levelPercent',
            source: tagSource('TANK01.LEVEL'),
            transform: { kind: 'direct' },
            direction: 'up',
          },
        ],
      },
      {
        elementUid: 'el_pump_body',
        bindings: [
          {
            id: 'run-color',
            target: 'style.fill',
            source: tagSource('MOTOR01.RUN'),
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
  'screens/overview.svg':
    '<svg xmlns="http://www.w3.org/2000/svg"><rect data-mat-uid="el_tank_level"/></svg>\n',
  'screens/pump.screen.json': screen('pump', 'Bơm', [
    { elementUid: 'el_speed_text', name: 'Tốc độ', kind: 'text' },
  ]),
  'screens/pump.bindings.json': {
    schemaVersion: '0.1.0',
    screenId: 'pump',
    elements: [
      {
        elementUid: 'el_speed_text',
        bindings: [
          {
            id: 'speed',
            target: 'text.content',
            source: tagSource('MOTOR01.SPEED'),
            transform: { kind: 'direct' },
            format: { decimals: 0, suffix: ' rpm' },
          },
        ],
      },
    ],
  },
  'screens/pump.svg':
    '<svg xmlns="http://www.w3.org/2000/svg"><text data-mat-uid="el_speed_text"/></svg>\n',
};

/** Bản sao chép sâu của BASE, truy cập tự do như JSON đã parse. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Editable = Record<string, any>;
const edited = (fn: (f: Editable) => void): Files => {
  const f = clone(BASE) as Editable;
  fn(f);
  return f;
};

const ALL_KEYS = [
  'project:project',
  'tag:TANK01.LEVEL',
  'tag:MOTOR01.RUN',
  'tag:MOTOR01.SPEED',
  'logging-settings:logging',
  'logging-group:van-hanh',
  'logging-group:bao-cao',
  'logging-connection:mysql1',
  'screen:overview',
  'screen:pump',
  'svg:screens/overview.svg',
  'svg:screens/pump.svg',
  'binding:overview/el_tank_level/level',
  'binding:overview/el_pump_body/run-color',
  'binding:pump/el_speed_text/speed',
];
const keysOf = (r: CompareResult) => r.objects.map((o) => `${o.kind}:${o.key}`);

// ---------- Bước 1: theo file ----------

describe('compareFiles (R15 bước 1)', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);
  const f = (path: string, sha256: string, size = 1): PackageFile => ({ path, size, sha256 });

  it('cùng SHA-256 =, khác ≠, chỉ trên máy +, chỉ trên thiết bị -; sắp theo byte UTF-8', () => {
    expect(
      compareFiles(
        [f('b.json', A), f('a.json', A), f('only-local.svg', C), f('Z.json', B)],
        [f('a.json', A), f('b.json', B), f('only-device.json', C), f('Z.json', B)],
      ),
    ).toEqual([
      { path: 'Z.json', status: '=', localSha256: B, deviceSha256: B },
      { path: 'a.json', status: '=', localSha256: A, deviceSha256: A },
      { path: 'b.json', status: '≠', localSha256: A, deviceSha256: B },
      { path: 'only-device.json', status: '-', deviceSha256: C },
      { path: 'only-local.svg', status: '+', localSha256: C },
    ]);
  });

  it('đường dẫn trùng trong một bên: lỗi lập trình', () => {
    expect(() => compareFiles([f('a.json', A), f('a.json', B)], [])).toThrow();
    expect(() => compareFiles([], [f('a.json', A), f('a.json', A)])).toThrow();
  });

  it('deviceReads: chỉ file JSON ≠ hoặc - (SVG không so sâu, + không có trên thiết bị)', () => {
    const files = compareFiles(
      [f('a.json', A), f('b.json', A), f('c.json', A), f('x.svg', A), f('y.svg', A)],
      [f('a.json', A), f('b.json', B), f('d.json', C), f('x.svg', B), f('z.svg', C)],
    );
    expect(deviceReads(files)).toEqual(['b.json', 'd.json']);
  });
});

// ---------- Bước 2: theo đối tượng ----------

describe('compareProjects (R15)', () => {
  it('hai digest bằng nhau: mọi file và đối tượng =, không lấy manifest hay gói của thiết bị', async () => {
    const { result, device: d } = await run(BASE, BASE);
    expect(result.same).toBe(true);
    expect(result.localDigest).toBe(result.deviceDigest);
    expect(d.side.files).not.toHaveBeenCalled();
    expect(d.side.source).not.toHaveBeenCalled();
    expect(result.files.map((f) => f.status)).toEqual(Array(9).fill('='));
    expect(result.files.find((f) => f.path === 'project.json')).toEqual({
      path: 'project.json',
      status: '=',
      localSha256: sha(textOf(PROJECT)),
      deviceSha256: sha(textOf(PROJECT)),
    });
    expect(keysOf(result)).toEqual(ALL_KEYS);
    expect(result.objects.every((o) => o.status === '=' && o.fields.length === 0)).toBe(true);
  });

  it('chỉ khác SVG: lấy manifest, không tải gói; SVG ≠ theo SHA-256 (không so sâu)', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg"><text data-mat-uid="el_speed_text">x</text></svg>\n';
    const l = edited((f) => (f['screens/pump.svg'] = svg));
    const { result, local: ls, device: d } = await run(l, BASE);
    expect(result.same).toBe(false);
    expect(d.side.files).toHaveBeenCalledTimes(1);
    expect(d.side.source).not.toHaveBeenCalled();
    expect(ls.spy.reads.some((p) => p.endsWith('.svg'))).toBe(false);
    expect(changed(result)).toEqual([
      {
        kind: 'svg',
        key: 'screens/pump.svg',
        file: 'screens/pump.svg',
        status: '≠',
        fields: [
          { path: '/sha256', local: sha(svg), device: sha(textOf(BASE['screens/pump.svg'])) },
          {
            path: '/size',
            local: svg.length,
            device: textOf(BASE['screens/pump.svg']).length,
          },
        ],
      },
    ]);
    expect(keysOf(result)).toEqual(ALL_KEYS); // đối tượng = vẫn có trong danh sách
  });

  it('theo đối tượng chỉ cho file ≠, +, -: chỉ đọc của thiết bị file JSON ≠, -', async () => {
    const l = edited((f) => {
      f['tags.json'].tags[2].max = 1200;
    });
    const { result, device: d } = await run(l, BASE);
    expect(statusOfFiles(result)['tags.json']).toBe('≠');
    expect(d.side.source).toHaveBeenCalledTimes(1);
    expect(d.spy.reads).toEqual(['tags.json']);
    expect(changed(result)).toEqual([
      {
        kind: 'tag',
        key: 'MOTOR01.SPEED',
        file: 'tags.json',
        status: '≠',
        fields: [{ path: '/max', local: 1200, device: 1500 }],
      },
    ]);
  });

  it('project: từng trường, trừ danh sách screens', async () => {
    const l = edited((f) => {
      f['project.json'].projectVersion = '1.1.0';
      f['project.json'].maxClients = 5;
      f['project.json'].screens = ['pump', 'overview']; // chỉ đổi thứ tự
      f['project.json'].supportedBrowsers = [{ engine: 'chromium', minVersion: 120 }];
    });
    const { result } = await run(l, BASE);
    expect(statusOfFiles(result)['project.json']).toBe('≠');
    expect(changed(result)).toEqual([
      {
        kind: 'project',
        key: 'project',
        file: 'project.json',
        status: '≠',
        fields: [
          { path: '/projectVersion', local: '1.1.0', device: '1.0.0' },
          { path: '/maxClients', local: 5, device: 10 },
          { path: '/supportedBrowsers', local: [{ engine: 'chromium', minVersion: 120 }] },
        ],
      },
    ]);
  });

  it('tag theo id: thêm +, bớt -, đổi ≠ từng trường; đổi thứ tự không tính là khác', async () => {
    const l = edited((f) => {
      const [level, , speed] = f['tags.json'].tags;
      speed.max = 1200;
      speed.source.signal = 'motor.rpm';
      delete speed.min;
      f['tags.json'].tags = [
        speed,
        level,
        { id: 'TANK01.TEMP', type: 'FLOAT32', source: { kind: 'mock', signal: 'tank.temp' } },
      ];
    });
    const { result } = await run(l, BASE);
    expect(objectsOf(result, 'tag')).toEqual([
      {
        kind: 'tag',
        key: 'MOTOR01.SPEED',
        file: 'tags.json',
        status: '≠',
        fields: [
          { path: '/max', local: 1200, device: 1500 },
          { path: '/source/signal', local: 'motor.rpm', device: 'motor.speed' },
          { path: '/min', device: 0 },
        ],
      },
      { kind: 'tag', key: 'TANK01.LEVEL', file: 'tags.json', status: '=', fields: [] },
      { kind: 'tag', key: 'TANK01.TEMP', file: 'tags.json', status: '+', fields: [] },
      { kind: 'tag', key: 'MOTOR01.RUN', file: 'tags.json', status: '-', fields: [] },
    ]);
  });

  it('chỉ đổi thứ tự Tag: file ≠ nhưng mọi Tag =', async () => {
    const l = edited((f) => f['tags.json'].tags.reverse());
    const { result } = await run(l, BASE);
    expect(statusOfFiles(result)['tags.json']).toBe('≠');
    expect(changed(result)).toEqual([]);
  });

  it('nhóm lưu trữ và kết nối theo id; Tag của nhóm theo tagId; thiết lập chung của file lưu trữ', async () => {
    const l = edited((f) => {
      const log = f['logging.json'];
      log.timeZone = '+08:00';
      const g = log.groups[0];
      g.tags = [{ tagId: 'MOTOR01.RUN' }, { tagId: 'TANK01.LEVEL', deadband: 1 }];
      g.tags.push({ tagId: 'MOTOR01.SPEED', deadband: 10 });
      log.groups = [
        g,
        {
          id: 'ca-dem',
          name: 'Ca đêm',
          mode: 'cyclic',
          periodMs: 5000,
          retentionDays: 7,
          tags: [],
        },
      ];
      log.connections[0].port = 3307;
      log.connections.push({ id: 'pg1', type: 'postgresql', host: '10.0.0.6' });
    });
    const { result } = await run(l, BASE);
    expect(changed(result)).toEqual([
      {
        kind: 'logging-settings',
        key: 'logging',
        file: 'logging.json',
        status: '≠',
        fields: [{ path: '/timeZone', local: '+08:00', device: '+07:00' }],
      },
      {
        kind: 'logging-group',
        key: 'van-hanh',
        file: 'logging.json',
        status: '≠',
        fields: [
          { path: '/tags/TANK01.LEVEL/deadband', local: 1, device: 0.5 },
          { path: '/tags/MOTOR01.SPEED', local: { tagId: 'MOTOR01.SPEED', deadband: 10 } },
        ],
      },
      { kind: 'logging-group', key: 'ca-dem', file: 'logging.json', status: '+', fields: [] },
      { kind: 'logging-group', key: 'bao-cao', file: 'logging.json', status: '-', fields: [] },
      {
        kind: 'logging-connection',
        key: 'mysql1',
        file: 'logging.json',
        status: '≠',
        fields: [{ path: '/port', local: 3307, device: 3306 }],
      },
      { kind: 'logging-connection', key: 'pg1', file: 'logging.json', status: '+', fields: [] },
    ]);
  });

  it('project không còn lưu trữ: thiết lập, nhóm, kết nối của thiết bị đều -', async () => {
    const l = edited((f) => {
      delete f['project.json'].loggingFile;
      delete f['logging.json'];
    });
    const { result, device: d } = await run(l, BASE);
    expect(statusOfFiles(result)['logging.json']).toBe('-');
    expect(d.spy.reads).toEqual(['project.json', 'logging.json']);
    expect(changed(result).map((o) => `${o.status} ${o.kind}:${o.key}`)).toEqual([
      '≠ project:project',
      '- logging-settings:logging',
      '- logging-group:van-hanh',
      '- logging-group:bao-cao',
      '- logging-connection:mysql1',
    ]);
    expect(find(result, 'project', 'project')?.fields).toEqual([
      { path: '/loggingFile', device: 'logging.json' },
    ]);
  });

  it('màn hình: trường của *.screen.json, phần tử theo elementUid', async () => {
    const l = edited((f) => {
      const s = f['screens/overview.screen.json'];
      s.name = 'Tổng quan trạm';
      s.viewBox = [0, 0, 1920, 1080];
      s.elements[1].name = 'Bơm chính';
      s.elements.reverse();
    });
    const { result } = await run(l, BASE);
    expect(changed(result)).toEqual([
      {
        kind: 'screen',
        key: 'overview',
        file: 'screens/overview.screen.json',
        status: '≠',
        fields: [
          { path: '/name', local: 'Tổng quan trạm', device: 'Tổng quan' },
          { path: '/viewBox', local: [0, 0, 1920, 1080], device: [0, 0, 1280, 720] },
          { path: '/elements/el_pump_body/name', local: 'Bơm chính', device: 'Bơm' },
        ],
      },
    ]);
  });

  it('binding: khóa elementUid rồi binding.id; từng thuộc tính', async () => {
    const l = edited((f) => {
      const els = f['screens/overview.bindings.json'].elements;
      els[1].bindings[0].transform.cases[0].value = '#16a34a';
      delete els[0].bindings[0].direction;
      els[0].bindings.push({
        id: 'level-2',
        target: 'style.opacity',
        source: tagSource('TANK01.LEVEL'),
        transform: { kind: 'direct' },
      });
    });
    const { result } = await run(l, BASE);
    expect(changed(result)).toEqual([
      {
        kind: 'binding',
        key: 'overview/el_tank_level/level',
        file: 'screens/overview.bindings.json',
        status: '≠',
        fields: [{ path: '/direction', device: 'up' }],
      },
      {
        kind: 'binding',
        key: 'overview/el_tank_level/level-2',
        file: 'screens/overview.bindings.json',
        status: '+',
        fields: [],
      },
      {
        kind: 'binding',
        key: 'overview/el_pump_body/run-color',
        file: 'screens/overview.bindings.json',
        status: '≠',
        fields: [{ path: '/transform/cases/0/value', local: '#16a34a', device: '#22c55e' }],
      },
    ]);
  });

  it('màn hình chỉ có trên máy +, chỉ có trên thiết bị -: kèm SVG và binding', async () => {
    const l = edited((f) => {
      f['project.json'].screens = ['overview', 'alarm'];
      delete f['screens/pump.screen.json'];
      delete f['screens/pump.bindings.json'];
      delete f['screens/pump.svg'];
      f['screens/alarm.screen.json'] = screen('alarm', 'Cảnh báo', [
        { elementUid: 'el_alarm_lamp', name: 'Đèn' },
      ]);
      f['screens/alarm.bindings.json'] = {
        schemaVersion: '0.1.0',
        screenId: 'alarm',
        elements: [
          {
            elementUid: 'el_alarm_lamp',
            bindings: [
              {
                id: 'lamp',
                target: 'style.fill',
                source: tagSource('MOTOR01.RUN'),
                transform: { kind: 'direct' },
              },
            ],
          },
        ],
      };
      f['screens/alarm.svg'] = '<svg xmlns="http://www.w3.org/2000/svg"/>\n';
    });
    const { result, device: d } = await run(l, BASE);
    expect(d.spy.reads.sort()).toEqual([
      'project.json', // ≠ vì danh sách screens đổi
      'screens/pump.bindings.json',
      'screens/pump.screen.json',
    ]);
    expect(changed(result).map((o) => `${o.status} ${o.kind}:${o.key} (${o.file})`)).toEqual([
      '+ screen:alarm (screens/alarm.screen.json)',
      '- screen:pump (screens/pump.screen.json)',
      '+ svg:screens/alarm.svg (screens/alarm.svg)',
      '- svg:screens/pump.svg (screens/pump.svg)',
      '+ binding:alarm/el_alarm_lamp/lamp (screens/alarm.bindings.json)',
      '- binding:pump/el_speed_text/speed (screens/pump.bindings.json)',
    ]);
    expect(find(result, 'project', 'project')?.status).toBe('='); // chỉ danh sách screens đổi
  });

  it('fields chỉ có khi ≠; thứ tự theo kind: project, tag, lưu trữ, màn hình, SVG, binding', async () => {
    const l = edited((f) => {
      f['tags.json'].tags[0].max = 99;
      f['screens/overview.svg'] = '<svg/>\n';
    });
    const { result } = await run(l, BASE);
    const kinds = result.objects.map((o) => o.kind);
    expect([...new Set(kinds)]).toEqual([
      'project',
      'tag',
      'logging-settings',
      'logging-group',
      'logging-connection',
      'screen',
      'svg',
      'binding',
    ]);
    for (const o of result.objects)
      expect(o.fields.length > 0, `${o.kind}:${o.key}`).toBe(o.status === '≠');
  });

  it('file không đọc được hoặc JSON hỏng: đánh dấu unreadable, bỏ cả họ đối tượng ở hai bên', async () => {
    const l = edited((f) => {
      f['tags.json'] = '{ "schemaVersion": "0.1.0", "tags": [ ';
      f['screens/overview.bindings.json'].elements[0].bindings[0].direction = 'down';
    });
    const { result } = await run(l, BASE, {
      'screens/overview.bindings.json': { error: 'missing' },
    });
    expect(result.files.find((f) => f.path === 'tags.json')).toMatchObject({
      status: '≠',
      unreadable: 'local',
    });
    expect(result.files.find((f) => f.path === 'screens/overview.bindings.json')).toMatchObject({
      status: '≠',
      unreadable: 'device',
    });
    expect(objectsOf(result, 'tag')).toEqual([]);
    expect(keysOf(result).filter((k) => k.startsWith('binding:'))).toEqual([
      'binding:pump/el_speed_text/speed',
    ]);
    expect(find(result, 'logging-group', 'van-hanh')?.status).toBe('=');
    expect(result.files.filter((f) => f.unreadable).map((f) => f.path)).toEqual([
      'screens/overview.bindings.json',
      'tags.json',
    ]);
  });

  it('thiết bị chưa có project (danh sách file rỗng): mọi đối tượng trên máy là +', async () => {
    const ls = await local(BASE);
    const empty = {
      digest: 'none',
      files: vi.fn(async () => [] as PackageFile[]),
      source: vi.fn(async () => new MemorySource({}) as ProjectSource),
    } satisfies DeviceSide;
    const result = await compareProjects(ls, empty);
    expect(empty.source).not.toHaveBeenCalled();
    expect(result.files.every((f) => f.status === '+')).toBe(true);
    expect(keysOf(result)).toEqual(ALL_KEYS);
    expect(result.objects.every((o) => o.status === '+')).toBe(true);
  });

  it('project.json hỏng ở một bên: chỉ so được theo file và SVG', async () => {
    const l = edited((f) => (f['project.json'] = '{'));
    const { result } = await run(l, BASE);
    expect(result.files.find((f) => f.path === 'project.json')?.unreadable).toBe('local');
    expect([...new Set(result.objects.map((o) => o.kind))]).toEqual(['svg']);
  });

  it('khóa lạ: JSON pointer thoát ~ và /; khóa trùng tên thuộc tính của Object không bị đọc nhầm', async () => {
    const l = edited((f) => {
      const t = f['tags.json'].tags[0];
      t['a/b~c'] = 1;
      t.constructor = 'x';
      t.toString = { v: 1 };
    });
    const d = edited((f) => {
      f['tags.json'].tags[0]['a/b~c'] = 2;
    });
    const { result } = await run(l, d);
    expect(find(result, 'tag', 'TANK01.LEVEL')?.fields).toEqual([
      { path: '/a~1b~0c', local: 1, device: 2 },
      { path: '/constructor', local: 'x' },
      { path: '/toString', local: { v: 1 } },
    ]);
  });

  it('kịch bản quickstart §5 bước 12 (projects/tank-demo): thêm một Tag, đổi một deadband, đổi một binding', async () => {
    const DIR = resolve(__dirname, '../../../projects/tank-demo');
    const rels = [
      'project.json',
      'tags.json',
      'logging.json',
      'screens/tank-motor.screen.json',
      'screens/tank-motor.bindings.json',
      'screens/tank-motor.svg',
    ];
    const disk: Files = Object.fromEntries(
      rels.map((r) => [r, readFileSync(join(DIR, r), 'utf8')]),
    );
    const json = (r: string) => JSON.parse(disk[r] as string);
    const tags = json('tags.json');
    tags.tags.push({
      id: 'TANK01.PRESSURE',
      type: 'FLOAT32',
      unit: 'bar',
      min: 0,
      max: 10,
      source: { kind: 'mock', signal: 'tank.pressure' },
    });
    const logging = json('logging.json');
    logging.groups[0].tags[0].deadband = 1;
    const bindings = json('screens/tank-motor.bindings.json');
    bindings.elements[0].bindings[1].transform.outMin = 0.5;
    const l: Files = {
      ...disk,
      'tags.json': tags,
      'logging.json': logging,
      'screens/tank-motor.bindings.json': bindings,
    };
    const { result } = await run(l, disk);
    expect(statusOfFiles(result)).toEqual({
      'logging.json': '≠',
      'project.json': '=',
      'screens/tank-motor.bindings.json': '≠',
      'screens/tank-motor.screen.json': '=',
      'screens/tank-motor.svg': '=',
      'tags.json': '≠',
    });
    expect(changed(result)).toEqual([
      { kind: 'tag', key: 'TANK01.PRESSURE', file: 'tags.json', status: '+', fields: [] },
      {
        kind: 'logging-group',
        key: 'van-hanh',
        file: 'logging.json',
        status: '≠',
        fields: [{ path: '/tags/TANK01.LEVEL/deadband', local: 1, device: 0.5 }],
      },
      {
        kind: 'binding',
        key: 'tank-motor/el_tank_level/level-opacity',
        file: 'screens/tank-motor.bindings.json',
        status: '≠',
        fields: [{ path: '/transform/outMin', local: 0.5, device: 0.6 }],
      },
    ]);
    // Mọi đối tượng còn lại đều có mặt với ký hiệu =.
    expect(objectsOf(result, 'tag')).toHaveLength(6);
    expect(objectsOf(result, 'binding').filter((o) => o.status === '=')).toHaveLength(8);
  });
});

// ---------- Tóm tắt cho bước xem trước của Nạp xuống (FR-020) ----------

describe('summarizeCompare, loggingImpact', () => {
  it('summarizeCompare: số đối tượng theo ký hiệu và theo kind', async () => {
    const l = edited((f) => {
      f['tags.json'].tags[0].max = 99;
      f['tags.json'].tags.push({ id: 'X.Y', type: 'BOOL', source: { kind: 'mock', signal: 'x' } });
      f['logging.json'] = JSON.stringify(LOGGING, null, 4) + '\n'; // cùng nội dung, khác định dạng
      f['screens/pump.svg'] = '<svg/>\n';
    });
    const { result } = await run(l, BASE);
    expect(statusOfFiles(result)['logging.json']).toBe('≠');
    expect(summarizeCompare(result)).toEqual({
      same: false,
      counts: { '=': 13, '≠': 2, '+': 1, '-': 0 },
      byKind: { tag: { '≠': 1, '+': 1, '-': 0 }, svg: { '≠': 1, '+': 0, '-': 0 } },
    });
    const same = await run(BASE, BASE);
    expect(summarizeCompare(same.result)).toEqual({
      same: true,
      counts: { '=': 15, '≠': 0, '+': 0, '-': 0 },
      byKind: {},
    });
  });

  it('loggingImpact: nhóm thêm, bớt, đổi; cột mới; kết nối; thiết lập chung', async () => {
    const l = edited((f) => {
      const log = f['logging.json'];
      log.groups[0].tags.push({ tagId: 'MOTOR01.SPEED' });
      log.groups[0].tags[1].column = 'bom_chay';
      log.groups[0].retentionDays = 60;
      log.groups.splice(1, 1);
      log.groups.push({
        id: 'ca-dem',
        name: 'Ca đêm',
        mode: 'cyclic',
        periodMs: 5000,
        retentionDays: 7,
        tags: [{ tagId: 'TANK01.LEVEL' }],
      });
      log.connections = [];
    });
    const { result } = await run(l, BASE);
    expect(loggingImpact(result)).toEqual({
      settings: '=',
      added: ['ca-dem'],
      removed: ['bao-cao'],
      changed: ['van-hanh'],
      newColumns: [
        { group: 'van-hanh', tagId: 'MOTOR01.RUN' },
        { group: 'van-hanh', tagId: 'MOTOR01.SPEED' },
      ],
      connections: { added: [], removed: ['mysql1'], changed: [] },
    });
    const none = await run(BASE, BASE);
    expect(loggingImpact(none.result)).toEqual({
      settings: '=',
      added: [],
      removed: [],
      changed: [],
      newColumns: [],
      connections: { added: [], removed: [], changed: [] },
    });
    const noLogging = edited((f) => {
      delete f['project.json'].loggingFile;
      delete f['logging.json'];
    });
    const both = await run(noLogging, noLogging);
    expect(loggingImpact(both.result).settings).toBeNull();
  });
});
