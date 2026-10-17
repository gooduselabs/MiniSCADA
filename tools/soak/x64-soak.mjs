// Accelerated x64 soak S0 of feature 011 (T076; FR-039; contracts/test-protocols.md §2): starts the rig and leaves it
// running detached in Docker (nothing of it depends on this process), or collects and analyses it.
//
//   node tools/soak/x64-soak.mjs start [--hours 24] [--kill-min 30] [--deploy-h 2] [--build-dir <dir>]
//   node tools/soak/x64-soak.mjs status
//   node tools/soak/x64-soak.mjs collect [--out docs/reports/011-soak-x64.json]
//   node tools/soak/x64-soak.mjs stop            (docker compose down -v: removes the rig and its data)
//
// start: compose project mat-soak-x64 on tests/web-it/compose.yaml (networks 172.30.57.0/24, 203.0.57.0/24, ports
// 127.0.0.1:48080/48443/48503), the runtime of <build dir>/x64/bin (Release, copied into <build dir> so later builds do
// not touch it) running projects/soak-standard (500 Tag, 200 logged by change); accounts admin and kysu1 with random
// passwords (only in the environment of the detached processes); deployment/device/mat-sample.sh every 60 s inside rt
// (MAT_SAMPLE_DIR=/data/mat-sample, MAT_TMP_DIR=/dev/shm: /run of the container is not a tmpfs); tests/soak/x64-driver.mjs detached in the client container: reduced L1
// (load-tester 10 x 500 Tag), kill -9 every --kill-min, a deploy every --deploy-h.
// collect: copies /data/mat-sample and /data/soak out of the containers into <build dir>/soak-collect/<time>/, runs
// tools/soak/analyze.mjs (--planned-restarts = kills + deploys so far, --skip-hours 1) and writes --out with the
// driver summary. A soak that is not finished yet is collected as it is ("running").
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'status';
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const buildRoot = process.env.MAT_BUILD_ROOT ?? join(homedir(), 'build');
const buildDir = resolve(opt('--build-dir', join(buildRoot, 'mat-soak-x64')));
const compose = join(root, 'tests/web-it/compose.yaml');
const project = 'mat-soak-x64';
const rt = `${project}-rt-1`;
const client = `${project}-client-1`;
const env = {
  MAT_IT_BUILD: buildDir,
  MAT_IT_PROJECT: '/build/bench-projects/soak-standard',
  MAT_IT_LAN: '172.30.57',
  MAT_IT_PUB: '203.0.57',
  MAT_IT_HTTP_PORT: '48080',
  MAT_IT_HTTPS_PORT: '48443',
  MAT_IT_SIM_PORT: '48503',
};
const sh = (c, a, o = {}) => {
  const r = spawnSync(c, a, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...o,
    env: { ...process.env, ...env, ...(o.env ?? {}) },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const docker = (a, o) => sh('docker', a, o);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secret = () =>
  [...randomBytes(24)]
    .map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 57])
    .join('');

