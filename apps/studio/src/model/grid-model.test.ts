// Logic lưới Bảng Tag (feature 004, T011, research R3, contracts/commands.md "Phím trong từng vùng").
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TagDefinition, TagList } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n/index.ts';
import {
  TAG_COLUMNS,
  TAG_TYPES,
  addTag,
  beginEdit,
  cellText,
  clampCell,
  clearCell,
  commitEdit,
  deleteRow,
  fillDown,
  gridColumns,
  gridKey,
  initialGridState,
  parseNumber,
  pasteTsv,
  selectCell,
  setFilter,
  visibleRows,
  type GridData,
  type GridState,
  type KeyInput,
} from './grid-model.ts';
import { applyProjectEdits, type ProjectEdit } from './project-doc.ts';

const DEMO = resolve(__dirname, '../../../../projects/tank-demo');
const demoTags = (): TagDefinition[] =>
  (JSON.parse(readFileSync(resolve(DEMO, 'tags.json'), 'utf8')) as TagList).tags;
// 0 TANK01.LEVEL, 1 MOTOR01.RUN, 2 MOTOR01.SPEED, 3 TANK01.INFLOW, 4 TANK01.TEMP

const data = (tags = demoTags(), monitoring = false): GridData => ({
  tags,
  columns: gridColumns(monitoring),
});
const at = (row: number, column: string, filter = ''): GridState =>
  ({ ...initialGridState, cell: { row, column }, filter }) as GridState;
const key = (k: string, mods: Partial<KeyInput> = {}): KeyInput => ({ key: k, ...mods });
/** Áp sửa đổi của lưới lên danh sách Tag như store sẽ làm. */
const apply = (tags: readonly TagDefinition[], edits: ProjectEdit[]) =>
  applyProjectEdits(
    { project: {} as never, tags: { schemaVersion: '0.1.0', tags: [...tags] } },
    edits,
  ).tags.tags as TagDefinition[];

describe('cột', () => {
  it('cột Tag và nhãn tiếng Việt; khi theo dõi, giá trị sống và quality ngay sau tên', () => {
    expect(gridColumns(false).map((c) => c.key)).toEqual([
      'id',
      'type',
      'source',
      'unit',
      'min',
      'max',
      'description',
    ]);
    expect(TAG_COLUMNS.map((c) => t(c.label))).toEqual([
      'Tên',
      'Kiểu',
      'Nguồn',
      'Đơn vị',
      'Min',
      'Max',
      'Mô tả',
    ]);
    const live = gridColumns(true);
    expect(live.map((c) => c.key).slice(0, 4)).toEqual(['id', 'value', 'quality', 'type']);
    expect(t(live[1].label)).toBe('Giá trị sống');
    expect(t(live[2].label)).toBe('Quality');
    expect(TAG_TYPES).toHaveLength(10);
  });

  it('nội dung ô: số như trong file, nguồn là "Mô phỏng · signal", trường thiếu là rỗng', () => {
    const tags = demoTags();
    expect(cellText(tags[0], 'max')).toBe('100');
    expect(cellText(tags[0], 'source')).toBe('Mô phỏng · tank.level');
    expect(cellText(tags[1], 'unit')).toBe('');
    expect(cellText(tags[1], 'min')).toBe('');
    expect(cellText({ ...tags[0], min: 1.5 }, 'min')).toBe('1.5');
    expect(cellText(tags[0], 'value')).toBe('');
  });
});

