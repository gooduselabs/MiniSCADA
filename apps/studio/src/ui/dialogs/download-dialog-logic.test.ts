// Hộp thoại Nạp xuống với logic (feature 011, T132/T144; FR-082; mockup studio-logic.html cảnh 3; T007 quyết định 4, 5):
// dòng "Logic sẽ tự động ghi N Tag xuống PLC" kèm bảng (Tag thiết bị, mục writes, giá trị cho phép, tần suất, luật), chip
// trạng thái ghi PLC của thiết bị đích và lời nhắc theo trạng thái; Nạp xuống khóa tới khi tích "Tôi đã xem danh sách",
// kể cả khi thiết bị đang tắt ghi.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { newLogicOnlineApp } from '../logic/logic-test-helpers.ts';
import { pinnedDevice, textOf } from '../online-test-helpers.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';
import './download-dialog.ts';
import type { MatDownloadDialog } from './download-dialog.ts';

const apps: StudioApp[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const a of apps.splice(0)) a.session.disconnect();
  cleanup();
});

async function advance(ms = 10) {
  await vi.advanceTimersByTimeAsync(ms);
  await settled();
}

async function openPreview(writes: 'off' | 'on' | 'stopped') {
  vi.useFakeTimers();
  const env = await newLogicOnlineApp(writes);
  apps.push(env.app);
  const el = await mount<MatDownloadDialog>('mat-download-dialog', env.app);
  env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
  await advance();
  await env.app.login('kysu1', env.pw('kysu1'));
  await advance(50);
  await env.app.run('online.download');
  for (let i = 0; i < 400 && env.app.deploy?.flow?.state !== 'preview'; i++) await advance(10);
  expect(env.app.deploy?.flow?.state).toBe('preview');
  return { ...env, el };
}

const role = <T extends HTMLElement>(el: Element, r: string) =>
  el.querySelector<T>(`[data-role="${r}"]`);

describe('Nạp xuống: ghi tự động của logic', () => {
  it('liệt kê Tag logic sẽ ghi; khóa tới khi tích "Tôi đã xem danh sách"', async () => {
    const { el } = await openPreview('on');
    const row = el.querySelector('tr[data-row="logic"]')!;
    expect(row).not.toBeNull();
    expect(textOf(row)).toContain('Logic sẽ tự động ghi 1 Tag xuống PLC');
    const list = el.querySelector('table[data-role="logic-writes"]')!;
    const cells = [...list.querySelectorAll('tbody td')].map((td) => textOf(td));
    expect(cells).toEqual([
      'PUMP01.RUN_CMD',
      'w_pump_run',
      'true, false',
      '1 lệnh / 30 s · 20 / giờ',
      'pump_high_level, pump_low_level',
    ]);
    expect(textOf(role(el, 'logic-device'))).toContain('Ghi PLC: bật');
    const deploy = role<HTMLButtonElement>(el, 'deploy')!;
    expect(deploy.disabled).toBe(true);
    expect(textOf(role(el, 'lock'))).toContain('Tôi đã xem danh sách');
    role<HTMLInputElement>(el, 'logic-ack')!.click();
    await advance();
    // Project mẫu còn một cảnh báo của bộ kiểm: ô "đã đọc cảnh báo" là ô riêng, độc lập với danh sách ghi tự động.
    expect(textOf(role(el, 'lock'))).not.toContain('Tôi đã xem danh sách');
    role<HTMLInputElement>(el, 'ack')?.click();
    await advance();
    expect(role<HTMLButtonElement>(el, 'deploy')!.disabled).toBe(false);
  });

  it('thiết bị đang tắt ghi: lời nhắc W_LOGIC_WRITES_OFF, vẫn phải tích xác nhận', async () => {
    const { el } = await openPreview('off');
    expect(textOf(role(el, 'logic-note'))).toContain('W_LOGIC_WRITES_OFF');
    expect(textOf(role(el, 'logic-device'))).toContain('Ghi PLC: tắt');
    expect(role<HTMLButtonElement>(el, 'deploy')!.disabled).toBe(true);
    role<HTMLInputElement>(el, 'logic-ack')!.click();
    role<HTMLInputElement>(el, 'ack')?.click();
    await advance();
    expect(role<HTMLButtonElement>(el, 'deploy')!.disabled).toBe(false);
  });

  it('thiết bị đã dừng ghi: nạp xuống không bật lại (lời nhắc)', async () => {
    const { el } = await openPreview('stopped');
    expect(textOf(role(el, 'logic-note'))).toContain('Nạp xuống không bật lại');
  });
});
