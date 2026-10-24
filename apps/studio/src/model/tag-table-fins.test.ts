// Bảng Tag với thiết bị Omron FINS (feature 018): địa chỉ FINS kiểm bằng @mat/tag-codec (cùng vector với C++), cột
// mã hàm hiện lệnh và mã vùng, offset là địa chỉ gửi đi, lỗi có gợi ý cú pháp FINS, thứ tự word mặc định CDAB.
import type { TagV1 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { tableInputs, tagTable } from './tag-table.ts';

const TAGS: TagV1[] = [
  { id: 'A', kind: 'external', type: 'FLOAT32', source: { device: 'cj2', address: 'D200' } },
  { id: 'B', kind: 'external', type: 'BOOL', source: { device: 'cj2', address: 'CIO10.03' } },
  { id: 'C', kind: 'external', type: 'UINT16', source: { device: 'cj2', address: 'C12' } },
  { id: 'D', kind: 'external', type: 'UINT16', source: { device: 'cj2', address: 'A100' } },
  { id: 'E', kind: 'external', type: 'BOOL', source: { device: 'cj2', address: 'D100.16' } },
  { id: 'M', kind: 'external', type: 'INT16', source: { device: 'plc1', address: 'HR1' } },
];

const make = () =>
  tagTable({
    tags: TAGS,
    devices: [
      { id: 'cj2', name: 'CJ2M', byteOrder: 'CDAB', fins: true },
      { id: 'plc1', name: 'PLC', addressBase: 0 },
    ],
    valueTables: [],
    version: '0.2',
  });

describe('Bảng Tag: địa chỉ Omron FINS', () => {
  it('địa chỉ hợp lệ: lệnh và mã vùng, địa chỉ gửi đi, số word', () => {
    const t = make();
    expect(t.addressInfo(0)).toMatchObject({
      ok: true,
      normalized: 'D200',
      fc: '0101/0102 · 82',
      offset: 200,
      regs: 2,
    });
    expect(t.addressInfo(1)).toMatchObject({ ok: true, fc: '0101/0102 · 30', offset: 10, regs: 1 });
    expect(t.addressInfo(2)).toMatchObject({ ok: true, fc: '0101/0102 · 89', offset: 0x800c });
    expect(t.addressInfo(3)).toMatchObject({ ok: true, fc: '0101 · B3' }); // A0-A447 chỉ đọc
  });

  it('địa chỉ sai: lỗi cụ thể, dòng FINS có gợi ý cú pháp; dòng Modbus giữ cú pháp Modbus', () => {
    const t = make();
    expect(t.addressInfo(4)).toEqual({ ok: false, error: 'tt.err.address' });
    expect(t.isFinsRow(4)).toBe(true);
    expect(t.finsHint()).toMatch(/D100.*CIO10\.03.*E0_100/);
    expect(t.isFinsRow(5)).toBe(false);
    expect(t.addressInfo(5)).toMatchObject({ ok: true, normalized: 'HR1' });
  });

  it('gõ địa chỉ chữ thường trên thiết bị FINS: lưu chữ hoa', () => {
    const t = make();
    const out = t.apply([{ row: 0, col: 'address', text: 'e0_100' }]);
    expect(out.rejected).toEqual([]);
    expect(JSON.stringify(out.edits)).toContain('"E0_100"');
  });

  it('tableInputs: thiết bị của kênh fins mang cờ fins và thứ tự word CDAB mặc định', () => {
    const inputs = tableInputs({
      tags: { tags: [] },
      connections: {
        channels: [
          { kind: 'fins', devices: [{ id: 'cj2', name: 'CJ2M' }] },
          { kind: 'modbus-tcp', devices: [{ id: 'plc1', name: 'PLC' }] },
        ],
      },
      valueTables: [],
    });
    expect(inputs.devices).toEqual([
      {
        id: 'cj2',
        name: 'CJ2M',
        addressBase: undefined,
        byteOrder: 'CDAB',
        kind: 'fins',
        fins: true,
      },
      { id: 'plc1', name: 'PLC', addressBase: undefined, byteOrder: undefined, kind: 'modbus-tcp' },
    ]);
  });
});
