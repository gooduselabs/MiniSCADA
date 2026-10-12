// Lớp DeviceLink giả cho e2e (feature 005, T073, contracts/tauri-commands.md §9–10): hai thiết bị trong
// LAN, một thiết bị chỉ thêm theo địa chỉ, một thiết bị runtime cũ; chứng chỉ chưa ghim, khớp, đổi; tài
// khoản kysu1 (engineer), xem1 (viewer), admin (administrator); khóa sau 5 lần sai; điều khiển qua
// `window.__matMock.device`. Mật khẩu thử sinh ngẫu nhiên mỗi lần chạy, không ghi vào repo.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isDeviceError,
  type DeviceError,
  type DiscoveredDevice,
  type KnownDevice,
  type ProbeResult,
  type SessionInfo,
} from './device-types.ts';
import { createMockDevice, deviceLink, type MockDevice } from './mock-device.ts';

const PW = `thu-${randomUUID()}`;

/** Ném lỗi nếu kết quả là DeviceError (để đọc tiếp các trường). */
function ok<T>(r: T | DeviceError): T {
  if (isDeviceError(r)) throw new Error(`lỗi không mong đợi: ${JSON.stringify(r)}`);
  return r;
}

async function scanAll(dev: MockDevice, ifaces: number[] | null = null) {
  const found: DiscoveredDevice[] = [];
  const done = dev.discover(ifaces, (d) => found.push(d));
  await vi.advanceTimersByTimeAsync(dev.control.scanMs);
  return { found, summary: await done };
}

/** Thêm thiết bị theo tên giả, dò rồi ghim; trả KnownDevice đã ghim. */
async function pinned(dev: MockDevice, name: string): Promise<KnownDevice> {
  const f = dev.control.device(name);
  const known = ok(await dev.addDevice({ host: f.ip, httpsPort: f.httpsPort }));
  const p = ok(await dev.probe(known.id));
  return ok(await dev.pin(known.id, p.fingerprint));
}

