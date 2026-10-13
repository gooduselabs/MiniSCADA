// Phần alarm của giao thức live 1.3.0 (feature 009, FR-063; specs/009-alarms/contracts/live-protocol-1.3.md §2 đến §9):
// subscribeAlarms, alarmSnapshot (kể cả chia mảnh), alarmDelta, sequence đứt, kết nối lại, thiết bị cũ.
import { describe, expect, it } from 'vitest';
import {
  ALARM_PART_TIMEOUT_MS,
  alarmSupportOf,
  parseAlarmInstance,
  type AlarmDeltaMsg,
  type AlarmSnapshotMsg,
  type AlarmSupport,
} from './alarms.ts';
import { LiveConnection, type SocketLike } from './connection.ts';

class FakeSocket implements SocketLike {
  sent: Array<Record<string, unknown>> = [];
  closed: { code?: number } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number) {
    this.closed = { code };
  }
  open() {
    this.onopen?.();
  }
  msg(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  serverClose(code: number) {
    this.onclose?.({ code });
  }
}

class Clock {
  t = 0;
  timers: Array<{ at: number; fn: () => void; id: number }> = [];
  private seq = 0;
  set = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clear = (id: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== id);
  };
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }
}

const counts = (over: Record<string, unknown> = {}) => ({
  active: 1,
  unack: 1,
  rtnUnack: 0,
  shelved: 0,
  disabled: 0,
  byPriority: {
    critical: { active: 1, unack: 1 },
    major: { active: 0, unack: 0 },
    minor: { active: 0, unack: 0 },
    advisory: { active: 0, unack: 0 },
  },
  ...over,
});
const rawInst = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  alarmId: id.split('.')[0],
  name: `Tên ${id}`,
  type: 'digital',
  occurrence: 5,
  rev: 10,
  state: 'ACTIVE_UNACK',
  class: 'critical',
  priority: 'critical',
  area: null,
  text: `Nội dung ${id}`,
  valueActive: true,
  qualityActive: 'GOOD',
  tsActive: 1000,
  clockOk: true,
  inputBad: false,
  startup: false,
  disabled: false,
  ...over,
});
const classes = [
  {
    id: 'critical',
    name: 'Khẩn cấp',
    priority: 'critical',
    color: 'red',
    blink: true,
    requiresAck: true,
    ackReturn: false,
    sound: 'siren',
    chatterLimit: 5,
  },
];
const snapMsg = (sub: string, seq: number, instances: unknown[], extra: object = {}) => ({
  type: 'alarmSnapshot',
  subscriptionId: sub,
  sequence: seq,
  ts: 5000,
  revision: 77,
  instances,
  classes,
  areas: [{ id: 'bon', name: 'Bồn' }],
  counts: counts(),
  ...extra,
});

function setup(tags: string[] = ['A'], wantAlarms = true) {
  const clock = new Clock();
  const sockets: FakeSocket[] = [];
  const support: AlarmSupport[] = [];
  const snaps: AlarmSnapshotMsg[] = [];
  const deltas: AlarmDeltaMsg[] = [];
  let resyncs = 0;
  const conn = new LiveConnection({
    url: 'ws://dev/api/v1/live',
    tags,
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    now: () => clock.t,
    random: () => 1,
    setTimer: clock.set,
    clearTimer: clock.clear,
  });
  conn.onAlarmSupport = (s) => support.push(s);
  conn.onAlarmSnapshot = (s) => snaps.push(s);
  conn.onAlarmDelta = (d) => deltas.push(d);
  conn.onAlarmResync = () => resyncs++;
  if (wantAlarms) conn.subscribeAlarms();
  const last = () => sockets[sockets.length - 1]!;
  const hello = (v = '1.3.0', features?: unknown) =>
    last().msg({
      type: 'hello',
      protocolVersion: v,
      serverVersion: '0.8.0',
      maxClients: 10,
      ...(features === undefined ? {} : { features }),
    });
  const alarmSubs = () =>
    last().sent.filter((m) => m.type === 'subscribeAlarms') as Array<{ requestId: string }>;
  const sub = () => alarmSubs().at(-1)!.requestId;
  const start = () => {
    conn.start();
    last().open();
  };
  return {
    clock,
    sockets,
    support,
    snaps,
    deltas,
    conn,
    last,
    hello,
    alarmSubs,
    sub,
    start,
    resyncs: () => resyncs,
  };
}

