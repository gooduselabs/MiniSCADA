// Hàm thuần của bảng alarm (feature 009, FR-056, FR-058, FR-066; contracts/ui-alarm.md §4.1, §8, §9).
import { describe, expect, it } from 'vitest';
import {
  type AlarmColumn,
  BlinkClock,
  SOUND_PATTERNS,
  compareInstances,
  computeCounts,
  filterInstances,
  foldVi,
  formatAlarmClock,
  priorityIcon,
  priorityLabel,
  shelvedRemaining,
  sortInstances,
  stateIcon,
  stateKind,
  stateLabel,
  strongestSound,
  topUnacked,
} from './alarm-format.ts';
import { inst, snap } from '../fixtures/alarm-fixtures.ts';

describe('foldVi', () => {
  const cases: Array<[string, string]> = [
    ['Bồn', 'bon'],
    ['ĐIỆN ÁP', 'dien ap'],
    ['Mức bồn B1 rất cao', 'muc bon b1 rat cao'],
    ['đồng hồ', 'dong ho'],
    ['Đồng', 'dong'],
    ['ắằẳẵặ', 'aaaaa'],
    ['ếềểễệ', 'eeeee'],
    ['ơờớởỡợ ưừứửữự', 'oooooo uuuuuu'],
    ['abc', 'abc'],
    ['', ''],
  ];
  it.each(cases)('%s → %s', (a, b) => expect(foldVi(a)).toBe(b));
  it('chuỗi đã tổ hợp sẵn và dạng NFD cho cùng kết quả', () => {
    expect(foldVi('Quạt'.normalize('NFD'))).toBe(foldVi('Quạt'.normalize('NFC')));
  });
});

describe('filterInstances', () => {
  const list = [
    inst({
      id: 'A',
      area: 'bon',
      class: 'critical',
      priority: 'critical',
      text: 'Mức bồn rất cao',
    }),
    inst({
      id: 'B',
      area: null,
      class: 'major',
      priority: 'major',
      state: 'ACTIVE_ACK',
      text: 'Bơm lỗi',
    }),
    inst({
      id: 'C',
      area: 'dien',
      class: 'minor',
      priority: 'minor',
      state: 'RTN_UNACK',
      text: 'Mất tín hiệu',
    }),
    inst({ id: 'D', area: 'bon', class: 'advisory', priority: 'advisory', text: 'Lưu ý ĐÈN' }),
  ];
  const ids = (f: Parameters<typeof filterInstances>[1]) =>
    filterInstances(list, f).map((i) => i.id);

  it('không bộ lọc: tất cả', () => expect(ids({})).toEqual(['A', 'B', 'C', 'D']));
  it('areas, "-" khớp Chung', () => {
    expect(ids({ areas: ['bon'] })).toEqual(['A', 'D']);
    expect(ids({ areas: ['-'] })).toEqual(['B']);
    expect(ids({ areas: ['-', 'dien'] })).toEqual(['B', 'C']);
  });
  it('classes', () => expect(ids({ classes: ['major', 'minor'] })).toEqual(['B', 'C']));
  it('priorities là chính xác các mức', () =>
    expect(ids({ priorities: ['critical', 'minor'] })).toEqual(['A', 'C']));
  it('minPriority là từ mức này trở lên', () => {
    expect(ids({ minPriority: 'major' })).toEqual(['A', 'B']);
    expect(ids({ minPriority: 'advisory' })).toEqual(['A', 'B', 'C', 'D']);
    expect(ids({ minPriority: 'critical' })).toEqual(['A']);
  });
  it('states', () =>
    expect(ids({ states: ['ACTIVE_UNACK', 'RTN_UNACK'] })).toEqual(['A', 'C', 'D']));
  it('q không phân biệt hoa thường và dấu tiếng Việt', () => {
    expect(ids({ q: 'BON' })).toEqual(['A']);
    expect(ids({ q: 'bơm' })).toEqual(['B']);
    expect(ids({ q: 'bom' })).toEqual(['B']);
    expect(ids({ q: 'den' })).toEqual(['D']);
  });
  it('q khớp cả tên định nghĩa', () => {
    const l = [inst({ id: 'X', name: 'Quạt hút', text: 'Chữ khác' })];
    expect(filterInstances(l, { q: 'quat' })).toHaveLength(1);
  });
  it('q rỗng hoặc chỉ khoảng trắng: không lọc', () => expect(ids({ q: '  ' })).toHaveLength(4));
  it('kết hợp bằng AND', () =>
    expect(ids({ areas: ['bon'], minPriority: 'major' })).toEqual(['A']));
  it('mảng rỗng là không lọc theo khóa đó', () =>
    expect(ids({ areas: [], classes: [], priorities: [], states: [] })).toHaveLength(4));
});

