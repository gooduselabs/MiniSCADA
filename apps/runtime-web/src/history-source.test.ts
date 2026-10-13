// T077: HttpHistorySource (hàng đợi, ưu tiên, hủy, 429 lùi, 401/HTTP, 404 NO_HISTORY, 503, bộ nhớ đệm).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryError, type HistoryState } from '@mat/ui-components';
import { HttpHistorySource, type HttpHistoryOptions } from './history-source.ts';

const NOW = 1_800_000_000_000;

interface Call {
  url: string;
  signal: AbortSignal | undefined;
  resolve: (r: Response) => void;
  reject: (e: unknown) => void;
}

function harness(over: Partial<HttpHistoryOptions> = {}) {
  const calls: Call[] = [];
  const fetchFn = ((url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const c: Call = { url, signal: init?.signal ?? undefined, resolve, reject };
      calls.push(c);
      init?.signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      );
    })) as unknown as typeof fetch;
  const expired = vi.fn();
  const src = new HttpHistorySource({
    fetch: fetchFn,
    https: true,
    now: () => NOW,
    random: () => 0.5, // jitter 0
    onUnauthorized: expired,
    ...over,
  });
  const states: HistoryState[] = [];
  src.onState((s) => states.push(s));
  return { src, calls, states, expired };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const seriesBody = (tag = 'A') => ({
  group: 'g',
  timeZone: '+07:00',
  from: 0,
  to: 1,
  res: 'raw',
  reduce: 'minmax',
  approximate: false,
  maxPoints: 100,
  coverage: null,
  gaps: [],
  series: [{ tagId: tag, t: [1], v: [1] }],
});

const q = (over: Record<string, unknown> = {}) => ({
  group: 'g',
  tags: ['A'],
  from: NOW - 3_600_000,
  to: NOW,
  maxPoints: 500,
  ...over,
});

const tick = async (n = 5) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('HttpHistorySource: yêu cầu và hàng đợi', () => {
  it('dựng URL cùng nguồn gốc với tham số đã mã hóa và gửi cookie', async () => {
    const { src, calls } = harness();
    const p = src.series(q({ tags: ['LINE1.PRESS', 'A B'] }), new AbortController().signal);
    await tick();
    expect(calls[0]!.url).toBe(
      `/api/v1/history/series?group=g&tags=LINE1.PRESS,A%20B&from=${NOW - 3_600_000}&to=${NOW}&maxPoints=500`,
    );
    calls[0]!.resolve(json(seriesBody()));
    await expect(p).resolves.toMatchObject({ group: 'g' });
  });

  it('tối đa 2 yêu cầu bay; yêu cầu người dùng đi trước yêu cầu nền', async () => {
    const { src, calls } = harness();
    const ac = new AbortController();
    const done: string[] = [];
    const run = (tag: string, priority: 'user' | 'background') =>
      src.series(q({ tags: [tag], priority }), ac.signal).then(() => done.push(tag));
    void run('A', 'background');
    void run('B', 'background');
    void run('C', 'background');
    void run('U', 'user');
    await tick();
    expect(calls.length).toBe(2);
    calls[0]!.resolve(json(seriesBody('A')));
    await tick();
    expect(calls.length).toBe(3);
    expect(calls[2]!.url).toContain('tags=U');
    calls[1]!.resolve(json(seriesBody('B')));
    await tick();
    expect(calls[3]!.url).toContain('tags=C');
  });

  it('hủy: yêu cầu đang chờ rời hàng đợi, yêu cầu bay bị ngắt, đều ném ABORTED', async () => {
    const { src, calls } = harness();
    const a1 = new AbortController();
    const a2 = new AbortController();
    const a3 = new AbortController();
    const p1 = src.series(q({ tags: ['A'] }), a1.signal);
    const p2 = src.series(q({ tags: ['B'] }), a2.signal);
    const p3 = src.series(q({ tags: ['C'] }), a3.signal);
    await tick();
    a3.abort();
    a1.abort();
    await expect(p3).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(p1).rejects.toMatchObject({ code: 'ABORTED' });
    await tick();
    // C chưa từng gửi; B vẫn bay.
    expect(calls.map((c) => c.url).some((u) => u.includes('tags=C'))).toBe(false);
    calls[1]!.resolve(json(seriesBody('B')));
    await expect(p2).resolves.toBeDefined();
  });
});

