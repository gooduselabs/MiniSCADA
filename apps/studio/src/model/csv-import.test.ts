// Nhập và xuất CSV của Bảng Tag (feature 006, T123, FR-045, US1-12): xem trước, khớp cột theo tiêu đề, thêm mới và cập nhật
// theo tên (không xóa Tag), dấu phân cách và dấu thập phân chọn được, bảng mã, tên trùng, lỗi theo dòng và ô, trần 2.000 Tag.
import type { TagV1 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { applyEdits, type EditableProject } from './project-doc.ts';
import { defaultDecimal, planCsvImport, tagsToCsv } from './csv-import.ts';
import { tagTable, type TagTable } from './tag-table.ts';

const DEVICES = [{ id: 'plc1-main', name: 'PLC chính' }];
const TAGS: TagV1[] = [
  {
    id: 'A.ONE',
    kind: 'external',
    type: 'FLOAT32',
    description: 'Một',
    min: 0,
    max: 10.5,
    source: { device: 'plc1-main', address: 'HR100' },
  },
  { id: 'B.TWO', kind: 'internal', type: 'INT16', initial: 3, retain: true },
];
const table = (tags: readonly TagV1[] = TAGS): TagTable =>
  tagTable({ tags, devices: DEVICES, valueTables: [], version: '0.2' });
const enc = (s: string) => new TextEncoder().encode(s);
const OPTS = { decimal: '.' as const };

function applied(tags: readonly TagV1[], edits: Parameters<typeof applyEdits>[1]): TagV1[] {
  const base = {
    project: { schemaVersion: '0.2.0' },
    tags: { schemaVersion: '0.2.0', tags: structuredClone(tags) },
  } as unknown as EditableProject;
  return (applyEdits(base, edits).state.tags as { tags: TagV1[] }).tags;
}

describe('khớp cột', () => {
  it('theo tiêu đề không phân biệt hoa thường, bỏ dấu; chấp nhận cả khóa; tiêu đề lạ được liệt kê và bỏ qua', () => {
    const plan = planCsvImport(enc('TÊN,mô tả,unit,Cột lạ\nC.NEW,Xin chào,m,x\n'), table(), OPTS);
    expect(plan.fatal).toBeUndefined();
    expect(plan.headers.map((h) => h.col)).toEqual(['id', 'description', 'unit', null]);
    expect(plan.counts.add).toBe(1);
    const tags = applied(TAGS, plan.edits);
    expect(tags.at(-1)).toMatchObject({ id: 'C.NEW', description: 'Xin chào', unit: 'm' });
  });

  it('thiếu cột tên thì không nhập được', () => {
    const plan = planCsvImport(enc('Mô tả\nx\n'), table(), OPTS);
    expect(plan.fatal).toBe('tt.csv.noId');
    expect(plan.edits).toEqual([]);
  });

  it('file rỗng hoặc chỉ có tiêu đề', () => {
    expect(planCsvImport(enc(''), table(), OPTS).fatal).toBe('tt.csv.empty');
    const only = planCsvImport(enc('Tên\n'), table(), OPTS);
    expect(only.rows).toEqual([]);
  });
});

describe('thêm mới và cập nhật theo tên', () => {
  it('cập nhật chỉ ô khác; Tag không có trong file giữ nguyên; một bước hoàn tác', () => {
    const plan = planCsvImport(enc('Tên,Mô tả,Max\nA.ONE,Mới,20\nZ.NEW,Tag z,5\n'), table(), OPTS);
    expect(plan.counts).toMatchObject({ add: 1, update: 1, same: 0, error: 0 });
    expect(plan.rows[0]).toMatchObject({ action: 'update', id: 'A.ONE', line: 2 });
    expect(plan.rows[0].cells.sort()).toEqual(['description', 'max']);
    expect(plan.rows[1]).toMatchObject({ action: 'add', id: 'Z.NEW' });
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].kind).toBe('batch');
    const tags = applied(TAGS, plan.edits);
    expect(tags).toHaveLength(3);
    expect(tags[0]).toMatchObject({ id: 'A.ONE', description: 'Mới', max: 20, min: 0 });
    expect(tags[1].id).toBe('B.TWO');
  });

  it('dòng không đổi gì là same', () => {
    const plan = planCsvImport(enc('Tên,Mô tả\nA.ONE,Một\n'), table(), OPTS);
    expect(plan.counts.same).toBe(1);
    expect(plan.edits).toEqual([]);
  });

  it('Tag mới có địa chỉ chuẩn hóa chữ hoa và thiết bị trường', () => {
    const plan = planCsvImport(
      enc('Tên,Loại,Kiểu,Thiết bị trường,Địa chỉ\nN.X,Ngoài,INT16,plc1-main,hr9\n'),
      table(),
      OPTS,
    );
    expect(applied(TAGS, plan.edits).at(-1)).toMatchObject({
      id: 'N.X',
      kind: 'external',
      type: 'INT16',
      source: { device: 'plc1-main', address: 'HR9' },
    });
  });
});