describe('compareInstances / sortInstances', () => {
  it('mặc định: ưu tiên rồi bật gần nhất trước', () => {
    const l = [
      inst({ id: 'm1', priority: 'major', tsActive: 100 }),
      inst({ id: 'c1', priority: 'critical', tsActive: 50 }),
      inst({ id: 'm2', priority: 'major', tsActive: 200 }),
      inst({ id: 'a1', priority: 'advisory', tsActive: 900 }),
    ];
    expect(sortInstances(l, null).map((i) => i.id)).toEqual(['c1', 'm2', 'm1', 'a1']);
  });
  it('hòa: occurrence giảm dần', () => {
    const l = [
      inst({ id: 'x', tsActive: 10, occurrence: 3 }),
      inst({ id: 'y', tsActive: 10, occurrence: 9 }),
    ];
    expect(sortInstances(l, null).map((i) => i.id)).toEqual(['y', 'x']);
  });
  it('cùng định nghĩa: HH trước H, LL trước L', () => {
    const base = { alarmId: 'T', type: 'limit' as const, tsActive: 5, occurrence: 1 };
    const l = [
      inst({ ...base, id: 'T.H', limit: 'H' }),
      inst({ ...base, id: 'T.HH', limit: 'HH' }),
      inst({ ...base, id: 'T.L', limit: 'L' }),
      inst({ ...base, id: 'T.LL', limit: 'LL' }),
    ];
    const out = sortInstances(l, null).map((i) => i.id);
    expect(out.indexOf('T.HH')).toBeLessThan(out.indexOf('T.H'));
    expect(out.indexOf('T.LL')).toBeLessThan(out.indexOf('T.L'));
  });
  it('sắp xếp theo mọi cột, hai chiều', () => {
    const l = [
      inst({
        id: 'a',
        tsActive: 3,
        text: 'Cảm biến',
        priority: 'minor',
        area: 'z',
        valueActive: 10,
        ackUser: 'b',
        state: 'ACTIVE_ACK',
      }),
      inst({
        id: 'b',
        tsActive: 1,
        text: 'An toàn',
        priority: 'critical',
        area: 'a',
        valueActive: 2,
        ackUser: 'a',
        state: 'ACTIVE_UNACK',
      }),
      inst({
        id: 'c',
        tsActive: 2,
        text: 'Bơm',
        priority: 'major',
        area: null,
        valueActive: 33,
        state: 'RTN_UNACK',
      }),
    ];
    const run = (column: AlarmColumn, dir: 'asc' | 'desc') =>
      sortInstances(l, { column, dir }).map((i) => i.id);
    expect(run('time', 'asc')).toEqual(['b', 'c', 'a']);
    expect(run('time', 'desc')).toEqual(['a', 'c', 'b']);
    expect(run('text', 'asc')).toEqual(['b', 'c', 'a']);
    expect(run('priority', 'asc')).toEqual(['b', 'c', 'a']); // asc = nghiêm trọng trước
    expect(run('priority', 'desc')).toEqual(['a', 'c', 'b']);
    expect(run('value', 'asc')).toEqual(['b', 'a', 'c']);
    expect(run('value', 'desc')).toEqual(['c', 'a', 'b']);
    expect(run('state', 'asc')).toEqual(['b', 'c', 'a']);
    expect(run('ackUser', 'asc')).toEqual(['c', 'b', 'a']); // vắng trước
    expect(run('area', 'asc')[0]).toBe('c'); // Chung (null) trước
  });
  it('compareInstances tương thích Array.sort và không đổi mảng gốc', () => {
    const l = [inst({ id: 'a', tsActive: 1 }), inst({ id: 'b', tsActive: 2 })];
    const copy = [...l];
    sortInstances(l, null);
    expect(l).toEqual(copy);
    expect([...l].sort((x, y) => compareInstances(x, y, null))[0]!.id).toBe('b');
  });
  it('khóa cột dùng tên khu vực khi được cấp', () => {
    const l = [inst({ id: 'p', area: 'k1' }), inst({ id: 'q', area: 'k2' })];
    const names: Record<string, string> = { k1: 'Zeta', k2: 'Alpha' };
    expect(
      sortInstances(l, { column: 'area', dir: 'asc' }, (id) => names[id ?? ''] ?? '').map(
        (i) => i.id,
      ),
    ).toEqual(['q', 'p']);
  });
});

