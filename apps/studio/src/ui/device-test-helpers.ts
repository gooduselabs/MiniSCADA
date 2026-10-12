// Thiết bị giả cho test giao diện của phần theo dõi (feature 004, US3): WebSocket và fetch giả để đưa
// phiên thiết bị duy nhất (DeviceSession) tới từng trạng thái mà không cần mạng. Không vào bản build: chỉ
// file *.test.ts import.
import type { SocketLike } from '@mat/live-client';
import { StudioApp } from '../app/app.ts';
import { DeviceSession } from '../model/device-session.ts';
import type { DeviceInfo } from '../model/device.ts';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';

export class FakeSocket implements SocketLike {
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

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number): void {
    this.closed = { code };
  }

  open(): void {
    this.onopen?.();
  }

  msg(m: object): void {
    this.onmessage?.({ data: JSON.stringify(m) });
  }

  serverClose(code: number): void {
    this.onclose?.({ code });
  }

  /** `subscribe` gần nhất client đã gửi. */
  request(): { requestId: string; tags: string[] } {
    const subs = this.sent.filter((m) => m.type === 'subscribe');
    return subs[subs.length - 1] as unknown as { requestId: string; tags: string[] };
  }

  hello(protocolVersion = '1.0.0'): void {
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
  snapshot(values: Record<string, unknown>, unknown: string[] = []): void {
    this.msg({
      type: 'snapshot',
      subscriptionId: this.request().requestId,
      sequence: ++this.seq,
      ts: 1,
      tags: Object.entries(values).map(([id, value]) => ({ id, value, quality: 'GOOD' })),
      unknown,
    });
  }

  delta(tags: Array<[number, unknown, string]>): void {
    this.msg({
      type: 'delta',
      subscriptionId: this.request().requestId,
      sequence: ++this.seq,
      ts: 2,
      tags,
    });
  }
}

/** system/info của runtime 0.3.0 chạy project mẫu, có lưu trữ với hai DB ngoài. */
export const DEVICE_INFO: DeviceInfo = {
  runtimeVersion: '0.3.0',
  protocolVersion: '1.0.0',
  clients: 3,
  maxClients: 10,
  uptimeS: 3 * 86400 + 4 * 3600 + 120,
  project: { status: 'active', projectId: 'tank-demo', projectVersion: '0.1.0' },
  historian: {
    enabled: true,
    state: 'running',
    rowsWritten: 15234,
    dbBytes: 12582912,
    dbMaxBytes: 2147483648,
    warnings: [],
    destinations: [
      { id: 'mysql-office', type: 'mysql', state: 'ok', pendingRows: 0, lagS: 0, lastError: null },
      {
        id: 'influx',
        type: 'influxdb',
        state: 'error',
        pendingRows: 1834,
        lagS: 1830,
        lastError: { code: 'connect', dbCode: null, message: 'connect refused', at: 1 },
      },
    ],
  },
};

/** Cách fetch giả trả lời system/info. */
export type FetchMode = 'ok' | 'hang' | 'fail' | 'http500';

export interface FakeDevice {
  readonly sockets: FakeSocket[];
  /** URL các lần gọi fetch. */
  readonly fetched: string[];
  /** system/info trả về (đổi được giữa chừng). */
  info: DeviceInfo;
  mode: FetchMode;
  last(): FakeSocket;
  /** Số socket chưa bị client đóng. */
  openSockets(): number;
}

export function fakeDevice(): { device: FakeDevice; session: DeviceSession } {
  const device: FakeDevice = {
    sockets: [],
    fetched: [],
    info: DEVICE_INFO,
    mode: 'ok',
    last: () => device.sockets[device.sockets.length - 1],
    openSockets: () => device.sockets.filter((s) => s.closed === null).length,
  };
  const session = new DeviceSession({
    createSocket: (url) => {
      const s = new FakeSocket(url);
      device.sockets.push(s);
      return s;
    },
    fetch: (url) => {
      device.fetched.push(url);
      if (device.mode === 'hang') return new Promise<Response>(() => undefined);
      if (device.mode === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
      const status = device.mode === 'http500' ? 500 : 200;
      return Promise.resolve(new Response(JSON.stringify(device.info), { status }));
    },
    random: () => 1, // backoff không ngẫu nhiên: lần đầu đúng 1 s
  });
  return { device, session };
}

/** Chờ chuỗi promise (fetch giả, checkDevice) chạy xong. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** App có phiên thiết bị giả; mặc định đã mở project mẫu. */
export async function newDeviceApp(
  opts: { open?: boolean; width?: number } = {},
): Promise<{ app: StudioApp; platform: MockPlatform; device: FakeDevice }> {
  const platform = createMockPlatform();
  const { device, session } = fakeDevice();
  const app = new StudioApp({
    platform,
    storage: null,
    windowWidth: opts.width ?? 1400,
    session,
    versionGate: false,
  });
  await app.start();
  if (opts.open !== false) {
    await app.run('project.open');
    await app.store.idle();
  }
  return { app, platform, device };
}

/** Giá trị mặc định của snapshot: TANK01.TEMP không có trên thiết bị. */
export const DEVICE_VALUES: Record<string, unknown> = {
  'TANK01.LEVEL': 42,
  'MOTOR01.RUN': true,
  'MOTOR01.SPEED': 1440,
  'TANK01.INFLOW': 9.5,
};

/** Ctrl+K tới địa chỉ giả rồi đưa phiên tới `monitoring` (system/info trả lời, socket mở, snapshot). */
export async function toMonitoring(
  app: StudioApp,
  device: FakeDevice,
  values: Record<string, unknown> = DEVICE_VALUES,
  unknown: string[] = ['TANK01.TEMP'],
): Promise<void> {
  if (!app.deviceAddress()) app.setDeviceAddress('192.168.1.110');
  await app.run('online.connect');
  await flush();
  device.last().open();
  device.last().hello();
  device.last().snapshot(values, unknown);
  await flush();
}
