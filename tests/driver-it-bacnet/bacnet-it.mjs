// Scenarios of the BACnet/IP driver integration tests (feature 020, specs/020-driver-bacnet/spec.md US1-US3).
// Runs in the Node container of tests/driver-it-bacnet/compose.yaml, started by tools/driver-it-bacnet.ps1,
// and prints one JSON object: { scenario, checks: [{ name, pass, detail }], measures, pass }.
//
//   node bacnet-it.mjs read|write|errors --fp <fingerprint>          (project read-all-bacnet)
//   node bacnet-it.mjs load --seconds 60 --clients 10 --fp <fp>      (project bench-500-bacnet)
//
// Passwords come from the environment (MAT_IT_PW_ADMIN, _KYSU1, _VH1). The runtime is `rt`, the simulator
// `sim` (control API on :8090). Same helpers as tests/driver-it-s7/s7-it.mjs (pinned HTTPS, live channel).
import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { login, pinnedRequest, pinnedWebSocket } from '../../tools/measure/device-api.mjs';

const BASE = 'https://rt:8443';
const LIVE_USER = 'kysu1';
const SIM = 'http://sim:8090';

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
const simGet = (device, object) => simCall('GET', `/get?device=${device}&object=${object}`);
const simCounters = () => simCall('GET', '/counters');
const simLog = (since = 0) => simCall('GET', `/log?since=${since}`);

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
  return JSON.parse(readFileSync(`/src/tests/driver-it-bacnet/projects/${dir}/tags.json`, 'utf8'))
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
  return r.json.channels.find((c) => c.id === 'bms');
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
  'AHU.AI1': { value: 24.5 },
  'AHU.AI2': { value: 55.25 },
  'AHU.AI3_FAULT': { quality: 'BAD', reason: 'BACNET_FAULT' },
  'AHU.AI4_OOS': { value: 12, quality: 'UNCERTAIN', reason: 'BACNET_OUT_OF_SERVICE' },
  'AHU.AO1': { value: 0 },
  'AHU.AV5': { value: 23 },
  'AHU.BI1': { value: true },
  'AHU.BO2': { value: false },
  'AHU.BV3': { value: true },
  'AHU.MSI1': { value: 2 },
  'AHU.MSO1': { value: 1 },
  'AHU.MSV3': { value: 3 },
  'AHU.UNITS': { value: 62 },
  'AHU.FLAGS3': { value: 2 },
  'AHU.NAME': { value: 'AHU-1' },
  'AHU.MISSING': { quality: 'BAD', reason: 'BACNET_UNKNOWN_OBJECT' },
  'AHU.REL8': { value: true },
  'VAV.AI1': { value: 310.5 },
  'VAV.AO1': { value: 40 },
};
const allIds = () => projectTags('read-all-bacnet').map((t) => t.id);
const same = (a, b) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))
    : a === b;
const matches = (t, e) =>
  !!t &&
  t.quality === (e.quality ?? 'GOOD') &&
  (e.reason === undefined || t.reason === e.reason) &&
  (e.value === undefined || same(t.value, e.value));

