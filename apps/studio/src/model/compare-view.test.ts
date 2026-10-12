// Mô hình So sánh của Studio (feature 005, US3, data-model §11, research R15, FR-029, FR-030): bảng dòng
// `= ≠ + -`, ánh xạ sang nút cây, bản tóm tắt cho viewer, tự so khi cần, và "Đọc lên phần chọn".
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MemorySource,
  compareProjects,
  packageDigest,
  packageFile,
  type CompareResult,
  type LocalSide,
  type PackageFile,
} from '@mat/project-schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioStore } from '../app/store.ts';
import { createMockPlatform } from '../platform/mock.ts';
import type { Role } from '../platform/device-types.ts';
import type { CompareState } from './device-session.ts';
import {
  CompareRunner,
  applyFromDevice,
  briefOf,
  compareRows,
  treeMarks,
  type CompareEnv,
} from './compare-view.ts';

const DEMO = resolve(__dirname, '../../../../projects/tank-demo');
const REL = [
  'project.json',
  'tags.json',
  'logging.json',
  'screens/tank-motor.screen.json',
  'screens/tank-motor.bindings.json',
  'screens/tank-motor.svg',
];
const demo = (): Record<string, string> =>
  Object.fromEntries(REL.map((f) => [f, readFileSync(resolve(DEMO, f), 'utf8')]));

const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

/** Thiết bị khác máy: Tag LEVEL đổi max, bỏ TEMP, thêm DEV.ONLY; deadband lưu trữ khác; một binding khác. */
function deviceFiles(): Record<string, string> {
  const f = demo();
  const tags = JSON.parse(f['tags.json']) as { tags: Array<Record<string, unknown>> };
  tags.tags[0].max = 120;
  const temp = tags.tags.findIndex((x) => x.id === 'TANK01.TEMP');
  tags.tags.splice(temp, 1);
  tags.tags.push({
    id: 'DEV.ONLY',
    type: 'BOOL',
    description: 'Chỉ có trên thiết bị',
    source: { kind: 'mock', signal: 'motor.run' },
  });
  f['tags.json'] = json(tags);
  const logging = JSON.parse(f['logging.json']) as {
    groups: Array<{ tags: Array<{ deadband?: number }> }>;
  };
  logging.groups[0].tags[0].deadband = 0.9;
  f['logging.json'] = json(logging);
  const bindings = JSON.parse(f['screens/tank-motor.bindings.json']) as {
    elements: Array<{ bindings: Array<{ direction?: string }> }>;
  };
  bindings.elements[0].bindings[0].direction = 'down';
  f['screens/tank-motor.bindings.json'] = json(bindings);
  return f;
}

async function sideOf(files: Record<string, string>) {
  const list: PackageFile[] = await Promise.all(
    Object.entries(files).map(([p, t]) => packageFile(p, t, sha)),
  );
  return {
    digest: await packageDigest(list, sha),
    files: list,
    source: new MemorySource(files),
  } satisfies LocalSide;
}

async function compared(
  local = demo(),
  device = deviceFiles(),
): Promise<{ result: CompareResult; local: LocalSide; device: LocalSide }> {
  const l = await sideOf(local);
  const d = await sideOf(device);
  const result = await compareProjects(l, {
    digest: d.digest,
    files: async () => d.files,
    source: async () => d.source,
  });
  return { result, local: l, device: d };
}

