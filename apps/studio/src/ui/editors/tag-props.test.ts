// Inspector › Thuộc tính của Tag (feature 006, T125, FR-047; phần 004 T066, FR-006): project 0.2 hiện mọi thuộc tính theo
// nhóm và cho sửa tại chỗ (một bước hoàn tác mỗi trường, lỗi tại trường); project 0.1 giữ dạng chỉ xem kèm "Dùng ở đâu".
import { render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { FakeSession } from '../fake-session.ts';
import { renderProps } from '../registry.ts';
import { cleanup, newApp, newApp02, settled } from '../test-helpers.ts';
import './tag-grid.ts';
import './tag-props.ts';

afterEach(cleanup);

const tags = (app: StudioApp) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (app.store.state.outline.tags?.tags ?? []) as unknown as Array<Record<string, any>>;

/** Vẽ nội dung tab Thuộc tính vào một phần tử gắn trong document. */
async function inspector(app: StudioApp): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const view = renderProps(app);
  expect(view).not.toBeNull();
  render(view!.body as never, host);
  await settled(host);
  return host;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowOf = (app: StudioApp, pred: (t: Record<string, any>) => boolean) =>
  tags(app).findIndex(pred);
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const field = (el: Element, col: string) =>
  el.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`#tp-${col}`);
async function change(el: Element, col: string, value: string) {
  const f = field(el, col)!;
  f.value = value;
  f.dispatchEvent(new Event('change', { bubbles: true }));
  await settled(el);
}

describe('inspector của Tag 0.2: nhóm thuộc tính và sửa tại chỗ', () => {
  it('Tag ngoài: nhóm Chung, Nguồn Modbus (mã hàm, offset, số thanh ghi), Thang đo, Giới hạn ghi', async () => {
    const { app } = await newApp02();
    const row = rowOf(app, (t) => t.kind === 'external' && t.type === 'FLOAT32');
    app.select({ kind: 'tag', row });
    const el = await inspector(app);
    const groups = [...el.querySelectorAll('.psec')].map((e) => text(e));
    expect(groups.slice(0, 2)).toEqual(['Chung', 'Nguồn Modbus']);
    expect(field(el, 'id')).not.toBeNull();
    expect(field(el, 'address')).not.toBeNull();
    expect(text(el.querySelector('[data-role="addr-info"]'))).toMatch(
      /Mã hàm 0\d.*offset \d+.*\d+ thanh ghi/,
    );
    expect(el.querySelector('#tp-fc')?.tagName).toBe('OUTPUT');
    expect(el.querySelector('#tp-offset')?.tagName).toBe('OUTPUT');
    expect(el.textContent).toContain('Dùng ở đâu');
  });

  it('sửa một trường: ghi MỘT bước hoàn tác; Ctrl+Z trả lại; địa chỉ chữ thường thành chữ hoa', async () => {
    const { app } = await newApp02();
    const row = rowOf(app, (t) => t.kind === 'external');
    app.select({ kind: 'tag', row });
    const el = await inspector(app);
    const before = app.store.state.history.past.length;
    await change(el, 'description', 'Mô tả mới');
    expect(tags(app)[row].description).toBe('Mô tả mới');
    await change(el, 'address', 'hr777');
    expect(tags(app)[row].source.address).toBe('HR777');
    expect(app.store.state.history.past.length).toBe(before + 2);
    await app.run('edit.undo');
    expect(tags(app)[row].source.address).not.toBe('HR777');
  });

  it('giá trị sai: lỗi tại trường (role alert, aria-invalid), không ghi gì; sửa đúng thì hết lỗi', async () => {
    const { app } = await newApp02();
    const row = rowOf(app, (t) => t.kind === 'external');
    app.select({ kind: 'tag', row });
    const el = await inspector(app);
    const before = app.store.state.history.past.length;
    await change(el, 'max', 'abc');
    expect(app.store.state.history.past.length).toBe(before);
    expect(field(el, 'max')?.getAttribute('aria-invalid')).toBe('true');
    expect(text(el.querySelector('#tp-max-e'))).toBe('Không phải số');
    expect(el.querySelector('#tp-max-e')?.getAttribute('role')).toBe('alert');
    await change(el, 'max', '250');
    expect(tags(app)[row].max).toBe(250);
    expect(el.querySelector('#tp-max-e')).toBeNull();
  });

  it('Tag tính toán: ô biểu thức nhiều dòng sửa được; không có nhóm Nguồn', async () => {
    const { app } = await newApp02();
    const row = rowOf(app, (t) => t.kind === 'calculated');
    app.select({ kind: 'tag', row });
    const el = await inspector(app);
    expect(field(el, 'expression')?.tagName).toBe('TEXTAREA');
    expect([...el.querySelectorAll('.psec')].map((e) => text(e))).not.toContain('Nguồn Modbus');
    await change(el, 'expression', '1 + 2');
    expect(tags(app)[row].expression).toBe('1 + 2');
  });

  it('Tag mô phỏng: kiểu và tham số theo kiểu; Tag nội bộ: giá trị đầu và giữ qua mất điện', async () => {
    const { app } = await newApp02();
    const sim = rowOf(app, (t) => t.kind === 'simulation');
    if (sim >= 0) {
      app.select({ kind: 'tag', row: sim });
      const el = await inspector(app);
      expect(field(el, 'simKind')).not.toBeNull();
    }
    const internal = rowOf(app, (t) => t.kind === 'internal');
    app.select({ kind: 'tag', row: internal });
    const el2 = await inspector(app);
    expect(field(el2, 'initial')).not.toBeNull();
    expect(field(el2, 'retain')?.tagName).toBe('SELECT');
    await change(el2, 'retain', 'Có');
    expect(tags(app)[internal].retain).toBe(true);
  });

  it('chỉ đọc (project 0.1 mở chỉ đọc): không có ô sửa', async () => {
    const { app } = await newApp();
    app.store.openReadOnly();
    app.select({ kind: 'tag', row: 0 });
    const el = await inspector(app);
    expect(el.querySelector('input, select, textarea')).toBeNull();
    expect(el.textContent).toContain('Dùng ở đâu');
  });

  it('Online: thêm dòng giá trị sống (cập nhật theo giá trị mới)', async () => {
    const session = new FakeSession();
    const { app } = await newApp02({ session });
    const row = rowOf(app, (t) => t.id === 'TANK01.LEVEL');
    session.fakeValues.set('TANK01.LEVEL', { value: 45.25, quality: 'GOOD', ts: 1 });
    app.select({ kind: 'tag', row });
    const el = await inspector(app);
    expect(text(el.querySelector('mat-tag-live'))).toContain('45,25');
    session.fakeValues.set('TANK01.LEVEL', { value: 50, quality: 'GOOD', ts: 2 });
    (app as unknown as { valueListeners: Set<(t: string[]) => void> }).valueListeners.forEach((l) =>
      l(['TANK01.LEVEL']),
    );
    await settled(el);
    expect(text(el.querySelector('mat-tag-live'))).toContain('50');
  });
});

describe('inspector của Tag 0.1 (dạng chỉ xem của 004)', () => {
  it('trường của Tag và "Dùng ở đâu"; Tag không dùng ở đâu', async () => {
    const { app } = await newApp();
    app.select({ kind: 'tag', row: 0 });
    const el = await inspector(app);
    expect(el.textContent).toContain('TANK01.LEVEL');
    expect(el.textContent).toContain('Dùng ở đâu');
    expect(el.querySelector('input, select, textarea')).toBeNull();
  });
});
