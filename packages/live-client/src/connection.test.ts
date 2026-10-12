// LiveConnection với WebSocket và timer giả (contracts/live-ws.md: mã đóng, backoff, 4429, STALE).
import { describe, expect, it, vi } from 'vitest';
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

function setup(random = () => 1, tags = ['A', 'B']) {
  const clock = new Clock();
  const sockets: FakeSocket[] = [];
  const changes: TagChange[][] = [];
  const states: string[] = [];
  const conn = new LiveConnection({
    url: 'ws://dev/api/v1/live',
    tags,
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

  it('delta nhảy sequence có Tag: không vẽ giá trị đó, đăng ký lại (audit FR-012)', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    const r1 = h.snap(1);
    const shown = h.changes.length;
    h.last().msg({ type: 'delta', subscriptionId: r1, sequence: 5, tags: [[0, 42, 'GOOD']] });
    expect(h.changes.length).toBe(shown);
    expect((h.last().sent.at(-1) as { type: string }).type).toBe('subscribe');
  });

  it('1008/1009 (client vi phạm giao thức) → ghi lỗi console; mã khác thì không (live-ws.md)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const code of [1008, 1009, 4409, 1006]) {
        const h = setup();
        h.conn.start();
        h.last().open();
        h.last().serverClose(code);
        expect(h.conn.state).toBe('offline');
      }
      expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([
        expect.stringContaining('1008'),
        expect.stringContaining('1009'),
      ]);
    } finally {
      spy.mockRestore();
    }
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

// Studio giữ một phiên cho mọi Tag của project: danh sách Tag đổi thì đăng ký lại trên cùng socket
// (giao thức 1.0.0: subscribe lần 2 thay đăng ký cũ), và bảng Tag cần biết Tag thiết bị không có.
describe('LiveConnection — đổi danh sách Tag, Tag lạ (feature 004, research R10)', () => {
  interface Subscribe {
    type: string;
    requestId: string;
    tags: string[];
    mode: string;
  }
  const subs = (s: FakeSocket) => (s.sent as Subscribe[]).filter((m) => m.type === 'subscribe');
  const snapshotOf = (
    requestId: string,
    sequence: number,
    tags: Array<[string, unknown, string]>,
    unknown: string[] = [],
  ) => ({
    type: 'snapshot',
    subscriptionId: requestId,
    sequence,
    ts: 1,
    tags: tags.map(([id, value, quality]) => ({ id, value, quality })),
    unknown,
  });

  it('setTags gửi subscribe mới với requestId mới trên cùng socket', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.hello();
    const r1 = h.snap();
    h.conn.setTags(['A', 'C']);
    const all = subs(h.last());
    expect(all).toHaveLength(2);
    expect(all[1]).toEqual({
      type: 'subscribe',
      requestId: expect.any(String),
      tags: ['A', 'C'],
      mode: 'delta',
    });
    expect(all[1].requestId).not.toBe(r1);
    expect(h.conn.tags).toEqual(['A', 'C']);
    expect(h.sockets).toHaveLength(1);
    expect(h.last().closed).toBeNull();
  });

  it('bỏ delta và snapshot của đăng ký cũ; áp snapshot và delta của đăng ký mới', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    const r1 = h.snap(1);
    h.conn.setTags(['B', 'C']);
    const r2 = subs(h.last())[1].requestId;
    const shown = h.changes.length;
    h.last().msg({ type: 'delta', subscriptionId: r1, sequence: 2, tags: [[0, 99, 'GOOD']] });
    h.last().msg(
      snapshotOf(r1, 3, [
        ['A', 5, 'GOOD'],
        ['B', false, 'GOOD'],
      ]),
    );
    expect(h.changes).toHaveLength(shown);
    expect(subs(h.last())).toHaveLength(2); // delta cũ không bị coi là nhảy sequence
    h.last().msg(
      snapshotOf(r2, 4, [
        ['B', false, 'GOOD'],
        ['C', 7, 'UNCERTAIN'],
      ]),
    );
    expect(h.changes.at(-1)).toEqual([
      { id: 'B', value: false, quality: 'GOOD' },
      { id: 'C', value: 7, quality: 'UNCERTAIN' },
    ]);
    h.last().msg({ type: 'delta', subscriptionId: r2, sequence: 5, tags: [[1, 8, 'GOOD']] });
    expect(h.changes.at(-1)).toEqual([{ id: 'C', value: 8, quality: 'GOOD' }]);
  });

  it('hai lần setTags liền nhau: chỉ snapshot của lần cuối được áp', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.conn.setTags(['C']);
    h.conn.setTags(['D']);
    const [r1, r2, r3] = subs(h.last()).map((m) => m.requestId);
    h.last().msg(
      snapshotOf(r1, 1, [
        ['A', 1, 'GOOD'],
        ['B', true, 'GOOD'],
      ]),
    );
    h.last().msg(snapshotOf(r2, 2, [['C', 2, 'GOOD']]));
    expect(h.changes).toEqual([]);
    expect(h.conn.state).toBe('open');
    h.last().msg(snapshotOf(r3, 3, [['D', 3, 'GOOD']]));
    expect(h.changes).toEqual([[{ id: 'D', value: 3, quality: 'GOOD' }]]);
    expect(h.conn.state).toBe('live');
  });

  it('setTags trước khi socket mở: đăng ký danh sách mới khi mở, chỉ một lần', () => {
    const h = setup();
    h.conn.setTags(['X']);
    h.conn.start();
    h.conn.setTags(['X', 'Y']);
    expect(h.last().sent).toEqual([]);
    h.last().open();
    expect(subs(h.last()).map((m) => m.tags)).toEqual([['X', 'Y']]);
  });

  it('setTags khi đang chờ kết nối lại: socket mới đăng ký danh sách mới nhất', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.snap();
    h.last().serverClose(1006);
    h.conn.setTags(['C']);
    expect(h.sockets).toHaveLength(1);
    h.clock.advance(1000);
    h.last().open();
    expect(subs(h.last()).map((m) => m.tags)).toEqual([['C']]);
  });

  it('unknown của snapshot đọc được qua conn.unknown; onSubscribed báo khi đăng ký có kết quả', () => {
    const h = setup(() => 1, ['A', 'B', 'Z']);
    const seen: Array<{ unknown: string[]; subscribed: boolean }> = [];
    h.conn.onSubscribed = (c) => seen.push({ unknown: [...c.unknown], subscribed: c.subscribed });
    h.conn.start();
    h.last().open();
    expect(h.conn.unknown).toEqual([]);
    expect(h.conn.subscribed).toBe(false);
    const r1 = subs(h.last())[0].requestId;
    h.last().msg(
      snapshotOf(
        r1,
        1,
        [
          ['A', 1, 'GOOD'],
          ['B', true, 'GOOD'],
        ],
        ['Z'],
      ),
    );
    expect(h.conn.unknown).toEqual(['Z']);
    expect(h.conn.subscribed).toBe(true);
    expect(seen).toEqual([{ unknown: ['Z'], subscribed: true }]);
    h.conn.setTags(['A']);
    expect(h.conn.subscribed).toBe(false); // chờ kết quả của đăng ký mới
  });

  it('mất kết nối: đăng ký không còn hiệu lực tới snapshot của socket mới', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.snap();
    expect(h.conn.subscribed).toBe(true);
    h.last().serverClose(1006);
    expect(h.conn.subscribed).toBe(false);
    h.clock.advance(1000);
    h.last().open();
    expect(h.conn.subscribed).toBe(false);
    h.snap();
    expect(h.conn.subscribed).toBe(true);
  });

  it('NO_VALID_TAGS của đăng ký hiện tại: mọi Tag là Tag lạ, bỏ dữ liệu của đăng ký cũ', () => {
    const h = setup();
    let answered = 0;
    h.conn.onSubscribed = () => answered++;
    h.conn.start();
    h.last().open();
    const r1 = h.snap(1);
    expect(answered).toBe(1);
    h.conn.setTags(['P', 'Q']);
    const r2 = subs(h.last())[1].requestId;
    h.last().msg({ type: 'error', code: 'NO_VALID_TAGS', message: 'x', requestId: 'r-old' });
    expect(answered).toBe(1); // lỗi của yêu cầu khác: không tính
    h.last().msg({ type: 'error', code: 'NO_VALID_TAGS', message: 'x', requestId: r2 });
    expect(h.conn.unknown).toEqual(['P', 'Q']);
    expect(h.conn.subscribed).toBe(true);
    expect(answered).toBe(2);
    const shown = h.changes.length;
    // Máy chủ giữ đăng ký cũ khi trả NO_VALID_TAGS: delta của nó vẫn tới và phải bị bỏ.
    h.last().msg({ type: 'delta', subscriptionId: r1, sequence: 2, tags: [[0, 5, 'GOOD']] });
    expect(h.changes).toHaveLength(shown);
    // Không còn Tag nào đang nhận: mất kết nối không phát STALE cho Tag cũ.
    h.last().serverClose(1006);
    expect(h.changes).toHaveLength(shown);
  });

  it('danh sách rỗng: không gửi gì, bỏ dữ liệu của đăng ký cũ', () => {
    const h = setup();
    let answered = 0;
    h.conn.onSubscribed = () => answered++;
    h.conn.start();
    h.last().open();
    h.hello();
    const r1 = h.snap(1);
    const sent = h.last().sent.length;
    h.conn.setTags([]);
    expect(h.last().sent).toHaveLength(sent);
    expect(h.conn.tags).toEqual([]);
    expect(h.conn.unknown).toEqual([]);
    expect(answered).toBe(2); // thiết bị đã nhận phiên: danh sách rỗng có hiệu lực ngay
    const shown = h.changes.length;
    h.last().msg({ type: 'delta', subscriptionId: r1, sequence: 2, tags: [[0, 5, 'GOOD']] });
    h.last().serverClose(1006);
    expect(h.changes).toHaveLength(shown);
  });

  it('khởi tạo với danh sách rỗng: mở socket không gửi subscribe; hello thì báo onSubscribed', () => {
    const h = setup(() => 1, []);
    let answered = 0;
    h.conn.onSubscribed = () => answered++;
    h.conn.start();
    h.last().open();
    expect(h.last().sent).toEqual([]);
    expect(answered).toBe(0);
    h.hello();
    expect(answered).toBe(1);
    expect(h.conn.subscribed).toBe(true);
    h.conn.setTags(['A']);
    expect(subs(h.last()).map((m) => m.tags)).toEqual([['A']]);
    expect(h.conn.subscribed).toBe(false);
  });

  it('setTags cùng danh sách không gửi lại; Tag trùng bị bỏ', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.snap();
    h.conn.setTags(['A', 'B', 'A']);
    expect(subs(h.last())).toHaveLength(1);
    h.conn.setTags(['C', 'C', 'D']);
    expect(subs(h.last()).at(-1)?.tags).toEqual(['C', 'D']);
  });

  // Phiên thiết bị của Studio dừng kết nối ngay khi nhận trạng thái: không được để lại socket ma.
  it('stop() ngay trong onState offline/full: không còn hẹn giờ kết nối lại', () => {
    for (const code of [1006, 4429]) {
      const h = setup();
      h.conn.onState = (s, c) => {
        if (s === 'offline' || s === 'full') c.stop();
      };
      h.conn.start();
      h.last().open();
      h.last().serverClose(code);
      h.clock.advance(120000);
      expect(h.sockets).toHaveLength(1);
      expect(h.conn.state).toBe('stopped');
    }
  });
});

