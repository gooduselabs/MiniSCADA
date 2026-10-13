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

  it('đổi phiên (đăng nhập, đăng xuất) báo cho người nghe của host', async () => {
    const { host, session, changes } = await setup();
    changes.mockClear();
    session.expire();
    expect(changes).toHaveBeenCalledTimes(1);
    const un = host.onChange(() => {});
    un();
  });
});