if (cmd === 'start') {
  const hours = opt('--hours', '24');
  const src = resolve(opt('--from', join(buildRoot, 'mat-x64-e2')));
  mkdirSync(join(buildDir, 'x64/bin'), { recursive: true });
  mkdirSync(join(buildDir, 'tools'), { recursive: true });
  copyFileSync(join(src, 'x64/bin/mat-runtime'), join(buildDir, 'x64/bin/mat-runtime'));
  copyFileSync(join(src, 'tools/load-tester'), join(buildDir, 'tools/load-tester'));
  sh('node', [
    join(root, 'tools/gen-bench-projects.mjs'),
    '--out',
    join(buildDir, 'bench-projects'),
    '--only',
    'soak-standard',
  ]);
  docker(['compose', '-f', compose, '-p', project, 'down', '-v']);
  const up = docker(['compose', '-f', compose, '-p', project, 'up', '-d']);
  if (up.code) throw new Error(up.err);
  for (let i = 0; i < 180; i++) {
    if (docker(['exec', rt, 'grep', '-q', 'https ok on :8443', '/logs/runtime.log']).code === 0)
      break;
    await sleep(500);
  }
  const pw = { MAT_IT_PW_ADMIN: secret(), MAT_IT_PW_KYSU1: secret() };
  for (const [u, role, v] of [
    ['admin', 'administrator', 'MAT_IT_PW_ADMIN'],
    ['kysu1', 'engineer', 'MAT_IT_PW_KYSU1'],
  ]) {
    const r = docker(['exec', '-e', v, rt, 'sh', '/src/tests/device-it/add-user.sh', u, role, v], {
      env: pw,
    });
    if (r.code) throw new Error(`user-add ${u}: ${r.err}`);
  }
  const f = docker([
    'exec',
    rt,
    '/build/x64/bin/mat-runtime',
    '--cert-fingerprint',
    '--data-dir',
    '/data',
  ]).out;
  const fp = /Fingerprint=([0-9A-Fa-f:]+)/.exec(f)?.[1].replace(/:/g, '').toLowerCase();
  if (!fp) throw new Error('fingerprint');
  docker(['cp', join(buildDir, 'tools/load-tester'), `${client}:/tmp/load-tester`]);
  docker(['exec', client, 'mkdir', '-p', '/rt-data/soak']);
  docker(['cp', join(buildDir, 'bench-projects/soak-standard'), `${client}:/rt-data/soak-project`]);
  docker([
    'exec',
    '-d',
    '-e',
    'MAT_SAMPLE_DIR=/data/mat-sample',
    '-e',
    'MAT_DATA_DIR=/data',
    '-e',
    'MAT_SAMPLE_PERIOD_S=60',
    '-e',
    'MAT_SAMPLE_FILES=16',
    '-e',
    'MAT_TMP_DIR=/dev/shm',
    rt,
    'sh',
    '/src/deployment/device/mat-sample.sh',
  ]);
  const d = docker(
    [
      'exec',
      '-d',
      '-e',
      'MAT_IT_PW_KYSU1',
      client,
      'node',
      '--no-warnings',
      '/src/tests/soak/x64-driver.mjs',
      '--fp',
      fp,
      '--hours',
      hours,
      '--kill-min',
      opt('--kill-min', '30'),
      '--deploy-h',
      opt('--deploy-h', '2'),
      '--dir',
      '/rt-data/soak',
      '--project',
      '/rt-data/soak-project',
    ],
    { env: pw },
  );
  if (d.code) throw new Error(`driver: ${d.err}`);
  const startedAt = new Date().toISOString();
  writeFileSync(
    join(buildDir, 'soak-started.json'),
    `${JSON.stringify({ startedAt, hours: Number(hours), project, rt, client }, null, 2)}\n`,
  );
  console.log(
    `soak x64 started ${startedAt} for ${hours} h: compose project ${project} (containers ${rt}, ${client})`,
  );
  console.log('status:  node tools/soak/x64-soak.mjs status');
  console.log('collect: node tools/soak/x64-soak.mjs collect --out docs/reports/011-soak-x64.json');
  console.log('stop:    node tools/soak/x64-soak.mjs stop');
} else if (cmd === 'status') {
  const lines = docker([
    'exec',
    client,
    'sh',
    '-c',
    'tail -n 5 /rt-data/soak/driver.jsonl; ls /rt-data/soak | wc -l',
  ]).out;
  console.log(lines || 'no driver log (not started?)');
} else if (cmd === 'collect') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = join(buildDir, 'soak-collect', stamp);
  mkdirSync(out, { recursive: true });
  docker(['cp', `${rt}:/data/mat-sample`, join(out, 'mat-sample')]);
  docker(['cp', `${client}:/rt-data/soak`, join(out, 'driver')]);
  const events = existsSync(join(out, 'driver/driver.jsonl'))
    ? readFileSync(join(out, 'driver/driver.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
  const kills = events.filter((e) => e.event === 'kill').length;
  const deploys = events.filter((e) => e.event === 'deploy');
  const segs = events.filter((e) => e.event === 'segment');
  const done = events.find((e) => e.event === 'done') ?? null;
  const reportOut = resolve(opt('--out', join(root, 'docs/reports/011-soak-x64.json')));
  // --check-data of the data as it is now (read only; the runtime keeps running)
  const cd = docker([
    'exec',
    rt,
    '/build/x64/bin/mat-runtime',
    '--check-data',
    '--json',
    '--data-dir',
    '/data',
  ]);
  writeFileSync(join(out, 'check-data.json'), cd.out);
  const an = sh('node', [
    join(root, 'tools/soak/analyze.mjs'),
    join(out, 'mat-sample'),
    '--out',
    join(out, 'analyze.json'),
    '--svg',
    join(out, 'soak.svg'),
    '--skip-hours',
    '1',
    '--planned-restarts',
    String(kills + deploys.length),
    '--check-data',
    join(out, 'check-data.json'),
  ]);
  let analysis = null;
  try {
    analysis = JSON.parse(readFileSync(join(out, 'analyze.json'), 'utf8'));
  } catch {
    analysis = { error: an.err.slice(-1000) };
  }
  const started = existsSync(join(buildDir, 'soak-started.json'))
    ? JSON.parse(readFileSync(join(buildDir, 'soak-started.json'), 'utf8'))
    : {};
  const seqGaps = segs.reduce(
    (n, s) => n + (s.summary?.totalSeqGaps ?? s.summary?.seqGaps ?? 0),
    0,
  );
  const report = {
    task: 'T076 (FR-039): accelerated soak S0 on x64',
    machine: 'Docker mat-armhf on Apple Silicon (Linux arm64, not a real x64); not BL335 numbers',
    state: done ? 'finished' : 'running',
    startedAt: started.startedAt ?? null,
    plannedHours: started.hours ?? null,
    collectedAt: new Date().toISOString(),
    collectDir: out,
    driver: {
      kills,
      deploys: deploys.length,
      deploysCommitted: deploys.filter((d) => d.ok).length,
      loadSegments: segs.length,
      loadSegmentsPassed: segs.filter((s) => s.pass).length,
      sequenceGapsTotal: seqGaps,
      maxRestartMs: Math.max(
        0,
        ...events
          .filter((e) => e.event === 'serving')
          .map((e) => e.afterKillMs ?? e.afterDeployMs ?? 0),
      ),
      done,
    },
    analyzeExitCode: an.code,
    analysis,
  };
  writeFileSync(reportOut, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `collected into ${out}; report ${reportOut} (${report.state}, analyze exit ${an.code})`,
  );
} else if (cmd === 'stop') {
  docker(['compose', '-f', compose, '-p', project, 'down', '-v']);
  console.log('soak rig removed');
} else {
  console.error('use start | status | collect | stop');
  process.exit(2);
}