describe('alarmSupportOf (live-protocol-1.3.md §9)', () => {
  const hi = (protocolVersion: string, features?: string[]) => ({
    protocolVersion,
    serverVersion: '',
    maxClients: 10,
    heartbeatMs: 0,
    timeoutMs: 0,
    project: null,
    ...(features ? { features } : {}),
  });
  it('< 1.3.0: unsupported', () => {
    expect(alarmSupportOf(hi('1.2.0'))).toBe('unsupported');
    expect(alarmSupportOf(hi('1.0.0', ['alarms']))).toBe('unsupported');
    expect(alarmSupportOf(hi('1.2.9'))).toBe('unsupported');
  });
  it('≥ 1.3.0 không có features.alarms: none', () => {
    expect(alarmSupportOf(hi('1.3.0'))).toBe('none');
    expect(alarmSupportOf(hi('1.3.0', []))).toBe('none');
    expect(alarmSupportOf(hi('1.3.0', ['gì-đó']))).toBe('none');
  });
  it('≥ 1.3.0 có features.alarms: supported (kể cả MINOR cao hơn)', () => {
    expect(alarmSupportOf(hi('1.3.0', ['alarms']))).toBe('supported');
    expect(alarmSupportOf(hi('1.4.1', ['x', 'alarms']))).toBe('supported');
  });
  it('MAJOR khác 1: unsupported', () => {
    expect(alarmSupportOf(hi('2.0.0', ['alarms']))).toBe('unsupported');
  });
});

describe('subscribeAlarms', () => {
  it('gửi sau hello khi có features.alarms; không gửi trước hello', () => {
    const h = setup();
    h.start();
    expect(h.alarmSubs()).toHaveLength(0);
    h.hello('1.3.0', ['alarms']);
    expect(h.alarmSubs()).toHaveLength(1);
    expect(typeof h.sub()).toBe('string');
    expect(h.sub().length).toBeLessThanOrEqual(64);
    expect(h.support).toEqual(['supported']);
  });
  it('không cần có Tag: danh sách Tag rỗng vẫn đăng ký alarm', () => {
    const h = setup([]);
    h.start();
    h.hello('1.3.0', ['alarms']);
    expect(h.alarmSubs()).toHaveLength(1);
    expect(h.last().sent.some((m) => m.type === 'subscribe')).toBe(false);
  });
  it('thiết bị 1.2.0: unsupported, KHÔNG gửi subscribeAlarms', () => {
    const h = setup();
    h.start();
    h.hello('1.2.0');
    expect(h.alarmSubs()).toHaveLength(0);
    expect(h.support).toEqual(['unsupported']);
    expect(h.conn.alarmSupport).toBe('unsupported');
  });
  it('1.3.0 không có features: none, không gửi', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0');
    expect(h.alarmSubs()).toHaveLength(0);
    expect(h.support).toEqual(['none']);
  });
  it('giá trị lạ trong features bị bỏ qua; features sai kiểu không làm hỏng', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['tương-lai', 5, null, 'alarms']);
    expect(h.alarmSubs()).toHaveLength(1);
    const h2 = setup();
    h2.start();
    h2.hello('1.3.0', 'alarms');
    expect(h2.alarmSubs()).toHaveLength(0);
    expect(h2.support).toEqual(['none']);
  });
  it('không đăng ký khi chưa yêu cầu; yêu cầu muộn gửi ngay', () => {
    const h = setup(['A'], false);
    h.start();
    h.hello('1.3.0', ['alarms']);
    expect(h.alarmSubs()).toHaveLength(0);
    h.conn.subscribeAlarms();
    expect(h.alarmSubs()).toHaveLength(1);
    h.conn.subscribeAlarms(); // lặp: không gửi lại
    expect(h.alarmSubs()).toHaveLength(1);
  });
  it('unsubscribeAlarms gửi bản tin và bỏ mọi alarmDelta sau đó', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    const sub = h.sub();
    h.last().msg(snapMsg(sub, 1, [rawInst('A')]));
    h.conn.unsubscribeAlarms();
    expect(h.last().sent.at(-1)).toEqual({ type: 'unsubscribeAlarms' });
    h.last().msg({
      type: 'alarmDelta',
      subscriptionId: sub,
      sequence: 2,
      ts: 1,
      revision: 1,
      changed: [rawInst('B')],
      removed: [],
      counts: counts(),
    });
    expect(h.deltas).toHaveLength(0);
  });
});

