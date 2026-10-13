// Hộp Đăng nhập (feature 007, FR-039, FR-049, SC-015): mở/đóng, focus, Esc, mật khẩu không nằm lại trong DOM.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginDialog } from './login-dialog.ts';
import { WebSession } from './session.ts';
import { fakeFetch } from './testing.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));

function make(routes: Parameters<typeof fakeFetch>[0] = {}) {
  const f = fakeFetch({
    'POST /api/v1/web/login': { json: { user: 'vanhanh1', role: 'operator', csrfToken: 'C' } },
    ...routes,
  });
  const session = new WebSession({ fetch: f.fn, https: true });
  const root = document.createElement('div');
  const opener = document.createElement('button');
  document.body.replaceChildren(opener, root);
  const onSuccess = vi.fn();
  const dlg = new LoginDialog(root, session, onSuccess);
  return { f, session, dlg, opener, onSuccess };
}
const q = (d: LoginDialog, sel: string) => d.dialog.querySelector(sel) as HTMLInputElement;
const submit = (d: LoginDialog) =>
  q(d, 'form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));

beforeEach(() => {
  document.body.replaceChildren();
});

describe('LoginDialog', () => {
  it('mở: dialog hiện, được gắn nhãn bằng tiêu đề, focus vào ô tài khoản', () => {
    const { dlg, opener } = make();
    opener.focus();
    dlg.open();
    expect(dlg.isOpen).toBe(true);
    const t = document.getElementById(dlg.dialog.getAttribute('aria-labelledby')!);
    expect(t?.textContent).toBe('Đăng nhập');
    expect(document.activeElement).toBe(q(dlg, 'input[autocomplete="username"]'));
  });

  it('Hủy: đóng, xóa mật khẩu, trả focus cho nút đã mở', () => {
    const { dlg, opener } = make();
    opener.focus();
    dlg.open();
    q(dlg, 'input[type="password"]').value = 'abc';
    (q(dlg, 'button[type="button"]') as unknown as HTMLButtonElement).click();
    expect(dlg.isOpen).toBe(false);
    expect(q(dlg, 'input[type="password"]').value).toBe('');
    expect(document.activeElement).toBe(opener);
  });

  it('Esc (sự kiện cancel của <dialog>) đóng hộp và bị chặn mặc định để tự đóng', () => {
    const { dlg } = make();
    dlg.open();
    const ev = new Event('cancel', { cancelable: true });
    dlg.dialog.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(dlg.isOpen).toBe(false);
  });

  it('đăng nhập đúng: phiên có, hộp đóng, onSuccess được gọi, ô mật khẩu trống', async () => {
    const { dlg, session, onSuccess } = make();
    dlg.open();
    q(dlg, 'input[autocomplete="username"]').value = 'vanhanh1';
    q(dlg, 'input[type="password"]').value = 'mk';
    submit(dlg);
    expect(q(dlg, 'input[type="password"]').value).toBe('');
    await flush();
    expect(session.info).toEqual({ user: 'vanhanh1', role: 'operator' });
    expect(dlg.isOpen).toBe(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('đăng nhập sai: hộp ở lại, có lỗi; mở lại thì lỗi được xóa', async () => {
    const { dlg } = make({
      'POST /api/v1/web/login': { status: 401, json: { error: 'AUTH_FAILED' } },
    });
    dlg.open();
    q(dlg, 'input[autocomplete="username"]').value = 'a';
    q(dlg, 'input[type="password"]').value = 'b';
    submit(dlg);
    await flush();
    expect(dlg.isOpen).toBe(true);
    expect((q(dlg, '.login-error') as HTMLElement).hidden).toBe(false);
    dlg.close();
    dlg.open();
    expect((q(dlg, '.login-error') as HTMLElement).hidden).toBe(true);
  });

  it('mở hai lần không dựng thêm', () => {
    const { dlg } = make();
    dlg.open();
    dlg.open();
    expect(document.querySelectorAll('dialog')).toHaveLength(1);
  });
});
