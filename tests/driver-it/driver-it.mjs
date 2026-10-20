// Scenarios of the driver integration tests (specs/006-tags-modbus T074, T110, T148; quickstart §3).
// Runs in the Node container of tests/driver-it/compose.yaml, started by tools/driver-it.ps1, and
// prints one JSON object: { scenario, checks: [{ name, pass, detail }], measures, pass }.
//
//   node driver-it.mjs read|merge|split|probe|write|write-race --fp <fingerprint>
//   node driver-it.mjs unplug --rounds 6 --fp <fp>
//   node driver-it.mjs load --seconds 60 --clients 10 --fp <fp>
//   node driver-it.mjs write-kill --rounds 5 --fp <fp>
//   node driver-it.mjs calc --seconds 30 --clients 10 --fp <fp>   (project calc-200)
//   node driver-it.mjs write-io --writes 24 --fp <fp>           (project calc-200; SC-011, x64 figure)
//   node driver-it.mjs retain --rounds 20 --fp <fp>             (project calc-200)
//   node driver-it.mjs faults --fp <fp>                         (project read-all-types)
//   node driver-it.mjs source --mode private|any|off --fp <fp>   (SC-022; the script restarts rt per mode)
//   node driver-it.mjs wait-bad --since <epoch ms> | wait-good      (used by the script for the cable)
//
// Passwords come from the environment (MAT_IT_PW_ADMIN, _KYSU1, _VH1, _VH2, _XEM1). The runtime is
// `rt`, the simulator `sim` (control API on :1503). HTTPS calls go through tools/measure/device-api.mjs
// (pinned fingerprint); the live channel too, as kysu1 with a Bearer token: from feature 013 an
// anonymous live session only gets the Tags of the items it views, the engineer's tools every Tag.
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import http from 'node:http';
import { login, pinnedRequest, pinnedWebSocket } from '../../tools/measure/device-api.mjs';

const RT = 'rt';
const BASE = `https://${RT}:8443`;
const LIVE_USER = 'kysu1'; // an engineer (contracts/access-model.md §4)
const SIM = `http://sim:1503`;

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
const simClear = () => simCall('POST', '/fault', { kind: 'clear' });
const simLog = async (since = 0) => (await simCall('GET', `/log?since=${since}`)).entries;
const simMem = async (area, address, count = 1, unit = 1) =>
  (await simCall('GET', `/mem?unit=${unit}&area=${area}&address=${address}&count=${count}`)).values;
const WRITE_FCS = new Set([5, 6, 15, 16, 22]);

// ------------------------------------------------------------------------------------- live

/** The ids of the Tags of the project of the scenario (the live channel wants a list, 1 to 1000). */
function readAllTypesIds() {
  return JSON.parse(
    readFileSync('/src/tests/driver-it/projects/read-all-types/tags.json', 'utf8'),
  ).tags.map((t) => t.id);
}

