// Dữ liệu mẫu cho test logic của Studio (feature 011, T132): Tag của trạm bơm trong mockup studio-logic.html và một
// logic.json hợp lệ (luật bơm tự bật/tắt theo mức, timer khởi động, counter số lần chạy, cộng dồn lưu lượng, giờ chạy, lịch).
import type { LogicDoc, TagV1 } from '@mat/project-schema';

export const LOGIC_TAGS: TagV1[] = [
  {
    id: 'TANK01.LEVEL',
    kind: 'external',
    type: 'FLOAT32',
    unit: '%',
    source: { device: 'plc1', address: 'HR100' },
  },
  {
    id: 'PUMP01.RUN_CMD',
    kind: 'external',
    type: 'BOOL',
    access: 'RW',
    source: { device: 'plc1', address: 'C10' },
  },
  { id: 'PUMP01.RUN', kind: 'external', type: 'BOOL', source: { device: 'plc1', address: 'C11' } },
  {
    id: 'FLOW01',
    kind: 'external',
    type: 'FLOAT32',
    unit: 'm³/h',
    source: { device: 'plc1', address: 'HR102' },
  },
  {
    id: 'VALVE02.SP',
    kind: 'external',
    type: 'FLOAT32',
    access: 'RW',
    source: { device: 'plc1', address: 'HR210' },
  },
  { id: 'INT.MODE_REQ', kind: 'internal', type: 'BOOL', access: 'RW', initial: false },
  { id: 'INT.MODE_AUTO', kind: 'internal', type: 'BOOL', access: 'RW', initial: false },
] as unknown as TagV1[];

export function pumpLogic(): LogicDoc {
  return {
    schemaVersion: '1.0.0',
    writes: [
      {
        id: 'w_pump_run',
        tag: 'PUMP01.RUN_CMD',
        allowed: { values: [true, false] },
        minIntervalMs: 30000,
        maxPerHour: 20,
      },
    ],
    rules: [
      {
        id: 'pump_high_level',
        name: 'Pump off at high level',
        enabled: true,
        when: 'TANK01.LEVEL > 80',
        hold: 5000,
        onRise: [{ do: 'write', write: 'w_pump_run', value: false }],
        onFall: [],
      },
      {
        id: 'pump_low_level',
        name: 'Pump on at low level',
        enabled: true,
        when: 'TANK01.LEVEL < 20 && LOGIC.DAY.Q',
        hold: 10000,
        onRise: [{ do: 'write', write: 'w_pump_run', value: true }],
        onFall: [],
      },
    ],
    timers: [
      {
        id: 't_start',
        kind: 'ton',
        in: 'PUMP01.RUN_CMD',
        pt: 5000,
        q: 'LOGIC.T_START.Q',
        et: 'LOGIC.T_START.ET',
      },
    ],
    counters: [
      {
        id: 'c_starts',
        up: 'PUMP01.RUN',
        down: null,
        reset: null,
        preset: 1000,
        value: 'LOGIC.C_STARTS.VALUE',
        reached: 'LOGIC.C_STARTS.REACHED',
        retain: true,
      },
    ],
    totalizers: [
      {
        id: 'z_flow',
        source: 'FLOW01',
        rateUnit: 'h',
        factor: 1,
        cutoff: 0.05,
        maxGapMs: 5000,
        reset: null,
        total: 'LOGIC.FLOW01.TOTAL',
        gapSeconds: 'LOGIC.FLOW01.GAP_S',
        retain: true,
      },
    ],
    runhours: [
      {
        id: 'h_pump',
        run: 'PUMP01.RUN',
        reset: null,
        serviceEveryHours: 500,
        hours: 'LOGIC.PUMP01.HOURS',
        starts: 'LOGIC.PUMP01.STARTS',
        due: 'LOGIC.PUMP01.DUE',
        retain: true,
      },
    ],
    schedules: [
      {
        id: 's_day',
        weekly: [{ days: [1, 2, 3, 4, 5, 6], from: '06:00', to: '18:00' }],
        exceptions: [{ date: '2026-12-25', mode: 'off' }],
        out: 'LOGIC.DAY.Q',
      },
    ],
  };
}
