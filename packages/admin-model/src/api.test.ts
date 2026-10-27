// Lớp API quản trị (feature 013; admin-api §2–§5): đường, CSRF, rev, reauth trong thân; lỗi thành AdminApiError có mã và
// trường thêm; 401 gọi onUnauthorized; đọc thân phòng thủ. Kênh web (`fetchTransport`) và kênh tùy ý (Studio, 027).
import { describe, expect, it, vi } from 'vitest';
import {
  AdminApi,
  AdminApiError,
  fetchTransport,
  parseAccessStore,
  parseApiKeys,
  parseUsers,
  type AdminTransport,
} from './api.ts';

type Reply = { status?: number; json?: unknown } | Error;
interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** `fetch` giả tối thiểu: tuyến `"METHOD /đường"` → trả lời; không có tuyến → 404; `Error` → lỗi mạng. */
function fakeFetch(routes: Record<string, Reply> = {}) {
  const table = new Map(Object.entries(routes));
  const calls: Call[] = [];
  const fn = (async (input: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, url: String(input), headers, body });
    const h = table.get(`${method} ${String(input)}`) ?? { status: 404 };
    if (h instanceof Error) throw h;
    const status = h.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (h.json === undefined) throw new Error('không phải JSON');
        return h.json;
      },
    };
  }) as unknown as typeof fetch;
  return { fn, calls, set: (k: string, h: Reply) => void table.set(k, h) };
}

function mk(routes: Record<string, Reply>) {
  const f = fakeFetch(routes);
  const onUnauthorized = vi.fn();
  const api = new AdminApi({
    transport: fetchTransport({ fetch: f.fn, csrf: () => ({ 'X-MAT-CSRF': 'T' }) }),
    onUnauthorized,
  });
  return { f, api, onUnauthorized };
}

describe('AdminApi qua kênh tùy ý (Studio, feature 027)', () => {
  it('gửi method, đường kèm query, thân; GET không có thân', async () => {
    const seen: [string, string, unknown][] = [];
    const transport: AdminTransport = async (m, p, b) => {
      seen.push([m, p, b]);
      return m === 'GET'
        ? { status: 200, body: { rev: 2, groups: [{ id: 'ca-a', name: 'Ca A' }] } }
        : { status: 201, body: { rev: 3 } };
    };
    const api = new AdminApi({ transport, onUnauthorized: () => {} });
    expect((await api.groups()).groups[0]).toMatchObject({ id: 'ca-a', name: 'Ca A' });
    expect(await api.createGroup({ rev: 2, id: 'ca-b', name: 'Ca B' })).toEqual({ rev: 3 });
    expect(seen).toEqual([
      ['GET', '/api/v1/admin/groups', undefined],
      ['POST', '/api/v1/admin/groups', { rev: 2, id: 'ca-b', name: 'Ca B' }],
    ]);
  });

  it('409 CONFLICT mang rev mới; AdminApiError do kênh ném giữ nguyên mã', async () => {
    const api = new AdminApi({
      transport: async (_m, p) => {
        if (p.endsWith('/users')) return { status: 409, body: { error: 'CONFLICT', rev: 9 } };
        throw new AdminApiError(0, 'PIN_MISMATCH', {});
      },
      onUnauthorized: () => {},
    });
    const e = (await api
      .createUser({ rev: 1, name: 'abc', role: 'viewer', groups: [] })
      .catch((x) => x)) as AdminApiError;
    expect([e.status, e.code, e.body.rev]).toEqual([409, 'CONFLICT', 9]);
    await expect(api.groups()).rejects.toMatchObject({ code: 'PIN_MISMATCH' });
  });
});

