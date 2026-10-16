// T131 (feature 010, US8; contracts/studio-010.md §2): nguồn lịch sử từ thiết bị. Gọi `/api/v1/history/*` qua `DeviceLink.get` (token
// Bearer do lớp Rust giữ và gắn; giao diện không thấy token), MỘT hàng đợi chung (tối đa 2 yêu cầu bay, yêu cầu người dùng trước
// yêu cầu nền), hủy bằng AbortSignal, ánh xạ lỗi: auth-required → AUTH_REQUIRED (login-required), http 422 → RANGE_TOO_LARGE,
// http 429 → nghỉ rồi thử lại (BUSY, state busy), http 404 → NO_HISTORY (disabled), unreachable/timeout → NETWORK (error).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult, DeviceError, DeviceLink } from './device-types.ts';
import { DeviceHistorySource } from './device-history.ts';

type Reply = ApiResult | DeviceError | Promise<ApiResult | DeviceError>;

function fakeLink(reply: (path: string, query: Record<string, string>) => Reply) {
  const calls: Array<{ id: string; path: string; query: Record<string, string> }> = [];
  const link = {
    get: vi.fn(async (id: string, path: string, query?: Record<string, string>) => {
      calls.push({ id, path, query: query ?? {} });
      return reply(path, query ?? {});
    }),
  } as unknown as Pick<DeviceLink, 'get'>;
  return { link, calls };
}

const ok = (body: unknown): ApiResult => ({ status: 200, body });
const CATALOG = {
  apiVersion: '1.4.0',
  enabled: true,
  state: 'running',
  limits: {},
  groups: [{ id: 'g' }],
};
const AGG = { group: 'g', count: 1, series: [], start: 0, bucketMs: 1, timeZone: '+07:00' };
const ac = () => new AbortController().signal;

afterEach(() => vi.useRealTimers());

