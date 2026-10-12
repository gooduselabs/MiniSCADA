// Hộp thoại đăng nhập (feature 005, T081, FR-012, FR-013, FR-031, spec US1-5, US1-6, US1-8, mockup
// drawLogin): thông báo không cho biết sai tên hay sai mật khẩu; đang khóa thì hiện thời gian còn lại; ô
// mật khẩu xóa sau khi gửi, không lưu; `setup-required` hướng dẫn lệnh trên thiết bị; đăng nhập lại khi phiên
// hết hạn không đụng việc đang sửa.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import type { KnownDevice } from '../../platform/device-types.ts';
import {
  buttonByText,
  newOnlineApp,
  pinnedDevice,
  textOf,
  typeInto,
  type OnlineEnv,
} from '../online-test-helpers.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';
import './devices-dialog.ts';
import './login-dialog.ts';
import type { MatLoginDialog } from './login-dialog.ts';

const apps: StudioApp[] = [];

async function advance(ms = 10) {
  await vi.advanceTimersByTimeAsync(ms);
  await settled();
}

async function setup(
  name = 'BL335-01',
): Promise<OnlineEnv & { el: MatLoginDialog; k: KnownDevice }> {
  vi.useFakeTimers();
  const env = await newOnlineApp();
  apps.push(env.app);
  await mount('mat-devices-dialog', env.app);
  const el = await mount<MatLoginDialog>('mat-login-dialog', env.app);
  const k = await pinnedDevice(env.dev, name);
  env.app.session.goOnline(k);
  await advance();
  expect(env.app.ui.dialog).toEqual({ kind: 'login' });
  return { ...env, el, k };
}

const userInput = (el: Element) => el.querySelector<HTMLInputElement>('input[name="user"]')!;
const passInput = (el: Element) => el.querySelector<HTMLInputElement>('input[name="password"]')!;
const alertText = (el: Element) => textOf(el.querySelector('[role="alert"]'));

/** Gõ tài khoản, mật khẩu rồi bấm Đăng nhập; trả giá trị ô mật khẩu ngay sau khi bấm. */
async function submit(el: Element, user: string, password: string): Promise<string> {
  typeInto(userInput(el), user);
  typeInto(passInput(el), password);
  buttonByText(el, 'Đăng nhập')!.click();
  const left = passInput(el).value;
  await advance();
  return left;
}

