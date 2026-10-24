// Scenarios of the MC protocol (SLMP) integration tests (specs/017-driver-mc T032, T050). Runs in the
// Node container of tests/driver-it/compose-mc.yaml, started by tools/driver-it-mc.ps1, and prints one
// JSON object: { scenario, checks: [{ name, pass, detail }], measures, pass }.
//
//   node mc-it.mjs read|merge|write|faults --fp <fingerprint>      (project mc-all-types)
//   node mc-it.mjs unplug --rounds 6 --fp <fp>                      (project mc-all-types)
//   node mc-it.mjs load --seconds 60 --clients 10 --fp <fp>         (project bench-500-mc)
//
// Passwords come from the environment (MAT_IT_PW_ADMIN, _KYSU1, _VH1, _XEM1). The runtime is `rt`,
// the simulator `sim` (tools/mc-sim, control API on :5009). The expected values come from the map
// of the simulator, read with its own memory model (tools/mc-sim/map.mjs); the expected requests
// are computed again here with the rules of contracts/mc-protocol.md and spec FR-005.
import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { login, pinnedRequest, pinnedWebSocket } from '../../tools/measure/device-api.mjs';
import { DEVICES, loadMap, tagRadix } from '../../tools/mc-sim/map.mjs';

const RT = 'rt';
const BASE = `https://${RT}:8443`;
const LIVE_USER = 'kysu1'; // an engineer: the live channel gives every Tag
const SIM = 'http://sim:5009';
const PROJECTS = '/src/tests/driver-it/projects';

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
const simClear = () => simCall('POST', '/fault', { mode: 'clear' });
const simLog = async (since = 0) => (await simCall('GET', `/log?since=${since}`)).entries;
const simMark = async () => (await simCall('GET', '/counters')).last?.seq ?? 0;
const simTyped = async (device, at, type, length) =>
  (
    await simCall(
      'GET',
      `/mem?device=${device}&at=${at}&type=${type}${length ? `&length=${length}` : ''}`,
    )
  ).value;
const simPoints = async (device, at, count = 1) =>
  (await simCall('GET', `/mem?device=${device}&at=${at}&count=${count}`)).values;
// the frames of channel plc-a (3E binary over TCP): faults aimed at it leave plc-b and plc-c alone
const CH_A = { transport: 'tcp', frame: '3E', encoding: 'binary' };

// ------------------------------------------------------------------------------------- project

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const projectTags = (dir) => readJson(`${PROJECTS}/${dir}/tags.json`).tags;
const externalTags = (dir) => projectTags(dir).filter((t) => t.kind === 'external');
const connections = (dir) => readJson(`${PROJECTS}/${dir}/connections.json`);

/** A Tag address of the MC channel: { device, number, bit? } (contracts/mc-protocol.md §1). */
function parseAddress(text) {
  const names = Object.keys(DEVICES).sort((a, b) => b.length - a.length);
  const device = names.find((n) => text.startsWith(n));
  const m = /^([0-9A-Fa-f]+)(?:\.([0-9A-Fa-f]))?$/.exec(text.slice(device.length));
  const number = parseInt(m[1], tagRadix(device, 'hex'));
  return { device, number, bit: m[2] === undefined ? undefined : parseInt(m[2], 16) };
}

const WORDS = { INT16: 1, UINT16: 1, INT32: 2, UINT32: 2, FLOAT32: 2, INT64: 4, UINT64: 4 };
WORDS.FLOAT64 = 4;
const wordsOf = (t) => {
  const a = parseAddress(t.source.address);
  if (DEVICES[a.device].bit || a.bit !== undefined) return 1;
  if (t.type === 'STRING') return Math.ceil(t.source.stringLength / 2);
  return WORDS[t.type];
};

/** The value of each Tag as the map of the simulator holds it. */
function expectedValues(tags, mapFile) {
  const mem = loadMap(readJson(mapFile));
  const out = {};
  for (const t of tags) {
    const a = parseAddress(t.source.address);
    if (DEVICES[a.device].bit) out[t.id] = mem.get(a.device, a.number) === 1;
    else if (a.bit !== undefined) out[t.id] = ((mem.get(a.device, a.number) >> a.bit) & 1) === 1;
    else out[t.id] = mem.getTyped(a.device, a.number, t.type, t.source.stringLength);
  }
  return out;
}

// The live channel writes a double with 9 significant digits, a 64-bit integer as a string:
// compared to 1e-8 relative, and as text.
const same = (got, want) => {
  if (typeof want === 'string' && /^-?\d+$/.test(want)) return String(got) === want;
  if (typeof got === 'string' && /^-?\d+$/.test(got) && typeof want === 'number')
    return got === String(want);
  if (typeof got === 'number' && typeof want === 'number')
    return Math.abs(got - want) <= 1e-8 * Math.max(1, Math.abs(want));
  return got === want;
};

// ------------------------------------------------------------------------------------- live

