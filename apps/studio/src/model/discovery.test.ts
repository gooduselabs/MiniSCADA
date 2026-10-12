// Kết quả tìm thiết bị trong hộp thoại Thiết bị trong mạng (feature 005, T077, data-model §1, contract
// discovery §5, §5a, spec US1-1, Edge Cases): kết quả đến dần; gộp theo (deviceId, IP); trùng tên tách được
// nhờ MAC và IP; sắp theo tên rồi IP; card VPN mờ kèm gợi ý; không thấy gì thì gợi ý tường lửa và Thêm theo
// địa chỉ; fingerprint của gói tìm chỉ để tham khảo, khác kết quả dò thì cảnh báo đỏ; Tìm lại.
import { describe, expect, it, vi } from 'vitest';
import type {
  DeviceLink,
  DiscoveredDevice,
  DiscoverSummary,
  KnownDevice,
  NetInterface,
  ProbeResult,
} from '../platform/device-types.ts';
import {
  compareDiscovered,
  compareIp,
  deviceRows,
  DiscoveryScan,
  ifaceOptions,
  mergeFound,
  scanHint,
  statusKind,
} from './discovery.ts';

const FP1 = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);

function found(over: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    iface: 0,
    ip: '192.168.1.110',
    deviceId: 'dev-1',
    name: 'BL335-01',
    model: 'BL335',
    mac: '02:4E:1C:5A:33:01',
    prefix: 24,
    runtime: '0.4.0',
    api: '1.0.0',
    status: 'running',
    project: { id: 'tank-demo', name: 'Tank', version: '0.1.0', digest: 'sha256:x' },
    httpsPort: 8443,
    httpPort: 8080,
    fingerprint: FP1,
    receivedAt: 1,
    ...over,
  };
}

function known(over: Partial<KnownDevice> = {}): KnownDevice {
  return {
    id: 'k1',
    name: 'BL335-01',
    host: '192.168.1.110',
    httpsPort: 8443,
    httpPort: 8080,
    deviceId: 'dev-1',
    mac: '02:4E:1C:5A:33:01',
    pin: null,
    lastUser: null,
    lastSeenAt: null,
    lastRuntime: null,
    ...over,
  };
}

