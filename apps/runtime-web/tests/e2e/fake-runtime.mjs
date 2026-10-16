// Runtime giả cho e2e của trang vận hành (feature 007, T040, T074): phục vụ bản build `dist-e2e` cùng
//  - GET /api/v1/projects/active (0.3 tóm tắt, hoặc 0.1 đầy đủ), GET /project/<file>, system/info, device/identity;
//  - phiên web theo contracts/web-session.md: web/login, session, touch, logout (cookie `__Host-mat_sid`, CSRF, Origin);
//  - POST tags/write và GET tags/write/<id> theo device-api-1.2.md §6 (kết quả theo Tag: xem BEHAVIOR);
//  - WebSocket /api/v1/live (hello, snapshot, delta, heartbeat; Tag lạ trong `unknown`).
// Có hai cổng: HTTP và HTTPS (chứng chỉ tự ký sinh bằng openssl; Chrome chạy với --ignore-certificate-errors).
// Mô phỏng thiết bị chỉ đủ cho trang: không kiểm kỹ như runtime thật (kiểm thật ở tests/web-it).
import { execFileSync } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttp } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { animDemo } from './anim-fixture.mjs';
import { TAGS, alarmBoard, dashboard, legacyTank } from './fixture-project.mjs';
import { historyProject, makeHistory } from './history-fake.mjs';
import { history10Project, reportsProject } from './history-projects.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};
const COOKIE = '__Host-mat_sid';
const ROLES = {
  vanhanh1: ['op-pass', 'operator'],
  xem1: ['view-pass', 'viewer'],
  kysu1: ['eng-pass', 'engineer'],
};

/** Kết quả ghi theo Tag (mặc định: CONFIRMED sau writeDelayMs). */
const BEHAVIOR = {
  'VALVE1.CMD': {
    reject: { reason: 'CONNECTION_BAD', message: 'Kết nối tới PLC trạm bơm đang mất' },
  },
  'TANK02.SP': {
    final: {
      status: 'FAILED',
      code: 'DEVICE_EXCEPTION',
      message: 'PLC báo lỗi 02: địa chỉ không hợp lệ',
    },
  },
  'TANK03.SP': {
    final: {
      status: 'TIMEOUT',
      code: 'WRITE_TIMEOUT',
      message: 'Thiết bị trường không trả lời: không chắc đã ghi',
    },
  },
};

function openssl() {
  const cands = [
    'openssl',
    'C:/Program Files/Git/usr/bin/openssl.exe',
    'C:/Program Files/Git/mingw64/bin/openssl.exe',
  ];
  for (const c of cands) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' });
      return c;
    } catch {
      /* thử tiếp */
    }
  }
  return null;
}