describe('AdminApi: API key (feature 025)', () => {
  it('đọc danh sách phòng thủ, không có token', () => {
    const l = parseApiKeys({
      rev: 4,
      storeOk: true,
      keys: [
        {
          id: '0123456789ab',
          name: 'ERP',
          prefix: 'matk_AbCdEfG',
          role: 'operator',
          readOnly: false,
          canWrite: true,
          groups: ['kho'],
          allowFrom: ['192.0.2.0/24'],
          expiresAt: null,
          calls: 7,
          lastUsedAt: '2026-10-25T01:00:00.000Z',
        },
        'rác',
      ],
      groups: [{ id: 'kho', name: 'Kho' }],
    });
    expect(l.rev).toBe(4);
    expect(l.keys).toHaveLength(1);
    expect(l.keys[0]).toMatchObject({ id: '0123456789ab', canWrite: true, calls: 7, denied: 0 });
    expect(l.groups).toEqual([{ id: 'kho', name: 'Kho' }]);
    expect(() => parseApiKeys({ rev: 1 })).toThrow(AdminApiError);
  });

  it('tạo, sửa, thu hồi: đường, CSRF, rev, reauth', async () => {
    const { api, f } = mk({
      'POST /api/v1/admin/apikeys': {
        status: 201,
        json: { rev: 2, key: { id: 'abcdefabcdef' }, token: 'matk_x' },
      },
      'POST /api/v1/admin/apikeys/abcdefabcdef': { json: { rev: 3 } },
      'POST /api/v1/admin/apikeys/abcdefabcdef/revoke': { json: { rev: 4 } },
    });
    expect(
      await api.createApiKey({
        rev: 1,
        name: 'MES',
        role: 'operator',
        readOnly: false,
        reauth: 'mk',
      }),
    ).toEqual({ rev: 2, id: 'abcdefabcdef', token: 'matk_x' });
    expect(f.calls[0]!.headers['x-mat-csrf']).toBe('T');
    expect(f.calls[0]!.body).toEqual({
      rev: 1,
      name: 'MES',
      role: 'operator',
      readOnly: false,
      reauth: 'mk',
    });
    expect(await api.updateApiKey('abcdefabcdef', { rev: 2, ratePerMin: 60 })).toEqual({ rev: 3 });
    expect(await api.revokeApiKey('abcdefabcdef', 3)).toEqual({ rev: 4 });
    expect(f.calls[2]!.body).toEqual({ rev: 3 });
  });
});