describe('DeviceLink giả', () => {
  let dev: MockDevice;
  beforeEach(() => {
    vi.useFakeTimers();
    dev = createMockDevice({ latency: false });
    for (const u of ['kysu1', 'xem1', 'admin']) dev.control.setPassword(u, `${PW}-${u}`);
  });
  afterEach(() => vi.useRealTimers());

  it('card mạng: Ethernet và Wi-Fi gửi broadcast được; card VPN có gợi ý, không broadcast', async () => {
    const list = await dev.netInterfaces();
    expect(list.map((i) => [i.name, i.canBroadcast, i.hint])).toEqual([
      ['Ethernet 2', true, null],
      ['Wi-Fi', true, null],
      ['WireGuard', false, 'vpn'],
    ]);
    expect(list[0]).toMatchObject({
      address: '192.168.1.20',
      prefix: 24,
      broadcast: '192.168.1.255',
    });
  });

  it('tìm thiết bị: hai thiết bị trong LAN trả lời dần trong lượt quét 2,5 s; thiết bị xa và runtime cũ không trả lời', async () => {
    const found: DiscoveredDevice[] = [];
    const done = dev.discover(null, (d) => found.push(d));
    await vi.advanceTimersByTimeAsync(400);
    expect(found.map((d) => d.name)).toEqual(['BL335-01']);
    await vi.advanceTimersByTimeAsync(400);
    expect(new Set(found.map((d) => d.name))).toEqual(new Set(['BL335-01', 'BL335-02']));
    await expect(dev.discover(null, () => undefined)).rejects.toEqual({ error: 'busy' });
    await vi.advanceTimersByTimeAsync(dev.control.scanMs);
    const summary = await done;
    expect(summary).toEqual({ scanned: 2, found: 2, failed: [] });
    const first = found.find((d) => d.name === 'BL335-01')!;
    expect(first).toMatchObject({
      iface: 0,
      ip: '192.168.1.110',
      model: 'BL335',
      runtime: '0.4.0',
      status: 'running',
      httpsPort: 8443,
      httpPort: 8080,
      project: { id: 'tank-demo', version: '0.1.0' },
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.mac).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    expect(found.find((d) => d.name === 'BL335-02')).toMatchObject({
      status: 'no-project',
      project: null,
    });
    // Mỗi thiết bị trả lời cả ba gói hỏi (0, 600, 1200 ms): giao diện gộp theo (deviceId, IP).
    expect(found.filter((d) => d.name === 'BL335-01').length).toBeGreaterThan(1);
    expect(found.some((d) => d.name === 'TRAM-XA' || d.name === 'BL335-07')).toBe(false);
  });

  it('chọn card Wi-Fi: không thiết bị nào; chọn card VPN: báo card lỗi', async () => {
    expect((await scanAll(dev, [1])).found).toEqual([]);
    const vpn = await scanAll(dev, [2]);
    expect(vpn.found).toEqual([]);
    expect(vpn.summary.failed).toEqual([{ index: 2, reason: 'send' }]);
  });

  it('thêm theo địa chỉ: cổng mặc định, trùng host:cổng trả mục cũ, địa chỉ sai, tối đa 64, quên', async () => {
    const a = ok(await dev.addDevice({ host: '10.8.0.21' }));
    expect(a).toMatchObject({ host: '10.8.0.21', httpsPort: 8443, httpPort: 8080, pin: null });
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    const again = ok(await dev.addDevice({ host: '10.8.0.21', httpsPort: 8443, name: 'khác' }));
    expect(again.id).toBe(a.id);
    expect(await dev.addDevice({ host: 'a b' })).toEqual({ error: 'bad-address' });
    expect(await dev.addDevice({ host: 'x', httpsPort: 70000 })).toEqual({ error: 'bad-address' });
    for (let i = 1; i < 64; i++) ok(await dev.addDevice({ host: `10.9.0.${i}` }));
    expect(await dev.addDevice({ host: '10.9.1.1' })).toEqual({ error: 'too-many' });
    expect((await dev.devices()).length).toBe(64);
    await dev.forgetDevice(a.id);
    expect((await dev.devices()).some((d) => d.id === a.id)).toBe(false);
    await expect(dev.forgetDevice(a.id)).rejects.toEqual({ error: 'no-such-device' });
    expect(await dev.updateDevice({ id: a.id, name: 'x' })).toEqual({ error: 'no-such-device' });
  });

  it('chứng chỉ: chưa ghim → dò thấy fingerprint; ghim đúng lần dò gần nhất; khớp; đổi → không khớp', async () => {
    await scanAll(dev);
    const f = dev.control.device('BL335-01');
    const known = ok(await dev.addDevice({ host: f.ip }));
    expect(await dev.pin(known.id, f.fingerprint)).toEqual({ error: 'not-observed' });
    const p1 = ok(await dev.probe(known.id));
    expect(p1).toEqual<ProbeResult>({
      fingerprint: f.fingerprint,
      pinned: null,
      state: 'unpinned',
      discovered: f.fingerprint,
    });
    expect(await dev.pin(known.id, 'f'.repeat(64))).toEqual({ error: 'not-observed' });
    const p = ok(await dev.pin(known.id, p1.fingerprint));
    expect(p.pin?.fingerprint).toBe(f.fingerprint);
    expect(ok(await dev.probe(known.id)).state).toBe('match');
    const g = dev.control.rotateCert('BL335-01');
    expect(g).not.toBe(f.fingerprint);
    expect(ok(await dev.probe(known.id))).toMatchObject({
      fingerprint: g,
      pinned: f.fingerprint,
      state: 'mismatch',
      // Gói tìm gần nhất vẫn mang fingerprint cũ: giao diện so và cảnh báo đỏ.
      discovered: f.fingerprint,
    });
    expect(await dev.unpin(known.id, g)).toEqual({ error: 'pin-mismatch' });
    expect(ok(await dev.unpin(known.id, f.fingerprint)).pin).toBeNull();
    expect(ok(await dev.probe(known.id)).state).toBe('unpinned');
  });

  it('thiết bị runtime cũ: cổng HTTPS không trả lời; HTTP 8080 báo runtime 0.3.0 (theo dõi chỉ đọc)', async () => {
    const old = dev.control.device('BL335-07');
    const known = ok(await dev.addDevice({ host: old.ip }));
    expect(await dev.probe(known.id)).toEqual({ error: 'unreachable' });
    const r = ok(await dev.monitorGet(`${old.ip}:8080`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ runtimeVersion: '0.3.0', project: { projectId: 'tank-demo' } });
    expect(await dev.monitorGet(`${old.ip}:9999`)).toEqual({ error: 'network', detail: 'mock' });
  });

  // T085b, như Rust (`DeviceManager::probe`, `adopt_old_http_port`).
  it('dò cổng trả lời HTTP thường → not-tls; runtime < 0.4.0 thì lưu cổng đó làm httpPort (thêm theo địa chỉ với cổng HTTP, port-forward :9080)', async () => {
    const old = dev.control.device('BL335-07');
    dev.control.setHttpPort('BL335-07', 9080);
    expect(dev.control.device('BL335-07').httpPort).toBe(9080);
    const k = ok(await dev.addDevice({ host: old.ip, httpsPort: 9080 }));
    expect(k.httpPort).toBe(8080);
    expect(await dev.probe(k.id)).toEqual({ error: 'not-tls' });
    const saved = (await dev.devices()).find((d) => d.id === k.id);
    expect(saved).toMatchObject({ httpsPort: 9080, httpPort: 9080, pin: null, name: old.ip });
    expect(await dev.pin(k.id, 'a'.repeat(64))).toEqual({ error: 'not-observed' });
    expect(ok(await dev.monitorGet(`${old.ip}:9080`)).body).toMatchObject({
      runtimeVersion: '0.3.0',
    });
    // Runtime mới: cổng HTTP ghi nhầm vào chỗ cổng HTTPS → not-tls, httpPort giữ nguyên.
    dev.control.setHttpPort('BL335-01', 9081);
    const n = ok(await dev.addDevice({ host: '192.168.1.110', httpsPort: 9081 }));
    expect(await dev.probe(n.id)).toEqual({ error: 'not-tls' });
    expect((await dev.devices()).find((d) => d.id === n.id)?.httpPort).toBe(8080);
    // Cổng không có gì nghe: unreachable như trước.
    const none = ok(await dev.addDevice({ host: old.ip, httpsPort: 9999 }));
    expect(await dev.probe(none.id)).toEqual({ error: 'unreachable' });
    expect((await dev.devices()).find((d) => d.id === none.id)?.httpPort).toBe(8080);
  });

  it('đăng nhập theo role; sai tên hay sai mật khẩu cùng một lỗi; cần ghim; chưa có tài khoản', async () => {
    const f = dev.control.device('BL335-01');
    const known = ok(await dev.addDevice({ host: f.ip }));
    expect(await dev.login(known.id, 'kysu1', `${PW}-kysu1`)).toEqual({ error: 'cert-unpinned' });
    const pin = await pinned(dev, 'BL335-01');
    const s = ok(await dev.login(pin.id, 'kysu1', `${PW}-kysu1`));
    expect(s).toMatchObject<Partial<SessionInfo>>({
      user: 'kysu1',
      role: 'engineer',
      idleTimeoutS: 1800,
      maxLifetimeS: 43200,
    });
    expect(s.identity).toMatchObject({
      name: 'BL335-01',
      setupRequired: false,
      runtimeVersion: '0.4.0',
    });
    expect(JSON.stringify(s)).not.toMatch(/token|mats_/);
    expect(ok(await dev.login(pin.id, 'xem1', `${PW}-xem1`)).role).toBe('viewer');
    expect(ok(await dev.login(pin.id, 'admin', `${PW}-admin`)).role).toBe('administrator');
    expect(await dev.login(pin.id, 'kysu1', 'sai')).toEqual({ error: 'auth-failed' });
    expect(await dev.login(pin.id, 'khongco', `${PW}-kysu1`)).toEqual({ error: 'auth-failed' });
    expect((await dev.devices()).find((d) => d.id === pin.id)?.lastUser).toBe('admin');
    dev.control.setSetupRequired('BL335-01', true);
    expect(await dev.login(pin.id, 'kysu1', `${PW}-kysu1`)).toEqual({ error: 'setup-required' });
  });

  it('mật khẩu có dấu so sau chuẩn hóa NFC, như Studio gửi (ADR-011, T085c): gõ dạng tổ hợp vẫn vào được', async () => {
    const pin = await pinned(dev, 'BL335-01');
    // Thiết bị lưu dạng dựng sẵn: lệnh đặt mật khẩu trên thiết bị từ chối dấu tổ hợp.
    const stored = `${PW}-Trăm-bơm`;
    dev.control.setPassword('kysu1', stored);
    const typed = `${PW}-Trăm-bơm`;
    expect(typed).not.toBe(stored);
    expect(ok(await dev.login(pin.id, 'kysu1', typed)).user).toBe('kysu1');
    expect(ok(await dev.login(pin.id, 'kysu1', stored)).user).toBe('kysu1');
    // Chữ khác (không dấu) thì vẫn sai.
    expect(await dev.login(pin.id, 'kysu1', `${PW}-Tram-bom`)).toEqual({ error: 'auth-failed' });
  });

  it('sai 5 lần thì khóa 5 phút, lần 6 đúng mật khẩu vẫn bị từ chối; hết 5 phút thì vào được', async () => {
    const pin = await pinned(dev, 'BL335-02');
    for (let i = 0; i < 5; i++)
      expect(await dev.login(pin.id, 'xem1', 'sai')).toEqual({ error: 'auth-failed' });
    expect(await dev.login(pin.id, 'xem1', `${PW}-xem1`)).toEqual({ error: 'locked', detail: 300 });
    await vi.advanceTimersByTimeAsync(13_000);
    expect(await dev.login(pin.id, 'xem1', `${PW}-xem1`)).toEqual({ error: 'locked', detail: 287 });
    await vi.advanceTimersByTimeAsync(287_000);
    expect(ok(await dev.login(pin.id, 'xem1', `${PW}-xem1`)).user).toBe('xem1');
  });

  it('chứng chỉ đổi sau khi ghim: đăng nhập bị chặn kèm fingerprint đã ghim và fingerprint thấy', async () => {
    const pin = await pinned(dev, 'BL335-01');
    const g = dev.control.rotateCert('BL335-01');
    expect(await dev.login(pin.id, 'kysu1', `${PW}-kysu1`)).toEqual({
      error: 'cert-mismatch',
      detail: { pinned: pin.pin!.fingerprint, seen: g },
    });
  });

  it('device_get: chỉ đường dẫn cho phép; phiên hết hạn, phiên bị hủy, thiếu quyền', async () => {
    const pin = await pinned(dev, 'BL335-01');
    expect(await dev.get(pin.id, '/api/v1/project/package')).toEqual({ error: 'bad-path' });
    const info = ok(await dev.get(pin.id, '/api/v1/system/info'));
    expect(info.body).toMatchObject({
      runtimeVersion: '0.4.0',
      device: { name: 'BL335-01', https: 'ok' },
      project: { projectId: 'tank-demo' },
    });
    expect(await dev.get(pin.id, '/api/v1/auth/session')).toEqual({ error: 'auth-required' });
    ok(await dev.login(pin.id, 'xem1', `${PW}-xem1`));
    expect(ok(await dev.get(pin.id, '/api/v1/auth/session')).body).toMatchObject({
      user: 'xem1',
      role: 'viewer',
    });
    expect(ok(await dev.get(pin.id, '/api/v1/diagnostics')).status).toBe(200);
    expect(await dev.get(pin.id, '/api/v1/audit')).toEqual({ error: 'forbidden' });
    expect(await dev.session(pin.id)).toMatchObject({ user: 'xem1' });
    dev.control.expireSession('BL335-01');
    expect(await dev.get(pin.id, '/api/v1/auth/session')).toEqual({ error: 'session-expired' });
    // Rust bỏ token sau 401 SESSION_*: lần sau là chưa đăng nhập.
    expect(await dev.get(pin.id, '/api/v1/auth/session')).toEqual({ error: 'auth-required' });
    expect(await dev.session(pin.id)).toBeNull();
    ok(await dev.login(pin.id, 'kysu1', `${PW}-kysu1`));
    dev.control.invalidateSession('BL335-01');
    expect(await dev.get(pin.id, '/api/v1/auth/session')).toEqual({ error: 'session-invalid' });
    ok(await dev.login(pin.id, 'kysu1', `${PW}-kysu1`));
    await dev.logout(pin.id);
    expect(await dev.session(pin.id)).toBeNull();
  });

  it('dữ liệu sống giả: hello, subscribe → snapshot, delta; chứng chỉ đổi → close 1006 cert-mismatch', async () => {
    const pin = await pinned(dev, 'BL335-01');
    const s = dev.openLive({ id: pin.id });
    const got: Array<Record<string, unknown>> = [];
    const closes: Array<{ code: number; reason?: string }> = [];
    s.onopen = () =>
      s.send(
        JSON.stringify({
          type: 'subscribe',
          requestId: 'r1',
          tags: ['TANK01.LEVEL', 'KHONG.CO'],
          mode: 'delta',
        }),
      );
    s.onmessage = (ev) => got.push(JSON.parse(String(ev.data)) as Record<string, unknown>);
    s.onclose = (ev) => closes.push(ev);
    await vi.advanceTimersByTimeAsync(1200);
    expect(got[0]).toMatchObject({ type: 'hello', protocolVersion: '1.1.0' });
    expect(got[1]).toMatchObject({
      type: 'snapshot',
      subscriptionId: 'r1',
      tags: [{ id: 'TANK01.LEVEL', value: 42, quality: 'GOOD' }],
      unknown: ['KHONG.CO'],
    });
    expect(got.some((m) => m.type === 'delta')).toBe(true);
    expect(ok(await dev.get(pin.id, '/api/v1/system/info')).body).toMatchObject({ clients: 1 });
    s.close(1000, 'stop');
    await vi.advanceTimersByTimeAsync(100);
    expect(ok(await dev.get(pin.id, '/api/v1/system/info')).body).toMatchObject({ clients: 0 });

    dev.control.rotateCert('BL335-01');
    const s2 = dev.openLive({ id: pin.id });
    const c2: Array<{ code: number; reason?: string }> = [];
    s2.onclose = (ev) => c2.push(ev);
    await vi.advanceTimersByTimeAsync(100);
    expect(c2).toEqual([{ code: 1006, reason: 'cert-mismatch' }]);
  });

  it('nhật ký lệnh không giữ mật khẩu; bản dùng cho e2e gắn vào window.__matMock.device', async () => {
    const pin = await pinned(dev, 'BL335-01');
    await dev.login(pin.id, 'kysu1', `${PW}-kysu1`);
    await dev.login(pin.id, 'kysu1', 'sai-mat-khau');
    expect(dev.control.calls.map((c) => c.cmd)).toContain('device_login');
    expect(JSON.stringify(dev.control.calls)).not.toContain(PW);
    expect(JSON.stringify(dev.control.calls)).not.toContain('sai-mat-khau');
    expect(JSON.stringify(await dev.devices())).not.toContain(PW);
    const w = window as unknown as { __matMock?: { device?: unknown } };
    expect(w.__matMock?.device).toBe(deviceLink.control);
  });

  // Hành vi của Rust (phiên chính đối chiếu 2026-10-11, contract tauri-commands §10).
  it('device_login: tên > 64 byte hay mật khẩu > 512 byte → auth-failed, không gửi đi (không tính lần sai); thứ tự kiểm', async () => {
    const f = dev.control.device('BL335-02');
    const known = ok(await dev.addDevice({ host: f.ip }));
    // Chưa ghim: cert-unpinned trước mọi kiểm khác.
    expect(await dev.login(known.id, 'x'.repeat(65), 'p')).toEqual({ error: 'cert-unpinned' });
    const pin = await pinned(dev, 'BL335-02');
    dev.control.setSetupRequired('BL335-02', true);
    expect(await dev.login(pin.id, 'x'.repeat(65), 'p')).toEqual({ error: 'setup-required' });
    dev.control.setSetupRequired('BL335-02', false);
    for (let i = 0; i < 6; i++) {
      expect(await dev.login(pin.id, 'x'.repeat(65), 'p')).toEqual({ error: 'auth-failed' });
      expect(await dev.login(pin.id, 'xem1', 'p'.repeat(513))).toEqual({ error: 'auth-failed' });
    }
    // Không gửi tới thiết bị nên không bị khóa.
    expect(ok(await dev.login(pin.id, 'xem1', `${PW}-xem1`)).user).toBe('xem1');
  });

  it('device_update đổi host hoặc cổng HTTPS: bỏ phiên và kết quả dò cũ, giữ ghim; device_session hỏi thiết bị (401 → null)', async () => {
    const pin = await pinned(dev, 'BL335-01');
    ok(await dev.login(pin.id, 'kysu1', `${PW}-kysu1`));
    expect(await dev.session(pin.id)).toMatchObject({ user: 'kysu1' });
    dev.control.expireSession('BL335-01');
    expect(await dev.session(pin.id)).toBeNull();
    ok(await dev.login(pin.id, 'kysu1', `${PW}-kysu1`));
    const moved = ok(await dev.updateDevice({ id: pin.id, name: 'Bom 1' }));
    expect(moved.name).toBe('Bom 1');
    expect(await dev.session(pin.id)).not.toBeNull();
    // Đổi host (cùng thiết bị, gọi theo tên máy): bỏ phiên và kết quả dò, giữ ghim.
    const back = ok(await dev.updateDevice({ id: pin.id, host: 'BL335-01' }));
    expect(back.host).toBe('BL335-01');
    expect(back.pin?.fingerprint).toBe(pin.pin?.fingerprint);
    expect(await dev.session(pin.id)).toBeNull();
    // Kết quả dò cũ bị bỏ: ghim lại phải dò lại.
    expect(await dev.pin(pin.id, pin.pin!.fingerprint)).toEqual({ error: 'not-observed' });
    expect(await dev.unpin(pin.id, 'f'.repeat(64))).toEqual({ error: 'pin-mismatch' });
  });

  // T085a, như Rust (registry.rs, mod.rs): tên mặc định là host; dò chỉ bắt tay TLS nên không đặt tên.
  it('thiết bị thêm theo địa chỉ: đăng nhập đúng (hoặc đọc device/identity) đặt tên thiết bị báo; tên người dùng đặt thì giữ; đổi host thì tên mặc định theo host', async () => {
    const f = dev.control.device('TRAM-XA');
    const k = ok(await dev.addDevice({ host: f.ip }));
    expect(k.name).toBe('10.8.0.21');
    const nameOf = async (id: string) => (await dev.devices()).find((d) => d.id === id)?.name;
    ok(await dev.pin(k.id, ok(await dev.probe(k.id)).fingerprint));
    expect(await nameOf(k.id)).toBe('10.8.0.21');
    expect(await dev.login(k.id, 'kysu1', 'sai')).toEqual({ error: 'auth-failed' });
    expect(await nameOf(k.id)).toBe('10.8.0.21');
    ok(await dev.login(k.id, 'kysu1', `${PW}-kysu1`));
    expect(await nameOf(k.id)).toBe('TRAM-XA');
    ok(await dev.updateDevice({ id: k.id, name: 'Trạm xa' }));
    ok(await dev.login(k.id, 'kysu1', `${PW}-kysu1`));
    expect(await nameOf(k.id)).toBe('Trạm xa');

    const b = await pinned(dev, 'BL335-01');
    expect(b.name).toBe('192.168.1.110');
    expect(ok(await dev.get(b.id, '/api/v1/device/identity')).body).toMatchObject({
      name: 'BL335-01',
    });
    expect(await nameOf(b.id)).toBe('BL335-01');

    const c = ok(await dev.addDevice({ host: '192.168.1.140' }));
    expect(ok(await dev.updateDevice({ id: c.id, host: '192.168.1.141' })).name).toBe(
      '192.168.1.141',
    );
  });

  it('chế độ theo dõi chỉ HTTP như Rust: monitor_get, live_open theo địa chỉ có scheme khác http:// → bad-address', async () => {
    expect(await dev.monitorGet('https://192.168.1.117:8443')).toEqual({ error: 'bad-address' });
    expect(await dev.monitorGet('wss://192.168.1.117:8080')).toEqual({ error: 'bad-address' });
    expect(ok(await dev.monitorGet('http://192.168.1.117:8080/')).body).toMatchObject({
      runtimeVersion: '0.3.0',
    });
    const s = dev.openLive({ address: 'wss://192.168.1.117:8080' });
    const closes: Array<{ code: number; reason?: string }> = [];
    s.onclose = (ev) => closes.push(ev);
    await vi.advanceTimersByTimeAsync(50);
    expect(closes).toEqual([{ code: 1006, reason: 'bad-address' }]);
  });

  it('control.addSaved: thêm thẳng vào danh sách đã lưu (như devices.json có sẵn), không qua lệnh', async () => {
    const k = dev.control.addSaved({ host: '127.0.0.1', httpPort: 18080, name: 'BL335-LAB' });
    expect(k).toMatchObject({
      name: 'BL335-LAB',
      host: '127.0.0.1',
      httpsPort: 8443,
      httpPort: 18080,
      pin: null,
    });
    expect((await dev.devices()).map((d) => d.id)).toEqual([k.id]);
    expect(dev.control.calls.some((c) => c.cmd === 'device_add')).toBe(false);
    expect(() => dev.control.addSaved({ host: 'a b' })).toThrow(/bad-address/);
  });

  it('live_open khi chưa ghim: close 1006, lý do cert-unpinned; liveId là số', async () => {
    const f = dev.control.device('BL335-01');
    const known = ok(await dev.addDevice({ host: f.ip }));
    const s = dev.openLive({ id: known.id });
    const closes: Array<{ code: number; reason?: string }> = [];
    s.onclose = (ev) => closes.push(ev);
    await vi.advanceTimersByTimeAsync(50);
    expect(closes).toEqual([{ code: 1006, reason: 'cert-unpinned' }]);
    const open = dev.control.calls.find((c) => c.cmd === 'live_close');
    expect(open === undefined || typeof open.args.liveId === 'number').toBe(true);
  });
});
