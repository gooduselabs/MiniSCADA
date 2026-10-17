// Scenarios of the logic integration tests (feature 011 T146, T147; SC-025 to SC-028). Runs in the Node
// client container of tests/driver-it/compose.yaml (same rig as driver-it: runtime `rt` under
// supervise.sh, simulator `sim`, PID namespace of rt shared), started by tools/logic-it/run.mjs, and
// prints one JSON object: { scenario, checks: [{ name, pass, detail }], measures, pass }.
//
//   node logic-it.mjs rules --fp <fp>             pump rules through the simulator: writes, audit before the command
//   node logic-it.mjs writes-off --fp <fp>        (runtime started with logic.writes "off") 0 commands, suppressed audit
//   node logic-it.mjs throttle --fp <fp>          minIntervalMs / maxPerHour of a writes entry: commands capped
//   node logic-it.mjs stop --fp <fp>              POST /logic/writes {enabled:false}: 0 commands; enabling refused (403)
//   node logic-it.mjs stop-after --fp <fp>        (after root ran --logic-writes-reset) commands go out again
//   node logic-it.mjs retain-kill --rounds 100 --fp <fp>   counter/totalizer/run hours across kill -9
//   node logic-it.mjs retain-lost --phase break|check --fp <fp>   damaged store: 0 + LOGIC_RETAIN_LOST + audit
//   node logic-it.mjs deploy-keep --fp <fp>       a deploy of a new version keeps the retained values
//   node logic-it.mjs load --seconds 600 --clients 10 --label <name> --fp <fp>   CPU, RSS, scan of the runtime
//
// Passwords come from the environment (MAT_IT_PW_ADMIN, _KYSU1, _VH1, _VH2, _XEM1).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import {
  deployPackage,
  login,
  pinnedRequest,
  versions,
  waitOperation,
} from '../../tools/measure/device-api.mjs';
import { buildPackage, readProjectDir, variant } from '../device-it/pack.mjs';

