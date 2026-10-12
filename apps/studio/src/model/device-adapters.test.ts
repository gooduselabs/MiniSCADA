// Bộ chuyển giữa lệnh Rust của feature 005 và mã theo dõi của 004 (T075, contracts/tauri-commands.md §6–7,
// §9, research R6): `FetchFn` dựa trên `monitorGet`/`get` cho `checkDevice` (giữ chữ ký), `SocketLike` bọc
// `live_open`/`live_send`/`live_close` cho `LiveConnection`; `@mat/live-client` không đổi giao diện.
import { LiveConnection, type SocketLike } from '@mat/live-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApiResult,
  DeviceError,
  DeviceLink,
  LiveEvent,
  LiveTarget,
} from '../platform/device-types.ts';
import {
  addressOf,
  liveSocket,
  monitorFetch,
  monitorSocket,
  onlineFetch,
  onlineSocket,
  type LiveIpc,
} from './device-adapters.ts';
import { checkDevice, DEVICE_TIMEOUT_MS } from './device.ts';

/** Ba lệnh IPC giả: mỗi lần mở giữ hàm đẩy sự kiện và hàm trả `liveId`. */
class FakeIpc implements LiveIpc {
  opens: Array<{
    target: LiveTarget;
    emit: (e: LiveEvent) => void;
    resolve: (id: number) => void;
    reject: (e: unknown) => void;
  }> = [];
  sent: Array<[number, string]> = [];
  closed: Array<[number, number | undefined, string | undefined]> = [];

