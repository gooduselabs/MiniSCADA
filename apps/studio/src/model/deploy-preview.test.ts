// Xem trước Nạp xuống của logic và chip "Ghi PLC" (feature 011, T132/T143; FR-082, FR-083, FR-096; T007 quyết định 1, 4, 5):
// danh sách Tag logic sẽ tự động ghi xuống PLC, trạng thái `logic.writes` của thiết bị đích (tắt, bật, dừng, chưa hỗ trợ),
// cảnh báo W_LOGIC_WRITES_OFF, bắt buộc xác nhận khi có ghi tự động, ai được "Dừng ghi của logic".
import { describe, expect, it } from 'vitest';
import type { DeviceInfo } from './device.ts';
import { logicChip, logicDeployPreview, logicDeviceWrites } from './deploy-preview.ts';
import { addAction, addBlock, emptyLogic, updateBlock } from './logic-doc.ts';
import { pumpLogic } from './logic-fixtures.ts';

const info = (logic?: unknown): DeviceInfo =>
  ({
    runtimeVersion: '1.0.0',
    ...(logic === undefined ? {} : { logic }),
  }) as DeviceInfo;

describe('deploy-preview: trạng thái ghi PLC của thiết bị', () => {
  it('system/info.logic.writes → tắt/bật/dừng; thiết bị cũ (không có khối logic) → chưa hỗ trợ; chưa hỏi → không rõ', () => {
    expect(logicDeviceWrites(info({ present: true, writes: 'off' }))).toBe('off');
    expect(logicDeviceWrites(info({ present: true, writes: 'on' }))).toBe('on');
    expect(logicDeviceWrites(info({ present: false, writes: 'stopped' }))).toBe('stopped');
    expect(logicDeviceWrites(info({ present: true, writes: 'lạ' }))).toBe('off');
    expect(logicDeviceWrites(info())).toBe('unsupported');
    expect(logicDeviceWrites(null)).toBe('unknown');
  });

  it('chip Ghi PLC: chỉ administrator và khi đang bật mới "Dừng ghi"; "Bật" luôn khóa (LOGIC_ENABLE_ROOT_ONLY)', () => {
    expect(logicChip(info({ writes: 'on' }), 'administrator')).toEqual({
      state: 'on',
      canStop: true,
      stopBlocked: null,
      enableBlocked: 'LOGIC_ENABLE_ROOT_ONLY',
    });
    expect(logicChip(info({ writes: 'on' }), 'engineer')).toMatchObject({
      state: 'on',
      canStop: false,
      stopBlocked: 'role',
    });
    expect(logicChip(info({ writes: 'off' }), 'administrator')).toMatchObject({
      state: 'off',
      canStop: false,
      stopBlocked: 'not-on',
    });
    expect(logicChip(info({ writes: 'stopped' }), 'administrator')).toMatchObject({
      state: 'stopped',
      canStop: false,
    });
    expect(logicChip(info(), 'administrator')).toMatchObject({
      state: 'unsupported',
      canStop: false,
      stopBlocked: 'unsupported',
    });
  });
});

describe('deploy-preview: Logic sẽ tự động ghi N Tag xuống PLC', () => {
  it('không có logic, hoặc logic không khai writes: không có dòng', () => {
    expect(logicDeployPreview(null, info({ writes: 'on' }))).toBeNull();
    expect(logicDeployPreview(emptyLogic(), info({ writes: 'on' }))).toBeNull();
    const noWrites = addBlock(emptyLogic(), 'timer').doc;
    expect(logicDeployPreview(noWrites, info({ writes: 'on' }))).toBeNull();
  });

  it('liệt kê mục writes: Tag thiết bị, giá trị cho phép, tần suất, luật ghi; luôn bắt xác nhận', () => {
    const pv = logicDeployPreview(pumpLogic(), info({ writes: 'on' }))!;
    expect(pv.writes).toEqual([
      {
        write: 'w_pump_run',
        tag: 'PUMP01.RUN_CMD',
        allowed: { values: [true, false] },
        minIntervalMs: 30000,
        maxPerHour: 20,
        rules: ['pump_high_level', 'pump_low_level'],
        pulseMs: null,
      },
    ]);
    expect(pv.tagCount).toBe(1);
    expect(pv.device).toBe('on');
    expect(pv.warning).toBeNull();
    expect(pv.needsAck).toBe(true);
  });

  it('thiết bị đang tắt ghi: W_LOGIC_WRITES_OFF, vẫn phải xác nhận (T007 quyết định 5)', () => {
    const pv = logicDeployPreview(pumpLogic(), info({ writes: 'off' }))!;
    expect(pv.device).toBe('off');
    expect(pv.warning).toBe('W_LOGIC_WRITES_OFF');
    expect(pv.needsAck).toBe(true);
    expect(logicDeployPreview(pumpLogic(), info({ writes: 'stopped' }))!.warning).toBeNull();
    expect(logicDeployPreview(pumpLogic(), info())!.device).toBe('unsupported');
  });

  it('xung (pulse): ghi lại độ dài; nhiều mục cùng một Tag đếm một Tag; mục chưa luật nào dùng vẫn liệt kê', () => {
    let doc = addBlock(pumpLogic(), 'writes').doc; // w_1
    doc = updateBlock(doc, 'writes', 'w_1', {
      tag: 'PUMP01.RUN_CMD',
      allowed: { values: [true] },
      minIntervalMs: 5000,
      maxPerHour: 30,
    });
    doc = addAction(doc, 'pump_low_level', 'onFall', {
      do: 'pulse',
      write: 'w_1',
      value: true,
      ms: 500,
    });
    let doc2 = addBlock(doc, 'writes').doc; // w_2: chưa dùng
    doc2 = updateBlock(doc2, 'writes', 'w_2', {
      tag: 'VALVE02.SP',
      allowed: { min: 0, max: 100 },
      minIntervalMs: 60000,
      maxPerHour: 10,
    });
    const pv = logicDeployPreview(doc2, info({ writes: 'on' }))!;
    expect(pv.writes.map((w) => [w.write, w.pulseMs, w.rules])).toEqual([
      ['w_pump_run', null, ['pump_high_level', 'pump_low_level']],
      ['w_1', 500, ['pump_low_level']],
      ['w_2', null, []],
    ]);
    expect(pv.tagCount).toBe(2);
  });
});
