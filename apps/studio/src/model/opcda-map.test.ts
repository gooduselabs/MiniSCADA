import { describe, expect, it } from 'vitest';
import { planOpcdaImport } from './opcda-map.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const CSV =
  '﻿id,type,address,access,qualityAddress,description,unit,opcItem\r\n' +
  'TANK1.LEVEL,FLOAT32,HR1,R,IR1,Mức bồn 1,%,Channel1.Device1.Level\r\n' +
  'PUMP1.RUN,BOOL,C1,RW,IR2,,,Channel1.Device1.PumpRun\r\n' +
  'BRIDGE_OK,UINT16,IR3,R,,Trạng thái cầu nối,,\r\n';

type Batch = {
  kind: 'batch';
  edits: { kind: string; index?: number; tag: Record<string, unknown> }[];
};

describe('planOpcdaImport', () => {
  it('tạo Tag external trỏ thiết bị cầu nối, kèm Tag quality', () => {
    const plan = planOpcdaImport(enc(CSV), [], { device: 'opcda1', withQuality: true });
    expect(plan.errors).toEqual([]);
    expect(plan.add).toBe(5);
    const tags = (plan.edits[0] as unknown as Batch).edits.map((e) => e.tag);
    expect(tags[0]).toEqual({
      id: 'TANK1.LEVEL',
      kind: 'external',
      type: 'FLOAT32',
      description: 'Mức bồn 1',
      unit: '%',
      access: 'R',
      source: { device: 'opcda1', address: 'HR1' },
    });
    expect(tags[1]).toMatchObject({
      id: 'TANK1.LEVEL_Q',
      type: 'UINT16',
      source: { address: 'IR1' },
    });
    expect(tags[2]).toMatchObject({
      id: 'PUMP1.RUN',
      type: 'BOOL',
      access: 'RW',
      description: 'OPC DA: Channel1.Device1.PumpRun',
    });
    expect(tags[4]).toMatchObject({ id: 'BRIDGE_OK', access: 'R', source: { address: 'IR3' } });
  });

  it('cập nhật Tag cùng tên (không phân biệt hoa thường), không thêm quality khi tắt', () => {
    const plan = planOpcdaImport(enc(CSV), [{ id: 'X' }, { id: 'tank1.level' }], {
      device: 'd',
      withQuality: false,
    });
    expect(plan.add).toBe(2);
    expect(plan.update).toBe(1);
    expect((plan.edits[0] as unknown as Batch).edits[0]).toMatchObject({
      kind: 'tagUpsert',
      index: 1,
    });
  });

  it('báo lỗi từng dòng, bỏ dòng lỗi', () => {
    const csv =
      'id;type;address\n1BAD;FLOAT32;HR1\nA.B;STRING;HR1\nA.C;INT16;XX1\nA.D;INT16;HR2\nA.D;INT16;HR3\n';
    const plan = planOpcdaImport(enc(csv), [], { device: 'd', withQuality: true });
    expect(plan.errors.map((e) => e.line)).toEqual([2, 3, 4, 6]);
    expect(plan.add).toBe(1);
  });

  it('lỗi cả file: rỗng hoặc thiếu cột', () => {
    expect(planOpcdaImport(enc(''), [], { device: 'd', withQuality: true }).fatal).toBe('empty');
    expect(
      planOpcdaImport(enc('id,type\nA,BOOL\n'), [], { device: 'd', withQuality: true }).fatal,
    ).toMatch(/address/);
  });
});
