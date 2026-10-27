// API quản trị giả của thiết bị giả (feature 027): đủ các đường `/api/v1/admin/*` mà nhóm editor "Người dùng và quyền" của
// Studio gọi qua `device_admin` (013 người dùng, nhóm, quy tắc, quyền hiệu lực, nhật ký; 023 email; 025 API key), với
// `rev` (409 CONFLICT), xác nhận lại mật khẩu (`reauth`, 403 REAUTH_REQUIRED), LAST_ADMIN, IN_USE, EXISTS, WEAK_PASSWORD.
// Tài khoản dùng chung bảng `accounts` của thiết bị giả: người dùng tạo ở đây đăng nhập được ngay. Chỉ dùng cho chế độ e2e
// và test; không có mật khẩu nào trong câu trả lời (trừ mật khẩu sinh, trả một lần như máy chủ thật).
import type { Role } from './device-types.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const RANK: Record<Role, number> = { viewer: 0, operator: 1, engineer: 2, administrator: 3 };
const ROLES = Object.keys(RANK) as Role[];

export interface MockAccount {
  role: Role;
  password: string | null;
}

export interface MockAdminResource {
  id: string;
  kind: 'screen' | 'popup' | 'item' | 'page' | 'history' | 'report';
  title: string;
  screen?: string;
  widget?: string;
  levels: ('view' | 'operate')[];
  defaults: Partial<Record<'view' | 'operate', Role>>;
}

interface UserMeta {
  groups: string[];
  enabled: boolean;
  email: string | null;
  locked: { until: number } | null;
  createdAt: number;
  updatedAt: number | null;
  lastLoginAt: number | null;
}

export interface MockAdminReply {
  status: number;
  body: unknown;
}

/** Điều khiển của e2e (qua `control.admin(tên thiết bị)`). */
export interface MockAdminControl {
  /** Danh mục tài nguyên (màn hình, item, trang) của project "đang chạy". */
  setResources(resources: MockAdminResource[]): void;
  /** Có người khác vừa đổi dữ liệu: tăng `rev` của người dùng và quy tắc (lần lưu sau nhận 409). */
  bumpRev(): void;
  /** Các yêu cầu đã nhận (method, đường, thân; `reauth` thay bằng `***`). */
  readonly requests: Array<{ method: string; path: string; body: unknown }>;
  /** Thư gửi thử đã "gửi". */
  readonly emailTests: string[];
  /** Tên các tài khoản hiện có. */
  users(): string[];
  /** Quy tắc hiện có: `resource|level` → người nhận. */
  rules(): Record<string, string[]>;
  /** Bản ghi nhật ký (mới nhất trước). */
  readonly audit: Array<{ id: number; ts: number; user: string; action: string; target: string }>;
}

const DEFAULT_RESOURCES: MockAdminResource[] = [
  {
    id: 'page:alarms',
    kind: 'page',
    title: 'Alarm',
    levels: ['view', 'operate'],
    defaults: { view: 'viewer', operate: 'operator' },
  },
  {
    id: 'history',
    kind: 'history',
    title: 'History',
    levels: ['view'],
    defaults: { view: 'viewer' },
  },
  {
    id: 'page:reports',
    kind: 'page',
    title: 'Reports',
    levels: ['view'],
    defaults: { view: 'viewer' },
  },
];

