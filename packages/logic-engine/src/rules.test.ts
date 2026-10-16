// Ngữ nghĩa luật (T127; FR-076, FR-077, FR-081, FR-082; contracts/logic-engine.md §2, §8, §10): hold, cạnh,
// fireOnStart, repeatMs, SUSPENDED và tiếp tục không cạnh giả, edgeId, thứ tự theo id, sắp xếp tô-pô, THROTTLED,
// writes off, giá trị ngoài allowed; các mã tĩnh (vòng, tự kích, xung đột ghi) qua validator của @mat/project-schema.
import { describe, expect, it } from 'vitest';
import { checkLogic, logicTagsFromList, type LogicDoc, type LogicRule } from '@mat/project-schema';
import { LogicHarness, type HarnessOptions } from './harness.ts';

const TAGS: HarnessOptions['tags'] = {
  LEVEL: { type: 'FLOAT64', kind: 'external', access: 'R' },
  RUN: { type: 'BOOL', kind: 'external', access: 'R' },
  CMD: { type: 'BOOL', kind: 'external', access: 'RW' },
  SP: { type: 'FLOAT64', kind: 'external', access: 'RW' },
  MODE: { type: 'BOOL', kind: 'internal', access: 'RW' },
  N: { type: 'INT32', kind: 'internal', access: 'RW' },
};
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
const lowRule = (o: Partial<LogicRule> = {}): LogicRule => ({
  id: 'low',
  when: 'LEVEL < 20',
  hold: 1000,
  onRise: [{ do: 'write', write: 'w_cmd', value: true }],
  onFall: [{ do: 'write', write: 'w_cmd', value: false }],
  ...o,
});
const make = (d: Partial<LogicDoc>, o: Partial<HarnessOptions> = {}) =>
  new LogicHarness({ schemaVersion: '1.0.0', writes: [W_CMD, W_SP], ...d }, { tags: TAGS, ...o });
const brief = (as: ReadonlyArray<{ rule: string; do: string; value?: unknown; result: string }>) =>
  as.map((a) => `${a.rule}:${a.do}:${String(a.value)}:${a.result}`);

describe('luật: hold và cạnh', () => {
  it('cạnh lên sau hold liên tục; đổi lại trước hạn thì hủy', () => {
    const h = make({ rules: [lowRule()] });
    h.set('LEVEL', 50);
    expect(h.runTo(1000)).toEqual([]);
    h.set('LEVEL', 10);
    expect(h.runTo(1500)).toEqual([]);
    h.set('LEVEL', 30); // hủy trước hạn
    expect(h.runTo(1600)).toEqual([]);
    h.set('LEVEL', 10);
    expect(h.runTo(2600)).toEqual([]);
    const a = h.runTo(2700);
    expect(brief(a)).toEqual(['low:write:true:QUEUED']);
    expect(a[0]).toMatchObject({ tag: 'CMD', write: 'w_cmd', edgeId: 1, t: 2700 });
    expect(h.runTo(10000)).toEqual([]);
    h.set('LEVEL', 25);
    expect(h.runTo(11000)).toEqual([]);
    expect(brief(h.runTo(11100))).toEqual(['low:write:false:QUEUED']);
    expect(h.state('low')).toMatchObject({ state: 'OK', edgeId: 2 });
  });

  it('hold = 0: thành stable ngay trong quét đó', () => {
    const h = make({ rules: [lowRule({ hold: 0 })] });
    h.set('LEVEL', 50);
    h.runTo(0);
    h.set('LEVEL', 10);
    expect(brief(h.runTo(100))).toEqual(['low:write:true:QUEUED']);
  });

  it('lần quét hợp lệ đầu tiên không bắn cạnh (fireOnStart mặc định false)', () => {
    const h = make({ rules: [lowRule({ hold: 0 })] });
    h.set('LEVEL', 10);
    expect(h.runTo(5000)).toEqual([]);
    expect(h.state('low').stable).toBe(true);
  });

  it('fireOnStart: true và điều kiện đúng: onRise chạy một lần lúc khởi động', () => {
    const h = make({ rules: [lowRule({ fireOnStart: true })] });
    h.set('LEVEL', 10);
    expect(brief(h.runTo(0))).toEqual(['low:write:true:QUEUED']);
    expect(h.runTo(5000)).toEqual([]);
  });

  it('fireOnStart: true mà điều kiện sai: không chạy gì', () => {
    const h = make({ rules: [lowRule({ fireOnStart: true })] });
    h.set('LEVEL', 50);
    expect(h.runTo(5000)).toEqual([]);
  });
});