describe('chọn ô và di chuyển', () => {
  it('chọn ô bằng nhấp', () => {
    const s = selectCell(data(), initialGridState, { row: 2, column: 'unit' });
    expect(s.cell).toEqual({ row: 2, column: 'unit' });
    expect(s.editing).toBeNull();
  });

  it('mũi tên di chuyển; chặn ở biên', () => {
    const d = data();
    expect(gridKey(d, at(1, 'unit'), key('ArrowDown')).state.cell).toEqual({
      row: 2,
      column: 'unit',
    });
    expect(gridKey(d, at(1, 'unit'), key('ArrowRight')).state.cell?.column).toBe('min');
    expect(gridKey(d, at(1, 'unit'), key('ArrowLeft')).state.cell?.column).toBe('source');
    const top = gridKey(d, at(0, 'id'), key('ArrowUp'));
    expect(top.state.cell).toEqual({ row: 0, column: 'id' });
    expect(top.handled).toBe(true);
    expect(gridKey(d, at(0, 'id'), key('ArrowLeft')).state.cell).toEqual({ row: 0, column: 'id' });
    expect(gridKey(d, at(4, 'description'), key('ArrowDown')).state.cell?.row).toBe(4);
    expect(gridKey(d, at(4, 'description'), key('ArrowRight')).state.cell?.column).toBe(
      'description',
    );
  });

  it('Tab sang phải, Shift+Tab sang trái; ở biên thì không giữ phím để focus rời lưới', () => {
    const d = data();
    expect(gridKey(d, at(1, 'id'), key('Tab')).state.cell?.column).toBe('type');
    expect(gridKey(d, at(1, 'type'), key('Tab', { shiftKey: true })).state.cell?.column).toBe('id');
    const end = gridKey(d, at(1, 'description'), key('Tab'));
    expect(end.state.cell).toEqual({ row: 1, column: 'description' });
    expect(end.handled).toBe(false);
    expect(gridKey(d, at(1, 'id'), key('Tab', { shiftKey: true })).handled).toBe(false);
  });

  it('Home/End trong dòng, Ctrl+Home/Ctrl+End tới ô đầu/cuối, Ctrl+mũi tên tới biên', () => {
    const d = data();
    expect(gridKey(d, at(2, 'unit'), key('Home')).state.cell).toEqual({ row: 2, column: 'id' });
    expect(gridKey(d, at(2, 'unit'), key('End')).state.cell).toEqual({
      row: 2,
      column: 'description',
    });
    expect(gridKey(d, at(2, 'unit'), key('Home', { ctrlKey: true })).state.cell).toEqual({
      row: 0,
      column: 'id',
    });
    expect(gridKey(d, at(2, 'unit'), key('End', { ctrlKey: true })).state.cell).toEqual({
      row: 4,
      column: 'description',
    });
    expect(gridKey(d, at(2, 'unit'), key('ArrowDown', { ctrlKey: true })).state.cell?.row).toBe(4);
  });

  it('bỏ qua dòng bị lọc', () => {
    const d = data();
    const s = at(1, 'id', 'motor'); // dòng hiện: 1, 2
    expect(visibleRows(d.tags, 'motor')).toEqual([1, 2]);
    const down = gridKey(d, s, key('ArrowDown'));
    expect(down.state.cell?.row).toBe(2);
    expect(gridKey(d, down.state, key('ArrowDown')).state.cell?.row).toBe(2);
    const s2 = at(0, 'id', 'tank'); // dòng hiện: 0, 3, 4
    expect(gridKey(d, s2, key('ArrowDown')).state.cell?.row).toBe(3);
  });

  it('chưa chọn ô: phím di chuyển chọn ô đầu tiên', () => {
    expect(gridKey(data(), initialGridState, key('ArrowDown')).state.cell).toEqual({
      row: 0,
      column: 'id',
    });
  });

  it('clampCell: dòng bị lọc mất thì về dòng đầu đang hiện; cột không còn thì về tên', () => {
    const d = data();
    expect(clampCell(d, at(0, 'unit', 'motor')).cell).toEqual({ row: 1, column: 'unit' });
    expect(clampCell(d, at(0, 'value')).cell).toEqual({ row: 0, column: 'id' });
    expect(clampCell(d, at(0, 'id', 'khong co')).cell).toBeNull();
    expect(clampCell(data([]), at(0, 'id')).cell).toBeNull();
  });
});

