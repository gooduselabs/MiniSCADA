// @vitest-environment jsdom
// Thanh trạng thái, phần 006 (T117, T118, FR-055a, ADR-018): cảnh báo màu hổ phách "Trang xem đang mở cho mọi nguồn" khi
// `viewerAccess = any`; theo dõi theo địa chỉ bị lọc nguồn nói "hãy Online (đăng nhập)".
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../app/app.ts';
import { newOnlineApp, pinnedDevice } from './online-test-helpers.ts';
import './mat-statusbar.ts';
import type { MatStatusbar } from './mat-statusbar.ts';
import { cleanup, mount, settled } from './test-helpers.ts';

const apps: StudioApp[] = [];

async function setup() {
  vi.useFakeTimers();
  const env = await newOnlineApp();
  apps.push(env.app);
  env.dev.control.setRuntime('BL335-01', '0.5.0');
  const bar = await mount<MatStatusbar>('mat-statusbar', env.app);
  env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
  await vi.advanceTimersByTimeAsync(60);
  await env.app.login('kysu1', env.pw('kysu1'));
  await vi.advanceTimersByTimeAsync(300);
  await settled(bar);
  return { ...env, bar, text: () => bar.textContent!.replace(/\s+/g, ' ') };
}

describe('thanh trạng thái: lọc nguồn của trang xem', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('viewerAccess = any: cảnh báo hổ phách (kèm icon), mất khi trả về private', async () => {
    const { dev, bar, text } = await setup();
    expect(text()).not.toContain('Trang xem đang mở cho mọi nguồn');
    dev.control.setViewerAccess('BL335-01', 'any');
    await vi.advanceTimersByTimeAsync(5200);
    await settled(bar);
    expect(text()).toContain('Trang xem đang mở cho mọi nguồn');
    const warn = bar.querySelector('.sb-viewer')!;
    expect(warn.querySelector('svg.warn')).not.toBeNull();
    expect(warn.getAttribute('role')).toBe('status');
    dev.control.setViewerAccess('BL335-01', 'private');
    await vi.advanceTimersByTimeAsync(5200);
    await settled(bar);
    expect(text()).not.toContain('Trang xem đang mở cho mọi nguồn');
  });

  // T052 (feature 011, FR-036): mỗi cảnh báo mới một chip (màu theo mức, icon, chữ), title là hướng dẫn
  // hành động, bấm mở trang Thiết bị; mất khi thiết bị thôi báo.
  it('cảnh báo 011: chip HOST_CHECK_OFF, PULSE_STUCK… kèm hướng dẫn; bấm mở trang Thiết bị', async () => {
    const { app, dev, bar, text } = await setup();
    dev.control.setWarnings('BL335-01', [
      { code: 'HOST_CHECK_OFF' },
      { code: 'PULSE_STUCK', detail: { tags: ['RUN_CMD'] } },
      { code: 'LOGIC_WRITES_STOPPED' },
    ]);
    await vi.advanceTimersByTimeAsync(5200);
    await settled(bar);
    const chips = [...bar.querySelectorAll<HTMLElement>('[data-role="devwarn"]')];
    expect(chips.map((c) => c.dataset.code)).toEqual([
      'HOST_CHECK_OFF',
      'PULSE_STUCK',
      'LOGIC_WRITES_STOPPED',
    ]);
    expect(chips[1]!.classList.contains('err')).toBe(true);
    expect(chips[0]!.querySelector('svg')).not.toBeNull();
    expect(chips[0]!.title).toContain('hostCheck');
    expect(chips[1]!.title).toContain('RUN_CMD');
    expect(text()).toContain('Xung kẹt');
    const run = vi.spyOn(app, 'run');
    chips[0]!.click();
    expect(run).toHaveBeenCalledWith('online.device');
    dev.control.setWarnings('BL335-01', []);
    await vi.advanceTimersByTimeAsync(5200);
    await settled(bar);
    expect(bar.querySelectorAll('[data-role="devwarn"]')).toHaveLength(0);
  });

  it('theo dõi theo địa chỉ bị lọc nguồn: lỗi nói hãy Online (đăng nhập)', async () => {
    const { app, dev, bar, text } = await setup();
    app.session.disconnect();
    const f = dev.control.device('BL335-01');
    dev.control.setViewerBlock('BL335-01', 'viewer-private');
    app.setDeviceAddress(`${f.ip}:${f.httpPort}`);
    app.monitorAddress();
    await vi.advanceTimersByTimeAsync(300);
    await settled(bar);
    expect(text()).toContain('hãy Online (đăng nhập)');
  });
});