describe('alarmSnapshot', () => {
  it('đọc đủ instance, lớp, khu vực, số đếm, revision, ts', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    h.last().msg(
      snapMsg(h.sub(), 1, [
        rawInst('TANK.HH', { type: 'limit', limit: 'HH', area: 'bon', valueActive: 91.2 }),
        rawInst('P1', {
          state: 'ACTIVE_ACK',
          tsAck: 2000,
          ackUser: 'vanhanh1',
          shelved: { until: 9, remainingMs: 8, reason: 'r', user: 'u', system: false },
        }),
      ]),
    );
    expect(h.snaps).toHaveLength(1);
    const s = h.snaps[0]!;
    expect(s.sequence).toBe(1);
    expect(s.revision).toBe(77);
    expect(s.ts).toBe(5000);
    expect(s.instances.map((i) => i.id)).toEqual(['TANK.HH', 'P1']);
    expect(s.instances[0]).toMatchObject({ limit: 'HH', area: 'bon', valueActive: 91.2 });
    expect(s.instances[1]).toMatchObject({ ackUser: 'vanhanh1', tsAck: 2000 });
    expect(s.instances[1]!.shelved).toEqual({
      until: 9,
      remainingMs: 8,
      reason: 'r',
      user: 'u',
      system: false,
    });
    expect(s.classes[0]).toMatchObject({
      id: 'critical',
      color: 'red',
      sound: 'siren',
      blink: true,
    });
    expect(s.areas).toEqual([{ id: 'bon', name: 'Bồn' }]);
    expect(s.counts.unack).toBe(1);
    expect(s.counts.byPriority.critical).toEqual({ active: 1, unack: 1 });
  });
  it('snapshot rỗng của project không có alarm', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    h.last().msg(
      snapMsg(h.sub(), 1, [], {
        classes: [],
        areas: [],
        revision: 0,
        counts: counts({ active: 0, unack: 0 }),
      }),
    );
    expect(h.snaps[0]!.instances).toEqual([]);
    expect(h.snaps[0]!.revision).toBe(0);
  });
  it('bỏ bản tin của đăng ký khác (subscriptionId cũ)', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    h.last().msg(snapMsg('khác', 1, [rawInst('A')]));
    expect(h.snaps).toHaveLength(0);
  });
  it('instance hỏng (thiếu id, state lạ) bị bỏ, phần còn lại vẫn nhận', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    h.last().msg(
      snapMsg(h.sub(), 1, [
        rawInst('OK'),
        { ...rawInst('X'), state: 'LẠ' },
        { name: 'không id' },
        5,
        null,
      ]),
    );
    expect(h.snaps[0]!.instances.map((i) => i.id)).toEqual(['OK']);
  });
  it('chia mảnh: chỉ áp khi đủ parts cùng sequence', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    const sub = h.sub();
    h.last().msg(snapMsg(sub, 3, [rawInst('A'), rawInst('B')], { part: 1, parts: 3 }));
    h.last().msg(
      snapMsg(sub, 3, [rawInst('C')], { part: 3, parts: 3, counts: counts({ active: 3 }) }),
    );
    expect(h.snaps).toHaveLength(0);
    h.last().msg(
      snapMsg(sub, 3, [rawInst('D')], { part: 2, parts: 3, counts: counts({ active: 3 }) }),
    );
    expect(h.snaps).toHaveLength(1);
    expect(h.snaps[0]!.instances.map((i) => i.id).sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(h.snaps[0]!.sequence).toBe(3);
    expect(h.snaps[0]!.counts.active).toBe(3);
  });
  it('mảnh trùng không tính hai lần; mảnh của sequence mới thay bộ đệm cũ', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    const sub = h.sub();
    h.last().msg(snapMsg(sub, 3, [rawInst('A')], { part: 1, parts: 2 }));
    h.last().msg(snapMsg(sub, 3, [rawInst('A')], { part: 1, parts: 2 }));
    expect(h.snaps).toHaveLength(0);
    h.last().msg(snapMsg(sub, 4, [rawInst('N1')], { part: 1, parts: 2 }));
    h.last().msg(snapMsg(sub, 4, [rawInst('N2')], { part: 2, parts: 2 }));
    expect(h.snaps).toHaveLength(1);
    expect(h.snaps[0]!.instances.map((i) => i.id)).toEqual(['N1', 'N2']);
  });
  it('thiếu mảnh quá 10 s: gửi lại subscribeAlarms với requestId mới', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    const first = h.sub();
    h.last().msg(snapMsg(first, 3, [rawInst('A')], { part: 1, parts: 2 }));
    h.clock.advance(ALARM_PART_TIMEOUT_MS - 1);
    expect(h.alarmSubs()).toHaveLength(1);
    h.clock.advance(2);
    expect(h.alarmSubs()).toHaveLength(2);
    expect(h.sub()).not.toBe(first);
    expect(h.resyncs()).toBe(1);
  });
});

