// x64 pre-check of the power-cut protocol with `docker kill -s KILL` (feature 011, T074, T077; FR-043, D14, contract
// test-protocols.md §4): the same rounds as tools/powercut/x64-kill.ps1, in Node (macOS without pwsh, CI on Linux).
//
//   node tools/powercut/x64-kill.mjs --container <name> [--rounds 100] [--point-rounds 10] [--points D1,D3,D4,D5]
//        [--base-url https://127.0.0.1:8443] [--runtime /opt/mat-runtime/bin/mat-runtime] [--data-dir /var/lib/mat-runtime]
//        [--command-log <jsonl>] [--out docs/reports/011-powercut-x64.json] [--stable-s 60] [--max-delay-s 300]
//        [--ready-timeout-s 90] [--event-timeout-s 1800] [--retain-period-s 60] [--off-s 5] [--wal-bytes 4194304]
//
// Each round: READY (GET /api/v1/system/info) and stable --stable-s; the kill time (random in [0, --max-delay-s] or the
// event of the point, read inside the container); docker kill -s KILL; --off-s; docker start; READY within
// --ready-timeout-s; no deploy operation left running (<= 90 s); `mat-runtime --check-data --json` (exit 0, or 1 only for pulse.journal or a WAL to recover); every
// requestId logged ACCEPTED in --command-log before the kill is in `mat-runtime --export-audit --format jsonl`. Stops at the first
// failure and keeps the container as it is. Points: D1 a deploy running (the running op of
// <--store-dir, default <data dir>/projects>/ops/*.json; x64-kill.ps1 looked in <data dir>/ops and at finished ops), killed
// 0 to 2.5 s after it is seen so the cut falls on different steps, D3
// history.db-wal > --wal-bytes (4 MiB; SQLite checkpoints at about 1.000 pages, so a WAL rarely passes 4 MiB), D4 pulse.journal not empty, D5 retain/ just written (kill --retain-period-s - U(0,5) s later).
// LIMITATION (in the report): docker kill only kills processes; the kernel of the host still writes the page cache,
// so data not yet fsynced is not lost as on a real power cut. Never against a container you do not own.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const container = opt('--container');
if (!container) {
  console.error('--container is required');
  process.exit(2);
}
const cfg = {
  rounds: Number(opt('--rounds', '100')),
  pointRounds: Number(opt('--point-rounds', '10')),
  points: opt('--points', 'D1,D3,D4,D5').split(',').filter(Boolean),
  baseUrl: opt('--base-url', 'https://127.0.0.1:8443').replace(/\/$/, ''),
  runtime: opt('--runtime', '/opt/mat-runtime/bin/mat-runtime'),
  dataDir: opt('--data-dir', '/var/lib/mat-runtime'),
  storeDir: opt('--store-dir', ''),
  commandLog: opt('--command-log', ''),
  out: opt('--out', 'docs/reports/011-powercut-x64.json'),
  stableS: Number(opt('--stable-s', '60')),
  maxDelayS: Number(opt('--max-delay-s', '300')),
  readyTimeoutS: Number(opt('--ready-timeout-s', '90')),
  eventTimeoutS: Number(opt('--event-timeout-s', '1800')),
  retainPeriodS: Number(opt('--retain-period-s', '60')),
  offS: Number(opt('--off-s', '5')),
  walBytes: Number(opt('--wal-bytes', String(4 * 1024 * 1024))),
};
cfg.storeDir ||= `${cfg.dataDir}/projects`;
const limitation =
  'docker kill -s KILL chỉ giết tiến trình; nhân Linux của máy chủ vẫn ghi page cache xuống đĩa, nên không mô phỏng mất dữ liệu chưa fsync ở tầng đĩa; không thay thế cắt điện thật trên BL335 (FR-043)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const docker = (args) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: r.stderr ?? '' };
};
const execIn = (cmd) => docker(['exec', container, 'sh', '-c', cmd]);

if (docker(['inspect', '-f', '{{.State.Status}}', container]).code !== 0) {
  console.error(`container not found: ${container}`);
  process.exit(2);
}
if (dirname(cfg.out)) mkdirSync(dirname(cfg.out), { recursive: true });
const roundsLog = cfg.out.replace(/\.json$/, '') + '.rounds.jsonl';
writeFileSync(roundsLog, '');

