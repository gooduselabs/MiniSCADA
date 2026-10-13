import { afterEach, describe, expect, it } from 'vitest';
import './select.ts';
import type { MatWSelect } from './select.ts';
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

const sel = (el: HTMLElement) => el.shadowRoot!.querySelector<HTMLSelectElement>('select')!;
const pick = (el: HTMLElement, v: string) => {
  sel(el).value = v;
  sel(el).dispatchEvent(new Event('change', { bubbles: true }));
};
const mk = (env = makeEnv(), props: Record<string, string> = {}, tag = 'MODE') =>
  mount<MatWSelect>(env, 'select', { tag, props: { label: 'Chế độ', ...props } });

describe('mat-w-select', () => {
  it('mục theo bảng giá trị của Tag, chọn mục khớp giá trị thật', async () => {
    const el = await mk();
    const texts = [...sel(el).options].map((o) => o.textContent?.trim());
    expect(texts).toEqual(['Dừng', 'Chạy', 'Tự động']);
    expect(sel(el).value).toBe('1');
    expect(sel(el).getAttribute('aria-label')).toBe('Chế độ');
    expectLiveRegion(el);
  });

  it('props.table ghi đè bảng của Tag', async () => {
    const env = makeEnv();
    env.source.setConnection('live');
    const other = {
      entries: [
        { value: 0, text: 'A' },
        { value: 1, text: 'B' },
      ],
    };
    (env.source as unknown as { valueTable(n: string): unknown }).valueTable = (n: string) =>
      n === 'OTHER' ? other : undefined;
    const el = await mk(env, { table: 'OTHER' });
    expect([...sel(el).options].map((o) => o.textContent?.trim())).toEqual(['A', 'B']);
  });

  it('giá trị thật không có trong bảng: hiện mục "—" chọn sẵn, không ghi', async () => {
    const env = makeEnv();
    env.source.set('MODE', { value: 9 });
    const el = await mk(env);
    expect(sel(el).selectedOptions[0]?.textContent?.trim()).toBe('—');
    expect(sel(el).selectedOptions[0]?.disabled).toBe(true);
  });

  it('giá trị live đổi thì mục chọn đổi theo', async () => {
    const env = makeEnv();
    const el = await mk(env);
    env.source.set('MODE', { value: 2 });
    await settle(el);
    expect(sel(el).value).toBe('2');
  });

  it('chọn mục → hộp xác nhận (giá trị theo bảng) → ghi giá trị của mục', async () => {
    const env = makeEnv();
    const el = await mk(env);
    pick(el, '2');
    await settle(el);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.shadowRoot!.textContent).toMatch(/Chạy\s*→\s*Tự động/);
    expect(env.host.writes).toHaveLength(0);
    dialogBtn('ok').click();
    await settle(el);
    expect(env.host.writes[0]).toMatchObject({ kind: 'write', tag: 'MODE', value: 2 });
    env.host.resolve({ status: 'CONFIRMED' });
    await settle(el);
    expect(bannerText(el)).toContain('Đã ghi và xác nhận');
  });

  it('Hủy: mục chọn trở lại giá trị thật', async () => {
    const el = await mk();
    pick(el, '0');
    await settle(el);
    dialogBtn('cancel').click();
    await settle(el);
    expect(sel(el).value).toBe('1');
  });

  it('Tag BOOL với bảng: ghi boolean', async () => {
    const env = makeEnv();
    env.source.define({
      id: 'RUN',
      type: 'BOOL',
      access: 'RW',
      kind: 'external',
      valueTable: 'ONOFF',
    });
    (env.source as unknown as { valueTable(n: string): unknown }).valueTable = () => ({
      entries: [
        { value: false, text: 'Ngắt' },
        { value: true, text: 'Nối' },
      ],
    });
    const el = await mk(env, {}, 'RUN');
    expect([...sel(el).options].map((o) => o.textContent?.trim())).toEqual(['Ngắt', 'Nối']);
    expect(sel(el).value).toBe('0');
    pick(el, '1');
    await settle(el);
    dialogBtn('ok').click();
    await settle(el);
    expect(env.host.writes[0]).toMatchObject({ tag: 'RUN', value: true });
  });

  it('không có bảng: không mục, select tắt', async () => {
    const el = await mk(makeEnv(), {}, 'SP');
    expect(sel(el).options.length).toBe(0);
    expect(sel(el).disabled).toBe(true);
  });

  it('XSS: chữ của mục và label hiện dạng chữ', async () => {
    const evil = '<img src=x onerror="window.__se=1">';
    const env = makeEnv();
    (env.source as unknown as { valueTable(n: string): unknown }).valueTable = () => ({
      entries: [{ value: 1, text: evil }],
    });
    const el = await mk(env, { label: evil });
    expect(el.shadowRoot!.querySelector('img')).toBeNull();
    expect(sel(el).options[0]?.textContent).toContain(evil);
  });

  for (const [name, setup, text] of lockScenarios('MODE')) {
    it(`khóa ${name}`, async () => {
      const env = makeEnv();
      setup(env);
      const el = await mk(env);
      expect(sel(el).disabled).toBe(true);
      expect(lockText(el)).toContain(text);
    });
  }

  it('edit: không ghi', async () => {
    const env = makeEnv();
    const el = await mount<MatWSelect>(env, 'select', { tag: 'MODE', mode: 'edit' });
    pick(el, '2');
    await settle(el);
    expect(dialog()).toBeNull();
    expect(env.host.writes).toHaveLength(0);
  });
});
