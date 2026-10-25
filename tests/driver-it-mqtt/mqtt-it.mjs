// Scenarios of the MQTT driver integration tests (feature 022, specs/022-driver-mqtt/spec.md SC-001, SC-002).
// Runs in the Node container of tests/driver-it-mqtt/compose.yaml, started by tools/driver-it-mqtt.ps1, and prints
// one JSON object: { scenario, checks: [{ name, pass, detail }], measures, pass }.
//
//   node mqtt-it.mjs read|write|reconnect|stale --fp <fingerprint>     (project mqtt-it)
//   node mqtt-it.mjs load --seconds 60 --clients 10 --rate 50 --fp <fp> (project bench-500-mqtt)
//
// Passwords come from the environment (MAT_IT_PW_ADMIN, _KYSU1, _VH1). The runtime is `rt`, the broker `sim`
// (mat-mqtt-sim; its control port 1880 takes one command per line). Same API helpers as the other driver rigs.
import { readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import { login, pinnedRequest, pinnedWebSocket } from '../../tools/measure/device-api.mjs';

const BASE = 'https://rt:8443';
const LIVE_USER = 'kysu1';

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

// ------------------------------------------------------------------------------- broker control

class Control {
  async open() {
    this.sock = net.connect(1880, 'sim');
    this.buf = '';
    this.waiting = [];
    this.sock.setEncoding('utf8');
    this.sock.on('data', (d) => {
      this.buf += d;
      this.drain();
    });
    await new Promise((res, rej) => {
      this.sock.once('connect', res);
      this.sock.once('error', rej);
    });
    return this;
  }
  drain() {
    while (this.waiting.length) {
      const w = this.waiting[0];
      const end = w.multi ? this.buf.indexOf('END\n') : this.buf.indexOf('\n');
      if (end < 0) return;
      const len = w.multi ? end + 4 : end + 1;
      const text = this.buf.slice(0, len);
      this.buf = this.buf.slice(len);
      this.waiting.shift();
      w.resolve(text.trimEnd());
    }
  }
  cmd(line, multi = false) {
    return new Promise((resolve) => {
      this.waiting.push({ resolve, multi });
      this.sock.write(`${line}\n`);
    });
  }
  pub(topic, payload, qos = 0, retain = false) {
    return this.cmd(`PUB ${qos} ${retain ? 1 : 0} ${topic} ${payload}`);
  }
  async received() {
    const text = await this.cmd('RECEIVED', true);
    return text
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));
  }
  close() {
    this.sock.end();
  }
}

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

