// Client of the device-it scenarios (specs/005-device-online T051, T061; quickstart §3). Runs in
// the Node container of tests/device-it/compose.yaml, started by tools/device-it.ps1, and prints
// one JSON object: { scenario, checks: [{ name, pass, detail }], measures, pass }.
//
//   node client.mjs auth      --fp <fingerprint>        (passwords: MAT_IT_PW_ADMIN, _KYSU1, _XEM1)
//   node client.mjs tls-idle  --fp <fingerprint>
//   node client.mjs secrets   --fp <fingerprint>        (sign-in traffic only; the search is in ps1)
//   node client.mjs discovery
//   node client.mjs deploy|packages|busy|health|kill  --fp <fp>   (deploy-scenarios.mjs; kysu2)
//
// HTTPS calls go through tools/measure/device-api.mjs (pinned fingerprint, full handshake).
// The audit rows are read from a copy of rt1's audit.db (read-only volume) with node:sqlite.
import dgram from 'node:dgram';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { deployScenarios } from './deploy-scenarios.mjs';
import {
  audit,
  diagnostics,
  login,
  logout,
  pinnedRequest,
  session,
  PinError,
} from '../../tools/measure/device-api.mjs';

const RT1 = '172.30.5.10';
const RT2 = '172.30.5.11';
const RT3 = '172.30.5.12';
const CLIENT = '172.30.5.50';
const CLIENT_2 = '172.30.5.51'; // second address on lan (NET_ADMIN): sign-ins that get locked
const OTHER_NET = '172.30.6.50'; // the client's address on the second network
const ALIAS_OTHER = '10.99.0.50'; // extra address on the lan card, outside every subnet
const BROADCAST = '172.30.5.255';
const HTTPS_PORT = 8443;
const HTTP_PORT = 8080;
const DISCOVERY_PORT = 8446;
const ECHO_PORT = 9999; // UDP echo in rt1's network namespace (discovery: path control)
const BASE = `https://${RT1}:${HTTPS_PORT}`;

const args = process.argv.slice(2);
const scenario = args[0];
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const fp = opt('--fp', '');

const checks = [];
const measures = {};
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : detail });
  return Boolean(pass);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round1 = (x) => Math.round(x * 10) / 10;

