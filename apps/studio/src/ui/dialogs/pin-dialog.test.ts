// Hộp thoại xác nhận chứng chỉ (feature 005, T081, FR-008, spec US1-3, US1-4, mockup drawCert): fingerprint
// SHA-256 đủ 64 ký tự (chữ đơn cách, nhóm theo cặp), hướng dẫn so với `mat-runtime --cert-fingerprint`;
// chưa xác nhận thì không đi tiếp. Không khớp: hiện fingerprint cũ và mới, nói rõ nguy cơ; gỡ ghim chỉ khi
// xác nhận rõ.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { isDeviceError, type KnownDevice } from '../../platform/device-types.ts';
import type { MockDevice } from '../../platform/mock-device.ts';
import {
  buttonByText,
  newOnlineApp,
  pinnedDevice,
  textOf,
  type OnlineEnv,
} from '../online-test-helpers.ts';
import { cleanup, mount, press, settled } from '../test-helpers.ts';
import './devices-dialog.ts';
import './pin-dialog.ts';
import type { MatPinDialog } from './pin-dialog.ts';

const apps: StudioApp[] = [];
const FP1 = 'a35f1c9e4207b8d16c20e4937a0f58c2194bd760e82a913c5d7f0b66a412c98e';
const GROUPED1 = [
  'A3 5F 1C 9E 42 07 B8 D1',
  '6C 20 E4 93 7A 0F 58 C2',
  '19 4B D7 60 E8 2A 91 3C',
  '5D 7F 0B 66 A4 12 C9 8E',
].join('\n');

async function setup(): Promise<OnlineEnv & { el: MatPinDialog }> {
  vi.useFakeTimers();
  const env = await newOnlineApp();
  apps.push(env.app);
  await mount('mat-devices-dialog', env.app);
  const el = await mount<MatPinDialog>('mat-pin-dialog', env.app);
  return { ...env, el };
}

async function addNamed(dev: MockDevice, name: string): Promise<KnownDevice> {
  const r = await dev.addDevice({ host: dev.control.device(name).ip, name });
  if (isDeviceError(r)) throw new Error(r.error);
  return r;
}

async function advance(ms = 10) {
  await vi.advanceTimersByTimeAsync(ms);
  await settled();
}

const calls = (dev: MockDevice, cmd: string) => dev.control.calls.filter((c) => c.cmd === cmd);

