// Thanh trạng thái khi làm việc với thiết bị (feature 004, T071, FR-008, FR-028, FR-030, US3-3, US3-6,
// Edge Cases): tên, địa chỉ, runtime, project trên thiết bị; báo khi thiết bị chạy project khác; lý do lỗi
// bằng chữ; đầy thì đếm ngược tới lần thử lại và có "Thử lại ngay"; mất kết nối thì đếm ngược kết nối lại.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../app/app.ts';
import { DEVICE_INFO, flush, newDeviceApp, toMonitoring } from './device-test-helpers.ts';
import './mat-shell.ts';
import type { MatShell } from './mat-shell.ts';
import './mat-statusbar.ts';
import type { MatStatusbar } from './mat-statusbar.ts';
import { cleanup, mount, settled } from './test-helpers.ts';

const apps: StudioApp[] = [];

async function setup() {
  const env = await newDeviceApp();
  apps.push(env.app);
  const bar = await mount<MatStatusbar>('mat-statusbar', env.app);
  const text = () => bar.textContent!.replace(/\s+/g, ' ');
  return { ...env, bar, text };
}

const button = (root: Element, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(text),
  );

describe('thanh trạng thái: thiết bị', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('không kết nối: địa chỉ đã nhập, hoặc nhắc nhập địa chỉ', async () => {
    const { app, bar, text } = await setup();
    expect(text()).toContain('Không kết nối');
    expect(text()).toContain('chưa nhập địa chỉ thiết bị');
    app.setDeviceAddress('192.168.1.110');
    await settled(bar);
    expect(text()).toContain('192.168.1.110');
  });

  it('đang theo dõi: tên, địa chỉ, phiên bản runtime, project trên thiết bị', async () => {
    const { app, device, bar, text } = await setup();
    await toMonitoring(app, device);
    await settled(bar);
    for (const s of [
      'Đang theo dõi',
      'BL335',
      '192.168.1.110:8080',
      'runtime 0.3.0',
      'tank-demo 0.1.0, cùng phiên bản với máy này',
    ])
      expect(text(), s).toContain(s);
    expect(app.ui.toast?.text).toContain('Đang theo dõi 192.168.1.110:8080');
  });

  it('thiết bị chạy project khác: báo trên thanh trạng thái và bằng thông báo', async () => {
    const { app, device, bar, text } = await setup();
    device.info = {
      ...DEVICE_INFO,
      project: { status: 'active', projectId: 'plant-a', projectVersion: '0.2.0' },
    };
    await toMonitoring(app, device);
    await settled(bar);
    expect(text()).toContain('thiết bị đang chạy project khác (plant-a, 0.2.0)');
    expect(app.ui.toast?.text).toContain('thiết bị đang chạy project khác (plant-a, 0.2.0)');
  });

  it('cùng project khác phiên bản; thiết bị chưa có project', async () => {
    const { app, device, bar, text } = await setup();
    device.info = {
      ...DEVICE_INFO,
      project: { status: 'active', projectId: 'tank-demo', projectVersion: '0.0.9' },
    };
    await toMonitoring(app, device);
    await settled(bar);
    expect(text()).toContain('tank-demo: thiết bị 0.0.9, máy này 0.1.0');
    await app.run('online.disconnect');
    device.info = { ...DEVICE_INFO, project: { status: 'missing' } };
    await toMonitoring(app, device);
    await settled(bar);
    expect(text()).toContain('thiết bị chưa có project');
  });

  it('không kết nối được: lý do bằng chữ (≤ 3 s), có thông báo', async () => {
    vi.useFakeTimers();
    const { app, device, bar, text } = await setup();
    device.mode = 'hang';
    app.setDeviceAddress('10.0.0.99');
    await app.run('online.connect');
    await settled(bar);
    expect(text()).toContain('Đang kết nối');
    await vi.advanceTimersByTimeAsync(3000);
    await settled(bar);
    expect(app.session.state).toBe('error');
    expect(text()).toContain('Không kết nối được: thiết bị không trả lời trong 3 s');
    expect(app.ui.toast?.text).toContain('thiết bị không trả lời trong 3 s');
  });

  it('thiết bị đầy: đếm ngược tới lần thử lại; "Thử lại ngay" thử lại tức thì', async () => {
    vi.useFakeTimers();
    const { app, device, bar, text } = await setup();
    app.setDeviceAddress('192.168.1.110');
    await app.run('online.connect');
    await flush();
    device.last().msg({
      type: 'error',
      code: 'MAX_CLIENTS_REACHED',
      message: 'Hệ thống đã đạt tối đa 10 kết nối. Vui lòng thử lại sau.',
    });
    device.last().serverClose(4429);
    await settled(bar);
    expect(app.session.state).toBe('full');
    expect(text()).toContain('Thiết bị đã đủ số phiên, tự thử lại sau 30 s');
    expect(app.ui.toast?.text).toContain('đã đủ số phiên');
    await vi.advanceTimersByTimeAsync(1000);
    await settled(bar);
    expect(text()).toContain('tự thử lại sau 29 s');
    button(bar, 'Thử lại ngay')!.click();
    await settled(bar);
    expect(device.sockets).toHaveLength(2);
    expect(app.session.state).toBe('connecting');
  });

  it('mất kết nối: giá trị không còn tốt, đếm ngược tới lần kết nối lại', async () => {
    vi.useFakeTimers();
    const { app, device, bar, text } = await setup();
    await toMonitoring(app, device);
    device.last().serverClose(1006);
    await settled(bar);
    expect(app.session.state).toBe('lost');
    expect(app.session.values.get('TANK01.LEVEL')?.quality).toBe('STALE');
    expect(text()).toContain('Mất kết nối, thử lại sau 1 s');
    expect(button(bar, 'Thử lại ngay')).toBeDefined();
    expect(app.ui.toast?.text).toContain('Mất kết nối tới 192.168.1.110:8080');
  });

  it('chỉ báo trên hàng menu nói đúng trạng thái: đang kết nối, theo dõi, đầy, mất kết nối', async () => {
    const env = await newDeviceApp();
    apps.push(env.app);
    const { app, device } = env;
    const shell = await mount<MatShell>('mat-shell', app);
    const chip = () =>
      shell.querySelector('.online-chip')?.textContent?.replace(/\s+/g, ' ').trim();
    app.setDeviceAddress('192.168.1.110');
    await app.run('online.connect');
    await settled(shell);
    expect(chip()).toBe('Đang kết nối 192.168.1.110:8080');
    await flush();
    device.last().open();
    device.last().hello();
    device.last().snapshot({ 'TANK01.LEVEL': 1 });
    await flush();
    await settled(shell);
    expect(chip()).toBe('Đang theo dõi 192.168.1.110:8080');
    device.last().serverClose(1006);
    await settled(shell);
    expect(chip()).toBe('Mất kết nối 192.168.1.110:8080');
    await app.run('online.disconnect');
    await app.run('online.connect');
    await flush();
    device.last().msg({ type: 'error', code: 'MAX_CLIENTS_REACHED', message: 'full' });
    device.last().serverClose(4429);
    await settled(shell);
    expect(chip()).toBe('Thiết bị 192.168.1.110:8080 đã đủ số phiên');
  });

  it('giao thức không tương thích: báo, không tự thử lại', async () => {
    const { app, device, bar, text } = await setup();
    app.setDeviceAddress('192.168.1.110');
    await app.run('online.connect');
    await flush();
    device.last().open();
    device.last().hello('2.0.0');
    await settled(bar);
    expect(app.session.state).toBe('incompatible');
    expect(text()).toContain('Giao thức của thiết bị không tương thích');
  });
});
