// LiveTagSource (feature 007, FR-017, FR-018; research R10): nguồn dữ liệu của trang vận hành, bọc LiveConnection.
// Socket giả; kiểm hợp tập Tag của nhiều người đăng ký, gom lần đổi, STALE, UNKNOWN, INT64 chuỗi, reason, giờ BL335.
import type { TagInfo } from '@mat/ui-components';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveTagSource } from './live-source.ts';

class FakeSocket {
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  closed = false;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.();
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006): void {
    this.onclose?.({ code });
  }
  subscribes(): Array<{ requestId: string; tags: string[] }> {
    return this.sent.filter((m) => m.type === 'subscribe') as never;
  }
  /** Trả snapshot cho lần subscribe cuối. */
  snapshot(
    tags: Array<{ id: string; value: unknown; quality?: string; reason?: string }>,
    extra: { unknown?: string[]; ts?: number } = {},
  ): void {
    const sub = this.subscribes().at(-1)!;
    this.receive({
      type: 'snapshot',
      subscriptionId: sub.requestId,
      sequence: 1,
      ts: extra.ts ?? 1000,
      tags: tags.map((t) => ({ quality: 'GOOD', ...t })),
      unknown: extra.unknown ?? [],
    });
  }
}

const info = (id: string, extra: Partial<TagInfo> = {}): TagInfo => ({
  id,
  type: 'FLOAT32',
  access: 'R',
  kind: 'external',
  ...extra,
});

const HELLO = {
  type: 'hello',
  protocolVersion: '1.2.0',
  serverVersion: '0.6.0',
  maxClients: 10,
  heartbeatMs: 5000,
  timeoutMs: 15000,
  project: { projectId: 'p', projectVersion: '1' },
};

let live: LiveTagSource | null = null;
/** Hẹn giờ giả: chỉ chạy khi test gọi (watchdog và thử lại của LiveConnection không chạy thật). */
function fakeTimers() {
  const q = new Map<number, () => void>();
  let n = 0;
  return {
    setTimer: (fn: () => void) => {
      q.set(++n, fn);
      return n;
    },
    clearTimer: (h: unknown) => void q.delete(h as number),
    fire: () => {
      const all = [...q.values()];
      q.clear();
      for (const f of all) f();
    },
  };
}

function make(opt: { now?: () => number } = {}) {
  const sockets: FakeSocket[] = [];
  const timers = fakeTimers();
  live = new LiveTagSource({
    url: 'ws://x/api/v1/live',
    tags: [
      info('A'),
      info('B'),
      info('C'),
      info('BIG', { type: 'INT64' }),
      info('S', { type: 'STRING' }),
    ],
    valueTables: { TT: { entries: [] } as never },
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    ...opt,
  });
  return { src: live, sockets, timers };
}
const tick = () => new Promise<void>((r) => queueMicrotask(r));
afterEach(() => {
  live?.stop();
  live = null;
});

/** Mở kết nối, nhận hello, chờ gom đăng ký. */
async function connected(src: LiveTagSource, sockets: FakeSocket[]): Promise<FakeSocket> {
  src.start();
  const s = sockets[0];
  s.open();
  s.receive(HELLO);
  await tick();
  return s;
}

describe('đăng ký theo tập Tag', () => {
  it('hợp tập Tag của nhiều người đăng ký, bỏ trùng, một lần subscribe', async () => {
    const { src, sockets } = make();
    src.subscribe(['A', 'B'], () => {});
    src.subscribe(['B', 'C'], () => {});
    const s = await connected(src, sockets);
    await tick();
    expect(s.subscribes()).toHaveLength(1);
    expect(s.subscribes()[0].tags).toEqual(['A', 'B', 'C']);
  });

  it('hủy một người đăng ký thì thu hẹp tập; hủy hết thì không gửi subscribe rỗng', async () => {
    const { src, sockets } = make();
    const off1 = src.subscribe(['A', 'B'], () => {});
    const off2 = src.subscribe(['B', 'C'], () => {});
    const s = await connected(src, sockets);
    s.snapshot([]);
    off1();
    await tick();
    expect(s.subscribes().at(-1)!.tags).toEqual(['B', 'C']);
    off2();
    await tick();
    expect(s.subscribes()).toHaveLength(2); // rỗng: LiveConnection không gửi
    expect(src.conn.tags).toEqual([]);
  });

  it('đổi màn hình (hủy cũ, đăng ký mới cùng lượt) chỉ gửi một subscribe', async () => {
    const { src, sockets } = make();
    const off = src.subscribe(['A'], () => {});
    const s = await connected(src, sockets);
    s.snapshot([{ id: 'A', value: 1 }]);
    off();
    src.subscribe(['C'], () => {});
    await tick();
    expect(s.subscribes()).toHaveLength(2);
    expect(s.subscribes()[1].tags).toEqual(['C']);
  });

  it('hủy hai lần không lỗi', () => {
    const { src } = make();
    const off = src.subscribe(['A'], () => {});
    off();
    expect(() => off()).not.toThrow();
  });
});

