// Phiên web (feature 007, FR-039, FR-040, FR-049, FR-050; contracts/web-session.md §2, §4): khôi phục sau F5 qua
// `web/session`, đăng nhập/đăng xuất, CSRF chỉ nằm trong bộ nhớ của module, `touch` tối đa 1 lần/phút, HTTP không gọi
// `web/session`, không đặt Origin bằng tay.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSession } from './session.ts';
import { fakeFetch } from './testing.ts';

const SESSION_BODY = {
  user: 'vanhanh1',
  role: 'operator',
  csrfToken: 'CSRF-SECRET-TOKEN-0123456789abcdefghijklmnop',
  expiresAt: '2026-10-20T15:12:00Z',
  idleExpiresAt: '2026-10-20T03:42:00Z',
  idleTimeoutS: 1800,
  maxSessionS: 43200,
};

function make(https = true, routes: Parameters<typeof fakeFetch>[0] = {}) {
  const f = fakeFetch(routes);
  const changes: number[] = [];
  const s = new WebSession({ fetch: f.fn, https, onChange: () => changes.push(1) });
  return { s, f, changes };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('khôi phục phiên (F5)', () => {
  it('HTTPS: GET web/session, có phiên thì giữ user, role; CSRF đi kèm header', async () => {
    const { s, f } = make(true, { 'GET /api/v1/web/session': { json: SESSION_BODY } });
    await s.restore();
    expect(s.info).toEqual({ user: 'vanhanh1', role: 'operator' });
    expect(f.calls[0].credentials).not.toBe('omit');
    expect(s.csrfHeaders()).toEqual({ 'X-MAT-CSRF': SESSION_BODY.csrfToken });
  });

  it('401 → chế độ chỉ xem (không phiên), không ném lỗi', async () => {
    const { s } = make(true, {
      'GET /api/v1/web/session': { status: 401, json: { error: 'AUTH_REQUIRED' } },
    });
    await s.restore();
    expect(s.info).toBeNull();
    expect(s.csrfHeaders()).toEqual({});
  });

  it('404 (runtime 0.5 chưa có web/session) và lỗi mạng cũng là chỉ xem', async () => {
    for (const h of [{ status: 404 }, new Error('mạng')]) {
      const { s } = make(true, { 'GET /api/v1/web/session': h });
      await expect(s.restore()).resolves.toBeUndefined();
      expect(s.info).toBeNull();
    }
  });

  it('HTTP: không gọi web/session', async () => {
    const { s, f } = make(false, { 'GET /api/v1/web/session': { json: SESSION_BODY } });
    await s.restore();
    expect(f.calls).toHaveLength(0);
    expect(s.info).toBeNull();
  });
});

describe('đăng nhập', () => {
  it('POST web/login với JSON, mật khẩu NFC, không đặt Origin; thành công giữ phiên', async () => {
    const { s, f, changes } = make(true, { 'POST /api/v1/web/login': { json: SESSION_BODY } });
    const r = await s.login('vanhanh1', 'Mát khâu'); // "á" dạng tổ hợp (a + dấu sắc rời)
    expect(r).toEqual({ ok: true, info: { user: 'vanhanh1', role: 'operator' } });
    const c = f.calls[0];
    expect(c.method).toBe('POST');
    expect(c.headers['content-type']).toBe('application/json');
    expect(c.headers.origin).toBeUndefined();
    expect(c.body).toEqual({ username: 'vanhanh1', password: 'Mát khâu' });
    expect((c.body as { password: string }).password).toBe('Mát khâu');
    expect(s.info?.role).toBe('operator');
    expect(changes.length).toBeGreaterThan(0);
  });

  it('CSRF không lộ ra ngoài biến của module: không trong đối tượng, localStorage, sessionStorage, URL, window', async () => {
    const { s } = make(true, { 'POST /api/v1/web/login': { json: SESSION_BODY } });
    await s.login('vanhanh1', 'x');
    const secret = SESSION_BODY.csrfToken;
    expect(JSON.stringify(s)).not.toContain(secret);
    expect(JSON.stringify(s.info)).not.toContain(secret);
    expect(JSON.stringify({ ...localStorage })).not.toContain(secret);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(secret);
    expect(location.href).not.toContain(secret);
    expect(document.cookie).not.toContain(secret);
    for (const k of Object.keys(window)) {
      const v = (window as unknown as Record<string, unknown>)[k];
      if (typeof v === 'string') expect(v).not.toContain(secret);
    }
    expect(Object.getOwnPropertyNames(s)).not.toContain('csrf');
  });

  it.each([
    [401, { error: 'AUTH_FAILED' }, 'AUTH_FAILED'],
    [403, { error: 'ORIGIN_MISMATCH' }, 'ORIGIN_MISMATCH'],
    [403, { error: 'HTTPS_REQUIRED' }, 'HTTPS_REQUIRED'],
    [400, { error: 'BAD_REQUEST' }, 'BAD_REQUEST'],
    [503, { error: 'AUDIT_UNAVAILABLE' }, 'AUDIT_UNAVAILABLE'],
  ])('HTTP %i → mã %s, không có phiên', async (status, json, code) => {
    const { s } = make(true, { 'POST /api/v1/web/login': { status, json } });
    const r = await s.login('u', 'p');
    expect(r).toMatchObject({ ok: false, code });
    expect(s.info).toBeNull();
  });

  it('429 AUTH_LOCKED kèm retryAfterS', async () => {
    const { s } = make(true, {
      'POST /api/v1/web/login': { status: 429, json: { error: 'AUTH_LOCKED', retryAfterS: 270 } },
    });
    expect(await s.login('u', 'p')).toEqual({ ok: false, code: 'AUTH_LOCKED', retryAfterS: 270 });
  });

  it('lỗi mạng → NETWORK; thân lạ → mã theo HTTP', async () => {
    const a = make(true, { 'POST /api/v1/web/login': new Error('mạng') });
    expect(await a.s.login('u', 'p')).toMatchObject({ ok: false, code: 'NETWORK' });
    const b = make(true, { 'POST /api/v1/web/login': { status: 500 } });
    expect(await b.s.login('u', 'p')).toMatchObject({ ok: false, code: 'HTTP_500' });
  });

  it('200 nhưng thân thiếu csrfToken → từ chối, không phiên', async () => {
    const { s } = make(true, {
      'POST /api/v1/web/login': { json: { user: 'a', role: 'operator' } },
    });
    expect(await s.login('u', 'p')).toMatchObject({ ok: false, code: 'BAD_RESPONSE' });
    expect(s.info).toBeNull();
  });

  it('HTTP: không đăng nhập được, không gọi mạng', async () => {
    const { s, f } = make(false);
    expect(await s.login('u', 'p')).toMatchObject({ ok: false, code: 'INSECURE' });
    expect(f.calls).toHaveLength(0);
  });
});

describe('đăng xuất và hết hạn', () => {
  it('logout: POST web/logout kèm CSRF rồi xóa phiên và CSRF; lỗi mạng vẫn xóa', async () => {
    const { s, f } = make(true, {
      'POST /api/v1/web/login': { json: SESSION_BODY },
      'POST /api/v1/web/logout': { status: 204 },
    });
    await s.login('u', 'p');
    await s.logout();
    const c = f.calls.find((x) => x.url.endsWith('/logout'))!;
    expect(c.headers['x-mat-csrf']).toBe(SESSION_BODY.csrfToken);
    expect(c.headers.origin).toBeUndefined();
    expect(s.info).toBeNull();
    expect(s.csrfHeaders()).toEqual({});
    const b = make(true, {
      'POST /api/v1/web/login': { json: SESSION_BODY },
      'POST /api/v1/web/logout': new Error('x'),
    });
    await b.s.login('u', 'p');
    await b.s.logout();
    expect(b.s.info).toBeNull();
  });

  it('expire(): xóa phiên, đặt cờ hết hạn, báo thay đổi; đăng nhập lại xóa cờ', async () => {
    const { s, changes } = make(true, { 'POST /api/v1/web/login': { json: SESSION_BODY } });
    await s.login('u', 'p');
    changes.length = 0;
    s.expire();
    expect(s.info).toBeNull();
    expect(s.expired).toBe(true);
    expect(changes).toHaveLength(1);
    s.expire(); // lần hai không báo lại
    expect(changes).toHaveLength(1);
    await s.login('u', 'p');
    expect(s.expired).toBe(false);
  });

  it('chưa từng đăng nhập thì expire() không đặt cờ hết hạn', () => {
    const { s } = make();
    s.expire();
    expect(s.expired).toBe(false);
  });
});

describe('touch', () => {
  async function loggedIn() {
    const m = make(true, {
      'POST /api/v1/web/login': { json: SESSION_BODY },
      'POST /api/v1/web/touch': { status: 204 },
    });
    m.s.watchActivity(document);
    await m.s.login('u', 'p');
    return m;
  }
  const touches = (f: ReturnType<typeof fakeFetch>) => f.count('POST', '/api/v1/web/touch');

  it('không hoạt động của người thì không touch', async () => {
    const { f } = await loggedIn();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(touches(f)).toBe(0);
  });

  it('có chuột hoặc phím: touch tối đa 1 lần mỗi phút, kèm CSRF', async () => {
    const { f } = await loggedIn();
    for (let i = 0; i < 20; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(touches(f)).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(touches(f)).toBe(1);
    expect(f.calls.find((c) => c.url.endsWith('/touch'))!.headers['x-mat-csrf']).toBe(
      SESSION_BODY.csrfToken,
    );
    await vi.advanceTimersByTimeAsync(60_000); // cờ đã tắt: không hoạt động mới thì không touch
    expect(touches(f)).toBe(1);
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(touches(f)).toBe(2);
  });

  it('touch nhận 401 thì phiên hết hạn', async () => {
    const { s, f } = await loggedIn();
    f.set('POST /api/v1/web/touch', { status: 401, json: { error: 'SESSION_EXPIRED' } });
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(s.info).toBeNull();
    expect(s.expired).toBe(true);
  });

  it('đăng xuất thì dừng touch', async () => {
    const { s, f } = await loggedIn();
    f.set('POST /api/v1/web/logout', { status: 204 });
    await s.logout();
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(touches(f)).toBe(0);
  });

  it('phiên khôi phục sau F5 cũng có touch', async () => {
    const m = make(true, {
      'GET /api/v1/web/session': { json: SESSION_BODY },
      'POST /api/v1/web/touch': { status: 204 },
    });
    m.s.watchActivity(document);
    await m.s.restore();
    document.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(touches(m.f)).toBe(1);
  });
});
