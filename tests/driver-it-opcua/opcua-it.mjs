// Scenarios of the OPC UA driver integration tests (feature 019 T021, specs/019-driver-opcua/spec.md
// US1-US4). Runs in the Node container of tests/driver-it-opcua/compose.yaml, started by
// tools/driver-it-opcua.ps1, and prints one JSON object: { scenario, checks, measures, pass }.
//
//   node opcua-it.mjs read|write|errors|security --fp <fingerprint>
//   node opcua-it.mjs reconnect-before|reconnect-down|reconnect-up --fp <fp>   (the script stops and
//                                                                           starts the server between)
//   node opcua-it.mjs load --seconds 60 --clients 10 --fp <fp>             (project bench-500-opcua)
//
// Passwords come from the environment (MAT_IT_PW_ADMIN, _KYSU1, _VH1). The runtime is `rt`, the
// server `sim` (tools/opcua-sim). Same helpers as tests/driver-it (pinned HTTPS, live channel).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { login, pinnedRequest, pinnedWebSocket } from '../../tools/measure/device-api.mjs';

const BASE = 'https://rt:8443';
const LIVE_USER = 'kysu1';
const STATE = '/tmp/opcua-it-state.json';

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
  checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : String(detail) });
  return Boolean(pass);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const round1 = (x) => Math.round(x * 10) / 10;

// ------------------------------------------------------------------------------------- API, live

const tokens = {};
async function token(user) {
  if (tokens[user]) return tokens[user];
  const r = await login(BASE, fp, user, process.env[`MAT_IT_PW_${user.toUpperCase()}`]);
  if (r.status !== 200) throw new Error(`login ${user}: ${r.status} ${r.body}`);
  tokens[user] = r.json.token;
  return tokens[user];
}
async function api(user, method, path, body) {
  return pinnedRequest(BASE, fp, method, path, {
    token: user ? await token(user) : undefined,
    body,
  });
}

function projectTags(dir) {
  return JSON.parse(readFileSync(`/src/tests/driver-it-opcua/projects/${dir}/tags.json`, 'utf8'))
    .tags;
}

class Live {
  constructor(ids) {
    this.ids = ids;
    this.tags = new Map();
    this.order = [];
    this.gaps = 0;
    this.lastSeq = 0;
    this.changeLog = [];
    this.snapshotAt = 0;
  }
  async open() {
    this.ws = await pinnedWebSocket(BASE, fp, await token(LIVE_USER));
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    this.beat = setInterval(() => {
      try {
        this.ws.send(JSON.stringify({ type: 'heartbeat' }));
      } catch {
        // closed
      }
    }, 5000);
    this.ws.send(
      JSON.stringify({ type: 'subscribe', requestId: 's1', tags: this.ids, mode: 'delta' }),
    );
    const t0 = now();
    while (!this.snapshotAt && now() - t0 < 10000) await sleep(20);
    if (!this.snapshotAt) throw new Error('no snapshot');
    return this;
  }
  onMessage(m) {
    if (m.type === 'snapshot') {
      this.order = m.tags.map((t) => t.id);
      for (const t of m.tags)
        this.tags.set(t.id, { value: t.value, quality: t.quality, reason: t.reason ?? '' });
      this.snapshotAt = now();
      this.lastSeq = m.sequence;
    } else if (m.type === 'delta') {
      if (m.sequence !== this.lastSeq + 1) this.gaps++;
      this.lastSeq = m.sequence;
      const at = now();
      for (const e of m.tags) {
        const id = this.order[e[0]];
        const prev = this.tags.get(id);
        this.tags.set(id, { value: e[1], quality: e[2], reason: e[3] ?? '' });
        if (!prev || prev.value !== e[1] || prev.quality !== e[2])
          this.changeLog.push({ id, at, serverTs: m.ts });
      }
    }
  }
  get(id) {
    return this.tags.get(id);
  }
  async waitFor(id, pred, ms = 10000) {
    const t0 = now();
    while (now() - t0 < ms) {
      const t = this.tags.get(id);
      if (t && pred(t)) return t;
      await sleep(20);
    }
    return undefined;
  }
  async waitAll(ids, pred, ms) {
    const t0 = now();
    while (now() - t0 < ms) {
      if (ids.every((id) => this.tags.get(id) && pred(this.tags.get(id)))) return now() - t0;
      await sleep(50);
    }
    return -1;
  }
  close() {
    clearInterval(this.beat);
    try {
      this.ws.close();
    } catch {
      // closed already
    }
  }
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16),
  );

