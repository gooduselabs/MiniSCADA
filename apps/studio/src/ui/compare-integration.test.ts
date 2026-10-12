// Nối Đọc lên và So sánh vào khung Studio (feature 005, US3, T138): ký hiệu trên cây khi Online, chip "khớp/khác" của
// thanh trạng thái, hộp thoại Đọc lên (thành project mới, so với project đang mở), Đọc lên thành project mới (giải
// nén vào thư mục rỗng giả, kết luận kiểm tra, digest giống thiết bị), nút Đọc lên của Thiết bị trong mạng.
// Chạy trên DeviceLink giả, đồng hồ giả.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../app/app.ts';
import './dialogs/devices-dialog.ts';
import './dialogs/login-dialog.ts';
import './dialogs/upload-dialog.ts';
import './mat-shell.ts';
import type { MatShell } from './mat-shell.ts';
import { newOnlineApp, pinnedDevice, textOf, type OnlineEnv } from './online-test-helpers.ts';
import { cleanup, mount, settled } from './test-helpers.ts';

const apps: StudioApp[] = [];

async function advance(ms = 10) {
  await vi.advanceTimersByTimeAsync(ms);
  await settled();
}

async function until(pred: () => boolean, label = 'điều kiện') {
  for (let i = 0; i < 400 && !pred(); i++) await advance(10);
  expect(pred(), label).toBe(true);
}

interface Env extends OnlineEnv {
  shell: MatShell;
}

/** Khung Studio đã mở project mẫu; `edited`: thiết bị chạy bản có Tag khác. `online`: Online đăng nhập `user`. */
async function setup(
  opts: { edited?: boolean; user?: string | null; open?: boolean; gate?: boolean } = {},
): Promise<Env> {
  vi.useFakeTimers();
  const env = await newOnlineApp({ open: opts.open, versionGate: opts.gate });
  apps.push(env.app);
  if (opts.open !== false) await env.app.store.validateNow();
  if (opts.edited) {
    const r = await env.platform.read('tags.json');
    if (!('text' in r)) throw new Error('tags.json');
    const tags = JSON.parse(r.text) as { tags: Array<Record<string, unknown>> };
    tags.tags[0].max = 120;
    env.dev.control.editStored('BL335-01', 'tags.json', JSON.stringify(tags, null, 2) + '\n');
  }
  const shell = await mount<MatShell>('mat-shell', env.app);
  if (opts.user !== null) {
    const user = opts.user ?? 'kysu1';
    env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
    await advance();
    await env.app.login(user, env.pw(user));
    await advance(50);
    await until(
      () => env.app.session.compare.info !== null && !env.app.session.compare.busy,
      'đã so',
    );
  }
  return { ...env, shell };
}

const node = (shell: Element, id: string) => shell.querySelector(`[id="ti-${id}"]`);
const mark = (shell: Element, id: string) => node(shell, id)?.querySelector('.cmp-sym');

describe('ký hiệu so sánh trên cây (FR-029)', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('Online: nút Bảng Tag, Lưu trữ, Màn hình, Thiết lập mang ký hiệu kèm chữ; Offline thì mất', async () => {
    const { shell, app } = await setup({ edited: true });
    await settled(shell);
    expect(mark(shell, 'tags')?.textContent).toBe('≠');
    expect(textOf(node(shell, 'tags'))).toContain('Khác thiết bị');
    expect(mark(shell, 'logging')?.textContent).toBe('=');
    expect(mark(shell, 'settings')?.textContent).toBe('=');
    expect(mark(shell, 'screen:tank-motor')?.textContent).toBe('=');
    expect(mark(shell, 'start')).toBeNull();
    app.session.disconnect();
    await advance();
    expect(shell.querySelector('mat-tree .cmp-sym')).toBeNull();
  });
});

describe('chip khớp/khác của thanh trạng thái', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('khác: nói "khác thiết bị"; nhấp mở So sánh', async () => {
    const { shell, app } = await setup({ edited: true });
    const chip = shell.querySelector<HTMLButtonElement>('mat-statusbar [data-role="compare"]')!;
    expect(textOf(chip)).toContain('khác thiết bị');
    chip.click();
    await advance();
    expect(app.store.state.active).toBe('compare');
  });

  it('giống: nói "khớp" kèm phiên bản project; chưa Online thì không có chip', async () => {
    const { shell, app } = await setup();
    const chip = shell.querySelector('mat-statusbar [data-role="compare"]')!;
    expect(textOf(chip)).toContain('khớp thiết bị');
    expect(textOf(chip)).toContain('0.1.0');
    app.session.disconnect();
    await advance();
    expect(shell.querySelector('mat-statusbar [data-role="compare"]')).toBeNull();
  });
});

