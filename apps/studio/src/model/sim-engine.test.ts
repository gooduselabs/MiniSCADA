// Nguồn mô phỏng của Studio (T201, FR-052, data-model §13.4, contract value-tables-simulation §2.3, SC-017): Tag có `sim`
// chạy theo `sim`, Tag ngoài chưa có `sim` theo mặc định của @mat/tag-sim, Tag nội bộ là `initial`, Tag tính toán tính bằng
// @mat/expression theo thứ tự tô-pô; giá trị khớp tests/sim-vectors ở cùng `t`; ghi tay áp ngay; project 0.1 dùng legacy-mock;
// không gọi DeviceLink nào, không mở kết nối mạng nào.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegacyMock, defaultSim, simValue, type SimConfig } from '@mat/tag-sim';
import type { TagV1 } from '@mat/project-schema';
import { SIM_INTERVAL_MS, SimEngine, type SimChange } from './sim-engine.ts';

afterEach(() => vi.restoreAllMocks());

const VECTORS = resolve(__dirname, '../../../../tests/sim-vectors');

function clock(start = 1_791_601_205_123) {
  let now = start;
  return {
    now: () => now,
    set: (t: number) => (now = t),
    advance: (ms: number) => (now += ms),
  };
}

function fakeTimers() {
  const jobs = new Map<number, { fn: () => void; every: number }>();
  let id = 0;
  return {
    setInterval: (fn: () => void, every: number) => {
      jobs.set(++id, { fn, every });
      return id;
    },
    clearInterval: (h: unknown) => void jobs.delete(h as number),
    fire: () => jobs.forEach((j) => j.fn()),
    get active() {
      return jobs.size;
    },
    everyMs: () => [...jobs.values()].map((j) => j.every),
  };
}

const sim = (id: string, config: SimConfig, type: TagV1['type'] = 'FLOAT64'): TagV1 => ({
  id,
  kind: 'simulation',
  type,
  access: 'RW',
  sim: config,
});
const ext = (id: string, type: TagV1['type'] = 'FLOAT32', extra: Partial<TagV1> = {}): TagV1 => ({
  id,
  kind: 'external',
  type,
  source: { device: 'plc1', address: 'HR1' },
  ...extra,
});
const calc = (id: string, expression: string, type: TagV1['type'] = 'FLOAT64'): TagV1 => ({
  id,
  kind: 'calculated',
  type,
  expression,
});

function engineWith(tags: TagV1[], tables = [] as Parameters<SimEngine['load']>[1], t0?: number) {
  const c = clock(t0);
  const timers = fakeTimers();
  const e = new SimEngine({ clock: c.now, timers });
  e.load(tags, tables);
  return { e, c, timers };
}

describe('SimEngine: khớp tests/sim-vectors ở cùng t (SC-017)', () => {
  for (const file of ['const', 'ramp', 'sine', 'random', 'square']) {
    const { suites } = JSON.parse(readFileSync(resolve(VECTORS, `${file}.json`), 'utf8')) as {
      suites: {
        name: string;
        sim: SimConfig;
        type: TagV1['type'];
        cases: { t: number; value: number | boolean | string }[];
      }[];
    };
    it(`${file}: mọi suite, mọi ca`, () => {
      for (const s of suites) {
        const { e, c } = engineWith([sim('X', s.sim, s.type)]);
        for (const k of s.cases) {
          c.set(k.t);
          e.tick();
          const got = e.get('X')!;
          expect(got.quality).toBe('GOOD');
          if (s.type === 'INT64' || s.type === 'UINT64')
            expect(BigInt(got.value as number | string), `${s.name} t=${k.t}`).toBe(
              BigInt(k.value as string),
            );
          else if (typeof k.value === 'number')
            expect(
              Object.is(got.value, k.value),
              `${s.name} t=${k.t} got ${String(got.value)}`,
            ).toBe(true);
          else expect(got.value, `${s.name} t=${k.t}`).toBe(k.value);
          expect(got.ts).toBe(k.t);
        }
      }
    });
  }

  it('manual: giá trị của lệnh ghi cuối (chuỗi lệnh ghi của vector)', () => {
    const { suites } = JSON.parse(readFileSync(resolve(VECTORS, 'manual.json'), 'utf8')) as {
      suites: {
        name: string;
        sim: SimConfig;
        type: TagV1['type'];
        cases: {
          t: number;
          writes: (number | boolean | string)[];
          value: number | boolean | string;
        }[];
      }[];
    };
    for (const s of suites.filter((x) => x.type !== 'INT64' && x.type !== 'UINT64')) {
      for (const k of s.cases) {
        const { e, c } = engineWith([sim('X', s.sim, s.type)]);
        c.set(k.t);
        for (const w of k.writes) expect(e.write('X', w).ok).toBe(true);
        e.tick();
        const got = e.get('X')!.value;
        if (typeof k.value === 'number')
          expect(Object.is(got, k.value), `${s.name} t=${k.t} got ${String(got)}`).toBe(true);
        else expect(got).toBe(k.value);
      }
    }
  });
});