function ready() {
  return new Promise((resolve) => {
    const req = https.get(
      `${cfg.baseUrl}/api/v1/system/info`,
      { rejectUnauthorized: false, timeout: 5000 },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}
async function waitReady(timeoutS) {
  const t0 = now();
  for (;;) {
    if (await ready()) return { ok: true, ms: now() - t0 };
    if (now() - t0 >= timeoutS * 1000) return { ok: false, ms: now() - t0 };
    await sleep(500);
  }
}
async function waitStable() {
  const t0 = now();
  let since = null;
  for (;;) {
    if (await ready()) {
      since ??= now();
      if (now() - since >= cfg.stableS * 1000) return true;
    } else since = null;
    if (now() - t0 >= 900000) return false;
    await sleep(1000);
  }
}

const retainMark = () =>
  execIn(`find '${cfg.dataDir}/retain' -type f -exec stat -c %Y {} + 2>/dev/null | sort -n | tail -n 1`).out;
async function waitEvent(point, round) {
  const t0 = now();
  const steps = ['any'];
  const mark = retainMark();
  while (now() - t0 < cfg.eventTimeoutS * 1000) {
    if (point === 'D1') {
      // an operation of the project store still running, its current step the one of this round
      const step = steps[(round - 1) % steps.length];
      const files = execIn(`grep -l '"result": "running"' '${cfg.storeDir}'/ops/*.json 2>/dev/null | head -n 3`).out;
      for (const f of files.split('\n').filter(Boolean)) {
        let op;
        try {
          op = JSON.parse(execIn(`cat '${f}'`).out);
        } catch {
          continue; // being rewritten
        }
        const cur = (op.steps ?? []).find((x) => x.state === 'running');
        if (cur && (step === 'any' || cur.id === step)) return `deploy ${op.opId} at step ${cur.id}`;
      }
    } else if (point === 'D3') {
      const r = execIn(`stat -c %s '${cfg.dataDir}/history.db-wal' 2>/dev/null`);
      if (/^\d+$/.test(r.out) && Number(r.out) > cfg.walBytes) return `history.db-wal ${r.out} bytes`;
    } else if (point === 'D4') {
      if (execIn(`test -s '${cfg.dataDir}/pulse.journal' && echo yes`).out === 'yes') return 'pulse.journal not empty';
    } else if (point === 'D5') {
      const m = retainMark();
      if (m && m !== mark) return `retain written at ${m}`;
    } else throw new Error(`unknown point ${point}`);
    await sleep(500);
  }
  return null;
}

function accepted() {
  if (!cfg.commandLog || !existsSync(cfg.commandLog)) return null;
  const ids = [];
  for (const l of readFileSync(cfg.commandLog, 'utf8').split('\n')) {
    if (!/\bACCEPTED\b/.test(l)) continue;
    const m = /requestId"?\s*[=:]\s*"?([A-Za-z0-9._-]+)/.exec(l);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}
function exportedIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/requestId"?\s*[=:]\s*"?([A-Za-z0-9._-]+)/g)) ids.add(m[1]);
  return ids;
}
function checkData(text, code) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, reason: `check-data: not JSON (exit ${code})` };
  }
  if (j.schema !== 'mat-check-data/1') return { ok: false, reason: 'check-data: wrong schema' };
  if (j.exitCode !== code) return { ok: false, reason: `check-data: exit ${code} differs from exitCode ${j.exitCode}` };
  if (code === 0 && j.result === 'ok') return { ok: true, acceptedWarnings: [] };
  const problems = (j.checks ?? []).filter((c) => ['warning', 'damaged'].includes(c.status));
  if (code === 1 && j.result === 'warning') {
    const bad = problems.filter(
      (c) => !(c.status === 'warning' && (c.name === 'pulse.journal' || (/\.db$/.test(c.name) && /\bwal\b/.test(String(c.detail ?? ''))))),
    );
    if (!bad.length) return { ok: true, acceptedWarnings: problems.map((c) => c.name) };
    return { ok: false, reason: `check-data: warnings not accepted: ${bad.map((c) => `${c.name} (${c.status}: ${c.detail ?? ''})`).join(', ')}` };
  }
  return { ok: false, reason: `check-data: exit ${code}, ${j.result}: ${problems.map((c) => `${c.name} ${c.status} (${c.detail ?? ''})`).join(', ')}` };
}

