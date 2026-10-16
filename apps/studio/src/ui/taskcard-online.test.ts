// Task card Công cụ online (feature 004, T074, FR-031, FR-033, mockup bản 1): chưa theo dõi thì mời kết
// nối; đang theo dõi thì tóm tắt thiết bị (runtime, client x/10, project), Mở web thiết bị, nút ghi xuống
// thiết bị bị khóa ("Có ở feature 005").
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../app/app.ts';
import { flush, newDeviceApp, toMonitoring } from './device-test-helpers.ts';
import './mat-taskcards.ts';
import type { MatTaskcards } from './mat-taskcards.ts';
import { cleanup, mount, settled } from './test-helpers.ts';

const apps: StudioApp[] = [];

async function setup() {
  const env = await newDeviceApp();
  apps.push(env.app);
  env.app.setTaskCard('online');
  const card = await mount<MatTaskcards>('mat-taskcards', env.app);
  const body = () => card.querySelector('.tc-body')!;
  const text = () => body().textContent!.replace(/\s+/g, ' ');
  return { ...env, card, body, text };
}

const button = (root: Element, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(text),
  )!;

describe('task card Công cụ online', () => {
  afterEach(() => {
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('chưa theo dõi: mời kết nối theo dõi', async () => {
    const { body, text } = await setup();
    expect(text()).toContain('Chưa kết nối thiết bị');
    expect(button(body(), 'Kết nối theo dõi')).toBeDefined();
  });

  it('đang theo dõi: tóm tắt thiết bị, Mở web, ghi xuống thiết bị bị khóa', async () => {
    const { app, device, platform, card, body, text } = await setup();
    await toMonitoring(app, device);
    await settled(card);
    for (const s of ['BL335', '192.168.1.110:8080', '0.3.0', '3 / 10', 'tank-demo 0.1.0'])
      expect(text(), s).toContain(s);
    expect(body().querySelector('.metric .bar i')).not.toBeNull();

    const open = vi.spyOn(platform, 'openDeviceWeb');
    button(body(), 'Mở web thiết bị').click();
    await flush();
    expect(open).toHaveBeenCalledWith('https://192.168.1.110:8443/'); // feature 011: HTTPS

    // Theo dõi chỉ đọc chưa đăng nhập: nút Nạp xuống khóa, nói lý do (feature 005, US2).
    const write = button(body(), 'Nạp project xuống thiết bị');
    expect(write.getAttribute('aria-disabled')).toBe('true');
    expect(write.title).toBe('Cần Online và đăng nhập thiết bị');
    write.click();
    expect(app.ui.toast?.text).toBe('Nạp xuống…: Cần Online và đăng nhập thiết bị');
  });

  it('mất kết nối: báo trong thẻ, vẫn giữ tóm tắt cuối', async () => {
    const { app, device, card, text } = await setup();
    await toMonitoring(app, device);
    device.last().serverClose(1006);
    await flush();
    await settled(card);
    expect(text()).toContain('Mất kết nối');
    expect(text()).toContain('0.3.0');
  });
});
