// Phân quyền giả cho e2e của trang vận hành (feature 013; contracts/access-model.md, admin-api.md). Bật khi kịch bản có
// `options.access`. Cài đủ cho trang: kho người dùng, nhóm, quy tắc trong bộ nhớ (có `rev`, `409 CONFLICT`), tính
// EffectiveAccess theo access-model §4 (hàm `computeAccess` đơn giản), API `/api/v1/web/access|password` và
// `/api/v1/admin/*` (xác nhận lại `reauth`, LAST_ADMIN, IN_USE, EXISTS, WEAK_PASSWORD, RATE_LIMITED, STORE_INVALID,
// audit), lọc `/project/<màn hình>` và `projects/active`, Tag `denied` trên live, `access-changed`.
// Chỉ là mô phỏng cho trang: luật kiểm thật ở runtime C++ và tests/web-it.

const RANK = { viewer: 0, operator: 1, engineer: 2, administrator: 3 };
const ROLES = Object.keys(RANK);
const NAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;
const GROUP_RE = /^[a-z][a-z0-9-]{1,31}$/;
const PAGES = ['alarms', 'history', 'reports', 'watch'];
/** Widget thuộc nhóm `control` của danh mục (thao tác được). */
const CONTROL = new Set(['button', 'switch', 'setpoint', 'slider', 'select', 'toggle']);

const tagsOfItem = (it) => {
  const out = [];
  for (const v of Object.values(it.tags ?? {})) {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
  }
  return out;
};
const itemTitle = (it) =>
  String(it.name ?? it.props?.label ?? it.props?.title ?? it.props?.text ?? it.id).slice(0, 80);
const operableOf = (it) =>
  it.type === 'widget' &&
  CONTROL.has(it.widget) &&
  (it.widget !== 'button' ||
    ['write', 'pulse', 'toggle'].includes(it.events?.click?.action ?? '') ||
    Boolean(it.tags?.target));

/** Danh mục tài nguyên từ project giả (access-model §2, §3). */
export function catalogOf(proj) {
  const screens = [];
  for (const s of proj.active.screens ?? []) {
    const f = proj.files.get(s.file);
    const model = f?.json;
    if (!model) continue;
    screens.push({
      id: s.id,
      name: s.name,
      popup: s.kind === 'popup',
      view: model.security?.view ?? 'viewer',
      items: (model.items ?? []).map((it) => ({
        id: it.id,
        title: itemTitle(it),
        widget: it.type === 'svg' ? 'svg' : it.widget,
        operable: operableOf(it),
        view: it.security?.view ?? 'viewer',
        operate: it.security?.operate ?? it.security?.minRole ?? 'operator',
        tags: tagsOfItem(it),
      })),
    });
  }
  return { screens, historyGroups: proj.historyGroups ?? [], reports: proj.reportList ?? [] };
}

/** Tài nguyên cho `GET /api/v1/admin/access`. */
function resourcesOf(cat) {
  const out = [];
  for (const s of cat.screens) {
    out.push({
      id: `screen:${s.id}`,
      kind: s.popup ? 'popup' : 'screen',
      title: s.name,
      levels: ['view'],
      defaults: { view: s.view },
    });
  }
  for (const p of PAGES)
    out.push({
      id: `page:${p}`,
      kind: 'page',
      title: { alarms: 'Alarm', history: 'Lịch sử', reports: 'Báo cáo', watch: 'Bảng theo dõi' }[p],
      levels: ['view'],
      defaults: { view: p === 'watch' ? 'operator' : 'viewer' },
    });
  for (const g of cat.historyGroups)
    out.push({
      id: `history:${g.id}`,
      kind: 'history',
      title: g.name ?? g.id,
      levels: ['view'],
      defaults: { view: 'viewer' },
    });
  for (const r of cat.reports)
    out.push({
      id: `report:${r.id}`,
      kind: 'report',
      title: r.name ?? r.id,
      levels: ['view'],
      defaults: { view: 'viewer' },
    });
  for (const s of cat.screens)
    for (const it of s.items)
      out.push({
        id: `item:${s.id}/${it.id}`,
        kind: 'item',
        title: it.title,
        screen: s.id,
        widget: it.widget,
        levels: it.operable ? ['view', 'operate'] : ['view'],
        defaults: it.operable ? { view: it.view, operate: it.operate } : { view: it.view },
      });
  return out;
}

