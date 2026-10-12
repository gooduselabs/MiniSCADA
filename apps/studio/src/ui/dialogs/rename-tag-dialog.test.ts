// Hộp thoại Đổi tên Tag (T188, FR-047, D32, US4-12, mockup d-ren): xem danh sách chỗ sẽ đổi (biểu thức, bảng theo dõi, nhóm lưu
// trữ, binding) rồi xác nhận; cả lần đổi là MỘT bước hoàn tác; từ chối tên đã có hoặc sai luật.
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { cleanup, mount, newApp02, press, settled } from '../test-helpers.ts';
import './rename-tag-dialog.ts';
import type { MatRenameTagDialog } from './rename-tag-dialog.ts';

afterEach(cleanup);

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** TANK02.LEVEL dùng ở hai biểu thức và một bảng theo dõi (US4-12). */
async function open(tagId = 'TANK02.LEVEL', to?: string) {
  const env = await newApp02();
  env.app.store.edit([
    {
      kind: 'tagUpsert',
      tag: {
        id: 'TANK02.LEVEL',
        kind: 'external',
        type: 'FLOAT32',
        source: { device: 'plc1', address: 'HR300' },
      },
    },
    {
      kind: 'tagUpsert',
      tag: { id: 'T2.X2', kind: 'calculated', type: 'FLOAT64', expression: 'TANK02.LEVEL * 2' },
    },
    {
      kind: 'tagUpsert',
      tag: { id: 'T2.HI', kind: 'calculated', type: 'BOOL', expression: 'TANK02.LEVEL > 80' },
    },
    {
      kind: 'watchTableUpsert',
      table: {
        schemaVersion: '0.2.0',
        id: 'van-hanh',
        name: 'Vận hành',
        rows: [{ tag: 'TANK01.SP' }, { tag: 'TANK02.LEVEL' }],
      },
    },
  ]);
  await env.app.store.idle();
  env.app.openDialog({ kind: 'renameTag', tagId, ...(to ? { to } : {}) });
  const el = await mount<MatRenameTagDialog>('mat-rename-tag-dialog', env.app);
  await settled(el);
  return { ...env, el };
}

const input = (el: Element) => el.querySelector<HTMLInputElement>('input[name="to"]')!;
const ok = (el: Element) => el.querySelector<HTMLButtonElement>('button[data-role="ok"]')!;
const type = async (el: Element, v: string) => {
  const i = input(el);
  i.value = v;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await settled(el);
};
const tags = (app: StudioApp) =>
  (app.store.state.outline.tags?.tags ?? []) as unknown as {
    id: string;
    expression?: string;
  }[];
const errors = (app: StudioApp) => app.store.state.issues.filter((i) => i.code.startsWith('E_'));

describe('mat-rename-tag-dialog: xem trước', () => {
  it('hộp thoại modal: tên cũ, ô tên mới điền sẵn và có focus; chưa đổi tên thì chưa có danh sách và nút khóa', async () => {
    const { el } = await open();
    const dlg = el.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(text(dlg)).toContain('Đổi tên Tag');
    expect(text(el.querySelector('[data-role="from"]'))).toBe('TANK02.LEVEL');
    expect(input(el).value).toBe('TANK02.LEVEL');
    expect(document.activeElement).toBe(input(el));
    expect(el.querySelector('[data-role="hits"]')).toBeNull();
    expect(ok(el).getAttribute('aria-disabled')).toBe('true');
  });

  it('gõ tên mới: liệt kê đúng 3 chỗ (hai biểu thức, một bảng theo dõi)', async () => {
    const { el } = await open();
    await type(el, 'BON2.MUC');
    expect(text(el.querySelector('[data-role="count"]'))).toContain('3 chỗ');
    const items = [...el.querySelectorAll('[data-role="hits"] li')].map(text);
    expect(items).toEqual([
      'Biểu thức của T2.X2',
      'Biểu thức của T2.HI',
      'Bảng theo dõi › Vận hành (dòng 2)',
    ]);
    expect(ok(el).getAttribute('aria-disabled')).toBeNull();
  });

  it('tên đã có, tên sai luật: báo lỗi tại ô (role alert) và khóa nút; cùng tên cũ thì chỉ khóa nút', async () => {
    const { el } = await open();
    await type(el, 'TANK01.LEVEL');
    expect(input(el).getAttribute('aria-invalid')).toBe('true');
    expect(text(el.querySelector('[role="alert"]'))).toContain('đã có');
    expect(ok(el).getAttribute('aria-disabled')).toBe('true');
    await type(el, '1abc');
    expect(text(el.querySelector('[role="alert"]'))).toContain('không hợp lệ');
    await type(el, 'a b');
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    await type(el, 'TANK02.LEVEL');
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(ok(el).getAttribute('aria-disabled')).toBe('true');
  });

  it('Tag chưa ai dùng: báo "không có chỗ nào khác", vẫn đổi được', async () => {
    const { el } = await open('DEMO.WAVE');
    await type(el, 'SP_CAO');
    expect(text(el)).toContain('Không có chỗ nào khác dùng Tag này');
    expect(ok(el).getAttribute('aria-disabled')).toBeNull();
  });

  it('mở từ ô tên của Bảng Tag với tên gõ sẵn (to): ô mới điền sẵn và danh sách hiện ngay', async () => {
    const { el } = await open('TANK02.LEVEL', 'BON2.MUC');
    expect(input(el).value).toBe('BON2.MUC');
    expect(el.querySelectorAll('[data-role="hits"] li')).toHaveLength(3);
  });
});