async function writeAndWait(user, tag, value, maxMs = 15000) {
  let id = uuid();
  let t0 = now();
  let post = await api(user, 'POST', '/api/v1/tags/write', {
    requests: [{ requestId: id, tag, value }],
  });
  let first = post.json?.results?.[0];
  for (let i = 0; i < 3 && first?.reason === 'RATE_LIMITED'; i++) {
    await sleep((first.retryAfterMs ?? 3000) + 100);
    id = uuid();
    t0 = now();
    post = await api(user, 'POST', '/api/v1/tags/write', {
      requests: [{ requestId: id, tag, value }],
    });
    first = post.json?.results?.[0];
  }
  if (post.status !== 200 || first?.status !== 'ACCEPTED') return { first, final: first, id };
  let final = first;
  while (now() - t0 < maxMs) {
    await sleep(200);
    const r = await api(user, 'GET', `/api/v1/tags/write/${id}`);
    final = r.json?.results?.[0] ?? final;
    if (final.status !== 'ACCEPTED') break;
  }
  return { first, final, id, ms: now() - t0 };
}

async function diag() {
  const r = await api(LIVE_USER, 'GET', '/api/v1/drivers/diagnostics');
  if (r.status !== 200) throw new Error(`drivers/diagnostics ${r.status}`);
  return r.json.channels.find((c) => c.id === 'ua-1');
}

function runtimePid() {
  for (const d of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      if (readFileSync(`/proc/${d}/cmdline`, 'utf8').startsWith('/build/x64/bin/mat-runtime'))
        return Number(d);
    } catch {
      // gone
    }
  }
  return 0;
}

// --------------------------------------------------------------------------- expected values

// initial values of tools/opcua-sim (sim_server.cpp, kTypes)
const EXPECT = {
  'UA.BOOL': true,
  'UA.SBYTE': -5,
  'UA.BYTE': 200,
  'UA.INT16': -1234,
  'UA.UINT16': 54321,
  'UA.INT32': -123456,
  'UA.UINT32': 3000000000,
  'UA.INT64': -9000000000,
  'UA.UINT64': 18000000000000000000,
  'UA.FLOAT': 3.5,
  'UA.DOUBLE': 2.718281828,
  'UA.STRING': 'Xin chào',
  'UA.DATETIME_MS': 1792810800000,
  'UA.DATETIME': '2026-10-24T03:00:00.000Z',
  'UA.N_INT16': -1234,
  'UA.N_DOUBLE': 2.718281828,
  'UA.READONLY': 42.5,
};
const REFUSED = {
  'UA.NO_NODE': 'OPCUA_NODE_UNKNOWN',
  'UA.ARRAY': 'OPCUA_TYPE_MISMATCH',
  'UA.TOO_BIG': 'OPCUA_TYPE_MISMATCH',
};
const same = (a, b) =>
  typeof b === 'number' ? Math.abs(Number(a) - b) <= 1e-7 * Math.max(1, Math.abs(b)) : a === b;

async function checkValues(live, label, expect) {
  const ids = Object.keys(expect);
  for (const id of ids) await live.waitFor(id, (t) => t.quality === 'GOOD', 15000);
  let ok = 0;
  for (const id of ids) {
    const t = live.get(id);
    const match = t && t.quality === 'GOOD' && same(t.value, expect[id]);
    if (match) ok++;
    else check(`${label}: value of ${id}`, false, `got ${JSON.stringify(t)} want ${expect[id]}`);
  }
  check(`${label}: 100 % of the Tags match the server`, ok === ids.length, `${ok}/${ids.length}`);
  return ok;
}