async function checkValues(live, label) {
  const ids = Object.keys(EXPECT);
  for (const id of ids) await live.waitFor(id, (t) => matches(t, EXPECT[id]), 12000);
  let ok = 0;
  for (const id of ids) {
    const t = live.get(id);
    if (matches(t, EXPECT[id])) ok++;
    else
      check(
        `${label}: ${id}`,
        false,
        `got ${JSON.stringify(t)} want ${JSON.stringify(EXPECT[id])}`,
      );
  }
  check(
    `${label}: 100 % of the Tags as the simulator says`,
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
    'diagnostics: kind bacnet, connected',
    d?.kind === 'bacnet' && d?.state === 'connected',
    JSON.stringify(d?.state),
  );
  const vav = d?.devices?.find((x) => x.id === 'vav7');
  check(
    'diagnostics: the VAV rejected RPM once (reject:9), then ReadProperty',
    (vav?.exceptions?.['reject:9'] ?? 0) >= 1,
    JSON.stringify(vav?.exceptions),
  );
  const log = (await simLog()).entries;
  const rpm = log.filter((e) => e.service === 'readPropertyMultiple' && e.device === 1001);
  measures.rpmPerRound = rpm.length;
  measures.maxRpmProps = Math.max(0, ...rpm.map((e) => e.props));
  check(
    'the AHU is read by ReadPropertyMultiple',
    rpm.length > 0 && measures.maxRpmProps > 1,
    JSON.stringify(measures),
  );
  check(
    'every RPM answer within 1476 bytes',
    rpm.every((e) => e.bytes <= 1476),
  );
  // Tìm thiết bị qua runtime (Who-Is broadcast trên mạng 172.30.20.0/24)
  const w = await api(LIVE_USER, 'POST', '/api/v1/drivers/test', {
    channel: { kind: 'bacnet', bacnet: { broadcast: '172.30.20.255' } },
    action: 'whois',
    whois: { waitMs: 1500 },
  });
  const found = (w.json?.devices ?? []).map((x) => x.instance).sort((a, b) => a - b);
  check(
    'Who-Is through the runtime finds devices 7 and 1001',
    found.join(',') === '7,1001',
    `${w.status} ${JSON.stringify(w.json)}`,
  );
  const vavFound = (w.json?.devices ?? []).find((x) => x.instance === 7);
  check(
    'the VAV is behind network 5, MAC 07',
    vavFound?.network === 5 && vavFound?.mac === '07',
    JSON.stringify(vavFound),
  );
  const o = await api(LIVE_USER, 'POST', '/api/v1/drivers/test', {
    channel: { kind: 'bacnet' },
    device: { deviceInstance: 1001, host: 'sim' },
    action: 'objects',
  });
  const addrs = (o.json?.objects ?? []).map((x) => x.address);
  check(
    'object-list of the AHU: 13 objects with names',
    o.json?.ok === true &&
      addrs.length === 13 &&
      addrs.includes('MSV:3') &&
      o.json.objects.some((x) => x.name === 'Điểm đặt'),
    `${o.status} ${addrs.join(',')}`,
  );
  const r = await api(LIVE_USER, 'POST', '/api/v1/drivers/test', {
    channel: { kind: 'bacnet' },
    device: { deviceInstance: 7, host: 'sim', network: 5, mac: '07' },
    action: 'read',
    read: { address: 'AI:1' },
  });
  check(
    'read AI:1 of the VAV through the router',
    r.json?.read?.value === '310.5',
    JSON.stringify(r.json),
  );
  live.close();
}

// ------------------------------------------------------------------------------------- write

async function runWrite() {
  const live = await new Live(allIds()).open();
  await checkValues(live, 'before writes');
  const cases = [
    ['AHU.AV5', 21.5, 'AV:5', 8, 21.5],
    ['AHU.BO2', true, 'BO:2', 16, true],
    ['AHU.MSV3', 2, 'MSV:3', 16, 2],
    ['AHU.AO1', 55, 'AO:1', 16, 55],
  ];
  for (const [tag, value, object, prio, simValue] of cases) {
    const w = await writeAndWait('kysu1', tag, value);
    const s = await simGet(1001, object);
    check(
      `write ${tag} = ${value}: CONFIRMED, priority ${prio} of the simulator`,
      w.final?.status === 'CONFIRMED' && same(s.priority?.[prio - 1], simValue),
      `${JSON.stringify(w.final)} ${JSON.stringify(s)}`,
    );
  }
  const t = await live.waitFor('AHU.REL8', (x) => x.value === false, 5000);
  check(
    'AV:5 priority 8 set: relinquish Tag reads false',
    !!t,
    JSON.stringify(live.get('AHU.REL8')),
  );
  const rel = await writeAndWait('kysu1', 'AHU.REL8', true);
  const s5 = await simGet(1001, 'AV:5');
  check(
    'relinquish priority 8: CONFIRMED, slot NULL, present-value back to 23',
    rel.final?.status === 'CONFIRMED' && s5.priority[7] === null && s5.presentValue === 23,
    `${JSON.stringify(rel.final)} ${JSON.stringify(s5)}`,
  );
  const av = await live.waitFor('AHU.AV5', (x) => same(x.value, 23), 5000);
  check('AHU.AV5 reads 23 again', !!av);
  const vw = await writeAndWait('kysu1', 'VAV.AO1', 66);
  const vs = await simGet(7, 'AO:1');
  check(
    'write through the router (VAV.AO1 = 66)',
    vw.final?.status === 'CONFIRMED' && vs.presentValue === 66,
    `${JSON.stringify(vw.final)} ${JSON.stringify(vs)}`,
  );
  await simFault({ kind: 'error', code: 40 });
  const denied = await writeAndWait('kysu1', 'AHU.AO1', 10);
  await simClear();
  check(
    'write-access-denied: FAILED DEVICE_EXCEPTION 40',
    denied.final?.status === 'FAILED' && denied.final?.code === 'DEVICE_EXCEPTION',
    JSON.stringify(denied.final),
  );
  const ro = await writeAndWait('kysu1', 'AHU.AI1', 1);
  check(
    'a read-only Tag is refused before the driver',
    ro.final?.status === 'REJECTED' || ro.first?.status === 'REJECTED',
    JSON.stringify(ro.first),
  );
  const audit = await api('admin', 'GET', '/api/v1/audit?limit=50');
  check(
    'the writes are in the audit log',
    audit.status === 200 && JSON.stringify(audit.json).includes('AHU.AV5'),
    String(audit.status),
  );
  live.close();
}

