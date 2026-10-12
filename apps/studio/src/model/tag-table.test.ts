// Adapter Bảng Tag cho mat-grid (feature 006, T121, FR-045, FR-015, data-model §1): bộ cột theo loại, trình sửa ô,
// địa chỉ (chữ hoa, mã hàm, offset, số thanh ghi), điền xuống tăng địa chỉ, lỗi tại ô, mức dùng tags.json, 0.1 qua adapter 0.1.
import type { TagV1 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { applyEdits, type EditableProject, type ProjectEdit } from './project-doc.ts';
import {
  COLUMN_SETS,
  MAX_TAG_ROWS,
  TAGS_FILE_LIMIT,
  loadColumnChoice,
  saveColumnChoice,
  tagTable,
  tagsFileUsage,
  type TagTable,
} from './tag-table.ts';

const DEVICES = [
  { id: 'plc1-main', name: 'PLC chính', addressBase: 0 as const },
  { id: 'meter3', name: 'Đồng hồ 3', addressBase: 1 as const },
];

const TAGS: TagV1[] = [
  {
    id: 'TANK01.LEVEL',
    kind: 'external',
    type: 'FLOAT32',
    description: 'Mức bồn 1',
    unit: 'm',
    source: { device: 'plc1-main', address: 'HR100' },
  },
  {
    id: 'TANK01.SP',
    kind: 'external',
    type: 'INT16',
    access: 'RW',
    source: { device: 'plc1-main', address: 'HR10', scanGroup: 'slow' },
  },
  { id: 'MODE', kind: 'internal', type: 'INT16', initial: 1, retain: true },
  { id: 'TANK01.PCT', kind: 'calculated', type: 'FLOAT32', expression: 'TANK01.LEVEL / 3 * 100' },
  {
    id: 'SIM.A',
    kind: 'simulation',
    type: 'FLOAT32',
    sim: { kind: 'sine', center: 5, amplitude: 1, periodMs: 1000 },
  },
];

function make(extra: Partial<Parameters<typeof tagTable>[0]> = {}): TagTable {
  return tagTable({
    tags: TAGS,
    devices: DEVICES,
    valueTables: ['TrangThaiBom'],
    version: '0.2',
    ...extra,
  });
}

/** Áp sửa đổi lên danh sách Tag như store làm. */
function applyTo(tags: readonly TagV1[], edits: readonly ProjectEdit[]): TagV1[] {
  const base = {
    project: { schemaVersion: '0.2.0' },
    tags: { schemaVersion: '0.2.0', tags: structuredClone(tags) },
  } as unknown as EditableProject;
  return (applyEdits(base, edits).state.tags as { tags: TagV1[] }).tags;
}

const rowOf = (a: TagTable, id: string) => {
  for (let i = 0; i < a.rowCount(); i++) if (a.text(i, 'id') === id) return i;
  throw new Error(id);
};

describe('bộ cột', () => {
  it('mỗi loại một bộ cột; tất cả gồm mọi cột; tên luôn đứng đầu', () => {
    for (const set of ['external', 'internal', 'calculated', 'simulation'] as const) {
      expect(COLUMN_SETS[set][0]).toBe('id');
    }
    expect(COLUMN_SETS.external).toEqual(
      expect.arrayContaining(['device', 'address', 'fc', 'offset', 'regs', 'scanGroup']),
    );
    expect(COLUMN_SETS.internal).toEqual(expect.arrayContaining(['initial', 'retain']));
    expect(COLUMN_SETS.calculated).toContain('expression');
    expect(COLUMN_SETS.simulation).toContain('simKind');
    expect(COLUMN_SETS.all.length).toBeGreaterThan(COLUMN_SETS.external.length);
    expect(make({ set: 'internal' }).columns.map((c) => c.key)).toEqual([...COLUMN_SETS.internal]);
  });

  it('chọn cột tự do: giữ thứ tự chuẩn, bỏ khóa lạ, tên luôn có', () => {
    const a = make({ columns: ['unit', 'bogus', 'address'] });
    expect(a.columns.map((c) => c.key)).toEqual(['id', 'unit', 'address']);
  });

  it('nhớ lựa chọn trong thiết lập của Studio; hỏng hoặc thiếu thì về mặc định', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    expect(loadColumnChoice(storage)).toEqual({ set: 'all', columns: null });
    saveColumnChoice(storage, { set: 'external', columns: ['id', 'address'] });
    expect(loadColumnChoice(storage)).toEqual({ set: 'external', columns: ['id', 'address'] });
    data.set([...data.keys()][0], '{xấu');
    expect(loadColumnChoice(storage)).toEqual({ set: 'all', columns: null });
    expect(loadColumnChoice(null)).toEqual({ set: 'all', columns: null });
  });

  it('cột sống chen ngay sau tên khi Online; chỉ đọc; chữ lấy từ liveText', () => {
    const a = make({
      live: true,
      liveText: (id, col) => (col === 'value' ? `v:${id}` : col === 'quality' ? 'GOOD' : ''),
    });
    expect(a.columns.slice(0, 4).map((c) => c.key)).toEqual(['id', 'value', 'quality', 'reason']);
    expect(a.columns[1].kind).toBe('live');
    expect(a.text(0, 'value')).toBe('v:TANK01.LEVEL');
    expect(a.editable(0, 'value')).toBe(false);
  });
});