describe('compareRows (bảng So sánh)', () => {
  it('mỗi đối tượng một dòng, theo kind; ký hiệu = ≠ + - đúng', async () => {
    const { result } = await compared();
    const rows = compareRows(result);
    const at = (kind: string, key: string) => rows.find((r) => r.kind === kind && r.key === key);
    expect(at('project', 'project')?.status).toBe('=');
    expect(at('tag', 'TANK01.LEVEL')?.status).toBe('≠');
    expect(at('tag', 'TANK01.TEMP')?.status).toBe('+');
    expect(at('tag', 'DEV.ONLY')?.status).toBe('-');
    expect(at('tag', 'MOTOR01.RUN')?.status).toBe('=');
    expect(at('logging-group', 'van-hanh')?.status).toBe('≠');
    expect(at('logging-group', 'bao-cao-ca')?.status).toBe('=');
    expect(at('screen', 'tank-motor')?.status).toBe('=');
    expect(at('binding', 'tank-motor/el_tank_level/level')?.status).toBe('≠');
    // Theo thứ tự kind của compare.ts: project, tag, lưu trữ, màn hình, binding, svg.
    const kinds = rows.map((r) => r.kind);
    expect(kinds.indexOf('project')).toBe(0);
    expect(kinds.indexOf('tag')).toBeLessThan(kinds.indexOf('logging-group'));
    expect(kinds.indexOf('logging-group')).toBeLessThan(kinds.indexOf('screen'));
  });

  it('khác biệt từng trường của dòng ≠, đếm trường; dòng + - = không có trường', async () => {
    const { result } = await compared();
    const rows = compareRows(result);
    const level = rows.find((r) => r.kind === 'tag' && r.key === 'TANK01.LEVEL')!;
    expect(level.fields).toEqual([{ path: '/max', local: 100, device: 120 }]);
    expect(level.fieldCount).toBe(1);
    const only = rows.find((r) => r.key === 'DEV.ONLY')!;
    expect(only.fields).toEqual([]);
    expect(only.presence).toEqual({ local: false, device: true });
    expect(rows.find((r) => r.key === 'TANK01.TEMP')!.presence).toEqual({
      local: true,
      device: false,
    });
  });

  it('lọc theo trạng thái và theo kind', async () => {
    const { result } = await compared();
    const diff = compareRows(result, { status: '≠' });
    expect(diff.every((r) => r.status === '≠')).toBe(true);
    expect(diff.map((r) => r.key).sort()).toEqual(
      ['TANK01.LEVEL', 'van-hanh', 'tank-motor/el_tank_level/level'].sort(),
    );
    const tags = compareRows(result, { kind: 'tag' });
    expect(tags.every((r) => r.kind === 'tag')).toBe(true);
    expect(compareRows(result, { kind: 'tag', status: '+' }).map((r) => r.key)).toEqual([
      'TANK01.TEMP',
    ]);
    expect(compareRows(result, { status: 'all', kind: 'all' })).toHaveLength(
      compareRows(result).length,
    );
  });

  it('digest giống: mọi dòng "=" (kết quả dùng để nói "giống hệt")', async () => {
    const { result } = await compared(demo(), demo());
    expect(result.same).toBe(true);
    expect(compareRows(result).every((r) => r.status === '=')).toBe(true);
    expect(compareRows(result, { status: '≠' })).toEqual([]);
  });
});

describe('treeMarks (ký hiệu trên cây project)', () => {
  it('nút Bảng Tag, nhóm lưu trữ, màn hình mang ký hiệu gộp của đối tượng của nó', async () => {
    const { result } = await compared();
    const store = new StudioStore({ platform: createMockPlatform() });
    await store.openProject();
    const marks = treeMarks(result, store.state.outline);
    expect(marks.get('settings')).toBe('=');
    expect(marks.get('tags')).toBe('≠'); // lẫn ≠, + và -
    expect(marks.get('logging')).toBe('≠');
    // Màn hình: binding khác nên màn hình ≠ dù file màn hình và SVG giống.
    expect(marks.get('screen:tank-motor')).toBe('≠');
  });

  it('chỉ có một loại khác biệt thì giữ loại đó; không có đối tượng thì không có ký hiệu', async () => {
    const only = demo();
    const dev = demo();
    const tags = JSON.parse(only['tags.json']) as { tags: unknown[] };
    tags.tags.pop();
    only['tags.json'] = json(tags); // máy có ít Tag hơn → thiết bị có thêm Tag: '-'
    const { result } = await compared(only, dev);
    const store = new StudioStore({ platform: createMockPlatform() });
    await store.openProject();
    const marks = treeMarks(result, store.state.outline);
    expect(marks.get('tags')).toBe('≠'); // 4 '=' và 1 '-': lẫn lộn
    const onlyMinus = compareRows(result, { kind: 'tag', status: '-' });
    expect(onlyMinus).toHaveLength(1);
    expect(marks.has('screen:khong-co')).toBe(false);
  });

  it('digest giống: mọi nút "="', async () => {
    const { result } = await compared(demo(), demo());
    const store = new StudioStore({ platform: createMockPlatform() });
    await store.openProject();
    const marks = treeMarks(result, store.state.outline);
    expect([...marks.values()].every((m) => m === '=')).toBe(true);
    expect(marks.get('tags')).toBe('=');
  });
});

describe('briefOf (viewer chỉ thấy khớp/khác)', () => {
  it('chưa so thì chưa biết; digest bằng nhau thì khớp; khác thì khác', () => {
    expect(briefOf(null)).toBe('unknown');
    const base = { at: 1, result: null, localDigest: 'sha256:a', deviceDigest: 'sha256:a' };
    expect(briefOf({ ...base, same: true })).toBe('match');
    expect(briefOf({ ...base, deviceDigest: 'sha256:b', same: false })).toBe('differ');
  });
});

// ---------- Tự so ----------

