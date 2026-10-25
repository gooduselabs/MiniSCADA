// Lớp gọi API quản trị (feature 013; contracts/admin-api.md §2–§5). Cookie phiên + `X-MAT-CSRF` (Origin do trình duyệt
// đặt), JSON, `cache: no-store`. Lỗi máy chủ thành `AdminApiError` mang mã (`CONFLICT`, `LAST_ADMIN`, `IN_USE`…) và các
// trường thêm (`usedBy`, `reason`, `resource`, `retryAfterS`). 401 gọi `onUnauthorized` (về trang đăng nhập).
// Mật khẩu và `reauth` chỉ đi trong thân yêu cầu, không giữ lại ở đây.
import { parseAccess, type EffectiveAccess } from '../access.ts';

export type Role = 'viewer' | 'operator' | 'engineer' | 'administrator';
export const ROLES: readonly Role[] = ['viewer', 'operator', 'engineer', 'administrator'];

export interface AdminUser {
  name: string;
  role: Role;
  groups: string[];
  enabled: boolean;
  locked: { until: number } | null;
  lastLoginAt: number | null;
  createdAt: number | null;
  updatedAt: number | null;
  sessions: number;
  /** Feature 023: email nhận cảnh báo alarm của nhóm; null = chưa có. */
  email: string | null;
}

export interface AdminGroup {
  id: string;
  name: string;
  members: string[];
  rules: number;
}

export type ResourceKind = 'screen' | 'popup' | 'item' | 'page' | 'history' | 'report';
export type Level = 'view' | 'operate';

export interface AccessResource {
  id: string;
  kind: ResourceKind;
  title: string;
  screen?: string;
  widget?: string;
  levels: Level[];
  defaults: Partial<Record<Level, Role>>;
}

export interface AccessRule {
  resource: string;
  level: Level;
  grantees: string[];
}

export interface AccessStore {
  rev: number;
  viewerLogin: 'off' | 'required' | null;
  storeState: 'ok' | 'invalid';
  resources: AccessResource[];
  rules: AccessRule[];
  orphans: { resource: string; level: Level }[];
}

export interface AuditRecord {
  id: number;
  ts: number;
  user: string | null;
  role: string | null;
  source: string | null;
  channel: string | null;
  action: string;
  target: string | null;
  result: string;
  code: string | null;
  detail: unknown;
}

/** Feature 025: một API key như `GET /api/v1/admin/apikeys` trả về (không bao giờ có token hay băm). */
export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  role: 'viewer' | 'operator';
  readOnly: boolean;
  canWrite: boolean;
  groups: string[];
  allowFrom: string[];
  expiresAt: string | null;
  expired: boolean;
  ratePerMin: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string | null;
  lastUsedAt: string | null;
  lastFrom: string | null;
  calls: number;
  denied: number;
}

export interface ApiKeyList {
  rev: number;
  storeOk: boolean;
  storeError: string | null;
  keys: ApiKeyInfo[];
  groups: { id: string; name: string }[];
}

