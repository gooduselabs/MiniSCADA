// Phiên thiết bị với giao thức live 1.2.0 (feature 006, T117, FR-055a, live-protocol-1.2 §1–§3): `reason` của quality;
// 4401 (phiên đã dùng để mở kết nối hết hạn) → `relogin` như SESSION_EXPIRED rồi mở lại live sau khi đăng nhập;
// theo dõi theo địa chỉ từ ngoài mạng riêng nhận `viewer-private` → báo "hãy Online (đăng nhập)"; `viewerAccess = any`
// → cờ cảnh báo.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDeviceError, type KnownDevice } from '../platform/device-types.ts';
import { createMockDevice, type MockDevice } from '../platform/mock-device.ts';
import { monitorFetch, monitorSocket } from './device-adapters.ts';
import { DeviceSession } from './device-session.ts';

const PW = `thu-${randomUUID()}`;
const TAGS = ['TANK01.LEVEL', 'MOTOR01.RUN'];
const settle = (ms = 60) => vi.advanceTimersByTimeAsync(ms);

function setup() {
  const dev: MockDevice = createMockDevice({ latency: false });
  for (const u of ['kysu1', 'xem1', 'admin']) dev.control.setPassword(u, `${PW}-${u}`);
  dev.control.setRuntime('BL335-01', '0.5.0');
  const session = new DeviceSession({
    link: dev,
    createSocket: monitorSocket(dev),
    fetch: monitorFetch(dev),
    random: () => 1,
  });
  session.setTags(TAGS);
  return { dev, session };
}

async function pinned(dev: MockDevice): Promise<KnownDevice> {
  const k = await dev.addDevice({ host: dev.control.device('BL335-01').ip });
  if (isDeviceError(k)) throw new Error(k.error);
  const p = await dev.probe(k.id);
  if (isDeviceError(p)) throw new Error(p.error);
  const r = await dev.pin(k.id, p.fingerprint);
  if (isDeviceError(r)) throw new Error(r.error);
  return r;
}

async function toOnline(o: ReturnType<typeof setup>) {
  const k = await pinned(o.dev);
  o.session.goOnline(k);
  await settle();
  await o.session.login('kysu1', `${PW}-kysu1`);
  await settle(300);
  expect(o.session.state).toBe('monitoring');
  return k;
}

describe('DeviceSession: live 1.2.0', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('giá trị sống mang reason khi quality khác GOOD; GOOD thì không có reason; đổi lý do cập nhật', async () => {
    const o = setup();
    await toOnline(o);
    expect(o.session.values.get('TANK01.LEVEL')).toMatchObject({ quality: 'GOOD' });
    expect(o.session.values.get('TANK01.LEVEL')?.reason).toBeUndefined();
    o.dev.control.setTag('BL335-01', 'TANK01.LEVEL', { value: 12.4, quality: 'BAD', reason: 'TIMEOUT' });
    await settle(600);
    expect(o.session.values.get('TANK01.LEVEL')).toMatchObject({ value: 12.4, quality: 'BAD', reason: 'TIMEOUT' });
    o.dev.control.setTag('BL335-01', 'TANK01.LEVEL', { value: 12.4, quality: 'BAD', reason: 'DISCONNECTED' });
    await settle(600);
    expect(o.session.values.get('TANK01.LEVEL')?.reason).toBe('DISCONNECTED');
    o.dev.control.setTag('BL335-01', 'TANK01.LEVEL', { value: 13, quality: 'GOOD' });
    await settle(600);
    expect(o.session.values.get('TANK01.LEVEL')?.reason).toBeUndefined();
  });

  it('mã lạ giữ nguyên trong reason (giao diện hiện "không rõ" kèm mã)', async () => {
    const o = setup();
    await toOnline(o);
    o.dev.control.setTag('BL335-01', 'MOTOR01.RUN', { value: true, quality: 'BAD', reason: 'MA_LA' });
    await settle(600);
    expect(o.session.values.get('MOTOR01.RUN')?.reason).toBe('MA_LA');
  });

  it('4401: về relogin như SESSION_EXPIRED, giá trị STALE; đăng nhập lại thì mở lại live và về monitoring', async () => {
    const o = setup();
    await toOnline(o);
    const states: string[] = [];
    o.session.subscribe((e) => e.type === 'state' && states.push(e.state));
    o.dev.control.endSession('BL335-01');
    await settle(50);
    expect(o.session.state).toBe('relogin');
    expect(o.session.values.get('TANK01.LEVEL')?.quality).toBe('STALE');
    // Không tự kết nối lại bằng token cũ: không có live mới.
    const opensBefore = o.dev.control.calls.filter((c) => c.cmd === 'live_open').length;
    await settle(5000);
    expect(o.dev.control.calls.filter((c) => c.cmd === 'live_open').length).toBe(opensBefore);
    await o.session.login('kysu1', `${PW}-kysu1`);
    await settle(400);
    expect(o.session.state).toBe('monitoring');
    expect(o.dev.control.calls.filter((c) => c.cmd === 'live_open').length).toBe(opensBefore + 1);
    expect(o.session.values.get('TANK01.LEVEL')?.quality).toBe('GOOD');
    expect(states).toEqual(['relogin', 'connecting', 'monitoring']);
  });

  it('theo dõi theo địa chỉ bị lọc nguồn (viewer-private): lỗi nói hãy Online; viewer-off cũng vậy', async () => {
    const o = setup();
    const f = o.dev.control.device('BL335-01');
    o.dev.control.setViewerBlock('BL335-01', 'viewer-private');
    o.session.connect(`${f.ip}:${f.httpPort}`);
    await settle(200);
    expect(o.session.state).toBe('error');
    expect(o.session.error).toBe('viewer-private');
    o.session.disconnect();
    o.dev.control.setViewerBlock('BL335-01', null);
    o.dev.control.setViewerAccess('BL335-01', 'off');
    o.session.connect(`${f.ip}:${f.httpPort}`);
    await settle(200);
    expect(o.session.state).toBe('error');
    expect(o.session.error).toBe('viewer-private');
  });

  it('viewerAccess = any: cờ viewerPublic bật (cảnh báo VIEWER_PUBLIC); private thì tắt', async () => {
    const o = setup();
    await toOnline(o);
    expect(o.session.viewerPublic).toBe(false);
    o.dev.control.setViewerAccess('BL335-01', 'any');
    await settle(5200);
    expect(o.session.viewerPublic).toBe(true);
    o.dev.control.setViewerAccess('BL335-01', 'private');
    await settle(5200);
    expect(o.session.viewerPublic).toBe(false);
  });

  it('runtime 0.4: không có cờ viewerPublic, không có 4401', async () => {
    const o = setup();
    o.dev.control.setRuntime('BL335-01', '0.4.0');
    await toOnline(o);
    expect(o.session.viewerPublic).toBe(false);
  });
});