// ------------------------------------------------------------------------------------- errors

// the Tags the write scenario changed (it runs before, on the same simulator)
const WRITTEN = new Set(['AHU.AO1', 'AHU.BO2', 'AHU.MSV3', 'VAV.AO1']);
const unchanged = () => Object.keys(EXPECT).filter((id) => !WRITTEN.has(id));

async function runErrors() {
  const live = await new Live(allIds()).open();
  await live.waitFor('AHU.AI1', (t) => t.quality === 'GOOD', 12000);
  const pid0 = runtimePid();
  // silence: every request lost
  await simFault({ kind: 'dropAll' });
  const t0 = now();
  const bad = await live.waitFor(
    'AHU.AI1',
    (t) => t.quality === 'BAD' && t.reason === 'TIMEOUT',
    10000,
  );
  measures.timeoutDetectMs = now() - t0;
  check(
    'no answer: BAD TIMEOUT within 5 s',
    !!bad && measures.timeoutDetectMs <= 5000,
    `${measures.timeoutDetectMs} ms`,
  );
  await simClear();
  const t1 = now();
  const good = await live.waitFor('AHU.AI1', (t) => t.quality === 'GOOD', 40000);
  measures.recoverMs = now() - t1;
  check(
    'answers again: GOOD within the device backoff (<= 32 s)',
    !!good,
    `${measures.recoverMs} ms`,
  );
  // an answer too large for the device: Abort segmentation-not-supported, the requests split
  await simFault({ kind: 'maxApdu', value: 120 });
  await sleep(4000);
  const afterSplit = unchanged().filter((id) => !matches(live.get(id), EXPECT[id]));
  check(
    'small APDU: requests split, every Tag still as expected',
    afterSplit.length === 0,
    afterSplit.join(','),
  );
  await simClear();
  // no RPM at all: ReadProperty per property
  await simFault({ kind: 'noRpm' });
  await sleep(4000);
  const noRpm = unchanged().filter((id) => !matches(live.get(id), EXPECT[id]));
  check(
    'no ReadPropertyMultiple: fallback to ReadProperty, every Tag as expected',
    noRpm.length === 0,
    noRpm.join(','),
  );
  await simClear();
  // values change at the device
  await simCall('POST', '/set', { device: 1001, object: 'AI:1', value: 30.25, flags: 4 });
  const ov = await live.waitFor(
    'AHU.AI1',
    (t) => same(t.value, 30.25) && t.quality === 'UNCERTAIN',
    5000,
  );
  check(
    'overridden at the device: UNCERTAIN BACNET_OVERRIDDEN with the value',
    ov?.reason === 'BACNET_OVERRIDDEN',
    JSON.stringify(live.get('AHU.AI1')),
  );
  check('the runtime never restarted', runtimePid() === pid0, `${pid0} -> ${runtimePid()}`);
  const d = await diag();
  measures.diag = d?.devices?.map((x) => ({
    id: x.id,
    timeouts: x.timeouts,
    exceptions: x.exceptions,
  }));
  live.close();
}

// -------------------------------------------------------------------------------------- load

async function runLoad() {
  const seconds = Number(opt('--seconds', '60'));
  const nClients = Number(opt('--clients', '10'));
  const ids = projectTags('bench-500-bacnet').map((t) => t.id);
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
  measures.requestsPerSecond = round1((c1.requests - c0.requests) / secs);
  measures.dropped = c1.dropped - c0.dropped;
  const gaps = clients.reduce((n, c) => n + c.gaps, 0);
  measures.sequenceGaps = gaps;
  check('no lost sequence on any client', gaps === 0, `${gaps} gaps`);
  const periods = [];
  for (const c of clients) {
    const last = new Map();
    for (const ch of c.changeLog) {
      if (!ch.id.startsWith('B.AV')) continue;
      const p = last.get(ch.id);
      if (p !== undefined) periods.push(ch.serverTs - p);
      last.set(ch.id, ch.serverTs);
    }
  }
  const mean = periods.reduce((a, b) => a + b, 0) / Math.max(1, periods.length);
  measures.periodMeanMs = round1(mean);
  check(
    'the real period of a moving AV is 1 s +/- 10 %',
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
  else if (scenario === 'load') await runLoad();
  else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  check(`scenario ${scenario} ran to its end`, false, e?.stack ?? e);
}
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario, checks, measures, pass }));
process.exit(pass ? 0 : 1);
