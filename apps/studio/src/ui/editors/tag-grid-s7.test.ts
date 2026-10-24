// Bảng Tag với Tag của CPU Siemens S7 (feature 016, US4): dòng gợi ý theo định dạng S7 (vùng, kiểu S7, số byte), lỗi địa chỉ
// S7 bằng tiếng Việt tại ô, cột Mã hàm/Offset/Số thanh ghi và Thứ tự byte trống với Tag S7, Inspector không có thứ tự byte.
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { readProjectDir, REPO } from '../../model/test-fixtures.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './tag-grid.ts';
import type { TagGrid } from './tag-grid.ts';

afterEach(cleanup);

const v11S7 = () => readProjectDir(resolve(REPO, 'tests/project-vectors/v11-s7-valid-channel'));
const cell = (el: Element, r: number, c: string) =>
  el.querySelector<HTMLElement>(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`);
const ta = (el: Element) => el.querySelector<HTMLTextAreaElement>('textarea.mg-input')!;
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const tags = (app: StudioApp) =>
  (app.store.state.outline.tags?.tags ?? []) as unknown as Array<{
    id: string;
    source?: { address?: string };
  }>;

async function openGrid() {
  const made = await newApp02({ files: v11S7() });
  made.app.openEditor('tags');
  // Bộ cột "tất cả" để có cả Thứ tự byte.
  const el = await mount<TagGrid>('mat-tag-grid', made.app);
  await settled(el);
  const sel = el.querySelector<HTMLSelectElement>('select[data-role="set"]')!;
  sel.value = 'all';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  await settled(el);
  return { ...made, el };
}

async function click(el: Element, r: number, c: string) {
  cell(el, r, c)!.scrollIntoView?.();
  cell(el, r, c)!.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await settled(el);
}

async function typeText(el: Element, value: string) {
  const input = ta(el);
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { data: value, bubbles: true }));
  await settled(el);
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await settled(el);
}

const rowOf = (app: StudioApp, id: string) => tags(app).findIndex((x) => x.id === id);

/** Lưới ảo chỉ vẽ dòng đang thấy: lọc để Tag cần xem lên đầu. */
async function only(el: Element, id: string) {
  const filter = el.querySelector<HTMLInputElement>('input[data-role="filter"]')!;
  filter.value = id;
  filter.dispatchEvent(new Event('input', { bubbles: true }));
  await settled(el);
}

describe('mat-tag-grid: Tag của CPU Siemens S7', () => {
  it('ô địa chỉ của Tag S7: gợi ý vùng, kiểu S7, số byte; cột Modbus và thứ tự byte trống', async () => {
    const { app, el } = await openGrid();
    await only(el, 'S7.DB_REAL');

    const r = rowOf(app, 'S7.DB_REAL');
    await click(el, r, 'address');
    expect(text(el.querySelector('[data-role="addr-hint"]'))).toBe(
      'Vùng DB · kiểu S7 REAL · 4 byte',
    );
    expect(text(cell(el, r, 'fc'))).toBe('');
    expect(text(cell(el, r, 'regs'))).toBe('');
    expect(text(cell(el, r, 'byteOrder'))).toBe('');
  });

  it('địa chỉ S7 sai: lỗi tiếng Việt với ví dụ S7; địa chỉ đúng được chuẩn hóa', async () => {
    const { app, el } = await openGrid();
    await only(el, 'S7.DB_REAL');

    const r = rowOf(app, 'S7.DB_REAL');
    await click(el, r, 'address');
    await typeText(el, 'DB1.DBX4');
    expect(tags(app)[r]!.source?.address).toBe('DB1.DBX4');
    await click(el, r, 'address');
    const err = el.querySelector('[data-role="addr-hint"]');
    expect(err?.classList.contains('field-err')).toBe(true);
    expect(text(err)).toContain('DB1.DBX0.0, DB1.DBW2, DB1.DBD4, DB1.STRING10, MW10, I0.1, Q0.0');
    await typeText(el, 'db001.dbd016');
    expect(tags(app)[r]!.source?.address).toBe('DB1.DBD16');
  });
});