function sh(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function addAddress(cidr) {
  try {
    sh('ip', ['addr', 'add', cidr, 'dev', 'eth0']);
  } catch (e) {
    if (!String(e.stderr).includes('exists')) throw e;
  }
}

// ------------------------------------------------------------------------------------- audit

/** Rows of rt1's audit.db (a copy of the WAL database, so the runtime's file is never touched). */
async function auditRows(where = '1 = 1', params = []) {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  try {
    for (const f of readdirSync('/rt1-data').filter((n) => n.startsWith('audit.db')))
      copyFileSync(join('/rt1-data', f), join(dir, f));
    const db = new DatabaseSync(join(dir, 'audit.db'));
    try {
      return db
        .prepare(`SELECT * FROM audit WHERE ${where} ORDER BY id`)
        .all(...params)
        .map((r) => ({ ...r }));
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A refusal is recorded either as its own row (or the row of its 60 s window) or, above 10
// refusal rows a minute, in audit.suppressed (research R11).
async function refusalRecorded(sinceId, channel, target) {
  const rows = await auditRows('id > ?', [sinceId]);
  return rows.some(
    (r) =>
      (r.action === 'access.denied' && r.channel === channel && r.target === target) ||
      r.action === 'audit.suppressed',
  );
}

async function lastAuditId() {
  const rows = await auditRows();
  return rows.length ? rows[rows.length - 1].id : 0;
}

// ---------------------------------------------------------------------------------- requests

function httpGet(host, port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host, port, path, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const get = (path, token, extra = {}) => pinnedRequest(BASE, fp, 'GET', path, { token, ...extra });

// -------------------------------------------------------------------------------------- auth

async function scenarioAuth() {
  const pw = {
    admin: process.env.MAT_IT_PW_ADMIN,
    kysu1: process.env.MAT_IT_PW_KYSU1,
    xem1: process.env.MAT_IT_PW_XEM1,
  };
  if (!pw.admin || !pw.kysu1 || !pw.xem1) throw new Error('MAT_IT_PW_* missing');
  addAddress(`${CLIENT_2}/24`);

  // Pinned identity, and a wrong pin stops before any HTTP byte.
  const id = await get('/api/v1/device/identity');
  check('identity 200 qua HTTPS có ghim', id.status === 200, id.status);
  check('identity: setupRequired = false', id.json?.setupRequired === false);
  check('identity: fingerprint = ghim', id.json?.fingerprint === fp.toLowerCase());
  measures.tls = { protocol: id.protocol, cipher: id.cipher, handshakeMs: round1(id.handshakeMs) };
  const before = await lastAuditId();
  const wrongPin = fp.slice(0, -1) + (fp.endsWith('0') ? '1' : '0');
  let pinErr = null;
  try {
    await login(BASE, wrongPin, 'admin', pw.admin);
  } catch (e) {
    pinErr = e;
  }
  check(
    'ghim sai: dừng sau bắt tay (cert-mismatch), không gửi request',
    pinErr instanceof PinError && pinErr.seen === fp.toLowerCase(),
    pinErr?.code,
  );
  await sleep(300);
  check(
    'ghim sai: thiết bị không ghi audit (không nhận request nào)',
    (await lastAuditId()) === before,
  );

  // Not signed in: 401 and audited.
  let since = await lastAuditId();
  const anon = await get('/api/v1/diagnostics');
  check(
    'chưa đăng nhập: diagnostics 401 AUTH_REQUIRED',
    anon.status === 401 && anon.json?.error === 'AUTH_REQUIRED',
    `${anon.status} ${anon.json?.error}`,
  );
  check('401 kèm WWW-Authenticate: Bearer', /^Bearer/.test(anon.headers['www-authenticate'] ?? ''));
  check(
    '401 có audit access.denied (https)',
    await refusalRecorded(since, 'https', '/api/v1/diagnostics'),
  );

  // Engineering endpoint over HTTP: 403 HTTPS_REQUIRED and audited.
  since = await lastAuditId();
  const plain = await httpGet(RT1, HTTP_PORT, '/api/v1/diagnostics');
  check(
    'HTTP: diagnostics 403 HTTPS_REQUIRED',
    plain.status === 403 && plain.json?.error === 'HTTPS_REQUIRED',
    `${plain.status} ${plain.json?.error}`,
  );
  check(
    'HTTP 403 có audit access.denied (http)',
    await refusalRecorded(since, 'http', '/api/v1/diagnostics'),
  );
  const page = await httpGet(RT1, HTTP_PORT, '/api/v1/system/info');
  check('HTTP: system/info vẫn 200 không cần đăng nhập (FR-033)', page.status === 200);
  check(
    'system/info: device.https = ok',
    page.json?.device?.https === 'ok',
    page.json?.device?.https,
  );

  // Sign-in of the three roles.
  const loginMs = [];
  const tokens = {};
  for (const [user, role] of [
    ['admin', 'administrator'],
    ['kysu1', 'engineer'],
    ['xem1', 'viewer'],
  ]) {
    const r = await login(BASE, fp, user, pw[user]);
    loginMs.push(r.requestMs);
    tokens[user] = r.json?.token;
    check(
      `đăng nhập ${user}: 200, role ${role}`,
      r.status === 200 && r.json?.role === role,
      `${r.status} ${r.json?.role}`,
    );
    check(
      `đăng nhập ${user}: idle 1800 s, tối đa 43200 s`,
      r.json?.idleTimeoutS === 1800 && r.json?.maxLifetimeS === 43200,
    );
  }
  const okRows = await auditRows("action = 'auth.login' AND result = 'ok'");
  check(
    'audit auth.login ok cho cả 3 tài khoản, kèm IP nguồn',
    ['admin', 'kysu1', 'xem1'].every((u) =>
      okRows.some((r) => r.user === u && r.source.startsWith(`${CLIENT}:`)),
    ),
  );

  // Roles.
  since = await lastAuditId();
  const viewer = await get('/api/v1/project/versions', tokens.xem1);
  check(
    'viewer: project/versions 403 FORBIDDEN',
    viewer.status === 403 && viewer.json?.error === 'FORBIDDEN',
    `${viewer.status} ${viewer.json?.error}`,
  );
  const rows403 = await auditRows('id > ?', [since]);
  check(
    'viewer 403 có audit access.denied kèm tài khoản',
    rows403.some(
      (r) => (r.action === 'access.denied' && r.user === 'xem1') || r.action === 'audit.suppressed',
    ),
  );
  const engAudit = await get('/api/v1/audit', tokens.kysu1);
  check(
    'engineer: audit 403 FORBIDDEN',
    engAudit.status === 403 && engAudit.json?.error === 'FORBIDDEN',
    `${engAudit.status} ${engAudit.json?.error}`,
  );
  const engVersions = await get('/api/v1/project/versions', tokens.kysu1);
  check(
    'engineer: project/versions qua cổng kiểm (không 401/403)',
    ![401, 403].includes(engVersions.status),
    engVersions.status,
  );
  const adminAudit = await get('/api/v1/audit', tokens.admin);
  check(
    'administrator: audit qua cổng kiểm (không 401/403)',
    ![401, 403].includes(adminAudit.status),
    adminAudit.status,
  );

  // Session and logout.
  const s = await session(BASE, fp, tokens.kysu1);
  check('session kysu1 200', s.status === 200 && s.json?.user === 'kysu1', s.status);
  const out = await logout(BASE, fp, tokens.kysu1);
  check('logout 204', out.status === 204, out.status);
  const after = await session(BASE, fp, tokens.kysu1);
  check('sau logout: session 401', after.status === 401, `${after.status} ${after.json?.error}`);
  check(
    'audit auth.logout',
    (await auditRows("action = 'auth.logout' AND user = 'kysu1'")).length >= 1,
  );

  // Lockout: 5 wrong passwords from the second address, then the right one is refused too.
  const wrong = [];
  for (let i = 0; i < 5; i++) {
    const r = await login(BASE, fp, 'kysu1', `${pw.kysu1}-sai-${i}`, { localAddress: CLIENT_2 });
    wrong.push(`${r.status} ${r.json?.error}`);
  }
  check(
    '5 lần sai: 401 AUTH_FAILED',
    wrong.every((w) => w === '401 AUTH_FAILED'),
    wrong.join(', '),
  );
  const locked = await login(BASE, fp, 'kysu1', pw.kysu1, { localAddress: CLIENT_2 });
  check(
    'lần 6, mật khẩu đúng: 429 AUTH_LOCKED',
    locked.status === 429 && locked.json?.error === 'AUTH_LOCKED',
    `${locked.status} ${locked.json?.error}`,
  );
  const retry = locked.json?.retryAfterS;
  check('khóa 5 phút: retryAfterS trong 290–300', retry >= 290 && retry <= 300, retry);
  check(
    'header Retry-After = retryAfterS',
    Number(locked.headers['retry-after']) === retry,
    locked.headers['retry-after'],
  );
  const otherIp = await login(BASE, fp, 'kysu1', pw.kysu1);
  check(
    'khóa theo tên: từ địa chỉ khác vẫn 429 AUTH_LOCKED',
    otherIp.status === 429 && otherIp.json?.error === 'AUTH_LOCKED',
    `${otherIp.status} ${otherIp.json?.error}`,
  );
  const adminAgain = await login(BASE, fp, 'admin', pw.admin);
  check(
    'tài khoản khác từ địa chỉ chưa bị khóa vẫn đăng nhập được',
    adminAgain.status === 200,
    adminAgain.status,
  );
  const lockRows = await auditRows(
    "user = 'kysu1' AND action IN ('auth.login', 'auth.lockout', 'auth.locked')",
  );
  check(
    'audit: auth.login failed',
    lockRows.some((r) => r.action === 'auth.login' && r.result === 'failed'),
  );
  check(
    'audit: auth.lockout',
    lockRows.some((r) => r.action === 'auth.lockout'),
  );
  check(
    'audit: auth.locked (thử khi đang khóa)',
    lockRows.some((r) => r.action === 'auth.locked'),
  );
  // T150: audit and diagnostics through the real routes. Engineer 403 is itself audited; the
  // administrator reads, pages and filters; a viewer reads diagnostics.
  const engRows = await auditRows(
    "action = 'access.denied' AND user = 'kysu1' AND target = '/api/v1/audit'",
  );
  check(
    'engineer gọi /audit: 403 có audit access.denied kèm tên',
    engRows.length >= 1 || (await auditRows("action = 'audit.suppressed'")).length >= 1,
  );
  const all = await audit(BASE, fp, tokens.admin, { limit: 200 });
  check(
    'administrator đọc audit 200',
    all.status === 200 && Array.isArray(all.json?.records),
    all.status,
  );
  const recs = all.json?.records ?? [];
  check(
    'audit có đăng nhập thất bại và khóa tạm',
    recs.some((r) => r.action === 'auth.login' && r.result === 'failed') &&
      recs.some((r) => r.action === 'auth.lockout'),
  );
  check(
    'audit có truy cập bị từ chối (access.denied)',
    recs.some((r) => r.action === 'access.denied'),
  );
  check(
    'audit không chứa mật khẩu thử',
    ![pw.admin, pw.kysu1, pw.xem1].some((p) => JSON.stringify(recs).includes(p)),
  );
  const byUser = await audit(BASE, fp, tokens.admin, { user: 'kysu1', action: 'auth.', limit: 50 });
  const urecs = byUser.json?.records ?? [];
  check(
    'lọc theo user và tiền tố action: chỉ có kysu1, auth.*',
    byUser.status === 200 &&
      urecs.length > 0 &&
      urecs.every((r) => r.user === 'kysu1' && r.action.startsWith('auth.')),
    `${byUser.status} ${urecs.length}`,
  );
  const page1 = await audit(BASE, fp, tokens.admin, { limit: 3 });
  const page2 = await audit(BASE, fp, tokens.admin, { limit: 3, before: page1.json?.next ?? 1 });
  check(
    'phân trang: next trỏ tới các bản cũ hơn',
    page1.json?.records?.length === 3 &&
      page1.json?.next !== null &&
      page2.json?.records?.every((r) => r.id < page1.json.records.at(-1).id + 1),
    `${page1.json?.next}`,
  );
  const badQuery = await audit(BASE, fp, tokens.admin, { limit: 0 });
  check('tham số sai: 400 BAD_REQUEST', badQuery.status === 400, badQuery.status);
  const viewerDiag = await diagnostics(BASE, fp, tokens.xem1);
  check(
    'viewer đọc diagnostics 200, đủ khóa',
    viewerDiag.status === 200 &&
      viewerDiag.json?.cpu &&
      viewerDiag.json?.memory &&
      viewerDiag.json?.uptime &&
      viewerDiag.json?.versions,
    viewerDiag.status,
  );
  check(
    'audit.read được ghi cho administrator',
    (await auditRows("action = 'audit.read' AND user = 'admin'")).length >= 1,
  );
  for (const t of Object.values(tokens)) if (t) await logout(BASE, fp, t).catch(() => {});
  if (adminAgain.json?.token) await logout(BASE, fp, adminAgain.json.token).catch(() => {});

  const sorted = [...loginMs].sort((a, b) => a - b);
  measures.loginMs = { median: round1(sorted[1]), min: round1(sorted[0]), max: round1(sorted[2]) };
  measures.retryAfterS = retry;
}

// ---------------------------------------------------------------------------------- tls-idle

function runtimePid() {
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      if (readFileSync(`/proc/${d}/comm`, 'utf8').trim() === 'mat-runtime') return Number(d);
    } catch {
      /* gone */
    }
  }
  return 0;
}

/** CPU time of the process in ms (utime + stime; USER_HZ = 100), and VmRSS in KiB. */
function procSample(pid) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const cpuMs = (Number(f[11]) + Number(f[12])) * 10;
  const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0);
  return { cpuMs, rssKiB: rss, at: performance.now() };
}

/** % of one core used by the runtime over `ms`, and its largest RSS meanwhile. */
async function cpuOver(pid, ms) {
  const a = procSample(pid);
  let rssMax = a.rssKiB;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await sleep(500);
    rssMax = Math.max(rssMax, procSample(pid).rssKiB);
  }
  const b = procSample(pid);
  return { pct: round1(((b.cpuMs - a.cpuMs) / (b.at - a.at)) * 100), rssMaxKiB: rssMax };
}