class Live {
  constructor(ids) {
    this.ids = ids;
    this.tags = new Map();
    this.order = [];
    this.gaps = 0;
    this.lastSeq = 0;
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
      for (const e of m.tags)
        this.tags.set(this.order[e[0]], { value: e[1], quality: e[2], reason: e[3] ?? '' });
    }
  }
  get(id) {
    return this.tags.get(id);
  }
  async waitFor(id, pred, ms = 10000) {
    const t0 = now();
    while (now() - t0 < ms) {
      const t = this.tags.get(id);
      if (t && pred(t)) return now() - t0;
      await sleep(20);
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
  const id = uuid();
  const t0 = now();
  const post = await api(user, 'POST', '/api/v1/tags/write', {
    requests: [{ requestId: id, tag, value }],
  });
  const first = post.json?.results?.[0];
  if (post.status !== 200 || first?.status !== 'ACCEPTED') return { first, final: first, id };
  let final = first;
  while (now() - t0 < maxMs) {
    await sleep(100);
    const r = await api(user, 'GET', `/api/v1/tags/write/${id}`);
    final = r.json?.results?.[0] ?? final;
    if (final.status !== 'ACCEPTED') break;
  }
  return { first, final, id, ms: now() - t0 };
}

async function diag(id = 'mq') {
  const r = await api(LIVE_USER, 'GET', '/api/v1/drivers/diagnostics');
  if (r.status !== 200) throw new Error(`drivers/diagnostics ${r.status}`);
  return r.json.channels.find((c) => c.id === id);
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

const IDS = [
  'MQ.LEVEL',
  'MQ.TEMP',
  'MQ.ARR',
  'MQ.RUN',
  'MQ.NAME',
  'MQ.EVENTS',
  'MQ.DENIED',
  'MQ.STALE',
  'MQ.SP',
  'MQ.MODE',
  'TLS.V',
  'BAD.V',
];
const good = (v) => (t) => t.quality === 'GOOD' && (v === undefined || t.value === v);

// -------------------------------------------------------------------------------------- read

async function runRead(ctl) {
  const live = await new Live(IDS).open();
  check(
    'the channel is connected',
    (await live.waitFor('MQ.DENIED', (t) => t.reason === 'MQTT_SUBSCRIBE_REFUSED', 15000)) >= 0,
    JSON.stringify(live.get('MQ.DENIED')),
  );
  check('a filter the broker refuses: BAD MQTT_SUBSCRIBE_REFUSED', true);
  await ctl.pub('plant/tank1/level', '42.5');
  await ctl.pub('sensors/a7/data', '{"temp":19.25,"rh":40}', 1);
  await ctl.pub('sensors/t9', '{"values":[{"v":1},{"v":2},{"v":-7}]}');
  await ctl.pub('plant/pump1/run', 'ON');
  await ctl.pub('plant/name', 'Trạm bơm số 1');
  await ctl.pub('events/pump1/start', 'started');
  await ctl.pub('tls/v', '8.5', 0, true); // retained: the TLS channels may connect later
  const t0 = now();
  check('raw number: MQ.LEVEL = 42.5 GOOD', (await live.waitFor('MQ.LEVEL', good(42.5))) >= 0);
  check('JSON on a + filter: MQ.TEMP = 19.25', (await live.waitFor('MQ.TEMP', good(19.25))) >= 0);
  check('JSON array path: MQ.ARR = -7', (await live.waitFor('MQ.ARR', good(-7))) >= 0);
  check('ON as BOOL: MQ.RUN = true', (await live.waitFor('MQ.RUN', good(true))) >= 0);
  check('UTF-8 string', (await live.waitFor('MQ.NAME', good('Trạm bơm số 1'))) >= 0);
  check('# filter', (await live.waitFor('MQ.EVENTS', good('started'))) >= 0);
  measures.readLatencyMs = now() - t0;
  check(
    'TLS with the pinned certificate: TLS.V = 8.5',
    (await live.waitFor('TLS.V', good(8.5))) >= 0,
    JSON.stringify(live.get('TLS.V')),
  );
  check(
    'TLS with a wrong pin: BAD MQTT_CERT_UNTRUSTED',
    (await live.waitFor('BAD.V', (t) => t.reason === 'MQTT_CERT_UNTRUSTED')) >= 0,
    JSON.stringify(live.get('BAD.V')),
  );
  await ctl.pub('sensors/a7/data', 'not json');
  check(
    'a payload that does not decode: BAD MQTT_PAYLOAD',
    (await live.waitFor('MQ.TEMP', (t) => t.reason === 'MQTT_PAYLOAD')) >= 0,
  );
  await ctl.pub('sensors/a7/data', '{"temp":20}');
  check('and GOOD again', (await live.waitFor('MQ.TEMP', good(20))) >= 0);
  const d = await diag();
  const tls = await diag('mqtls');
  measures.diag = d?.details;
  measures.tlsDiag = { state: tls?.state, lastError: tls?.lastError, details: tls?.details };
  check('diagnostics: connected, broker sim:1883', d?.state === 'connected', JSON.stringify(d));
  check(
    'diagnostics of the TLS channel show the broker certificate',
    JSON.stringify(tls?.details ?? {}).includes('serverCertSha256'),
    JSON.stringify(tls?.details),
  );
  live.close();
}

// ------------------------------------------------------------------------------------- write

async function runWrite(ctl) {
  const live = await new Live(IDS).open();
  await live.waitFor('MQ.DENIED', (t) => t.reason === 'MQTT_SUBSCRIBE_REFUSED', 15000);
  await ctl.cmd('CLEAR');
  const sp = await writeAndWait('vh1', 'MQ.SP', 42.5);
  check('write MQ.SP: NO_READBACK', sp.final?.code === 'NO_READBACK', JSON.stringify(sp.final));
  measures.writeMs = sp.ms;
  const mode = await writeAndWait('vh1', 'MQ.MODE', 2);
  check(
    'write MQ.MODE: NO_READBACK',
    mode.final?.code === 'NO_READBACK',
    JSON.stringify(mode.final),
  );
  const rx = await ctl.received();
  const spMsg = rx.find((m) => m.topic === 'plant/cmd/sp');
  check(
    'the broker got {"data":{"sp":42.5}} QoS 1 retained on plant/cmd/sp',
    spMsg?.payload === '{"data":{"sp":42.5}}' && spMsg.qos === 1 && spMsg.retain === true,
    JSON.stringify(spMsg),
  );
  check(
    'the broker got 2 on plant/mode',
    rx.some((m) => m.topic === 'plant/mode' && m.payload === '2'),
  );
  check('a pub Tag shows the written value', (await live.waitFor('MQ.SP', good(42.5))) >= 0);
  check('a both Tag gets its own message back', (await live.waitFor('MQ.MODE', good(2))) >= 0);
  const range = await writeAndWait('vh1', 'MQ.SP', 500);
  check(
    'a write out of limits is refused',
    range.final?.status !== 'CONFIRMED',
    JSON.stringify(range.final),
  );
  // groups: every second and on change
  await ctl.cmd('CLEAR');
  await ctl.pub('plant/tank1/level', '77.25');
  await sleep(2500);
  const groups = (await ctl.received()).filter((m) => m.topic === 'mat/rt/state');
  const last = groups.length ? JSON.parse(groups[groups.length - 1].payload) : {};
  check(
    'group mat/rt/state: JSON of MQ.LEVEL, MQ.RUN, MQ.SP with quality',
    groups.length >= 2 && last.values?.['MQ.LEVEL'] === 77.25 && last.quality?.['MQ.SP'] === 'GOOD',
    groups.map((g) => g.payload).join(' | '),
  );
  const audit = await api('admin', 'GET', '/api/v1/audit?limit=50');
  check(
    'the writes are in the audit log',
    audit.status === 200 && JSON.stringify(audit.json).includes('MQ.SP'),
    String(audit.status),
  );
  live.close();
}

// ---------------------------------------------------------------------------------- reconnect

async function runReconnect(ctl) {
  const live = await new Live(IDS).open();
  await ctl.pub('plant/tank1/level', '1.5');
  await live.waitFor('MQ.LEVEL', good(1.5), 15000);
  const pid0 = runtimePid();
  await ctl.cmd('CLEAR');
  await ctl.cmd('KICK');
  await sleep(500);
  const rx = await ctl.received();
  check(
    'the link killed without DISCONNECT: the broker sends the will (retained)',
    rx.some((m) => m.topic === 'mat/rt/status' && m.payload === 'offline' && m.retain),
    JSON.stringify(rx),
  );
  await ctl.cmd('DOWN');
  check(
    'broker down: BAD DISCONNECTED',
    (await live.waitFor('MQ.LEVEL', (t) => t.reason === 'DISCONNECTED', 10000)) >= 0,
    JSON.stringify(live.get('MQ.LEVEL')),
  );
  const w = await writeAndWait('vh1', 'MQ.SP', 10);
  check(
    'a write while down: refused (CONNECTION_BAD) or NOT_SENT_DISCONNECTED',
    /NOT_SENT_DISCONNECTED|CONNECTION_BAD/.test(JSON.stringify(w.final)),
    JSON.stringify(w.final),
  );
  await sleep(4000);
  const t0 = now();
  await ctl.cmd('UP');
  let back = -1;
  while (now() - t0 < 10000) {
    await ctl.pub('plant/tank1/level', '2.5');
    if ((await live.waitFor('MQ.LEVEL', good(2.5), 300)) >= 0) {
      back = now() - t0;
      break;
    }
  }
  measures.reconnectMs = back;
  check(
    'broker back: GOOD within reconnectMaxS + 2 s (5 s)',
    back >= 0 && back <= 5000,
    `${back} ms`,
  );
  check('the runtime never restarted', runtimePid() === pid0, `${pid0} -> ${runtimePid()}`);
  const d = await diag();
  check('reconnects counted', (d?.reconnects ?? 0) >= 1, JSON.stringify(d?.reconnects));
  live.close();
}

// -------------------------------------------------------------------------------------- stale

async function runStale(ctl) {
  const live = await new Live(IDS).open();
  await ctl.pub('plant/stale', '3.25');
  check('MQ.STALE GOOD', (await live.waitFor('MQ.STALE', good(3.25), 15000)) >= 0);
  const t0 = now();
  const ms = await live.waitFor('MQ.STALE', (t) => t.reason === 'MQTT_STALE', 8000);
  measures.staleAfterMs = ms >= 0 ? now() - t0 : -1;
  check(
    'no message for staleAfterMs (3 s): UNCERTAIN MQTT_STALE with the last value',
    ms >= 0 && live.get('MQ.STALE').quality === 'UNCERTAIN' && live.get('MQ.STALE').value === 3.25,
    JSON.stringify(live.get('MQ.STALE')),
  );
  check('not before 3 s', measures.staleAfterMs >= 2500, `${measures.staleAfterMs} ms`);
  await ctl.pub('plant/stale', '4');
  check('a new message: GOOD again', (await live.waitFor('MQ.STALE', good(4))) >= 0);
  live.close();
}

// -------------------------------------------------------------------------------------- load

async function runLoad(ctl) {
  const seconds = Number(opt('--seconds', '60'));
  const nClients = Number(opt('--clients', '10'));
  const rate = Number(opt('--rate', '50'));
  const ids = [];
  for (let i = 0; i < 500; i++) ids.push(i % 2 ? `B.J${i}` : `B.R${i}`);
  const payload = (i, v) => (i % 2 ? [`bench/j/${i}`, `{"v":${v}}`] : [`bench/r/${i}`, String(v)]);
  // every Tag gets a first value
  for (let i = 0; i < 500; i++) await ctl.pub(...payload(i, i));
  const clients = [];
  for (let i = 0; i < nClients; i++) clients.push(await new Live(ids).open());
  check(
    'all 500 Tags GOOD',
    (await clients[0].waitFor(ids[499], good(499), 15000)) >= 0 &&
      ids.every((id) => clients[0].get(id)?.quality === 'GOOD'),
  );
  const pid = runtimePid();
  const stat = () => {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return Number(s[11]) + Number(s[12]);
  };
  const rss = () =>
    Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) * 1024;
  const cpu0 = stat();
  const t0 = now();
  let rssMax = 0;
  let sent = 0;
  let n = 0;
  while (now() - t0 < seconds * 1000) {
    const tick = now();
    for (let k = 0; k < rate; k++, n++) {
      const i = n % 500;
      await ctl.pub(...payload(i, 1000 + n));
      sent++;
    }
    rssMax = Math.max(rssMax, rss());
    await sleep(Math.max(0, 1000 - (now() - tick)));
  }
  const secs = (now() - t0) / 1000;
  await sleep(1000);
  const d = await diag();
  measures.seconds = round1(secs);
  measures.clients = nClients;
  measures.tags = ids.length;
  measures.messagesPerSecond = round1(sent / secs);
  measures.cpuPercentOneCoreAvg = round1(((stat() - cpu0) / 100 / secs) * 100);
  measures.rssMaxMB = round1(rssMax / 1048576);
  measures.driver = d?.details;
  const last = (n - 1) % 500;
  check(
    'the last message reached its Tag',
    (await clients[0].waitFor(ids[last], good(1000 + n - 1), 5000)) >= 0,
  );
  const gaps = clients.reduce((x, c) => x + c.gaps, 0);
  check('no lost sequence on any client', gaps === 0, `${gaps} gaps`);
  check('RSS <= 150 MB (Constitution III)', rssMax <= 150 * 1048576, `${measures.rssMaxMB} MB`);
  for (const c of clients) c.close();
}

// -------------------------------------------------------------------------------------- main

let ctl;
try {
  ctl = await new Control().open();
  if (scenario === 'read') await runRead(ctl);
  else if (scenario === 'write') await runWrite(ctl);
  else if (scenario === 'reconnect') await runReconnect(ctl);
  else if (scenario === 'stale') await runStale(ctl);
  else if (scenario === 'load') await runLoad(ctl);
  else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  check(`scenario ${scenario} ran to its end`, false, e?.stack ?? e);
}
ctl?.close();
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario, checks, measures, pass }));
process.exit(pass ? 0 : 1);
