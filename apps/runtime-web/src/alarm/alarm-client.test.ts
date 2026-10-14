// Kho trạng thái alarm của trang (feature 009, FR-063, FR-066; US1 kịch bản 10, 11; contracts/ui-alarm.md §2, live-protocol-1.3.md §4.1, §6).
import {
  LiveConnection,
  type AlarmDeltaMsg,
  type ConnState,
  type AlarmSnapshotMsg,
  type LiveAlarmInstance,
  type SocketLike,
} from '@mat/live-client';
import { describe, expect, it } from 'vitest';
import { LiveAlarmSource } from './alarm-client.ts';

const counts = (unack = 0) => ({
  active: unack,
  unack,
  rtnUnack: 0,
  shelved: 0,
  disabled: 0,
  byPriority: {
    critical: { active: unack, unack },
    major: { active: 0, unack: 0 },
    minor: { active: 0, unack: 0 },
    advisory: { active: 0, unack: 0 },
  },
});

const inst = (id: string, over: Partial<LiveAlarmInstance> = {}): LiveAlarmInstance => ({
  id,
  alarmId: id,
  name: id,
  type: 'digital',
  occurrence: 1,
  rev: 1,
  state: 'ACTIVE_UNACK',
  class: 'critical',
  priority: 'critical',
  area: null,
  text: `t ${id}`,
  valueActive: true,
  qualityActive: 'GOOD',
  tsActive: 1000,
  clockOk: true,
  disabled: false,
  inputBad: false,
  startup: false,
  ...over,
});

const snap = (
  instances: LiveAlarmInstance[],
  over: Partial<AlarmSnapshotMsg> = {},
): AlarmSnapshotMsg => ({
  subscriptionId: 'a1',
  sequence: 1,
  ts: 5000,
  revision: 10,
  instances,
  classes: [
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
  ],
  areas: [{ id: 'bon', name: 'Bồn' }],
  counts: counts(instances.length),
  ...over,
});
const delta = (
  changed: LiveAlarmInstance[],
  removed: string[] = [],
  over: Partial<AlarmDeltaMsg> = {},
): AlarmDeltaMsg => ({
  subscriptionId: 'a1',
  sequence: 2,
  ts: 6000,
  revision: 11,
  changed,
  removed,
  counts: counts(changed.length),
  ...over,
});

const mk = (now = 1234) => new LiveAlarmSource({ now: () => now });
const tick = () => Promise.resolve();

describe('LiveAlarmSource: trạng thái nguồn (§2)', () => {
  it('ban đầu: offline, snapshot rỗng và là cùng một đối tượng', () => {
    const s = mk();
    expect(s.status()).toBe('offline');
    expect(s.snapshot().instances).toEqual([]);
    expect(s.snapshot()).toBe(s.snapshot());
    expect(s.counts().unack).toBe(0);
    expect(s.now()).toBe(1234);
  });
  it('support none: none; unsupported: unsupported, kể cả khi mất kết nối', () => {
    const a = mk();
    a.setSupport('none');
    expect(a.status()).toBe('none');
    a.setConnected(false);
    expect(a.status()).toBe('none');
    const b = mk();
    b.setSupport('unsupported');
    b.setConnected(true);
    expect(b.status()).toBe('unsupported');
  });
  it('supported: offline tới snapshot đầu, live sau đó, stale khi mất kết nối', () => {
    const s = mk();
    s.setSupport('supported');
    s.setConnected(true);
    expect(s.status()).toBe('offline');
    s.applySnapshot(snap([inst('A')]));
    expect(s.status()).toBe('live');
    s.setConnected(false);
    expect(s.status()).toBe('stale');
    expect(s.snapshot().instances).toHaveLength(1);
  });
  it('mất kết nối trước snapshot đầu: vẫn offline (chưa có dữ liệu cũ)', () => {
    const s = mk();
    s.setSupport('supported');
    s.setConnected(false);
    expect(s.status()).toBe('offline');
  });
  it('kết nối lại: snapshot mới THAY HOÀN TOÀN trạng thái cũ (US1 kịch bản 10)', () => {
    const s = mk();
    s.setSupport('supported');
    s.setConnected(true);
    s.applySnapshot(snap([inst('A'), inst('B')]));
    s.setConnected(false);
    s.setConnected(true);
    expect(s.status()).toBe('stale'); // chưa có snapshot mới
    s.applySnapshot(snap([inst('C')], { sequence: 7, subscriptionId: 'a2', revision: 40 }));
    expect(s.status()).toBe('live');
    expect(s.snapshot().instances.map((i) => i.id)).toEqual(['C']);
    expect(s.snapshot().revision).toBe(40);
  });
  it('resync: stale tới khi có snapshot mới, giữ hàng cũ trong lúc chờ', () => {
    const s = mk();
    s.setSupport('supported');
    s.setConnected(true);
    s.applySnapshot(snap([inst('A')]));
    s.markResync();
    expect(s.status()).toBe('stale');
    expect(s.snapshot().instances).toHaveLength(1);
    s.applySnapshot(snap([inst('A2')], { sequence: 3 }));
    expect(s.status()).toBe('live');
  });
});

