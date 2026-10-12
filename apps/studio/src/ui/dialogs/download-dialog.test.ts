// Hộp thoại Nạp xuống (feature 005, T122, FR-020–FR-024, data-model §13, mockup openDownload): xem trước đủ các
// dòng, nút khóa kèm lý do, ô "đã đọc cảnh báo", tiến trình 6 bước, kết quả và lý do lỗi, DEVICE_BUSY, Esc không
// đóng khi đang chạy. Chạy trên DeviceLink giả (platform/mock-device.ts), đồng hồ giả.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import type { MockDevice } from '../../platform/mock-device.ts';
import { newOnlineApp, pinnedDevice, textOf, type OnlineEnv } from '../online-test-helpers.ts';
import { cleanup, mount, press, settled } from '../test-helpers.ts';
import './devices-dialog.ts';
import './download-dialog.ts';
import './login-dialog.ts';
import './restore-dialog.ts';
import type { MatDownloadDialog } from './download-dialog.ts';

const apps: StudioApp[] = [];

async function advance(ms = 10) {
  await vi.advanceTimersByTimeAsync(ms);
  await settled();
}

/** Đẩy đồng hồ giả tới khi `pred` đúng (tối đa ~4 s giả). */
async function until(pred: () => boolean, label = 'điều kiện') {
  for (let i = 0; i < 400 && !pred(); i++) await advance(10);
  expect(pred(), label).toBe(true);
}

interface Env extends OnlineEnv {
  el: MatDownloadDialog;
  dev: MockDevice;
}

/** App đã mở project mẫu, Online và đăng nhập kysu1 (engineer) trên BL335-01. */
async function setup(user = 'kysu1'): Promise<Env> {
  vi.useFakeTimers();
  const env = await newOnlineApp();
  apps.push(env.app);
  env.dev.control.deployStepMs = 5;
  for (const tag of ['mat-devices-dialog', 'mat-login-dialog', 'mat-restore-dialog'])
    await mount(tag, env.app);
  const el = await mount<MatDownloadDialog>('mat-download-dialog', env.app);
  env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
  await advance();
  await env.app.login(user, env.pw(user));
  await advance(50);
  expect(env.app.ui.dialog).toBeNull();
  return { ...env, el };
}

async function openDownload(env: Env): Promise<void> {
  await env.app.run('online.download');
  await until(() => env.app.deploy?.flow?.state === 'preview', 'xem trước');
}

const row = (el: Element, id: string) => el.querySelector(`tr[data-row="${id}"]`);
const rowText = (el: Element, id: string) => textOf(row(el, id));
const role = <T extends HTMLElement>(el: Element, r: string) =>
  el.querySelector<T>(`[data-role="${r}"]`);
const title = (el: Element) => textOf(el.querySelector('.dlg-h .ttl'));
const steps = (el: Element) =>
  [...el.querySelectorAll<HTMLElement>('li[data-step]')].map(
    (li) => `${li.dataset.step}:${li.dataset.state}`,
  );

