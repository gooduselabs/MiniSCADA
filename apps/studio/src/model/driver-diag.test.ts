// Chẩn đoán driver (T197, FR-051, FR-029, R22; device-api-1.1 §5): đọc `GET /api/v1/drivers/diagnostics`; hỏi mỗi 2 s chỉ khi
// trang đang mở; giữ bản đầu khi mở trang để hiện "tăng thêm từ lúc mở" (US5-4); cây kênh › thiết bị trường; chu kỳ thực cạnh
// chu kỳ đặt, dấu quá tải (US5-3); Tag xấu kèm lý do tiếng Việt.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, DeviceError } from '../platform/device-types.ts';
import {
  DRIVER_DIAG_PERIOD_MS,
  DriverDiagFeed,
  badTagLine,
  counterRows,
  groupRows,
  parseDriverDiag,
  s7ExceptionText,
  type DriverDiag,
} from './driver-diag.ts';

const body = (over: Record<string, unknown> = {}) => ({
  at: 1791601205000,
  runtimeStartedAt: 1791597605000,
  scanGroups: { fast: 250, normal: 1000, slow: 5000 },
  channels: [
    {
      id: 'plc1',
      name: 'PLC trạm bơm',
      kind: 'modbus-tcp',
      state: 'connected',
      lastError: null,
      reconnects: 1,
      warnings: [],
      devices: [
        {
          id: 'plc1',
          name: 'PLC 1',
          state: 'active',
          requestsOk: 120431,
          timeouts: 3,
          exceptions: { '02': 1 },
          badFrames: { crc: 0, format: 2, tid: 0, unit: 0, length: 0, echo: 0 },
          responseMs: { avg: 38, max: 120 },
          groups: [
            {
              group: 'fast',
              periodMs: 250,
              actualMs: { avg: 312, max: 480 },
              overruns: 6,
              overloaded: true,
            },
            {
              group: 'normal',
              periodMs: 1000,
              actualMs: { avg: 1002, max: 1010 },
              overruns: 0,
              overloaded: false,
            },
          ],
          writes: { confirmed: 3, failed: 0, timeout: 1, rejected: 2 },
        },
      ],
    },
    {
      id: 'rs485-1',
      name: 'RS485 đồng hồ điện',
      kind: 'modbus-rtu',
      state: 'error',
      lastError: { code: 'TIMEOUT', at: 1791601201000, device: 'meter1' },
      reconnects: 0,
      warnings: ['RS485_UNSUPPORTED'],
      devices: [
        {
          id: 'meter1',
          name: 'Đồng hồ 1',
          state: 'suspended',
          requestsOk: 10,
          timeouts: 57,
          exceptions: {},
          badFrames: { crc: 12, format: 0, tid: 0, unit: 0, length: 3, echo: 0 },
          responseMs: { avg: 41.5, max: 212 },
          groups: [],
          writes: { confirmed: 0, failed: 0, timeout: 0, rejected: 0 },
        },
      ],
    },
  ],
  badTags: [
    { id: 'METER1.P', quality: 'BAD', reason: 'TIMEOUT', detail: null, updatedAt: 1791601201000 },
    {
      id: 'TANK01.VOLUME',
      quality: 'BAD',
      reason: 'INPUT_BAD',
      detail: 'TANK01.LEVEL',
      updatedAt: 1791601202000,
    },
    {
      id: 'PUMP01.FAULT',
      quality: 'UNCERTAIN',
      reason: 'EXCEPTION_02',
      detail: '02',
      updatedAt: 1791601203000,
    },
  ],
  badTagsTruncated: false,
  ...over,
});

const parse = (b: unknown = body()): DriverDiag => {
  const d = parseDriverDiag(b);
  if (!d) throw new Error('parse failed');
  return d;
};

describe('parseDriverDiag', () => {
  it('đọc đủ kênh, thiết bị trường, nhóm quét, Tag xấu', () => {
    const d = parse();
    expect(d.at).toBe(1791601205000);
    expect(d.scanGroups).toEqual({ fast: 250, normal: 1000, slow: 5000 });
    expect(d.channels.map((c) => c.id)).toEqual(['plc1', 'rs485-1']);
    expect(d.channels[0]!.devices[0]!.groups[0]).toMatchObject({
      group: 'fast',
      periodMs: 250,
      overloaded: true,
    });
    expect(d.channels[1]!.lastError).toEqual({
      code: 'TIMEOUT',
      at: 1791601201000,
      device: 'meter1',
    });
    expect(d.badTags).toHaveLength(3);
    expect(d.badTagsTruncated).toBe(false);
  });

  it('thiếu hoặc sai hình dạng thì null; trường lạ bị bỏ qua; số âm hay không hữu hạn thành 0', () => {
    expect(parseDriverDiag(null)).toBeNull();
    expect(parseDriverDiag({ at: 1 })).toBeNull();
    expect(parseDriverDiag({ ...body(), channels: 'x' })).toBeNull();
    const weird = body();
    (weird.channels[0]!.devices[0] as { requestsOk: number; extra?: string }).requestsOk = -5;
    (weird.channels[0]!.devices[0] as { extra?: string }).extra = 'bỏ qua';
    expect(parse(weird).channels[0]!.devices[0]!.requestsOk).toBe(0);
  });

  it('Tag xấu quá 500 hoặc thiếu trường: giữ tối đa 500, bỏ mục sai', () => {
    const many = body({
      badTags: [
        ...Array.from({ length: 520 }, (_, i) => ({
          id: `T${i}`,
          quality: 'BAD',
          reason: 'TIMEOUT',
          detail: null,
          updatedAt: 1,
        })),
        { quality: 'BAD' },
      ],
    });
    expect(parse(many).badTags).toHaveLength(500);
  });
});