describe('giá trị và thông báo', () => {
  it('snapshot đưa giá trị vào get(); chỉ người đăng ký trúng Tag đổi mới được gọi', async () => {
    const { src, sockets } = make();
    const onA = vi.fn();
    const onC = vi.fn();
    src.subscribe(['A', 'B'], onA);
    src.subscribe(['C'], onC);
    const s = await connected(src, sockets);
    s.snapshot([
      { id: 'A', value: 1.5 },
      { id: 'B', value: 2 },
      { id: 'C', value: 3 },
    ]);
    expect(src.get('A')).toMatchObject({ value: 1.5, quality: 'GOOD' });
    expect(onA).toHaveBeenCalledTimes(1);
    expect(onA.mock.calls[0][0]).toEqual(['A', 'B']);
    expect(onC.mock.calls[0][0]).toEqual(['C']);
    // delta chỉ đổi B
    s.receive({
      type: 'delta',
      subscriptionId: s.subscribes()[0].requestId,
      sequence: 2,
      ts: 1250,
      tags: [[1, 9, 'GOOD']],
    });
    expect(src.get('B').value).toBe(9);
    expect(onA).toHaveBeenCalledTimes(2);
    expect(onA.mock.calls[1][0]).toEqual(['B']);
    expect(onC).toHaveBeenCalledTimes(1);
  });

  it('INT64 ngoài ±2^53 giữ nguyên dạng chuỗi', async () => {
    const { src, sockets } = make();
    src.subscribe(['BIG', 'S'], () => {});
    const s = await connected(src, sockets);
    s.snapshot([
      { id: 'BIG', value: '9223372036854775807' },
      { id: 'S', value: 'xin chào' },
    ]);
    expect(src.get('BIG').value).toBe('9223372036854775807');
    expect(src.get('S').value).toBe('xin chào');
  });

  it('reason của quality đi theo', async () => {
    const { src, sockets } = make();
    src.subscribe(['A'], () => {});
    const s = await connected(src, sockets);
    s.snapshot([{ id: 'A', value: 0, quality: 'BAD', reason: 'TIMEOUT' }]);
    expect(src.get('A')).toMatchObject({ quality: 'BAD', reason: 'TIMEOUT' });
  });
});

describe('Tag lạ và chưa có dữ liệu', () => {
  it('Tag thiết bị báo lạ → UNKNOWN và người đăng ký được báo', async () => {
    const { src, sockets } = make();
    const fn = vi.fn();
    src.subscribe(['A', 'ZZ'], fn);
    const s = await connected(src, sockets);
    s.snapshot([{ id: 'A', value: 1 }], { unknown: ['ZZ'] });
    expect(src.get('ZZ')).toEqual({ value: null, quality: 'UNKNOWN' });
    expect(fn.mock.calls.flatMap((c) => c[0] as string[])).toContain('ZZ');
  });

  it('Tag không có trong project và chưa nhận → UNKNOWN; get không ném lỗi', () => {
    const { src } = make();
    expect(src.get('KHONG_CO')).toEqual({ value: null, quality: 'UNKNOWN' });
    expect(src.info('KHONG_CO')).toBeUndefined();
  });

  it('Tag có trong project nhưng chưa có dữ liệu và chưa kết nối → STALE (không phải UNKNOWN)', () => {
    const { src } = make();
    expect(src.get('A')).toEqual({ value: null, quality: 'STALE' });
  });

  it('NO_VALID_TAGS: mọi Tag lạ → UNKNOWN', async () => {
    const { src, sockets } = make();
    src.subscribe(['ZZ'], () => {});
    const s = await connected(src, sockets);
    s.receive({
      type: 'error',
      requestId: s.subscribes()[0].requestId,
      code: 'NO_VALID_TAGS',
      message: 'x',
    });
    expect(src.get('ZZ').quality).toBe('UNKNOWN');
  });
});

