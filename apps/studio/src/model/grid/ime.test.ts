// Bộ gõ trên lưới (feature 006, T085, ADR-016 điểm 2, data-model §13.2 "Máy trạng thái của ô nhập"): gõ ký tự đầu = sửa
// ô, kể cả Telex TSF (`keydown` là `Process`, chữ tới qua `compositionstart`, `beforeinput`, `input`); Esc, Enter,
// Tab khi đang ghép chữ thuộc về bộ gõ; F2, Enter, nhấp đúp vào sửa như 004.
import { describe, expect, it } from 'vitest';
import {
  beginEdit,
  beginTyped,
  cancelEdit,
  commitEdit,
  compositionEnd,
  compositionStart,
  editKey,
  gridKey,
  initialGrid,
  isImeKey,
  type GridState,
  type KeyInput,
} from './index.ts';
import { FakeAdapter } from './test-adapter.ts';

const demo = () =>
  new FakeAdapter([
    { id: 'TANK01.LEVEL', addr: 'HR100', min: '0', desc: 'Mức nước' },
    { id: 'TANK01.SP', addr: 'HR200', min: '10', desc: 'Điểm đặt' },
    { id: 'PUMP01.RUN', type: 'BOOL', addr: 'C10', desc: 'Bơm chạy' },
  ]);
const at = (row: number, col: string): GridState => ({
  ...initialGrid,
  cell: { row, col },
  anchor: { row, col },
});
const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({ key: k, ...mods });

describe('phím của bộ gõ', () => {
  it('keydown "Process" và isComposing không bị lưới xử lý, không bị chặn', () => {
    const a = demo();
    expect(isImeKey(key('Process'))).toBe(true);
    expect(isImeKey(key('a', { isComposing: true }))).toBe(true);
    expect(isImeKey(key('a'))).toBe(false);
    const r = gridKey(a, at(0, 'desc'), key('Process'));
    expect(r.handled).toBe(false);
    expect(r.state).toEqual(at(0, 'desc'));
    // Ký tự thường cũng không bị lưới nuốt: ô nhập tự nhận chữ qua beforeinput/input.
    expect(gridKey(a, at(0, 'desc'), key('M')).handled).toBe(false);
  });

  it('khi đang ghép chữ, Enter, Tab, mũi tên, Esc không làm lưới xác nhận hay di chuyển', () => {
    const a = demo();
    const s = compositionStart(a, at(0, 'desc')).state;
    for (const k of ['Enter', 'Tab', 'ArrowDown', 'ArrowLeft']) {
      const r = editKey(a, s, key(k, { isComposing: true }), 'mư');
      expect(r.handled, k).toBe(false);
      expect(r.edits, k).toEqual([]);
      expect(r.state, k).toBe(s);
    }
  });
});

describe('vào chế độ sửa bằng cách gõ', () => {
  it('compositionstart: vào sửa (origin typed), ime = composing, chưa đổi chữ', () => {
    const a = demo();
    const r = compositionStart(a, at(0, 'desc'));
    expect(r.state.editing).toEqual({
      row: 0,
      col: 'desc',
      original: 'Mức nước',
      text: '',
      origin: 'typed',
    });
    expect(r.state.ime).toBe('composing');
    expect(r.edits).toEqual([]);
  });

  it('beforeinput hoặc input có chữ: vào sửa với chữ đã vào ô nhập (Unikey, bàn phím thường)', () => {
    const a = demo();
    const r = beginTyped(a, at(0, 'desc'), 'M');
    expect(r.state.editing).toMatchObject({ original: 'Mức nước', text: 'M', origin: 'typed' });
    expect(r.state.ime).toBe('idle');
    // Đang sửa rồi thì chỉ cập nhật chữ, không bắt đầu lại.
    const again = beginTyped(a, r.state, 'Mứ');
    expect(again.state.editing).toMatchObject({
      original: 'Mức nước',
      text: 'Mứ',
      origin: 'typed',
    });
  });

  it('compositionstart khi đã sửa: không bắt đầu lại, giữ chữ ban đầu', () => {
    const a = demo();
    const s = beginTyped(a, at(0, 'desc'), 'M').state;
    const r = compositionStart(a, s);
    expect(r.state.editing).toMatchObject({ original: 'Mức nước', text: 'M' });
    expect(r.state.ime).toBe('composing');
  });

  it('F2, Enter, nhấp đúp: sửa với chữ hiện tại, origin f2 hoặc dblclick', () => {
    const a = demo();
    const f2 = gridKey(a, at(1, 'desc'), key('F2'));
    expect(f2.handled).toBe(true);
    expect(f2.state.editing).toMatchObject({
      original: 'Điểm đặt',
      text: 'Điểm đặt',
      origin: 'f2',
    });
    const enter = gridKey(a, at(1, 'desc'), key('Enter'));
    expect(enter.state.editing).toMatchObject({ text: 'Điểm đặt', origin: 'f2' });
    const dbl = beginEdit(a, at(1, 'desc'), 'dblclick');
    expect(dbl.state.editing).toMatchObject({ text: 'Điểm đặt', origin: 'dblclick' });
  });

  it('ô chỉ đọc không vào sửa, kèm lý do; gõ vào cột chỉ đọc cũng vậy', () => {
    const a = demo();
    const r = beginEdit(a, at(0, 'info'), 'f2');
    expect(r.state.editing).toBeNull();
    expect(r.notice?.key).toBe('gx.notice.readonly');
    const typed = beginTyped(a, at(0, 'info'), 'x');
    expect(typed.state.editing).toBeNull();
    expect(typed.notice?.key).toBe('gx.notice.readonly');
    expect(compositionStart(a, at(0, 'info')).state.editing).toBeNull();
  });

  it('chưa chọn ô thì không vào sửa', () => {
    const a = demo();
    expect(beginTyped(a, initialGrid, 'x').state.editing).toBeNull();
    expect(compositionStart(a, initialGrid).state.editing).toBeNull();
  });
});

