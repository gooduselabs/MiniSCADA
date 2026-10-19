// Hộp "Đổi mật khẩu của tôi" (feature 013, US2 AC7, FR-005): ba ô, chỉ báo độ dài 15–128, kiểm khớp, gọi
// session.changePassword, lỗi rõ theo mã, xóa mật khẩu khỏi DOM sau khi gửi.
import { describe, expect, it, vi } from 'vitest';
import { PasswordDialog, passwordHint } from './password-dialog.ts';
import type { PasswordResult } from './session.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));

function mount(result: PasswordResult | Promise<PasswordResult> = { ok: true }) {
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  const change = vi.fn(async () => result);
  const d = new PasswordDialog(root, { changePassword: change });
  d.open();
  const q = (sel: string) => d.dialog.querySelector(sel) as HTMLInputElement;
  const fill = (o: string, n: string, r = n) => {
    q('#pw-old').value = o;
    q('#pw-new').value = n;
    q('#pw-new').dispatchEvent(new Event('input'));
    q('#pw-repeat').value = r;
  };
  const submit = () =>
    d.dialog
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  return { d, change, q, fill, submit };
}

const NEW = 'mot-cau-de-nho-15';

describe('passwordHint', () => {
  it('ngắn, đủ, quá dài', () => {
    expect(passwordHint(3)).toMatchObject({ ok: false, text: 'Còn thiếu 12 ký tự' });
    expect(passwordHint(15)).toMatchObject({ ok: true, text: 'Đủ độ dài' });
    expect(passwordHint(129)).toMatchObject({ ok: false, text: 'Quá 128 ký tự' });
  });
});

describe('PasswordDialog', () => {
  it('ba ô có nhãn và autocomplete đúng, chỉ báo cập nhật khi gõ', () => {
    const { d, q, fill } = mount();
    expect(q('#pw-old').autocomplete).toBe('current-password');
    expect(q('#pw-new').autocomplete).toBe('new-password');
    expect(q('#pw-repeat').autocomplete).toBe('new-password');
    expect(d.dialog.querySelector('label[for="pw-new"]')?.textContent).toBe('Mật khẩu mới');
    fill('cu', 'abc');
    expect(d.dialog.querySelector('.pw-meter')?.textContent).toContain('Còn thiếu 12 ký tự');
    expect(d.dialog.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('3');
  });

  it('không khớp, quá ngắn, trùng mật khẩu cũ: không gọi máy chủ', async () => {
    const { change, fill, submit, d } = mount();
    fill('cu-123456789012345', NEW, NEW + 'x');
    submit();
    await flush();
    expect(d.dialog.querySelector('.login-error')?.textContent).toBe(
      'Hai lần nhập mật khẩu mới không khớp',
    );
    fill('cu', 'ngan');
    submit();
    fill(NEW, NEW);
    submit();
    expect(change).not.toHaveBeenCalled();
  });

  it('đúng: gọi changePassword, hiện thông báo xong, ô mật khẩu bị xóa', async () => {
    const { change, fill, submit, d, q } = mount();
    fill('cu-123456789012345', NEW);
    submit();
    expect(q('#pw-old').value).toBe('');
    expect(q('#pw-new').value).toBe('');
    await flush();
    expect(change).toHaveBeenCalledWith('cu-123456789012345', NEW);
    expect(d.dialog.textContent).toContain('Đã đổi mật khẩu');
  });

  it('REAUTH_REQUIRED, WEAK_PASSWORD kèm lý do', async () => {
    const m = mount({ ok: false, code: 'REAUTH_REQUIRED' });
    m.fill('sai-123456789012345', NEW);
    m.submit();
    await flush();
    expect(m.d.dialog.querySelector('.login-error')?.textContent).toBe(
      'Mật khẩu hiện tại không đúng',
    );
    const w = mount({ ok: false, code: 'WEAK_PASSWORD', reason: 'COMMON' });
    w.fill('cu-123456789012345', NEW);
    w.submit();
    await flush();
    expect(w.d.dialog.querySelector('.login-error')?.textContent).toContain('quá phổ biến');
  });

  it('Esc đóng hộp', () => {
    const { d } = mount();
    d.dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    expect(d.isOpen).toBe(false);
  });
});