describe('counterRows: tổng và phần tăng thêm từ lúc mở trang (US5-4)', () => {
  const dev = (d: DriverDiag) => d.channels[0]!.devices[0]!;

  it('không có bản đầu thì phần tăng là 0; có bản đầu thì tính hiệu', () => {
    const base = parse();
    const later = parse(body());
    (later.channels[0]!.devices[0] as { requestsOk: number; timeouts: number }).requestsOk += 84;
    (later.channels[0]!.devices[0] as { timeouts: number }).timeouts += 2;
    const rows = counterRows(dev(later), dev(base));
    const ok = rows.find((r) => r.key === 'requestsOk')!;
    expect(ok).toMatchObject({ total: '120515', delta: 84 });
    expect(rows.find((r) => r.key === 'timeouts')).toMatchObject({ total: '5', delta: 2 });
    expect(
      counterRows(dev(later), null)
        .filter((r) => r.delta !== null)
        .every((r) => r.delta === 0),
    ).toBe(true);
  });

  it('có hàng exception theo mã, khung hỏng theo loại; trả lời trung bình và lớn nhất không có phần tăng', () => {
    const rows = counterRows(dev(parse()), null);
    expect(rows.map((r) => r.key)).toEqual([
      'requestsOk',
      'timeouts',
      'exception:02',
      'badFrames',
      'responseMs',
      'writes',
    ]);
    expect(rows.find((r) => r.key === 'badFrames')!.total).toBe('0/2/0/0/0/0');
    expect(rows.find((r) => r.key === 'responseMs')!.delta).toBeNull();
  });

  it('thiết bị mới xuất hiện sau bản đầu (không có trong bản đầu): phần tăng tính từ 0', () => {
    const base = parse();
    const later = parse();
    const rows = counterRows(dev(later), undefined);
    expect(rows.find((r) => r.key === 'timeouts')!.delta).toBe(0);
    void base;
  });

  it('bộ đếm giảm (runtime chạy lại): phần tăng không âm', () => {
    const base = parse();
    const later = parse();
    (later.channels[0]!.devices[0] as { requestsOk: number }).requestsOk = 5;
    expect(counterRows(dev(later), dev(base)).find((r) => r.key === 'requestsOk')!.delta).toBe(5);
  });
});

describe('groupRows: chu kỳ đặt, chu kỳ thực, quá tải (US5-3)', () => {
  it('mỗi nhóm một dòng; quá tải theo cờ của thiết bị kèm số lần; nhóm không quá tải không có dấu', () => {
    const rows = groupRows(parse().channels[0]!.devices[0]!);
    expect(rows).toEqual([
      { group: 'fast', periodMs: 250, avgMs: 312, maxMs: 480, overruns: 6, overloaded: true },
      { group: 'normal', periodMs: 1000, avgMs: 1002, maxMs: 1010, overruns: 0, overloaded: false },
    ]);
  });
});

describe('badTagLine', () => {
  it('lý do tiếng Việt; Tag tính toán kèm đầu vào xấu; exception kèm mã', () => {
    const d = parse();
    expect(badTagLine(d.badTags[0]!)).toEqual({
      id: 'METER1.P',
      quality: 'BAD',
      reason: 'thiết bị trường không trả lời kịp',
      at: 1791601201000,
    });
    expect(badTagLine(d.badTags[1]!).reason).toBe('đầu vào của biểu thức không tốt: TANK01.LEVEL');
    expect(badTagLine(d.badTags[2]!).reason).toBe('exception 02: địa chỉ không hợp lệ');
    expect(
      badTagLine({ id: 'X', quality: 'BAD', reason: 'MA_LA', detail: null, updatedAt: 1 }).reason,
    ).toBe('không rõ (MA_LA)');
  });
});