describe('Esc, xác nhận khi ghép chữ', () => {
  it('Esc khi đang ghép: chờ compositionend rồi mới hủy, ô giữ nội dung cũ', () => {
    const a = demo();
    let s = compositionStart(a, at(0, 'desc')).state;
    const esc = editKey(a, s, key('Escape', { isComposing: true }), 'mư');
    expect(esc.state.ime).toBe('cancelPending');
    expect(esc.state.editing).not.toBeNull();
    expect(esc.handled).toBe(false); // bộ gõ cũng nhận Esc
    s = esc.state;
    const end = compositionEnd(a, s);
    expect(end.state.editing).toBeNull();
    expect(end.state.ime).toBe('idle');
    expect(end.edits).toEqual([]);
    expect(end.state.cell).toEqual({ row: 0, col: 'desc' });
  });

  it('compositionend bình thường: về idle, vẫn đang sửa', () => {
    const a = demo();
    const s = compositionStart(a, at(0, 'desc')).state;
    const end = compositionEnd(a, s);
    expect(end.state.ime).toBe('idle');
    expect(end.state.editing).not.toBeNull();
  });

  it('Esc khi rảnh: hủy sửa, ô giữ nội dung cũ, về chế độ di chuyển', () => {
    const a = demo();
    const s = beginTyped(a, at(0, 'desc'), 'Mứ').state;
    const r = editKey(a, s, key('Escape'), 'Mứ');
    expect(r.handled).toBe(true);
    expect(r.state.editing).toBeNull();
    expect(r.edits).toEqual([]);
    expect(cancelEdit(s).editing).toBeNull();
  });

  it('Enter khi rảnh xác nhận đúng MỘT sửa đổi rồi xuống dòng; Tab sang phải; Shift+Tab sang trái', () => {
    const a = demo();
    const s = beginTyped(a, at(0, 'desc'), 'Mức nước bồn').state;
    const enter = editKey(a, s, key('Enter'), 'Mức nước bồn');
    expect(enter.handled).toBe(true);
    expect(enter.edits).toEqual([
      { kind: 'tagField', index: 0, field: 'desc', value: 'Mức nước bồn' },
    ]);
    expect(enter.state.editing).toBeNull();
    expect(enter.state.cell).toEqual({ row: 1, col: 'desc' });
    const tab = editKey(a, s, key('Tab'), 'Mức nước bồn');
    // Cột cuối: Tab xác nhận rồi ở lại ô đó.
    expect(tab.state.cell).toEqual({ row: 0, col: 'desc' });
    expect(tab.edits).toHaveLength(1);
    const shift = editKey(
      a,
      beginTyped(a, at(0, 'desc'), 'x').state,
      key('Tab', { shiftKey: true }),
      'x',
    );
    expect(shift.state.cell).toEqual({ row: 0, col: 'info' });
  });

  it('xác nhận không đổi gì thì không sinh sửa đổi', () => {
    const a = demo();
    const s = beginEdit(a, at(0, 'desc'), 'f2').state;
    const r = commitEdit(a, s, 'Mức nước', 'down');
    expect(r.edits).toEqual([]);
    expect(r.state.editing).toBeNull();
    expect(r.state.cell).toEqual({ row: 1, col: 'desc' });
  });

  it('phím khác khi đang sửa để ô nhập tự xử lý', () => {
    const a = demo();
    const s = beginTyped(a, at(0, 'desc'), 'M').state;
    expect(editKey(a, s, key('ArrowLeft'), 'M').handled).toBe(false);
    expect(editKey(a, s, key('Home'), 'M').handled).toBe(false);
    expect(editKey(a, s, key('a', { ctrlKey: true }), 'M').handled).toBe(false);
  });
});