class Live {
  constructor(ids) {
    this.ids = ids;
    this.tags = new Map(); // id -> { value, quality, reason, ts }
    this.order = [];
    this.updates = 0;
    this.lastSeq = 0;
    this.gaps = 0;
    this.changeLog = []; // [{ id, at, serverTs }]
    this.snapshotAt = 0;
    this.reasons = new Map(); // id -> Set of BAD reasons seen
  }
  async open() {
    try {
      this.ws = await pinnedWebSocket(BASE, fp, await token(LIVE_USER));
    } catch {
      tokens[LIVE_USER] = undefined;
      this.ws = await pinnedWebSocket(BASE, fp, await token(LIVE_USER));
    }
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    // the server drops a client that is silent for 15 s: a heartbeat every 5 s
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
    if (!this.snapshotAt) throw new Error(`no snapshot ${JSON.stringify(this.lastError ?? {})}`);
    return this;
  }
  noteBad(id, quality, reason) {
    if (quality !== 'BAD') return;
    if (!this.reasons.has(id)) this.reasons.set(id, new Set());
    this.reasons.get(id).add(reason);
  }
  onMessage(m) {
    if (m.type === 'snapshot') {
      this.order = m.tags.map((t) => t.id);
      for (const t of m.tags) {
        this.tags.set(t.id, {
          value: t.value,
          quality: t.quality,
          reason: t.reason ?? '',
          ts: t.serverTimestamp,
        });
        this.noteBad(t.id, t.quality, t.reason ?? '');
      }
      this.snapshotAt = now();
      this.lastSeq = m.sequence;
    } else if (m.type === 'delta') {
      if (m.sequence !== this.lastSeq + 1) this.gaps++;
      this.lastSeq = m.sequence;
      const at = now();
      for (const e of m.tags) {
        const id = this.order[e[0]];
        const prev = this.tags.get(id);
        this.tags.set(id, { value: e[1], quality: e[2], reason: e[3] ?? '', ts: m.ts });
        this.noteBad(id, e[2], e[3] ?? '');
        this.updates++;
        if (!prev || prev.value !== e[1] || prev.quality !== e[2])
          this.changeLog.push({ id, at, serverTs: m.ts });
      }
    } else if (m.type === 'error') {
      this.lastError = m;
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
  /** Waits until every id meets pred; returns the ms it took, or -1. */
  async waitAll(ids, pred, ms) {
    const t0 = now();
    while (now() - t0 < ms) {
      if (ids.every((id) => this.tags.has(id) && pred(this.tags.get(id)))) return now() - t0;
      await sleep(20);
    }
    return -1;
  }
  send(o) {
    this.ws.send(JSON.stringify(o));
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

// ------------------------------------------------------------------------------------- API

const tokens = {};
async function token(user) {
  if (tokens[user]) return tokens[user];
  const pw = process.env[`MAT_IT_PW_${user.toUpperCase()}`];
  const r = await login(BASE, fp, user, pw);
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
const uuid = (() => {
  let n = Date.now() % 1e9;
  return () => {
    n++;
    const h = (x, w) => x.toString(16).padStart(w, '0');
    return `${h(n, 8)}-${h(Math.floor(Math.random() * 0xffff), 4)}-4${h(Math.floor(Math.random() * 0xfff), 3)}-8${h(Math.floor(Math.random() * 0xfff), 3)}-${h(Math.floor(Math.random() * 0xffffffff), 8)}${h(n & 0xffff, 4)}`;
  };
})();

/** Writes one value and polls the result every 200 ms until it is final. Returns { post, final, ms }. */
async function writeAndWait(user, tag, value, { maxMs = 30000 } = {}) {
  let id = uuid();
  let t0 = now();
  let post = await api(user, 'POST', '/api/v1/tags/write', {
    requests: [{ requestId: id, tag, value }],
  });
  let first = post.json?.results?.[0];
  for (let i = 0; i < 3 && first?.reason === 'RATE_LIMITED'; i++) {
    await sleep((first.retryAfterMs ?? 3000) + 100);
    id = uuid(); // a refused request id is remembered: a new attempt is a new command
    t0 = now();
    post = await api(user, 'POST', '/api/v1/tags/write', {
      requests: [{ requestId: id, tag, value }],
    });
    first = post.json?.results?.[0];
  }
  if (post.status !== 200 || first?.status !== 'ACCEPTED')
    return { post, first, final: first, ms: now() - t0, id };
  let final = first;
  while (now() - t0 < maxMs) {
    await sleep(200);
    const r = await api(user, 'GET', `/api/v1/tags/write/${id}`);
    final = r.json?.results?.[0] ?? final;
    if (final.status !== 'ACCEPTED') break;
  }
  return { post, first, final, ms: now() - t0, id };
}

async function auditRows(user, query) {
  const rows = [];
  let before;
  for (let page = 0; page < 20; page++) {
    const r = await api(
      user,
      'GET',
      `/api/v1/audit?${query}&limit=200${before ? `&before=${before}` : ''}`,
    );
    if (r.status !== 200) break;
    rows.push(...r.json.records);
    before = r.json.next;
    if (!before) break;
  }
  return rows;
}

async function diag() {
  const r = await api('xem1', 'GET', '/api/v1/drivers/diagnostics');
  if (r.status !== 200) throw new Error(`drivers/diagnostics ${r.status} ${r.body}`);
  const ch = (id) => r.json.channels.find((c) => c.id === id);
  return { json: r.json, ch, a: ch('plc-a'), qa: ch('plc-a')?.devices?.[0] };
}

function runtimePid() {
  for (const d of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8');
      if (cmd.startsWith('/build/x64/bin/mat-runtime')) return Number(d);
    } catch {
      // gone
    }
  }
  return 0;
}

const ALL = 'mc-all-types';
const MAP = '/src/tools/mc-sim/maps/it-all-types.json';

/** Opens the live channel on every external Tag of mc-all-types and waits for them to be GOOD. */
async function openAll(ms = 15000) {
  const ext = externalTags(ALL);
  const ids = ext.map((t) => t.id);
  const live = await new Live(ids).open();
  const t = await live.waitAll(ids, (x) => x.quality === 'GOOD', ms);
  return { live, ext, ids, firstGoodMs: t };
}
const notGood = (live, ids) =>
  ids
    .filter((id) => live.get(id)?.quality !== 'GOOD')
    .map((id) => `${id}:${live.get(id)?.quality}/${live.get(id)?.reason}`);

// ------------------------------------------------------------------------------------- read

async function runRead() {
  const { live, ext, ids, firstGoodMs } = await openAll(20000);
  measures.firstGoodMs = firstGoodMs;
  const want = expectedValues(ext, MAP);
  let ok = 0;
  const wrong = [];
  for (const id of ids) {
    const t = live.get(id);
    if (t && t.quality === 'GOOD' && same(t.value, want[id])) ok++;
    else wrong.push(`${id}: got ${JSON.stringify(t)} want ${JSON.stringify(want[id])}`);
  }
  for (const p of ['A', 'B', 'C']) {
    const mine = ids.filter((id) => id.startsWith(`${p}.`));
    const good = mine.filter(
      (id) => live.get(id)?.quality === 'GOOD' && same(live.get(id).value, want[id]),
    );
    check(
      `channel plc-${p.toLowerCase()}: every Tag GOOD and equal to the map`,
      good.length === mine.length,
      `${good.length}/${mine.length}`,
    );
  }
  measures.tagsChecked = ids.length;
  measures.tagsMatching = ok;
  check(
    '100 % of the Tags match the simulator (SC-001)',
    ok === ids.length,
    wrong.slice(0, 20).join(' | ') || `${ok}/${ids.length}`,
  );
  // every device and every type is in the test
  const devices = new Set(ext.map((t) => parseAddress(t.source.address).device));
  const types = new Set(ext.map((t) => t.type));
  check(
    'the Tags cover every device and every type of FR-003, FR-004',
    Object.keys(DEVICES).every((d) => devices.has(d)) &&
      ['BOOL', 'INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT32', 'FLOAT64', 'INT64', 'UINT64']
        .concat(['STRING'])
        .every((x) => types.has(x)),
    `${[...devices].join(',')} / ${[...types].join(',')}`,
  );
  live.close();
}

// ------------------------------------------------------------------------------------- merge

const ORDER = ['D', 'W', 'R', 'ZR', 'SD', 'TN', 'CN', 'M', 'X', 'Y', 'B', 'L', 'SM'];
const GROUPS = ['fast', 'normal', 'slow'];

/** planBlocks of drivers/sdk/merge_planner.cpp, written again. */
function planBlocks(items, maxGap, maxLen) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks = [];
  for (const r of sorted) {
    const b = blocks.at(-1);
    if (b && r.start - b.end <= maxGap && Math.max(b.end, r.end) - b.start <= maxLen)
      b.end = Math.max(b.end, r.end);
    else blocks.push({ start: r.start, end: r.end });
  }
  return blocks;
}

/**
 * The requests of one scan round of a field device (spec FR-005): per scan group and device code,
 * greedy blocks (gap <= maxGapWords, length <= maxBatchWords; a bit device as its word index
 * number / 16); blocks of 1 or 2 words go to Random Read (words first, then dwords, <= 192
 * points a request), a lone point is a Batch Read. Returns keys like the simulator log gives.
 */
function expectedRound(device, tags) {
  const maxGap = device.maxGapWords ?? 16;
  const maxLen = Math.min(device.maxBatchWords ?? 960, 960);
  const per = Math.min(device.maxRandomPoints ?? 192, 192);
  const random = device.randomRead ?? true;
  const out = [];
  for (const g of GROUPS) {
    const small = [];
    for (const dev of ORDER) {
      const items = tags
        .filter((t) => (t.source.scanGroup ?? 'normal') === g)
        .map((t) => ({ t, a: parseAddress(t.source.address) }))
        .filter((x) => x.a.device === dev)
        .map((x) => {
          const s = DEVICES[dev].bit ? Math.floor(x.a.number / 16) : x.a.number;
          return { start: s, end: s + wordsOf(x.t) };
        });
      for (const b of planBlocks(items, maxGap, maxLen)) {
        const e = { dev, start: b.start, count: b.end - b.start };
        if (random && e.count <= 2) small.push(e);
        else out.push(e);
      }
    }
    const ordered = [...small.filter((e) => e.count === 1), ...small.filter((e) => e.count === 2)];
    for (let k = 0; k < ordered.length; k += per) {
      const chunk = ordered.slice(k, k + per);
      if (chunk.length === 1) out.push(chunk[0]);
      else
        out.push({
          random: true,
          n: chunk.filter((e) => e.count === 1).length,
          m: chunk.filter((e) => e.count === 2).length,
        });
    }
  }
  return out.map((e) =>
    e.random
      ? `0403/n${e.n}/m${e.m}`
      : `0401/${e.dev}/${DEVICES[e.dev].bit ? e.start * 16 : e.start}/${e.count}`,
  );
}
const logKey = (e) =>
  e.cmd === '0403' ? `0403/n${e.n}/m${e.m}` : `${e.cmd}/${e.device}/${e.at}/${e.points}`;
const channelOf = (e) => `${e.transport}/${e.frame}/${e.code}`;

async function runMerge() {
  const { live } = await openAll();
  const conn = connections(ALL);
  const ext = externalTags(ALL);
  const kinds = {
    'plc-a': 'tcp/3E/binary',
    'plc-b': 'tcp/4E/ascii',
    'plc-c': 'udp/3E/binary',
  };
  await sleep(1500);
  const mark = await simMark();
  const t0 = now();
  await sleep(10200);
  const secs = (now() - t0) / 1000;
  const log = (await simLog(mark)).filter((e) => e.cmd !== '1401');
  measures.windowS = round1(secs);
  measures.channels = {};
  for (const ch of conn.channels) {
    const device = ch.devices[0];
    const want = expectedRound(
      device,
      ext.filter((t) => t.source.device === device.id),
    );
    const wantCount = new Map();
    for (const k of want) wantCount.set(k, (wantCount.get(k) ?? 0) + 1);
    const mine = log.filter((e) => channelOf(e) === kinds[ch.id]);
    const seen = new Map();
    for (const e of mine) seen.set(logKey(e), (seen.get(logKey(e)) ?? 0) + 1);
    const wantKeys = [...wantCount.keys()].sort();
    const seenKeys = [...seen.keys()].sort();
    check(
      `${ch.id}: the simulator saw exactly the requests that were computed`,
      JSON.stringify(seenKeys) === JSON.stringify(wantKeys),
      `seen ${seenKeys.join(' ')} | want ${wantKeys.join(' ')}`,
    );
    // rounds in the window: each request of the plan comes once a round (1 s)
    const perKey = [...wantCount.entries()].map(([k, n]) => (seen.get(k) ?? 0) / n);
    const rounds = mine.length / want.length;
    check(
      `${ch.id}: one round of ${want.length} requests per second`,
      perKey.every((r) => r >= secs - 1.5 && r <= secs + 1.5) && Math.abs(rounds - secs) <= 1.5,
      `${mine.length} requests in ${round1(secs)} s = ${round1(rounds)} rounds`,
    );
    check(
      `${ch.id}: every Batch Read <= 960 points, every Random Read <= 192 points`,
      mine.every((e) =>
        e.cmd === '0403' ? e.n + e.m <= 192 && e.n + e.m >= 2 : e.points <= 960 && e.points >= 1,
      ),
    );
    check(
      `${ch.id}: every answer has end code 0000`,
      mine.every((e) => e.endCode === '0000'),
      [...new Set(mine.map((e) => e.endCode))].join(','),
    );
    measures.channels[ch.id] = {
      tags: ext.filter((t) => t.source.device === device.id).length,
      requestsPerRound: want.length,
      batchReads: want.filter((k) => k.startsWith('0401')).length,
      randomReads: want.filter((k) => k.startsWith('0403')).length,
      plan: want,
      requestsInWindow: mine.length,
    };
  }
  const other = log.filter((e) => !Object.values(kinds).includes(channelOf(e)));
  check('no request of another kind of frame', other.length === 0, other.length);
  live.close();
}

// ------------------------------------------------------------------------------------- write

async function runWrite() {
  const { live } = await openAll();
  const mark = await simMark();
  const confirmed = [];
  const ids = [];
  const known = async (what, tag, value, mem, wantLive = value) => {
    const w = await writeAndWait('vh1', tag, value);
    ids.push(w.id);
    const f = w.final;
    const good = f?.status === 'CONFIRMED' && f.code === 'CONFIRMED';
    check(`${what}: CONFIRMED`, good, `${w.post.status} ${JSON.stringify(f)}`);
    if (good) confirmed.push(w.ms);
    const got = await mem();
    check(
      `${what}: the simulator holds ${JSON.stringify(value)}`,
      same(got, typeof value === 'boolean' ? (value ? 1 : 0) : value),
      JSON.stringify(got),
    );
    const t = await live.waitFor(tag, (x) => x.quality === 'GOOD' && same(x.value, wantLive), 5000);
    check(`${what}: the Tag carries the value`, Boolean(t), JSON.stringify(live.get(tag)));
  };
  await known('INT16 A.W_I16 = -321', 'A.W_I16', -321, () => simTyped('D', 500, 'INT16'));
  await known('FLOAT32 A.W_F32 = 12.5', 'A.W_F32', 12.5, () => simTyped('D', 502, 'FLOAT32'));
  await known('INT32 A.W_I32 = -7654321', 'A.W_I32', -7654321, () => simTyped('D', 504, 'INT32'));
  await known('UINT32 A.W_U32 = 4000000000', 'A.W_U32', 4000000000, () =>
    simTyped('D', 506, 'UINT32'),
  );
  await known('FLOAT64 A.W_F64 = 2.718281828459045', 'A.W_F64', 2.718281828459045, () =>
    simTyped('D', 510, 'FLOAT64'),
  );
  await known('INT64 A.W_I64 = -1234567890123', 'A.W_I64', -1234567890123, async () =>
    Number(await simTyped('D', 514, 'INT64')),
  );
  await known('STRING A.W_STR = PUMP-07', 'A.W_STR', 'PUMP-07', () =>
    simTyped('D', 520, 'STRING', 8),
  );
  await known('UINT16 A.W_U16 = 65000', 'A.W_U16', 65000, () => simTyped('D', 530, 'UINT16'));
  // a bit of a word by read-modify-write: the other bits of D540 stay
  await simCall('POST', '/set', { device: 'D', at: 540, value: 1, bit: 0 });
  await sleep(1500);
  await known(
    'bit in a word A.W_BIT (D540.3) = true, read-modify-write',
    'A.W_BIT',
    true,
    async () => ((await simPoints('D', 540))[0] >> 3) & 1,
  );
  check(
    'read-modify-write kept the other bits of D540 (bit 0 still set)',
    (await simPoints('D', 540))[0] === 9,
    JSON.stringify(await simPoints('D', 540)),
  );
  await known(
    'bit device A.W_M (M500) = true',
    'A.W_M',
    true,
    async () => (await simPoints('M', 500))[0],
  );
  await known(
    'bit device A.W_Y (Y40) = true',
    'A.W_Y',
    true,
    async () => (await simPoints('Y', 0x40))[0],
  );
  await known(
    'bit device A.W_B (B50) = true',
    'A.W_B',
    true,
    async () => (await simPoints('B', 0x50))[0],
  );
  await known('4E ASCII: INT16 B.W_I16 = 4321', 'B.W_I16', 4321, () => simTyped('D', 550, 'INT16'));
  await known(
    '4E ASCII: bit device B.W_M (M510) = true',
    'B.W_M',
    true,
    async () => (await simPoints('M', 510))[0],
  );
  await known(
    'bit device A.W_M (M500) = false',
    'A.W_M',
    false,
    async () => (await simPoints('M', 500))[0],
  );

  const writes = (await simLog(mark)).filter((e) => e.cmd === '1401');
  measures.writesAtTheSimulator = writes.length;
  check(
    'bit devices are written with 1401/0001, words with 1401/0000',
    writes.every((e) => (DEVICES[e.device].bit ? e.sub === '0001' : e.sub === '0000')),
    writes.map((e) => `${e.sub}:${e.device}${e.at}`).join(','),
  );

  // the PLC refuses the write with an end code
  await simFault({ mode: 'endcode', code: 'C05B', cmd: '1401', device: 'D', at: 500, count: 1 });
  const ex = await writeAndWait('vh1', 'A.W_I16', 99);
  ids.push(ex.id);
  check(
    'end code C05B on the write: FAILED DEVICE_EXCEPTION',
    ex.final?.status === 'FAILED' && ex.final.code === 'DEVICE_EXCEPTION',
    JSON.stringify(ex.final),
  );
  measures.endCodeResult = ex.final;
  check(
    'end code C05B on the write: the result names the end code C05B',
    JSON.stringify(ex.final?.exception ?? {})
      .toUpperCase()
      .includes('C05B'),
    JSON.stringify(ex.final?.exception),
  );
  check(
    'the refused write did not change the simulator',
    (await simTyped('D', 500, 'INT16')) === -321,
  );
  await simClear();

  // audit: a record of receipt and a result for every command, as admin
  await sleep(1000);
  const rows = await auditRows('admin', 'action=tag.write');
  const byId = new Map();
  for (const r of rows) {
    const d = typeof r.detail === 'object' && r.detail ? r.detail : JSON.parse(r.detail ?? '{}');
    if (!d.requestId) continue;
    if (!byId.has(d.requestId)) byId.set(d.requestId, []);
    byId.get(d.requestId).push(r.result);
  }
  const missing = ids.filter(
    (id) =>
      !byId.get(id)?.includes('started') ||
      !byId.get(id)?.some((x) => x === 'ok' || x === 'failed'),
  );
  check(
    'audit tag.write: every command has its record of receipt and its result',
    missing.length === 0,
    `${missing.length} of ${ids.length} missing: ${missing.map((id) => JSON.stringify(byId.get(id))).join(',')}`,
  );
  check(
    'audit tag.write: the refused write is recorded as failed',
    byId.get(ex.id)?.includes('failed'),
    JSON.stringify(byId.get(ex.id)),
  );
  confirmed.sort((x, y) => x - y);
  measures.confirmedMs = confirmed;
  live.close();
}

// ------------------------------------------------------------------------------------- faults

async function runFaults() {
  const { live, ids } = await openAll();
  const aIds = ids.filter((id) => id.startsWith('A.'));
  const others = ids.filter((id) => !id.startsWith('A.'));
  const d0 = await diag();
  check(
    'diagnostics: three channels of kind "mc"',
    d0.json.channels.filter((c) => c.kind === 'mc').length === 3,
    d0.json.channels.map((c) => `${c.id}:${c.kind}`).join(','),
  );
  const steps = [];

  // 1-2. end code C056 at one address: only that Tag BAD MC_END_RANGE (a Batch Read block, then a
  // point of a Random Read)
  for (const [tag, device, at] of [
    ['A.D104', 'D', 104],
    ['A.SD210', 'SD', 210],
  ]) {
    const before = await diag();
    live.reasons.clear();
    const t0 = now();
    await simFault({ mode: 'endcode', code: 'C056', device, at, ...CH_A });
    const bad = await live.waitFor(
      tag,
      (x) => x.quality === 'BAD' && x.reason === 'MC_END_RANGE',
      15000,
    );
    const ms = now() - t0;
    check(
      `C056 at ${device}${at}: ${tag} BAD MC_END_RANGE`,
      Boolean(bad),
      JSON.stringify(live.get(tag)),
    );
    // the other Tags are GOOD from the following rounds
    const rest = ids.filter((id) => id !== tag);
    const goodMs = await live.waitAll(rest, (x) => x.quality === 'GOOD', 6000);
    await sleep(2000);
    const notOk = notGood(live, rest);
    check(
      `C056 at ${device}${at}: every other Tag GOOD (block split)`,
      goodMs >= 0 && notOk.length === 0,
      notOk.slice(0, 10).join(','),
    );
    const transient = [...live.reasons.keys()].filter((id) => id !== tag);
    const after = await diag();
    const ex0 = before.qa.exceptions ?? {};
    const ex1 = after.qa.exceptions ?? {};
    check(
      `C056 at ${device}${at}: diagnostics count end code C056 on qa`,
      (ex1.C056 ?? 0) > (ex0.C056 ?? 0),
      `exceptions before ${JSON.stringify(ex0)} after ${JSON.stringify(ex1)}`,
    );
    await simClear();
    const healed = await live.waitFor(tag, (x) => x.quality === 'GOOD', 15000);
    check(`C056 at ${device}${at}: ${tag} GOOD again when the PLC is fixed`, Boolean(healed));
    steps.push({
      step: `C056 ${device}${at}`,
      badMs: ms,
      othersBadForAMoment: transient.length,
      exceptions: ex1,
    });
  }

  // 3. silence on plc-a: its Tags BAD, the other channels stay GOOD, then GOOD again. 3E over TCP
  // closes the connection on a timeout (contract §2.3, spec edge cases): the Tags of the request
  // that timed out are TIMEOUT, the other Tags of the channel DISCONNECTED (as Modbus TCP).
  {
    const before = await diag();
    live.reasons.clear();
    const t0 = now();
    await simFault({ mode: 'silent', ...CH_A });
    const badMs = await live.waitAll(
      aIds,
      (x) => x.quality === 'BAD' && ['TIMEOUT', 'DISCONNECTED'].includes(x.reason),
      8000,
    );
    const seen = new Set();
    for (const id of aIds) for (const r of live.reasons.get(id) ?? []) seen.add(r);
    check(
      'silent: every Tag of plc-a BAD (TIMEOUT for the request that timed out, else DISCONNECTED)',
      badMs >= 0 && seen.has('TIMEOUT'),
      `${badMs} ms, reasons seen ${[...seen].join(',')}`,
    );
    const otherBad = others.filter((id) => live.reasons.has(id));
    check('silent on plc-a: plc-b and plc-c stay GOOD', otherBad.length === 0, otherBad.join(','));
    const mid = await diag();
    check(
      'silent: the timeouts are counted',
      mid.qa.timeouts > before.qa.timeouts,
      `${before.qa.timeouts} -> ${mid.qa.timeouts}`,
    );
    await simClear();
    const t1 = now();
    const goodMs = await live.waitAll(aIds, (x) => x.quality === 'GOOD', 14000);
    check('silent: GOOD again within 12 s', goodMs >= 0 && goodMs <= 12000, `${goodMs} ms`);
    steps.push({ step: 'silent', badMs, goodMs, sinceStartMs: t1 - t0 });
  }

  // 4. three closed connections: counted as reconnects
  {
    const before = await diag();
    await simFault({ mode: 'close', count: 3, ...CH_A });
    const t0 = now();
    while (now() - t0 < 30000 && (await simCall('GET', '/faults')).faults.length) await sleep(250);
    let after = before;
    const t1 = now();
    while (now() - t1 < 8000) {
      after = await diag();
      if (after.a.reconnects - before.a.reconnects >= 3) break;
      await sleep(250);
    }
    check(
      'close x3: plc-a counts 3 reconnects',
      after.a.reconnects - before.a.reconnects >= 3,
      `${before.a.reconnects} -> ${after.a.reconnects}`,
    );
    const goodMs = await live.waitAll(aIds, (x) => x.quality === 'GOOD', 14000);
    check('close x3: every Tag of plc-a GOOD again within 12 s', goodMs >= 0 && goodMs <= 12000);
    steps.push({ step: 'close x3', reconnects: after.a.reconnects - before.a.reconnects, goodMs });
  }

  // 5. rubbish bytes: BAD_FRAME, counted, then GOOD
  {
    const before = await diag();
    live.reasons.clear();
    await simFault({ mode: 'garbage', count: 3, ...CH_A });
    const t0 = now();
    while (now() - t0 < 30000 && (await simCall('GET', '/faults')).faults.length) await sleep(250);
    await sleep(1000);
    const reasons = new Set();
    for (const id of aIds) for (const r of live.reasons.get(id) ?? []) reasons.add(r);
    check('garbage: Tags of plc-a BAD_FRAME', reasons.has('BAD_FRAME'), [...reasons].join(','));
    const after = await diag();
    const bf = (x) => Object.values(x.qa.badFrames).reduce((s, n) => s + n, 0);
    check(
      'garbage: bad frames counted',
      bf(after) - bf(before) >= 1,
      `${JSON.stringify(before.qa.badFrames)} -> ${JSON.stringify(after.qa.badFrames)}`,
    );
    const goodMs = await live.waitAll(aIds, (x) => x.quality === 'GOOD', 14000);
    check('garbage: every Tag of plc-a GOOD again within 12 s', goodMs >= 0 && goodMs <= 12000);
    steps.push({ step: 'garbage x3', reasons: [...reasons], goodMs });
  }

  const last = await diag();
  check('plc-a is connected after the faults', last.a.state === 'connected', last.a.state);
  check(
    'the last error has a code and a time',
    typeof last.a.lastError?.code === 'string' && last.a.lastError.at > now() - 600000,
    JSON.stringify(last.a.lastError),
  );
  measures.steps = steps;
  measures.finalCounters = {
    timeouts: last.qa.timeouts,
    exceptions: last.qa.exceptions,
    badFrames: last.qa.badFrames,
    reconnects: last.a.reconnects,
    lastError: last.a.lastError,
  };
  live.close();
}

// ------------------------------------------------------------------------------------- unplug

async function runUnplug() {
  const rounds = Number(opt('--rounds', '6'));
  const { live, ids, firstGoodMs } = await openAll(20000);
  check('every Tag GOOD at the start', firstGoodMs >= 0, notGood(live, ids).slice(0, 10).join(','));
  const timeoutMs = 500; // devices of mc-all-types
  const pid0 = runtimePid();
  const badMs = [];
  const goodMs = [];
  for (let k = 0; k < rounds; k++) {
    const mode = k % 2 === 0 ? 'refuse' : 'silent'; // PLC stopped / cable pulled
    const t0 = now();
    await simFault({ mode });
    const tBad = await live.waitAll(ids, (x) => x.quality === 'BAD' && Boolean(x.reason), 8000);
    badMs.push(tBad);
    const reasons = [...new Set(ids.map((id) => live.get(id)?.reason))];
    check(
      `round ${k + 1} (${mode}): every Tag BAD with a reason within 2 cycles + timeout`,
      tBad >= 0 && tBad <= 2 * 1000 + timeoutMs,
      `${tBad} ms (from ${t0}), reasons ${reasons.join(',')}${tBad < 0 ? `, not BAD: ${ids.filter((id) => live.get(id)?.quality !== 'BAD').slice(0, 5)}` : ''}`,
    );
    await sleep(1500);
    await simClear();
    const tGood = await live.waitAll(ids, (x) => x.quality === 'GOOD', 14000);
    goodMs.push(tGood);
    check(
      `round ${k + 1}: GOOD again within 12 s without restarting the runtime`,
      tGood >= 0 && tGood <= 12000,
      `${tGood} ms${tGood < 0 ? `, not GOOD: ${notGood(live, ids).slice(0, 5)}` : ''}`,
    );
  }
  const pid1 = runtimePid();
  check(
    'the runtime process is the same one at the end',
    pid0 > 0 && pid0 === pid1,
    `${pid0} -> ${pid1}`,
  );
  measures.rounds = rounds;
  measures.tags = ids.length;
  measures.badMs = badMs;
  measures.goodMs = goodMs;
  measures.badMaxMs = Math.max(...badMs);
  measures.goodMaxMs = Math.max(...goodMs);
  live.close();
}

// ------------------------------------------------------------------------------------- load

async function runLoad() {
  const seconds = Number(opt('--seconds', '60'));
  const nClients = Number(opt('--clients', '10'));
  const ids = externalTags('bench-500-mc').map((t) => t.id);
  const clients = [];
  for (let i = 0; i < nClients; i++) clients.push(await new Live(ids).open());
  await clients[0].waitAll(ids, (x) => x.quality === 'GOOD', 15000);
  const pid = runtimePid();
  const stat = () => {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return Number(s[11]) + Number(s[12]); // utime + stime, clock ticks
  };
  const rss = () =>
    Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) * 1024;
  const hz = 100;
  await sleep(3000);
  const mark = await simMark();
  for (const c of clients) c.changeLog = [];
  const cpu0 = stat();
  const t0 = now();
  let rssMax = 0;
  const cpuSamples = [];
  let lastCpu = cpu0;
  let lastT = t0;
  for (let s = 0; s < seconds; s += 5) {
    await sleep(5000);
    rssMax = Math.max(rssMax, rss());
    const c = stat();
    const t = now();
    cpuSamples.push(((c - lastCpu) / hz / ((t - lastT) / 1000)) * 100);
    lastCpu = c;
    lastT = t;
  }
  const secs = (now() - t0) / 1000;
  measures.seconds = round1(secs);
  measures.clients = nClients;
  measures.tags = ids.length;
  measures.cpuPercentOneCoreAvg = round1(((stat() - cpu0) / hz / secs) * 100);
  measures.cpuPercentOneCoreMax5s = round1(Math.max(...cpuSamples));
  measures.rssMaxMB = round1(rssMax / 1048576);
  const reqs = await simLog(mark);
  measures.requestsPerSecond = round1(reqs.length / secs);
  measures.requestKinds = [...new Set(reqs.map(logKey))];
  const gaps = clients.reduce((n, c) => n + c.gaps, 0);
  measures.sequenceGaps = gaps;
  check('no lost sequence on any client', gaps === 0, `${gaps} gaps`);
  const periods = [];
  const lags = [];
  for (const c of clients) {
    const last = new Map();
    for (const ch of c.changeLog) {
      const p = last.get(ch.id);
      if (p !== undefined) periods.push(ch.serverTs - p);
      last.set(ch.id, ch.serverTs);
      lags.push(ch.at - ch.serverTs);
    }
  }
  periods.sort((a, b) => a - b);
  lags.sort((a, b) => a - b);
  const mean = periods.reduce((a, b) => a + b, 0) / Math.max(1, periods.length);
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] ?? 0;
  measures.periodMeanMs = round1(mean);
  measures.periodP95Ms = pct(periods, 0.95);
  measures.lagP95Ms = pct(lags, 0.95);
  measures.lagMaxMs = lags.at(-1) ?? 0;
  const changed = new Set(clients[0].changeLog.map((c) => c.id));
  measures.tagsChangingPerClient = changed.size;
  check(
    'the real period of a Tag is 1 s +/- 10 %',
    mean >= 900 && mean <= 1100,
    `${round1(mean)} ms`,
  );
  check(
    'delay from the PLC to the client within a cycle and a second',
    pct(lags, 0.95) <= 2000,
    `p95 ${pct(lags, 0.95)} ms`,
  );
  check('every one of the 500 Tags changes', changed.size === ids.length, `${changed.size}`);
  check(
    'all 500 Tags GOOD on every client',
    clients.every((c) => ids.every((id) => c.get(id)?.quality === 'GOOD')),
  );
  check(
    'three requests a round (D0-D399, D1100-D1139, M0-M79)',
    Math.abs(reqs.length / secs - 3) <= 0.2,
    `${round1(reqs.length / secs)} requests/s`,
  );
  for (const c of clients) c.close();
}

// ------------------------------------------------------------------------------------- main

try {
  if (scenario === 'read') await runRead();
  else if (scenario === 'merge') await runMerge();
  else if (scenario === 'write') await runWrite();
  else if (scenario === 'faults') await runFaults();
  else if (scenario === 'unplug') await runUnplug();
  else if (scenario === 'load') await runLoad();
  else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  check(`scenario ${scenario} ran to its end`, false, e?.stack ?? e);
}
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario, checks, measures, pass }));
process.exit(pass ? 0 : 1);
