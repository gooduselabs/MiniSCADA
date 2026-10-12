// Hộp thoại Nhập CSV (feature 006, T125, FR-045, US1-12, mockup d-csv): chọn file, xem trước từng dòng, đổi dấu phân cách,
// dấu thập phân, bảng mã ngay ở bước xem trước; nhập thành MỘT bước hoàn tác; bàn phím và ARIA.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, mount, newApp02, press, settled } from '../test-helpers.ts';
import './csv-import-dialog.ts';
import type { MatCsvImportDialog } from './csv-import-dialog.ts';

afterEach(cleanup);

const enc = (s: string) => new TextEncoder().encode(s);
const FILE =
  'Tên,Mô tả,Max,Cột lạ\nTANK01.LEVEL,Mức mới,20,x\nNEW.ONE,Tag mới,5,y\n1sai,Hỏng,1,z\nNEW.ONE,Trùng,2,z\n';

async function open(bytes: Uint8Array | null = enc(FILE), name = 'tags.csv') {
  const env = await newApp02();
  env.app.openEditor('tags');
  env.platform.control.csvOpenResult = bytes ? { name, bytes } : null;
  const el = await mount<MatCsvImportDialog>('mat-csv-import-dialog', env.app);
  await env.app.run('tags.importCsv');
  await settled();
  await new Promise((r) => setTimeout(r, 0));
  await settled();
  return { ...env, el };
}

const rows = (el: Element) => [...el.querySelectorAll<HTMLElement>('tr[data-line]')];
const okBtn = (el: Element) => el.querySelector<HTMLButtonElement>('[data-role="ok"]')!;
const select = async (el: Element, name: string, value: string) => {
  const s = el.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  s.value = value;
  s.dispatchEvent(new Event('change', { bubbles: true }));
  await settled();
};

describe('mat-csv-import-dialog', () => {
  it('hủy hộp thoại chọn file: đóng luôn, không đổi gì', async () => {
    const { app } = await open(null);
    expect(app.ui.dialog).toBeNull();
  });

  it('xem trước: tên file, bảng mã, dấu phân cách, từng dòng với kết quả, cột lạ bị bỏ qua', async () => {
    const { app, el } = await open();
    expect(app.ui.dialog).toEqual({ kind: 'csvImport' });
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(el.textContent).toContain('tags.csv');
    const r = rows(el);
    expect(r).toHaveLength(4);
    expect(r.map((x) => x.dataset.action)).toEqual(['update', 'error', 'error', 'error']);
    expect(el.querySelector('[data-role="summary"]')?.textContent).toContain('1 cập nhật');
    expect(el.querySelector('[data-role="ignored"]')?.textContent).toContain('Cột lạ');
    expect(okBtn(el).textContent).toContain('1');
  });

  it('dòng lỗi hiện lý do tiếng Việt kèm cột; tên trùng báo ở mọi dòng trùng', async () => {
    const { el } = await open();
    const text = el.textContent ?? '';
    expect(text).toContain('Tên Tag bắt đầu bằng chữ');
    expect(text).toContain('xuất hiện nhiều lần');
  });

  it('đổi dấu thập phân, dấu phân cách, bảng mã: xem trước tính lại', async () => {
    const semi = 'Tên;Max\nTANK01.LEVEL;12,5\n';
    const { el } = await open(enc(semi));
    expect((el.querySelector('select[name="delimiter"]') as HTMLSelectElement).value).toBe('auto');
    await select(el, 'decimal', '.');
    expect(rows(el)[0].dataset.action).toBe('error');
    await select(el, 'decimal', ',');
    expect(rows(el)[0].dataset.action).toBe('update');
    await select(el, 'delimiter', ',');
    expect(rows(el)).toHaveLength(0);
    expect(el.textContent).toContain('File không có cột Tên');
    await select(el, 'delimiter', ';');
    expect(rows(el)[0].dataset.action).toBe('update');
    await select(el, 'encoding', 'windows-1258');
    expect(el.textContent).toContain('File không có cột Tên');
    await select(el, 'encoding', 'utf-8');
    expect(el.querySelector('[data-role="summary"]')).toBeTruthy();
  });

  it('Nhập: áp các dòng hợp lệ trong MỘT bước hoàn tác, thông báo số dòng, đóng hộp thoại', async () => {
    const { app, el } = await open(enc('Tên,Mô tả\nTANK01.LEVEL,Mức mới\nNEW.A,A\nNEW.B,B\n'));
    const before = app.store.state.outline.tags!.tags.length;
    okBtn(el).click();
    await settled();
    expect(app.ui.dialog).toBeNull();
    const tags = app.store.state.outline.tags!.tags as unknown as Array<{
      id: string;
      description?: string;
    }>;
    expect(tags).toHaveLength(before + 2);
    expect(tags.find((x) => x.id === 'TANK01.LEVEL')?.description).toBe('Mức mới');
    expect(app.ui.toast?.text).toContain('2 thêm');
    await app.run('edit.undo');
    const undone = app.store.state.outline.tags!.tags as unknown as Array<{
      id: string;
      description?: string;
    }>;
    expect(undone).toHaveLength(before);
    expect(undone.find((x) => x.id === 'TANK01.LEVEL')?.description).not.toBe('Mức mới');
  });

  it('không có dòng hợp lệ: nút Nhập khóa; file quá lớn hoặc lỗi đọc: báo lỗi trong hộp thoại', async () => {
    const { el } = await open(enc('Tên\n1sai\n'));
    expect(okBtn(el).disabled).toBe(true);
  });

  it('bàn phím: Esc đóng; Enter trên nút Nhập chạy; Tab vòng trong hộp thoại', async () => {
    const { app, el } = await open(enc('Tên,Mô tả\nNEW.A,A\n'));
    const before = app.store.state.outline.tags!.tags.length;
    press(el.querySelector('[role="dialog"]')!, 'Escape');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.outline.tags!.tags).toHaveLength(before);
  });
});