describe('sửa ô', () => {
  it('Enter hoặc F2 vào sửa với nội dung hiện tại, chọn hết', () => {
    for (const k of ['Enter', 'F2']) {
      const r = gridKey(data(), at(0, 'unit'), key(k));
      expect(r.handled).toBe(true);
      expect(r.state.editing).toEqual({
        row: 0,
        column: 'unit',
        original: '%',
        text: '%',
        caret: 'all',
      });
    }
  });

  it('gõ một ký tự: nội dung là ký tự đó, con trỏ ở cuối', () => {
    const r = gridKey(data(), at(0, 'unit'), key('k'));
    expect(r.state.editing).toEqual({
      row: 0,
      column: 'unit',
      original: '%',
      text: 'k',
      caret: 'end',
    });
    // AltGr (Ctrl+Alt) trên bàn phím châu Âu cũng gõ ký tự
    expect(
      gridKey(data(), at(0, 'unit'), key('@', { ctrlKey: true, altKey: true })).state.editing?.text,
    ).toBe('@');
    // Ctrl+chữ là phím tắt, không vào sửa
    expect(gridKey(data(), at(0, 'unit'), key('c', { ctrlKey: true })).state.editing).toBeNull();
  });

  it('nhấp đúp (beginEdit) vào sửa đúng ô đó', () => {
    const r = beginEdit(data(), at(0, 'id'), { row: 3, column: 'max' });
    expect(r.state.cell).toEqual({ row: 3, column: 'max' });
    expect(r.state.editing).toMatchObject({ row: 3, column: 'max', text: '20', caret: 'all' });
  });

  it('Enter xác nhận rồi xuống dòng; Tab xác nhận rồi sang phải', () => {
    const d = data();
    const s = gridKey(d, at(0, 'unit'), key('Enter')).state;
    const r = gridKey(d, s, key('Enter'), 'kPa');
    expect(r.edits).toEqual([{ kind: 'tagField', index: 0, field: 'unit', value: 'kPa' }]);
    expect(r.state.editing).toBeNull();
    expect(r.state.cell).toEqual({ row: 1, column: 'unit' });
    const r2 = gridKey(d, s, key('Tab'), 'kPa');
    expect(r2.state.cell).toEqual({ row: 0, column: 'min' });
    expect(r2.edits).toHaveLength(1);
    const r3 = gridKey(d, s, key('Tab', { shiftKey: true }), 'kPa');
    expect(r3.state.cell).toEqual({ row: 0, column: 'source' });
  });

  it('Esc hủy: không sửa gì, ô giữ nguyên', () => {
    const d = data();
    const s = gridKey(d, at(2, 'unit'), key('x')).state;
    const r = gridKey(d, s, key('Escape'), 'xyz');
    expect(r.edits).toEqual([]);
    expect(r.state.editing).toBeNull();
    expect(r.state.cell).toEqual({ row: 2, column: 'unit' });
    expect(r.handled).toBe(true);
  });

  it('phím khác khi đang sửa để ô nhập tự xử lý; đang gõ IME thì không bắt Enter', () => {
    const s = gridKey(data(), at(2, 'unit'), key('Enter')).state;
    expect(gridKey(data(), s, key('ArrowLeft'), 'rp').handled).toBe(false);
    expect(gridKey(data(), s, key('Enter', { isComposing: true }), 'rp').handled).toBe(false);
  });

  it('xác nhận mà không đổi gì thì không sinh sửa đổi (kể cả ô viết tay có khoảng trắng)', () => {
    const tags = demoTags();
    tags[0] = { ...tags[0], unit: ' % ' };
    const d = data(tags);
    const s = gridKey(d, at(0, 'unit'), key('F2')).state;
    expect(s.editing?.original).toBe(' % ');
    expect(commitEdit(d, s, ' % ', 'down').edits).toEqual([]);
    // gõ lại cùng giá trị đã có: cũng không sửa
    const s2 = gridKey(d, at(3, 'max'), key('2')).state;
    expect(commitEdit(d, s2, '20', 'none').edits).toEqual([]);
  });

  it('chuẩn hóa khi xác nhận: tên và chữ bỏ khoảng trắng đầu cuối, ô chữ trống thì bỏ khóa', () => {
    const d = data();
    const id = commitEdit(d, gridKey(d, at(1, 'id'), key('F2')).state, ' PUMP01.RUN ', 'none');
    expect(id.edits).toEqual([{ kind: 'tagField', index: 1, field: 'id', value: 'PUMP01.RUN' }]);
    const desc = commitEdit(d, gridKey(d, at(0, 'description'), key('F2')).state, '  ', 'none');
    expect(desc.edits).toEqual([
      { kind: 'tagField', index: 0, field: 'description', value: undefined },
    ]);
  });

  it('Min/Max nhận dấu phẩy thập phân; chữ không phải số giữ nguyên để bộ kiểm tra báo lỗi', () => {
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('-0,25')).toBe(-0.25);
    expect(parseNumber(' 12 ')).toBe(12);
    expect(parseNumber('1e3')).toBe(1000);
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('abc')).toBe('abc');
    expect(parseNumber('1.000,5')).toBe('1.000,5');
    expect(parseNumber('Infinity')).toBe('Infinity');
    const d = data();
    const r = commitEdit(d, gridKey(d, at(0, 'min'), key('1')).state, '1,5', 'down');
    expect(r.edits).toEqual([{ kind: 'tagField', index: 0, field: 'min', value: 1.5 }]);
    const tags = apply(d.tags, r.edits);
    expect(tags[0].min).toBe(1.5);
    expect(Object.keys(tags[0])).toEqual(Object.keys(d.tags[0]));
  });

  it('cột chỉ đọc (nguồn) và cột giá trị sống không vào sửa, kèm lý do', () => {
    const d = data(demoTags(), true);
    for (const [col, notice] of [
      ['source', 'grid.notice.sourceReadonly'],
      ['value', 'grid.notice.liveReadonly'],
      ['quality', 'grid.notice.liveReadonly'],
    ] as const) {
      for (const k of ['Enter', 'F2', 'a']) {
        const r = gridKey(d, at(0, col), key(k));
        expect(r.state.editing).toBeNull();
        expect(r.notice).toBe(notice);
        expect(r.handled).toBe(true);
      }
      expect(beginEdit(d, at(0, 'id'), { row: 0, column: col }).state.editing).toBeNull();
    }
  });

  it('cột kiểu (danh sách chọn): Enter mở chọn với kiểu hiện tại; gõ chữ không vào sửa', () => {
    const d = data();
    expect(gridKey(d, at(1, 'type'), key('Enter')).state.editing).toMatchObject({
      text: 'BOOL',
      column: 'type',
    });
    const typed = gridKey(d, at(1, 'type'), key('b'));
    expect(typed.state.editing).toBeNull();
    expect(typed.handled).toBe(false);
    const s = gridKey(d, at(1, 'type'), key('Enter')).state;
    expect(gridKey(d, s, key('Enter'), 'INT16').edits).toEqual([
      { kind: 'tagField', index: 1, field: 'type', value: 'INT16' },
    ]);
  });
});