describe('alarmDelta', () => {
  const ready = () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    const sub = h.sub();
    h.last().msg(snapMsg(sub, 1, [rawInst('A'), rawInst('B')]));
    const delta = (seq: number, over: object = {}) =>
      h.last().msg({
        type: 'alarmDelta',
        subscriptionId: sub,
        sequence: seq,
        ts: 6000 + seq,
        revision: 100 + seq,
        changed: [],
        removed: [],
        counts: counts(),
        ...over,
      });
    return { h, sub, delta };
  };
  it('áp changed, removed, counts, revision theo sequence + 1', () => {
    const { h, delta } = ready();
    delta(2, {
      changed: [rawInst('A', { state: 'ACTIVE_ACK', ackUser: 'u' })],
      removed: ['B'],
      counts: counts({ unack: 0 }),
    });
    expect(h.deltas).toHaveLength(1);
    const d = h.deltas[0]!;
    expect(d.changed.map((i) => [i.id, i.state])).toEqual([['A', 'ACTIVE_ACK']]);
    expect(d.removed).toEqual(['B']);
    expect(d.counts.unack).toBe(0);
    expect(d.revision).toBe(102);
    expect(d.sequence).toBe(2);
    delta(3, { changed: [rawInst('C')] });
    expect(h.deltas).toHaveLength(2);
  });
  it('sequence đứt: bỏ bản tin, xin lại snapshot bằng requestId mới, báo resync', () => {
    const { h, sub, delta } = ready();
    delta(2);
    delta(4, { changed: [rawInst('Z')] });
    expect(h.deltas).toHaveLength(1);
    expect(h.alarmSubs()).toHaveLength(2);
    expect(h.sub()).not.toBe(sub);
    expect(h.resyncs()).toBe(1);
    // delta của đăng ký cũ tiếp tục bị bỏ
    delta(5);
    expect(h.deltas).toHaveLength(1);
    // snapshot mới thay hoàn toàn; delta kế tiếp theo sequence của nó
    h.last().msg(snapMsg(h.sub(), 9, [rawInst('N')]));
    expect(h.snaps).toHaveLength(2);
    h.last().msg({
      type: 'alarmDelta',
      subscriptionId: h.sub(),
      sequence: 10,
      ts: 1,
      revision: 1,
      changed: [],
      removed: ['N'],
      counts: counts(),
    });
    expect(h.deltas).toHaveLength(2);
  });
  it('delta tới trước snapshot: bỏ, không phải sequence đứt', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    h.last().msg({
      type: 'alarmDelta',
      subscriptionId: h.sub(),
      sequence: 5,
      ts: 1,
      revision: 1,
      changed: [],
      removed: [],
      counts: counts(),
    });
    expect(h.deltas).toHaveLength(0);
    expect(h.alarmSubs()).toHaveLength(1);
  });
  it('removed không phải mảng chuỗi: bỏ phần tử sai', () => {
    const { h, delta } = ready();
    delta(2, { removed: ['B', 5, null, 'C'] });
    expect(h.deltas[0]!.removed).toEqual(['B', 'C']);
  });
  it('sequence của alarm độc lập với sequence của Tag', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    const tagSub = (h.last().sent.find((m) => m.type === 'subscribe') as { requestId: string })
      .requestId;
    h.last().msg({
      type: 'snapshot',
      subscriptionId: tagSub,
      sequence: 40,
      tags: [{ id: 'A', value: 1, quality: 'GOOD' }],
      unknown: [],
    });
    h.last().msg(snapMsg(h.sub(), 1, [rawInst('A')]));
    h.last().msg({
      type: 'delta',
      subscriptionId: tagSub,
      sequence: 41,
      ts: 1,
      tags: [[0, 2, 'GOOD']],
    });
    h.last().msg({
      type: 'alarmDelta',
      subscriptionId: h.sub(),
      sequence: 2,
      ts: 1,
      revision: 5,
      changed: [],
      removed: [],
      counts: counts(),
    });
    expect(h.deltas).toHaveLength(1);
    expect(h.conn.state).toBe('live');
    expect(h.conn.live.seqGaps).toBe(0);
  });
});

