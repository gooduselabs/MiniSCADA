// Nối US1 vào khung của 004 (feature 005, T083, FR-031, FR-035, data-model §6): lệnh Online › Thiết bị
// trong mạng…, Đăng nhập…, Đăng xuất; thanh trạng thái có thiết bị, tài khoản và role; viền cam; phiên hết
// hạn hỏi đăng nhập lại mà không đụng việc đang sửa; thiết bị runtime cũ chỉ theo dõi chỉ đọc. Nạp xuống,
// Đọc lên, So sánh vẫn khóa (US2/US3, sau Mốc bảo mật).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceRows } from '../model/discovery.ts';
import { deviceNodeState, findNode } from '../model/tree.ts';
import { isDeviceError } from '../platform/device-types.ts';
import '../ui/mat-shell.ts';
import type { MatShell } from '../ui/mat-shell.ts';
import {
  memoryStorage,
  newOnlineApp,
  pinnedDevice,
  textOf,
  type OnlineEnv,
} from '../ui/online-test-helpers.ts';
import { cleanup, mount, settled } from '../ui/test-helpers.ts';
import { StudioApp } from './app.ts';
import { BINDINGS_KEY, projectKey } from './device-binding.ts';
import type { StorageLike } from './workspace.ts';

const apps: StudioApp[] = [];

async function env(opts: { open?: boolean; storage?: StorageLike } = {}): Promise<OnlineEnv> {
  vi.useFakeTimers();
  const e = await newOnlineApp(opts);
  apps.push(e.app);
  return e;
}

async function advance(ms = 10) {
  await vi.advanceTimersByTimeAsync(ms);
  await settled();
}

/** Online tới thiết bị giả đã ghim, đăng nhập bằng tài khoản `user`. */
async function goOnline(e: OnlineEnv, name = 'BL335-01', user = 'kysu1') {
  const k = await pinnedDevice(e.dev, name);
  e.app.session.goOnline(k);
  await advance();
  await e.app.login(user, e.pw(user));
  await advance(300);
  expect(e.app.session.state).toBe('monitoring');
  return k;
}

const statusbar = (shell: MatShell) => textOf(shell.querySelector('mat-statusbar'));