describe('DriverDiagFeed: hỏi mỗi 2 s khi trang mở, giữ bản đầu', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make() {
    let n = 0;
    const get = vi.fn(async (): Promise<ApiResult | DeviceError> => {
      n++;
      const b = body();
      (b.channels[0]!.devices[0] as { requestsOk: number }).requestsOk = 1000 + n * 84;
      return { status: 200, body: b };
    });
    const changes: number[] = [];
    const feed = new DriverDiagFeed({
      get,
      now: () => Date.now(),
      onChange: () => changes.push(get.mock.calls.length),
    });
    return { feed, get, changes };
  }

  it('chu kỳ là 2 s; chưa start thì không hỏi; start hỏi ngay rồi mỗi 2 s; stop thì ngừng', async () => {
    expect(DRIVER_DIAG_PERIOD_MS).toBe(2000);
    const { feed, get } = make();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(get).not.toHaveBeenCalled();
    feed.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    expect(get).toHaveBeenCalledTimes(4);
    feed.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(get).toHaveBeenCalledTimes(4);
  });

  it('bản đầu của lần mở trang được giữ; bản sau cho phần tăng; mở lại trang thì bản đầu mới', async () => {
    const { feed } = make();
    feed.start();
    await vi.advanceTimersByTimeAsync(4100);
    const s = feed.state;
    expect(s.baseline?.channels[0]!.devices[0]!.requestsOk).toBe(1084);
    expect(s.data?.channels[0]!.devices[0]!.requestsOk).toBe(1000 + 3 * 84);
    feed.stop();
    expect(feed.state.baseline).toBeNull();
    feed.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(feed.state.baseline?.channels[0]!.devices[0]!.requestsOk).toBe(1000 + 4 * 84);
  });

  it('đặt lại phần tăng: bản hiện tại thành bản đầu', async () => {
    const { feed } = make();
    feed.start();
    await vi.advanceTimersByTimeAsync(4100);
    feed.rebaseline();
    expect(feed.state.baseline).toBe(feed.state.data);
  });

  it('lỗi một lần hỏi: giữ bản cũ, báo mã lỗi; lần sau được thì hết lỗi', async () => {
    let fail = false;
    const get = vi.fn(async (): Promise<ApiResult | DeviceError> =>
      fail ? { error: 'unreachable' } : { status: 200, body: body() },
    );
    const feed = new DriverDiagFeed({ get, now: () => Date.now(), onChange: () => undefined });
    feed.start();
    await vi.advanceTimersByTimeAsync(1);
    fail = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(feed.state.error).toBe('unreachable');
    expect(feed.state.data).not.toBeNull();
    fail = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(feed.state.error).toBeNull();
    feed.stop();
  });

  it('trả lời sai hình dạng: lỗi bad-response; 403 forbidden giữ nguyên mã', async () => {
    const get = vi.fn(async (): Promise<ApiResult | DeviceError> => ({
      status: 200,
      body: { oops: 1 },
    }));
    const feed = new DriverDiagFeed({ get, now: () => Date.now(), onChange: () => undefined });
    feed.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(feed.state.error).toBe('bad-response');
    feed.stop();
    const f2 = new DriverDiagFeed({
      get: async () => ({ error: 'forbidden' }),
      now: () => Date.now(),
      onChange: () => undefined,
    });
    f2.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f2.state.error).toBe('forbidden');
    f2.stop();
  });

  it('không hỏi chồng: lần hỏi chưa xong thì chu kỳ sau bỏ qua; trả lời của lần chạy cũ bị bỏ sau stop', async () => {
    let release: (() => void) | null = null;
    const get = vi.fn(
      () =>
        new Promise<ApiResult | DeviceError>((resolve) => {
          release = () => resolve({ status: 200, body: body() });
        }),
    );
    const feed = new DriverDiagFeed({ get, now: () => Date.now(), onChange: () => undefined });
    feed.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(get).toHaveBeenCalledTimes(1);
    feed.stop();
    release!();
    await vi.advanceTimersByTimeAsync(1);
    expect(feed.state.data).toBeNull();
  });
});

describe('kênh Siemens S7 (feature 016)', () => {
  const s7 = {
    at: 1,
    channels: [
      {
        id: 's7-1',
        name: 'PLC S7-1200',
        kind: 's7',
        state: 'connected',
        details: { pduSize: '480', localTsap: '0100', remoteTsap: '0101', bad: 5 },
        devices: [{ id: 'cpu1', name: 'CPU', exceptions: { '03': 2, '0A': 1, '8104': 4 } }],
      },
      { id: 'plc1', name: 'PLC', kind: 'modbus-tcp', devices: [] },
    ],
  };

  it('đọc details của kênh S7 (chỉ giá trị chữ); kênh khác không có details', () => {
    const d = parseDriverDiag(s7)!;
    expect(d.channels[0]!.kind).toBe('s7');
    expect(d.channels[0]!.details).toEqual({
      pduSize: '480',
      localTsap: '0100',
      remoteTsap: '0101',
    });
    expect(d.channels[1]!.details).toBeNull();
  });

  it('mã lỗi PLC theo tên S7: mã item 2 chữ số hex, lỗi đầu khung 4 chữ số hex', () => {
    expect(s7ExceptionText('03')).toBe('03 truy cập bị từ chối');
    expect(s7ExceptionText('0A')).toBe('0A DB không có');
    expect(s7ExceptionText('8104')).toBe('8104 chưa bật PUT/GET');
    expect(s7ExceptionText('05')).toBe('05 địa chỉ ngoài vùng');
    expect(s7ExceptionText('FF')).toBe('FF lỗi khác của PLC');
    expect(s7ExceptionText('xyz')).toBe('xyz lỗi khác của PLC');
  });
});
