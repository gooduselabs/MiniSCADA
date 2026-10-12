// Editor Bảng giá trị (T186, FR-048, FR-046, US4-7, US4-8, mockup studio-tags.html v-vt): lưới mục (giá trị hoặc khoảng, chữ, màu),
// dòng mặc định, ô thử, lỗi theo ô (chồng nhau, khoảng rỗng, chữ dài, màu sai), bộ chọn màu, "Dùng ở đâu"; lưới dùng chung
// (chọn ô, gõ qua bộ gõ, hoàn tác như Bảng Tag).
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './value-table-editor.ts';
import type { ValueTableEditor } from './value-table-editor.ts';

afterEach(cleanup);

const cell = (el: Element, r: number, c: string) =>
  el.querySelector<HTMLElement>(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`);
const ta = (el: Element) => el.querySelector<HTMLTextAreaElement>('textarea.mg-input')!;
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const entries = (app: StudioApp) => app.store.state.outline.valueTables[0]!.doc!.entries;
const doc = (app: StudioApp) => app.store.state.outline.valueTables[0]!.doc!;

async function open(name = 'TrangThaiBom') {
  const env = await newApp02();
  env.app.openEditor(`vt:${name}`);
  const el = await mount<ValueTableEditor>('mat-value-table-editor', env.app);
  el.tableName = name;
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
const key = async (target: Element, k: string, init: KeyboardEventInit = {}) => {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
  await settled(target);
};
async function typeCell(el: Element, r: number, c: string, value: string) {
  await click(el, r, c);
  ta(el).value = value;
  ta(el).dispatchEvent(new InputEvent('input', { data: value, bubbles: true }));
  await settled(el);
  await key(ta(el), 'Enter');
}
async function typeInto(el: Element, input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await settled(el);
}
const tryBox = (el: Element) => el.querySelector<HTMLInputElement>('input[data-role="try"]')!;
const tryResult = (el: Element) => el.querySelector('[data-role="try-result"]')!;

describe('mat-value-table-editor: bố cục', () => {
  it('tiêu đề là tên bảng; lưới 3 cột; mỗi mục một dòng và dòng mặc định ở cuối; màu có ô màu kèm mã', async () => {
    const { el } = await open();
    expect(text(el.querySelector('h2'))).toBe('TrangThaiBom');
    expect(el.querySelector('.path')?.textContent).toContain('value-tables/TrangThaiBom.json');
    const heads = [...el.querySelectorAll('[role="columnheader"]')].map(text);
    expect(heads).toEqual(['Giá trị / khoảng', 'Chữ', 'Màu']);
    expect(el.querySelectorAll('[role="row"][data-r]')).toHaveLength(5);
    expect(text(cell(el, 0, 'value'))).toBe('0');
    expect(text(cell(el, 3, 'value'))).toBe('[10, 20)');
    expect(text(cell(el, 4, 'value'))).toBe('(mặc định)');
    expect(text(cell(el, 4, 'text'))).toBe('Không rõ');
    expect(cell(el, 1, 'color')!.querySelector('.mg-swatch')).not.toBeNull();
    expect(text(cell(el, 1, 'color'))).toContain('#2E7D32');
    expect(el.querySelector('[role="grid"]')?.getAttribute('aria-label')).toBe('TrangThaiBom');
    expect(text(el.querySelector('[data-role="count"]'))).toContain('4/256');
  });

  it('bảng không có: báo không tìm thấy', async () => {
    const { el } = await open('KhongCo');
    expect(el.querySelector('[role="grid"]')).toBeNull();
    expect(el.querySelector('.empty')).not.toBeNull();
  });
});

describe('mat-value-table-editor: ô thử (US4-7)', () => {
  it('gõ 1 → Chạy, màu xanh lá, mục 2; 12 → Bảo trì, mục 4, không màu', async () => {
    const { el } = await open();
    await typeInto(el, tryBox(el), '1');
    expect(text(tryResult(el))).toContain('Chạy');
    expect(text(tryResult(el))).toContain('mục 2');
    const sw = tryResult(el).querySelector<HTMLElement>('.vt-swatch')!;
    expect(sw.style.background).toMatch(/rgb\(46, 125, 50\)|#2e7d32/i);
    await typeInto(el, tryBox(el), '12');
    expect(text(tryResult(el))).toContain('Bảo trì');
    expect(text(tryResult(el))).toContain('mục 4');
    expect(tryResult(el).querySelector('.vt-swatch')).toBeNull();
  });

  it('không khớp thì dùng mặc định; chưa gõ có hướng dẫn; không phải số báo lỗi tại ô', async () => {
    const { el } = await open();
    expect(text(tryResult(el))).toContain('Gõ một giá trị');
    await typeInto(el, tryBox(el), '20');
    expect(text(tryResult(el))).toContain('Không rõ');
    expect(text(tryResult(el))).toContain('mặc định');
    await typeInto(el, tryBox(el), 'abc');
    expect(tryBox(el).getAttribute('aria-invalid')).toBe('true');
    expect(text(tryResult(el))).toContain('số');
  });

  it('ô thử theo bảng đang sửa: đổi chữ của mục thì kết quả đổi theo', async () => {
    const { el } = await open();
    await typeInto(el, tryBox(el), '1');
    await typeCell(el, 1, 'text', 'Đang chạy');
    expect(text(tryResult(el))).toContain('Đang chạy');
  });
});

describe('mat-value-table-editor: sửa trong lưới (FR-046)', () => {
  it('gõ chữ rồi Enter ghi vào bảng; một bước hoàn tác', async () => {
    const { app, el } = await open();
    await typeCell(el, 1, 'text', 'Đang chạy');
    expect(entries(app)[1]!.text).toBe('Đang chạy');
    await app.run('edit.undo');
    await settled(el);
    expect(entries(app)[1]!.text).toBe('Chạy');
  });

  it('sửa khóa thành khoảng; màu sai bị từ chối tại ô, màu đúng nhận', async () => {
    const { app, el } = await open();
    await typeCell(el, 0, 'value', '[0, 5)');
    expect(entries(app)[0]).toMatchObject({ from: 0, to: 5 });
    expect(entries(app)[0]!.value).toBeUndefined();
    await typeCell(el, 1, 'color', 'xanh');
    expect(entries(app)[1]!.color).toBe('#2E7D32');
    expect(cell(el, 1, 'color')!.getAttribute('aria-invalid')).toBe('true');
    expect(cell(el, 1, 'color')!.getAttribute('title')).toContain('#RRGGBB');
    await typeCell(el, 1, 'color', '#112233');
    expect(entries(app)[1]!.color).toBe('#112233');
  });

  it('dòng mặc định: sửa chữ nhận; cột giá trị không sửa được', async () => {
    const { app, el } = await open();
    await typeCell(el, 4, 'text', 'Lạ');
    expect(doc(app).default?.text).toBe('Lạ');
    expect(cell(el, 4, 'value')!.getAttribute('aria-readonly')).toBe('true');
  });

  it('nút Thêm mục: dòng mới ở cuối (trước dòng mặc định), giá trị là số nguyên nhỏ nhất chưa dùng', async () => {
    const { app, el } = await open();
    el.querySelector<HTMLButtonElement>('button[data-act="add"]')!.click();
    await settled(el);
    expect(entries(app)).toHaveLength(5);
    expect(entries(app)[4]).toEqual({ value: 3, text: '' });
    expect(text(cell(el, 5, 'value'))).toBe('(mặc định)');
    expect(text(el.querySelector('[data-role="count"]'))).toContain('5/256');
  });

  it('Xóa mục: bỏ các mục đang chọn; chưa chọn thì khóa kèm lý do', async () => {
    const { app, el } = await open();
    const del = el.querySelector<HTMLButtonElement>('button[data-act="delete"]')!;
    expect(del.getAttribute('aria-disabled')).toBe('true');
    await click(el, 3, 'text');
    del.click();
    await settled(el);
    expect(entries(app)).toHaveLength(3);
  });
});

describe('mat-value-table-editor: lỗi theo ô', () => {
  it('hai khoảng chồng nhau: ô khóa của mục sau đỏ, có chữ E_VT_OVERLAP; danh sách lỗi nhảy tới ô', async () => {
    const { el } = await open();
    el.querySelector<HTMLButtonElement>('button[data-act="add"]')!.click();
    await settled(el);
    await typeCell(el, 4, 'value', '[15, 25)');
    const c = cell(el, 4, 'value')!;
    expect(c.getAttribute('aria-invalid')).toBe('true');
    expect(c.getAttribute('title')).toContain('E_VT_OVERLAP');
    expect(c.getAttribute('title')).toContain('mục 4');
    const items = [...el.querySelectorAll('[data-role="issues"] li')];
    expect(items).toHaveLength(1);
    expect(text(items[0])).toContain('E_VT_OVERLAP');
    expect(el.querySelector('[data-role="issues"]')?.getAttribute('role')).toBe('alert');
    (items[0]!.querySelector('button') as HTMLButtonElement).click();
    await settled(el);
    expect(cell(el, 4, 'value')!.classList.contains('mg-cur')).toBe(true);
  });

  it('khoảng rỗng (từ ≥ đến) và chữ dài hơn 64 ký tự trong file: báo tại ô', async () => {
    const { app, el } = await open();
    app.store.edit([
      {
        kind: 'valueTableUpsert',
        table: {
          ...doc(app),
          entries: [
            { from: 5, to: 5, text: 'a' },
            { value: 1, text: 'x'.repeat(70) },
          ],
        },
      },
    ]);
    await settled(el);
    expect(cell(el, 0, 'value')!.getAttribute('title')).toContain('E_VT_RANGE');
    expect(cell(el, 1, 'text')!.getAttribute('title')).toContain('E_VT_TEXT');
  });

  it('bảng đúng: không có khối lỗi', async () => {
    const { el } = await open();
    expect(el.querySelector('[data-role="issues"]')).toBeNull();
  });
});

describe('mat-value-table-editor: bộ chọn màu', () => {
  it('<input type="color"> theo dòng đang chọn; đổi màu ghi vào mục; dòng không có màu thì ô trống', async () => {
    const { app, el } = await open();
    const picker = el.querySelector<HTMLInputElement>('input[type="color"]')!;
    expect(picker.disabled).toBe(true); // chưa chọn dòng
    await click(el, 1, 'text');
    expect(picker.disabled).toBe(false);
    expect(picker.value).toBe('#2e7d32');
    picker.value = '#ff0000';
    picker.dispatchEvent(new Event('input', { bubbles: true }));
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(entries(app)[1]!.color).toBe('#ff0000');
    await app.run('edit.undo');
    await settled(el);
    expect(entries(app)[1]!.color).toBe('#2E7D32');
  });

  it('nút Bỏ màu xóa màu của dòng đang chọn', async () => {
    const { app, el } = await open();
    await click(el, 0, 'text');
    el.querySelector<HTMLButtonElement>('button[data-act="clear-color"]')!.click();
    await settled(el);
    expect(entries(app)[0]!.color).toBeUndefined();
  });
});

describe('mat-value-table-editor: Dùng ở đâu (FR-048)', () => {
  it('liệt kê Tag có valueTable, biểu thức text() và binding; nhấp một dòng mở nơi dùng', async () => {
    const { app, el } = await open();
    const items = [...el.querySelectorAll('.xref li button')].map(text);
    expect(items).toHaveLength(4);
    expect(items[0]).toContain('PUMP01.STATE');
    expect(items.some((s) => s.includes('Biểu thức của PUMP01.STATE_TEXT'))).toBe(true);
    (el.querySelector('.xref li button') as HTMLButtonElement).click();
    expect(app.store.state.active).toBe('tags');
    expect(app.takeReveal('tags')).toMatchObject({ editor: 'tags', row: 3 });
  });
});

describe('mat-value-table-editor: ARIA và bàn phím', () => {
  it('lưới có role grid, ô thử có nhãn, nút có tên; mũi tên di chuyển giữa các ô; F2 sửa tại chỗ', async () => {
    const { el } = await open();
    expect(el.querySelector('[role="grid"]')).not.toBeNull();
    expect(tryBox(el).getAttribute('aria-label')).toBeTruthy();
    for (const b of el.querySelectorAll('button'))
      expect(b.textContent?.trim() || b.title).toBeTruthy();
    await click(el, 0, 'value');
    await key(ta(el), 'ArrowDown');
    expect(cell(el, 1, 'value')!.classList.contains('mg-cur')).toBe(true);
    await key(ta(el), 'F2');
    expect(el.querySelector('textarea.mg-input.mg-editing, textarea.mg-input')).not.toBeNull();
  });
});
