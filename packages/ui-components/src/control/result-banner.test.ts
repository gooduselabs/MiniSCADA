import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WriteOutcome } from '../host/types.ts';
import type { ControlState, Draft } from './controller.ts';
import { MatResultBanner } from './result-banner.ts';

const draft = {} as Draft;

async function mount(state: ControlState | null, canDismiss = true) {
  const el = new MatResultBanner();
  el.state = state;
  el.canDismiss = canDismiss;
  const onDismiss = vi.fn();
  el.onDismiss = onDismiss;
  document.body.append(el);
  await el.updateComplete;
  const root = el.shadowRoot!;
  return {
    el,
    root,
    onDismiss,
    live: () => root.querySelector('[aria-live]')!,
    text: () => root.querySelector('[aria-live]')!.textContent ?? '',
    btn: () => root.querySelector<HTMLButtonElement>('button'),
  };
}
const res = (outcome: WriteOutcome): ControlState => ({ phase: 'result', outcome, draft });

afterEach(() => document.body.replaceChildren());

describe('mat-result-banner', () => {
  it('vùng aria-live="polite" luôn có, kể cả khi trống', async () => {
    const m = await mount({ phase: 'ready' });
    expect(m.live().getAttribute('aria-live')).toBe('polite');
    expect(m.text().trim()).toBe('');
    expect(m.btn()).toBeNull();
  });

  it('sending: "Đang gửi…", ACCEPTED: đang chờ đọc lại', async () => {
    const s: ControlState = { phase: 'sending', requestId: 'r', draft, since: 0, accepted: false };
    const m = await mount(s);
    expect(m.text()).toContain('Đang gửi…');
    m.el.state = { ...s, accepted: true };
    await m.el.updateComplete;
    expect(m.text()).toContain('đang chờ đọc lại');
  });

  it('CONFIRMED: xanh, biểu tượng, tự mất nên không nút Đóng', async () => {
    const m = await mount(res({ status: 'CONFIRMED' }));
    expect(m.text()).toContain('Đã ghi và xác nhận');
    expect(m.root.querySelector('.sev-ok')).not.toBeNull();
    expect(m.root.querySelector('.icon')?.textContent).toBeTruthy();
    expect(m.btn()).toBeNull();
  });

  it('REJECTED: đỏ, lý do dịch và mã, nút Đóng', async () => {
    const m = await mount(res({ status: 'REJECTED', code: 'CONNECTION_BAD' }));
    expect(m.root.querySelector('.sev-error')).not.toBeNull();
    expect(m.text()).toContain('Mất kết nối với thiết bị');
    expect(m.text()).toContain('CONNECTION_BAD');
    m.btn()!.click();
    expect(m.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('RATE_LIMITED kèm thời gian thử lại', async () => {
    const m = await mount(res({ status: 'REJECTED', code: 'RATE_LIMITED', retryAfterMs: 2500 }));
    expect(m.text()).toContain('2.5 s');
  });

  it('TIMEOUT: hổ phách và câu cảnh báo', async () => {
    const m = await mount(res({ status: 'TIMEOUT', code: 'WRITE_TIMEOUT' }));
    expect(m.root.querySelector('.sev-warn')).not.toBeNull();
    expect(m.text()).toContain('Không chắc đã ghi, kiểm tra giá trị thực trước khi thử lại');
  });

  it('FAILED: đỏ kèm mã', async () => {
    const m = await mount(res({ status: 'FAILED', code: 'READBACK_MISMATCH' }));
    expect(m.root.querySelector('.sev-error')).not.toBeNull();
    expect(m.text()).toContain('READBACK_MISMATCH');
  });

  it('UNKNOWN: cảnh báo, nút Đóng tắt khi canDismiss = false', async () => {
    const m = await mount(res({ status: 'UNKNOWN' }), false);
    expect(m.text()).toContain('Không rõ kết quả');
    expect(m.btn()!.disabled).toBe(true);
    m.el.canDismiss = true;
    await m.el.updateComplete;
    expect(m.btn()!.disabled).toBe(false);
  });

  it('XSS: message của BL335 hiện dạng chữ', async () => {
    const evil = '<img src=x onerror="window.__y=1">';
    const m = await mount(res({ status: 'REJECTED', message: evil }));
    expect(m.root.querySelector('img')).toBeNull();
    expect(m.text()).toContain(evil);
  });
});