describe('LiveAlarmSource: snapshot và delta', () => {
  const live = () => {
    const s = mk();
    s.setSupport('supported');
    s.setConnected(true);
    return s;
  };
  it('snapshot: instance, lớp, khu vực, số đếm, revision', () => {
    const s = live();
    s.applySnapshot(snap([inst('A'), inst('B', { priority: 'major' })]));
    const v = s.snapshot();
    expect(v.instances.map((i) => i.id).sort()).toEqual(['A', 'B']);
    expect(v.classes[0]!.id).toBe('critical');
    expect(v.areas).toEqual([{ id: 'bon', name: 'Bồn' }]);
    expect(v.revision).toBe(10);
    expect(s.classes()).toBe(v.classes);
    expect(s.areas()).toBe(v.areas);
    expect(s.counts()).toBe(v.counts);
  });
  it('delta: thay theo id (không nhân đôi), xóa removed, lấy counts và revision của bản tin', () => {
    const s = live();
    s.applySnapshot(snap([inst('A'), inst('B')]));
    s.applyDelta(
      delta([inst('A', { state: 'ACTIVE_ACK', ackUser: 'u' }), inst('C')], ['B'], {
        counts: counts(7),
        revision: 22,
      }),
    );
    const v = s.snapshot();
    expect(v.instances.map((i) => i.id).sort()).toEqual(['A', 'C']);
    expect(v.instances.find((i) => i.id === 'A')!.state).toBe('ACTIVE_ACK');
    expect(v.counts.unack).toBe(7); // không tự cộng dồn
    expect(v.revision).toBe(22);
  });
  it('mỗi thay đổi tạo bản chụp mới (so ===); không đổi thì giữ nguyên', () => {
    const s = live();
    s.applySnapshot(snap([inst('A')]));
    const a = s.snapshot();
    expect(s.snapshot()).toBe(a);
    s.applyDelta(delta([inst('A', { rev: 2 })]));
    expect(s.snapshot()).not.toBe(a);
  });
  it('instance không đổi giữ nguyên đối tượng (bảng so theo đối tượng)', () => {
    const s = live();
    s.applySnapshot(snap([inst('A'), inst('B')]));
    const before = s.snapshot().instances.find((i) => i.id === 'B');
    s.applyDelta(delta([inst('A', { rev: 3 })]));
    expect(s.snapshot().instances.find((i) => i.id === 'B')).toBe(before);
  });
  it('xóa id không có: không báo thay đổi', async () => {
    const s = live();
    s.applySnapshot(snap([inst('A')]));
    await tick();
    const seen: unknown[] = [];
    s.subscribe((c) => seen.push(c));
    s.applyDelta(delta([], ['KHÔNG-CÓ'], { counts: counts(1) }));
    await tick();
    expect(seen).toEqual([]);
  });
});

describe('LiveAlarmSource: thông báo (subscribe)', () => {
  const setup = () => {
    const s = mk();
    s.setSupport('supported');
    s.setConnected(true);
    const seen: Array<readonly string[] | 'all'> = [];
    s.subscribe((c) => seen.push(c));
    return { s, seen };
  };
  it("snapshot mới báo 'all'", async () => {
    const { s, seen } = setup();
    s.applySnapshot(snap([inst('A')]));
    await tick();
    expect(seen).toEqual(['all']);
  });
  it('delta báo đúng id đổi và id bị xóa, gộp một lần ở cuối microtask', async () => {
    const { s, seen } = setup();
    s.applySnapshot(snap([inst('A'), inst('B')]));
    await tick();
    seen.length = 0;
    s.applyDelta(delta([inst('A', { rev: 2 })], ['B']));
    s.applyDelta(delta([inst('C')], [], { sequence: 3 }));
    expect(seen).toEqual([]);
    await tick();
    expect(seen).toHaveLength(1);
    expect([...(seen[0] as string[])].sort()).toEqual(['A', 'B', 'C']);
  });
  it("đổi trạng thái nguồn báo 'all'", async () => {
    const { s, seen } = setup();
    s.applySnapshot(snap([inst('A')]));
    await tick();
    seen.length = 0;
    s.setConnected(false);
    await tick();
    expect(seen).toEqual(['all']);
  });
  it('hàm hủy ngừng báo; người nghe ném lỗi không làm hỏng nguồn', async () => {
    const s = mk();
    const calls: number[] = [];
    const off = s.subscribe(() => calls.push(1));
    s.subscribe(() => {
      throw new Error('x');
    });
    s.setSupport('none');
    await tick();
    expect(calls).toHaveLength(1);
    off();
    s.setSupport('supported');
    await tick();
    expect(calls).toHaveLength(1);
  });
});

