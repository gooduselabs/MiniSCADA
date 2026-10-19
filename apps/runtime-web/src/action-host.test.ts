// WebActionHost (feature 007, FR-034, FR-039, FR-040, FR-049, FR-050; contracts/web-session.md §4): ghi Tag qua
// `POST tags/write` bằng cookie + CSRF, hỏi kết quả mỗi 200 ms tới 30 s (rồi UNKNOWN), không bao giờ gửi lại.
import type { WriteOutcome, WriteSpec } from '@mat/ui-components';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebActionHost } from './action-host.ts';
import { WebSession } from './session.ts';
import { fakeFetch, type FakeHandler } from './testing.ts';

const SESSION_BODY = { user: 'vanhanh1', role: 'operator', csrfToken: 'CSRF-TOKEN-ABC' };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WRITE = 'POST /api/v1/tags/write';

const spec = (extra: Partial<WriteSpec> = {}): WriteSpec => ({
  kind: 'write',
  tag: 'TANK01.SP',
  value: 75,
  context: { screen: 'tong-quan', widget: 'sp1' },
  ...extra,
});

async function setup(routes: Record<string, FakeHandler | FakeHandler[]> = {}, https = true) {
  const f = fakeFetch({ 'POST /api/v1/web/login': { json: SESSION_BODY }, ...routes });
  const session = new WebSession({ fetch: f.fn, https });
  if (https) await session.login('vanhanh1', 'x');
  const nav = { navigate: vi.fn(), openPopup: vi.fn(), closePopup: vi.fn() };
  const requestLogin = vi.fn();
  const host = new WebActionHost({ session, fetch: f.fn, nav, requestLogin });
  const changes = vi.fn();
  host.onChange(changes);
  return { f, session, host, nav, requestLogin, changes };
}

const accepted = (id?: string) => ({
  json: { results: [{ requestId: id ?? 'x', status: 'ACCEPTED', phase: 'queued' }] },
});
const final = (status: string, extra: Record<string, unknown> = {}) => ({
  json: { results: [{ requestId: 'x', status, ...extra }] },
});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Chạy `write` tới khi xong, đẩy đồng hồ giả. */
async function run(
  host: WebActionHost,
  s: WriteSpec,
  phases: WriteOutcome[] = [],
): Promise<WriteOutcome> {
  const p = host.write(s, (o) => phases.push(o));
  await vi.advanceTimersByTimeAsync(60_000);
  return p;
}

describe('gửi lệnh', () => {
  it('POST tags/write: JSON, X-MAT-CSRF, requestId UUID v4, context, không đặt Origin', async () => {
    const { f, host } = await setup({
      [WRITE]: { json: { results: [{ status: 'REJECTED', reason: 'CONNECTION_BAD' }] } },
    });
    await run(host, spec());
    const c = f.calls.find((x) => x.method === 'POST' && x.url === '/api/v1/tags/write')!;
    expect(c.headers['content-type']).toBe('application/json');
    expect(c.headers['x-mat-csrf']).toBe('CSRF-TOKEN-ABC');
    expect(c.headers.origin).toBeUndefined();
    expect(c.credentials ?? 'same-origin').toBe('same-origin');
    const req = (c.body as { requests: Array<Record<string, unknown>> }).requests;
    expect(req).toHaveLength(1);
    expect(req[0].requestId).toMatch(UUID_V4);
    expect(req[0]).toMatchObject({
      tag: 'TANK01.SP',
      value: 75,
      context: { screen: 'tong-quan', widget: 'sp1' },
    });
    expect('pulseMs' in req[0]).toBe(false);
    expect('expect' in req[0]).toBe(false);
  });

  it('pulse mang pulseMs; toggle mang expect; mỗi lệnh một requestId mới', async () => {
    const { f, host } = await setup({
      [WRITE]: { json: { results: [{ status: 'REJECTED', reason: 'FORBIDDEN' }] } },
    });
    await run(host, spec({ kind: 'pulse', tag: 'P.RUN', value: true, pulseMs: 500 }));
    await run(host, spec({ kind: 'toggle', tag: 'P.AUTO', value: false, expect: true }));
    const posts = f.calls.filter((x) => x.url === '/api/v1/tags/write' && x.method === 'POST');
    const [a, b] = posts.map(
      (p) => (p.body as { requests: Array<Record<string, unknown>> }).requests[0],
    );
    expect(a).toMatchObject({ pulseMs: 500, value: true });
    expect(b).toMatchObject({ expect: true, value: false });
    expect(a.requestId).not.toBe(b.requestId);
  });

  it('chuỗi INT64 giữ nguyên chuỗi', async () => {
    const { f, host } = await setup({
      [WRITE]: { json: { results: [{ status: 'REJECTED', reason: 'X' }] } },
    });
    await run(host, spec({ tag: 'BIG', value: '12345678901234567890' }));
    const body = f.calls.find((x) => x.url === '/api/v1/tags/write')!.body as {
      requests: Array<{ value: unknown }>;
    };
    expect(body.requests[0].value).toBe('12345678901234567890');
  });

  it('chưa đăng nhập: REJECTED NO_SESSION, không gọi mạng', async () => {
    const f = fakeFetch();
    const session = new WebSession({ fetch: f.fn, https: true });
    const nav = { navigate() {}, openPopup() {}, closePopup() {} };
    const host = new WebActionHost({ session, fetch: f.fn, nav, requestLogin() {} });
    const o = await host.write(spec(), () => {});
    expect(o).toMatchObject({ status: 'REJECTED', code: 'NO_SESSION' });
    expect(f.calls).toHaveLength(0);
  });
});