describe('DeviceHistorySource', () => {
  it('catalog, aggregate, series, rows gọi đúng đường dẫn và tham số của API 1.4.0', async () => {
    const { link, calls } = fakeLink((path) =>
      ok(
        path.endsWith('catalog')
          ? CATALOG
          : path.endsWith('rows')
            ? { rows: [], columns: [], next: null }
            : path.endsWith('aggregate')
              ? AGG
              : { series: [] },
      ),
    );
    const s = new DeviceHistorySource({ link, deviceId: () => 'BL335-01' });
    expect((await s.catalog()).groups).toHaveLength(1);
    await s.aggregate(
      {
        group: 'g',
        tags: ['A', 'B'],
        from: 10,
        to: 20,
        bucketMs: 5,
        offsetMs: 2,
        priority: 'user',
      },
      ac(),
    );
    await s.series(
      { group: 'g', tags: ['A'], from: 1, to: 9, maxPoints: 100, res: '1m', reduce: 'minmax' },
      ac(),
    );
    await s.rows(
      { group: 'g', from: 1, to: 9, tags: ['A'], limit: 10, order: 'desc', after: 4 },
      ac(),
    );
    expect(calls.map((c) => c.path)).toEqual([
      '/api/v1/history/catalog',
      '/api/v1/history/aggregate',
      '/api/v1/history/series',
      '/api/v1/history/rows',
    ]);
    expect(calls.every((c) => c.id === 'BL335-01')).toBe(true);
    expect(calls[1]!.query).toEqual({
      group: 'g',
      tags: 'A,B',
      from: '10',
      to: '20',
      bucketMs: '5',
      offsetMs: '2',
    });
    expect(calls[2]!.query).toEqual({
      group: 'g',
      tags: 'A',
      from: '1',
      to: '9',
      maxPoints: '100',
      res: '1m',
      reduce: 'minmax',
    });
    expect(calls[3]!.query).toEqual({
      group: 'g',
      from: '1',
      to: '9',
      tags: 'A',
      limit: '10',
      order: 'desc',
      after: '4',
    });
    expect(s.state).toBe('ready');
  });

  it('chưa chọn thiết bị: lỗi NO_DEVICE, không gọi mạng; token không bao giờ nằm trong tham số', async () => {
    const { link, calls } = fakeLink(() => ok(CATALOG));
    const s = new DeviceHistorySource({ link, deviceId: () => null });
    await expect(s.catalog()).rejects.toMatchObject({ code: 'NO_DEVICE' });
    expect(calls).toHaveLength(0);
    const t = new DeviceHistorySource({ link, deviceId: () => 'x' });
    await t.catalog();
    expect(JSON.stringify(calls)).not.toMatch(/mats_|Bearer|token/i);
  });

  it('401 (auth-required, session-expired): login-required và HistoryError AUTH_REQUIRED/SESSION_EXPIRED; requestLogin gọi tùy chọn', async () => {
    const onLogin = vi.fn();
    const { link } = fakeLink(() => ({ error: 'auth-required' }));
    const s = new DeviceHistorySource({ link, deviceId: () => 'x', requestLogin: onLogin });
    const states: string[] = [];
    s.onState((v) => states.push(v));
    await expect(
      s.aggregate({ group: 'g', tags: ['A'], from: 1, to: 2, bucketMs: 1 }, ac()),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect(s.state).toBe('login-required');
    expect(states).toEqual(['login-required']);
    s.requestLogin();
    expect(onLogin).toHaveBeenCalledOnce();
    const exp = new DeviceHistorySource({
      link: fakeLink(() => ({ error: 'session-expired' })).link,
      deviceId: () => 'x',
    });
    await expect(exp.catalog()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('http 422 → RANGE_TOO_LARGE; http 404 → NO_HISTORY và disabled; unreachable/timeout → NETWORK và error', async () => {
    const mk = (r: DeviceError) =>
      new DeviceHistorySource({ link: fakeLink(() => r).link, deviceId: () => 'x' });
    const q = { group: 'g', tags: ['A'], from: 1, to: 2, bucketMs: 1 };
    await expect(mk({ error: 'http', detail: 422 }).aggregate(q, ac())).rejects.toMatchObject({
      code: 'RANGE_TOO_LARGE',
      status: 422,
    });
    const nf = mk({ error: 'http', detail: 404 });
    await expect(nf.aggregate(q, ac())).rejects.toMatchObject({ code: 'NO_HISTORY' });
    expect(nf.state).toBe('disabled');
    const un = mk({ error: 'unreachable' });
    await expect(un.aggregate(q, ac())).rejects.toMatchObject({ code: 'NETWORK' });
    expect(un.state).toBe('error');
    await expect(mk({ error: 'timeout' }).aggregate(q, ac())).rejects.toMatchObject({
      code: 'NETWORK',
    });
  });

  it('429 BUSY: cả hàng đợi nghỉ rồi thử lại, state busy → ready khi xong', async () => {
    vi.useFakeTimers();
    let n = 0;
    const { link, calls } = fakeLink(() => (n++ === 0 ? { error: 'http', detail: 429 } : ok(AGG)));
    const s = new DeviceHistorySource({ link, deviceId: () => 'x', random: () => 0.5 });
    const states: string[] = [];
    s.onState((v) => states.push(v));
    const p = s.aggregate(
      { group: 'g', tags: ['A'], from: 1, to: 2, bucketMs: 1, priority: 'user' },
      ac(),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe('busy');
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1100);
    await p;
    expect(calls).toHaveLength(2);
    expect(states).toEqual(['busy', 'ready']);
  });

  it('một hàng đợi chung: tối đa 2 yêu cầu bay; yêu cầu người dùng đi trước yêu cầu nền', async () => {
    const gates: Array<() => void> = [];
    const order: string[] = [];
    let inflight = 0;
    let maxInflight = 0;
    const { link } = fakeLink(
      (_p, q) =>
        new Promise<ApiResult>((res) => {
          order.push(q.group!);
          inflight++;
          maxInflight = Math.max(maxInflight, inflight);
          gates.push(() => {
            inflight--;
            res(ok(AGG));
          });
        }),
    );
    const s = new DeviceHistorySource({ link, deviceId: () => 'x' });
    const q = (group: string, priority: 'user' | 'background') => ({
      group,
      tags: ['A'],
      from: 1,
      to: 2,
      bucketMs: 1,
      priority,
    });
    const all = [
      s.aggregate(q('b1', 'background'), ac()),
      s.aggregate(q('b2', 'background'), ac()),
      s.aggregate(q('b3', 'background'), ac()),
      s.aggregate(q('u1', 'user'), ac()),
    ];
    await Promise.resolve();
    expect(order).toEqual(['b1', 'b2']);
    gates[0]!();
    await vi.waitFor(() => expect(order).toHaveLength(3));
    expect(order[2]).toBe('u1'); // yêu cầu người dùng vượt hàng đợi nền
    gates[1]!();
    await vi.waitFor(() => expect(order).toHaveLength(4));
    for (const g of gates.slice(2)) g();
    await Promise.all(all);
    expect(maxInflight).toBeLessThanOrEqual(2);
  });

  it('hủy: tín hiệu đã hủy bị từ chối ngay; hủy khi còn trong hàng đợi gỡ yêu cầu', async () => {
    const hold: Array<() => void> = [];
    const { link, calls } = fakeLink(
      () => new Promise<ApiResult>((r) => hold.push(() => r(ok(AGG)))),
    );
    const s = new DeviceHistorySource({ link, deviceId: () => 'x', maxInflight: 1 });
    const done = new AbortController();
    done.abort();
    await expect(
      s.aggregate({ group: 'g', tags: ['A'], from: 1, to: 2, bucketMs: 1 }, done.signal),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    const first = s.aggregate({ group: 'g', tags: ['A'], from: 1, to: 2, bucketMs: 1 }, ac());
    const c = new AbortController();
    const queued = s.aggregate({ group: 'q', tags: ['A'], from: 1, to: 2, bucketMs: 1 }, c.signal);
    c.abort();
    await expect(queued).rejects.toMatchObject({ code: 'ABORTED' });
    hold[0]!();
    await first;
    expect(calls.map((x) => x.query.group)).toEqual(['g']);
  });

  it('exportUrl: đường dẫn tương đối của API (xuất file đi qua lệnh lưu của Tauri, không mở URL)', () => {
    const { link } = fakeLink(() => ok(CATALOG));
    const s = new DeviceHistorySource({ link, deviceId: () => 'x' });
    expect(
      s.exportUrl({ group: 'g', from: 1, to: 2, tags: ['A', 'B'], res: '1h', bom: false }),
    ).toBe('/api/v1/history/export.csv?group=g&from=1&to=2&tags=A%2CB&res=1h&bom=0');
  });
});
