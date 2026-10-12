// Phần chẩn đoán và audit của DeviceLink giả (feature 005, T148, device-api §6, §7): đúng dạng của contract để Studio
// chạy trên bản giả như trên thiết bị thật. Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo.
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { isDeviceError, type DeviceError, type KnownDevice } from './device-types.ts';
import { createMockDevice, type MockDevice } from './mock-device.ts';

const PW = `thu-${randomUUID()}`;

function ok<T>(r: T | DeviceError): T {
  if (isDeviceError(r)) throw new Error(`lỗi không mong đợi: ${JSON.stringify(r)}`);
  return r;
}

async function login(dev: MockDevice, user: string): Promise<KnownDevice> {
  const f = dev.control.device('BL335-01');
  const known = ok(await dev.addDevice({ host: f.ip, httpsPort: f.httpsPort }));
  const p = ok(await dev.probe(known.id));
  ok(await dev.pin(known.id, p.fingerprint));
  ok(await dev.login(known.id, user, `${PW}-${user}`));
  return known;
}

interface AuditBody {
  records: Array<{
    id: number;
    ts: number;
    clockOk: boolean;
    user: string | null;
    action: string;
    result: string;
    detail: Record<string, unknown> | null;
    count: number;
  }>;
  next: number | null;
}

describe('DeviceLink giả: chẩn đoán và audit', () => {
  let dev: MockDevice;
  beforeEach(() => {
    dev = createMockDevice({ latency: false });
    for (const u of ['kysu1', 'xem1', 'admin']) dev.control.setPassword(u, `${PW}-${u}`);
  });

  it('chẩn đoán có đủ khối của contract §6; viewer xem được', async () => {
    const k = await login(dev, 'xem1');
    const r = ok(await dev.get(k.id, '/api/v1/diagnostics'));
    expect(r.status).toBe(200);
    const b = r.body as Record<string, Record<string, unknown> & number>;
    expect(typeof b.at).toBe('number');
    expect(b.timeSynced).toBe(true);
    expect(b.cpu).toMatchObject({ systemPct1m: 11.7, runtimePct1m: 4.2, loadAvg1: 0.42, cores: 2 });
    expect(b.memory).toMatchObject({
      runtimeRssBytes: 9900032,
      systemTotalBytes: 1041235968,
      systemAvailableBytes: 909115392,
    });
    expect(b.disk).toMatchObject({ path: '/var/lib/mat-runtime', totalBytes: 7301234688 });
    expect(b.uptime).toMatchObject({ runtimeS: 3600 });
    expect(b.clients).toMatchObject({ live: 0, max: 10, sessions: 1 });
    expect(b.discovery).toMatchObject({ enabled: true });
    expect(b.versions).toMatchObject({ runtime: '0.4.0', api: '1.0.0' });
  });

  it('control.setDiagnostics đổi số liệu, độ lệch giờ, giờ đồng bộ và gây lỗi', async () => {
    const k = await login(dev, 'kysu1');
    dev.control.setDiagnostics('BL335-01', {
      cpu: { systemPct1m: 80, runtimePct1m: 20, loadAvg1: 1.5, cores: 4 },
      skewMs: 5000,
      timeSynced: false,
    });
    const b = ok(await dev.get(k.id, '/api/v1/diagnostics')).body as {
      at: number;
      timeSynced: boolean;
      cpu: { systemPct1m: number; cores: number };
    };
    expect(b.cpu).toMatchObject({ systemPct1m: 80, cores: 4 });
    expect(b.timeSynced).toBe(false);
    expect(Math.abs(b.at - (Date.now() + 5000))).toBeLessThan(1000);
    dev.control.setDiagnostics('BL335-01', { fail: 'unreachable' });
    expect(await dev.get(k.id, '/api/v1/diagnostics')).toEqual({ error: 'unreachable' });
  });

  it('audit: chỉ administrator; engineer bị forbidden', async () => {
    const k = await login(dev, 'kysu1');
    expect(await dev.get(k.id, '/api/v1/audit')).toEqual({ error: 'forbidden' });
  });

  it('audit: mới nhất trước, có đăng nhập thất bại và truy cập bị từ chối, mỗi lần đọc ghi audit.read', async () => {
    const k = await login(dev, 'admin');
    const first = ok(await dev.get(k.id, '/api/v1/audit')).body as AuditBody;
    const ids = first.records.map((r) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const actions = first.records.map((r) => `${r.action}/${r.result}`);
    expect(actions).toContain('auth.login/failed');
    expect(actions).toContain('access.denied/denied');
    expect(first.records.every((r) => typeof r.ts === 'number' && r.count >= 1)).toBe(true);
    const second = ok(await dev.get(k.id, '/api/v1/audit', { action: 'audit.' })).body as AuditBody;
    expect(second.records.length).toBeGreaterThanOrEqual(1);
    expect(second.records.every((r) => r.action === 'audit.read')).toBe(true);
  });

  it('audit: lọc user, action (tiền tố), from và to; sai tham số thì bad-request', async () => {
    const k = await login(dev, 'admin');
    dev.control.addAudit('BL335-01', [
      { action: 'project.deploy', result: 'ok', user: 'kysu1', role: 'engineer', ts: 1000 },
      { action: 'project.deploy', result: 'ok', user: 'kysu2', role: 'engineer', ts: 2000 },
      { action: 'project.read', result: 'ok', user: 'kysu1', role: 'engineer', ts: 3000 },
    ]);
    const get = async (query: Record<string, string>) =>
      (ok(await dev.get(k.id, '/api/v1/audit', query)).body as AuditBody).records;
    // Mới nhất trước: hai bản ghi vừa thêm, rồi các bản ghi có sẵn của kysu1.
    const mine = await get({ user: 'kysu1', action: 'project.' });
    expect(mine.slice(0, 2).map((r) => r.action)).toEqual(['project.read', 'project.deploy']);
    expect(mine.every((r) => r.user === 'kysu1' && r.action.startsWith('project.'))).toBe(true);
    expect(mine.length).toBeGreaterThan(2);
    expect(await get({ from: '1500', to: '2500' })).toHaveLength(1);
    expect(await dev.get(k.id, '/api/v1/audit', { limit: '0' })).toMatchObject({ error: 'http' });
    expect(await dev.get(k.id, '/api/v1/audit', { nope: '1' })).toMatchObject({ error: 'http' });
  });

  it('audit: phân trang bằng before và next, limit 1–200, mặc định 100', async () => {
    const k = await login(dev, 'admin');
    dev.control.addAudit(
      'BL335-01',
      Array.from({ length: 250 }, () => ({ action: 'project.read', result: 'ok', user: 'a' })),
    );
    const p1 = ok(await dev.get(k.id, '/api/v1/audit')).body as AuditBody;
    expect(p1.records).toHaveLength(100);
    expect(p1.next).toBe(p1.records.at(-1)!.id);
    const p2 = ok(await dev.get(k.id, '/api/v1/audit', { before: String(p1.next) }))
      .body as AuditBody;
    expect(p2.records[0].id).toBeLessThan(p1.records.at(-1)!.id);
    const small = ok(await dev.get(k.id, '/api/v1/audit', { limit: '5' })).body as AuditBody;
    expect(small.records).toHaveLength(5);
  });

  it('control.setAuditError gây lỗi cho lần đọc audit kế tiếp', async () => {
    const k = await login(dev, 'admin');
    dev.control.setAuditError('BL335-01', 'forbidden');
    expect(await dev.get(k.id, '/api/v1/audit')).toEqual({ error: 'forbidden' });
    dev.control.setAuditError('BL335-01', null);
    expect(ok(await dev.get(k.id, '/api/v1/audit')).status).toBe(200);
  });
});
