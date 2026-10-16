// Validator logic.json (feature 011, T128; FR-073, FR-075, FR-079, FR-093; contracts/logic-engine.md §1, §11):
// mỗi mã E_LOGIC_* và W_LOGIC_* có ít nhất một ca đúng và một ca sai; giới hạn số khối; `writes`; trùng đầu ra; vòng;
// tự kích; móc vào bộ kiểm project 1.0 (Tag logic tự khai thành Tag nội bộ chỉ đọc).
import { describe, expect, it } from 'vitest';
import {
  checkLogic,
  logicOrder,
  logicOutputs,
  logicTagsFromList,
  LOGIC_LIMITS,
  type LogicCheckOptions,
} from './rules-logic.ts';
import type { LogicDoc } from './types-10.ts';
import type { TagV1 } from './types-02.ts';

const TAGS: TagV1[] = [
  { id: 'TANK01.LEVEL', kind: 'external', type: 'FLOAT64', access: 'R' },
  { id: 'PUMP01.RUN', kind: 'external', type: 'BOOL', access: 'R' },
  { id: 'PUMP01.RUN_CMD', kind: 'external', type: 'BOOL', access: 'RW' },
  { id: 'VALVE02.SP', kind: 'external', type: 'FLOAT32', access: 'RW' },
  { id: 'MODE.CODE', kind: 'external', type: 'INT16', access: 'RW' },
  { id: 'FLOW01', kind: 'external', type: 'FLOAT64', access: 'R' },
  { id: 'INT.MODE', kind: 'internal', type: 'BOOL', access: 'RW' },
  { id: 'INT.COUNT', kind: 'internal', type: 'INT32', access: 'RW' },
  { id: 'INT.NAME', kind: 'internal', type: 'STRING', access: 'RW' },
  { id: 'CALC.MODE', kind: 'calculated', type: 'BOOL', expression: 'INT.MODE' },
];

const opts = (o: Partial<LogicCheckOptions> = {}): LogicCheckOptions => ({
  tags: logicTagsFromList(TAGS),
  ...o,
});
const doc = (d: Partial<LogicDoc>): LogicDoc => ({ schemaVersion: '1.0.0', ...d });
const run = (d: Partial<LogicDoc>, o: Partial<LogicCheckOptions> = {}) =>
  checkLogic(doc(d), opts(o));
const errs = (d: Partial<LogicDoc>, o: Partial<LogicCheckOptions> = {}) =>
  [...new Set(run(d, o).errors.map((e) => e.code))].sort();
const warns = (d: Partial<LogicDoc>, o: Partial<LogicCheckOptions> = {}) =>
  [...new Set(run(d, o).warnings.map((e) => e.code))].sort();

const W_PUMP = {
  id: 'w_pump',
  tag: 'PUMP01.RUN_CMD',
  allowed: { values: [true, false] },
  minIntervalMs: 30000,
  maxPerHour: 20,
};
const W_VALVE = {
  id: 'w_valve',
  tag: 'VALVE02.SP',
  allowed: { min: 0, max: 100 },
  minIntervalMs: 1000,
  maxPerHour: 60,
};
const rule = (o: Record<string, unknown> = {}) => ({
  id: 'r_low',
  when: 'TANK01.LEVEL < 20',
  hold: 1000,
  onRise: [{ do: 'write', write: 'w_pump', value: true }],
  ...o,
});
const timer = (o: Record<string, unknown> = {}) => ({
  id: 't_run',
  kind: 'ton',
  in: 'PUMP01.RUN',
  pt: 5000,
  q: 'LOGIC.T_RUN.Q',
  ...o,
});

