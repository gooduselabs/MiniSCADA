// Chẩn đoán thiết bị (feature 005, US4, data-model §12, FR-032): đọc `GET /api/v1/diagnostics`, độ lệch giờ so với máy
// kỹ sư, hỏi mỗi 5 s chỉ khi đang chạy (start/stop).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, DeviceError } from '../platform/device-types.ts';
import {
  DIAGNOSTICS_PERIOD_MS,
  DiagnosticsFeed,
  parseDiagnostics,
  type DiagnosticsState,
} from './diagnostics-feed.ts';

const BODY = {
  at: 1_791_600_000_000,
  timeSynced: true,
  cpu: { systemPct1m: 11.7, runtimePct1m: 4.2, loadAvg1: 0.42, cores: 2 },
  memory: {
    runtimeRssBytes: 9_900_032,
    systemTotalBytes: 1_041_235_968,
    systemAvailableBytes: 9e8,
  },
  disk: { path: '/var/lib/mat-runtime', totalBytes: 7_301_234_688, freeBytes: 6_512_341_504 },
  uptime: { systemS: 123_456, runtimeS: 3600 },
  clients: { live: 3, max: 10, sessions: 1 },
  discovery: { enabled: true, replies: 42, dropped: { subnet: 0, format: 3, rate: 0, port: 0 } },
  versions: { runtime: '0.4.0', protocol: '1.1.0', api: '1.0.0' },
};

describe('parseDiagnostics: khối của 006 (viewer, tags, retain; device-api-1.1 §2)', () => {
  const EXTRA = {
    viewer: { access: 'private', blockedTotal: 17, lastBlockedAt: 1_791_601_205_000 },
    tags: { total: 812, good: 790, uncertain: 2, bad: 20 },
    retain: { state: 'ok', tags: 12, lastSaveAt: 1_791_601_200_000, saves: 341 },
  };

  it('đọc đủ ba khối khi thiết bị có', () => {
    const d = parseDiagnostics({ ...BODY, ...EXTRA })!;
    expect(d.viewer).toEqual({
      access: 'private',
      blockedTotal: 17,
      lastBlockedAt: 1_791_601_205_000,
    });
    expect(d.tags).toEqual({ total: 812, good: 790, uncertain: 2, bad: 20 });
    expect(d.retain).toEqual({ state: 'ok', tags: 12, lastSaveAt: 1_791_601_200_000, saves: 341 });
  });

  it('runtime cũ không có các khối này: null, các khối cũ vẫn đọc được; số lạ không làm hỏng cả bản', () => {
    const d = parseDiagnostics(BODY)!;
    expect(d.viewer).toBeNull();
    expect(d.tags).toBeNull();
    expect(d.retain).toBeNull();
    expect(
      parseDiagnostics({ ...BODY, viewer: 5, tags: { total: 'x' }, retain: { state: 7 } }),
    ).not.toBeNull();
    expect(
      parseDiagnostics({
        ...BODY,
        viewer: { access: 'any', blockedTotal: 0, lastBlockedAt: null },
      })!.viewer,
    ).toEqual({
      access: 'any',
      blockedTotal: 0,
      lastBlockedAt: null,
    });
  });
});

describe('parseDiagnostics', () => {
  it('đọc đủ các khối của contract §6', () => {
    const d = parseDiagnostics(BODY)!;
    expect(d.cpu).toEqual(BODY.cpu);
    expect(d.memory.runtimeRssBytes).toBe(9_900_032);
    expect(d.disk).toEqual(BODY.disk);
    expect(d.uptime).toEqual(BODY.uptime);
    expect(d.clients).toEqual({ live: 3, max: 10, sessions: 1 });
    expect(d.timeSynced).toBe(true);
    expect(d.versions.runtime).toBe('0.4.0');
  });

  it('khối thiếu hay sai kiểu thì không dùng được; disk null thì không có khối disk', () => {
    expect(parseDiagnostics(null)).toBeNull();
    expect(parseDiagnostics({})).toBeNull();
    expect(parseDiagnostics({ ...BODY, cpu: 'x' })).toBeNull();
    expect(parseDiagnostics({ ...BODY, at: 'x' })).toBeNull();
    expect(parseDiagnostics({ ...BODY, disk: null })!.disk).toBeNull();
    // Số lạ (NaN, vô cực, âm) trong khối tùy chọn không làm hỏng cả bản.
    expect(parseDiagnostics({ ...BODY, discovery: 5, versions: null })).not.toBeNull();
  });
});

describe('DiagnosticsFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function feed(respond: () => ApiResult | DeviceError) {
    const calls: number[] = [];
    const states: DiagnosticsState[] = [];
    const f = new DiagnosticsFeed({
      get: async () => {
        calls.push(Date.now());
        return respond();
      },
      now: () => Date.now(),
      onChange: (s) => states.push(s),
    });
    return { f, calls, states };
  }

  it('start hỏi ngay rồi mỗi 5 s; stop dừng hẳn; start lại hỏi ngay', async () => {
    const { f, calls } = feed(() => ({ status: 200, body: BODY }));
    f.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_PERIOD_MS);
    expect(calls).toHaveLength(2);
    f.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);
    f.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);
    f.stop();
  });

  it('độ lệch giờ = giờ thiết bị − giờ máy này lúc nhận', async () => {
    vi.setSystemTime(BODY.at + 1000); // máy này nhanh hơn thiết bị 1 s
    const { f } = feed(() => ({ status: 200, body: BODY }));
    f.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.state.skewMs).toBe(-1000);
    expect(f.state.error).toBeNull();
    f.stop();
  });

  it('lỗi thì giữ số liệu cũ, ghi mã lỗi; hỏi được lại thì hết lỗi', async () => {
    let fail = false;
    const { f } = feed(() => (fail ? { error: 'unreachable' } : { status: 200, body: BODY }));
    f.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.state.data).not.toBeNull();
    fail = true;
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_PERIOD_MS);
    expect(f.state.error).toBe('unreachable');
    expect(f.state.data).not.toBeNull();
    fail = false;
    await vi.advanceTimersByTimeAsync(DIAGNOSTICS_PERIOD_MS);
    expect(f.state.error).toBeNull();
    f.stop();
  });

  it('thân sai dạng là lỗi bad-response; không có hai lần hỏi chồng nhau', async () => {
    let release: (() => void) | null = null;
    let calls = 0;
    const f = new DiagnosticsFeed({
      get: () => {
        calls++;
        return new Promise((resolve) => {
          release = () => resolve({ status: 200, body: { nope: 1 } });
        });
      },
      now: () => Date.now(),
      onChange: () => undefined,
    });
    f.start();
    await vi.advanceTimersByTimeAsync(3 * DIAGNOSTICS_PERIOD_MS);
    expect(calls).toBe(1); // lần đầu chưa xong: không hỏi thêm
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.state.error).toBe('bad-response');
    f.stop();
  });
});
