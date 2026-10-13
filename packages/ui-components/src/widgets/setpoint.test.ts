import { afterEach, describe, expect, it } from 'vitest';
import './setpoint.ts';
import type { MatWSetpoint } from './setpoint.ts';
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

const inp = (el: HTMLElement) => el.shadowRoot!.querySelector<HTMLInputElement>('input')!;
const type = (el: HTMLElement, text: string) => {
  inp(el).value = text;
  inp(el).dispatchEvent(new Event('input', { bubbles: true }));
};
const enter = (el: HTMLElement) =>
  inp(el).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
const errText = (el: HTMLElement) =>
  el.shadowRoot!.querySelector('[role="alert"]')?.textContent ?? '';
const mk = (env = makeEnv(), props: Record<string, string | number> = {}) =>
  mount<MatWSetpoint>(env, 'setpoint', { props: { label: 'Áp suất', ...props } });

describe('mat-w-setpoint', () => {
  it('ô inputmode=decimal có nhãn, hiện giá trị hiện tại và đơn vị của Tag', async () => {
    const el = await mk();
    expect(inp(el).getAttribute('inputmode')).toBe('decimal');
    expect(inp(el).getAttribute('aria-label')).toBe('Áp suất');
    expect(inp(el).value).toBe('10.0');
    expect(el.shadowRoot!.textContent).toContain('bar');
    expectLiveRegion(el);
  });

  it('decimals và unit của widget ghi đè', async () => {
    const el = await mk(makeEnv(), { decimals: 2, unit: 'kPa' });
    expect(inp(el).value).toBe('10.00');
    expect(el.shadowRoot!.textContent).toContain('kPa');
  });

  it('giá trị hiện tại cập nhật khi người dùng chưa gõ', async () => {
    const env = makeEnv();
    const el = await mk(env);
    env.source.set('SP', { value: 22.5 });
    await settle(el);
    expect(inp(el).value).toBe('22.5');
  });

  it('đang gõ thì không bị giá trị live ghi đè', async () => {
    const env = makeEnv();
    const el = await mk(env);
    type(el, '4');
    env.source.set('SP', { value: 22.5 });
    await settle(el);
    expect(inp(el).value).toBe('4');
  });

  it('XSS qua label', async () => {
    const evil = '<img src=x onerror="window.__p=1">';
    const el = await mk(makeEnv(), { label: evil });
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(evil);
  });

  it('Enter → hộp xác nhận → ghi', async () => {
    const env = makeEnv();
    const el = await mk(env);
    type(el, '55.5');
    enter(el);
    await settle(el);
    expect(dialog()).not.toBeNull();
    expect(env.host.writes).toHaveLength(0);
    dialogBtn('ok').click();
    await settle(el);
    expect(env.host.writes[0]).toMatchObject({ kind: 'write', tag: 'SP', value: 55.5 });
    env.host.resolve({ status: 'CONFIRMED' });
    await settle(el);
    expect(bannerText(el)).toContain('Đã ghi và xác nhận');
  });

  it('nút Ghi cho người dùng con trỏ cũng đi qua xác nhận', async () => {
    const env = makeEnv();
    const el = await mk(env);
    type(el, '30');
    el.shadowRoot!.querySelector<HTMLButtonElement>('button[data-write]')!.click();
    await settle(el);
    expect(dialog()).not.toBeNull();
  });

  it('dấu phẩy bị từ chối với câu "Dùng dấu chấm thập phân"', async () => {
    const env = makeEnv();
    const el = await mk(env);
    type(el, '12,5');
    enter(el);
    await settle(el);
    expect(errText(el)).toContain('Dùng dấu chấm thập phân');
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(0);
  });

  it('chữ không phải số bị từ chối', async () => {
    const el = await mk();
    type(el, 'abc');
    enter(el);
    await settle(el);
    expect(errText(el)).toContain('không phải số');
  });

  it('ngoài giới hạn của Tag', async () => {
    const el = await mk();
    type(el, '150');
    enter(el);
    await settle(el);
    expect(errText(el)).toContain('Ngoài giới hạn 0–100');
    expect(dialog()).toBeNull();
  });

  it('giới hạn = giao của widget và Tag', async () => {
    const el = await mk(makeEnv(), { min: 20, max: 200 });
    type(el, '10');
    enter(el);
    await settle(el);
    expect(errText(el)).toContain('Ngoài giới hạn 20–100');
    type(el, '20');
    enter(el);
    await settle(el);
    expect(dialog()).not.toBeNull();
  });

  it('bước: giá trị không là bội của step bị từ chối', async () => {
    const el = await mk(makeEnv(), { step: 5, decimals: 0 });
    type(el, '12');
    enter(el);
    await settle(el);
    expect(errText(el)).toContain('bội số của 5');
    expect(dialog()).toBeNull();
    type(el, '15');
    enter(el);
    await settle(el);
    expect(dialog()).not.toBeNull();
  });

  it('bước mặc định theo decimals', async () => {
    const el = await mk(makeEnv(), { decimals: 1 });
    type(el, '12.34');
    enter(el);
    await settle(el);
    expect(errText(el)).toContain('bội số của 0.1');
    type(el, '12.3');
    enter(el);
    await settle(el);
    expect(dialog()).not.toBeNull();
  });

  it('Hủy hộp: ô nhập trở lại giá trị thật', async () => {
    const el = await mk();
    type(el, '40');
    enter(el);
    await settle(el);
    dialogBtn('cancel').click();
    await settle(el);
    expect(inp(el).value).toBe('10.0');
  });

  it('sửa ô nhập xóa lỗi cũ', async () => {
    const el = await mk();
    type(el, '150');
    enter(el);
    await settle(el);
    type(el, '15');
    await settle(el);
    expect(errText(el)).toBe('');
  });

  for (const [name, setup, text] of lockScenarios('SP')) {
    it(`khóa ${name}: ô tắt và hiện lý do`, async () => {
      const env = makeEnv();
      setup(env);
      const el = await mk(env);
      expect(inp(el).disabled).toBe(true);
      expect(lockText(el)).toContain(text);
      enter(el);
      await settle(el);
      expect(dialog()).toBeNull();
    });
  }

  it('edit: ô chỉ đọc, Enter không làm gì', async () => {
    const env = makeEnv();
    const el = await mount<MatWSetpoint>(env, 'setpoint', { mode: 'edit' });
    type(el, '40');
    enter(el);
    await settle(el);
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(0);
  });
});