// Feature 005 (specs/005-device-online/contracts/live-protocol-1.1.md §2, §5): máy chủ đóng mọi phiên bằng 1012
// ngay trước khi chạy lại để kích hoạt project mới hoặc quay về bản cũ; client thử lại nhanh để tải lại ≤ 10 s.
describe('LiveConnection — mã đóng 1012 (protocol 1.1.0)', () => {
  /** Thử lại một lần: chưa tới hạn thì chưa có socket mới, đúng hạn thì có. */
  const expectRetryAfter = (h: ReturnType<typeof setup>, ms: number) => {
    const before = h.sockets.length;
    h.clock.advance(ms - 1);
    expect(h.sockets).toHaveLength(before);
    h.clock.advance(1);
    expect(h.sockets).toHaveLength(before + 1);
  };

  it('1012: thử lại mỗi 1 s cộng 0–250 ms, tối đa 30 lần, rồi về backoff thường', () => {
    const h = setup(() => 1); // phần ngẫu nhiên lớn nhất: 1000 + 250 ms
    h.conn.start();
    h.last().open();
    h.snap();
    h.last().serverClose(1012);
    expect(h.conn.state).toBe('offline');
    expect(h.conn.retryAt).toBe(h.clock.t + 1250);
    for (let i = 0; i < 30; i++) {
      expectRetryAfter(h, 1250);
      h.last().serverClose(1006); // thiết bị chưa chạy lại xong: kết nối bị từ chối
    }
    // Hết 30 lần thử nhanh: backoff thường 1, 2, 4 s (nhân jitter, random = 1).
    expectRetryAfter(h, 1000);
    h.last().serverClose(1006);
    expectRetryAfter(h, 2000);
    h.last().serverClose(1006);
    expectRetryAfter(h, 4000);
  });

  it('1012: phần ngẫu nhiên nằm trong 0–250 ms', () => {
    for (const [r, ms] of [
      [0, 1000],
      [0.5, 1125],
      [1, 1250],
    ] as const) {
      const h = setup(() => r);
      h.conn.start();
      h.last().open();
      h.last().serverClose(1012);
      expect(h.conn.retryAt).toBe(ms);
      expectRetryAfter(h, ms);
    }
  });

  it('1012: giá trị chuyển STALE như mọi lần mất kết nối, giữ giá trị cuối', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.snap();
    h.last().serverClose(1012);
    expect(h.changes.at(-1)).toEqual([
      { id: 'A', value: 1, quality: 'STALE' },
      { id: 'B', value: true, quality: 'STALE' },
    ]);
    expect(h.conn.subscribed).toBe(false);
  });

  it('kết nối lại được sau 1012: lần mất kết nối sau theo backoff thường', () => {
    const h = setup(() => 1);
    h.conn.start();
    h.last().open();
    h.snap();
    h.last().serverClose(1012);
    expectRetryAfter(h, 1250);
    h.last().open();
    h.snap();
    expect(h.conn.state).toBe('live');
    h.last().serverClose(1006);
    expectRetryAfter(h, 1000);
    h.last().serverClose(1006);
    expectRetryAfter(h, 2000);
  });

  it('1012 mới trong lúc đang thử nhanh (quay về bản cũ): đếm lại từ đầu', () => {
    const h = setup(() => 0);
    h.conn.start();
    h.last().open();
    h.snap();
    h.last().serverClose(1012);
    for (let i = 0; i < 20; i++) {
      expectRetryAfter(h, 1000);
      h.last().serverClose(1006);
    }
    expectRetryAfter(h, 1000);
    h.last().open(); // bản mới chạy rồi kiểm tra sức khỏe lỗi: lại đóng 1012 trước khi quay về
    h.last().serverClose(1012);
    for (let i = 0; i < 30; i++) {
      expectRetryAfter(h, 1000);
      h.last().serverClose(1006);
    }
    expectRetryAfter(h, 500); // backoff thường lần đầu: 1 s × 0,5
  });

  it('mã khác giữ backoff thường', () => {
    for (const code of [1000, 1001, 1006, 1011, 4408, 4409]) {
      const h = setup(() => 1);
      h.conn.start();
      h.last().open();
      h.snap();
      h.last().serverClose(code);
      expectRetryAfter(h, 1000);
      h.last().serverClose(code);
      expectRetryAfter(h, 2000);
    }
  });

  it('stop() sau 1012: không thử lại', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.last().serverClose(1012);
    h.conn.stop();
    h.clock.advance(120000);
    expect(h.sockets).toHaveLength(1);
  });

  it('1012 không phải lỗi của client: không ghi console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const h = setup();
      h.conn.start();
      h.last().open();
      h.last().serverClose(1012);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('hello.project.digest đọc được qua conn.live.hello', () => {
    const h = setup();
    h.conn.start();
    h.last().open();
    h.last().msg({
      type: 'hello',
      protocolVersion: '1.1.0',
      serverVersion: '0.4.0',
      maxClients: 10,
      project: {
        projectId: 'tank-demo',
        projectVersion: '1.3.0',
        digest: `sha256:${'9'.repeat(64)}`,
      },
    });
    expect(h.conn.state).toBe('open');
    expect(h.conn.live.hello?.project).toEqual({
      projectId: 'tank-demo',
      projectVersion: '1.3.0',
      digest: `sha256:${'9'.repeat(64)}`,
    });
  });
});