export function createMockAdmin(accounts: Map<string, MockAccount>, now = () => Date.now()) {
  const meta = new Map<string, UserMeta>();
  const metaOf = (name: string): UserMeta => {
    let m = meta.get(name);
    if (!m) {
      m = {
        groups: [],
        enabled: true,
        email: null,
        locked: null,
        createdAt: now() - 86_400_000,
        updatedAt: null,
        lastLoginAt: null,
      };
      meta.set(name, m);
    }
    return m;
  };
  let usersRev = 1;
  let accessRev = 1;
  const groups = new Map<string, string>();
  const rules = new Map<string, string[]>();
  let resources: MockAdminResource[] = [...DEFAULT_RESOURCES];
  let emailRev = 1;
  let email: Obj = {
    enabled: false,
    siteName: '',
    baseUrl: '',
    smtp: {
      host: '',
      port: 587,
      security: 'starttls',
      username: '',
      auth: 'auto',
      from: '',
      fromName: '',
      caFile: '',
      pinSha256: '',
      timeoutS: 20,
    },
    rules: [],
    quietHours: { enabled: false, from: '22:00', to: '06:00', minPriority: 1 },
    batchSeconds: 30,
    maxPerHour: 20,
    reminderMax: 3,
  };
  let keysRev = 1;
  let keySeq = 0;
  const keys: Obj[] = [];
  const audit: MockAdminControl['audit'] = [];
  let auditSeq = 100;
  const requests: MockAdminControl['requests'] = [];
  const emailTests: string[] = [];

  const ok = (body: unknown, status = 200): MockAdminReply => ({ status, body });
  const err = (status: number, error: string, extra: Obj = {}): MockAdminReply => ({
    status,
    body: { error, ...extra },
  });
  const log = (user: string, action: string, target: string) =>
    audit.unshift({ id: ++auditSeq, ts: now(), user, action, target });

  const userJson = (name: string) => {
    const a = accounts.get(name)!;
    const m = metaOf(name);
    return {
      name,
      role: a.role,
      groups: [...m.groups],
      enabled: m.enabled,
      locked: m.locked,
      lastLoginAt: m.lastLoginAt,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      sessions: 0,
      email: m.email,
    };
  };
  const admins = () =>
    [...accounts].filter(([n, a]) => a.role === 'administrator' && metaOf(n).enabled).length;
  const reauthOk = (who: string, b: Obj) =>
    typeof b.reauth === 'string' && b.reauth !== '' && accounts.get(who)?.password === b.reauth;
  const genPassword = () => `Sinh-${Math.random().toString(36).slice(2, 10)}-${++keySeq}`;
  const weak = (pw: unknown) => typeof pw !== 'string' || pw.length < 8;

  const grants = (grantees: readonly string[], user: string): boolean => {
    const a = accounts.get(user);
    if (!a) return false;
    return grantees.some(
      (g) =>
        g === '*' ||
        g === `user:${user}` ||
        (g.startsWith('group:') && metaOf(user).groups.includes(g.slice(6))) ||
        (g.startsWith('role:') && RANK[a.role] >= RANK[g.slice(5) as Role]),
    );
  };
  const allowed = (user: string, r: MockAdminResource, level: 'view' | 'operate'): boolean => {
    const a = accounts.get(user);
    if (!a) return false;
    if (a.role === 'administrator') return true;
    const g = rules.get(`${r.id}|${level}`);
    if (g) return grants(g, user);
    const def = r.defaults[level] ?? 'viewer';
    return RANK[a.role] >= RANK[def];
  };
  const effective = (user: string) => {
    const a = accounts.get(user)!;
    const screens = resources.filter(
      (r) => (r.kind === 'screen' || r.kind === 'popup') && allowed(user, r, 'view'),
    );
    const hidden: Record<string, string[]> = {};
    const locked: Record<string, string[]> = {};
    for (const r of resources) {
      if (r.kind !== 'item' || !r.screen) continue;
      const item = r.id.slice(r.id.indexOf('/') + 1);
      if (!allowed(user, r, 'view')) (hidden[r.screen] ??= []).push(item);
      else if (r.levels.includes('operate') && !allowed(user, r, 'operate'))
        (locked[r.screen] ??= []).push(item);
    }
    return {
      user,
      role: a.role,
      groups: [...metaOf(user).groups],
      anonymous: false,
      storeRev: accessRev,
      usersRev,
      projectHash: '',
      screens: screens.map((r) => r.id.slice(r.id.indexOf(':') + 1)),
      hiddenItems: hidden,
      lockedItems: locked,
      pages: resources
        .filter((r) => r.kind === 'page' && allowed(user, r, 'view'))
        .map((r) => r.id.slice(5)),
      admin: a.role === 'administrator',
    };
  };

  function users(who: string, method: string, rest: string[], b: Obj): MockAdminReply {
    if (method === 'GET' && rest.length === 0)
      return ok({ rev: usersRev, users: [...accounts.keys()].sort().map(userJson) });
    if (method !== 'POST') return err(405, 'METHOD');
    if (b.rev !== usersRev) return err(409, 'CONFLICT', { rev: usersRev });
    if (rest.length === 0) {
      const name = String(b.name ?? '');
      if (!/^[a-z][a-z0-9._-]{2,31}$/.test(name)) return err(400, 'BAD_REQUEST');
      if (accounts.has(name)) return err(400, 'EXISTS');
      if (!ROLES.includes(b.role as Role)) return err(400, 'BAD_REQUEST');
      const gs = strs(b.groups);
      if (gs.some((g) => !groups.has(g))) return err(400, 'NOT_FOUND');
      const generated = b.generate === true ? genPassword() : null;
      const pw = generated ?? b.password;
      if (weak(pw)) return err(400, 'WEAK_PASSWORD', { reason: 'TOO_SHORT' });
      accounts.set(name, { role: b.role as Role, password: String(pw) });
      const m = metaOf(name);
      m.groups = gs;
      m.createdAt = now();
      m.email = typeof b.email === 'string' && b.email ? b.email : null;
      usersRev++;
      log(who, 'account.create', name);
      return ok(generated ? { rev: usersRev, password: generated } : { rev: usersRev }, 201);
    }
    const name = decodeURIComponent(rest[0]!);
    const a = accounts.get(name);
    if (!a) return err(404, 'NOT_FOUND');
    const m = metaOf(name);
    const op = rest[1];
    if (op === 'password') {
      if (!reauthOk(who, b)) return err(403, 'REAUTH_REQUIRED');
      const generated = b.generate === true ? genPassword() : null;
      const pw = generated ?? b.password;
      if (weak(pw)) return err(400, 'WEAK_PASSWORD', { reason: 'TOO_SHORT' });
      a.password = String(pw);
      usersRev++;
      log(who, 'account.password', name);
      return ok(
        generated ? { rev: usersRev, password: generated, signedOut: true } : { rev: usersRev },
      );
    }
    if (op === 'delete') {
      if (!reauthOk(who, b)) return err(403, 'REAUTH_REQUIRED');
      if (a.role === 'administrator' && admins() <= 1) return err(409, 'LAST_ADMIN');
      accounts.delete(name);
      meta.delete(name);
      for (const [k, g] of rules)
        rules.set(
          k,
          g.filter((x) => x !== `user:${name}`),
        );
      usersRev++;
      accessRev++;
      log(who, 'account.delete', name);
      return ok({ rev: usersRev, accessRev });
    }
    const role = b.role as Role | undefined;
    if (role !== undefined && !ROLES.includes(role)) return err(400, 'BAD_REQUEST');
    const demote = role !== undefined && RANK[role] < RANK[a.role];
    if ((demote || b.enabled === false) && !reauthOk(who, b)) return err(403, 'REAUTH_REQUIRED');
    if (a.role === 'administrator' && (demote || b.enabled === false) && admins() <= 1)
      return err(409, 'LAST_ADMIN');
    if (b.groups !== undefined) {
      const gs = strs(b.groups);
      if (gs.some((g) => !groups.has(g))) return err(400, 'NOT_FOUND');
      m.groups = gs;
    }
    if (role !== undefined) a.role = role;
    if (typeof b.enabled === 'boolean') m.enabled = b.enabled;
    if (b.unlock === true) m.locked = null;
    if (b.email !== undefined) m.email = typeof b.email === 'string' && b.email ? b.email : null;
    m.updatedAt = now();
    usersRev++;
    log(who, role !== undefined ? 'account.role' : 'account.update', name);
    return ok({ rev: usersRev });
  }

  const groupJson = (id: string) => ({
    id,
    name: groups.get(id)!,
    members: [...accounts.keys()].filter((n) => metaOf(n).groups.includes(id)),
    rules: [...rules.values()].filter((g) => g.includes(`group:${id}`)).length,
  });

  function groupsRoute(who: string, method: string, rest: string[], b: Obj): MockAdminReply {
    if (method === 'GET') return ok({ rev: accessRev, groups: [...groups.keys()].map(groupJson) });
    if (b.rev !== accessRev) return err(409, 'CONFLICT', { rev: accessRev });
    if (rest.length === 0) {
      const id = String(b.id ?? '');
      if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) return err(400, 'BAD_REQUEST');
      if (groups.has(id)) return err(400, 'EXISTS');
      groups.set(id, String(b.name ?? id));
      accessRev++;
      log(who, 'group.create', id);
      return ok({ rev: accessRev }, 201);
    }
    const id = decodeURIComponent(rest[0]!);
    if (!groups.has(id)) return err(404, 'NOT_FOUND');
    if (rest[1] === 'delete') {
      if (!reauthOk(who, b)) return err(403, 'REAUTH_REQUIRED');
      const g = groupJson(id);
      if (g.members.length || g.rules)
        return err(409, 'IN_USE', {
          usedBy: {
            users: g.members,
            rules: [...rules]
              .filter(([, v]) => v.includes(`group:${id}`))
              .map(([k]) => ({ resource: k.split('|')[0], level: k.split('|')[1] })),
          },
        });
      groups.delete(id);
      accessRev++;
      log(who, 'group.delete', id);
      return ok({ rev: accessRev });
    }
    groups.set(id, String(b.name ?? id));
    accessRev++;
    log(who, 'group.rename', id);
    return ok({ rev: accessRev });
  }

  function access(who: string, method: string, rest: string[], b: Obj): MockAdminReply {
    if (method === 'GET')
      return ok({
        rev: accessRev,
        viewerLogin: 'required',
        storeState: 'ok',
        resources,
        rules: [...rules].map(([k, g]) => {
          const [resource, level] = k.split('|');
          return { resource, level, grantees: g };
        }),
        orphans: [],
      });
    if (rest[0] === 'restore') {
      if (!reauthOk(who, b)) return err(403, 'REAUTH_REQUIRED');
      return ok({ rev: accessRev });
    }
    if (b.rev !== accessRev) return err(409, 'CONFLICT', { rev: accessRev });
    if (rest[0] === 'cleanup') return ok({ rev: accessRev, removed: 0 });
    const set = Array.isArray(b.set) ? b.set.filter(isObj) : [];
    for (const s of set) {
      const k = `${String(s.resource)}|${s.level === 'operate' ? 'operate' : 'view'}`;
      if (s.grantees === null) rules.delete(k);
      else rules.set(k, strs(s.grantees));
      log(who, 'access.rule', String(s.resource));
    }
    accessRev++;
    return ok({ rev: accessRev });
  }

  function emailRoute(who: string, method: string, rest: string[], b: Obj): MockAdminReply {
    if (method === 'GET')
      return ok({
        rev: emailRev,
        config: email,
        passwordSet: false,
        status: {
          enabled: email.enabled === true,
          queue: { count: 0, bytes: 0 },
          pendingEvents: 0,
          lastOkAt: emailTests.length ? now() : null,
          lastError: null,
          nextAttemptInS: 0,
          sent: emailTests.length,
          failed: 0,
          dropped: 0,
          configError: null,
        },
        groups: [...groups.keys()].map((id) => ({
          id,
          name: groups.get(id),
          members: groupJson(id).members.length,
          withEmail: groupJson(id).members.filter((n) => metaOf(n).email).length,
        })),
      });
    if (rest[0] === 'test') {
      const to = String(b.to ?? '');
      emailTests.push(to);
      log(who, 'email.test', to);
      return to.includes('loi')
        ? ok({
            ok: false,
            stage: 'connect',
            error: 'CONNECT',
            code: 0,
            message: 'connection refused',
          })
        : ok({ ok: true, stage: 'done', error: '', code: 250, message: 'OK' });
    }
    if (b.rev !== emailRev) return err(409, 'CONFLICT', { rev: emailRev });
    if (isObj(b.config)) email = b.config;
    emailRev++;
    log(who, 'email.config', 'email.json');
    return ok({ rev: emailRev });
  }

  function apikeys(who: string, method: string, rest: string[], b: Obj): MockAdminReply {
    if (method === 'GET')
      return ok({
        rev: keysRev,
        storeOk: true,
        storeError: null,
        keys,
        groups: [...groups.keys()].map((id) => ({ id, name: groups.get(id) })),
      });
    if (b.rev !== keysRev) return err(409, 'CONFLICT', { rev: keysRev });
    const writes = (k: Obj) => k.role === 'operator' && k.readOnly === false;
    if (rest.length === 0) {
      const id = (++keySeq).toString(16).padStart(12, '0');
      const token = `matk_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
      const k: Obj = {
        id,
        name: String(b.name ?? ''),
        prefix: token.slice(0, 12),
        role: b.role === 'operator' ? 'operator' : 'viewer',
        readOnly: b.readOnly !== false,
        groups: strs(b.groups),
        allowFrom: strs(b.allowFrom),
        expiresAt: typeof b.expiresAt === 'string' ? b.expiresAt : null,
        expired: false,
        ratePerMin: typeof b.ratePerMin === 'number' ? b.ratePerMin : 600,
        createdAt: new Date(now()).toISOString(),
        createdBy: who,
        updatedAt: null,
        lastUsedAt: null,
        lastFrom: null,
        calls: 0,
        denied: 0,
      };
      k.canWrite = writes(k);
      if (writes(k) && !reauthOk(who, b)) return err(403, 'REAUTH_REQUIRED');
      keys.push(k);
      keysRev++;
      log(who, 'apikey.create', id);
      return ok({ rev: keysRev, key: k, token }, 201);
    }
    const id = decodeURIComponent(rest[0]!);
    const i = keys.findIndex((k) => k.id === id);
    if (i < 0) return err(404, 'NOT_FOUND');
    if (rest[1] === 'revoke') {
      keys.splice(i, 1);
      keysRev++;
      log(who, 'apikey.revoke', id);
      return ok({ rev: keysRev });
    }
    const before = keys[i]!;
    const next: Obj = { ...before };
    for (const f of ['name', 'role', 'readOnly', 'groups', 'allowFrom', 'expiresAt', 'ratePerMin'])
      if (b[f] !== undefined) next[f] = b[f];
    if (writes(next) && !writes(before) && !reauthOk(who, b)) return err(403, 'REAUTH_REQUIRED');
    next.canWrite = writes(next);
    next.updatedAt = new Date(now()).toISOString();
    keys[i] = next;
    keysRev++;
    log(who, 'apikey.update', id);
    return ok({ rev: keysRev });
  }

  const control: MockAdminControl = {
    setResources(r) {
      resources = [...DEFAULT_RESOURCES, ...r];
      accessRev++;
    },
    bumpRev() {
      usersRev++;
      accessRev++;
    },
    requests,
    emailTests,
    users: () => [...accounts.keys()].sort(),
    rules: () => Object.fromEntries(rules),
    audit,
  };

  /** Một yêu cầu của người `who` (đã đăng nhập; vai trò kiểm ở đây như cổng của máy chủ). */
  function handle(
    who: string,
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string> | undefined,
    body: unknown,
  ): MockAdminReply {
    const b = isObj(body) ? body : {};
    requests.push({ method, path, body: 'reauth' in b ? { ...b, reauth: '***' } : body });
    if (accounts.get(who)?.role !== 'administrator') return err(403, 'FORBIDDEN');
    const parts = path.slice('/api/v1/admin/'.length).split('/');
    const [head, ...rest] = parts;
    switch (head) {
      case 'users':
        return users(who, method, rest, b);
      case 'groups':
        return groupsRoute(who, method, rest, b);
      case 'access':
        return access(who, method, rest, b);
      case 'effective': {
        if (query?.users !== undefined) {
          const out: Obj = {};
          for (const n of query.users.split(',')) if (accounts.has(n)) out[n] = effective(n);
          return ok({ effective: out });
        }
        const u = query?.user ?? '';
        if (!accounts.has(u)) return err(404, 'NOT_FOUND');
        log(who, 'admin.view-as', u);
        return ok(effective(u));
      }
      case 'audit': {
        const before = query?.beforeId ? Number(query.beforeId) : Infinity;
        const limit = Math.min(200, Number(query?.limit ?? 100));
        const rows = audit.filter(
          (r) =>
            r.id < before &&
            (!query?.user || r.user === query.user) &&
            (!query?.action || r.action.startsWith(query.action)),
        );
        const records = rows.slice(0, limit).map((r) => ({
          ...r,
          role: 'administrator',
          source: '192.168.1.20',
          channel: 'https',
          result: 'ok',
          code: null,
          detail: null,
        }));
        return ok({ records, next: rows.length > limit ? records.at(-1)!.id : null });
      }
      case 'email':
        return emailRoute(who, method, rest, b);
      case 'apikeys':
        return apikeys(who, method, rest, b);
      default:
        return err(404, 'NOT_FOUND');
    }
  }

  return { handle, control };
}

export type MockAdmin = ReturnType<typeof createMockAdmin>;