/** Opens `n` connections with `open(i)` → socket; resolves with the seconds until each closed. */
function closeTimes(sockets) {
  const t0 = performance.now();
  return Promise.all(
    sockets.map(
      (s) =>
        new Promise((resolve) => {
          const done = () => resolve((performance.now() - t0) / 1000);
          if (s.destroyed) return done();
          s.once('close', done);
          s.on('error', () => {});
          s.on('data', () => {});
        }),
    ),
  );
}

async function ninthClient(delayMs) {
  await sleep(delayMs);
  const t0 = performance.now();
  try {
    const r = await pinnedRequest(BASE, fp, 'GET', '/api/v1/device/identity', { timeoutMs: 40000 });
    return { status: r.status, waitS: round1((performance.now() - t0) / 1000) };
  } catch (e) {
    return { error: e.code ?? e.message, waitS: round1((performance.now() - t0) / 1000) };
  }
}

async function scenarioTlsIdle() {
  const pid = runtimePid();
  if (!check('thấy tiến trình mat-runtime của rt1 (chung PID namespace)', pid > 0)) return;
  const conns = 8;
  const idle = await cpuOver(pid, 10000);
  measures.idle = idle;

  // Phase 1: 8 TCP connections that never send a byte (TLS handshake waits; mAT patch 3).
  const silent = [];
  for (let i = 0; i < conns; i++) {
    silent.push(net.connect({ host: RT1, port: HTTPS_PORT, localAddress: CLIENT }));
  }
  await Promise.all(silent.map((s) => new Promise((r) => s.once('connect', r))));
  const closedSilent = closeTimes(silent);
  const ninthSilent = ninthClient(2000);
  const cpuSilent = await cpuOver(pid, 8000);
  const tSilent = await closedSilent;
  const n9s = await ninthSilent;
  measures.silent = {
    connections: conns,
    cpuPct: cpuSilent.pct,
    cpuIncreasePts: round1(cpuSilent.pct - idle.pct),
    rssMaxKiB: cpuSilent.rssMaxKiB,
    closedAfterS: tSilent.map(round1),
    ninthClient: n9s,
  };
  check(
    `im lặng: CPU tăng ≤ 2 điểm (${measures.silent.cpuIncreasePts})`,
    measures.silent.cpuIncreasePts <= 2,
  );
  check(
    `im lặng: cả ${conns} kết nối bị đóng sau ≤ 11 s`,
    Math.max(...tSilent) <= 11,
    Math.max(...tSilent).toFixed(1),
  );
  check('im lặng: client thứ 9 vẫn được phục vụ (sau khi worker rảnh)', n9s.status === 200, n9s);

  await sleep(1000);
  // Phase 2: 8 TLS connections, one keep-alive request each, then silent (decision 2026-10-12:
  // the device closes an idle connection after 15 s).
  const kept = [];
  for (let i = 0; i < conns; i++) {
    const s = tls.connect({ host: RT1, port: HTTPS_PORT, rejectUnauthorized: false });
    await new Promise((resolve, reject) => {
      s.once('secureConnect', resolve);
      s.once('error', reject);
    });
    let got = '';
    const answered = new Promise((resolve) => {
      const onData = (c) => {
        got += c;
        if (/\r\n\r\n/.test(got) && /\}\s*$/.test(got)) {
          s.off('data', onData);
          resolve();
        }
      };
      s.on('data', onData);
    });
    s.write(`GET /api/v1/device/identity HTTP/1.1\r\nHost: ${RT1}\r\n\r\n`);
    await answered;
    if (!/^HTTP\/1\.1 200/.test(got) || /connection:\s*close/i.test(got)) {
      check('keep-alive: phản hồi 200 giữ kết nối', false, got.split('\r\n')[0]);
    }
    kept.push(s);
  }
  const closedKept = closeTimes(kept);
  const ninthKept = ninthClient(2000);
  const cpuKept = await cpuOver(pid, 12000);
  const tKept = await closedKept;
  const n9k = await ninthKept;
  measures.keepAlive = {
    connections: conns,
    cpuPct: cpuKept.pct,
    cpuIncreasePts: round1(cpuKept.pct - idle.pct),
    rssMaxKiB: cpuKept.rssMaxKiB,
    closedAfterS: tKept.map(round1),
    ninthClient: n9k,
  };
  check(
    `keep-alive: CPU tăng ≤ 2 điểm (${measures.keepAlive.cpuIncreasePts})`,
    measures.keepAlive.cpuIncreasePts <= 2,
  );
  check(
    `keep-alive: cả ${conns} kết nối rảnh bị đóng sau 14–16,5 s`,
    Math.min(...tKept) >= 14 && Math.max(...tKept) <= 16.5,
    `${Math.min(...tKept).toFixed(1)}–${Math.max(...tKept).toFixed(1)}`,
  );
  check('keep-alive: client thứ 9 vẫn được phục vụ (sau khi worker rảnh)', n9k.status === 200, n9k);
  measures.after = await cpuOver(pid, 3000);
}

