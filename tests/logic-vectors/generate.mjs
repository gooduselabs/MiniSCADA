// Sinh bộ vector logic dùng chung TS (packages/logic-engine) và C++ (core/logic): contracts/logic-engine.md §12,
// định dạng ở README.md cùng thư mục. Tất định, không phụ thuộc gói ngoài, KHÔNG import engine:
//
//   node tests/logic-vectors/generate.mjs
//
// - Kỳ vọng suy từ contract (§2-§11) và các quyết định ghi ở README.md: viết tay theo từng họ ca, hoặc tính bằng công
//   thức tham chiếu viết riêng ở đây (totalizer: hình thang đúng thứ tự phép toán của §5; giờ chạy: tổng ms).
// - Ra: tests/logic-vectors/<nhóm>.json = { group, cases } (mỗi ca một dòng).
// - Script tự kiểm số ca tối thiểu của từng nhóm (§12) và tổng (≥ 200), id duy nhất.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ======================================================================================
// Nền chung
// ======================================================================================

/** Tag dùng chung của mọi ca (ca có thể thay bằng `tags` riêng). */
const TAGS = {
  LEVEL: { type: 'FLOAT64', kind: 'external', writable: false },
  RUN: { type: 'BOOL', kind: 'external', writable: false },
  IN: { type: 'BOOL', kind: 'external', writable: false },
  UP: { type: 'BOOL', kind: 'external', writable: false },
  DOWN: { type: 'BOOL', kind: 'external', writable: false },
  RST: { type: 'BOOL', kind: 'external', writable: false },
  FLOW: { type: 'FLOAT64', kind: 'external', writable: false },
  CMD: { type: 'BOOL', kind: 'external', writable: true },
  SP: { type: 'FLOAT64', kind: 'external', writable: true },
  CODE: { type: 'INT16', kind: 'external', writable: true },
  MODE: { type: 'BOOL', kind: 'internal', writable: true },
  N: { type: 'INT32', kind: 'internal', writable: true },
  TXT: { type: 'STRING', kind: 'internal', writable: true },
  CALC: { type: 'BOOL', kind: 'calculated', writable: false, expression: 'MODE' },
};
const CONFIG = { scanMs: 100, tzOffsetMin: 420, writes: 'on', maxWritesPerMin: 20 };
const W_CMD = {
  id: 'w_cmd',
  tag: 'CMD',
  allowed: { values: [true, false] },
  minIntervalMs: 1000,
  maxPerHour: 100,
};
const W_SP = {
  id: 'w_sp',
  tag: 'SP',
  allowed: { min: 0, max: 100 },
  minIntervalMs: 1000,
  maxPerHour: 100,
};
const BAD = { value: null, quality: 'BAD' };

/** Gộp các bước cùng `t` (sắp ổn định theo t): `set`, `expect` (và các mục con) gộp nông, khóa khác ghi đè. */
function mergeSteps(steps) {
  const out = [];
  for (const s of [...steps].sort((a, b) => a.t - b.t)) {
    const last = out[out.length - 1];
    if (!last || last.t !== s.t) {
      out.push(structuredClone(s));
      continue;
    }
    for (const [k, v] of Object.entries(s)) {
      if (k === 'set') last.set = { ...last.set, ...v };
      else if (k === 'expect') {
        const e = (last.expect ??= {});
        for (const [ek, ev] of Object.entries(v))
          e[ek] =
            ek === 'actions' || typeof ev !== 'object' || ev === null ? ev : { ...e[ek], ...ev };
      } else last[k] = v;
    }
  }
  return out;
}

const groups = new Map();
const ids = new Set();
function add(group, id, description, c) {
  if (ids.has(id)) throw new Error(`id trùng: ${id}`);
  ids.add(id);
  const out = {
    id,
    group,
    description,
    doc: { schemaVersion: '1.0.0', ...c.doc },
    tags: c.tags ?? TAGS,
    config: { ...CONFIG, ...c.config },
  };
  if (c.retain !== undefined) out.retain = c.retain;
  out.steps = mergeSteps(c.steps ?? []);
  out.expectErrors = c.expectErrors ?? [];
  if (c.expectWarnings !== undefined) out.expectWarnings = c.expectWarnings;
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(out);
}
const ceil100 = (x) => Math.ceil(x / 100) * 100;
/** Hành động kỳ vọng. */
const act = (rule, d, o) => ({ rule, do: d, ...o });
const wr = (rule, write, tag, value, edgeId, t, result = 'QUEUED') => ({
  rule,
  do: 'write',
  write,
  tag,
  value,
  result,
  edgeId,
  t,
});

