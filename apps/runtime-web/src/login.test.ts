// Trang /login (feature 007, FR-039, FR-054): biểu mẫu, vân tay chứng chỉ, liên kết /device.crt, chuyển trang sau đăng nhập.
import { describe, expect, it, vi } from 'vitest';
import { formatFingerprint, mountLoginPage } from './login.ts';
import { fakeFetch } from './testing.ts';

const FP = '3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b';
const flush = () => new Promise((r) => setTimeout(r, 0));

function mount(https: boolean, routes: Parameters<typeof fakeFetch>[0] = {}) {
  const f = fakeFetch({ 'GET /api/v1/device/identity': { json: { fingerprint: FP } }, ...routes });
  const redirect = vi.fn();
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const { ready } = mountLoginPage(root, { https, fetch: f.fn, redirect });
  return { root, f, redirect, ready };
}

describe('formatFingerprint', () => {
  it('64 ký tự hex → nhóm hai, chữ hoa, cách bằng dấu hai chấm', () => {
    expect(formatFingerprint(FP)).toBe(FP.toUpperCase().match(/../g)!.join(':'));
  });
  it('dạng khác giữ nguyên', () => {
    expect(formatFingerprint('abc')).toBe('abc');
  });
});

describe('mountLoginPage', () => {
  it('HTTPS: biểu mẫu (autocomplete đúng), vân tay, liên kết /device.crt', async () => {
    const { root, ready } = mount(true);
    await ready;
    expect(root.querySelector('input[autocomplete="username"]')).not.toBeNull();
    expect(root.querySelector('input[autocomplete="current-password"]')).not.toBeNull();
    expect(root.querySelector('.login-fingerprint')?.textContent).toBe(formatFingerprint(FP));
    const a = root.querySelector('a.login-cert-link') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/device.crt');
    expect(a.hasAttribute('download')).toBe(true);
    expect(root.querySelector('h1')?.textContent).toBe('Đăng nhập mAT SCADA');
  });

  it('không lấy được vân tay: biểu mẫu vẫn dùng được, vân tay ẩn', async () => {
    const { root, ready } = mount(true, { 'GET /api/v1/device/identity': new Error('x') });
    await ready;
    expect((root.querySelector('.login-fingerprint') as HTMLElement).hidden).toBe(true);
    expect(root.querySelector('form')).not.toBeNull();
  });

  it('HTTP: chỉ thông báo cần HTTPS, không biểu mẫu, không gọi mạng', () => {
    const { root, f } = mount(false);
    expect(root.querySelector('form')).toBeNull();
    expect(root.textContent).toContain('HTTPS');
    expect(f.calls).toHaveLength(0);
  });

  it('đăng nhập đúng: POST web/login rồi chuyển về /; không lưu gì vào storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const { root, f, redirect, ready } = mount(true, {
      'POST /api/v1/web/login': { json: { user: 'vanhanh1', role: 'operator', csrfToken: 'C' } },
    });
    await ready;
    (root.querySelector('input[autocomplete="username"]') as HTMLInputElement).value = 'vanhanh1';
    (root.querySelector('input[autocomplete="current-password"]') as HTMLInputElement).value = 'mk';
    root
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(f.count('POST', '/api/v1/web/login')).toBe(1);
    expect(redirect).toHaveBeenCalledWith('/');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('đăng nhập sai: ở lại trang, hiện lỗi', async () => {
    const { root, redirect, ready } = mount(true, {
      'POST /api/v1/web/login': { status: 401, json: { error: 'AUTH_FAILED' } },
    });
    await ready;
    (root.querySelector('input[autocomplete="username"]') as HTMLInputElement).value = 'a';
    (root.querySelector('input[autocomplete="current-password"]') as HTMLInputElement).value = 'b';
    root
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();
    expect(redirect).not.toHaveBeenCalled();
    expect(root.querySelector('.login-error')?.textContent).toBe('Sai tài khoản hoặc mật khẩu');
  });
});