// ------------------------------------------------------------------------------------- read

async function runRead() {
  const ids = projectTags('read-all-types-opcua').map((t) => t.id);
  const live = await new Live(ids).open();
  const t0 = now();
  measures.tagsMatching = await checkValues(live, 'read', EXPECT);
  measures.firstGoodMs = now() - t0;
  const c0 = live.get('UA.COUNTER')?.value;
  const moved = await live.waitFor('UA.COUNTER', (t) => Number(t.value) >= Number(c0) + 2, 5000);
  check(
    'the counter changes by subscription',
    Boolean(moved),
    JSON.stringify(live.get('UA.COUNTER')),
  );
  const d = await diag();
  check(
    'diagnostics: kind opcua, connected, subscription',
    d?.kind === 'opcua' && d?.state === 'connected' && d?.details?.readMode === 'subscription',
    JSON.stringify({ state: d?.state, details: d?.details }),
  );
  check(
    'diagnostics: publishing intervals 250/1000/5000',
    d?.details?.publishingMs === '250/1000/5000',
    d?.details?.publishingMs,
  );
  live.close();
}

// ------------------------------------------------------------------------------------- write

async function runWrite() {
  const ids = projectTags('read-all-types-opcua').map((t) => t.id);
  const live = await new Live(ids).open();
  await live.waitAll(Object.keys(EXPECT), (t) => t.quality === 'GOOD', 15000);
  const cases = [
    ['UA.BOOL', false],
    ['UA.BYTE', 17],
    ['UA.INT16', -2000],
    ['UA.INT32', 765432],
    ['UA.FLOAT', 1.5],
    ['UA.DOUBLE', 12345.678],
    ['UA.STRING', 'Bơm 2 chạy'],
  ];
  const ms = [];
  for (const [tag, value] of cases) {
    const r = await writeAndWait('vh1', tag, value);
    ms.push(r.ms ?? 0);
    check(
      `write ${tag} = ${JSON.stringify(value)}: CONFIRMED`,
      r.final?.status === 'CONFIRMED',
      JSON.stringify(r.final),
    );
    const seen = await live.waitFor(tag, (t) => same(t.value, value), 3000);
    check(`write ${tag}: live value`, Boolean(seen), JSON.stringify(live.get(tag)));
  }
  measures.writeMsMax = Math.max(...ms);
  const ro = await writeAndWait('vh1', 'UA.READONLY', 50);
  check(
    'write to a read-only node: refused by the server',
    ro.final?.status !== 'CONFIRMED' && /DEVICE_EXCEPTION/.test(JSON.stringify(ro.final)),
    JSON.stringify(ro.final),
  );
  const out = await writeAndWait('vh1', 'UA.INT16', 31000);
  check(
    'write beyond limits refused before the server',
    out.final?.status !== 'CONFIRMED',
    JSON.stringify(out.final),
  );
  const rows = await api('admin', 'GET', '/api/v1/audit?action=tag.write&target=UA.INT16&limit=50');
  check(
    'audit: tag.write rows for UA.INT16',
    (rows.json?.records ?? []).length >= 2,
    `${(rows.json?.records ?? []).length} rows`,
  );
  live.close();
}

// ------------------------------------------------------------------------------------ errors

async function runErrors() {
  const ids = projectTags('read-all-types-opcua').map((t) => t.id);
  const live = await new Live(ids).open();
  for (const [id, reason] of Object.entries(REFUSED)) {
    const t = await live.waitFor(id, (x) => x.reason === reason, 15000);
    check(`${id} BAD ${reason}`, t?.quality === 'BAD', JSON.stringify(live.get(id)));
  }
  await live.waitAll(Object.keys(EXPECT), (t) => t.quality === 'GOOD', 15000);
  check(
    'the other Tags stay GOOD',
    Object.keys(EXPECT).every((id) => live.get(id)?.quality === 'GOOD'),
  );
  const d = await diag();
  check(
    'diagnostics: lastStatus is a Bad name',
    /^Bad/.test(d?.details?.lastStatus ?? ''),
    d?.details?.lastStatus,
  );
  live.close();
}