// ======================================================================================
// rules (≥ 40)
// ======================================================================================
{
  const G = 'rules';
  const low = (o = {}) => ({
    id: 'low',
    when: 'LEVEL < 20',
    hold: 1000,
    onRise: [{ do: 'write', write: 'w_cmd', value: true }],
    onFall: [{ do: 'write', write: 'w_cmd', value: false }],
    ...o,
  });
  const doc = (rules, extra = {}) => ({ writes: [W_CMD, W_SP], rules, ...extra });

  for (const hold of [0, 100, 250, 1000, 5000, 10000]) {
    const T = 1000 + ceil100(hold);
    const steps = [
      { t: 0, set: { LEVEL: 50 } },
      { t: 1000, set: { LEVEL: 10 } },
    ];
    if (T > 1000) steps.push({ t: T - 100, expect: { actions: [] } });
    const exp = {
      actions: [wr('low', 'w_cmd', 'CMD', true, 1, T)],
      state: { low: { state: 'OK', stable: true, edgeId: 1 } },
    };
    if (T === 1000) steps[1].expect = exp;
    else steps.push({ t: T, expect: exp });
    add(
      G,
      `rule-hold-rise-${hold}`,
      `hold ${hold} ms: cạnh lên ở quét đầu tiên có now - mốc ≥ hold (t = ${T})`,
      {
        doc: doc([low({ hold })]),
        steps,
      },
    );
  }
  for (const hold of [0, 500, 3000]) {
    const T = 1000 + ceil100(hold);
    const steps = [
      { t: 0, set: { LEVEL: 10 } },
      { t: 1000, set: { LEVEL: 50 } },
    ];
    if (T > 1000) steps.push({ t: T - 100, expect: { actions: [] } });
    const exp = {
      actions: [wr('low', 'w_cmd', 'CMD', false, 1, T)],
      state: { low: { stable: false } },
    };
    if (T === 1000) steps[1].expect = exp;
    else steps.push({ t: T, expect: exp });
    add(
      G,
      `rule-hold-fall-${hold}`,
      `hold ${hold} ms: cạnh xuống chạy onFall (khởi động với điều kiện đúng không bắn)`,
      {
        doc: doc([low({ hold })]),
        steps,
      },
    );
  }
  add(G, 'rule-hold-cancel', 'candidate đổi lại trước hạn thì hủy; giữ lại từ đầu', {
    doc: doc([low()]),
    steps: [
      { t: 0, set: { LEVEL: 50 } },
      { t: 1000, set: { LEVEL: 10 } },
      { t: 1500, set: { LEVEL: 50 } },
      { t: 5000, expect: { actions: [], state: { low: { stable: false } } } },
      { t: 6000, set: { LEVEL: 10 } },
      { t: 6900, expect: { actions: [] } },
      { t: 7000, expect: { actions: [wr('low', 'w_cmd', 'CMD', true, 1, 7000)] } },
    ],
  });
  add(
    G,
    'rule-hold-cancel-last-scan',
    'hủy ở quét cuối trước hạn (1.900 ms của 1.000 ms bắt đầu từ 1.000)',
    {
      doc: doc([low()]),
      steps: [
        { t: 0, set: { LEVEL: 50 } },
        { t: 1000, set: { LEVEL: 10 } },
        { t: 1900, set: { LEVEL: 50 } },
        { t: 4000, expect: { actions: [] } },
      ],
    },
  );
  add(G, 'rule-hold-restart-on-flip', 'true, false, true: hold tính lại từ lần true thứ hai', {
    doc: doc([low()]),
    steps: [
      { t: 0, set: { LEVEL: 50 } },
      { t: 1000, set: { LEVEL: 10 } },
      { t: 1200, set: { LEVEL: 50 } },
      { t: 1300, set: { LEVEL: 10 } },
      { t: 2200, expect: { actions: [] } },
      { t: 2300, expect: { actions: [wr('low', 'w_cmd', 'CMD', true, 1, 2300)] } },
    ],
  });
  add(
    G,
    'rule-start-true-no-edge',
    'lần quét hợp lệ đầu tiên đặt stable mà không bắn (fireOnStart mặc định false)',
    {
      doc: doc([low()]),
      steps: [
        { t: 0, set: { LEVEL: 10 } },
        {
          t: 5000,
          expect: { actions: [], state: { low: { state: 'OK', stable: true, edgeId: 0 } } },
        },
      ],
    },
  );
  add(
    G,
    'rule-fire-on-start-true',
    'fireOnStart: true và điều kiện đúng: onRise một lần ở quét đầu',
    {
      doc: doc([low({ fireOnStart: true })]),
      steps: [
        { t: 0, set: { LEVEL: 10 }, expect: { actions: [wr('low', 'w_cmd', 'CMD', true, 1, 0)] } },
        { t: 5000, expect: { actions: [] } },
      ],
    },
  );
  add(G, 'rule-fire-on-start-false-cond', 'fireOnStart: true mà điều kiện sai: không chạy gì', {
    doc: doc([low({ fireOnStart: true })]),
    steps: [
      { t: 0, set: { LEVEL: 50 } },
      { t: 5000, expect: { actions: [] } },
    ],
  });
  add(
    G,
    'rule-fire-on-start-ignores-hold',
    'lần quét hợp lệ đầu không chờ hold (hold 5.000 ms vẫn bắn ở t = 0)',
    {
      doc: doc([low({ fireOnStart: true, hold: 5000 })]),
      steps: [
        { t: 0, set: { LEVEL: 10 }, expect: { actions: [wr('low', 'w_cmd', 'CMD', true, 1, 0)] } },
      ],
    },
  );
  add(
    G,
    'rule-first-valid-after-no-value',
    'chưa có giá trị đến 2.000: SUSPENDED; lần hợp lệ đầu không bắn',
    {
      doc: doc([low()]),
      steps: [
        {
          t: 1000,
          expect: { state: { low: { state: 'SUSPENDED', reason: 'INPUT_BAD', stable: null } } },
        },
        {
          t: 2000,
          set: { LEVEL: 10 },
          expect: { actions: [], state: { low: { state: 'OK', stable: true } } },
        },
        { t: 9000, expect: { actions: [] } },
      ],
    },
  );
  for (const r of [10000, 15000, 30000])
    add(
      G,
      `rule-repeat-${r}`,
      `repeatMs ${r}: onRise chạy lại mỗi ${r} ms kể từ lần chạy trước, edgeId mới`,
      {
        doc: doc([low({ hold: 0, repeatMs: r })]),
        steps: [
          { t: 0, set: { LEVEL: 50 } },
          {
            t: 1000,
            set: { LEVEL: 10 },
            expect: { actions: [wr('low', 'w_cmd', 'CMD', true, 1, 1000)] },
          },
          { t: 1000 + r - 100, expect: { actions: [] } },
          { t: 1000 + r, expect: { actions: [wr('low', 'w_cmd', 'CMD', true, 2, 1000 + r)] } },
          {
            t: 1000 + 2 * r,
            expect: { actions: [wr('low', 'w_cmd', 'CMD', true, 3, 1000 + 2 * r)] },
          },
        ],
      },
    );
  add(G, 'rule-repeat-stops-after-fall', 'repeatMs không áp cho onFall; sau cạnh xuống không lặp', {
    doc: doc([low({ hold: 0, repeatMs: 10000 })]),
    steps: [
      { t: 0, set: { LEVEL: 50 } },
      { t: 1000, set: { LEVEL: 10 } },
      {
        t: 5000,
        set: { LEVEL: 50 },
        expect: {
          actions: [
            wr('low', 'w_cmd', 'CMD', true, 1, 1000),
            wr('low', 'w_cmd', 'CMD', false, 2, 5000),
          ],
        },
      },
      { t: 40000, expect: { actions: [] } },
    ],
  });
  add(
    G,
    'rule-repeat-needs-first-run',
    'stable = true từ lúc khởi động mà chưa chạy onRise: không lặp',
    {
      doc: doc([low({ hold: 0, repeatMs: 10000 })]),
      steps: [
        { t: 0, set: { LEVEL: 10 } },
        { t: 40000, expect: { actions: [] } },
      ],
    },
  );
  add(
    G,
    'rule-suspend-resume-no-edge',
    'BAD: SUSPENDED INPUT_BAD, đóng băng; trở lại cùng điều kiện: không cạnh giả',
    {
      doc: doc([low()]),
      steps: [
        { t: 0, set: { LEVEL: 10 } },
        {
          t: 1000,
          set: { LEVEL: { value: 50, quality: 'BAD' } },
          expect: { state: { low: { state: 'SUSPENDED', reason: 'INPUT_BAD', stable: true } } },
        },
        {
          t: 3000,
          set: { LEVEL: 10 },
          expect: { actions: [], state: { low: { state: 'OK', stable: true } } },
        },
        { t: 10000, expect: { actions: [] } },
      ],
    },
  );
  add(
    G,
    'rule-suspend-resume-opposite',
    'sau khi treo, điều kiện khác stable: hold bắt đầu từ quét trở lại',
    {
      doc: doc([low()]),
      steps: [
        { t: 0, set: { LEVEL: 10 } },
        { t: 1000, set: { LEVEL: BAD } },
        { t: 3000, set: { LEVEL: 50 } },
        { t: 3900, expect: { actions: [] } },
        { t: 4000, expect: { actions: [wr('low', 'w_cmd', 'CMD', false, 1, 4000)] } },
      ],
    },
  );
  add(
    G,
    'rule-suspend-no-value-start',
    'Tag chưa có giá trị: SUSPENDED INPUT_BAD, stable chưa đặt',
    {
      doc: doc([low()]),
      steps: [
        {
          t: 500,
          expect: {
            actions: [],
            state: { low: { state: 'SUSPENDED', reason: 'INPUT_BAD', stable: null } },
          },
        },
      ],
    },
  );
  add(G, 'rule-suspend-uncertain', 'quality UNCERTAIN (STALE) cũng là unknown', {
    doc: doc([low()]),
    steps: [
      { t: 0, set: { LEVEL: { value: 10, quality: 'UNCERTAIN', reason: 'STALE' } } },
      {
        t: 500,
        expect: { actions: [], state: { low: { state: 'SUSPENDED', reason: 'INPUT_BAD' } } },
      },
    ],
  });
  add(
    G,
    'rule-suspend-expr-error',
    'chia 0 lúc chạy: SUSPENDED EXPR_ERROR; hết lỗi: lần hợp lệ đầu không bắn',
    {
      doc: doc([low({ when: '100 / LEVEL > 1' })]),
      steps: [
        {
          t: 0,
          set: { LEVEL: 0 },
          expect: { state: { low: { state: 'SUSPENDED', reason: 'EXPR_ERROR' } } },
        },
        {
          t: 1000,
          set: { LEVEL: 50 },
          expect: { actions: [], state: { low: { state: 'OK', stable: true } } },
        },
      ],
    },
  );
  add(
    G,
    'rule-suspend-during-hold',
    'bị treo giữa lúc giữ: hủy candidate, giữ lại từ đầu khi trở lại',
    {
      doc: doc([low()]),
      steps: [
        { t: 0, set: { LEVEL: 50 } },
        { t: 1000, set: { LEVEL: 10 } },
        { t: 1500, set: { LEVEL: BAD } },
        { t: 2000, set: { LEVEL: 10 } },
        { t: 2900, expect: { actions: [] } },
        { t: 3000, expect: { actions: [wr('low', 'w_cmd', 'CMD', true, 1, 3000)] } },
      ],
    },
  );
  add(
    G,
    'rule-suspend-time-not-synced',
    'lịch chưa đồng bộ giờ: luật phụ thuộc SUSPENDED TIME_NOT_SYNCED',
    {
      doc: doc([low({ when: 'L.DAY && LEVEL < 20', hold: 0 })], {
        schedules: [
          {
            id: 's_day',
            weekly: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '23:59' }],
            out: 'L.DAY',
          },
        ],
      }),
      steps: [
        {
          t: 0,
          wall: '2026-10-19T08:00:00+07:00',
          timeSynced: false,
          set: { LEVEL: 10 },
          expect: {
            state: { low: { state: 'SUSPENDED', reason: 'TIME_NOT_SYNCED' } },
            outputs: { 'L.DAY': { quality: 'BAD', reason: 'TIME_NOT_SYNCED' } },
          },
        },
        {
          t: 1000,
          timeSynced: true,
          expect: {
            actions: [],
            state: { low: { state: 'OK', stable: true } },
            outputs: { 'L.DAY': true },
          },
        },
      ],
    },
  );
  add(
    G,
    'rule-suspend-stable-false',
    'treo khi stable = false rồi trở lại false: không hành động',
    {
      doc: doc([low()]),
      steps: [
        { t: 0, set: { LEVEL: 50 } },
        { t: 1000, set: { LEVEL: BAD } },
        { t: 2000, set: { LEVEL: 60 } },
        { t: 9000, expect: { actions: [], state: { low: { state: 'OK', stable: false } } } },
      ],
    },
  );
  add(
    G,
    'rule-suspend-null-value',
    'giá trị null (chưa có giá trị) giữa chừng: SUSPENDED INPUT_BAD',
    {
      doc: doc([low()]),
      steps: [
        { t: 0, set: { LEVEL: 50 } },
        {
          t: 1000,
          set: { LEVEL: null },
          expect: { state: { low: { state: 'SUSPENDED', reason: 'INPUT_BAD', stable: false } } },
        },
      ],
    },
  );
  add(G, 'rule-disabled', 'enabled: false: DISABLED, không hành động; cảnh báo W_LOGIC_DISABLED', {
    doc: doc([low({ enabled: false })]),
    steps: [
      { t: 0, set: { LEVEL: 50 } },
      { t: 1000, set: { LEVEL: 10 } },
      { t: 3000, expect: { actions: [], state: { low: { state: 'DISABLED' } } } },
    ],
    expectWarnings: ['W_LOGIC_DISABLED'],
  });
  const setN = (id, v) => ({
    id,
    when: 'LEVEL < 20',
    onRise: [{ do: 'setTag', tag: 'N', value: v }],
  });
  add(
    G,
    'rule-order-by-id',
    'nhiều luật cùng quét: chạy theo id tăng dần (không theo thứ tự khai báo)',
    {
      doc: doc([setN('zeta', 3), setN('alpha', 1), setN('mid', 2)]),
      steps: [
        { t: 0, set: { LEVEL: 50 } },
        {
          t: 100,
          set: { LEVEL: 10 },
          expect: {
            actions: [
              act('alpha', 'setTag', { tag: 'N', value: 1, result: 'OK' }),
              act('mid', 'setTag', { tag: 'N', value: 2, result: 'OK' }),
              act('zeta', 'setTag', { tag: 'N', value: 3, result: 'OK' }),
            ],
          },
        },
        { t: 200, expect: { outputs: { N: 3 } } },
      ],
      expectWarnings: ['W_LOGIC_WRITE_CONFLICT'],
    },
  );
  add(
    G,
    'rule-topo-timer',
    'luật id nhỏ hơn đọc đầu ra timer: timer chạy trước (tô-pô), cùng quét',
    {
      doc: doc([{ id: 'a_rule', when: 'L.T', onRise: [{ do: 'setTag', tag: 'N', value: 1 }] }], {
        timers: [{ id: 'z_timer', kind: 'ton', in: 'RUN', pt: 300, q: 'L.T' }],
      }),
      steps: [
        { t: 0, set: { RUN: false } },
        { t: 100, set: { RUN: true } },
        { t: 300, expect: { actions: [], outputs: { 'L.T': false } } },
        {
          t: 400,
          expect: {
            actions: [act('a_rule', 'setTag', { tag: 'N', value: 1, result: 'OK', t: 400 })],
            outputs: { 'L.T': true },
          },
        },
      ],
    },
  );
  add(G, 'rule-topo-counter', 'luật đọc reached của counter: thấy giá trị của cùng quét', {
    doc: doc(
      [{ id: 'a_rule', when: 'L.C.R', onRise: [{ do: 'setTag', tag: 'MODE', value: true }] }],
      {
        counters: [{ id: 'z_cnt', up: 'UP', preset: 2, value: 'L.C.V', reached: 'L.C.R' }],
      },
    ),
    steps: [
      { t: 0, set: { UP: false } },
      { t: 100, set: { UP: true } },
      { t: 200, set: { UP: false } },
      {
        t: 300,
        set: { UP: true },
        expect: {
          actions: [act('a_rule', 'setTag', { tag: 'MODE', value: true, t: 300 })],
          outputs: { 'L.C.V': 2, 'L.C.R': true },
        },
      },
    ],
  });
  add(G, 'rule-setTag-next-scan', 'setTag có hiệu lực ở quét sau: luật đọc Tag đó thấy ở quét kế', {
    doc: doc([
      { id: 'a', when: 'RUN', onRise: [{ do: 'setTag', tag: 'MODE', value: true }] },
      { id: 'c', when: 'MODE', onRise: [{ do: 'setTag', tag: 'N', value: 5 }] },
    ]),
    steps: [
      { t: 0, set: { RUN: false, MODE: false, N: 0 } },
      {
        t: 100,
        set: { RUN: true },
        expect: {
          actions: [act('a', 'setTag', { tag: 'MODE', value: true, t: 100 })],
          outputs: { MODE: true, N: 0 },
        },
      },
      {
        t: 200,
        expect: {
          actions: [act('c', 'setTag', { tag: 'N', value: 5, t: 200 })],
          outputs: { N: 5 },
        },
      },
    ],
  });
  add(G, 'rule-toggle', 'toggle đảo giá trị hiện tại của Tag BOOL nội bộ', {
    doc: doc([{ id: 'e', when: 'RUN', onRise: [{ do: 'toggle', tag: 'MODE' }] }]),
    steps: [
      { t: 0, set: { RUN: false, MODE: false } },
      {
        t: 100,
        set: { RUN: true },
        expect: { actions: [act('e', 'toggle', { tag: 'MODE', value: true, result: 'OK' })] },
      },
      { t: 200, set: { RUN: false }, expect: { outputs: { MODE: true } } },
      {
        t: 300,
        set: { RUN: true },
        expect: { actions: [act('e', 'toggle', { tag: 'MODE', value: false, result: 'OK' })] },
      },
      { t: 400, expect: { outputs: { MODE: false } } },
    ],
  });
  add(G, 'rule-actions-in-order', 'hành động chạy tuần tự theo thứ tự khai báo, cùng edgeId', {
    doc: doc([
      {
        id: 'r',
        when: 'RUN',
        onRise: [
          { do: 'setTag', tag: 'N', value: 7 },
          { do: 'write', write: 'w_cmd', value: true },
          { do: 'setTag', tag: 'MODE', value: true },
        ],
      },
    ]),
    steps: [
      { t: 0, set: { RUN: false } },
      {
        t: 100,
        set: { RUN: true },
        expect: {
          actions: [
            act('r', 'setTag', { tag: 'N', value: 7, edgeId: 1, index: 0 }),
            act('r', 'write', {
              write: 'w_cmd',
              tag: 'CMD',
              value: true,
              edgeId: 1,
              index: 1,
              result: 'QUEUED',
            }),
            act('r', 'setTag', { tag: 'MODE', value: true, edgeId: 1, index: 2 }),
          ],
        },
      },
    ],
  });
  add(
    G,
    'rule-setTag-expression',
    'setTag giá trị biểu thức tính lúc bắn, gán theo kiểu đích (INT32 làm tròn nửa xa 0)',
    {
      doc: doc([
        {
          id: 'r',
          when: 'RUN',
          onRise: [{ do: 'setTag', tag: 'N', value: { expr: 'LEVEL * 2' } }],
        },
      ]),
      steps: [
        { t: 0, set: { RUN: false, LEVEL: 6.25 } },
        {
          t: 100,
          set: { RUN: true },
          expect: { actions: [act('r', 'setTag', { tag: 'N', value: 13, result: 'OK' })] },
        },
      ],
    },
  );
  add(
    G,
    'rule-setTag-expression-error',
    'biểu thức của giá trị lỗi lúc chạy: EXPR_ERROR, lastError, không đặt Tag',
    {
      doc: doc([
        {
          id: 'r',
          when: 'RUN',
          onRise: [{ do: 'setTag', tag: 'N', value: { expr: '100 / LEVEL' } }],
        },
      ]),
      steps: [
        { t: 0, set: { RUN: false, LEVEL: 0, N: 1 } },
        {
          t: 100,
          set: { RUN: true },
          expect: {
            actions: [act('r', 'setTag', { tag: 'N', result: 'EXPR_ERROR' })],
            state: { r: { state: 'OK', lastError: 'EXPR_ERROR' } },
          },
        },
        { t: 200, expect: { outputs: { N: 1 } } },
      ],
    },
  );
  add(G, 'rule-toggle-no-value', 'toggle Tag chưa có giá trị: NO_VALUE, lastError', {
    doc: doc([{ id: 'r', when: 'RUN', onRise: [{ do: 'toggle', tag: 'MODE' }] }]),
    steps: [
      { t: 0, set: { RUN: false } },
      {
        t: 100,
        set: { RUN: true },
        expect: {
          actions: [act('r', 'toggle', { tag: 'MODE', result: 'NO_VALUE' })],
          state: { r: { lastError: 'NO_VALUE' } },
        },
      },
    ],
  });
  add(G, 'rule-edge-ids', 'edgeId tăng 1 mỗi lần bắn (lên, xuống, lên)', {
    doc: doc([
      low({
        hold: 0,
        onRise: [{ do: 'setTag', tag: 'N', value: 1 }],
        onFall: [{ do: 'setTag', tag: 'N', value: 0 }],
      }),
    ]),
    steps: [
      { t: 0, set: { LEVEL: 50 } },
      {
        t: 100,
        set: { LEVEL: 10 },
        expect: { actions: [act('low', 'setTag', { value: 1, edgeId: 1 })] },
      },
      {
        t: 200,
        set: { LEVEL: 50 },
        expect: { actions: [act('low', 'setTag', { value: 0, edgeId: 2 })] },
      },
      {
        t: 300,
        set: { LEVEL: 10 },
        expect: {
          actions: [act('low', 'setTag', { value: 1, edgeId: 3 })],
          state: { low: { edgeId: 3 } },
        },
      },
    ],
  });
  add(
    G,
    'rule-write-result-failed',
    'kết quả FAILED từ WriteCoordinator: lastError, không tự thử lại',
    {
      doc: doc([
        { id: 'r', when: 'RUN', hold: 0, onRise: [{ do: 'write', write: 'w_cmd', value: true }] },
      ]),
      steps: [
        { t: 0, set: { RUN: false } },
        {
          t: 100,
          set: { RUN: true },
          expect: { actions: [wr('r', 'w_cmd', 'CMD', true, 1, 100)] },
        },
        {
          t: 200,
          writeResult: { rule: 'r', result: 'FAILED' },
          expect: { actions: [], state: { r: { state: 'OK', lastError: 'FAILED' } } },
        },
        { t: 30000, expect: { actions: [] } },
      ],
    },
  );
}

