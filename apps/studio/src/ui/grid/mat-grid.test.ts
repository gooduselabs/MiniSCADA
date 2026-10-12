// @vitest-environment jsdom
// mat-grid: lưới ảo hóa tự viết có một textarea nhận bộ gõ (feature 006, T087, ADR-016, FR-045, FR-046).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialGrid, type GridState } from '../../model/grid/index.ts';
import { FakeAdapter, type Row } from '../../model/grid/test-adapter.ts';
import './mat-grid.ts';
import type { MatGrid } from './mat-grid.ts';

const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `T${String(i + 1).padStart(4, '0')}`,
    addr: `HR${i}`,
    min: String(i),
    desc: `mô tả ${i}`,
  }));

async function mount(adapter = new FakeAdapter(rows(5)), state: GridState = initialGrid) {
  const el = document.createElement('mat-grid') as MatGrid;
  el.label = 'Bảng thử';
  el.adapter = adapter;
  el.state = state;
  document.body.append(el);
  await el.updateComplete;
  return { el, adapter };
}

afterEach(() => document.body.replaceChildren());

const cell = (el: Element, r: number, c: string) =>
  el.querySelector<HTMLElement>(`[role="gridcell"][data-r="${r}"][data-c="${c}"]`)!;
const ta = (el: Element) => el.querySelector<HTMLTextAreaElement>('textarea.mg-input')!;
const edits = (el: Element) => {
  const out: unknown[][] = [];
  el.addEventListener('grid-edit', (e) => out.push((e as CustomEvent).detail.edits));
  return out;
};
const key = (target: Element, k: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );

async function click(el: MatGrid, r: number, c: string, init: PointerEventInit = {}) {
  cell(el, r, c).dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ...init }),
  );
  window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  await el.updateComplete;
}

describe('ảo hóa', () => {
  it('2.000 dòng: chỉ vẽ khung nhìn cộng 10 dòng đệm mỗi phía; dòng cao cố định 24 px', async () => {
    const { el } = await mount(new FakeAdapter(rows(2000)));
    const scroll = el.querySelector<HTMLElement>('.mg-scroll')!;
    Object.defineProperty(scroll, 'clientHeight', { value: 24 * 20 + 24, configurable: true });
    el.syncViewport();
    await el.updateComplete;
    const rendered = () => el.querySelectorAll('[role="row"][data-r]').length;
    expect(rendered()).toBeLessThanOrEqual(20 + 20);
    expect(rendered()).toBeGreaterThan(10);
    expect(el.rowHeight).toBe(24);
    const body = el.querySelector<HTMLElement>('.mg-body')!;
    expect(body.style.height).toBe(`${24 * 2000 + 24}px`);
    // Cuộn tới giữa: các dòng vẽ nằm quanh vị trí cuộn.
    scroll.scrollTop = 24 * 1000;
    scroll.dispatchEvent(new Event('scroll'));
    await el.updateComplete;
    const rs = [...el.querySelectorAll<HTMLElement>('[role="row"][data-r]')].map((r) =>
      Number(r.dataset.r),
    );
    expect(rs.length).toBeLessThanOrEqual(40);
    expect(Math.min(...rs)).toBeGreaterThanOrEqual(1000 - 12);
    expect(Math.max(...rs)).toBeLessThanOrEqual(1000 + 32);
  });

  it('dòng thoáng 28 px khi đổi mật độ', async () => {
    const { el } = await mount();
    el.rowHeight = 28;
    await el.updateComplete;
    expect(el.querySelector<HTMLElement>('.mg-body')!.style.height).toBe(`${28 * 5 + 28}px`);
  });

  it('ARIA grid: aria-rowcount, aria-colcount; dòng, ô, tiêu đề có chỉ số và vai trò', async () => {
    const { el } = await mount();
    const grid = el.querySelector('[role="grid"]')!;
    expect(grid.getAttribute('aria-rowcount')).toBe('6');
    expect(grid.getAttribute('aria-colcount')).toBe('7');
    expect(grid.getAttribute('aria-label')).toBe('Bảng thử');
    expect(el.querySelectorAll('[role="columnheader"]').length).toBe(6);
    expect(cell(el, 2, 'addr').closest('[role="row"]')!.getAttribute('aria-rowindex')).toBe('4');
    expect(cell(el, 2, 'addr').getAttribute('aria-colindex')).toBe('4');
    expect(cell(el, 0, 'info').getAttribute('aria-readonly')).toBe('true');
  });
});