/** Thân của tạo/sửa key (feature 025): mọi trường tùy chọn khi sửa. */
export interface ApiKeySettings {
  name?: string;
  role?: 'viewer' | 'operator';
  readOnly?: boolean;
  groups?: string[];
  allowFrom?: string[];
  expiresAt?: string | null;
  ratePerMin?: number;
}

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;
  constructor(status: number, code: string, body: Record<string, unknown>) {
    super(typeof body.message === 'string' ? body.message : code);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
  get reason(): string | undefined {
    return typeof this.body.reason === 'string' ? this.body.reason : undefined;
  }
  get retryAfterS(): number | undefined {
    return typeof this.body.retryAfterS === 'number' ? this.body.retryAfterS : undefined;
  }
  get usedBy(): { users: string[]; rules: { resource: string; level: string }[] } {
    const u = this.body.usedBy as Record<string, unknown> | undefined;
    const users = Array.isArray(u?.users)
      ? u.users.filter((x): x is string => typeof x === 'string')
      : [];
    const rules = Array.isArray(u?.rules)
      ? u.rules.flatMap((r) =>
          r && typeof r === 'object' && typeof (r as { resource?: unknown }).resource === 'string'
            ? [
                {
                  resource: (r as { resource: string }).resource,
                  level: String((r as { level?: unknown }).level ?? 'view'),
                },
              ]
            : typeof r === 'string'
              ? [{ resource: r, level: 'view' }]
              : [],
        )
      : [];
    return { users, rules };
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const role = (v: unknown): Role => (ROLES.includes(v as Role) ? (v as Role) : 'viewer');

export function parseUsers(b: unknown): { rev: number; users: AdminUser[] } {
  if (!isObj(b) || !Array.isArray(b.users)) throw new AdminApiError(0, 'BAD_RESPONSE', {});
  return {
    rev: num(b.rev) ?? 0,
    users: b.users.filter(isObj).map((u) => ({
      name: String(u.name ?? ''),
      role: role(u.role),
      groups: strs(u.groups),
      enabled: u.enabled !== false,
      locked:
        isObj(u.locked) && num(u.locked.until) !== null ? { until: num(u.locked.until)! } : null,
      lastLoginAt: num(u.lastLoginAt),
      createdAt: num(u.createdAt),
      updatedAt: num(u.updatedAt),
      sessions: num(u.sessions) ?? 0,
      email: typeof u.email === 'string' && u.email ? u.email : null,
    })),
  };
}

export function parseApiKeys(b: unknown): ApiKeyList {
  if (!isObj(b) || !Array.isArray(b.keys)) throw new AdminApiError(0, 'BAD_RESPONSE', {});
  const s = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    rev: num(b.rev) ?? 0,
    storeOk: b.storeOk !== false,
    storeError: s(b.storeError),
    keys: b.keys.filter(isObj).map((k) => ({
      id: String(k.id ?? ''),
      name: String(k.name ?? ''),
      prefix: String(k.prefix ?? ''),
      role: k.role === 'operator' ? 'operator' : 'viewer',
      readOnly: k.readOnly !== false,
      canWrite: k.canWrite === true,
      groups: strs(k.groups),
      allowFrom: strs(k.allowFrom),
      expiresAt: s(k.expiresAt),
      expired: k.expired === true,
      ratePerMin: num(k.ratePerMin) ?? 0,
      createdAt: String(k.createdAt ?? ''),
      createdBy: String(k.createdBy ?? ''),
      updatedAt: s(k.updatedAt),
      lastUsedAt: s(k.lastUsedAt),
      lastFrom: s(k.lastFrom),
      calls: num(k.calls) ?? 0,
      denied: num(k.denied) ?? 0,
    })),
    groups: Array.isArray(b.groups)
      ? b.groups.filter(isObj).map((g) => ({ id: String(g.id ?? ''), name: String(g.name ?? '') }))
      : [],
  };
}

export function parseGroups(b: unknown): { rev: number; groups: AdminGroup[] } {
  if (!isObj(b) || !Array.isArray(b.groups)) throw new AdminApiError(0, 'BAD_RESPONSE', {});
  return {
    rev: num(b.rev) ?? 0,
    groups: b.groups.filter(isObj).map((g) => ({
      id: String(g.id ?? ''),
      name: String(g.name ?? g.id ?? ''),
      members: strs(g.members),
      rules: num(g.rules) ?? 0,
    })),
  };
}

const KINDS = new Set(['screen', 'popup', 'item', 'page', 'history', 'report']);
const level = (v: unknown): Level => (v === 'operate' ? 'operate' : 'view');

export function parseAccessStore(b: unknown): AccessStore {
  if (!isObj(b) || !Array.isArray(b.resources)) throw new AdminApiError(0, 'BAD_RESPONSE', {});
  const resources: AccessResource[] = b.resources.filter(isObj).flatMap((r) => {
    if (typeof r.id !== 'string' || !KINDS.has(r.kind as string)) return [];
    const defaults: Partial<Record<Level, Role>> = {};
    if (isObj(r.defaults)) {
      if (r.defaults.view !== undefined) defaults.view = role(r.defaults.view);
      if (r.defaults.operate !== undefined) defaults.operate = role(r.defaults.operate);
    }
    const levels = strs(r.levels).filter((l): l is Level => l === 'view' || l === 'operate');
    const out: AccessResource = {
      id: r.id,
      kind: r.kind as ResourceKind,
      title: typeof r.title === 'string' && r.title ? r.title : r.id,
      levels: levels.length ? levels : ['view'],
      defaults,
    };
    if (typeof r.screen === 'string') out.screen = r.screen;
    if (typeof r.widget === 'string') out.widget = r.widget;
    return [out];
  });
  return {
    rev: num(b.rev) ?? 0,
    viewerLogin: b.viewerLogin === 'off' || b.viewerLogin === 'required' ? b.viewerLogin : null,
    storeState: b.storeState === 'invalid' ? 'invalid' : 'ok',
    resources,
    rules: Array.isArray(b.rules)
      ? b.rules
          .filter(isObj)
          .flatMap((r) =>
            typeof r.resource === 'string'
              ? [{ resource: r.resource, level: level(r.level), grantees: strs(r.grantees) }]
              : [],
          )
      : [],
    orphans: Array.isArray(b.orphans)
      ? b.orphans
          .filter(isObj)
          .flatMap((o) =>
            typeof o.resource === 'string' ? [{ resource: o.resource, level: level(o.level) }] : [],
          )
      : [],
  };
}

export function parseAudit(b: unknown): { records: AuditRecord[]; next: number | null } {
  if (!isObj(b) || !Array.isArray(b.records)) throw new AdminApiError(0, 'BAD_RESPONSE', {});
  const s = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    records: b.records.filter(isObj).map((r) => ({
      id: num(r.id) ?? 0,
      ts: num(r.ts) ?? 0,
      user: s(r.user),
      role: s(r.role),
      source: s(r.source),
      channel: s(r.channel),
      action: String(r.action ?? ''),
      target: s(r.target),
      result: String(r.result ?? ''),
      code: s(r.code),
      detail: r.detail ?? null,
    })),
    next: num(b.next),
  };
}