// ======================================================================================
// timers (≥ 30)
// ======================================================================================
{
  const G = 'timers';
  const tdoc = (kind, pt, extra = {}) => ({
    timers: [{ id: 't', kind, in: 'IN', pt, q: 'L.Q', et: 'L.ET', ...extra }],
  });
  const qe = (q, et, extra = {}) => ({ outputs: { 'L.Q': q, 'L.ET': et }, ...extra });

  for (const pt of [100, 250, 500, 1000, 3000]) {
    const P = ceil100(pt);
    const T = 1000 + P;
    add(
      G,
      `ton-${pt}`,
      `ton pt ${pt}: q ở quét đầu tiên có et ≥ pt (t = ${T}), et dừng ở pt, in xuống đặt lại`,
      {
        doc: tdoc('ton', pt),
        steps: [
          { t: 0, set: { IN: false }, expect: qe(false, 0) },
          { t: 1000, set: { IN: true }, expect: qe(false, 0) },
          { t: T - 100, expect: qe(false, P - 100) },
          { t: T, expect: qe(true, pt) },
          { t: T + 1000, expect: qe(true, pt) },
          { t: T + 2000, set: { IN: false }, expect: qe(false, 0) },
        ],
      },
    );
  }
  add(G, 'ton-short-pulse-500', 'ton: in ngắn hơn pt (300 ms của 500): không bật q', {
    doc: tdoc('ton', 500),
    steps: [
      { t: 0, set: { IN: false } },
      { t: 1000, set: { IN: true } },
      { t: 1300, expect: qe(false, 300) },
      { t: 1400, set: { IN: false }, expect: qe(false, 0) },
      { t: 3000, expect: qe(false, 0) },
    ],
  });
  add(G, 'ton-short-pulse-1000', 'ton: in 900 ms của pt 1.000: không bật q', {
    doc: tdoc('ton', 1000),
    steps: [
      { t: 0, set: { IN: false } },
      { t: 1000, set: { IN: true } },
      { t: 1900, set: { IN: false }, expect: qe(false, 0) },
      { t: 5000, expect: qe(false, 0) },
    ],
  });
  for (const pt of [30, 99])
    add(
      G,
      `ton-pt-rounded-${pt}`,
      `ton pt ${pt} < scanMs 100: làm tròn lên 100 (W_LOGIC_PT_ROUNDED)`,
      {
        doc: tdoc('ton', pt),
        steps: [
          { t: 0, set: { IN: false } },
          { t: 1000, set: { IN: true }, expect: qe(false, 0) },
          { t: 1100, expect: qe(true, 100) },
        ],
        expectWarnings: ['W_LOGIC_PT_ROUNDED'],
      },
    );
  add(
    G,
    'ton-unknown-freeze',
    'ton: in BAD giữ q, et, dừng đếm (degraded); trở lại thì tiếp tục, khoảng treo không tính',
    {
      doc: tdoc('ton', 1000),
      steps: [
        { t: 0, set: { IN: false } },
        { t: 1000, set: { IN: true } },
        { t: 1500, set: { IN: BAD }, expect: qe(false, 400, { state: { t: { degraded: true } } }) },
        {
          t: 3000,
          set: { IN: true },
          expect: qe(false, 400, { state: { t: { degraded: false } } }),
        },
        { t: 3500, expect: qe(false, 900) },
        { t: 3600, expect: qe(true, 1000) },
      ],
    },
  );
  add(
    G,
    'ton-unknown-holds-q',
    'ton: q đang true, in BAD: giữ q = true; in false sau đó: q = false',
    {
      doc: tdoc('ton', 300),
      steps: [
        { t: 0, set: { IN: false } },
        { t: 1000, set: { IN: true } },
        { t: 1300, expect: qe(true, 300) },
        { t: 2000, set: { IN: BAD }, expect: qe(true, 300) },
        { t: 3000, set: { IN: false }, expect: qe(false, 0) },
      ],
    },
  );
  for (const pt of [100, 200, 500, 2000]) {
    const P = ceil100(pt);
    const T = 1000 + P;
    add(G, `tof-${pt}`, `tof pt ${pt}: q giữ ${pt} ms sau cạnh xuống (tắt ở t = ${T})`, {
      doc: tdoc('tof', pt),
      steps: [
        { t: 0, set: { IN: true }, expect: qe(true, 0) },
        { t: 1000, set: { IN: false }, expect: qe(true, 0) },
        { t: T - 100, expect: qe(true, P - 100) },
        { t: T, expect: qe(false, pt) },
        { t: T + 1000, expect: qe(false, pt) },
        { t: T + 2000, set: { IN: true }, expect: qe(true, 0) },
      ],
    });
  }
  add(G, 'tof-cancel', 'tof: in lên lại trước pt thì hủy; đếm lại từ cạnh xuống sau', {
    doc: tdoc('tof', 500),
    steps: [
      { t: 0, set: { IN: true } },
      { t: 1000, set: { IN: false } },
      { t: 1300, set: { IN: true }, expect: qe(true, 0) },
      { t: 2000, set: { IN: false } },
      { t: 2400, expect: qe(true, 400) },
      { t: 2500, expect: qe(false, 500) },
    ],
  });
  add(G, 'tof-start-false', 'tof: in false từ đầu: q = false (không có cạnh xuống)', {
    doc: tdoc('tof', 500),
    steps: [
      { t: 0, set: { IN: false }, expect: qe(false, 0) },
      { t: 1000, expect: qe(false, 0) },
    ],
  });
  add(G, 'tof-unknown-freeze', 'tof: in BAD khi đang đếm: dừng đếm, giữ q; tiếp tục khi trở lại', {
    doc: tdoc('tof', 1000),
    steps: [
      { t: 0, set: { IN: true } },
      { t: 1000, set: { IN: false } },
      { t: 1500, set: { IN: BAD }, expect: qe(true, 400) },
      { t: 3000, set: { IN: false }, expect: qe(true, 400) },
      { t: 3500, expect: qe(true, 900) },
      { t: 3600, expect: qe(false, 1000) },
    ],
  });
  for (const pt of [300, 500, 1500]) {
    const P = ceil100(pt);
    const T = 1000 + P;
    add(G, `tp-${pt}`, `tp pt ${pt}: xung q đúng ${pt} ms từ cạnh lên; in vẫn true thì et giữ pt`, {
      doc: tdoc('tp', pt),
      steps: [
        { t: 0, set: { IN: false } },
        { t: 1000, set: { IN: true }, expect: qe(true, 0) },
        { t: T - 100, expect: qe(true, P - 100) },
        { t: T, expect: qe(false, pt) },
        { t: T + 1000, expect: qe(false, pt) },
        { t: T + 2000, set: { IN: false }, expect: qe(false, 0) },
      ],
    });
  }
  add(
    G,
    'tp-no-retrigger',
    'tp: cạnh lên khi đang chạy không kích lại; cạnh sau khi xong thì có xung mới',
    {
      doc: tdoc('tp', 500),
      steps: [
        { t: 0, set: { IN: false } },
        { t: 1000, set: { IN: true } },
        { t: 1100, set: { IN: false } },
        { t: 1200, set: { IN: true }, expect: qe(true, 200) },
        { t: 1500, expect: qe(false, 500) },
        { t: 2000, set: { IN: false }, expect: qe(false, 0) },
        { t: 2100, set: { IN: true }, expect: qe(true, 0) },
      ],
    },
  );
  add(G, 'tp-input-falls-mid-pulse', 'tp: in xuống giữa xung không cắt xung', {
    doc: tdoc('tp', 500),
    steps: [
      { t: 0, set: { IN: false } },
      { t: 1000, set: { IN: true } },
      { t: 1200, set: { IN: false }, expect: qe(true, 200) },
      { t: 1400, expect: qe(true, 400) },
      { t: 1500, expect: qe(false, 500) },
      { t: 1600, expect: qe(false, 0) },
    ],
  });
  add(G, 'tp-first-scan-true', 'tp: in true ở lần quét đầu là cạnh lên (in ban đầu coi là false)', {
    doc: tdoc('tp', 300),
    steps: [
      { t: 0, set: { IN: true }, expect: qe(true, 0) },
      { t: 300, expect: qe(false, 300) },
    ],
  });
  add(G, 'tp-unknown-freeze', 'tp: in BAD giữa xung: dừng đếm; tiếp tục khi trở lại', {
    doc: tdoc('tp', 500),
    steps: [
      { t: 0, set: { IN: false } },
      { t: 1000, set: { IN: true } },
      { t: 1200, set: { IN: BAD }, expect: qe(true, 100) },
      { t: 2000, set: { IN: true }, expect: qe(true, 100) },
      { t: 2300, expect: qe(true, 400) },
      { t: 2400, expect: qe(false, 500) },
    ],
  });
  add(G, 'tp-100', 'tp pt bằng scanMs: xung một quét', {
    doc: tdoc('tp', 100),
    steps: [
      { t: 0, set: { IN: false } },
      { t: 1000, set: { IN: true }, expect: qe(true, 0) },
      { t: 1100, expect: qe(false, 100) },
    ],
  });
  add(G, 'ton-no-et', 'timer không khai et: chỉ có q', {
    doc: { timers: [{ id: 't', kind: 'ton', in: 'IN', pt: 500, q: 'L.Q' }] },
    steps: [
      { t: 0, set: { IN: true } },
      { t: 400, expect: { outputs: { 'L.Q': false } } },
      { t: 500, expect: { outputs: { 'L.Q': true } } },
    ],
  });
  add(G, 'ton-expression-input', 'đầu vào là biểu thức (LEVEL > 50)', {
    doc: { timers: [{ id: 't', kind: 'ton', in: 'LEVEL > 50', pt: 500, q: 'L.Q', et: 'L.ET' }] },
    steps: [
      { t: 0, set: { LEVEL: 10 } },
      { t: 1000, set: { LEVEL: 60 } },
      { t: 1400, expect: qe(false, 400) },
      { t: 1500, expect: qe(true, 500) },
    ],
  });
  add(
    G,
    'timer-chain-ton-tof',
    'chuỗi ton → tof: khối sau thấy đầu ra khối trước trong cùng quét',
    {
      doc: {
        timers: [
          { id: 't_a', kind: 'ton', in: 'IN', pt: 300, q: 'L.A' },
          { id: 't_b', kind: 'tof', in: 'L.A', pt: 500, q: 'L.B' },
        ],
      },
      steps: [
        { t: 0, set: { IN: false } },
        { t: 1000, set: { IN: true } },
        { t: 1200, expect: { outputs: { 'L.A': false, 'L.B': false } } },
        { t: 1300, expect: { outputs: { 'L.A': true, 'L.B': true } } },
        { t: 2000, set: { IN: false }, expect: { outputs: { 'L.A': false, 'L.B': true } } },
        { t: 2400, expect: { outputs: { 'L.B': true } } },
        { t: 2500, expect: { outputs: { 'L.B': false } } },
      ],
    },
  );
  add(G, 'timer-input-never-set', 'in chưa từng có giá trị: q = false, et = 0, degraded', {
    doc: tdoc('ton', 500),
    steps: [{ t: 1000, expect: qe(false, 0, { state: { t: { degraded: true } } }) }],
  });
}

// ======================================================================================
// counters (≥ 25)
// ======================================================================================
{
  const G = 'counters';
  const cdoc = (o = {}) => ({
    counters: [
      {
        id: 'c',
        up: 'UP',
        down: 'DOWN',
        reset: 'RST',
        preset: 5,
        value: 'L.V',
        reached: 'L.R',
        ...o,
      },
    ],
  });
  /** n cạnh lên của `tag` bắt đầu tại `t0` (true ở t0 + 200i, false ở t0 + 200i + 100). */
  const pulses = (tag, n, t0) => {
    const s = [];
    for (let i = 0; i < n; i++) {
      s.push({ t: t0 + 200 * i, set: { [tag]: true } });
      s.push({ t: t0 + 200 * i + 100, set: { [tag]: false } });
    }
    return s;
  };
  const init = { t: 0, set: { UP: false, DOWN: false, RST: false } };
  for (const n of [1, 5, 100, 1000])
    add(G, `counter-edges-${n}`, `${n} cạnh lên của up: value = ${n}, không sai cạnh nào`, {
      doc: cdoc({ preset: 1000 }),
      steps: [
        init,
        ...pulses('UP', n, 100),
        { t: 100 + 200 * n, expect: { outputs: { 'L.V': n, 'L.R': n >= 1000 } } },
      ],
    });
  for (const p of [1, 3, 10])
    add(G, `counter-preset-${p}`, `preset ${p}: reached = false ở ${p - 1} cạnh, true ở ${p}`, {
      doc: cdoc({ preset: p }),
      steps: [
        init,
        ...pulses('UP', p, 200),
        { t: 200 * p - 100, expect: { outputs: { 'L.V': p - 1, 'L.R': false } } },
        { t: 200 * p, expect: { outputs: { 'L.V': p, 'L.R': true } } },
      ],
    });
  add(G, 'counter-down-floor', 'down ở 0: value không âm', {
    doc: cdoc(),
    steps: [init, { t: 100, set: { DOWN: true }, expect: { outputs: { 'L.V': 0 } } }],
  });
  add(G, 'counter-down', '3 cạnh up rồi 2 cạnh down: 1', {
    doc: cdoc(),
    steps: [
      init,
      ...pulses('UP', 3, 100),
      ...pulses('DOWN', 2, 1000),
      { t: 2000, expect: { outputs: { 'L.V': 1 } } },
    ],
  });
  add(G, 'counter-up-down-same-scan', 'up và down cùng quét: bù nhau', {
    doc: cdoc(),
    steps: [
      init,
      ...pulses('UP', 2, 100),
      { t: 1000, set: { UP: true, DOWN: true }, expect: { outputs: { 'L.V': 2 } } },
    ],
  });
  add(G, 'counter-reset', 'cạnh lên của reset: value = 0, reached = false', {
    doc: cdoc({ preset: 2 }),
    steps: [
      init,
      ...pulses('UP', 3, 100),
      { t: 900, expect: { outputs: { 'L.V': 3, 'L.R': true } } },
      { t: 1000, set: { RST: true }, expect: { outputs: { 'L.V': 0, 'L.R': false } } },
    ],
  });
  add(G, 'counter-reset-drops-up', 'cạnh up cùng quét với reset bị bỏ', {
    doc: cdoc(),
    steps: [
      init,
      ...pulses('UP', 2, 100),
      { t: 1000, set: { UP: true, RST: true }, expect: { outputs: { 'L.V': 0 } } },
    ],
  });
  add(G, 'counter-reset-held', 'reset giữ true không đặt lại lần nữa; up vẫn đếm', {
    doc: cdoc(),
    steps: [
      init,
      { t: 100, set: { RST: true } },
      ...pulses('UP', 2, 300),
      { t: 1000, expect: { outputs: { 'L.V': 2 } } },
    ],
  });
  add(G, 'counter-reset-clears-overflow', 'reset xóa overflow', {
    doc: cdoc({ down: null, preset: null, reached: undefined }),
    retain: { 'logic/c/value': '9223372036854775807', 'logic/c/overflow': true },
    steps: [
      init,
      {
        t: 100,
        expect: { outputs: { 'L.V': '9223372036854775807' }, state: { c: { overflow: true } } },
      },
      {
        t: 200,
        set: { RST: true },
        expect: { outputs: { 'L.V': 0 }, state: { c: { overflow: false } } },
      },
    ],
  });
  add(G, 'counter-first-true-no-edge', 'lần thấy hợp lệ đầu tiên (true) không phải cạnh', {
    doc: cdoc(),
    steps: [
      { t: 0, set: { UP: true } },
      { t: 500, expect: { outputs: { 'L.V': 0 } } },
    ],
  });
  add(G, 'counter-unknown-keeps-prev', 'false → BAD → true: mốc trước giữ false nên đếm 1', {
    doc: cdoc(),
    steps: [
      init,
      { t: 100, set: { UP: BAD } },
      { t: 200, set: { UP: true }, expect: { outputs: { 'L.V': 1 } } },
    ],
  });
  add(G, 'counter-true-bad-true', 'true → BAD → true: không cạnh', {
    doc: cdoc(),
    steps: [
      init,
      { t: 100, set: { UP: true } },
      { t: 200, set: { UP: { value: false, quality: 'BAD' } } },
      { t: 300, set: { UP: true }, expect: { outputs: { 'L.V': 1 } } },
    ],
  });
  add(G, 'counter-uncertain', 'UNCERTAIN là unknown: không tạo cạnh', {
    doc: cdoc(),
    steps: [
      init,
      { t: 100, set: { UP: { value: true, quality: 'UNCERTAIN', reason: 'STALE' } } },
      { t: 200, set: { UP: false } },
      { t: 300, expect: { outputs: { 'L.V': 0 } } },
      { t: 400, set: { UP: true }, expect: { outputs: { 'L.V': 1 } } },
    ],
  });
  add(G, 'counter-overflow', 'tràn: dừng ở 9223372036854775807, overflow = true, không quay vòng', {
    doc: cdoc({ down: null, reset: null }),
    retain: { 'logic/c/value': '9223372036854775805' },
    steps: [
      init,
      ...pulses('UP', 4, 100),
      {
        t: 1000,
        expect: {
          outputs: { 'L.V': '9223372036854775807', 'L.R': true },
          state: { c: { overflow: true } },
          retain: { 'logic/c/value': '9223372036854775807', 'logic/c/overflow': true },
        },
      },
    ],
  });
  add(G, 'counter-up-expression', 'up là biểu thức (LEVEL > 50)', {
    doc: { counters: [{ id: 'c', up: 'LEVEL > 50', value: 'L.V' }] },
    steps: [
      { t: 0, set: { LEVEL: 10 } },
      { t: 100, set: { LEVEL: 60 } },
      { t: 200, set: { LEVEL: 70 } },
      { t: 300, set: { LEVEL: 40 } },
      { t: 400, set: { LEVEL: 51 }, expect: { outputs: { 'L.V': 2 } } },
    ],
  });
  add(G, 'counter-no-preset', 'preset vắng (null): không có reached', {
    doc: { counters: [{ id: 'c', up: 'UP', value: 'L.V' }] },
    steps: [init, ...pulses('UP', 3, 100), { t: 800, expect: { outputs: { 'L.V': 3 } } }],
  });
  add(G, 'counter-retain-false', 'retain: false: không có trong kho retain', {
    doc: cdoc({ retain: false }),
    steps: [
      init,
      ...pulses('UP', 2, 100),
      { t: 600, expect: { outputs: { 'L.V': 2 }, retain: {} } },
    ],
  });
  add(G, 'counter-feeds-rule', 'luật đọc value của counter (cùng quét)', {
    doc: {
      counters: [{ id: 'a_cnt', up: 'UP', value: 'L.V' }],
      rules: [
        { id: 'b_rule', when: 'L.V >= 2', onRise: [{ do: 'setTag', tag: 'MODE', value: true }] },
      ],
    },
    steps: [
      init,
      { t: 100, set: { UP: true } },
      { t: 200, set: { UP: false } },
      {
        t: 300,
        set: { UP: true },
        expect: { actions: [act('b_rule', 'setTag', { tag: 'MODE', value: true, t: 300 })] },
      },
    ],
  });
  add(G, 'counter-down-unknown', 'down BAD: bỏ qua', {
    doc: cdoc(),
    steps: [
      init,
      ...pulses('UP', 2, 100),
      { t: 1000, set: { DOWN: BAD } },
      { t: 1100, set: { DOWN: BAD }, expect: { outputs: { 'L.V': 2 } } },
    ],
  });
  add(G, 'counter-reached-after-down', 'down xuống dưới preset: reached = false', {
    doc: cdoc({ preset: 2 }),
    steps: [
      init,
      ...pulses('UP', 2, 100),
      { t: 600, expect: { outputs: { 'L.R': true } } },
      { t: 700, set: { DOWN: true }, expect: { outputs: { 'L.V': 1, 'L.R': false } } },
    ],
  });
  add(G, 'counter-all-bad', 'up và reset BAD: không đổi', {
    doc: cdoc(),
    steps: [
      init,
      ...pulses('UP', 1, 100),
      { t: 500, set: { UP: BAD, RST: BAD } },
      { t: 900, expect: { outputs: { 'L.V': 1 } } },
    ],
  });
}