describe('Online trong khung Studio (feature 005)', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('Thiết bị trong mạng… luôn bật (kể cả chưa mở project), mở hộp thoại; Nạp xuống, Đọc lên, So sánh vẫn khóa', async () => {
    const { app } = await env({ open: false });
    expect(app.enabled('online.devices')).toBe(true);
    await app.run('online.devices');
    expect(app.ui.dialog).toEqual({ kind: 'devices' });
    for (const id of ['online.download', 'online.upload', 'online.compare'] as const)
      expect(app.enabled(id), id).toBe('reason.f005');
  });

  it('Đăng nhập…, Đăng xuất: điều kiện bật và lý do theo phiên', async () => {
    const e = await env();
    const { app } = e;
    expect(app.enabled('online.login')).toBe(true);
    expect(app.enabled('online.logout')).toBe('reason.notLoggedIn');
    await goOnline(e);
    expect(app.enabled('online.login')).toBe('reason.loggedIn');
    expect(app.enabled('online.logout')).toBe(true);
    e.dev.control.expireSession('BL335-01');
    await advance(5000);
    expect(app.session.state).toBe('relogin');
    expect(app.enabled('online.login')).toBe(true);
    expect(app.enabled('online.logout')).toBe(true);
  });

  it('Đăng nhập… khi chưa Online lần nào: mở Thiết bị trong mạng; đã Online rồi ngắt: Online lại thiết bị gần nhất', async () => {
    const e = await env();
    await e.app.run('online.login');
    expect(e.app.ui.dialog).toEqual({ kind: 'devices' });
    e.app.closeOnlineDialog();
    await goOnline(e);
    await e.app.run('online.disconnect');
    expect(e.app.session.state).toBe('idle');
    await e.app.run('online.login');
    await advance(300);
    // Rust còn giữ phiên của thiết bị: vào thẳng, không hỏi lại.
    expect(e.app.session.state).toBe('monitoring');
    expect(e.app.session.auth?.user).toBe('kysu1');
    expect(e.app.ui.dialog).toBeNull();
  });

  it('thanh trạng thái khi Online: tên thiết bị, địa chỉ HTTPS, runtime, kysu1 · engineer; viền cam; chip Online', async () => {
    const e = await env();
    const shell = await mount<MatShell>('mat-shell', e.app);
    await goOnline(e);
    await settled(shell);
    const sb = statusbar(shell);
    for (const s of [
      'Online',
      'BL335-01',
      '192.168.1.110:8443',
      'runtime 0.4.0',
      'kysu1 · engineer',
    ])
      expect(sb, s).toContain(s);
    expect(shell.querySelector('.win.online')).not.toBeNull();
    expect(textOf(shell.querySelector('.online-chip'))).toBe('Online: BL335-01');
    expect(e.app.ui.toast?.text).toBe(
      'Đã online BL335-01 (tài khoản kysu1 · engineer). Viền cam: đang làm việc với thiết bị.',
    );
    // Cây project: nút thiết bị mang tên thiết bị, đang theo dõi.
    const node = findNode(e.app.tree(), 'device');
    expect(node?.label).toBe('BL335-01');
    expect(node?.deviceState).toBe('monitoring');
  });

  it('phiên hết hạn: hỏi đăng nhập lại; Tag đang sửa vẫn còn, chưa lưu; viền cam giữ; có nút Đăng nhập lại', async () => {
    const e = await env();
    const shell = await mount<MatShell>('mat-shell', e.app);
    await goOnline(e);
    e.app.store.edit([{ kind: 'tagField', index: 0, field: 'unit', value: 'cm' }]);
    expect(e.app.store.dirtyFiles()).toEqual(['tags.json']);
    e.dev.control.expireSession('BL335-01');
    await advance(5000);
    await settled(shell);
    expect(e.app.session.state).toBe('relogin');
    expect(e.app.ui.dialog).toEqual({ kind: 'login' });
    expect(e.app.ui.toast?.text).toContain('Phiên đăng nhập BL335-01 đã hết hạn');
    expect(e.app.store.dirtyFiles()).toEqual(['tags.json']);
    expect(e.platform.control.writes).toEqual([]);
    expect(shell.querySelector('.win.online')).not.toBeNull();
    expect(deviceNodeState('relogin')).toBe('monitoring');
    e.app.closeOnlineDialog();
    await settled(shell);
    expect(statusbar(shell)).toContain('Phiên hết hạn, cần đăng nhập lại');
    const relogin = [...shell.querySelectorAll<HTMLButtonElement>('mat-statusbar button')].find(
      (b) => b.textContent?.includes('Đăng nhập lại'),
    );
    relogin!.click();
    await settled(shell);
    expect(e.app.ui.dialog).toEqual({ kind: 'login' });
    await e.app.login('kysu1', e.pw('kysu1'));
    await advance();
    expect(e.app.session.state).toBe('monitoring');
    expect(e.app.store.dirtyFiles()).toEqual(['tags.json']);
    expect(e.platform.control.writes).toEqual([]);
  });

  it('phiên bị hủy (tài khoản tắt, đổi IP): về Offline, báo lý do', async () => {
    const e = await env();
    await mount<MatShell>('mat-shell', e.app);
    await goOnline(e);
    e.dev.control.invalidateSession('BL335-01');
    await advance(5000);
    expect(e.app.session.state).toBe('idle');
    expect(e.app.online()).toBe(false);
    expect(e.app.ui.toast?.text).toBe(
      'Phiên đăng nhập bị hủy (tài khoản bị tắt hoặc máy này đổi địa chỉ mạng): Studio về Offline.',
    );
  });

  it('thiết bị runtime cũ: theo dõi chỉ đọc, báo "runtime cần cập nhật để nạp xuống"', async () => {
    const e = await env();
    const shell = await mount<MatShell>('mat-shell', e.app);
    const k = await e.dev.addDevice({ host: '192.168.1.117', name: 'BL335-07' });
    if (isDeviceError(k)) throw new Error(k.error);
    e.app.session.goOnline(k);
    await advance(300);
    await settled(shell);
    expect(e.app.session.state).toBe('monitoring');
    expect(e.app.session.mode).toBe('monitor');
    const sb = statusbar(shell);
    expect(sb).toContain('Đang theo dõi');
    expect(sb).toContain('runtime 0.3.0');
    expect(sb).toContain('runtime cần cập nhật để nạp xuống');
    expect(e.app.ui.toast?.text).toBe(
      'BL335-07 chạy runtime 0.3.0: chỉ theo dõi chỉ đọc. Runtime cần cập nhật để nạp xuống.',
    );
  });

  it('mỗi lượt quét đọc lại card mạng ngay trước (Rust đánh số theo lần gọi gần nhất); card đã chọn được chọn lại theo tên, địa chỉ', async () => {
    const e = await env();
    const real = await e.dev.netInterfaces();
    const usb = {
      ...real[0],
      name: 'USB Ethernet',
      address: '172.16.0.5',
      broadcast: '172.16.0.255',
    };
    let calls = 0;
    vi.spyOn(e.dev, 'netInterfaces').mockImplementation(async () => {
      calls++;
      // Lần gọi thứ hai: cắm thêm một card, các card cũ bị đánh số lại.
      return calls === 1 ? real : [usb, ...real].map((n, index) => ({ ...n, index }));
    });
    await e.app.run('online.devices');
    expect(calls).toBe(1);
    const discover = vi.spyOn(e.dev, 'discover');
    await advance(2600);
    expect(e.app.netInterfaces?.map((n) => n.name)).toEqual(['Ethernet 2', 'Wi-Fi', 'WireGuard']);
    // Chọn Wi-Fi (chỉ số 1 của lần gọi đầu) → lần gọi mới đánh số Wi-Fi là 2.
    await e.app.rescan([1]);
    expect(calls).toBe(2);
    expect(discover).toHaveBeenLastCalledWith([2], expect.any(Function));
    expect(e.app.discovery?.ifaces).toEqual([2]);
    expect(e.app.netInterfaces?.[2].name).toBe('Wi-Fi');
    await advance(2600);
  });

  it('đóng Thiết bị trong mạng khi đang dò chứng chỉ: hủy, không bật hộp thoại ghim sau đó', async () => {
    const e = await env();
    const k = await e.dev.addDevice({ host: '192.168.1.110', name: 'BL335-01' });
    if (isDeviceError(k)) throw new Error(k.error);
    const probe = e.dev.probe.bind(e.dev);
    vi.spyOn(e.dev, 'probe').mockImplementation(async (id) => {
      await new Promise((r) => setTimeout(r, 50));
      return probe(id);
    });
    await e.app.run('online.devices');
    await e.app.refreshDevices();
    e.app.session.goOnline(k);
    expect(e.app.session.state).toBe('probing');
    e.app.closeOnlineDialog();
    await advance(100);
    expect(e.app.session.state).toBe('idle');
    expect(e.app.ui.dialog).toBeNull();
  });

  it('Đăng xuất: Rust xóa token, về Offline, báo', async () => {
    const e = await env();
    await goOnline(e);
    await e.app.run('online.logout');
    await advance();
    expect(e.app.session.state).toBe('idle');
    expect(e.dev.control.calls.filter((c) => c.cmd === 'device_logout')).toHaveLength(1);
    expect(e.app.ui.toast?.text).toBe('Đã đăng xuất BL335-01.');
    expect(e.app.enabled('online.logout')).toBe('reason.notLoggedIn');
  });

  // ---- T085a (FR-031, FR-035): Ctrl+K và nút Online theo thiết bị gắn với project ----

  it('project chưa gắn thiết bị: Ctrl+K mở Thiết bị trong mạng, không kết nối', async () => {
    const e = await env();
    expect(e.app.projectDevice()).toBeNull();
    await e.app.run('online.connect');
    expect(e.app.ui.dialog).toEqual({ kind: 'devices' });
    expect(e.app.session.state).toBe('idle');
    expect(e.dev.control.calls.some((c) => c.cmd === 'device_probe')).toBe(false);
    await advance(2600);
  });

  it('chọn thiết bị trong hộp thoại (Online): gắn với project; Offline rồi Ctrl+K Online lại thiết bị đó qua wss (còn phiên Rust: không hỏi đăng nhập)', async () => {
    const e = await env();
    await e.app.run('online.connect');
    await advance(2600);
    const row = deviceRows(e.app.discovery?.rows ?? [], e.app.knownDevices).find(
      (r) => r.kind === 'found' && r.device.name === 'BL335-01',
    );
    await e.app.goOnline(row!);
    await advance();
    const bound = e.app.projectDevice();
    expect(bound).toMatchObject({ name: 'BL335-01', host: '192.168.1.110' });
    expect(e.app.ui.dialog).toEqual({ kind: 'pin' });
    await e.app.confirmPin();
    await e.app.login('kysu1', e.pw('kysu1'));
    await advance(300);
    expect(e.app.session.state).toBe('monitoring');
    await e.app.run('online.disconnect');
    const calls = (cmd: string) => e.dev.control.calls.filter((c) => c.cmd === cmd);
    const probes = calls('device_probe').length;
    await e.app.run('online.connect');
    await advance(300);
    expect(e.app.session.state).toBe('monitoring');
    expect(e.app.session.mode).toBe('online');
    expect(e.app.session.deviceId).toBe(bound!.id);
    expect(e.app.session.auth?.user).toBe('kysu1');
    expect(e.app.ui.dialog).toBeNull();
    expect(calls('device_probe')).toHaveLength(probes + 1);
    expect(calls('live_open').at(-1)?.args.target).toEqual({ id: bound!.id });
    expect(calls('device_login')).toHaveLength(1);
  });

  it('thêm theo địa chỉ trong hộp thoại: gắn với project; thiết bị runtime cũ → Ctrl+K theo dõi chỉ đọc kèm runtime-old (FR-035)', async () => {
    const e = await env();
    const added = await e.app.addDeviceAddress('192.168.1.117');
    expect(added.ok).toBe(true);
    expect(e.app.projectDevice()?.host).toBe('192.168.1.117');
    await e.app.run('online.connect');
    await advance(300);
    expect(e.app.session.state).toBe('monitoring');
    expect(e.app.session.mode).toBe('monitor');
    expect(e.app.session.notice).toBe('runtime-old');
    expect(e.app.session.address).toBe('http://192.168.1.117:8080');
    expect(e.app.ui.dialog).toBeNull();
  });

  // ---- T085b: thiết bị runtime cũ có cổng HTTP khác 8080 (port-forward :9080) ----

  it('thêm theo địa chỉ với cổng HTTP của runtime cũ (host:9080) rồi Ctrl+K: theo dõi chỉ đọc kèm runtime-old; danh sách đã lưu, Mở web thiết bị dùng cổng đó cả khi Offline', async () => {
    const e = await env();
    e.dev.control.setHttpPort('BL335-07', 9080);
    const added = await e.app.addDeviceAddress('192.168.1.117:9080');
    expect(added.ok && added.device).toMatchObject({ httpsPort: 9080, httpPort: 8080 });
    await e.app.run('online.connect');
    await advance(300);
    expect(e.app.session.state).toBe('monitoring');
    expect(e.app.session.mode).toBe('monitor');
    expect(e.app.session.notice).toBe('runtime-old');
    expect(e.app.session.address).toBe('http://192.168.1.117:9080');
    expect(e.app.ui.dialog).toBeNull();
    expect(e.app.projectDevice()).toMatchObject({ httpsPort: 9080, httpPort: 9080 });
    await e.app.run('online.disconnect');
    expect(e.app.projectDevice()?.httpPort).toBe(9080);
    const open = vi.spyOn(e.platform, 'openDeviceWeb');
    await e.app.run('online.openWeb');
    expect(open).toHaveBeenCalledWith('http://192.168.1.117:9080/');
  });

  it('Thêm theo địa chỉ kèm cổng HTTP (Nâng cao): lưu httpPort; thiết bị đã lưu thì sửa cổng HTTP; để trống là 8080; cổng sai → http-port, không lưu', async () => {
    const e = await env();
    const a = await e.app.addDeviceAddress('192.168.1.117', { httpPort: '9080' });
    expect(a.ok && a.device).toMatchObject({
      host: '192.168.1.117',
      httpsPort: 8443,
      httpPort: 9080,
    });
    const again = await e.app.addDeviceAddress('192.168.1.117:8443', { httpPort: ' 9090 ' });
    expect(again.ok && again.device).toMatchObject({ httpsPort: 8443, httpPort: 9090 });
    expect(e.app.knownDevices.map((d) => d.httpPort)).toEqual([9090]);
    for (const bad of ['0', '65536', 'abc', '80 80', '-1', '1e3', '8080.5'])
      expect(await e.app.addDeviceAddress('192.168.1.118', { httpPort: bad }), bad).toEqual({
        ok: false,
        error: 'http-port',
      });
    expect(e.app.knownDevices).toHaveLength(1);
    const d = await e.app.addDeviceAddress('192.168.1.119', { httpPort: '  ' });
    expect(d.ok && d.device.httpPort).toBe(8080);
  });

  it('gắn lưu cục bộ theo thư mục project, không ghi file project; mở lại Studio vẫn còn; project khác chưa gắn', async () => {
    const storage = memoryStorage();
    const e = await env({ storage });
    await e.app.addDeviceAddress('192.168.1.117');
    const id = e.app.boundDeviceId();
    expect(id).toBe(e.app.projectDevice()?.id);
    expect(e.platform.control.writes).toEqual([]);
    expect(JSON.parse(storage.data.get(BINDINGS_KEY)!)).toEqual([
      [projectKey('D:\\Projects\\tank-demo'), id],
    ]);
    // Lần mở Studio sau: cùng thiết lập cục bộ, Rust còn devices.json.
    const again = new StudioApp({ platform: e.platform, link: e.dev, storage, windowWidth: 1400 });
    apps.push(again);
    await again.start();
    await again.run('project.open');
    await again.store.idle();
    expect(again.boundDeviceId()).toBe(id);
    await again.refreshDevices();
    expect(again.projectDevice()?.host).toBe('192.168.1.117');
    // Thư mục project khác: chưa gắn, Ctrl+K mở hộp thoại.
    e.platform.control.useProject({ 'project.json': '{}' }, 'D:\\Projects\\khac');
    await again.run('project.open');
    await again.store.idle();
    expect(again.boundDeviceId()).toBeNull();
    await again.run('online.connect');
    expect(again.ui.dialog).toEqual({ kind: 'devices' });
    await advance(2600);
  });

  it('thiết bị đã gắn bị bỏ khỏi danh sách đã lưu: Bỏ trong hộp thoại gỡ gắn; bị bỏ ở nơi khác thì Ctrl+K gỡ gắn và mở hộp thoại', async () => {
    const e = await env();
    await e.app.addDeviceAddress('192.168.1.117');
    await e.app.forgetDevice(e.app.boundDeviceId()!);
    expect(e.app.boundDeviceId()).toBeNull();
    await e.app.addDeviceAddress('192.168.1.111');
    await e.dev.forgetDevice(e.app.boundDeviceId()!);
    await e.app.run('online.connect');
    expect(e.app.ui.dialog).toEqual({ kind: 'devices' });
    expect(e.app.boundDeviceId()).toBeNull();
    expect(e.app.session.state).toBe('idle');
    await advance(2600);
  });

  it('nút Online trên thanh công cụ chạy như Ctrl+K', async () => {
    const e = await env();
    const shell = await mount<MatShell>('mat-shell', e.app);
    shell.querySelector<HTMLButtonElement>('mat-toolbar [data-cmd="online.toggle"]')!.click();
    await advance();
    expect(e.app.ui.dialog).toEqual({ kind: 'devices' });
    await advance(2600);
    e.app.closeOnlineDialog();
    await e.app.addDeviceAddress('192.168.1.117');
    shell.querySelector<HTMLButtonElement>('mat-toolbar [data-cmd="online.toggle"]')!.click();
    await advance(300);
    expect(e.app.session.notice).toBe('runtime-old');
    expect(e.app.session.state).toBe('monitoring');
  });

  it('khi Offline: thanh trạng thái và cây project hiện thiết bị gắn với project', async () => {
    const e = await env();
    const shell = await mount<MatShell>('mat-shell', e.app);
    await e.dev.addDevice({ host: '192.168.1.110', name: 'BL335-01' });
    await e.app.addDeviceAddress('192.168.1.110');
    await settled(shell);
    const sb = statusbar(shell);
    for (const s of ['Không kết nối', 'BL335-01', '192.168.1.110:8443']) expect(sb, s).toContain(s);
    expect(findNode(e.app.tree(), 'device')?.label).toBe('BL335-01');
  });

  it('Đăng nhập… khi chưa Online lần nào mà project đã gắn thiết bị: Online thiết bị đó', async () => {
    const e = await env();
    await e.app.addDeviceAddress('192.168.1.110');
    await e.app.run('online.login');
    await advance();
    expect(e.app.session.deviceId).toBe(e.app.boundDeviceId());
    expect(e.app.ui.dialog).toEqual({ kind: 'pin' });
  });

  it('thiết bị thêm theo địa chỉ: đăng nhập xong danh sách đã lưu và thanh trạng thái mang tên thiết bị báo', async () => {
    const e = await env();
    const shell = await mount<MatShell>('mat-shell', e.app);
    await e.app.addDeviceAddress('10.8.0.21');
    expect(e.app.projectDevice()?.name).toBe('10.8.0.21');
    await e.app.run('online.connect');
    await advance();
    await e.app.confirmPin();
    await e.app.login('kysu1', e.pw('kysu1'));
    await advance(300);
    await settled(shell);
    expect(e.app.session.state).toBe('monitoring');
    expect(e.app.projectDevice()?.name).toBe('TRAM-XA');
    expect(statusbar(shell)).toContain('TRAM-XA');
    expect(e.app.ui.toast?.text).toContain('Đã online TRAM-XA');
  });

  it('chứng chỉ đổi: chặn, mở hộp thoại hiện fingerprint cũ và mới, thanh trạng thái nói lý do', async () => {
    const e = await env();
    const shell = await mount<MatShell>('mat-shell', e.app);
    const k = await pinnedDevice(e.dev, 'BL335-01');
    e.dev.control.rotateCert('BL335-01');
    e.app.session.goOnline(k);
    await advance();
    await settled(shell);
    expect(e.app.ui.dialog).toEqual({ kind: 'pin' });
    expect(e.app.ui.toast?.text).toBe('Chứng chỉ của BL335-01 đã đổi: Studio chặn kết nối.');
    e.app.closeOnlineDialog();
    await settled(shell);
    expect(statusbar(shell)).toContain(
      'chứng chỉ của thiết bị khác chứng chỉ đã ghim, Studio đã chặn kết nối',
    );
  });
});
