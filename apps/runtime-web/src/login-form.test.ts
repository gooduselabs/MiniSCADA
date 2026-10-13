// Biểu mẫu đăng nhập (feature 007, FR-039, FR-049; contracts/web-session.md §4): autocomplete đúng, mật khẩu xóa khỏi
// DOM sau khi gửi, thông báo theo mã, không gửi đôi.
import { describe, expect, it, vi } from 'vitest';
import { createLoginForm } from './login-form.ts';
import type { LoginResult } from './session.ts';

function make(login: (u: string, p: string) => Promise<LoginResult>) {
  const onSuccess = vi.fn();
  const onCancel = vi.fn();
  const f = createLoginForm({ login, onSuccess, onCancel });
  document.body.replaceChildren(f.form);
  return { f, onSuccess, onCancel };
}
const submit = (f: ReturnType<typeof createLoginForm>) =>
  f.form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createLoginForm', () => {
  it('autocomplete đúng, mật khẩu là type=password, nhãn gắn với ô', () => {
    const { f } = make(async () => ({ ok: false, code: 'X' }));
    expect(f.user.autocomplete).toBe('username');
    expect(f.pass.autocomplete).toBe('current-password');
    expect(f.pass.type).toBe('password');
    for (const input of [f.user, f.pass]) {
      const label = f.form.querySelector(`label[for="${input.id}"]`);
      expect(label?.textContent).toBeTruthy();
    }
  });

  it('rỗng: báo lỗi, không gọi login', () => {
    const login = vi.fn();
    const { f } = make(login);
    submit(f);
    expect(login).not.toHaveBeenCalled();
    expect(f.error.hidden).toBe(false);
    expect(f.error.getAttribute('role')).toBe('alert');
  });

  it('gửi tên đã cắt khoảng trắng và mật khẩu nguyên văn; mật khẩu xóa khỏi DOM NGAY, trước khi có kết quả', async () => {
    let resolve!: (r: LoginResult) => void;
    const login = vi.fn(() => new Promise<LoginResult>((r) => (resolve = r)));
    const { f, onSuccess } = make(login);
    f.user.value = '  vanhanh1 ';
    f.pass.value = ' bí mật ';
    submit(f);
    expect(login).toHaveBeenCalledWith('vanhanh1', ' bí mật ');
    expect(f.pass.value).toBe('');
    expect(f.submit.disabled).toBe(true);
    resolve({ ok: true, info: { user: 'vanhanh1', role: 'operator' } });
    await flush();
    expect(onSuccess).toHaveBeenCalledWith({ user: 'vanhanh1', role: 'operator' });
    expect(f.submit.disabled).toBe(false);
  });

  it('bấm hai lần khi đang gửi chỉ gọi một lần', () => {
    const login = vi.fn(() => new Promise<LoginResult>(() => {}));
    const { f } = make(login);
    f.user.value = 'a';
    f.pass.value = 'b';
    submit(f);
    f.pass.value = 'b';
    submit(f);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it('thất bại: câu theo mã, mật khẩu vẫn trống, tên giữ, focus vào mật khẩu', async () => {
    const { f, onSuccess } = make(async () => ({ ok: false, code: 'AUTH_FAILED' }));
    f.user.value = 'a';
    f.pass.value = 'b';
    submit(f);
    await flush();
    expect(f.error.hidden).toBe(false);
    expect(f.error.textContent).toBe('Sai tài khoản hoặc mật khẩu');
    expect(f.pass.value).toBe('');
    expect(f.user.value).toBe('a');
    expect(document.activeElement).toBe(f.pass);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('AUTH_LOCKED nêu số phút theo retryAfterS', async () => {
    const { f } = make(async () => ({ ok: false, code: 'AUTH_LOCKED', retryAfterS: 270 }));
    f.user.value = 'a';
    f.pass.value = 'b';
    submit(f);
    await flush();
    expect(f.error.textContent).toContain('5 phút');
  });

  it('login ném lỗi: báo lỗi mạng, mở khóa nút', async () => {
    const { f } = make(() => Promise.reject(new Error('x')));
    f.user.value = 'a';
    f.pass.value = 'b';
    submit(f);
    await flush();
    expect(f.error.textContent).toContain('Không kết nối');
    expect(f.submit.disabled).toBe(false);
  });

  it('Hủy gọi onCancel; reset xóa lỗi và mật khẩu', () => {
    const { f, onCancel } = make(async () => ({ ok: false, code: 'X' }));
    (f.form.querySelector('button[type="button"]') as HTMLButtonElement).click();
    expect(onCancel).toHaveBeenCalled();
    f.pass.value = 'zz';
    f.error.hidden = false;
    f.reset();
    expect(f.pass.value).toBe('');
    expect(f.error.hidden).toBe(true);
  });

  it('chữ hiển thị là chữ, không phải HTML (mã lạ chứa thẻ)', async () => {
    const { f } = make(async () => ({ ok: false, code: '<img src=x onerror=alert(1)>' }));
    f.user.value = 'a';
    f.pass.value = 'b';
    submit(f);
    await flush();
    expect(f.form.querySelector('img')).toBeNull();
    expect(f.error.textContent).toContain('<img');
  });
});