// ======================================================================================
// totalizers (≥ 25): kỳ vọng tính bằng mô phỏng tham chiếu của §5
// ======================================================================================
const UNIT = { s: 1, min: 60, h: 3600, d: 86400 };
/**
 * Mô phỏng tham chiếu một totalizer: `sets` là danh sách {t, v} (v: số, null = unknown) áp từ quét t; quét mỗi scanMs
 * từ `from` (mặc định 0) tới `to`. Trả bản đồ t → {total, gap (giây)}.
 */
function refTotalizer(p, sets, to, opt = {}) {
  const scan = opt.scanMs ?? 100;
  const factor = p.factor ?? 1;
  const cutoff = p.cutoff ?? 0;
  const maxGap = p.maxGapMs ?? 5000;
  const unit = UNIT[p.rateUnit];
  let total = opt.total ?? 0;
  let gapMs = Math.round((opt.gap ?? 0) * 1000);
  let prev = null;
  let prevReset;
  const out = new Map();
  const at = (list, t) => {
    let v;
    for (const s of list) if (s.t <= t) v = s.v;
    return v;
  };
  const cut = (r) => (r < cutoff ? 0 : r);
  for (let t = opt.from ?? 0; t <= to; t += scan) {
    const v = at(sets, t);
    const rate = typeof v === 'number' ? v : null;
    if (prev !== null) {
      const dt = t - prev.t;
      if (rate === null || prev.rate === null || dt > maxGap) gapMs += dt;
      else {
        const next = total + (factor * ((cut(prev.rate) + cut(rate)) / 2) * (dt / 1000)) / unit;
        // tràn số: không cộng, là khoảng trống
        if (Number.isFinite(next)) total = next;
        else gapMs += dt;
      }
      if (p.rolloverAt !== undefined && total >= p.rolloverAt) total = total - p.rolloverAt;
    }
    prev = { t, rate };
    if (opt.reset) {
      const r = at(opt.reset, t);
      if (typeof r === 'boolean') {
        if (prevReset === false && r) {
          total = 0;
          gapMs = 0;
        }
        prevReset = r;
      }
    }
    out.set(t, { total, gap: gapMs / 1000 });
  }
  return out;
}
{
  const G = 'totalizers';
  const zdoc = (o = {}) => ({
    totalizers: [
      {
        id: 'z',
        source: 'FLOW',
        rateUnit: 'h',
        maxGapMs: 5000,
        total: 'L.T',
        gapSeconds: 'L.G',
        ...o,
      },
    ],
  });
  const steps = (sets, checks, ref) => [
    ...sets.map((x) => ({ t: x.t, set: { FLOW: x.v === null ? BAD : x.v } })),
    ...checks.map((t) => ({
      t,
      expect: { outputs: { 'L.T': ref.get(t).total, 'L.G': ref.get(t).gap } },
    })),
  ];
  const simple = (id, desc, p, sets, checks, extra = {}) => {
    const ref = refTotalizer({ maxGapMs: 5000, ...p }, sets, Math.max(...checks), extra.opt);
    add(G, id, desc, {
      doc: zdoc(p),
      steps: steps(sets, checks, ref),
      ...(extra.retain ? { retain: extra.retain } : {}),
    });
  };
  for (const u of ['s', 'min', 'h', 'd'])
    simple(
      `totalizer-constant-${u}`,
      `dòng hằng 36/${u} trong 60 s, quét 100 ms`,
      { rateUnit: u },
      [{ t: 0, v: 36 }],
      [30000, 60000],
    );
  simple(
    'totalizer-factor-half',
    'factor 0,5',
    { rateUnit: 's', factor: 0.5 },
    [{ t: 0, v: 10 }],
    [10000],
  );
  simple(
    'totalizer-factor-1000',
    'factor 1.000 (m³ → L)',
    { rateUnit: 'min', factor: 1000 },
    [{ t: 0, v: 1.5 }],
    [60000],
  );
  simple(
    'totalizer-cutoff-below',
    'tốc độ dưới cutoff coi là 0',
    { rateUnit: 's', cutoff: 1 },
    [{ t: 0, v: 0.5 }],
    [5000],
  );
  simple(
    'totalizer-cutoff-crossing',
    'qua cutoff: đầu mút dưới ngưỡng tính 0 trong hình thang',
    { rateUnit: 's', cutoff: 1 },
    [
      { t: 0, v: 0.5 },
      { t: 1000, v: 2 },
      { t: 2000, v: 0.9 },
    ],
    [1000, 1100, 2000, 3000],
  );
  simple(
    'totalizer-cutoff-equal',
    'tốc độ bằng cutoff được tính (chỉ < cutoff mới là 0)',
    { rateUnit: 's', cutoff: 1 },
    [{ t: 0, v: 1 }],
    [2000],
  );
  {
    const sets = Array.from({ length: 101 }, (_, k) => ({ t: k * 100, v: k * 0.1 }));
    simple(
      'totalizer-ramp',
      'dốc tuyến tính 0 → 10/s trong 10 s: hình thang',
      { rateUnit: 's' },
      sets,
      [5000, 10000],
    );
  }
  simple(
    'totalizer-step',
    'bước 10 → 20: khoảng chứa bước tính trung bình hai đầu',
    { rateUnit: 's' },
    [
      { t: 0, v: 10 },
      { t: 1000, v: 20 },
    ],
    [900, 1000, 2000],
  );
  simple(
    'totalizer-negative-zero',
    'tốc độ âm < cutoff 0: coi là 0',
    { rateUnit: 's' },
    [
      { t: 0, v: -5 },
      { t: 1000, v: 5 },
    ],
    [1000, 2000],
  );
  simple(
    'totalizer-bad-gap',
    'source BAD: không cộng, khoảng có đầu mút unknown vào gapSeconds',
    { rateUnit: 's' },
    [
      { t: 0, v: 10 },
      { t: 1000, v: null },
      { t: 2000, v: 10 },
    ],
    [1000, 2000, 2100, 3000],
  );
  simple(
    'totalizer-overflow-gap',
    'tốc độ hữu hạn rất lớn: khoảng cộng ra không hữu hạn (tràn số) không cộng, là khoảng trống',
    { rateUnit: 's' },
    [
      { t: 0, v: 1e307 },
      { t: 20000, v: 1e308 },
      { t: 22000, v: 1 },
    ],
    [10000, 17900, 18000, 20000, 21000, 22000, 23000],
  );
  simple(
    'totalizer-no-value-start',
    'chưa có giá trị tới 2.000: khoảng trống từ quét đầu',
    { rateUnit: 's' },
    [{ t: 2000, v: 10 }],
    [1000, 2000, 3000],
  );
  {
    const sets = [{ t: 0, v: 10 }];
    const ref = refTotalizer(
      { rateUnit: 's', maxGapMs: 5000 },
      [
        { t: 0, v: 10 },
        { t: 1000, v: null },
        { t: 1500, v: 10 },
      ],
      3000,
    );
    add(G, 'totalizer-uncertain-gap', 'UNCERTAIN là unknown: khoảng trống', {
      doc: zdoc({ rateUnit: 's' }),
      steps: [
        { t: sets[0].t, set: { FLOW: 10 } },
        { t: 1000, set: { FLOW: { value: 10, quality: 'UNCERTAIN', reason: 'STALE' } } },
        { t: 1500, set: { FLOW: 10 } },
        { t: 3000, expect: { outputs: { 'L.T': ref.get(3000).total, 'L.G': ref.get(3000).gap } } },
      ],
    });
  }
  simple(
    'totalizer-max-gap',
    'maxGapMs 50 < scanMs: mọi khoảng là khoảng trống',
    { rateUnit: 's', maxGapMs: 50 },
    [{ t: 0, v: 10 }],
    [2000],
  );
  {
    const ref1 = refTotalizer({ rateUnit: 's' }, [{ t: 0, v: 10 }], 5000);
    const t5 = ref1.get(5000);
    const ref2 = refTotalizer({ rateUnit: 's' }, [{ t: 6000, v: 10 }], 8000, {
      from: 6000,
      total: t5.total,
      gap: t5.gap,
    });
    add(
      G,
      'totalizer-restart',
      'khởi động lại: total giữ theo lần flush, khoảng tắt máy không cộng và không là khoảng trống',
      {
        doc: zdoc({ rateUnit: 's' }),
        steps: [
          { t: 0, set: { FLOW: 10 } },
          { t: 5000, flush: true, expect: { outputs: { 'L.T': t5.total } } },
          {
            t: 6000,
            restart: true,
            set: { FLOW: 10 },
            expect: { outputs: { 'L.T': t5.total, 'L.G': 0 } },
          },
          {
            t: 8000,
            expect: { outputs: { 'L.T': ref2.get(8000).total, 'L.G': ref2.get(8000).gap } },
          },
        ],
      },
    );
  }
  simple(
    'totalizer-rollover',
    'rolloverAt 100: total ≥ 100 thì trừ 100',
    { rateUnit: 's', rolloverAt: 100 },
    [{ t: 0, v: 30 }],
    [3000, 3400, 7000],
  );
  simple(
    'totalizer-rollover-meter',
    'đồng hồ cơ 99.999,9: từ 99.990 qua mốc quay vòng',
    { rateUnit: 'h', rolloverAt: 99999.9, factor: 3600000 },
    [{ t: 0, v: 0.05 }],
    [100, 200, 300],
    { retain: { 'logic/z/total': 99990 }, opt: { total: 99990 } },
  );
  {
    const sets = [{ t: 0, v: 10 }];
    const reset = [
      { t: 0, v: false },
      { t: 2000, v: true },
    ];
    const ref = refTotalizer({ rateUnit: 's' }, sets, 4000, { reset });
    add(
      G,
      'totalizer-reset',
      'cạnh lên của reset: total = 0, gapSeconds = 0 (sau khi cộng khoảng của quét đó)',
      {
        doc: zdoc({ rateUnit: 's', reset: 'RST' }),
        steps: [
          { t: 0, set: { FLOW: 10, RST: false } },
          { t: 1900, expect: { outputs: { 'L.T': ref.get(1900).total } } },
          { t: 2000, set: { RST: true }, expect: { outputs: { 'L.T': 0, 'L.G': 0 } } },
          { t: 4000, expect: { outputs: { 'L.T': ref.get(4000).total } } },
        ],
      },
    );
    const ref2 = refTotalizer({ rateUnit: 's' }, sets, 4000, { reset: [{ t: 0, v: true }] });
    add(G, 'totalizer-reset-held', 'reset true từ đầu: không phải cạnh, không đặt lại', {
      doc: zdoc({ rateUnit: 's', reset: 'RST' }),
      steps: [
        { t: 0, set: { FLOW: 10, RST: true } },
        { t: 4000, expect: { outputs: { 'L.T': ref2.get(4000).total } } },
      ],
    });
    const ref3 = refTotalizer({ rateUnit: 's' }, sets, 4000, {
      reset: [
        { t: 0, v: false },
        { t: 1000, v: null },
        { t: 2000, v: false },
      ],
    });
    add(G, 'totalizer-reset-unknown', 'reset BAD: không tạo cạnh', {
      doc: zdoc({ rateUnit: 's', reset: 'RST' }),
      steps: [
        { t: 0, set: { FLOW: 10, RST: false } },
        { t: 1000, set: { RST: BAD } },
        { t: 2000, set: { RST: false } },
        { t: 4000, expect: { outputs: { 'L.T': ref3.get(4000).total } } },
      ],
    });
  }
  {
    const ref = refTotalizer({ rateUnit: 's' }, [{ t: 0, v: 10 }], 1000, { total: 12.5, gap: 3 });
    add(G, 'totalizer-retain-initial', 'kho retain có sẵn: total và gapSeconds tiếp tục', {
      doc: zdoc({ rateUnit: 's' }),
      retain: { 'logic/z/total': 12.5, 'logic/z/gapSeconds': 3 },
      steps: [
        { t: 0, set: { FLOW: 10 } },
        {
          t: 1000,
          expect: {
            outputs: { 'L.T': ref.get(1000).total, 'L.G': 3 },
            retain: { 'logic/z/total': ref.get(1000).total, 'logic/z/gapSeconds': 3 },
          },
        },
      ],
    });
  }
  simple(
    'totalizer-one-hour',
    'dòng hằng 36 m³/h trong 1 giờ (36.000 quét): sai số ≤ 0,1 %',
    { rateUnit: 'h' },
    [{ t: 0, v: 36 }],
    [3600000],
  );
  {
    const ref = refTotalizer({ rateUnit: 'h' }, [{ t: 0, v: 36 }], 600000, { scanMs: 250 });
    add(G, 'totalizer-scan-250', 'scanMs 250: dt = 0,25 s', {
      doc: zdoc({ rateUnit: 'h' }),
      config: { scanMs: 250 },
      steps: [
        { t: 0, set: { FLOW: 36 } },
        { t: 600000, expect: { outputs: { 'L.T': ref.get(600000).total } } },
      ],
    });
  }
  {
    const ref = refTotalizer({ rateUnit: 's' }, [{ t: 0, v: 4 }], 2000);
    add(G, 'totalizer-no-gap-output', 'không khai gapSeconds: chỉ có total', {
      doc: { totalizers: [{ id: 'z', source: 'FLOW', rateUnit: 's', total: 'L.T' }] },
      steps: [
        { t: 0, set: { FLOW: 4 } },
        { t: 2000, expect: { outputs: { 'L.T': ref.get(2000).total } } },
      ],
    });
    const ref2 = refTotalizer({ rateUnit: 's' }, [{ t: 0, v: 8 }], 2000);
    add(G, 'totalizer-source-expression', 'source là biểu thức (FLOW * 2)', {
      doc: { totalizers: [{ id: 'z', source: 'FLOW * 2', rateUnit: 's', total: 'L.T' }] },
      steps: [
        { t: 0, set: { FLOW: 4 } },
        { t: 2000, expect: { outputs: { 'L.T': ref2.get(2000).total } } },
      ],
    });
  }
}