describe('hộp thoại Đọc lên và Đọc lên thành project mới', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  const dlg = (shell: Element) => shell.querySelector('mat-upload-dialog')!;
  const role = (el: Element, r: string) => el.querySelector<HTMLElement>(`[data-role="${r}"]`);

  it('Đọc lên… khóa khi chưa Online, viewer; mở hộp thoại khi engineer', async () => {
    const off = await setup({ user: null });
    expect(off.app.enabled('online.upload')).toBe('reason.notOnline');
    cleanup();
    apps.pop()?.session.disconnect();
    const viewer = await setup({ user: 'xem1' });
    expect(viewer.app.enabled('online.upload')).toBe('reason.needEngineer');
    cleanup();
    apps.pop()?.session.disconnect();
    const env = await setup();
    expect(env.app.enabled('online.upload')).toBe(true);
    await env.app.run('online.upload');
    await advance();
    expect(env.app.ui.dialog).toEqual({ kind: 'upload' });
    expect(textOf(dlg(env.shell).querySelector('.ttl'))).toContain('BL335-01');
    expect(role(dlg(env.shell), 'upload-new')).not.toBeNull();
    expect(role(dlg(env.shell), 'upload-compare')).not.toBeNull();
  });

  it('So với project đang mở: đóng hộp thoại và mở editor So sánh', async () => {
    const { shell, app } = await setup({ edited: true });
    await app.run('online.upload');
    await advance();
    role(dlg(shell), 'upload-compare')!.click();
    await advance();
    role(dlg(shell), 'upload-go')!.click();
    await advance();
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.active).toBe('compare');
  });

  it('Thành project mới: giải nén vào thư mục rỗng giả, mở project, báo kiểm tra và digest giống thiết bị', async () => {
    const { shell, app, dev } = await setup();
    const before = app.store.state.project?.display;
    await app.run('online.upload');
    await advance();
    role(dlg(shell), 'upload-go')!.click();
    await until(() => app.store.state.project?.display !== before, 'mở project mới');
    await app.store.idle();
    expect(app.store.state.project?.display).toContain('BL335-01');
    await until(() => (app.ui.toast?.text ?? '').includes('Đã đọc lên'), 'thông báo kết luận');
    const text = app.ui.toast?.text ?? '';
    expect(text).toContain('Kiểm tra: không có lỗi');
    expect(text).toContain('Digest giống thiết bị');
    const cmds = dev.control.calls.map((c) => c.cmd);
    expect(cmds).toContain('device_fetch_package');
    expect(cmds).toContain('package_extract');
    expect(app.boundDeviceId()).toBe(app.session.deviceId);
  });

  it('Thành project mới với gói 0.1: đi qua cổng phiên bản, hiện hộp thoại Nâng cấp (T082)', async () => {
    const { app } = await setup({ gate: true });
    const before = app.store.state.project?.display;
    await app.uploadNew();
    await advance();
    expect(app.store.state.project?.display).not.toBe(before);
    expect(app.store.state.pendingUpgrade).toBeTruthy();
    expect(app.ui.dialog?.kind).toBe('upgrade');
  });

  it('hủy hộp thoại chọn thư mục: không đổi project, không báo lỗi; thư mục không rỗng: báo lý do', async () => {
    const { app, dev } = await setup();
    const before = app.store.state.project?.display;
    dev.control.setExtractFolder('cancel');
    await app.uploadNew();
    await advance();
    expect(app.store.state.project?.display).toBe(before);
    expect(app.ui.toast?.text ?? '').not.toContain('Không đọc lên được');
    dev.control.setExtractFolder('not-empty');
    await app.uploadNew();
    await advance();
    expect(app.ui.toast?.text).toContain('thư mục đã chọn không rỗng');
    expect(app.store.state.project?.display).toBe(before);
  });

  it('viewer không đọc lên được: báo cần engineer, không gọi thiết bị lấy gói', async () => {
    const { app, dev } = await setup({ user: 'xem1' });
    await app.uploadNew();
    await advance();
    expect(app.ui.toast?.text).toContain('engineer');
    expect(dev.control.calls.some((c) => c.cmd === 'device_fetch_package')).toBe(false);
  });

  it('project đang mở còn sửa dở: hỏi lưu trước khi đọc lên thành project mới', async () => {
    const { app } = await setup();
    app.store.edit([{ kind: 'tagField', index: 0, field: 'max', value: 777 }]);
    const run = app.uploadNew();
    await advance();
    expect(app.ui.dialog?.kind).toBe('unsaved');
    app.answer('cancel');
    await run;
    await advance();
    expect(app.store.state.project?.display).not.toContain('BL335-01');
  });
});

describe('Thiết bị trong mạng: Đọc lên', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('có hai nút "Đọc lên thành project mới", "Đọc lên để so sánh"; bấm là Online rồi làm việc đó', async () => {
    const { shell, app, pw, dev } = await setup({ user: null, edited: true });
    await pinnedDevice(dev, 'BL335-01');
    await app.run('online.devices');
    await advance(2800);
    const dialog = shell.querySelector('mat-devices-dialog')!;
    const compare = dialog.querySelector<HTMLButtonElement>('[data-role="upload-compare"]');
    expect(compare, 'nút so sánh').not.toBeNull();
    expect(dialog.querySelector('[data-role="upload-new"]'), 'nút project mới').not.toBeNull();
    compare!.click();
    await advance(300);
    expect(app.ui.dialog?.kind).toBe('login');
    await app.login('kysu1', pw('kysu1'));
    await until(() => app.store.state.active === 'compare', 'mở So sánh sau khi đăng nhập');
  });
});