describe('dấu phân cách, dấu thập phân, bảng mã', () => {
  it('mặc định theo vùng của máy: có hàm defaultDecimal', () => {
    expect(['.', ',']).toContain(defaultDecimal());
  });

  it('dấu chấm phẩy và thập phân dấu phẩy', () => {
    const plan = planCsvImport(enc('Tên;Max\nA.ONE;12,5\n'), table(), { decimal: ',' });
    expect(plan.delimiter).toBe(';');
    expect(applied(TAGS, plan.edits)[0].max).toBe(12.5);
  });

  it('ép dấu phân cách khác dấu tự nhận', () => {
    const plan = planCsvImport(enc('Tên\tMô tả\nA.ONE\tX\n'), table(), {
      ...OPTS,
      delimiter: '\t',
    });
    expect(plan.counts.update).toBe(1);
  });

  it('số mơ hồ (1,000) và không phải số: lỗi theo dòng và ô, dòng không áp', () => {
    const plan = planCsvImport(enc('Tên;Max;Min\nA.ONE;1,000;abc\nB.TWO;;\n'), table(), {
      decimal: ',',
    });
    expect(plan.counts.error).toBe(1);
    const row = plan.rows[0];
    expect(row.action).toBe('error');
    expect(row.errors.map((e) => e.col).sort()).toEqual(['max', 'min']);
    expect(applied(TAGS, plan.edits)[0].max).toBe(10.5);
  });

  it('bảng mã: BOM UTF-8, UTF-8 hợp lệ, không thì Windows-1258; đổi được khi xem trước', () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc('Tên,Mô tả\nA.ONE,Ôn\n')]);
    expect(planCsvImport(bom, table(), OPTS).encoding).toBe('utf-8');
    expect(planCsvImport(enc('Tên,Mô tả\nA.ONE,Ôn\n'), table(), OPTS).encoding).toBe('utf-8');
    const w1258 = new Uint8Array([
      ...enc('Tên'),
      ...enc(',Mô tả\nA.ONE,M'),
      0xf4,
      0x20,
      ...enc('x\n'),
    ]);
    const auto = planCsvImport(w1258, table(), OPTS);
    expect(auto.encoding).toBe('windows-1258');
    const forced = planCsvImport(w1258, table(), { ...OPTS, encoding: 'utf-8' });
    expect(forced.encoding).toBe('utf-8');
  });
});

describe('tên trùng và giới hạn', () => {
  it('tên trùng trong file: mọi dòng trùng báo lỗi, không áp', () => {
    const plan = planCsvImport(enc('Tên,Mô tả\nN.A,1\nN.B,2\nN.A,3\n'), table(), OPTS);
    expect(plan.rows.map((r) => r.action)).toEqual(['error', 'add', 'error']);
    expect(plan.rows[0].errors[0].reason).toBe('tt.csv.dupInFile');
    expect(applied(TAGS, plan.edits).map((x) => x.id)).toEqual(['A.ONE', 'B.TWO', 'N.B']);
  });

  it('tên sai luật: lỗi dòng', () => {
    const plan = planCsvImport(enc('Tên\n1xx\n'), table(), OPTS);
    expect(plan.rows[0]).toMatchObject({ action: 'error' });
    expect(plan.rows[0].errors[0]).toMatchObject({ col: 'id', reason: 'tt.err.idSyntax' });
  });

  it('vượt 2.000 Tag: bỏ phần vượt và báo số dòng', () => {
    const many = Array.from({ length: 1999 }, (_, i) => ({
      id: `T${i}`,
      kind: 'internal' as const,
      type: 'INT16' as const,
    }));
    const lines = ['Tên', 'N.1', 'N.2', 'N.3'].join('\n') + '\n';
    const plan = planCsvImport(enc(lines), table(many), OPTS);
    expect(plan.counts.add).toBe(1);
    expect(plan.counts.dropped).toBe(2);
    expect(plan.rows.map((r) => r.action)).toEqual(['add', 'dropped', 'dropped']);
  });
});

describe('xuất CSV', () => {
  it('UTF-8 có BOM, tiêu đề tiếng Việt, số theo dấu thập phân đã chọn; bỏ cột chỉ đọc', () => {
    const csv = tagsToCsv(table(), '.');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const head = csv.slice(1).split('\r\n')[0];
    expect(head.startsWith('Tên,Loại,Kiểu')).toBe(true);
    expect(head).not.toContain('Mã hàm');
    expect(csv).toContain('A.ONE,Ngoài,FLOAT32,Một');
    const vi = tagsToCsv(table(), ',');
    expect(vi).toContain(';');
    expect(vi).toContain('10,5');
  });

  it('xuất rồi nhập lại: mọi dòng giống, không sửa đổi nào', () => {
    for (const decimal of ['.', ','] as const) {
      const csv = tagsToCsv(table(), decimal);
      const plan = planCsvImport(enc(csv), table(), { decimal });
      expect(plan.counts).toMatchObject({ add: 0, update: 0, error: 0, same: 2 });
      expect(plan.edits).toEqual([]);
    }
  });

  it('ô bắt đầu bằng ký tự công thức được bọc để Excel không chạy; nhập lại bỏ lớp bọc', () => {
    const tags: TagV1[] = [
      { id: 'F.ONE', kind: 'calculated', type: 'FLOAT32', expression: '=A+1' },
    ];
    const csv = tagsToCsv(table(tags), '.');
    expect(csv).toContain("'=A+1");
    const plan = planCsvImport(enc(csv), table(tags), OPTS);
    expect(plan.counts.same).toBe(1);
  });
});