// ======================================================================================
// runhours (≥ 15)
// ======================================================================================
{
  const G = 'runhours';
  const hdoc = (o = {}) => ({
    runhours: [
      { id: 'h', run: 'RUN', reset: 'RST', hours: 'L.H', starts: 'L.S', due: 'L.D', ...o },
    ],
  });
  const H = (ms) => ms / 3600000;
  const init = { t: 0, set: { RUN: false, RST: false } };
  add(G, 'runhours-one-hour', 'chạy 1 giờ: hours = 1, starts = 1', {
    doc: hdoc(),
    steps: [
      init,
      { t: 100, set: { RUN: true } },
      { t: 3600100, set: { RUN: false } },
      { t: 3700000, expect: { outputs: { 'L.H': 1, 'L.S': 1, 'L.D': false } } },
    ],
  });
  {
    const steps = [init];
    for (let i = 0; i < 10; i++) {
      steps.push({ t: 100 + i * 2000, set: { RUN: true } });
      steps.push({ t: 1100 + i * 2000, set: { RUN: false } });
    }
    steps.push({ t: 21000, expect: { outputs: { 'L.H': H(10000), 'L.S': 10 } } });
    add(G, 'runhours-cycles', '10 chu kỳ chạy 1 s: 10.000 ms, 10 lần khởi động', {
      doc: hdoc(),
      steps,
    });
  }
  add(
    G,
    'runhours-first-true-not-start',
    'lần thấy đầu tiên là true: không đếm khởi động, giờ tính từ quét đó',
    {
      doc: hdoc(),
      steps: [
        { t: 0, set: { RUN: true, RST: false } },
        { t: 1000, expect: { outputs: { 'L.H': H(1000), 'L.S': 0 } } },
      ],
    },
  );
  add(
    G,
    'runhours-retained-last-run',
    'retain lastRun = true và run vẫn true: không đếm thêm khởi động',
    {
      doc: hdoc(),
      retain: { 'logic/h/hours': 2, 'logic/h/starts': 7, 'logic/h/lastRun': true },
      steps: [
        { t: 0, set: { RUN: true, RST: false } },
        {
          t: 3600000,
          expect: {
            outputs: { 'L.H': 3, 'L.S': 7 },
            retain: { 'logic/h/hours': 3, 'logic/h/starts': 7, 'logic/h/lastRun': true },
          },
        },
      ],
    },
  );
  add(
    G,
    'runhours-retained-last-run-false',
    'retain lastRun = false và run true sau khởi động: đếm một khởi động',
    {
      doc: hdoc(),
      retain: { 'logic/h/hours': 2, 'logic/h/starts': 7, 'logic/h/lastRun': false },
      steps: [{ t: 0, set: { RUN: true, RST: false }, expect: { outputs: { 'L.S': 8 } } }],
    },
  );
  add(G, 'runhours-due', 'due = hours ≥ serviceEveryHours', {
    doc: hdoc({ serviceEveryHours: 0.0005 }),
    steps: [
      init,
      { t: 100, set: { RUN: true } },
      { t: 1800, expect: { outputs: { 'L.D': false } } },
      { t: 1900, expect: { outputs: { 'L.H': 0.0005, 'L.D': true } } },
    ],
  });
  add(G, 'runhours-due-null', 'serviceEveryHours vắng: due luôn false', {
    doc: hdoc(),
    steps: [
      init,
      { t: 100, set: { RUN: true } },
      { t: 10000, expect: { outputs: { 'L.D': false } } },
    ],
  });
  add(G, 'runhours-reset', 'reset: hours = 0, due = false; starts giữ', {
    doc: hdoc({ serviceEveryHours: 0.0001 }),
    steps: [
      init,
      { t: 100, set: { RUN: true } },
      { t: 1000, expect: { outputs: { 'L.D': true, 'L.S': 1 } } },
      { t: 1100, set: { RST: true }, expect: { outputs: { 'L.H': 0, 'L.S': 1, 'L.D': false } } },
      { t: 2100, expect: { outputs: { 'L.H': H(1000) } } },
    ],
  });
  add(G, 'runhours-reset-unknown', 'reset BAD: không đặt lại', {
    doc: hdoc(),
    steps: [
      init,
      { t: 100, set: { RUN: true } },
      { t: 1000, set: { RST: BAD } },
      { t: 2100, expect: { outputs: { 'L.H': H(2000) } } },
    ],
  });
  add(G, 'runhours-run-bad', 'run BAD: khoảng có quét unknown không cộng, không bù', {
    doc: hdoc(),
    steps: [
      init,
      { t: 100, set: { RUN: true } },
      { t: 1100, set: { RUN: BAD } },
      { t: 2000, set: { RUN: true } },
      { t: 3000, expect: { outputs: { 'L.H': H(900 + 1000), 'L.S': 1 } } },
    ],
  });
  add(G, 'runhours-run-uncertain', 'run UNCERTAIN: như unknown', {
    doc: hdoc(),
    steps: [
      init,
      { t: 100, set: { RUN: true } },
      { t: 1100, set: { RUN: { value: true, quality: 'UNCERTAIN' } } },
      { t: 2000, set: { RUN: true } },
      { t: 3000, expect: { outputs: { 'L.H': H(900 + 1000) } } },
    ],
  });
  add(
    G,
    'runhours-left-rule',
    'khoảng (k-1, k] tính theo run ở quét k-1: quét lên không tính, quét xuống có tính',
    {
      doc: hdoc(),
      steps: [
        init,
        { t: 1000, set: { RUN: true }, expect: { outputs: { 'L.H': 0 } } },
        { t: 1100, expect: { outputs: { 'L.H': H(100) } } },
        { t: 1500, set: { RUN: false }, expect: { outputs: { 'L.H': H(500) } } },
        { t: 3000, expect: { outputs: { 'L.H': H(500) } } },
      ],
    },
  );
  add(G, 'runhours-retain-hours', 'retain hours (số thực) khôi phục theo ms làm tròn', {
    doc: hdoc(),
    retain: { 'logic/h/hours': 1.5, 'logic/h/starts': 3 },
    steps: [
      { t: 0, set: { RUN: false, RST: false }, expect: { outputs: { 'L.H': 1.5, 'L.S': 3 } } },
    ],
  });
  add(G, 'runhours-run-expression', 'run là biểu thức (FLOW > 1)', {
    doc: { runhours: [{ id: 'h', run: 'FLOW > 1', hours: 'L.H', starts: 'L.S' }] },
    steps: [
      { t: 0, set: { FLOW: 0 } },
      { t: 100, set: { FLOW: 5 } },
      { t: 1100, set: { FLOW: 0.5 } },
      { t: 2000, expect: { outputs: { 'L.H': H(1000), 'L.S': 1 } } },
    ],
  });
  {
    const steps = [init];
    for (let i = 0; i < 12; i++) {
      steps.push({ t: 100 + i * 7200000, set: { RUN: true } });
      steps.push({ t: 100 + i * 7200000 + 3600000, set: { RUN: false } });
    }
    steps.push({ t: 86400000, expect: { outputs: { 'L.H': 12, 'L.S': 12 } } });
    add(G, 'runhours-24h', '24 giờ mô phỏng, chạy 1 giờ nghỉ 1 giờ: 12 giờ, 12 lần', {
      doc: hdoc(),
      steps,
    });
  }
  add(G, 'runhours-hours-only', 'chỉ khai hours', {
    doc: { runhours: [{ id: 'h', run: 'RUN', hours: 'L.H' }] },
    steps: [
      { t: 0, set: { RUN: false } },
      { t: 100, set: { RUN: true } },
      { t: 600, expect: { outputs: { 'L.H': H(500) } } },
    ],
  });
}