  open(target: LiveTarget, onEvent: (e: LiveEvent) => void): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.opens.push({ target, emit: onEvent, resolve, reject });
    });
  }
  async send(liveId: number, text: string): Promise<void> {
    this.sent.push([liveId, text]);
  }
  async close(liveId: number, code?: number, reason?: string): Promise<void> {
    this.closed.push([liveId, code, reason]);
  }
  last() {
    return this.opens[this.opens.length - 1];
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** Ghi lại mọi lời gọi handler của SocketLike theo thứ tự. */
function record(s: SocketLike) {
  const log: unknown[] = [];
  s.onopen = () => log.push('open');
  s.onmessage = (ev) => log.push(['message', ev.data]);
  s.onclose = (ev) => log.push(['close', ev.code, (ev as { reason?: string }).reason]);
  return log;
}

function fakeLink(over: Partial<DeviceLink> = {}): DeviceLink {
  const no = () => {
    throw new Error('không dùng trong test này');
  };
  return {
    netInterfaces: no,
    discover: no,
    devices: no,
    addDevice: no,
    updateDevice: no,
    forgetDevice: no,
    probe: no,
    pin: no,
    unpin: no,
    login: no,
    logout: no,
    session: no,
    get: no,
    post: no,
    monitorGet: no,
    openLive: no,
    buildPackage: no,
    deploy: no,
    restore: no,
    fetchPackage: no,
    readPackageFile: no,
    discardPackage: no,
    extractPackage: no,
    ...over,
  };
}

const INFO = { runtimeVersion: '0.3.0', protocolVersion: '1.0.0', clients: 1, maxClients: 10 };

describe('liveSocket: SocketLike bọc live_open, live_send, live_close', () => {
  it('sự kiện open, message, close đi đúng thứ tự tới handler; close giữ mã và lý do', async () => {
    const ipc = new FakeIpc();
    const s = liveSocket(ipc, { id: 'd1' });
    const log = record(s);
    expect(ipc.last().target).toEqual({ id: 'd1' });
    ipc.last().resolve(1);
    await flush();
    ipc.last().emit({ kind: 'open' });
    ipc.last().emit({ kind: 'message', data: '{"type":"hello"}' });
    ipc.last().emit({ kind: 'message', data: '{"type":"snapshot"}' });
    ipc.last().emit({ kind: 'close', code: 4429, reason: 'full' });
    expect(log).toEqual([
      'open',
      ['message', '{"type":"hello"}'],
      ['message', '{"type":"snapshot"}'],
      ['close', 4429, 'full'],
    ]);
  });

  it('send trước khi biết liveId: giữ lại, gửi đúng thứ tự khi live_open trả lời', async () => {
    const ipc = new FakeIpc();
    const s = liveSocket(ipc, { address: '10.0.0.9:8080' });
    record(s);
    // Sự kiện open có thể tới trước kết quả của live_open: LiveConnection gửi subscribe ngay trong onopen.
    ipc.last().emit({ kind: 'open' });
    s.send('a');
    s.send('b');
    expect(ipc.sent).toEqual([]);
    ipc.last().resolve(7);
    await flush();
    expect(ipc.sent).toEqual([
      [7, 'a'],
      [7, 'b'],
    ]);
    s.send('c');
    await flush();
    expect(ipc.sent.at(-1)).toEqual([7, 'c']);
  });

  it('close: gọi live_close với mã và lý do (mặc định để Rust đặt 1000); close sớm thì đóng khi có liveId', async () => {
    const ipc = new FakeIpc();
    const a = liveSocket(ipc, { id: 'd1' });
    ipc.last().resolve(11);
    await flush();
    a.close();
    a.close(1000, 'lần hai không gửi lại');
    expect(ipc.closed).toEqual([[11, undefined, undefined]]);

    const b = liveSocket(ipc, { id: 'd1' });
    const log = record(b);
    b.close(1000, 'stop');
    b.send('không gửi sau khi đóng');
    expect(ipc.closed).toHaveLength(1);
    ipc.last().resolve(12);
    await flush();
    expect(ipc.closed.at(-1)).toEqual([12, 1000, 'stop']);
    expect(ipc.sent).toEqual([]);
    // Đã đóng thì không báo open/message nữa; close của Rust vẫn tới (một lần).
    ipc.last().emit({ kind: 'open' });
    ipc.last().emit({ kind: 'close', code: 1000, reason: '' });
    ipc.last().emit({ kind: 'close', code: 1006, reason: 'x' });
    expect(log).toEqual([['close', 1000, '']]);
  });

  it('live_open bị từ chối: báo close 1006, lý do là mã lỗi', async () => {
    const ipc = new FakeIpc();
    const s = liveSocket(ipc, { id: 'gone' });
    const log = record(s);
    ipc.last().reject('no-such-device');
    await flush();
    expect(log).toEqual([['close', 1006, 'no-such-device']]);
    ipc.last().emit({ kind: 'close', code: 1006, reason: 'again' });
    expect(log).toHaveLength(1);
  });

  it('bắt tay lỗi: Rust báo close 1006 kèm mã (cert-mismatch)', async () => {
    const ipc = new FakeIpc();
    const s = liveSocket(ipc, { id: 'd1' });
    const log = record(s);
    ipc.last().resolve(2);
    await flush();
    ipc.last().emit({ kind: 'close', code: 1006, reason: 'cert-mismatch' });
    expect(log).toEqual([['close', 1006, 'cert-mismatch']]);
  });
});

describe('createSocket cho LiveConnection', () => {
  it('addressOf: lấy host:cổng đúng như đã viết (giữ cả cổng mặc định)', () => {
    expect(addressOf('ws://192.168.1.110:8080/api/v1/live')).toBe('192.168.1.110:8080');
    expect(addressOf('http://bl335.local:80/api/v1/system/info')).toBe('bl335.local:80');
    expect(addressOf('ws://[::1]:9/x')).toBe('[::1]:9');
  });

  // T085a: chế độ theo dõi chỉ đi HTTP. URL https://, wss:// giữ nguyên scheme để Rust từ chối (bad-address,
  // contract §12.7), không bị bỏ scheme rồi gọi HTTP.
  it('addressOf: URL https://, wss:// giữ scheme (không tự hạ xuống HTTP)', async () => {
    expect(addressOf('https://192.168.1.110:8443/api/v1/system/info')).toBe(
      'https://192.168.1.110:8443',
    );
    expect(addressOf('wss://192.168.1.110:8443/api/v1/live')).toBe('wss://192.168.1.110:8443');
    const openLive = vi.fn(() => ({}) as SocketLike);
    const monitorGet = vi.fn(async (): Promise<DeviceError> => ({ error: 'bad-address' }));
    const link = fakeLink({ openLive, monitorGet });
    monitorSocket(link)('wss://192.168.1.110:8443/api/v1/live');
    expect(openLive).toHaveBeenCalledWith({ address: 'wss://192.168.1.110:8443' });
    await expect(
      monitorFetch(link)('https://192.168.1.110:8443/api/v1/system/info'),
    ).rejects.toThrow(/bad-address/);
    expect(monitorGet).toHaveBeenCalledWith('https://192.168.1.110:8443');
  });

  it('monitorSocket: ws://host:port/api/v1/live → openLive({ address: host:port })', () => {
    const openLive = vi.fn(() => ({}) as SocketLike);
    const create = monitorSocket(fakeLink({ openLive }));
    create('ws://192.168.1.110:9080/api/v1/live');
    expect(openLive).toHaveBeenCalledWith({ address: '192.168.1.110:9080' });
  });

  it('onlineSocket: mở theo id của thiết bị đã lưu (wss có ghim do Rust làm)', () => {
    const openLive = vi.fn(() => ({}) as SocketLike);
    onlineSocket(fakeLink({ openLive }), 'dev-1')('wss://192.168.1.110:8443/api/v1/live');
    expect(openLive).toHaveBeenCalledWith({ id: 'dev-1' });
  });

  it('LiveConnection chạy trên SocketLike bọc IPC: subscribe qua live_send, snapshot → live, 4429 → full', async () => {
    const ipc = new FakeIpc();
    const link = fakeLink({ openLive: (t) => liveSocket(ipc, t) });
    const conn = new LiveConnection({
      url: 'ws://10.0.0.9:8080/api/v1/live',
      tags: ['A', 'B'],
      createSocket: monitorSocket(link),
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    conn.start();
    expect(conn.state).toBe('connecting');
    expect(ipc.last().target).toEqual({ address: '10.0.0.9:8080' });
    ipc.last().resolve(1);
    await flush();
    ipc.last().emit({ kind: 'open' });
    await flush();
    expect(conn.state).toBe('open');
    const sub = JSON.parse(ipc.sent[0][1]) as { type: string; requestId: string; tags: string[] };
    expect(sub).toMatchObject({ type: 'subscribe', tags: ['A', 'B'] });
    const msg = (m: object) => ipc.last().emit({ kind: 'message', data: JSON.stringify(m) });
    msg({
      type: 'hello',
      protocolVersion: '1.1.0',
      serverVersion: '0.4.0',
      maxClients: 10,
      heartbeatMs: 5000,
      timeoutMs: 15000,
    });
    msg({
      type: 'snapshot',
      subscriptionId: sub.requestId,
      sequence: 1,
      ts: 1,
      tags: [{ id: 'A', value: 1, quality: 'GOOD' }],
      unknown: ['B'],
    });
    expect(conn.state).toBe('live');
    expect(conn.unknown).toEqual(['B']);
    ipc.last().emit({ kind: 'close', code: 4429, reason: '' });
    expect(conn.state).toBe('full');
    conn.stop();
  });
});

describe('FetchFn cho checkDevice (giữ chữ ký FetchFn)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('monitorFetch: system/info qua monitor_get theo host:cổng', async () => {
    const monitorGet = vi.fn(async (): Promise<ApiResult> => ({ status: 200, body: INFO }));
    const r = await checkDevice(
      'http://192.168.1.110:8080',
      monitorFetch(fakeLink({ monitorGet })),
    );
    expect(monitorGet).toHaveBeenCalledWith('192.168.1.110:8080');
    expect(r).toEqual({ ok: true, info: INFO });
  });

  it('monitorFetch: mã lỗi của monitor_get thành đúng mã của checkDevice', async () => {
    const cases: Array<[ApiResult | DeviceError, unknown]> = [
      [
        { error: 'network', detail: 'connection refused' },
        { ok: false, code: 'network', detail: 'connection refused' },
      ],
      [
        { error: 'http', detail: 500 },
        { ok: false, code: 'http', detail: '500' },
      ],
      [
        { status: 503, body: null },
        { ok: false, code: 'http', detail: '503' },
      ],
      [{ error: 'bad-response' }, expect.objectContaining({ ok: false, code: 'bad-response' })],
      [
        { status: 200, body: [1, 2] },
        { ok: false, code: 'bad-response' },
      ],
      [
        { status: 200, body: 'x' },
        { ok: false, code: 'bad-response' },
      ],
    ];
    for (const [answer, expected] of cases) {
      const link = fakeLink({ monitorGet: async () => answer });
      expect(await checkDevice('http://h:1', monitorFetch(link)), JSON.stringify(answer)).toEqual(
        expected,
      );
    }
  });

  it('monitorFetch: "timeout" của Rust → checkDevice báo timeout đúng hạn của nó', async () => {
    const link = fakeLink({ monitorGet: async () => ({ error: 'timeout' }) });
    let result: unknown = null;
    void checkDevice('http://h:1', monitorFetch(link)).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(DEVICE_TIMEOUT_MS - 1);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toEqual({ ok: false, code: 'timeout' });
  });

  it('monitorFetch: chỉ đường dẫn system/info (chế độ theo dõi chỉ đọc)', async () => {
    const monitorGet = vi.fn();
    const f = monitorFetch(fakeLink({ monitorGet }));
    await expect(f('http://h:1/api/v1/projects/active')).rejects.toThrow(/bad-path/);
    expect(monitorGet).not.toHaveBeenCalled();
  });

  it('onlineFetch: system/info qua device_get theo id; lỗi phiên báo ra ngoài trước khi đổi mã', async () => {
    const get = vi.fn(async (_id: string, path: string): Promise<ApiResult | DeviceError> =>
      path === '/api/v1/system/info' ? { status: 200, body: INFO } : { error: 'bad-path' },
    );
    const errors: DeviceError[] = [];
    const f = onlineFetch(fakeLink({ get }), 'dev-1', (e) => errors.push(e));
    expect(await checkDevice('https://192.168.1.110:8443', f)).toEqual({ ok: true, info: INFO });
    expect(get).toHaveBeenCalledWith('dev-1', '/api/v1/system/info');

    get.mockResolvedValueOnce({ error: 'session-expired' });
    const r = await checkDevice('https://192.168.1.110:8443', f);
    expect(r).toEqual({ ok: false, code: 'network', detail: 'session-expired' });
    get.mockResolvedValueOnce({
      error: 'cert-mismatch',
      detail: { pinned: 'a'.repeat(64), seen: 'b'.repeat(64) },
    });
    await checkDevice('https://192.168.1.110:8443', f);
    expect(errors.map((e) => e.error)).toEqual(['session-expired', 'cert-mismatch']);
  });
});
