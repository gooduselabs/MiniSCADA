// Âm thanh alarm bằng Web Audio (feature 009, FR-059; US1 kịch bản 9; contracts/ui-alarm.md §9).
import { MemoryAlarmSource, SOUND_PATTERNS } from '@mat/ui-components';
import { AREAS, CLASSES, inst } from '@mat/ui-components/fixtures';
import { describe, expect, it } from 'vitest';
import { AlarmSound, SOUND_STORAGE_KEY, type AudioContextLike } from './sound.ts';

interface Ev {
  kind: 'set' | 'ramp' | 'cancel';
  value?: number;
  time: number;
}
class FakeParam {
  events: Ev[] = [];
  value = 0;
  setValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'set', value, time });
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ kind: 'ramp', value, time });
  }
  cancelScheduledValues(time: number) {
    this.events.push({ kind: 'cancel', time });
  }
}
class FakeOsc {
  type = 'sine';
  frequency = new FakeParam();
  started: number | null = null;
  stopped: number | null = null;
  connected: unknown = null;
  connect(n: unknown) {
    this.connected = n;
  }
  disconnect() {}
  start(t: number) {
    this.started = t;
  }
  stop(t: number) {
    this.stopped = t;
  }
}
class FakeGain {
  gain = new FakeParam();
  connect() {}
  disconnect() {}
}
class FakeCtx implements AudioContextLike {
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'suspended';
  destination = {};
  oscs: FakeOsc[] = [];
  gains: FakeGain[] = [];
  resumes = 0;
  resume() {
    this.resumes++;
    if (!this.blocked) this.state = 'running';
    return Promise.resolve();
  }
  blocked = false;
  createOscillator() {
    const o = new FakeOsc();
    this.oscs.push(o);
    return o as never;
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g as never;
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

class Store {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

function setup(opts: { stored?: string; throwing?: boolean } = {}) {
  const ctxs: FakeCtx[] = [];
  const store = new Store();
  if (opts.stored) store.data.set(SOUND_STORAGE_KEY, opts.stored);
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  let tid = 0;
  let now = 0;
  const sound = new AlarmSound({
    createContext: () => {
      const c = new FakeCtx();
      ctxs.push(c);
      return c;
    },
    storage: () =>
      opts.throwing
        ? ({
            getItem() {
              throw new Error('SecurityError');
            },
            setItem() {
              throw new Error('SecurityError');
            },
          } as unknown as Storage)
        : (store as unknown as Storage),
    setTimer: (fn, ms) => {
      timers.push({ at: now + ms, fn, id: ++tid });
      return tid;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  /** Chạy bộ hẹn giờ và đồng hồ âm thanh tiến `ms`. */
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const n = timers[0];
      if (!n || n.at > end) break;
      timers.shift();
      now = n.at;
      for (const c of ctxs) c.currentTime = now / 1000;
      n.fn();
    }
    now = end;
    for (const c of ctxs) c.currentTime = now / 1000;
  };
  return { sound, ctxs, store, advance, ctx: () => ctxs[0]! };
}

const src = (list: ReturnType<typeof inst>[]) =>
  new MemoryAlarmSource({ instances: list, classes: CLASSES, areas: AREAS });
const crit = (id: string, over: Partial<ReturnType<typeof inst>> = {}) =>
  inst({ id, priority: 'critical', class: 'critical', ...over }); // siren
const major = (id: string, over: Partial<ReturnType<typeof inst>> = {}) =>
  inst({ id, priority: 'major', class: 'major', ...over }); // double
const minor = (id: string, over: Partial<ReturnType<typeof inst>> = {}) =>
  inst({ id, priority: 'minor', class: 'minor', ...over }); // beep
const upd = (s: AlarmSound, m: MemoryAlarmSource, status: 'live' | 'stale' = 'live') =>
  s.update(m.snapshot(), status);

describe('mặc định tắt và chỉ báo (D23, D38)', () => {
  it('mặc định tắt; chưa tạo AudioContext; có alarm có tiếng thì hiện chỉ báo', () => {
    const t = setup();
    expect(t.sound.state).toBe('off');
    upd(t.sound, src([crit('a')]));
    expect(t.ctxs).toHaveLength(0);
    expect(t.sound.hintVisible()).toBe(true);
  });
  it('không alarm có tiếng: không chỉ báo', () => {
    const t = setup();
    upd(t.sound, src([inst({ id: 'adv', priority: 'advisory', class: 'advisory' })]));
    expect(t.sound.hintVisible()).toBe(false);
    upd(t.sound, src([]));
    expect(t.sound.hintVisible()).toBe(false);
  });
  it('lần lặp cập nhật khi tắt không thử phát hay tạo AudioContext', () => {
    const t = setup();
    const m = src([crit('a')]);
    for (let i = 0; i < 5; i++) upd(t.sound, m);
    t.advance(5000);
    expect(t.ctxs).toHaveLength(0);
  });
});

describe('bật bằng một nhấp (chính sách tự phát của Chrome)', () => {
  it('toggle() tạo và resume AudioContext, lưu "on", state on', async () => {
    const t = setup();
    await t.sound.toggle();
    expect(t.ctxs).toHaveLength(1);
    expect(t.ctx().resumes).toBeGreaterThanOrEqual(1);
    expect(t.store.getItem(SOUND_STORAGE_KEY)).toBe('on');
    expect(t.sound.state).toBe('on');
    await t.sound.toggle();
    expect(t.store.getItem(SOUND_STORAGE_KEY)).toBe('off');
    expect(t.sound.state).toBe('off');
  });
  it('đã lưu "on" từ lần trước nhưng chưa có thao tác: suspended + chỉ báo, chưa tạo context', () => {
    const t = setup({ stored: 'on' });
    expect(t.sound.state).toBe('suspended');
    upd(t.sound, src([crit('a')]));
    expect(t.ctxs).toHaveLength(0);
    expect(t.sound.hintVisible()).toBe(true);
  });
  it('unlock() (thao tác người dùng bất kỳ) khôi phục khi đã lưu "on"', async () => {
    const t = setup({ stored: 'on' });
    await t.sound.unlock();
    expect(t.ctxs).toHaveLength(1);
    expect(t.sound.state).toBe('on');
  });
  it('context bị trình duyệt giữ suspended sau khi bật (tab nền): state suspended, hiện lại chỉ báo', async () => {
    const t = setup();
    await t.sound.toggle();
    t.ctx().state = 'suspended';
    upd(t.sound, src([crit('a')]));
    expect(t.sound.state).toBe('suspended');
    expect(t.sound.hintVisible()).toBe(true);
    expect(t.ctx().oscs).toHaveLength(0);
  });
  it('localStorage ném lỗi: vẫn chạy, không ném', async () => {
    const t = setup({ throwing: true });
    expect(t.sound.state).toBe('off');
    await t.sound.toggle();
    expect(t.sound.state).toBe('on');
    upd(t.sound, src([crit('a')]));
    expect(t.ctx().oscs.length).toBe(1);
  });
});

describe('phát theo lớp (§9.1, §9.2)', () => {
  const on = async (stored = 'on') => {
    const t = setup({ stored });
    await t.sound.unlock();
    return t;
  };
  it('siren: sóng triangle, quét 600→1100→600 Hz, biên độ đỉnh 0,25 và bao tăng giảm', async () => {
    const t = await on();
    upd(t.sound, src([crit('a')]));
    const o = t.ctx().oscs[0]!;
    expect(o.type).toBe('triangle');
    const f = o.frequency.events.filter((e) => e.kind !== 'cancel');
    const hz = f.map((e) => e.value);
    expect(hz).toContain(600);
    expect(hz).toContain(1100);
    const g = t
      .ctx()
      .gains[0]!.gain.events.filter((e) => e.kind !== 'cancel')
      .map((e) => e.value!);
    expect(Math.max(...g)).toBeLessThanOrEqual(SOUND_PATTERNS.siren!.peak);
    expect(Math.max(...g)).toBeCloseTo(0.25, 5);
    expect(g[0]).toBe(0); // bắt đầu từ 0: không lách tách
  });
  it('double: sine 880 Hz, hai tiếng mỗi chu kỳ 2 s', async () => {
    const t = await on();
    upd(t.sound, src([major('a')]));
    const o = t.ctx().oscs[0]!;
    expect(o.type).toBe('sine');
    const gain = t
      .ctx()
      .gains[0]!.gain.events.filter((e) => e.kind === 'ramp' && e.value === 0.25 && e.time < 2);
    expect(gain).toHaveLength(2); // hai tiếng trong chu kỳ đầu
    expect(o.frequency.events.some((e) => e.value === 880)).toBe(true);
  });
  it('beep: một tiếng 200 ms mỗi chu kỳ 2 s', async () => {
    const t = await on();
    upd(t.sound, src([minor('a')]));
    const peaks = t
      .ctx()
      .gains[0]!.gain.events.filter((e) => e.kind === 'ramp' && e.value === 0.25 && e.time < 2);
    expect(peaks).toHaveLength(1);
  });
  it('lặp khi còn ACTIVE_UNACK: lên lịch chu kỳ kế bằng currentTime', async () => {
    const t = await on();
    const m = src([minor('a')]);
    upd(t.sound, m);
    const before = t
      .ctx()
      .gains[0]!.gain.events.filter((e) => e.kind === 'ramp' && e.value === 0.25).length;
    t.advance(10_000);
    const after = t
      .ctx()
      .gains[0]!.gain.events.filter((e) => e.kind === 'ramp' && e.value === 0.25).length;
    expect(after).toBeGreaterThan(before + 2);
  });
  it('ngừng khi xác nhận (hết ACTIVE_UNACK): dừng oscillator ngay', async () => {
    const t = await on();
    const m = src([minor('a')]);
    upd(t.sound, m);
    const o = t.ctx().oscs[0]!;
    expect(o.stopped).toBeNull();
    m.upsert(minor('a', { state: 'ACTIVE_ACK' }));
    upd(t.sound, m);
    expect(o.stopped).not.toBeNull();
    expect(t.sound.playing).toBe('none');
    // không phát lại
    const n = t.ctx().oscs.length;
    t.advance(10_000);
    expect(t.ctx().oscs.length).toBe(n);
  });
  it('shelved, ACTIVE_ACK, RTN_UNACK, advisory, lớp none: không tiếng', async () => {
    const t = await on();
    const shelf = { until: 1, remainingMs: 1, reason: 'r', user: 'u', system: false };
    upd(
      t.sound,
      src([
        crit('s', { shelved: shelf }),
        crit('k', { state: 'ACTIVE_ACK' }),
        crit('r', { state: 'RTN_UNACK' }),
        inst({ id: 'adv', priority: 'advisory', class: 'advisory' }),
      ]),
    );
    expect(t.ctx().oscs).toHaveLength(0);
    expect(t.sound.playing).toBe('none');
  });
  it('chọn một kiểu: mức ưu tiên cao nhất thắng, không phát chồng', async () => {
    const t = await on();
    upd(t.sound, src([minor('a'), major('b'), crit('c')]));
    expect(t.sound.playing).toBe('siren');
    expect(t.ctx().oscs).toHaveLength(1);
  });
  it('cùng mức: kiểu mạnh hơn thắng (siren > double > beep)', async () => {
    const t = await on();
    const classes = [
      { ...CLASSES[0]!, id: 'x1', priority: 'major' as const, sound: 'beep' as const },
      { ...CLASSES[0]!, id: 'x2', priority: 'major' as const, sound: 'siren' as const },
    ];
    const m = new MemoryAlarmSource({
      instances: [
        inst({ id: 'a', class: 'x1', priority: 'major' }),
        inst({ id: 'b', class: 'x2', priority: 'major' }),
      ],
      classes,
    });
    upd(t.sound, m);
    expect(t.sound.playing).toBe('siren');
  });
  it('alarm ưu tiên cao không có tiếng thì xét alarm thấp hơn có tiếng', async () => {
    const t = await on();
    const classes = [
      { ...CLASSES[0]!, id: 'q', priority: 'critical' as const, sound: 'none' as const },
      CLASSES[2]!,
    ];
    const m = new MemoryAlarmSource({
      instances: [inst({ id: 'a', class: 'q', priority: 'critical' }), minor('b')],
      classes,
    });
    upd(t.sound, m);
    expect(t.sound.playing).toBe('beep');
  });
  it('mất kết nối (stale): ngừng tiếng', async () => {
    const t = await on();
    const m = src([crit('a')]);
    upd(t.sound, m);
    expect(t.sound.playing).toBe('siren');
    upd(t.sound, m, 'stale');
    expect(t.sound.playing).toBe('none');
  });
  it('đổi kiểu khi alarm mạnh hơn tới: dừng kiểu cũ, phát kiểu mới', async () => {
    const t = await on();
    const m = src([minor('a')]);
    upd(t.sound, m);
    expect(t.sound.playing).toBe('beep');
    m.upsert(crit('b'));
    upd(t.sound, m);
    expect(t.sound.playing).toBe('siren');
    expect(t.ctx().oscs[0]!.stopped).not.toBeNull();
  });
});

describe('Tắt tiếng (US1 kịch bản 9)', () => {
  const on = async () => {
    const t = setup({ stored: 'on' });
    await t.sound.unlock();
    return t;
  };
  it('dừng tiếng, KHÔNG xác nhận, không gọi gì ra ngoài', async () => {
    const t = await on();
    const m = src([crit('a')]);
    upd(t.sound, m);
    t.sound.mute();
    expect(t.sound.playing).toBe('none');
    expect(t.sound.muted).toBe(true);
    upd(t.sound, m);
    expect(t.sound.playing).toBe('none');
    expect(m.snapshot().instances[0]!.state).toBe('ACTIVE_UNACK'); // vẫn chưa xác nhận
  });
  it('alarm mới (id mới) bật tiếng lại; lần xảy ra mới của cùng id cũng vậy', async () => {
    const t = await on();
    const m = src([crit('a', { occurrence: 1 })]);
    upd(t.sound, m);
    t.sound.mute();
    m.upsert(crit('b'));
    upd(t.sound, m);
    expect(t.sound.playing).toBe('siren');
    t.sound.mute();
    expect(t.sound.playing).toBe('none');
    m.upsert(crit('a', { occurrence: 2 }));
    upd(t.sound, m);
    expect(t.sound.playing).toBe('siren');
  });
  it('mute không ảnh hưởng tùy chọn bật; không lưu nhớ qua tải lại', async () => {
    const t = await on();
    upd(t.sound, src([crit('a')]));
    t.sound.mute();
    expect(t.sound.state).toBe('on');
    expect(t.store.getItem(SOUND_STORAGE_KEY)).toBe('on');
    const t2 = setup({ stored: 'on' });
    expect(t2.sound.muted).toBe(false);
  });
  it('khi hết alarm, trạng thái tắt tiếng được dọn (alarm sau đó lại có tiếng)', async () => {
    const t = await on();
    const m = src([crit('a', { occurrence: 1 })]);
    upd(t.sound, m);
    t.sound.mute();
    m.set([]);
    upd(t.sound, m);
    m.set([crit('a', { occurrence: 3 })]);
    upd(t.sound, m);
    expect(t.sound.playing).toBe('siren');
  });
});

describe('tắt công tắc', () => {
  it('toggle tắt khi đang phát: dừng ngay', async () => {
    const t = setup();
    await t.sound.toggle();
    upd(t.sound, src([crit('a')]));
    expect(t.sound.playing).toBe('siren');
    await t.sound.toggle();
    expect(t.sound.playing).toBe('none');
    expect(t.sound.state).toBe('off');
  });
});