describe('mất kết nối', () => {
  it('giữ giá trị cuối, quality STALE, connection chuyển live → stale', async () => {
    const { src, sockets } = make();
    const fn = vi.fn();
    src.subscribe(['A'], fn);
    const s = await connected(src, sockets);
    expect(src.connection).toBe('offline'); // chưa có snapshot
    s.snapshot([{ id: 'A', value: 7 }]);
    expect(src.connection).toBe('live');
    fn.mockClear();
    s.drop();
    expect(src.get('A')).toMatchObject({ value: 7, quality: 'STALE' });
    expect(fn).toHaveBeenCalledWith(['A']);
    expect(src.connection).toBe('stale');
  });

  it('kết nối lại và snapshot mới thì trở về GOOD, live', async () => {
    const { src, sockets, timers } = make();
    src.subscribe(['A'], () => {});
    const s = await connected(src, sockets);
    s.snapshot([{ id: 'A', value: 7 }]);
    s.drop();
    timers.fire();
    const s2 = sockets[1];
    expect(s2).toBeDefined();
    s2.open();
    s2.receive(HELLO);
    s2.snapshot([{ id: 'A', value: 8 }]);
    expect(src.get('A')).toMatchObject({ value: 8, quality: 'GOOD' });
    expect(src.connection).toBe('live');
  });

  it('onConnection báo mỗi lần đổi trạng thái kết nối', async () => {
    const { src, sockets } = make();
    const states: string[] = [];
    src.onConnection((c) => states.push(c));
    src.subscribe(['A'], () => {});
    const s = await connected(src, sockets);
    s.snapshot([{ id: 'A', value: 1 }]);
    s.drop();
    expect(states).toEqual(['live', 'stale']);
  });
});

describe('giờ BL335 và bảng tra', () => {
  it('now() theo ts của máy chủ cộng thời gian trôi cục bộ', async () => {
    let local = 5_000;
    const { src, sockets } = make({ now: () => local });
    src.subscribe(['A'], () => {});
    expect(src.now()).toBe(5_000); // chưa có giờ máy chủ: giờ cục bộ
    const s = await connected(src, sockets);
    s.snapshot([{ id: 'A', value: 1 }], { ts: 1_791_601_205_000 });
    local = 5_500;
    expect(src.now()).toBe(1_791_601_205_500);
  });

  it('updatedAt của Tag là giờ máy chủ lúc nhận', async () => {
    const { src, sockets } = make({ now: () => 5_000 });
    src.subscribe(['A'], () => {});
    const s = await connected(src, sockets);
    s.snapshot([{ id: 'A', value: 1 }], { ts: 2_000_000 });
    expect(src.get('A').updatedAt).toBe(2_000_000);
  });

  it('info và valueTable tra từ project', () => {
    const { src } = make();
    expect(src.info('BIG')?.type).toBe('INT64');
    expect(src.valueTable('TT')).toBeDefined();
    expect(src.valueTable('NO')).toBeUndefined();
  });
});

describe('trạng thái cho thanh trạng thái', () => {
  it('onState báo trạng thái thô của LiveConnection; hủy được', async () => {
    const { src, sockets } = make();
    const seen: string[] = [];
    const off = src.onState((s) => seen.push(s));
    src.subscribe(['A'], () => {});
    const s = await connected(src, sockets);
    s.snapshot([{ id: 'A', value: 1 }]);
    expect(seen).toEqual(['connecting', 'open', 'live']);
    off();
    s.drop();
    expect(seen).toEqual(['connecting', 'open', 'live']);
  });

  it('lastUpdate: giờ nhận dữ liệu mới; bản tin STALE khi mất kết nối không tính', async () => {
    const { src, sockets } = make({ now: () => 7_000 });
    src.subscribe(['A'], () => {});
    expect(src.lastUpdate).toBe(0);
    const s = await connected(src, sockets);
    s.snapshot([{ id: 'A', value: 1 }], { ts: 9_000 });
    expect(src.lastUpdate).toBe(9_000);
    s.snapshot([{ id: 'A', value: 1 }], { ts: 9_500 });
    s.drop();
    expect(src.get('A').quality).toBe('STALE');
    expect(src.lastUpdate).toBe(9_500);
  });
});

describe('refresh', () => {
  it('báo mọi người đăng ký như thể Tag của họ đổi (widget tính lại khóa khi phiên đổi)', async () => {
    const { src } = make();
    const a = vi.fn();
    const b = vi.fn();
    src.subscribe(['A', 'B'], a);
    src.subscribe(['C'], b);
    src.refresh();
    expect(a).toHaveBeenCalledWith(['A', 'B']);
    expect(b).toHaveBeenCalledWith(['C']);
  });
});