describe('topUnacked (US1 kịch bản 7)', () => {
  it('ưu tiên cao nhất, rồi bật mới nhất', () => {
    const s = snap([
      inst({ id: 'a', priority: 'major', tsActive: 900 }),
      inst({ id: 'b', priority: 'critical', tsActive: 100 }),
      inst({ id: 'c', priority: 'critical', tsActive: 200 }),
    ]);
    expect(topUnacked(s)?.id).toBe('c');
  });
  it('không tính shelved, ACTIVE_ACK, RTN_UNACK', () => {
    const s = snap([
      inst({
        id: 'sh',
        priority: 'critical',
        shelved: { until: 1, remainingMs: 1, reason: 'r', user: 'u', system: false },
      }),
      inst({ id: 'ack', priority: 'critical', state: 'ACTIVE_ACK' }),
      inst({ id: 'rtn', priority: 'critical', state: 'RTN_UNACK' }),
      inst({ id: 'low', priority: 'advisory' }),
    ]);
    expect(topUnacked(s)?.id).toBe('low');
  });
  it('hòa: occurrence lớn nhất', () => {
    const s = snap([
      inst({ id: 'a', tsActive: 5, occurrence: 1 }),
      inst({ id: 'b', tsActive: 5, occurrence: 4 }),
    ]);
    expect(topUnacked(s)?.id).toBe('b');
  });
  it('không có: null', () => expect(topUnacked(snap([]))).toBeNull());
});

describe('trạng thái, biểu tượng, nhãn', () => {
  it('stateKind ưu tiên shelved, disabled', () => {
    expect(stateKind(inst({ state: 'ACTIVE_UNACK' }))).toBe('ACTIVE_UNACK');
    expect(stateKind(inst({ state: 'NORMAL', disabled: true }))).toBe('disabled');
    expect(
      stateKind(
        inst({
          state: 'NORMAL',
          shelved: { until: 1, remainingMs: 1, reason: 'r', user: 'u', system: false },
        }),
      ),
    ).toBe('shelved');
    expect(stateKind(inst({ state: 'NORMAL' }))).toBe('NORMAL');
  });
  it('nhãn có chữ và đầu vào BAD', () => {
    expect(stateLabel('ACTIVE_UNACK', false)).toBe('Đang có, chưa xác nhận');
    expect(stateLabel('ACTIVE_ACK', true)).toBe('Đang có, đã xác nhận (đầu vào BAD)');
    expect(stateLabel('shelved', false)).toBe('Tạm ẩn');
    expect(priorityLabel('critical')).toBe('Khẩn cấp');
  });
  it('hình mức ưu tiên khác nhau từng mức; biểu tượng trạng thái khác nhau', () => {
    const p = (['critical', 'major', 'minor', 'advisory'] as const).map(priorityIcon);
    expect(new Set(p).size).toBe(4);
    const s = (['ACTIVE_UNACK', 'ACTIVE_ACK', 'RTN_UNACK', 'shelved', 'disabled'] as const).map(
      stateIcon,
    );
    expect(new Set(s).size).toBe(5);
  });
  it('shelvedRemaining không âm', () => {
    const i = inst({
      shelved: { until: 1, remainingMs: 5000, reason: 'r', user: 'u', system: false },
    });
    expect(shelvedRemaining(i, 2000)).toBe(3000);
    expect(shelvedRemaining(i, 9000)).toBe(0);
    expect(shelvedRemaining(inst({}), 0)).toBe(0);
  });
  it('computeCounts đúng quy tắc §3.3', () => {
    const shelf = { until: 1, remainingMs: 1, reason: 'r', user: 'u', system: false };
    const c = computeCounts([
      inst({ id: '1', priority: 'critical' }),
      inst({ id: '2', priority: 'major', state: 'ACTIVE_ACK' }),
      inst({ id: '3', priority: 'minor', state: 'RTN_UNACK' }),
      inst({ id: '4', priority: 'critical', shelved: shelf }),
      inst({ id: '5', state: 'NORMAL', disabled: true }),
    ]);
    expect(c.active).toBe(3);
    expect(c.unack).toBe(1);
    expect(c.rtnUnack).toBe(1);
    expect(c.shelved).toBe(1);
    expect(c.disabled).toBe(1);
    expect(c.byPriority.critical).toEqual({ active: 1, unack: 1 });
    expect(c.byPriority.major).toEqual({ active: 1, unack: 0 });
  });
});

describe('formatAlarmClock', () => {
  const at = (d: number, h: number, m: number, s: number) =>
    new Date(2026, 9, d, h, m, s).getTime();
  it('cùng ngày: HH:mm:ss', () =>
    expect(formatAlarmClock(at(13, 8, 5, 9), at(13, 20, 0, 0))).toBe('08:05:09'));
  it('khác ngày: kèm ngày', () =>
    expect(formatAlarmClock(at(12, 23, 59, 1), at(13, 0, 1, 0))).toBe('12/10 23:59:01'));
});

