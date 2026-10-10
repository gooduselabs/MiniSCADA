// LiveConnection với WebSocket và timer giả (contracts/live-ws.md: mã đóng, backoff, 4429, STALE).
import { describe, expect, it } from 'vitest';
import { LiveConnection, backoffDelay, type SocketLike } from './connection.ts';
import type { TagChange } from './state.ts';

class FakeSocket implements SocketLike {
  sent: unknown[] = [];
  closed: { code?: number } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number) {
    this.closed = { code };
  }
  // helpers
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

function setup(random = () => 1) {
  const clock = new Clock();
  const sockets: FakeSocket[] = [];
  const changes: TagChange[][] = [];
  const states: string[] = [];
  const conn = new LiveConnection({
    url: 'ws://dev/api/v1/live',
    tags: ['A', 'B'],
    createSocket: (u) => {
      const s = new FakeSocket(u);
      sockets.push(s);
      return s;
    },
    now: () => clock.t,
    random,
    setTimer: clock.set,
    clearTimer: clock.clear,
  });
  conn.onChange = (c) => changes.push(c);
  conn.onState = (s) => states.push(s);
  const last = () => sockets[sockets.length - 1];
  const hello = (v = '1.0.0') =>
    last().msg({ type: 'hello', protocolVersion: v, serverVersion: '0.2.0', maxClients: 10 });
  const snap = (seq = 1) => {
    const sub = (last().sent.at(-1) as { requestId: string }).requestId;
    last().msg({
      type: 'snapshot',
      subscriptionId: sub,
      sequence: seq,
      tags: [
        { id: 'A', value: 1, quality: 'GOOD' },
        { id: 'B', value: true, quality: 'GOOD' },
      ],
      unknown: [],
    });
    return sub;
  };
  return { clock, sockets, changes, states, conn, last, hello, snap };
}

describe('LiveConnection — kết nối cơ bản (US1)', () => {
  it('subscribe danh sách Tag khi mở, nhận snapshot thì vào trạng thái live', () => {
    const h = setup();
    h.conn.start();
    expect(h.conn.state).toBe('connecting');
    expect(h.last().url).toBe('ws://dev/api/v1/live');
    h.last().open();
    expect(h.last().sent[0]).toMatchObject({ type: 'subscribe', tags: ['A', 'B'], mode: 'delta' });
    h.hello();
    h.snap();
    expect(h.conn.state).toBe('live');
    expect(h.changes.at(-1)).toEqual([
      { id: 'A', value: 1, quality: 'GOOD' },
      { id: 'B', value: true, quality: 'GOOD' },
    ]);
  });

  it('trả lời heartbeat', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.clock.t = 777;
    h.last().msg({ type: 'heartbeat', ts: 1 });
    expect(h.last().sent.at(-1)).toEqual({ type: 'heartbeat', ts: 777 });
  });

  it('stop() đóng socket, không kết nối lại', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.conn.stop();
    expect(h.last().closed).not.toBeNull();
    h.last().serverClose(1000);
    h.clock.advance(60000);
    expect(h.sockets.length).toBe(1);
    expect(h.conn.state).toBe('stopped');
  });
});

describe('LiveConnection — đầy 10 phiên (US2)', () => {
  it('4429: trạng thái full, đếm ngược 30 s rồi thử lại (không dùng backoff)', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.last().msg({ type: 'error', code: 'MAX_CLIENTS_REACHED', message: 'full' });
    h.last().serverClose(4429);
    expect(h.conn.state).toBe('full');
    expect(h.conn.retryAt).toBe(30000);
    h.clock.advance(29999);
    expect(h.sockets.length).toBe(1);
    h.clock.advance(1);
    expect(h.sockets.length).toBe(2);
    expect(h.conn.state).toBe('connecting');
  });

  it('error MAX_CLIENTS_REACHED kèm mã đóng khác vẫn là full', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.last().msg({ type: 'error', code: 'MAX_CLIENTS_REACHED', message: 'full' });
    h.last().serverClose(1006);
    expect(h.conn.state).toBe('full');
  });

  it('retryNow() thử lại ngay; vẫn đầy thì đếm ngược mới', () => {
    const h = setup();
    h.conn.start();
    h.last().serverClose(4429);
    h.clock.advance(5000);
    h.conn.retryNow();
    expect(h.sockets.length).toBe(2);
    h.last().serverClose(4429);
    expect(h.conn.state).toBe('full');
    expect(h.conn.retryAt).toBe(35000);
    h.clock.advance(25000); // timer cũ (tại 30 s) đã bị hủy
    expect(h.sockets.length).toBe(2);
    h.clock.advance(5000);
    expect(h.sockets.length).toBe(3);
  });
});