describe('luật: repeatMs', () => {
  it('chạy lại onRise mỗi repeatMs kể từ lần chạy trước khi stable = true; không áp cho onFall', () => {
    const h = make({ rules: [lowRule({ hold: 0, repeatMs: 10000 })] });
    h.set('LEVEL', 50);
    h.runTo(0);
    h.set('LEVEL', 10);
    expect(brief(h.runTo(100))).toEqual(['low:write:true:QUEUED']);
    expect(h.runTo(10000)).toEqual([]);
    const a = h.runTo(10100);
    expect(brief(a)).toEqual(['low:write:true:QUEUED']);
    expect(a[0]!.edgeId).toBe(2);
    expect(brief(h.runTo(20100))).toEqual(['low:write:true:QUEUED']);
    expect(h.runTo(21100)).toEqual([]);
    h.set('LEVEL', 50);
    expect(brief(h.runTo(21200))).toEqual(['low:write:false:QUEUED']);
    expect(h.runTo(60000)).toEqual([]);
  });

  it('không lặp khi stable = true có từ lúc khởi động mà chưa từng chạy onRise', () => {
    const h = make({ rules: [lowRule({ hold: 0, repeatMs: 10000 })] });
    h.set('LEVEL', 10);
    expect(h.runTo(60000)).toEqual([]);
  });
});

describe('luật: SUSPENDED', () => {
  it('Tag BAD: SUSPENDED INPUT_BAD, đóng băng, không cạnh giả khi trở lại', () => {
    const h = make({ rules: [lowRule()] });
    h.set('LEVEL', 10);
    h.runTo(0);
    expect(h.state('low').stable).toBe(true);
    h.set('LEVEL', { value: 50, quality: 'BAD' });
    expect(h.runTo(5000)).toEqual([]);
    expect(h.state('low')).toMatchObject({ state: 'SUSPENDED', reason: 'INPUT_BAD', stable: true });
    h.set('LEVEL', 10);
    expect(h.runTo(10000)).toEqual([]);
    expect(h.state('low')).toMatchObject({ state: 'OK', stable: true });
  });

  it('hold bắt đầu lại từ 0 sau khi bị treo', () => {
    const h = make({ rules: [lowRule()] });
    h.set('LEVEL', 50);
    h.runTo(0);
    h.set('LEVEL', 10);
    h.runTo(800);
    h.set('LEVEL', { value: null, quality: 'BAD' });
    h.runTo(900);
    h.set('LEVEL', 10);
    expect(h.runTo(1900)).toEqual([]);
    expect(brief(h.runTo(2000))).toEqual(['low:write:true:QUEUED']);
  });

  it('chưa có giá trị và chất lượng UNCERTAIN cũng là unknown', () => {
    const h = make({ rules: [lowRule()] });
    h.runTo(500);
    expect(h.state('low')).toMatchObject({ state: 'SUSPENDED', reason: 'INPUT_BAD' });
    h.set('LEVEL', { value: 10, quality: 'UNCERTAIN', reason: 'STALE' });
    h.runTo(600);
    expect(h.state('low')).toMatchObject({ state: 'SUSPENDED', reason: 'INPUT_BAD' });
  });

  it('lỗi biểu thức lúc chạy (chia 0): EXPR_ERROR', () => {
    const h = make({ rules: [lowRule({ when: '100 / LEVEL > 1' })] });
    h.set('LEVEL', 0);
    h.runTo(0);
    expect(h.state('low')).toMatchObject({ state: 'SUSPENDED', reason: 'EXPR_ERROR' });
  });

  it('lịch chưa đồng bộ giờ: TIME_NOT_SYNCED', () => {
    const h = make({
      rules: [lowRule({ when: 'L.DAY && LEVEL < 20' })],
      schedules: [
        {
          id: 's_day',
          weekly: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '06:00', to: '18:00' }],
          out: 'L.DAY',
        },
      ],
    });
    h.set('LEVEL', 10);
    h.setWall(Date.parse('2026-10-19T08:00:00+07:00'), false);
    h.runTo(0);
    expect(h.state('low')).toMatchObject({ state: 'SUSPENDED', reason: 'TIME_NOT_SYNCED' });
    h.setWall(Date.parse('2026-10-19T08:00:00+07:00'), true);
    h.runTo(100);
    expect(h.state('low')).toMatchObject({ state: 'OK', stable: true });
  });

  it('enabled: false: DISABLED, không hành động', () => {
    const h = make({ rules: [lowRule({ enabled: false, hold: 0 })] });
    h.set('LEVEL', 50);
    h.runTo(0);
    h.set('LEVEL', 10);
    expect(h.runTo(1000)).toEqual([]);
    expect(h.state('low').state).toBe('DISABLED');
  });
});

