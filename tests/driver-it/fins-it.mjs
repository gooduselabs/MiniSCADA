// Scenarios of the Omron FINS integration tests (feature 018, T051). Runs in the Node container of
// tests/driver-it/compose-fins.yaml, started by tools/driver-it.ps1 (-Scenario fins-*), and prints one
// JSON object: { scenario, checks: [{ name, pass, detail }], measures, pass }.
//
//   node fins-it.mjs fins-read|fins-endcode|fins-loss|fins-write --fp <fingerprint>   (project fins-all-types)
//   node fins-it.mjs fins-load --seconds 60 --clients 10 --fp <fp>                     (project bench-500-fins)
//
// The runtime is `rt`, the simulator `fins-sim` (FINS/UDP and FINS/TCP on 9600, control API on 9601).
// Passwords come from the environment (MAT_IT_PW_*), as for driver-it.mjs.
import { readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { login, pinnedRequest, pinnedWebSocket } from '../../tools/measure/device-api.mjs';
import { EXPECT, idOf } from './fins-expect.mjs';

const BASE = 'https://rt:8443';
const SIM = 'http://fins-sim:9601';
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

// ---------------------------------------------------------------------------------- simulator

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
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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
const simLog = async (since = 0) => (await simCall('GET', `/log?since=${since}`)).entries;
const simMem = async (area, address, count = 1) =>
  (await simCall('GET', `/mem?area=${area}&address=${address}&count=${count}`)).values;

// ------------------------------------------------------------------------------- API, live

const tokens = {};
async function token(user) {
  if (tokens[user]) return tokens[user];
  const r = await login(BASE, fp, user, process.env[`MAT_IT_PW_${user.toUpperCase()}`]);
  if (r.status !== 200) throw new Error(`login ${user}: ${r.status} ${r.body}`);
  tokens[user] = r.json.token;
  return tokens[user];
}
const api = async (user, method, path, body) =>
  pinnedRequest(BASE, fp, method, path, { token: user ? await token(user) : undefined, body });

let uuidN = Date.now() % 1e9;
function uuid() {
  uuidN++;
  const h = (x, w) => x.toString(16).padStart(w, '0');
  const r = (n) => Math.floor(Math.random() * n);
  return `${h(uuidN, 8)}-${h(r(0xffff), 4)}-4${h(r(0xfff), 3)}-8${h(r(0xfff), 3)}-${h(r(0xffffffff), 8)}${h(uuidN & 0xffff, 4)}`;
}

/** Writes one value and polls its result until it is final. */
async function writeAndWait(user, tag, value, maxMs = 20000) {
  let id = uuid();
  let t0 = now();
  let post = await api(user, 'POST', '/api/v1/tags/write', {
    requests: [{ requestId: id, tag, value }],
  });
  let final = post.json?.results?.[0];
  // the burst of the session may be spent by the scenario itself: wait as told (a new command id)
  for (let i = 0; i < 3 && final?.reason === 'RATE_LIMITED'; i++) {
    await sleep((final.retryAfterMs ?? 3000) + 100);
    id = uuid();
    t0 = now();
    post = await api(user, 'POST', '/api/v1/tags/write', {
      requests: [{ requestId: id, tag, value }],
    });
    final = post.json?.results?.[0];
  }
  if (post.status !== 200 || final?.status !== 'ACCEPTED') return { final, ms: now() - t0 };
  while (now() - t0 < maxMs) {
    await sleep(150);
    const r = await api(user, 'GET', `/api/v1/tags/write/${id}`);
    final = r.json?.results?.[0] ?? final;
    if (final.status !== 'ACCEPTED') break;
  }
  return { final, ms: now() - t0 };
}

class Live {
  constructor(ids) {
    this.ids = ids;
    this.tags = new Map();
    this.order = [];
    this.gaps = 0;
    this.lastSeq = 0;
    this.changeLog = [];
    this.everBad = new Map(); // id -> reasons seen
  }
  async open() {
    this.ws = await pinnedWebSocket(BASE, fp, await token('kysu1'));
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
    while (!this.order.length && now() - t0 < 10000) await sleep(20);
    if (!this.order.length) throw new Error('no snapshot');
    return this;
  }
  onMessage(m) {
    if (m.type === 'snapshot') {
      this.order = m.tags.map((t) => t.id);
      for (const t of m.tags)
        this.tags.set(t.id, { value: t.value, quality: t.quality, reason: t.reason ?? '' });
      this.lastSeq = m.sequence;
    } else if (m.type === 'delta') {
      if (m.sequence !== this.lastSeq + 1) this.gaps++;
      this.lastSeq = m.sequence;
      const at = now();
      for (const e of m.tags) {
        const id = this.order[e[0]];
        const prev = this.tags.get(id);
        this.tags.set(id, { value: e[1], quality: e[2], reason: e[3] ?? '' });
        if (e[2] === 'BAD') {
          if (!this.everBad.has(id)) this.everBad.set(id, new Set());
          this.everBad.get(id).add(e[3] ?? '');
        }
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
  close() {
    clearInterval(this.beat);
    try {
      this.ws.close();
    } catch {
      // closed
    }
  }
}

const projectTags = (dir) =>
  JSON.parse(readFileSync(`/src/tests/driver-it/projects/${dir}/tags.json`, 'utf8')).tags;
const same = (a, b) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b))
    : a === b;
const allIds = () => projectTags('fins-all-types').map((t) => t.id);

async function diag() {
  const r = await api('xem1', 'GET', '/api/v1/drivers/diagnostics');
  if (r.status !== 200) throw new Error(`drivers/diagnostics ${r.status}`);
  const byId = Object.fromEntries(r.json.channels.map((c) => [c.id, c]));
  return { json: r.json, udp: byId.udp1, tcp: byId.tcp1 };
}

// ---------------------------------------------------------------------------------- fins-read

async function runRead() {
  const live = await new Live(allIds()).open();
  const want = [];
  for (const prefix of ['U', 'T']) {
    for (const [address, [, value]] of Object.entries(EXPECT))
      want.push([idOf(prefix, address), value]);
    want.push([`${prefix}.SCALED`, 50]);
  }
  const t0 = now();
  for (const [id] of want) await live.waitFor(id, (t) => t.quality === 'GOOD', 15000);
  measures.firstGoodMs = now() - t0;
  let ok = 0;
  for (const [id, value] of want) {
    const t = live.get(id);
    const match = t && t.quality === 'GOOD' && same(t.value, value);
    if (match) ok++;
    else check(`value of ${id}`, false, `got ${JSON.stringify(t)} want ${JSON.stringify(value)}`);
  }
  measures.tagsChecked = want.length;
  measures.tagsMatching = ok;
  check(
    '100 % of the Tags match the simulator over FINS/UDP and FINS/TCP',
    ok === want.length,
    `${ok}/${want.length}`,
  );
  // the simulator saw both kinds of read over both transports
  const log = await simLog(0);
  const kinds = new Set(log.map((e) => `${e.transport}:${e.command}`));
  measures.commandKinds = [...kinds].sort();
  for (const k of ['udp:0101', 'udp:0104', 'tcp:0101', 'tcp:0104'])
    check(`the simulator got ${k}`, kinds.has(k));
  const d = await diag();
  check(
    'diagnostics: both channels connected, kind fins',
    d.udp?.state === 'connected' && d.tcp?.state === 'connected' && d.udp.kind === 'fins',
    JSON.stringify([d.udp?.state, d.tcp?.state, d.udp?.kind]),
  );
  live.close();
}

// ------------------------------------------------------------------------------- fins-endcode

async function runEndCode() {
  const live = await new Live(allIds()).open();
  const good = await live.waitFor('E.D19995', (t) => t.quality === 'GOOD', 20000);
  const bad = await live.waitFor('E.D20001', (t) => t.reason === 'FINS_ADDRESS', 20000);
  check(
    'a Tag past the end of the DM is BAD FINS_ADDRESS (1103)',
    bad,
    JSON.stringify(live.get('E.D20001')),
  );
  check(
    'its neighbour of the same block is GOOD after the split',
    good && good.value === 99,
    JSON.stringify(live.get('E.D19995')),
  );
  let d = await diag();
  const ex = d.udp.devices[0].exceptions;
  check(
    'diagnostics count the end code 1103 by its four digits',
    (ex['1103'] ?? 0) >= 1,
    JSON.stringify(ex),
  );
  // an end code of the PLC mode on the TCP channel: its Tags BAD FINS_MODE, then GOOD again
  await live.waitFor('T.D100', (t) => t.quality === 'GOOD', 10000);
  await simFault({ kind: 'endCode', endCode: '2203', transport: 'tcp', command: '0101', count: 2 });
  const mode = await live.waitFor('T.D100', (t) => t.reason === 'FINS_MODE', 8000);
  check('end code 2203 (PROGRAM mode) gives FINS_MODE', mode, JSON.stringify(live.get('T.D100')));
  const back = await live.waitFor('T.D100', (t) => t.quality === 'GOOD', 10000);
  check('the Tags are GOOD again at the next good answer', back);
  check('the UDP channel kept its Tags GOOD meanwhile', !live.everBad.has('U.D100'));
  d = await diag();
  check(
    'the TCP channel stays connected (an end code is an answer)',
    d.tcp.state === 'connected',
    d.tcp.state,
  );
  live.close();
}

// ---------------------------------------------------------------------------------- fins-loss

async function runLoss() {
  const live = await new Live(allIds()).open();
  await live.waitFor('U.D100', (t) => t.quality === 'GOOD', 15000);
  await sleep(1500);
  let d0 = await diag();
  const t0 = d0.udp.devices[0].timeouts;
  const mark = (await simLog()).at(-1)?.seq ?? 0;
  // one lost datagram: sent again with a new SID, no Tag turns BAD
  await simFault({ kind: 'silent', transport: 'udp', command: '0101', count: 1 });
  await sleep(3000);
  const log = (await simLog(mark)).filter((e) => e.transport === 'udp' && e.command === '0101');
  let resent = false;
  for (let i = 1; i < log.length; i++)
    if (
      log[i - 1].result === 'silent' &&
      log[i].address === log[i - 1].address &&
      log[i].sid !== log[i - 1].sid
    )
      resent = true;
  check(
    'a lost datagram is sent again at once with a new SID',
    resent,
    JSON.stringify(log.slice(0, 4)),
  );
  check(
    'no UDP Tag turned BAD for one lost datagram',
    ![...live.everBad.keys()].some((k) => k.startsWith('U.')),
    JSON.stringify([...live.everBad.keys()]),
  );
  let d = await diag();
  check(
    'diagnostics: one timeout more',
    d.udp.devices[0].timeouts - t0 === 1,
    `${d.udp.devices[0].timeouts - t0}`,
  );
  // a late answer (after the 500 ms timeout): dropped by its SID, counted
  const tid0 = d.udp.devices[0].badFrames.tid;
  await simFault({ kind: 'late', delayMs: 800, transport: 'udp', command: '0101', count: 1 });
  await sleep(4000);
  d = await diag();
  check(
    'a late answer is dropped by its SID and counted',
    d.udp.devices[0].badFrames.tid - tid0 >= 1,
    `${d.udp.devices[0].badFrames.tid - tid0}`,
  );
  check('still no UDP Tag BAD', ![...live.everBad.keys()].some((k) => k.startsWith('U.')));
  // the PLC stops answering on UDP: TIMEOUT within 2 cycles + the timeouts, GOOD again after
  const tStop = now();
  await simFault({ kind: 'silent', transport: 'udp', count: 1000000 });
  const bad = await live.waitFor('U.D100', (t) => t.quality === 'BAD', 8000);
  measures.badMs = now() - tStop;
  check(
    'no answer: the UDP Tags turn BAD with TIMEOUT or DISCONNECTED',
    bad && ['TIMEOUT', 'DISCONNECTED'].includes(bad.reason),
    JSON.stringify(bad),
  );
  check('the TCP Tags stay GOOD', live.get('T.D100')?.quality === 'GOOD');
  await simClear();
  const tBack = now();
  const good = await live.waitFor('U.D100', (t) => t.quality === 'GOOD', 40000);
  measures.goodMs = now() - tBack;
  check('answers again: GOOD within the backoff (<= 32 s)', good, `${measures.goodMs} ms`);
  live.close();
}

// ---------------------------------------------------------------------------------- fins-write

async function runWrite() {
  const live = await new Live(allIds()).open();
  await live.waitFor('WU.I16', (t) => t.quality === 'GOOD', 15000);
  await live.waitFor('WT.I16', (t) => t.quality === 'GOOD', 15000);
  const cases = [
    ['I16', -321, (b) => simMem('D', b).then((v) => v[0] === 65215)],
    ['BIT', true, (b) => simMem('W', b / 100 + 10).then((v) => (v[0] & 0x80) !== 0)],
    ['BCD', 4321, (b) => simMem('D', b + 10).then((v) => v[0] === 0x4321)],
    ['F32', 2.5, (b) => simMem('D', b + 20, 2).then((v) => v[0] === 0 && v[1] === 0x4020)],
    ['U32', 3000000000, (b) => simMem('E1', b, 2).then((v) => v[0] === 0x5e00 && v[1] === 0xb2d0)],
    [
      'STR',
      'Van 2',
      (b) =>
        simMem('D', b + 30, 4).then((v) => v[0] === 0x5661 && v[1] === 0x6e20 && v[2] === 0x3200),
    ],
  ];
  for (const [prefix, base] of [
    ['WU', 300],
    ['WT', 400],
  ])
    for (const [name, value, inSim] of cases) {
      const tag = `${prefix}.${name}`;
      const r = await writeAndWait('vh1', tag, value);
      const confirmed =
        r.final?.status === 'CONFIRMED' ||
        r.final?.result === 'CONFIRMED' ||
        r.final?.code === 'CONFIRMED';
      check(
        `write ${tag} = ${JSON.stringify(value)} is confirmed`,
        confirmed,
        JSON.stringify(r.final),
      );
      check(`the simulator holds ${tag}`, await inSim(base));
      const t = await live.waitFor(tag, (x) => same(x.value, value), 5000);
      check(`the live value of ${tag} follows`, t, JSON.stringify(live.get(tag)));
    }
  // the PLC refuses: end code 2101 -> DEVICE_EXCEPTION, sent once
  const mark = (await simLog()).at(-1)?.seq ?? 0;
  await simFault({ kind: 'endCode', endCode: '2101', command: '0102', count: 1 });
  const r = await writeAndWait('vh1', 'WU.I16', 77);
  check(
    'an end code on a write is DEVICE_EXCEPTION',
    JSON.stringify(r.final).includes('DEVICE_EXCEPTION'),
    JSON.stringify(r.final),
  );
  const writes = (await simLog(mark)).filter((e) => e.command === '0102');
  check('the refused write was sent once', writes.length === 1, `${writes.length}`);
  measures.writes = cases.length * 2 + 1;
  live.close();
}

// ---------------------------------------------------------------------------------- fins-load

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

async function runLoad() {
  const seconds = Number(opt('--seconds', '60'));
  const nClients = Number(opt('--clients', '10'));
  const ids = projectTags('bench-500-fins').map((t) => t.id);
  const clients = [];
  for (let i = 0; i < nClients; i++) clients.push(await new Live(ids).open());
  const pid = runtimePid();
  const stat = () => {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return Number(s[11]) + Number(s[12]);
  };
  const rss = () =>
    Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) * 1024;
  const hz = 100;
  await sleep(3000);
  const mark = (await simLog()).at(-1)?.seq ?? 0;
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
    samples.push(((c - lastCpu) / hz / ((t - lastT) / 1000)) * 100);
    lastCpu = c;
    lastT = t;
  }
  const secs = (now() - t0) / 1000;
  const log = await simLog(mark);
  measures.seconds = round1(secs);
  measures.clients = nClients;
  measures.tags = ids.length;
  measures.cpuPercentOneCoreAvg = round1(((stat() - cpu0) / hz / secs) * 100);
  measures.cpuPercentOneCoreMax5s = round1(Math.max(...samples));
  measures.rssMaxMB = round1(rssMax / 1048576);
  measures.commandsPerSecond = round1(log.length / secs);
  measures.byCommand = log.reduce((m, e) => ((m[e.command] = (m[e.command] ?? 0) + 1), m), {});
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
    'the real period of a Tag is 1 s +/- 10 %',
    mean >= 900 && mean <= 1100,
    `${round1(mean)} ms`,
  );
  // 250 in one 0101, 250 scattered in 0104 of 64 items: 1 + 4 commands a second
  check(
    '500 Tags take 5 commands a round (one 0101, four 0104)',
    measures.commandsPerSecond <= 5.5,
    `${measures.commandsPerSecond}/s ${JSON.stringify(measures.byCommand)}`,
  );
  check(
    'all 500 Tags GOOD on every client',
    clients.every((c) => ids.every((id) => c.get(id)?.quality === 'GOOD')),
  );
  for (const c of clients) c.close();
}

try {
  if (scenario === 'fins-read') await runRead();
  else if (scenario === 'fins-endcode') await runEndCode();
  else if (scenario === 'fins-loss') await runLoss();
  else if (scenario === 'fins-write') await runWrite();
  else if (scenario === 'fins-load') await runLoad();
  else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  check(`scenario ${scenario} ran to its end`, false, e?.stack ?? e);
}
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario, checks, measures, pass }));
process.exit(pass ? 0 : 1);