describe('rules-logic: ca đúng', () => {
  it('ví dụ đầy đủ của contract §1 không lỗi, không cảnh báo', () => {
    const d: Partial<LogicDoc> = {
      writes: [W_PUMP],
      rules: [
        rule({ id: 'pump_low', when: 'TANK01.LEVEL < 20', hold: 10000 }),
        rule({
          id: 'pump_high',
          when: 'TANK01.LEVEL > 80',
          hold: 5000,
          onRise: [{ do: 'write', write: 'w_pump', value: false }],
        }),
      ],
      timers: [
        {
          id: 't_start',
          kind: 'ton',
          in: 'PUMP01.RUN_CMD',
          pt: 5000,
          q: 'LOGIC.T.Q',
          et: 'LOGIC.T.ET',
        },
      ],
      counters: [
        {
          id: 'c_starts',
          up: 'PUMP01.RUN',
          down: null,
          reset: 'LOGIC.RESET.Q',
          preset: 1000,
          value: 'LOGIC.C.VALUE',
          reached: 'LOGIC.C.REACHED',
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
          reset: 'LOGIC.RESET.Q',
          total: 'LOGIC.Z.TOTAL',
          gapSeconds: 'LOGIC.Z.GAP_S',
          retain: true,
        },
      ],
      runhours: [
        {
          id: 'h_pump',
          run: 'PUMP01.RUN',
          reset: null,
          serviceEveryHours: 500,
          hours: 'LOGIC.H.HOURS',
          starts: 'LOGIC.H.STARTS',
          due: 'LOGIC.H.DUE',
        },
      ],
      schedules: [
        {
          id: 's_day',
          tzOffsetMin: null,
          weekly: [{ days: [1, 2, 3, 4, 5, 6], from: '06:00', to: '18:00' }],
          exceptions: [{ date: '2026-12-25', mode: 'off' }],
          out: 'LOGIC.DAY.Q',
        },
        {
          id: 's_midnight',
          weekly: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '00:01' }],
          out: 'LOGIC.RESET.Q',
        },
      ],
    };
    const r = run(d);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('logic.json tối thiểu', () => {
    expect(run({})).toEqual({ errors: [], warnings: [] });
  });

  it('đầu ra và kiểu của Tag logic (contract §1)', () => {
    const outs = logicOutputs(
      doc({
        timers: [timer({ et: 'LOGIC.T_RUN.ET' })],
        counters: [{ id: 'c', up: 'PUMP01.RUN', value: 'L.C.V', reached: 'L.C.R', preset: 3 }],
        totalizers: [
          { id: 'z', source: 'FLOW01', rateUnit: 's', total: 'L.Z.T', gapSeconds: 'L.Z.G' },
        ],
        runhours: [{ id: 'h', run: 'PUMP01.RUN', hours: 'L.H.H', starts: 'L.H.S', due: 'L.H.D' }],
        schedules: [{ id: 's', weekly: [], out: 'L.S.Q' }],
      }),
    );
    expect(outs.map((o) => [o.tag, o.type, o.block, o.field])).toEqual([
      ['LOGIC.T_RUN.Q', 'BOOL', 't_run', 'q'],
      ['LOGIC.T_RUN.ET', 'INT64', 't_run', 'et'],
      ['L.C.V', 'INT64', 'c', 'value'],
      ['L.C.R', 'BOOL', 'c', 'reached'],
      ['L.Z.T', 'FLOAT64', 'z', 'total'],
      ['L.Z.G', 'FLOAT64', 'z', 'gapSeconds'],
      ['L.H.H', 'FLOAT64', 'h', 'hours'],
      ['L.H.S', 'INT64', 'h', 'starts'],
      ['L.H.D', 'BOOL', 'h', 'due'],
      ['L.S.Q', 'BOOL', 's', 'out'],
    ]);
  });
});

