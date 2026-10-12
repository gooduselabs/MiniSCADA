// Hộp thoại Đổi tên của cây (feature 006, T083/T084, FR-043): kênh, thiết bị trường, bảng giá trị, bảng theo dõi.
// Điền sẵn tên hiện tại, Enter đổi, lỗi hiện tại ô (role alert), Esc hủy; một bước hoàn tác.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, mount, newApp02, press, settled } from '../test-helpers.ts';
import './rename-dialog.ts';
import type { MatRenameDialog } from './rename-dialog.ts';

afterEach(cleanup);

async function open(nodeId: string) {
  const env = await newApp02();
  env.app.selectNode(nodeId, false);
  const el = await mount<MatRenameDialog>('mat-rename-dialog', env.app);
  await env.app.run('tree.rename');
  await settled();
  return { ...env, el };
}

const input = (el: Element) => el.querySelector<HTMLInputElement>('input[name="name"]')!;
const type = async (el: Element, text: string) => {
  const i = input(el);
  i.value = text;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await settled();
};

describe('mat-rename-dialog', () => {
  it('mở bằng lệnh Đổi tên: hộp thoại modal, ô tên điền sẵn tên hiện tại và có focus', async () => {
    const { app, el } = await open('channel:plc1');
    expect(app.ui.dialog).toEqual({ kind: 'rename' });
    const dlg = el.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.textContent).toContain('Đổi tên');
    expect(input(el).value).toBe('PLC trạm bơm');
    expect(document.activeElement).toBe(input(el));
    expect(el.textContent).toContain('Mã kênh không đổi');
  });

  it('Enter đổi tên: cây hiện tên mới, hộp thoại đóng, Ctrl+Z trả lại', async () => {
    const { app, el } = await open('channel:rs485-1');
    await type(el, 'RS485 tầng 2');
    press(input(el), 'Enter');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.outline.connections?.channels[1].name).toBe('RS485 tầng 2');
    expect(app.tree().children?.[2]).toBeDefined();
    await app.run('edit.undo');
    expect(app.store.state.outline.connections?.channels[1].name).toBe('RS485 đồng hồ điện');
  });

  it('thiết bị trường và bảng theo dõi: đổi tên hiển thị', async () => {
    const d = await open('fdev:meter2');
    await type(d.el, 'Công tơ 2');
    press(input(d.el), 'Enter');
    await settled();
    expect(d.app.store.state.outline.connections?.channels[1].devices[1].name).toBe('Công tơ 2');
    cleanup();
    const w = await open('watch:van-hanh');
    await type(w.el, 'Ca 2');
    press(input(w.el), 'Enter');
    await settled();
    expect(w.app.store.state.outline.watchTables[0].doc?.name).toBe('Ca 2');
  });

  it('bảng giá trị: đổi khóa; tên sai hiện lỗi tại ô và giữ hộp thoại', async () => {
    const { app, el } = await open('valuetable:TrangThaiBom');
    await type(el, '1sai');
    press(input(el), 'Enter');
    await settled();
    expect(app.ui.dialog).toEqual({ kind: 'rename' });
    expect(input(el).getAttribute('aria-invalid')).toBe('true');
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Tên bảng giá trị bắt đầu bằng chữ');
    expect(input(el).getAttribute('aria-describedby')).toBe(alert?.id);
    await type(el, 'TrangThaiMay');
    expect(el.querySelector('[role="alert"]')).toBeNull();
    press(input(el), 'Enter');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.outline.valueTables.map((v) => v.name)).toEqual(['TrangThaiMay']);
    expect(app.ui.treeSel).toBe('valuetable:TrangThaiMay');
  });

  it('Esc hủy: không đổi gì; nút Hủy cũng vậy; tên rỗng bị từ chối', async () => {
    const { app, el } = await open('channel:plc1');
    await type(el, 'Tên khác');
    press(el.querySelector('[role="dialog"]')!, 'Escape');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.outline.connections?.channels[0].name).toBe('PLC trạm bơm');
    await app.run('tree.rename');
    await settled();
    await type(el, '   ');
    press(input(el), 'Enter');
    await settled();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('không để trống');
    el.querySelector<HTMLButtonElement>('[data-role="cancel"]')!.click();
    await settled();
    expect(app.ui.dialog).toBeNull();
  });
});