describe('nội dung ô', () => {
  const a = make();
  it('chữ của ô theo loại', () => {
    const r = rowOf(a, 'TANK01.LEVEL');
    expect(a.text(r, 'kind')).toBe('Ngoài');
    expect(a.text(r, 'type')).toBe('FLOAT32');
    expect(a.text(r, 'device')).toBe('plc1-main');
    expect(a.text(r, 'address')).toBe('HR100');
    expect(a.text(r, 'scanGroup')).toBe('normal');
    expect(a.text(r, 'access')).toBe('R');
    expect(a.text(rowOf(a, 'TANK01.SP'), 'scanGroup')).toBe('slow');
    expect(a.text(rowOf(a, 'MODE'), 'retain')).toBe('Có');
    expect(a.text(rowOf(a, 'MODE'), 'initial')).toBe('1');
    expect(a.text(rowOf(a, 'SIM.A'), 'simKind')).toBe('Hình sin');
  });

  it('địa chỉ: mã hàm, offset thật và số thanh ghi từ @mat/tag-codec', () => {
    const r = rowOf(a, 'TANK01.LEVEL');
    expect(a.text(r, 'fc')).toBe('03 / 06, 16');
    expect(a.text(r, 'offset')).toBe('100');
    expect(a.text(r, 'regs')).toBe('2');
    const sp = rowOf(a, 'TANK01.SP');
    expect(a.text(sp, 'regs')).toBe('1');
  });

  it('addressBase 1 của thiết bị trường làm offset lệch 1 với địa chỉ Modicon', () => {
    const b = make({
      tags: [
        {
          id: 'M.A',
          kind: 'external',
          type: 'INT16',
          source: { device: 'meter3', address: '40101' },
        },
      ],
    });
    expect(b.text(0, 'offset')).toBe('100');
    expect(b.text(0, 'regs')).toBe('1');
  });

  it('ô không dùng cho loại Tag thì không sửa được và trống', () => {
    const m = rowOf(a, 'MODE');
    expect(a.editable(m, 'address')).toBe(false);
    expect(a.text(m, 'address')).toBe('');
    expect(a.editable(m, 'initial')).toBe(true);
    expect(a.editable(rowOf(a, 'TANK01.LEVEL'), 'expression')).toBe(false);
    expect(a.editable(rowOf(a, 'TANK01.PCT'), 'expression')).toBe(true);
    expect(a.editable(rowOf(a, 'TANK01.LEVEL'), 'fc')).toBe(false);
  });

  it('trình sửa ô: danh sách chọn cho loại, kiểu, thiết bị trường, nhóm quét, bảng giá trị', () => {
    expect(a.options?.(0, 'kind')).toEqual(['Ngoài', 'Nội bộ', 'Tính toán', 'Mô phỏng']);
    expect(a.options?.(0, 'type')).toContain('FLOAT32');
    expect(a.options?.(0, 'device')).toEqual(['plc1-main', 'meter3']);
    expect(a.options?.(0, 'scanGroup')).toEqual(['fast', 'normal', 'slow']);
    expect(a.options?.(0, 'valueTable')).toEqual(['', 'TrangThaiBom']);
    expect(a.options?.(0, 'description')).toBeNull();
  });

  it('giới hạn dòng bằng LIMITS_02.tags', () => {
    expect(a.maxRows).toBe(MAX_TAG_ROWS);
    expect(MAX_TAG_ROWS).toBe(2000);
  });
});

