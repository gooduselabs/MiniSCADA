// Giá trị mô phỏng cho xem trước (feature 004, T013, research R11, FR-032), đồng hồ giả.
import type { TagUpdate } from '@mat/binding-engine';
import type { TagDefinition } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  BOOL_TOGGLE_MS,
  SimSource,
  simRange,
  simValue,
  type SimClock,
  type SimTag,
} from './sim-source.ts';

/** Đồng hồ giả: advance(ms) chạy các lần hẹn giờ tới hạn. */
function fakeClock() {
  let now = 1_000_000;
  let next = 1;
  const timers = new Map<number, { cb: () => void; ms: number; due: number }>();
  const clock: SimClock = {
    now: () => now,
    setInterval: (cb, ms) => {
      const id = next++;
      timers.set(id, { cb, ms, due: now + ms });
      return id;
    },
    clearInterval: (h) => {
      timers.delete(h as number);
    },
  };
  return {
    clock,
    timers,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.values()]
          .filter((x) => x.due <= end)
          .sort((a, b) => a.due - b.due)[0];
        if (!due) break;
        now = due.due;
        due.due += due.ms;
        due.cb();
      }
      now = end;
    },
  };
}

const LEVEL: SimTag = { id: 'TANK01.LEVEL', type: 'FLOAT32', min: 0, max: 100 };
const SPEED: SimTag = { id: 'MOTOR01.SPEED', type: 'FLOAT32', min: 0, max: 1500 };
const RUN: SimTag = { id: 'MOTOR01.RUN', type: 'BOOL' };
const STATE: SimTag = { id: 'PUMP01.STATE', type: 'STRING' };
const COUNT: SimTag = { id: 'PUMP01.COUNT', type: 'UINT16', min: 0, max: 10 };
const RAW: SimTag = { id: 'RAW', type: 'FLOAT64' };

const times = Array.from({ length: 1200 }, (_, i) => i * 97); // ~2 phút, bước lẻ

describe('simValue', () => {
  it('Tag số nằm trong Min–Max và thật sự dao động', () => {
    for (const [i, tag] of [LEVEL, SPEED].entries()) {
      const vs = times.map((ms) => simValue(tag, i, ms) as number);
      expect(vs.every((v) => typeof v === 'number' && v >= tag.min! && v <= tag.max!)).toBe(true);
      expect(Math.max(...vs) - Math.min(...vs)).toBeGreaterThan((tag.max! - tag.min!) * 0.8);
    }
  });

  it('thiếu Min/Max thì 0–100; thiếu một đầu thì lấy 100 đơn vị từ đầu còn lại', () => {
    expect(simRange(RAW)).toEqual([0, 100]);
    expect(simRange({ ...RAW, min: 200 })).toEqual([200, 300]);
    expect(simRange({ ...RAW, max: -5 })).toEqual([-105, -5]);
    // Min ≥ Max (E_TAG_RANGE) hoặc không phải số: coi như thiếu
    expect(simRange({ ...RAW, min: 5, max: 5 })).toEqual([0, 100]);
    expect(simRange({ ...RAW, min: 'x' as unknown as number })).toEqual([0, 100]);
    const vs = times.map((ms) => simValue(RAW, 0, ms) as number);
    expect(vs.every((v) => v >= 0 && v <= 100)).toBe(true);
  });

  it('Tag số nguyên ra số nguyên trong khoảng', () => {
    const vs = times.map((ms) => simValue(COUNT, 3, ms) as number);
    expect(vs.every((v) => Number.isInteger(v) && v >= 0 && v <= 10)).toBe(true);
  });

  it('BOOL đổi trạng thái mỗi 5 s', () => {
    expect(BOOL_TOGGLE_MS).toBe(5000);
    expect(simValue(RUN, 0, 0)).toBe(true);
    expect(simValue(RUN, 0, 4999)).toBe(true);
    expect(simValue(RUN, 0, 5000)).toBe(false);
    expect(simValue(RUN, 0, 9999)).toBe(false);
    expect(simValue(RUN, 0, 10000)).toBe(true);
  });

  it('STRING giữ một giá trị cố định', () => {
    const vs = new Set(times.map((ms) => simValue(STATE, 0, ms)));
    expect(vs.size).toBe(1);
    expect(typeof [...vs][0]).toBe('string');
  });

  it('các Tag khác nhau không cùng pha', () => {
    expect(simValue(LEVEL, 0, 3000)).not.toBe(simValue(LEVEL, 1, 3000));
  });
});