describe('hộp thoại xác nhận chứng chỉ', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('lần đầu: fingerprint đủ 64 ký tự, chữ đơn cách, nhóm theo cặp; hướng dẫn so với mat-runtime --cert-fingerprint', async () => {
    const { app, dev, el } = await setup();
    app.session.goOnline(await addNamed(dev, 'BL335-01'));
    await advance();
    expect(app.ui.dialog).toEqual({ kind: 'pin' });
    expect(textOf(el.querySelector('.dlg-h'))).toContain('Xác nhận chứng chỉ · BL335-01');
    const body = textOf(el.querySelector('.dlg-b'));
    expect(body).toContain('Lần đầu kết nối tới BL335-01 (192.168.1.110:8443).');
    expect(body).toContain('mat-runtime --cert-fingerprint');
    const fp = el.querySelector('.fp')!;
    expect(fp.classList.contains('mono')).toBe(true);
    expect(fp.textContent).toBe(GROUPED1);
    expect(fp.textContent!.replace(/\s/g, '').toLowerCase()).toBe(FP1);
    expect(document.activeElement?.textContent).toContain('Ghim và tiếp tục');
  });

  it('chưa xác nhận thì không đi tiếp; Quay lại về danh sách thiết bị, không ghim', async () => {
    const { app, dev, el } = await setup();
    app.session.goOnline(await addNamed(dev, 'BL335-01'));
    await advance();
    await advance(60_000);
    expect(app.session.state).toBe('pin-confirm');
    expect(calls(dev, 'device_pin')).toHaveLength(0);
    buttonByText(el, 'Quay lại')!.click();
    await advance();
    expect(app.session.state).toBe('idle');
    expect(app.ui.dialog).toEqual({ kind: 'devices' });
    expect(calls(dev, 'device_pin')).toHaveLength(0);
  });

  it('Esc khi xác nhận lần đầu: hủy, về Offline, không ghim', async () => {
    const { app, dev, el } = await setup();
    app.session.goOnline(await addNamed(dev, 'BL335-01'));
    await advance();
    press(el.querySelector('.overlay')!, 'Escape');
    await advance();
    expect(app.ui.dialog).toBeNull();
    expect(app.session.state).toBe('idle');
    expect(calls(dev, 'device_pin')).toHaveLength(0);
  });

  it('Ghim và tiếp tục: ghim đúng fingerprint vừa dò rồi sang đăng nhập', async () => {
    const { app, dev, el } = await setup();
    const k = await addNamed(dev, 'BL335-01');
    app.session.goOnline(k);
    await advance();
    buttonByText(el, 'Ghim và tiếp tục')!.click();
    await advance();
    expect(calls(dev, 'device_pin').map((c) => c.args)).toEqual([{ id: k.id, fingerprint: FP1 }]);
    expect(app.session.state).toBe('login');
    expect(app.ui.dialog).toEqual({ kind: 'login' });
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('fingerprint của gói tìm khác kết quả dò: cảnh báo đỏ (chỉ ghim khi khớp với thiết bị)', async () => {
    const { app, dev, el } = await setup();
    const k = await addNamed(dev, 'BL335-01');
    vi.spyOn(dev, 'probe').mockResolvedValue({
      fingerprint: FP1,
      pinned: null,
      state: 'unpinned',
      discovered: 'b'.repeat(64),
    });
    app.session.goOnline(k);
    await advance();
    const alert = el.querySelector('.dlg-b [role="alert"]');
    expect(textOf(alert)).toContain('khác fingerprint thiết bị gửi trong gói tìm (BB BB BB BB…)');
    expect(alert?.classList.contains('err')).toBe(true);
  });

  it('không khớp: hiện fingerprint cũ và mới, nói rõ nguy cơ; gỡ ghim chỉ khi xác nhận rõ; rồi xác nhận lại', async () => {
    const { app, dev, el } = await setup();
    const k = await pinnedDevice(dev, 'BL335-01');
    const g = dev.control.rotateCert('BL335-01');
    app.session.goOnline(k);
    await advance();
    expect(app.session.error).toBe('cert-mismatch');
    expect(app.ui.dialog).toEqual({ kind: 'pin' });
    expect(textOf(el.querySelector('.dlg-h'))).toContain('Chứng chỉ đã đổi · BL335-01');
    expect(textOf(el.querySelector('[role="alert"]'))).toContain('Studio đã chặn kết nối');
    expect(textOf(el.querySelector('.dlg-b'))).toContain('giả làm thiết bị');
    const fps = [...el.querySelectorAll('.fp')].map((f) =>
      f.textContent!.replace(/\s/g, '').toLowerCase(),
    );
    expect(fps).toEqual([FP1, g]);
    expect(textOf(el.querySelector('.dlg-b'))).toContain('Fingerprint đã ghim');
    expect(textOf(el.querySelector('.dlg-b'))).toContain('Fingerprint thiết bị gửi bây giờ');
    // An toàn mặc định: focus ở Đóng, gỡ ghim khóa tới khi đánh dấu đã kiểm trên thiết bị.
    expect(document.activeElement?.textContent).toContain('Đóng');
    const unpin = buttonByText(el, 'Gỡ ghim và xác nhận lại')!;
    expect(unpin.disabled).toBe(true);
    unpin.click();
    await advance();
    expect(calls(dev, 'device_unpin')).toHaveLength(0);
    const check = el.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    check.click();
    await settled();
    expect(buttonByText(el, 'Gỡ ghim và xác nhận lại')!.disabled).toBe(false);
    buttonByText(el, 'Gỡ ghim và xác nhận lại')!.click();
    await advance();
    expect(calls(dev, 'device_unpin').map((c) => c.args)).toEqual([{ id: k.id, fingerprint: FP1 }]);
    expect(app.session.state).toBe('pin-confirm');
    expect(el.querySelector('.fp')!.textContent!.replace(/\s/g, '').toLowerCase()).toBe(g);
    expect(textOf(el.querySelector('.dlg-h'))).toContain('Xác nhận chứng chỉ');
  });

  it('Đóng khi không khớp: không gỡ ghim; phiên giữ lý do (thanh trạng thái báo)', async () => {
    const { app, dev, el } = await setup();
    const k = await pinnedDevice(dev, 'BL335-01');
    dev.control.rotateCert('BL335-01');
    app.session.goOnline(k);
    await advance();
    buttonByText(el, 'Đóng')!.click();
    await advance();
    expect(app.ui.dialog).toBeNull();
    expect(app.session.state).toBe('error');
    expect(app.session.error).toBe('cert-mismatch');
    expect(calls(dev, 'device_unpin')).toHaveLength(0);
  });
});