describe('LiveConnection — mất kết nối, resync (US3)', () => {
  it('backoff 1, 2, 4, 8, 16, 30, 30 s nhân jitter [0,5; 1]', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((a) => backoffDelay(a, () => 1))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(backoffDelay(5, () => 0)).toBe(15000);
  });

  it('mất kết nối: phát STALE cho mọi Tag, giữ giá trị; kết nối lại theo backoff', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.snap();
    h.last().serverClose(1006);
    expect(h.conn.state).toBe('offline');
    expect(h.changes.at(-1)).toEqual([
      { id: 'A', value: 1, quality: 'STALE' },
      { id: 'B', value: true, quality: 'STALE' },
    ]);
    h.clock.advance(999);
    expect(h.sockets.length).toBe(1);
    h.clock.advance(1);
    expect(h.sockets.length).toBe(2);
    h.last().serverClose(1006); // lần 2: 2 s
    h.clock.advance(1999);
    expect(h.sockets.length).toBe(2);
    h.clock.advance(1);
    expect(h.sockets.length).toBe(3);
    h.last().open();
    h.snap();
    expect(h.conn.state).toBe('live');
    h.last().serverClose(1006); // sau snapshot: backoff đặt lại 1 s
    h.clock.advance(1000);
    expect(h.sockets.length).toBe(4);
  });

  it('watchdog: im lặng > 15 s → đóng 4001, offline ngay', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.snap();
    h.clock.advance(14999);
    expect(h.conn.state).toBe('live');
    h.clock.advance(1);
    expect(h.last().closed?.code).toBe(4001);
    expect(h.conn.state).toBe('offline');
    expect(h.changes.at(-1)?.[0].quality).toBe('STALE');
  });

  it('mỗi bản tin làm mới watchdog', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.snap();
    h.clock.advance(10000);
    h.last().msg({ type: 'heartbeat', ts: 1 });
    h.clock.advance(10000);
    expect(h.conn.state).toBe('live');
  });

  it('sequence nhảy → subscribe lại (requestId mới) trên cùng kết nối', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    const r1 = h.snap(1);
    h.last().msg({ type: 'delta', subscriptionId: r1, sequence: 5, tags: [] });
    const sub2 = h.last().sent.at(-1) as { type: string; requestId: string };
    expect(sub2.type).toBe('subscribe');
    expect(sub2.requestId).not.toBe(r1);
    expect(h.sockets.length).toBe(1);
    expect(h.last().closed).toBeNull();
  });

  it('resync_required / 4409 / 4408 → kết nối lại theo backoff', () => {
    for (const code of [4409, 4408, 1008, 1009]) {
      const h = setup();
      h.conn.start();
      h.last().open();
      h.last().msg({ type: 'resync_required', reason: 'SEND_QUEUE_OVERFLOW' });
      h.last().serverClose(code);
      expect(h.conn.state).toBe('offline');
      h.clock.advance(1000);
      expect(h.sockets.length).toBe(2);
    }
  });

  it('protocol MAJOR khác → incompatible, không thử lại', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.hello('2.0.0');
    expect(h.conn.state).toBe('incompatible');
    h.last().serverClose(1000);
    h.clock.advance(120000);
    expect(h.sockets.length).toBe(1);
    expect(h.conn.state).toBe('incompatible');
  });

  it('subscribe lại sau mỗi lần kết nối', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.last().serverClose(1006);
    h.clock.advance(1000);
    h.last().open();
    expect(h.last().sent[0]).toMatchObject({ type: 'subscribe', tags: ['A', 'B'] });
  });
});
