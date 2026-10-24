// Chẩn đoán driver với kênh Siemens S7 (feature 016, US4): loại kênh "Siemens S7", PDU đã thương lượng và TSAP ở thông tin
// kênh, lỗi PLC theo tên S7 ("03 truy cập bị từ chối", "0A DB không có", "8104 chưa bật PUT/GET") thay cho exception Modbus.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import type { DiagChannel } from '../../platform/mock-device-006.ts';
import { full02 } from '../../model/test-fixtures.ts';
import { newOnlineApp, pinnedDevice } from '../online-test-helpers.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';
import './driver-diagnostics.ts';
import type { DriverDiagnostics } from './driver-diagnostics.ts';

const apps: StudioApp[] = [];

const CHANNELS = [
  {
    id: 's7-1',
    name: 'PLC S7-1200',
    kind: 's7',
    state: 'connected',
    lastError: { code: 'S7_FUNCTION_NOT_AVAILABLE', at: 1791601201000, device: 'cpu1' },
    reconnects: 0,
    warnings: [],
    details: { pduSize: '240', localTsap: '0100', remoteTsap: '0301' },
    devices: [
      {
        id: 'cpu1',
        name: 'CPU 1214C',
        state: 'active',
        requestsOk: 500,
        timeouts: 0,
        exceptions: { '03': 2, '0A': 1, '8104': 4 },
        badFrames: { crc: 0, format: 0, tid: 0, unit: 0, length: 0, echo: 0 },
        responseMs: { avg: 12, max: 30 },
        groups: [],
        writes: { confirmed: 0, failed: 0, timeout: 0, rejected: 0 },
      },
    ],
  },
  {
    id: 'plc1',
    name: 'PLC trạm bơm',
    kind: 'modbus-tcp',
    state: 'connected',
    lastError: null,
    reconnects: 0,
    warnings: [],
    devices: [
      {
        id: 'plc1',
        name: 'PLC 1',
        state: 'active',
        requestsOk: 1,
        timeouts: 0,
        exceptions: { '02': 1 },
        badFrames: { crc: 0, format: 0, tid: 0, unit: 0, length: 0, echo: 0 },
        responseMs: { avg: 1, max: 1 },
        groups: [],
        writes: { confirmed: 0, failed: 0, timeout: 0, rejected: 0 },
      },
    ],
  },
] as unknown as DiagChannel[];

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

async function setup() {
  vi.useFakeTimers();
  const env = await newOnlineApp({ files: full02() });
  apps.push(env.app);
  env.dev.control.setRuntime('BL335-01', '0.5.0');
  env.dev.control.setDriverDiagnostics('BL335-01', {
    channels: structuredClone(CHANNELS),
    badTags: [
      {
        id: 'S7.TEMP',
        quality: 'BAD',
        reason: 'S7_OBJECT_NOT_FOUND',
        detail: null,
        updatedAt: 1791601202000,
      },
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
  return { ...env, el };
}

describe('mat-driver-diagnostics: kênh Siemens S7', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('cây: kênh S7 có loại "Siemens S7"; số đếm của CPU dùng tên lỗi S7', async () => {
    const { el } = await setup();
    const items = [...el.querySelectorAll('[role="treeitem"]')];
    expect(text(items[0]!.querySelector('.dd-kind'))).toBe('Siemens S7');
    expect(items[1]!.getAttribute('aria-selected')).toBe('true');
    expect(text(el.querySelector('tr[data-row="exception:03"] td'))).toBe(
      'Lỗi PLC 03 truy cập bị từ chối',
    );
    expect(text(el.querySelector('tr[data-row="exception:0A"] td'))).toBe('Lỗi PLC 0A DB không có');
    expect(text(el.querySelector('tr[data-row="exception:8104"] td'))).toBe(
      'Lỗi PLC 8104 chưa bật PUT/GET',
    );
    expect(text(el.querySelector('tr[data-row="exception:03"] .dd-total'))).toBe('2');
    // Tag xấu: lý do S7 bằng tiếng Việt.
    expect(text(el.querySelector('tr[data-tag="S7.TEMP"]'))).toContain('DB không có trên PLC S7');
  });

  it('thông tin kênh S7: PDU đã thương lượng, TSAP nguồn và đích, lỗi gần nhất', async () => {
    const { el } = await setup();
    (el.querySelectorAll('[role="treeitem"]')[0] as HTMLElement).click();
    await settled(el);
    const info = text(el.querySelector('[data-role="channel-info"]'));
    expect(info).toContain('Siemens S7');
    expect(info).toContain('PDU đã thương lượng: 240 byte');
    expect(info).toContain('TSAP nguồn 0100 · đích 0301');
    expect(info).toContain('S7_FUNCTION_NOT_AVAILABLE');
  });

  it('kênh Modbus giữ nhãn Exception và không có dòng PDU', async () => {
    const { el } = await setup();
    const items = [...el.querySelectorAll('[role="treeitem"]')] as HTMLElement[];
    items[3]!.click();
    await settled(el);
    expect(text(el.querySelector('tr[data-row="exception:02"] td'))).toBe('Exception 02');
    items[2]!.click();
    await settled(el);
    expect(text(el.querySelector('[data-role="channel-info"]'))).not.toContain('PDU');
  });
});
