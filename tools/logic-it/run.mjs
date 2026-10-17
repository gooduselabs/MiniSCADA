// Logic integration tests on x64 (feature 011 T146, T147; SC-025 to SC-028): the runtime x64 in Docker under the
// supervision loop of device-it, the Modbus simulator of tools/modbus-sim and a Node client, on the rig of
// tests/driver-it/compose.yaml (compose project mat-logic-it). tools/logic-it.ps1 calls this script.
//
//   node tools/logic-it/run.mjs [--scenario rules,writes-off,throttle,stop,retain-kill,retain-lost,deploy-keep,load]
//        [--build-dir <dir>] [--no-build] [--rounds 100] [--seconds 600] [--clients 10] [--keep]
//
//   rules        pump rules: commands at the simulator, audit (rule, Tag, old/new, inputs) before each command
//   writes-off   logic.writes "off" (the default of runtime.json): 0 commands, logic.write.suppressed
//   throttle     writes entry minIntervalMs / maxPerHour: commands capped, logic.throttled audit
//   stop         POST /logic/writes {enabled:false}: 0 commands, enabling over the API refused, kept across kill -9;
//                then root runs mat-runtime --logic-writes-reset in the container and commands go out again
//   retain-kill  --rounds kill -9 (default 100): retained values never go down, loss <= one flushS, 0 duplicate writes
//   retain-lost  both files of the retain store damaged while the runtime is down: blocks at 0, warning, audit
//   deploy-keep  a deploy of a new version of the project keeps the retained values
//   load         projects/logic-load (gen-bench-projects) with --clients live clients for --seconds, and the same
//                project without logic.json (baseline): extra CPU, RSS, scan (T147) -> 011-logic-load-x64.json
// Results: docs/reports/011-logic-x64.json (and 011-logic-load-x64.json for load). Test passwords are random per run,
// passed with docker exec -e and --password-stdin; nothing is written to a file. Exit 0 when every scenario passed.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(name);
const ALL = ['rules', 'writes-off', 'throttle', 'stop', 'retain-kill', 'retain-lost', 'deploy-keep', 'load'];
const scenarios = opt('--scenario', ALL.filter((s) => s !== 'load').join(',')).split(',');
for (const s of scenarios) if (!ALL.includes(s)) throw new Error(`unknown scenario ${s}`);
const buildRoot = process.env.MAT_BUILD_ROOT ?? join(homedir(), 'build');
const buildDir = resolve(opt('--build-dir', join(buildRoot, 'mat-x64-e2')));
const rounds = opt('--rounds', '100');
const seconds = opt('--seconds', '600');
const clients = opt('--clients', '10');
const compose = join(root, 'tests/driver-it/compose.yaml');
const project = 'mat-logic-it';
const rt = `${project}-rt-1`;
const client = `${project}-client-1`;
const bin = '/build/x64/bin/mat-runtime';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sh(cmd, args, { env, quiet = false, input } = {}) {
  const r = spawnSync(cmd, args, {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!quiet && r.status !== 0) process.stderr.write(r.stderr ?? '');
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const docker = (args, o) => sh('docker', args, o);

const users = [
  ['admin', 'administrator', 'MAT_IT_PW_ADMIN'],
  ['kysu1', 'engineer', 'MAT_IT_PW_KYSU1'],
  ['vh1', 'operator', 'MAT_IT_PW_VH1'],
  ['vh2', 'operator', 'MAT_IT_PW_VH2'],
  ['xem1', 'viewer', 'MAT_IT_PW_XEM1'],
];
const secrets = Object.fromEntries(
  users.map(([, , v]) => [
    v,
    [...randomBytes(24)].map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 57]).join(''),
  ]),
);

function build() {
  mkdirSync(buildDir, { recursive: true });
  const r = docker([
    'run', '--rm', '--name', `logic-it-build-${process.pid}`, '-v', `${root}:/src`, '-v', `${buildDir}:/build`, 'mat-armhf',
    'sh', '-c', 'cmake -S /src -B /build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build /build/x64 --target mat-runtime -j 2',
  ]);
  if (r.code) throw new Error('build failed');
}

async function waitLog(pattern, count, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = docker(['exec', rt, 'sh', '-c', `grep -c '${pattern}' /logs/runtime.log`], { quiet: true });
    if (Number(r.out.trim() || 0) >= count) return true;
    await sleep(500);
  }
  return false;
}

