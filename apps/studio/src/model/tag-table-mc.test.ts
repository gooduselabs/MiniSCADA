// Bảng Tag với thiết bị trường của kênh Mitsubishi MC (feature 017, US4, FR-011): địa chỉ theo ngữ pháp MC (xyNotation của
// thiết bị), lỗi cụ thể tại ô, dòng gợi ý (ví dụ theo kiểu, thiết bị, số, word), cột offset và số word, điền xuống, Thêm
// hàng loạt; thiết bị Modbus không đổi.
import type { TagV1 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n/index.ts';
import { planBulkAdd } from './grid/bulk-add.ts';
import { applyEdits, type EditableProject, type ProjectEdit } from './project-doc.ts';
import { addressHintText, tableInputs, tagTable, type DeviceInfo } from './tag-table.ts';

const DEVICES: DeviceInfo[] = [
  { id: 'plc1', name: 'PLC Modbus', addressBase: 0 },
  { id: 'fx5u', name: 'FX5U', channelKind: 'mc', xyNotation: 'octal' },
  { id: 'q03', name: 'Q03UDE', channelKind: 'mc', xyNotation: 'hex' },
];

const TAGS: TagV1[] = [
  { id: 'MC.D', kind: 'external', type: 'FLOAT32', source: { device: 'q03', address: 'D100' } },
  { id: 'MC.X', kind: 'external', type: 'BOOL', source: { device: 'fx5u', address: 'X17' } },
  { id: 'MC.BIT', kind: 'external', type: 'BOOL', source: { device: 'q03', address: 'D10.A' } },
  { id: 'MC.NEW', kind: 'external', type: 'INT16', source: { device: 'q03', address: '' } },
  { id: 'MB', kind: 'external', type: 'INT16', source: { device: 'plc1', address: 'HR10' } },
];

const make = (tags: TagV1[] = TAGS) =>
  tagTable({ tags, devices: DEVICES, version: '0.2', set: 'all' });
const rowOf = (id: string, tags: TagV1[] = TAGS) => tags.findIndex((x) => x.id === id);

function applyTo(tags: readonly TagV1[], edits: readonly ProjectEdit[]): TagV1[] {
  const base = {
    project: { schemaVersion: '1.1.0' },
    tags: { schemaVersion: '1.1.0', tags: structuredClone(tags) },
  } as unknown as EditableProject;
  return (applyEdits(base, edits).state.tags as { tags: TagV1[] }).tags;
}

describe('địa chỉ MC trong Bảng Tag', () => {
  it('đọc địa chỉ MC: thiết bị, số, số word; cột offset là số thiết bị, cột mã hàm trống', () => {
    const a = make();
    const r = rowOf('MC.D');
    expect(a.addressInfo(r)).toMatchObject({
      ok: true,
      normalized: 'D100',
      mc: { device: 'D', bitDevice: false, number: 100, words: 2, bit: null },
    });
    expect(a.text(r, 'offset')).toBe('100');
    expect(a.text(r, 'regs')).toBe('2');
    expect(a.text(r, 'fc')).toBe('');
    expect(addressHintText(a.addressInfo(r)!)).toBe('MC D (thiết bị word) · số 100 · 2 word');
  });

  it('X17 bát phân = điểm 15 (theo xyNotation của thiết bị); bit trong word', () => {
    const a = make();
    expect(a.addressInfo(rowOf('MC.X'))?.mc).toMatchObject({ device: 'X', number: 15 });
    expect(addressHintText(a.addressInfo(rowOf('MC.X'))!)).toMatch(/thiết bị bit/);
    const bit = a.addressInfo(rowOf('MC.BIT'))!;
    expect(bit.mc).toMatchObject({ device: 'D', number: 10, bit: 10 });
    expect(addressHintText(bit)).toBe('MC D (bit A trong word) · số 10 · 1 word');
  });

  it('gõ q100: lưu chữ hoa để bộ kiểm tra báo E_ADDR_SYNTAX tại ô; addressInfo báo lỗi MC', () => {
    const a = make();
    const r = rowOf('MC.D');
    const out = a.apply([{ row: r, col: 'address', text: 'q100' }]);
    expect(out.rejected).toEqual([]);
    const tags = applyTo(TAGS, out.edits);
    expect(tags[r].source?.address).toBe('Q100');
    expect(make(tags).addressInfo(r)).toEqual({ ok: false, error: 'tt.err.mcAddress' });
    // Chữ thường hợp lệ thì chuẩn hóa
    const ok = applyTo(TAGS, a.apply([{ row: r, col: 'address', text: 'zr1000' }]).edits);
    expect(ok[r].source?.address).toBe('ZR1000');
  });

  it('lỗi cụ thể: X18 trên thiết bị bát phân, M10 kiểu số, X ghi được, số quá lớn', () => {
    const tags: TagV1[] = [
      { id: 'A', kind: 'external', type: 'BOOL', source: { device: 'fx5u', address: 'X18' } },
      { id: 'B', kind: 'external', type: 'INT16', source: { device: 'q03', address: 'M10' } },
      {
        id: 'C',
        kind: 'external',
        type: 'BOOL',
        access: 'RW',
        source: { device: 'q03', address: 'X1' },
      },
      { id: 'D', kind: 'external', type: 'INT32', source: { device: 'q03', address: 'D16777215' } },
    ];
    const a = make(tags);
    expect(a.addressInfo(0)?.error).toBe('tt.err.mcOctal');
    expect(a.addressInfo(1)?.error).toBe('tt.err.mcAddressArea');
    expect(a.addressInfo(2)?.error).toBe('tt.err.mcAddressArea');
    expect(a.addressInfo(3)?.error).toBe('tt.err.mcAddressRange');
    expect(addressHintText(a.addressInfo(0)!)).toBe(t('tt.err.mcOctal'));
  });

  it('ô trống: gợi ý cú pháp MC theo kiểu Tag; Modbus giữ gợi ý cũ', () => {
    const a = make();
    expect(a.addressInfo(rowOf('MC.NEW'))).toBeNull();
    expect(a.addressSyntaxHint(rowOf('MC.NEW'))).toBe(
      'Địa chỉ Mitsubishi MC: D100, W1A, R200, ZR1000, TN5, SD8000',
    );
    expect(a.addressSyntaxHint(rowOf('MC.X'))).toMatch(/X17/);
    expect(a.addressSyntaxHint(rowOf('MB'))).toBe(t('tt.hint.syntax'));
  });

  it('thiết bị Modbus không đổi: HR10 vẫn là mã hàm 03, offset 10', () => {
    const a = make();
    const r = rowOf('MB');
    expect(a.addressInfo(r)).toMatchObject({ ok: true, normalized: 'HR10', offset: 10 });
    expect(a.addressInfo(r)?.mc).toBeUndefined();
    expect(a.text(r, 'fc')).toMatch(/^03/);
  });

  it('điền xuống: tăng theo số word và cơ số của thiết bị', () => {
    const a = make();
    expect(a.fillNext?.(rowOf('MC.D'), 'address', 'D100', 2)).toBe('D104');
    expect(a.fillNext?.(rowOf('MC.X'), 'address', 'X17', 1)).toBe('X20');
    expect(a.fillNext?.(rowOf('MC.BIT'), 'address', 'D10.E', 1)).toBe('D10.F');
    expect(a.fillNext?.(rowOf('MB'), 'address', 'HR10', 1)).toBe('HR11');
  });
});

describe('tableInputs và Thêm hàng loạt', () => {
  it('tableInputs gắn loại kênh và cách viết X, Y cho thiết bị MC', () => {
    const inputs = tableInputs({
      tags: { tags: [] },
      connections: {
        channels: [
          { kind: 'modbus-tcp', devices: [{ id: 'p', name: 'P', addressBase: 1 }] },
          {
            kind: 'mc',
            devices: [
              { id: 'm', name: 'M' },
              { id: 'f', name: 'F', xyNotation: 'octal' },
            ],
          },
        ],
      },
      valueTables: [],
    });
    expect(inputs.devices).toEqual([
      { id: 'p', name: 'P', addressBase: 1, byteOrder: undefined, kind: 'modbus-tcp' },
      {
        id: 'm',
        name: 'M',
        addressBase: undefined,
        byteOrder: undefined,
        kind: 'mc',
        channelKind: 'mc',
        xyNotation: 'hex',
      },
      {
        id: 'f',
        name: 'F',
        addressBase: undefined,
        byteOrder: undefined,
        kind: 'mc',
        channelKind: 'mc',
        xyNotation: 'octal',
      },
    ]);
  });

  it('20 FLOAT32 từ D100 trên thiết bị MC: D100, D102 … D138; địa chỉ Modbus bị từ chối', () => {
    const p = {
      count: 20,
      namePattern: 'TT_01',
      address: 'D100',
      step: null,
      type: 'FLOAT32' as const,
      device: 'q03',
      scanGroup: 'normal' as const,
    };
    const ctx = { existing: [], devices: DEVICES, total: 0 };
    const plan = planBulkAdd(p, ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.preview.map((x) => x.address).slice(0, 3)).toEqual(['D100', 'D102', 'D104']);
    expect(plan.preview[19].address).toBe('D138');
    expect(planBulkAdd({ ...p, address: 'HR100' }, ctx).errors[0]?.field).toBe('address');
    const bits = planBulkAdd({ ...p, type: 'BOOL', address: 'X16', count: 3, device: 'fx5u' }, ctx);
    expect(bits.preview.map((x) => x.address)).toEqual(['X16', 'X17', 'X20']);
  });
});
