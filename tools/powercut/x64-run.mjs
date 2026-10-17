// x64 power-cut pre-check, the whole run (feature 011 T077; FR-043, SC-014; contract test-protocols.md §4): a container
// of its own (mat-powercut-x64: the runtime x64 under tests/device-it/supervise.sh, no other process shares its PID
// namespace, so `docker kill -s KILL` takes the whole "device"), project projects/soak-standard plus one retained
// internal Tag CMD.SP (writes, D5) — 500 Tag, 200 logged by change (D3) —, a command generator in this process
// (operator vh1 writes CMD.SP every --write-ms and logs every ACCEPTED requestId to <build dir>/powercut/commands.jsonl;
// engineer kysu1 deploys a new projectVersion every --deploy-s so D1 has deploy steps), and tools/powercut/x64-kill.mjs
// with that command log for the audit cross-check.
//   node tools/powercut/x64-run.mjs [--rounds 100] [--point-rounds 10] [--points D1,D3,D5] [--stable-s 10]
//        [--max-delay-s 60] [--build-dir <dir>] [--out docs/reports/011-powercut-x64.json] [--keep]
// D4 (pulse.journal not empty) needs an external Tag on a Modbus PLC with a pulse command: not in this rig (the report
// says so). Passwords are random per run (docker exec -e, --password-stdin).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployPackage, login, pinnedRequest, versions } from '../measure/device-api.mjs';
import { buildPackage, readProjectDir, variant } from '../../tests/device-it/pack.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const buildRoot = process.env.MAT_BUILD_ROOT ?? join(homedir(), 'build');
const buildDir = resolve(opt('--build-dir', join(buildRoot, 'mat-x64-e2')));
const work = join(buildDir, 'powercut');
const name = 'mat-powercut-x64';
const port = opt('--port', '58443');
const BASE = `https://127.0.0.1:${port}`;
const writeMs = Number(opt('--write-ms', '3000'));
const deployS = Number(opt('--deploy-s', '45'));
const out = resolve(opt('--out', join(root, 'docs/reports/011-powercut-x64.json')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c, a, o = {}) => {
  const r = spawnSync(c, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...o, env: { ...process.env, ...(o.env ?? {}) } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const secret = () => [...randomBytes(24)].map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 57]).join('');
const pw = { MAT_IT_PW_VH1: secret(), MAT_IT_PW_KYSU1: secret() };

// the project: soak-standard + CMD.SP (internal, RW, retained)
mkdirSync(work, { recursive: true });
sh('node', [join(root, 'tools/gen-bench-projects.mjs'), '--out', join(work, 'projects'), '--only', 'soak-standard']);
const pdir = join(work, 'projects/soak-standard');
const tags = JSON.parse(readFileSync(join(pdir, 'tags.json'), 'utf8'));
tags.tags.push({ id: 'CMD.SP', kind: 'internal', type: 'FLOAT64', access: 'RW', initial: 0, retain: true });
writeFileSync(join(pdir, 'tags.json'), `${JSON.stringify(tags, null, 2)}\n`);
const cmdLog = join(work, 'commands.jsonl');
const pauseFile = join(work, 'pause');
writeFileSync(cmdLog, '');

sh('docker', ['rm', '-f', name]);
sh('docker', ['volume', 'rm', '-f', `${name}-data`]);
const run = sh('docker', [
  'run', '-d', '--name', name, '-e', 'MAT_IT_PROJECT=/build/powercut/projects/soak-standard',
  '-v', `${root}:/src:ro`, '-v', `${buildDir}:/build:ro`, '-v', `${name}-data:/data`, '-p', `127.0.0.1:${port}:8443`,
  'mat-armhf', 'sh', '/src/tests/device-it/supervise.sh', '--no-discovery',
]);
if (run.code) throw new Error(run.err);
for (let i = 0; i < 120; i++) {
  if (sh('docker', ['exec', name, 'grep', '-q', 'https ok on :8443', '/logs/runtime.log']).code === 0) break;
  await sleep(500);
}
for (const [u, role, v] of [['vh1', 'operator', 'MAT_IT_PW_VH1'], ['kysu1', 'engineer', 'MAT_IT_PW_KYSU1']]) {
  const r = sh('docker', ['exec', '-e', v, name, 'sh', '/src/tests/device-it/add-user.sh', u, role, v], { env: pw });
  if (r.code) throw new Error(`user-add ${u}: ${r.err}`);
}
const fpOut = sh('docker', ['exec', name, '/build/x64/bin/mat-runtime', '--cert-fingerprint', '--data-dir', '/data']).out;
const fp = /Fingerprint=([0-9A-Fa-f:]+)/.exec(fpOut)?.[1].replace(/:/g, '').toLowerCase();

let stop = false;
const stats = { writesSent: 0, accepted: 0, errors: 0, deploys: 0, deploysAccepted: 0 };
async function tokenOf(user) {
  const r = await login(BASE, fp, user, pw[`MAT_IT_PW_${user.toUpperCase()}`], { timeoutMs: 4000 });
  return r.status === 200 ? r.json.token : null;
}
async function writer() {
  let token = null;
  let v = 0;
  while (!stop) {
    try {
      token ??= await tokenOf('vh1');
      if (token) {
        const requestId = randomUUID();
        stats.writesSent++;
        const r = await pinnedRequest(BASE, fp, 'POST', '/api/v1/tags/write', {
          token,
          timeoutMs: 4000,
          body: { requests: [{ requestId, tag: 'CMD.SP', value: ++v }] },
        });
        if (r.status === 401) token = null;
        const st = r.json?.results?.[0]?.status;
        if (st === 'ACCEPTED') stats.accepted++;
        appendFileSync(cmdLog, `${JSON.stringify({ at: new Date().toISOString(), requestId, status: st ?? `HTTP ${r.status}` })}\n`);
      }
    } catch {
      stats.errors++;
      token = null;
    }
    await sleep(writeMs);
  }
}
async function deployer() {
  const files = readProjectDir(pdir);
  let token = null;
  let n = 0;
  while (!stop) {
    await sleep(deployS * 1000);
    if (existsSync(pauseFile)) continue; // x64-kill is checking the round after a kill
    try {
      token ??= await tokenOf('kysu1');
      if (!token) continue;
      const v = await versions(BASE, fp, token, { timeoutMs: 4000 });
      if (v.status === 401) {
        token = null;
        continue;
      }
      const cur = v.json?.versions?.find((x) => x.state === 'active');
      const pkg = buildPackage(variant(files, { projectVersion: `0.1.${++n}` }));
      stats.deploys++;
      const r = await deployPackage(BASE, fp, token, pkg.bytes, pkg.digest, cur?.digest ?? 'none', { timeoutMs: 10000 });
      if (r.status === 202) stats.deploysAccepted++;
      if (r.status === 401) token = null;
    } catch {
      token = null;
    }
  }
}
const bg = [writer(), deployer()];
await sleep(15000);
const killArgs = [
  join(root, 'tools/powercut/x64-kill.mjs'), '--container', name, '--rounds', opt('--rounds', '100'),
  '--point-rounds', opt('--point-rounds', '10'), '--points', opt('--points', 'D1,D3,D5'), '--base-url', BASE,
  '--runtime', '/build/x64/bin/mat-runtime', '--data-dir', '/data', '--command-log', cmdLog, '--pause-file', pauseFile, '--out', out,
  '--stable-s', opt('--stable-s', '10'), '--max-delay-s', opt('--max-delay-s', '60'), '--ready-timeout-s', '90',
  '--event-timeout-s', opt('--event-timeout-s', '900'), '--retain-period-s', opt('--retain-period-s', '5'), '--off-s', '5',
  '--wal-bytes', opt('--wal-bytes', String(3 * 1024 * 1024)),
];
const code = await new Promise((res) => {
  const p = spawn('node', killArgs, { stdio: 'inherit' });
  p.on('close', res);
});
stop = true;
await Promise.allSettled(bg);
const report = JSON.parse(readFileSync(out, 'utf8'));
report.task = 'T077 (FR-043; SC-014): x64 pre-check of the power cut';
report.runner = 'tools/powercut/x64-run.mjs (tools/powercut/x64-kill.mjs)';
report.machine = 'Docker mat-armhf on Apple Silicon (Linux arm64, not a real x64)';
report.rig = {
  container: name,
  project: 'projects/soak-standard (500 Tag, 200 logged by change) + CMD.SP internal retained RW',
  commands: { everyMs: writeMs, ...stats },
  deployEveryS: deployS,
};
report.notRun = { D4: 'pulse.journal not empty: needs an external Tag on a Modbus PLC with a pulse command, not in this rig' };
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
if (!argv.includes('--keep') && code === 0) {
  sh('docker', ['rm', '-f', name]);
  sh('docker', ['volume', 'rm', '-f', `${name}-data`]);
}
console.log(`powercut x64: exit ${code}, ${JSON.stringify(stats)} -> ${out}`);
process.exit(code ?? 1);