// ======================================================================================
// schedules (≥ 40); 2026-10-19 là thứ Hai
// ======================================================================================
{
  const G = 'schedules';
  const DAY = { days: [1, 2, 3, 4, 5], from: '06:00', to: '18:00' };
  const NIGHT = { days: [1], from: '22:00', to: '06:00' };
  const ALL = [1, 2, 3, 4, 5, 6, 7];
  const CASES = [
    ['mon-0559', 'thứ Hai 05:59 trước khung', {}, '2026-10-19T05:59:00+07:00', false],
    ['mon-0600', 'thứ Hai 06:00 biên đầu (đóng)', {}, '2026-10-19T06:00:00+07:00', true],
    ['mon-060059', 'thứ Hai 06:00:59', {}, '2026-10-19T06:00:59+07:00', true],
    ['mon-1200', 'thứ Hai 12:00', {}, '2026-10-19T12:00:00+07:00', true],
    ['mon-175959', 'thứ Hai 17:59:59 trước biên cuối', {}, '2026-10-19T17:59:59+07:00', true],
    ['mon-1800', 'thứ Hai 18:00 biên cuối (mở)', {}, '2026-10-19T18:00:00+07:00', false],
    ['fri-1000', 'thứ Sáu 10:00', {}, '2026-10-23T10:00:00+07:00', true],
    ['sat-1000', 'thứ Bảy 10:00 ngoài ngày', {}, '2026-10-24T10:00:00+07:00', false],
    ['sun-1000', 'Chủ nhật 10:00 ngoài ngày', {}, '2026-10-25T10:00:00+07:00', false],
    [
      'utc-other-day',
      'giờ UTC khác ngày địa phương (Chủ nhật 23:30 UTC = thứ Hai 06:30 +07)',
      {},
      '2026-10-18T23:30:00Z',
      true,
    ],
    [
      'night-mon-2200',
      'qua nửa đêm: thứ Hai 22:00',
      { weekly: [NIGHT] },
      '2026-10-19T22:00:00+07:00',
      true,
    ],
    [
      'night-mon-2159',
      'qua nửa đêm: thứ Hai 21:59',
      { weekly: [NIGHT] },
      '2026-10-19T21:59:00+07:00',
      false,
    ],
    [
      'night-mon-2359',
      'qua nửa đêm: thứ Hai 23:59',
      { weekly: [NIGHT] },
      '2026-10-19T23:59:00+07:00',
      true,
    ],
    [
      'night-tue-0000',
      'qua nửa đêm: thứ Ba 00:00 (đuôi của thứ Hai)',
      { weekly: [NIGHT] },
      '2026-10-20T00:00:00+07:00',
      true,
    ],
    [
      'night-tue-0559',
      'qua nửa đêm: thứ Ba 05:59',
      { weekly: [NIGHT] },
      '2026-10-20T05:59:00+07:00',
      true,
    ],
    [
      'night-tue-0600',
      'qua nửa đêm: thứ Ba 06:00 (mở)',
      { weekly: [NIGHT] },
      '2026-10-20T06:00:00+07:00',
      false,
    ],
    [
      'night-tue-2200',
      'qua nửa đêm: thứ Ba 22:00 (thứ Ba không có khung)',
      { weekly: [NIGHT] },
      '2026-10-20T22:00:00+07:00',
      false,
    ],
    [
      'night-mon-0300',
      'qua nửa đêm: thứ Hai 03:00 (đuôi của Chủ nhật, Chủ nhật không có)',
      { weekly: [NIGHT] },
      '2026-10-19T03:00:00+07:00',
      false,
    ],
    [
      'night-sun-mon-0100',
      'Chủ nhật 23:00 → thứ Hai 02:00: thứ Hai 01:00',
      { weekly: [{ days: [7], from: '23:00', to: '02:00' }] },
      '2026-10-19T01:00:00+07:00',
      true,
    ],
    [
      'night-sun-mon-0200',
      'Chủ nhật 23:00 → thứ Hai 02:00: thứ Hai 02:00 (mở)',
      { weekly: [{ days: [7], from: '23:00', to: '02:00' }] },
      '2026-10-19T02:00:00+07:00',
      false,
    ],
    [
      'midnight-0000',
      'khung 00:00–00:01: 00:00',
      { weekly: [{ days: ALL, from: '00:00', to: '00:01' }] },
      '2026-10-21T00:00:00+07:00',
      true,
    ],
    [
      'midnight-000059',
      'khung 00:00–00:01: 00:00:59',
      { weekly: [{ days: ALL, from: '00:00', to: '00:01' }] },
      '2026-10-21T00:00:59+07:00',
      true,
    ],
    [
      'midnight-0001',
      'khung 00:00–00:01: 00:01',
      { weekly: [{ days: ALL, from: '00:00', to: '00:01' }] },
      '2026-10-21T00:01:00+07:00',
      false,
    ],
    [
      'to-midnight-2359',
      'khung 23:59–00:00 (to = 00:00 là qua nửa đêm): 23:59:30',
      { weekly: [{ days: [1], from: '23:59', to: '00:00' }] },
      '2026-10-19T23:59:30+07:00',
      true,
    ],
    [
      'to-midnight-0000',
      'khung 23:59–00:00: thứ Ba 00:00 (mở)',
      { weekly: [{ days: [1], from: '23:59', to: '00:00' }] },
      '2026-10-20T00:00:00+07:00',
      false,
    ],
    [
      'two-windows-gap',
      'hai khung: khoảng giữa',
      {
        weekly: [
          { days: [1], from: '08:00', to: '11:00' },
          { days: [1], from: '13:00', to: '17:00' },
        ],
      },
      '2026-10-19T12:00:00+07:00',
      false,
    ],
    [
      'two-windows-second',
      'hai khung: khung sau',
      {
        weekly: [
          { days: [1], from: '08:00', to: '11:00' },
          { days: [1], from: '13:00', to: '17:00' },
        ],
      },
      '2026-10-19T13:00:00+07:00',
      true,
    ],
    [
      'overlap',
      'khung chồng nhau',
      {
        weekly: [
          { days: [1], from: '08:00', to: '12:00' },
          { days: [1], from: '10:00', to: '14:00' },
        ],
      },
      '2026-10-19T13:00:00+07:00',
      true,
    ],
    ['no-windows', 'không khung: luôn tắt', { weekly: [] }, '2026-10-19T12:00:00+07:00', false],
    [
      'exc-off',
      'ngoại lệ off đè khung',
      { exceptions: [{ date: '2026-12-25', mode: 'off' }] },
      '2026-12-25T10:00:00+07:00',
      false,
    ],
    [
      'exc-off-other-day',
      'ngoại lệ off ngày khác không ảnh hưởng',
      { exceptions: [{ date: '2026-12-25', mode: 'off' }] },
      '2026-12-24T10:00:00+07:00',
      true,
    ],
    [
      'exc-on-0000',
      'ngoại lệ on: thứ Bảy cả ngày bật (00:00)',
      { exceptions: [{ date: '2026-10-24', mode: 'on' }] },
      '2026-10-24T00:00:00+07:00',
      true,
    ],
    [
      'exc-on-2359',
      'ngoại lệ on: 23:59:59 cùng ngày',
      { exceptions: [{ date: '2026-10-24', mode: 'on' }] },
      '2026-10-24T23:59:59+07:00',
      true,
    ],
    [
      'exc-on-next-day',
      'ngoại lệ on: hết ngày',
      { exceptions: [{ date: '2026-10-24', mode: 'on' }] },
      '2026-10-25T00:00:00+07:00',
      false,
    ],
    [
      'exc-local-date',
      'ngoại lệ theo ngày địa phương, không theo UTC',
      { exceptions: [{ date: '2026-12-25', mode: 'off' }] },
      '2026-12-24T23:30:00Z',
      false,
    ],
    [
      'exc-off-cancels-tail',
      'ngoại lệ off của thứ Hai hủy đuôi qua nửa đêm sang thứ Ba',
      { weekly: [NIGHT], exceptions: [{ date: '2026-10-19', mode: 'off' }] },
      '2026-10-20T02:00:00+07:00',
      false,
    ],
    [
      'exc-on-tuesday',
      'ngoại lệ on của thứ Ba đè cả ngày thứ Ba',
      { weekly: [NIGHT], exceptions: [{ date: '2026-10-20', mode: 'on' }] },
      '2026-10-20T12:00:00+07:00',
      true,
    ],
    [
      'tz-block-0-0530',
      'tzOffsetMin của khối (0) thay cho thiết bị: 05:30 UTC',
      { tzOffsetMin: 0 },
      '2026-10-19T05:30:00Z',
      false,
    ],
    [
      'tz-block-0-0600',
      'tzOffsetMin của khối (0): 06:00 UTC',
      { tzOffsetMin: 0 },
      '2026-10-19T06:00:00Z',
      true,
    ],
    [
      'tz-null',
      'tzOffsetMin null dùng của thiết bị',
      { tzOffsetMin: null },
      '2026-10-19T06:00:00+07:00',
      true,
    ],
    [
      'tz-neg-1100',
      'tzOffsetMin -300: 11:00 UTC = 06:00',
      { tzOffsetMin: -300 },
      '2026-10-19T11:00:00Z',
      true,
    ],
    [
      'tz-neg-1059',
      'tzOffsetMin -300: 10:59 UTC',
      { tzOffsetMin: -300 },
      '2026-10-19T10:59:00Z',
      false,
    ],
    [
      'tz-device-0',
      'tzOffsetMin của thiết bị 0',
      {},
      '2026-10-19T06:00:00Z',
      true,
      { tzOffsetMin: 0 },
    ],
    [
      'tz-345-0015',
      'tzOffsetMin 345 (lẻ phút): 00:15 UTC = 06:00',
      { tzOffsetMin: 345 },
      '2026-10-19T00:15:00Z',
      true,
    ],
    [
      'tz-345-0014',
      'tzOffsetMin 345: 00:14 UTC',
      { tzOffsetMin: 345 },
      '2026-10-19T00:14:00Z',
      false,
    ],
    [
      'leap-2028',
      'ngày nhuận 2028-02-29 là thứ Ba',
      { weekly: [{ days: [2], from: '00:00', to: '23:59' }] },
      '2028-02-29T12:00:00+07:00',
      true,
    ],
    [
      'leap-exc',
      'ngoại lệ ngày nhuận',
      { exceptions: [{ date: '2028-02-29', mode: 'off' }] },
      '2028-02-29T12:00:00+07:00',
      false,
    ],
    [
      'new-year-fri',
      'đổi năm: 2027-01-01 là thứ Sáu',
      { weekly: [{ days: [5], from: '00:00', to: '01:00' }] },
      '2027-01-01T00:30:00+07:00',
      true,
    ],
    [
      'new-year-tail',
      'đổi năm: qua nửa đêm từ thứ Năm 31/12',
      { weekly: [{ days: [4], from: '23:00', to: '01:00' }] },
      '2027-01-01T00:30:00+07:00',
      true,
    ],
    [
      'year-2100',
      'năm 2100 không nhuận: 2100-03-01 là thứ Hai',
      { weekly: [{ days: [1], from: '00:00', to: '23:59' }] },
      '2100-03-01T12:00:00+07:00',
      true,
    ],
  ];
  for (const [id, desc, s, wall, want, cfg] of CASES)
    add(G, `schedule-${id}`, desc, {
      doc: { schedules: [{ id: 's', weekly: [DAY], out: 'L.S', ...s }] },
      ...(cfg ? { config: cfg } : {}),
      steps: [{ t: 0, wall, expect: { outputs: { 'L.S': want } } }],
    });
  add(G, 'schedule-not-synced', 'timeSynced = false: BAD TIME_NOT_SYNCED', {
    doc: { schedules: [{ id: 's', weekly: [DAY], out: 'L.S' }] },
    steps: [
      {
        t: 0,
        wall: '2026-10-19T12:00:00+07:00',
        timeSynced: false,
        expect: { outputs: { 'L.S': { quality: 'BAD', reason: 'TIME_NOT_SYNCED' } } },
      },
    ],
  });
  add(G, 'schedule-no-wall', 'không có giờ thực: BAD TIME_NOT_SYNCED', {
    doc: { schedules: [{ id: 's', weekly: [DAY], out: 'L.S' }] },
    steps: [
      { t: 0, expect: { outputs: { 'L.S': { quality: 'BAD', reason: 'TIME_NOT_SYNCED' } } } },
    ],
  });
  add(
    G,
    'schedule-boundary-by-scan',
    'giờ thực trôi cùng đồng hồ monotonic: đổi ở quét đầu tiên ≥ biên',
    {
      doc: { schedules: [{ id: 's', weekly: [DAY], out: 'L.S' }] },
      steps: [
        { t: 0, wall: '2026-10-19T05:59:59.800+07:00', expect: { outputs: { 'L.S': false } } },
        { t: 100, expect: { outputs: { 'L.S': false } } },
        { t: 200, expect: { outputs: { 'L.S': true } } },
      ],
    },
  );
  add(G, 'schedule-sync-lost-and-back', 'mất đồng bộ rồi có lại: BAD rồi GOOD', {
    doc: { schedules: [{ id: 's', weekly: [DAY], out: 'L.S' }] },
    steps: [
      { t: 0, wall: '2026-10-19T12:00:00+07:00', expect: { outputs: { 'L.S': true } } },
      {
        t: 100,
        timeSynced: false,
        expect: { outputs: { 'L.S': { quality: 'BAD', reason: 'TIME_NOT_SYNCED' } } },
      },
      { t: 200, timeSynced: true, expect: { outputs: { 'L.S': true } } },
    ],
  });
  add(G, 'schedule-wall-jump', 'giờ thực nhảy (đặt lại wall) giữa chừng: lịch theo giờ mới', {
    doc: { schedules: [{ id: 's', weekly: [DAY], out: 'L.S' }] },
    steps: [
      { t: 0, wall: '2026-10-19T12:00:00+07:00', expect: { outputs: { 'L.S': true } } },
      { t: 1000, wall: '2026-10-19T19:00:00+07:00', expect: { outputs: { 'L.S': false } } },
    ],
  });
  add(G, 'schedule-drives-rule', 'luật theo lịch: cạnh lên ở biên 06:00', {
    doc: {
      schedules: [{ id: 's_day', weekly: [DAY], out: 'L.DAY' }],
      rules: [{ id: 'r', when: 'L.DAY', onRise: [{ do: 'setTag', tag: 'MODE', value: true }] }],
    },
    steps: [
      { t: 0, wall: '2026-10-19T05:59:59.500+07:00', expect: { actions: [] } },
      { t: 500, expect: { actions: [act('r', 'setTag', { tag: 'MODE', value: true, t: 500 })] } },
    ],
  });
}