describe('luật: thứ tự và hành động', () => {
  it('nhiều luật cùng quét: theo id tăng dần; hành động theo thứ tự khai báo', () => {
    const r = (id: string, v: number) => ({
      id,
      when: 'LEVEL < 20',
      onRise: [
        { do: 'setTag', tag: 'N', value: v },
        { do: 'write', write: 'w_sp', value: v },
      ],
    });
    const h = make({ rules: [r('zeta', 3), r('alpha', 1), r('mid', 2)] });
    h.set('LEVEL', 50);
    h.runTo(0);
    h.set('LEVEL', 10);
    expect(brief(h.runTo(100))).toEqual([
      'alpha:setTag:1:OK',
      'alpha:write:1:QUEUED',
      'mid:setTag:2:OK',
      'mid:write:2:RATE_LIMITED',
      'zeta:setTag:3:OK',
      'zeta:write:3:RATE_LIMITED',
    ]);
  });

  it('setTag có hiệu lực ở quét sau; toggle đảo giá trị hiện tại', () => {
    const h = make({
      rules: [
        { id: 'a', when: 'RUN', onRise: [{ do: 'setTag', tag: 'MODE', value: true }] },
        { id: 'c', when: 'MODE', onRise: [{ do: 'setTag', tag: 'N', value: 5 }] },
        { id: 'e', when: 'N > 0', onRise: [{ do: 'toggle', tag: 'MODE' }] },
      ],
    });
    h.set('RUN', false);
    h.set('MODE', false);
    h.set('N', 0);
    h.runTo(0);
    h.set('RUN', true);
    expect(brief(h.runTo(100))).toEqual(['a:setTag:true:OK']);
    expect(h.value('MODE')).toBe(true);
    expect(brief(h.runTo(200))).toEqual(['c:setTag:5:OK']);
    expect(h.value('N')).toBe(5);
    expect(brief(h.runTo(300))).toEqual(['e:toggle:false:OK']);
    expect(h.value('MODE')).toBe(false);
    expect(h.runTo(1000)).toEqual([]);
  });

  it('giá trị biểu thức: tính lúc bắn; ngoài allowed ⇒ OUT_OF_LIMITS và lastError', () => {
    const h = make({
      rules: [
        {
          id: 'r',
          when: 'RUN',
          onRise: [{ do: 'write', write: 'w_sp', value: { expr: 'LEVEL * 2' } }],
        },
      ],
    });
    h.set('RUN', false);
    h.set('LEVEL', 30);
    h.runTo(0);
    h.set('RUN', true);
    expect(brief(h.runTo(100))).toEqual(['r:write:60:QUEUED']);
    h.set('RUN', false);
    h.set('LEVEL', 70);
    h.runTo(5000);
    h.set('RUN', true);
    expect(brief(h.runTo(5100))).toEqual(['r:write:140:OUT_OF_LIMITS']);
    expect(h.state('r').lastError).toBe('OUT_OF_LIMITS');
  });

  it('khối đọc đầu ra của khối khác thấy giá trị của cùng quét (sắp xếp tô-pô)', () => {
    const h = make({
      rules: [{ id: 'a_rule', when: 'L.T', onRise: [{ do: 'setTag', tag: 'N', value: 1 }] }],
      timers: [{ id: 'z_timer', kind: 'ton', in: 'RUN', pt: 300, q: 'L.T' }],
    });
    h.set('RUN', false);
    h.runTo(0);
    h.set('RUN', true);
    expect(h.runTo(300)).toEqual([]);
    const a = h.runTo(400);
    expect(brief(a)).toEqual(['a_rule:setTag:1:OK']);
    expect(a[0]!.t).toBe(400);
    expect(h.value('L.T')).toBe(true);
  });
});