describe('xóa ô, điền xuống, thêm và xóa dòng', () => {
  it('Delete xóa ô (bỏ khóa) trừ cột tên và kiểu', () => {
    const d = data();
    expect(gridKey(d, at(0, 'unit'), key('Delete')).edits).toEqual([
      { kind: 'tagField', index: 0, field: 'unit', value: undefined },
    ]);
    expect(clearCell(d, at(0, 'max')).edits).toEqual([
      { kind: 'tagField', index: 0, field: 'max', value: undefined },
    ]);
    const id = gridKey(d, at(0, 'id'), key('Delete'));
    expect(id.edits).toEqual([]);
    expect(id.notice).toBe('grid.notice.required');
    expect(gridKey(d, at(0, 'type'), key('Delete')).edits).toEqual([]);
    expect(gridKey(d, at(0, 'source'), key('Delete')).notice).toBe('grid.notice.sourceReadonly');
    // ô đã trống: không sửa gì
    expect(gridKey(d, at(1, 'unit'), key('Delete')).edits).toEqual([]);
  });

  it('điền xuống chép ô bên trên', () => {
    const d = data();
    expect(fillDown(d, at(1, 'unit')).edits).toEqual([
      { kind: 'tagField', index: 1, field: 'unit', value: '%' },
    ]);
    expect(fillDown(d, at(2, 'type')).edits).toEqual([
      { kind: 'tagField', index: 2, field: 'type', value: 'BOOL' },
    ]);
    // Ctrl+D trong lưới cũng là điền xuống
    const ctrlD = gridKey(d, at(2, 'type'), key('d', { ctrlKey: true }));
    expect(ctrlD.edits).toEqual(fillDown(d, at(2, 'type')).edits);
    expect(ctrlD.handled).toBe(true);
    // ô bên trên trống: điền xuống làm ô này trống
    expect(fillDown(d, at(2, 'min')).edits).toEqual([
      { kind: 'tagField', index: 2, field: 'min', value: undefined },
    ]);
  });

  it('điền xuống cột tên thì tăng số, không trùng tên đã có', () => {
    const tags: TagDefinition[] = [
      { id: 'TANK02.LEVEL', type: 'FLOAT32', source: { kind: 'mock', signal: 'tank.level' } },
      { id: 'X', type: 'FLOAT32', source: { kind: 'mock', signal: 'tank.level' } },
      { id: 'TANK03.LEVEL', type: 'FLOAT32', source: { kind: 'mock', signal: 'tank.level' } },
    ];
    expect(fillDown(data(tags), at(1, 'id')).edits).toEqual([
      { kind: 'tagField', index: 1, field: 'id', value: 'TANK04.LEVEL' },
    ]);
    // dòng đang có đúng tên kế tiếp: không sửa
    const ok = [tags[0], tags[2]];
    expect(fillDown(data(ok), at(1, 'id')).edits).toEqual([]);
  });

  it('điền xuống ở dòng đầu (kể cả dòng đầu đang hiện khi lọc) thì không làm gì', () => {
    const d = data();
    expect(fillDown(d, at(0, 'unit')).edits).toEqual([]);
    expect(fillDown(d, at(1, 'unit', 'motor')).edits).toEqual([]);
    // khi lọc, chép từ dòng đang hiện bên trên (bỏ dòng bị ẩn)
    expect(fillDown(d, at(3, 'unit', 'tank')).edits).toEqual([
      { kind: 'tagField', index: 3, field: 'unit', value: '%' },
    ]);
  });

  it('điền xuống cột chỉ đọc thì báo lý do', () => {
    expect(fillDown(data(), at(1, 'source')).notice).toBe('grid.notice.sourceReadonly');
  });

  it('Thêm Tag: tên tăng số từ dòng cuối, chép kiểu, đơn vị, nguồn; thứ tự khóa chuẩn; vào sửa tên', () => {
    const d = data();
    const r = addTag(d, at(1, 'unit', 'motor'));
    expect(r.edits).toHaveLength(1);
    const e = r.edits[0] as Extract<ProjectEdit, { kind: 'tagUpsert' }>;
    expect(e.kind).toBe('tagUpsert');
    expect(e.index).toBeUndefined();
    expect(e.tag).toEqual({
      id: 'TANK02.TEMP',
      type: 'FLOAT32',
      unit: '°C',
      source: { kind: 'mock', signal: 'tank.temp' },
    });
    expect(Object.keys(e.tag)).toEqual(['id', 'type', 'unit', 'source']);
    expect(r.state.filter).toBe(''); // bỏ lọc để thấy dòng mới
    expect(r.state.cell).toEqual({ row: 5, column: 'id' });
    expect(r.state.editing).toEqual({
      row: 5,
      column: 'id',
      original: 'TANK02.TEMP',
      text: 'TANK02.TEMP',
      caret: 'all',
    });
    // xác nhận tên không đổi: không thêm sửa đổi
    const tags = apply(d.tags, r.edits);
    expect(commitEdit(data(tags), r.state, 'TANK02.TEMP', 'down').edits).toEqual([]);
  });

  it('Thêm Tag vào bảng trống: TAG_1, FLOAT32, nguồn mô phỏng theo tên', () => {
    const r = addTag(data([]), initialGridState);
    expect((r.edits[0] as Extract<ProjectEdit, { kind: 'tagUpsert' }>).tag).toEqual({
      id: 'TAG_1',
      type: 'FLOAT32',
      source: { kind: 'mock', signal: 'tag_1' },
    });
  });

  it('Xóa dòng: ô chọn giữ vị trí (dòng dưới dồn lên), dòng cuối thì lùi lên', () => {
    const d = data();
    const r = deleteRow(d, at(1, 'unit'));
    expect(r.edits).toEqual([{ kind: 'tagRemove', index: 1 }]);
    expect(r.state.cell).toEqual({ row: 1, column: 'unit' });
    expect(deleteRow(d, at(4, 'unit')).state.cell).toEqual({ row: 3, column: 'unit' });
    expect(deleteRow(data([d.tags[0]]), at(0, 'id')).state.cell).toBeNull();
    expect(deleteRow(d, initialGridState).edits).toEqual([]);
  });
});