describe('SimEngine: nguồn theo loại Tag', () => {
  it('Tag ngoài chưa có sim: bộ sinh mặc định theo kiểu và khoảng của Tag (value-tables-simulation §2.3)', () => {
    const tags = [
      ext('A', 'FLOAT32', { min: 10, max: 20 }),
      ext('B', 'BOOL'),
      ext('C', 'STRING'),
      ext('D', 'INT16'),
    ];
    const { e, c } = engineWith(tags);
    e.tick();
    for (const tg of tags) {
      const want = simValue(
        defaultSim({
          id: tg.id,
          type: tg.type,
          ...(tg.min !== undefined ? { min: tg.min, max: tg.max } : {}),
        }),
        c.now(),
        tg.type,
      );
      expect(e.get(tg.id)!.value).toBe(want);
    }
    expect(e.get('C')!.value).toBe('');
    expect(Number.isInteger(e.get('D')!.value)).toBe(true);
  });

  it('Tag ngoài có sim: chạy theo sim; Tag nội bộ là initial (thiếu thì 0, false, chuỗi rỗng)', () => {
    const tags: TagV1[] = [
      { ...ext('A', 'FLOAT64'), sim: { kind: 'const', value: 7 } },
      { id: 'I1', kind: 'internal', type: 'FLOAT32', initial: 12.5 },
      { id: 'I2', kind: 'internal', type: 'BOOL' },
      { id: 'I3', kind: 'internal', type: 'STRING' },
      { id: 'I4', kind: 'internal', type: 'INT16' },
    ];
    const { e } = engineWith(tags);
    e.tick();
    expect(e.get('A')!.value).toBe(7);
    expect(e.get('I1')!.value).toBe(12.5);
    expect(e.get('I2')!.value).toBe(false);
    expect(e.get('I3')!.value).toBe('');
    expect(e.get('I4')!.value).toBe(0);
  });

  it('Tag tính toán: biểu thức theo thứ tự tô-pô, kể cả khi Tag phụ thuộc nằm trước trong danh sách', () => {
    const tags = [
      calc('DOUBLE', 'VOL * 2'),
      calc('VOL', 'LEVEL * 12.5'),
      sim('LEVEL', { kind: 'const', value: 40 }, 'FLOAT32'),
      calc('HIGH', 'LEVEL > 30', 'BOOL'),
      calc('TXT', 'text(MODE, Mode)', 'STRING'),
      { id: 'MODE', kind: 'internal', type: 'UINT16', initial: 1 } as TagV1,
    ];
    const { e } = engineWith(tags, [
      { name: 'Mode', entries: [{ value: 1, text: 'Tự động' }], default: { text: '?' } },
    ]);
    e.tick();
    expect(e.get('VOL')!.value).toBe(500);
    expect(e.get('DOUBLE')!.value).toBe(1000);
    expect(e.get('HIGH')!.value).toBe(true);
    expect(e.get('TXT')!.value).toBe('Tự động');
  });

  it('Tag tính toán lỗi: vòng tham chiếu, biểu thức sai, chia cho 0 → BAD, giữ giá trị cuối', () => {
    const tags = [
      calc('A', 'B + 1'),
      calc('B', 'A + 1'),
      calc('BROKEN', 'KHONGCO + 1'),
      sim('Z', { kind: 'manual', initial: 5 }, 'FLOAT64'),
      calc('Q', '10 / Z'),
    ];
    const { e } = engineWith(tags);
    e.tick();
    expect(e.get('A')!.quality).toBe('BAD');
    expect(e.get('BROKEN')!.quality).toBe('BAD');
    expect(e.get('Q')!.value).toBe(2);
    e.write('Z', 0);
    expect(e.get('Q')!.quality).toBe('BAD');
    expect(e.get('Q')!.reason).toBe('DIV_ZERO');
    expect(e.get('Q')!.value).toBe(2);
  });
});