describe('rules-logic: từng mã E_LOGIC_*', () => {
  it('E_LOGIC_VERSION', () => {
    expect(checkLogic({ schemaVersion: '1.0.7' }, opts()).errors).toEqual([]);
    expect(checkLogic({ schemaVersion: '1.1.0' }, opts()).errors.map((e) => e.code)).toEqual([
      'E_LOGIC_VERSION',
    ]);
    expect(checkLogic({ schemaVersion: '2.0.0' }, opts()).errors.map((e) => e.code)).toEqual([
      'E_LOGIC_VERSION',
    ]);
  });

  it('E_LOGIC_LIMIT: số khối, số hành động, cỡ tệp, khung lịch, writes, hold, repeatMs', () => {
    const rules = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `r${String(i).padStart(3, '0')}`,
        when: 'INT.MODE',
      }));
    expect(errs({ rules: rules(LOGIC_LIMITS.rules) })).toEqual([]);
    expect(errs({ rules: rules(LOGIC_LIMITS.rules + 1) })).toEqual(['E_LOGIC_LIMIT']);
    const timers = (n: number) =>
      Array.from({ length: n }, (_, i) => timer({ id: `t${i}`, q: `L.T${i}` }));
    expect(errs({ timers: timers(100) })).toEqual([]);
    expect(errs({ timers: timers(101) })).toEqual(['E_LOGIC_LIMIT']);
    const acts = (n: number) =>
      Array.from({ length: n }, () => ({ do: 'toggle', tag: 'INT.MODE' }));
    expect(
      errs({ rules: [rule({ when: 'PUMP01.RUN', onRise: acts(5), onFall: acts(3) })] }),
    ).toEqual([]);
    expect(
      errs({ rules: [rule({ when: 'PUMP01.RUN', onRise: acts(5), onFall: acts(4) })] }),
    ).toEqual(['E_LOGIC_LIMIT']);
    expect(errs({}, { bytes: 512 * 1024 })).toEqual([]);
    expect(errs({}, { bytes: 512 * 1024 + 1 })).toEqual(['E_LOGIC_LIMIT']);
    const win = { days: [1], from: '01:00', to: '02:00' };
    expect(errs({ schedules: [{ id: 's', weekly: Array(16).fill(win), out: 'L.S' }] })).toEqual([]);
    expect(errs({ schedules: [{ id: 's', weekly: Array(17).fill(win), out: 'L.S' }] })).toEqual([
      'E_LOGIC_LIMIT',
    ]);
    expect(errs({ writes: [{ ...W_PUMP, minIntervalMs: 999 }] })).toEqual(['E_LOGIC_LIMIT']);
    expect(errs({ writes: [{ ...W_PUMP, maxPerHour: 0 }] })).toEqual(['E_LOGIC_LIMIT']);
    const noInterval: Partial<typeof W_PUMP> = { ...W_PUMP };
    delete noInterval.minIntervalMs;
    expect(errs({ writes: [noInterval as typeof W_PUMP] })).toEqual(['E_LOGIC_LIMIT']);
    expect(errs({ writes: [W_PUMP], rules: [rule({ hold: -1 })] })).toEqual(['E_LOGIC_LIMIT']);
    expect(errs({ writes: [W_PUMP], rules: [rule({ repeatMs: 9999 })] })).toEqual([
      'E_LOGIC_LIMIT',
    ]);
    expect(errs({ writes: [W_PUMP], rules: [rule({ repeatMs: 10000 })] })).toEqual([]);
    const long = 'INT.MODE' + ' && INT.MODE'.repeat(200);
    expect(errs({ rules: [{ id: 'r', when: long }] })).toEqual(['E_LOGIC_LIMIT']);
  });

  it('E_LOGIC_ID: dạng và trùng (một không gian id cho mọi loại khối)', () => {
    expect(errs({ rules: [{ id: 'a_1', when: 'INT.MODE' }] })).toEqual([]);
    expect(errs({ rules: [{ id: 'A1', when: 'INT.MODE' }] })).toEqual(['E_LOGIC_ID']);
    expect(errs({ rules: [{ id: '1a', when: 'INT.MODE' }] })).toEqual(['E_LOGIC_ID']);
    expect(errs({ rules: [{ id: 'a'.repeat(49), when: 'INT.MODE' }] })).toEqual(['E_LOGIC_ID']);
    expect(errs({ rules: [{ id: 'x', when: 'INT.MODE' }], timers: [timer({ id: 'x' })] })).toEqual([
      'E_LOGIC_ID',
    ]);
    expect(errs({ writes: [W_PUMP, W_PUMP] })).toEqual(['E_LOGIC_ID']);
    // Tag đầu ra sai dạng
    expect(errs({ timers: [timer({ q: 'LOGIC..Q' })] })).toEqual(['E_LOGIC_ID']);
  });

  it('E_LOGIC_TAG_REF', () => {
    expect(errs({ rules: [{ id: 'r', when: 'LOGIC.T_RUN.Q' }], timers: [timer()] })).toEqual([]);
    expect(errs({ rules: [{ id: 'r', when: 'NO.SUCH' }] })).toEqual(['E_LOGIC_TAG_REF']);
    expect(errs({ timers: [timer({ in: 'NO.SUCH' })] })).toEqual(['E_LOGIC_TAG_REF']);
    expect(errs({ writes: [{ ...W_PUMP, tag: 'NO.SUCH' }] })).toEqual(['E_LOGIC_TAG_REF']);
    expect(
      errs({ rules: [rule({ when: 'INT.MODE', onRise: [{ do: 'toggle', tag: 'NO.SUCH' }] })] }),
    ).toEqual(['E_LOGIC_TAG_REF']);
  });

  it('E_LOGIC_TYPE', () => {
    expect(errs({ rules: [{ id: 'r', when: 'TANK01.LEVEL > 1' }] })).toEqual([]);
    expect(errs({ rules: [{ id: 'r', when: 'TANK01.LEVEL' }] })).toEqual(['E_LOGIC_TYPE']);
    expect(
      errs({ totalizers: [{ id: 'z', source: 'INT.NAME', rateUnit: 's', total: 'L.Z' }] }),
    ).toEqual(['E_LOGIC_TYPE']);
    expect(
      errs({ totalizers: [{ id: 'z', source: 'FLOW01 * 2', rateUnit: 's', total: 'L.Z' }] }),
    ).toEqual([]);
    // toggle cần BOOL; setTag hằng phải khớp kiểu
    expect(
      errs({ rules: [rule({ when: 'INT.MODE', onRise: [{ do: 'toggle', tag: 'INT.COUNT' }] })] }),
    ).toEqual(['E_LOGIC_TYPE']);
    expect(
      errs({
        rules: [
          rule({ when: 'PUMP01.RUN', onRise: [{ do: 'setTag', tag: 'INT.COUNT', value: 'x' }] }),
        ],
      }),
    ).toEqual(['E_LOGIC_TYPE']);
    expect(
      errs({
        rules: [
          rule({ when: 'PUMP01.RUN', onRise: [{ do: 'setTag', tag: 'INT.COUNT', value: 1.5 }] }),
        ],
      }),
    ).toEqual(['E_LOGIC_TYPE']);
    expect(
      errs({
        rules: [
          rule({
            when: 'PUMP01.RUN',
            onRise: [{ do: 'setTag', tag: 'INT.COUNT', value: { expr: 'INT.NAME' } }],
          }),
        ],
      }),
    ).toEqual(['E_LOGIC_TYPE']);
    expect(
      errs({
        rules: [
          rule({
            when: 'PUMP01.RUN',
            onRise: [{ do: 'setTag', tag: 'INT.COUNT', value: { expr: 'round(TANK01.LEVEL)' } }],
          }),
        ],
      }),
    ).toEqual([]);
  });

  it('E_LOGIC_EXPR', () => {
    expect(errs({ rules: [{ id: 'r', when: 'INT.MODE && !PUMP01.RUN' }] })).toEqual([]);
    expect(errs({ rules: [{ id: 'r', when: 'INT.MODE &&' }] })).toEqual(['E_LOGIC_EXPR']);
    expect(errs({ rules: [{ id: 'r', when: '' }] })).toEqual(['E_LOGIC_EXPR']);
    expect(errs({ rules: [{ id: 'r', when: 'foo(1) > 0' }] })).toEqual(['E_LOGIC_EXPR']);
    expect(errs({ rules: [{ id: 'r', when: '"a" + 1 > 0' }] })).toEqual(['E_LOGIC_EXPR']);
  });

  it('E_LOGIC_TAG_COLLISION', () => {
    expect(errs({ timers: [timer({ q: 'LOGIC.A', et: 'LOGIC.B' })] })).toEqual([]);
    expect(errs({ timers: [timer({ q: 'PUMP01.RUN' })] })).toEqual(['E_LOGIC_TAG_COLLISION']);
    expect(errs({ timers: [timer({ q: 'LOGIC.A', et: 'LOGIC.A' })] })).toEqual([
      'E_LOGIC_TAG_COLLISION',
    ]);
    expect(errs({ timers: [timer(), timer({ id: 't2', in: 'INT.MODE' })] })).toEqual([
      'E_LOGIC_TAG_COLLISION',
    ]);
  });

  it('E_LOGIC_CYCLE', () => {
    const ok = {
      timers: [
        timer({ id: 't_a', in: 'PUMP01.RUN', q: 'L.A' }),
        timer({ id: 't_b', in: 'L.A', q: 'L.B' }),
      ],
    };
    expect(errs(ok)).toEqual([]);
    const loop = {
      timers: [
        timer({ id: 't_a', in: 'L.B', q: 'L.A' }),
        timer({ id: 't_b', in: 'L.A', q: 'L.B' }),
      ],
    };
    const r = run(loop);
    expect(r.errors.map((e) => e.code)).toEqual(['E_LOGIC_CYCLE']);
    expect(r.errors[0]!.message).toContain('t_a → t_b → t_a');
    expect(errs({ timers: [timer({ in: '!LOGIC.T_RUN.Q' })] })).toEqual(['E_LOGIC_CYCLE']);
  });

  it('E_LOGIC_SELF_TRIGGER (trực tiếp, qua khối, qua Tag tính toán)', () => {
    const set = (tag: string) => [{ do: 'setTag', tag, value: true }];
    expect(errs({ rules: [{ id: 'r', when: 'PUMP01.RUN', onRise: set('INT.MODE') }] })).toEqual([]);
    expect(errs({ rules: [{ id: 'r', when: 'INT.MODE', onRise: set('INT.MODE') }] })).toEqual([
      'E_LOGIC_SELF_TRIGGER',
    ]);
    expect(
      errs({
        rules: [{ id: 'r', when: 'LOGIC.T_RUN.Q', onFall: [{ do: 'toggle', tag: 'INT.MODE' }] }],
        timers: [timer({ in: 'INT.MODE' })],
      }),
    ).toEqual(['E_LOGIC_SELF_TRIGGER']);
    expect(errs({ rules: [{ id: 'r', when: 'CALC.MODE', onRise: set('INT.MODE') }] })).toEqual([
      'E_LOGIC_SELF_TRIGGER',
    ]);
    // luật khác đặt Tag mà luật này đọc: không phải tự kích
    expect(
      errs({
        rules: [
          { id: 'a', when: 'INT.MODE', onRise: [{ do: 'setTag', tag: 'INT.COUNT', value: 1 }] },
          { id: 'b', when: 'PUMP01.RUN', onRise: set('INT.MODE') },
        ],
      }),
    ).toEqual([]);
  });

  it('E_LOGIC_WRITE_UNDECLARED', () => {
    expect(errs({ writes: [W_PUMP], rules: [rule()] })).toEqual([]);
    expect(
      errs({
        writes: [W_PUMP],
        rules: [rule({ onRise: [{ do: 'write', write: 'w_x', value: true }] })],
      }),
    ).toEqual(['E_LOGIC_WRITE_UNDECLARED']);
    expect(
      errs({ rules: [rule({ onRise: [{ do: 'pulse', write: 'w_pump', value: true, ms: 500 }] })] }),
    ).toEqual(['E_LOGIC_WRITE_UNDECLARED']);
  });

  it('E_LOGIC_WRITE_TARGET', () => {
    expect(errs({ writes: [W_PUMP, W_VALVE] })).toEqual([]);
    expect(errs({ writes: [{ ...W_PUMP, tag: 'PUMP01.RUN' }] })).toEqual(['E_LOGIC_WRITE_TARGET']);
    expect(errs({ writes: [{ ...W_PUMP, tag: 'INT.MODE' }] })).toEqual(['E_LOGIC_WRITE_TARGET']);
    expect(errs({ writes: [{ ...W_PUMP, tag: 'LOGIC.T_RUN.Q' }], timers: [timer()] })).toEqual([
      'E_LOGIC_WRITE_TARGET',
    ]);
  });

  it('E_LOGIC_WRITE_VALUE', () => {
    const wv = (value: unknown, w = W_VALVE) =>
      errs({ writes: [w], rules: [rule({ onRise: [{ do: 'write', write: w.id, value }] })] });
    expect(wv(50)).toEqual([]);
    expect(wv(100)).toEqual([]);
    expect(wv(101)).toEqual(['E_LOGIC_WRITE_VALUE']);
    expect(wv(true)).toEqual(['E_LOGIC_WRITE_VALUE']);
    expect(wv({ expr: 'TANK01.LEVEL * 2' })).toEqual([]);
    expect(wv(true, W_PUMP as never)).toEqual([]);
    expect(wv(1, W_PUMP as never)).toEqual(['E_LOGIC_WRITE_VALUE']);
    expect(errs({ writes: [{ ...W_VALVE, allowed: { min: 10, max: 5 } }] })).toEqual([
      'E_LOGIC_WRITE_VALUE',
    ]);
    expect(errs({ writes: [{ ...W_PUMP, allowed: { values: [true, 2] } }] })).toEqual([
      'E_LOGIC_WRITE_VALUE',
    ]);
    expect(errs({ writes: [{ ...W_PUMP, allowed: { min: 0, max: 1 } }] })).toEqual([
      'E_LOGIC_WRITE_VALUE',
    ]);
    expect(
      errs({
        writes: [{ ...W_VALVE, id: 'w_mode', tag: 'MODE.CODE', allowed: { values: [1, 2.5] } }],
      }),
    ).toEqual(['E_LOGIC_WRITE_VALUE']);
  });

  it('E_LOGIC_ACTION', () => {
    const a = (act: Record<string, unknown>) =>
      errs({ writes: [W_PUMP], rules: [rule({ when: 'PUMP01.RUN', onRise: [act] })] });
    expect(a({ do: 'setTag', tag: 'INT.MODE', value: true })).toEqual([]);
    expect(a({ do: 'pulse', write: 'w_pump', value: true, ms: 100 })).toEqual([]);
    expect(a({ do: 'pulse', write: 'w_pump', value: true, ms: 10000 })).toEqual([]);
    expect(a({ do: 'pulse', write: 'w_pump', value: true, ms: 99 })).toEqual(['E_LOGIC_ACTION']);
    expect(a({ do: 'pulse', write: 'w_pump', value: true })).toEqual(['E_LOGIC_ACTION']);
    expect(a({ do: 'run', tag: 'INT.MODE' })).toEqual(['E_LOGIC_ACTION']);
    expect(a({ do: 'setTag', tag: 'PUMP01.RUN_CMD', value: true })).toEqual(['E_LOGIC_ACTION']);
    expect(a({ do: 'toggle', tag: 'CALC.MODE' })).toEqual(['E_LOGIC_ACTION']);
    expect(a({ do: 'toggle', tag: 'INT.MODE', value: true })).toEqual(['E_LOGIC_ACTION']);
    expect(a({ do: 'setTag', tag: 'INT.MODE' })).toEqual(['E_LOGIC_ACTION']);
    expect(a({ do: 'write', write: 'w_pump', tag: 'INT.MODE', value: true })).toEqual([
      'E_LOGIC_ACTION',
    ]);
    expect(
      errs({
        rules: [
          rule({
            when: 'PUMP01.RUN',
            onRise: [{ do: 'setTag', tag: 'LOGIC.T_RUN.Q', value: true }],
          }),
        ],
        timers: [timer({ in: 'INT.MODE' })],
      }),
    ).toEqual(['E_LOGIC_ACTION']);
  });

  it('E_LOGIC_TIMER', () => {
    expect(errs({ timers: [timer({ kind: 'tof', pt: 86_400_000 })] })).toEqual([]);
    expect(errs({ timers: [timer({ kind: 'tp', pt: 1 })] })).toEqual([]);
    expect(errs({ timers: [timer({ pt: 0 })] })).toEqual(['E_LOGIC_TIMER']);
    expect(errs({ timers: [timer({ pt: 86_400_001 })] })).toEqual(['E_LOGIC_TIMER']);
    expect(errs({ timers: [timer({ kind: 'TON' })] })).toEqual(['E_LOGIC_TIMER']);
  });

  it('E_LOGIC_COUNTER', () => {
    const c = (o: Record<string, unknown>) =>
      errs({ counters: [{ id: 'c', up: 'PUMP01.RUN', value: 'L.C', ...o }] });
    expect(c({ preset: 1, reached: 'L.R' })).toEqual([]);
    expect(c({ preset: null })).toEqual([]);
    expect(c({})).toEqual([]);
    expect(c({ preset: 0 })).toEqual(['E_LOGIC_COUNTER']);
    expect(c({ preset: -5 })).toEqual(['E_LOGIC_COUNTER']);
    expect(c({ preset: null, reached: 'L.R' })).toEqual(['E_LOGIC_COUNTER']);
  });

  it('E_LOGIC_TOTALIZER', () => {
    const z = (o: Record<string, unknown>) =>
      errs({ totalizers: [{ id: 'z', source: 'FLOW01', rateUnit: 'min', total: 'L.Z', ...o }] });
    expect(z({ factor: 0.001, cutoff: 0, rolloverAt: 99999.9, maxGapMs: 1 })).toEqual([]);
    expect(z({ rateUnit: 'hour' })).toEqual(['E_LOGIC_TOTALIZER']);
    expect(z({ factor: 0 })).toEqual(['E_LOGIC_TOTALIZER']);
    expect(z({ cutoff: -0.1 })).toEqual(['E_LOGIC_TOTALIZER']);
    expect(z({ maxGapMs: 0 })).toEqual(['E_LOGIC_TOTALIZER']);
    expect(z({ rolloverAt: 0 })).toEqual(['E_LOGIC_TOTALIZER']);
  });

  it('E_LOGIC_SCHEDULE', () => {
    const s = (o: Record<string, unknown>) =>
      errs({
        schedules: [
          { id: 's', weekly: [{ days: [1], from: '22:00', to: '06:00' }], out: 'L.S', ...o },
        ],
      });
    expect(s({})).toEqual([]);
    expect(s({ tzOffsetMin: -720 })).toEqual([]);
    expect(s({ tzOffsetMin: 841 })).toEqual(['E_LOGIC_SCHEDULE']);
    expect(s({ weekly: [{ days: [1], from: '06:00', to: '06:00' }] })).toEqual([
      'E_LOGIC_SCHEDULE',
    ]);
    expect(s({ weekly: [{ days: [0], from: '06:00', to: '07:00' }] })).toEqual([
      'E_LOGIC_SCHEDULE',
    ]);
    expect(s({ weekly: [{ days: [], from: '06:00', to: '07:00' }] })).toEqual(['E_LOGIC_SCHEDULE']);
    expect(s({ weekly: [{ days: [1, 1], from: '06:00', to: '07:00' }] })).toEqual([
      'E_LOGIC_SCHEDULE',
    ]);
    expect(s({ weekly: [{ days: [1], from: '24:00', to: '07:00' }] })).toEqual([
      'E_LOGIC_SCHEDULE',
    ]);
    expect(s({ weekly: [{ days: [1], from: '6:00', to: '07:00' }] })).toEqual(['E_LOGIC_SCHEDULE']);
    expect(s({ exceptions: [{ date: '2026-02-29', mode: 'on' }] })).toEqual(['E_LOGIC_SCHEDULE']);
    expect(s({ exceptions: [{ date: '2028-02-29', mode: 'on' }] })).toEqual([]);
    expect(s({ exceptions: [{ date: '2026-12-25', mode: 'skip' }] })).toEqual(['E_LOGIC_SCHEDULE']);
    expect(
      s({
        exceptions: [
          { date: '2026-12-25', mode: 'on' },
          { date: '2026-12-25', mode: 'off' },
        ],
      }),
    ).toEqual(['E_LOGIC_SCHEDULE']);
  });

  it('runhours: serviceEveryHours > 0', () => {
    const h = (o: Record<string, unknown>) =>
      errs({ runhours: [{ id: 'h', run: 'PUMP01.RUN', hours: 'L.H', ...o }] });
    expect(h({ serviceEveryHours: 0.5 })).toEqual([]);
    expect(h({ serviceEveryHours: 0 })).toEqual(['E_LOGIC_LIMIT']);
  });
});