describe('sửa ô thành sửa đổi project', () => {
  it('mô tả, đơn vị: tagField; xóa chữ thì bỏ khóa', () => {
    const a = make();
    const r = rowOf(a, 'TANK01.LEVEL');
    const out = a.apply([
      { row: r, col: 'description', text: 'Mức mới' },
      { row: r, col: 'unit', text: '' },
    ]);
    expect(out.rejected).toEqual([]);
    const next = applyTo(TAGS, out.edits)[r];
    expect(next.description).toBe('Mức mới');
    expect('unit' in next).toBe(false);
  });

  it('địa chỉ: chữ thường thành chữ hoa; ô địa chỉ chỉ chạm source', () => {
    const a = make();
    const r = rowOf(a, 'TANK01.LEVEL');
    const out = a.apply([{ row: r, col: 'address', text: ' hr120 ' }]);
    expect(out.rejected).toEqual([]);
    const next = applyTo(TAGS, out.edits)[r];
    expect(next.source).toEqual({ device: 'plc1-main', address: 'HR120' });
  });

  it('địa chỉ sai: vẫn lưu chữ hoa để bộ kiểm tra đánh dấu tại ô; addressInfo báo lỗi cụ thể', () => {
    const a = make();
    const r = rowOf(a, 'TANK01.LEVEL');
    const out = a.apply([{ row: r, col: 'address', text: 'xx5' }]);
    expect(out.rejected).toEqual([]);
    const tags = applyTo(TAGS, out.edits);
    expect((tags[r].source ?? {}).address).toBe('XX5');
    const b = make({ tags });
    expect(b.addressInfo(r)).toMatchObject({ ok: false, error: 'tt.err.address' });
    const area = make({
      tags: applyTo(
        TAGS,
        a.apply([{ row: rowOf(a, 'TANK01.SP'), col: 'address', text: 'IR5' }]).edits,
      ),
    });
    expect(area.addressInfo(rowOf(area, 'TANK01.SP'))).toMatchObject({
      error: 'tt.err.addressArea',
    });
    const range = make({
      tags: applyTo(TAGS, a.apply([{ row: r, col: 'address', text: 'HR70000' }]).edits),
    });
    expect(range.addressInfo(r)).toMatchObject({ error: 'tt.err.addressRange' });
    expect(a.addressInfo(r)).toMatchObject({ ok: true, normalized: 'HR100', offset: 100, regs: 2 });
  });

  it('thiết bị trường phải có trong Kết nối; đổi theo id hoặc theo tên', () => {
    const a = make();
    const r = rowOf(a, 'TANK01.LEVEL');
    expect(a.apply([{ row: r, col: 'device', text: 'khong-co' }]).rejected[0].reason).toBe(
      'tt.err.device',
    );
    const ok = a.apply([{ row: r, col: 'device', text: 'Đồng hồ 3' }]);
    expect((applyTo(TAGS, ok.edits)[r].source ?? {}).device).toBe('meter3');
  });

  it('số: dấu chấm; rỗng bỏ khóa; không phải số bị từ chối', () => {
    const a = make();
    const r = rowOf(a, 'TANK01.LEVEL');
    const out = a.apply([
      { row: r, col: 'min', text: '0' },
      { row: r, col: 'max', text: '12.5' },
      { row: r, col: 'deadband', text: '0.1' },
    ]);
    const next = applyTo(TAGS, out.edits)[r];
    expect(next).toMatchObject({ min: 0, max: 12.5, deadband: 0.1 });
    expect(a.apply([{ row: r, col: 'max', text: 'abc' }]).rejected[0].reason).toBe('tt.err.number');
    expect(a.apply([{ row: r, col: 'deadband', text: '-1' }]).rejected[0].reason).toBe(
      'tt.err.negative',
    );
  });

  it('giới hạn ghi và thang đo gộp vào một đối tượng', () => {
    const a = make();
    const r = rowOf(a, 'TANK01.SP');
    const out = a.apply([
      { row: r, col: 'limMin', text: '0' },
      { row: r, col: 'limMax', text: '90' },
    ]);
    expect(applyTo(TAGS, out.edits)[r].limits).toEqual({ min: 0, max: 90 });
    const sc = a.apply([{ row: rowOf(a, 'TANK01.LEVEL'), col: 'rawMax', text: '1000' }]);
    expect(applyTo(TAGS, sc.edits)[0].scaling).toEqual({
      rawMin: 0,
      rawMax: 1000,
      engMin: 0,
      engMax: 100,
    });
  });

  it('quyền R là mặc định nên bỏ khóa; RW ghi khóa; bảng giá trị chỉ nhận tên có thật', () => {
    const a = make();
    const sp = rowOf(a, 'TANK01.SP');
    const r0 = a.apply([{ row: sp, col: 'access', text: 'r' }]);
    expect('access' in applyTo(TAGS, r0.edits)[sp]).toBe(false);
    const rw = a.apply([{ row: 0, col: 'access', text: 'RW' }]);
    expect(applyTo(TAGS, rw.edits)[0].access).toBe('RW');
    expect(a.apply([{ row: 0, col: 'valueTable', text: 'Lạ' }]).rejected[0].reason).toBe(
      'tt.err.valueTable',
    );
    const vt = a.apply([{ row: 0, col: 'valueTable', text: 'TrangThaiBom' }]);
    expect(applyTo(TAGS, vt.edits)[0].valueTable).toBe('TrangThaiBom');
  });

  it('đổi loại: bỏ phần của loại cũ, thêm phần của loại mới', () => {
    const a = make();
    const r = rowOf(a, 'TANK01.LEVEL');
    const toInt = applyTo(TAGS, a.apply([{ row: r, col: 'kind', text: 'Nội bộ' }]).edits)[r];
    expect(toInt.kind).toBe('internal');
    expect('source' in toInt).toBe(false);
    const m = rowOf(a, 'MODE');
    const toExt = applyTo(TAGS, a.apply([{ row: m, col: 'kind', text: 'external' }]).edits)[m];
    expect(toExt.kind).toBe('external');
    expect(toExt.source).toEqual({ device: 'plc1-main', address: '' });
    expect('initial' in toExt).toBe(false);
    expect('retain' in toExt).toBe(false);
    const toCalc = applyTo(TAGS, a.apply([{ row: r, col: 'kind', text: 'Tính toán' }]).edits)[r];
    expect(toCalc.expression).toBe('');
    expect(toCalc.access).toBeUndefined();
  });

  it('giá trị đầu theo kiểu; giữ qua mất điện nhận Có/Không', () => {
    const a = make();
    const m = rowOf(a, 'MODE');
    const out = a.apply([
      { row: m, col: 'initial', text: '7' },
      { row: m, col: 'retain', text: 'Không' },
    ]);
    const next = applyTo(TAGS, out.edits)[m];
    expect(next.initial).toBe(7);
    expect('retain' in next).toBe(false);
    expect(a.apply([{ row: m, col: 'initial', text: 'abc' }]).rejected[0].reason).toBe(
      'tt.err.initial',
    );
    expect(a.apply([{ row: m, col: 'retain', text: 'có lẽ' }]).rejected[0].reason).toBe(
      'tt.err.bool',
    );
  });

  it('mô phỏng: chọn kiểu đặt tham số mặc định', () => {
    const a = make();
    const r = rowOf(a, 'SIM.A');
    const next = applyTo(TAGS, a.apply([{ row: r, col: 'simKind', text: 'Dốc' }]).edits)[r];
    expect(next.sim).toMatchObject({ kind: 'ramp' });
  });

  it('nhiều ô cùng dòng (dán) gộp thành một sửa đổi cho mỗi trường', () => {
    const a = make();
    const r = rowOf(a, 'TANK01.LEVEL');
    const out = a.apply([
      { row: r, col: 'address', text: 'HR200' },
      { row: r, col: 'scanGroup', text: 'fast' },
    ]);
    const src = out.edits.filter((e) => e.kind === 'tagField' && e.field === 'source');
    expect(src).toHaveLength(1);
    expect(applyTo(TAGS, out.edits)[r].source).toEqual({
      device: 'plc1-main',
      address: 'HR200',
      scanGroup: 'fast',
    });
  });

  it('tên: đúng luật, không trùng, không rỗng', () => {
    const a = make();
    const r = rowOf(a, 'TANK01.LEVEL');
    expect(a.apply([{ row: r, col: 'id', text: '1abc' }]).rejected[0].reason).toBe(
      'tt.err.idSyntax',
    );
    expect(a.apply([{ row: r, col: 'id', text: 'MODE' }]).rejected[0].reason).toBe('tt.err.idDup');
    expect(a.apply([{ row: r, col: 'id', text: '' }]).rejected[0].reason).toBe('tt.err.idRequired');
    expect(a.apply([{ row: r, col: 'id', text: 'TANK01.LEVEL' }]).rejected).toEqual([]);
    const ok = a.apply([{ row: r, col: 'id', text: 'TANK01.LVL' }]);
    expect(applyTo(TAGS, ok.edits)[r].id).toBe('TANK01.LVL');
  });

  it('tên trùng giữa các dòng mới trong cùng lần dán: dòng sau bị từ chối', () => {
    const a = make();
    const out = a.apply([
      { row: null, newIndex: 0, col: 'id', text: 'NEW.A' },
      { row: null, newIndex: 1, col: 'id', text: 'NEW.A' },
    ]);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]).toMatchObject({ row: null, newIndex: 1, reason: 'tt.err.idDup' });
  });

  it('dòng mới: Tag ngoài đầu tiên của thiết bị; kiểu và loại theo bộ cột đang xem', () => {
    const a = make({ set: 'internal' });
    const out = a.apply([
      { row: null, newIndex: 0, col: 'id', text: 'N.ONE' },
      { row: null, newIndex: 0, col: 'type', text: 'bool' },
    ]);
    const tags = applyTo(TAGS, out.edits);
    expect(tags.at(-1)).toMatchObject({ id: 'N.ONE', kind: 'internal', type: 'BOOL' });
    const ext = make({ set: 'external' }).apply([
      { row: null, newIndex: 0, col: 'id', text: 'N.TWO' },
      { row: null, newIndex: 0, col: 'address', text: 'hr5' },
    ]);
    expect(applyTo(TAGS, ext.edits).at(-1)).toMatchObject({
      id: 'N.TWO',
      kind: 'external',
      type: 'FLOAT32',
      source: { device: 'plc1-main', address: 'HR5' },
    });
  });

  it('xóa dòng và thêm dòng cuối', () => {
    const a = make();
    expect(a.remove?.([1, 3])).toEqual([
      { kind: 'tagRemove', index: 3 },
      { kind: 'tagRemove', index: 1 },
    ]);
    const add = a.append?.();
    expect(add?.row).toBe(TAGS.length);
    expect(applyTo(TAGS, add!.edits)).toHaveLength(TAGS.length + 1);
  });
});