describe('SimSource', () => {
  const tags = [LEVEL, RUN, STATE];

  it('start phát ngay một bản đủ mọi Tag, đúng kiểu TagUpdate, quality GOOD', () => {
    const f = fakeClock();
    const sim = new SimSource({ tags, clock: f.clock });
    const got: TagUpdate[][] = [];
    sim.onChange = (u) => got.push(u);
    sim.start();
    expect(sim.running).toBe(true);
    expect(got).toHaveLength(1);
    expect(got[0].map((u) => u.id)).toEqual(['TANK01.LEVEL', 'MOTOR01.RUN', 'PUMP01.STATE']);
    for (const u of got[0]) {
      expect(Object.keys(u).sort()).toEqual(['id', 'quality', 'value']);
      expect(u.quality).toBe('GOOD');
    }
    expect(got[0][1].value).toBe(true);
  });

  it('mỗi chu kỳ chỉ phát giá trị đã đổi; BOOL đổi ở giây thứ 5', () => {
    const f = fakeClock();
    const sim = new SimSource({ tags, clock: f.clock, intervalMs: 500 });
    const got: TagUpdate[][] = [];
    sim.onChange = (u) => got.push(u);
    sim.start();
    f.advance(500);
    expect(got).toHaveLength(2);
    expect(got[1].map((u) => u.id)).toEqual(['TANK01.LEVEL']); // BOOL, STRING chưa đổi
    f.advance(4500); // tới 5 s
    const all = got.flat();
    const runs = all.filter((u) => u.id === 'MOTOR01.RUN').map((u) => u.value);
    expect(runs).toEqual([true, false]);
    expect(all.filter((u) => u.id === 'PUMP01.STATE')).toHaveLength(1);
    expect(all.every((u) => u.quality === 'GOOD')).toBe(true);
  });

  it('stop dừng hẹn giờ, không phát nữa; start lại phát bản đủ', () => {
    const f = fakeClock();
    const sim = new SimSource({ tags, clock: f.clock });
    let n = 0;
    sim.onChange = () => n++;
    sim.start();
    sim.stop();
    expect(sim.running).toBe(false);
    expect(f.timers.size).toBe(0);
    f.advance(10_000);
    expect(n).toBe(1);
    sim.start();
    sim.start(); // gọi hai lần không tạo hai hẹn giờ
    expect(f.timers.size).toBe(1);
    expect(n).toBe(2);
  });

  it('setTags khi đang chạy phát bản đủ cho danh sách mới; nhận cả TagDefinition', () => {
    const f = fakeClock();
    const sim = new SimSource({ tags: [LEVEL], clock: f.clock });
    const got: TagUpdate[][] = [];
    sim.onChange = (u) => got.push(u);
    sim.start();
    const def: TagDefinition = {
      id: 'TANK01.TEMP',
      type: 'FLOAT32',
      min: 0,
      max: 100,
      source: { kind: 'mock', signal: 'tank.temp' },
    };
    sim.setTags([LEVEL, def]);
    expect(got.at(-1)!.map((u) => u.id)).toEqual(['TANK01.LEVEL', 'TANK01.TEMP']);
    sim.stop();
    sim.setTags([RUN]); // đang dừng: không phát
    expect(got).toHaveLength(2);
  });
});