describe('luật: giới hạn ghi và THROTTLED', () => {
  const flap = (h: LogicHarness, from: number, n: number, period: number) => {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      h.set('RUN', true);
      out.push(...brief(h.runTo(from + i * period)));
      h.set('RUN', false);
      h.runTo(from + i * period + period / 2);
    }
    return out;
  };
  const rule = { id: 'r', when: 'RUN', onRise: [{ do: 'write', write: 'w_cmd', value: true }] };

  it('minIntervalMs: lệnh thứ hai trong khoảng bị RATE_LIMITED; THROTTLED 60 s rồi về OK', () => {
    const h = make({ writes: [{ ...W_CMD, minIntervalMs: 5000 }], rules: [rule] });
    h.set('RUN', false);
    h.runTo(0);
    expect(flap(h, 1000, 3, 2000)).toEqual([
      'r:write:true:QUEUED',
      'r:write:true:RATE_LIMITED',
      'r:write:true:RATE_LIMITED',
    ]);
    expect(h.state('r')).toMatchObject({ state: 'THROTTLED', lastError: 'RATE_LIMITED' });
    h.runTo(64000);
    expect(h.state('r').state).toBe('THROTTLED');
    h.runTo(64100);
    expect(h.state('r').state).toBe('OK');
  });

  it('maxPerHour: cửa sổ trượt 1 giờ', () => {
    const h = make({ writes: [{ ...W_CMD, maxPerHour: 3 }], rules: [rule] });
    h.set('RUN', false);
    h.runTo(0);
    const r = flap(h, 1000, 5, 2000);
    expect(r.filter((x) => x.endsWith('QUEUED'))).toHaveLength(3);
    expect(r.slice(3)).toEqual(['r:write:true:RATE_LIMITED', 'r:write:true:RATE_LIMITED']);
    // lệnh đầu (t = 1000) ra khỏi cửa sổ ở t = 3.601.000
    h.runTo(3_600_900);
    expect(flap(h, 3_601_000, 1, 2000)).toEqual(['r:write:true:QUEUED']);
  });

  it('logic.maxWritesPerMin: token bucket toàn thiết bị', () => {
    const rules = Array.from({ length: 4 }, (_, i) => ({
      id: `r${i}`,
      when: 'RUN',
      onRise: [{ do: 'write', write: `w${i}`, value: true }],
    }));
    const writes = rules.map((_, i) => ({ ...W_CMD, id: `w${i}` }));
    const h = make({ writes, rules }, { config: { maxWritesPerMin: 3 } });
    h.set('RUN', false);
    h.runTo(0);
    h.set('RUN', true);
    expect(brief(h.runTo(100)).map((x) => x.split(':')[3])).toEqual([
      'QUEUED',
      'QUEUED',
      'QUEUED',
      'RATE_LIMITED',
    ]);
    // 20 s nạp lại một lượt (3 lượt/phút)
    h.set('RUN', false);
    h.runTo(20000);
    h.set('RUN', true);
    expect(brief(h.runTo(20100)).map((x) => x.split(':')[3])).toEqual([
      'QUEUED',
      'RATE_LIMITED',
      'RATE_LIMITED',
      'RATE_LIMITED',
    ]);
  });

  it('logic.writes = off: SUPPRESSED, không tính vào giới hạn; setTag vẫn chạy', () => {
    const h = make(
      {
        rules: [{ ...rule, onRise: [{ do: 'setTag', tag: 'MODE', value: true }, ...rule.onRise] }],
      },
      { config: { writes: 'off' } },
    );
    h.set('RUN', false);
    h.runTo(0);
    expect(flap(h, 1000, 2, 2000)).toEqual([
      'r:setTag:true:OK',
      'r:write:true:SUPPRESSED',
      'r:setTag:true:OK',
      'r:write:true:SUPPRESSED',
    ]);
    expect(h.state('r').state).toBe('OK');
  });

  it('kết quả FAILED từ WriteCoordinator ghi vào lastError, không tự thử lại', () => {
    const h = make({ rules: [rule] });
    h.set('RUN', false);
    h.runTo(0);
    h.set('RUN', true);
    const [a] = h.runTo(100);
    h.writeResult('r', 'FAILED');
    expect(h.state('r')).toMatchObject({ state: 'OK', lastError: 'FAILED', edgeId: a!.edgeId });
    expect(h.runTo(10000)).toEqual([]);
  });
});