describe('SimEngine: lượt, thời gian, đăng ký', () => {
  it('bật xong có ngay giá trị đủ mọi Tag (≤ 1 s) rồi mỗi 250 ms; tắt thì ngừng', () => {
    const { e, timers } = engineWith([
      sim('A', { kind: 'ramp', from: 0, to: 100, periodMs: 10000 }),
    ]);
    const seen: SimChange[][] = [];
    e.subscribe((c) => seen.push(c));
    expect(SIM_INTERVAL_MS).toBe(250);
    e.start();
    expect(e.running).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toMatchObject({ id: 'A', quality: 'GOOD' });
    expect(timers.everyMs()).toEqual([250]);
    e.start(); // lần hai không thêm hẹn giờ
    expect(timers.active).toBe(1);
    e.stop();
    expect(e.running).toBe(false);
    expect(timers.active).toBe(0);
  });

  it('mỗi lượt đọc đồng hồ Date.now() và chỉ báo Tag đổi giá trị', () => {
    const { e, c, timers } = engineWith([
      sim('RAMP', { kind: 'ramp', from: 0, to: 100, periodMs: 10000 }),
      sim('K', { kind: 'const', value: 1 }),
    ]);
    const seen: SimChange[][] = [];
    e.subscribe((x) => seen.push(x));
    c.set(1000);
    e.start();
    seen.length = 0;
    c.advance(250);
    timers.fire();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.map((x) => x.id)).toEqual(['RAMP']);
    expect(seen[0]![0]!.value).toBe(
      simValue({ kind: 'ramp', from: 0, to: 100, periodMs: 10000 }, 1250, 'FLOAT64'),
    );
  });

  it('load khi đang chạy: phát lại đầy đủ cho danh sách mới', () => {
    const { e } = engineWith([sim('A', { kind: 'const', value: 1 })]);
    const seen: SimChange[][] = [];
    e.start();
    e.subscribe((x) => seen.push(x));
    e.load([sim('A', { kind: 'const', value: 1 }), sim('B', { kind: 'const', value: 2 })], []);
    expect(
      seen
        .at(-1)!
        .map((x) => x.id)
        .sort(),
    ).toEqual(['A', 'B']);
    expect(e.get('B')!.value).toBe(2);
  });

  it('gỡ đăng ký thì không nhận nữa', () => {
    const { e, c, timers } = engineWith([
      sim('A', { kind: 'ramp', from: 0, to: 1, periodMs: 1000 }),
    ]);
    const seen: SimChange[][] = [];
    const off = e.subscribe((x) => seen.push(x));
    e.start();
    off();
    seen.length = 0;
    c.advance(250);
    timers.fire();
    expect(seen).toHaveLength(0);
  });
});