describe('điền xuống địa chỉ', () => {
  const a = make();
  it('tăng theo số thanh ghi của kiểu của dòng đích', () => {
    const f32 = rowOf(a, 'TANK01.LEVEL');
    const i16 = rowOf(a, 'TANK01.SP');
    expect(a.fillNext?.(f32, 'address', 'HR100', 1)).toBe('HR102');
    expect(a.fillNext?.(f32, 'address', 'HR100', 3)).toBe('HR106');
    expect(a.fillNext?.(i16, 'address', 'HR100', 3)).toBe('HR103');
    expect(a.fillNext?.(f32, 'address', '40101', 1)).toBe('40103');
  });
  it('bit trong thanh ghi tăng chỉ số bit; cột khác dùng mặc định', () => {
    expect(a.fillNext?.(0, 'address', 'HR100.3', 2)).toBe('HR100.5');
    expect(a.fillNext?.(0, 'description', 'x', 1)).toBeUndefined();
    expect(a.fillNext?.(0, 'address', 'rác', 1)).toBeUndefined();
  });
});

describe('mức dùng tags.json (R2)', () => {
  it('đếm byte của file ghi ra so với trần 1 MiB; cảnh báo từ 85 %', () => {
    expect(TAGS_FILE_LIMIT).toBe(1024 * 1024);
    const small = tagsFileUsage(TAGS);
    expect(small.bytes).toBeGreaterThan(100);
    expect(small.level).toBe('ok');
    const big = Array.from({ length: 2000 }, (_, i) => ({
      id: `T${i}`,
      kind: 'internal' as const,
      type: 'STRING' as const,
      initial: 'x'.repeat(480),
    }));
    const u = tagsFileUsage(big);
    expect(u.ratio).toBeGreaterThan(0.85);
    expect(['warn', 'full']).toContain(u.level);
    expect(tagsFileUsage(big.concat(big)).level).toBe('full');
  });
});

