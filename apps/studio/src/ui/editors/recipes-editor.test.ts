// Editor Recipe (feature 024, US1): ba vùng (loại, lưới bảng tính, thuộc tính), ô theo bản recipe, sửa tại ô, lỗi giới
// hạn tô đỏ, kéo Tag thêm tham số (Tag chỉ đọc bị từ chối), thêm/sao chép/xóa bản, hoàn tác một bước, project 1.0 bị khóa.
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { readProjectDir, REPO } from '../../model/test-fixtures.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './recipes-editor.ts';
import type { RecipesEditor } from './recipes-editor.ts';

afterEach(cleanup);

const v11 = () => readProjectDir(resolve(REPO, 'tests/project-vectors/v11-recipe-valid'));
const cell = (el: Element, r: number, c: string) =>
  el.querySelector<HTMLElement>(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`);
const ta = (el: Element) => el.querySelector<HTMLTextAreaElement>('textarea.mg-input')!;
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const type0 = (app: StudioApp) => app.store.state.outline.recipes!.types[0]!;

async function open(files = v11()) {
  const env = await newApp02({ files });
  env.app.openEditor('recipe:lo-say');
  const el = await mount<RecipesEditor>('mat-recipes-editor', env.app);
  el.typeId = 'lo-say';
  await settled(el);
  return { ...env, el };
}
async function click(el: Element, r: number, c: string) {
  cell(el, r, c)!.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await settled(el);
}
async function typeCell(el: Element, r: number, c: string, value: string) {
  await click(el, r, c);
  ta(el).value = value;
  ta(el).dispatchEvent(new InputEvent('input', { data: value, bubbles: true }));
  await settled(el);
  ta(el).dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await settled(el);
}
const tool = (el: Element, act: string) =>
  el.querySelector<HTMLButtonElement>(`button[data-act="${act}"]`)!;

function dropTag(el: Element, id: string) {
  const zone = el.querySelector('[data-role="drop"]')!;
  const store = new Map([['application/x-mat-tag', id]]);
  const dt = {
    types: [...store.keys()],
    getData: (k: string) => store.get(k) ?? '',
    dropEffect: 'none',
  } as unknown as DataTransfer;
  for (const type of ['dragover', 'drop']) {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    zone.dispatchEvent(ev);
  }
}

describe('mat-recipes-editor', () => {
  it('ba vùng: danh sách loại, lưới (cột cố định + mỗi bản một cột), thuộc tính', async () => {
    const { el } = await open();
    expect(text(el.querySelector('h2'))).toBe('Lò sấy');
    expect(el.querySelectorAll('.rc-types li')).toHaveLength(1);
    const heads = [...el.querySelectorAll('[role="columnheader"]')].map(text);
    expect(heads).toEqual(['Tham số', 'Tag', 'Đơn vị', 'Min', 'Max', 'Mùa hè', 'Mùa đông']);
    expect(text(cell(el, 0, 'tag'))).toBe('TANK01.SP');
    expect(text(cell(el, 0, 'r0'))).toBe('55.5');
    expect(text(cell(el, 1, 'r0'))).toBe('1');
    expect(el.querySelector('[data-role="type-props"]')).not.toBeNull();
    expect(text(el.querySelector('[data-role="count"]'))).toBe('5 tham số · 2 bản');
  });

  it('sửa ô như bảng tính; ngoài giới hạn tô đỏ; hoàn tác một bước', async () => {
    const { el, app } = await open();
    await typeCell(el, 0, 'r1', '75');
    expect(type0(app).recipes[1]!.values['TANK01.SP']).toBe(75);
    await typeCell(el, 0, 'r1', '85');
    await app.store.idle();
    await settled(el);
    expect(cell(el, 0, 'r1')!.className).toMatch(/err/);
    app.store.undo();
    await settled(el);
    expect(type0(app).recipes[1]!.values['TANK01.SP']).toBe(75);
    expect(el.querySelector('[data-role="recipe-props"]')).not.toBeNull();
  });

  it('kéo Tag: Tag ghi được thành tham số mới, Tag chỉ đọc bị từ chối', async () => {
    const { el, app } = await open();
    dropTag(el, 'SEL.TAB');
    await settled(el);
    expect(type0(app).params.map((p) => p.tagId)).toContain('SEL.TAB');
    expect(type0(app).recipes[0]!.values['SEL.TAB']).toBe(0);
    dropTag(el, 'TANK01.LEVEL');
    await settled(el);
    expect(type0(app).params.map((p) => p.tagId)).not.toContain('TANK01.LEVEL');
  });

  it('thêm, sao chép, xóa bản', async () => {
    const { el, app } = await open();
    tool(el, 'add-recipe').click();
    await settled(el);
    expect(type0(app).recipes).toHaveLength(3);
    await click(el, 0, 'r0');
    tool(el, 'dup-recipe').click();
    await settled(el);
    expect(type0(app).recipes.map((r) => r.id)).toEqual([
      'mua-he',
      'mua-he-copy',
      'mua-dong',
      'ban-3',
    ]);
    await click(el, 0, 'r1');
    tool(el, 'del-recipe').click();
    await settled(el);
    expect(type0(app).recipes).toHaveLength(3);
  });

  it('project 1.0: biểu ngữ cần 1.1, không thêm được loại', async () => {
    const { el } = await open(
      readProjectDir(resolve(REPO, 'tests/project-vectors/v10-valid-full')),
    );
    expect(text(el.querySelector('.empty'))).toContain('1.1');
    expect(tool(el, 'add-type').getAttribute('aria-disabled')).toBe('true');
  });
});