describe('mất kết nối và kết nối lại', () => {
  it('kết nối lại tự đăng ký lại alarm bằng requestId mới; snapshot cũ bị bỏ', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    const first = h.sub();
    h.last().msg(snapMsg(first, 1, [rawInst('A')]));
    h.last().serverClose(1006);
    h.clock.advance(60_000);
    expect(h.sockets).toHaveLength(2);
    h.last().open();
    expect(h.alarmSubs()).toHaveLength(0);
    h.hello('1.3.0', ['alarms']);
    expect(h.alarmSubs()).toHaveLength(1);
    expect(h.sub()).not.toBe(first);
    h.last().msg(snapMsg(first, 7, [rawInst('CŨ')]));
    expect(h.snaps).toHaveLength(1);
    h.last().msg(snapMsg(h.sub(), 8, [rawInst('MỚI')]));
    expect(h.snaps).toHaveLength(2);
    expect(h.snaps[1]!.instances.map((i) => i.id)).toEqual(['MỚI']);
  });
  it('đóng 1012 (đổi project): hello mới đổi features thì cập nhật hỗ trợ', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    h.last().serverClose(1012);
    h.clock.advance(3000);
    h.last().open();
    h.hello('1.3.0');
    expect(h.support).toEqual(['supported', 'none']);
    expect(h.alarmSubs()).toHaveLength(0);
  });
  it('mất kết nối: bộ đệm mảnh bị bỏ', () => {
    const h = setup();
    h.start();
    h.hello('1.3.0', ['alarms']);
    h.last().msg(snapMsg(h.sub(), 3, [rawInst('A')], { part: 1, parts: 2 }));
    h.last().serverClose(1006);
    h.clock.advance(60_000);
    h.last().open();
    h.hello('1.3.0', ['alarms']);
    h.last().msg(snapMsg(h.sub(), 3, [rawInst('B')], { part: 2, parts: 2 }));
    expect(h.snaps).toHaveLength(0);
  });
});

describe('parseAlarmInstance', () => {
  it('bỏ trường lạ, ép kiểu an toàn, giữ chữ thô nguyên văn', () => {
    const i = parseAlarmInstance(
      rawInst('A', { text: '<script>x</script>', extra: 1, valueActive: { a: 1 } }),
    )!;
    expect(i.text).toBe('<script>x</script>');
    expect(i.valueActive).toBeNull();
    expect('extra' in i).toBe(false);
  });
  it('shelved sai kiểu bị bỏ', () => {
    expect(parseAlarmInstance(rawInst('A', { shelved: 'x' }))!.shelved).toBeUndefined();
  });
  it('area chuỗi rỗng hoặc sai kiểu thành null', () => {
    expect(parseAlarmInstance(rawInst('A', { area: 5 }))!.area).toBeNull();
  });
  it('id không hợp lệ: null', () => {
    expect(parseAlarmInstance({ ...rawInst('A'), id: '' })).toBeNull();
    expect(parseAlarmInstance(undefined)).toBeNull();
  });
});
