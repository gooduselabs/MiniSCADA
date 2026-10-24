// Scenarios of the S7 driver integration tests (feature 016 T021, specs/016-driver-s7/spec.md US1-US3).
// Runs in the Node container of tests/driver-it-s7/compose.yaml, started by tools/driver-it-s7.ps1,
// and prints one JSON object: { scenario, checks: [{ name, pass, detail }], measures, pass }.
//
//   node s7-it.mjs read|write|reconnect|errors|small-pdu --fp <fingerprint>
//   node s7-it.mjs load --seconds 60 --clients 10 --fp <fp>          (project bench-500-s7)
//
// Passwords come from the environment (MAT_IT_PW_ADMIN, _KYSU1, _VH1). The runtime is `rt`, the
// simulator `sim` (control API on :1503). Same helpers as tests/driver-it/driver-it.mjs (pinned HTTPS,
// live channel as an engineer).
import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { login, pinnedRequest, pinnedWebSocket } from '../../tools/measure/device-api.mjs';

const BASE = 'https://rt:8443';
const LIVE_USER = 'kysu1';
const SIM = 'http://sim:1503';

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

// ------------------------------------------------------------------------------------ simulator

function simCall(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      `${SIM}${path}`,
      {
        method,
        headers: data
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(text ? JSON.parse(text) : {});
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const simFault = (f) => simCall('POST', '/fault', f);
const simClear = () => simCall('DELETE', '/fault');
const simMem = async (area, byte, count) =>
  (await simCall('GET', `/mem?area=${area}&byte=${byte}&count=${count}`)).hex;
const simCounters = () => simCall('GET', '/counters');

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
  return JSON.parse(readFileSync(`/src/tests/driver-it-s7/projects/${dir}/tags.json`, 'utf8')).tags;
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
  return r.json.channels.find((c) => c.id === 's7-1');
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

const EXPECT = {
  'S7.DB_BOOL': true,
  'S7.DB_BOOL5': false,
  'S7.DB_BYTE': 200,
  'S7.DB_INT': -1234,
  'S7.DB_WORD': 64302,
  'S7.DB_DINT': -100000,
  'S7.DB_DWORD': 4000000000,
  'S7.DB_REAL': Math.fround(123.456),
  'S7.DB_LREAL': 3.141592653589793,
  'S7.DB_CHAR': 'A',
  'S7.DB_CHARS': 'OK',
  'S7.DB_STRING': 'Bom 1',
  'S7.DB2_INT': 42,
  'S7.M_BOOL': true,
  'S7.M_WORD': 4660,
  'S7.M_REAL': -1.5,
  'S7.I_BOOL': true,
  'S7.I_WORD': 100,
  'S7.Q_BOOL': true,
  'S7.Q_BYTE': 7,
};
const REFUSED = {
  'S7.DENIED': 'S7_ACCESS_DENIED',
  'S7.NO_DB': 'S7_OBJECT_NOT_FOUND',
  'S7.OUT_OF_RANGE': 'S7_ADDRESS_OUT_OF_RANGE',
};
// 9 significant digits on the live channel for a double (as driver-it)
const same = (a, b) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(b))
    : a === b;
const allIds = () => projectTags('read-all-types-s7').map((t) => t.id);
const goodIds = () => allIds().filter((id) => !(id in REFUSED));

async function checkValues(live, label) {
  const ids = Object.keys(EXPECT);
  for (const id of ids) await live.waitFor(id, (t) => t.quality === 'GOOD', 12000);
  let ok = 0;
  for (const id of ids) {
    const t = live.get(id);
    const match = t && t.quality === 'GOOD' && same(t.value, EXPECT[id]);
    if (match) ok++;
    else check(`${label}: value of ${id}`, false, `got ${JSON.stringify(t)} want ${EXPECT[id]}`);
  }
  check(
    `${label}: 100 % of the Tags match the simulator`,
    ok === ids.length,
    `${ok}/${ids.length}`,
  );
  return ok;
}

// ------------------------------------------------------------------------------------- read

async function runRead() {
  const live = await new Live(allIds()).open();
  const t0 = now();
  measures.tagsMatching = await checkValues(live, 'read');
  measures.firstGoodMs = now() - t0;
  const d = await diag();
  check(
    'diagnostics: kind s7, connected',
    d?.kind === 's7' && d?.state === 'connected',
    JSON.stringify(d?.state),
  );
  check(
    'diagnostics: negotiated PDU 480 (asked 960)',
    d?.details?.pduSize === '480',
    JSON.stringify(d?.details),
  );
  const c = await simCounters();
  measures.sim = {
    requests: c.requests,
    items: c.items,
    maxRequestPdu: c.maxRequestPdu,
    maxResponsePdu: c.maxResponsePdu,
  };
  check(
    'every request within the PDU',
    c.maxRequestPdu <= 480 && c.maxResponsePdu <= 480,
    JSON.stringify(measures.sim),
  );
  check('no protocol error at the simulator', c.errors === 0, String(c.errors));
  live.close();
}

// ------------------------------------------------------------------------------------- write

async function runWrite() {
  const live = await new Live(allIds()).open();
  await live.waitAll(goodIds(), (t) => t.quality === 'GOOD', 12000);
  const cases = [
    ['S7.W_BOOL', true, 'DB1', 60, 1, '01'],
    ['S7.W_INT', -1234, 'DB1', 62, 2, 'FB 2E'],
    ['S7.W_REAL', 1.5, 'DB1', 64, 4, '3F C0 00 00'],
    ['S7.W_STRING', 'Van 2', 'DB1', 70, 7, '0A 05 56 61 6E 20 32'],
    ['S7.W_BYTE', 255, 'DB1', 84, 1, 'FF'],
    ['S7.W_DINT', -100000, 'DB1', 86, 4, 'FF FE 79 60'],
    ['S7.W_LREAL', 2.5, 'DB1', 90, 8, '40 04 00 00 00 00 00 00'],
    ['S7.Q_BYTE', 9, 'Q', 1, 1, '09'],
    ['S7.Q_BOOL', false, 'Q', 0, 1, '00'],
  ];
  const ms = [];
  for (const [tag, value, area, byte, count, hex] of cases) {
    const r = await writeAndWait('vh1', tag, value);
    ms.push(r.ms ?? 0);
    const mem = await simMem(area, byte, count);
    check(
      `write ${tag} = ${JSON.stringify(value)}: CONFIRMED`,
      r.final?.status === 'CONFIRMED',
      JSON.stringify(r.final),
    );
    check(`write ${tag}: simulator memory ${hex}`, mem === hex, mem);
    const seen = await live.waitFor(tag, (t) => same(t.value, value), 3000);
    check(`write ${tag}: live value`, Boolean(seen), JSON.stringify(live.get(tag)));
  }
  measures.writeMsMax = Math.max(...ms);
  // limits are checked before the driver: nothing reaches the simulator
  const before = (await simCounters()).byFunction?.write ?? 0;
  const out = await writeAndWait('vh1', 'S7.W_INT', 31000);
  const after = (await simCounters()).byFunction?.write ?? 0;
  check(
    'write beyond limits refused before the PLC',
    out.final?.status !== 'CONFIRMED' && after === before,
    JSON.stringify(out.final),
  );
  const rows = await api('admin', 'GET', '/api/v1/audit?action=tag.write&target=S7.W_INT&limit=50');
  const done = (rows.json?.records ?? []).filter(
    (x) => x.result === 'CONFIRMED' || x.result === 'confirmed' || x.code === 'CONFIRMED',
  );
  check(
    'audit: tag.write rows for S7.W_INT',
    (rows.json?.records ?? []).length >= 2,
    `${(rows.json?.records ?? []).length} rows, ${done.length} confirmed`,
  );
  live.close();
}

// --------------------------------------------------------------------------------- reconnect

async function runReconnect() {
  const ids = goodIds();
  const live = await new Live(allIds()).open();
  await live.waitAll(ids, (t) => t.quality === 'GOOD', 12000);
  const pid = runtimePid();
  const rounds = [
    ['close', { kind: 'close' }],
    ['silent', { kind: 'silent' }],
    ['refuse', { kind: 'refuse' }],
  ];
  const out = {};
  for (const [name, fault] of rounds) {
    await simFault(fault);
    const badMs = await live.waitAll(ids, (t) => t.quality === 'BAD', 6000);
    const reasons = [...new Set(ids.map((id) => live.get(id)?.reason))];
    await simClear();
    const goodMs = await live.waitAll(ids, (t) => t.quality === 'GOOD', 15000);
    out[name] = { badMs, goodMs, reasons };
    check(
      `${name}: every Tag BAD with a reason within 2 cycles + timeout`,
      badMs >= 0 && badMs <= 2500 && reasons.every(Boolean),
      JSON.stringify(out[name]),
    );
    check(
      `${name}: every Tag GOOD again within 12 s`,
      goodMs >= 0 && goodMs <= 12000,
      `${goodMs} ms`,
    );
  }
  measures.rounds = out;
  check('the runtime did not restart', runtimePid() === pid, `${pid} -> ${runtimePid()}`);
  const d = await diag();
  measures.reconnects = d?.reconnects;
  check('diagnostics count the reconnections', (d?.reconnects ?? 0) >= 3, String(d?.reconnects));
  live.close();
}

// ------------------------------------------------------------------------------------ errors

async function runErrors() {
  const live = await new Live(allIds()).open();
  for (const [id, reason] of Object.entries(REFUSED)) {
    const t = await live.waitFor(id, (x) => x.reason === reason, 12000);
    check(`${id} BAD ${reason}`, t?.quality === 'BAD', JSON.stringify(live.get(id)));
  }
  await live.waitAll(goodIds(), (t) => t.quality === 'GOOD', 12000);
  check(
    'the other Tags stay GOOD',
    goodIds().every((id) => live.get(id)?.quality === 'GOOD'),
  );
  await simFault({ kind: 'putget' });
  const ms = await live.waitAll(goodIds(), (t) => t.reason === 'S7_FUNCTION_NOT_AVAILABLE', 5000);
  check('PUT/GET off: every Tag BAD S7_FUNCTION_NOT_AVAILABLE', ms >= 0, `${ms} ms`);
  const d = await diag();
  check(
    'diagnostics: last error S7_FUNCTION_NOT_AVAILABLE, exception 8104',
    d?.lastError?.code === 'S7_FUNCTION_NOT_AVAILABLE' &&
      (d?.devices?.[0]?.exceptions?.['8104'] ?? 0) > 0,
    JSON.stringify({ lastError: d?.lastError, exceptions: d?.devices?.[0]?.exceptions }),
  );
  await simClear();
  const back = await live.waitAll(goodIds(), (t) => t.quality === 'GOOD', 5000);
  check('PUT/GET on again: GOOD without a new connection', back >= 0, `${back} ms`);
  measures.exceptions = d?.devices?.[0]?.exceptions;
  live.close();
}

// --------------------------------------------------------------------------------- small PDU

async function runSmallPdu() {
  const live = await new Live(allIds()).open();
  measures.tagsMatching = await checkValues(live, 'small PDU');
  const d = await diag();
  check(
    'negotiated PDU 240 (project asks 960)',
    d?.details?.pduSize === '240',
    JSON.stringify(d?.details),
  );
  const c = await simCounters();
  measures.sim = {
    requests: c.requests,
    maxRequestPdu: c.maxRequestPdu,
    maxResponsePdu: c.maxResponsePdu,
    errors: c.errors,
  };
  check(
    'every request and answer within 240 bytes',
    c.maxRequestPdu <= 240 && c.maxResponsePdu <= 240,
    JSON.stringify(measures.sim),
  );
  check('no request refused by the simulator', c.errors === 0, String(c.errors));
  live.close();
}

// -------------------------------------------------------------------------------------- load

async function runLoad() {
  const seconds = Number(opt('--seconds', '60'));
  const nClients = Number(opt('--clients', '10'));
  const ids = projectTags('bench-500-s7').map((t) => t.id);
  const clients = [];
  for (let i = 0; i < nClients; i++) clients.push(await new Live(ids).open());
  const pid = runtimePid();
  const stat = () => {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return Number(s[11]) + Number(s[12]);
  };
  const rss = () =>
    Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) * 1024;
  await sleep(3000);
  const c0 = await simCounters();
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
  const c1 = await simCounters();
  measures.seconds = round1(secs);
  measures.clients = nClients;
  measures.tags = ids.length;
  measures.cpuPercentOneCoreAvg = round1(((stat() - cpu0) / 100 / secs) * 100);
  measures.cpuPercentOneCoreMax5s = round1(Math.max(...samples));
  measures.rssMaxMB = round1(rssMax / 1048576);
  measures.readRequestsPerSecond = round1(
    ((c1.byFunction?.read ?? 0) - (c0.byFunction?.read ?? 0)) / secs,
  );
  measures.maxRequestPdu = c1.maxRequestPdu;
  measures.maxResponsePdu = c1.maxResponsePdu;
  const gaps = clients.reduce((n, c) => n + c.gaps, 0);
  measures.sequenceGaps = gaps;
  check('no lost sequence on any client', gaps === 0, `${gaps} gaps`);
  const periods = [];
  for (const c of clients) {
    const last = new Map();
    for (const ch of c.changeLog) {
      if (!ch.id.startsWith('B.INT')) continue;
      const p = last.get(ch.id);
      if (p !== undefined) periods.push(ch.serverTs - p);
      last.set(ch.id, ch.serverTs);
    }
  }
  const mean = periods.reduce((a, b) => a + b, 0) / Math.max(1, periods.length);
  measures.periodMeanMs = round1(mean);
  check(
    'the real period of an animated Tag is 1 s +/- 10 %',
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
  else if (scenario === 'reconnect') await runReconnect();
  else if (scenario === 'errors') await runErrors();
  else if (scenario === 'small-pdu') await runSmallPdu();
  else if (scenario === 'load') await runLoad();
  else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  check(`scenario ${scenario} ran to its end`, false, e?.stack ?? e);
}
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario, checks, measures, pass }));
process.exit(pass ? 0 : 1);