describe('mat-rename-tag-dialog: xác nhận và hoàn tác', () => {
  it('Enter xác nhận: đổi hết (Tag, biểu thức, bảng theo dõi), không còn lỗi tham chiếu, MỘT Ctrl+Z trả lại tất cả', async () => {
    const { app, el } = await open();
    const past = app.store.state.history.past.length;
    await type(el, 'BON2.MUC');
    press(input(el), 'Enter');
    await settled();
    await app.store.idle();
    expect(app.ui.dialog).toBeNull();
    expect(tags(app).some((x) => x.id === 'TANK02.LEVEL')).toBe(false);
    expect(tags(app).find((x) => x.id === 'BON2.MUC')).toBeDefined();
    expect(tags(app).find((x) => x.id === 'T2.X2')!.expression).toBe('BON2.MUC * 2');
    expect(tags(app).find((x) => x.id === 'T2.HI')!.expression).toBe('BON2.MUC > 80');
    expect(app.store.state.outline.watchTables[0]!.doc!.rows.map((r) => r.tag)).toEqual([
      'TANK01.SP',
      'BON2.MUC',
    ]);
    expect(errors(app)).toEqual([]);
    expect(app.ui.toast?.text).toContain('3 chỗ');
    expect(app.store.state.history.past.length).toBe(past + 1);
    await app.run('edit.undo');
    await app.store.idle();
    expect(tags(app).find((x) => x.id === 'TANK02.LEVEL')).toBeDefined();
    expect(tags(app).find((x) => x.id === 'BON2.MUC')).toBeUndefined();
    expect(tags(app).find((x) => x.id === 'T2.X2')!.expression).toBe('TANK02.LEVEL * 2');
    expect(app.store.state.outline.watchTables[0]!.doc!.rows[1]!.tag).toBe('TANK02.LEVEL');
    expect(errors(app)).toEqual([]);
  });

  it('Tag có binding: file binding đổi theo (nội dung chờ ghi), hoàn tác trả lại file và hết "chưa lưu" của nó', async () => {
    const { app, el } = await open('TANK01.LEVEL');
    const file = app.store.state.outline.screens[0]!.bindingFile!;
    await type(el, 'BON1.MUC');
    expect([...el.querySelectorAll('[data-role="hits"] li')].map(text)).toContain(
      'Main › el_aaa (Mức chất lỏng)',
    );
    press(input(el), 'Enter');
    await settled();
    await app.store.idle();
    const after = app.store.textOf(file);
    expect(after).toContain('BON1.MUC');
    expect(after).not.toContain('"TANK01.LEVEL"');
    expect(app.dirtyFiles()).toContain(file);
    expect(errors(app)).toEqual([]);
    await app.run('edit.undo');
    await app.store.idle();
    expect(app.store.textOf(file)).toContain('TANK01.LEVEL');
    expect(app.dirtyFiles()).not.toContain(file);
  });

  it('nút Đổi tên bằng chuột; Esc và Hủy không đổi gì', async () => {
    const { app, el } = await open();
    await type(el, 'BON2.MUC');
    press(el.querySelector('[role="dialog"]')!, 'Escape');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(tags(app).find((x) => x.id === 'TANK02.LEVEL')).toBeDefined();
    app.openDialog({ kind: 'renameTag', tagId: 'TANK02.LEVEL' });
    await settled(el);
    await type(el, 'BON2.MUC');
    ok(el).click();
    await settled();
    expect(tags(app).find((x) => x.id === 'BON2.MUC')).toBeDefined();
  });

  it('chữ gõ qua bộ gõ: Enter trong lúc ghép chưa xác nhận', async () => {
    const { app, el } = await open();
    await type(el, 'BON2.MUC');
    input(el).dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settled();
    expect(app.ui.dialog?.kind).toBe('renameTag');
  });
});

describe('lệnh Đổi tên Tag', () => {
  it('tags.rename mở hộp thoại cho Tag đang chọn; khóa kèm lý do khi chưa chọn Tag', async () => {
    const env = await newApp02();
    expect(env.app.enabled('tags.rename')).toBe('reason.noTag');
    env.app.select({ kind: 'tag', row: 0 });
    expect(env.app.enabled('tags.rename')).toBe(true);
    await env.app.run('tags.rename');
    expect(env.app.ui.dialog).toEqual({ kind: 'renameTag', tagId: 'TANK01.LEVEL' });
  });
});
