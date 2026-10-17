// Driver of the accelerated x64 soak S0 (feature 011 T076; FR-039; contracts/test-protocols.md §2): runs detached in
// the client container of the soak rig (tests/web-it/compose.yaml, PID namespace of rt shared), started by
// tools/soak/x64-soak.mjs. For --hours:
//   - reduced L1: tools/load-tester 10 clients x 500 Tag (ws 8080) in segments that end before each kill;
//   - kill -9 of mat-runtime every --kill-min minutes (supervise.sh starts it again after 2 s);
//   - a deploy of the project (a new projectVersion, account kysu1, MAT_IT_PW_KYSU1) every --deploy-h hours, right
//     after a restart;
// and writes one JSON line per event to <--dir>/driver.jsonl (segment results, kills, restarts, deploys), then
// <--dir>/done.json. mat-sample.sh samples the runtime from inside rt (/data/mat-sample).
//   node x64-driver.mjs --fp <fp> [--hours 24] [--kill-min 30] [--deploy-h 2] [--dir /rt-data/soak]
//        [--project /build/bench-projects/soak-standard]
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { deployPackage, login, versions, waitOperation } from '../../tools/measure/device-api.mjs';
import { buildPackage, readProjectDir, variant } from '../device-it/pack.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const fp = opt('--fp', '');
const hours = Number(opt('--hours', '24'));
const killMin = Number(opt('--kill-min', '30'));
const deployH = Number(opt('--deploy-h', '2'));
const dir = opt('--dir', '/rt-data/soak');
const projectDir = opt('--project', '/build/bench-projects/soak-standard');
const BASE = 'https://rt:8443';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(dir, { recursive: true });
const log = (o) => appendFileSync(`${dir}/driver.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), ...o })}\n`);

function runtimePid() {
  for (const d of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      if (readFileSync(`/proc/${d}/cmdline`, 'utf8').startsWith('/build/x64/bin/mat-runtime')) return Number(d);
    } catch {
      // gone
    }
  }
  return 0;
}
async function waitServing(ms = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch('http://rt:8080/api/v1/system/info');
      if (r.ok) return Date.now() - t0;
    } catch {
      // restarting
    }
    await sleep(500);
  }
  return null;
}
function loadSegment(seconds, n) {
  return new Promise((resolve) => {
    const out = `${dir}/load-${String(n).padStart(3, '0')}.json`;
    const p = spawn('/tmp/load-tester', ['-host', 'rt', '-port', '8080', '-tags', '500', '-clients', '10', '-extra', '0', '-duration', String(seconds), '-latency', '-out', out]);
    p.stdout.resume();
    p.stderr.resume();
    p.on('close', (code) => {
      let r = null;
      try {
        r = JSON.parse(readFileSync(out, 'utf8'));
      } catch {
        // no result
      }
      resolve({ code, out, summary: r?.summary ?? null, latency: r?.latency?.relative ?? null, pass: r?.pass ?? false });
    });
  });
}
let deploys = 0;
async function deploy() {
  const pw = process.env.MAT_IT_PW_KYSU1;
  const l = await login(BASE, fp, 'kysu1', pw);
  const token = l.json?.token;
  const v = await versions(BASE, fp, token);
  const cur = v.json?.versions?.find((x) => x.state === 'active');
  deploys++;
  const pkg = buildPackage(variant(readProjectDir(projectDir), { projectVersion: `0.1.${deploys}` }));
  const t0 = Date.now();
  const r = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, cur?.digest ?? 'none');
  if (r.status !== 202) return { ok: false, status: r.status, body: r.body.slice(0, 300) };
  const w = await waitOperation(BASE, fp, token, r.json.opId, {
    timeoutMs: 120000,
    reauth: async () => (await login(BASE, fp, 'kysu1', pw)).json?.token,
  });
  return { ok: w.op?.result === 'committed', result: w.op?.result, error: w.op?.error?.code ?? null, ms: Date.now() - t0, version: `0.1.${deploys}` };
}

const start = Date.now();
const end = start + hours * 3600_000;
log({ event: 'start', hours, killMin, deployH, pid: runtimePid() });
let cycle = 0;
let kills = 0;
let segments = 0;
let segmentsPassed = 0;
let lastDeployAt = start;
try {
  await waitServing();
  while (Date.now() < end) {
    cycle++;
    const cycleEnd = Math.min(end, start + cycle * killMin * 60_000);
    if (Date.now() - lastDeployAt >= deployH * 3600_000) {
      const d = await deploy().catch((e) => ({ ok: false, error: String(e) }));
      lastDeployAt = Date.now();
      log({ event: 'deploy', ...d });
      const back = await waitServing();
      log({ event: 'serving', afterDeployMs: back });
    }
    const seconds = Math.floor((cycleEnd - Date.now()) / 1000) - 20;
    if (seconds > 30) {
      const s = await loadSegment(seconds, ++segments);
      if (s.pass) segmentsPassed++;
      log({ event: 'segment', n: segments, seconds, ...s });
    }
    while (Date.now() < cycleEnd) await sleep(1000);
    if (Date.now() >= end) break;
    const pid = runtimePid();
    try {
      process.kill(pid, 'SIGKILL');
      kills++;
      log({ event: 'kill', pid, kills });
    } catch (e) {
      log({ event: 'kill-failed', pid, error: String(e) });
    }
    await sleep(1500);
    const back = await waitServing();
    log({ event: 'serving', afterKillMs: back, pid: runtimePid() });
  }
} catch (e) {
  log({ event: 'error', error: e.stack ?? String(e) });
}
const done = { event: 'done', hours, startedAt: new Date(start).toISOString(), finishedAt: new Date().toISOString(), kills, deploys, segments, segmentsPassed };
log(done);
writeFileSync(`${dir}/done.json`, `${JSON.stringify(done, null, 2)}\n`);