describe('một textarea giữ focus', () => {
  it('chỉ có một textarea; nhấp ô chọn ô và đặt focus vào textarea; chế độ di chuyển: rỗng, con trỏ trong suốt', async () => {
    const { el } = await mount();
    expect(el.querySelectorAll('textarea').length).toBe(1);
    await click(el, 1, 'addr');
    expect(el.state.cell).toEqual({ row: 1, col: 'addr' });
    expect(document.activeElement).toBe(ta(el));
    expect(ta(el).value).toBe('');
    expect(ta(el).style.caretColor).toBe('transparent');
    expect(cell(el, 1, 'addr').getAttribute('aria-selected')).toBe('true');
  });

  it('textarea có aria-label "<cột>, dòng <n>: <giá trị>" và aria-activedescendant là ô hiện hành', async () => {
    const { el } = await mount();
    await click(el, 2, 'addr');
    expect(ta(el).getAttribute('aria-label')).toBe('Địa chỉ, dòng 3: HR2');
    expect(ta(el).getAttribute('aria-activedescendant')).toBe(cell(el, 2, 'addr').id);
  });

  it('mũi tên di chuyển ô, báo trạng thái; Tab ở biên không bị giữ lại', async () => {
    const { el } = await mount();
    const states: GridState[] = [];
    el.addEventListener('grid-state', (e) => states.push((e as CustomEvent).detail.state));
    await click(el, 0, 'id');
    expect(key(ta(el), 'ArrowDown')).toBe(false);
    await el.updateComplete;
    expect(el.state.cell).toEqual({ row: 1, col: 'id' });
    expect(states.at(-1)?.cell).toEqual({ row: 1, col: 'id' });
    await click(el, 4, 'desc');
    expect(key(ta(el), 'Tab')).toBe(true); // không chặn: focus rời lưới
  });
});

describe('gõ thẳng, bộ gõ', () => {
  it('chữ vào textarea (Unikey, bàn phím): sửa ngay trên chính phần tử, không dời focus', async () => {
    const { el } = await mount();
    await click(el, 0, 'desc');
    const input = ta(el);
    input.value = 'M';
    input.dispatchEvent(
      new InputEvent('input', { data: 'M', inputType: 'insertText', bubbles: true }),
    );
    await el.updateComplete;
    expect(el.state.editing).toMatchObject({ row: 0, col: 'desc', text: 'M', origin: 'typed' });
    expect(document.activeElement).toBe(input);
    expect(ta(el)).toBe(input);
    expect(input.value).toBe('M'); // không gán lại value
  });

  it('Telex TSF: compositionstart vào sửa, chữ ghép cập nhật, compositionend rồi Enter xác nhận đúng một sửa đổi', async () => {
    const { el } = await mount();
    const out = edits(el);
    await click(el, 0, 'desc');
    const input = ta(el);
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    await el.updateComplete;
    expect(el.state.editing?.origin).toBe('typed');
    expect(el.state.ime).toBe('composing');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('');
    // keydown "Process" và Enter khi đang ghép: lưới không chặn, không xác nhận.
    expect(key(input, 'Process', { isComposing: true })).toBe(true);
    expect(key(input, 'Enter', { isComposing: true })).toBe(true);
    expect(out).toEqual([]);
    input.value = 'Mức nước';
    input.dispatchEvent(
      new InputEvent('input', { data: 'Mức nước', isComposing: true, bubbles: true }),
    );
    input.dispatchEvent(
      new CompositionEvent('compositionend', { data: 'Mức nước', bubbles: true }),
    );
    await el.updateComplete;
    expect(el.state.ime).toBe('idle');
    expect(key(input, 'Enter')).toBe(false);
    await el.updateComplete;
    expect(out).toEqual([[{ kind: 'tagField', index: 0, field: 'desc', value: 'Mức nước' }]]);
    expect(el.state.editing).toBeNull();
    expect(input.value).toBe('');
    expect(el.state.cell).toEqual({ row: 1, col: 'desc' });
  });

  it('Esc giữa lúc ghép: hủy sau compositionend, ô giữ nội dung cũ', async () => {
    const { el } = await mount();
    const out = edits(el);
    await click(el, 0, 'desc');
    const input = ta(el);
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = 'mư';
    input.dispatchEvent(new InputEvent('input', { data: 'mư', isComposing: true, bubbles: true }));
    key(input, 'Escape', { isComposing: true });
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await el.updateComplete;
    expect(el.state.editing).toBeNull();
    expect(out).toEqual([]);
    expect(input.value).toBe('');
  });

  it('F2, Enter, nhấp đúp vào sửa với chữ hiện tại (origin f2, dblclick), chọn hết', async () => {
    const { el } = await mount();
    await click(el, 1, 'desc');
    key(ta(el), 'F2');
    await el.updateComplete;
    expect(el.state.editing).toMatchObject({ origin: 'f2', text: 'mô tả 1' });
    expect(ta(el).value).toBe('mô tả 1');
    key(ta(el), 'Escape');
    await el.updateComplete;
    cell(el, 2, 'desc').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await el.updateComplete;
    expect(el.state.editing).toMatchObject({ origin: 'dblclick', row: 2 });
  });

  it('rời textarea khi đang sửa thì xác nhận (như nhấp ra ngoài)', async () => {
    const { el } = await mount();
    const out = edits(el);
    await click(el, 0, 'desc');
    const input = ta(el);
    input.value = 'xong';
    input.dispatchEvent(new InputEvent('input', { data: 'xong', bubbles: true }));
    input.dispatchEvent(new FocusEvent('blur'));
    await el.updateComplete;
    expect(out).toEqual([[{ kind: 'tagField', index: 0, field: 'desc', value: 'xong' }]]);
  });

  it('Delete xóa ô thành sửa đổi; ô tên bắt buộc không xóa', async () => {
    const { el } = await mount();
    const out = edits(el);
    await click(el, 1, 'desc');
    key(ta(el), 'Delete');
    expect(out).toEqual([[{ kind: 'tagField', index: 1, field: 'desc', value: '' }]]);
    await click(el, 1, 'id');
    key(ta(el), 'Delete');
    expect(out).toHaveLength(1);
  });

  it('ô chỉ đọc: Enter không vào sửa và báo lý do', async () => {
    const { el } = await mount();
    const notices: string[] = [];
    el.addEventListener('grid-notice', (e) => notices.push((e as CustomEvent).detail.text));
    await click(el, 0, 'info');
    key(ta(el), 'Enter');
    await el.updateComplete;
    expect(el.state.editing).toBeNull();
    expect(notices).toEqual(['Ô này chỉ đọc, không sửa được']);
  });
});

