// Bản port TS của MockTagProvider (generator `legacy`, T028/T029; contract value-tables-simulation §2.4): khớp
// tests/sim-vectors/legacy.json (do bản C++ sinh) với sai số tuyệt đối 1e-9; tín hiệu lạ → BAD `NO_SIGNAL`;
// bước 250 ms tính từ lúc bật Mô phỏng.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LegacyMock, type LegacyUpdate } from './legacy-mock.ts';

interface Vector {
  t0: number;
  stepMs: number;
  steps: number;
  tags: { id: string; type: string; signal: string }[];
  load: { count: number; recorded: number };
  values: Array<Array<[number | boolean | null, string, string?]>>;
  simSumCents: number[];
}
const vec = JSON.parse(
  readFileSync(resolve(__dirname, '../../../tests/sim-vectors/legacy.json'), 'utf8'),
) as Vector;

/** Bộ nhớ giá trị cuối của từng Tag, như TagStore: bản cập nhật ghi đè. */
function store(updates: LegacyUpdate[], into: Map<number, LegacyUpdate>) {
  for (const u of updates) into.set(u.tag, u);
}

describe('LegacyMock khớp legacy.json của bản C++', () => {
  it('mọi bước, mọi Tag: sai số tuyệt đối ≤ 1e-9, cùng quality và lý do', () => {
    const first = vec.tags.length;
    const sim = Array.from({ length: vec.load.count }, (_, k) => first + k);
    const mock = new LegacyMock(
      vec.tags.map((t, tag) => ({ tag, signal: t.signal })),
      sim,
    );
    const cur = new Map<number, LegacyUpdate>();
    let worst = 0;
    for (let s = 0; s < vec.steps; s++) {
      store(mock.step(vec.t0 + s * vec.stepMs), cur);
      const row = vec.values[s];
      for (let i = 0; i < first + vec.load.recorded; i++) {
        const got = cur.get(i)!;
        const [value, quality, reason] = row[i];
        expect(got.quality, `bước ${s} Tag ${i}`).toBe(quality);
        expect(got.reason ?? undefined, `bước ${s} Tag ${i} lý do`).toBe(reason);
        if (value === null) expect(got.value, `bước ${s} Tag ${i}`).toBeNull();
        else if (typeof value === 'boolean') expect(got.value, `bước ${s} Tag ${i}`).toBe(value);
        else {
          expect(typeof got.value).toBe('number');
          worst = Math.max(worst, Math.abs((got.value as number) - value));
          expect(Math.abs((got.value as number) - value), `bước ${s} Tag ${i}`).toBeLessThanOrEqual(
            1e-9,
          );
        }
      }
      let sum = 0;
      for (const k of sim) sum += Math.round((cur.get(k)!.value as number) * 100);
      expect(sum, `tổng SIM bước ${s}`).toBe(vec.simSumCents[s]);
    }
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  it('tín hiệu lạ → BAD NO_SIGNAL, không có giá trị', () => {
    const mock = new LegacyMock([{ tag: 0, signal: 'khong.co' }]);
    const [u] = mock.step(1_000_000);
    expect(u).toMatchObject({ tag: 0, value: null, quality: 'BAD', reason: 'NO_SIGNAL' });
  });

  it('bước 250 ms tính từ lúc bật Mô phỏng: lần đầu là t = 0 bất kể đồng hồ', () => {
    const a = new LegacyMock([
      { tag: 0, signal: 'tank.level' },
      { tag: 1, signal: 'motor.speed' },
    ]);
    const b = new LegacyMock([
      { tag: 0, signal: 'tank.level' },
      { tag: 1, signal: 'motor.speed' },
    ]);
    const early = a.step(5_000);
    const late = b.step(9_999_999_000);
    expect(early.map((u) => u.value)).toEqual(late.map((u) => u.value));
    expect(early[0].value).toBe(50);
    expect(early[1].value).toBe(1450);
    // Bốn bước 250 ms = 1 s: mực nước tăng đúng 80/30 %/s.
    let level = 0;
    for (let i = 1; i <= 4; i++) level = a.step(5_000 + i * 250)[0].value as number;
    expect(level).toBeCloseTo(Math.round((50 + 80 / 30) * 100) / 100, 9);
  });

  it('thời gian đi lùi hoặc nhảy xa: dt kẹp trong [0, 1 s]', () => {
    const m = new LegacyMock([{ tag: 0, signal: 'tank.level' }]);
    m.step(1000);
    const jump = m.step(1000 + 3_600_000)[0].value as number;
    expect(jump).toBeCloseTo(Math.round((50 + 80 / 30) * 100) / 100, 9);
    const back = m.step(500)[0].value as number;
    expect(back).toBe(jump);
  });

  it('tank.temp BAD DISCONNECTED 5 s trong mỗi cửa sổ 20 s, vẫn mang giá trị tính được', () => {
    const m = new LegacyMock([{ tag: 0, signal: 'tank.temp' }]);
    const t0 = 42_000;
    const at = (ms: number) => m.step(t0 + ms)[0];
    expect(at(0).quality).toBe('GOOD');
    expect(at(14_999).quality).toBe('GOOD');
    const bad = at(15_000);
    expect(bad).toMatchObject({ quality: 'BAD', reason: 'DISCONNECTED' });
    expect(typeof bad.value).toBe('number');
    expect(at(20_000).quality).toBe('GOOD');
  });
});