// ----------------------------------------------------------------------------------- secrets

// Sign-in traffic with every test password, right and wrong, so that the search of tools/
// device-it.ps1 has something to miss. MAT_IT_PW_WRONG is a random wrong password.
async function scenarioSecrets() {
  const users = [
    ['admin', process.env.MAT_IT_PW_ADMIN],
    ['xem1', process.env.MAT_IT_PW_XEM1],
  ];
  for (const [user, password] of users) {
    const r = await login(BASE, fp, user, password);
    check(`đăng nhập ${user} 200`, r.status === 200, r.status);
    if (r.json?.token) {
      await session(BASE, fp, r.json.token);
      await logout(BASE, fp, r.json.token);
    }
  }
  const bad = await login(BASE, fp, 'xem1', process.env.MAT_IT_PW_WRONG);
  check('đăng nhập sai 401', bad.status === 401, bad.status);
  // A password typed in the user field (a common slip) must not be kept either.
  const slip = await login(BASE, fp, process.env.MAT_IT_PW_SLIP, 'x'.repeat(16));
  check('mật khẩu gõ nhầm vào ô tên: 401', slip.status === 401, slip.status);
}

// --------------------------------------------------------------------------------- discovery

const QUERY_SIZE = 1024;

function queryPacket(nonce) {
  const b = Buffer.alloc(QUERY_SIZE);
  b.write('MATD', 0, 'latin1');
  b[4] = 1;
  b[5] = 1;
  nonce.copy(b, 8);
  return b;
}

