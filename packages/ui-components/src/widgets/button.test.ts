import { afterEach, describe, expect, it } from 'vitest';
import './button.ts';
import type { MatWButton } from './button.ts';
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

afterEach(() => document.body.replaceChildren());

const btn = (el: HTMLElement) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-main]')!;
const writeEv = { click: { action: 'write', value: true } } as const;

describe('mat-w-button: hiển thị', () => {
  it('là <button> có nhãn và biến thể', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', {
      tag: 'RUN',
      props: { label: 'Bật bơm', variant: 'danger' },
      events: writeEv,
    });
    expect(btn(el).textContent?.trim()).toBe('Bật bơm');
    expect(btn(el).classList.contains('danger')).toBe(true);
    expect(btn(el).getAttribute('aria-label')).toBe('Bật bơm');
    expectLiveRegion(el);
  });

  it('biến thể mặc định primary', async () => {
    const el = await mount<MatWButton>(makeEnv(), 'button', { tag: 'RUN', events: writeEv });
    expect(btn(el).classList.contains('primary')).toBe(true);
  });

  it('XSS: label hiện dạng chữ', async () => {
    const evil = '<img src=x onerror="window.__b=1"><script>window.__b=2</script>';
    const el = await mount<MatWButton>(makeEnv(), 'button', {
      tag: 'RUN',
      props: { label: evil },
      events: writeEv,
    });
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.querySelector('script')).toBeNull();
    expect(btn(el).textContent).toContain(evil);
  });

  it('XSS: confirmText hiện dạng chữ trong hộp xác nhận', async () => {
    const evil = '<img src=x onerror="window.__c=1">';
    const el = await mount<MatWButton>(makeEnv(), 'button', {
      tag: 'RUN',
      props: { label: 'x', confirmText: evil },
      events: writeEv,
    });
    btn(el).click();
    await settle(el);
    const root = dialog()!.shadowRoot!;
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[data-text]')?.textContent).toBe(evil);
  });
});

describe('mat-w-button: hành động ghi', () => {
  it('write: nhấp → hộp xác nhận → Xác nhận → host.write với context và requestId', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', {
      tag: 'RUN',
      props: { label: 'Bật' },
      events: writeEv,
    });
    btn(el).click();
    await settle(el);
    expect(dialog()).not.toBeNull();
    expect(env.host.writes).toHaveLength(0);
    expect(btn(el).disabled).toBe(true);
    dialogBtn('ok').click();
    await settle(el);
    expect(env.host.writes).toHaveLength(1);
    expect(env.host.writes[0]).toMatchObject({
      kind: 'write',
      tag: 'RUN',
      value: true,
      context: { screen: 's1', widget: 'w1' },
    });
    expect((env.host.writes[0] as { requestId?: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(dialog()).toBeNull();
    expect(bannerText(el)).toContain('Đang gửi…');
    env.host.resolve({ status: 'ACCEPTED' });
    await settle(el);
    expect(bannerText(el)).toContain('đang chờ đọc lại');
    env.host.resolve({ status: 'CONFIRMED' });
    await settle(el);
    expect(bannerText(el)).toContain('Đã ghi và xác nhận');
  });

  it('Hủy: đóng hộp, không ghi, trả focus về nút', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', {
      tag: 'RUN',
      events: writeEv,
      props: { label: 'x' },
    });
    btn(el).click();
    await settle(el);
    dialogBtn('cancel').click();
    await settle(el);
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(0);
    expect(btn(el).disabled).toBe(false);
  });

  it('toggle: ghi giá trị đối lập kèm expect', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', {
      tag: 'RUN',
      events: { click: { action: 'toggle' } },
    });
    btn(el).click();
    await settle(el);
    dialogBtn('ok').click();
    await settle(el);
    expect(env.host.writes[0]).toMatchObject({
      kind: 'toggle',
      tag: 'RUN',
      value: true,
      expect: false,
    });
  });

  it('pulse: kèm pulseMs', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', {
      tag: 'RUN',
      events: { click: { action: 'pulse', value: true, durationMs: 800 } },
    });
    btn(el).click();
    await settle(el);
    dialogBtn('ok').click();
    await settle(el);
    expect(env.host.writes[0]).toMatchObject({ kind: 'pulse', value: true, pulseMs: 800 });
  });

  it('confirm none với Tag BOOL: ghi thẳng, không hộp', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', {
      tag: 'RUN',
      props: { confirm: 'none' },
      events: writeEv,
    });
    btn(el).click();
    await settle(el);
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(1);
  });

  it('confirm none không có tác dụng với Tag số: vẫn có hộp', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', {
      props: { confirm: 'none' },
      events: { click: { action: 'write', value: 50 } },
    });
    btn(el).click();
    await settle(el);
    expect(dialog()).not.toBeNull();
    expect(env.host.writes).toHaveLength(0);
  });

  it('giá trị ghi sai giới hạn: hiện lỗi, không hộp', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', {
      events: { click: { action: 'write', value: 500 } },
    });
    btn(el).click();
    await settle(el);
    expect(dialog()).toBeNull();
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      'Ngoài giới hạn 0–100',
    );
  });

  it('kết quả lỗi nằm lại tới khi đóng; lần bấm thứ hai bị chặn', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', {
      tag: 'RUN',
      props: { confirm: 'none' },
      events: writeEv,
    });
    btn(el).click();
    await settle(el);
    env.host.resolve({ status: 'REJECTED', code: 'RATE_LIMITED', retryAfterMs: 1000 });
    await settle(el);
    expect(bannerText(el)).toContain('Ghi quá nhanh');
    btn(el).click();
    await settle(el);
    expect(env.host.writes).toHaveLength(1);
    el.shadowRoot!.querySelector('mat-result-banner')!.shadowRoot!.querySelector('button')!.click();
    await settle(el);
    expect(bannerText(el)).not.toContain('Ghi quá nhanh');
    expect(btn(el).disabled).toBe(false);
  });
});

