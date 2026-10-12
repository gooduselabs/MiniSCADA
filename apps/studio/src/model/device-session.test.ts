// Phiên thiết bị duy nhất của Studio (data-model §9, research R10, FR-027…FR-030).
// WebSocket và fetch giả, đồng hồ giả của Vitest (gồm cả hẹn giờ 3 s bên trong checkDevice).
import type { SocketLike } from '@mat/live-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_TIMEOUT_MS, DeviceSession, type SessionEvent } from './device-session.ts';
// Feature 005 (T079): chế độ online, chạy trên DeviceLink giả.
import { randomUUID } from 'node:crypto';
import { isDeviceError, type KnownDevice } from '../platform/device-types.ts';
import { createMockDevice, type MockDevice } from '../platform/mock-device.ts';
import { monitorFetch, monitorSocket } from './device-adapters.ts';

class FakeSocket implements SocketLike {
  sent: Array<Record<string, unknown>> = [];
  closed: { code?: number } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  readonly url: string;
  private seq = 0;
  constructor(url: string) {
    this.url = url;
  }
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
  /** `subscribe` gần nhất client đã gửi. */
  request(): { requestId: string; tags: string[] } {
    const subs = this.sent.filter((m) => m.type === 'subscribe');
    return subs[subs.length - 1] as unknown as { requestId: string; tags: string[] };
  }
  hello(protocolVersion = '1.0.0') {
    this.msg({
      type: 'hello',
      protocolVersion,
      serverVersion: '0.3.0',
      maxClients: 10,
      heartbeatMs: 5000,
      timeoutMs: 15000,
      project: { projectId: 'tank-demo', projectVersion: '0.1.0' },
    });
  }
  /** Snapshot trả lời `subscribe` gần nhất; mọi Tag GOOD. */
  snapshot(values: Record<string, unknown>, unknown: string[] = []) {
    this.msg({
      type: 'snapshot',
      subscriptionId: this.request().requestId,
      sequence: ++this.seq,
      ts: 1,
      tags: Object.entries(values).map(([id, value]) => ({ id, value, quality: 'GOOD' })),
      unknown,
    });
  }
  delta(tags: Array<[number, unknown, string]>) {
    this.msg({
      type: 'delta',
      subscriptionId: this.request().requestId,
      sequence: ++this.seq,
      ts: 2,
      tags,
    });
  }
}

interface PendingFetch {
  url: string;
  respond(body: unknown, status?: number): void;
  fail(error?: unknown): void;
}

const INFO = {
  runtimeVersion: '0.3.0',
  protocolVersion: '1.0.0',
  clients: 1,
  maxClients: 10,
  project: { status: 'active', projectId: 'tank-demo', projectVersion: '0.1.0' },
};

function setup(tags: string[] = ['A', 'B', 'C']) {
  const sockets: FakeSocket[] = [];
  const fetches: PendingFetch[] = [];
  const session = new DeviceSession({
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    fetch: (url, init) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
        fetches.push({
          url,
          respond: (body, status = 200) =>
            resolve({
              ok: status >= 200 && status < 300,
              status,
              json: async () => body,
            } as unknown as Response),
          fail: (error = new TypeError('Failed to fetch')) => reject(error),
        });
      }),
    random: () => 1, // backoff không ngẫu nhiên: lần đầu đúng 1 s
  });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  session.setTags(tags);
  const last = () => sockets[sockets.length - 1];
  const states = () => events.flatMap((e) => (e.type === 'state' ? [e.state] : []));
  return { session, sockets, fetches, events, last, states };
}
type Harness = ReturnType<typeof setup>;

