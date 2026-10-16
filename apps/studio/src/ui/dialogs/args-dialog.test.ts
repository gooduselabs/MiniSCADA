// Hộp `args` của hành động Mở popup (feature 011, T171; FR-123, FR-126): đúng bộ tham số của popup đích, kiểm kiểu ngay
// khi gõ, báo thiếu và thừa như bộ kiểm (E_POPUP_ARGS), xem trước Tag bung tĩnh (Tag không có bị đánh dấu), áp một bước
// hoàn tác; nút của bản sao template chỉ xem (args lấy từ {tham số} của template).
import { resolve } from 'node:path';
import type { ScreenModel } from '@mat/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { readProjectDir, REPO } from '../../model/test-fixtures.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './args-dialog.ts';
import type { MatArgsDialog } from './args-dialog.ts';

afterEach(cleanup);

async function open(screen: string, item: string, patch?: (files: Record<string, string>) => void) {
  const files = readProjectDir(resolve(REPO, 'tests/project-vectors/v10-valid-full'));
  delete files['expected.json'];
  patch?.(files);
  const env = await newApp02({ files });
  const el = await mount<MatArgsDialog>('mat-args-dialog', env.app);
  env.app.openDialog({ kind: 'popupArgs', screen, item });
  await settled();
  return { ...env, el };
}

/** Nút "btn_pump" của màn hình main mở popup `bom-chi-tiet` (faceplate prefix, title). */
const toFaceplate = (files: Record<string, string>) => {
  files['screens/main.screen.json'] = files['screens/main.screen.json']!.replace(
    '"screen": "pump"',
    '"screen": "bom-chi-tiet"',
  );
};

const click = (app: Awaited<ReturnType<typeof open>>['app']) =>
  (app.screenModel('main') as ScreenModel).items.find((i) => i.id === 'btn_pump') as {
    events?: { click?: unknown };
  };
const input = (el: Element, name: string) =>
  el.querySelector<HTMLInputElement>(`input[name="a-${name}"]`)!;
const typeIn = async (i: HTMLInputElement, v: string) => {
  i.value = v;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await settled();
};
const ok = (el: Element) => el.querySelector<HTMLButtonElement>('[data-role="ok"]')!;

describe('mat-args-dialog', () => {
  it('đúng bộ tham số của popup đích; thiếu prefix (không default) khóa Áp dụng', async () => {
    const { el } = await open('main', 'btn_pump', toFaceplate);
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect([...el.querySelectorAll('tbody tr')].map((r) => r.getAttribute('data-param'))).toEqual([
      'prefix',
      'title',
    ]);
    expect(input(el, 'title').placeholder).toBe('Bơm');
    expect(input(el, 'prefix').getAttribute('aria-invalid')).toBe('true');
    expect(ok(el).disabled).toBe(true);
  });

  it('giá trị sai kiểu báo tại ô; đúng thì xem trước Tag và áp args (một bước hoàn tác)', async () => {
    const { app, el } = await open('main', 'btn_pump', toFaceplate);
    await typeIn(input(el, 'prefix'), 'PUMP 07');
    expect(input(el, 'prefix').getAttribute('aria-invalid')).toBe('true');
    expect(ok(el).disabled).toBe(true);
    await typeIn(input(el, 'prefix'), 'PUMP07');
    await typeIn(input(el, 'title'), 'Bơm 7');
    expect(ok(el).disabled).toBe(false);
    const tags = el.querySelector('[data-k="tags"]')!.textContent!;
    expect(tags).toContain('PUMP07.FLOW');
    expect(tags).toContain('PUMP07.RUN_CMD');
    expect(tags).not.toContain('không có');
    ok(el).click();
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(click(app).events?.click).toEqual({
      action: 'popup',
      screen: 'bom-chi-tiet',
      args: { prefix: 'PUMP07', title: 'Bơm 7' },
    });
    await app.run('edit.undo');
    expect(click(app).events?.click).toEqual({ action: 'popup', screen: 'bom-chi-tiet' });
  });

  it('Tag không có trong project được đánh dấu', async () => {
    const { el } = await open('main', 'btn_pump', toFaceplate);
    await typeIn(input(el, 'prefix'), 'PUMP99');
    expect(el.querySelector('[data-k="tags"] .bad')?.textContent).toContain('PUMP99.FLOW');
  });

  it('args thừa: báo lỗi và bỏ được', async () => {
    const { el } = await open('main', 'btn_pump', (f) => {
      toFaceplate(f);
      f['screens/main.screen.json'] = f['screens/main.screen.json']!.replace(
        '"screen": "bom-chi-tiet"',
        '"screen": "bom-chi-tiet", "args": { "prefix": "PUMP07", "speed": "1" }',
      );
    });
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('speed');
    expect(ok(el).disabled).toBe(true);
    el.querySelector<HTMLButtonElement>('[data-act="drop-extra"]')!.click();
    await settled();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(ok(el).disabled).toBe(false);
  });

  it('nút của bản sao template: chỉ xem, không áp', async () => {
    const { el } = await open('main', 'pump7.detail');
    expect(input(el, 'prefix').readOnly).toBe(true);
    expect(input(el, 'prefix').value).toBe('PUMP07');
    expect(ok(el).disabled).toBe(true);
    expect(el.textContent).toContain('Nút thuộc bản sao template');
  });
});