describe('xác nhận: giá trị, vùng, danh sách chọn', () => {
  it('giá trị không đổi được (ô số gõ chữ): giữ chế độ sửa, báo ô bị từ chối', () => {
    const a = demo();
    const s = beginTyped(a, at(0, 'min'), 'abc').state;
    const r = commitEdit(a, s, 'abc', 'down');
    expect(r.state.editing).not.toBeNull();
    expect(r.edits).toEqual([]);
    expect(r.rejected).toEqual([
      { row: 0, newIndex: undefined, col: 'min', text: 'abc', reason: 'NaN' },
    ]);
    expect(r.notice?.key).toBe('gx.notice.rejected');
  });

  it('gõ một giá trị áp cả vùng chọn', () => {
    const a = demo();
    let s: GridState = {
      ...at(0, 'addr'),
      anchor: { row: 0, col: 'addr' },
      cell: { row: 2, col: 'addr' },
    };
    s = beginTyped(a, s, 'HR9').state;
    expect(s.editing).toMatchObject({ row: 2, col: 'addr', original: 'C10' });
    const r = commitEdit(a, s, 'HR9', 'none');
    expect(r.edits).toEqual([
      { kind: 'tagField', index: 0, field: 'addr', value: 'HR9' },
      { kind: 'tagField', index: 1, field: 'addr', value: 'HR9' },
      { kind: 'tagField', index: 2, field: 'addr', value: 'HR9' },
    ]);
  });

  it('vùng có cột chỉ đọc: ô chỉ đọc bị bỏ qua, ô sửa được vẫn áp', () => {
    const a = demo();
    let s: GridState = {
      ...at(0, 'min'),
      anchor: { row: 0, col: 'min' },
      cell: { row: 1, col: 'info' },
    };
    s = beginTyped(a, { ...s, cell: { row: 1, col: 'min' } }, '7').state;
    const r = commitEdit(
      a,
      { ...s, anchor: { row: 0, col: 'min' }, cell: { row: 1, col: 'info' }, editing: s.editing },
      '7',
      'none',
    );
    expect(r.edits.map((e) => (e as { field: string }).field)).toEqual(['min', 'min']);
  });

  it('Delete xóa nội dung vùng chọn thành một lô; ô bắt buộc (tên) báo lý do', () => {
    const a = demo();
    const area: GridState = {
      ...at(0, 'desc'),
      anchor: { row: 0, col: 'desc' },
      cell: { row: 1, col: 'desc' },
    };
    const r = gridKey(a, area, key('Delete'));
    expect(r.handled).toBe(true);
    expect(r.edits).toEqual([
      { kind: 'tagField', index: 0, field: 'desc', value: '' },
      { kind: 'tagField', index: 1, field: 'desc', value: '' },
    ]);
    const name = gridKey(a, at(0, 'id'), key('Delete'));
    expect(name.edits).toEqual([]);
    expect(name.rejected?.[0].reason).toBe('required');
    expect(name.notice?.key).toBe('gx.notice.required');
  });

  it('ô danh sách chọn: gõ chữ vào ô nhập làm ô lọc (combobox); chữ ngoài danh sách bị từ chối', () => {
    const a = demo();
    const typed = beginTyped(a, at(0, 'type'), 'bo');
    expect(typed.state.editing).toMatchObject({ col: 'type', original: 'FLOAT32', text: 'bo' });
    const bad = commitEdit(a, typed.state, 'bo', 'none');
    expect(bad.state.editing).not.toBeNull();
    expect(bad.rejected?.[0].col).toBe('type');
    const good = commitEdit(a, typed.state, 'BOOL', 'none');
    expect(good.edits).toEqual([{ kind: 'tagField', index: 0, field: 'type', value: 'BOOL' }]);
  });
});
