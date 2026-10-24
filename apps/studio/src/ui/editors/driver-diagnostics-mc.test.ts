// Chẩn đoán driver với kênh Mitsubishi MC (feature 017, US4, contracts/mc-protocol.md §4): loại kênh "Mitsubishi MC"; bộ đếm
// `exceptions` của thiết bị MC là end code (số thập phân trong JSON) nên hiện hex kèm nghĩa ngắn; Modbus giữ "Exception 02";
// lý do quality MC_END_* của Tag xấu bằng tiếng Việt.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { channelKindOf, exceptionLabel, parseDriverDiag } from '../../model/driver-diag.ts';
import { full02 } from '../../model/test-fixtures.ts';
import type { DiagChannel } from '../../platform/mock-device-006.ts';
import { newOnlineApp, pinnedDevice } from '../online-test-helpers.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';
import './driver-diagnostics.ts';
import type { DriverDiagnostics } from './driver-diagnostics.ts';

const apps: StudioApp[] = [];

const device = (id: string, exceptions: Record<string, number>) => ({
  id,
  name: id.toUpperCase(),
  state: 'active',
  requestsOk: 100,
  timeouts: 0,
  exceptions,
  badFrames: { crc: 0, format: 0, tid: 0, unit: 0, length: 0, echo: 0 },
  responseMs: { avg: 12, max: 30 },
  groups: [],
  writes: { confirmed: 0, failed: 0, timeout: 0, rejected: 0 },
});

const CHANNELS = [
  {
    id: 'plc-mc',
    name: 'PLC Mitsubishi',
    kind: 'mc',
    state: 'connected',
    lastError: null,
    reconnects: 0,
    warnings: [],
    devices: [device('fx5u', { C056: 3, C05C: 1 })],
  },
  {
    id: 'plc1',
    name: 'PLC trạm bơm',
    kind: 'modbus-tcp',
    state: 'connected',
    lastError: null,
    reconnects: 0,
    warnings: [],
    devices: [device('plc1', { '02': 1 })],
  },
] as unknown as DiagChannel[];

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('nhãn bộ đếm end code (thuần)', () => {
  it('MC: hex kèm nghĩa; Modbus: Exception mã', () => {
    expect(exceptionLabel('C056', 'mc')).toBe('End code C056: địa chỉ hoặc số điểm ngoài vùng');
    expect(exceptionLabel('C05C', 'mc')).toBe('End code C05C: thiết bị không đọc/ghi được');
    expect(exceptionLabel('C050', 'mc')).toMatch(/^End code C050: lệnh/);
    expect(exceptionLabel('0001', 'mc')).toBe('End code 0001: lỗi khác của PLC');
    expect(exceptionLabel('02', 'modbus-tcp')).toBe('Exception 02');
  });

  it('loại kênh của thiết bị trong bản chẩn đoán', () => {
    const data = parseDriverDiag({ at: 1, channels: CHANNELS });
    expect(channelKindOf(data, 'fx5u')).toBe('mc');
    expect(channelKindOf(data, 'plc1')).toBe('modbus-tcp');
    expect(channelKindOf(data, 'nope')).toBe('');
    expect(channelKindOf(null, 'fx5u')).toBe('');
  });
});

describe('mat-driver-diagnostics: kênh MC', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('cây hiện loại "Mitsubishi MC"; số đếm end code hex C056, C05C; Tag xấu MC_END_RANGE bằng tiếng Việt', async () => {
    vi.useFakeTimers();
    const env = await newOnlineApp({ files: full02() });
    apps.push(env.app);
    env.dev.control.setRuntime('BL335-01', '0.5.0');
    env.dev.control.setDriverDiagnostics('BL335-01', {
      channels: structuredClone(CHANNELS),
      badTags: [
        { id: 'MC.D', quality: 'BAD', reason: 'MC_END_RANGE', detail: null, updatedAt: 1 },
      ] as never,
    });
    env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
    await vi.advanceTimersByTimeAsync(60);
    await env.app.login('kysu1', env.pw('kysu1'));
    await vi.advanceTimersByTimeAsync(300);
    env.app.openEditor('driverDiag');
    const el = await mount<DriverDiagnostics>('mat-driver-diagnostics', env.app);
    await vi.advanceTimersByTimeAsync(10);
    await settled(el);
    const items = [...el.querySelectorAll('[role="treeitem"]')];
    expect(text(items[0]!.querySelector('.dd-kind'))).toBe('Mitsubishi MC');
    expect(text(el.querySelector('tr[data-row="exception:C056"]'))).toContain(
      'End code C056: địa chỉ hoặc số điểm ngoài vùng',
    );
    expect(text(el.querySelector('tr[data-row="exception:C05C"] td'))).toBe(
      'End code C05C: thiết bị không đọc/ghi được',
    );
    expect(text(el.querySelector('[data-role="bad-tags"]'))).toContain(
      'PLC báo địa chỉ hoặc số điểm ngoài vùng',
    );
  });
});