describe('HttpHistorySource: trạng thái và lỗi', () => {
  it('429 nghỉ theo Retry-After, lùi 1→2→4→8 s tối đa 30 s, rồi tự thử lại và về ready', async () => {
    const { src, calls, states } = harness();
    const p = src.series(q(), new AbortController().signal);
    const waits: number[] = [];
    for (const expectMs of [2000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      await tick();
      const c = calls[calls.length - 1]!;
      c.resolve(json({ error: 'BUSY', message: 'bận' }, 429, { 'Retry-After': '2' }));
      await tick();
      expect(src.state).toBe('busy');
      const before = calls.length;
      await vi.advanceTimersByTimeAsync(expectMs - 1);
      expect(calls.length).toBe(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls.length).toBe(before + 1);
      waits.push(expectMs);
    }
    calls[calls.length - 1]!.resolve(json(seriesBody()));
    await expect(p).resolves.toBeDefined();
    expect(src.state).toBe('ready');
    expect(states).toContain('busy');
    expect(waits.length).toBe(7);
  });

  it('khoảng chờ có ngẫu nhiên ±25 % theo hạt giống tiêm', async () => {
    const { src, calls } = harness({ random: () => 1 }); // +25 %
    void src.series(q(), new AbortController().signal);
    await tick();
    calls[0]!.resolve(json({ error: 'BUSY' }, 429, { 'Retry-After': '2' }));
    await tick();
    await vi.advanceTimersByTimeAsync(2499);
    expect(calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.length).toBe(2);
  });

  it('401 → login-required, báo phiên hết hạn, ném AUTH_REQUIRED', async () => {
    const { src, calls, expired } = harness();
    const p = src.series(q(), new AbortController().signal);
    await tick();
    calls[0]!.resolve(json({ error: 'AUTH_REQUIRED' }, 401));
    await expect(p).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    expect(src.state).toBe('login-required');
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('HTTP (không phải HTTPS) → login-required, không gọi mạng', async () => {
    const { src, calls } = harness({ https: false });
    await expect(src.series(q(), new AbortController().signal)).rejects.toMatchObject({
      code: 'HTTPS_REQUIRED',
    });
    expect(calls.length).toBe(0);
    expect(src.state).toBe('login-required');
  });

  it('404 NO_HISTORY → disabled; làm mới catalog khi enabled thì về ready', async () => {
    const { src, calls } = harness();
    const p = src.series(q(), new AbortController().signal);
    await tick();
    calls[0]!.resolve(json({ error: 'NO_HISTORY' }, 404));
    await expect(p).rejects.toMatchObject({ code: 'NO_HISTORY' });
    expect(src.state).toBe('disabled');
    const c = src.catalog();
    await tick();
    calls[1]!.resolve(
      json({ apiVersion: '1.4.0', enabled: true, state: 'running', limits: {}, groups: [] }),
    );
    await expect(c).resolves.toMatchObject({ enabled: true });
    expect(src.state).toBe('ready');
  });

  it('catalog enabled:false → disabled', async () => {
    const { src, calls } = harness();
    const c = src.catalog();
    await tick();
    calls[0]!.resolve(
      json({ apiVersion: '1.4.0', enabled: false, state: 'off', limits: {}, groups: [] }),
    );
    await c;
    expect(src.state).toBe('disabled');
  });

  it('503 và lỗi mạng → error, ném lỗi có mã; yêu cầu sau thành công thì về ready', async () => {
    const { src, calls } = harness();
    const p1 = src.series(q(), new AbortController().signal);
    await tick();
    calls[0]!.resolve(json({ error: 'HISTORY_UNAVAILABLE' }, 503));
    await expect(p1).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
    expect(src.state).toBe('error');
    const p2 = src.series(q({ tags: ['B'] }), new AbortController().signal);
    await tick();
    calls[1]!.reject(new TypeError('Failed to fetch'));
    await expect(p2).rejects.toBeInstanceOf(HistoryError);
    expect(src.state).toBe('error');
    const p3 = src.series(q({ tags: ['C'] }), new AbortController().signal);
    await tick();
    calls[2]!.resolve(json(seriesBody()));
    await p3;
    expect(src.state).toBe('ready');
  });

  it('lỗi 4xx khác (UNKNOWN_GROUP, RANGE_TOO_LARGE) ném lỗi nhưng không đổi trạng thái', async () => {
    const { src, calls } = harness();
    const p = src.series(q(), new AbortController().signal);
    await tick();
    calls[0]!.resolve(json({ error: 'RANGE_TOO_LARGE', message: 'quá lớn' }, 422));
    await expect(p).rejects.toMatchObject({ code: 'RANGE_TOO_LARGE', status: 422 });
    expect(src.state).toBe('ready');
  });

  it('thân phản hồi sai hình dạng → BAD_RESPONSE', async () => {
    const { src, calls } = harness();
    const p = src.series(q(), new AbortController().signal);
    await tick();
    calls[0]!.resolve(json({ nope: 1 }));
    await expect(p).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});

describe('HttpHistorySource: bộ nhớ đệm', () => {
  it('cùng truy vấn không gọi lại; khoảng chạm "bây giờ" hết hạn sau 30 s', async () => {
    let now = NOW;
    const { src, calls } = harness({ now: () => now });
    const sig = new AbortController().signal;
    const p1 = src.series(q(), sig);
    await tick();
    calls[0]!.resolve(json(seriesBody()));
    await p1;
    await src.series(q(), sig);
    expect(calls.length).toBe(1);
    now += 31_000;
    const p3 = src.series(q(), sig);
    await tick();
    expect(calls.length).toBe(2);
    calls[1]!.resolve(json(seriesBody()));
    await p3;
  });

  it('khoảng đã qua không hết hạn; tối đa 32 mục (mục cũ nhất bị đẩy ra)', async () => {
    let now = NOW;
    const { src, calls } = harness({ now: () => now });
    const sig = new AbortController().signal;
    const past = (i: number) => q({ from: i * 1000, to: i * 1000 + 500, tags: ['A'] });
    for (let i = 0; i < 33; i++) {
      const p = src.series(past(i), sig);
      await tick();
      calls[calls.length - 1]!.resolve(json(seriesBody()));
      await p;
    }
    now += 3_600_000;
    const before = calls.length;
    await src.series(past(32), sig);
    expect(calls.length).toBe(before); // còn trong đệm dù đã quá 30 s
    const p = src.series(past(0), sig);
    await tick();
    expect(calls.length).toBe(before + 1); // mục 0 đã bị đẩy ra
    calls[calls.length - 1]!.resolve(json(seriesBody()));
    await p;
  });
});

describe('HttpHistorySource: tiện ích', () => {
  it('exportUrl dựng đường dẫn cùng nguồn gốc', () => {
    const { src } = harness();
    expect(
      src.exportUrl({
        group: 'g',
        from: 1,
        to: 2,
        tags: ['A', 'B'],
        res: '1m',
        fields: ['avg', 'max'],
      }),
    ).toBe('/api/v1/history/export.csv?group=g&from=1&to=2&tags=A,B&res=1m&fields=avg,max');
  });

  it('requestLogin gọi hàm do trang cấp', () => {
    const requestLogin = vi.fn();
    const { src } = harness({ requestLogin });
    src.requestLogin();
    expect(requestLogin).toHaveBeenCalledOnce();
  });
});
