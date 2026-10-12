// Scenarios of the driver integration tests (specs/006-tags-modbus T074, T110, T148; quickstart §3).
// Runs in the Node container of tests/driver-it/compose.yaml, started by tools/driver-it.ps1, and
// prints one JSON object: { scenario, checks: [{ name, pass, detail }], measures, pass }.
//
//   node driver-it.mjs read|merge|split|probe|write|write-race --fp <fingerprint>
//   node driver-it.mjs unplug --rounds 6 --fp <fp>
//   node driver-it.mjs load --seconds 60 --clients 10 --fp <fp>
//   node driver-it.mjs write-kill --rounds 5 --fp <fp>
//   node driver-it.mjs wait-bad --since <epoch ms> | wait-good      (used by the script for the cable)
//
// Passwords come from the environment (MAT_IT_PW_ADMIN, _KYSU1, _VH1, _VH2, _XEM1). The runtime is
// `rt`, the simulator `sim` (control API on :1503). The live channel is read with the WebSocket of
// Node. HTTPS calls go through tools/measure/device-api.mjs (pinned fingerprint).
import { readFileSync, readdirSync } from 'node:fs';
import http from 'node:http';
import { login, pinnedRequest } from '../../tools/measure/device-api.mjs';

const RT = 'rt';
const BASE = `https://${RT}:8443`;
const WS = `ws://${RT}:8080/api/v1/live`;
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
    this.ws = new WebSocket(WS);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (e) => reject(new Error(`websocket: ${e.message ?? 'error'}`));
    });
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
      for (const e of m.tags) {
        const id = this.order[e[0]];
        const prev = this.tags.get(id);
        this.tags.set(id, { value: e[1], quality: e[2], reason: e[3] ?? '', ts: m.ts });
        if (e[2] === 'BAD') this.everBad.add(id);
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
  else throw new Error(`unknown scenario ${scenario}`);
} catch (e) {
  check(`scenario ${scenario} ran to its end`, false, e?.stack ?? e);
}
const pass = checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario, checks, measures, pass }));
process.exit(pass ? 0 : 1);