describe('luật: edgeId qua khởi động lại', () => {
  it('edgeId tiếp tục từ giá trị đã lưu cộng 1; cạnh dở dang không bắn lại', () => {
    const h = make({ rules: [lowRule({ hold: 0 })] });
    h.set('LEVEL', 50);
    h.runTo(0);
    for (let i = 0; i < 3; i++) {
      h.set('LEVEL', 10);
      h.runTo(100 + i * 2000);
      h.set('LEVEL', 50);
      h.runTo(1100 + i * 2000);
    }
    expect(h.state('low').edgeId).toBe(6);
    h.flush();
    h.set('LEVEL', 10);
    h.runTo(6000);
    expect(h.state('low').edgeId).toBe(7);
    h.restart(); // trạng thái của lần flush: edgeId 6
    h.set('LEVEL', 10);
    expect(h.runTo(6100)).toEqual([]);
    h.set('LEVEL', 50);
    const a = h.runTo(6200);
    expect(a[0]).toMatchObject({ do: 'write', value: false, edgeId: 7 });
  });
});

describe('kiểm tra tĩnh liên quan (validator TS)', () => {
  const tags = logicTagsFromList(
    Object.entries(TAGS).map(([id, t]) => ({ id, kind: t.kind, type: t.type, access: t.access })),
  );
  const codes = (d: Partial<LogicDoc>) =>
    checkLogic({ schemaVersion: '1.0.0', writes: [W_CMD], ...d }, { tags }).errors.map(
      (e) => e.code,
    );
  const wcodes = (d: Partial<LogicDoc>) =>
    checkLogic({ schemaVersion: '1.0.0', writes: [W_CMD], ...d }, { tags }).warnings.map(
      (e) => e.code,
    );

  it('E_LOGIC_CYCLE', () => {
    expect(
      codes({
        timers: [
          { id: 'a', kind: 'ton', in: 'L.B', pt: 100, q: 'L.A' },
          { id: 'b', kind: 'tof', in: 'L.A', pt: 100, q: 'L.B' },
        ],
      }),
    ).toEqual(['E_LOGIC_CYCLE']);
  });

  it('E_LOGIC_SELF_TRIGGER', () => {
    expect(
      codes({
        rules: [{ id: 'r', when: '!MODE', onRise: [{ do: 'setTag', tag: 'MODE', value: true }] }],
      }),
    ).toEqual(['E_LOGIC_SELF_TRIGGER']);
  });

  it('W_LOGIC_WRITE_CONFLICT', () => {
    expect(
      wcodes({
        rules: [
          {
            id: 'a',
            when: 'RUN',
            hold: 1000,
            onRise: [{ do: 'write', write: 'w_cmd', value: true }],
          },
          {
            id: 'b',
            when: 'RUN',
            hold: 1000,
            onRise: [{ do: 'write', write: 'w_cmd', value: false }],
          },
        ],
      }),
    ).toEqual(['W_LOGIC_WRITE_CONFLICT']);
  });
});