describe('AdminApi', () => {
  it('GET users: đọc rev và người dùng', async () => {
    const { api } = mk({
      'GET /api/v1/admin/users': {
        json: {
          rev: 12,
          users: [
            {
              name: 'vh1',
              role: 'operator',
              groups: ['a'],
              enabled: true,
              locked: { until: 5 },
              sessions: 2,
            },
          ],
        },
      },
    });
    const r = await api.users();
    expect(r.rev).toBe(12);
    expect(r.users[0]).toMatchObject({
      name: 'vh1',
      role: 'operator',
      locked: { until: 5 },
      sessions: 2,
    });
  });

  it('POST: JSON, CSRF, thân đúng hợp đồng (rev, reauth)', async () => {
    const { api, f } = mk({
      'POST /api/v1/admin/users/vh%2B1/delete': { json: { rev: 13, accessRev: 8 } },
    });
    expect(await api.deleteUser('vh+1', { rev: 12, reauth: 'mk' })).toEqual({
      rev: 13,
      accessRev: 8,
    });
    const c = f.calls[0]!;
    expect(c.headers['x-mat-csrf']).toBe('T');
    expect(c.headers['content-type']).toBe('application/json');
    expect(c.body).toEqual({ rev: 12, reauth: 'mk' });
  });

  it('createUser generate: trả password một lần', async () => {
    const { api } = mk({
      'POST /api/v1/admin/users': { status: 201, json: { rev: 3, password: 'abc' } },
    });
    expect(
      await api.createUser({ rev: 2, name: 'x', role: 'viewer', groups: [], generate: true }),
    ).toEqual({
      rev: 3,
      password: 'abc',
    });
  });

  it('lỗi: mã, usedBy, reason, retryAfterS', async () => {
    const { api, f } = mk({
      'POST /api/v1/admin/groups/a/delete': {
        status: 409,
        json: {
          error: 'IN_USE',
          usedBy: { users: ['vh1'], rules: [{ resource: 'screen:x', level: 'view' }] },
        },
      },
    });
    const e = (await api
      .deleteGroup('a', { rev: 1, reauth: 'x' })
      .catch((x) => x)) as AdminApiError;
    expect(e).toBeInstanceOf(AdminApiError);
    expect(e.code).toBe('IN_USE');
    expect(e.usedBy).toEqual({ users: ['vh1'], rules: [{ resource: 'screen:x', level: 'view' }] });
    f.set('POST /api/v1/admin/groups/a/delete', {
      status: 429,
      json: { error: 'RATE_LIMITED', retryAfterS: 30 },
    });
    const r = (await api
      .deleteGroup('a', { rev: 1, reauth: 'x' })
      .catch((x) => x)) as AdminApiError;
    expect([r.code, r.retryAfterS]).toEqual(['RATE_LIMITED', 30]);
  });

  it('401 gọi onUnauthorized; lỗi mạng → NETWORK', async () => {
    const { api, f, onUnauthorized } = mk({
      'GET /api/v1/admin/groups': { status: 401, json: { error: 'SESSION_EXPIRED' } },
    });
    await expect(api.groups()).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    f.set('GET /api/v1/admin/groups', new Error('x'));
    await expect(api.groups()).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('audit: tham số beforeId, action, limit', async () => {
    const { api, f } = mk({});
    f.set('GET /api/v1/admin/audit?action=account.&beforeId=90&limit=50', {
      json: { records: [{ id: 89, ts: 1, action: 'account.role', result: 'ok' }], next: null },
    });
    const r = await api.audit({ action: 'account.', beforeId: 90, limit: 50 });
    expect(r.records[0]).toMatchObject({ id: 89, action: 'account.role' });
    expect(r.next).toBeNull();
  });

  it('effective: thân EffectiveAccess', async () => {
    const { api } = mk({
      'GET /api/v1/admin/effective?user=vh1': {
        json: { user: 'vh1', role: 'operator', screens: ['a'], admin: false },
      },
    });
    expect((await api.effective('vh1')).screens).toEqual(['a']);
  });
});

describe('parse phòng thủ', () => {
  it('parseUsers: vai trò lạ thành viewer, thiếu khóa thành mặc định', () => {
    expect(parseUsers({ rev: 1, users: [{ name: 'a', role: 'root' }] }).users[0]).toMatchObject({
      role: 'viewer',
      groups: [],
      enabled: true,
      locked: null,
      sessions: 0,
    });
    expect(() => parseUsers({})).toThrow(AdminApiError);
  });
  it('parseAccessStore: bỏ tài nguyên sai loại, đọc mồ côi và storeState', () => {
    const s = parseAccessStore({
      rev: 7,
      viewerLogin: 'off',
      storeState: 'invalid',
      resources: [
        {
          id: 'screen:a',
          kind: 'screen',
          title: 'A',
          levels: ['view'],
          defaults: { view: 'operator' },
        },
        { id: 'x', kind: 'weird' },
      ],
      rules: [{ resource: 'screen:a', level: 'view', grantees: ['*'] }],
      orphans: [{ resource: 'screen:gone', level: 'view' }],
    });
    expect(s.resources.map((r) => r.id)).toEqual(['screen:a']);
    expect(s.resources[0]!.defaults).toEqual({ view: 'operator' });
    expect([s.viewerLogin, s.storeState, s.orphans.length]).toEqual(['off', 'invalid', 1]);
  });
});

describe('effectiveMany (lô ≤ 200)', () => {
  it('một lần gọi users=a,b; > 200 chia lô; đọc {effective:{tên: EffectiveAccess}}', async () => {
    const { api, f } = mk({});
    const names = Array.from({ length: 250 }, (_, i) => `u${i}`);
    const body = (list: string[]) => ({
      json: {
        effective: Object.fromEntries(
          list.map((n) => [n, { user: n, role: 'viewer', screens: ['a'], admin: false }]),
        ),
      },
    });
    f.set(
      `GET /api/v1/admin/effective?users=${names.slice(0, 200).join('%2C')}`,
      body(names.slice(0, 200)),
    );
    f.set(
      `GET /api/v1/admin/effective?users=${names.slice(200).join('%2C')}`,
      body(names.slice(200)),
    );
    const m = await api.effectiveMany(names);
    expect(m.size).toBe(250);
    expect(m.get('u249')?.screens).toEqual(['a']);
    expect(f.calls).toHaveLength(2);
  });
});