describe('LiveAlarmSource: nối với LiveConnection (live 1.3.0)', () => {
  class FakeSocket implements SocketLike {
    sent: Array<Record<string, unknown>> = [];
    onopen: (() => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: ((ev: { code: number }) => void) | null = null;
    send(d: string) {
      this.sent.push(JSON.parse(d) as Record<string, unknown>);
    }
    close() {}
    msg(m: object) {
      this.onmessage?.({ data: JSON.stringify(m) });
    }
  }
  const setup = () => {
    const sockets: FakeSocket[] = [];
    const states: Array<(s: ConnState) => void> = [];
    const conn = new LiveConnection({
      url: 'ws://x/api/v1/live',
      tags: ['A'],
      createSocket: () => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      setTimer: () => 0,
      clearTimer: () => undefined,
      random: () => 1,
    });
    conn.onState = (st) => states.forEach((f) => f(st));
    const src = new LiveAlarmSource({
      conn,
      onState: (f) => {
        states.push(f);
        return () => undefined;
      },
    });
    src.start();
    conn.start();
    const sock = () => sockets.at(-1)!;
    sock().onopen?.();
    return { conn, src, sock, sockets };
  };
  it('hello 1.3.0 có alarms: gửi subscribeAlarms; snapshot → live; đóng → stale', () => {
    const { src, sock } = setup();
    sock().msg({
      type: 'hello',
      protocolVersion: '1.3.0',
      serverVersion: '0.8.0',
      maxClients: 10,
      features: ['alarms'],
    });
    const sub = sock().sent.find((m) => m.type === 'subscribeAlarms') as { requestId: string };
    expect(sub).toBeDefined();
    expect(src.status()).toBe('offline');
    sock().msg({
      type: 'alarmSnapshot',
      subscriptionId: sub.requestId,
      sequence: 1,
      ts: 1,
      revision: 3,
      instances: [inst('A')],
      classes: [],
      areas: [],
      counts: counts(1),
    });
    expect(src.status()).toBe('live');
    expect(src.snapshot().instances).toHaveLength(1);
    sock().onclose?.({ code: 1006 });
    expect(src.status()).toBe('stale');
  });
  it('hello 1.2.0: unsupported, không gửi subscribeAlarms', () => {
    const { src, sock } = setup();
    sock().msg({ type: 'hello', protocolVersion: '1.2.0', serverVersion: '0.6.0', maxClients: 10 });
    expect(src.status()).toBe('unsupported');
    expect(sock().sent.some((m) => m.type === 'subscribeAlarms')).toBe(false);
  });
  it('hello 1.3.0 không features: none', () => {
    const { src, sock } = setup();
    sock().msg({ type: 'hello', protocolVersion: '1.3.0', serverVersion: '0.8.0', maxClients: 10 });
    expect(src.status()).toBe('none');
  });
  it('sequence đứt: stale rồi snapshot mới đưa về live', () => {
    const { src, sock } = setup();
    sock().msg({
      type: 'hello',
      protocolVersion: '1.3.0',
      serverVersion: '0.8.0',
      maxClients: 10,
      features: ['alarms'],
    });
    const sub = (sock().sent.find((m) => m.type === 'subscribeAlarms') as { requestId: string })
      .requestId;
    const base = { ts: 1, revision: 1, counts: counts(0), classes: [], areas: [] };
    sock().msg({
      type: 'alarmSnapshot',
      subscriptionId: sub,
      sequence: 1,
      instances: [inst('A')],
      ...base,
    });
    sock().msg({
      type: 'alarmDelta',
      subscriptionId: sub,
      sequence: 5,
      changed: [],
      removed: [],
      ...base,
    });
    expect(src.status()).toBe('stale');
    const sub2 = (
      sock()
        .sent.filter((m) => m.type === 'subscribeAlarms')
        .at(-1) as { requestId: string }
    ).requestId;
    expect(sub2).not.toBe(sub);
    sock().msg({
      type: 'alarmSnapshot',
      subscriptionId: sub2,
      sequence: 8,
      instances: [inst('Z')],
      ...base,
    });
    expect(src.status()).toBe('live');
    expect(src.snapshot().instances.map((i) => i.id)).toEqual(['Z']);
  });
});