/** computeAccess (access-model §4), phiên bản rút gọn của e2e. */
export function computeAccess(cat, store, P) {
  const rules = new Map(store.rules.map((r) => [`${r.resource}|${r.level}`, r.grantees]));
  const admin = P.role === 'administrator';
  const match = (g) =>
    g === '*'
      ? P.user !== null
      : g.startsWith('user:')
        ? P.user === g.slice(5)
        : g.startsWith('group:')
          ? P.groups.includes(g.slice(6))
          : g.startsWith('role:')
            ? RANK[P.role] >= RANK[g.slice(5)]
            : false;
  const allowed = (res, level, def) => {
    if (admin) return true;
    if (store.invalid) return false;
    if (RANK[P.role] < RANK[level === 'operate' ? 'operator' : 'viewer']) return false;
    if (RANK[P.role] < RANK[def]) return false;
    const g = rules.get(`${res}|${level}`);
    return g ? g.some(match) : true;
  };
  const screens = [];
  const hiddenItems = {};
  const lockedItems = {};
  const live = new Set();
  const itemOk = new Map();
  for (const s of cat.screens) {
    if (!allowed(`screen:${s.id}`, 'view', s.view)) continue;
    screens.push(s.id);
    for (const it of s.items) {
      const v = allowed(`item:${s.id}/${it.id}`, 'view', it.view);
      const o = v && it.operable && allowed(`item:${s.id}/${it.id}`, 'operate', it.operate);
      itemOk.set(`${s.id}/${it.id}`, { view: v, operate: o, tags: it.tags });
      if (!v) (hiddenItems[s.id] ??= []).push(it.id);
      else {
        for (const t of it.tags) live.add(t);
        if (it.operable && !o) (lockedItems[s.id] ??= []).push(it.id);
      }
    }
  }
  const pages = PAGES.filter((p) =>
    allowed(`page:${p}`, 'view', p === 'watch' ? 'operator' : 'viewer'),
  );
  return {
    effective: {
      user: P.user,
      role: P.role,
      groups: P.groups,
      anonymous: P.user === null,
      storeRev: store.rev,
      usersRev: 0,
      projectHash: 'sha256:e2e',
      screens,
      hiddenItems,
      lockedItems,
      pages,
      admin,
    },
    live,
    itemOk,
  };
}

/**
 * Bộ phân quyền giả. `seed`: `{ users: [{name, role, groups?, password, enabled?}], groups: [{id,name}], rules: [] }`.
 * `deps`: `{ proj: () => project, sessions: Map, json, err, readBody, originOk, eq, broadcast(type) }`.
 */
