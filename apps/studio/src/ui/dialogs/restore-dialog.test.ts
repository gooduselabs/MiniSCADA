// Hộp thoại Khôi phục (feature 005, T122, FR-024, mockup confirmRestore): danh sách bản lưu với phiên bản, digest,
// thời điểm, người nạp; chọn rồi xác nhận; tiến trình và kết quả như Nạp xuống; lỗi đọc danh sách. DeviceLink giả.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { newOnlineApp, pinnedDevice, textOf, type OnlineEnv } from '../online-test-helpers.ts';
import { cleanup, mount, press, settled } from '../test-helpers.ts';
import './devices-dialog.ts';
import './download-dialog.ts';
import './login-dialog.ts';
import './restore-dialog.ts';
import type { MatRestoreDialog } from './restore-dialog.ts';

const apps: StudioApp[] = [];

async function advance(ms = 10) {
  await vi.advanceTimersByTimeAsync(ms);
  await settled();
}

async function until(pred: () => boolean, label = 'điều kiện') {
  for (let i = 0; i < 400 && !pred(); i++) await advance(10);
  expect(pred(), label).toBe(true);
}

async function setup(): Promise<OnlineEnv & { el: MatRestoreDialog }> {
  vi.useFakeTimers();
  const env = await newOnlineApp();
  apps.push(env.app);
  env.dev.control.deployStepMs = 5;
  for (const tag of ['mat-devices-dialog', 'mat-login-dialog', 'mat-download-dialog'])
    await mount(tag, env.app);
  const el = await mount<MatRestoreDialog>('mat-restore-dialog', env.app);
  env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
  await advance();
  await env.app.login('kysu1', env.pw('kysu1'));
  await advance(50);
  return { ...env, el };
}

/** Nạp xuống một bản mới để thiết bị có bản lưu (bản 1 thành bản lưu). */
async function deployOnce(env: OnlineEnv): Promise<void> {
  env.app.store.edit([{ kind: 'tagField', index: 0, field: 'description', value: 'Mức mới' }]);
  await env.app.run('project.save');
  await env.app.run('online.download');
  await until(() => env.app.deploy?.flow?.state === 'preview', 'xem trước');
  document.querySelector<HTMLButtonElement>('[data-role="deploy"]')!.click();
  await until(() => env.app.deploy?.flow?.state === 'result', 'nạp xuống xong');
  env.app.deploy!.close();
  await advance();
}

const role = <T extends HTMLElement>(el: Element, r: string) =>
  el.querySelector<T>(`[data-role="${r}"]`);
const seqRows = (el: Element) =>
  [...el.querySelectorAll<HTMLElement>('tr[data-seq]')].map((r) => r.dataset.seq);

describe('hộp thoại Khôi phục', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('danh sách bản lưu: phiên bản, digest, thời điểm, người nạp; bản đang chạy không chọn được', async () => {
    const env = await setup();
    await deployOnce(env);
    await env.app.run('online.restore');
    await until(() => env.app.deploy?.versions.status === 'ready', 'danh sách');
    const { el } = env;
    expect(env.app.ui.dialog).toEqual({ kind: 'restore' });
    expect(textOf(el.querySelector('.dlg-h .ttl'))).toBe('Khôi phục bản trước trên BL335-01');
    expect(seqRows(el)).toEqual(['2', '1']);
    const active = el.querySelector<HTMLElement>('tr[data-seq="2"]')!;
    const backup = el.querySelector<HTMLElement>('tr[data-seq="1"]')!;
    expect(textOf(active)).toContain('Đang chạy');
    expect(textOf(active)).toContain('0.1.0');
    expect(textOf(active)).toContain('kysu1');
    expect(textOf(backup)).toContain('Bản lưu');
    expect(textOf(backup)).toMatch(/9ba112c6/);
    expect(textOf(backup)).toContain('cài tại thiết bị');
    expect(backup.querySelector('.mono')).not.toBeNull();
    const restore = role<HTMLButtonElement>(el, 'restore')!;
    expect(restore.disabled).toBe(true);
    active.click();
    await advance();
    expect(restore.disabled).toBe(true);
    backup.click();
    await advance();
    expect(backup.getAttribute('aria-selected')).toBe('true');
    expect(restore.disabled).toBe(false);
  });

  it('xác nhận rồi khôi phục: 6 bước (hai bước đầu bỏ qua) và kết quả; Hủy ở bước xác nhận không gửi gì', async () => {
    const env = await setup();
    await deployOnce(env);
    await env.app.run('online.restore');
    await until(() => env.app.deploy?.versions.status === 'ready', 'danh sách');
    const { el } = env;
    el.querySelector<HTMLElement>('tr[data-seq="1"]')!.click();
    await advance();
    role<HTMLButtonElement>(el, 'restore')!.click();
    await advance();
    expect(textOf(el.querySelector('.dlg-h .ttl'))).toBe('Khôi phục 0.1.0 trên BL335-01?');
    expect(el.textContent).toContain('Thiết bị chạy lại bản 0.1.0');
    role<HTMLButtonElement>(el, 'back')!.click();
    await advance();
    expect(seqRows(el)).toEqual(['2', '1']);
    expect(env.dev.control.calls.some((c) => c.cmd === 'device_restore')).toBe(false);

    el.querySelector<HTMLElement>('tr[data-seq="1"]')!.click();
    await advance();
    role<HTMLButtonElement>(el, 'restore')!.click();
    await advance();
    role<HTMLButtonElement>(el, 'confirm')!.click();
    await until(() => env.app.deploy?.flow?.state === 'running', 'chạy');
    expect(textOf(el.querySelector('.dlg-h .ttl'))).toBe('Khôi phục trên BL335-01: đang chạy');
    const states = () =>
      [...el.querySelectorAll<HTMLElement>('li[data-step]')].map(
        (li) => `${li.dataset.step}:${li.dataset.state}`,
      );
    expect(states().slice(0, 2)).toEqual(['receive:skipped', 'verify-package:skipped']);
    // Esc khi đang chạy: không đóng.
    press(el.querySelector('.overlay')!, 'Escape');
    await advance();
    expect(env.app.ui.dialog).toEqual({ kind: 'restore' });
    await until(() => env.app.deploy?.flow?.state === 'result', 'xong');
    expect(textOf(el.querySelector('.result'))).toMatch(/Khôi phục xong/);
    role<HTMLButtonElement>(el, 'close')!.click();
    await advance();
    expect(env.app.ui.dialog).toBeNull();
    const call = env.dev.control.calls.find((c) => c.cmd === 'device_restore')!;
    expect(call.args).toMatchObject({ seq: 1 });
  });

  it('thiết bị chưa có bản lưu nào: nói rõ; lỗi đọc danh sách hiện lý do và vẫn đóng được', async () => {
    const env = await setup();
    await env.app.run('online.restore');
    await until(() => env.app.deploy?.versions.status === 'ready', 'danh sách');
    // Chỉ có bản đang chạy: không còn gì để khôi phục.
    expect(env.el.textContent).toContain('Thiết bị chưa có bản lưu nào');
    expect(role<HTMLButtonElement>(env.el, 'restore')!.disabled).toBe(true);
    press(env.el.querySelector('.overlay')!, 'Escape');
    await advance();
    expect(env.app.ui.dialog).toBeNull();

    env.dev.control.expireSession('BL335-01');
    await env.app.deploy!.openRestore();
    await until(() => env.app.deploy?.versions.status === 'error', 'lỗi');
    expect(textOf(env.el.querySelector('[role="alert"]'))).toContain('phiên đăng nhập đã hết hạn');
  });
});