describe('kết quả', () => {
  it('ACCEPTED rồi hỏi mỗi 200 ms tới CONFIRMED; onPhase báo ACCEPTED; chỉ một POST', async () => {
    const { f, host } = await setup({
      [WRITE]: accepted(),
      'GET /api/v1/tags/write/ID': { json: {} },
    });
    // requestId do host sinh: chặn mọi GET write/<id> bằng hàm
    f.set(WRITE, (call) => {
      const id = (call.body as { requests: Array<{ requestId: string }> }).requests[0].requestId;
      let n = 0;
      f.set(`GET /api/v1/tags/write/${id}`, () => {
        n++;
        return n < 3
          ? { json: { results: [{ requestId: id, status: 'ACCEPTED', phase: 'sent' }] } }
          : {
              json: {
                results: [{ requestId: id, status: 'CONFIRMED', code: 'CONFIRMED', readback: 75 }],
              },
            };
      });
      return accepted(id);
    });
    const phases: WriteOutcome[] = [];
    const o = await run(host, spec(), phases);
    expect(o).toMatchObject({ status: 'CONFIRMED', code: 'CONFIRMED', readback: 75 });
    expect(phases.map((p) => p.status)).toEqual(['ACCEPTED']);
    const polls = f.calls.filter(
      (c) => c.method === 'GET' && c.url.startsWith('/api/v1/tags/write/'),
    );
    expect(polls).toHaveLength(3);
    expect(f.count('POST', '/api/v1/tags/write')).toBe(1);
  });

  it('khoảng giữa hai lần hỏi là 200 ms', async () => {
    const times: number[] = [];
    const { f, host } = await setup();
    f.set(WRITE, (call) => {
      const id = (call.body as { requests: Array<{ requestId: string }> }).requests[0].requestId;
      f.set(`GET /api/v1/tags/write/${id}`, () => {
        times.push(Date.now());
        return times.length < 4
          ? { json: { results: [{ status: 'ACCEPTED' }] } }
          : final('CONFIRMED');
      });
      return accepted(id);
    });
    await run(host, spec());
    expect(times.slice(1).map((t, i) => t - times[i])).toEqual([200, 200, 200]);
  });

  it.each([
    ['REJECTED', 'CONNECTION_BAD', 'Mất kết nối với PLC'],
    ['FAILED', 'DEVICE_EXCEPTION', undefined],
    ['TIMEOUT', 'WRITE_TIMEOUT', 'Không chắc đã ghi'],
  ])('kết quả cuối %s kèm mã %s', async (status, code, message) => {
    const { f, host } = await setup();
    f.set(WRITE, (call) => {
      const id = (call.body as { requests: Array<{ requestId: string }> }).requests[0].requestId;
      f.set(
        `GET /api/v1/tags/write/${id}`,
        final(status, { code, ...(message ? { message } : {}) }),
      );
      return accepted(id);
    });
    const o = await run(host, spec());
    expect(o).toMatchObject({ status, code });
    expect(o.message).toBe(message);
  });

  it('POST trả REJECTED ngay (không hỏi tiếp); RATE_LIMITED mang retryAfterMs; câu của thiết bị được giữ', async () => {
    const { f, host } = await setup({
      [WRITE]: {
        json: {
          results: [
            {
              requestId: 'x',
              status: 'REJECTED',
              reason: 'RATE_LIMITED',
              retryAfterMs: 2400,
              message: 'Ghi quá nhanh',
            },
          ],
        },
      },
    });
    const o = await run(host, spec());
    expect(o).toEqual({
      status: 'REJECTED',
      code: 'RATE_LIMITED',
      message: 'Ghi quá nhanh',
      retryAfterMs: 2400,
    });
    expect(f.calls.filter((c) => c.method === 'GET')).toHaveLength(0);
  });

  it('30 s không có kết quả cuối → UNKNOWN, không gửi lại', async () => {
    const { f, host } = await setup();
    f.set(WRITE, (call) => {
      const id = (call.body as { requests: Array<{ requestId: string }> }).requests[0].requestId;
      f.set(`GET /api/v1/tags/write/${id}`, {
        json: { results: [{ status: 'ACCEPTED', phase: 'readback' }] },
      });
      return accepted(id);
    });
    const o = await run(host, spec());
    expect(o.status).toBe('UNKNOWN');
    expect(o.code).toBe('NO_RESULT');
    expect(f.count('POST', '/api/v1/tags/write')).toBe(1);
    const polls = f.calls.filter((c) => c.method === 'GET').length;
    expect(polls).toBeGreaterThanOrEqual(140);
    expect(polls).toBeLessThanOrEqual(151);
  });

  it('thiết bị không biết mã (404 hoặc UNKNOWN) → UNKNOWN ngay', async () => {
    for (const reply of [{ status: 404, json: { error: 'NO_SUCH_REQUEST' } }, final('UNKNOWN')]) {
      const { f, host } = await setup();
      f.set(WRITE, (call) => {
        const id = (call.body as { requests: Array<{ requestId: string }> }).requests[0].requestId;
        f.set(`GET /api/v1/tags/write/${id}`, reply);
        return accepted(id);
      });
      const o = await run(host, spec());
      expect(o.status).toBe('UNKNOWN');
    }
  });

  it('lỗi mạng ở POST: UNKNOWN, không gửi lại', async () => {
    const { f, host } = await setup({ [WRITE]: new Error('mạng đứt') });
    const o = await run(host, spec());
    expect(o).toMatchObject({ status: 'UNKNOWN', code: 'NETWORK' });
    expect(f.count('POST', '/api/v1/tags/write')).toBe(1);
  });

  it('lỗi mạng thoáng qua khi hỏi kết quả: hỏi tiếp, không gửi lại', async () => {
    const { f, host } = await setup();
    f.set(WRITE, (call) => {
      const id = (call.body as { requests: Array<{ requestId: string }> }).requests[0].requestId;
      f.set(`GET /api/v1/tags/write/${id}`, [
        new Error('x'),
        { status: 502 },
        final('CONFIRMED', { code: 'CONFIRMED' }),
      ]);
      return accepted(id);
    });
    const o = await run(host, spec());
    expect(o.status).toBe('CONFIRMED');
    expect(f.count('POST', '/api/v1/tags/write')).toBe(1);
  });

  // T041 (FR-026, D32; R-11 của rà soát 007): `#poll` từng coi 403 và 5xx như "chưa có kết quả" và hỏi tiếp 30 s.
  const pollWith = async (replies: FakeHandler | FakeHandler[]) => {
    const r = await setup();
    r.f.set(WRITE, (call) => {
      const id = (call.body as { requests: Array<{ requestId: string }> }).requests[0].requestId;
      r.f.set(`GET /api/v1/tags/write/${id}`, replies);
      return accepted(id);
    });
    const o = await run(r.host, spec());
    return { ...r, o, polls: r.f.calls.filter((c) => c.method === 'GET').length };
  };

  it('403 khi hỏi kết quả: dừng ngay, UNKNOWN mã FORBIDDEN, không gửi lại', async () => {
    const { o, polls, f } = await pollWith({ status: 403, json: { error: 'FORBIDDEN' } });
    expect(o).toMatchObject({ status: 'UNKNOWN', code: 'FORBIDDEN' });
    expect(o.message).toBeTruthy();
    expect(polls).toBe(1);
    expect(f.count('POST', '/api/v1/tags/write')).toBe(1);
  });

  it('5xx liên tiếp: dừng sau 10 lượt (2 s), UNKNOWN mã SERVER_ERROR', async () => {
    const { o, polls } = await pollWith({ status: 500 });
    expect(o).toMatchObject({ status: 'UNKNOWN', code: 'SERVER_ERROR' });
    expect(polls).toBe(10);
  });

  it('5xx xen kẽ trả lời bình thường: đếm lại từ đầu, vẫn chờ kết quả cuối', async () => {
    const pending = { json: { results: [{ status: 'ACCEPTED', phase: 'sent' }] } };
    const replies: FakeHandler[] = [];
    for (let i = 0; i < 3; i++) replies.push(...Array(9).fill({ status: 503 }), pending);
    replies.push(final('CONFIRMED', { code: 'CONFIRMED' }));
    const { o, polls } = await pollWith(replies);
    expect(o.status).toBe('CONFIRMED');
    expect(polls).toBe(31);
  });

  it.each([400, 405, 410])('4xx khác (%i): dừng ngay, UNKNOWN', async (status) => {
    const { o, polls } = await pollWith({ status });
    expect(o).toMatchObject({ status: 'UNKNOWN', code: `HTTP_${status}` });
    expect(polls).toBe(1);
  });

  it('429 khi hỏi kết quả: hỏi tiếp (bị giới hạn tốc độ, không phải lỗi)', async () => {
    const { o } = await pollWith([{ status: 429 }, final('CONFIRMED', { code: 'CONFIRMED' })]);
    expect(o.status).toBe('CONFIRMED');
  });
});