export function makeAccess(seed, deps) {
  const now = () => Date.now();
  const users = new Map(
    (seed.users ?? []).map((u) => [
      u.name,
      {
        name: u.name,
        role: u.role,
        groups: [...(u.groups ?? [])],
        enabled: u.enabled !== false,
        password: u.password,
        locked: u.lockedUntil ? { until: u.lockedUntil } : null,
        lastLoginAt: u.lastLoginAt ?? null,
        createdAt: u.createdAt ?? now() - 86_400_000 * 30,
        updatedAt: now() - 86_400_000,
        fails: 0,
      },
    ]),
  );
  const store = {
    rev: seed.accessRev ?? 1,
    usersRev: seed.usersRev ?? 1,
    groups: (seed.groups ?? []).map((g) => ({ ...g })),
    rules: (seed.rules ?? []).map((r) => ({ ...r, grantees: [...r.grantees] })),
    invalid: false,
    bak: null,
  };
  const audit = [];
  let auditId = 1000;
  const rate = new Map(); // phiên → [thời điểm]
  const cfg = { rateLimit: seed.rateLimit ?? 30, viewerLogin: seed.viewerLogin ?? 'required' };
  const log = { reauth: [], posts: [], effective: [] };
  // feature 025: API key giả (token chỉ trả một lần, không giữ)
  const apikeys = { rev: 0, keys: [], seq: 0, tokens: [] };
  // feature 027: thiết lập thiết bị và chứng chỉ giả
  const devBase = {
    viewerLogin: 'required',
    viewerAccess: 'private',
    allowedHosts: [],
    maxLiveClientsPerSource: 0,
    updateEnabled: false,
    deviceName: 'BL335-demo',
  };
  const device = {
    rev: 0,
    settings: {},
    restarts: 0,
    fingerprint: 'ab'.repeat(32),
    sanIps: [],
    csr: 0,
    imports: 0,
  };
  const devEffective = () => ({ ...devBase, ...device.settings });
  const fpColons = (h) => h.toUpperCase().match(/.{2}/g).join(':');
  // feature 023: cấu hình email alarm giả (không có mật khẩu: chỉ passwordSet)
  const email = {
    rev: 0,
    passwordSet: seed.emailPasswordSet ?? true,
    tests: [],
    config: {
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
    },
    status: {
      enabled: false,
      queue: { count: 1, bytes: 2048 },
      pendingEvents: 0,
      lastOkAt: null,
      lastError: {
        at: now() - 60_000,
        stage: 'connect',
        error: 'CONNECT',
        code: 0,
        message: 'Không kết nối được smtp.example.com:587',
      },
      nextAttemptInS: 25,
      sent: 4,
      failed: 1,
      dropped: 0,
      configError: null,
    },
  };

  const record = (s, action, target, result, detail = null, code = null) => {
    audit.unshift({
      id: ++auditId,
      ts: now(),
      clockOk: true,
      user: s?.user ?? null,
      role: s?.role ?? null,
      source: '127.0.0.1',
      channel: 'web',
      action,
      target,
      result,
      code,
      detail,
      count: 1,
    });
  };
  // Vài dòng có sẵn để tab Nhật ký có dữ liệu.
  for (let i = 0; i < (seed.auditSeed ?? 0); i++)
    audit.push({
      id: 900 - i,
      ts: now() - (i + 1) * 3_600_000,
      clockOk: true,
      user: i % 3 === 0 ? 'vh1' : 'quantri',
      role: i % 3 === 0 ? 'operator' : 'administrator',
      source: '192.168.1.20',
      channel: 'web',
      action: i % 3 === 0 ? 'auth.login' : i % 3 === 1 ? 'access.rule' : 'account.role',
      target: i % 3 === 0 ? 'vh1' : i % 3 === 1 ? 'screen:bon-nuoc' : 'vh2',
      result: i % 5 === 4 ? 'denied' : 'ok',
      code: i % 5 === 4 ? 'ACCESS_DENIED' : null,
      detail: i % 3 === 1 ? { before: null, after: ['group:bao-tri'] } : null,
      count: 1,
    });

  const principal = (s) =>
    s
      ? { user: s.user, role: s.role, groups: users.get(s.user)?.groups ?? s.groups ?? [] }
      : { user: null, role: 'viewer', groups: [] };
  const cat = () => catalogOf(deps.proj());
  const effectiveOf = (s) => computeAccess(cat(), store, principal(s));

  const usersBody = () => ({
    rev: store.usersRev,
    users: [...users.values()].map((u) => ({
      name: u.name,
      role: u.role,
      groups: u.groups,
      enabled: u.enabled,
      locked: u.locked && u.locked.until > now() ? { until: u.locked.until } : null,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      sessions: [...deps.sessions.values()].filter((x) => x.user === u.name).length,
      email: u.email ?? null,
    })),
  });
  const groupsBody = () => ({
    rev: store.rev,
    groups: store.groups.map((g) => ({
      id: g.id,
      name: g.name,
      members: [...users.values()].filter((u) => u.groups.includes(g.id)).map((u) => u.name),
      rules: store.rules.filter((r) => r.grantees.includes(`group:${g.id}`)).length,
    })),
  });
  const resIds = () => new Set(resourcesOf(cat()).map((r) => r.id));
  const accessBody = () => {
    const ids = resIds();
    return {
      rev: store.rev,
      viewerLogin: cfg.viewerLogin,
      storeState: store.invalid ? 'invalid' : 'ok',
      resources: resourcesOf(cat()),
      rules: store.invalid ? [] : store.rules,
      orphans: store.rules
        .filter((r) => !ids.has(r.resource))
        .map((r) => ({ resource: r.resource, level: r.level })),
    };
  };
  const activeAdmins = (except) =>
    [...users.values()].filter((u) => u.role === 'administrator' && u.enabled && u.name !== except);
  const dropSessions = (name) => {
    for (const [t, v] of deps.sessions) if (v.user === name) deps.sessions.delete(t);
  };
  const genPassword = () => {
    const a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let p = '';
    for (let i = 0; i < 20; i++) p += a[Math.floor(Math.random() * a.length)];
    return p;
  };
  const weak = (p, name) =>
    typeof p !== 'string'
      ? 'TOO_SHORT'
      : [...p].length < 15
        ? 'TOO_SHORT'
        : [...p].length > 128
          ? 'TOO_LONG'
          : name && p.toLowerCase().includes(name)
            ? 'CONTAINS_NAME'
            : null;
  const writeStore = () => {
    store.bak = JSON.stringify({ groups: store.groups, rules: store.rules });
    store.rev++;
    deps.broadcast('access-changed');
  };

  /** Đăng nhập theo kho (trả `{ok, role, groups}` hoặc `{error, status, retryAfterS?}`). */
  function authenticate(name, password) {
    const u = users.get(name);
    if (u?.locked && u.locked.until > now())
      return {
        status: 429,
        error: 'AUTH_LOCKED',
        retryAfterS: Math.ceil((u.locked.until - now()) / 1000),
      };
    if (!u || !u.enabled || !deps.eq(u.password, password)) {
      if (u) {
        u.fails++;
        if (u.fails >= 5) {
          u.locked = { until: now() + 300_000 };
          u.fails = 0;
          record({ user: name }, 'auth.lock', name, 'ok');
          return { status: 429, error: 'AUTH_LOCKED', retryAfterS: 300 };
        }
      }
      record({ user: name }, 'auth.login', name, 'denied', null, 'AUTH_FAILED');
      return { status: 401, error: 'AUTH_FAILED' };
    }
    u.fails = 0;
    u.lastLoginAt = now();
    record({ user: name, role: u.role }, 'auth.login', name, 'ok');
    return { ok: true, role: u.role, groups: [...u.groups] };
  }

  /** Item `screen/item` được thao tác với Tag `tag` (tags/write cookie, admin-api §6). */
  function canWrite(s, context, tag) {
    if (!context || typeof context.screen !== 'string' || typeof context.widget !== 'string')
      return false;
    const e = effectiveOf(s);
    const it = e.itemOk.get(`${context.screen}/${context.widget}`);
    return Boolean(it?.operate && it.tags.includes(tag));
  }

  /** Màn hình được xem? (/project/<màn hình>) và item cần bỏ. */
  function screenFilter(s, screenId) {
    const e = effectiveOf(s).effective;
    if (!e.screens.includes(screenId)) return null;
    return e.hiddenItems[screenId] ?? [];
  }

  function reauthOk(s, body) {
    log.reauth.push(body?.reauth ?? null);
    const me = users.get(s.user);
    return typeof body?.reauth === 'string' && me && deps.eq(me.password, body.reauth);
  }

  async function handle(req, res, s, path, url) {
    const m = req.method;
    const { json, err } = deps;
    if (path === '/api/v1/web/access' && m === 'GET')
      return json(res, 200, effectiveOf(s).effective);
    if (!s) return err(res, 401, 'AUTH_REQUIRED');
    if (path === '/api/v1/web/password' && m === 'POST') {
      const body = await readJson(req);
      const me = users.get(s.user);
      if (!me || !deps.eq(me.password, body?.old ?? '')) {
        record(s, 'account.password', s.user, 'denied', null, 'REAUTH_REQUIRED');
        return err(res, 403, 'REAUTH_REQUIRED');
      }
      const w = weak(body?.new);
      if (w) return err(res, 400, 'WEAK_PASSWORD', { reason: w });
      me.password = body.new;
      me.updatedAt = now();
      for (const [t, v] of deps.sessions) if (v.user === s.user && v !== s) deps.sessions.delete(t);
      record(s, 'account.password', s.user, 'ok');
      return json(res, 204, undefined);
    }
    if (!path.startsWith('/api/v1/admin/')) return err(res, 404, 'NOT_FOUND');
    if (s.role !== 'administrator') {
      record(s, 'access.denied', path, 'denied', null, 'FORBIDDEN');
      return err(res, 403, 'FORBIDDEN');
    }
    if (m === 'POST') {
      const list = (rate.get(s) ?? []).filter((t) => t > now() - 60_000);
      if (list.length >= cfg.rateLimit) {
        record(s, 'admin.rate', path, 'denied', null, 'RATE_LIMITED');
        return err(res, 429, 'RATE_LIMITED', { retryAfterS: 60 });
      }
      list.push(now());
      rate.set(s, list);
    }
    const body = m === 'POST' ? await readJson(req) : null;
    if (m === 'POST')
      log.posts.push({ path, body: { ...body, reauth: body?.reauth ? '***' : undefined } });
    if (m === 'POST' && body === undefined) return err(res, 400, 'BAD_REQUEST');

    // ---- người dùng ----
    if (path === '/api/v1/admin/users' && m === 'GET') return json(res, 200, usersBody());
    if (path === '/api/v1/admin/users' && m === 'POST') {
      if (body.rev !== store.usersRev) return err(res, 409, 'CONFLICT');
      if (!NAME_RE.test(body.name ?? '')) return err(res, 400, 'BAD_REQUEST', { field: 'name' });
      if (users.has(body.name)) return err(res, 409, 'EXISTS');
      if (!ROLES.includes(body.role)) return err(res, 400, 'BAD_REQUEST', { field: 'role' });
      const gs = body.groups ?? [];
      if (gs.some((g) => !store.groups.some((x) => x.id === g)))
        return err(res, 400, 'NOT_FOUND', { field: 'groups' });
      let password = body.password;
      if (body.generate === true) password = genPassword();
      else {
        const w = weak(password, body.name);
        if (w) return err(res, 400, 'WEAK_PASSWORD', { reason: w });
      }
      users.set(body.name, {
        name: body.name,
        role: body.role,
        groups: [...gs],
        enabled: true,
        password,
        locked: null,
        lastLoginAt: null,
        createdAt: now(),
        updatedAt: now(),
        fails: 0,
      });
      store.usersRev++;
      record(s, 'account.create', body.name, 'ok', {
        before: null,
        after: { role: body.role, groups: gs },
      });
      return json(res, 201, { rev: store.usersRev, ...(body.generate ? { password } : {}) });
    }
    let mm = /^\/api\/v1\/admin\/users\/([^/]+)(\/password|\/delete)?$/.exec(path);
    if (mm && m === 'POST') {
      const name = decodeURIComponent(mm[1]);
      const u = users.get(name);
      if (body.rev !== store.usersRev) return err(res, 409, 'CONFLICT');
      if (!u) return err(res, 404, 'NOT_FOUND');
      if (mm[2] === '/password') {
        if (!reauthOk(s, body)) {
          record(s, 'account.password', name, 'denied', null, 'REAUTH_REQUIRED');
          return err(res, 403, 'REAUTH_REQUIRED');
        }
        let password = body.password;
        if (body.generate === true) password = genPassword();
        else {
          const w = weak(password, name);
          if (w) return err(res, 400, 'WEAK_PASSWORD', { reason: w });
        }
        u.password = password;
        u.updatedAt = now();
        store.usersRev++;
        dropSessions(name);
        record(s, 'account.password', name, 'ok');
        return json(res, 200, {
          rev: store.usersRev,
          ...(body.generate ? { password } : {}),
          ...(name === s.user ? { signedOut: true } : {}),
        });
      }
      if (mm[2] === '/delete') {
        if (!reauthOk(s, body)) return err(res, 403, 'REAUTH_REQUIRED');
        if (u.role === 'administrator' && activeAdmins(name).length === 0)
          return err(res, 409, 'LAST_ADMIN');
        users.delete(name);
        store.usersRev++;
        dropSessions(name);
        const before = store.rules.length;
        for (const r of store.rules) r.grantees = r.grantees.filter((g) => g !== `user:${name}`);
        if (before) writeStore();
        record(s, 'account.delete', name, 'ok', { before: { role: u.role }, after: null });
        return json(res, 200, { rev: store.usersRev, accessRev: store.rev });
      }
      // sửa
      const demote = body.role !== undefined && RANK[body.role] < RANK[u.role];
      const disable = body.enabled === false && u.enabled;
      if ((demote || disable) && !reauthOk(s, body)) return err(res, 403, 'REAUTH_REQUIRED');
      if (body.role !== undefined && !ROLES.includes(body.role))
        return err(res, 400, 'BAD_REQUEST');
      if (
        u.role === 'administrator' &&
        u.enabled &&
        ((body.role && body.role !== 'administrator') || body.enabled === false) &&
        activeAdmins(name).length === 0
      )
        return err(res, 409, 'LAST_ADMIN');
      if (body.groups && body.groups.some((g) => !store.groups.some((x) => x.id === g)))
        return err(res, 400, 'NOT_FOUND', { field: 'groups' });
      const before = { role: u.role, groups: [...u.groups], enabled: u.enabled };
      if (body.role !== undefined) u.role = body.role;
      if (body.groups !== undefined) u.groups = [...body.groups];
      // feature 023: email của tài khoản (không làm hết phiên)
      if (body.email !== undefined) {
        if (body.email !== null && !/^[^s@]+@[^s@]+.[^s@]+$/.test(body.email))
          return err(res, 400, 'BAD_REQUEST', { field: 'email' });
        u.email = body.email || null;
        record(s, 'account.email', name, 'ok', { after: { email: u.email } });
      }
      if (body.enabled !== undefined) u.enabled = body.enabled;
      if (body.unlock === true) u.locked = null;
      u.updatedAt = now();
      store.usersRev++;
      const changed =
        body.role !== undefined || body.groups !== undefined || body.enabled !== undefined;
      if (changed) dropSessions(name);
      const action =
        body.unlock === true
          ? 'account.unlock'
          : body.enabled === false
            ? 'account.disable'
            : body.enabled === true
              ? 'account.enable'
              : body.role !== undefined
                ? 'account.role'
                : 'account.groups';
      record(s, action, name, 'ok', {
        before,
        after: { role: u.role, groups: u.groups, enabled: u.enabled },
      });
      return json(res, 200, {
        rev: store.usersRev,
        ...(changed && name === s.user ? { signedOut: true } : {}),
      });
    }

    // ---- nhóm ----
    if (path === '/api/v1/admin/groups' && m === 'GET') return json(res, 200, groupsBody());
    if (path === '/api/v1/admin/groups' && m === 'POST') {
      if (body.rev !== store.rev) return err(res, 409, 'CONFLICT');
      if (!GROUP_RE.test(body.id ?? '')) return err(res, 400, 'BAD_REQUEST', { field: 'id' });
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 64)
        return err(res, 400, 'BAD_REQUEST', { field: 'name' });
      if (store.groups.some((g) => g.id === body.id)) return err(res, 409, 'EXISTS');
      store.groups.push({ id: body.id, name: body.name.trim() });
      writeStore();
      record(s, 'group.create', body.id, 'ok', { before: null, after: { name: body.name } });
      return json(res, 201, { rev: store.rev });
    }
    mm = /^\/api\/v1\/admin\/groups\/([^/]+)(\/delete)?$/.exec(path);
    if (mm && m === 'POST') {
      const id = decodeURIComponent(mm[1]);
      const g = store.groups.find((x) => x.id === id);
      if (body.rev !== store.rev) return err(res, 409, 'CONFLICT');
      if (!g) return err(res, 404, 'NOT_FOUND');
      if (mm[2]) {
        if (!reauthOk(s, body)) return err(res, 403, 'REAUTH_REQUIRED');
        const members = [...users.values()].filter((u) => u.groups.includes(id)).map((u) => u.name);
        const rules = store.rules
          .filter((r) => r.grantees.includes(`group:${id}`))
          .map((r) => ({ resource: r.resource, level: r.level }));
        if (members.length || rules.length)
          return err(res, 409, 'IN_USE', { usedBy: { users: members, rules } });
        store.groups = store.groups.filter((x) => x.id !== id);
        writeStore();
        record(s, 'group.delete', id, 'ok', { before: { name: g.name }, after: null });
        return json(res, 200, { rev: store.rev });
      }
      if (typeof body.name !== 'string' || !body.name.trim())
        return err(res, 400, 'BAD_REQUEST', { field: 'name' });
      const before = g.name;
      g.name = body.name.trim();
      writeStore();
      record(s, 'group.rename', id, 'ok', { before, after: g.name });
      return json(res, 200, { rev: store.rev });
    }

    // ---- quy tắc ----
    if (path === '/api/v1/admin/access' && m === 'GET') return json(res, 200, accessBody());
    if (path === '/api/v1/admin/access' && m === 'POST') {
      if (body.rev !== store.rev) return err(res, 409, 'CONFLICT');
      if (store.invalid) return err(res, 503, 'STORE_INVALID');
      const ids = new Map(resourcesOf(cat()).map((r) => [r.id, r]));
      const set = Array.isArray(body.set) ? body.set : null;
      if (!set || set.length > 500) return err(res, 400, 'BAD_REQUEST');
      for (const x of set) {
        if (x.resource === 'page:admin')
          return err(res, 400, 'BAD_REQUEST', { resource: x.resource });
        const r = ids.get(x.resource);
        if (!r) return err(res, 400, 'NOT_FOUND', { resource: x.resource });
        if (!r.levels.includes(x.level))
          return err(res, 400, 'BAD_REQUEST', { resource: x.resource });
        if (x.grantees !== null) {
          if (!Array.isArray(x.grantees) || new Set(x.grantees).size !== x.grantees.length)
            return err(res, 400, 'BAD_REQUEST', { resource: x.resource });
          for (const g of x.grantees) {
            const ok =
              g === '*' ||
              (g.startsWith('role:') && ROLES.includes(g.slice(5))) ||
              (g.startsWith('group:') && store.groups.some((y) => y.id === g.slice(6))) ||
              (g.startsWith('user:') && users.has(g.slice(5)));
            if (!ok) return err(res, 400, 'NOT_FOUND', { resource: x.resource, grantee: g });
          }
        }
      }
      for (const x of set) {
        const i = store.rules.findIndex((r) => r.resource === x.resource && r.level === x.level);
        const before = i >= 0 ? store.rules[i].grantees : null;
        if (x.grantees === null) {
          if (i >= 0) store.rules.splice(i, 1);
        } else if (i >= 0) store.rules[i].grantees = [...x.grantees];
        else store.rules.push({ resource: x.resource, level: x.level, grantees: [...x.grantees] });
        record(s, 'access.rule', `${x.resource}#${x.level}`, 'ok', { before, after: x.grantees });
      }
      writeStore();
      return json(res, 200, { rev: store.rev });
    }
    if (path === '/api/v1/admin/access/cleanup' && m === 'POST') {
      if (body.rev !== store.rev) return err(res, 409, 'CONFLICT');
      const ids = resIds();
      const before = store.rules.length;
      store.rules = store.rules.filter((r) => ids.has(r.resource));
      writeStore();
      record(s, 'access.cleanup', 'access', 'ok');
      return json(res, 200, { rev: store.rev, removed: before - store.rules.length });
    }
    if (path === '/api/v1/admin/access/restore' && m === 'POST') {
      if (!reauthOk(s, body)) return err(res, 403, 'REAUTH_REQUIRED');
      store.invalid = false;
      writeStore();
      record(s, 'access.restore', 'access', 'ok');
      return json(res, 200, { rev: store.rev });
    }
    if (path === '/api/v1/admin/effective' && m === 'GET' && url.searchParams.has('users')) {
      // Lô (≤ 200): {"effective":{"tên": EffectiveAccess}}; tên lạ thì bỏ.
      const names = (url.searchParams.get('users') ?? '').split(',').filter(Boolean);
      if (names.length > 200) return err(res, 400, 'BAD_REQUEST');
      log.batches = (log.batches ?? 0) + 1;
      const out = {};
      for (const n of names) {
        const u = users.get(n);
        if (!u) continue;
        log.effective.push(n);
        out[n] = computeAccess(cat(), store, {
          user: u.name,
          role: u.role,
          groups: u.groups,
        }).effective;
      }
      return json(res, 200, { effective: out });
    }
    if (path === '/api/v1/admin/effective' && m === 'GET') {
      const name = url.searchParams.get('user') ?? '';
      const u = users.get(name);
      if (!u) return err(res, 404, 'NOT_FOUND');
      log.effective.push(name);
      record(s, 'admin.view-as', name, 'ok');
      return json(
        res,
        200,
        computeAccess(cat(), store, { user: u.name, role: u.role, groups: u.groups }).effective,
      );
    }
    // ---- thiết lập thiết bị (feature 027) ----
    if (path === '/api/v1/admin/device-settings' && m === 'GET')
      return json(res, 200, {
        rev: device.rev,
        settings: device.settings,
        base: devBase,
        effective: devEffective(),
        running: devEffective(),
        restartPending: false,
        cert: {
          ok: true,
          fingerprint: device.fingerprint,
          fingerprintColons: fpColons(device.fingerprint),
          subject: 'CN=mAT BL335-demo',
          issuer: 'CN=mAT BL335-demo',
          selfSigned: true,
          sanDns: ['bl335'],
          sanIps: device.sanIps,
          notBefore: '2026-10-01 00:00:00',
          notAfter: '2036-10-01 00:00:00',
          chainLength: 1,
          warnings: device.sanIps.length ? [] : ['TLS_NO_IP_SAN'],
          cardIps: ['192.0.2.10'],
        },
        update: { enabled: devEffective().updateEnabled, updaterInstalled: true },
      });
    if (path === '/api/v1/admin/device-settings' && m === 'POST') {
      if (body.rev !== device.rev) return err(res, 409, 'CONFLICT', { rev: device.rev });
      const next = { ...devBase, ...(body.settings ?? {}) };
      const before = devEffective();
      const lowered =
        (before.viewerLogin === 'required' && next.viewerLogin !== 'required') ||
        (!before.updateEnabled && next.updateEnabled);
      if (lowered && !reauthOk(s, body)) return err(res, 403, 'REAUTH_REQUIRED');
      device.settings = body.settings ?? {};
      device.rev++;
      device.restarts++;
      record(s, 'device.settings', 'settings.json', 'ok', { before, after: next });
      return json(res, 200, { rev: device.rev, effective: next, restart: true, restartInMs: 1000 });
    }
    if (path === '/api/v1/admin/cert/regen' && m === 'POST') {
      if (!reauthOk(s, body)) return err(res, 403, 'REAUTH_REQUIRED');
      device.fingerprint = 'cd'.repeat(32);
      device.sanIps = ['192.0.2.10', ...(body.san ?? []).filter((x) => /^[\d.]+$/.test(x))];
      record(s, 'cert.regenerate', device.fingerprint, 'ok');
      return json(res, 200, {
        fingerprint: device.fingerprint,
        fingerprintColons: fpColons(device.fingerprint),
        sanIps: device.sanIps,
        sanDns: ['bl335'],
        restart: true,
        restartInMs: 1000,
      });
    }
    if (path === '/api/v1/admin/cert/csr' && m === 'POST') {
      device.csr++;
      return json(res, 200, {
        csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----\n',
      });
    }
    if (path === '/api/v1/admin/cert/import' && m === 'POST') {
      if (!reauthOk(s, body)) return err(res, 403, 'REAUTH_REQUIRED');
      device.imports++;
      if (!String(body.pem).includes('BEGIN CERTIFICATE'))
        return err(res, 400, 'CERT_FILE_INVALID', { message: 'tệp không có khối CERTIFICATE' });
      return err(res, 400, 'CERT_KEY_MISMATCH', {
        message: 'chứng chỉ không khớp khóa riêng nào của thiết bị',
      });
    }
    // ---- email alarm (feature 023) ----
    if (path === '/api/v1/admin/email' && m === 'GET')
      return json(res, 200, {
        rev: email.rev,
        config: email.config,
        passwordSet: email.passwordSet,
        status: email.status,
        groups: store.groups.map((g) => {
          const mem = [...users.values()].filter((u) => u.enabled && u.groups.includes(g.id));
          return {
            id: g.id,
            name: g.name,
            members: mem.length,
            withEmail: mem.filter((u) => u.email).length,
          };
        }),
      });
    if (path === '/api/v1/admin/email' && m === 'POST') {
      if (body.rev !== email.rev) return err(res, 409, 'CONFLICT', { rev: email.rev });
      const c = body.config;
      if (!c || typeof c !== 'object' || 'password' in (c.smtp ?? {}))
        return err(res, 400, 'BAD_REQUEST');
      if (c.enabled && (!c.smtp?.host || !c.smtp?.from)) return err(res, 400, 'BAD_REQUEST');
      email.config = c;
      email.rev++;
      email.status.enabled = c.enabled === true;
      record(s, 'email.config', 'email.json', 'ok');
      return json(res, 200, { rev: email.rev });
    }
    if (path === '/api/v1/admin/email/test' && m === 'POST') {
      const ok = typeof body.to === 'string' && body.to.endsWith('@example.com');
      email.tests.push(body.to);
      record(s, 'email.test', body.to, ok ? 'ok' : 'failed');
      if (ok) email.status.lastOkAt = now();
      return json(res, 200, {
        ok,
        stage: ok ? 'done' : 'rcpt',
        error: ok ? '' : 'REJECTED',
        code: ok ? 250 : 550,
        message: ok ? 'Đã gửi.' : 'Mọi người nhận bị từ chối',
      });
    }
    // ---- API key (feature 025) ----
    if (path === '/api/v1/admin/apikeys' && m === 'GET')
      return json(res, 200, {
        rev: apikeys.rev,
        storeOk: true,
        keys: apikeys.keys,
        groups: store.groups.map((g) => ({ id: g.id, name: g.name })),
        limits: { maxKeys: 32, maxAllowFrom: 16, rateMin: 10, rateMax: 6000, rateDefault: 600 },
      });
    if (path.startsWith('/api/v1/admin/apikeys') && m === 'POST') {
      if (body.rev !== apikeys.rev) return err(res, 409, 'CONFLICT', { rev: apikeys.rev });
      const keyOf = (id) => apikeys.keys.find((k) => k.id === id);
      const settings = (k, b) => {
        for (const f of [
          'name',
          'role',
          'readOnly',
          'groups',
          'allowFrom',
          'expiresAt',
          'ratePerMin',
        ])
          if (b[f] !== undefined) k[f] = b[f];
        if (k.role === 'viewer') k.readOnly = true;
        k.canWrite = k.role === 'operator' && !k.readOnly;
      };
      const tail = path.slice('/api/v1/admin/apikeys'.length);
      if (tail === '') {
        if (typeof body.name !== 'string' || !body.name.trim()) return err(res, 400, 'BAD_REQUEST');
        const k = {
          id: (++apikeys.seq).toString(16).padStart(12, '0'),
          role: 'viewer',
          readOnly: true,
          groups: [],
          allowFrom: [],
          expiresAt: null,
          ratePerMin: 600,
          expired: false,
          createdAt: new Date(now()).toISOString(),
          createdBy: s.user,
          updatedAt: null,
          lastUsedAt: null,
          lastFrom: null,
          calls: 0,
          denied: 0,
        };
        settings(k, body);
        if (k.canWrite && !reauthOk(s, body)) return err(res, 403, 'REAUTH_REQUIRED');
        const token = `matk_${'T'.repeat(36)}${String(apikeys.seq).padStart(7, '0')}`;
        k.prefix = token.slice(0, 12);
        apikeys.keys.push(k);
        apikeys.tokens.push(token);
        apikeys.rev++;
        record(s, 'apikey.create', k.id, 'ok');
        return json(res, 201, { rev: apikeys.rev, key: { id: k.id, name: k.name }, token });
      }
      const [, id, verb] = tail.split('/');
      const k = keyOf(id);
      if (!k) return err(res, 404, 'NOT_FOUND');
      if (verb === 'revoke') {
        apikeys.keys = apikeys.keys.filter((x) => x !== k);
        apikeys.rev++;
        record(s, 'apikey.revoke', id, 'ok');
        return json(res, 200, { rev: apikeys.rev });
      }
      const before = k.canWrite;
      const next = { ...k };
      settings(next, body);
      if (next.canWrite && !before && !reauthOk(s, body)) return err(res, 403, 'REAUTH_REQUIRED');
      Object.assign(k, next, { updatedAt: new Date(now()).toISOString() });
      apikeys.rev++;
      record(s, 'apikey.update', id, 'ok');
      return json(res, 200, { rev: apikeys.rev, key: { id } });
    }
    if (path === '/api/v1/admin/audit' && m === 'GET') {
      const p = url.searchParams;
      const limit = Math.min(200, Math.max(1, Number(p.get('limit') ?? 100)));
      const before = p.has('beforeId') ? Number(p.get('beforeId')) : Infinity;
      const rows = audit.filter(
        (r) =>
          r.id < before &&
          (!p.get('user') || r.user === p.get('user')) &&
          (!p.get('action') || r.action.startsWith(p.get('action'))) &&
          (!p.get('from') || r.ts >= Number(p.get('from'))) &&
          (!p.get('to') || r.ts < Number(p.get('to'))),
      );
      const records = rows.slice(0, limit);
      const out = { records, next: rows.length > limit ? records.at(-1).id : null };
      record(s, 'audit.read', '/api/v1/admin/audit', 'ok', Object.fromEntries(p));
      return json(res, 200, out);
    }
    return err(res, 404, 'NOT_FOUND');
  }

  async function readJson(req) {
    try {
      const t = await deps.readBody(req);
      const v = JSON.parse(t || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }

  return {
    authenticate,
    canWrite,
    screenFilter,
    effectiveOf,
    handle,
    users,
    store,
    audit,
    log,
    email,
    apikeys,
    device,
    cfg,
    /** Admin khác vừa sửa: tăng rev (lần lưu kế tiếp của trang nhận 409). */
    bumpRev(kind = 'access') {
      if (kind === 'users') store.usersRev++;
      else store.rev++;
    },
    /** Đặt quy tắc từ kịch bản rồi phát `access-changed`. */
    setRules(rules) {
      store.rules = rules.map((r) => ({ ...r, grantees: [...r.grantees] }));
      writeStore();
    },
    breakStore(v = true) {
      store.invalid = v;
      deps.broadcast('access-changed');
    },
  };
}