interface Harness {
  env: CompareEnv;
  state: { loggedIn: boolean; role: Role | null; deviceDigest: string | null; key: string };
  published: CompareState[];
  calls: { info: number; manifest: number; fetch: number; discard: number };
  local: LocalSide;
  device: LocalSide;
}

async function harness(opts: { role?: Role; same?: boolean } = {}): Promise<Harness> {
  const { local, device } = await compared(demo(), opts.same ? demo() : deviceFiles());
  const state: Harness['state'] = {
    loggedIn: true,
    role: opts.role ?? 'engineer',
    deviceDigest: device.digest,
    key: 'k1',
  };
  const calls = { info: 0, manifest: 0, fetch: 0, discard: 0 };
  let current: CompareState = { busy: false, info: null, error: null };
  const published: CompareState[] = [];
  const env: CompareEnv = {
    loggedIn: () => state.loggedIn,
    role: () => state.role,
    deviceDigest: () => state.deviceDigest,
    localKey: () => state.key,
    local: async () => local,
    device: {
      info: async () => {
        calls.info++;
        return { project: { status: 'active', digest: state.deviceDigest } } as never;
      },
      manifest: async () => {
        calls.manifest++;
        return { digest: device.digest, files: device.files } as never;
      },
      fetchPackage: async () => {
        calls.fetch++;
        return { packageId: 'p1', digest: device.digest } as never;
      },
      readPackageFile: (_id, rel) => device.source.read(rel) as never,
      discardPackage: async () => {
        calls.discard++;
      },
    },
    publish: (patch) => {
      current = { ...current, ...patch };
      published.push(current);
    },
    now: () => 1000,
  };
  return { env, state, published, calls, local, device };
}

describe('CompareRunner (tự so)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const last = (h: Harness) => h.published[h.published.length - 1];

  it('vào Online với role engineer: tự so đầy đủ; khác digest → tải manifest rồi gói; bỏ gói sau khi so', async () => {
    const h = await harness();
    const runner = new CompareRunner(h.env);
    runner.sync();
    await runner.idle();
    expect(h.calls).toEqual({ info: 1, manifest: 1, fetch: 1, discard: 1 });
    const info = last(h).info!;
    expect(info.same).toBe(false);
    expect(info.result?.objects.some((o) => o.status === '≠')).toBe(true);
    expect(last(h).busy).toBe(false);
    expect(h.published[0].busy).toBe(true);
  });

  it('digest giống: chỉ cần system/info, không tải manifest hay gói', async () => {
    const h = await harness({ same: true });
    const runner = new CompareRunner(h.env);
    runner.sync();
    await runner.idle();
    expect(h.calls).toEqual({ info: 1, manifest: 0, fetch: 0, discard: 0 });
    expect(last(h).info?.same).toBe(true);
    expect(last(h).info?.result?.same).toBe(true);
  });

  it('viewer: chỉ khớp/khác từ digest, không tải manifest hay gói, không có chi tiết', async () => {
    const h = await harness({ role: 'viewer' });
    const runner = new CompareRunner(h.env);
    runner.sync();
    await runner.idle();
    expect(h.calls).toEqual({ info: 1, manifest: 0, fetch: 0, discard: 0 });
    expect(last(h).info).toMatchObject({ same: false, result: null });
    expect(briefOf(last(h).info!)).toBe('differ');
  });

  it('sau mỗi lần lưu (khóa nội dung đổi) hoặc nạp xuống (digest thiết bị đổi) thì so lại; không đổi thì thôi', async () => {
    const h = await harness();
    const runner = new CompareRunner(h.env);
    runner.sync();
    await runner.idle();
    runner.sync();
    await runner.idle();
    expect(h.calls.info).toBe(1); // không có gì đổi
    h.state.key = 'k2'; // vừa lưu
    runner.sync();
    await runner.idle();
    expect(h.calls.info).toBe(2);
    h.state.deviceDigest = `sha256:${'c'.repeat(64)}`; // vừa nạp xuống (system/info báo digest mới)
    runner.sync();
    await runner.idle();
    expect(h.calls.info).toBe(3);
  });

  it('chưa biết digest của thiết bị (chưa có system/info) thì chờ; chưa đăng nhập thì xóa kết quả', async () => {
    const h = await harness();
    const runner = new CompareRunner(h.env);
    h.state.deviceDigest = null;
    runner.sync();
    await runner.idle();
    expect(h.calls.info).toBe(0);
    h.state.deviceDigest = 'sha256:x';
    runner.sync();
    await runner.idle();
    expect(h.calls.info).toBe(1);
    h.state.loggedIn = false;
    runner.sync();
    expect(last(h)).toEqual({ busy: false, info: null, error: null });
    // đăng nhập lại là so lại.
    h.state.loggedIn = true;
    runner.sync();
    await runner.idle();
    expect(h.calls.info).toBe(2);
  });

  it('refresh() so lại ngay cả khi không có gì đổi; lỗi thiết bị thành mã lỗi, không ném', async () => {
    const h = await harness();
    const runner = new CompareRunner(h.env);
    runner.sync();
    await runner.idle();
    await runner.refresh();
    expect(h.calls.info).toBe(2);
    h.env.device.fetchPackage = async () => ({ error: 'session-expired' });
    await runner.refresh();
    expect(last(h)).toMatchObject({ busy: false, error: 'session-expired' });
  });

  it('thiết bị chưa có project: mọi đối tượng "+"', async () => {
    const h = await harness();
    h.env.device.info = async () => ({ project: { status: 'missing' } }) as never;
    h.state.deviceDigest = 'none';
    const runner = new CompareRunner(h.env);
    await runner.refresh();
    const result = last(h).info!.result!;
    expect(result.objects.length).toBeGreaterThan(0);
    expect(result.objects.every((o) => o.status === '+')).toBe(true);
    expect(h.calls.fetch).toBe(0);
  });
});

