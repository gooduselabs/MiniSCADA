import { afterEach, describe, expect, it, vi } from 'vitest';
import './switch.ts';
import type { MatWSwitch } from './switch.ts';
import {
  bannerText,
  dialog,
  dialogBtn,
  expectLiveRegion,
  lockScenarios,
  lockText,
  makeEnv,
  mount,
  settle,
} from './control-test-util.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

const sw = (el: HTMLElement) => el.shadowRoot!.querySelector<HTMLElement>('[role="switch"]')!;
const mk = (env = makeEnv(), props: Record<string, string> = {}) =>
  mount<MatWSwitch>(env, 'switch', { tag: 'RUN', props: { label: 'Bơm 1', ...props } });

describe('mat-w-switch', () => {
  it('role=switch, aria-checked theo giá trị thật, chữ Bật/Tắt theo props', async () => {
    const env = makeEnv();
    const el = await mk(env, { onText: 'Chạy', offText: 'Dừng' });
    expect(sw(el).getAttribute('aria-checked')).toBe('false');
    expect(sw(el).textContent).toContain('Dừng');
    expect(sw(el).getAttribute('aria-label')).toBe('Bơm 1');
    env.source.set('RUN', { value: true });
    await settle(el);
    expect(sw(el).getAttribute('aria-checked')).toBe('true');
    expect(sw(el).textContent).toContain('Chạy');
    expectLiveRegion(el);
  });

  it('mặc định Bật/Tắt', async () => {
    const el = await mk();
    expect(sw(el).textContent).toContain('Tắt');
  });

  it('XSS qua label', async () => {
    const evil = '<img src=x onerror="window.__s=1">';
    const el = await mk(makeEnv(), { label: evil });
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(evil);
  });

  it('nhấp → hộp xác nhận → ghi giá trị đối lập kèm expect', async () => {
    const env = makeEnv();
    const el = await mk(env);
    sw(el).click();
    await settle(el);
    expect(dialog()).not.toBeNull();
    dialogBtn('ok').click();
    await settle(el);
    expect(env.host.writes[0]).toMatchObject({
      kind: 'toggle',
      tag: 'RUN',
      value: true,
      expect: false,
    });
  });

  it('bàn phím: Space và Enter kích hoạt', async () => {
    const env = makeEnv();
    const el = await mk(env);
    sw(el).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await settle(el);
    expect(dialog()).not.toBeNull();
  });

  it('"đang chuyển" tới khi đọc lại khớp', async () => {
    const env = makeEnv();
    const el = await mk(env);
    sw(el).click();
    await settle(el);
    dialogBtn('ok').click();
    await settle(el);
    expect(sw(el).getAttribute('aria-busy')).toBe('true');
    expect(sw(el).textContent).toContain('Đang chuyển');
    expect(sw(el).getAttribute('aria-checked')).toBe('false');
    env.host.resolve({ status: 'ACCEPTED' });
    await settle(el);
    expect(sw(el).textContent).toContain('Đang chuyển');
    env.host.resolve({ status: 'CONFIRMED' });
    await settle(el);
    // Đã CONFIRMED nhưng Tag chưa đọc lại giá trị mới: vẫn đang chuyển.
    expect(sw(el).textContent).toContain('Đang chuyển');
    env.source.set('RUN', { value: true });
    await settle(el);
    expect(sw(el).textContent).not.toContain('Đang chuyển');
    expect(sw(el).getAttribute('aria-checked')).toBe('true');
    expect(sw(el).getAttribute('aria-busy')).not.toBe('true');
  });

  it('hết thời gian chờ đọc lại thì thôi "đang chuyển"', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    const env = makeEnv();
    const el = await mk(env);
    sw(el).click();
    await vi.advanceTimersByTimeAsync(0);
    await el.updateComplete;
    dialogBtn('ok').click();
    await vi.advanceTimersByTimeAsync(0);
    env.host.resolve({ status: 'CONFIRMED' });
    await vi.advanceTimersByTimeAsync(0);
    expect(sw(el).textContent).toContain('Đang chuyển');
    await vi.advanceTimersByTimeAsync(11_000);
    await el.updateComplete;
    expect(sw(el).textContent).not.toContain('Đang chuyển');
  });

  it('ghi bị từ chối: thôi "đang chuyển" ngay, kết quả lỗi hiện', async () => {
    const env = makeEnv();
    const el = await mk(env);
    sw(el).click();
    await settle(el);
    dialogBtn('ok').click();
    await settle(el);
    env.host.resolve({ status: 'REJECTED', code: 'CONNECTION_BAD' });
    await settle(el);
    expect(sw(el).textContent).not.toContain('Đang chuyển');
    expect(bannerText(el)).toContain('Mất kết nối với thiết bị');
  });

  it('confirm none: ghi thẳng không hộp', async () => {
    const env = makeEnv();
    const el = await mount<MatWSwitch>(env, 'switch', { tag: 'RUN', props: { confirm: 'none' } });
    sw(el).click();
    await settle(el);
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(1);
  });

  for (const [name, setup, text] of lockScenarios('RUN')) {
    it(`khóa ${name}`, async () => {
      const env = makeEnv();
      setup(env);
      const el = await mk(env);
      expect(sw(el).getAttribute('aria-disabled')).toBe('true');
      expect(lockText(el)).toContain(text);
      sw(el).click();
      await settle(el);
      expect(dialog()).toBeNull();
    });
  }

  it('edit: không hành động', async () => {
    const env = makeEnv();
    const el = await mount<MatWSwitch>(env, 'switch', { tag: 'RUN', mode: 'edit' });
    sw(el).click();
    await settle(el);
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(0);
  });
});