/** Chờ chuỗi promise của fetch giả (checkDevice) chạy xong. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Đưa phiên tới monitoring: system/info trả lời, socket mở, hello, snapshot. */
async function toMonitoring(
  h: Harness,
  values: Record<string, unknown> = { A: 1, B: true },
  unknown: string[] = ['C'],
) {
  h.session.connect('192.168.1.110');
  h.fetches[h.fetches.length - 1].respond(INFO);
  await flush();
  h.last().open();
  h.last().hello();
  h.last().snapshot(values, unknown);
  expect(h.session.state).toBe('monitoring');
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('DeviceSession — kết nối theo dõi', () => {
  it('idle → connecting → monitoring khi system/info trả lời và đăng ký Tag có kết quả', async () => {
    const h = setup();
    expect(h.session.state).toBe('idle');
    h.session.connect(' 192.168.1.110 ');
    expect(h.session.state).toBe('connecting');
    expect(h.session.address).toBe('http://192.168.1.110:8080');
    expect(h.fetches.map((f) => f.url)).toEqual(['http://192.168.1.110:8080/api/v1/system/info']);
    expect(h.sockets.map((s) => s.url)).toEqual(['ws://192.168.1.110:8080/api/v1/live']);
    h.fetches[0].respond(INFO);
    await flush();
    expect(h.session.info).toEqual(INFO);
    expect(h.session.infoAt).toBe(Date.now());
    expect(h.session.state).toBe('connecting'); // chưa có dữ liệu sống
    h.last().open();
    expect(h.last().request().tags).toEqual(['A', 'B', 'C']);
    h.last().hello();
    expect(h.session.state).toBe('connecting');
    h.last().snapshot({ A: 1, B: true }, ['C']);
    expect(h.session.state).toBe('monitoring');
    expect(h.session.error).toBeNull();
    expect(h.session.live).toBe('live');
    expect(h.states()).toEqual(['connecting', 'monitoring']);
    expect(h.session.values.get('A')).toEqual({ value: 1, quality: 'GOOD', ts: Date.now() });
    expect(h.session.values.get('B')).toMatchObject({ value: true, quality: 'GOOD' });
    expect(h.session.values.has('C')).toBe(false);
    expect([...h.session.unknown]).toEqual(['C']); // "không có trên thiết bị"
  });

  it('dữ liệu sống tới trước system/info: chờ đủ cả hai rồi mới monitoring', async () => {
    const h = setup();
    h.session.connect('192.168.1.110:9080');
    h.last().open();
    h.last().hello();
    h.last().snapshot({ A: 1, B: 2 }, ['C']);
    expect(h.session.state).toBe('connecting');
    expect(h.session.values.size).toBe(0); // chưa theo dõi thì chưa có giá trị
    h.fetches[0].respond(INFO);
    await flush();
    expect(h.session.state).toBe('monitoring');
    expect(h.session.values.get('B')).toMatchObject({ value: 2, quality: 'GOOD' });
  });

  it('thiết bị không có Tag nào của project (NO_VALID_TAGS): vẫn theo dõi, mọi Tag là Tag lạ', async () => {
    const h = setup(['P', 'Q']);
    h.session.connect('192.168.1.110');
    h.fetches[0].respond(INFO);
    await flush();
    h.last().open();
    h.last().hello();
    const { requestId } = h.last().request();
    h.last().msg({ type: 'error', code: 'NO_VALID_TAGS', message: 'x', requestId });
    expect(h.session.state).toBe('monitoring');
    expect([...h.session.unknown]).toEqual(['P', 'Q']);
    expect(h.session.values.size).toBe(0);
  });

  it('project chưa có Tag: theo dõi khi thiết bị nhận phiên, không gửi subscribe rỗng', async () => {
    const h = setup([]);
    h.session.connect('192.168.1.110');
    h.fetches[0].respond(INFO);
    await flush();
    h.last().open();
    expect(h.last().sent).toEqual([]);
    h.last().hello();
    expect(h.session.state).toBe('monitoring');
  });

  it('delta cập nhật giá trị; người nghe nhận đúng Tag; hủy đăng ký thì thôi nhận', async () => {
    const h = setup();
    await toMonitoring(h);
    expect(h.events).toContainEqual({ type: 'state', state: 'monitoring' });
    expect(h.events).toContainEqual({ type: 'values', tags: ['A', 'B'] });
    expect(h.events).toContainEqual({ type: 'unknown' });
    expect(h.events).toContainEqual({ type: 'info' });
    const seen: SessionEvent[] = [];
    const off = h.session.subscribe((e) => seen.push(e));
    await vi.advanceTimersByTimeAsync(250);
    h.last().delta([[0, 2, 'UNCERTAIN']]);
    expect(seen).toEqual([{ type: 'values', tags: ['A'] }]);
    expect(h.session.values.get('A')).toEqual({ value: 2, quality: 'UNCERTAIN', ts: Date.now() });
    off();
    h.last().delta([[1, false, 'BAD']]);
    expect(seen).toHaveLength(1);
    expect(h.session.values.get('B')).toMatchObject({ value: false, quality: 'BAD' });
  });

  it('chỉ một WebSocket: kết nối lại cùng địa chỉ không mở thêm; địa chỉ khác thì đóng socket cũ trước', async () => {
    const h = setup();
    await toMonitoring(h);
    h.session.connect('http://192.168.1.110:8080/');
    expect(h.sockets).toHaveLength(1);
    expect(h.session.state).toBe('monitoring');
    h.session.connect('192.168.1.111');
    expect(h.sockets[0].closed).not.toBeNull();
    expect(h.sockets).toHaveLength(2);
    expect(h.session.address).toBe('http://192.168.1.111:8080');
    expect(h.session.state).toBe('connecting');
    expect(h.session.values.size).toBe(0);
  });
});

describe('DeviceSession — lỗi khi kết nối (FR-027: báo trong ≤ 3 s, nói rõ lý do)', () => {
  it('hạn chót chừa ít nhất 200 ms để vẽ thông báo trong ngân sách 3 s (e2e đo 3,006–3,015 s với hạn 3 s)', () => {
    expect(CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(2800);
  });

  it('không trả lời trong 3 s → error "timeout", đóng socket, không tự thử lại', async () => {
    const h = setup();
    h.session.connect('10.0.0.9');
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS - 1);
    expect(h.session.state).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.session.state).toBe('error');
    expect(h.session.error).toBe('timeout');
    expect(h.last().closed).not.toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.fetches).toHaveLength(1);
    expect(h.states()).toEqual(['connecting', 'error']);
  });

  it('system/info trả lời nhưng dữ liệu sống không tới trong 3 s → error "timeout"', async () => {
    const h = setup();
    h.session.connect('10.0.0.9');
    h.fetches[0].respond(INFO);
    await flush();
    h.last().open();
    h.last().hello();
    await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS);
    expect(h.session.state).toBe('error');
    expect(h.session.error).toBe('timeout');
    expect(h.last().closed).not.toBeNull();
  });

  it('system/info lỗi mạng, HTTP lỗi, nội dung hỏng → error kèm mã, đóng socket ngay', async () => {
    const cases: Array<[(f: PendingFetch) => void, string]> = [
      [(f) => f.fail(), 'network'],
      [(f) => f.respond('x', 500), 'http'],
      [(f) => f.respond([1, 2]), 'bad-response'],
    ];
    for (const [answer, code] of cases) {
      const h = setup();
      h.session.connect('10.0.0.9');
      answer(h.fetches[0]);
      await flush();
      expect(h.session.state, code).toBe('error');
      expect(h.session.error, code).toBe(code);
      expect(h.last().closed, code).not.toBeNull();
    }
  });

  it('địa chỉ sai → error "invalid-address", không mở socket, không gọi mạng', () => {
    const h = setup();
    h.session.connect('ftp://x');
    expect(h.session.state).toBe('error');
    expect(h.session.error).toBe('invalid-address');
    expect(h.sockets).toHaveLength(0);
    expect(h.fetches).toHaveLength(0);
  });

  it('socket đóng trước khi theo dõi được (thiết bị từ chối) → error "live-closed", không thử lại', async () => {
    const h = setup();
    h.session.connect('10.0.0.9');
    h.fetches[0].respond(INFO);
    await flush();
    h.last().serverClose(1006);
    expect(h.session.state).toBe('error');
    expect(h.session.error).toBe('live-closed');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('đang error mà lỗi lại với lý do khác: người nghe vẫn được báo', async () => {
    const h = setup();
    h.session.connect('10.0.0.9');
    h.fetches[0].fail();
    await flush();
    expect(h.session.error).toBe('network');
    const seen: SessionEvent[] = [];
    h.session.subscribe((e) => seen.push(e));
    h.session.connect('ftp://x');
    expect(h.session.error).toBe('invalid-address');
    expect(seen).toContainEqual({ type: 'state', state: 'error' });
  });

  it('từ error kết nối lại được; lý do lỗi cũ bị xóa', async () => {
    const h = setup();
    h.session.connect('10.0.0.9');
    h.fetches[0].fail();
    await flush();
    expect(h.session.error).toBe('network');
    await toMonitoring(h);
    expect(h.session.error).toBeNull();
    expect(h.sockets).toHaveLength(2);
  });
});