describe('hộp thoại Nạp xuống', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('xem trước: đủ tám dòng theo thứ tự, thông tin từng dòng, nút Nạp xuống bật', async () => {
    const env = await setup();
    env.dev.control.setClients('BL335-01', 4);
    await openDownload(env);
    const { el } = env;
    expect(env.app.ui.dialog).toEqual({ kind: 'download' });
    expect(title(el)).toBe('Nạp xuống BL335-01: xem trước');
    expect(el.querySelector('dialog, [role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(
      [...el.querySelectorAll('tr[data-row]')].map((r) => (r as HTMLElement).dataset.row),
    ).toEqual([
      'check',
      'runtime',
      'replace',
      'clients',
      'size',
      'logging',
      'connections',
      'device',
    ]);
    expect(rowText(el, 'check')).toContain('Kiểm tra project');
    expect(rowText(el, 'check')).toContain('0 lỗi, 0 cảnh báo');
    expect(rowText(el, 'runtime')).toContain('Project cần ≥ 0.3.0, thiết bị 0.4.0');
    expect(rowText(el, 'replace')).toContain('Giống máy này (0.1.0)');
    expect(rowText(el, 'clients')).toMatch(/\d+ client sẽ tự tải lại trang/);
    expect(rowText(el, 'size')).toMatch(/KB \/ 50[,.]0 MB|KB \/ 50 MB/);
    expect(rowText(el, 'logging')).toContain('Giữ history.db');
    expect(rowText(el, 'connections')).toContain('Kênh và thiết bị trường không đổi');
    expect(rowText(el, 'device')).toContain('Đã đăng nhập kysu1 (engineer)');
    const deploy = role<HTMLButtonElement>(el, 'deploy')!;
    expect(deploy.disabled).toBe(false);
    expect(deploy.textContent).toContain('Nạp xuống');
    expect(role(el, 'ack')).toBeNull();
    expect(el.textContent).toContain('Gói .matscada có checksum');
    // Gói tạm đã đóng từ file trên đĩa.
    expect(env.dev.control.calls.some((c) => c.cmd === 'package_build')).toBe(true);
  });

  it('project trên máy khác thiết bị: dòng Thay project nói số khác biệt; mở bước xem trước không gửi gì lên thiết bị', async () => {
    const env = await setup();
    env.app.store.edit([{ kind: 'tagField', index: 0, field: 'description', value: 'Mức mới' }]);
    await env.app.run('project.save');
    await openDownload(env);
    expect(rowText(env.el, 'replace')).toMatch(/0\.1\.0 → 0\.1\.0/);
    expect(rowText(env.el, 'replace')).toContain('1 khác, 0 thêm, 0 bỏ');
    expect(env.dev.control.calls.some((c) => c.cmd === 'device_deploy')).toBe(false);
  });

  it('còn thay đổi chưa lưu: hỏi Lưu rồi nạp xuống hoặc Hủy; lưu xong đi tiếp tới xem trước', async () => {
    const env = await setup();
    env.app.store.edit([{ kind: 'tagField', index: 0, field: 'unit', value: 'm' }]);
    await env.app.run('online.download');
    await until(() => env.app.deploy?.flow?.step === 'ask-save', 'hỏi lưu');
    const { el } = env;
    expect(el.textContent).toContain('chưa lưu');
    expect(role(el, 'save')!.textContent).toContain('Lưu rồi nạp xuống');
    role<HTMLButtonElement>(el, 'save')!.click();
    await until(() => env.app.deploy?.flow?.state === 'preview', 'xem trước sau khi lưu');
    expect(env.app.store.dirtyFiles()).toEqual([]);
    expect(env.platform.control.writes.some((w) => w.rel === 'tags.json')).toBe(true);
    // Hủy ở bước hỏi: đóng hộp thoại, không đóng gói.
    env.app.deploy!.close();
    await advance();
    env.app.store.edit([{ kind: 'tagField', index: 0, field: 'unit', value: 'cm' }]);
    await env.app.run('online.download');
    await until(() => env.app.deploy?.flow?.step === 'ask-save', 'hỏi lưu lần hai');
    role<HTMLButtonElement>(el, 'cancel')!.click();
    await advance();
    expect(env.app.ui.dialog).toBeNull();
    expect(env.app.deploy?.flow).toBeNull();
  });

  it('project còn lỗi: nút Nạp xuống khóa kèm lý do và lối mở danh sách lỗi', async () => {
    const env = await setup();
    env.app.store.edit([{ kind: 'tagField', index: 0, field: 'max', value: -1 }]);
    await advance(400); // bộ kiểm tra chạy sau 250 ms
    await env.app.store.idle();
    // Lệnh bị khóa khi còn lỗi (FR-023 của 004); vào thẳng hộp thoại để thử dòng khóa.
    expect(env.app.enabled('online.download')).toBe('reason.projectErrors');
    await env.app.deploy!.openDownload();
    await until(() => env.app.deploy?.flow?.step === 'ask-save', 'hỏi lưu');
    role<HTMLButtonElement>(env.el, 'save')!.click();
    await until(() => env.app.deploy?.flow?.state === 'preview', 'xem trước');
    const { el } = env;
    expect(rowText(el, 'check')).toMatch(/[1-9]\d* lỗi/);
    const deploy = role<HTMLButtonElement>(el, 'deploy')!;
    expect(deploy.disabled).toBe(true);
    expect(deploy.title).toContain('Còn lỗi');
    expect(textOf(role(el, 'lock'))).toContain('Còn lỗi: sửa trước khi nạp xuống');
    role<HTMLButtonElement>(el, 'view-errors')!.click();
    await advance();
    expect(env.app.ui.dialog).toBeNull();
    expect(env.app.ui.inspectorTab).toBe('diag');
  });

  it('có cảnh báo thì phải đánh dấu "đã đọc" mới nạp xuống được', async () => {
    const env = await setup();
    // Thêm phần tử không có trong SVG: W_UID_NOT_IN_SVG (cảnh báo, không phải lỗi).
    const screen = await env.platform.read('screens/tank-motor.screen.json');
    if (!('text' in screen)) throw new Error('không đọc được màn hình mẫu');
    env.platform.control.editOutside(
      'screens/tank-motor.screen.json',
      screen.text.replace(
        '"elements": [',
        '"elements": [\n    { "elementUid": "el_thua", "name": "Thừa", "kind": "shape" },',
      ),
    );
    await env.app.run('tools.validate');
    await env.app.store.idle();
    await openDownload(env);
    const { el } = env;
    expect(rowText(el, 'check')).toMatch(/0 lỗi, [1-9]\d* cảnh báo/);
    const ack = role<HTMLInputElement>(el, 'ack')!;
    expect(ack.checked).toBe(false);
    expect(el.textContent).toContain('Tôi đã đọc các cảnh báo');
    const deploy = () => role<HTMLButtonElement>(el, 'deploy')!;
    expect(deploy().disabled).toBe(true);
    expect(textOf(role(el, 'lock'))).toContain('Đánh dấu đã đọc cảnh báo');
    ack.click();
    await advance();
    expect(deploy().disabled).toBe(false);
  });

  it('đang chạy: 6 bước theo thứ tự với trạng thái từng bước; Esc không đóng; xong thì có kết quả', async () => {
    const env = await setup();
    await openDownload(env);
    const { el } = env;
    role<HTMLButtonElement>(el, 'deploy')!.click();
    await until(() => env.app.deploy?.flow?.state === 'running', 'chạy');
    expect(title(el)).toBe('Nạp xuống BL335-01: đang chạy');
    expect(steps(el).map((s) => s.split(':')[0])).toEqual([
      'receive',
      'verify-package',
      'validate',
      'backup',
      'activate',
      'health',
    ]);
    expect(el.textContent).toContain('Gửi gói lên thiết bị');
    expect(el.textContent).toContain('Kiểm tra sức khỏe');
    await until(
      () => steps(el).some((s) => s.endsWith(':running')) && steps(el)[0] !== 'receive:running',
    );
    expect(steps(el).some((s) => s.endsWith(':ok'))).toBe(true);
    // Esc khi đang chạy: hộp thoại vẫn mở.
    press(el.querySelector('.overlay')!, 'Escape');
    await advance();
    expect(env.app.ui.dialog).toEqual({ kind: 'download' });
    expect(role<HTMLButtonElement>(el, 'close')).toBeNull();
    await until(() => env.app.deploy?.flow?.state === 'result', 'kết quả');
    expect(title(el)).toBe('Nạp xuống BL335-01: kết quả');
    const result = el.querySelector<HTMLElement>('.result')!;
    expect(result.dataset.outcome).toBe('committed');
    expect(textOf(result)).toMatch(/Nạp xuống xong trong [\d.,]+ s\./);
    expect(el.textContent).toContain('BL335-01 đang chạy');
    expect(el.textContent).toContain('Bản trước');
    expect(steps(el).every((s) => s.endsWith(':ok'))).toBe(true);
    // Thiết bị thật sự chạy bản mới.
    const versions = await env.dev.get(env.app.session.deviceId!, '/api/v1/project/versions');
    expect((versions as { body: { active: number } }).body.active).toBe(2);
    // Xong thì Esc đóng được.
    press(el.querySelector('.overlay')!, 'Escape');
    await advance();
    expect(env.app.ui.dialog).toBeNull();
  });

  it('kết quả committed: Khôi phục bản trước chạy kind = restore', async () => {
    const env = await setup();
    await openDownload(env);
    role<HTMLButtonElement>(env.el, 'deploy')!.click();
    await until(() => env.app.deploy?.flow?.state === 'result', 'kết quả nạp xuống');
    role<HTMLButtonElement>(env.el, 'restore-prev')!.click();
    await until(
      () =>
        env.app.deploy?.flow?.state === 'result' && env.app.deploy.flow.result?.kind === 'restore',
      'khôi phục xong',
    );
    expect(title(env.el)).toBe('Khôi phục trên BL335-01: kết quả');
    expect(textOf(env.el.querySelector('.result'))).toMatch(/Khôi phục xong/);
    expect(steps(env.el).slice(0, 2)).toEqual(['receive:skipped', 'verify-package:skipped']);
  });

  it('lỗi ở một bước: kết quả không thành công, đúng lý do, bản đang chạy không đổi', async () => {
    const env = await setup();
    env.dev.control.failDeploy('validate', 'E_VALIDATION');
    await openDownload(env);
    role<HTMLButtonElement>(env.el, 'deploy')!.click();
    await until(() => env.app.deploy?.flow?.state === 'result', 'kết quả');
    const { el } = env;
    expect(title(el)).toBe('Nạp xuống BL335-01: không thành công');
    const result = el.querySelector<HTMLElement>('.result')!;
    expect(result.dataset.outcome).toBe('failed');
    expect(textOf(result)).toContain('Nạp xuống không thành công. Bản đang chạy không đổi.');
    expect(textOf(result)).toContain('thiết bị từ chối project');
    expect(el.textContent).toContain('E_TAG_RANGE');
    expect(steps(el)).toContain('validate:failed');
    expect(role(el, 'restore-prev')).toBeNull();
    expect(role(el, 'retry')).not.toBeNull();
  });

  it('rollback: thêm bước Quay về bản trước; kết quả nói đã quay về bản nào', async () => {
    const env = await setup();
    env.dev.control.failDeploy('health', 'HEALTH_TIMEOUT');
    await openDownload(env);
    role<HTMLButtonElement>(env.el, 'deploy')!.click();
    await until(() => env.app.deploy?.flow?.state === 'result', 'kết quả');
    const { el } = env;
    const result = el.querySelector<HTMLElement>('.result')!;
    expect(result.dataset.outcome).toBe('rolled-back');
    expect(textOf(result)).toContain('Thiết bị đã tự quay về bản 0.1.0.');
    expect(textOf(result)).toContain('runtime không trả lời sau 15 giây');
    expect(steps(el)).toEqual([
      'receive:ok',
      'verify-package:ok',
      'validate:ok',
      'backup:ok',
      'activate:ok',
      'health:failed',
      'rollback:ok',
    ]);
    expect(el.textContent).toContain('Quay về bản trước');
  });

  it('DEVICE_BUSY: về bước xem trước, nói ai, từ đâu, từ lúc nào', async () => {
    const env = await setup();
    await openDownload(env);
    env.dev.control.setBusy('BL335-01', { user: 'kysu2', source: '192.168.1.77' });
    role<HTMLButtonElement>(env.el, 'deploy')!.click();
    await until(
      () => env.app.deploy?.flow?.state === 'preview' && role(env.el, 'notice') !== null,
      'về xem trước',
    );
    const notice = textOf(role(env.el, 'notice'));
    expect(notice).toContain('kysu2');
    expect(notice).toContain('192.168.1.77');
    expect(notice).toContain('nạp xuống');
    expect(title(env.el)).toBe('Nạp xuống BL335-01: xem trước');
  });

  it('BASE_CHANGED: về xem trước kèm thông báo có người vừa nạp xuống', async () => {
    const env = await setup();
    await openDownload(env);
    env.dev.control.changeBase('BL335-01');
    role<HTMLButtonElement>(env.el, 'deploy')!.click();
    await until(() => role(env.el, 'notice') !== null, 'thông báo');
    expect(textOf(role(env.el, 'notice'))).toContain('Có người vừa nạp xuống thiết bị này');
    expect(env.app.deploy?.flow?.state).toBe('preview');
    expect(rowText(env.el, 'replace')).not.toContain('Giống máy này');
  });

  it('phiên hết hạn khi bấm Nạp xuống: thông báo, quay về xem trước, dòng Thiết bị khóa', async () => {
    const env = await setup();
    await openDownload(env);
    env.dev.control.expireSession('BL335-01');
    role<HTMLButtonElement>(env.el, 'deploy')!.click();
    await until(() => env.app.deploy?.flow?.state === 'preview' && role(env.el, 'notice') !== null);
    expect(textOf(role(env.el, 'notice'))).toContain('Phiên đăng nhập đã hết hạn');
    expect(role<HTMLButtonElement>(env.el, 'deploy')!.disabled).toBe(true);
  });

  it('viewer: dòng Thiết bị báo thiếu quyền và khóa nút', async () => {
    const env = await setup('xem1');
    // Role viewer không mở được lệnh Nạp xuống qua menu? Lệnh chỉ cần đăng nhập; thiết bị mới từ chối.
    await env.app.deploy!.openDownload();
    await until(() => env.app.deploy?.flow?.state === 'preview', 'xem trước');
    expect(rowText(env.el, 'device')).toContain('không đủ quyền');
    expect(role<HTMLButtonElement>(env.el, 'deploy')!.disabled).toBe(true);
    expect(textOf(role(env.el, 'lock'))).toContain('Tài khoản không đủ quyền');
  });

  it('Esc ở xem trước đóng hộp thoại và bỏ gói tạm; lệnh Nạp xuống khóa khi chưa Online', async () => {
    const env = await setup();
    await openDownload(env);
    press(env.el.querySelector('.overlay')!, 'Escape');
    await advance();
    expect(env.app.ui.dialog).toBeNull();
    expect(env.dev.control.calls.some((c) => c.cmd === 'package_discard')).toBe(true);
    env.app.session.disconnect();
    await advance();
    expect(env.app.enabled('online.download')).toBe('reason.notOnline');
    expect(env.app.enabled('online.restore')).toBe('reason.notOnline');
  });
});