describe('lỗi cả lô', () => {
  it.each([
    [403, 'CSRF_FAILED'],
    [403, 'ORIGIN_MISMATCH'],
    [403, 'SESSION_SCOPE'],
    [403, 'FORBIDDEN'],
    [403, 'HTTPS_REQUIRED'],
    [503, 'AUDIT_UNAVAILABLE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
  ])('HTTP %i %s → REJECTED cùng mã', async (status, code) => {
    const { host } = await setup({ [WRITE]: { status, json: { error: code } } });
    expect(await run(host, spec())).toMatchObject({ status: 'REJECTED', code });
  });

  it('401: hủy phiên, báo thay đổi (hộp xác nhận bị hủy), khóa SESSION_EXPIRED', async () => {
    const { host, session, changes } = await setup({
      [WRITE]: { status: 401, json: { error: 'SESSION_EXPIRED' } },
    });
    expect(host.session()).toEqual({ user: 'vanhanh1', role: 'operator' });
    changes.mockClear();
    const o = await run(host, spec());
    expect(o).toMatchObject({ status: 'REJECTED', code: 'SESSION_EXPIRED' });
    expect(session.info).toBeNull();
    expect(host.session()).toBeNull();
    expect(changes).toHaveBeenCalled();
    expect(host.writeBlocked()).toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('401 trong lúc hỏi kết quả: UNKNOWN (đã nhận lệnh nhưng mất phiên), phiên hết hạn', async () => {
    const { f, host, session } = await setup();
    f.set(WRITE, (call) => {
      const id = (call.body as { requests: Array<{ requestId: string }> }).requests[0].requestId;
      f.set(`GET /api/v1/tags/write/${id}`, { status: 401, json: { error: 'SESSION_EXPIRED' } });
      return accepted(id);
    });
    const o = await run(host, spec());
    expect(o).toMatchObject({ status: 'UNKNOWN', code: 'SESSION_EXPIRED' });
    expect(session.info).toBeNull();
  });
});

describe('khóa chung', () => {
  it('HTTP: INSECURE; ghi bị từ chối, không gọi mạng', async () => {
    const { host, f } = await setup({}, false);
    expect(host.writeBlocked()).toEqual({
      code: 'INSECURE',
      message: 'Mở bằng HTTPS để điều khiển',
    });
    expect(await host.write(spec(), () => {})).toMatchObject({
      status: 'REJECTED',
      code: 'INSECURE',
    });
    expect(f.calls).toHaveLength(0);
  });

  it('HTTP và cổng HTTPS không chạy: HTTPS_DOWN', async () => {
    const { host, changes } = await setup({}, false);
    host.setHttpsDown(true);
    expect(host.writeBlocked()?.code).toBe('HTTPS_DOWN');
    expect(changes).toHaveBeenCalled();
  });

  it('HTTPS có phiên: không khóa; PROJECT_CHANGING khi báo; hết phiên: SESSION_EXPIRED', async () => {
    const { host, session } = await setup();
    expect(host.writeBlocked()).toBeNull();
    host.setProjectChanging(true);
    expect(host.writeBlocked()?.code).toBe('PROJECT_CHANGING');
    host.setProjectChanging(false);
    session.expire();
    expect(host.writeBlocked()?.code).toBe('SESSION_EXPIRED');
  });

  it('HTTPS nhưng chưa đăng nhập: không khóa chung (khóa NO_SESSION thuộc controller)', async () => {
    const { host } = await setup({
      'POST /api/v1/web/login': { status: 401, json: { error: 'AUTH_FAILED' } },
    });
    expect(host.session()).toBeNull();
    expect(host.writeBlocked()).toBeNull();
  });
});

describe('điều hướng và đăng nhập', () => {
  it('navigate, openPopup, closePopup, requestLogin chuyển cho nơi chứa', async () => {
    const { host, nav, requestLogin } = await setup();
    host.navigate('bom1');
    host.openPopup('pop1');
    host.closePopup();
    host.requestLogin();
    expect(nav.navigate).toHaveBeenCalledWith('bom1');
    expect(nav.openPopup).toHaveBeenCalledWith('pop1');
    expect(nav.closePopup).toHaveBeenCalled();
    expect(requestLogin).toHaveBeenCalled();
  });

  it('openPopup kèm args (faceplate, FR-125): chuyển nguyên args cho nơi chứa', async () => {
    const { host, nav } = await setup();
    host.openPopup('bom-chi-tiet', { prefix: 'PUMP07', title: 'Bơm 7' });
    expect(nav.openPopup).toHaveBeenCalledWith('bom-chi-tiet', {
      prefix: 'PUMP07',
      title: 'Bơm 7',
    });
  });

  it('đổi phiên (đăng nhập, đăng xuất) báo cho người nghe của host', async () => {
    const { host, session, changes } = await setup();
    changes.mockClear();
    session.expire();
    expect(changes).toHaveBeenCalledTimes(1);
    const un = host.onChange(() => {});
    un();
  });
});

// ---- Alarm (feature 009, FR-064, FR-091; device-api-1.3.md §3) ----
describe('WebActionHost.ackAlarms / shelveAlarm / unshelveAlarm', () => {
  const ACK = 'POST /api/v1/alarms/ack';
  const SHELVE = 'POST /api/v1/alarms/shelve';
  const UNSHELVE = 'POST /api/v1/alarms/unshelve';
  const items = { items: [{ id: 'A', occurrence: 3 }] };

  it('gửi JSON cùng CSRF và không gửi lại; đọc results/acked/skippedNewer', async () => {
    const t = await setup({
      [ACK]: {
        json: {
          mode: 'items',
          results: [{ id: 'A', occurrence: 3, result: 'ACKED' }],
          acked: 1,
          skippedNewer: 0,
          revision: 9,
          counts: {},
        },
      },
    });
    const o = await t.host.ackAlarms(items);
    expect(o).toEqual({
      ok: true,
      results: [{ id: 'A', occurrence: 3, result: 'ACKED' }],
      acked: 1,
      skippedNewer: 0,
    });
    const call = t.f.calls.find((c) => c.url === '/api/v1/alarms/ack')!;
    expect(call.headers['x-mat-csrf']).toBe('CSRF-TOKEN-ABC');
    expect(call.headers['content-type']).toBe('application/json');
    expect(call.body).toEqual(items);
    expect(t.f.count('POST', '/api/v1/alarms/ack')).toBe(1);
  });
  it('dạng all gửi nguyên upToRevision và filter', async () => {
    const t = await setup({
      [ACK]: { json: { mode: 'all', results: [], acked: 0, skippedNewer: 2 } },
    });
    const o = await t.host.ackAlarms({ all: true, upToRevision: 77, filter: { areas: ['bon'] } });
    expect(o.skippedNewer).toBe(2);
    expect(t.f.calls.at(-1)!.body).toEqual({
      all: true,
      upToRevision: 77,
      filter: { areas: ['bon'] },
    });
  });
  it('kết quả lạ bị bỏ; thân không hợp lệ: BAD_RESPONSE', async () => {
    const t = await setup({
      [ACK]: [
        {
          json: {
            results: [
              { id: 'A', occurrence: 3, result: 'GÌ' },
              { id: 'B', occurrence: 1, result: 'STALE' },
            ],
            acked: 0,
          },
        },
        { json: 'x' },
      ],
    });
    const a = await t.host.ackAlarms(items);
    expect(a.results).toEqual([{ id: 'B', occurrence: 1, result: 'STALE' }]);
    const b = await t.host.ackAlarms(items);
    expect(b.ok).toBe(false);
    expect(b.error?.code).toBe('BAD_RESPONSE');
  });
  it('503 AUDIT_UNAVAILABLE: ok false, error có mã và câu thiết bị', async () => {
    const t = await setup({
      [ACK]: {
        status: 503,
        json: { error: 'AUDIT_UNAVAILABLE', message: 'Thiết bị không ghi được nhật ký' },
      },
    });
    const o = await t.host.ackAlarms(items);
    expect(o.ok).toBe(false);
    expect(o.error).toEqual({
      code: 'AUDIT_UNAVAILABLE',
      message: 'Thiết bị không ghi được nhật ký',
    });
    expect(o.results).toEqual([]);
  });
  it('429: retryAfterMs; 422 SHELVE_RANGE: field', async () => {
    const t = await setup({
      [ACK]: { status: 429, json: { error: 'RATE_LIMITED', retryAfterMs: 800 } },
      [SHELVE]: { status: 422, json: { error: 'SHELVE_RANGE', field: 'reason', message: 'x' } },
    });
    expect((await t.host.ackAlarms(items)).error).toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 800,
    });
    expect((await t.host.shelveAlarm({ id: 'A', reason: '', durationS: 60 })).error).toMatchObject({
      code: 'SHELVE_RANGE',
      field: 'reason',
    });
  });
  it('401: hủy phiên, SESSION_EXPIRED, mở hộp đăng nhập; 403: FORBIDDEN, mở hộp đăng nhập', async () => {
    const t = await setup({
      [ACK]: [
        { status: 401, json: { error: 'SESSION_EXPIRED' } },
        { status: 403, json: { error: 'FORBIDDEN' } },
      ],
    });
    const a = await t.host.ackAlarms(items);
    expect(a.error?.code).toBe('SESSION_EXPIRED');
    expect(t.session.info).toBeNull();
    expect(t.session.expired).toBe(true);
    expect(t.requestLogin).toHaveBeenCalledTimes(1);
    // Phiên đã hết: lần sau bị chặn ngay bởi khóa chung, không gọi mạng.
    expect((await t.host.ackAlarms(items)).error?.code).toBe('SESSION_EXPIRED');
    expect(t.f.count('POST', '/api/v1/alarms/ack')).toBe(1);
    const t2 = await setup({ [ACK]: { status: 403, json: { error: 'FORBIDDEN' } } });
    const b = await t2.host.ackAlarms(items);
    expect(b.error?.code).toBe('FORBIDDEN');
    expect(t2.session.info).not.toBeNull();
    expect(t2.requestLogin).toHaveBeenCalledTimes(1);
  });
  it('lỗi mạng: NETWORK, không gửi lại', async () => {
    const t = await setup({ [ACK]: new Error('ECONNRESET') });
    const o = await t.host.ackAlarms(items);
    expect(o.ok).toBe(false);
    expect(o.error?.code).toBe('NETWORK');
    expect(t.f.count('POST', '/api/v1/alarms/ack')).toBe(1);
  });
  it('chưa đăng nhập hoặc bị khóa chung: không gọi mạng, trả lỗi tương ứng', async () => {
    const t = await setup({}, false);
    const o = await t.host.ackAlarms(items);
    expect(o.error?.code).toBe('INSECURE');
    expect(t.f.count('POST', '/api/v1/alarms/ack')).toBe(0);
    const t2 = await setup();
    await t2.session.logout();
    expect((await t2.host.shelveAlarm({ id: 'A', reason: 'r', durationS: 60 })).error?.code).toBe(
      'NO_SESSION',
    );
  });
  it('shelve và unshelve: changed theo thân trả về', async () => {
    const t = await setup({
      [SHELVE]: { json: { id: 'A', shelved: {}, changed: true } },
      [UNSHELVE]: { json: { id: 'A', shelved: null, changed: false } },
    });
    expect(await t.host.shelveAlarm({ id: 'A', reason: 'Bảo trì', durationS: 3600 })).toEqual({
      ok: true,
      changed: true,
    });
    expect(t.f.calls.at(-1)!.body).toEqual({ id: 'A', reason: 'Bảo trì', durationS: 3600 });
    expect(await t.host.unshelveAlarm('A')).toEqual({ ok: true, changed: false });
    expect(t.f.calls.at(-1)!.body).toEqual({ id: 'A' });
  });
});

// Feature 013 (US4 AC2, AC3): item trong lockedItems khóa "Cần quyền thao tác"; máy chủ trả ACCESS_DENIED.
describe('quyền theo item (013)', () => {
  it('itemBlocked theo AccessView: lockedItems → NO_PERMISSION; khác → null; đổi quyền thì báo onChange', async () => {
    const { AccessView, parseAccess } = await import('./access.ts');
    const { host, changes } = await setup();
    expect(host.itemBlocked({ screen: 'bom1', item: 'run' })).toBeNull();
    changes.mockClear();
    host.setAccess(
      new AccessView(
        parseAccess({
          role: 'operator',
          screens: ['bom1'],
          lockedItems: { bom1: ['run'] },
          admin: false,
        }),
      ),
    );
    expect(changes).toHaveBeenCalled();
    expect(host.itemBlocked({ screen: 'bom1', item: 'run' })).toMatchObject({
      code: 'NO_PERMISSION',
    });
    expect(host.itemBlocked({ screen: 'bom1', item: 'auto' })).toBeNull();
  });

  it('403 ACCESS_DENIED của tags/write → REJECTED mã ACCESS_DENIED, không mở hộp đăng nhập', async () => {
    const { host, requestLogin } = await setup({
      [WRITE]: {
        status: 403,
        json: { error: 'ACCESS_DENIED', message: 'Thiếu quyền thao tác' },
      },
    });
    const o = await run(host, spec());
    expect(o).toMatchObject({ status: 'REJECTED', code: 'ACCESS_DENIED' });
    expect(requestLogin).not.toHaveBeenCalled();
  });
});
