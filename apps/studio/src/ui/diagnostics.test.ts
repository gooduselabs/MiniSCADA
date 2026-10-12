// Tab Chẩn đoán (feature 004, T072, FR-029, US3-8, Edge Cases): runtime và giao thức, phiên/tối đa,
// project trên thiết bị, lưu trữ (trạng thái, số dòng, dung lượng), từng DB ngoài (trạng thái, số dòng chờ,
// độ trễ, lỗi gần nhất); CPU, RAM "chưa có"; làm mới theo system/info mỗi 5 s; chưa theo dõi thì như cũ.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../app/app.ts';
import { DEVICE_INFO, flush, newDeviceApp, toMonitoring } from './device-test-helpers.ts';
import './diagnostics.ts';
import './mat-inspector.ts';
import type { MatInspector } from './mat-inspector.ts';
import { cleanup, mount, settled } from './test-helpers.ts';

const apps: StudioApp[] = [];

async function setup() {
  const env = await newDeviceApp();
  apps.push(env.app);
  env.app.setInspectorTab('diag');
  const insp = await mount<MatInspector>('mat-inspector', env.app);
  const text = () => insp.querySelector('.insp-body')!.textContent!.replace(/\s+/g, ' ');
  const ctx = () => insp.querySelector('.insp-ctx')!.textContent!;
  return { ...env, insp, text, ctx };
}

/** Thẻ số liệu theo nhãn: chữ của giá trị và ghi chú. */
function metric(insp: Element, label: string): string {
  const card = [...insp.querySelectorAll('.metric')].find(
    (m) => m.querySelector('.l')?.textContent?.trim() === label,
  );
  return card ? card.textContent!.replace(/\s+/g, ' ').trim() : `(không có thẻ "${label}")`;
}

describe('tab Chẩn đoán', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('chưa theo dõi: như cũ, có nút Kết nối theo dõi', async () => {
    const { insp, text, ctx } = await setup();
    expect(text()).toContain('Chưa kết nối thiết bị');
    expect(insp.querySelector('.insp-body button')?.textContent).toContain('Kết nối theo dõi');
    expect(ctx()).toBe('Không kết nối');
  });

  it('kết nối lỗi: nói rõ lý do', async () => {
    const { app, device, insp, text } = await setup();
    device.mode = 'fail';
    app.setDeviceAddress('192.168.1.110');
    await app.run('online.connect');
    await flush();
    await settled(insp);
    expect(app.session.state).toBe('error');
    expect(text()).toContain('không tới được thiết bị');
  });

  it('đang theo dõi: runtime, giao thức, phiên/tối đa, project, lưu trữ, từng DB ngoài', async () => {
    const { app, device, insp, ctx } = await setup();
    await toMonitoring(app, device);
    await settled(insp);
    expect(metric(insp, 'Runtime')).toContain('0.3.0');
    expect(metric(insp, 'Runtime')).toContain('giao thức 1.0.0');
    expect(metric(insp, 'Phiên dữ liệu sống')).toContain('3 / 10');
    expect(metric(insp, 'Project trên thiết bị')).toContain(
      'tank-demo 0.1.0, cùng phiên bản với máy này',
    );
    expect(metric(insp, 'Thời gian chạy runtime')).toContain('3 ngày 4 giờ');
    expect(metric(insp, 'CPU')).toContain('chưa có');
    expect(metric(insp, 'RAM')).toContain('chưa có');
    const storage = metric(insp, 'Lưu trữ trên thiết bị');
    expect(storage).toContain('đang ghi');
    expect(storage).toContain('15.234 dòng');
    expect(storage).toContain('12,0 MB / 2,0 GB');
    const ok = metric(insp, 'DB ngoài mysql-office');
    expect(ok).toContain('đang gửi');
    expect(ok).toContain('chờ 0 dòng · trễ 0 s');
    const bad = metric(insp, 'DB ngoài influx');
    expect(bad).toContain('lỗi');
    expect(bad).toContain('chờ 1.834 dòng · trễ 1.830 s');
    expect(bad).toContain('connect refused');
    expect(ctx()).toContain('BL335');
    expect(ctx()).toContain('mỗi 5 s');
  });

  it('thiết bị không báo khối lưu trữ, không có thời gian chạy: ghi rõ, không lỗi', async () => {
    const { app, device, insp } = await setup();
    const old = { ...DEVICE_INFO };
    delete old.historian;
    delete old.uptimeS;
    device.info = old;
    await toMonitoring(app, device);
    await settled(insp);
    expect(metric(insp, 'Lưu trữ trên thiết bị')).toContain(
      'thiết bị không báo trạng thái lưu trữ',
    );
    expect(metric(insp, 'Thời gian chạy runtime')).toContain('chưa có');
    expect(insp.querySelectorAll('.metric .l')).not.toHaveLength(0);
  });

  it('project không lưu dữ liệu: "không lưu trữ"', async () => {
    const { app, device, insp } = await setup();
    device.info = { ...DEVICE_INFO, historian: { enabled: false } };
    await toMonitoring(app, device);
    await settled(insp);
    expect(metric(insp, 'Lưu trữ trên thiết bị')).toContain('không lưu trữ');
  });

  it('làm mới theo system/info mỗi 5 s', async () => {
    vi.useFakeTimers();
    const { app, device, insp } = await setup();
    await toMonitoring(app, device);
    await settled(insp);
    expect(metric(insp, 'Phiên dữ liệu sống')).toContain('3 / 10');
    device.info = { ...DEVICE_INFO, clients: 4 };
    await vi.advanceTimersByTimeAsync(5000);
    await flush();
    await settled(insp);
    expect(metric(insp, 'Phiên dữ liệu sống')).toContain('4 / 10');
  });

  it('thiết bị đầy: nói đúng lý do, không nói Studio đang chiếm phiên', async () => {
    const { app, device, insp, ctx } = await setup();
    app.setDeviceAddress('192.168.1.110');
    await app.run('online.connect');
    await flush();
    device.last().msg({ type: 'error', code: 'MAX_CLIENTS_REACHED', message: 'full' });
    device.last().serverClose(4429);
    await flush();
    await settled(insp);
    expect(app.session.state).toBe('full');
    expect(ctx()).toContain('thiết bị đã đủ số phiên');
    expect(metric(insp, 'Phiên dữ liệu sống')).not.toContain('Studio chiếm 1 phiên');
  });

  it('mất kết nối: giữ số liệu cuối và nói rõ là số liệu cũ', async () => {
    const { app, device, insp, ctx } = await setup();
    await toMonitoring(app, device);
    device.last().serverClose(1006);
    await flush();
    await settled(insp);
    expect(app.session.state).toBe('lost');
    expect(metric(insp, 'Runtime')).toContain('0.3.0');
    expect(ctx()).toContain('đang mất kết nối');
  });
});
