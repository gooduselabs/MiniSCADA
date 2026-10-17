// Reduced x64 load runs of feature 011 (T075 L1, L3, L4, L5, L8; T078 L6; contracts/test-protocols.md §1) in Docker:
// the runtime x64 under supervise.sh on the rig of tests/web-it/compose.yaml (its own slot: compose project
// mat-load-x64, networks 172.30.47.0/24 and 203.0.47.0/24, ports 127.0.0.1:38080/38443), project
// projects/soak-standard (500 Tag, tools/gen-bench-projects.mjs; generated into <build dir>/bench-projects).
//
//   node tools/load/x64.mjs [--scenario L1,L3,L4,L5,L8,L6] [--build-dir <dir>] [--l1-seconds 3600] [--rounds 50]
//        [--flap 50] [--flap-off-s 10] [--keep]
//
//   L1  load-tester 10 clients x 500 Tag (ws 8080) for --l1-seconds, --latency; CPU/RSS of mat-runtime sampled every 5 s
//       from the client container (tests/web-it/proc-sample.mjs, % of one core); diagnostics liveLagP95Ms at the end
//   L3  10 clients held, 50 successive extra clients: close 4429 each
//   L4  tests/web-it/f5-storm.mjs on the host: 10 Chrome headless pages, F5 together, --rounds rounds, screen 250 items
//   L5  tests/web-it/svg-load.mjs (fake runtime of the e2e, real page): 400 SVG elements, 50 animations, 10 pages, 60 s
//   L8  40 silent TLS connections from the lan address of the client container, then a login from its pub address
//   L6  (T078) load-tester -flap --flap -flap-mode external in a container of its own on the lan network; this script
//       cuts it off the network (docker network disconnect) for --flap-off-s and connects it again, --flap times
// Needs: the runtime in <build dir>/x64/bin (Release), the load-tester for Linux in <build dir>/tools/load-tester
// (GOOS=linux GOARCH=<arch of Docker> CGO_ENABLED=0 go build), apps/runtime-web/dist-device (npm run build:web) and,
// for L5, apps/runtime-web/dist-e2e (npx vite build --mode e2e); Chrome in CHROME_PATH.
// Results: docs/reports/011-load-x64.json (one key per scenario) and docs/reports/011-flap-x64.json (L6).
// Numbers are of Linux in Docker on the dev machine, never of the BL335.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { login, pinnedRequest } from '../measure/device-api.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (n) => argv.includes(n);
const scenarios = opt('--scenario', 'L1,L3,L4,L5,L8').split(',');
const buildRoot = process.env.MAT_BUILD_ROOT ?? join(homedir(), 'build');
const buildDir = resolve(opt('--build-dir', join(buildRoot, 'mat-x64-e2')));
const l1Seconds = Number(opt('--l1-seconds', '3600'));
const rounds = opt('--rounds', '50');
const flapN = Number(opt('--flap', '50'));
const flapOffS = Number(opt('--flap-off-s', '10'));
const compose = join(root, 'tests/web-it/compose.yaml');
const project = 'mat-load-x64';
const rt = `${project}-rt-1`;
const client = `${project}-client-1`;
const env = {
  MAT_IT_BUILD: buildDir,
  MAT_IT_PROJECT: '/build/bench-projects/soak-standard',
  MAT_IT_LAN: '172.30.47',
  MAT_IT_PUB: '203.0.47',
  MAT_IT_HTTP_PORT: '38080',
  MAT_IT_HTTPS_PORT: '38443',
  MAT_IT_SIM_PORT: '38503',
};
const BASE = `https://127.0.0.1:${env.MAT_IT_HTTPS_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...o, env: { ...process.env, ...env, ...(o.env ?? {}) } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const docker = (a, o) => sh('docker', a, o);
const pw = [...randomBytes(24)].map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 57]).join('');
const arch = docker(['run', '--rm', 'mat-armhf', 'uname', '-m']).out.trim();
const machine = `${sh('uname', ['-sm']).out.trim()}; Docker mat-armhf ${arch} (Linux ${arch} on Apple Silicon, not a real x64; the numbers are not BL335 numbers)`;

async function startRig() {
  docker(['compose', '-f', compose, '-p', project, 'down', '-v']);
  const up = docker(['compose', '-f', compose, '-p', project, 'up', '-d']);
  if (up.code) throw new Error(`compose up: ${up.err}`);
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    if (docker(['exec', rt, 'grep', '-q', 'https ok on :8443', '/logs/runtime.log']).code === 0) break;
    await sleep(500);
  }
  const add = docker(['exec', '-e', 'MAT_IT_PW_ADMIN', rt, 'sh', '/src/tests/device-it/add-user.sh', 'admin', 'administrator', 'MAT_IT_PW_ADMIN'], { env: { MAT_IT_PW_ADMIN: pw } });
  if (add.code) throw new Error(`user-add: ${add.err}`);
  const f = docker(['exec', rt, '/build/x64/bin/mat-runtime', '--cert-fingerprint', '--data-dir', '/data']).out;
  const fp = /Fingerprint=([0-9A-Fa-f:]+)/.exec(f)?.[1].replace(/:/g, '').toLowerCase();
  if (!fp) throw new Error('fingerprint');
  docker(['cp', join(buildDir, 'tools/load-tester'), `${client}:/tmp/load-tester`]);
  await sleep(3000);
  return fp;
}
const stopRig = () => {
  if (!flag('--keep')) docker(['compose', '-f', compose, '-p', project, 'down', '-v']);
};
async function diag(fp) {
  const l = await login(BASE, fp, 'admin', pw);
  const d = await pinnedRequest(BASE, fp, 'GET', '/api/v1/diagnostics', { token: l.json?.token });
  return d.json;
}
const catJson = (container, path) => {
  try {
    return JSON.parse(docker(['exec', container, 'cat', path]).out);
  } catch {
    return null;
  }
};
const lastJsonLine = (text) => {
  const l = text.split('\n').filter((x) => x.trim().startsWith('{')).at(-1);
  return l ? JSON.parse(l) : null;
};
function spawnAsync(cmd, args, o = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { ...o, env: { ...process.env, ...env, ...(o.env ?? {}) } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

const reportPath = join(root, 'docs/reports/011-load-x64.json');
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : {};
report.task = 'T075 (FR-044; SC-011 x64 part)';
report.machine = machine;
report.runner = 'tools/load/x64.mjs';
report.project = 'projects/soak-standard (tools/gen-bench-projects.mjs): 450 simulation + 50 calculated Tags, 200 logged by change';
report.scenarios = report.scenarios ?? {};
const save = () => writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

let failed = 0;
try {
  mkdirSync(join(buildDir, 'bench-projects'), { recursive: true });
  sh('node', [join(root, 'tools/gen-bench-projects.mjs'), '--out', join(buildDir, 'bench-projects'), '--only', 'soak-standard']);
  const needRig = scenarios.some((s) => ['L1', 'L3', 'L4', 'L8', 'L6'].includes(s));
  const fp = needRig ? await startRig() : '';
  for (const s of scenarios) {
    console.log(`--- ${s}`);
    const startedAt = new Date().toISOString();
    let res;
    if (s === 'L1') {
      docker(['exec', '-d', client, 'sh', '-c', `node /src/tests/web-it/proc-sample.mjs --seconds ${l1Seconds} --interval 5 > /tmp/proc-l1.json 2>&1`]);
      const lt = docker(['exec', client, '/tmp/load-tester', '-host', 'rt', '-port', '8080', '-tags', '500', '-clients', '10', '-extra', '1', '-duration', String(l1Seconds), '-latency', '-out', '/tmp/l1.json']);
      await sleep(8000);
      const proc = catJson(client, '/tmp/proc-l1.json');
      const l1 = catJson(client, '/tmp/l1.json');
      const d = await diag(fp).catch(() => null);
      const lost = l1?.summary?.totalSeqGaps ?? l1?.summary?.seqGaps ?? null;
      res = {
        startedAt,
        seconds: l1Seconds,
        loadTester: l1 ? { scenario: l1.scenario, config: l1.config, summary: l1.summary, latency: l1.latency, checks: l1.checks, notMeasured: l1.notMeasured, pass: l1.pass } : { error: lt.err.slice(-500) },
        runtime: proc,
        liveLagP95Ms: d?.liveLagP95Ms ?? null,
        checks: [
          { name: 'load-tester L1 checks (10 clients, client 11 refused, 0 sequence loss)', pass: Boolean(l1?.pass), detail: JSON.stringify(l1?.checks ?? []).slice(0, 600) },
          { name: 'mat-runtime RSS max <= 150 MB', pass: proc?.rssMaxMB != null && proc.rssMaxMB <= 150, detail: `${proc?.rssMaxMB} MB` },
          { name: 'mat-runtime CPU avg <= 30 % of one core (x64 Docker, not BL335)', pass: proc?.cpuAvgPct != null && proc.cpuAvgPct <= 30, detail: `${proc?.cpuAvgPct} %` },
          { name: 'mat-runtime CPU peak (5 s window) <= 60 % of one core', pass: proc?.cpuMaxWindowPct != null && proc.cpuMaxWindowPct <= 60, detail: `${proc?.cpuMaxWindowPct} %` },
          { name: 'the runtime did not restart', pass: proc && !proc.runtimeGone },
        ],
        notMeasured: ['wss8443Alternation (load-tester opens ws:// 8080 only)', 'CPU of the whole machine (only mat-runtime, % of one core)'],
        sequenceGaps: lost,
      };
    } else if (s === 'L3') {
      docker(['exec', client, '/tmp/load-tester', '-host', 'rt', '-port', '8080', '-tags', '500', '-clients', '10', '-extra', '1', '-extra-attempts', '50', '-duration', '120', '-out', '/tmp/l3.json']);
      const l3 = catJson(client, '/tmp/l3.json');
      res = { startedAt, l3: l3?.l3 ?? null, summary: l3?.summary ?? null, checks: l3?.checks ?? [{ name: 'load-tester ran', pass: false }], notMeasured: l3?.notMeasured ?? [] };
    } else if (s === 'L4') {
      const r = await spawnAsync('node', [join(root, 'tests/web-it/f5-storm.mjs'), '--base', BASE, '--pages', '10', '--rounds', rounds, '--screen', 'tong-quan', '--items', '250']);
      const j = lastJsonLine(r.out);
      res = j ? { startedAt, ...j } : { startedAt, checks: [{ name: 'f5-storm ran', pass: false, detail: (r.out + r.err).slice(-1500) }] };
    } else if (s === 'L5') {
      const r = await spawnAsync('node', [join(root, 'tests/web-it/svg-load.mjs'), '--elements', '400', '--animations', '50', '--pages', '10', '--seconds', '60']);
      const j = lastJsonLine(r.out);
      res = j ? { startedAt, ...j } : { startedAt, checks: [{ name: 'svg-load ran', pass: false, detail: (r.out + r.err).slice(-1500) }] };
    } else if (s === 'L8') {
      const r = docker(['exec', '-e', 'MAT_IT_PW_ADMIN', client, 'node', '--no-warnings', '/src/tests/load-x64/l8.mjs', '--fp', fp, '--silent', '40'], { env: { MAT_IT_PW_ADMIN: pw } });
      const j = lastJsonLine(r.out);
      res = j ? { startedAt, ...j } : { startedAt, checks: [{ name: 'l8 ran', pass: false, detail: (r.out + r.err).slice(-1500) }] };
    } else if (s === 'L6') {
      res = await runFlap(fp);
    } else throw new Error(`unknown scenario ${s}`);
    res.pass = (res.checks ?? []).length > 0 && res.checks.every((c) => c.pass);
    if (!res.pass) failed++;
    const bad = (res.checks ?? []).filter((c) => !c.pass);
    console.log(`${s}: ${(res.checks ?? []).length} checks, ${bad.length} failed`);
    for (const b of bad) console.log(`  FAIL ${b.name}: ${b.detail ?? ''}`);
    if (s === 'L6') {
      const flapPath = join(root, 'docs/reports/011-flap-x64.json');
      writeFileSync(flapPath, `${JSON.stringify({ task: 'T078 (FR-038, L6; SC-015)', machine, runner: 'tools/load/x64.mjs --scenario L6', ...res }, null, 2)}\n`);
    } else {
      report.scenarios[s] = res;
      save();
    }
  }
} finally {
  stopRig();
}
console.log(failed ? `load x64: ${failed} scenario(s) failed` : 'load x64: all scenarios passed');
process.exit(failed ? 1 : 0);

// L6: a load-tester container of its own on the lan network, cut off and connected again --flap times.
async function runFlap() {
  const name = `${project}-flapper`;
  const net = `${project}_lan`;
  const ip = `${env.MAT_IT_LAN}.60`;
  docker(['rm', '-f', name]);
  const c = docker(['run', '-d', '--name', name, '--network', net, '--ip', ip, '-v', `${join(buildDir, 'tools')}:/t:ro`, 'node:22.23.3-alpine', 'sleep', 'infinity']);
  if (c.code) throw new Error(`flapper: ${c.err}`);
  const startedAt = new Date().toISOString();
  const timeout = flapN * (flapOffS + 60) + 120;
  const lt = spawnAsync('docker', ['exec', name, '/t/load-tester', '-host', 'rt', '-port', '8080', '-tags', '500', '-clients', '10', '-extra', '0', '-flap', String(flapN), '-flap-mode', 'external', '-flap-timeout', String(timeout), '-flap-settle', '25', '-out', '/tmp/l6.json']);
  await sleep(8000);
  const cuts = [];
  for (let k = 1; k <= flapN; k++) {
    const t0 = Date.now();
    docker(['network', 'disconnect', net, name]);
    await sleep(flapOffS * 1000);
    docker(['network', 'connect', '--ip', ip, net, name]);
    cuts.push({ cycle: k, cutAt: new Date(t0).toISOString(), offMs: Date.now() - t0 });
    // the sessions notice the cut after 5 s of silence, reconnect, and the old slots of the server free after
    // the heartbeat timeout (15 s): wait well past that before the next cut
    await sleep(45000);
    if (k % 10 === 0) console.log(`  flap ${k}/${flapN}`);
  }
  const r = await lt;
  const l6 = catJson(name, '/tmp/l6.json');
  docker(['rm', '-f', name]);
  const flap = l6?.flap ?? null;
  return {
    startedAt,
    cycles: flapN,
    offS: flapOffS,
    method: 'docker network disconnect/connect of the load-tester container (10 live clients); the runtime side keeps its end until the heartbeat timeout (15 s)',
    flap,
    cutLog: cuts,
    cuts: cuts.length,
    checks: flap
      ? [
          { name: `100 % reconnect (${flap.expected} = 10 clients x ${flapN} cuts)`, pass: flap.reconnects === flap.expected && flap.failed === 0, detail: `${flap.reconnects}/${flap.expected}, failed ${flap.failed}` },
          { name: 'every reconnect <= 35 s (cut included)', pass: flap.overLimit === 0, detail: `over ${flap.overLimit}, p95 ${flap.reconnectMs?.p95Ms} ms, max ${flap.reconnectMs?.maxMs} ms` },
          { name: '0 leaked slot after the run (system/info clients)', pass: flap.slotsMeasured && flap.slotsLeaked === 0, detail: `${flap.slotsOpenAfter}` },
        ]
      : [{ name: 'load-tester -flap ran', pass: false, detail: (r.out + r.err).slice(-1500) }],
  };
}
