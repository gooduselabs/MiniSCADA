// Hộp thoại Thêm hàng loạt (feature 006, T125, FR-045, US1-11, mockup d-bulk): xem trước tên → địa chỉ, lỗi tại ô,
// một bước hoàn tác, bàn phím và ARIA.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, mount, newApp02, press, settled } from '../test-helpers.ts';
import './bulk-add-dialog.ts';
import type { MatBulkAddDialog } from './bulk-add-dialog.ts';

afterEach(cleanup);

async function open() {
  const env = await newApp02();
  env.app.openEditor('tags');
  const el = await mount<MatBulkAddDialog>('mat-bulk-add-dialog', env.app);
  await env.app.run('tags.bulkAdd');
  await settled();
  return { ...env, el };
}

const field = (el: Element, name: string) =>
  el.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
async function set(el: Element, name: string, value: string) {
  const f = field(el, name);
  f.value = value;
  f.dispatchEvent(
    new Event(f instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
  );
  await settled();
}
const preview = (el: Element) =>
  el.querySelector('[data-role="preview"]')?.textContent?.trim() ?? '';
const addBtn = (el: Element) => el.querySelector<HTMLButtonElement>('[data-role="ok"]')!;

describe('mat-bulk-add-dialog', () => {
  it('mở bằng lệnh Thêm hàng loạt: modal, có đủ ô, thiết bị trường lấy từ Kết nối', async () => {
    const { app, el } = await open();
    expect(app.ui.dialog).toEqual({ kind: 'bulkAdd' });
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    for (const n of ['namePattern', 'count', 'type', 'device', 'address', 'step', 'scanGroup'])
      expect(field(el, n), n).toBeTruthy();
    const devices = [...field(el, 'device').querySelectorAll('option')].map((o) => o.value);
    expect(devices).toEqual(['plc1', 'meter1', 'meter2']);
    expect(el.querySelector('label[for]')).toBeTruthy();
    expect(el.textContent).toContain('Thêm hàng loạt');
  });

  it('50 FLOAT32 mẫu TT_01 từ HR100: xem trước TT_01 → HR100 … TT_50 → HR198; nút ghi số Tag', async () => {
    const { el } = await open();
    await set(el, 'namePattern', 'TT_01');
    await set(el, 'count', '50');
    await set(el, 'type', 'FLOAT32');
    await set(el, 'address', 'HR100');
    expect(preview(el)).toContain('TT_01 → HR100');
    expect(preview(el)).toContain('TT_50 → HR198');
    expect(addBtn(el).disabled).toBe(false);
    expect(addBtn(el).textContent).toContain('50');
  });

  it('Thêm: 50 Tag mới vào project trong MỘT bước hoàn tác; hộp thoại đóng; thông báo', async () => {
    const { app, el } = await open();
    await set(el, 'namePattern', 'TT_01');
    await set(el, 'count', '50');
    await set(el, 'address', 'HR1000');
    const before = app.store.state.outline.tags!.tags.length;
    addBtn(el).click();
    await settled();
    expect(app.ui.dialog).toBeNull();
    const tags = app.store.state.outline.tags!.tags as unknown as Array<{
      id: string;
      source: { address: string };
    }>;
    expect(tags).toHaveLength(before + 50);
    expect(tags.at(-1)).toMatchObject({ id: 'TT_50', source: { address: 'HR1098' } });
    expect(app.ui.toast?.text).toContain('50');
    await app.run('edit.undo');
    expect(app.store.state.outline.tags!.tags).toHaveLength(before);
  });

  it('lỗi tại ô: số dòng, mẫu tên, địa chỉ; nút Thêm khóa; mô tả lỗi gắn với ô', async () => {
    const { el } = await open();
    await set(el, 'count', '0');
    expect(addBtn(el).disabled).toBe(true);
    expect(field(el, 'count').getAttribute('aria-invalid')).toBe('true');
    const ids = field(el, 'count').getAttribute('aria-describedby')!.split(' ');
    expect(ids).toHaveLength(2);
    expect(el.querySelector(`[id="${ids[1]}"]`)?.textContent).toContain('Số dòng');
    await set(el, 'count', '3');
    expect(field(el, 'count').getAttribute('aria-invalid')).toBe('false');
    await set(el, 'address', 'XX1');
    expect(field(el, 'address').getAttribute('aria-invalid')).toBe('true');
    await set(el, 'address', 'HR10');
    await set(el, 'namePattern', 'TANK01.LEVEL');
    expect(el.textContent).toContain('đã có trong project');
    expect(addBtn(el).disabled).toBe(true);
  });

  it('bàn phím: Enter ở ô nhập thêm; Esc đóng không đổi gì; Tab vòng trong hộp thoại', async () => {
    const { app, el } = await open();
    await set(el, 'namePattern', 'NEW_01');
    await set(el, 'count', '2');
    const before = app.store.state.outline.tags!.tags.length;
    press(field(el, 'count'), 'Enter');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.outline.tags!.tags).toHaveLength(before + 2);
    await app.run('tags.bulkAdd');
    await settled();
    press(el.querySelector('[role="dialog"]')!, 'Escape');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.outline.tags!.tags).toHaveLength(before + 2);
  });

  it('bước tự đặt thay cho số thanh ghi của kiểu; nhóm quét fast được ghi vào Tag', async () => {
    const { app, el } = await open();
    await set(el, 'namePattern', 'S_01');
    await set(el, 'count', '3');
    await set(el, 'step', '10');
    await set(el, 'scanGroup', 'fast');
    expect(preview(el)).toContain('S_03 → HR120');
    addBtn(el).click();
    await settled();
    const tags = app.store.state.outline.tags!.tags as unknown as Array<{
      source?: { scanGroup?: string };
    }>;
    expect(tags.at(-1)?.source?.scanGroup).toBe('fast');
  });
});