/** DeviceLink chỉ có `discover`, do test điều khiển từng gói trả lời. */
function scanLink() {
  const runs: Array<{
    ifaces: number[] | null;
    onFound: (d: DiscoveredDevice) => void;
    finish: (s: DiscoverSummary) => void;
    fail: (e: unknown) => void;
  }> = [];
  const link = {
    discover: (ifaces: number[] | null, onFound: (d: DiscoveredDevice) => void) =>
      new Promise<DiscoverSummary>((finish, fail) => runs.push({ ifaces, onFound, finish, fail })),
  } as unknown as DeviceLink;
  return { link, runs };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('gộp và sắp kết quả', () => {
  it('gộp theo (deviceId, IP): ba gói trả lời của một thiết bị thành một dòng, bản mới thay bản cũ', () => {
    let list: DiscoveredDevice[] = [];
    list = mergeFound(list, found({ receivedAt: 1 }));
    list = mergeFound(list, found({ receivedAt: 2, status: 'activating' }));
    list = mergeFound(list, found({ receivedAt: 3, status: 'running' }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ receivedAt: 3, status: 'running' });
    // Cùng thiết bị trả lời trên hai card (hai IP): hai dòng.
    list = mergeFound(list, found({ iface: 1, ip: '10.0.0.110' }));
    expect(list).toHaveLength(2);
  });

  it('IPv4 so theo số: 192.168.1.9 trước 192.168.1.10', () => {
    expect(compareIp('192.168.1.9', '192.168.1.10')).toBeLessThan(0);
    expect(compareIp('10.0.0.1', '9.255.255.255')).toBeGreaterThan(0);
    expect(compareIp('192.168.1.10', '192.168.1.10')).toBe(0);
  });

  it('sắp theo tên rồi IP; hai thiết bị trùng tên đánh dấu để hiện MAC, tách được nhờ MAC và IP', () => {
    const list = [
      found({ name: 'BL335-02', deviceId: 'd2', ip: '192.168.1.111' }),
      found({ name: 'Bom', deviceId: 'd3', ip: '192.168.1.10', mac: '02:00:00:00:00:10' }),
      found({ name: 'bom', deviceId: 'd4', ip: '192.168.1.9', mac: '02:00:00:00:00:09' }),
      found({ name: 'BL335-01', deviceId: 'd1', ip: '192.168.1.110' }),
    ];
    const rows = deviceRows(list, []);
    expect(rows.map((r) => (r.kind === 'found' ? r.device.ip : ''))).toEqual([
      '192.168.1.110',
      '192.168.1.111',
      '192.168.1.9',
      '192.168.1.10',
    ]);
    expect(rows.map((r) => r.sameName)).toEqual([false, false, true, true]);
    expect(new Set(rows.map((r) => r.key)).size).toBe(4);
  });

  it('thiết bị đã lưu: khớp theo deviceId (kể cả đổi IP) hoặc host:cổng; mục đã lưu không trả lời đứng sau', () => {
    const saved = [
      known({ id: 'k1', deviceId: 'dev-1', host: '192.168.1.50' }),
      known({ id: 'k2', deviceId: null, name: 'Tram xa', host: '10.8.0.21' }),
      known({ id: 'k3', deviceId: null, name: 'BL335-02', host: '192.168.1.111' }),
    ];
    const rows = deviceRows(
      [found(), found({ deviceId: 'dev-2', name: 'BL335-02', ip: '192.168.1.111' })],
      saved,
    );
    expect(rows.map((r) => [r.kind, r.known?.id ?? null])).toEqual([
      ['found', 'k1'],
      ['found', 'k3'],
      ['saved', 'k2'],
    ]);
  });

  it('trạng thái lạ vẫn hiện thiết bị, ghi "không rõ" (discovery §5a)', () => {
    expect(statusKind('running')).toBe('running');
    expect(statusKind('no-project')).toBe('no-project');
    expect(statusKind('project-error')).toBe('project-error');
    expect(statusKind('activating')).toBe('activating');
    expect(statusKind('updating')).toBe('unknown');
    expect(statusKind('toString')).toBe('unknown');
  });
});

describe('card mạng, gợi ý', () => {
  const NICS: NetInterface[] = [
    {
      index: 0,
      name: 'Ethernet 2',
      address: '192.168.1.20',
      prefix: 24,
      broadcast: '192.168.1.255',
      canBroadcast: true,
      hint: null,
    },
    {
      index: 2,
      name: 'WireGuard',
      address: '10.8.0.2',
      prefix: 32,
      broadcast: null,
      canBroadcast: false,
      hint: 'vpn',
    },
    {
      index: 3,
      name: 'Link',
      address: '169.254.1.2',
      prefix: 31,
      broadcast: null,
      canBroadcast: false,
      hint: null,
    },
  ];

  it('card VPN và card không broadcast hiện mờ (không chọn được), kèm lý do để gợi ý Thêm theo địa chỉ', () => {
    expect(ifaceOptions(NICS)).toEqual([
      {
        index: 0,
        name: 'Ethernet 2',
        cidr: '192.168.1.20/24',
        subnet: '192.168.1.0/24',
        usable: true,
        reason: null,
      },
      {
        index: 2,
        name: 'WireGuard',
        cidr: '10.8.0.2/32',
        subnet: '10.8.0.2/32',
        usable: false,
        reason: 'vpn',
      },
      {
        index: 3,
        name: 'Link',
        cidr: '169.254.1.2/31',
        subnet: '169.254.1.2/31',
        usable: false,
        reason: 'no-broadcast',
      },
    ]);
  });

  it('không thấy thiết bị nào sau lượt quét: gợi ý kiểm tường lửa Windows và Thêm theo địa chỉ; card lỗi thì báo', () => {
    expect(scanHint({ state: 'scanning', rows: [], summary: null })).toBeNull();
    expect(
      scanHint({ state: 'done', rows: [], summary: { scanned: 1, found: 0, failed: [] } }),
    ).toBe('none-found');
    expect(
      scanHint({
        state: 'done',
        rows: [],
        summary: { scanned: 0, found: 0, failed: [{ index: 2, reason: 'send' }] },
      }),
    ).toBe('iface-failed');
    expect(
      scanHint({ state: 'done', rows: [found()], summary: { scanned: 1, found: 1, failed: [] } }),
    ).toBeNull();
  });

  it('fingerprint của gói tìm chỉ để tham khảo: khác kết quả dò thì cảnh báo đỏ', () => {
    const probe = (discovered: string | null): ProbeResult => ({
      fingerprint: FP1,
      pinned: null,
      state: 'unpinned',
      discovered,
    });
    expect(compareDiscovered(probe(FP1))).toBe('same');
    expect(compareDiscovered(probe(FP2))).toBe('differs');
    expect(compareDiscovered(probe(null))).toBe('unknown');
  });
});

describe('lượt quét (DiscoveryScan)', () => {
  it('kết quả đến dần; người nghe được báo mỗi lần; xong thì có tóm tắt', async () => {
    const { link, runs } = scanLink();
    const scan = new DiscoveryScan(link, () => 1000);
    const seen = vi.fn();
    scan.subscribe(seen);
    const done = scan.start(null);
    expect(scan.state).toBe('scanning');
    expect(scan.startedAt).toBe(1000);
    expect(runs[0].ifaces).toBeNull();
    runs[0].onFound(found({ name: 'BL335-02', deviceId: 'd2', ip: '192.168.1.111' }));
    expect(scan.rows.map((d) => d.name)).toEqual(['BL335-02']);
    runs[0].onFound(found());
    runs[0].onFound(found({ receivedAt: 9 }));
    expect(scan.rows.map((d) => d.name)).toEqual(['BL335-01', 'BL335-02']);
    expect(seen.mock.calls.length).toBeGreaterThanOrEqual(4);
    runs[0].finish({ scanned: 1, found: 2, failed: [] });
    await done;
    expect(scan.state).toBe('done');
    expect(scan.summary).toEqual({ scanned: 1, found: 2, failed: [] });
  });

  it('Tìm lại: xóa kết quả cũ, quét theo card đã chọn; gói của lượt cũ tới muộn thì bỏ', async () => {
    const { link, runs } = scanLink();
    const scan = new DiscoveryScan(link);
    void scan.start(null);
    runs[0].onFound(found());
    runs[0].finish({ scanned: 2, found: 1, failed: [] });
    await flush();
    void scan.start([0]);
    expect(scan.rows).toEqual([]);
    expect(runs[1].ifaces).toEqual([0]);
    runs[0].onFound(found({ name: 'cu', deviceId: 'old' }));
    expect(scan.rows).toEqual([]);
    runs[1].onFound(found());
    expect(scan.rows).toHaveLength(1);
  });

  it('đang có lượt quét khác (busy): báo lỗi, không treo', async () => {
    const { link, runs } = scanLink();
    const scan = new DiscoveryScan(link);
    const done = scan.start(null);
    runs[0].fail({ error: 'busy' });
    await done;
    expect(scan.state).toBe('error');
    expect(scan.error).toBe('busy');
  });
});