describe('hộp thoại đăng nhập', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('nhãn, autocomplete, ô mật khẩu ẩn; không có ô nhớ mật khẩu; nói rõ khóa sau 5 lần sai', async () => {
    const { el } = await setup();
    expect(textOf(el.querySelector('.dlg-h'))).toContain('Đăng nhập · BL335-01');
    const user = userInput(el);
    const pass = passInput(el);
    expect(textOf(el.querySelector(`label[for="${user.id}"]`))).toBe('Tài khoản');
    expect(textOf(el.querySelector(`label[for="${pass.id}"]`))).toBe('Mật khẩu');
    expect(user.autocomplete).toBe('username');
    expect(pass.type).toBe('password');
    expect(pass.autocomplete).toBe('current-password');
    expect(pass.placeholder).toBe('Mật khẩu tài khoản thiết bị');
    expect(el.querySelector('input[type="checkbox"]')).toBeNull();
    const body = textOf(el.querySelector('.dlg-b'));
    expect(body).toContain('Sai 5 lần thì tài khoản bị khóa tạm 5 phút');
    expect(body).toContain('không lưu mật khẩu');
    expect(document.activeElement).toBe(user);
  });

  it('đăng nhập đúng: ô mật khẩu xóa ngay khi gửi; mật khẩu không nằm trong DOM hay dữ liệu đã lưu; vào Online', async () => {
    const { app, dev, el, pw } = await setup();
    const left = await submit(el, 'kysu1', pw('kysu1'));
    expect(left).toBe('');
    await advance(300);
    expect(app.ui.dialog).toBeNull();
    expect(app.session.state).toBe('monitoring');
    expect(app.session.auth).toMatchObject({ user: 'kysu1', role: 'engineer' });
    expect(document.body.outerHTML).not.toContain(pw('kysu1'));
    expect(JSON.stringify(dev.control.saved())).not.toContain(pw('kysu1'));
    expect(JSON.stringify(dev.control.calls)).not.toContain(pw('kysu1'));
  });

  it('sai tên hay sai mật khẩu: cùng một câu, không cho biết sai ở đâu; ô mật khẩu xóa', async () => {
    const { app, el, pw } = await setup();
    expect(await submit(el, 'kysu1', 'sai-mat-khau-dai-15')).toBe('');
    const wrongPassword = alertText(el);
    expect(wrongPassword).toBe('Tên tài khoản hoặc mật khẩu không đúng.');
    expect(await submit(el, 'khongco', pw('kysu1'))).toBe('');
    expect(alertText(el)).toBe(wrongPassword);
    expect(app.session.state).toBe('login');
    expect(passInput(el).getAttribute('aria-describedby')).toBe(
      el.querySelector('[role="alert"]')!.id,
    );
  });

  it('đang khóa: hiện thời gian còn lại và đếm ngược', async () => {
    const { el, pw } = await setup('BL335-02');
    for (let i = 0; i < 5; i++) await submit(el, 'xem1', 'sai-mat-khau-dai-15');
    await submit(el, 'xem1', pw('xem1'));
    expect(alertText(el)).toBe(
      'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau 5 phút 0 giây.',
    );
    await advance(1000);
    expect(alertText(el)).toContain('4 phút 59 giây');
    await advance(299_000);
    expect(alertText(el)).toBe('Hết thời gian khóa tạm: có thể đăng nhập lại.');
  });

  it('thiết bị chưa có tài khoản (setup-required): hướng dẫn lệnh trên thiết bị', async () => {
    const { dev, el, pw } = await setup();
    dev.control.setSetupRequired('BL335-01', true);
    await submit(el, 'admin', pw('admin'));
    expect(alertText(el)).toContain('mat-runtime --user-add admin --role administrator');
  });

  it('lỗi khác của Rust (TLS, mã lạ): câu tiếng Việt kèm chi tiết, ở lại bước đăng nhập', async () => {
    const { app, dev, el, pw } = await setup();
    vi.spyOn(dev, 'login').mockResolvedValueOnce({ error: 'tls', detail: 'bad handshake' });
    await submit(el, 'kysu1', pw('kysu1'));
    expect(alertText(el)).toBe(
      'Không đăng nhập được: bắt tay TLS với thiết bị không được (bad handshake).',
    );
    vi.spyOn(dev, 'login').mockResolvedValueOnce({ error: 'ma-la' });
    await submit(el, 'kysu1', pw('kysu1'));
    expect(alertText(el)).toBe(
      'Không đăng nhập được: lỗi không rõ của thiết bị hoặc Studio (ma-la).',
    );
    expect(app.session.state).toBe('login');
  });

  it('thiếu tên hay mật khẩu: báo tại chỗ, không gửi', async () => {
    const { dev, el } = await setup();
    await submit(el, '', 'x');
    expect(alertText(el)).toBe('Nhập tên tài khoản');
    await submit(el, 'kysu1', '');
    expect(alertText(el)).toBe('Nhập mật khẩu');
    expect(dev.control.calls.filter((c) => c.cmd === 'device_login')).toHaveLength(0);
  });

  it('Quay lại: hủy kết nối, về danh sách thiết bị', async () => {
    const { app, el } = await setup();
    buttonByText(el, 'Quay lại')!.click();
    await advance();
    expect(app.session.state).toBe('idle');
    expect(app.ui.dialog).toEqual({ kind: 'devices' });
  });

  it('phiên hết hạn: hỏi đăng nhập lại, tài khoản điền sẵn; Để sau giữ theo dõi; đăng nhập lại về Online', async () => {
    const { app, dev, el, pw } = await setup();
    await submit(el, 'kysu1', pw('kysu1'));
    await advance(300);
    expect(app.session.state).toBe('monitoring');
    dev.control.expireSession('BL335-01');
    await advance(5000);
    expect(app.session.state).toBe('relogin');
    expect(app.ui.dialog).toEqual({ kind: 'login' });
    expect(textOf(el.querySelector('.dlg-h'))).toContain('Đăng nhập lại · BL335-01');
    expect(textOf(el.querySelector('.dlg-b'))).toContain('Phiên đăng nhập đã hết hạn');
    expect(userInput(el).value).toBe('kysu1');
    expect(document.activeElement).toBe(passInput(el));
    buttonByText(el, 'Để sau')!.click();
    await advance();
    expect(app.ui.dialog).toBeNull();
    expect(app.session.state).toBe('relogin');
    expect(app.online()).toBe(true);
    await app.run('online.login');
    await advance();
    expect(app.ui.dialog).toEqual({ kind: 'login' });
    expect(await submit(el, 'kysu1', pw('kysu1'))).toBe('');
    expect(app.session.state).toBe('monitoring');
    expect(app.ui.dialog).toBeNull();
  });
});