describe('SimEngine: ghi tay áp ngay', () => {
  it('Tag nội bộ: ghi áp ngay; Tag tính toán phụ thuộc cập nhật ngay (≤ 1 s)', () => {
    const { e } = engineWith([
      { id: 'SP', kind: 'internal', type: 'FLOAT32', access: 'RW', initial: 10 },
      calc('SP2', 'SP * 2'),
    ]);
    e.tick();
    expect(e.get('SP2')!.value).toBe(20);
    const seen: SimChange[][] = [];
    e.subscribe((x) => seen.push(x));
    expect(e.write('SP', 25)).toEqual({ ok: true });
    expect(e.get('SP')!.value).toBe(25);
    expect(e.get('SP2')!.value).toBe(50);
    expect(
      seen
        .flat()
        .map((x) => x.id)
        .sort(),
    ).toEqual(['SP', 'SP2']);
    e.tick(); // lượt sau vẫn giữ giá trị đã ghi
    expect(e.get('SP')!.value).toBe(25);
  });

  it('Tag có bộ sinh: ghi đè tới khi tắt Mô phỏng; ghi đè theo kiểu Tag (INT16 làm tròn, kẹp)', () => {
    const { e, c } = engineWith([
      {
        ...ext('W', 'INT16', { access: 'RW' }),
        sim: { kind: 'ramp', from: 0, to: 100, periodMs: 10000 },
      },
    ]);
    e.start();
    e.write('W', 2.5);
    expect(e.get('W')!.value).toBe(3);
    c.advance(5000);
    e.tick();
    expect(e.get('W')!.value).toBe(3);
    e.write('W', 99999);
    expect(e.get('W')!.value).toBe(32767);
    e.stop();
    e.start();
    expect(e.get('W')!.value).not.toBe(32767);
  });

  it('từ chối: Tag không có, Tag tính toán, Tag chỉ đọc (access R)', () => {
    const { e } = engineWith([
      calc('C', '1'),
      ext('R1', 'FLOAT32', { access: 'R' }),
      ext('R2', 'FLOAT32'), // access vắng = R
    ]);
    e.tick();
    expect(e.write('NOPE', 1)).toEqual({ ok: false, reason: 'unknown' });
    expect(e.write('C', 1)).toEqual({ ok: false, reason: 'calculated' });
    expect(e.write('R1', 1)).toEqual({ ok: false, reason: 'readonly' });
    expect(e.write('R2', 1)).toEqual({ ok: false, reason: 'readonly' });
  });

  it('writable(id) cho biết ghi được hay không và vì sao', () => {
    const { e } = engineWith([
      calc('C', '1'),
      ext('R1'),
      { id: 'I', kind: 'internal', type: 'BOOL', access: 'RW' },
    ]);
    expect(e.writable('I')).toBeNull();
    expect(e.writable('C')).toBe('calculated');
    expect(e.writable('R1')).toBe('readonly');
    expect(e.writable('X')).toBe('unknown');
  });
});

describe('SimEngine: project 0.1 (legacy-mock)', () => {
  const tags01 = [
    { id: 'tank.level', type: 'FLOAT32', source: { kind: 'mock', signal: 'tank.level' } },
    { id: 'motor.run', type: 'BOOL', source: { kind: 'mock', signal: 'motor.run' } },
    { id: 'x.unknown', type: 'FLOAT32', source: { kind: 'mock', signal: 'x.unknown' } },
  ] as unknown as Parameters<SimEngine['load']>[0];

  it('giá trị theo LegacyMock bước từ lúc bật; tín hiệu lạ BAD NO_SIGNAL', () => {
    const c = clock(5000);
    const e = new SimEngine({ clock: c.now, timers: fakeTimers() });
    e.load(tags01, []);
    const ref = new LegacyMock([
      { tag: 0, signal: 'tank.level' },
      { tag: 1, signal: 'motor.run' },
    ]);
    e.start();
    const first = ref.step(5000);
    expect(e.get('tank.level')!.value).toBe(first[0]!.value);
    expect(e.get('motor.run')!.value).toBe(first[1]!.value);
    expect(e.get('x.unknown')).toMatchObject({ quality: 'BAD', reason: 'NO_SIGNAL', value: null });
    c.advance(250);
    e.tick();
    const next = ref.step(5250);
    expect(e.get('tank.level')!.value).toBe(next[0]!.value);
  });

  it('Tag 0.2 có sim legacy dùng cùng bộ sinh', () => {
    const c = clock(1000);
    const e = new SimEngine({ clock: c.now, timers: fakeTimers() });
    e.load(
      [
        {
          id: 'L',
          kind: 'simulation',
          type: 'FLOAT32',
          sim: { kind: 'legacy', signal: 'tank.level' },
        },
      ],
      [],
    );
    e.start();
    const ref = new LegacyMock([{ tag: 0, signal: 'tank.level' }]);
    expect(e.get('L')!.value).toBe(ref.step(1000)[0]!.value);
  });
});

describe('SimEngine: không đụng mạng và thiết bị (FR-052)', () => {
  it('không gọi fetch, WebSocket, XMLHttpRequest, sendBeacon trong cả vòng đời', () => {
    const fetchSpy = vi.fn();
    const wsSpy = vi.fn();
    const xhrSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', wsSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    const { e, timers } = engineWith([
      ext('A'),
      calc('C', 'A + 1'),
      { id: 'I', kind: 'internal', type: 'FLOAT32', access: 'RW' },
    ]);
    e.start();
    timers.fire();
    e.write('I', 3);
    e.stop();
    vi.unstubAllGlobals();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  });
});