describe('DeviceSession — thiết bị đầy, không tương thích (FR-030)', () => {
  it('4429 → full, quá 3 s không thành error; sau 30 s tự connecting rồi monitoring', async () => {
    const h = setup();
    h.session.connect('10.0.0.9');
    h.fetches[0].respond(INFO);
    await flush();
    h.last().open();
    h.last().msg({ type: 'error', code: 'MAX_CLIENTS_REACHED', message: 'full' });
    h.last().serverClose(4429);
    expect(h.session.state).toBe('full');
    expect(h.session.retryAt).toBe(Date.now() + 30_000);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(h.session.state).toBe('full');
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.session.state).toBe('connecting');
    expect(h.sockets).toHaveLength(2);
    h.last().open();
    h.last().hello();
    h.last().snapshot({ A: 1, B: 2 }, ['C']);
    expect(h.session.state).toBe('monitoring');
    expect(h.states()).toEqual(['connecting', 'full', 'connecting', 'monitoring']);
  });

  it('full: retryNow thử lại ngay', async () => {
    const h = setup();
    h.session.connect('10.0.0.9');
    h.fetches[0].respond(INFO);
    await flush();
    h.last().serverClose(4429);
    expect(h.session.state).toBe('full');
    h.session.retryNow();
    expect(h.sockets).toHaveLength(2);
    expect(h.session.state).toBe('connecting');
  });

  it('giao thức không tương thích → incompatible, đóng socket, không thử lại', async () => {
    const h = setup();
    h.session.connect('10.0.0.9');
    h.fetches[0].respond(INFO);
    await flush();
    h.last().open();
    h.last().hello('2.0.0');
    expect(h.session.state).toBe('incompatible');
    expect(h.last().closed).not.toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.fetches).toHaveLength(1);
    expect(h.session.state).toBe('incompatible');
  });
});

