// Trang Thiết bị khi có lớp thiết bị (feature 005, T085a, FR-031, FR-035): thiết bị gắn với project kèm
// "Đổi thiết bị…"; ô địa chỉ (theo dõi chỉ đọc qua HTTP, cho thiết bị runtime cũ) báo ngay tại ô khi gõ
// `https://`, gợi ý dùng Online, không gọi thiết bị; "Kết nối theo dõi" của trang theo dõi theo địa chỉ đã
// nhập (không phải Ctrl+K).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import '../mat-shell.ts';
import type { MatShell } from '../mat-shell.ts';
import { buttonByText, newOnlineApp, textOf, typeInto } from '../online-test-helpers.ts';
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

  it('chưa mở project: phần thiết bị của project nhắc mở project', async () => {
    const { page } = await openPage({ open: false });
    expect(textOf(bound(page))).toContain('Mở project');
  });
});
