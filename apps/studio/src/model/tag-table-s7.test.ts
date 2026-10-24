// Bảng Tag với Tag của CPU Siemens S7 (feature 016, US4, contracts/s7-driver.md §2): địa chỉ S7 kiểm bằng parseS7Address, chuẩn
// hóa (chữ hoa, E→I, A→Q, bỏ số 0 đầu), lỗi theo mã bằng tiếng Việt, gợi ý định dạng S7, cột thứ tự byte không dùng cho Tag S7,
// điền xuống theo cỡ kiểu S7, nhóm thuộc tính không có thứ tự byte. Tag Modbus giữ nguyên hành vi.
import type { TagV1 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { applyEdits, type EditableProject, type ProjectEdit } from './project-doc.ts';
import { propertyGroups, tableInputs, tagTable, type TagTable } from './tag-table.ts';
import { t } from '../i18n/index.ts';

const DEVICES = [
  { id: 'plc1-main', name: 'PLC chính', addressBase: 0 as const, kind: 'modbus-tcp' },
  { id: 'cpu1', name: 'CPU 1214C', kind: 's7' },
];

const TAGS: TagV1[] = [
  {
    id: 'TANK01.LEVEL',
    kind: 'external',
    type: 'FLOAT32',
    source: { device: 'plc1-main', address: 'HR100' },
  },
  {
    id: 'S7.TEMP',
    kind: 'external',
    type: 'FLOAT32',
    source: { device: 'cpu1', address: 'DB1.DBD4' },
  },
  {
    id: 'S7.RUN',
    kind: 'external',
    type: 'BOOL',
    source: { device: 'cpu1', address: 'DB1.DBX0.0' },
  },
  {
    id: 'S7.NAME',
    kind: 'external',
    type: 'STRING',
    source: { device: 'cpu1', address: 'DB1.STRING10', stringLength: 20 },
  },
];

function make(tags: readonly TagV1[] = TAGS): TagTable {
  return tagTable({ tags, devices: DEVICES, valueTables: [], version: '0.2' });
}

function applyTo(tags: readonly TagV1[], edits: readonly ProjectEdit[]): TagV1[] {
  const base = {
    project: { schemaVersion: '1.1.0' },
    tags: { schemaVersion: '1.1.0', tags: structuredClone(tags) },
  } as unknown as EditableProject;
  return (applyEdits(base, edits).state.tags as { tags: TagV1[] }).tags;
}

const rowOf = (a: TagTable, id: string) => {
  for (let i = 0; i < a.rowCount(); i++) if (a.text(i, 'id') === id) return i;
  throw new Error(id);
};

describe('Bảng Tag: địa chỉ S7', () => {
  it('tableInputs mang loại kênh của thiết bị trường', () => {
    const inputs = tableInputs({
      tags: { tags: [] },
      connections: {
        channels: [
          { kind: 'modbus-tcp', devices: [{ id: 'plc1', name: 'PLC' }] },
          { kind: 's7', devices: [{ id: 'cpu1', name: 'CPU' }] },
        ],
      },
      valueTables: [],
    });
    expect(inputs.devices?.map((d) => [d.id, d.kind])).toEqual([
      ['plc1', 'modbus-tcp'],
      ['cpu1', 's7'],
    ]);
  });

  it('địa chỉ đúng: chuẩn hóa theo S7 (chữ hoa, E→I, bỏ số 0 đầu), thông tin vùng, kiểu, cỡ', () => {
    const a = make();
    const r = rowOf(a, 'S7.TEMP');
    const out = a.apply([{ row: r, col: 'address', text: ' db01.dbd008 ' }]);
    expect(out.rejected).toEqual([]);
    expect(applyTo(TAGS, out.edits)[r].source?.address).toBe('DB1.DBD8');
    const run = rowOf(a, 'S7.RUN');
    const e = a.apply([{ row: run, col: 'address', text: 'e0.1' }]);
    expect(applyTo(TAGS, e.edits)[run].source?.address).toBe('I0.1');
    expect(a.addressInfo(r)).toMatchObject({
      ok: true,
      normalized: 'DB1.DBD4',
      s7: { area: 'DB', type: 'REAL', size: 4 },
    });
    expect(a.addressInfo(rowOf(a, 'S7.NAME'))).toMatchObject({
      ok: true,
      s7: { type: 'STRING', size: 22 },
    });
    // Cột mã hàm, offset, thanh ghi của Modbus để trống với Tag S7.
    expect(a.text(r, 'fc')).toBe('');
    expect(a.text(r, 'offset')).toBe('');
    expect(a.text(r, 'regs')).toBe('');
  });

  it('địa chỉ sai: lưu chữ hoa để bộ kiểm tra đánh dấu; lỗi theo mã bằng tiếng Việt của S7', () => {
    const a = make();
    const r = rowOf(a, 'S7.TEMP');
    const syntax = applyTo(TAGS, a.apply([{ row: r, col: 'address', text: 'hr100' }]).edits);
    expect(syntax[r].source?.address).toBe('HR100');
    expect(make(syntax).addressInfo(r)).toMatchObject({ ok: false, error: 'tt.err.s7Address' });
    const range = applyTo(TAGS, a.apply([{ row: r, col: 'address', text: 'DB0.DBD4' }]).edits);
    expect(make(range).addressInfo(r)).toMatchObject({ error: 'tt.err.s7AddressRange' });
    const area = applyTo(TAGS, a.apply([{ row: r, col: 'address', text: 'DB1.DBW4' }]).edits);
    expect(make(area).addressInfo(r)).toMatchObject({ error: 'tt.err.s7AddressArea' });
  });

  it('gợi ý định dạng theo loại kênh của Tag; Tag Modbus giữ gợi ý và chuẩn hóa cũ', () => {
    const a = make();
    expect(a.addressSyntaxHint(rowOf(a, 'S7.TEMP'))).toBe(t('tt.hint.s7Syntax'));
    const m = rowOf(a, 'TANK01.LEVEL');
    expect(a.addressSyntaxHint(m)).toBe(t('tt.hint.syntax'));
    expect(a.addressInfo(m)).toMatchObject({ ok: true, normalized: 'HR100', offset: 100, regs: 2 });
    expect(a.addressInfo(m)?.s7).toBeUndefined();
    const out = a.apply([{ row: m, col: 'address', text: ' hr120 ' }]);
    expect(applyTo(TAGS, out.edits)[m].source?.address).toBe('HR120');
  });

  it('thứ tự byte và thứ tự byte chuỗi: không dùng cho Tag S7 (ô trống, không sửa được)', () => {
    const a = make();
    const r = rowOf(a, 'S7.TEMP');
    expect(a.text(r, 'byteOrder')).toBe('');
    expect(a.editable(r, 'byteOrder')).toBe(false);
    const s = rowOf(a, 'S7.NAME');
    expect(a.text(s, 'stringByteOrder')).toBe('');
    expect(a.editable(s, 'stringByteOrder')).toBe(false);
    expect(a.apply([{ row: r, col: 'byteOrder', text: 'CDAB' }]).rejected).toHaveLength(1);
    // Tag Modbus 32 bit vẫn có thứ tự byte.
    expect(a.editable(rowOf(a, 'TANK01.LEVEL'), 'byteOrder')).toBe(true);
  });

  it('đổi thiết bị trường sang CPU S7: bỏ thứ tự byte của Modbus', () => {
    const tags: TagV1[] = [
      {
        id: 'X',
        kind: 'external',
        type: 'FLOAT32',
        source: { device: 'plc1-main', address: 'HR10', byteOrder: 'CDAB' },
      },
    ];
    const a = make(tags);
    const next = applyTo(tags, a.apply([{ row: 0, col: 'device', text: 'cpu1' }]).edits);
    expect(next[0].source).toEqual({ device: 'cpu1', address: 'HR10' });
  });

  it('điền xuống theo cỡ kiểu S7: DBD +4, DBW +2, bit tăng qua byte', () => {
    const a = make();
    expect(a.fillNext?.(rowOf(a, 'S7.TEMP'), 'address', 'DB1.DBD4', 2)).toBe('DB1.DBD12');
    expect(a.fillNext?.(rowOf(a, 'S7.RUN'), 'address', 'DB1.DBX0.7', 1)).toBe('DB1.DBX1.0');
    expect(a.fillNext?.(rowOf(a, 'S7.RUN'), 'address', 'M10.6', 3)).toBe('M11.1');
    expect(a.fillNext?.(rowOf(a, 'S7.NAME'), 'address', 'DB1.STRING10', 1)).toBe('DB1.STRING32');
    expect(a.fillNext?.(rowOf(a, 'S7.TEMP'), 'address', 'rác', 1)).toBeUndefined();
  });

  it('Inspector: nhóm Nguồn của Tag S7 không có thứ tự byte, mã hàm, offset, thanh ghi', () => {
    const cols = (tag: TagV1, s7: boolean) =>
      propertyGroups(tag, { s7 })
        .find((g) => g.key === 'source')!
        .fields.map((f) => f.col);
    const s7 = cols(TAGS[3]!, true);
    for (const c of ['byteOrder', 'stringByteOrder', 'fc', 'offset', 'regs'])
      expect(s7).not.toContain(c);
    expect(s7).toContain('stringLength');
    const modbus = cols({ ...TAGS[3]!, source: { device: 'plc1-main', address: 'HR1' } }, false);
    expect(modbus).toContain('stringByteOrder');
    expect(modbus).toContain('fc');
  });
});