describe('project 0.1 qua adapter 0.1', () => {
  const v1 = [
    {
      id: 'TANK01.LEVEL',
      type: 'FLOAT32',
      unit: 'm',
      min: 0,
      max: 10,
      source: { kind: 'mock', signal: 'sine' },
    },
    { id: 'MOTOR01.RUN', type: 'BOOL' },
  ] as never[];
  it('cột của 004; sửa được khi không chỉ đọc; nguồn chỉ đọc', () => {
    const a = tagTable({ tags: v1, version: '0.1' });
    expect(a.columns.map((c) => c.key)).toEqual([
      'id',
      'type',
      'source',
      'unit',
      'min',
      'max',
      'description',
    ]);
    expect(a.text(0, 'source')).toContain('sine');
    expect(a.editable(0, 'source')).toBe(false);
    expect(a.editable(0, 'unit')).toBe(true);
    const out = a.apply([{ row: 1, col: 'unit', text: 'V' }]);
    expect(out.edits).toEqual([{ kind: 'tagField', index: 1, field: 'unit', value: 'V' }]);
  });
  it('chỉ đọc: không ô nào sửa được', () => {
    const a = tagTable({ tags: v1, version: '0.1', readOnly: true });
    expect(a.editable(0, 'unit')).toBe(false);
    expect(a.maxRows).toBe(0);
  });
});

