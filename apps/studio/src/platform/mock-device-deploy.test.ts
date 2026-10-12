// Phần nạp xuống của DeviceLink giả (feature 005, T123, contracts/tauri-commands.md §8, §10): đóng gói từ project
// đang mở, nạp xuống từng bước, cờ gây lỗi ở bước bất kỳ, gây rollback, gây DEVICE_BUSY, khôi phục, đọc lên.
// Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isDeviceError,
  type DeployEvent,
  type DeployOperation,
  type DeviceError,
  type KnownDevice,
  type PackageInfo,
} from './device-types.ts';
import { createMockDevice, type MockDevice } from './mock-device.ts';
import { platform as mockPlatform } from './mock.ts';

const PW = `thu-${randomUUID()}`;
/** Digest của project mẫu `projects/tank-demo`: như vector golden `valid-device-tank-demo` (C++) và Rust. */
const TANK_DEMO_DIGEST = 'sha256:9ba112c6ddbd961f0336f8b246ff172826d544130a7fe1168cb10b2b2861edb7';
const FILES = [
  'logging.json',
  'project.json',
  'screens/tank-motor.bindings.json',
  'screens/tank-motor.screen.json',
  'screens/tank-motor.svg',
  'tags.json',
];

function ok<T>(r: T | DeviceError): T {
  if (isDeviceError(r)) throw new Error(`lỗi không mong đợi: ${JSON.stringify(r)}`);
  return r;
}

async function pinned(dev: MockDevice, name: string): Promise<KnownDevice> {
  const f = dev.control.device(name);
  const known = ok(await dev.addDevice({ host: f.ip, httpsPort: f.httpsPort }));
  const p = ok(await dev.probe(known.id));
  return ok(await dev.pin(known.id, p.fingerprint));
}

async function login(dev: MockDevice, name = 'BL335-01', user = 'kysu1'): Promise<KnownDevice> {
  const k = await pinned(dev, name);
  ok(await dev.login(k.id, user, `${PW}-${user}`));
  return k;
}

/** Danh sách `{ rel, hash }` của project mẫu như giao diện gửi cho `package_build`. */
async function refs(): Promise<Array<{ rel: string; hash: string }>> {
  await mockPlatform.pickProject();
  const out: Array<{ rel: string; hash: string }> = [];
  for (const rel of FILES) {
    const r = await mockPlatform.read(rel);
    if (!('hash' in r)) throw new Error(`không đọc được ${rel}`);
    out.push({ rel, hash: r.hash });
  }
  return out;
}

async function built(dev: MockDevice): Promise<PackageInfo> {
  return ok(await dev.buildPackage(await refs()));
}

const stepStates = (op: DeployOperation) => op.steps.map((s) => `${s.id}:${s.state}`);

/** Chạy `p` trong lúc đẩy đồng hồ giả tới khi xong. */
async function run<T>(p: Promise<T>): Promise<T> {
  let done = false;
  const guarded = p.finally(() => (done = true));
  for (let i = 0; i < 200 && !done; i++) await vi.advanceTimersByTimeAsync(100);
  return guarded;
}