const plan = [];
for (let i = 0; i < cfg.rounds; i++) plan.push('random');
for (const p of cfg.points) for (let i = 0; i < cfg.pointRounds; i++) plan.push(p);
const rounds = [];
let failure = null;
const startedAt = new Date().toISOString();
const perPointIndex = {};
let n = 0;
for (const point of plan) {
  n++;
  perPointIndex[point] = (perPointIndex[point] ?? 0) + 1;
  const r = { round: n, point, startedAt: new Date().toISOString() };
  let fail = null;
  if (!(await waitStable())) fail = `not READY and stable ${cfg.stableS} s before the kill`;
  if (!fail) {
    if (point === 'random') r.cutDelayMs = Math.floor(Math.random() * (cfg.maxDelayS * 1000 + 1));
    else {
      const ev = await waitEvent(point, perPointIndex[point]);
      if (!ev) fail = `event ${point} not seen in ${cfg.eventTimeoutS} s`;
      else {
        r.event = ev;
        // D5: before the next write of the store; D1: 0 to 2.5 s into the running deploy (the steps after the one seen:
        // validate, backup, activate with its restart, health)
        r.cutDelayMs =
          point === 'D5'
            ? Math.floor(cfg.retainPeriodS * 1000 - Math.random() * 5001)
            : point === 'D1'
              ? Math.floor(Math.random() * 2500)
              : 0;
      }
    }
  }
  if (!fail) {
    await sleep(Math.max(0, r.cutDelayMs));
    r.cutAt = new Date().toISOString();
    docker(['kill', '-s', 'KILL', container]);
    const acc = accepted();
    await sleep(cfg.offS * 1000);
    if (docker(['inspect', '-f', '{{.State.Status}}', container]).out !== 'running') docker(['start', container]);
    r.readyAfter = await waitReady(cfg.readyTimeoutS);
    if (!r.readyAfter.ok) fail = `not READY within ${cfg.readyTimeoutS} s after the restart`;
    if (!fail) {
      // a deploy cut in the middle is finished or rolled back by the runtime at its start (boot decision, health):
      // check-data runs once no operation is left running (it reports a running one as a warning), at most 90 s
      const t0 = now();
      while (now() - t0 < 90000 && execIn(`grep -l '"result": "running"' '${cfg.storeDir}'/ops/*.json 2>/dev/null`).out) await sleep(500);
      r.pendingOpMs = now() - t0;
      const c = execIn(`${cfg.runtime} --check-data --json --data-dir ${cfg.dataDir}`);
      r.check = { ...checkData(c.out, c.code), exitCode: c.code };
      if (!r.check.ok) fail = r.check.reason;
    }
    if (!fail) {
      if (acc) {
        const ex = exportedIds(execIn(`${cfg.runtime} --export-audit --format jsonl --data-dir ${cfg.dataDir}`).out);
        const missing = acc.filter((id) => !ex.has(id));
        r.audit = { status: missing.length ? 'fail' : 'pass', accepted: acc.length, exported: ex.size, missing };
        if (missing.length) fail = `audit: ${missing.length} ACCEPTED requestId missing from audit.db`;
      } else r.audit = { status: 'not-measured', detail: 'no --command-log' };
    }
  }
  r.ok = !fail;
  if (fail) r.failure = fail;
  rounds.push(r);
  appendFileSync(roundsLog, `${JSON.stringify(r)}\n`);
  console.log(`round ${n}/${plan.length} ${point}: ${fail ? `FAILED: ${fail}` : 'ok'}${r.readyAfter ? ` (ready ${r.readyAfter.ms} ms)` : ''}`);
  if (fail) {
    failure = { round: n, point, reason: fail };
    break;
  }
}
const auditNm = rounds.filter((r) => r.audit?.status === 'not-measured').length;
const result = failure ? 'fail' : auditNm > 0 || rounds.length < plan.length ? 'incomplete' : 'pass';
const perPoint = {};
for (const r of rounds) {
  perPoint[r.point] ??= { run: 0, ok: 0 };
  perPoint[r.point].run++;
  if (r.ok) perPoint[r.point].ok++;
}
const readyMs = rounds.filter((r) => r.readyAfter?.ok).map((r) => r.readyAfter.ms).sort((a, b) => a - b);
const summary = {
  schema: 'mat-powercut/1',
  target: 'x64',
  driver: 'docker-kill',
  container,
  config: cfg,
  startedAt,
  finishedAt: new Date().toISOString(),
  roundsPlanned: plan.length,
  roundsRun: rounds.length,
  roundsOk: rounds.filter((r) => r.ok).length,
  stoppedOnFailure: Boolean(failure),
  failure,
  result,
  readyAfterMs: {
    max: readyMs.at(-1) ?? null,
    median: readyMs.length ? readyMs[Math.floor(readyMs.length / 2)] : null,
    limit: cfg.readyTimeoutS * 1000,
  },
  perPoint,
  auditNotMeasuredRounds: auditNm,
  limitations: [limitation],
  rounds,
};
writeFileSync(cfg.out, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`result: ${result} -> ${cfg.out}`);
if (failure) {
  console.log('STOPPED: the container is kept as it is for the investigation (no fix, no further kill).');
  process.exit(1);
}
process.exit(result === 'incomplete' ? 3 : 0);