describe('lọc', () => {
  it('theo tên và mô tả, bỏ dấu, không phân biệt hoa thường, nhiều từ', () => {
    const tags = demoTags();
    expect(visibleRows(tags, '')).toEqual([0, 1, 2, 3, 4]);
    expect(visibleRows(tags, 'muc nuoc')).toEqual([0]); // "Mức nước bồn"
    expect(visibleRows(tags, 'BƠM')).toEqual([1, 2]); // "Bơm đang chạy", "Tốc độ bơm"
    expect(visibleRows(tags, 'tank level')).toEqual([0]);
    expect(visibleRows(tags, 'khong co')).toEqual([]);
  });

  it('setFilter giữ ô nếu còn hiện, không thì về dòng đầu đang hiện', () => {
    const d = data();
    expect(setFilter(d, at(2, 'unit'), 'motor').cell).toEqual({ row: 2, column: 'unit' });
    expect(setFilter(d, at(0, 'unit'), 'motor').cell).toEqual({ row: 1, column: 'unit' });
    expect(setFilter(d, at(0, 'unit'), 'motor').filter).toBe('motor');
  });
});

describe('dán dữ liệu dạng tab (logic, chưa bật trong giao diện GĐ 1)', () => {
  it('nhiều dòng, nhiều cột từ ô đang chọn', () => {
    const d = data();
    const r = pasteTsv(d, at(0, 'unit'), 'kPa\t1,5\t10\r\nbar\t\t20\r\n');
    const tags = apply(d.tags, r.edits);
    expect(tags[0]).toMatchObject({ unit: 'kPa', min: 1.5, max: 10 });
    expect(tags[1].unit).toBe('bar');
    expect('min' in tags[1]).toBe(false);
    expect(tags[1].max).toBe(20);
    expect(Object.keys(tags[0])).toEqual(Object.keys(d.tags[0]));
    expect(r.state.cell).toEqual({ row: 0, column: 'unit' });
  });

  it('cột chỉ đọc vẫn chiếm chỗ nhưng bỏ qua; kiểu lạ bỏ qua; kiểu viết thường được nhận', () => {
    const d = data();
    const tags = apply(
      d.tags,
      pasteTsv(d, at(0, 'type'), 'int16\tbỏ qua\tm\nKIEU_LA\tx\tl/s').edits,
    );
    expect(tags[0].type).toBe('INT16');
    expect(tags[0].source).toEqual(d.tags[0].source);
    expect(tags[0].unit).toBe('m');
    expect(tags[1].type).toBe('BOOL');
    expect(tags[1].unit).toBe('l/s');
  });

  it('dán quá dòng cuối thì thêm Tag mới (tên tự tăng nếu không dán tên)', () => {
    const d = data();
    const r = pasteTsv(d, at(4, 'id'), 'TANK01.TEMP\nTANK09.PRESS\tINT32\n\tBOOL');
    const tags = apply(d.tags, r.edits);
    expect(tags).toHaveLength(7);
    expect(tags[5]).toMatchObject({ id: 'TANK09.PRESS', type: 'INT32' });
    expect(Object.keys(tags[5])).toEqual(['id', 'type', 'unit', 'source']);
    expect(tags[6]).toMatchObject({ id: 'TANK10.PRESS', type: 'BOOL' });
  });

  it('khi lọc, dán vào các dòng đang hiện', () => {
    const d = data();
    const tags = apply(d.tags, pasteTsv(d, at(1, 'unit', 'motor'), 'a\nb').edits);
    expect(tags[1].unit).toBe('a');
    expect(tags[2].unit).toBe('b');
    expect(tags[3].unit).toBe('m3/h');
  });

  it('chưa chọn ô thì không dán', () => {
    expect(pasteTsv(data(), initialGridState, 'a').edits).toEqual([]);
  });
});