function parseReply(msg, nonce) {
  if (msg.length < 24 || msg.length > 1024) return null;
  if (msg.toString('latin1', 0, 4) !== 'MATD' || msg[4] !== 1 || msg[5] !== 2) return null;
  if (!msg.subarray(8, 24).equals(nonce)) return null;
  try {
    return { flags: msg.readUInt16BE(6), json: JSON.parse(msg.subarray(24).toString('utf8')) };
  } catch {
    return null;
  }
}

/**
 * Sends the query to each target at the given times (ms) from a socket bound to `bind`
 * ({ address, port }), and listens for `listenMs`. Returns the replies.
 */
async function sweep({
  bind,
  targets,
  at = [0],
  listenMs = 2500,
  broadcast = false,
  port = DISCOVERY_PORT,
}) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: false });
  await new Promise((resolve, reject) => {
    sock.once('error', reject);
    sock.bind({ address: bind.address, port: bind.port ?? 0, exclusive: true }, resolve);
  });
  if (broadcast) sock.setBroadcast(true);
  const nonce = Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)));
  const packet = queryPacket(nonce);
  const replies = [];
  const t0 = performance.now();
  sock.on('message', (msg, rinfo) => {
    replies.push({
      from: rinfo.address,
      size: msg.length,
      ms: round1(performance.now() - t0),
      reply: parseReply(msg, nonce),
    });
  });
  for (const ms of at) {
    const wait = t0 + ms - performance.now();
    if (wait > 0) await sleep(wait);
    for (const t of targets) sock.send(packet, port, t);
  }
  await sleep(Math.max(0, t0 + listenMs - performance.now()));
  sock.close();
  return replies;
}