// ======================================================================================
// writes: ghi và giới hạn (≥ 15)
// ======================================================================================
{
  const G = 'writes';
  const rule = (o = {}) => ({
    id: 'r',
    when: 'RUN',
    onRise: [{ do: 'write', write: 'w_cmd', value: true }],
    ...o,
  });
  /** n cạnh lên của RUN bắt đầu từ t0, chu kỳ `period`. */
  const flap = (n, t0, period) => {
    const s = [];
    for (let i = 0; i < n; i++) {
      s.push({ t: t0 + i * period, set: { RUN: true } });
      s.push({ t: t0 + i * period + period / 2, set: { RUN: false } });
    }
    return s;
  };
  const w = (o) => ({ ...W_CMD, ...o });
  add(
    G,
    'write-min-interval',
    'minIntervalMs 5.000: lệnh trong khoảng bị RATE_LIMITED, luật THROTTLED',
    {
      doc: { writes: [w({ minIntervalMs: 5000 })], rules: [rule()] },
      steps: [
        { t: 0, set: { RUN: false } },
        ...flap(3, 1000, 2000),
        {
          t: 6000,
          expect: {
            actions: [
              wr('r', 'w_cmd', 'CMD', true, 1, 1000),
              wr('r', 'w_cmd', 'CMD', true, 3, 3000, 'RATE_LIMITED'),
              wr('r', 'w_cmd', 'CMD', true, 5, 5000, 'RATE_LIMITED'),
            ],
            state: { r: { state: 'THROTTLED', lastError: 'RATE_LIMITED' } },
          },
        },
      ].sort((a, b) => a.t - b.t),
    },
  );
  add(G, 'write-throttled-expires', 'THROTTLED giữ 60 s kể từ lần bị chặn cuối rồi về OK', {
    doc: { writes: [w({ minIntervalMs: 5000 })], rules: [rule()] },
    steps: [
      { t: 0, set: { RUN: false } },
      ...flap(2, 1000, 2000),
      { t: 62900, expect: { state: { r: { state: 'THROTTLED' } } } },
      { t: 63000, expect: { state: { r: { state: 'OK', lastError: 'RATE_LIMITED' } } } },
    ],
  });
  add(G, 'write-max-per-hour', 'maxPerHour 3: lệnh thứ 4 và 5 trong giờ bị chặn', {
    doc: { writes: [w({ maxPerHour: 3 })], rules: [rule()] },
    steps: [
      { t: 0, set: { RUN: false } },
      ...flap(5, 1000, 2000),
      {
        t: 11000,
        expect: {
          actions: [1000, 3000, 5000, 7000, 9000].map((t, i) =>
            wr('r', 'w_cmd', 'CMD', true, 2 * i + 1, t, i < 3 ? 'QUEUED' : 'RATE_LIMITED'),
          ),
        },
      },
    ].sort((a, b) => a.t - b.t),
  });
  add(
    G,
    'write-max-per-hour-window',
    'cửa sổ trượt 1 giờ: lệnh đầu (t = 1.000) ra khỏi cửa sổ ở 3.601.000',
    {
      doc: { writes: [w({ maxPerHour: 2 })], rules: [rule()] },
      steps: [
        { t: 0, set: { RUN: false } },
        ...flap(2, 1000, 2000),
        {
          t: 3600800,
          expect: {
            actions: [
              wr('r', 'w_cmd', 'CMD', true, 1, 1000),
              wr('r', 'w_cmd', 'CMD', true, 3, 3000),
            ],
          },
        },
        {
          t: 3600900,
          set: { RUN: true },
          expect: { actions: [wr('r', 'w_cmd', 'CMD', true, 5, 3600900, 'RATE_LIMITED')] },
        },
        { t: 3601000, set: { RUN: false } },
        {
          t: 3601100,
          set: { RUN: true },
          expect: { actions: [wr('r', 'w_cmd', 'CMD', true, 7, 3601100)] },
        },
      ].sort((a, b) => a.t - b.t),
    },
  );
  const many = (n) => ({
    writes: Array.from({ length: n }, (_, i) => w({ id: `w${i}` })),
    rules: Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      when: 'RUN',
      onRise: [{ do: 'write', write: `w${i}`, value: true }],
    })),
  });
  add(
    G,
    'write-bucket',
    'logic.maxWritesPerMin 3: token bucket toàn thiết bị (đầy lúc khởi động)',
    {
      doc: many(4),
      config: { maxWritesPerMin: 3 },
      steps: [
        { t: 0, set: { RUN: false } },
        {
          t: 100,
          set: { RUN: true },
          expect: {
            actions: ['QUEUED', 'QUEUED', 'QUEUED', 'RATE_LIMITED'].map((r, i) => ({
              rule: `r${i}`,
              result: r,
            })),
          },
        },
      ],
    },
  );
  add(
    G,
    'write-bucket-refill',
    'bucket nạp 1 lượt mỗi 60.000 / maxWritesPerMin ms (20 s với 3/phút)',
    {
      doc: many(4),
      config: { maxWritesPerMin: 3 },
      steps: [
        { t: 0, set: { RUN: false } },
        {
          t: 100,
          set: { RUN: true },
          expect: {
            actions: ['QUEUED', 'QUEUED', 'QUEUED', 'RATE_LIMITED'].map((r, i) => ({
              rule: `r${i}`,
              result: r,
              t: 100,
            })),
          },
        },
        { t: 20000, set: { RUN: false } },
        {
          t: 20100,
          set: { RUN: true },
          expect: {
            actions: ['QUEUED', 'RATE_LIMITED', 'RATE_LIMITED', 'RATE_LIMITED'].map((r, i) => ({
              rule: `r${i}`,
              result: r,
              t: 20100,
            })),
          },
        },
      ],
    },
  );
  add(
    G,
    'write-off-suppressed',
    'logic.writes = off: SUPPRESSED, không tính giới hạn; setTag vẫn chạy',
    {
      doc: {
        writes: [w({ minIntervalMs: 60000 })],
        rules: [
          rule({
            onRise: [
              { do: 'setTag', tag: 'MODE', value: true },
              { do: 'write', write: 'w_cmd', value: true },
            ],
          }),
        ],
      },
      config: { writes: 'off' },
      steps: [
        { t: 0, set: { RUN: false } },
        ...flap(2, 1000, 2000),
        {
          t: 4000,
          expect: {
            actions: [
              act('r', 'setTag', { result: 'OK' }),
              act('r', 'write', { result: 'SUPPRESSED', value: true }),
              act('r', 'setTag', { result: 'OK' }),
              act('r', 'write', { result: 'SUPPRESSED' }),
            ],
            state: { r: { state: 'OK', lastError: null } },
          },
        },
      ].sort((a, b) => a.t - b.t),
    },
  );
  add(G, 'write-pulse', 'pulse: mang ms, qua cùng bộ chặn', {
    doc: {
      writes: [W_CMD],
      rules: [rule({ onRise: [{ do: 'pulse', write: 'w_cmd', value: true, ms: 500 }] })],
    },
    steps: [
      { t: 0, set: { RUN: false } },
      {
        t: 100,
        set: { RUN: true },
        expect: {
          actions: [
            act('r', 'pulse', {
              write: 'w_cmd',
              tag: 'CMD',
              value: true,
              ms: 500,
              result: 'QUEUED',
            }),
          ],
        },
      },
    ],
  });
  add(G, 'write-pulse-limited', 'pulse bị minIntervalMs chặn', {
    doc: {
      writes: [w({ minIntervalMs: 10000 })],
      rules: [rule({ onRise: [{ do: 'pulse', write: 'w_cmd', value: true, ms: 500 }] })],
    },
    steps: [
      { t: 0, set: { RUN: false } },
      ...flap(2, 1000, 2000),
      {
        t: 4000,
        expect: {
          actions: [
            act('r', 'pulse', { result: 'QUEUED' }),
            act('r', 'pulse', { result: 'RATE_LIMITED' }),
          ],
        },
      },
    ].sort((a, b) => a.t - b.t),
  });
  const spRule = (expr) => rule({ onRise: [{ do: 'write', write: 'w_sp', value: { expr } }] });
  add(G, 'write-expr-in-range', 'giá trị biểu thức trong allowed: QUEUED', {
    doc: { writes: [W_SP], rules: [spRule('LEVEL * 2')] },
    steps: [
      { t: 0, set: { RUN: false, LEVEL: 30 } },
      {
        t: 100,
        set: { RUN: true },
        expect: { actions: [act('r', 'write', { tag: 'SP', value: 60, result: 'QUEUED' })] },
      },
    ],
  });
  add(G, 'write-expr-out-of-range', 'giá trị biểu thức ngoài allowed: OUT_OF_LIMITS, lastError', {
    doc: { writes: [W_SP], rules: [spRule('LEVEL * 2')] },
    steps: [
      { t: 0, set: { RUN: false, LEVEL: 70 } },
      {
        t: 100,
        set: { RUN: true },
        expect: {
          actions: [act('r', 'write', { value: 140, result: 'OUT_OF_LIMITS' })],
          state: { r: { lastError: 'OUT_OF_LIMITS' } },
        },
      },
    ],
  });
  add(G, 'write-expr-boundary', 'biên min/max đóng: 100 được phép', {
    doc: { writes: [W_SP], rules: [spRule('LEVEL')] },
    steps: [
      { t: 0, set: { RUN: false, LEVEL: 100 } },
      {
        t: 100,
        set: { RUN: true },
        expect: { actions: [act('r', 'write', { value: 100, result: 'QUEUED' })] },
      },
    ],
  });
  add(
    G,
    'write-expr-values-list',
    'allowed là danh sách: giá trị biểu thức không thuộc danh sách bị chặn',
    {
      doc: {
        writes: [w({ allowed: { values: [true] } })],
        rules: [rule({ onRise: [{ do: 'write', write: 'w_cmd', value: { expr: 'LEVEL > 50' } }] })],
      },
      steps: [
        { t: 0, set: { RUN: false, LEVEL: 10 } },
        {
          t: 100,
          set: { RUN: true },
          expect: { actions: [act('r', 'write', { value: false, result: 'OUT_OF_LIMITS' })] },
        },
      ],
    },
  );
  add(G, 'write-shared-limiter', 'hai luật dùng chung một mục writes: chung bộ chặn', {
    doc: {
      writes: [w({ minIntervalMs: 5000 })],
      rules: [rule({ id: 'a' }), rule({ id: 'b', when: 'LEVEL > 50' })],
    },
    steps: [
      { t: 0, set: { RUN: false, LEVEL: 0 } },
      {
        t: 100,
        set: { RUN: true, LEVEL: 60 },
        expect: {
          actions: [
            act('a', 'write', { result: 'QUEUED' }),
            act('b', 'write', { result: 'RATE_LIMITED' }),
          ],
        },
      },
    ],
  });
  add(
    G,
    'write-blocked-not-counted',
    'lệnh bị chặn không tính vào giới hạn (maxPerHour 2, minIntervalMs 5.000)',
    {
      doc: { writes: [w({ minIntervalMs: 5000, maxPerHour: 2 })], rules: [rule()] },
      steps: [
        { t: 0, set: { RUN: false } },
        ...flap(4, 1000, 2000),
        { t: 13000, set: { RUN: true } },
        {
          t: 14000,
          expect: {
            actions: [
              act('r', 'write', { t: 1000, result: 'QUEUED' }),
              act('r', 'write', { t: 3000, result: 'RATE_LIMITED' }),
              act('r', 'write', { t: 5000, result: 'RATE_LIMITED' }),
              act('r', 'write', { t: 7000, result: 'QUEUED' }),
              act('r', 'write', { t: 13000, result: 'RATE_LIMITED' }),
            ],
          },
        },
      ].sort((a, b) => a.t - b.t),
    },
  );
  add(
    G,
    'write-int-rounding',
    'giá trị biểu thức vào Tag INT16: làm tròn nửa xa 0 (assign của ADR-015)',
    {
      doc: {
        writes: [w({ id: 'w_code', tag: 'CODE', allowed: { min: 0, max: 10 } })],
        rules: [rule({ onRise: [{ do: 'write', write: 'w_code', value: { expr: 'LEVEL / 2' } }] })],
      },
      steps: [
        { t: 0, set: { RUN: false, LEVEL: 5 } },
        {
          t: 100,
          set: { RUN: true },
          expect: { actions: [act('r', 'write', { tag: 'CODE', value: 3, result: 'QUEUED' })] },
        },
      ],
    },
  );
}