// --------------------------------------------------------------------------------- reconnect

const RECONNECT_IDS = ['UA.INT16', 'UA.DOUBLE', 'UA.COUNTER', 'UA.STRING'];

async function runReconnectBefore() {
  const live = await new Live(RECONNECT_IDS).open();
  const ms = await live.waitAll(RECONNECT_IDS, (t) => t.quality === 'GOOD', 15000);
  check('before: every Tag GOOD', ms >= 0, `${ms} ms`);
  writeFileSync(STATE, JSON.stringify({ pid: runtimePid() }));
  live.close();
}

async function runReconnectDown() {
  const live = await new Live(RECONNECT_IDS).open();
  const ms = await live.waitAll(RECONNECT_IDS, (t) => t.quality === 'BAD', 15000);
  const reasons = [...new Set(RECONNECT_IDS.map((id) => live.get(id)?.reason))];
  measures.badMs = ms;
  check(
    'server stopped: every Tag BAD DISCONNECTED',
    ms >= 0 && reasons.join() === 'DISCONNECTED',
    JSON.stringify(reasons),
  );
  const w = await writeAndWait('vh1', 'UA.INT16', 5);
  check('a write while down is not sent', w.final?.status !== 'CONFIRMED', JSON.stringify(w.final));
  live.close();
}

async function runReconnectUp() {
  const live = await new Live(RECONNECT_IDS).open();
  const ms = await live.waitAll(RECONNECT_IDS, (t) => t.quality === 'GOOD', 20000);
  measures.goodMs = ms;
  check(
    'server back: every Tag GOOD within 20 s (backoff, subscriptions made again)',
    ms >= 0,
    `${ms} ms`,
  );
  const c0 = Number(live.get('UA.COUNTER')?.value);
  const moved = await live.waitFor('UA.COUNTER', (t) => Number(t.value) >= c0 + 2, 5000);
  check('the subscription delivers again', Boolean(moved));
  const before = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).pid : 0;
  check('the runtime did not restart', runtimePid() === before, `${before} -> ${runtimePid()}`);
  const d = await diag();
  measures.reconnects = d?.reconnects;
  check('diagnostics count the reconnection', (d?.reconnects ?? 0) >= 1, String(d?.reconnects));
  live.close();
}

// ---------------------------------------------------------------------------------- security

async function runSecurity() {
  const ids = Object.keys(EXPECT);
  const live = await new Live(ids).open();
  measures.tagsMatching = await checkValues(live, 'SignAndEncrypt + user', EXPECT);
  const d = await diag();
  check(
    'diagnostics: Basic256Sha256 SignAndEncrypt, pinned certificate, client certificate',
    d?.details?.securityPolicy === 'Basic256Sha256' &&
      d?.details?.securityMode === 'SignAndEncrypt' &&
      /^[0-9a-f]{64}$/.test(d?.details?.serverCertSha256 ?? '') &&
      /^[0-9a-f]{64}$/.test(d?.details?.clientCertSha256 ?? ''),
    JSON.stringify(d?.details),
  );
  const r = await writeAndWait('vh1', 'UA.DOUBLE', 77.25);
  check(
    'write over the encrypted channel: CONFIRMED',
    r.final?.status === 'CONFIRMED',
    JSON.stringify(r.final),
  );
  // the browse route with the same channel: pinned, password from the device
  const ch = JSON.parse(readFileSync(`${opt('--project', '')}/connections.json`, 'utf8'))
    .channels[0];
  const b = await api('kysu1', 'POST', '/api/v1/drivers/opcua/browse', {
    channel: ch,
    action: 'browse',
    nodeId: 'ns=2;s=Sim',
  });
  check(
    'browse over the encrypted channel lists the nodes',
    b.status === 200 &&
      b.json?.ok &&
      (b.json?.references ?? []).some((x) => x.nodeId === 'ns=2;s=Double'),
    `${b.status} ${b.json?.code} ${(b.json?.references ?? []).length}`,
  );
  const unpinned = await api('kysu1', 'POST', '/api/v1/drivers/opcua/browse', {
    channel: { ...ch, opcua: { ...ch.opcua, serverCertSha256: '0'.repeat(64) } },
    action: 'browse',
  });
  check(
    'a wrong pin: OPCUA_CERT_UNTRUSTED with the certificate seen',
    unpinned.json?.code === 'OPCUA_CERT_UNTRUSTED' &&
      unpinned.json?.server?.certSha256 === ch.opcua.serverCertSha256,
    JSON.stringify(unpinned.json?.server),
  );
  live.close();
}