describe('clipboard qua ô nhập', () => {
  const clip = (initial = '') => {
    const store = { text: initial };
    return {
      store,
      data: {
        getData: (type: string) => (type === 'text/plain' ? store.text : ''),
        setData: (type: string, v: string) => void (type === 'text/plain' && (store.text = v)),
      },
    };
  };
  const fire = (target: Element, type: string, data: unknown) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: data });
    target.dispatchEvent(e);
    return e;
  };

  it('copy: vùng chọn thành TSV trong clipboardData, chặn mặc định', async () => {
    const { el } = await mount();
    await click(el, 0, 'id');
    await click(el, 1, 'addr', { shiftKey: true });
    const c = clip();
    const e = fire(ta(el), 'copy', c.data);
    expect(e.defaultPrevented).toBe(true);
    expect(c.store.text).toBe('T0001\tFLOAT32\tHR0\r\nT0002\tFLOAT32\tHR1');
  });

  it('cut: chép rồi xóa vùng', async () => {
    const { el } = await mount();
    const out = edits(el);
    await click(el, 0, 'desc');
    const c = clip();
    fire(ta(el), 'cut', c.data);
    expect(c.store.text).toBe('mô tả 0');
    expect(out).toEqual([[{ kind: 'tagField', index: 0, field: 'desc', value: '' }]]);
  });

  it('paste: dán nhiều dòng nhiều cột thành MỘT lần sửa đổi, báo ô sai', async () => {
    const { el } = await mount();
    const out = edits(el);
    const detail: unknown[] = [];
    el.addEventListener('grid-edit', (e) => detail.push((e as CustomEvent).detail));
    await click(el, 0, 'addr');
    const c = clip('X1\t5\r\nX2\tabc');
    const e = fire(ta(el), 'paste', c.data);
    expect(e.defaultPrevented).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual([
      { kind: 'tagField', index: 0, field: 'addr', value: 'X1' },
      { kind: 'tagField', index: 0, field: 'min', value: '5' },
      { kind: 'tagField', index: 1, field: 'addr', value: 'X2' },
    ]);
    expect((detail[0] as { rejected: unknown[] }).rejected).toHaveLength(1);
  });
});