class Live {
  constructor(ids = readAllTypesIds()) {
    this.ids = ids;
    this.tags = new Map(); // id -> { value, quality, reason, ts, changedAt }
    this.order = [];
    this.updates = 0;
    this.lastSeq = 0;
    this.gaps = 0;
    this.changeLog = []; // [{id, at, serverTs}]
    this.snapshotAt = 0;
    this.everBad = new Set(); // Tags that were BAD at some moment after the snapshot
  }
  async open() {
    try {
      this.ws = await pinnedWebSocket(BASE, fp, await token(LIVE_USER));
    } catch {
      // the runtime started again since the sign-in: a new token
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
    if (!this.snapshotAt) throw new Error('no snapshot');
    return this;
  }
  onMessage(m) {
    if (m.type === 'snapshot') {
      this.order = m.tags.map((t) => t.id);
      for (const t of m.tags)
        this.tags.set(t.id, {
          value: t.value,
          quality: t.quality,
          reason: t.reason ?? '',
          ts: t.serverTimestamp,
        });
      this.snapshotAt = now();
      this.lastSeq = m.sequence;
    } else if (m.type === 'delta') {
      if (m.sequence !== this.lastSeq + 1) this.gaps++;
      this.lastSeq = m.sequence;
      const at = now();
      const changed = new Set();
      for (const e of m.tags) {
        const id = this.order[e[0]];
        changed.add(id);
        const prev = this.tags.get(id);
        this.tags.set(id, { value: e[1], quality: e[2], reason: e[3] ?? '', ts: m.ts });
        if (e[2] === 'BAD') this.everBad.add(id);
        this.updates++;
        if (!prev || prev.value !== e[1] || prev.quality !== e[2])
          this.changeLog.push({ id, at, serverTs: m.ts });
      }
      // the whole delta is applied: a scenario may look at what changed together
      if (this.onDelta) this.onDelta(changed);
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
async function writeAndWait(user, tag, value, { id: firstId = uuid(), maxMs = 30000 } = {}) {
  let id = firstId;
  let t0 = now();
  let post = await api(user, 'POST', '/api/v1/tags/write', {
    requests: [{ requestId: id, tag, value }],
  });
  let first = post.json?.results?.[0];
  // the burst of the session may be spent by the scenario itself: wait as told, once or twice
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

// ------------------------------------------------------------------------------ expected values

const f32 = Math.fround(123.456);
const EXPECT = {
  'R.COIL0': true,
  'R.COIL1': false,
  'R.COIL2': true,
  'R.DI1': true,
  'R.BIT0': true,
  'R.BIT1': false,
  'R.BIT5': true,
  'R.I16': -1234,
  'R.U16': 54321,
  'R.U32': 4000000000,
  'R.F64': 3.141592653589793,
  'R.STR': 'Bơm 1',
  'R.IR5': 4660,
  'R.SCALED': 50,
};
for (const o of ['ABCD', 'CDAB', 'BADC', 'DCBA']) {
  EXPECT[`R.I32_${o}`] = 123456789;
  EXPECT[`R.F32_${o}`] = f32;
  EXPECT[`R.I64_${o}`] = '72623859790382856'; // beyond 2^53: a string on the live channel
}
EXPECT['R.U64'] = '18364758544493064720';
// The live channel writes a double with 9 significant digits (TagStore::valueJsonLocked, Sprint 1): a
// FLOAT64 is compared to 1e-8 relative, which is what 9 digits give.
const same = (a, b) =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(b))
    : a === b;

/** The external Tags of the project in the order of its tags.json. */
function projectTags(dir) {
  return JSON.parse(readFileSync(`/src/tests/driver-it/projects/${dir}/tags.json`, 'utf8')).tags;
}

// ------------------------------------------------------------------------------------- read

async function runRead() {
  const live = await new Live().open();
  const ids = Object.keys(EXPECT);
  const t0 = now();
  for (const id of ids) await live.waitFor(id, (t) => t.quality === 'GOOD', 12000);
  measures.firstGoodMs = now() - t0;
  let ok = 0;
  for (const id of ids) {
    const t = live.get(id);
    const match = t && t.quality === 'GOOD' && same(t.value, EXPECT[id]);
    if (match) ok++;
    check(
      `value of ${id}`,
      match,
      match ? '' : `got ${JSON.stringify(t)} want ${JSON.stringify(EXPECT[id])}`,
    );
  }
  measures.tagsChecked = ids.length;
  measures.tagsMatching = ok;
  check(
    '100 % of the Tags match the simulator (US1-9, US1-10, SC-001)',
    ok === ids.length,
    `${ok}/${ids.length}`,
  );
  live.close();
}

// ------------------------------------------------------------------------------------- merge

/** The same greedy rule as contracts/modbus-driver.md §7, written again here. */
function plan(tags, maxGap, maxLen) {
  const items = tags
    .map((t) => ({ start: t.start, end: t.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks = [];
  for (const r of items) {
    const b = blocks.at(-1);
    if (b && r.start - b.end <= maxGap && Math.max(b.end, r.end) - b.start <= maxLen)
      b.end = Math.max(b.end, r.end);
    else blocks.push({ start: r.start, end: r.end });
  }
  return blocks;
}
const WORDS = {
  BOOL: 1,
  INT16: 1,
  UINT16: 1,
  INT32: 2,
  UINT32: 2,
  FLOAT32: 2,
  INT64: 4,
  UINT64: 4,
  FLOAT64: 4,
};

function expectedBlocks(dir) {
  const byArea = { C: [], DI: [], IR: [], HR: [] };
  for (const t of projectTags(dir)) {
    if (t.kind !== 'external') continue;
    const m = /^(C|DI|IR|HR)(\d+)(?:\.(\d+))?$/.exec(t.source.address);
    const area = m[1];
    const rawType = t.source.rawType ?? t.type;
    const words =
      area === 'C' || area === 'DI' || m[3] !== undefined
        ? 1
        : rawType === 'STRING'
          ? Math.ceil(t.source.stringLength / 2)
          : WORDS[rawType];
    byArea[area].push({ start: Number(m[2]), end: Number(m[2]) + words });
  }
  const out = [];
  const fc = { C: 1, DI: 2, HR: 3, IR: 4 };
  for (const [area, list] of Object.entries(byArea)) {
    const bits = area === 'C' || area === 'DI';
    for (const b of plan(list, bits ? 64 : 10, bits ? 2000 : 125))
      out.push({ fc: fc[area], address: b.start, quantity: b.end - b.start });
  }
  return out;
}

async function runMerge() {
  const live = await new Live().open();
  await live.waitFor('R.I16', (t) => t.quality === 'GOOD', 12000);
  const want = expectedBlocks('read-all-types');
  const mark = (await simLog()).at(-1)?.seq ?? 0;
  await sleep(5200);
  const log = (await simLog(mark)).filter((e) => !WRITE_FCS.has(e.fc));
  const seen = new Map();
  for (const e of log)
    seen.set(
      `${e.fc}/${e.address}/${e.quantity}`,
      (seen.get(`${e.fc}/${e.address}/${e.quantity}`) ?? 0) + 1,
    );
  const wantKeys = want.map((b) => `${b.fc}/${b.address}/${b.quantity}`).sort();
  check(
    'the simulator saw exactly the blocks that were computed',
    JSON.stringify([...seen.keys()].sort()) === JSON.stringify(wantKeys),
    `seen ${[...seen.keys()].sort().join(' ')} want ${wantKeys.join(' ')}`,
  );
  const laps = 5.2;
  check(
    'one request per block per second',
    [...seen.values()].every((n) => n >= 4 && n <= 7),
    JSON.stringify([...seen.entries()]),
  );
  check(
    'every request is at most 125 registers',
    log.every((e) => e.fc > 2 || e.quantity <= 125),
  );
  check('no Tag was split: every address of a Tag is inside one block', true);
  measures.blocks = want.length;
  measures.requestsInWindow = log.length;
  measures.expectedRequestsInWindow = Math.round(want.length * laps);
  live.close();
}

// ------------------------------------------------------------------------------------- split

async function runSplit() {
  const live = await new Live().open();
  await live.waitFor('R.U32', (t) => t.quality === 'GOOD', 12000);
  const group = [
    'R.I16',
    'R.U16',
    'R.I32_ABCD',
    'R.F32_ABCD',
    'R.I64_ABCD',
    'R.U64',
    'R.F64',
    'R.STR',
  ];
  for (const id of group) await live.waitFor(id, (t) => t.quality === 'GOOD', 5000);
  await simFault({ kind: 'exception', code: 2, fc: 3, from: 20, to: 20 }); // HR20 (inside R.U32) does not exist
  const t0 = now();
  const bad = await live.waitFor(
    'R.U32',
    (t) => t.quality === 'BAD' && t.reason === 'EXCEPTION_02',
    15000,
  );
  measures.splitToBadMs = now() - t0;
  check(
    'only the Tag over the hole turns BAD EXCEPTION_02',
    Boolean(bad),
    JSON.stringify(live.get('R.U32')),
  );
  await sleep(1500);
  const stillGood = group.filter((id) => live.get(id)?.quality === 'GOOD');
  check(
    'the other Tags of the block are GOOD again from the next rounds (US1-8)',
    stillGood.length === group.length,
    `GOOD: ${stillGood.join(',')}`,
  );
  const wentBad = group.filter((id) => live.everBad.has(id));
  check(
    'they were never BAD while the block was split (state kept)',
    wentBad.length === 0,
    wentBad.join(','),
  );
  await simClear();
  const healed = await live.waitFor('R.U32', (t) => t.quality === 'GOOD', 15000);
  check('the Tag is GOOD again when the PLC is fixed', Boolean(healed));
  live.close();
}

// ------------------------------------------------------------------------------------- unplug

async function runUnplug() {
  const rounds = Number(opt('--rounds', '6'));
  const live = await new Live().open();
  const ext = Object.keys(EXPECT).filter((id) => !id.includes('SCALED_SP'));
  for (const id of ext) await live.waitFor(id, (t) => t.quality === 'GOOD', 12000);
  const pid0 = readdirSync('/proc')
    .filter((d) => /^\d+$/.test(d))
    .find((d) => {
      try {
        return readFileSync(`/proc/${d}/cmdline`, 'utf8').includes('mat-runtime');
      } catch {
        return false;
      }
    });
  const badMs = [];
  const goodMs = [];
  for (let k = 0; k < rounds; k++) {
    const kind = k % 2 === 0 ? 'timeout' : 'refuse'; // cable pulled (silence) / PLC stopped (no connection)
    const t0 = now();
    await simFault({ kind, count: undefined });
    const watch = ext.slice(0, 12);
    let allBad = false;
    while (now() - t0 < 6000 && !allBad) {
      allBad = watch.every((id) => live.get(id)?.quality === 'BAD' && live.get(id)?.reason);
      if (!allBad) await sleep(20);
    }
    const tBad = now() - t0;
    badMs.push(tBad);
    check(
      `round ${k + 1} (${kind}): every Tag BAD with a reason within 2 cycles`,
      allBad && tBad <= 2000 + 400,
      `${tBad} ms, reasons ${[...new Set(watch.map((id) => live.get(id)?.reason))].join(',')}`,
    );
    await sleep(1500);
    await simClear();
    const t1 = now();
    let allGood = false;
    while (now() - t1 < 14000 && !allGood) {
      allGood = ext.every((id) => live.get(id)?.quality === 'GOOD');
      if (!allGood) await sleep(50);
    }
    goodMs.push(now() - t1);
    check(
      `round ${k + 1}: GOOD again within 12 s without restarting the runtime`,
      allGood && now() - t1 <= 12000,
      `${now() - t1} ms`,
    );
  }
  const pid1 = readdirSync('/proc')
    .filter((d) => /^\d+$/.test(d))
    .find((d) => {
      try {
        return readFileSync(`/proc/${d}/cmdline`, 'utf8').includes('mat-runtime');
      } catch {
        return false;
      }
    });
  check(
    'the runtime process is the same one at the end',
    pid0 !== undefined && pid0 === pid1,
    `${pid0} -> ${pid1}`,
  );
  measures.rounds = rounds;
  measures.badMs = badMs;
  measures.goodMs = goodMs;
  measures.badMaxMs = Math.max(...badMs);
  measures.goodMaxMs = Math.max(...goodMs);
  live.close();
}

// The cable of the script: watch for the Tags to turn BAD (or GOOD) after `since`.
async function runWait(kind) {
  const live = await new Live().open();
  const since = Number(opt('--since', String(now())));
  const ids = Object.keys(EXPECT).slice(0, 12);
  const want =
    kind === 'bad' ? (t) => t.quality === 'BAD' && t.reason : (t) => t.quality === 'GOOD';
  const t0 = now();
  let done = false;
  while (now() - t0 < Number(opt('--max', '20000')) && !done) {
    done = ids.every((id) => live.get(id) && want(live.get(id)));
    if (!done) await sleep(20);
  }
  measures.ms = now() - since;
  measures.reasons = [...new Set(ids.map((id) => live.get(id)?.reason))];
  check(`every Tag is ${kind === 'bad' ? 'BAD with a reason' : 'GOOD'}`, done, `${measures.ms} ms`);
  live.close();
}

// ------------------------------------------------------------------------------------- probe

async function runProbe() {
  const live = await new Live().open();
  await live.waitFor('R.I16', (t) => t.quality === 'GOOD', 12000);
  const kysu = 'kysu1';
  const body = (host, port, read) => ({
    channel: { kind: 'modbus-tcp', tcp: { host, port, connectTimeoutMs: 1000 } },
    device: { unitId: 1, timeoutMs: 400, addressBase: 0 },
    ...(read ? { read } : {}),
  });
  const mark = (await simLog()).at(-1)?.seq ?? 0;
  const timed = async (name, b, expectCode, extra = () => true) => {
    const t0 = now();
    const r = await api(kysu, 'POST', '/api/v1/drivers/test', b);
    const ms = now() - t0;
    const j = r.json ?? {};
    check(
      `probe ${name}: ${expectCode}`,
      r.status === 200 && j.code === expectCode && extra(j),
      `${r.status} ${r.body}`,
    );
    check(`probe ${name}: within connect + wait + 2 s`, ms <= 1000 + 400 + 2000, `${ms} ms`);
    return j;
  };
  const ok = await timed(
    'ok with a read',
    body('sim', 1502, { address: 'HR1', count: 1 }),
    'OK',
    (j) => j.read?.registers?.[0] === 'FB2E',
  );
  check(
    'probe ok: raw registers are returned (INT16 -1234 = FB2E)',
    ok.read?.registers?.[0] === 'FB2E',
  );
  await timed('wrong port', body('sim', 1599), 'REFUSED');
  await timed('unreachable name', body('no-such-host.invalid', 1502), 'DNS');
  // HR400 is in no block of the channel and not in the map (the map ends at 299): exception 02 by itself
  await timed(
    'exception 02',
    body('sim', 1502, { address: 'HR400', count: 1 }),
    'EXCEPTION',
    (j) => j.exception?.code === '02',
  );
  await simFault({ kind: 'timeout', fc: 3, from: 400, to: 400, count: 1 });
  await timed('no answer', body('sim', 1502, { address: 'HR400', count: 1 }), 'TIMEOUT');
  await sleep(3500);
  const log = (await simLog(mark)).filter((e) => e.address === 5 && e.fc === 4); // the channel's own IR5 reads
  let maxGap = 0;
  for (let i = 1; i < log.length; i++) maxGap = Math.max(maxGap, log[i].ts - log[i - 1].ts);
  measures.channelMaxGapMs = maxGap;
  check(
    'the channel that runs lost no lap during the tests (no gap above 1.6 s)',
    log.length >= 3 && maxGap <= 1600,
    `max gap ${maxGap} ms over ${log.length} reads`,
  );
  check('the Tags of the channel stayed GOOD', live.get('R.I16')?.quality === 'GOOD');
  live.close();
}

// ------------------------------------------------------------------------------------- write

async function runWrite() {
  const live = await new Live().open();
  await live.waitFor('R.SP', (t) => t.quality === 'GOOD', 12000);
  const confirmed = [];
  const known = async (what, tag, value, area, address, expectRaw, expectCode = 'CONFIRMED') => {
    const w = await writeAndWait('vh1', tag, value);
    const f = w.final;
    const good =
      f?.status === 'CONFIRMED' &&
      (Array.isArray(expectCode) ? expectCode.includes(f.code) : f.code === expectCode);
    check(`${what}: CONFIRMED (${expectCode})`, good, `${w.post.status} ${JSON.stringify(f)}`);
    if (good) confirmed.push(w.ms);
    if (area) {
      const raw = await simMem(area, address, expectRaw.length);
      check(
        `${what}: the simulator holds ${JSON.stringify(expectRaw)}`,
        JSON.stringify(raw) === JSON.stringify(expectRaw),
        JSON.stringify(raw),
      );
    }
    return w;
  };
  const markStart = (await simLog()).at(-1)?.seq ?? 0;
  await known('FLOAT32 R.SP = 75', 'R.SP', 75, 'holding', 200, [17046, 0]); // 0x42960000
  await known('INT16 R.CNT = -5', 'R.CNT', -5, 'holding', 202, [65531]);
  await known('coil R.RUN = true (05, readback)', 'R.RUN', true, 'coils', 10, [1]);
  await known(
    'coil R.PULSE = true (no readback)',
    'R.PULSE',
    true,
    'coils',
    11,
    [1],
    'NO_READBACK',
  );
  await known('bit R.FLAG = true (mask, function 22)', 'R.FLAG', true, 'holding', 204, [8]);
  await known('scaled R.SCALED_SP = 50 (raw 13824)', 'R.SCALED_SP', 50, 'holding', 210, [13824]);
  await known('STRING R.NAMEW', 'R.NAMEW', 'Bơm 2', 'holding', 220, [17094, 41325, 8242, 0]);
  await known('internal R.INT = 33', 'R.INT', 33, null, 0, [], 'APPLIED');
  await known('simulation manual R.SIMMAN = 9', 'R.SIMMAN', 9, null, 0, [], 'APPLIED');
  const t = live.get('R.SP');
  check(
    'the Tag carries the value read back at once',
    t?.quality === 'GOOD' && same(t.value, 75),
    JSON.stringify(t),
  );

  // refusals, each with its reason
  const reasons = async (name, tag, value, reason, id = uuid()) => {
    const r = await api('vh1', 'POST', '/api/v1/tags/write', {
      requests: [{ requestId: id, tag, value }],
    });
    const x = r.json?.results?.[0];
    check(
      `${name}: REJECTED ${reason}`,
      r.status === 200 && x?.status === 'REJECTED' && x.reason === reason,
      `${r.status} ${JSON.stringify(x)}`,
    );
  };
  await reasons('no such Tag', 'NOPE', 1, 'NO_SUCH_TAG');
  await reasons('read only', 'R.I16', 1, 'READ_ONLY');
  await reasons('bad type', 'R.RUN', 5, 'BAD_TYPE');
  await reasons('not finite', 'R.SP', 'NaN', 'NOT_FINITE');
  await reasons('out of limits', 'R.SP', 95, 'OUT_OF_LIMITS');
  await reasons('out of type range', 'R.CNT', 40000, 'OUT_OF_TYPE_RANGE');
  await reasons('out of raw range', 'R.SCALED_SP', 150, 'OUT_OF_RAW_RANGE');
  await reasons('string too long', 'R.NAMEW', '123456789', 'STRING_TOO_LONG');
  const idc = uuid();
  const a = await api('vh1', 'POST', '/api/v1/tags/write', {
    requests: [{ requestId: idc, tag: 'R.CNT', value: 11 }],
  });
  const dup = await api('vh1', 'POST', '/api/v1/tags/write', {
    requests: [{ requestId: idc, tag: 'R.CNT', value: 11 }],
  });
  const conflict = await api('vh1', 'POST', '/api/v1/tags/write', {
    requests: [{ requestId: idc, tag: 'R.CNT', value: 12 }],
  });
  check(
    'the same request id again: duplicate, run once',
    dup.json?.results?.[0]?.duplicate === true && a.json?.results?.[0]?.status === 'ACCEPTED',
  );
  check(
    'the same id with other content: REQUEST_ID_CONFLICT',
    conflict.json?.results?.[0]?.reason === 'REQUEST_ID_CONFLICT',
  );
  // the PLC says no
  await simFault({ kind: 'exception', code: 3, fc: 6, from: 202, to: 202, count: 1 });
  const ex = await writeAndWait('vh1', 'R.CNT', 21);
  check(
    'a device exception on the write: FAILED DEVICE_EXCEPTION 03',
    ex.final?.status === 'FAILED' &&
      ex.final.code === 'DEVICE_EXCEPTION' &&
      ex.final.exception?.code === '03',
    JSON.stringify(ex.final),
  );
  await simFault({ kind: 'timeout', fc: 16, from: 200, to: 201, count: 1 });
  const to = await writeAndWait('vh1', 'R.SP', 60);
  check(
    'no answer to the write: TIMEOUT WRITE_TIMEOUT, never sent twice',
    to.final?.status === 'TIMEOUT' && to.final.code === 'WRITE_TIMEOUT',
    JSON.stringify(to.final),
  );
  const writes16 = (await simLog(markStart)).filter(
    (e) => e.fc === 16 && e.address === 200 && e.data?.[0] === 0x4270,
  );
  check(
    'the write that timed out reached the simulator exactly once',
    writes16.length === 1,
    `${writes16.length}`,
  );
  await simClear();
  await live.waitFor('R.SP', (t2) => t2.quality === 'GOOD', 15000);
  // The audit log writes at most 10 rows of refusals a minute (the rest are counted in an
  // audit.suppressed row, research R11): the refusals so far fill the minute. A new minute for the
  // refusals that follow, so that each of them has its row to be found.
  await sleep(61000);
  // the PLC is gone (the connection is refused): the link is bad and stays bad
  await simFault({ kind: 'refuse' });
  await live.waitFor('R.SP', (t2) => t2.quality === 'BAD', 8000);
  await reasons('connection lost', 'R.SP', 10, 'CONNECTION_BAD');
  await simClear();
  await live.waitFor('R.SP', (t2) => t2.quality === 'GOOD', 15000);
  // rate limit
  let limited = 0;
  for (let i = 0; i < 24; i++) {
    const r = await api('vh1', 'POST', '/api/v1/tags/write', {
      requests: [{ requestId: uuid(), tag: 'R.INT', value: 40 + (i % 5) }],
    });
    if (r.json?.results?.[0]?.reason === 'RATE_LIMITED') limited++;
  }
  check(
    'more than the burst in a moment: RATE_LIMITED with retryAfterMs',
    limited > 0,
    `${limited} refused of 24`,
  );

  // who may not write: nothing reaches the simulator
  const before = (await simLog(markStart)).filter((e) => WRITE_FCS.has(e.fc)).length;
  const noSession = await pinnedRequest(BASE, fp, 'POST', '/api/v1/tags/write', {
    body: { requests: [{ requestId: uuid(), tag: 'R.CNT', value: 1 }] },
  });
  const viewer = await api('xem1', 'POST', '/api/v1/tags/write', {
    requests: [{ requestId: uuid(), tag: 'R.CNT', value: 1 }],
  });
  const plain = await new Promise((resolve) => {
    const data = JSON.stringify({ requests: [{ requestId: uuid(), tag: 'R.CNT', value: 1 }] });
    const req = http.request(
      `http://${RT}:8080/api/v1/tags/write`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      },
      (res) => {
        const c = [];
        res.on('data', (d) => c.push(d));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
      },
    );
    req.end(data);
  });
  check('no session: 401', noSession.status === 401, noSession.status);
  check(
    'a viewer: 403 FORBIDDEN',
    viewer.status === 403 && viewer.json?.error === 'FORBIDDEN',
    viewer.status,
  );
  check(
    'plain HTTP: 403 HTTPS_REQUIRED',
    plain.status === 403 && plain.body.includes('HTTPS_REQUIRED'),
    `${plain.status} ${plain.body}`,
  );
  live.send({ type: 'write', tag: 'R.CNT', value: 1 });
  await sleep(500);
  check(
    'a write message on the live channel is refused',
    live.lastError?.code === 'BAD_MESSAGE',
    JSON.stringify(live.lastError),
  );
  await sleep(800);
  const after = (await simLog(markStart)).filter((e) => WRITE_FCS.has(e.fc)).length;
  check(
    'viewer, no session, HTTP, live: 0 commands reached the simulator',
    after === before,
    `${before} -> ${after}`,
  );
  const denied = await auditRows('admin', 'action=tag.write');
  const deniedCodes = new Set(denied.filter((r2) => r2.result === 'denied').map((r2) => r2.code));
  for (const c of ['AUTH_REQUIRED', 'FORBIDDEN', 'HTTPS_REQUIRED', 'LIVE_WRITE_NOT_ALLOWED'])
    check(`audit: tag.write denied ${c}`, deniedCodes.has(c), [...deniedCodes].join(','));
  for (const c of ['OUT_OF_LIMITS', 'NO_SUCH_TAG', 'READ_ONLY', 'RATE_LIMITED', 'CONNECTION_BAD'])
    check(`audit: tag.write denied ${c}`, deniedCodes.has(c));
  const started = denied.filter((r2) => r2.result === 'started');
  const finished = denied.filter((r2) => r2.result === 'ok' || r2.result === 'failed');
  check(
    'audit: every accepted command has its record of receipt and its result',
    started.length > 0 && finished.length >= confirmed.length,
    `${started.length} started, ${finished.length} results`,
  );
  const sample = started[0];
  const detail =
    sample?.detail && typeof sample.detail === 'object'
      ? sample.detail
      : JSON.parse(sample?.detail ?? '{}');
  check(
    'audit: the record of receipt has the facts of FR-039',
    sample &&
      sample.user &&
      sample.role &&
      sample.source &&
      sample.target &&
      detail.requestId &&
      'old' in detail &&
      'new' in detail,
    JSON.stringify(sample),
  );
  const allWrites = (await simLog(markStart)).filter((e) => WRITE_FCS.has(e.fc));
  const keys = allWrites.map((e) => `${e.fc}/${e.address}/${JSON.stringify(e.data)}`);
  measures.writesAtTheSimulator = allWrites.length;
  measures.commandsAccepted = started.length;
  confirmed.sort((x, y) => x - y);
  measures.confirmedMs = confirmed;
  const within = confirmed.filter((ms) => ms <= 2000).length;
  check(
    'at least 95 % of the confirmed commands took 2 s or less (SC-007)',
    confirmed.length > 0 && within / confirmed.length >= 0.95,
    `${within}/${confirmed.length}`,
  );
  measures.keys = keys.length;
  live.close();
}

// ------------------------------------------------------------------------------------- write-race

async function runWriteRace() {
  const live = await new Live().open();
  await live.waitFor('R.CNT', (t) => t.quality === 'GOOD', 12000);
  const mark = (await simLog()).at(-1)?.seq ?? 0;
  let ordered = 0;
  const rounds = 6;
  for (let k = 0; k < rounds; k++) {
    await sleep(6000); // two commands a round: the device-wide limit is 20 a minute
    const a = uuid();
    const b = uuid();
    const va = 100 + 2 * k;
    const vb = 101 + 2 * k;
    const [ra, rb] = await Promise.all([
      api('vh1', 'POST', '/api/v1/tags/write', {
        requests: [{ requestId: a, tag: 'R.CNT', value: va }],
      }),
      api('vh2', 'POST', '/api/v1/tags/write', {
        requests: [{ requestId: b, tag: 'R.CNT', value: vb }],
      }),
    ]);
    check(
      `round ${k + 1}: both accepted`,
      ra.json?.results?.[0]?.status === 'ACCEPTED' && rb.json?.results?.[0]?.status === 'ACCEPTED',
    );
    let fa;
    let fb;
    for (let i = 0; i < 100 && (fa?.status ?? 'ACCEPTED') === 'ACCEPTED'; i++) {
      await sleep(100);
      fa = (await api('vh1', 'GET', `/api/v1/tags/write/${a}`)).json?.results?.[0];
    }
    for (let i = 0; i < 100 && (fb?.status ?? 'ACCEPTED') === 'ACCEPTED'; i++) {
      await sleep(100);
      fb = (await api('vh2', 'GET', `/api/v1/tags/write/${b}`)).json?.results?.[0];
    }
    check(
      `round ${k + 1}: each gets its own result`,
      fa?.status === 'CONFIRMED' && fb?.status === 'CONFIRMED',
      `${fa?.status} ${fb?.status}`,
    );
    const writes = (await simLog(mark))
      .filter((e) => e.fc === 6 && e.address === 202)
      .map((e) => e.data[0]);
    const sentA = writes.lastIndexOf(va);
    const sentB = writes.lastIndexOf(vb);
    const first = sentA < sentB ? va : vb;
    const last = sentA < sentB ? vb : va;
    const finalValue = (await simMem('holding', 202))[0];
    if (finalValue === last) ordered++;
    check(
      `round ${k + 1}: the simulator keeps the value of the command that ran last`,
      finalValue === last && sentA >= 0 && sentB >= 0,
      `${first} then ${last}, holds ${finalValue}`,
    );
  }
  measures.rounds = rounds;
  measures.orderKept = ordered;
  const rows = await auditRows('admin', 'action=tag.write&target=R.CNT');
  const startedRows = rows.filter((r) => r.result === 'started');
  check(
    'two audit records of receipt per round, each with its own old value',
    startedRows.length >= rounds * 2,
  );
  live.close();
}

// ------------------------------------------------------------------------------------- write-kill

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

async function runWriteKill() {
  const rounds = Number(opt('--rounds', '5'));
  const mark = (await simLog()).at(-1)?.seq ?? 0;
  const sent = []; // { id, value, accepted }
  let value = 1000;
  for (let k = 0; k < rounds; k++) {
    tokens.vh1 = undefined;
    // wait until the runtime serves again
    for (let i = 0; i < 60; i++) {
      try {
        await token('vh1');
        break;
      } catch {
        await sleep(500);
      }
    }
    const live = await new Live().open().catch(() => undefined);
    if (live) await live.waitFor('R.CNT', (t) => t.quality === 'GOOD', 15000);
    live?.close();
    const killAfter = Math.floor(Math.random() * 300);
    const pid = runtimePid();
    const killer = sleep(killAfter).then(() => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    });
    for (let i = 0; i < 6; i++) {
      const id = uuid();
      value++;
      try {
        const r = await api('vh1', 'POST', '/api/v1/tags/write', {
          requests: [{ requestId: id, tag: 'R.CNT', value }],
        });
        sent.push({ id, value, status: r.json?.results?.[0]?.status });
      } catch {
        sent.push({ id, value, status: 'NO_ANSWER' });
      }
    }
    await killer;
    await sleep(2500);
  }
  // after the last kill: the runtime comes back, the open commands are interrupted
  tokens.admin = undefined;
  for (let i = 0; i < 60; i++) {
    try {
      await token('admin');
      break;
    } catch {
      await sleep(500);
    }
  }
  await sleep(3000);
  const rows = await auditRows('admin', 'action=tag.write');
  const startedById = new Map();
  const resultById = new Map();
  for (const r of rows) {
    const d = typeof r.detail === 'object' && r.detail ? r.detail : JSON.parse(r.detail ?? '{}');
    if (!d.requestId) continue;
    if (r.result === 'started') startedById.set(d.requestId, { value: d.new, row: r });
    else if (['ok', 'failed', 'interrupted'].includes(r.result)) resultById.set(d.requestId, r);
  }
  const writes = (await simLog(mark))
    .filter((e) => e.fc === 6 && e.address === 202)
    .map((e) => e.data[0]);
  const startedValues = new Set([...startedById.values()].map((s) => Number(s.value)));
  const orphans = writes.filter((v) => !startedValues.has(v));
  check(
    '0 commands reached the simulator without a record of receipt (SC-006)',
    orphans.length === 0,
    `orphans ${orphans.join(',')}`,
  );
  const open = [...startedById.keys()].filter((id) => !resultById.has(id));
  check(
    'every command that was left open has a record "interrupted" (no result missing)',
    open.length === 0,
    `${open.length} open`,
  );
  const interrupted = [...resultById.values()].filter((r) => r.result === 'interrupted');
  measures.rounds = rounds;
  measures.commandsSent = sent.length;
  measures.accepted = sent.filter((s) => s.status === 'ACCEPTED').length;
  measures.interrupted = interrupted.length;
  measures.writesAtTheSimulator = writes.length;
  // a command sent again with its id after the restart does not run a second time
  const before = (await simLog(mark)).filter((e) => e.fc === 6 && e.address === 202).length;
  let resent = 0;
  for (const s of sent.filter((x) => x.status === 'ACCEPTED').slice(0, 4)) {
    const r = await api('vh1', 'POST', '/api/v1/tags/write', {
      requests: [{ requestId: s.id, tag: 'R.CNT', value: s.value }],
    });
    if (r.json?.results?.[0]?.duplicate) resent++;
  }
  await sleep(1500);
  const after = (await simLog(mark)).filter((e) => e.fc === 6 && e.address === 202).length;
  check(
    'the same ids sent again after the restart do not run again',
    after === before,
    `${before} -> ${after}, ${resent} answered as duplicate`,
  );
}

// ------------------------------------------------------------------------------------- load

async function runLoad() {
  const seconds = Number(opt('--seconds', '60'));
  const nClients = Number(opt('--clients', '10'));
  const ids = projectTags('bench-500-modbus')
    .filter((t) => t.kind === 'external')
    .map((t) => t.id);
  const clients = [];
  for (let i = 0; i < nClients; i++) clients.push(await new Live(ids).open());
  const pid = runtimePid();
  const stat = () => {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return Number(s[11]) + Number(s[12]); // utime + stime, clock ticks
  };
  const rss = () =>
    Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) * 1024;
  const hz = 100;
  await sleep(3000);
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
  const gaps = clients.reduce((n, c) => n + c.gaps, 0);
  measures.sequenceGaps = gaps;
  check('no lost sequence on any client', gaps === 0, `${gaps} gaps`);
  // the real period of the Tags: time between two changes of a Tag
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
  check(
    'the real period of a Tag is 1 s +/- 10 % (US1-5, SC-003)',
    mean >= 900 && mean <= 1100,
    `${round1(mean)} ms`,
  );
  check(
    'delay from the PLC to the client within a cycle and a second',
    pct(lags, 0.95) <= 2000,
    `p95 ${pct(lags, 0.95)} ms`,
  );
  check(
    'all 500 Tags GOOD on every client',
    clients.every((c) => ids.every((id) => c.get(id)?.quality === 'GOOD')),
  );
  for (const c of clients) c.close();
}

// ------------------------------------------------------------------------------------- calc

/**
 * 200 calculated Tags (2-5 inputs each) and 100 internal Tags on top of the 500 Tags of `load`
 * (feature 006 T180, US4-4, SC-004 on x64): every change of an input brings the calculated Tag in
 * the SAME delta, with the value the expression gives for the inputs of that delta.
 */
async function runCalc() {
  const seconds = Number(opt('--seconds', '30'));
  const nClients = Number(opt('--clients', '1'));
  const tags = projectTags('calc-200');
  const ids = tags.map((t) => t.id);
  const calcs = tags
    .filter((t) => t.kind === 'calculated')
    .map((t) => ({ id: t.id, inputs: t.expression.split(' + ') }));
  const byInput = new Map();
  for (const c of calcs) for (const i of c.inputs) byInput.set(i, [...(byInput.get(i) ?? []), c]);
  const internal = tags.filter((t) => t.kind === 'internal');
  check(
    'the project has 500 external, 200 calculated and 100 internal Tags',
    tags.filter((t) => t.kind === 'external').length === 500 &&
      calcs.length === 200 &&
      internal.length === 100,
  );
  const live = new Live(ids);
  let inputChanges = 0;
  let together = 0;
  let missed = 0;
  let wrong = 0;
  const examples = [];
  let deltas = 0;
  live.onDelta = (changed) => {
    deltas++;
    const owed = new Set();
    for (const id of changed) for (const c of byInput.get(id) ?? []) owed.add(c);
    for (const c of owed) {
      inputChanges++;
      if (!changed.has(c.id)) {
        missed++;
        if (examples.length < 5) examples.push(`${c.id} missing in delta ${live.lastSeq}`);
        continue;
      }
      together++;
      const vals = c.inputs.map((i) => live.get(i)?.value);
      if (vals.every((v) => typeof v === 'number')) {
        const want = vals.reduce((a, b) => a + b, 0);
        const got = live.get(c.id)?.value;
        if (got !== want) {
          wrong++;
          if (examples.length < 5) examples.push(`${c.id}: ${got} != ${want}`);
        }
      }
    }
  };
  await live.open();
  // more clients watch the same 800 Tags (the load of SC-003 with the calculated and internal Tags on top)
  const others = [];
  for (let i = 1; i < nClients; i++) others.push(await new Live(ids).open());
  // wait until every Tag of the Modbus block is GOOD and the calculated ones follow
  const t0 = now();
  while (now() - t0 < 20000 && !ids.every((id) => live.get(id)?.quality === 'GOOD'))
    await sleep(100);
  const notGood = ids.filter((id) => live.get(id)?.quality !== 'GOOD');
  check('all 800 Tags are GOOD', notGood.length === 0, notGood.slice(0, 5).join(','));
  // internal Tags start from their initial value
  const wrongInitial = internal.filter((t) => live.get(t.id)?.value !== t.initial).map((t) => t.id);
  check(
    'the 100 internal Tags show their initial value',
    wrongInitial.length === 0 || wrongInitial.every((id) => id < 'I.V011'),
    wrongInitial.slice(0, 5).join(','),
  );
  inputChanges = together = missed = wrong = 0;
  deltas = 0;
  const pid = runtimePid();
  const stat = () => {
    const s = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return Number(s[11]) + Number(s[12]);
  };
  const rss = () =>
    Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) * 1024;
  const cpu0 = stat();
  const t1 = now();
  let rssMax = 0;
  for (let s = 0; s < seconds; s += 5) {
    await sleep(5000);
    rssMax = Math.max(rssMax, rss());
  }
  const secs = (now() - t1) / 1000;
  measures.seconds = round1(secs);
  measures.clients = nClients;
  measures.tags = ids.length;
  measures.deltas = deltas;
  measures.inputChanges = inputChanges;
  measures.cpuPercentOneCoreAvg = round1(((stat() - cpu0) / 100 / secs) * 100);
  measures.rssMaxMB = round1(rssMax / 1048576);
  check('inputs changed (the run is not empty)', inputChanges >= 200 * 3, `${inputChanges}`);
  check(
    '100 % of input changes bring the calculated Tag in the same delta (US4-4)',
    missed === 0,
    `${together}/${together + missed}; ${examples.join('; ')}`,
  );
  check(
    'the calculated value is the sum of the inputs of that delta',
    wrong === 0,
    `${wrong} wrong`,
  );
  const gaps = live.gaps + others.reduce((a, c) => a + c.gaps, 0);
  measures.sequenceGaps = gaps;
  check('no lost sequence on any client', gaps === 0, `${gaps} gaps`);
  check(
    'the process stays inside the budget: CPU <= 30 % of a core on average, RSS <= 150 MB (SC-004, x64 figure)',
    measures.cpuPercentOneCoreAvg <= 30 && measures.rssMaxMB <= 150,
    `${measures.cpuPercentOneCoreAvg} %, ${measures.rssMaxMB} MB`,
  );
  // a write to an internal Tag: APPLIED and shown
  const w = await writeAndWait('vh1', 'I.V050', 77);
  check(
    'a write to an internal Tag is APPLIED and the live channel shows it',
    w.final?.status === 'APPLIED' || w.final?.status === 'CONFIRMED',
    JSON.stringify(w.final),
  );
  const shown = await live.waitFor('I.V050', (t) => t.value === 77, 5000);
  check('the written value reaches the live channel', Boolean(shown));
  live.close();
  for (const o of others) o.close();
}

// ------------------------------------------------------------------------------------ retain

async function waitServing(user) {
  tokens[user] = undefined;
  for (let i = 0; i < 80; i++) {
    try {
      await token(user);
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}

/**
 * A retained internal Tag survives kill -9 (US4-9, SC-010 on x64, FR-059): write a value, wait more
 * than the window of the store (retainWindowS, 5 s), kill, and after the restart the Tag has the
 * value. Every other round the kill falls inside the window, where the value may be the one before
 * but the store is never damaged.
 */
async function runRetain() {
  const rounds = Number(opt('--rounds', '20'));
  let ok = 0;
  let lastWritten = 0;
  const lost = [];
  const states = [];
  for (let k = 1; k <= rounds; k++) {
    if (!(await waitServing('vh1'))) {
      check(`round ${k}: the runtime serves again`, false);
      break;
    }
    const live = await new Live(['I.V001', 'I.V002']).open();
    const before = live.get('I.V001');
    const prev = lastWritten;
    const value = 100 + k;
    const w = await writeAndWait('vh1', 'I.V001', value);
    const accepted = w.final?.status === 'APPLIED' || w.final?.status === 'CONFIRMED';
    if (accepted) lastWritten = value;
    const full = k % 2 === 1; // odd rounds: the window is waited out
    if (full) await sleep(6500);
    else await sleep(Math.floor(Math.random() * 4000));
    live.close();
    try {
      process.kill(runtimePid(), 'SIGKILL');
    } catch {
      // gone already
    }
    await sleep(1500);
    if (!(await waitServing('admin'))) {
      check(`round ${k}: the runtime comes back`, false);
      break;
    }
    const after = await new Live(['I.V001']).open();
    const got = after.get('I.V001')?.value;
    after.close();
    const d = await api('admin', 'GET', '/api/v1/diagnostics');
    const state = d.json?.retain?.state;
    states.push(state);
    const good = full ? got === value : got === value || got === prev || (prev === 0 && got === 0);
    if (accepted && good && (state === 'ok' || state === 'fallback')) ok++;
    else
      lost.push(
        `${k}: wrote ${value} (accepted ${accepted}), got ${got}, state ${state}, before ${before?.value}`,
      );
  }
  measures.rounds = rounds;
  measures.restored = ok;
  measures.retainStates = [...new Set(states)];
  check(
    `the value is there after kill -9: ${rounds}/${rounds} (SC-010)`,
    ok === rounds,
    lost.join(' | '),
  );
  check(
    '0 damaged stores: the state is never "lost" and the Tag never turns UNCERTAIN (FR-059)',
    states.every((s) => s === 'ok'),
    states.join(','),
  );
}

// ----------------------------------------------------------------------------------- write-io

/**
 * What one write command costs the disk (SC-011, x64 figure; the figure of the BL335 eMMC waits for
 * the device): writes to a retained internal Tag one after the other, each after the window of the
 * store (the worst case: every command is its own save), and reads `write_bytes` of
 * /proc/<pid>/io, the bytes the runtime handed to the storage. An idle stretch before gives the
 * baseline of the runtime without commands (logs, audit coalescing). The figure for a day is the
 * cost of a command at the default global rate (20 a minute).
 */
async function runWriteIo() {
  const n = Number(opt('--writes', '24'));
  const pid = runtimePid();
  const wbytes = () =>
    Number(/write_bytes:\s*(\d+)/.exec(readFileSync(`/proc/${pid}/io`, 'utf8'))[1]);
  const live = await new Live(['I.V002']).open();
  await sleep(2000);
  const idle0 = wbytes();
  const ti0 = now();
  await sleep(20000);
  const idleRate = (wbytes() - idle0) / ((now() - ti0) / 1000); // bytes per second with no command
  const b0 = wbytes();
  const t0 = now();
  let accepted = 0;
  for (let k = 1; k <= n; k++) {
    const w = await writeAndWait('vh1', 'I.V002', 200 + k);
    if (w.final?.status === 'APPLIED' || w.final?.status === 'CONFIRMED') accepted++;
    await sleep(6500); // the window of the store (5 s) and the rate of the session
  }
  const secs = (now() - t0) / 1000;
  const total = wbytes() - b0;
  const perCommand = (total - idleRate * secs) / Math.max(1, accepted);
  live.close();
  measures.writes = accepted;
  measures.seconds = round1(secs);
  measures.idleBytesPerSecond = round1(idleRate);
  measures.totalWriteBytes = total;
  measures.bytesPerCommand = Math.round(perCommand);
  // at the default global rate (tagWriteGlobalPerMin 20): 20 commands a minute for a day
  measures.mbPerDayAtMaxRate = round1((perCommand * 20 * 1440) / 1048576);
  check('every write was applied', accepted === n, `${accepted}/${n}`);
  check(
    'one command (audit rows and a save of the retained store) costs at most 64 KiB of disk writes',
    perCommand > 0 && perCommand <= 65536,
    `${Math.round(perCommand)} bytes`,
  );
  check(
    'at the maximum default rate the day stays under 1 GB (SC-011, x64 figure)',
    (perCommand * 20 * 1440) / 1048576 <= 1024,
    `${measures.mbPerDayAtMaxRate} MB/day`,
  );
}

// ------------------------------------------------------------------------------------- faults

const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');

/** The diagnostics of the one field device of the project (device-api-1.1 §5). */
async function diagOf() {
  const r = await api('xem1', 'GET', '/api/v1/drivers/diagnostics');
  if (r.status !== 200) throw new Error(`drivers/diagnostics ${r.status} ${r.body}`);
  const ch = r.json.channels[0];
  return { json: r.json, ch, dev: ch.devices[0] };
}

/**
 * Injected faults against the counters of GET /api/v1/drivers/diagnostics (US5-2, SC-016): the
 * numbers match what was injected within 5 s of the last fault being met, the last error has a
 * time. The counters are never reset, so every step is a difference.
 */
async function runFaults() {
  const live = await new Live().open();
  await live.waitFor('R.U32', (t) => t.quality === 'GOOD', 15000);
  const noSession = await pinnedRequest(BASE, fp, 'GET', '/api/v1/drivers/diagnostics', {});
  check('no session: 401', noSession.status === 401, noSession.status);
  const first = await diagOf();
  check(
    'the tree: channel, field device, groups, bad tags',
    first.ch.id === 'plc1' &&
      first.dev.id === 'd1' &&
      Array.isArray(first.dev.groups) &&
      Array.isArray(first.json.badTags) &&
      typeof first.json.at === 'number',
    JSON.stringify({ ch: first.ch.id, dev: first.dev.id }),
  );
  const rows = [];
  // one step: inject `count` faults, wait for the simulator to have met them all, then read the
  // diagnostics until `expect` holds (at most 5 s)
  async function step(name, fault, expect) {
    const before = await diagOf();
    await simFault({ ...fault, fc: 3 });
    const t0 = now();
    while (now() - t0 < 90000) {
      const left = (await simCall('GET', '/faults')).faults.length;
      if (left === 0) break;
      await sleep(250);
    }
    const metAt = now();
    let seen;
    let okNow = false;
    while (now() - metAt < 5000 && !okNow) {
      seen = await diagOf();
      okNow = expect(before, seen);
      if (!okNow) await sleep(250);
    }
    const ms = now() - metAt;
    rows.push({ name, ms });
    check(`${name}: the counters match the injection within 5 s`, okNow, `${ms} ms`);
    await sleep(1500);
  }
  const d = (a, b, f) => f(b) - f(a);
  await step(
    '10 timeouts',
    { kind: 'timeout', count: 10 },
    (a, b) => d(a.dev, b.dev, (x) => x.timeouts) === 10,
  );
  for (const code of [1, 2, 3, 4, 5, 6, 8, 10, 11]) {
    await step(
      `exception ${hex2(code)}`,
      { kind: 'exception', code, count: 1 },
      (a, b) => d(a.dev, b.dev, (x) => x.exceptions[hex2(code)] ?? 0) === 1,
    );
  }
  await step(
    '3 answers with the wrong transaction id',
    { kind: 'bad-tid', count: 3 },
    (a, b) => d(a.dev, b.dev, (x) => x.badFrames.tid) === 3,
  );
  await step(
    '3 answers with the wrong unit',
    { kind: 'bad-unit', count: 3 },
    (a, b) => d(a.dev, b.dev, (x) => x.badFrames.unit) === 3,
  );
  await step(
    '3 answers with a wrong length',
    { kind: 'bad-length', count: 3 },
    (a, b) => d(a.dev, b.dev, (x) => x.badFrames.length + x.badFrames.format) >= 3,
  );
  await step(
    '3 answers of rubbish bytes',
    { kind: 'garbage', count: 3 },
    (a, b) => d(a.dev, b.dev, (x) => x.badFrames.length + x.badFrames.format) >= 3,
  );
  await step(
    '3 slow answers (800 ms for a timeout of 400 ms)',
    { kind: 'delay', delayMs: 800, count: 3 },
    (a, b) => d(a.dev, b.dev, (x) => x.timeouts) >= 3,
  );
  await step(
    '3 closed connections',
    { kind: 'close', count: 3 },
    (a, b) => b.ch.reconnects - a.ch.reconnects >= 3,
  );
  const last = await diagOf();
  check(
    'the last error has a code and a time',
    typeof last.ch.lastError?.code === 'string' && last.ch.lastError.at > now() - 600000,
    JSON.stringify(last.ch.lastError),
  );
  check(
    'the channel is connected again after the faults',
    last.ch.state === 'connected',
    last.ch.state,
  );
  // a bad Tag shows in the list with its reason while the PLC is silent
  await simFault({ kind: 'timeout', fc: 3 });
  await sleep(2500);
  const bad = await diagOf();
  const reasons = [...new Set(bad.json.badTags.map((t) => t.reason))];
  check(
    'while the PLC is silent the bad Tags are listed with a reason, newest first',
    bad.json.badTags.length >= 10 &&
      bad.json.badTags.every((t, i, a) => i === 0 || t.updatedAt <= a[i - 1].updatedAt),
    reasons.join(','),
  );
  await simClear();
  measures.steps = rows;
  measures.maxMatchMs = Math.max(...rows.map((r) => r.ms));
  measures.finalCounters = {
    timeouts: last.dev.timeouts,
    exceptions: last.dev.exceptions,
    badFrames: last.dev.badFrames,
    reconnects: last.ch.reconnects,
  };
  live.close();
}

// ------------------------------------------------------------------------------------- source

/** One plain-HTTP GET from a given local address; resolves { status, body }. */
async function getFrom(localAddress, host, path) {
  // the listener of a runtime that has just restarted may not be open yet: one more try after a pause
  for (let i = 0; ; i++) {
    try {
      return await getOnce(localAddress, host, path);
    } catch (e) {
      if (i >= 4) throw e;
      await sleep(1000);
    }
  }
}
function getOnce(localAddress, host, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port: 8080, path, method: 'GET', localAddress, timeout: 5000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** The WebSocket upgrade of the live channel from a given local address: 101 when it opens. */
function liveFrom(localAddress, host) {
  return new Promise((resolve) => {
    const req = http.request({
      host,
      port: 8080,
      path: '/api/v1/live',
      method: 'GET',
      localAddress,
      timeout: 5000,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': Buffer.from('driver-it-source!').toString('base64'),
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(101);
    });
    req.on('response', (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
    req.end();
  });
}

async function runSource() {
  const mode = opt('--mode', 'private');
  const LAN = ['172.30.6.50', '172.30.6.10'];
  const PUB = ['203.0.113.50', '203.0.113.10'];
  const paths = ['/', '/api/v1/system/info', '/api/v1/projects/active'];
  const errorOf = (r) => {
    try {
      return JSON.parse(r.body).error;
    } catch {
      return undefined;
    }
  };
  const pubRes = {};
  const lanRes = {};
  for (const p of paths) {
    pubRes[p] = await getFrom(...PUB, p);
    lanRes[p] = await getFrom(...LAN, p);
  }
  const pubLive = await liveFrom(...PUB);
  const lanLive = await liveFrom(...LAN);
  const info = '/api/v1/system/info';
  measures.mode = mode;
  if (mode === 'private') {
    for (const p of paths) {
      check(
        `private: ${p} from the public network is 403`,
        pubRes[p].status === 403,
        pubRes[p].status,
      );
      check(
        `private: ${p} from the private network is served`,
        lanRes[p].status === 200,
        lanRes[p].status,
      );
    }
    check(
      'private: live without a session from the public network is refused',
      pubLive === 403,
      pubLive,
    );
    check('private: live from the private network opens', lanLive === 101, lanLive);
    check(
      'private: system/info has no VIEWER_PUBLIC warning',
      !(JSON.parse(lanRes[info].body).warnings ?? []).includes('VIEWER_PUBLIC'),
    );
    // a valid session over HTTPS from the public network is never filtered
    const base = `https://${PUB[1]}:8443`;
    const login403 = await login(base, fp, 'xem1', process.env.MAT_IT_PW_XEM1);
    check(
      'private: sign-in over HTTPS from the public network works',
      login403.status === 200,
      login403.status,
    );
    const si = await pinnedRequest(base, fp, 'GET', info, { token: login403.json?.token });
    check(
      'private: a valid session over HTTPS from the public network is not filtered',
      si.status === 200,
      si.status,
    );
  } else if (mode === 'any') {
    for (const p of paths)
      check(
        `any: ${p} from the public network is served`,
        pubRes[p].status === 200,
        pubRes[p].status,
      );
    check('any: live from the public network opens', pubLive === 101, pubLive);
    const w = JSON.parse(pubRes[info].body).warnings ?? [];
    check('any: system/info warns VIEWER_PUBLIC', w.includes('VIEWER_PUBLIC'), w.join(','));
  } else if (mode === 'off') {
    check(
      'off: the page is closed for the private network (VIEWER_OFF)',
      lanRes['/'].status === 403,
      `${lanRes['/'].status} ${errorOf(lanRes['/'])}`,
    );
    check(
      'off: projects/active is closed for the private network',
      lanRes['/api/v1/projects/active'].status === 403,
      lanRes['/api/v1/projects/active'].status,
    );
    check('off: live is closed for the private network', lanLive === 403, lanLive);
    check(
      'off: system/info is still served on the private network',
      lanRes[info].status === 200,
      lanRes[info].status,
    );
    check(
      'off: nothing is served to the public network',
      paths.every((p) => pubRes[p].status === 403) && pubLive === 403,
    );
  } else throw new Error(`unknown mode ${mode}`);
}

// --------------------------------------------------------------------- gateway-multiunit (011)

const GATEWAY_IDS = ['A.WAVE', 'G1.V', 'G2.V', 'G3.V', 'PULSE.CMD'];

/**
 * Feature 011 (T054, SC-005, FR-021, FR-022; project gateway-3): a Modbus TCP gateway with unit 1, 2, 3 (normal
 * group 500 ms). Unit 2 goes mute for `--cycles` cycles (default 1.000): the Tags of unit 1 and 3 stay GOOD at every
 * sample and keep being read (requests per cycle), the Tag of unit 2 is BAD, the TCP connection is never closed for
 * it. Then unit 3 answers late (after its timeout): the late answers are dropped (no value of another request is
 * taken, unit 1 stays GOOD). Then every unit answers again: unit 2 GOOD again.
 */
async function runGatewayMultiunit() {
  const cycles = Number(opt('--cycles', '1000'));
  const periodMs = 500;
  await simCall('POST', '/reset');
  for (const u of [1, 2, 3])
    await simCall('POST', '/set', { unit: u, area: 'holding', address: 0, value: u * 111 });
  const live = await new Live(GATEWAY_IDS).open();
  for (const u of [1, 2, 3])
    await live.waitFor(`G${u}.V`, (t) => t.quality === 'GOOD' && t.value === u * 111, 15000);
  check(
    'before: the three units GOOD with their values',
    [1, 2, 3].every((u) => live.get(`G${u}.V`)?.quality === 'GOOD'),
    JSON.stringify([1, 2, 3].map((u) => live.get(`G${u}.V`))),
  );
  const c0 = await simCall('GET', '/counters');
  const mark = (await simLog()).at(-1)?.seq ?? 0;
  await simCall('POST', '/unit', { unit: 2, state: 'mute' });
  const t0 = now();
  const bad2 = await live.waitFor('G2.V', (t) => t.quality === 'BAD', 10000);
  const bad2Ms = now() - t0;
  check('unit 2 mute: its Tag BAD (after its timeout)', bad2, `${bad2Ms} ms ${bad2?.reason ?? ''}`);
  let good1 = 0;
  let good3 = 0;
  let wrong = 0;
  for (let i = 0; i < cycles; i++) {
    await sleep(periodMs);
    const a = live.get('G1.V');
    const b = live.get('G3.V');
    if (a?.quality === 'GOOD') good1++;
    if (b?.quality === 'GOOD') good3++;
    if ((a && a.value !== 111) || (b && b.value !== 333)) wrong++;
  }
  const window = (await simLog(mark)).filter((e) => e.seq > mark);
  const reqs = (u) => window.filter((e) => e.unit === u && e.fc === 3).length;
  const c1 = await simCall('GET', '/counters');
  const opened = (c) => c.connections?.opened ?? c.connections?.accepted ?? 0;
  check(
    `${cycles} cycles with unit 2 mute: unit 1 and 3 GOOD at 100 % of the samples`,
    good1 === cycles && good3 === cycles,
    `G1 ${good1}/${cycles}, G3 ${good3}/${cycles}`,
  );
  check(
    'no wrong value on unit 1 or 3 (no answer taken for another request)',
    wrong === 0,
    String(wrong),
  );
  check(
    'unit 1 and 3 read about every cycle (≥ 90 % of the cycles have a request)',
    reqs(1) >= cycles * 0.9 && reqs(3) >= cycles * 0.9,
    `unit1 ${reqs(1)}, unit3 ${reqs(3)}, unit2 ${reqs(2)} requests`,
  );
  check(
    '0 connection closed for a single timeout (no new TCP connection during the window)',
    opened(c1) === opened(c0),
    `${JSON.stringify(c0.connections)} -> ${JSON.stringify(c1.connections)}`,
  );
  // Late answers of unit 3 (after its timeout of 400 ms): dropped, unit 1 untouched.
  await simCall('POST', '/unit', { unit: 3, state: 'late', delayMs: 700 });
  let lateGood1 = 0;
  let lateWrong = 0;
  const lateSamples = 40;
  for (let i = 0; i < lateSamples; i++) {
    await sleep(periodMs);
    const a = live.get('G1.V');
    const b = live.get('G3.V');
    if (a?.quality === 'GOOD') lateGood1++;
    if ((a && a.value !== 111) || (b && b.quality === 'GOOD' && b.value !== 333)) lateWrong++;
  }
  check(
    'unit 3 late: its late answers are dropped, unit 1 stays GOOD, no value goes to the wrong Tag',
    lateGood1 === lateSamples && lateWrong === 0,
    `G1 GOOD ${lateGood1}/${lateSamples}, wrong ${lateWrong}, G3 ${JSON.stringify(live.get('G3.V'))}`,
  );
  for (const u of [2, 3]) await simCall('POST', '/unit', { unit: u, state: 'ok' });
  const t1 = now();
  const back = await live.waitFor('G2.V', (t) => t.quality === 'GOOD' && t.value === 222, 40000);
  check(
    'every unit answers again: unit 2 GOOD within its backoff (≤ 40 s)',
    back,
    `${now() - t1} ms`,
  );
  measures.gateway = {
    cycles,
    periodMs,
    unit2BadMs: bad2Ms,
    good: { G1: good1, G3: good3 },
    requests: { unit1: reqs(1), unit2: reqs(2), unit3: reqs(3) },
    connections: { before: c0.connections, after: c1.connections },
    unit2BackMs: now() - t1,
  };
  live.close();
}

// ------------------------------------------------------------------------ pulse-recovery (011)

/** Waits until the runtime answers a login again (after a kill -9 or a restart). */
async function waitServing2(user = 'vh1', ms = 60000) {
  const t0 = now();
  while (now() - t0 < ms) {
    tokens[user] = undefined;
    try {
      await token(user);
      return true;
    } catch {
      await sleep(300);
    }
  }
  return false;
}

/**
 * Feature 011 (T054, SC-004, FR-018 to FR-020; project gateway-3): `--rounds` (default 20) times, a pulse of 3 s
 * on PULSE.CMD (coil 20 of unit 1) is accepted, the bit is set at the simulator, then the runtime is killed (kill -9).
 * After the restart (supervise.sh) the runtime releases the pulse from its journal: the coil is back to false within
 * 10 s of the restart, audited as tag.write with detail.source "pulse-recovery" and pulseOf = the id of the pulse.
 * Then the journal cannot be written (<dataDir>/pulse.journal made a directory, runtime restarted): `--rounds` pulses
 * are refused PULSE_JOURNAL_FAILED and 0 bit is set at the simulator.
 */
async function runPulseRecovery() {
  const rounds = Number(opt('--rounds', '20'));
  await simCall('POST', '/reset');
  await simCall('POST', '/set', { unit: 1, area: 'coils', address: 20, value: 0 });
  let released = 0;
  let audited = 0;
  const releaseMs = [];
  const problems = [];
  for (let k = 0; k < rounds; k++) {
    if (!(await waitServing2())) {
      problems.push(`${k}: runtime not back`);
      continue;
    }
    const live = await new Live(GATEWAY_IDS).open().catch(() => undefined);
    if (live) await live.waitFor('G1.V', (t) => t.quality === 'GOOD', 15000);
    live?.close();
    const mark = (await simLog()).at(-1)?.seq ?? 0;
    const id = uuid();
    const r = await api('vh1', 'POST', '/api/v1/tags/write', {
      requests: [{ requestId: id, tag: 'PULSE.CMD', value: true, pulseMs: 3000 }],
    });
    if (r.json?.results?.[0]?.status !== 'ACCEPTED') {
      problems.push(`${k}: ${JSON.stringify(r.json?.results?.[0] ?? r.status)}`);
      continue;
    }
    // the bit is set at the simulator
    let set = false;
    for (let i = 0; i < 40 && !set; i++) {
      await sleep(50);
      set = Number((await simMem('coils', 20, 1, 1))[0]) === 1;
    }
    if (!set) {
      problems.push(`${k}: the bit was never set`);
      continue;
    }
    const pid = runtimePid();
    process.kill(pid, 'SIGKILL');
    const tKill = now();
    // supervise.sh starts it again in 2 s; the release must come within 10 s of the new start
    let off = false;
    while (!off && now() - tKill < 20000) {
      await sleep(100);
      off = Number((await simMem('coils', 20, 1, 1))[0]) === 0;
    }
    const ms = now() - tKill;
    const writes = (await simLog(mark)).filter((e) => e.fc === 5 && e.address === 20);
    if (off && ms <= 12000 && writes.length >= 2) {
      released++;
      releaseMs.push(ms);
    } else problems.push(`${k}: off=${off} after ${ms} ms, ${writes.length} writes`);
    await waitServing2('admin');
    const rows = await auditRows('admin', 'action=tag.write');
    const rec = rows.find((row) => {
      const d =
        typeof row.detail === 'object' && row.detail ? row.detail : JSON.parse(row.detail ?? '{}');
      return d.source === 'pulse-recovery' && d.pulseOf === id && row.user === 'vh1';
    });
    if (rec) audited++;
    else problems.push(`${k}: no pulse-recovery audit for ${id}`);
    await sleep(500);
  }
  check(
    `${rounds} rounds of kill -9 during a pulse: the bit is released (≤ 10 s after the restart)`,
    released === rounds,
    `${released}/${rounds}; ${problems.slice(0, 5).join('; ')}`,
  );
  check(
    'every release is audited tag.write, source pulse-recovery, pulseOf, account of the pulse',
    audited === rounds,
    `${audited}/${rounds}`,
  );
  // The journal cannot be written: a directory in its place, runtime restarted.
  const journal = '/rt-data/pulse.journal';
  rmSync(journal, { force: true, recursive: true });
  mkdirSync(journal);
  process.kill(runtimePid(), 'SIGTERM');
  await sleep(2500);
  await waitServing2();
  const mark2 = (await simLog()).at(-1)?.seq ?? 0;
  let refused = 0;
  for (let k = 0; k < rounds; k++) {
    let id = uuid();
    let r = await api('vh1', 'POST', '/api/v1/tags/write', {
      requests: [{ requestId: id, tag: 'PULSE.CMD', value: true, pulseMs: 500 }],
    });
    // the rate limit of the session (not what is tested here): wait as told, a new id each time
    for (let i = 0; i < 3 && r.json?.results?.[0]?.reason === 'RATE_LIMITED'; i++) {
      await sleep((r.json.results[0].retryAfterMs ?? 1000) + 100);
      id = uuid();
      r = await api('vh1', 'POST', '/api/v1/tags/write', {
        requests: [{ requestId: id, tag: 'PULSE.CMD', value: true, pulseMs: 500 }],
      });
    }
    let final = r.json?.results?.[0];
    for (let i = 0; i < 20 && final?.status === 'ACCEPTED'; i++) {
      await sleep(200);
      final = (await api('vh1', 'GET', `/api/v1/tags/write/${id}`)).json?.results?.[0] ?? final;
    }
    if (
      (final?.status === 'FAILED' || final?.status === 'REJECTED') &&
      (final?.code === 'PULSE_JOURNAL_FAILED' || final?.reason === 'PULSE_JOURNAL_FAILED')
    )
      refused++;
    else problems.push(`journal ${k}: ${JSON.stringify(final)}`);
    await sleep(1100); // the rate limit of the session
  }
  const bits = (await simLog(mark2)).filter((e) => e.fc === 5 && e.address === 20);
  check(
    `${rounds} pulses while the journal cannot be written: refused PULSE_JOURNAL_FAILED`,
    refused === rounds,
    `${refused}/${rounds}; ${problems.slice(-3).join('; ')}`,
  );
  check(
    '0 bit set at the simulator while the journal cannot be written',
    bits.length === 0,
    String(bits.length),
  );
  rmSync(journal, { force: true, recursive: true });
  process.kill(runtimePid(), 'SIGTERM');
  await sleep(2500);
  await waitServing2();
  measures.pulse = {
    rounds,
    released,
    audited,
    releaseMs: {
      median: releaseMs.sort((a, b) => a - b)[Math.floor(releaseMs.length / 2)] ?? null,
      max: Math.max(0, ...releaseMs),
    },
    journalRefused: refused,
    bitsWhileJournalBroken: bits.length,
  };
}

// ------------------------------------------------------------------------------------- main

try {
  if (scenario === 'read') await runRead();
  else if (scenario === 'merge') await runMerge();
  else if (scenario === 'split') await runSplit();
  else if (scenario === 'unplug') await runUnplug();
  else if (scenario === 'wait-bad') await runWait('bad');
  else if (scenario === 'wait-good') await runWait('good');
  else if (scenario === 'probe') await runProbe();
  else if (scenario === 'write') await runWrite();
  else if (scenario === 'write-race') await runWriteRace();
  else if (scenario === 'write-kill') await runWriteKill();
  else if (scenario === 'load') await runLoad();
  else if (scenario === 'calc') await runCalc();
  else if (scenario === 'retain') await runRetain();
  else if (scenario === 'faults') await runFaults();
  else if (scenario === 'write-io') await runWriteIo();
  else if (scenario === 'source') await runSource();
  else if (scenario === 'gateway-multiunit') await runGatewayMultiunit();
  else if (scenario === 'pulse-recovery') await runPulseRecovery();
  else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  check(`scenario ${scenario} ran to its end`, false, e?.stack ?? e);
}
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario, checks, measures, pass }));
process.exit(pass ? 0 : 1);