// ---------- Đọc lên phần chọn ----------

describe('applyFromDevice (Đọc lên phần chọn)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const store = new StudioStore({ platform: createMockPlatform() });
    await store.openProject();
    await store.validateNow();
    const { result, device } = await compared();
    return { store, result, device };
  }
  const pick = (result: CompareResult, kind: string, key: string) =>
    result.objects.find((o) => o.kind === kind && o.key === key)!;

  it('Tag ≠: thay đối tượng trong tags.json bằng bản của thiết bị; Tag "-": thêm vào; một bước hoàn tác', async () => {
    const { store, result, device } = await setup();
    const report = await applyFromDevice(store, device.source, [
      pick(result, 'tag', 'TANK01.LEVEL'),
      pick(result, 'tag', 'DEV.ONLY'),
    ]);
    expect(report.applied).toHaveLength(2);
    expect(report.skipped).toEqual([]);
    expect(store.dirtyFiles()).toEqual(['tags.json']);
    const tags = store.state.outline.tags!.tags as Array<{ id: string; max?: number }>;
    expect(tags.find((x) => x.id === 'TANK01.LEVEL')?.max).toBe(120);
    expect(tags.some((x) => x.id === 'DEV.ONLY')).toBe(true);
    expect(tags.some((x) => x.id === 'TANK01.TEMP')).toBe(true); // "+" không bị đụng
    store.undo();
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.state.history.past).toHaveLength(0);
  });

  it('kind lưu trữ, binding: thay cả file thành nội dung chờ ghi, chưa lưu, hoàn tác được', async () => {
    const { store, result, device } = await setup();
    const deviceText = (await device.source.read('logging.json')) as { text: string };
    const report = await applyFromDevice(store, device.source, [
      pick(result, 'logging-group', 'van-hanh'),
      pick(result, 'binding', 'tank-motor/el_tank_level/level'),
    ]);
    expect(report.applied).toHaveLength(2);
    expect(store.dirtyFiles().sort()).toEqual(['logging.json', 'screens/tank-motor.bindings.json']);
    expect(store.textOf('logging.json')).toBe(deviceText.text);
    store.undo();
    expect(store.dirtyFiles()).toEqual([]);
    store.redo();
    expect(store.dirtyFiles()).toHaveLength(2);
  });

  it('dòng "+" (chỉ có trên máy) và "=" không áp được: bị bỏ qua kèm lý do, không đổi gì', async () => {
    const { store, result, device } = await setup();
    const report = await applyFromDevice(store, device.source, [
      pick(result, 'tag', 'TANK01.TEMP'),
      pick(result, 'tag', 'MOTOR01.RUN'),
    ]);
    expect(report.applied).toEqual([]);
    expect(report.skipped.map((s) => s.reason)).toEqual(['local-only', 'same']);
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.state.history.past).toHaveLength(0);
  });

  it('Lưu ghi đúng nội dung đã lấy', async () => {
    const platform = createMockPlatform();
    const store = new StudioStore({ platform });
    await store.openProject();
    const { result, device } = await compared();
    await applyFromDevice(store, device.source, [pick(result, 'logging-group', 'van-hanh')]);
    const deviceText = (await device.source.read('logging.json')) as { text: string };
    expect(await store.save()).toEqual({ status: 'saved', files: ['logging.json'] });
    expect(platform.control.writes).toEqual([{ rel: 'logging.json', content: deviceText.text }]);
  });
});