describe('DeviceSession — mất kết nối, đổi Tag, ngắt', () => {
  it('socket đóng khi đang theo dõi → lost: mọi giá trị chuyển mất kết nối; tự kết nối lại theo backoff', async () => {
    const h = setup();
    await toMonitoring(h);
    h.last().serverClose(1006);
    expect(h.session.state).toBe('lost');
    expect([...h.session.values.values()].map((v) => v.quality)).toEqual(['STALE', 'STALE']);
    expect(h.session.values.get('A')?.value).toBe(1); // giá trị cuối, không còn là GOOD
    await vi.advanceTimersByTimeAsync(999);
    expect(h.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sockets).toHaveLength(2);
    expect(h.session.state).toBe('lost');
    h.last().open();
    h.last().hello();
    h.last().snapshot({ A: 5, B: false }, ['C']);
    expect(h.session.state).toBe('monitoring');
    expect(h.session.values.get('A')).toMatchObject({ value: 5, quality: 'GOOD' });
    expect(h.states()).toEqual(['connecting', 'monitoring', 'lost', 'monitoring']);
  });

  it('máy chủ im lặng quá 15 s (mạng chết) cũng là lost', async () => {
    const h = setup();
    await toMonitoring(h);
    // Các lần hỏi system/info ở 5 s, 10 s không được trả lời: chỉ hết hạn, không đổi trạng thái.
    await vi.advanceTimersByTimeAsync(14_999);
    expect(h.session.state).toBe('monitoring');
    expect(h.session.infoError).toBe('timeout');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.session.state).toBe('lost');
    expect([...h.session.values.values()].every((v) => v.quality === 'STALE')).toBe(true);
  });

  it('đổi danh sách Tag → setTags trên cùng socket; delta cũ bị bỏ; Tag bỏ đi mất giá trị', async () => {
    const h = setup();
    await toMonitoring(h);
    const r1 = h.last().request().requestId;
    h.session.setTags(['A', 'D']);
    expect(h.session.tags).toEqual(['A', 'D']);
    expect(h.sockets).toHaveLength(1);
    expect(h.last().request().tags).toEqual(['A', 'D']);
    expect(h.last().request().requestId).not.toBe(r1);
    expect(h.session.values.has('B')).toBe(false);
    expect(h.session.unknown.size).toBe(0); // C không còn trong project
    h.last().msg({ type: 'delta', subscriptionId: r1, sequence: 2, tags: [[0, 99, 'GOOD']] });
    expect(h.session.values.get('A')?.value).toBe(1);
    h.last().snapshot({ A: 2 }, ['D']);
    expect(h.session.values.get('A')).toMatchObject({ value: 2, quality: 'GOOD' });
    expect([...h.session.unknown]).toEqual(['D']);
    expect(h.session.state).toBe('monitoring');
    h.session.setTags(['D', 'A', 'A']); // cùng tập nhưng khác thứ tự: đăng ký lại
    h.session.setTags(['D', 'A']); // y hệt lần trước: không gửi lại
    expect(h.last().sent.filter((m) => m.type === 'subscribe')).toHaveLength(3);
  });

  it('setTags trước khi kết nối: lần kết nối đăng ký đúng danh sách đó', async () => {
    const h = setup();
    h.session.setTags(['X', 'Y']);
    h.session.connect('10.0.0.9');
    h.last().open();
    expect(h.last().request().tags).toEqual(['X', 'Y']);
  });

  it('ngắt → đóng socket ngay, về idle, xóa giá trị; không kết nối lại, không hỏi system/info nữa', async () => {
    const h = setup();
    await toMonitoring(h);
    h.session.disconnect();
    expect(h.last().closed).toEqual({ code: 1000 });
    expect(h.session.state).toBe('idle');
    expect(h.session.values.size).toBe(0);
    expect(h.session.unknown.size).toBe(0);
    expect(h.session.info).toBeNull();
    expect(h.session.live).toBeNull();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.sockets).toHaveLength(1);
    expect(h.fetches).toHaveLength(1);
  });

  it('ngắt khi system/info chưa trả lời: kết quả về sau bị bỏ', async () => {
    const h = setup();
    h.session.connect('10.0.0.9');
    h.session.disconnect();
    expect(h.last().closed).not.toBeNull();
    h.fetches[0].respond(INFO);
    await flush();
    expect(h.session.state).toBe('idle');
    expect(h.session.info).toBeNull();
  });
});