describe('SOUND_PATTERNS (§9.1)', () => {
  it('bốn kiểu, none không phát', () => {
    expect(SOUND_PATTERNS.none).toBeNull();
    for (const k of ['beep', 'double', 'siren'] as const) expect(SOUND_PATTERNS[k]).not.toBeNull();
  });
  it('biên độ đỉnh 0,25 cho mọi kiểu', () => {
    for (const k of ['beep', 'double', 'siren'] as const)
      expect(SOUND_PATTERNS[k]!.peak).toBe(0.25);
  });
  it('beep: sine 880 Hz, chu kỳ 2,0 s, một tiếng 200 ms (10+150+40)', () => {
    const p = SOUND_PATTERNS.beep!;
    expect(p.wave).toBe('sine');
    expect(p.cycleMs).toBe(2000);
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0]).toMatchObject({
      startMs: 0,
      durMs: 200,
      fromHz: 880,
      toHz: 880,
      attackMs: 10,
      holdMs: 150,
      releaseMs: 40,
    });
  });
  it('double: hai tiếng 150 ms cách 100 ms, chu kỳ 2,0 s', () => {
    const p = SOUND_PATTERNS.double!;
    expect(p.cycleMs).toBe(2000);
    expect(p.segments.map((s) => [s.startMs, s.durMs])).toEqual([
      [0, 150],
      [250, 150],
    ]);
    for (const s of p.segments) expect([s.attackMs, s.holdMs, s.releaseMs]).toEqual([10, 100, 40]);
  });
  it('siren: triangle, quét 600→1100→600 Hz, chu kỳ 1,6 s, liên tục', () => {
    const p = SOUND_PATTERNS.siren!;
    expect(p.wave).toBe('triangle');
    expect(p.cycleMs).toBe(1600);
    expect(p.continuous).toBe(true);
    expect(p.segments.map((s) => [s.fromHz, s.toHz, s.durMs])).toEqual([
      [600, 1100, 800],
      [1100, 600, 800],
    ]);
  });
  it('kiểu mạnh hơn thắng: siren > double > beep', () => {
    expect(strongestSound(['beep', 'double'])).toBe('double');
    expect(strongestSound(['beep', 'siren', 'double'])).toBe('siren');
    expect(strongestSound(['none', 'beep'])).toBe('beep');
    expect(strongestSound(['none'])).toBe('none');
    expect(strongestSound([])).toBe('none');
  });
});

describe('BlinkClock (§8)', () => {
  const setup = (reduced = false) => {
    const root = document.createElement('div');
    const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
    let id = 0;
    const clock = new BlinkClock({
      root,
      reducedMotion: () => reduced,
      hidden: () => false,
      setTimer: (fn, ms) => {
        const my = ++id;
        timers.push({
          fn: () => {
            timers.splice(
              timers.findIndex((t) => t.id === my),
              1,
            );
            fn();
          },
          ms,
          id: my,
        });
        return my;
      },
      clearTimer: (h) => {
        const i = timers.findIndex((t) => t.id === h);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    return { root, timers, clock };
  };
  it('chỉ chạy khi có người đăng ký; nửa chu kỳ 500 ms (≤ 1 Hz)', () => {
    const { root, timers, clock } = setup();
    expect(timers).toHaveLength(0);
    const off = clock.acquire();
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(500);
    expect(root.dataset.blinkPhase).toBe('on');
    timers[0]!.fn();
    expect(root.dataset.blinkPhase).toBe('off');
    timers[0]!.fn();
    expect(root.dataset.blinkPhase).toBe('on');
    off();
    expect(timers).toHaveLength(0);
  });
  it('báo người nghe theo pha; nhiều người đăng ký dùng chung một bộ hẹn giờ', () => {
    const { timers, clock } = setup();
    const seen: string[] = [];
    const a = clock.acquire((p) => seen.push(`a${p}`));
    const b = clock.acquire((p) => seen.push(`b${p}`));
    expect(timers).toHaveLength(1);
    timers[0]!.fn();
    expect(seen).toEqual(['aon', 'aoff', 'boff']);
    a();
    expect(timers).toHaveLength(1);
    b();
    expect(timers).toHaveLength(0);
  });
  it('prefers-reduced-motion: không khởi động', () => {
    const { timers, clock, root } = setup(true);
    clock.acquire();
    expect(timers).toHaveLength(0);
    expect(root.dataset.blinkPhase).toBe('on');
  });
});