describe('DeviceLink giả: gói và nạp xuống', () => {
  let dev: MockDevice;
  beforeEach(() => {
    vi.useFakeTimers();
    dev = createMockDevice({ latency: false });
    for (const u of ['kysu1', 'xem1', 'admin']) dev.control.setPassword(u, `${PW}-${u}`);
  });
  afterEach(() => vi.useRealTimers());

  it('package_build: manifest từ file đang mở, digest như bộ ghi C++ và Rust; file đổi thì lỗi changed', async () => {
    const info = await built(dev);
    expect(info).toMatchObject({ origin: 'built', digest: TANK_DEMO_DIGEST });
    expect(info.packageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(info.manifest).toMatchObject({
      format: 'matscada-package',
      formatVersion: '1.0.0',
      project: { projectId: 'tank-demo', minRuntimeVersion: '0.3.0' },
      digest: TANK_DEMO_DIGEST,
    });
    expect(info.manifest.files.map((f) => f.path)).toEqual(FILES);
    expect(info.size).toBeGreaterThan(0);
    const list = await refs();
    list[5] = { ...list[5], hash: '0'.repeat(64) };
    expect(await dev.buildPackage(list)).toEqual({ error: 'changed', detail: 'tags.json' });
    dev.control.failBuild({ error: 'package', detail: 'E_PKG_SECRET' });
    expect(await dev.buildPackage(await refs())).toEqual({
      error: 'package',
      detail: 'E_PKG_SECRET',
    });
    expect(ok(await dev.buildPackage(await refs())).digest).toBe(TANK_DEMO_DIGEST);
  });

  it('gói tạm: đọc một file, xóa; tối đa 4 gói (gói cũ nhất bị đẩy ra)', async () => {
    const first = await built(dev);
    const tags = await dev.readPackageFile(first.packageId, 'tags.json');
    expect(tags).toMatchObject({ text: expect.stringContaining('TANK01.LEVEL') as string });
    expect(await dev.readPackageFile(first.packageId, 'khong-co.json')).toEqual({
      error: 'missing',
    });
    expect(await dev.readPackageFile(first.packageId, '../tags.json')).toEqual({
      error: 'bad-path',
    });
    const ids = [first.packageId];
    for (let i = 0; i < 4; i++) ids.push((await built(dev)).packageId);
    expect(await dev.readPackageFile(ids[0], 'tags.json')).toEqual({ error: 'missing' });
    expect(await dev.readPackageFile(ids[4], 'tags.json')).toHaveProperty('text');
    await dev.discardPackage(ids[4]);
    expect(await dev.readPackageFile(ids[4], 'tags.json')).toEqual({ error: 'missing' });
  });

  it('nạp xuống thành công: send, 6 bước theo thứ tự, restarting; bản mới chạy, bản cũ thành bản lưu', async () => {
    const k = await login(dev);
    const pkg = await built(dev);
    const before = ok(await dev.get(k.id, '/api/v1/system/info')).body as {
      project: { digest: string };
    };
    expect(before.project.digest).toBe(TANK_DEMO_DIGEST);
    const events: DeployEvent[] = [];
    const op = ok(
      await run(dev.deploy(k.id, pkg.packageId, TANK_DEMO_DIGEST, (e) => events.push(e))),
    );
    expect(op.result).toBe('committed');
    expect(op.kind).toBe('deploy');
    expect(op.user).toBe('kysu1');
    expect(stepStates(op)).toEqual([
      'receive:ok',
      'verify-package:ok',
      'validate:ok',
      'backup:ok',
      'activate:ok',
      'health:ok',
    ]);
    expect(op.from).toMatchObject({ seq: 1, digest: TANK_DEMO_DIGEST });
    expect(op.to).toMatchObject({ projectId: 'tank-demo', digest: pkg.digest });
    expect(op.error).toBeNull();
    expect(typeof op.clientsNotified).toBe('number');

    const sends = events.filter((e) => e.kind === 'send');
    expect(sends.length).toBeGreaterThan(0);
    expect(sends.at(-1)).toMatchObject({ sent: pkg.size, total: pkg.size });
    const kinds = events.map((e) => e.kind);
    expect(kinds.indexOf('send')).toBeLessThan(kinds.indexOf('operation'));
    expect(kinds).toContain('restarting');
    const ops = events.filter((e) => e.kind === 'operation');
    // Mỗi lần trạng thái đổi một sự kiện; sự kiện cuối là kết quả.
    expect(ops.length).toBeGreaterThanOrEqual(6);
    expect((ops.at(-1) as { op: DeployOperation }).op.result).toBe('committed');
    // Trong lúc chạy `system/info.operation` có bước; xong thì null.
    const after = ok(await dev.get(k.id, '/api/v1/system/info')).body as { operation: unknown };
    expect(after.operation).toBeNull();

    const versions = ok(await dev.get(k.id, '/api/v1/project/versions')).body as {
      active: number;
      versions: Array<{ seq: number; state: string; deployedBy: string; restorable?: boolean }>;
    };
    expect(versions.active).toBe(2);
    expect(versions.versions.map((v) => [v.seq, v.state])).toEqual([
      [2, 'active'],
      [1, 'backup'],
    ]);
    expect(versions.versions[0].deployedBy).toBe('kysu1');
    expect(versions.versions[1].restorable).toBe(true);
    const last = ok(await dev.get(k.id, '/api/v1/project/operation')).body as DeployOperation;
    expect(last.opId).toBe(op.opId);
    const byId = ok(await dev.get(k.id, `/api/v1/project/deployments/${op.opId}`)).body;
    expect(byId).toMatchObject({ opId: op.opId, result: 'committed' });
  });

  it('trong lúc chạy: system/info.operation có bước và thời điểm; thao tác thứ hai nhận busy kèm người đang chạy', async () => {
    const k = await login(dev);
    const pkg = await built(dev);
    const events: DeployEvent[] = [];
    const first = dev.deploy(k.id, pkg.packageId, TANK_DEMO_DIGEST, (e) => events.push(e));
    await vi.advanceTimersByTimeAsync(300);
    const mid = ok(await dev.get(k.id, '/api/v1/system/info')).body as {
      operation: { kind: string; step: string; since: string } | null;
    };
    expect(mid.operation).toMatchObject({ kind: 'deploy', step: expect.any(String) as string });
    const second = await dev.deploy(k.id, pkg.packageId, TANK_DEMO_DIGEST, () => undefined);
    expect(second).toMatchObject({
      error: 'busy',
      detail: { kind: 'deploy', user: 'kysu1', opId: expect.any(String) as string },
    });
    expect((second as DeviceError & { detail: Record<string, unknown> }).detail).toHaveProperty(
      'source',
    );
    expect((second as DeviceError & { detail: Record<string, unknown> }).detail).toHaveProperty(
      'since',
    );
    expect(ok(await run(first)).result).toBe('committed');
  });

  it('cờ gây lỗi ở từng bước: thao tác failed, bản đang chạy không đổi, đúng mã', async () => {
    const k = await login(dev);
    const pkg = await built(dev);
    for (const [step, code] of [
      ['receive', 'RECEIVE_TIMEOUT'],
      ['verify-package', 'E_PKG_CHECKSUM'],
      ['validate', 'E_VALIDATION'],
      ['backup', 'STORE_IO'],
      ['activate', 'EXEC_FAILED'],
    ] as const) {
      dev.control.failDeploy(step, code);
      const op = ok(await run(dev.deploy(k.id, pkg.packageId, TANK_DEMO_DIGEST, () => undefined)));
      expect(op.result, step).toBe('failed');
      expect(op.error?.code, step).toBe(code);
      const failed = op.steps.find((s) => s.state === 'failed');
      expect(failed?.id, step).toBe(step);
      expect(failed?.code, step).toBe(code);
      // Bước sau bước lỗi chưa chạy.
      const idx = op.steps.findIndex((s) => s.id === step);
      expect(op.steps.slice(idx + 1).every((s) => s.state === 'pending')).toBe(true);
      const versions = ok(await dev.get(k.id, '/api/v1/project/versions')).body as {
        active: number;
      };
      expect(versions.active, step).toBe(1);
    }
    // Lỗi kiểm project kèm danh sách issues.
    dev.control.failDeploy('validate', 'E_VALIDATION');
    const op = ok(await run(dev.deploy(k.id, pkg.packageId, TANK_DEMO_DIGEST, () => undefined)));
    expect(op.error?.issues?.[0]).toMatchObject({ code: 'E_TAG_RANGE', file: 'tags.json' });
    // Cờ chỉ dùng một lần: lần sau thành công.
    expect(
      ok(await run(dev.deploy(k.id, pkg.packageId, TANK_DEMO_DIGEST, () => undefined))).result,
    ).toBe('committed');
  });

  it('gây rollback: health lỗi → bước rollback → rolled-back, bản cũ chạy lại', async () => {
    const k = await login(dev);
    const pkg = await built(dev);
    dev.control.failDeploy('health', 'HEALTH_TIMEOUT');
    const op = ok(await run(dev.deploy(k.id, pkg.packageId, TANK_DEMO_DIGEST, () => undefined)));
    expect(op.result).toBe('rolled-back');
    expect(stepStates(op)).toEqual([
      'receive:ok',
      'verify-package:ok',
      'validate:ok',
      'backup:ok',
      'activate:ok',
      'health:failed',
      'rollback:ok',
    ]);
    expect(op.error?.code).toBe('HEALTH_TIMEOUT');
    const versions = ok(await dev.get(k.id, '/api/v1/project/versions')).body as {
      active: number;
    };
    expect(versions.active).toBe(1);
  });

  it('gây DEVICE_BUSY, BASE_CHANGED, mất theo dõi; viewer không nạp xuống được; phiên hết hạn', async () => {
    const k = await login(dev);
    const pkg = await built(dev);
    dev.control.setBusy('BL335-01', { user: 'kysu2', source: '192.168.1.77' });
    const busy = await dev.deploy(k.id, pkg.packageId, TANK_DEMO_DIGEST, () => undefined);
    expect(busy).toMatchObject({
      error: 'busy',
      detail: { kind: 'deploy', user: 'kysu2', source: '192.168.1.77' },
    });
    dev.control.setBusy('BL335-01', null);

    // Base cũ: người khác vừa nạp xuống.
    dev.control.changeBase('BL335-01');
    expect(await dev.deploy(k.id, pkg.packageId, TANK_DEMO_DIGEST, () => undefined)).toEqual({
      error: 'base-changed',
    });
    // `none` khi thiết bị đang có project cũng là base cũ.
    expect(await dev.deploy(k.id, pkg.packageId, 'none', () => undefined)).toEqual({
      error: 'base-changed',
    });

    dev.control.loseDeploy(true);
    const current = (
      ok(await dev.get(k.id, '/api/v1/system/info')).body as {
        project: { digest: string };
      }
    ).project.digest;
    expect(await run(dev.deploy(k.id, pkg.packageId, current, () => undefined))).toEqual({
      error: 'lost',
    });
    dev.control.loseDeploy(false);

    dev.control.expireSession('BL335-01');
    expect(await dev.deploy(k.id, pkg.packageId, current, () => undefined)).toEqual({
      error: 'session-expired',
    });

    const viewer = await login(dev, 'BL335-02', 'xem1');
    expect(await dev.deploy(viewer.id, pkg.packageId, 'none', () => undefined)).toEqual({
      error: 'forbidden',
    });
    expect(await dev.deploy(viewer.id, 'khong-co', 'none', () => undefined)).toEqual({
      error: 'forbidden',
    });
  });

  it('thiết bị chưa có project: base none, nạp xuống thành công', async () => {
    const k = await login(dev, 'BL335-02');
    const pkg = await built(dev);
    const info = ok(await dev.get(k.id, '/api/v1/system/info')).body as {
      project: { status: string };
    };
    expect(info.project.status).toBe('missing');
    const op = ok(await run(dev.deploy(k.id, pkg.packageId, 'none', () => undefined)));
    expect(op.result).toBe('committed');
    expect(op.from).toBeNull();
    expect(op.to.seq).toBe(1);
  });

  it('khôi phục: bước receive, verify-package bỏ qua; bản chọn chạy lại; seq lạ, bản đang chạy bị từ chối', async () => {
    const k = await login(dev);
    const pkg = await built(dev);
    ok(await run(dev.deploy(k.id, pkg.packageId, TANK_DEMO_DIGEST, () => undefined)));
    const current = (
      ok(await dev.get(k.id, '/api/v1/system/info')).body as {
        project: { digest: string };
      }
    ).project.digest;
    expect(await dev.restore(k.id, 99, current, () => undefined)).toEqual({
      error: 'no-such-version',
    });
    expect(await dev.restore(k.id, 2, current, () => undefined)).toEqual({
      error: 'already-active',
    });
    dev.control.changeBase('BL335-01');
    expect(await dev.restore(k.id, 1, current, () => undefined)).toEqual({ error: 'base-changed' });
    const now = (
      ok(await dev.get(k.id, '/api/v1/system/info')).body as {
        project: { digest: string };
      }
    ).project.digest;
    const events: DeployEvent[] = [];
    const op = ok(await run(dev.restore(k.id, 1, now, (e) => events.push(e))));
    expect(op.kind).toBe('restore');
    expect(op.result).toBe('committed');
    expect(stepStates(op)).toEqual([
      'receive:skipped',
      'verify-package:skipped',
      'validate:ok',
      'backup:ok',
      'activate:ok',
      'health:ok',
    ]);
    expect(op.to.seq).toBe(1);
    expect(events.some((e) => e.kind === 'send')).toBe(false);
    const versions = ok(await dev.get(k.id, '/api/v1/project/versions')).body as {
      active: number;
    };
    expect(versions.active).toBe(1);
  });

  it('đọc lên: bản đang chạy hoặc theo seq; manifest khớp digest của system/info; lỗi khi chưa có project', async () => {
    const k = await login(dev);
    const info = ok(await dev.fetchPackage(k.id));
    expect(info).toMatchObject({
      origin: 'fetched',
      digest: TANK_DEMO_DIGEST,
      deviceId: dev.control.device('BL335-01').deviceId,
    });
    expect(info.manifest.files.map((f) => f.path)).toEqual(FILES);
    expect(await dev.readPackageFile(info.packageId, 'project.json')).toHaveProperty('text');
    const manifest = ok(await dev.get(k.id, '/api/v1/project/manifest')).body as {
      digest: string;
    };
    expect(manifest.digest).toBe(TANK_DEMO_DIGEST);
    expect(await dev.fetchPackage(k.id, 9)).toEqual({ error: 'no-such-version' });
    expect(ok(await dev.fetchPackage(k.id, 1)).seq).toBe(1);
    const empty = await login(dev, 'BL335-02');
    expect(await dev.fetchPackage(empty.id)).toEqual({ error: 'no-project-package' });
    // Sửa bản trên thiết bị để thử So sánh.
    dev.control.editStored('BL335-01', 'tags.json', '{"schemaVersion":"0.1.0","tags":[]}\n');
    const edited = ok(await dev.fetchPackage(k.id));
    expect(edited.digest).not.toBe(TANK_DEMO_DIGEST);
    expect(await dev.readPackageFile(edited.packageId, 'tags.json')).toMatchObject({
      text: '{"schemaVersion":"0.1.0","tags":[]}\n',
    });
  });

  it('chẩn đoán có chỗ trống của thiết bị; nhật ký lệnh ghi tên lệnh Rust', async () => {
    const k = await login(dev);
    const d = ok(await dev.get(k.id, '/api/v1/diagnostics')).body as {
      disk: { freeBytes: number };
    };
    expect(d.disk.freeBytes).toBeGreaterThan(1e9);
    dev.control.setFreeBytes('BL335-01', 1000);
    const small = ok(await dev.get(k.id, '/api/v1/diagnostics')).body as {
      disk: { freeBytes: number };
    };
    expect(small.disk.freeBytes).toBe(1000);
    const pkg = await built(dev);
    await dev.discardPackage(pkg.packageId);
    const cmds = dev.control.calls.map((c) => c.cmd);
    expect(cmds).toContain('package_build');
    expect(cmds).toContain('package_discard');
  });
});
