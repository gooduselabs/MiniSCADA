// Bản Tauri của DeviceLink (feature 005, T074, contracts/tauri-commands.md §1–7, §9): đúng tên lệnh Rust và
// khóa tham số (camelCase), luồng sự kiện qua `Channel`, lỗi IPC đổi thành DeviceError (`ipcError` của 004).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();

class FakeChannel<T> {
  static last: FakeChannel<unknown> | null = null;
  onmessage: (m: T) => void = () => undefined;
  constructor(onmessage?: (m: T) => void) {
    if (onmessage) this.onmessage = onmessage;
    FakeChannel.last = this as FakeChannel<unknown>;
  }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
  Channel: FakeChannel,
}));

const { tauriDevice } = await import('./tauri-device.ts');

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('DeviceLink Tauri', () => {
  beforeEach(() => {
    invoke.mockReset();
    FakeChannel.last = null;
  });

  it('card mạng, danh sách thiết bị: tên lệnh đúng contract', async () => {
    invoke.mockResolvedValueOnce([]);
    await tauriDevice.netInterfaces();
    expect(invoke).toHaveBeenLastCalledWith('net_interfaces', undefined);
    invoke.mockResolvedValueOnce([{ id: 'a' }]);
    expect(await tauriDevice.devices()).toEqual([{ id: 'a' }]);
    expect(invoke).toHaveBeenLastCalledWith('devices_list', undefined);
  });

  it('discover_run: interfaces + Channel; sự kiện found đẩy lên ngay; busy làm promise bị từ chối', async () => {
    const found: unknown[] = [];
    invoke.mockImplementationOnce(async () => {
      FakeChannel.last!.onmessage({ kind: 'found', device: { name: 'BL335-01' } });
      return { scanned: 1, found: 1, failed: [] };
    });
    expect(await tauriDevice.discover([0], (d) => found.push(d))).toEqual({
      scanned: 1,
      found: 1,
      failed: [],
    });
    expect(invoke).toHaveBeenLastCalledWith('discover_run', {
      interfaces: [0],
      onEvent: FakeChannel.last,
    });
    expect(found).toEqual([{ name: 'BL335-01' }]);
    invoke.mockRejectedValueOnce('busy');
    await expect(tauriDevice.discover(null, () => undefined)).rejects.toEqual({ error: 'busy' });
    expect(invoke).toHaveBeenLastCalledWith('discover_run', {
      interfaces: null,
      onEvent: expect.any(FakeChannel),
    });
  });

  it('thêm, sửa, quên thiết bị: tham số JS theo contract §3; lỗi thành DeviceError', async () => {
    invoke.mockResolvedValueOnce({ id: 'x' });
    await tauriDevice.addDevice({
      host: '192.168.1.110',
      httpsPort: 8443,
      fromDiscovery: { deviceId: 'd', mac: 'm', fingerprint: 'f' },
    });
    expect(invoke).toHaveBeenLastCalledWith('device_add', {
      host: '192.168.1.110',
      httpsPort: 8443,
      fromDiscovery: { deviceId: 'd', mac: 'm', fingerprint: 'f' },
    });
    invoke.mockRejectedValueOnce('too-many');
    expect(await tauriDevice.addDevice({ host: 'x' })).toEqual({ error: 'too-many' });
    invoke.mockRejectedValueOnce('no-such-device');
    expect(await tauriDevice.updateDevice({ id: 'x', name: 'n' })).toEqual({
      error: 'no-such-device',
    });
    expect(invoke).toHaveBeenLastCalledWith('device_update', { id: 'x', name: 'n' });
    invoke.mockResolvedValueOnce(null);
    await tauriDevice.forgetDevice('x');
    expect(invoke).toHaveBeenLastCalledWith('device_forget', { id: 'x' });
    invoke.mockRejectedValueOnce('no-such-device');
    await expect(tauriDevice.forgetDevice('x')).rejects.toEqual({ error: 'no-such-device' });
  });

  it('dò, ghim, gỡ ghim', async () => {
    const probe = { fingerprint: 'a', pinned: null, state: 'unpinned', discovered: null };
    invoke.mockResolvedValueOnce(probe);
    expect(await tauriDevice.probe('x')).toEqual(probe);
    expect(invoke).toHaveBeenLastCalledWith('device_probe', { id: 'x' });
    invoke.mockRejectedValueOnce({ tls: 'handshake failure' });
    expect(await tauriDevice.probe('x')).toEqual({ error: 'tls', detail: 'handshake failure' });
    invoke.mockRejectedValueOnce('not-observed');
    expect(await tauriDevice.pin('x', 'f')).toEqual({ error: 'not-observed' });
    expect(invoke).toHaveBeenLastCalledWith('device_pin', { id: 'x', fingerprint: 'f' });
    invoke.mockRejectedValueOnce('pin-mismatch');
    expect(await tauriDevice.unpin('x', 'f')).toEqual({ error: 'pin-mismatch' });
    expect(invoke).toHaveBeenLastCalledWith('device_unpin', { id: 'x', fingerprint: 'f' });
  });

  it('đăng nhập: lỗi có dữ liệu kèm giữ nguyên (khóa tạm, chứng chỉ đổi); đăng xuất, phiên', async () => {
    invoke.mockRejectedValueOnce({ locked: 287 });
    expect(await tauriDevice.login('x', 'kysu1', 'p')).toEqual({ error: 'locked', detail: 287 });
    expect(invoke).toHaveBeenLastCalledWith('device_login', {
      id: 'x',
      user: 'kysu1',
      password: 'p',
    });
    invoke.mockRejectedValueOnce({ 'cert-mismatch': { pinned: 'a', seen: 'b' } });
    expect(await tauriDevice.login('x', 'kysu1', 'p')).toEqual({
      error: 'cert-mismatch',
      detail: { pinned: 'a', seen: 'b' },
    });
    invoke.mockRejectedValueOnce('auth-failed');
    expect(await tauriDevice.login('x', 'kysu1', 'p')).toEqual({ error: 'auth-failed' });
    invoke.mockResolvedValueOnce(null);
    await tauriDevice.logout('x');
    expect(invoke).toHaveBeenLastCalledWith('device_logout', { id: 'x' });
    // Đăng xuất luôn thành công phía giao diện (Rust luôn xóa token).
    invoke.mockRejectedValueOnce('unreachable');
    await expect(tauriDevice.logout('x')).resolves.toBeUndefined();
    invoke.mockResolvedValueOnce(null);
    expect(await tauriDevice.session('x')).toBeNull();
    expect(invoke).toHaveBeenLastCalledWith('device_session', { id: 'x' });
  });

  it('device_login: mật khẩu chuẩn hóa NFC trước khi gửi (ADR-011, T085c): gõ dạng tổ hợp ("a" + U+0306) tới Rust ở dạng dựng sẵn ("ă")', async () => {
    // Hai bộ gõ cho cùng chữ có dấu dưới hai dạng byte: dựng sẵn và tổ hợp (chữ gốc + dấu kết hợp).
    invoke.mockResolvedValue({ user: 'kysu1' });
    await tauriDevice.login('x', 'kysu1', 'ă');
    expect(invoke).toHaveBeenLastCalledWith('device_login', {
      id: 'x',
      user: 'kysu1',
      password: 'ă',
    });
    // "Trăm bơm nước" dạng tổ hợp (ă = a + U+0306, ơ = o + U+031B, ư = u + U+031B, ớ = o + U+031B + U+0301).
    const typed = 'Trăm bơm nước 15+';
    const precomposed = 'Trăm bơm nước 15+';
    expect(typed).not.toBe(precomposed);
    await tauriDevice.login('x', 'kysu1', typed);
    expect(invoke.mock.lastCall?.[1]).toEqual({ id: 'x', user: 'kysu1', password: precomposed });
    // Đã ở dạng dựng sẵn, hay không có dấu: gửi nguyên văn.
    await tauriDevice.login('x', 'kysu1', precomposed);
    expect(invoke.mock.lastCall?.[1]).toEqual({ id: 'x', user: 'kysu1', password: precomposed });
    await tauriDevice.login('x', 'kysu1', 'khong-dau-0123456789');
    expect(invoke.mock.lastCall?.[1]).toMatchObject({ password: 'khong-dau-0123456789' });
  });

  it('device_get, monitor_get', async () => {
    invoke.mockResolvedValueOnce({ status: 200, body: { a: 1 } });
    expect(await tauriDevice.get('x', '/api/v1/audit', { limit: '10' })).toEqual({
      status: 200,
      body: { a: 1 },
    });
    expect(invoke).toHaveBeenLastCalledWith('device_get', {
      id: 'x',
      path: '/api/v1/audit',
      query: { limit: '10' },
    });
    invoke.mockRejectedValueOnce({ http: 500 });
    expect(await tauriDevice.get('x', '/api/v1/diagnostics')).toEqual({
      error: 'http',
      detail: 500,
    });
    expect(invoke).toHaveBeenLastCalledWith('device_get', { id: 'x', path: '/api/v1/diagnostics' });
    invoke.mockRejectedValueOnce('timeout');
    expect(await tauriDevice.monitorGet('10.0.0.9:8080')).toEqual({ error: 'timeout' });
    expect(invoke).toHaveBeenLastCalledWith('monitor_get', { address: '10.0.0.9:8080' });
  });

  it('openLive: live_open với target và Channel; live_send, live_close theo liveId', async () => {
    invoke.mockResolvedValueOnce({ liveId: 1 });
    const s = tauriDevice.openLive({ id: 'x' });
    const log: unknown[] = [];
    s.onopen = () => log.push('open');
    s.onmessage = (ev) => log.push(ev.data);
    s.onclose = (ev) => log.push(ev.code);
    expect(invoke).toHaveBeenLastCalledWith('live_open', {
      target: { id: 'x' },
      onEvent: FakeChannel.last,
    });
    await flush();
    const ch = FakeChannel.last!;
    ch.onmessage({ kind: 'open' });
    ch.onmessage({ kind: 'message', data: 'm1' });
    invoke.mockResolvedValue(null);
    s.send('hello');
    expect(invoke).toHaveBeenLastCalledWith('live_send', { liveId: 1, text: 'hello' });
    s.close(1000, 'stop');
    expect(invoke).toHaveBeenLastCalledWith('live_close', {
      liveId: 1,
      code: 1000,
      reason: 'stop',
    });
    ch.onmessage({ kind: 'close', code: 1000, reason: '' });
    expect(log).toEqual(['open', 'm1', 1000]);
    invoke.mockResolvedValueOnce({ liveId: 2 });
    tauriDevice.openLive({ address: '10.0.0.9:8080' });
    expect(invoke).toHaveBeenLastCalledWith('live_open', {
      target: { address: '10.0.0.9:8080' },
      onEvent: expect.any(FakeChannel),
    });
  });

  // ---- US2 (contract §8) ----

  it('package_build: danh sách { rel, hash }; lỗi changed kèm file', async () => {
    invoke.mockResolvedValueOnce({ packageId: 'p1', origin: 'built' });
    expect(await tauriDevice.buildPackage([{ rel: 'tags.json', hash: 'h' }])).toEqual({
      packageId: 'p1',
      origin: 'built',
    });
    expect(invoke).toHaveBeenLastCalledWith('package_build', {
      files: [{ rel: 'tags.json', hash: 'h' }],
    });
    invoke.mockRejectedValueOnce({ changed: 'tags.json' });
    expect(await tauriDevice.buildPackage([])).toEqual({ error: 'changed', detail: 'tags.json' });
    invoke.mockRejectedValueOnce({ package: 'E_PKG_SECRET' });
    expect(await tauriDevice.buildPackage([])).toEqual({
      error: 'package',
      detail: 'E_PKG_SECRET',
    });
  });

  it('device_deploy, device_restore: Channel sự kiện; kết quả hoặc DeviceError', async () => {
    const events: unknown[] = [];
    invoke.mockImplementationOnce(async () => {
      FakeChannel.last!.onmessage({ kind: 'send', sent: 1, total: 2 });
      return { opId: 'o', result: 'committed' };
    });
    expect(await tauriDevice.deploy('dev', 'p1', 'sha256:x', (e) => events.push(e))).toEqual({
      opId: 'o',
      result: 'committed',
    });
    expect(invoke).toHaveBeenLastCalledWith('device_deploy', {
      id: 'dev',
      packageId: 'p1',
      baseDigest: 'sha256:x',
      onEvent: FakeChannel.last,
    });
    expect(events).toEqual([{ kind: 'send', sent: 1, total: 2 }]);

    invoke.mockRejectedValueOnce({ busy: { opId: 'o', user: 'kysu2' } });
    expect(await tauriDevice.deploy('dev', 'p1', 'none', () => undefined)).toEqual({
      error: 'busy',
      detail: { opId: 'o', user: 'kysu2' },
    });
    invoke.mockRejectedValueOnce('base-changed');
    expect(await tauriDevice.deploy('dev', 'p1', 'none', () => undefined)).toEqual({
      error: 'base-changed',
    });

    invoke.mockResolvedValueOnce({ opId: 'r', kind: 'restore' });
    await tauriDevice.restore('dev', 6, 'sha256:y', () => undefined);
    expect(invoke).toHaveBeenLastCalledWith('device_restore', {
      id: 'dev',
      seq: 6,
      baseDigest: 'sha256:y',
      onEvent: expect.any(FakeChannel),
    });
    invoke.mockRejectedValueOnce('already-active');
    expect(await tauriDevice.restore('dev', 7, 'none', () => undefined)).toEqual({
      error: 'already-active',
    });
    invoke.mockRejectedValueOnce('lost');
    expect(await tauriDevice.restore('dev', 6, 'none', () => undefined)).toEqual({ error: 'lost' });
  });

  it('device_fetch_package: seq chỉ gửi khi có; lỗi gói kèm đường dẫn', async () => {
    invoke.mockResolvedValueOnce({ packageId: 'p2', origin: 'fetched' });
    await tauriDevice.fetchPackage('dev');
    expect(invoke).toHaveBeenLastCalledWith('device_fetch_package', { id: 'dev' });
    invoke.mockResolvedValueOnce({ packageId: 'p3' });
    await tauriDevice.fetchPackage('dev', 6);
    expect(invoke).toHaveBeenLastCalledWith('device_fetch_package', { id: 'dev', seq: 6 });
    invoke.mockRejectedValueOnce({ 'package-at': { code: 'E_PKG_CHECKSUM', path: 'tags.json' } });
    expect(await tauriDevice.fetchPackage('dev')).toEqual({
      error: 'package-at',
      detail: { code: 'E_PKG_CHECKSUM', path: 'tags.json' },
    });
    invoke.mockRejectedValueOnce('no-project-package');
    expect(await tauriDevice.fetchPackage('dev')).toEqual({ error: 'no-project-package' });
  });

  it('package_read: { text, hash } hoặc mã đọc lỗi của 004; package_discard', async () => {
    invoke.mockResolvedValueOnce({ text: '{}', hash: 'h' });
    expect(await tauriDevice.readPackageFile('p1', 'tags.json')).toEqual({ text: '{}', hash: 'h' });
    expect(invoke).toHaveBeenLastCalledWith('package_read', { packageId: 'p1', rel: 'tags.json' });
    for (const code of ['missing', 'bad-path', 'too-large', 'bad-utf8']) {
      invoke.mockRejectedValueOnce(code);
      expect(await tauriDevice.readPackageFile('p1', 'x.json')).toEqual({ error: code });
    }
    invoke.mockResolvedValueOnce(null);
    await tauriDevice.discardPackage('p1');
    expect(invoke).toHaveBeenLastCalledWith('package_discard', { packageId: 'p1' });
  });
});