describe('lỗi theo ô', () => {
  it('ô có lỗi: lớp mg-err, aria-invalid, lý do ở title và mô tả ẩn', async () => {
    const adapter = new FakeAdapter(rows(3));
    const el = document.createElement('mat-grid') as MatGrid;
    el.adapter = adapter;
    el.label = 'Bảng';
    el.issues = new Map([['1:addr', ['E_ADDR_SYNTAX: địa chỉ sai']]]);
    document.body.append(el);
    await el.updateComplete;
    const c = cell(el, 1, 'addr');
    expect(c.classList.contains('mg-err')).toBe(true);
    expect(c.getAttribute('aria-invalid')).toBe('true');
    expect(c.title).toContain('địa chỉ sai');
    const desc = c.getAttribute('aria-describedby')!;
    expect(c.querySelector(`#${desc}`)?.textContent).toContain('địa chỉ sai');
    expect(cell(el, 0, 'addr').classList.contains('mg-err')).toBe(false);
  });
});

describe('ô danh sách chọn', () => {
  it('gõ chữ vào ô Kiểu: ô nhập làm ô lọc, danh sách chọn lọc theo chữ, Enter chọn mục sáng', async () => {
    const { el } = await mount();
    const out = edits(el);
    await click(el, 0, 'type');
    const input = ta(el);
    input.value = 'in';
    input.dispatchEvent(new InputEvent('input', { data: 'in', bubbles: true }));
    await el.updateComplete;
    const items = [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
    expect(items).toEqual(['INT16']);
    expect(el.querySelector('[role="listbox"]')).not.toBeNull();
    key(input, 'Enter');
    await el.updateComplete;
    expect(out).toEqual([[{ kind: 'tagField', index: 0, field: 'type', value: 'INT16' }]]);
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });

  it('mũi tên chọn mục trong danh sách khi mở; Esc đóng không đổi', async () => {
    const { el } = await mount();
    const out = edits(el);
    await click(el, 0, 'type');
    key(ta(el), 'F2');
    await el.updateComplete;
    expect([...el.querySelectorAll('[role="option"]')].length).toBe(3);
    key(ta(el), 'ArrowDown');
    key(ta(el), 'ArrowDown');
    await el.updateComplete;
    expect(ta(el).getAttribute('aria-activedescendant')).toBe(
      el.querySelectorAll('[role="option"]')[2].id,
    );
    key(ta(el), 'Escape');
    await el.updateComplete;
    expect(out).toEqual([]);
    expect(el.querySelector('[role="listbox"]')).toBeNull();
  });
});

describe('sắp xếp, lọc, đổi adapter', () => {
  it('bấm tiêu đề cột sắp xếp (aria-sort), bấm lần ba bỏ; ô tìm lọc dòng', async () => {
    const { el } = await mount();
    const head = el.querySelector<HTMLElement>('[role="columnheader"][data-c="min"] button')!;
    head.click();
    await el.updateComplete;
    expect(el.querySelector('[role="columnheader"][data-c="min"]')!.getAttribute('aria-sort')).toBe(
      'ascending',
    );
    head.click();
    await el.updateComplete;
    expect(el.querySelector('[role="columnheader"][data-c="min"]')!.getAttribute('aria-sort')).toBe(
      'descending',
    );
    head.click();
    await el.updateComplete;
    expect(el.querySelector('[role="columnheader"][data-c="min"]')!.getAttribute('aria-sort')).toBe(
      'none',
    );
    el.state = { ...el.state, filter: 't0003' };
    await el.updateComplete;
    expect(el.querySelectorAll('[role="row"][data-r]').length).toBe(1);
    expect(el.querySelector('[role="grid"]')!.getAttribute('aria-rowcount')).toBe('2');
  });

  it('adapter mới (dữ liệu đổi): ô chọn về chỗ hợp lệ', async () => {
    const { el } = await mount(new FakeAdapter(rows(5)));
    await click(el, 4, 'id');
    el.adapter = new FakeAdapter(rows(2));
    await el.updateComplete;
    expect(el.state.cell).toEqual({ row: 1, col: 'id' });
  });

  it('reveal: chọn ô, tùy chọn vào sửa, cuộn tới ô', async () => {
    const { el } = await mount(new FakeAdapter(rows(300)));
    const scroll = vi.fn();
    el.addEventListener('grid-state', () => scroll());
    el.reveal({ row: 250, col: 'desc' }, { edit: true });
    await el.updateComplete;
    expect(el.state.cell).toEqual({ row: 250, col: 'desc' });
    expect(el.state.editing?.origin).toBe('f2');
    expect(scroll).toHaveBeenCalled();
  });
});