/** Cặp khóa + chứng chỉ tự ký cho 127.0.0.1 (null nếu không có openssl). */
function selfSigned() {
  const bin = openssl();
  if (!bin) return null;
  const dir = mkdtempSync(join(tmpdir(), 'mat-e2e-tls-'));
  const key = join(dir, 'key.pem');
  const crt = join(dir, 'crt.pem');
  try {
    execFileSync(
      bin,
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:prime256v1',
        '-nodes',
        '-keyout',
        key,
        '-out',
        crt,
        '-subj',
        '/CN=127.0.0.1',
        '-days',
        '2',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    return { key: readFileSync(key), cert: readFileSync(crt) };
  } catch {
    return null;
  }
}

const eq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Bật runtime giả. `opts.staticDir`: thư mục bản build (dist-e2e); `opts.project`: 'dashboard' (0.3) hoặc 'tank' (0.1).
 * Trả bộ điều khiển (xem cuối hàm).
 */
export async function startFakeRuntime(opts = {}) {
  const staticDir = resolve(opts.staticDir ?? 'dist-e2e');
  const projectOf = (kind) =>
    kind === 'tank'
      ? legacyTank()
      : kind === 'alarm-board'
        ? alarmBoard()
        : kind === 'anim'
          ? animDemo()
          : kind === 'history'
            ? historyProject()
            : kind === 'reports'
              ? reportsProject()
              : kind === 'history10'
                ? history10Project()
                : dashboard();
  // `opts.fixture`: hàm trả { active, files } riêng (vd. tools/measure/anim-bench.mjs, 100 hoạt ảnh).
  let proj = opts.fixture?.() ?? projectOf(opts.project);
  // Lịch sử (feature 010): API /api/v1/history/* giả, chỉ khi kịch bản bật.
  const hist = opts.history ? makeHistory(opts.history) : null;
  const cfg = {
    noProject: false,
    viewerLogin: 'off',
    httpsDown: false,
    writeDelayMs: opts.writeDelayMs ?? 250,
    brokenFiles: new Set(),
    loginDelayMs: 0,
    // Feature 009: `alarms` bật features.alarms ở hello; `protocol` là protocolVersion của hello (mặc định 1.3.0, không có alarm).
    alarms: false,
    protocol: '1.3.0',
    ...opts.config,
  };
  const startedAt = Date.now();
  const values = new Map([
    ['TANK01.LEVEL', 62.5],
    ['TANK01.INFLOW', 9.5],
    ['TANK01.TEMP', 25],
    ['MOTOR01.RUN', true],
    ['MOTOR01.SPEED', 1200],
    ['PUMP1.RUN_CMD', false],
    ['PUMP1.START_CMD', false],
    ['PUMP1.AUTO', false],
    ['TANK01.SP', 70],
    ['PUMP1.SPEED_SP', 900],
    ['PUMP1.MODE', 2],
    ['VALVE1.CMD', false],
    ['TANK02.SP', 10],
    ['TANK03.SP', 20],
  ]);
  const quality = new Map([['TANK01.TEMP', { q: 'BAD', reason: 'TIMEOUT' }]]);
  const tagInfo = new Map(TAGS.map((t) => [t.id, t]));
  const sessions = new Map(); // token → {user, role, csrf, ip, created, last}
  const writes = new Map(); // requestId → {tag, value, ...result}
  const fails = new Map(); // tên → số lần sai
  const lockedUntil = new Map();
  const log = {
    subscribes: [],
    writes: [],
    logins: [],
    touches: 0,
    requests: [],
    wsOpened: 0,
    wsCookie: 0,
  };
  const sockets = new Set();
  let tick = 0;

  // ---- alarm giả (feature 009): live 1.3.0 (subscribeAlarms, alarmSnapshot, alarmDelta), REST ack/shelve/unshelve, lịch sử ----
  const ALARM_CLASSES = [
    {
      id: 'critical',
      name: 'Khẩn cấp',
      priority: 'critical',
      color: 'red',
      blink: true,
      requiresAck: true,
      ackReturn: false,
      sound: 'siren',
      chatterLimit: 5,
    },
    {
      id: 'major',
      name: 'Quan trọng',
      priority: 'major',
      color: 'orange',
      blink: true,
      requiresAck: true,
      ackReturn: false,
      sound: 'double',
      chatterLimit: 5,
    },
    {
      id: 'minor',
      name: 'Nhỏ',
      priority: 'minor',
      color: 'amber',
      blink: false,
      requiresAck: true,
      ackReturn: false,
      sound: 'beep',
      chatterLimit: 5,
    },
    {
      id: 'advisory',
      name: 'Lưu ý',
      priority: 'advisory',
      color: 'blue',
      blink: false,
      requiresAck: false,
      ackReturn: false,
      sound: 'none',
      chatterLimit: 5,
    },
  ];
  const ALARM_AREAS = [
    { id: 'bon', name: 'Bồn' },
    { id: 'dien', name: 'Điện' },
  ];
  const alarm = {
    inst: new Map(),
    rev: 100,
    history: [],
    acks: [],
    shelveCalls: [],
    historyCalls: [],
    auditDown: false,
    holdSnapshot: false,
  };
  const PRIO = ['critical', 'major', 'minor', 'advisory'];
  /** Gấp dấu tiếng Việt như máy chủ thật (không phân biệt hoa thường và dấu). */
  const fold = (x) =>
    String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  function alarmCounts() {
    const by = Object.fromEntries(PRIO.map((p) => [p, { active: 0, unack: 0 }]));
    const c = { active: 0, unack: 0, rtnUnack: 0, shelved: 0, disabled: 0, byPriority: by };
    for (const i of alarm.inst.values()) {
      if (i.disabled) c.disabled++;
      if (i.shelved) {
        c.shelved++;
        continue;
      }
      if (i.state === 'NORMAL') continue;
      c.active++;
      by[i.priority].active++;
      if (i.state === 'ACTIVE_UNACK') {
        c.unack++;
        by[i.priority].unack++;
      } else if (i.state === 'RTN_UNACK') c.rtnUnack++;
    }
    return c;
  }
  const alarmFull = () => ({
    classes: ALARM_CLASSES,
    areas: ALARM_AREAS,
    counts: alarmCounts(),
  });
  function alarmSend(c, o) {
    if (c.ws.readyState !== 1) return;
    c.aseq = (c.aseq ?? 0) + 1;
    c.ws.send(JSON.stringify({ ...o, subscriptionId: c.asub, sequence: c.aseq, ts: Date.now() }));
  }
  function alarmSnapshot(c) {
    const list = [...alarm.inst.values()];
    const base = { type: 'alarmSnapshot', revision: alarm.rev, ...alarmFull() };
    if (list.length <= 100) {
      alarmSend(c, { ...base, instances: list });
      return;
    }
    // chia mảnh ≤ 100 instance, cùng sequence (§3.4)
    c.aseq = (c.aseq ?? 0) + 1;
    const parts = Math.ceil(list.length / 100);
    for (let p = 0; p < parts; p++)
      c.ws.send(
        JSON.stringify({
          ...base,
          subscriptionId: c.asub,
          sequence: c.aseq,
          ts: Date.now(),
          part: p + 1,
          parts,
          instances: list.slice(p * 100, p * 100 + 100),
        }),
      );
  }
  function alarmBroadcast(changed, removed = []) {
    alarm.rev++;
    for (const c of sockets) {
      if (!c.asub) continue;
      const items = changed.map((id) => alarm.inst.get(id)).filter(Boolean);
      for (const i of items) i.rev = alarm.rev;
      alarmSend(c, {
        type: 'alarmDelta',
        revision: alarm.rev,
        changed: items,
        removed,
        counts: alarmCounts(),
      });
    }
  }
  const alarmCtl = {
    /** Đặt hoặc cập nhật một instance và phát alarmDelta. */
    set(id, patch = {}) {
      const cls =
        ALARM_CLASSES.find((x) => x.id === (patch.class ?? alarm.inst.get(id)?.class ?? 'major')) ??
        ALARM_CLASSES[1];
      const prev = alarm.inst.get(id);
      const i = {
        id,
        alarmId: id.split('.')[0],
        name: prev?.name ?? `Alarm ${id}`,
        type: 'digital',
        occurrence: (prev?.occurrence ?? 0) + (prev ? 0 : 1),
        rev: alarm.rev,
        state: 'ACTIVE_UNACK',
        class: cls.id,
        priority: cls.priority,
        area: null,
        text: `Nội dung ${id}`,
        valueActive: true,
        qualityActive: 'GOOD',
        tsActive: Date.now(),
        clockOk: true,
        disabled: false,
        inputBad: false,
        startup: false,
        ...prev,
        ...patch,
      };
      i.priority = ALARM_CLASSES.find((x) => x.id === i.class)?.priority ?? i.priority;
      alarm.inst.set(id, i);
      alarmBroadcast([id]);
      return i;
    },
    remove(id) {
      if (alarm.inst.delete(id)) alarmBroadcast([], [id]);
    },
    /** Thay toàn bộ tập instance (không phát delta; dùng trước khi mở trang hoặc sau dropLive). */
    reset(list = []) {
      alarm.inst.clear();
      for (const [id, patch] of list) {
        const cls =
          ALARM_CLASSES.find((x) => x.id === (patch.class ?? 'major')) ?? ALARM_CLASSES[1];
        alarm.inst.set(id, {
          id,
          alarmId: id.split('.')[0],
          name: `Alarm ${id}`,
          type: 'digital',
          occurrence: 1,
          rev: ++alarm.rev,
          state: 'ACTIVE_UNACK',
          class: cls.id,
          priority: cls.priority,
          area: null,
          text: `Nội dung ${id}`,
          valueActive: true,
          qualityActive: 'GOOD',
          tsActive: Date.now(),
          clockOk: true,
          disabled: false,
          inputBad: false,
          startup: false,
          ...patch,
        });
      }
    },
    get(id) {
      return alarm.inst.get(id);
    },
    count: () => alarm.inst.size,
    /** Lịch sử giả: mảng HistoryItem, mới nhất trước (id giảm dần). */
    setHistory(rows) {
      alarm.history = rows;
    },
    get acks() {
      return alarm.acks;
    },
    get historyCalls() {
      return alarm.historyCalls;
    },
    get shelveCalls() {
      return alarm.shelveCalls;
    },
    set auditDown(v) {
      alarm.auditDown = v;
    },
    revision: () => alarm.rev,
  };

  function alarmMatch(i, f) {
    if (f.areas?.length && !f.areas.includes(i.area ?? '-')) return false;
    if (f.classes?.length && !f.classes.includes(i.class)) return false;
    if (f.priorities?.length && !f.priorities.includes(i.priority)) return false;
    const states = f.states?.length ? f.states : ['ACTIVE_UNACK', 'RTN_UNACK'];
    if (!states.includes(i.state)) return false;
    if (f.q && !`${i.text} ${i.name}`.toLowerCase().includes(String(f.q).toLowerCase()))
      return false;
    return true;
  }

  async function alarmApi(req, res, s, path) {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (s.role === 'viewer') return err(res, 403, 'FORBIDDEN');
    if (alarm.auditDown)
      return err(res, 503, 'AUDIT_UNAVAILABLE', {
        message: 'Thiết bị không ghi được nhật ký kiểm toán nên chưa xác nhận',
      });
    if (path === '/api/v1/alarms/ack') {
      alarm.acks.push(body);
      const results = [];
      const changed = [];
      const removed = [];
      let skippedNewer = 0;
      const one = (i, occ) => {
        if (!i) return 'NOT_FOUND';
        if (i.shelved) return 'SHELVED';
        if (occ !== i.occurrence) return 'STALE';
        if (i.state === 'ACTIVE_UNACK') {
          Object.assign(i, { state: 'ACTIVE_ACK', tsAck: Date.now(), ackUser: s.user });
          changed.push(i.id);
          return 'ACKED';
        }
        if (i.state === 'RTN_UNACK') {
          removed.push(i.id);
          return 'ACKED';
        }
        return i.state === 'ACTIVE_ACK' ? 'ALREADY_ACKED' : 'NOT_ACTIVE';
      };
      if (body.all) {
        for (const i of [...alarm.inst.values()]) {
          if (!alarmMatch(i, body.filter ?? {}) || i.shelved) continue;
          if (i.rev > body.upToRevision) skippedNewer++;
          else results.push({ id: i.id, occurrence: i.occurrence, result: one(i, i.occurrence) });
        }
      } else
        for (const it of body.items ?? [])
          results.push({
            id: it.id,
            occurrence: it.occurrence,
            result: one(alarm.inst.get(it.id), it.occurrence),
          });
      for (const id of removed) alarm.inst.delete(id);
      if (changed.length || removed.length) alarmBroadcast(changed, removed);
      return json(res, 200, {
        mode: body.all ? 'all' : 'items',
        results,
        acked: results.filter((r) => r.result === 'ACKED').length,
        skippedNewer,
        revision: alarm.rev,
        counts: alarmCounts(),
      });
    }
    if (path === '/api/v1/alarms/shelve') {
      alarm.shelveCalls.push(body);
      const i = alarm.inst.get(body.id);
      if (!i) return err(res, 404, 'ALARM_NOT_FOUND');
      if (typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 120)
        return err(res, 422, 'SHELVE_RANGE', { field: 'reason', message: 'Lý do 1 đến 120 ký tự' });
      i.shelved = {
        until: Date.now() + body.durationS * 1000,
        remainingMs: body.durationS * 1000,
        reason: body.reason,
        user: s.user,
        system: false,
      };
      alarmBroadcast([i.id]);
      return json(res, 200, {
        id: i.id,
        shelved: i.shelved,
        state: i.state,
        changed: true,
        revision: alarm.rev,
        counts: alarmCounts(),
      });
    }
    if (path === '/api/v1/alarms/unshelve') {
      const i = alarm.inst.get(body.id);
      if (!i) return err(res, 404, 'ALARM_NOT_FOUND');
      if (!i.shelved)
        return json(res, 200, { id: i.id, shelved: null, state: i.state, changed: false });
      delete i.shelved;
      if (i.state === 'NORMAL') {
        alarm.inst.delete(i.id);
        alarmBroadcast([], [i.id]);
      } else alarmBroadcast([i.id]);
      return json(res, 200, {
        id: body.id,
        shelved: null,
        changed: true,
        revision: alarm.rev,
        counts: alarmCounts(),
      });
    }
    return err(res, 404, 'NOT_FOUND');
  }

  function alarmHistory(res, url) {
    const p = url.searchParams;
    alarm.historyCalls.push(url.search);
    if (alarm.historyBroken) return err(res, 503, 'ALARM_LOG_UNAVAILABLE');
    const from = Number(p.get('from') ?? 0);
    const to = Number(p.get('to') ?? Date.now());
    const limit = Math.min(500, Math.max(1, Number(p.get('limit') ?? 100)));
    const before = p.has('beforeId') ? Number(p.get('beforeId')) : Infinity;
    const q = (p.get('q') ?? '').toLowerCase();
    const min = p.get('priority') ? PRIO.indexOf(p.get('priority')) : 3;
    const rows = alarm.history.filter(
      (r) =>
        r.tsActive >= from &&
        r.tsActive < to &&
        r.id < before &&
        PRIO.indexOf(r.priority) <= min &&
        (!p.get('area') || (p.get('area') === '-' ? !r.area : r.area === p.get('area'))) &&
        (!p.get('state') ||
          p.get('state') === 'all' ||
          (p.get('state') === 'active'
            ? r.tsReturn == null
            : p.get('state') === 'acked'
              ? r.tsAck != null
              : r.tsReturn != null || r.closedBy)) &&
        (!p.get('alarmId') || r.alarmId.startsWith(p.get('alarmId'))) &&
        (!q || fold(`${r.text} ${r.name}`).includes(fold(q))),
    );
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return json(res, 200, {
      items,
      limit,
      hasMore,
      nextBeforeId: hasMore ? items.at(-1).id : null,
      ts: Date.now(),
    });
  }

  const http = createHttp((req, res) => handle(req, res, false));
  const tls = opts.https === false ? null : selfSigned();
  const https = tls ? createHttps(tls, (req, res) => handle(req, res, true)) : null;
  const wss = new WebSocketServer({ noServer: true });
  for (const [srv, secure] of [
    [http, false],
    [https, true],
  ]) {
    srv?.on('upgrade', (req, socket, head) => {
      const path = new URL(req.url, 'http://x').pathname;
      if (path !== '/api/v1/live') return socket.destroy();
      const sess = secure ? sessionOf(req) : null;
      if (cfg.viewerLogin === 'required' && !sess) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return socket.destroy();
      }
      wss.handleUpgrade(req, socket, head, (ws) => live(ws, sess));
    });
  }

  function json(res, status, body, headers = {}) {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers,
    });
    res.end(body === undefined ? '' : JSON.stringify(body));
  }
  const err = (res, status, error, extra = {}) => json(res, status, { error, ...extra });

  function cookiesOf(req) {
    const out = {};
    for (const p of String(req.headers.cookie ?? '').split(';')) {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    }
    return out;
  }
  function sessionOf(req) {
    const t = cookiesOf(req)[COOKIE];
    return t ? (sessions.get(t) ?? null) : null;
  }
  function readBody(req) {
    return new Promise((ok) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    });
  }

  async function handle(req, res, secure) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    log.requests.push(`${req.method} ${path}${secure ? ' (https)' : ''}`);
    try {
      if (path.startsWith('/api/v1/')) return await api(req, res, secure, path, url);
      if (path.startsWith('/project/'))
        return project(req, res, secure, decodeURIComponent(path.slice(9)));
      return stat(req, res, secure, path);
    } catch (e) {
      err(res, 500, 'FAKE_RUNTIME_ERROR', { message: String(e?.stack ?? e) });
    }
  }

  function stat(req, res, secure, path) {
    const sess = secure ? sessionOf(req) : null;
    if (path === '/' && cfg.viewerLogin === 'required' && !sess) {
      if (secure) {
        res.writeHead(302, { location: '/login' });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><p>Mở bằng HTTPS</p>');
    }
    const rel = path === '/' ? 'index.html' : path === '/login' ? 'login.html' : path.slice(1);
    const file = normalize(join(staticDir, rel));
    if (!file.startsWith(staticDir) || !existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(readFileSync(file));
  }

  function project(req, res, secure, rel) {
    if (cfg.viewerLogin === 'required' && !(secure && sessionOf(req)))
      return err(res, 401, 'AUTH_REQUIRED');
    if (cfg.brokenFiles.has(rel)) return err(res, 500, 'INTERNAL');
    const f = proj.files.get(rel);
    if (!f) return err(res, 404, 'NOT_FOUND');
    if (f.json) return json(res, 200, f.json);
    res.writeHead(200, {
      'content-type': f.type ?? 'application/json',
      'cache-control': 'no-cache',
    });
    res.end(f.text);
  }

  async function api(req, res, secure, path, url) {
    const m = req.method;
    if (path === '/api/v1/projects/active' && m === 'GET') {
      if (cfg.viewerLogin === 'required' && !(secure && sessionOf(req)))
        return err(res, 401, 'AUTH_REQUIRED');
      if (cfg.noProject)
        return err(res, 503, 'NO_VALID_PROJECT', {
          errors: [{ code: 'E_SCHEMA', file: 'project.json', path: '/x', message: 'lỗi thử' }],
        });
      return json(res, 200, proj.active);
    }
    if (path === '/api/v1/system/info' && m === 'GET') {
      return json(res, 200, {
        runtimeVersion: '0.6.0',
        protocolVersion: '1.2.0',
        schemaVersions: ['0.1', '0.2', '0.3'],
        web: {
          https: Boolean(https) && !cfg.httpsDown,
          httpsPort: https?.address()?.port ?? null,
          login: true,
          viewerLogin: cfg.viewerLogin,
        },
        warnings: cfg.httpsDown ? ['HTTPS_DOWN'] : [],
      });
    }
    if (path === '/api/v1/device/identity' && m === 'GET') {
      return json(res, 200, {
        deviceId: 'fake',
        name: 'BL335-fake',
        fingerprint: '3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b',
        httpsPort: https?.address()?.port ?? null,
        features: ['web-login'],
      });
    }
    if (path === '/api/v1/web/login' && m === 'POST') return login(req, res, secure);
    // Runtime không bật lưu trữ: danh mục trả enabled=false (200) để trang không ghi lỗi 404 vào console.
    if (path === '/api/v1/history/catalog' && !hist && m === 'GET')
      return json(res, 200, { apiVersion: '1.4.0', enabled: false, state: 'disabled', groups: [] });
    if (path.startsWith('/api/v1/history/') && hist) {
      if (m !== 'GET') return err(res, 405, 'METHOD_NOT_ALLOWED');
      if (!secure) return err(res, 403, 'HTTPS_REQUIRED');
      const hs = sessionOf(req);
      if (!hs) return err(res, 401, cookiesOf(req)[COOKIE] ? 'SESSION_EXPIRED' : 'AUTH_REQUIRED');
      return hist.handle(req, res, path, url);
    }
    if (path === '/api/v1/alarms/history' && m === 'GET') return alarmHistory(res, url);
    if (path === '/api/v1/alarms' && m === 'GET')
      return json(res, 200, {
        ts: Date.now(),
        revision: alarm.rev,
        instances: [...alarm.inst.values()],
        ...alarmFull(),
      });
    if (
      path.startsWith('/api/v1/alarms/') ||
      path.startsWith('/api/v1/web/') ||
      path.startsWith('/api/v1/tags/write')
    )
      return cookieApi(req, res, secure, path, url);
    return err(res, 404, 'NOT_FOUND');
  }

  /** Kiểm Origin cho yêu cầu đổi trạng thái (§1.3 bước 6). */
  function originOk(req) {
    return (
      String(req.headers.origin ?? '').toLowerCase() ===
      `https://${String(req.headers.host).toLowerCase()}`
    );
  }

  async function login(req, res, secure) {
    if (!secure) return err(res, 403, 'HTTPS_REQUIRED');
    if (!originOk(req)) return err(res, 403, 'ORIGIN_MISMATCH');
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json'))
      return err(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return err(res, 400, 'BAD_REQUEST');
    }
    if (typeof body?.username !== 'string' || typeof body?.password !== 'string')
      return err(res, 400, 'BAD_REQUEST');
    if (cfg.loginDelayMs) await new Promise((r) => setTimeout(r, cfg.loginDelayMs));
    const name = body.username;
    log.logins.push(name);
    const until = lockedUntil.get(name) ?? 0;
    if (until > Date.now())
      return err(res, 429, 'AUTH_LOCKED', { retryAfterS: Math.ceil((until - Date.now()) / 1000) });
    const acct = ROLES[name];
    if (!acct || !eq(acct[0], body.password)) {
      const n = (fails.get(name) ?? 0) + 1;
      fails.set(name, n);
      if (n >= 5) {
        lockedUntil.set(name, Date.now() + 300_000);
        return err(res, 429, 'AUTH_LOCKED', { retryAfterS: 300 });
      }
      return err(res, 401, 'AUTH_FAILED');
    }
    fails.delete(name);
    const token = `matw_${randomBytes(32).toString('base64url')}`;
    const csrf = randomBytes(32).toString('base64url');
    const ip = req.socket.remoteAddress;
    sessions.set(token, { user: name, role: acct[1], csrf, ip, last: Date.now() });
    json(res, 200, sessionBody(sessions.get(token)), {
      'set-cookie': `${COOKIE}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/`,
    });
  }

  const sessionBody = (s) => ({
    user: s.user,
    role: s.role,
    csrfToken: s.csrf,
    expiresAt: new Date(Date.now() + 43200_000).toISOString(),
    idleExpiresAt: new Date(Date.now() + 1800_000).toISOString(),
    idleTimeoutS: 1800,
    maxSessionS: 43200,
  });

  async function cookieApi(req, res, secure, path, url) {
    const m = req.method;
    if (!secure) return err(res, 403, 'HTTPS_REQUIRED');
    const hasCookie = Boolean(cookiesOf(req)[COOKIE]);
    const s = sessionOf(req);
    if (path === '/api/v1/web/logout' && m === 'POST') {
      if (!originOk(req)) return err(res, 403, 'ORIGIN_MISMATCH');
      if (s && !eq(req.headers['x-mat-csrf'] ?? '', s.csrf)) return err(res, 403, 'CSRF_FAILED');
      for (const [t, v] of sessions) if (v === s) sessions.delete(t);
      return json(res, 204, undefined, {
        'set-cookie': `${COOKIE}=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
      });
    }
    if (!s) return err(res, 401, hasCookie ? 'SESSION_EXPIRED' : 'AUTH_REQUIRED');
    if (m !== 'GET') {
      if (!originOk(req)) return err(res, 403, 'ORIGIN_MISMATCH');
      if (!eq(req.headers['x-mat-csrf'] ?? '', s.csrf)) return err(res, 403, 'CSRF_FAILED');
    }
    s.last = Date.now();
    if (path === '/api/v1/web/session' && m === 'GET') {
      return json(res, 200, sessionBody(s));
    }
    if (path === '/api/v1/web/touch' && m === 'POST') {
      log.touches++;
      return json(res, 204, undefined);
    }
    if (path.startsWith('/api/v1/alarms/') && m === 'POST') return alarmApi(req, res, s, path);
    if (path === '/api/v1/tags/write' && m === 'POST') return write(req, res, s);
    if (path.startsWith('/api/v1/tags/write/') && m === 'GET') {
      const id = decodeURIComponent(path.slice('/api/v1/tags/write/'.length));
      const w = writes.get(id);
      if (!w) return err(res, 404, 'NO_SUCH_REQUEST');
      const { tag, value, ...r } = w;
      void tag;
      void value;
      return json(res, 200, { results: [{ requestId: id, ...r }] });
    }
    void url;
    return err(res, 404, 'NOT_FOUND');
  }

  async function write(req, res, s) {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json'))
      return err(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return err(res, 400, 'BAD_REQUEST');
    }
    const r = body?.requests?.[0];
    if (!r || !/^[0-9a-f-]{36}$/.test(r.requestId ?? '')) return err(res, 400, 'BAD_REQUEST');
    log.writes.push({ ...r, user: s.user, role: s.role });
    const reject = (reason, message, extra = {}) =>
      json(res, 200, {
        results: [
          {
            requestId: r.requestId,
            status: 'REJECTED',
            reason,
            ...(message ? { message } : {}),
            ...extra,
          },
        ],
      });
    if (s.role === 'viewer')
      return json(res, 403, {
        error: 'FORBIDDEN',
        results: [{ requestId: r.requestId, status: 'REJECTED', reason: 'FORBIDDEN' }],
      });
    const info = tagInfo.get(r.tag);
    if (!info || !values.has(r.tag)) return reject('NO_SUCH_TAG');
    if (info.access !== 'RW') return reject('READ_ONLY');
    const lim = info.limits;
    if (lim && typeof r.value === 'number' && (r.value < lim.min || r.value > lim.max))
      return reject('OUT_OF_LIMITS');
    if (r.expect !== undefined && values.get(r.tag) !== r.expect)
      return reject('STALE_EXPECTATION', 'Giá trị đã đổi so với lúc nhấn');
    const beh = BEHAVIOR[r.tag];
    if (beh?.reject) return reject(beh.reject.reason, beh.reject.message);
    const prev = values.get(r.tag);
    const rec = { tag: r.tag, value: r.value, status: 'ACCEPTED', phase: 'queued' };
    writes.set(r.requestId, rec);
    setTimeout(() => {
      if (beh?.final) return Object.assign(rec, beh.final, { phase: undefined });
      if (r.pulseMs) {
        rec.phase = 'release';
        values.set(r.tag, r.value);
        setTimeout(
          () => {
            values.set(r.tag, !r.value);
            Object.assign(rec, {
              status: 'CONFIRMED',
              code: 'NO_READBACK',
              phase: undefined,
              pulse: { valueMs: r.pulseMs, released: true },
            });
          },
          Math.min(r.pulseMs, 600),
        );
        return;
      }
      values.set(r.tag, r.value);
      Object.assign(rec, {
        status: 'CONFIRMED',
        code: 'CONFIRMED',
        readback: r.value,
        phase: undefined,
      });
    }, cfg.writeDelayMs);
    json(res, 200, {
      results: [
        {
          requestId: r.requestId,
          status: 'ACCEPTED',
          phase: 'queued',
          tag: r.tag,
          old: { value: prev, quality: 'GOOD' },
          value: r.value,
          receivedAt: new Date().toISOString(),
        },
      ],
    });
  }

  // ---- live ----
  function live(ws, sess) {
    log.wsOpened++;
    if (sess) log.wsCookie++;
    const conn = { ws, sess, ids: [], sub: '', seq: 0, last: new Map() };
    sockets.add(conn);
    const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
    send({
      type: 'hello',
      protocolVersion: cfg.protocol,
      serverVersion: '0.6.0-fake',
      ...(cfg.alarms && !cfg.protocol.startsWith('1.2') ? { features: ['alarms'] } : {}),
      maxClients: 10,
      heartbeatMs: 5000,
      timeoutMs: 15000,
      project: {
        projectId: proj.active.project.projectId,
        projectVersion: proj.active.project.projectVersion,
        digest: proj.active.digest,
      },
    });
    const hb = setInterval(() => send({ type: 'heartbeat', ts: Date.now() }), 5000);
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (m.type === 'subscribeAlarms') {
        log.alarmSubs = (log.alarmSubs ?? 0) + 1;
        conn.asub = m.requestId;
        if (!alarm.holdSnapshot) alarmSnapshot(conn);
        return;
      }
      if (m.type === 'unsubscribeAlarms') {
        conn.asub = '';
        return;
      }
      if (m.type !== 'subscribe') return;
      log.subscribes.push([...m.tags]);
      const known = m.tags.filter((t) => values.has(t));
      const unknown = m.tags.filter((t) => !values.has(t));
      if (!known.length)
        return send({
          type: 'error',
          requestId: m.requestId,
          code: 'NO_VALID_TAGS',
          message: 'Không có Tag hợp lệ',
        });
      conn.ids = known;
      conn.sub = m.requestId;
      conn.seq = 1;
      conn.last = new Map(known.map((t) => [t, stamp(t)]));
      send({
        type: 'snapshot',
        subscriptionId: m.requestId,
        sequence: 1,
        ts: Date.now(),
        tags: known.map((t) => {
          const q = quality.get(t);
          return {
            id: t,
            value: values.get(t),
            quality: q?.q ?? 'GOOD',
            ...(q ? { reason: q.reason } : {}),
            serverTimestamp: Date.now(),
            revision: 1,
          };
        }),
        unknown,
      });
    });
    ws.on('close', () => {
      clearInterval(hb);
      sockets.delete(conn);
    });
    ws.on('error', () => undefined);
  }
  const stamp = (t) => `${values.get(t)}|${quality.get(t)?.q ?? 'GOOD'}`;
  const timer = setInterval(() => {
    tick++;
    // Mức bồn dao động chậm để thấy giá trị sống; chỉ đổi khi test không ghi đè (TANK01.LEVEL không ghi được).
    if (opts.drift !== false)
      values.set('TANK01.LEVEL', Math.round((62.5 + 10 * Math.sin(tick / 8)) * 10) / 10);
    for (const c of sockets) {
      if (!c.sub || c.ws.readyState !== 1) continue;
      const changed = [];
      c.ids.forEach((t, i) => {
        const s = stamp(t);
        if (c.last.get(t) !== s) {
          c.last.set(t, s);
          const q = quality.get(t);
          changed.push([i, values.get(t), q?.q ?? 'GOOD', ...(q ? [q.reason] : [])]);
        }
      });
      if (changed.length)
        c.ws.send(
          JSON.stringify({
            type: 'delta',
            subscriptionId: c.sub,
            sequence: ++c.seq,
            ts: Date.now(),
            tags: changed,
          }),
        );
    }
  }, 250);

  await new Promise((ok) => http.listen(0, '127.0.0.1', ok));
  if (https) await new Promise((ok) => https.listen(0, '127.0.0.1', ok));

  const rt = {
    httpUrl: `http://127.0.0.1:${http.address().port}`,
    httpsUrl: https ? `https://127.0.0.1:${https.address().port}` : null,
    log,
    cfg,
    alarm: alarmCtl,
    /** Giữ snapshot alarm (chưa gửi sau subscribeAlarms) hoặc thả ra. */
    holdAlarmSnapshot(v) {
      alarm.holdSnapshot = v;
    },
    breakAlarmHistory(v) {
      alarm.historyBroken = v;
    },
    values,
    startedAt,
    sessions,
    setValue(id, value, q = 'GOOD', reason) {
      values.set(id, value);
      if (q === 'GOOD') quality.delete(id);
      else quality.set(id, { q, reason });
    },
    /** Hủy mọi phiên web (yêu cầu sau 401 SESSION_EXPIRED) và đóng live của phiên cookie bằng 4401. */
    expireAll() {
      sessions.clear();
      for (const c of sockets) if (c.sess) c.ws.close(4401, 'SESSION_ENDED');
    },
    /** Cắt mọi kết nối live (mất kết nối). */
    dropLive() {
      for (const c of sockets) c.ws.terminate();
    },
    /** Trạng thái lịch sử giả (null khi kịch bản không bật). */
    history: hist?.state ?? null,
    useProject(kind) {
      proj = projectOf(kind);
    },
    async close() {
      clearInterval(timer);
      for (const c of sockets) c.ws.terminate();
      wss.close();
      http.closeAllConnections?.();
      https?.closeAllConnections?.();
      await Promise.all([
        new Promise((ok) => http.close(ok)),
        https ? new Promise((ok) => https.close(ok)) : null,
      ]);
    },
  };
  return rt;
}