// ---- email alarm (feature 023, device-api 1.6.0 mở rộng, apiVersion không đổi) ----

export type EmailEvent = 'active' | 'return' | 'reminder';
export interface EmailRule {
  id: string;
  name: string;
  enabled: boolean;
  priorities: number[];
  classes: string[];
  areas: string[];
  events: EmailEvent[];
  reminderMin: number;
  to: string[];
  groups: string[];
}
export interface EmailConfig {
  enabled: boolean;
  siteName: string;
  baseUrl: string;
  smtp: {
    host: string;
    port: number;
    security: 'starttls' | 'smtps' | 'none';
    username: string;
    auth: 'auto' | 'plain' | 'login';
    from: string;
    fromName: string;
    caFile: string;
    pinSha256: string;
    timeoutS: number;
  };
  rules: EmailRule[];
  quietHours: { enabled: boolean; from: string; to: string; minPriority: number };
  batchSeconds: number;
  maxPerHour: number;
  reminderMax: number;
}
export interface EmailStatus {
  enabled: boolean;
  queue: { count: number; bytes: number };
  pendingEvents: number;
  lastOkAt: number | null;
  lastError: { at: number; stage: string; error: string; code: number; message: string } | null;
  nextAttemptInS: number;
  sent: number;
  failed: number;
  dropped: number;
  configError: string | null;
}
export interface EmailSettings {
  rev: number;
  config: EmailConfig;
  passwordSet: boolean;
  status: EmailStatus;
  groups: { id: string; name: string; members: number; withEmail: number }[];
}
export interface EmailTestResult {
  ok: boolean;
  stage: string;
  error: string;
  code: number;
  message: string;
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const EVENTS: readonly EmailEvent[] = ['active', 'return', 'reminder'];

export function defaultEmailConfig(): EmailConfig {
  return {
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
}

export function parseEmailSettings(b: unknown): EmailSettings {
  if (!isObj(b) || !isObj(b.config)) throw new AdminApiError(0, 'BAD_RESPONSE', {});
  const c = b.config;
  const d = defaultEmailConfig();
  const s = isObj(c.smtp) ? c.smtp : {};
  const q = isObj(c.quietHours) ? c.quietHours : {};
  const sec = s.security === 'smtps' || s.security === 'none' ? s.security : 'starttls';
  const auth = s.auth === 'plain' || s.auth === 'login' ? s.auth : 'auto';
  const st = isObj(b.status) ? b.status : {};
  const le = isObj(st.lastError) ? st.lastError : null;
  return {
    rev: num(b.rev) ?? 0,
    passwordSet: b.passwordSet === true,
    config: {
      enabled: c.enabled === true,
      siteName: str(c.siteName),
      baseUrl: str(c.baseUrl),
      smtp: {
        host: str(s.host),
        port: num(s.port) ?? d.smtp.port,
        security: sec,
        username: str(s.username),
        auth,
        from: str(s.from),
        fromName: str(s.fromName),
        caFile: str(s.caFile),
        pinSha256: str(s.pinSha256),
        timeoutS: num(s.timeoutS) ?? d.smtp.timeoutS,
      },
      rules: Array.isArray(c.rules)
        ? c.rules.filter(isObj).map((r) => ({
            id: str(r.id),
            name: str(r.name),
            enabled: r.enabled !== false,
            priorities: Array.isArray(r.priorities)
              ? r.priorities.filter((p): p is number => typeof p === 'number')
              : [],
            classes: strs(r.classes),
            areas: strs(r.areas),
            events: strs(r.events).filter((e): e is EmailEvent => EVENTS.includes(e as EmailEvent)),
            reminderMin: num(r.reminderMin) ?? 30,
            to: strs(r.to),
            groups: strs(r.groups),
          }))
        : [],
      quietHours: {
        enabled: q.enabled === true,
        from: str(q.from, d.quietHours.from),
        to: str(q.to, d.quietHours.to),
        minPriority: num(q.minPriority) ?? 1,
      },
      batchSeconds: num(c.batchSeconds) ?? d.batchSeconds,
      maxPerHour: num(c.maxPerHour) ?? d.maxPerHour,
      reminderMax: num(c.reminderMax) ?? d.reminderMax,
    },
    status: {
      enabled: st.enabled === true,
      queue: {
        count: isObj(st.queue) ? (num(st.queue.count) ?? 0) : 0,
        bytes: isObj(st.queue) ? (num(st.queue.bytes) ?? 0) : 0,
      },
      pendingEvents: num(st.pendingEvents) ?? 0,
      lastOkAt: num(st.lastOkAt),
      lastError: le
        ? {
            at: num(le.at) ?? 0,
            stage: str(le.stage),
            error: str(le.error),
            code: num(le.code) ?? 0,
            message: str(le.message),
          }
        : null,
      nextAttemptInS: num(st.nextAttemptInS) ?? 0,
      sent: num(st.sent) ?? 0,
      failed: num(st.failed) ?? 0,
      dropped: num(st.dropped) ?? 0,
      configError: typeof st.configError === 'string' ? st.configError : null,
    },
    groups: Array.isArray(b.groups)
      ? b.groups.filter(isObj).map((g) => ({
          id: str(g.id),
          name: str(g.name, str(g.id)),
          members: num(g.members) ?? 0,
          withEmail: num(g.withEmail) ?? 0,
        }))
      : [],
  };
}

export interface AdminApiOptions {
  fetch?: typeof fetch;
  csrf: () => Record<string, string>;
  onUnauthorized: () => void;
}

export interface AuditQuery {
  from?: number;
  to?: number;
  user?: string;
  action?: string;
  beforeId?: number;
  limit?: number;
}

export class AdminApi {
  readonly #f: typeof fetch;
  readonly #o: AdminApiOptions;

  constructor(o: AdminApiOptions) {
    this.#o = o;
    this.#f = o.fetch ?? ((...a) => fetch(...a));
  }

  async #call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.#f(path, {
        method,
        cache: 'no-store',
        ...(method === 'POST'
          ? {
              headers: { 'Content-Type': 'application/json', ...this.#o.csrf() },
              body: JSON.stringify(body ?? {}),
            }
          : {}),
      });
    } catch {
      throw new AdminApiError(0, 'NETWORK', {});
    }
    const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.status === 401) {
      this.#o.onUnauthorized();
      throw new AdminApiError(401, 'SESSION_EXPIRED', isObj(data) ? data : {});
    }
    if (!res.ok) {
      const b = isObj(data) ? data : {};
      throw new AdminApiError(
        res.status,
        typeof b.error === 'string' ? b.error : `HTTP_${res.status}`,
        b,
      );
    }
    return data;
  }

  // ---- người dùng (§2) ----
  async users() {
    return parseUsers(await this.#call('GET', '/api/v1/admin/users'));
  }
  async createUser(b: {
    rev: number;
    name: string;
    role: Role;
    groups: string[];
    password?: string;
    generate?: true;
    email?: string;
  }): Promise<{ rev: number; password?: string }> {
    return this.#rev(await this.#call('POST', '/api/v1/admin/users', b));
  }
  async updateUser(
    name: string,
    b: {
      rev: number;
      role?: Role;
      groups?: string[];
      enabled?: boolean;
      unlock?: true;
      reauth?: string;
      email?: string | null;
    },
  ): Promise<{ rev: number; signedOut?: boolean }> {
    return this.#rev(
      await this.#call('POST', `/api/v1/admin/users/${encodeURIComponent(name)}`, b),
    );
  }
  async resetPassword(
    name: string,
    b: { rev: number; password?: string; generate?: true; reauth: string },
  ): Promise<{ rev: number; password?: string; signedOut?: boolean }> {
    return this.#rev(
      await this.#call('POST', `/api/v1/admin/users/${encodeURIComponent(name)}/password`, b),
    );
  }
  async deleteUser(name: string, b: { rev: number; reauth: string }) {
    return this.#rev(
      await this.#call('POST', `/api/v1/admin/users/${encodeURIComponent(name)}/delete`, b),
    );
  }

  // ---- nhóm (§3) ----
  async groups() {
    return parseGroups(await this.#call('GET', '/api/v1/admin/groups'));
  }
  async createGroup(b: { rev: number; id: string; name: string }) {
    return this.#rev(await this.#call('POST', '/api/v1/admin/groups', b));
  }
  async renameGroup(id: string, b: { rev: number; name: string }) {
    return this.#rev(await this.#call('POST', `/api/v1/admin/groups/${encodeURIComponent(id)}`, b));
  }
  async deleteGroup(id: string, b: { rev: number; reauth: string }) {
    return this.#rev(
      await this.#call('POST', `/api/v1/admin/groups/${encodeURIComponent(id)}/delete`, b),
    );
  }

  // ---- quy tắc (§4) ----
  async access() {
    return parseAccessStore(await this.#call('GET', '/api/v1/admin/access'));
  }
  async setAccess(b: {
    rev: number;
    set: { resource: string; level: Level; grantees: string[] | null }[];
  }) {
    return this.#rev(await this.#call('POST', '/api/v1/admin/access', b));
  }
  async cleanup(rev: number): Promise<{ rev: number; removed: number }> {
    const r = await this.#call('POST', '/api/v1/admin/access/cleanup', { rev });
    return { rev: isObj(r) ? (num(r.rev) ?? 0) : 0, removed: isObj(r) ? (num(r.removed) ?? 0) : 0 };
  }
  async restore(reauth: string) {
    return this.#rev(await this.#call('POST', '/api/v1/admin/access/restore', { reauth }));
  }
  async effective(user: string): Promise<EffectiveAccess> {
    const a = parseAccess(
      await this.#call('GET', `/api/v1/admin/effective?user=${encodeURIComponent(user)}`),
    );
    if (!a) throw new AdminApiError(0, 'BAD_RESPONSE', {});
    return a;
  }

  /**
   * EffectiveAccess của nhiều người một lần: `GET /api/v1/admin/effective?users=a,b,c` (≤ 200 mỗi lần) →
   * `{"effective":{"a":EffectiveAccess,…}}`; danh sách dài chia lô 200. Người thiếu trong kết quả thì bỏ.
   */
  async effectiveMany(users: readonly string[]): Promise<Map<string, EffectiveAccess>> {
    const out = new Map<string, EffectiveAccess>();
    for (let i = 0; i < users.length; i += 200) {
      const list = users.slice(i, i + 200);
      const b = await this.#call(
        'GET',
        `/api/v1/admin/effective?users=${encodeURIComponent(list.join(','))}`,
      );
      const map = isObj(b) && isObj(b.effective) ? b.effective : {};
      for (const n of list) {
        const a = parseAccess(map[n]);
        if (a) out.set(n, a);
      }
    }
    return out;
  }

  // ---- nhật ký (§5) ----
  async audit(q: AuditQuery) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
    const qs = p.toString();
    return parseAudit(await this.#call('GET', `/api/v1/admin/audit${qs ? `?${qs}` : ''}`));
  }

  // ---- email alarm (feature 023) ----
  async emailSettings() {
    return parseEmailSettings(await this.#call('GET', '/api/v1/admin/email'));
  }
  async saveEmail(rev: number, config: EmailConfig) {
    return this.#rev(await this.#call('POST', '/api/v1/admin/email', { rev, config }));
  }
  async testEmail(to: string): Promise<EmailTestResult> {
    const r = await this.#call('POST', '/api/v1/admin/email/test', { to });
    const o = isObj(r) ? r : {};
    return {
      ok: o.ok === true,
      stage: str(o.stage),
      error: str(o.error),
      code: num(o.code) ?? 0,
      message: str(o.message),
    };
  }

  // ---- API key của API dữ liệu (feature 025) ----
  async apiKeys() {
    return parseApiKeys(await this.#call('GET', '/api/v1/admin/apikeys'));
  }
  /** Tạo key: `token` chỉ có trong câu trả lời này, trang hiện đúng một lần rồi bỏ. */
  async createApiKey(
    b: ApiKeySettings & { rev: number; name: string; reauth?: string },
  ): Promise<{ rev: number; id: string; token: string }> {
    const r = await this.#call('POST', '/api/v1/admin/apikeys', b);
    const o = isObj(r) ? r : {};
    const key = isObj(o.key) ? o.key : {};
    return { rev: num(o.rev) ?? 0, id: str(key.id), token: str(o.token) };
  }
  async updateApiKey(id: string, b: ApiKeySettings & { rev: number; reauth?: string }) {
    return this.#rev(
      await this.#call('POST', `/api/v1/admin/apikeys/${encodeURIComponent(id)}`, b),
    );
  }
  async revokeApiKey(id: string, rev: number) {
    return this.#rev(
      await this.#call('POST', `/api/v1/admin/apikeys/${encodeURIComponent(id)}/revoke`, { rev }),
    );
  }

  #rev(r: unknown): { rev: number; password?: string; signedOut?: boolean; accessRev?: number } {
    const out: { rev: number; password?: string; signedOut?: boolean; accessRev?: number } = {
      rev: isObj(r) ? (num(r.rev) ?? 0) : 0,
    };
    if (isObj(r) && typeof r.password === 'string') out.password = r.password;
    if (isObj(r) && r.signedOut === true) out.signedOut = true;
    if (isObj(r) && num(r.accessRev) !== null) out.accessRev = num(r.accessRev)!;
    return out;
  }
}