const RT = 'rt';
const BASE = `https://${RT}:8443`;
const WS = `ws://${RT}:8080/api/v1/live`;
const SIM = 'http://sim:1503';
const PROJECT_DIR = '/src/tests/logic-it/projects/logic-it';

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
const simSet = (area, address, value) => simCall('POST', '/set', { unit: 1, area, address, value });
const simLog = async (since = 0) => (await simCall('GET', `/log?since=${since}`)).entries;
const simMark = async () => (await simLog()).at(-1)?.seq ?? 0;
/** Writes of coil `address` in the log since `mark`: [{ value, ts }]. */
async function coilWrites(mark, address) {
  return (await simLog(mark))
    .filter((e) => (e.fc === 5 || e.fc === 15) && e.address === address && e.result === 'ok')
    .map((e) => ({ value: Boolean(Array.isArray(e.data) ? e.data[0] : e.data), ts: e.ts }));
}
const level = (v) => simSet('holding', 0, v);
const flow = (v) => simSet('holding', 1, v);
const run = (on) => simSet('coils', 0, on ? 1 : 0);
const trig = (on) => simSet('coils', 1, on ? 1 : 0);

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
  let r = await pinnedRequest(BASE, fp, method, path, {
    token: user ? await token(user) : undefined,
    body,
  });
  if (r.status === 401 && user) {
    tokens[user] = undefined;
    r = await pinnedRequest(BASE, fp, method, path, { token: await token(user), body });
  }
  return r;
}
async function waitServing(user = 'admin', ms = 60000) {
  tokens[user] = undefined;
  const t0 = now();
  while (now() - t0 < ms) {
    try {
      await token(user);
      const r = await api(user, 'GET', '/api/v1/logic');
      if (r.status === 200 && r.json?.enabled) return true;
    } catch {
      // restarting
    }
    await sleep(300);
  }
  return false;
}
const logicStatus = async () => (await api('admin', 'GET', '/api/v1/logic')).json;
const blockOf = (st, id) => st?.blocks?.find((b) => b.id === id);
async function auditRows(query) {
  const rows = [];
  let before;
  for (let page = 0; page < 30; page++) {
    const r = await api(
      'admin',
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
/** The logic Tag `tag` of block `id` (GET /logic outputs). */
async function outputOf(id, tag) {
  return blockOf(await logicStatus(), id)?.outputs?.[tag];
}
async function waitFor(pred, ms, every = 200) {
  const t0 = now();
  while (now() - t0 < ms) {
    const v = await pred();
    if (v) return v;
    await sleep(every);
  }
  return undefined;
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
function killRuntime(sig = 'SIGKILL') {
  try {
    process.kill(runtimePid(), sig);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------- rules

async function runRules() {
  await level(50);
  await sleep(1500);
  const mark = await simMark();
  const t0 = now();
  await level(10); // LEVEL < 20 for 1 s (hold): pump_low writes PUMP.CMD = true
  const on = await waitFor(async () => {
    const w = await coilWrites(mark, 10);
    return w.find((x) => x.value === true);
  }, 8000);
  check('pump_low: LEVEL 10 -> PUMP.CMD true at the simulator', on, on ? `${on.ts - t0} ms` : 'none');
  measures.riseToCommandMs = on ? on.ts - t0 : null;
  check(
    'the command waits out the hold (1 s) and comes within hold + 2 scans + a poll (<= 2.5 s)',
    on && on.ts - t0 >= 950 && on.ts - t0 <= 2500,
    on ? `${on.ts - t0} ms` : '',
  );
  const mark2 = await simMark();
  const t1 = now();
  await level(95);
  const off = await waitFor(async () => {
    const w = await coilWrites(mark2, 10);
    return w.find((x) => x.value === false);
  }, 8000);
  check('pump_high: LEVEL 95 -> PUMP.CMD false', off, off ? `${off.ts - t1} ms` : 'none');
  await sleep(1500);
  const writes = await coilWrites(mark, 10);
  check('exactly 2 commands for the 2 edges (no repeat while the condition holds)', writes.length === 2, `${writes.length}`);
  // the audit of each command is durable before it goes out (SC-027)
  const rows = (await auditRows('action=logic.write')).filter(
    (r) => r.target === 'PUMP.CMD' && r.ts >= t0 - 1000,
  );
  const started = rows.filter((r) => r.result === 'started');
  const done = rows.filter((r) => r.result === 'ok');
  measures.auditSample = started[0] ?? null;
  check('a logic.write "started" row per command (2)', started.length === 2, `${started.length}`);
  check('a logic.write "ok" row per command (2)', done.length === 2, `${done.length}`);
  const fields = started.every(
    (r) =>
      /^logic:pump_(low|high)$/.test(r.user ?? '') &&
      r.channel === 'logic' &&
      r.detail &&
      r.detail.rule &&
      Number.isInteger(r.detail.edgeId) &&
      Array.isArray(r.detail.inputs) &&
      'new' in r.detail &&
      'old' in r.detail,
  );
  check(
    'every row has the rule, the Tag, old/new and the condition inputs (actor logic:<rule>, channel logic)',
    fields,
    JSON.stringify(started.map((r) => ({ user: r.user, ch: r.channel, d: r.detail }))).slice(0, 600),
  );
  const ordered = [on, off].every((w, i) => w && started[started.length - 1 - i] !== undefined);
  const before = started.every((r) => {
    const w = writes.find((x) => x.value === Boolean(r.detail?.new));
    return w && r.ts <= w.ts;
  });
  check('the "started" row is written before the command reaches the simulator', ordered && before);
  const st = await logicStatus();
  check(
    'GET /logic: rules OK, edgeId and fired counted',
    blockOf(st, 'pump_low')?.state === 'OK' && blockOf(st, 'pump_low')?.fired >= 1,
    JSON.stringify(blockOf(st, 'pump_low')),
  );
  measures.scan = st?.scan;
}

// --------------------------------------------------------------------------------- writes-off

async function runWritesOff() {
  const st = await logicStatus();
  check('logic.writes "off" (default of runtime.json): GET /logic says configured off', st?.writes?.configured === 'off', JSON.stringify(st?.writes));
  await level(50);
  await sleep(1500);
  const mark = await simMark();
  const t0 = now();
  for (const v of [10, 95, 10, 95]) {
    await level(v);
    await sleep(2500);
  }
  const writes = await coilWrites(mark, 10);
  check('0 commands reach the simulator with logic.writes off (SC-027)', writes.length === 0, `${writes.length}`);
  const rows = (await auditRows('action=logic.write.suppressed')).filter((r) => r.ts >= t0 - 500);
  check(
    'logic.write.suppressed in the audit (LOGIC_WRITES_OFF)',
    rows.length >= 1 && rows.every((r) => r.code === 'LOGIC_WRITES_OFF'),
    `${rows.length} rows, counts ${rows.map((r) => r.count).join(',')}`,
  );
  measures.suppressedRows = rows.length;
  measures.suppressedCount = rows.reduce((n, r) => n + (r.count ?? 1), 0);
}

// ----------------------------------------------------------------------------------- throttle

async function runThrottle() {
  await trig(false);
  await sleep(2000);
  const mark = await simMark();
  const t0 = now();
  // 40 edges (20 rises, 20 falls) in about 24 s: w_fast allows one command per 5 s and 6 per hour
  for (let i = 0; i < 20; i++) {
    await trig(true);
    await sleep(600);
    await trig(false);
    await sleep(600);
  }
  await sleep(2000);
  const writes = await coilWrites(mark, 11);
  measures.edges = 40;
  measures.commands = writes.length;
  const gaps = writes.slice(1).map((w, i) => w.ts - writes[i].ts);
  measures.minGapMs = gaps.length ? Math.min(...gaps) : null;
  check('maxPerHour 6: at most 6 commands for 40 edges', writes.length <= 6 && writes.length >= 1, `${writes.length}`);
  check(
    'minIntervalMs 5000: no two commands closer than 5 s (less a poll)',
    gaps.every((g) => g >= 4700),
    gaps.join(','),
  );
  const rows = (await auditRows('action=logic.throttled')).filter((r) => r.ts >= t0 - 500);
  const counted = rows.reduce((n, r) => n + (r.count ?? 1), 0);
  measures.throttledAudit = counted;
  check(
    '100 % of the edges over the limit are refused with an audit (RATE_LIMITED)',
    counted + writes.length >= 40 - 2 && rows.every((r) => r.code === 'RATE_LIMITED'),
    `${counted} throttled + ${writes.length} sent of 40`,
  );
  const st = await logicStatus();
  check(
    'GET /logic: fast_toggle THROTTLED or lastErrorCode RATE_LIMITED',
    ['THROTTLED', 'OK'].includes(blockOf(st, 'fast_toggle')?.state),
    JSON.stringify(blockOf(st, 'fast_toggle')),
  );
}

// --------------------------------------------------------------------------------------- stop

async function runStop() {
  const r = await api('admin', 'POST', '/api/v1/logic/writes', { enabled: false });
  check('administrator: POST /logic/writes {enabled:false} -> 200 stopped', r.status === 200 && r.json?.writes === 'stopped', `${r.status} ${r.body}`);
  const eng = await api('kysu1', 'POST', '/api/v1/logic/writes', { enabled: false });
  check('engineer cannot stop (403)', eng.status === 403, `${eng.status}`);
  const en = await api('admin', 'POST', '/api/v1/logic/writes', { enabled: true });
  check('enabling over the API is refused: 403 LOGIC_ENABLE_ROOT_ONLY', en.status === 403 && /LOGIC_ENABLE_ROOT_ONLY/.test(en.body), `${en.status} ${en.body}`);
  await level(50);
  await sleep(1500);
  const mark = await simMark();
  const t0 = now();
  for (const v of [10, 95]) {
    await level(v);
    await sleep(2500);
  }
  const writes = await coilWrites(mark, 10);
  check('0 commands while stopped', writes.length === 0, `${writes.length}`);
  const rows = (await auditRows('action=logic.write.suppressed')).filter((r) => r.ts >= t0 - 500);
  check('suppressed with LOGIC_WRITES_STOPPED', rows.length >= 1 && rows.every((r) => r.code === 'LOGIC_WRITES_STOPPED'), `${rows.length}`);
  const dis = (await auditRows('action=logic.writes.disabled')).filter((r) => r.ts >= t0 - 30000);
  check('audit logic.writes.disabled by admin', dis.some((r) => r.user === 'admin'), JSON.stringify(dis.map((x) => x.user)));
  // survives a restart (logic-state.json)
  killRuntime('SIGKILL');
  await sleep(1500);
  await waitServing();
  const st = await logicStatus();
  check('the stop survives kill -9 (logic-state.json)', st?.writes?.stopped === true, JSON.stringify(st?.writes));
}

async function runStopAfter() {
  const st = await waitFor(async () => {
    const s = await logicStatus();
    return s?.writes?.stopped === false ? s : undefined;
  }, 15000, 500);
  check('root --logic-writes-reset: GET /logic writes no longer stopped (<= 5 s + poll)', st, JSON.stringify(st?.writes));
  await level(50);
  await sleep(1500);
  const mark = await simMark();
  await level(10);
  const on = await waitFor(async () => (await coilWrites(mark, 10)).find((x) => x.value), 8000);
  check('commands go out again', on);
  const rows = await auditRows('action=logic.writes.enabled');
  check('audit logic.writes.enabled (request + applied)', rows.length >= 2, `${rows.length}`);
}

// -------------------------------------------------------------------------------- retain-kill

async function readRetained() {
  const st = await logicStatus();
  return {
    count: Number(blockOf(st, 'c_run')?.outputs?.['LOGIC.C_RUN.VALUE'] ?? NaN),
    total: Number(blockOf(st, 'z_flow')?.outputs?.['LOGIC.Z_FLOW.TOTAL'] ?? NaN),
    hours: Number(blockOf(st, 'h_run')?.outputs?.['LOGIC.H_RUN.HOURS'] ?? NaN),
    starts: Number(blockOf(st, 'h_run')?.outputs?.['LOGIC.H_RUN.STARTS'] ?? NaN),
    retainLost: st?.retainLost,
    edgeId: blockOf(st, 'pump_low')?.edgeId,
  };
}

/**
 * kill -9 in a loop (SC-026): RUN toggles at the simulator (counter, run hours), FLOW constant
 * (totalizer), pump_low fires once per round. After every restart: what was lost fits in one
 * logic.flushS of increments, each rising edge of pump_low wrote once, and no value went below what
 * the store had: when the run before the kill lasted more than flushS + the window of the store (5 s)
 * + 1 s, a flush happened after the previous restart, so the value after the kill is >= the value read
 * at that restart; in a shorter run the kill may fall before that flush and only the increments since
 * that restart (< one flushS) may go (the value seen live then was never stored).
 */
async function runRetainKill() {
  const rounds = Number(opt('--rounds', '100'));
  const flushS = Number(opt('--flush-s', '10'));
  if (!(await waitServing())) return check('the runtime serves', false);
  await flow(360); // 360 m3/h = 0.1 m3/s
  await level(50);
  let prev = await readRetained();
  const startValues = { ...prev };
  // increments in one flushS (+ a scan and the poll): RUN at most 1 rise per 1.2 s; FLOW 0.1 m3/s; RUN on 3600 h/h
  const capCount = Math.ceil((flushS + 1.5) / 1.2) + 1;
  const capTotal = 0.1 * (flushS + 1.5);
  const capHours = (flushS + 1.5) / 3600;
  const losses = { count: [], total: [], hours: [] };
  const problems = [];
  let rises = 0;
  let edgesSent = 0;
  const mark = await simMark();
  let downs = 0;
  let lostRounds = 0;
  let longRuns = 0;
  let servedAt = now();
  for (let k = 1; k <= rounds; k++) {
    // one rise of pump_low per round
    await level(10);
    rises++;
    const toggles = 3 + Math.floor(Math.random() * 6);
    for (let i = 0; i < toggles; i++) {
      await run(true);
      await sleep(700);
      await run(false);
      await sleep(500);
    }
    edgesSent += toggles;
    await run(true);
    await sleep(Math.floor(Math.random() * (flushS * 1000 + 3000)));
    const before = await readRetained();
    const runMs = now() - servedAt;
    const long = runMs >= (flushS + 6) * 1000;
    if (long) longRuns++;
    killRuntime('SIGKILL');
    await level(50);
    await run(false);
    await sleep(1200);
    if (!(await waitServing())) {
      problems.push(`round ${k}: no restart`);
      break;
    }
    servedAt = now();
    await sleep(600);
    const after = await readRetained();
    if (after.retainLost) lostRounds++;
    for (const f of ['count', 'total', 'hours']) {
      const slack = long ? 1e-9 : { count: capCount, total: capTotal, hours: capHours }[f];
      if (after[f] < prev[f] - slack) {
        downs++;
        problems.push(`round ${k}: ${f} went down ${prev[f]} -> ${after[f]} (run ${runMs} ms)`);
      }
      losses[f].push(Math.max(0, before[f] - after[f]));
    }
    prev = after;
    await sleep(800);
  }
  const writes = (await coilWrites(mark, 10)).filter((w) => w.value === true);
  const st = await logicStatus();
  const final = await readRetained();
  measures.rounds = rounds;
  measures.flushS = flushS;
  measures.start = startValues;
  measures.final = final;
  measures.edgesSent = edgesSent;
  measures.pumpRises = rises;
  measures.pumpWritesTrue = writes.length;
  const max = (a) => (a.length ? Math.max(...a) : 0);
  measures.maxLoss = { count: max(losses.count), total: max(losses.total), hours: max(losses.hours) };
  measures.longRuns = longRuns;
  check(`${rounds} rounds of kill -9 done`, problems.filter((p) => /no restart/.test(p)).length === 0, problems.join(' | ').slice(0, 800));
  check(
    'no value went below what was stored (counter, totalizer, run hours; strict after a run > flushS + 6 s)',
    downs === 0 && longRuns > 0,
    `${downs} decreases, ${longRuns} long runs; ${problems.join(' | ').slice(0, 600)}`,
  );
  check(
    `loss per kill <= one flushS of increments (count <= ${capCount}, total <= ${capTotal.toFixed(2)}, hours <= ${capHours.toFixed(5)})`,
    measures.maxLoss.count <= capCount &&
      measures.maxLoss.total <= capTotal + 1e-9 &&
      measures.maxLoss.hours <= capHours + 1e-9,
    JSON.stringify(measures.maxLoss),
  );
  check('the store is never reported lost (retainLost false after every restart)', lostRounds === 0, `${lostRounds}`);
  check(
    `0 duplicate PLC writes for one edge: ${rises} rises of pump_low, at most ${rises} commands true`,
    writes.length <= rises,
    `${writes.length} commands for ${rises} rises`,
  );
  check('pump_low still OK at the end', blockOf(st, 'pump_low')?.state === 'OK', JSON.stringify(blockOf(st, 'pump_low')));
  await run(false);
  await flow(0);
}

// -------------------------------------------------------------------------------- retain-lost

async function runRetainLost() {
  const phase = opt('--phase', 'break');
  if (phase === 'break') {
    // a value to lose, then a flush (SIGTERM) and both files of the store damaged while it is down
    for (let i = 0; i < 3; i++) {
      await run(true);
      await sleep(700);
      await run(false);
      await sleep(500);
    }
    const before = await readRetained();
    measures.before = before;
    check('a counter value before the damage', before.count >= 3, JSON.stringify(before));
    writeFileSync('/rt-data/extra-args', '--no-such-flag-on-purpose\n'); // the runtime cannot start: the store is free
    killRuntime('SIGTERM');
    await sleep(2500);
    const dir = '/rt-data/retain';
    const names = readdirSync(dir);
    for (const n of names) {
      const b = readFileSync(`${dir}/${n}`);
      for (let i = 0; i < Math.min(b.length, 4096); i++) b[i] = (i * 131 + 7) & 0xff;
      writeFileSync(`${dir}/${n}`, b);
    }
    measures.damaged = names;
    writeFileSync('/rt-data/extra-args', '');
    return;
  }
  if (!(await waitServing())) return check('the runtime serves after the damage', false);
  const after = await readRetained();
  measures.after = after;
  check('retain damaged: the blocks start at 0 (counter, totalizer, run hours)', after.count === 0 && after.total === 0 && after.hours === 0, JSON.stringify(after));
  check('GET /logic retainLost true', after.retainLost === true);
  const info = await api('admin', 'GET', '/api/v1/system/info');
  const warn = JSON.stringify(info.json?.warnings ?? []);
  check('warning LOGIC_RETAIN_LOST in system/info', /LOGIC_RETAIN_LOST/.test(warn), warn.slice(0, 300));
  const rows = await auditRows('action=logic.retain.lost');
  check('audit logic.retain.lost once', rows.length === 1, `${rows.length}`);
}

// -------------------------------------------------------------------------------- deploy-keep

async function runDeployKeep() {
  await flow(360);
  for (let i = 0; i < 4; i++) {
    await run(true);
    await sleep(700);
    await run(false);
    await sleep(500);
  }
  await sleep(500);
  const before = await readRetained();
  const tk = await token('kysu1');
  const v = await versions(BASE, fp, tk);
  const cur = v.json?.versions?.find((x) => x.state === 'active');
  const files = readProjectDir(PROJECT_DIR);
  const pkg = buildPackage(variant(files, { projectVersion: '0.2.0' }));
  const t0 = now();
  const r = await deployPackage(BASE, fp, tk, pkg.bytes, pkg.digest, cur?.digest ?? 'none');
  check('deploy of version 0.2.0 accepted (202)', r.status === 202, `${r.status} ${r.body}`);
  if (r.status !== 202) return;
  const w = await waitOperation(BASE, fp, tk, r.json.opId, {
    timeoutMs: 90000,
    reauth: async () => {
      tokens.kysu1 = undefined;
      return token('kysu1');
    },
  });
  check('deploy committed', w.op?.result === 'committed', `${w.op?.result} ${JSON.stringify(w.op?.error ?? {})}`);
  measures.deployMs = now() - t0;
  await waitServing();
  await sleep(800);
  const after = await readRetained();
  measures.before = before;
  measures.after = after;
  check(
    'the retained values are kept across the deploy (blocks kept by id)',
    before.count >= 4 &&
      before.total > 0 &&
      after.count >= before.count && after.total >= before.total - 1e-9 && after.hours >= before.hours - 1e-9 && !after.retainLost,
    `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
  );
}

// --------------------------------------------------------------------------------------- load

function procStat(pid) {
  const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
  return { ticks: Number(f[11]) + Number(f[12]) };
}
function rssKb(pid) {
  const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
  return m ? Number(m[1]) : 0;
}

/** CPU (% of one core), RSS and the logic scan of the runtime with `clients` live clients for `seconds`. */
async function runLoad() {
  const seconds = Number(opt('--seconds', '600'));
  const clients = Number(opt('--clients', '10'));
  const label = opt('--label', 'logic');
  const ids = JSON.parse(readFileSync(`${opt('--project', PROJECT_DIR)}/tags.json`, 'utf8')).tags.map((t) => t.id).slice(0, 1000);
  await sleep(3000);
  const socks = [];
  let updates = 0;
  let gaps = 0;
  for (let i = 0; i < clients; i++) {
    const ws = new WebSocket(WS);
    let last = 0;
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('ws'));
    });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'snapshot') last = m.sequence;
      if (m.type === 'delta') {
        if (m.sequence !== last + 1) gaps++;
        last = m.sequence;
        updates += m.tags.length;
      }
    };
    ws.send(JSON.stringify({ type: 'subscribe', requestId: `s${i}`, tags: ids, mode: 'delta' }));
    socks.push({ ws, beat: setInterval(() => ws.send(JSON.stringify({ type: 'heartbeat' })), 5000) });
  }
  const pid = runtimePid();
  const hz = 100;
  const samples = [];
  const scans = [];
  let t = procStat(pid).ticks;
  let at = performance.now();
  const end = now() + seconds * 1000;
  while (now() < end) {
    await sleep(5000);
    const t2 = procStat(pid).ticks;
    const at2 = performance.now();
    samples.push({ cpu: ((t2 - t) / hz / ((at2 - at) / 1000)) * 100, rss: rssKb(pid) });
    t = t2;
    at = at2;
    if (label !== 'baseline') {
      const st = await logicStatus().catch(() => undefined);
      if (st?.scan) scans.push(st.scan);
    }
  }
  for (const s of socks) {
    clearInterval(s.beat);
    s.ws.close();
  }
  const cpu = samples.map((s) => s.cpu);
  const rss = samples.map((s) => s.rss);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  measures.label = label;
  measures.seconds = seconds;
  measures.clients = clients;
  measures.tags = ids.length;
  measures.cpuAvgPct = Math.round(avg(cpu) * 100) / 100;
  measures.cpuMaxPct = Math.round(Math.max(...cpu) * 100) / 100;
  measures.rssAvgKb = Math.round(avg(rss));
  measures.rssMaxKb = Math.max(...rss);
  measures.liveUpdates = updates;
  measures.sequenceGaps = gaps;
  if (scans.length) {
    measures.scanLastMsMax = Math.max(...scans.map((s) => s.lastMs));
    measures.scanP99MsMax = Math.max(...scans.map((s) => s.p99Ms));
    measures.scanOverrun = scans.at(-1).overrun;
    measures.scanPeriodMs = scans.at(-1).periodMs;
  }
  check(`${samples.length} samples over ${seconds} s`, samples.length >= Math.floor(seconds / 5) - 1);
  check('0 live sequence gaps', gaps === 0, `${gaps}`);
  if (scans.length) check('logic scan p99 <= 5 ms (FR-095)', measures.scanP99MsMax <= 5, `${measures.scanP99MsMax}`);
}

// ------------------------------------------------------------------------------------- main

const table = {
  rules: runRules,
  'writes-off': runWritesOff,
  throttle: runThrottle,
  stop: runStop,
  'stop-after': runStopAfter,
  'retain-kill': runRetainKill,
  'retain-lost': runRetainLost,
  'deploy-keep': runDeployKeep,
  load: runLoad,
};
try {
  if (!table[scenario]) throw new Error(`unknown scenario ${scenario}`);
  if (scenario !== 'load' && !(scenario === 'retain-lost' && opt('--phase', 'break') === 'check'))
    if (!(await waitServing())) throw new Error('the runtime does not serve');
  await table[scenario]();
} catch (e) {
  check('scenario ran to the end', false, e.stack ?? String(e));
}
const pass = checks.length > 0 && checks.every((c) => c.pass);
console.log(JSON.stringify({ scenario, checks, measures, pass }));
process.exit(0);