async function startRig(projectDir, map) {
  const env = { MAT_IT_BUILD: buildDir, MAT_IT_PROJECT: projectDir, MAT_IT_MAP: map };
  docker(['compose', '-f', compose, '-p', project, 'down', '-v'], { env, quiet: true });
  const up = docker(['compose', '-f', compose, '-p', project, 'up', '-d'], { env });
  if (up.code) throw new Error(`compose up failed: ${up.err}`);
  if (!(await waitLog('https ok on :8443', 1, 60000))) {
    const log = docker(['exec', rt, 'tail', '-30', '/logs/runtime.log'], { quiet: true }).out;
    throw new Error(`runtime did not start:\n${log}`);
  }
  for (const [name, role, v] of users) {
    const r = docker(['exec', '-e', v, rt, 'sh', '/src/tests/device-it/add-user.sh', name, role, v], {
      env: { [v]: secrets[v] },
    });
    if (r.code) throw new Error(`--user-add ${name}: ${r.err}`);
  }
  const f = docker(['exec', rt, bin, '--cert-fingerprint', '--data-dir', '/data']).out;
  const m = /Fingerprint=([0-9A-Fa-f:]+)/.exec(f);
  if (!m) throw new Error(`--cert-fingerprint: ${f}`);
  return m[1].replace(/:/g, '').toLowerCase();
}
function stopRig() {
  if (flag('--keep')) return;
  docker(['compose', '-f', compose, '-p', project, 'down', '-v'], {
    env: { MAT_IT_BUILD: buildDir },
    quiet: true,
  });
}

function runClient(fp, clientArgs) {
  const envArgs = users.flatMap(([, , v]) => ['-e', v]);
  const r = docker(
    ['exec', ...envArgs, client, 'node', '--no-warnings', '/src/tests/logic-it/logic-it.mjs', ...clientArgs, '--fp', fp],
    { env: secrets },
  );
  const line = r.out.split('\n').filter((l) => l.trim().startsWith('{')).at(-1);
  if (!line) return { scenario: clientArgs[0], checks: [{ name: 'client wrote a result', pass: false, detail: (r.out + r.err).slice(-2000) }], pass: false };
  return JSON.parse(line);
}

/** Restarts the runtime with these extra arguments (supervise.sh reads /data/extra-args at each start). */
async function restartWith(list) {
  const before = Number(docker(['exec', rt, 'sh', '-c', "grep -c 'https ok on :8443' /logs/runtime.log"]).out.trim());
  const words = list.map((w) => `'${w}'`).join(' ');
  docker(['exec', rt, 'sh', '-c', `printf '%s\\n' ${words} > /data/extra-args; kill -TERM $(cat /run/mat-runtime.pid)`]);
  if (!(await waitLog('https ok on :8443', before + 1, 60000))) throw new Error('restart failed');
  await sleep(800);
}

function merge(parts, name) {
  const checks = parts.flatMap((p) => p.checks ?? []);
  const measures = Object.assign({}, ...parts.map((p) => p.measures ?? {}));
  return { scenario: name, checks, measures, pass: checks.length > 0 && checks.every((c) => c.pass) };
}

function show(res) {
  const bad = res.checks.filter((c) => !c.pass);
  console.log(`${res.scenario}: ${res.checks.length} checks, ${bad.length} failed${res.pass ? ' - PASS' : ' - FAILED'}`);
  for (const b of bad) console.log(`  FAIL ${b.name}: ${b.detail ?? ''}`);
  if (res.measures && Object.keys(res.measures).length) console.log(`  measures: ${JSON.stringify(res.measures).slice(0, 1500)}`);
}