// -------------------------------------------------------------------------------------- load

async function runLoad() {
  const seconds = Number(opt('--seconds', '60'));
  const nClients = Number(opt('--clients', '10'));
  const ids = projectTags('bench-500-opcua').map((t) => t.id);
  const clients = [];
  for (let i = 0; i < nClients; i++) clients.push(await new Live(ids).open());
  const pid = runtimePid();
  const stat = () => {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return Number(s[11]) + Number(s[12]);
  };
  const rss = () =>
    Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) * 1024;
  await clients[0].waitAll(ids, (t) => t.quality === 'GOOD', 20000);
  await sleep(3000);
  const cpu0 = stat();
  const t0 = now();
  let rssMax = 0;
  const samples = [];
  let lastCpu = cpu0;
  let lastT = t0;
  for (let s = 0; s < seconds; s += 5) {
    await sleep(5000);
    rssMax = Math.max(rssMax, rss());
    const c = stat();
    const t = now();
    samples.push(((c - lastCpu) / 100 / ((t - lastT) / 1000)) * 100);
    lastCpu = c;
    lastT = t;
  }
  const secs = (now() - t0) / 1000;
  measures.seconds = round1(secs);
  measures.clients = nClients;
  measures.tags = ids.length;
  measures.cpuPercentOneCoreAvg = round1(((stat() - cpu0) / 100 / secs) * 100);
  measures.cpuPercentOneCoreMax5s = round1(Math.max(...samples));
  measures.rssMaxMB = round1(rssMax / 1048576);
  const gaps = clients.reduce((n, c) => n + c.gaps, 0);
  measures.sequenceGaps = gaps;
  check('no lost sequence on any client', gaps === 0, `${gaps} gaps`);
  const periods = [];
  for (const c of clients) {
    const last = new Map();
    for (const ch of c.changeLog) {
      const p = last.get(ch.id);
      if (p !== undefined) periods.push(ch.serverTs - p);
      last.set(ch.id, ch.serverTs);
    }
  }
  const mean = periods.reduce((a, b) => a + b, 0) / Math.max(1, periods.length);
  measures.periodMeanMs = round1(mean);
  check(
    'the real period of a changing node is 1 s +/- 10 %',
    mean >= 900 && mean <= 1100,
    `${round1(mean)} ms`,
  );
  check(
    'all 500 Tags GOOD on every client',
    clients.every((c) => ids.every((id) => c.get(id)?.quality === 'GOOD')),
  );
  check('RSS <= 150 MB (Constitution III)', rssMax <= 150 * 1048576, `${measures.rssMaxMB} MB`);
  for (const c of clients) c.close();
}

// -------------------------------------------------------------------------------------- main

try {
  if (scenario === 'read') await runRead();
  else if (scenario === 'write') await runWrite();
  else if (scenario === 'errors') await runErrors();
  else if (scenario === 'reconnect-before') await runReconnectBefore();
  else if (scenario === 'reconnect-down') await runReconnectDown();
  else if (scenario === 'reconnect-up') await runReconnectUp();
  else if (scenario === 'security') await runSecurity();
  else if (scenario === 'load') await runLoad();
  else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  check(`scenario ${scenario} ran to its end`, false, e?.stack ?? e);
}
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario, checks, measures, pass }));
process.exit(pass ? 0 : 1);
