// Trang Thiết bị khi có lớp thiết bị (feature 005, T085a, FR-031, FR-035): thiết bị gắn với project kèm
// "Đổi thiết bị…"; ô địa chỉ (theo dõi chỉ đọc qua HTTP, cho thiết bị runtime cũ) báo ngay tại ô khi gõ
// `https://`, gợi ý dùng Online, không gọi thiết bị; "Kết nối theo dõi" của trang theo dõi theo địa chỉ đã
// nhập (không phải Ctrl+K).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import '../mat-shell.ts';
import type { MatShell } from '../mat-shell.ts';
import {
  buttonByText,
  newOnlineApp,
  pinnedDevice,
  textOf,
  typeInto,
} from '../online-test-helpers.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';

const apps: StudioApp[] = [];

async function openPage(opts: { open?: boolean } = {}) {
  vi.useFakeTimers();
  const env = await newOnlineApp(opts);
  apps.push(env.app);
  const shell = await mount<MatShell>('mat-shell', env.app);
  await env.app.run('online.device');
  await settled(shell);
  const page = shell.querySelector<HTMLElement>('mat-device-page')!;
  const input = () => page.querySelector<HTMLInputElement>('input[name="device-address"]')!;
  const calls = (cmd: string) => env.dev.control.calls.filter((c) => c.cmd === cmd);
  const advance = async (ms = 10) => {
    await vi.advanceTimersByTimeAsync(ms);
    await settled(shell);
  };
  return { ...env, shell, page, input, calls, advance };
}

const bound = (page: Element) => page.querySelector('.dp-bound');

describe('trang Thiết bị (feature 005)', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('gõ https:// ở ô địa chỉ: báo ngay tại ô, gợi ý Online (Ctrl+K) hoặc Thiết bị trong mạng; không gọi thiết bị', async () => {
    const { app, page, input, calls, advance } = await openPage();
    typeInto(input(), 'https://192.168.1.110:8443');
    await advance();
    expect(input().getAttribute('aria-invalid')).toBe('true');
    const err = page.querySelector(`[id="${input().getAttribute('aria-describedby')}"]`);
    expect(textOf(err)).toContain('Online (Ctrl+K)');
    expect(textOf(err)).toContain('Thiết bị trong mạng');
    buttonByText(page, 'Kiểm tra kết nối')!.click();
    await advance(3000);
    buttonByText(page, 'Kết nối theo dõi')!.click();
    await advance(3000);
    expect(calls('monitor_get')).toHaveLength(0);
    expect(calls('live_open')).toHaveLength(0);
    expect(app.session.state).toBe('idle');
    expect(buttonByText(page, 'Mở web thiết bị')!.getAttribute('aria-disabled')).toBe('true');
    buttonByText(page, 'Mở Thiết bị trong mạng')!.click();
    await advance();
    expect(app.ui.dialog).toEqual({ kind: 'devices' });
    await advance(2600);
  });

  it('project chưa gắn thiết bị: nói rõ; "Chọn thiết bị…" mở Thiết bị trong mạng', async () => {
    const { app, page, advance } = await openPage();
    expect(textOf(bound(page))).toContain('Project chưa gắn thiết bị');
    buttonByText(bound(page)!, 'Chọn thiết bị')!.click();
    await advance();
    expect(app.ui.dialog).toEqual({ kind: 'devices' });
    await advance(2600);
  });

  it('đã gắn: tên, địa chỉ HTTPS, trạng thái ghim; "Đổi thiết bị…" mở Thiết bị trong mạng; không ghi vào project', async () => {
    const { app, dev, platform, page, advance } = await openPage();
    await dev.addDevice({ host: '192.168.1.110', name: 'BL335-01' });
    await app.addDeviceAddress('192.168.1.110');
    await advance();
    const text = textOf(bound(page));
    for (const s of ['BL335-01', '192.168.1.110:8443', 'chưa ghim chứng chỉ'])
      expect(text, s).toContain(s);
    expect(text).toContain('không ghi vào file project');
    buttonByText(bound(page)!, 'Đổi thiết bị')!.click();
    await advance();
    expect(app.ui.dialog).toEqual({ kind: 'devices' });
    expect(platform.control.writes).toEqual([]);
    await advance(2600);
  });

  it('Kết nối theo dõi ở trang (thiết bị runtime cũ): theo dõi chỉ đọc địa chỉ đã nhập qua Rust (monitor_get, live_open theo địa chỉ), kể cả khi project đã gắn thiết bị', async () => {
    const { app, page, input, calls, advance } = await openPage();
    await app.addDeviceAddress('192.168.1.110');
    typeInto(input(), '192.168.1.117');
    await advance();
    buttonByText(page, 'Kết nối theo dõi')!.click();
    await advance(300);
    expect(app.session.state).toBe('monitoring');
    expect(app.session.mode).toBe('monitor');
    expect(app.session.deviceId).toBeNull();
    expect(calls('monitor_get').map((c) => c.args.address)).toContain('192.168.1.117:8080');
    expect(calls('live_open').at(-1)?.args.target).toEqual({ address: '192.168.1.117:8080' });
    expect(calls('device_probe')).toHaveLength(0);
    expect(textOf(page)).toContain('Đang theo dõi');
  });

  // T052 (feature 011, FR-036, FR-013): cảnh báo mới thành chip kèm hướng dẫn hành động; tên Host thiết bị nhận.
  it('Online: chip cho cảnh báo 011 kèm hướng dẫn, danh sách acceptedHosts', async () => {
    const { app, dev, page, advance, pw } = await openPage();
    dev.control.setRuntime('BL335-01', '1.0.0');
    dev.control.setAcceptedHosts('BL335-01', {
      names: ['localhost', 'bl335-01', 'bl335-01.local', 'scada.nhamay.vn'],
      ips: ['*'],
    });
    dev.control.setWarnings('BL335-01', [
      { code: 'HOST_CHECK_OFF', message: 'Kiểm Host đang tắt' },
      { code: 'SSH_ROOT_PASSWORD' },
      { code: 'PULSE_STUCK', detail: { tags: ['PUMP01.RUN_CMD'], pulseRecovery: 'on' } },
      { code: 'TIME_NOT_SYNCED' },
      { code: 'LOGIC_THROTTLED' },
      { code: 'UPDATE_ROLLED_BACK' },
    ]);
    app.session.goOnline(await pinnedDevice(dev, 'BL335-01'));
    await advance(60);
    await app.login('kysu1', pw('kysu1'));
    await advance(300);
    const chips = [...page.querySelectorAll('[data-role="devwarn"]')];
    expect(chips.map((c) => c.getAttribute('data-code'))).toEqual([
      'HOST_CHECK_OFF',
      'SSH_ROOT_PASSWORD',
      'PULSE_STUCK',
      'TIME_NOT_SYNCED',
      'LOGIC_THROTTLED',
      'UPDATE_ROLLED_BACK',
    ]);
    const text = textOf(page);
    // hướng dẫn hành động
    expect(text).toContain('allowedHosts');
    expect(text).toContain('PermitRootLogin');
    expect(text).toContain('PUMP01.RUN_CMD');
    expect(text).toContain('NTP');
    // tên Host thiết bị nhận
    const hosts = page.querySelector('[data-role="accepted-hosts"]');
    expect(textOf(hosts)).toContain('scada.nhamay.vn');
    expect(textOf(hosts)).toContain('bl335-01.local');
  });

  it('chưa mở project: phần thiết bị của project nhắc mở project', async () => {
    const { page } = await openPage({ open: false });
    expect(textOf(bound(page))).toContain('Mở project');
  });
});
