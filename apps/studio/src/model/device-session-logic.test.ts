// Lệnh logic của phiên thiết bị (feature 011, T145; FR-083, FR-096; contracts/device-api-011.md §4): `GET /api/v1/logic`
// (trạng thái từng khối), `POST /api/v1/logic/writes {"enabled": false}` (administrator, không có đường bật lại),
// `POST /api/v1/logic/reset` (engineer). Đi qua DeviceLink (Rust giữ phiên và ghim TLS); thử trên thiết bị giả.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDeviceError, type KnownDevice } from '../platform/device-types.ts';
import { createMockDevice, type MockDevice } from '../platform/mock-device.ts';
import { monitorFetch, monitorSocket } from './device-adapters.ts';
import { deviceSupport, parseLogicStatus } from './device.ts';
import { DeviceSession } from './device-session.ts';

const PW = `thu-${randomUUID()}`;
const settle = (ms = 60) => vi.advanceTimersByTimeAsync(ms);

function setup(runtime = '1.0.0') {
  const dev: MockDevice = createMockDevice({ latency: false });
  for (const u of ['kysu1', 'xem1', 'admin']) dev.control.setPassword(u, `${PW}-${u}`);
  dev.control.setRuntime('BL335-01', runtime);
  dev.control.setLogic('BL335-01', {
    writes: 'on',
    blocks: [
      { id: 'pump_low_level', kind: 'rule', state: 'OK', fired: 14, reason: null },
      { id: 'valve_follow', kind: 'rule', state: 'SUSPENDED', reason: 'INPUT_BAD' },
      { id: 'h_pump', kind: 'runhours', state: 'OK', outputs: { 'LOGIC.PUMP01.HOURS': 123.456 } },
    ],
  });
  const session = new DeviceSession({
    link: dev,
    createSocket: monitorSocket(dev),
    fetch: monitorFetch(dev),
    random: () => 1,
  });
  session.setTags(['TANK01.LEVEL']);
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

async function toOnline(o: ReturnType<typeof setup>, user = 'kysu1') {
  const k = await pinned(o.dev);
  o.session.goOnline(k);
  await settle();
  await o.session.login(user, `${PW}-${user}`);
  await settle(300);
  expect(o.session.state).toBe('monitoring');
  return k;
}

describe('DeviceSession: logic của thiết bị', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('system/info.logic: runtime 1.0 có khối logic (writes on/off/stopped); chip đọc qua deviceSupport', async () => {
    const o = setup();
    await toOnline(o);
    expect(deviceSupport(o.session.info)).toMatchObject({ logic: true, logicWrites: 'on' });
  });

  it('GET /logic: trạng thái từng khối, ghi PLC, vòng quét', async () => {
    const o = setup();
    await toOnline(o);
    const s = await o.session.logicStatus();
    expect(isDeviceError(s)).toBe(false);
    if (isDeviceError(s)) return;
    expect(s.enabled).toBe(true);
    expect(s.writes).toEqual({
      configured: 'on',
      runtimeEnabled: true,
      perMinute: 0,
      limitPerMinute: 20,
    });
    expect(s.scan.periodMs).toBe(100);
    expect(s.blocks.get('valve_follow')).toMatchObject({ state: 'SUSPENDED', reason: 'INPUT_BAD' });
    expect(s.blocks.get('h_pump')?.outputs).toEqual({ 'LOGIC.PUMP01.HOURS': 123.456 });
    expect(o.dev.control.calls.some((c) => c.cmd === 'logic_get')).toBe(true);
  });

  it('Dừng ghi của logic: engineer bị từ chối; administrator dừng ngay, giữ trạng thái, chip thành "dừng"', async () => {
    const o = setup();
    await toOnline(o);
    expect(await o.session.stopLogicWrites()).toEqual({ error: 'forbidden' });
    await o.session.logout();

    const a = setup();
    await toOnline(a, 'admin');
    const r = await a.session.stopLogicWrites();
    expect(isDeviceError(r)).toBe(false);
    // Chỉ có đường dừng: thân luôn là {"enabled": false}.
    const posted = a.dev.control.calls.filter((c) => c.cmd === 'logic_writes_stop');
    expect(posted).toHaveLength(1);
    await settle(5100);
    expect(deviceSupport(a.session.info).logicWrites).toBe('stopped');
    const s = await a.session.logicStatus();
    expect(isDeviceError(s) ? null : s.writes.runtimeEnabled).toBe(false);
    expect(a.dev.control.logicAudit('BL335-01')).toEqual(['logic.writes.disabled']);
  });

  it('Đặt lại khối (counter, totalizer, giờ chạy): engineer được, viewer bị từ chối', async () => {
    const o = setup();
    await toOnline(o);
    const r = await o.session.resetLogicBlock('h_pump', 0);
    expect(isDeviceError(r)).toBe(false);
    expect(o.dev.control.logicAudit('BL335-01')).toEqual(['logic.reset']);
    await o.session.logout();
    const v = setup();
    await toOnline(v, 'xem1');
    expect(await v.session.resetLogicBlock('h_pump', 0)).toEqual({ error: 'forbidden' });
  });

  it('thiết bị cũ (không có logic): GET /logic trả lỗi http 404, Studio coi là chưa hỗ trợ', async () => {
    const o = setup('0.9.0');
    await toOnline(o);
    expect(deviceSupport(o.session.info).logic).toBe(false);
    expect(await o.session.logicStatus()).toEqual({ error: 'http', detail: 404 });
  });

  it('parseLogicStatus: không có logic.json thì {"enabled": false}; thân hỏng thì lỗi bad-response', () => {
    expect(parseLogicStatus({ enabled: false })).toMatchObject({ enabled: false });
    expect(parseLogicStatus('x')).toEqual({ error: 'bad-response' });
    const s = parseLogicStatus({
      enabled: true,
      writes: { configured: 'off', runtimeEnabled: false, perMinute: 0, limitPerMinute: 20 },
      scan: { periodMs: 100, lastMs: 1.8, p99Ms: 3.1 },
      blocks: [{ id: 'a', kind: 'rule', state: 'LẠ' }, { kind: 'rule' }],
    });
    expect('blocks' in s ? [...s.blocks.values()] : null).toEqual([
      { id: 'a', kind: 'rule', state: 'UNKNOWN', reason: null },
    ]);
  });
});