describe('tableInputs', () => {
  it('lấy Tag, thiết bị trường của mọi kênh và tên bảng giá trị từ outline', async () => {
    const { tableInputs } = await import('./tag-table.ts');
    const r = tableInputs({
      tags: { tags: [{ id: 'A' }] },
      connections: {
        channels: [
          { devices: [{ id: 'd1', name: 'D1', addressBase: 1 }] },
          { devices: [{ id: 'd2', name: 'D2' }] },
        ],
      },
      valueTables: [{ name: 'VT' }],
    });
    expect(r.tags).toHaveLength(1);
    expect(r.devices?.map((d) => [d.id, d.addressBase])).toEqual([
      ['d1', 1],
      ['d2', undefined],
    ]);
    expect(r.valueTables).toEqual(['VT']);
    expect(tableInputs({ tags: null, connections: null, valueTables: [] })).toEqual({
      tags: [],
      devices: [],
      valueTables: [],
    });
  });
});

describe('thuộc tính phụ và nhóm cho Inspector (FR-047)', () => {
  it('nhóm thuộc tính theo loại và kiểu của Tag', async () => {
    const { propertyGroups } = await import('./tag-table.ts');
    const keys = (tag: unknown) => propertyGroups(tag).map((g) => g.key);
    expect(keys(TAGS[0])).toEqual(['general', 'source', 'scaling', 'limits']);
    expect(keys(TAGS[2])).toEqual(['general', 'limits', 'initial']);
    expect(keys(TAGS[3])).toEqual(['general', 'expression']);
    expect(keys(TAGS[4])).toEqual(['general', 'limits', 'simulation']);
    const ext = propertyGroups(TAGS[0]).find((g) => g.key === 'source')!;
    expect(ext.fields.map((f) => f.col)).toEqual(
      expect.arrayContaining([
        'device',
        'address',
        'fc',
        'offset',
        'regs',
        'scanGroup',
        'rawType',
        'byteOrder',
        'readback',
      ]),
    );
    const str = propertyGroups({
      id: 'S',
      kind: 'external',
      type: 'STRING',
      source: { device: 'd', address: 'HR1', stringLength: 10 },
    });
    expect(str.find((g) => g.key === 'source')!.fields.map((f) => f.col)).toEqual(
      expect.arrayContaining(['stringLength', 'stringByteOrder']),
    );
    expect(str.find((g) => g.key === 'limits')!.fields.map((f) => f.col)).toEqual(['maxLength']);
    const sine = propertyGroups(TAGS[4]).find((g) => g.key === 'simulation')!;
    expect(sine.fields.map((f) => f.col)).toEqual([
      'simKind',
      'simCenter',
      'simAmplitude',
      'simPeriodMs',
      'simPhase',
    ]);
    expect(propertyGroups(TAGS[3]).find((g) => g.key === 'expression')!.fields[0]).toMatchObject({
      col: 'expression',
      kind: 'multiline',
    });
  });

  it('sửa cột phụ: độ dài chuỗi, thứ tự byte chuỗi, đọc lại, clamp, độ dài tối đa, tham số mô phỏng', () => {
    const tags: TagV1[] = [
      {
        id: 'S1',
        kind: 'external',
        type: 'STRING',
        access: 'RW',
        source: { device: 'plc1-main', address: 'HR10', stringLength: 10 },
      },
      {
        id: 'F1',
        kind: 'external',
        type: 'FLOAT32',
        source: { device: 'plc1-main', address: 'HR20' },
        scaling: { rawMin: 0, rawMax: 100, engMin: 0, engMax: 1 },
      },
      {
        id: 'SIM',
        kind: 'simulation',
        type: 'FLOAT32',
        sim: { kind: 'sine', center: 5, amplitude: 1, periodMs: 1000 },
      },
    ];
    const a = make({ tags });
    const s = applyTo(
      tags,
      a.apply([
        { row: 0, col: 'stringLength', text: '20' },
        { row: 0, col: 'stringByteOrder', text: 'ba' },
        { row: 0, col: 'readback', text: 'Không' },
        { row: 0, col: 'maxLength', text: '8' },
      ]).edits,
    )[0];
    expect(s.source).toEqual({
      device: 'plc1-main',
      address: 'HR10',
      stringLength: 20,
      stringByteOrder: 'BA',
      readback: false,
    });
    expect(s.limits).toEqual({ maxLength: 8 });
    expect(a.text(0, 'stringByteOrder')).toBe('AB');
    expect(a.text(0, 'readback')).toBe('Có');
    const f = applyTo(tags, a.apply([{ row: 1, col: 'clamp', text: 'Có' }]).edits)[1];
    expect(f.scaling?.clamp).toBe(true);
    const sim = applyTo(
      tags,
      a.apply([
        { row: 2, col: 'simAmplitude', text: '2.5' },
        { row: 2, col: 'simPhase', text: '0.25' },
      ]).edits,
    )[2];
    expect(sim.sim).toMatchObject({ kind: 'sine', amplitude: 2.5, phase: 0.25 });
    expect(a.text(2, 'simCenter')).toBe('5');
    expect(a.apply([{ row: 0, col: 'stringLength', text: '300' }]).rejected[0].reason).toBe(
      'tt.err.stringLength',
    );
    expect(a.apply([{ row: 2, col: 'simAmplitude', text: 'x' }]).rejected[0].reason).toBe(
      'tt.err.number',
    );
    expect(a.apply([{ row: 0, col: 'simAmplitude', text: '1' }]).rejected[0].reason).toBe(
      'tt.err.notApplicable',
    );
    expect(a.apply([{ row: 1, col: 'stringLength', text: '5' }]).rejected[0].reason).toBe(
      'tt.err.notApplicable',
    );
  });
});