describe('rules-logic: từng mã W_LOGIC_*', () => {
  it('W_LOGIC_PT_ROUNDED', () => {
    expect(warns({ timers: [timer({ pt: 100 })] })).toEqual([]);
    expect(warns({ timers: [timer({ pt: 80 })] })).toEqual(['W_LOGIC_PT_ROUNDED']);
    expect(warns({ timers: [timer({ pt: 150 })] }, { scanMs: 200 })).toEqual([
      'W_LOGIC_PT_ROUNDED',
    ]);
  });

  it('W_LOGIC_WRITE_CONFLICT: cùng điều kiện, cùng cạnh, cùng Tag, khác giá trị', () => {
    const low = rule({ id: 'a', when: 'TANK01.LEVEL < 20' });
    const high = rule({
      id: 'b',
      when: 'TANK01.LEVEL > 80',
      onRise: [{ do: 'write', write: 'w_pump', value: false }],
    });
    expect(warns({ writes: [W_PUMP], rules: [low, high] })).toEqual([]);
    const same = { ...high, when: 'TANK01.LEVEL<20' };
    expect(warns({ writes: [W_PUMP], rules: [low, same] })).toEqual(['W_LOGIC_WRITE_CONFLICT']);
    expect(
      warns({
        writes: [W_PUMP],
        rules: [
          rule({
            onRise: [
              { do: 'write', write: 'w_pump', value: true },
              { do: 'write', write: 'w_pump', value: false },
            ],
          }),
        ],
      }),
    ).toEqual(['W_LOGIC_WRITE_CONFLICT']);
  });

  it('W_LOGIC_RETAIN_IO: ước tính ghi đĩa/ngày > 100 MiB', () => {
    const counters = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `c${i}`, up: 'PUMP01.RUN', value: `L.C${i}` }));
    // (100 × 24 + 512 + 4096) × 8640 = 60,5 MB/ngày ở flushS 10
    expect(warns({ counters: counters(100) }, { flushS: 10 })).toEqual([]);
    const rules = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, when: 'INT.MODE' }));
    const tot = Array.from({ length: 50 }, (_, i) => ({
      id: `z${i}`,
      source: 'FLOW01',
      rateUnit: 's',
      total: `L.Z${i}`,
    }));
    // (350 × 24 + 4608) × 8640 = 112,4 MB > 104,9 MB
    expect(warns({ counters: counters(100), rules, totalizers: tot }, { flushS: 10 })).toEqual([
      'W_LOGIC_RETAIN_IO',
    ]);
    expect(warns({ counters: counters(100), rules, totalizers: tot }, { flushS: 60 })).toEqual([]);
  });

  it('W_LOGIC_WRITES_OFF: chỉ khi biết thiết bị đích đang tắt ghi', () => {
    expect(warns({ writes: [W_PUMP] })).toEqual([]);
    expect(warns({ writes: [W_PUMP] }, { deviceWrites: 'on' })).toEqual([]);
    expect(warns({}, { deviceWrites: 'off' })).toEqual([]);
    expect(warns({ writes: [W_PUMP] }, { deviceWrites: 'off' })).toEqual(['W_LOGIC_WRITES_OFF']);
  });

  it('W_LOGIC_NO_HOLD: hold = 0, ghi PLC, điều kiện đọc Tag thiết bị số', () => {
    expect(warns({ writes: [W_PUMP], rules: [rule({ hold: 1000 })] })).toEqual([]);
    expect(warns({ writes: [W_PUMP], rules: [rule({ hold: 0, when: 'PUMP01.RUN' })] })).toEqual([]);
    expect(
      warns({
        rules: [rule({ hold: 0, onRise: [{ do: 'setTag', tag: 'INT.MODE', value: true }] })],
      }),
    ).toEqual([]);
    expect(warns({ writes: [W_PUMP], rules: [rule({ hold: 0 })] })).toEqual(['W_LOGIC_NO_HOLD']);
    const noHold: Partial<ReturnType<typeof rule>> = rule();
    delete noHold.hold;
    expect(warns({ writes: [W_PUMP], rules: [noHold as ReturnType<typeof rule>] })).toEqual([
      'W_LOGIC_NO_HOLD',
    ]);
  });

  it('W_LOGIC_DISABLED', () => {
    expect(warns({ rules: [{ id: 'r', when: 'INT.MODE', enabled: true }] })).toEqual([]);
    expect(warns({ rules: [{ id: 'r', when: 'INT.MODE', enabled: false }] })).toEqual([
      'W_LOGIC_DISABLED',
    ]);
  });
});

describe('logicOrder: sắp xếp tô-pô ổn định theo id', () => {
  it('khối đọc đầu ra của khối khác đứng sau; hòa thì theo id', () => {
    const d = doc({
      rules: [{ id: 'a_rule', when: 'L.B' }],
      timers: [
        timer({ id: 'z_first', in: 'PUMP01.RUN', q: 'L.Z' }),
        timer({ id: 'b_second', in: 'L.Z', q: 'L.B' }),
      ],
      schedules: [{ id: 'm_sched', weekly: [], out: 'L.M' }],
    });
    expect(logicOrder(d)).toEqual({
      order: ['m_sched', 'z_first', 'b_second', 'a_rule'],
      cycles: [],
    });
  });

  it('vòng: các khối trong vòng không có trong thứ tự', () => {
    const d = doc({
      timers: [
        timer({ id: 't_a', in: 'L.B', q: 'L.A' }),
        timer({ id: 't_b', in: 'L.A', q: 'L.B' }),
      ],
      rules: [{ id: 'r', when: 'INT.MODE' }],
    });
    expect(logicOrder(d)).toEqual({ order: ['r'], cycles: [['t_a', 't_b']] });
  });
});