const machine = sh('uname', ['-sm']).out.trim();
const arch = docker(['run', '--rm', 'mat-armhf', 'uname', '-m'], { quiet: true }).out.trim();
const results = {};
const logicMap = '/src/tools/modbus-sim/maps/logic-it.json';
const logicProject = '/src/tests/logic-it/projects/logic-it';
let failed = 0;
try {
  if (!flag('--no-build')) build();
  if (!existsSync(join(buildDir, 'x64/bin/mat-runtime'))) throw new Error(`no runtime in ${buildDir}/x64/bin`);
  sh('node', [join(root, 'tests/logic-it/make-project.mjs')]);
  for (const s of scenarios) {
    console.log(`--- ${s}`);
    let res;
    if (s === 'load') {
      // projects/logic-load (FR-095 maximum) and the same project without logic.json
      const out = join(buildDir, 'logic-load-projects');
      rmSync(out, { recursive: true, force: true });
      sh('node', [join(root, 'tools/gen-bench-projects.mjs'), '--out', out, '--only', 'logic-load']);
      const base = join(out, 'logic-load-baseline');
      mkdirSync(base, { recursive: true });
      sh('cp', ['-R', `${join(out, 'logic-load')}/.`, base]);
      rmSync(join(base, 'logic.json'));
      const pj = JSON.parse(readFileSync(join(base, 'project.json'), 'utf8'));
      delete pj.logic;
      pj.projectId = 'logic-load-baseline';
      writeFileSync(join(base, 'project.json'), `${JSON.stringify(pj, null, 2)}\n`);
      // the screen shows a logic Tag: without logic.json it must show a Tag of tags.json
      const scr = join(base, 'screens/tong-quan.screen.json');
      writeFileSync(scr, readFileSync(scr, 'utf8').replace(/LOGIC\.C001\.VALUE/g, 'INT.R001'));
      const runs = [];
      for (const [label, dir] of [['baseline', 'logic-load-baseline'], ['logic', 'logic-load']]) {
        const fp = await startRig(`/build/logic-load-projects/${dir}`, logicMap);
        // the client container does not mount the build dir: its copy of the project (the Tag list)
        docker(['cp', join(out, dir), `${client}:/tmp/load-project`]);
        const r = runClient(fp, ['load', '--seconds', seconds, '--clients', clients, '--label', label, '--project', '/tmp/load-project']);
        r.scenario = `load-${label}`;
        show(r);
        runs.push(r);
        stopRig();
      }
      res = merge(runs, 'load');
      const [b, l] = runs.map((r) => r.measures);
      res.measures = {
        baseline: b,
        logic: l,
        extraCpuPoints: Math.round((l.cpuAvgPct - b.cpuAvgPct) * 100) / 100,
        extraRssKb: l.rssAvgKb - b.rssAvgKb,
        extraRssMaxKb: l.rssMaxKb - b.rssMaxKb,
      };
      res.checks.push({
        name: 'x64 logic maximum: <= +3 CPU points, <= +5 MB RSS (SC-028; x64 pre-check, BL335 is T148)',
        pass: res.measures.extraCpuPoints <= 3 && res.measures.extraRssKb <= 5 * 1024,
        detail: `+${res.measures.extraCpuPoints} points, +${res.measures.extraRssKb} kB`,
      });
      res.pass = res.checks.every((c) => c.pass);
      const reportPath = join(root, 'docs/reports/011-logic-load-x64.json');
      const prev = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : {};
      prev.runtime = {
        task: 'T147',
        date: new Date().toISOString(),
        machine: `${machine}; Docker mat-armhf ${arch} (Linux ${arch} on Apple Silicon, not a real x64)`,
        project: 'projects/logic-load (tools/gen-bench-projects.mjs --only logic-load) vs. the same project without logic.json',
        clients: Number(clients),
        seconds: Number(seconds),
        ...res.measures,
        checks: res.checks,
        pass: res.pass,
      };
      delete prev.notMeasured;
      writeFileSync(reportPath, `${JSON.stringify(prev, null, 2)}\n`);
    } else {
      const fp = await startRig(logicProject, logicMap);
      // logic.writes is "off" by default (device-config): every scenario but writes-off runs with a runtime.json
      // that turns it on (what root does on a device), and flushS 10 (the minimum) for retain-kill
      if (s !== 'writes-off') {
        docker(['exec', rt, 'sh', '-c', `printf '{"logic":{"writes":"on","flushS":10}}\\n' > /data/runtime-on.json`]);
        await restartWith(['--config', '/data/runtime-on.json']);
      }
      if (s === 'writes-off') {
        res = runClient(fp, ['writes-off']);
      } else if (s === 'stop') {
        const a = runClient(fp, ['stop']);
        const reset = docker(['exec', rt, bin, '--logic-writes-reset', '--data-dir', '/data']);
        const b = runClient(fp, ['stop-after']);
        b.checks.unshift({ name: 'root: mat-runtime --logic-writes-reset exits 0', pass: reset.code === 0, detail: (reset.out + reset.err).trim().slice(0, 300) });
        res = merge([a, b], 'stop');
      } else if (s === 'retain-lost') {
        const a = runClient(fp, ['retain-lost', '--phase', 'break']);
        await sleep(1000);
        const b = runClient(fp, ['retain-lost', '--phase', 'check']);
        res = merge([a, b], 'retain-lost');
      } else if (s === 'retain-kill') {
        res = runClient(fp, ['retain-kill', '--rounds', rounds, '--flush-s', '10']);
      } else {
        res = runClient(fp, [s]);
      }
      show(res);
      stopRig();
    }
    results[s] = res;
    if (!res.pass) failed++;
  }
} finally {
  stopRig();
}
if (!scenarios.every((s) => s === 'load')) {
  const reportPath = join(root, 'docs/reports/011-logic-x64.json');
  const prev = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : { scenarios: {} };
  prev.task = 'T146 (SC-025 to SC-028)';
  prev.runner = 'tools/logic-it.ps1 (tools/logic-it/run.mjs, tests/logic-it/logic-it.mjs)';
  prev.machine = `${machine}; Docker mat-armhf ${arch} (Linux ${arch} on Apple Silicon, not a real x64)`;
  prev.scenarios = prev.scenarios ?? {};
  for (const [k, v] of Object.entries(results)) if (k !== 'load') prev.scenarios[k] = { date: new Date().toISOString(), ...v };
  writeFileSync(reportPath, `${JSON.stringify(prev, null, 2)}\n`);
  console.log(`-> ${reportPath}`);
}
console.log(failed ? `logic-it: ${failed} scenario(s) FAILED` : 'logic-it: all scenarios passed');
process.exit(failed ? 1 : 0);
