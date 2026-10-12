// Tab Chẩn đoán đầy đủ (feature 005, US4, T147, FR-032; device-api §6): khi Online có đăng nhập, tab hiện CPU (trung
// bình 1 phút), RAM của runtime và của hệ thống, dung lượng trống, thời gian chạy, số client, độ lệch giờ so với máy
// kỹ sư; GET /api/v1/diagnostics hỏi mỗi 5 s và chỉ khi tab đang mở. Chạy trên DeviceLink giả, đồng hồ giả.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../app/app.ts';
import './diagnostics.ts';
import './mat-inspector.ts';
import type { MatInspector } from './mat-inspector.ts';
import { newOnlineApp, pinnedDevice } from './online-test-helpers.ts';
import { cleanup, mount, settled } from './test-helpers.ts';

const apps: StudioApp[] = [];

/** Thẻ số liệu theo nhãn: chữ của giá trị và ghi chú. */
function metric(insp: Element, label: string): string {
  const card = [...insp.querySelectorAll('.metric')].find(
    (m) => m.querySelector('.l')?.textContent?.trim() === label,
  );
  return card ? card.textContent!.replace(/\s+/g, ' ').trim() : `(không có thẻ "${label}")`;
}

async function online(user = 'kysu1') {
  vi.useFakeTimers();
  const env = await newOnlineApp();
  apps.push(env.app);
  env.app.setInspectorTab('diag');
  const insp = await mount<MatInspector>('mat-inspector', env.app);
  env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
  await vi.advanceTimersByTimeAsync(50);
  await env.app.login(user, env.pw(user));
  await vi.advanceTimersByTimeAsync(400);
  await settled(insp);
  const polls = () =>
    env.dev.control.calls.filter(
      (c) => c.cmd === 'device_get' && (c.args as { path?: string }).path === '/api/v1/diagnostics',
    ).length;
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await settled(insp);
  };
  return { ...env, insp, polls, advance };
}