async function scenarioDiscovery() {
  addAddress(`${ALIAS_OTHER}/24`);
  // rt3 runs (HTTPS answers) with discovery off: its silence is the setting, not a dead runtime.
  const rt3 = await httpGet(RT3, HTTP_PORT, '/api/v1/system/info');
  check(
    'rt3 chạy, system/info: discovery = false',
    rt3.status === 200 && rt3.json?.device?.discovery === false,
    rt3.json?.device?.discovery,
  );

  // 1. A Studio-like sweep: broadcast at 0, 600, 1200 ms, listen 2.5 s.
  const sweepReplies = await sweep({
    bind: { address: '0.0.0.0' },
    targets: [BROADCAST],
    at: [0, 600, 1200],
    listenMs: 2500,
    broadcast: true,
  });
  const first = (ip) => sweepReplies.find((r) => r.from === ip && r.reply);
  const r1 = first(RT1);
  const r2 = first(RT2);
  check('quét broadcast: thấy rt1 trong ≤ 3 s', r1 && r1.ms <= 3000, r1?.ms);
  check('quét broadcast: thấy rt2 trong ≤ 3 s', r2 && r2.ms <= 3000, r2?.ms);
  check(
    'quét broadcast: rt3 (discoveryEnabled false) im lặng',
    !sweepReplies.some((r) => r.from === RT3),
  );
  check(
    'mọi gói trả lời hợp lệ (magic, type, nonce, JSON)',
    sweepReplies.length > 0 && sweepReplies.every((r) => r.reply),
  );
  check(
    'gói trả lời ≤ gói hỏi (1024 byte)',
    sweepReplies.every((r) => r.size <= QUERY_SIZE),
    Math.max(...sweepReplies.map((r) => r.size)),
  );
  const j1 = r1?.reply?.json;
  const j2 = r2?.reply?.json;
  check(
    'trả lời: ip = địa chỉ nguồn, prefix 24, https 8443, fp 64 hex',
    j1?.ip === RT1 &&
      j1?.prefix === 24 &&
      j1?.https === HTTPS_PORT &&
      /^[0-9a-f]{64}$/.test(j1?.fp ?? ''),
    JSON.stringify(j1),
  );
  check('hai runtime có deviceId khác nhau', j1?.id && j2?.id && j1.id !== j2.id);
  check(
    'trả lời không có tài khoản, mật khẩu, token, đường dẫn',
    !/user|pass|token|\/data|\/etc/i.test(JSON.stringify([j1, j2])),
  );
  measures.sweep = {
    replies: sweepReplies.length,
    firstReplyMs: { rt1: r1?.ms, rt2: r2?.ms },
    maxReplyBytes: Math.max(...sweepReplies.map((r) => r.size)),
    sample: j1,
  };

  await sleep(3500); // refill the per-source bucket (3 replies, 1/s)
  // 2. Control: unicast from the client's own lan address is answered.
  const control = await sweep({ bind: { address: CLIENT }, targets: [RT1, RT2, RT3] });
  check(
    'đối chứng: unicast từ cùng subnet được rt1, rt2 trả lời',
    [RT1, RT2].every((ip) => control.some((r) => r.from === ip && r.reply)),
  );
  check('đối chứng: rt3 im lặng với unicast', !control.some((r) => r.from === RT3));

  // 3. A source outside the subnet of the card: no reply. The path must be able to carry a reply,
  // or silence proves nothing: tools/device-it.ps1 gives rt1 and rt2 a route to 10.99.0.0/24 on
  // their lan card, and runs a UDP echo in rt1's network namespace (port ECHO_PORT) as a control.
  const echo = await sweep({ bind: { address: ALIAS_OTHER }, targets: [RT1], port: ECHO_PORT });
  check(
    `đối chứng đường về: echo UDP trong netns của rt1 trả lời được ${ALIAS_OTHER}`,
    echo.some((r) => r.from === RT1),
    echo.length,
  );
  // The second Docker network is no foreign source: Docker masquerades what leaves it for the lan
  // to the lan gateway (172.30.5.1), an address of the same subnet, so the device answers. Kept
  // as a measure: a router that does NAT into the LAN makes a remote client look local.
  const fromOther = await sweep({
    bind: { address: OTHER_NET },
    targets: [RT1, RT2],
    at: [0, 600, 1200],
  });
  measures.secondNetworkViaNat = {
    source: OTHER_NET,
    seenByDeviceAs: '172.30.5.1 (Docker masquerade)',
    replies: fromOther.length,
  };
  await sleep(3500); // the replies above came from the gateway's bucket, not the alias's
  const fromAlias = await sweep({
    bind: { address: ALIAS_OTHER },
    targets: [RT1, RT2],
    at: [0, 600, 1200],
  });
  check(
    `nguồn ${ALIAS_OTHER} (địa chỉ phụ ngoài subnet): không được trả lời`,
    fromAlias.length === 0,
    fromAlias.length,
  );

  // 4. Source port 53: no reply.
  const port53 = await sweep({
    bind: { address: CLIENT, port: 53 },
    targets: [RT1, RT2],
    at: [0, 600, 1200],
  });
  check('cổng nguồn 53: không được trả lời', port53.length === 0, port53.length);

  await sleep(3500);
  // 5. Rate: 5 queries from one source within 1 s → 3 replies per device (bucket of 3).
  const burst = await sweep({
    bind: { address: CLIENT },
    targets: [RT1],
    at: [0, 200, 400, 600, 800],
    listenMs: 1500,
  });
  const fromRt1 = burst.filter((r) => r.from === RT1).length;
  check('tần suất: 5 gói hỏi trong 1 s → 3 trả lời', fromRt1 === 3, fromRt1);
  measures.rateBurstReplies = fromRt1;
}