describe('DeviceSession — hỏi system/info (FR-029)', () => {
  it('mỗi 5 s khi monitoring; lần hỏi lỗi giữ bản cũ và trạng thái', async () => {
    const h = setup();
    await toMonitoring(h);
    expect(h.fetches).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.fetches).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fetches).toHaveLength(2);
    h.fetches[1].respond({ ...INFO, clients: 2 });
    await flush();
    expect(h.session.info?.clients).toBe(2);
    expect(h.session.infoAt).toBe(Date.now());
    h.last().msg({ type: 'heartbeat', ts: 1 }); // giữ socket qua watchdog 15 s
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fetches).toHaveLength(3);
    h.fetches[2].fail();
    await flush();
    expect(h.session.state).toBe('monitoring');
    expect(h.session.infoError).toBe('network');
    expect(h.session.info?.clients).toBe(2);
  });

  it('không hỏi khi lost; có lại thì hỏi ngay nếu bản cũ đã quá 5 s', async () => {
    const h = setup();
    await toMonitoring(h);
    h.last().serverClose(1006);
    await vi.advanceTimersByTimeAsync(1000); // backoff 1 s: socket mới
    await vi.advanceTimersByTimeAsync(9000);
    expect(h.fetches).toHaveLength(1);
    h.last().open();
    h.last().hello();
    h.last().snapshot({ A: 1, B: true }, ['C']);
    expect(h.session.state).toBe('monitoring');
    expect(h.fetches).toHaveLength(2);
    h.fetches[1].respond(INFO);
    await flush();
    await vi.advanceTimersByTimeAsync(4999);
    expect(h.fetches).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fetches).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------------
// Feature 005 (T079, data-model §6, tauri-commands §4–7, FR-008, FR-031, FR-035): chế độ online theo id
// của thiết bị đã lưu, qua HTTPS có ghim và đăng nhập. Chạy trên DeviceLink giả (mock-device.ts).
// ---------------------------------------------------------------------------------------------------

const PW = `thu-${randomUUID()}`;
const TAGS = ['TANK01.LEVEL', 'MOTOR01.RUN', 'KHONG.CO'];

function online() {
  const dev: MockDevice = createMockDevice({ latency: false });
  for (const u of ['kysu1', 'xem1', 'admin']) dev.control.setPassword(u, `${PW}-${u}`);
  const session = new DeviceSession({
    link: dev,
    createSocket: monitorSocket(dev),
    fetch: monitorFetch(dev),
    random: () => 1,
  });
  const events: SessionEvent[] = [];
  session.subscribe((e) => events.push(e));
  session.setTags(TAGS);
  const states = () => events.flatMap((e) => (e.type === 'state' ? [e.state] : []));
  const calls = (cmd: string) => dev.control.calls.filter((c) => c.cmd === cmd);
  return { dev, session, events, states, calls };
}
type Online = ReturnType<typeof online>;

/** Thêm thiết bị giả vào danh sách đã lưu (như Thêm theo địa chỉ). */
async function addKnown(dev: MockDevice, name: string): Promise<KnownDevice> {
  const r = await dev.addDevice({ host: dev.control.device(name).ip });
  if (isDeviceError(r)) throw new Error(r.error);
  return r;
}

/** Đã ghim từ trước (lần Online trước). */
async function pinnedKnown(dev: MockDevice, name: string): Promise<KnownDevice> {
  const k = await addKnown(dev, name);
  const p = await dev.probe(k.id);
  if (isDeviceError(p)) throw new Error(p.error);
  const r = await dev.pin(k.id, p.fingerprint);
  if (isDeviceError(r)) throw new Error(r.error);
  return r;
}

/** Cho các bước bất đồng bộ của thiết bị giả chạy (dữ liệu sống mở sau 20 ms, delta mỗi 500 ms). */
const settle = (ms = 60) => vi.advanceTimersByTimeAsync(ms);

async function toOnline(o: Online, name = 'BL335-01', user = 'kysu1') {
  const k = await pinnedKnown(o.dev, name);
  o.session.goOnline(k);
  await settle();
  expect(o.session.state).toBe('login');
  await o.session.login(user, `${PW}-${user}`);
  await settle(200);
  expect(o.session.state).toBe('monitoring');
  return k;
}

/** Mọi chuỗi trong dữ liệu của phiên (kể cả trường riêng): để kiểm mật khẩu không bị giữ lại. */
function strings(x: unknown, seen = new Set<unknown>()): string[] {
  if (typeof x === 'string') return [x];
  if (x === null || typeof x !== 'object' || seen.has(x)) return [];
  seen.add(x);
  const values = x instanceof Map ? [...x.values()] : x instanceof Set ? [...x] : Object.values(x);
  return values.flatMap((v) => strings(v, seen));
}

describe('DeviceSession — chế độ online (feature 005)', () => {
  it('lần đầu: idle → probing → pin-confirm → login → connecting → monitoring, qua HTTPS theo id', async () => {
    const o = online();
    const k = await addKnown(o.dev, 'BL335-01');
    const fp = o.dev.control.device('BL335-01').fingerprint;
    expect(o.session.mode).toBe('monitor');
    o.session.goOnline(k);
    expect(o.session.state).toBe('probing');
    expect(o.session.mode).toBe('online');
    expect(o.session.deviceId).toBe(k.id);
    await settle();
    expect(o.session.state).toBe('pin-confirm');
    expect(o.session.probe).toMatchObject({ fingerprint: fp, pinned: null, state: 'unpinned' });
    // Chưa xác nhận thì không đi tiếp (FR-008).
    await settle(10_000);
    expect(o.session.state).toBe('pin-confirm');
    expect(o.calls('device_pin')).toHaveLength(0);
    await o.session.confirmPin();
    expect(o.calls('device_pin')[0].args).toEqual({ id: k.id, fingerprint: fp });
    expect(o.session.state).toBe('login');
    await o.session.login('kysu1', `${PW}-kysu1`);
    expect(o.session.state).toBe('connecting');
    expect(o.session.auth).toEqual({
      user: 'kysu1',
      role: 'engineer',
      idleTimeoutS: 1800,
      maxLifetimeS: 43200,
    });
    expect(o.session.features).toEqual([
      'auth',
      'deploy',
      'upload',
      'restore',
      'diagnostics',
      'audit',
    ]);
    await settle(200);
    expect(o.session.state).toBe('monitoring');
    expect(o.session.address).toBe('https://192.168.1.110:8443');
    expect(o.states()).toEqual(['probing', 'pin-confirm', 'login', 'connecting', 'monitoring']);
    expect(o.session.values.get('TANK01.LEVEL')).toMatchObject({ value: 42, quality: 'GOOD' });
    expect([...o.session.unknown]).toEqual(['KHONG.CO']);
    expect(o.session.info).toMatchObject({ runtimeVersion: '0.4.0' });
    // Dữ liệu sống và system/info đi theo id (wss, HTTPS có ghim), không theo địa chỉ HTTP.
    expect(o.calls('live_open').map((c) => c.args.target)).toEqual([{ id: k.id }]);
    expect(o.calls('device_get').map((c) => c.args.path)).toContain('/api/v1/system/info');
    expect(o.calls('monitor_get')).toHaveLength(0);
    o.session.disconnect();
  });

  it('ghim khớp → login (không hỏi ghim lại); còn phiên Rust (Online lại sau khi ngắt) → vào thẳng', async () => {
    const o = online();
    const k = await toOnline(o);
    expect(o.states().filter((s) => s === 'pin-confirm')).toEqual([]);
    o.session.disconnect();
    expect(o.session.state).toBe('idle');
    expect(o.session.auth).toBeNull();
    o.session.goOnline(k);
    await settle(200);
    expect(o.session.state).toBe('monitoring');
    expect(o.session.auth?.user).toBe('kysu1');
    expect(o.calls('device_login')).toHaveLength(1);
    o.session.disconnect();
  });

  it('ghim không khớp → error cert-mismatch kèm F và G, không đăng nhập; gỡ ghim (xác nhận rõ) → dò lại, xác nhận G', async () => {
    const o = online();
    const k = await pinnedKnown(o.dev, 'BL335-01');
    const f = k.pin!.fingerprint;
    const g = o.dev.control.rotateCert('BL335-01');
    o.session.goOnline(k);
    await settle();
    expect(o.session.state).toBe('error');
    expect(o.session.error).toBe('cert-mismatch');
    expect(o.session.mismatch).toEqual({ pinned: f, seen: g });
    expect(o.calls('device_login')).toHaveLength(0);
    await o.session.unpin();
    expect(o.calls('device_unpin')[0].args).toEqual({ id: k.id, fingerprint: f });
    await settle();
    expect(o.session.state).toBe('pin-confirm');
    expect(o.session.probe).toMatchObject({ fingerprint: g, state: 'unpinned' });
    expect(o.session.mismatch).toBeNull();
  });

  it('cổng HTTPS không trả lời, HTTP là runtime < 0.4.0 → theo dõi chỉ đọc (mode monitor), mã runtime-old (FR-035)', async () => {
    const o = online();
    const k = await addKnown(o.dev, 'BL335-07');
    o.session.goOnline(k);
    await settle();
    expect(o.session.mode).toBe('monitor');
    expect(o.session.notice).toBe('runtime-old');
    expect(o.session.deviceId).toBe(k.id);
    expect(o.session.address).toBe('http://192.168.1.117:8080');
    expect(['connecting', 'monitoring']).toContain(o.session.state);
    await settle(200);
    expect(o.session.state).toBe('monitoring');
    expect(o.session.auth).toBeNull();
    expect(o.session.info).toMatchObject({ runtimeVersion: '0.3.0' });
    expect(o.calls('live_open').map((c) => c.args.target)).toEqual([
      { address: '192.168.1.117:8080' },
    ]);
    expect(o.states()).toContain('connecting');
    o.session.disconnect();
    expect(o.session.notice).toBeNull();
  });

  it('T085b: cổng đã lưu trả lời HTTP thường (not-tls), Rust lưu cổng đó làm httpPort (runtime cũ thêm theo địa chỉ với cổng HTTP, port-forward :9080) → đọc lại thiết bị, theo dõi chỉ đọc qua cổng đó, runtime-old', async () => {
    const o = online();
    o.dev.control.setHttpPort('BL335-07', 9080);
    const k = await o.dev.addDevice({ host: '192.168.1.117', httpsPort: 9080 });
    if (isDeviceError(k)) throw new Error(k.error);
    expect(k.httpPort).toBe(8080);
    o.session.goOnline(k);
    await settle();
    expect(o.session.mode).toBe('monitor');
    expect(o.session.notice).toBe('runtime-old');
    expect(o.session.address).toBe('http://192.168.1.117:9080');
    expect(o.session.device).toMatchObject({ id: k.id, httpsPort: 9080, httpPort: 9080 });
    await settle(200);
    expect(o.session.state).toBe('monitoring');
    expect(o.session.info).toMatchObject({ runtimeVersion: '0.3.0' });
    expect(o.calls('live_open').map((c) => c.args.target)).toEqual([
      { address: '192.168.1.117:9080' },
    ]);
    o.session.disconnect();
  });

  it('cổng HTTPS không trả lời, HTTP cũng không (hoặc runtime mới) → https-unreachable; lỗi TLS → tls', async () => {
    const o = online();
    const k = await addKnown(o.dev, 'BL335-01');
    const wrong = await o.dev.updateDevice({ id: k.id, httpsPort: 9443 });
    if (isDeviceError(wrong)) throw new Error(wrong.error);
    o.session.goOnline(wrong);
    await settle();
    expect(o.session.state).toBe('error');
    expect(o.session.error).toBe('https-unreachable');
    vi.spyOn(o.dev, 'probe').mockResolvedValueOnce({ error: 'tls', detail: 'bad handshake' });
    o.session.goOnline(k);
    await settle();
    expect(o.session.error).toBe('tls');
  });

  it('AUTH_FAILED ở lại login kèm lý do; khóa tạm kèm retryAfterS; chưa có tài khoản; mật khẩu không bị giữ', async () => {
    const o = online();
    const k = await pinnedKnown(o.dev, 'BL335-02');
    o.session.goOnline(k);
    await settle();
    for (let i = 0; i < 5; i++) {
      await o.session.login('xem1', 'mat-khau-sai-123456');
      expect(o.session.state).toBe('login');
      expect(o.session.loginError?.code).toBe('auth-failed');
    }
    await o.session.login('xem1', `${PW}-xem1`);
    expect(o.session.state).toBe('login');
    expect(o.session.loginError).toMatchObject({ code: 'locked', retryAfterS: 300 });
    expect(o.session.busy).toBe(false);
    const all = strings(o.session).join('\n');
    expect(all).not.toContain(PW);
    expect(all).not.toContain('mat-khau-sai-123456');
    o.dev.control.setSetupRequired('BL335-02', true);
    await o.session.login('kysu1', `${PW}-kysu1`);
    expect(o.session.loginError?.code).toBe('setup-required');
  });

  it('đang theo dõi gặp SESSION_EXPIRED → relogin: dữ liệu sống vẫn chạy; đăng nhập lại → monitoring, không mở kết nối mới', async () => {
    const o = online();
    await toOnline(o);
    o.dev.control.expireSession('BL335-01');
    await settle(5000);
    expect(o.session.state).toBe('relogin');
    const before = o.session.values.get('TANK01.LEVEL');
    await settle(1100);
    const after = o.session.values.get('TANK01.LEVEL');
    expect(after?.quality).toBe('GOOD');
    expect(after?.ts).not.toBe(before?.ts);
    await o.session.login('kysu1', `${PW}-kysu1`);
    expect(o.session.state).toBe('monitoring');
    expect(o.calls('live_open')).toHaveLength(1);
    expect(o.states().slice(-2)).toEqual(['relogin', 'monitoring']);
    o.session.disconnect();
  });

  it('SESSION_INVALID (tài khoản tắt, đổi IP) → idle kèm lý do, đóng kết nối', async () => {
    const o = online();
    await toOnline(o);
    o.dev.control.invalidateSession('BL335-01');
    await settle(5000);
    expect(o.session.state).toBe('idle');
    expect(o.session.error).toBe('session-invalid');
    expect(o.session.auth).toBeNull();
    expect(o.calls('live_close')).toHaveLength(1);
  });

  it('chứng chỉ đổi khi kết nối lại → error cert-mismatch kèm F và G', async () => {
    const o = online();
    const k = await toOnline(o);
    const g = o.dev.control.rotateCert('BL335-01');
    o.dev.control.dropLive('BL335-01');
    await settle(10);
    expect(o.session.state).toBe('lost');
    await settle(1100);
    expect(o.session.state).toBe('error');
    expect(o.session.error).toBe('cert-mismatch');
    expect(o.session.mismatch).toEqual({ pinned: k.pin!.fingerprint, seen: g });
  });

  it('đăng xuất: Rust xóa token, về idle; Online lại phải đăng nhập', async () => {
    const o = online();
    const k = await toOnline(o);
    await o.session.logout();
    expect(o.calls('device_logout')).toHaveLength(1);
    expect(o.session.state).toBe('idle');
    expect(o.session.auth).toBeNull();
    o.session.goOnline(k);
    await settle();
    expect(o.session.state).toBe('login');
    o.session.disconnect();
  });

  it('thiết bị thêm theo địa chỉ (tên mặc định là host): đăng nhập xong mang tên thiết bị báo (T085a)', async () => {
    const o = online();
    const k = await addKnown(o.dev, 'TRAM-XA');
    expect(k.name).toBe('10.8.0.21');
    o.session.goOnline(k);
    await settle();
    await o.session.confirmPin();
    expect(o.session.device?.name).toBe('10.8.0.21');
    await o.session.login('kysu1', `${PW}-kysu1`);
    expect(o.session.device?.name).toBe('TRAM-XA');
    expect(o.session.state).toBe('connecting');
    await settle(200);
    expect(o.session.state).toBe('monitoring');
    o.session.disconnect();
  });

  it('theo dõi theo địa chỉ (trang Thiết bị): https:// không theo dõi được, không gọi Rust (T085a)', () => {
    const o = online();
    o.session.connect('https://192.168.1.110:8443');
    expect(o.session.state).toBe('error');
    expect(o.session.error).toBe('invalid-address');
    expect(o.calls('monitor_get')).toHaveLength(0);
    expect(o.calls('live_open')).toHaveLength(0);
  });

  it('chế độ theo dõi của 004 (Ctrl+K theo địa chỉ): mode monitor, không có deviceId, auth, features', async () => {
    const o = online();
    await toOnline(o);
    o.session.connect('192.168.1.110');
    expect(o.session.mode).toBe('monitor');
    expect(o.session.deviceId).toBeNull();
    expect(o.session.auth).toBeNull();
    expect(o.session.features).toEqual([]);
    expect(o.session.notice).toBeNull();
    await settle(200);
    expect(o.session.state).toBe('monitoring');
    expect(o.calls('monitor_get').map((c) => c.args.address)).toContain('192.168.1.110:8080');
    expect(o.calls('live_open').at(-1)?.args.target).toEqual({ address: '192.168.1.110:8080' });
    o.session.disconnect();
  });
});
