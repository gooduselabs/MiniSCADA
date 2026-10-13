import { afterEach, describe, expect, it } from 'vitest';
import './slider.ts';
import type { MatWSlider } from './slider.ts';
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

const rng = (el: HTMLElement) =>
  el.shadowRoot!.querySelector<HTMLInputElement>('input[type="range"]')!;
const drag = (el: HTMLElement, v: number) => {
  rng(el).value = String(v);
  rng(el).dispatchEvent(new Event('input', { bubbles: true }));
};
const release = (el: HTMLElement) => rng(el).dispatchEvent(new Event('change', { bubbles: true }));
const mk = (env = makeEnv(), props: Record<string, string | number> = {}) =>
  mount<MatWSlider>(env, 'slider', { props: { label: 'Tốc độ', ...props } });

describe('mat-w-slider', () => {
  it('input range có nhãn, min/max/step theo giao của widget và Tag', async () => {
    const el = await mk(makeEnv(), { min: 20, max: 200, step: 5 });
    expect(rng(el).getAttribute('aria-label')).toBe('Tốc độ');
    expect(rng(el).min).toBe('20');
    expect(rng(el).max).toBe('100');
    expect(rng(el).step).toBe('5');
    expectLiveRegion(el);
  });

  it('không có giới hạn nào thì 0–100', async () => {
    const env = makeEnv();
    env.source.define({ id: 'SP', type: 'FLOAT32', access: 'RW', kind: 'external' });
    const el = await mk(env);
    expect(rng(el).min).toBe('0');
    expect(rng(el).max).toBe('100');
  });

  it('thanh trượt đặt theo giá trị thật và đi theo khi giá trị đổi', async () => {
    const env = makeEnv();
    const el = await mk(env);
    expect(rng(el).value).toBe('10');
    env.source.set('SP', { value: 66 });
    await settle(el);
    expect(rng(el).value).toBe('66');
  });

  it('kéo (input) không ghi; hiện giá trị đang kéo cạnh giá trị thật', async () => {
    const env = makeEnv();
    const el = await mk(env);
    drag(el, 40);
    await settle(el);
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(0);
    const t = el.shadowRoot!.textContent!.replace(/\s+/g, ' ');
    expect(t).toMatch(/Đang kéo\s*40/);
    expect(t).toMatch(/Thực tế\s*10/);
  });

  it('thả (change) → hộp xác nhận → mới ghi', async () => {
    const env = makeEnv();
    const el = await mk(env);
    drag(el, 40);
    release(el);
    await settle(el);
    expect(dialog()).not.toBeNull();
    expect(env.host.writes).toHaveLength(0);
    dialogBtn('ok').click();
    await settle(el);
    expect(env.host.writes[0]).toMatchObject({ kind: 'write', tag: 'SP', value: 40 });
    env.host.resolve({ status: 'CONFIRMED' });
    await settle(el);
    expect(bannerText(el)).toContain('Đã ghi và xác nhận');
  });

  it('Hủy: thanh trượt trở lại giá trị thật', async () => {
    const el = await mk();
    drag(el, 40);
    release(el);
    await settle(el);
    dialogBtn('cancel').click();
    await settle(el);
    expect(rng(el).value).toBe('10');
    expect(el.shadowRoot!.textContent).not.toContain('Đang kéo');
  });

  it('XSS qua label', async () => {
    const evil = '<img src=x onerror="window.__sl=1">';
    const el = await mk(makeEnv(), { label: evil });
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(el.shadowRoot!.textContent).toContain(evil);
  });

  for (const [name, setup, text] of lockScenarios('SP')) {
    it(`khóa ${name}`, async () => {
      const env = makeEnv();
      setup(env);
      const el = await mk(env);
      expect(rng(el).disabled).toBe(true);
      expect(lockText(el)).toContain(text);
    });
  }

  it('edit: không ghi', async () => {
    const env = makeEnv();
    const el = await mount<MatWSlider>(env, 'slider', { mode: 'edit' });
    drag(el, 30);
    release(el);
    await settle(el);
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(0);
  });
});