// ------------------------------------------------------------------------------------- main

// The runtime reads users.json again when it changes (at most every 2 s): wait until the accounts
// made by tools/device-it.ps1 are there.
async function waitReady() {
  const end = performance.now() + 20000;
  let id;
  while (performance.now() < end) {
    id = await get('/api/v1/device/identity').catch(() => null);
    if (id?.json?.setupRequired === false) break;
    await sleep(500);
  }
  check('rt1: tài khoản thử đã nạp (setupRequired = false)', id?.json?.setupRequired === false);
}

// UDP echo for the path control of the discovery scenario: tools/device-it.ps1 runs it in a helper
// container that shares rt1's network namespace. Not a scenario: prints nothing, runs until killed.
function udpEcho() {
  const sock = dgram.createSocket('udp4');
  sock.on('message', (msg, rinfo) => sock.send(Buffer.from('echo'), rinfo.port, rinfo.address));
  sock.bind(ECHO_PORT);
  return new Promise(() => {});
}
if (scenario === 'udp-echo') await udpEcho();

const deploys = deployScenarios({
  check,
  measures,
  fp,
  BASE,
  RT1,
  sleep,
  round1,
  auditRows,
  runtimePid,
  httpGet,
  opt,
});
const scenarios = {
  ready: waitReady,
  deploy: deploys.deploy,
  packages: deploys.packages,
  busy: deploys.busy,
  health: deploys.health,
  kill: deploys.kill,
  auth: scenarioAuth,
  'tls-idle': scenarioTlsIdle,
  secrets: scenarioSecrets,
  discovery: scenarioDiscovery,
};
if (!scenarios[scenario]) {
  console.error(`usage: node client.mjs ${Object.keys(scenarios).join('|')} [--fp <fingerprint>]`);
  process.exit(2);
}
if (scenario !== 'discovery' && !/^[0-9a-f]{64}$/i.test(fp)) {
  console.error('client: --fp <64 hex> is required');
  process.exit(2);
}
let error;
try {
  await scenarios[scenario]();
} catch (e) {
  error = e instanceof PinError ? `cert-mismatch: ${e.seen}` : (e.stack ?? String(e));
}
const result = {
  scenario,
  checks,
  measures,
  error,
  pass: !error && checks.length > 0 && checks.every((c) => c.pass),
};
process.stdout.write(JSON.stringify(result) + '\n');
process.exit(0);
