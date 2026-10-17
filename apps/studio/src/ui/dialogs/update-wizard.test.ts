// Hộp "Cập nhật runtime" (OTA, feature 011, T110; FR-068; contracts/device-api-011.md §3, §5) trên thiết bị giả: task card
// trong trang Thiết bị và Công cụ online chỉ hiện với administrator khi thiết bị báo `update.supported` (thiết bị cũ ẩn; OTA tắt
// thì khóa kèm gợi ý); chọn file, tải lên có tiến trình; xem kế hoạch (phiên bản, tương thích, thời gian ngừng, người ký);
// nhập mật khẩu (không lưu, xóa sau khi gửi); theo dõi qua nối lại tới committed, rolled-back hay mất kết nối quá 120 s; nút
// "Quay về bản trước". axe-core 0 vi phạm ở từng bước (trừ tương phản màu: jsdom không tính được; e2e đo ở hai theme).
import axe from 'axe-core';
import { render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import type { MockUpdateConfig } from '../../platform/mock-device-update.ts';
import { pinnedDevice, newOnlineApp, typeInto } from '../online-test-helpers.ts';
import { renderEditor } from '../registry.ts';
import { cleanup, settled } from '../test-helpers.ts';
import '../editors/device-page.ts';
import '../mat-taskcards.ts';
import './update-wizard.ts';

const apps: StudioApp[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const a of apps.splice(0)) a.session.disconnect();
  cleanup();
});

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function setup(
  opts: { user?: string; update?: MockUpdateConfig | null; runtime?: string } = {},
) {
  vi.useFakeTimers();
  const env = await newOnlineApp();
  apps.push(env.app);
  env.dev.control.setRuntime('BL335-01', opts.runtime ?? '1.0.0');
  env.dev.control.setUpdate(
    'BL335-01',
    opts.update === undefined ? { enabled: true } : opts.update,
  );
  env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
  await vi.advanceTimersByTimeAsync(50);
  const user = opts.user ?? 'admin';
  await env.app.login(user, env.pw(user));
  await vi.advanceTimersByTimeAsync(400);
  const host = document.createElement('div');
  document.body.append(host);
  const dlg = document.createElement('mat-update-wizard');
  dlg.app = env.app;
  document.body.append(dlg);
  const draw = () => render(renderEditor(env.app, 'device'), host);
  draw();
  env.app.subscribe(draw);
  const again = async (ms = 50) => {
    await vi.advanceTimersByTimeAsync(ms);
    await settled(document.body);
  };
  await again(100);
  const q = <T extends Element = HTMLElement>(sel: string) => dlg.querySelector<T>(sel);
  const click = async (sel: string, ms = 50) => {
    const b = q<HTMLButtonElement>(sel);
    if (!b) throw new Error(`không có ${sel}`);
    b.click();
    await again(ms);
  };
  const step = () => q('[data-step]')?.getAttribute('data-step') ?? null;
  return { ...env, host, dlg, again, q, click, step };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** Mở hộp từ task card của trang Thiết bị. */
async function open(env: Env) {
  const b = env.host.querySelector<HTMLButtonElement>('[data-act="ota-open"]')!;
  b.click();
  await env.again(100);
}

/** Chọn file, tải lên, tới bước kế hoạch. */
async function toPlan(env: Env) {
  await open(env);
  await env.click('[data-act="pick"]');
  await env.click('[data-act="upload"]', 500);
  expect(env.step()).toBe('plan');
}

/** axe-core dùng setTimeout: với đồng hồ giả, đẩy thời gian từng chút tới khi xong (luồng hỏi trạng thái mỗi 2 s). */
async function noAxeViolations(root: Element) {
  let done = false;
  const run = axe.run(root, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    resultTypes: ['violations'],
  });
  void run.finally(() => (done = true));
  for (let i = 0; i < 1000 && !done; i++) await vi.advanceTimersByTimeAsync(1);
  const res = await run;
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`)).toEqual(
    [],
  );
}

describe('ai thấy "Cập nhật runtime"', () => {
  it('administrator, thiết bị báo update.supported và enabled: task card bật trong trang Thiết bị', async () => {
    const env = await setup();
    const card = env.host.querySelector('[data-role="ota"]')!;
    expect(text(card)).toContain('Cập nhật runtime');
    const b = card.querySelector<HTMLButtonElement>('[data-act="ota-open"]')!;
    expect(b.getAttribute('aria-disabled')).toBeNull();
    b.click();
    await env.again(100);
    expect(env.app.ui.dialog?.kind).toBe('runtimeUpdate');
  });

  it('task card Công cụ online cũng có lệnh (administrator)', async () => {
    const env = await setup();
    env.app.setTaskCard('online');
    const tc = document.createElement('mat-taskcards');
    tc.app = env.app;
    document.body.append(tc);
    await env.again(100);
    const b = tc.querySelector<HTMLButtonElement>('[data-act="ota-open"]')!;
    expect(text(b)).toContain('Cập nhật runtime');
    b.click();
    await env.again(100);
    expect(env.app.ui.dialog?.kind).toBe('runtimeUpdate');
  });

  it('không phải administrator: không có', async () => {
    const env = await setup({ user: 'kysu1' });
    expect(env.host.querySelector('[data-role="ota"]')).toBeNull();
  });

  it('thiết bị cũ (system/info không có khóa update): không có', async () => {
    const env = await setup({ update: null });
    expect(env.host.querySelector('[data-role="ota"]')).toBeNull();
  });

  it('OTA tắt trên thiết bị: hiện nhưng khóa, kèm gợi ý update.enabled', async () => {
    const env = await setup({ update: { enabled: false } });
    const card = env.host.querySelector('[data-role="ota"]')!;
    const b = card.querySelector<HTMLButtonElement>('[data-act="ota-open"]')!;
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(text(card)).toContain('update.enabled');
    b.click();
    await env.again(100);
    expect(env.app.ui.dialog).toBeNull();
  });
});

describe('hộp Cập nhật runtime', () => {
  it('chọn file, tải lên có tiến trình, xem kế hoạch đủ thông tin', async () => {
    const env = await setup({ update: { enabled: true, uploadMs: 400 } });
    await open(env);
    expect(env.step()).toBe('pick');
    const upload = env.q<HTMLButtonElement>('[data-act="upload"]')!;
    expect(upload.disabled).toBe(true);
    await noAxeViolations(env.dlg);
    await env.click('[data-act="pick"]');
    expect(text(env.q('[data-role="file"]'))).toContain('mat-runtime-1.0.1.matupdate');
    expect(upload.disabled).toBe(false);
    upload.click();
    await env.again(150);
    expect(env.step()).toBe('uploading');
    const bar = env.q<HTMLProgressElement>('progress')!;
    expect(bar).not.toBeNull();
    expect(Number(bar.value)).toBeGreaterThan(0);
    expect(text(env.q('[data-role="progress"]'))).toMatch(/MB/);
    await noAxeViolations(env.dlg);
    await env.again(500);
    expect(env.step()).toBe('plan');
    const plan = text(env.q('[data-role="plan"]'));
    for (const s of ['1.0.0', '1.0.1', '25 s', 'release-primary', 'sha256:', 'Tương thích'])
      expect(plan, s).toContain(s);
    await noAxeViolations(env.dlg);
  });

  it('nút Cập nhật cần mật khẩu; mật khẩu không vào nhật ký lệnh và bị xóa sau khi gửi; theo dõi tới committed', async () => {
    const env = await setup({ update: { enabled: true, outcome: 'committed', restartPolls: 3 } });
    await toPlan(env);
    const apply = env.q<HTMLButtonElement>('[data-act="apply"]')!;
    expect(apply.disabled).toBe(true);
    const pw = env.q<HTMLInputElement>('input[type="password"]')!;
    expect(pw.labels?.length).toBe(1);
    typeInto(pw, env.pw('admin'));
    await env.again();
    expect(apply.disabled).toBe(false);
    apply.click();
    await env.again(100);
    expect(env.step()).toBe('following');
    expect(env.q('[data-role="following"]')?.getAttribute('role')).toBe('status');
    expect(JSON.stringify(env.dev.control.calls)).not.toContain(env.pw('admin'));
    await noAxeViolations(env.dlg);
    await env.again(15_000);
    expect(env.step()).toBe('result');
    const result = env.q('.result')!;
    expect(result.getAttribute('data-outcome')).toBe('committed');
    expect(text(result)).toContain('1.0.1');
    await noAxeViolations(env.dlg);
    // Mở lại: ô mật khẩu trống.
    await env.click('[data-act="close"]');
    expect(env.app.ui.dialog).toBeNull();
  });

  it('sai mật khẩu: báo lỗi, ở lại bước kế hoạch, ô mật khẩu đã xóa', async () => {
    const env = await setup();
    await toPlan(env);
    const pw = env.q<HTMLInputElement>('input[type="password"]')!;
    typeInto(pw, 'không-đúng');
    await env.again();
    await env.click('[data-act="apply"]', 200);
    expect(env.step()).toBe('plan');
    expect(text(env.q('[role="alert"]'))).toContain('Mật khẩu');
    expect(env.q<HTMLInputElement>('input[type="password"]')!.value).toBe('');
  });

  it('thiết bị tự quay về: kết quả rolled-back kèm lý do', async () => {
    const env = await setup({
      update: { enabled: true, outcome: 'rolled-back', reason: 'health-check thất bại' },
    });
    await toPlan(env);
    typeInto(env.q<HTMLInputElement>('input[type="password"]')!, env.pw('admin'));
    await env.again();
    await env.click('[data-act="apply"]', 15_000);
    const result = env.q('.result')!;
    expect(result.getAttribute('data-outcome')).toBe('rolled-back');
    expect(text(result)).toContain('health-check thất bại');
    expect(text(result)).toContain('1.0.0');
  });

  it('thiết bị không trả lời quá 120 s: bước mất kết nối kèm hướng dẫn', async () => {
    const env = await setup({ update: { enabled: true, outcome: 'lost' } });
    await toPlan(env);
    typeInto(env.q<HTMLInputElement>('input[type="password"]')!, env.pw('admin'));
    await env.again();
    await env.click('[data-act="apply"]', 100_000);
    expect(env.step()).toBe('following');
    await env.again(25_000);
    expect(env.step()).toBe('result');
    const result = env.q('.result')!;
    expect(result.getAttribute('data-outcome')).toBe('lost');
    expect(text(result)).toMatch(/120 s/);
    expect(text(result)).toContain('mat-runtime update status');
    await noAxeViolations(env.dlg);
  });

  it('thiết bị từ chối gói: báo mã lỗi ở bước chọn file', async () => {
    const env = await setup({ update: { enabled: true, uploadError: 'UPDATE_DOWNGRADE' } });
    await open(env);
    await env.click('[data-act="pick"]');
    await env.click('[data-act="upload"]', 500);
    expect(env.step()).toBe('pick');
    expect(text(env.q('[role="alert"]'))).toContain('UPDATE_DOWNGRADE');
  });

  it('Hủy gói đang chờ: gửi cancel, về bước chọn file', async () => {
    const env = await setup();
    await toPlan(env);
    await env.click('[data-act="cancel-package"]', 200);
    expect(env.step()).toBe('pick');
    expect(env.dev.control.calls.some((c) => c.cmd === 'device_update_cancel')).toBe(true);
  });

  it('Quay về bản trước: hỏi mật khẩu, theo dõi, báo bản đang chạy', async () => {
    const env = await setup({
      update: { enabled: true, previous: { version: '0.9.5', available: true } },
    });
    await open(env);
    await env.click('[data-act="rollback"]');
    expect(env.step()).toBe('confirm-rollback');
    expect(text(env.dlg)).toContain('0.9.5');
    const go = env.q<HTMLButtonElement>('[data-act="rollback-go"]')!;
    expect(go.disabled).toBe(true);
    typeInto(env.q<HTMLInputElement>('input[type="password"]')!, env.pw('admin'));
    await env.again();
    await noAxeViolations(env.dlg);
    go.click();
    await env.again(15_000);
    expect(env.step()).toBe('result');
    expect(text(env.q('.result'))).toContain('0.9.5');
    expect(JSON.stringify(env.dev.control.calls)).not.toContain(env.pw('admin'));
  });

  it('không có bản trước: không có nút Quay về bản trước', async () => {
    const env = await setup({ update: { enabled: true, previous: null } });
    await open(env);
    expect(env.q('[data-act="rollback"]')).toBeNull();
  });
});
