// Thêm hàng loạt (feature 006, T123, FR-045, US1-11): số dòng, mẫu tên có số tăng, địa chỉ bắt đầu, bước (mặc định bằng
// số thanh ghi của kiểu), kiểu, thiết bị trường, nhóm quét; một bước hoàn tác.
import type { TagV1 } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { applyEdits, type EditableProject } from '../project-doc.ts';
import { planBulkAdd, type BulkAddParams } from './bulk-add.ts';

const DEVICES = [{ id: 'plc1-main', name: 'PLC chính' }];
const base: BulkAddParams = {
  count: 50,
  namePattern: 'TT_01',
  address: 'HR100',
  step: null,
  type: 'FLOAT32',
  device: 'plc1-main',
  scanGroup: 'normal',
};
const ctx = { existing: [] as string[], devices: DEVICES, total: 0 };

describe('planBulkAdd', () => {
  it('50 FLOAT32 mẫu TT_01 từ HR100: TT_01…TT_50 ở HR100, HR102, …, HR198', () => {
    const plan = planBulkAdd(base, ctx);
    expect(plan.errors).toEqual([]);
    expect(plan.tags).toHaveLength(50);
    expect(plan.tags[0]).toMatchObject({
      id: 'TT_01',
      kind: 'external',
      type: 'FLOAT32',
      source: { device: 'plc1-main', address: 'HR100' },
    });
    expect(plan.tags[1].source).toMatchObject({ address: 'HR102' });
    expect(plan.tags[49]).toMatchObject({ id: 'TT_50', source: { address: 'HR198' } });
    expect(plan.preview[49]).toEqual({ id: 'TT_50', address: 'HR198' });
  });

  it('một bước hoàn tác: đúng một sửa đổi batch gồm các tagUpsert', () => {
    const plan = planBulkAdd(base, ctx);
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].kind).toBe('batch');
    const project = {
      project: { schemaVersion: '0.2.0' },
      tags: { schemaVersion: '0.2.0', tags: [] as TagV1[] },
    } as unknown as EditableProject;
    const next = applyEdits(project, plan.edits).state.tags as { tags: TagV1[] };
    expect(next.tags).toHaveLength(50);
  });

  it('nhóm quét mặc định normal không ghi vào Tag; fast, slow có ghi', () => {
    expect((planBulkAdd(base, ctx).tags[0].source ?? {}).scanGroup).toBeUndefined();
    expect(planBulkAdd({ ...base, scanGroup: 'fast' }, ctx).tags[0].source?.scanGroup).toBe('fast');
  });

  it('bước tự đặt thay cho số thanh ghi của kiểu', () => {
    const plan = planBulkAdd({ ...base, count: 3, step: 10 }, ctx);
    expect(plan.tags.map((x) => x.source?.address)).toEqual(['HR100', 'HR110', 'HR120']);
  });

  it('kiểu 16 bit bước 1; BOOL ở coil bước 1; bit trong thanh ghi tăng chỉ số bit', () => {
    expect(
      planBulkAdd({ ...base, count: 3, type: 'INT16' }, ctx).tags.map((x) => x.source?.address),
    ).toEqual(['HR100', 'HR101', 'HR102']);
    expect(
      planBulkAdd({ ...base, count: 3, type: 'BOOL', address: 'C5' }, ctx).tags.map(
        (x) => x.source?.address,
      ),
    ).toEqual(['C5', 'C6', 'C7']);
    expect(
      planBulkAdd({ ...base, count: 3, type: 'BOOL', address: 'HR10.14' }, ctx).errors.length,
    ).toBe(1);
  });

  it('địa chỉ Modicon và chữ thường được chuẩn hóa', () => {
    const plan = planBulkAdd({ ...base, count: 2, address: '40101', type: 'INT32' }, ctx);
    expect(plan.tags.map((x) => x.source?.address)).toEqual(['40101', '40103']);
    expect(planBulkAdd({ ...base, count: 1, address: 'hr7' }, ctx).tags[0].source?.address).toBe(
      'HR7',
    );
  });

  it('lỗi: số dòng, mẫu tên, địa chỉ, thiết bị, vượt 2.000, tên đã có, vượt khoảng địa chỉ', () => {
    const keys = (p: Partial<BulkAddParams>, c = ctx) =>
      planBulkAdd({ ...base, ...p }, c).errors.map((e) => e.field);
    expect(keys({ count: 0 })).toEqual(['count']);
    expect(keys({ count: 2001 })).toContain('count');
    expect(keys({ namePattern: '1bad' })).toEqual(['namePattern']);
    expect(keys({ address: 'XX1' })).toEqual(['address']);
    expect(keys({ device: 'lạ' })).toEqual(['device']);
    expect(keys({ step: 0 })).toEqual(['step']);
    expect(keys({ count: 10 }, { ...ctx, total: 1995 })).toContain('count');
    expect(keys({ count: 3 }, { ...ctx, existing: ['TT_02'] })).toEqual(['namePattern']);
    expect(keys({ count: 20, address: 'HR65530' })).toEqual(['address']);
    expect(planBulkAdd({ ...base, count: 0 }, ctx).edits).toEqual([]);
  });

  it('mẫu tên không có số thì thêm _1, _2…', () => {
    const plan = planBulkAdd({ ...base, count: 3, namePattern: 'PUMP.RUN' }, ctx);
    expect(plan.tags.map((x) => x.id)).toEqual(['PUMP.RUN', 'PUMP.RUN_1', 'PUMP.RUN_2']);
  });

  it('STRING cần độ dài và bước theo số thanh ghi', () => {
    expect(planBulkAdd({ ...base, type: 'STRING', count: 2 }, ctx).errors[0].field).toBe(
      'stringLength',
    );
    const plan = planBulkAdd({ ...base, type: 'STRING', count: 2, stringLength: 20 }, ctx);
    expect(plan.tags.map((x) => x.source?.address)).toEqual(['HR100', 'HR110']);
    expect(plan.tags[0].source?.stringLength).toBe(20);
  });
});