describe('mat-w-button: điều hướng', () => {
  it('navigate, popup, closePopup gọi host, không hộp, không cần phiên', async () => {
    const env = makeEnv();
    env.host.sessionInfo = null;
    for (const [ev, call] of [
      [{ action: 'navigate', screen: 's2' }, 'navigate:s2'],
      [{ action: 'popup', screen: 'p1' }, 'popup:p1'],
      [{ action: 'closePopup' }, 'closePopup'],
    ] as const) {
      const el = await mount<MatWButton>(env, 'button', { noTarget: true, events: { click: ev } });
      expect(btn(el).disabled).toBe(false);
      btn(el).click();
      await settle(el);
      expect(env.host.calls.at(-1)).toBe(call);
      el.remove();
    }
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(0);
  });
});

describe('mat-w-button: khóa', () => {
  for (const [name, setup, text] of lockScenarios('RUN')) {
    it(`${name}: nút tắt và hiện "${text}"`, async () => {
      const env = makeEnv();
      setup(env);
      const el = await mount<MatWButton>(env, 'button', { tag: 'RUN', events: writeEv });
      expect(btn(el).disabled).toBe(true);
      expect(lockText(el)).toContain(text);
      btn(el).click();
      await settle(el);
      expect(dialog()).toBeNull();
      expect(env.host.writes).toHaveLength(0);
    });
  }

  it('minRole engineer: operator bị khóa "Cần quyền engineer"', async () => {
    const el = await mount<MatWButton>(makeEnv(), 'button', {
      tag: 'RUN',
      events: writeEv,
      security: { minRole: 'engineer' },
    });
    expect(lockText(el)).toContain('Cần quyền engineer');
  });

  it('mất kết nối sau khi dựng: khóa ngay', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', { tag: 'RUN', events: writeEv });
    expect(btn(el).disabled).toBe(false);
    env.source.setConnection('stale');
    await settle(el);
    expect(btn(el).disabled).toBe(true);
    expect(lockText(el)).toContain('Mất kết nối dữ liệu');
  });

  it('UNCERTAIN không khóa', async () => {
    const env = makeEnv();
    env.source.set('RUN', { quality: 'UNCERTAIN' });
    const el = await mount<MatWButton>(env, 'button', { tag: 'RUN', events: writeEv });
    expect(btn(el).disabled).toBe(false);
  });

  it('hộp ở widget khác đang mở: khóa OTHER_DIALOG', async () => {
    const env = makeEnv();
    const a = await mount<MatWButton>(env, 'button', { tag: 'RUN', events: writeEv });
    const b = await mount<MatWButton>(env, 'button', { tag: 'RUN', events: writeEv });
    btn(a).click();
    await settle(a);
    await settle(b);
    expect(btn(b).disabled).toBe(true);
    expect(lockText(b)).toContain('hộp xác nhận khác');
    dialogBtn('cancel').click();
    await settle(b);
    expect(btn(b).disabled).toBe(false);
  });

  it('khóa xuất hiện giữa chừng: nút Xác nhận tắt, hiện lý do, không gửi', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', { tag: 'RUN', events: writeEv });
    btn(el).click();
    await settle(el);
    env.source.set('RUN', { quality: 'BAD' });
    await settle(el);
    expect(dialogBtn('ok').disabled).toBe(true);
    expect(dialog()!.shadowRoot!.querySelector('[role="alert"]')?.textContent).toContain(
      'Quality BAD',
    );
    dialogBtn('ok').click();
    expect(env.host.writes).toHaveLength(0);
  });
});

describe('mat-w-button: chế độ edit', () => {
  it('không phát hành động, không hộp', async () => {
    const env = makeEnv();
    const el = await mount<MatWButton>(env, 'button', {
      tag: 'RUN',
      mode: 'edit',
      props: { label: 'Bật' },
      events: { click: { action: 'navigate', screen: 's2' } },
    });
    expect(btn(el).textContent?.trim()).toBe('Bật');
    btn(el).click();
    await settle(el);
    expect(env.host.calls).toHaveLength(0);
    expect(dialog()).toBeNull();
    const w = await mount<MatWButton>(env, 'button', { tag: 'RUN', mode: 'edit', events: writeEv });
    btn(w).click();
    await settle(w);
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(0);
  });
});
