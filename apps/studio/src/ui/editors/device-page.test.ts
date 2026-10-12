// Trang Thiết bị (feature 004, T068, FR-027, FR-033, US3-2, US3-9): chuẩn hóa địa chỉ như Sprint 1; kiểm
// kết nối báo lỗi trong ≤ 3 s kể cả khi fetch treo; nhớ địa chỉ; Mở web thiết bị gọi open_device_web;
// kết nối theo dõi và ngắt dùng phiên thiết bị duy nhất.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioApp } from '../../app/app.ts';
import type { StorageLike } from '../../app/workspace.ts';
import { createMockPlatform } from '../../platform/mock.ts';
import '../mat-shell.ts';
import type { MatShell } from '../mat-shell.ts';
import { DEVICE_TIMEOUT_MS } from '../../model/device.ts';
import { DEVICE_INFO, flush, newDeviceApp } from '../device-test-helpers.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';

const apps: StudioApp[] = [];

async function openPage() {
  const env = await newDeviceApp();
  apps.push(env.app);
  const shell = await mount<MatShell>('mat-shell', env.app);
  await env.app.run('online.device');
  await settled(shell);
  const page = shell.querySelector<HTMLElement>('mat-device-page')!;
  const input = () => page.querySelector<HTMLInputElement>('input[name="device-address"]')!;
  return { ...env, shell, page, input };
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const button = (root: Element, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(text),
  )!;
const textOf = (el: Element) => el.textContent!.replace(/\s+/g, ' ');

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('trang Thiết bị', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('Online › Thiết bị… mở trang Thiết bị; ô địa chỉ có nhãn', async () => {
    const { shell, page, input } = await openPage();
    expect(page).not.toBeNull();
    expect(shell.querySelector('mat-pending-editor')).toBeNull();
    const label = page.querySelector(`label[for="${input().id}"]`);
    expect(label?.textContent?.trim()).toBe('Địa chỉ thiết bị');
  });

  it('chuẩn hóa địa chỉ như Sprint 1: hiện URL sẽ dùng, báo lỗi ngay tại ô', async () => {
    const { shell, page, input } = await openPage();
    type(input(), '192.168.1.110');
    await settled(shell);
    expect(textOf(page)).toContain('http://192.168.1.110:8080');
    expect(input().getAttribute('aria-invalid')).not.toBe('true');

    type(input(), 'http://198.51.100.200:9080/');
    await settled(shell);
    expect(textOf(page)).toContain('http://198.51.100.200:9080');

    type(input(), 'ftp://x');
    await settled(shell);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    const err = page.querySelector(`[id="${input().getAttribute('aria-describedby')}"]`);
    expect(err?.textContent).toContain('Chỉ hỗ trợ http:// và https://');

    type(input(), 'a:70000');
    await settled(shell);
    expect(textOf(page)).toContain('Cổng không hợp lệ');

    type(input(), 'x y');
    await settled(shell);
    expect(textOf(page)).toContain('Địa chỉ thiết bị không hợp lệ');
  });

  it('nhớ địa chỉ: ghi vào không gian làm việc, mở lại Studio vẫn còn', async () => {
    const mem = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
    };
    const app = new StudioApp({ platform: createMockPlatform(), storage, windowWidth: 1400 });
    apps.push(app);
    await app.start();
    await app.run('project.open');
    const shell = await mount<MatShell>('mat-shell', app);
    await app.run('online.device');
    await settled(shell);
    const input = shell.querySelector<HTMLInputElement>('input[name="device-address"]')!;
    type(input, ' 192.168.1.110:9080 ');
    await settled(shell);
    expect(app.workspace.deviceAddress).toBe('192.168.1.110:9080');
    expect(textOf(shell.querySelector('mat-tree')!)).toContain('192.168.1.110:9080');

    const again = new StudioApp({ platform: createMockPlatform(), storage, windowWidth: 1400 });
    apps.push(again);
    expect(again.workspace.deviceAddress).toBe('192.168.1.110:9080');
  });

  it('kiểm tra kết nối: thiết bị không trả lời (fetch treo) → báo lỗi đúng hạn (≤ 3 s), không treo', async () => {
    const { shell, page, input } = await openPage();
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    type(input(), '10.0.0.99');
    await settled(shell);
    button(page, 'Kiểm tra kết nối').click();
    await settled(shell);
    expect(textOf(page)).toContain('Đang kiểm tra http://10.0.0.99:8080');
    // Giao diện không treo: vẫn sửa được ô địa chỉ trong lúc chờ.
    expect(input().disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(DEVICE_TIMEOUT_MS - 1);
    await settled(shell);
    expect(textOf(page)).toContain('Đang kiểm tra');
    await vi.advanceTimersByTimeAsync(1);
    await settled(shell);
    expect(textOf(page)).toContain(
      'Không kết nối được http://10.0.0.99:8080: thiết bị không trả lời trong 3 s',
    );
  });

  it('kiểm tra kết nối thành công: runtime, giao thức, phiên/tối đa, project, lưu trữ; không chiếm phiên', async () => {
    const { shell, page, input, device } = await openPage();
    const fetchFn = respond(DEVICE_INFO);
    vi.stubGlobal('fetch', fetchFn);
    type(input(), '192.168.1.110');
    await settled(shell);
    button(page, 'Kiểm tra kết nối').click();
    await flush();
    await settled(shell);
    expect(fetchFn).toHaveBeenCalledWith(
      'http://192.168.1.110:8080/api/v1/system/info',
      expect.anything(),
    );
    const text = textOf(page);
    for (const s of [
      'Kết nối được http://192.168.1.110:8080',
      '0.3.0',
      '1.0.0',
      '3 / 10',
      'tank-demo 0.1.0, cùng phiên bản với máy này',
      'đang ghi · 15.234 dòng · 12,0 MB / 2,0 GB',
      'mysql-office: đang gửi · chờ 0 dòng · trễ 0 s',
      'influx: lỗi · chờ 1.834 dòng · trễ 1.830 s · connect refused',
    ])
      expect(text, s).toContain(s);
    expect(device.sockets).toHaveLength(0);
  });

  it('lỗi mạng, lỗi HTTP: nói rõ lý do', async () => {
    const { shell, page, input } = await openPage();
    type(input(), '192.168.1.110');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    button(page, 'Kiểm tra kết nối').click();
    await flush();
    await settled(shell);
    expect(textOf(page)).toContain('không tới được thiết bị');
    vi.stubGlobal('fetch', respond({}, 500));
    button(page, 'Kiểm tra kết nối').click();
    await flush();
    await settled(shell);
    expect(textOf(page)).toContain('thiết bị trả lỗi HTTP 500');
  });

  it('chưa nhập địa chỉ mà kiểm tra: báo tại ô', async () => {
    const { shell, page, input } = await openPage();
    const fetchFn = respond(DEVICE_INFO);
    vi.stubGlobal('fetch', fetchFn);
    button(page, 'Kiểm tra kết nối').click();
    await settled(shell);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(textOf(page)).toContain('Nhập địa chỉ thiết bị');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('Mở web thiết bị gọi open_device_web với gốc URL đã chuẩn hóa; khóa khi địa chỉ sai', async () => {
    const { shell, page, input, platform } = await openPage();
    const open = vi.spyOn(platform, 'openDeviceWeb');
    type(input(), 'x y');
    await settled(shell);
    expect(button(page, 'Mở web thiết bị').getAttribute('aria-disabled')).toBe('true');
    type(input(), '192.168.1.110:9080');
    await settled(shell);
    expect(button(page, 'Mở web thiết bị').getAttribute('aria-disabled')).not.toBe('true');
    button(page, 'Mở web thiết bị').click();
    await flush();
    expect(open).toHaveBeenCalledWith('http://192.168.1.110:9080/');
  });

  // contracts/commands.md: Online › Thiết bị… "luôn" bật; Sprint 1 kiểm kết nối được khi chưa mở project.
  it('chưa mở project: vẫn mở trang Thiết bị, kiểm kết nối được; theo dõi khóa kèm lý do', async () => {
    const env = await newDeviceApp({ open: false });
    apps.push(env.app);
    const shell = await mount<MatShell>('mat-shell', env.app);
    await env.app.run('online.device');
    await settled(shell);
    const page = shell.querySelector<HTMLElement>('mat-device-page');
    expect(page).not.toBeNull();
    vi.stubGlobal('fetch', respond(DEVICE_INFO));
    type(page!.querySelector<HTMLInputElement>('input[name="device-address"]')!, '192.168.1.110');
    await settled(shell);
    button(page!, 'Kiểm tra kết nối').click();
    await flush();
    await settled(shell);
    expect(textOf(page!)).toContain('Kết nối được http://192.168.1.110:8080');
    expect(textOf(page!)).toContain('tank-demo 0.1.0');
    const connect = button(page!, 'Kết nối theo dõi');
    expect(connect.getAttribute('aria-disabled')).toBe('true');
    expect(connect.title).toContain('Chưa mở project');
  });

  it('Kết nối theo dõi rồi Ngắt từ trang Thiết bị: một phiên, ngắt đóng socket ngay', async () => {
    const { app, shell, page, input, device } = await openPage();
    type(input(), '192.168.1.110');
    await settled(shell);
    button(page, 'Kết nối theo dõi').click();
    await flush();
    await settled(shell);
    expect(app.session.state).toBe('connecting');
    expect(device.sockets).toHaveLength(1);
    device.last().open();
    device.last().hello();
    device.last().snapshot({ 'TANK01.LEVEL': 1 });
    await flush();
    await settled(shell);
    expect(app.session.state).toBe('monitoring');
    expect(textOf(page)).toContain('Đang theo dõi');
    button(page, 'Ngắt kết nối').click();
    await settled(shell);
    expect(app.session.state).toBe('idle');
    expect(device.last().closed).not.toBeNull();
    expect(button(page, 'Kết nối theo dõi')).toBeDefined();
  });
});