describe('tab Chẩn đoán đầy đủ khi Online (feature 005, FR-032)', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('hiện CPU (trung bình 1 phút), RAM runtime và hệ thống, dung lượng trống, thời gian chạy, số client', async () => {
    const { insp } = await online();
    const cpu = metric(insp, 'CPU');
    expect(cpu).toContain('11,7 % hệ thống');
    expect(cpu).toContain('4,2 % runtime');
    expect(cpu).toContain('trung bình 1 phút');
    expect(cpu).toContain('2 lõi');
    expect(metric(insp, 'RAM runtime')).toContain('9,4 MB');
    const ram = metric(insp, 'RAM hệ thống');
    expect(ram).toContain('993,0 MB');
    expect(ram).toContain('còn 867,0 MB');
    const disk = metric(insp, 'Dung lượng trống');
    expect(disk).toContain('6,1 GB / 6,8 GB');
    expect(disk).toContain('/var/lib/mat-runtime');
    expect(metric(insp, 'Thời gian chạy runtime')).toContain('1 giờ 0 phút');
    expect(metric(insp, 'Thời gian chạy runtime')).toContain('hệ thống 3 ngày');
    expect(metric(insp, 'Phiên đăng nhập')).toContain('1');
    expect(metric(insp, 'Phiên dữ liệu sống')).toContain('/ 10');
  });

  it('độ lệch giờ so với máy kỹ sư; giờ thiết bị chưa đồng bộ thì cảnh báo', async () => {
    const { insp, dev, advance } = await online();
    expect(metric(insp, 'Giờ thiết bị')).toContain('lệch');
    dev.control.setDiagnostics('BL335-01', { skewMs: 3200, timeSynced: false });
    await advance(5100);
    const clock = metric(insp, 'Giờ thiết bị');
    expect(clock).toContain('+3,2 s');
    expect(clock).toContain('chưa đồng bộ');
  });

  it('hỏi mỗi 5 s khi tab đang mở, dừng khi đổi sang tab khác, hỏi lại khi mở lại', async () => {
    const { app, polls, advance } = await online();
    const first = polls();
    expect(first).toBeGreaterThanOrEqual(1);
    await advance(5000);
    expect(polls()).toBe(first + 1);
    await advance(10_000);
    expect(polls()).toBe(first + 3);
    app.setInspectorTab('props');
    await advance(30_000);
    expect(polls()).toBe(first + 3); // tab đóng: không hỏi
    app.setInspectorTab('diag');
    await advance(50);
    expect(polls()).toBe(first + 4); // mở lại: hỏi ngay
    await advance(5000);
    expect(polls()).toBe(first + 5);
  });

  it('đã Offline thì không hỏi', async () => {
    const { app, polls, advance } = await online();
    app.session.disconnect();
    await advance(100);
    const n = polls();
    await advance(20_000);
    expect(polls()).toBe(n);
  });

  it('khối của 006: trang xem (viewer), Tag tốt/xấu, giữ qua mất điện (device-api-1.1 §2, FR-051)', async () => {
    const { insp, dev, advance } = await online();
    dev.control.setRuntime('BL335-01', '0.5.0');
    dev.control.setDiagnostics('BL335-01', {
      viewer: {
        access: 'private',
        blockedTotal: 17,
        lastBlockedAt: Date.UTC(2026, 9, 20, 3, 12, 5),
      },
      tags: { total: 812, good: 790, uncertain: 2, bad: 20 },
      retain: { state: 'ok', tags: 12, lastSaveAt: Date.UTC(2026, 9, 20, 3, 0, 0), saves: 341 },
    });
    await advance(5100);
    const viewer = metric(insp, 'Trang xem');
    expect(viewer).toContain('Riêng tư');
    expect(viewer).toContain('đã chặn 17 lượt');
    const tags = metric(insp, 'Tag');
    expect(tags).toContain('812');
    expect(tags).toContain('tốt 790');
    expect(tags).toContain('không chắc 2');
    expect(tags).toContain('xấu 20');
    const retain = metric(insp, 'Giữ qua mất điện');
    expect(retain).toContain('Bình thường');
    expect(retain).toContain('12 Tag');
    expect(retain).toContain('341 lần');
  });

  it('trang xem mở cho mọi nguồn và giữ qua mất điện hỏng: cảnh báo kèm chữ, không chỉ màu', async () => {
    const { insp, dev, advance } = await online();
    dev.control.setRuntime('BL335-01', '0.5.0');
    dev.control.setDiagnostics('BL335-01', {
      viewer: { access: 'any', blockedTotal: 0, lastBlockedAt: null },
      retain: { state: 'lost', tags: 3, lastSaveAt: null, saves: 0 },
    });
    await advance(5100);
    const viewer = [...insp.querySelectorAll('.metric')].find(
      (m) => m.querySelector('.l')?.textContent?.trim() === 'Trang xem',
    )!;
    expect(viewer.textContent).toContain('Mở cho mọi nguồn');
    expect(viewer.querySelector('svg.warn')).not.toBeNull();
    const retain = [...insp.querySelectorAll('.metric')].find(
      (m) => m.querySelector('.l')?.textContent?.trim() === 'Giữ qua mất điện',
    )!;
    expect(retain.textContent).toContain('Tag về giá trị đầu');
    expect(retain.querySelector('svg.err, svg.warn')).not.toBeNull();
  });

  it('thiết bị chưa có các khối (runtime cũ): không hiện thẻ', async () => {
    const { insp } = await online();
    expect(metric(insp, 'Trang xem')).toContain('không có thẻ');
    expect(metric(insp, 'Giữ qua mất điện')).toContain('không có thẻ');
  });

  it('viewer cũng xem được chẩn đoán (device-api §6)', async () => {
    const { insp } = await online('xem1');
    expect(metric(insp, 'CPU')).toContain('11,7 % hệ thống');
  });

  it('lỗi khi hỏi: giữ số liệu cũ và nói lý do', async () => {
    const { insp, dev, advance } = await online();
    dev.control.setDiagnostics('BL335-01', { fail: 'unreachable' });
    await advance(5100);
    expect(metric(insp, 'CPU')).toContain('11,7 % hệ thống');
    expect(insp.querySelector('.insp-body')!.textContent).toContain('không hỏi được chẩn đoán');
  });
});