// ======================================================================================
// static: kiểm tra tĩnh (≥ 30): mỗi mã E_LOGIC_* một ca sai và một ca đúng gần nó; W_LOGIC_* tương tự
// ======================================================================================
{
  const G = 'static';
  const S = (id, desc, doc, expectErrors, o = {}) =>
    add(G, `static-${id}`, desc, { doc, expectErrors, ...o });
  const T = (o = {}) => ({ id: 't', kind: 'ton', in: 'IN', pt: 500, q: 'L.Q', ...o });
  const R = (o = {}) => ({
    id: 'r',
    when: 'RUN',
    hold: 1000,
    onRise: [{ do: 'write', write: 'w_cmd', value: true }],
    ...o,
  });
  const rules200 = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, when: 'RUN' }));
  S('limit-ok', '200 luật: đúng giới hạn', { rules: rules200(200) }, []);
  S('limit-rules', '201 luật: E_LOGIC_LIMIT', { rules: rules200(201) }, ['E_LOGIC_LIMIT']);
  S(
    'limit-actions',
    '9 hành động một luật: E_LOGIC_LIMIT',
    { rules: [{ id: 'r', when: 'RUN', onRise: Array(9).fill({ do: 'toggle', tag: 'MODE' }) }] },
    ['E_LOGIC_LIMIT'],
  );
  S(
    'limit-writes-interval',
    'minIntervalMs 999: E_LOGIC_LIMIT',
    { writes: [{ ...W_CMD, minIntervalMs: 999 }] },
    ['E_LOGIC_LIMIT'],
  );
  S('id-ok', 'id đúng dạng', { rules: [{ id: 'a_1', when: 'RUN' }] }, []);
  S('id-bad', 'id viết hoa: E_LOGIC_ID', { rules: [{ id: 'A1', when: 'RUN' }] }, ['E_LOGIC_ID']);
  S(
    'id-dup',
    'id trùng giữa luật và timer: E_LOGIC_ID',
    { rules: [{ id: 't', when: 'RUN' }], timers: [T()] },
    ['E_LOGIC_ID'],
  );
  S(
    'tag-ref-ok',
    'đọc Tag logic của timer',
    { rules: [{ id: 'r', when: 'L.Q' }], timers: [T()] },
    [],
  );
  S('tag-ref-bad', 'Tag không có: E_LOGIC_TAG_REF', { rules: [{ id: 'r', when: 'NO.SUCH' }] }, [
    'E_LOGIC_TAG_REF',
  ]);
  S('type-ok', 'when là BOOL', { rules: [{ id: 'r', when: 'LEVEL > 1' }] }, []);
  S('type-bad', 'when là số: E_LOGIC_TYPE', { rules: [{ id: 'r', when: 'LEVEL' }] }, [
    'E_LOGIC_TYPE',
  ]);
  S('expr-ok', 'biểu thức hợp lệ', { rules: [{ id: 'r', when: 'RUN && !MODE' }] }, []);
  S('expr-bad', 'cú pháp sai: E_LOGIC_EXPR', { rules: [{ id: 'r', when: 'RUN &&' }] }, [
    'E_LOGIC_EXPR',
  ]);
  S('collision-ok', 'đầu ra khác nhau', { timers: [T({ et: 'L.ET' })] }, []);
  S(
    'collision-bad',
    'đầu ra trùng Tag có sẵn: E_LOGIC_TAG_COLLISION',
    { timers: [T({ q: 'RUN' })] },
    ['E_LOGIC_TAG_COLLISION'],
  );
  S(
    'cycle-ok',
    'chuỗi không vòng',
    { timers: [T({ id: 'a', q: 'L.A' }), T({ id: 'b', in: 'L.A', q: 'L.B' })] },
    [],
  );
  S(
    'cycle-bad',
    'vòng a → b → a: E_LOGIC_CYCLE',
    { timers: [T({ id: 'a', in: 'L.B', q: 'L.A' }), T({ id: 'b', in: 'L.A', q: 'L.B' })] },
    ['E_LOGIC_CYCLE'],
  );
  S(
    'self-trigger-ok',
    'luật đặt Tag nó không đọc',
    { rules: [{ id: 'r', when: 'RUN', onRise: [{ do: 'setTag', tag: 'MODE', value: true }] }] },
    [],
  );
  S(
    'self-trigger-bad',
    'luật đọc Tag do chính nó đặt qua Tag tính toán: E_LOGIC_SELF_TRIGGER',
    { rules: [{ id: 'r', when: 'CALC', onRise: [{ do: 'setTag', tag: 'MODE', value: true }] }] },
    ['E_LOGIC_SELF_TRIGGER'],
  );
  S('write-undeclared-ok', 'write tham chiếu mục có', { writes: [W_CMD], rules: [R()] }, []);
  S(
    'write-undeclared-bad',
    'write tham chiếu mục không có: E_LOGIC_WRITE_UNDECLARED',
    { writes: [W_CMD], rules: [R({ onRise: [{ do: 'write', write: 'w_x', value: true }] })] },
    ['E_LOGIC_WRITE_UNDECLARED'],
  );
  S('write-target-ok', 'Tag thiết bị RW', { writes: [W_CMD, W_SP] }, []);
  S(
    'write-target-bad',
    'Tag chỉ đọc: E_LOGIC_WRITE_TARGET',
    { writes: [{ ...W_CMD, tag: 'RUN' }] },
    ['E_LOGIC_WRITE_TARGET'],
  );
  S(
    'write-value-ok',
    'hằng trong allowed',
    { writes: [W_SP], rules: [R({ onRise: [{ do: 'write', write: 'w_sp', value: 100 }] })] },
    [],
  );
  S(
    'write-value-bad',
    'hằng ngoài allowed: E_LOGIC_WRITE_VALUE',
    { writes: [W_SP], rules: [R({ onRise: [{ do: 'write', write: 'w_sp', value: 101 }] })] },
    ['E_LOGIC_WRITE_VALUE'],
  );
  S(
    'action-ok',
    'pulse ms 100',
    {
      writes: [W_CMD],
      rules: [R({ onRise: [{ do: 'pulse', write: 'w_cmd', value: true, ms: 100 }] })],
    },
    [],
  );
  S(
    'action-bad',
    'setTag vào Tag thiết bị: E_LOGIC_ACTION',
    { rules: [{ id: 'r', when: 'RUN', onRise: [{ do: 'setTag', tag: 'CMD', value: true }] }] },
    ['E_LOGIC_ACTION'],
  );
  S(
    'action-unknown',
    'hành động lạ: E_LOGIC_ACTION',
    { rules: [{ id: 'r', when: 'RUN', onRise: [{ do: 'exec', tag: 'MODE' }] }] },
    ['E_LOGIC_ACTION'],
  );
  S('timer-ok', 'pt 86.400.000', { timers: [T({ kind: 'tof', pt: 86400000 })] }, []);
  S('timer-bad', 'kind lạ: E_LOGIC_TIMER', { timers: [T({ kind: 'TON' })] }, ['E_LOGIC_TIMER']);
  S('timer-pt-zero', 'pt 0: E_LOGIC_TIMER', { timers: [T({ pt: 0 })] }, ['E_LOGIC_TIMER']);
  S(
    'counter-ok',
    'preset 1',
    { counters: [{ id: 'c', up: 'UP', preset: 1, value: 'L.V', reached: 'L.R' }] },
    [],
  );
  S(
    'counter-bad',
    'preset 0: E_LOGIC_COUNTER',
    { counters: [{ id: 'c', up: 'UP', preset: 0, value: 'L.V' }] },
    ['E_LOGIC_COUNTER'],
  );
  S(
    'totalizer-ok',
    'rateUnit min, cutoff 0',
    { totalizers: [{ id: 'z', source: 'FLOW', rateUnit: 'min', cutoff: 0, total: 'L.T' }] },
    [],
  );
  S(
    'totalizer-bad',
    'rateUnit lạ: E_LOGIC_TOTALIZER',
    { totalizers: [{ id: 'z', source: 'FLOW', rateUnit: 'hour', total: 'L.T' }] },
    ['E_LOGIC_TOTALIZER'],
  );
  S(
    'totalizer-factor',
    'factor 0: E_LOGIC_TOTALIZER',
    { totalizers: [{ id: 'z', source: 'FLOW', rateUnit: 's', factor: 0, total: 'L.T' }] },
    ['E_LOGIC_TOTALIZER'],
  );
  S(
    'schedule-ok',
    'khung qua nửa đêm',
    { schedules: [{ id: 's', weekly: [{ days: [1], from: '22:00', to: '06:00' }], out: 'L.S' }] },
    [],
  );
  S(
    'schedule-bad',
    'from = to: E_LOGIC_SCHEDULE',
    { schedules: [{ id: 's', weekly: [{ days: [1], from: '06:00', to: '06:00' }], out: 'L.S' }] },
    ['E_LOGIC_SCHEDULE'],
  );
  S(
    'schedule-date',
    'ngày 2026-02-29 không có: E_LOGIC_SCHEDULE',
    {
      schedules: [
        { id: 's', weekly: [], exceptions: [{ date: '2026-02-29', mode: 'on' }], out: 'L.S' },
      ],
    },
    ['E_LOGIC_SCHEDULE'],
  );
  add(G, 'static-version-ok', 'schemaVersion 1.0.3', { doc: {}, expectErrors: [] });
  groups.get(G).at(-1).doc.schemaVersion = '1.0.3';
  add(G, 'static-version-bad', 'schemaVersion 1.1.0: E_LOGIC_VERSION', {
    doc: {},
    expectErrors: ['E_LOGIC_VERSION'],
  });
  groups.get(G).at(-1).doc.schemaVersion = '1.1.0';
  // cảnh báo
  S('w-pt-rounded', 'pt 50 < scanMs: W_LOGIC_PT_ROUNDED', { timers: [T({ pt: 50 })] }, [], {
    expectWarnings: ['W_LOGIC_PT_ROUNDED'],
  });
  S('w-pt-ok', 'pt = scanMs: không cảnh báo', { timers: [T({ pt: 100 })] }, [], {
    expectWarnings: [],
  });
  S(
    'w-write-conflict',
    'cùng điều kiện, cùng cạnh, cùng Tag, khác giá trị: W_LOGIC_WRITE_CONFLICT',
    {
      writes: [W_CMD],
      rules: [
        R({ id: 'a' }),
        R({ id: 'b', onRise: [{ do: 'write', write: 'w_cmd', value: false }] }),
      ],
    },
    [],
    { expectWarnings: ['W_LOGIC_WRITE_CONFLICT'] },
  );
  S(
    'w-write-conflict-ok',
    'điều kiện khác nhau: không cảnh báo',
    {
      writes: [W_CMD],
      rules: [
        R({ id: 'a' }),
        R({ id: 'b', when: '!RUN', onRise: [{ do: 'write', write: 'w_cmd', value: false }] }),
      ],
    },
    [],
    { expectWarnings: [] },
  );
  {
    const counters = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`,
      up: 'UP',
      value: `L.C${i}`,
    }));
    const totalizers = Array.from({ length: 50 }, (_, i) => ({
      id: `z${i}`,
      source: 'FLOW',
      rateUnit: 's',
      total: `L.Z${i}`,
    }));
    S(
      'w-retain-io',
      '350 khối retain, flushS 10: > 100 MiB/ngày: W_LOGIC_RETAIN_IO',
      { rules: rules200(200), counters, totalizers },
      [],
      { config: { flushS: 10 }, expectWarnings: ['W_LOGIC_RETAIN_IO'] },
    );
    S(
      'w-retain-io-ok',
      'cùng khối, flushS 60: không cảnh báo',
      { rules: rules200(200), counters, totalizers },
      [],
      { config: { flushS: 60 }, expectWarnings: [] },
    );
  }
  S(
    'w-writes-off',
    'thiết bị đích logic.writes = off: W_LOGIC_WRITES_OFF',
    { writes: [W_CMD] },
    [],
    { config: { deviceWrites: 'off' }, expectWarnings: ['W_LOGIC_WRITES_OFF'] },
  );
  S('w-writes-on', 'thiết bị đích bật: không cảnh báo', { writes: [W_CMD] }, [], {
    config: { deviceWrites: 'on' },
    expectWarnings: [],
  });
  S(
    'w-no-hold',
    'hold 0, ghi PLC, điều kiện đọc Tag số của thiết bị: W_LOGIC_NO_HOLD',
    { writes: [W_CMD], rules: [R({ when: 'LEVEL > 50', hold: 0 })] },
    [],
    { expectWarnings: ['W_LOGIC_NO_HOLD'] },
  );
  S(
    'w-no-hold-ok',
    'hold 1.000: không cảnh báo',
    { writes: [W_CMD], rules: [R({ when: 'LEVEL > 50' })] },
    [],
    { expectWarnings: [] },
  );
  S(
    'w-disabled',
    'luật tắt: W_LOGIC_DISABLED',
    { rules: [{ id: 'r', when: 'RUN', enabled: false }] },
    [],
    { expectWarnings: ['W_LOGIC_DISABLED'] },
  );
  S(
    'w-enabled',
    'luật bật: không cảnh báo',
    { rules: [{ id: 'r', when: 'RUN', enabled: true }] },
    [],
    { expectWarnings: [] },
  );
}

// ======================================================================================
// retain (≥ 10): khởi động lại bằng `restart` trong steps
// ======================================================================================
{
  const G = 'retain';
  const cnt = (o = {}) => ({ id: 'c', up: 'UP', value: 'L.V', ...o });
  const pulses = (n, t0) => {
    const s = [];
    for (let i = 0; i < n; i++) {
      s.push({ t: t0 + 200 * i, set: { UP: true } });
      s.push({ t: t0 + 200 * i + 100, set: { UP: false } });
    }
    return s;
  };
  add(G, 'retain-counter', 'counter giữ value qua khởi động lại (flush rồi restart)', {
    doc: { counters: [cnt()] },
    steps: [
      { t: 0, set: { UP: false } },
      ...pulses(3, 100),
      {
        t: 1000,
        flush: true,
        expect: {
          outputs: { 'L.V': 3 },
          retain: { 'logic/c/value': '3', 'logic/c/overflow': false },
        },
      },
      { t: 5000, restart: true, set: { UP: false }, expect: { outputs: { 'L.V': 3 } } },
      { t: 5100, set: { UP: true }, expect: { outputs: { 'L.V': 4 } } },
    ],
  });
  add(
    G,
    'retain-not-flushed',
    'thay đổi sau lần flush cuối mất khi mất điện (tối đa một chu kỳ ghi)',
    {
      doc: { counters: [cnt()] },
      steps: [
        { t: 0, set: { UP: false } },
        ...pulses(2, 100),
        { t: 600, flush: true },
        ...pulses(2, 700),
        { t: 1200, expect: { outputs: { 'L.V': 4 } } },
        { t: 2000, restart: true, set: { UP: false }, expect: { outputs: { 'L.V': 2 } } },
      ],
    },
  );
  add(G, 'retain-false-resets', 'retain: false về 0 sau khởi động lại', {
    doc: { counters: [cnt({ retain: false })] },
    steps: [
      { t: 0, set: { UP: false } },
      ...pulses(2, 100),
      { t: 600, flush: true },
      { t: 2000, restart: true, set: { UP: false }, expect: { outputs: { 'L.V': 0 } } },
    ],
  });
  {
    const r1 = refTotalizer({ rateUnit: 's' }, [{ t: 0, v: 10 }], 3000);
    add(G, 'retain-totalizer', 'totalizer giữ total và gapSeconds', {
      doc: {
        totalizers: [{ id: 'z', source: 'FLOW', rateUnit: 's', total: 'L.T', gapSeconds: 'L.G' }],
      },
      steps: [
        { t: 0, set: { FLOW: 10 } },
        {
          t: 3000,
          flush: true,
          expect: { retain: { 'logic/z/total': r1.get(3000).total, 'logic/z/gapSeconds': 0 } },
        },
        {
          t: 9000,
          restart: true,
          set: { FLOW: 10 },
          expect: { outputs: { 'L.T': r1.get(3000).total, 'L.G': 0 } },
        },
      ],
    });
  }
  add(G, 'retain-runhours', 'giờ chạy giữ hours, starts, lastRun', {
    doc: { runhours: [{ id: 'h', run: 'RUN', hours: 'L.H', starts: 'L.S' }] },
    steps: [
      { t: 0, set: { RUN: false } },
      { t: 100, set: { RUN: true } },
      {
        t: 3600100,
        flush: true,
        expect: { retain: { 'logic/h/hours': 1, 'logic/h/starts': 1, 'logic/h/lastRun': true } },
      },
      {
        t: 4000000,
        restart: true,
        set: { RUN: true },
        expect: { outputs: { 'L.H': 1, 'L.S': 1 } },
      },
      {
        t: 4000100,
        set: { RUN: true },
        expect: { outputs: { 'L.H': 3600100 / 3600000, 'L.S': 1 } },
      },
    ],
  });
  add(
    G,
    'retain-edge-id',
    'edgeId tiếp tục từ giá trị đã lưu; cạnh dở dang trước mất điện không bắn lại',
    {
      doc: {
        rules: [
          {
            id: 'r',
            when: 'RUN',
            onRise: [{ do: 'setTag', tag: 'N', value: 1 }],
            onFall: [{ do: 'setTag', tag: 'N', value: 0 }],
          },
        ],
      },
      steps: [
        { t: 0, set: { RUN: false } },
        { t: 100, set: { RUN: true } },
        {
          t: 200,
          set: { RUN: false },
          flush: true,
          expect: {
            actions: [
              act('r', 'setTag', { value: 1, edgeId: 1 }),
              act('r', 'setTag', { value: 0, edgeId: 2 }),
            ],
            retain: { 'logic/r/edgeId': 2 },
          },
        },
        { t: 300, set: { RUN: true }, expect: { actions: [act('r', 'setTag', { edgeId: 3 })] } },
        {
          t: 1000,
          restart: true,
          set: { RUN: true },
          expect: { actions: [], state: { r: { edgeId: 2, stable: true } } },
        },
        {
          t: 1100,
          set: { RUN: false },
          expect: { actions: [act('r', 'setTag', { value: 0, edgeId: 3 })] },
        },
      ],
    },
  );
  add(G, 'retain-lost', 'kho retain hỏng: mọi khối về 0, retainLost', {
    doc: { counters: [cnt()], rules: [{ id: 'r', when: 'RUN' }] },
    steps: [
      { t: 0, set: { UP: false } },
      ...pulses(2, 100),
      { t: 600, flush: true },
      {
        t: 2000,
        restart: { retain: 'lost' },
        set: { UP: false },
        expect: { outputs: { 'L.V': 0 }, retainLost: true, state: { r: { edgeId: 0 } } },
      },
    ],
  });
  add(
    G,
    'retain-deploy-keeps-by-id',
    'nạp xuống tài liệu mới: khối cùng id giữ, id mới từ 0, id bị xóa bỏ',
    {
      doc: { counters: [cnt({ id: 'c_keep', value: 'L.K' }), cnt({ id: 'c_gone', value: 'L.G' })] },
      steps: [
        { t: 0, set: { UP: false } },
        ...pulses(2, 100),
        { t: 600, flush: true },
        {
          t: 2000,
          restart: {
            doc: {
              schemaVersion: '1.0.0',
              counters: [cnt({ id: 'c_keep', value: 'L.K' }), cnt({ id: 'c_new', value: 'L.N' })],
            },
          },
          set: { UP: false },
          expect: {
            outputs: { 'L.K': 2, 'L.N': 0 },
            retain: {
              'logic/c_keep/value': '2',
              'logic/c_keep/overflow': false,
              'logic/c_new/value': '0',
              'logic/c_new/overflow': false,
            },
          },
        },
      ],
    },
  );
  add(
    G,
    'retain-never-flushed',
    'chưa flush lần nào: khởi động lại với kho trống (không phải hỏng)',
    {
      doc: { counters: [cnt()] },
      steps: [
        { t: 0, set: { UP: false } },
        ...pulses(2, 100),
        {
          t: 2000,
          restart: true,
          set: { UP: false },
          expect: { outputs: { 'L.V': 0 }, retainLost: false },
        },
      ],
    },
  );
  add(G, 'retain-timer-not-kept', 'timer không giữ qua khởi động lại: q = false, et = 0, đếm lại', {
    doc: { timers: [{ id: 't', kind: 'ton', in: 'IN', pt: 500, q: 'L.Q', et: 'L.ET' }] },
    steps: [
      { t: 0, set: { IN: true } },
      { t: 1000, flush: true, expect: { outputs: { 'L.Q': true }, retain: {} } },
      {
        t: 2000,
        restart: true,
        set: { IN: true },
        expect: { outputs: { 'L.Q': false, 'L.ET': 0 } },
      },
      { t: 2500, expect: { outputs: { 'L.Q': true } } },
    ],
  });
  add(G, 'retain-hold-restarts', 'hold không giữ qua khởi động lại; lần hợp lệ đầu đặt stable', {
    doc: {
      rules: [{ id: 'r', when: 'RUN', hold: 1000, onRise: [{ do: 'setTag', tag: 'N', value: 1 }] }],
    },
    steps: [
      { t: 0, set: { RUN: false } },
      { t: 500, set: { RUN: true } },
      { t: 1000, flush: true },
      {
        t: 2000,
        restart: true,
        set: { RUN: true },
        expect: { actions: [], state: { r: { stable: true } } },
      },
      { t: 6000, expect: { actions: [] } },
    ],
  });
  add(G, 'retain-initial-store', 'kho retain có sẵn lúc khởi động đầu', {
    doc: {
      counters: [cnt()],
      rules: [{ id: 'r', when: 'RUN', onRise: [{ do: 'setTag', tag: 'N', value: 1 }] }],
    },
    retain: { 'logic/c/value': '41', 'logic/r/edgeId': 9 },
    steps: [
      { t: 0, set: { UP: false, RUN: false }, expect: { outputs: { 'L.V': 41 } } },
      {
        t: 100,
        set: { UP: true, RUN: true },
        expect: { outputs: { 'L.V': 42 }, actions: [act('r', 'setTag', { edgeId: 10 })] },
      },
    ],
  });
}

// ======================================================================================
// Ghi file, kiểm số ca
// ======================================================================================
const MIN = {
  rules: 40,
  timers: 30,
  counters: 25,
  totalizers: 25,
  runhours: 15,
  schedules: 40,
  writes: 15,
  static: 30,
  retain: 10,
};
let total = 0;
for (const [g, min] of Object.entries(MIN)) {
  const n = groups.get(g)?.length ?? 0;
  if (n < min) throw new Error(`nhóm ${g}: ${n} ca < ${min}`);
  total += n;
}
if (total < 200) throw new Error(`tổng ${total} < 200`);
for (const c of [...groups.values()].flat()) {
  let last = -1;
  for (const s of c.steps) {
    if (s.t <= last) throw new Error(`${c.id}: bước t = ${s.t} không tăng`);
    if (s.t % c.config.scanMs !== 0) throw new Error(`${c.id}: t = ${s.t} không là bội của scanMs`);
    last = s.t;
  }
}
for (const [g, cases] of groups) {
  const body = cases.map((c) => JSON.stringify(c)).join(',\n');
  writeFileSync(join(here, `${g}.json`), `{ "group": "${g}", "cases": [\n${body}\n] }\n`);
}
console.log(
  `logic-vectors: ${total} ca (${[...groups].map(([g, c]) => `${g} ${c.length}`).join(', ')})`,
);
