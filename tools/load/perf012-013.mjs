// Đo tải T055 (012, SC-005: Lưới so Tự do) và T032 (013, SC-006: 10 client đăng nhập có quy tắc so không quy tắc) trên
// runtime x64 trong Docker (rig tests/web-it/compose.yaml, slot riêng: compose project perf013, mạng 172.30.57.0/24 và
// 203.0.57.0/24, cổng loopback 48080/48443/48503). Số đo là của Linux x86_64 trong Docker trên máy dev, KHÔNG phải BL335.
//   node tools/load/perf012-013.mjs --build-dir C:\build\perf013-x64 [--part 012,013] [--reps 3] [--hold 75]
// Cần: <build>/x64/bin/mat-runtime (Release), <build>/tools/load-tester (GOOS=linux CGO_ENABLED=0). Project đo sinh bởi
// tools/load/gen-perf-projects.mjs vào <build>/projects. Kết quả: docs/reports/012-perf-x64.json, 013-perf-x64.json.
// Mỗi lượt: khởi động lại runtime, 10 client giữ --hold s, CPU/RSS/byte gửi lấy mẫu mỗi 1 s từ giây 10 đến giây hold-5
// (tools/load/perf-client.mjs sample). Tag mô phỏng 500 (sin, đổi mỗi chu kỳ Tag Engine), --no-sim-load ở cả hai bên.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USERS, allowedTags } from './perf-users.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const buildDir = resolve(opt('--build-dir', 'C:/build/perf013-x64'));
const parts = opt('--part', '012,013').split(',');
const reps = Number(opt('--reps', '3'));
const hold = Number(opt('--hold', '75'));
const sampleS = hold - 15;
const compose = join(root, 'tests/web-it/compose.yaml');
const project = 'perf013';
const rt = `${project}-rt-1`;
const client = `${project}-client-1`;
const env = {
  MAT_IT_BUILD: buildDir,
  MAT_IT_LAN: '172.30.57',
  MAT_IT_PUB: '203.0.57',
  MAT_IT_HTTP_PORT: '48080',
  MAT_IT_HTTPS_PORT: '48443',
  MAT_IT_SIM_PORT: '48503',
};
const secret = () =>
  [...randomBytes(24)]
    .map((b) => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'[b % 57])
    .join('');
const PW = { MAT_PERF_PW: secret(), MAT_PERF_PW_ADMIN: secret() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, args, o = {}) => {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 256 << 20,
    ...o,
    env: { ...process.env, ...env, ...PW, ...(o.env ?? {}) },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const docker = (a, o) => sh('docker', a, o);
const spawnAsync = (args) =>
  new Promise((res) => {
    const p = spawn('docker', args, { env: { ...process.env, ...env, ...PW } });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => res({ code, out, err }));
  });
const lastJson = (t) => {
  const l = t
    .split('\n')
    .filter((x) => x.trim().startsWith('{'))
    .at(-1);
  return l ? JSON.parse(l) : null;
};
const pc = (args, extraEnv = []) => {
  const e = extraEnv.flatMap((n) => ['-e', n]);
  const r = docker([
    'exec',
    ...e,
    client,
    'node',
    '--no-warnings',
    '/src/tools/load/perf-client.mjs',
    ...args,
  ]);
  const j = lastJson(r.out);
  if (!j || j.error) throw new Error(`perf-client ${args[0]}: ${r.out} ${r.err}`);
  return j;
};
const catJson = (path) => JSON.parse(docker(['exec', client, 'cat', path]).out);
const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const spread = (v) => ({
  median: Math.round(median(v) * 100) / 100,
  min: Math.min(...v),
  max: Math.max(...v),
});

async function waitLog(count) {
  for (let t = 0; t < 180; t++) {
    const n = Number(
      docker([
        'exec',
        rt,
        'sh',
        '-c',
        "grep -c 'https ok on :8443' /logs/runtime.log",
      ]).out.trim() || 0,
    );
    if (n > count) return n;
    await sleep(500);
  }
  throw new Error('runtime không lên');
}
const httpsCount = () =>
  Number(
    docker([
      'exec',
      rt,
      'sh',
      '-c',
      "grep -c 'https ok on :8443' /logs/runtime.log || true",
    ]).out.trim() || 0,
  );
async function restartRuntime() {
  const before = httpsCount();
  docker(['exec', rt, 'sh', '-c', 'kill -TERM $(cat /run/mat-runtime.pid)']);
  await waitLog(before);
  await sleep(3000);
}
async function startRig(projectPath, extraArgs) {
  docker(['compose', '-f', compose, '-p', project, 'down', '-v']);
  await sleep(3000);
  const up = docker(['compose', '-f', compose, '-p', project, 'up', '-d'], {
    env: { MAT_IT_PROJECT: projectPath },
  });
  if (up.code) throw new Error(`compose up: ${up.err}`);
  await waitLog(0);
  docker(['exec', rt, 'sh', '-c', `printf -- '${extraArgs.join('\\n')}\\n' > /data/extra-args`]);
  await restartRuntime();
  const log = docker(['exec', rt, 'sh', '-c', 'tail -n 40 /logs/runtime.log']).out;
  if (/lỗi|error|invalid/i.test(log.split('supervise: start').at(-1) ?? '')) console.error(log);
  docker(['cp', join(buildDir, 'tools/load-tester'), `${client}:/tmp/load-tester`]);
  const f = docker([
    'exec',
    rt,
    '/build/x64/bin/mat-runtime',
    '--cert-fingerprint',
    '--data-dir',
    '/data',
  ]).out;
  return /Fingerprint=([0-9A-Fa-f:]+)/.exec(f)?.[1].replace(/:/g, '').toLowerCase();
}
const stopRig = () => docker(['compose', '-f', compose, '-p', project, 'down', '-v']);

/** Một lượt: load-tester giữ `hold` s, lấy mẫu từ giây 10. Trả số chính và tài liệu thô gọn. */
async function oneRun(ltArgs) {
  const lt = spawnAsync([
    'exec',
    client,
    '/tmp/load-tester',
    '-host',
    'rt',
    '-port',
    '8080',
    '-clients',
    '10',
    '-extra',
    '0',
    '-duration',
    String(hold),
    '-latency',
    '-shared-clock', // client và rt là hai container trên cùng máy ảo Docker: cùng đồng hồ nhân
    '-out',
    '/tmp/lt.json',
    ...ltArgs,
  ]);
  await sleep(10000);
  const smp = await spawnAsync([
    'exec',
    client,
    'node',
    '--no-warnings',
    '/src/tools/load/perf-client.mjs',
    'sample',
    '--seconds',
    String(sampleS),
  ]);
  const r = await lt;
  const doc = catJson('/tmp/lt.json');
  const s = lastJson(smp.out);
  const cr = doc.clientResults ?? [];
  const bytes = cr.reduce((a, c) => a + (c.bytesReceived ?? 0), 0);
  return {
    exit: r.code,
    proc: s,
    accepted: doc.summary?.accepted,
    seqGaps: doc.summary?.totalSeqGaps,
    latencyAbsP95Ms: doc.latency?.absolute?.p95Ms,
    latencyRelP95Ms: doc.latency?.relative?.p95Ms,
    latency: doc.latency,
    updates: cr.reduce((a, c) => a + c.updatesReceived, 0),
    payloadBytesPerS: Math.round(bytes / hold),
    snapshotTags: cr.map((c) => c.snapshotTags),
    denied: cr.map((c) => c.denied),
    accessChangedAtMs: cr.map((c) => c.accessChangedAtMs ?? []),
    errors: cr.filter((c) => c.error).map((c) => c.error),
  };
}
const summarize = (runs) => ({
  cpuAvgPct: spread(runs.map((r) => r.proc.cpuAvgPct)),
  cpuP95Pct: spread(runs.map((r) => r.proc.cpuP95Pct)),
  rssAvgMB: spread(runs.map((r) => r.proc.rssAvgMB)),
  rssMaxMB: spread(runs.map((r) => r.proc.rssMaxMB)),
  latencyAbsP95Ms: spread(runs.map((r) => r.latencyAbsP95Ms)),
  txBytesPerS: spread(runs.map((r) => r.proc.txBytesPerS)),
  payloadBytesPerS: spread(runs.map((r) => r.payloadBytesPerS)),
  seqGaps: runs.map((r) => r.seqGaps),
  accepted: runs.map((r) => r.accepted),
});

function machine() {
  const info = docker([
    'info',
    '--format',
    '{{.NCPU}} {{.MemTotal}} {{.OperatingSystem}} {{.KernelVersion}}',
  ]).out.trim();
  return {
    host: `${cpus()[0]?.model} (${cpus().length} luồng logic), RAM ${Math.round(totalmem() / 2 ** 30)} GiB, Windows`,
    docker: `docker info: NCPU MemTotal OS Kernel = ${info}`,
    runtimeCommit: sh('git', ['-C', root, 'rev-parse', '--short', 'HEAD']).out.trim(),
    note: 'Linux x86_64 trong Docker Desktop (WSL2) trên máy dev, không phải BL335; CPU là % MỘT lõi của riêng mat-runtime',
  };
}

// ---------------------------------------------------------------------------------------------- 013 mô hình quyền
const ALL = Array.from({ length: 500 }, (_, k) => `SIM.T${String(k + 1).padStart(4, '0')}`);

async function part012() {
  const gen = sh('node', [
    join(root, 'tools/load/gen-perf-projects.mjs'),
    '--out',
    join(buildDir, 'projects'),
  ]);
  if (gen.code) throw new Error(gen.err);
  const res = {
    machine: machine(),
    config: {
      tags: 500,
      clients: 10,
      holdS: hold,
      sampleS,
      reps,
      transport: 'ws:// 8080, viewerLogin off (phiên ẩn danh, mọi Tag thuộc item xem được)',
    },
    runs: {},
  };
  for (const name of ['perf-free', 'perf-grid']) {
    await startRig(`/build/projects/${name}`, ['--no-sim-load']);
    res.runs[name] = [];
    for (let k = 0; k < reps; k++) {
      await restartRuntime();
      const r = await oneRun(['-tags', '500']);
      console.error(
        name,
        k + 1,
        JSON.stringify(r.proc),
        'lat',
        r.latencyAbsP95Ms,
        'gaps',
        r.seqGaps,
      );
      res.runs[name].push(r);
    }
  }
  res.summary = { free: summarize(res.runs['perf-free']), grid: summarize(res.runs['perf-grid']) };
  stopRig();
  return res;
}

async function part013() {
  const gen = sh('node', [
    join(root, 'tools/load/gen-perf-projects.mjs'),
    '--out',
    join(buildDir, 'projects'),
  ]);
  if (gen.code) throw new Error(gen.err);
  const fp = await startRig('/build/projects/perf-free', [
    '--no-sim-load',
    '--viewer-login',
    'required',
  ]);
  for (const [n, role, e] of [
    ['admin', 'administrator', 'MAT_PERF_PW_ADMIN'],
    ...USERS.map((u) => [u.name, u.role, 'MAT_PERF_PW']),
  ]) {
    const a = docker(['exec', '-e', e, rt, 'sh', '/src/tests/device-it/add-user.sh', n, role, e]);
    if (a.code) throw new Error(`user-add ${n}: ${a.err}`);
  }
  await sleep(2500); // users.json đọc lại tối đa 2 s/lần
  pc(['setup', '--fp', fp], ['MAT_PERF_PW_ADMIN']);
  const subset = USERS.map(allowedTags);
  writeFileSync(join(buildDir, 'tags-subset.json'), JSON.stringify(subset));
  writeFileSync(join(buildDir, 'tags-all.json'), JSON.stringify([ALL]));
  docker(['cp', join(buildDir, 'tags-subset.json'), `${client}:/tmp/tags-subset.json`]);
  docker(['cp', join(buildDir, 'tags-all.json'), `${client}:/tmp/tags-all.json`]);
  const configs = [
    ['none-all', 'clear', '/tmp/tags-all.json'],
    ['rules-all', 'set', '/tmp/tags-all.json'],
    ['none-subset', 'clear', '/tmp/tags-subset.json'],
    ['rules-subset', 'set', '/tmp/tags-subset.json'],
  ];
  const res = {
    machine: machine(),
    config: {
      tags: 500,
      clients: 10,
      holdS: hold,
      sampleS,
      reps,
      transport: 'wss:// 8443, viewerLogin required, 10 phiên web (cookie) của 10 tài khoản',
    },
    users: USERS.map((u, k) => ({ ...u, allowedTags: subset[k].length })),
    rules: 52,
    runs: {},
  };
  for (const [c] of configs) res.runs[c] = [];
  const ltBase = (tagsFile) => [
    '-wss',
    '-tls-port',
    '8443',
    '-fingerprint',
    fp,
    '-cookies-file',
    '/tmp/cookies.txt',
    '-client-tags-file',
    tagsFile,
  ];
  for (let k = 0; k < reps; k++)
    for (const [c, mode, tagsFile] of configs) {
      pc(['rules', '--fp', fp, '--mode', mode], ['MAT_PERF_PW_ADMIN']);
      await restartRuntime();
      pc(['sessions', '--fp', fp, '--out', '/tmp/cookies.txt'], ['MAT_PERF_PW']);
      await sleep(2000);
      const r = await oneRun(ltBase(tagsFile));
      console.error(
        c,
        k + 1,
        JSON.stringify(r.proc),
        'snap',
        r.snapshotTags.join(','),
        'gaps',
        r.seqGaps,
        r.errors.slice(0, 2),
      );
      res.runs[c].push(r);
    }
  res.summary = Object.fromEntries(configs.map(([c]) => [c, summarize(res.runs[c])]));
  // Kiểm mô hình: ở rules-all, snapshot của client i có đúng số Tag được phép đã tính
  res.modelCheck = res.runs['rules-all'].map((r) =>
    r.snapshotTags.every((n, i) => n === subset[i].length),
  );

  // Đổi quy tắc trong lúc tải (rules-subset): 10 lần, mỗi 5 s, từ giây 15; thời gian tới access-changed của u04..u06
  pc(['rules', '--fp', fp, '--mode', 'set'], ['MAT_PERF_PW_ADMIN']);
  await restartRuntime();
  pc(['sessions', '--fp', fp, '--out', '/tmp/cookies.txt'], ['MAT_PERF_PW']);
  await sleep(2000);
  const lt = spawnAsync([
    'exec',
    client,
    '/tmp/load-tester',
    '-host',
    'rt',
    '-port',
    '8080',
    '-clients',
    '10',
    '-extra',
    '0',
    '-duration',
    '75',
    '-out',
    '/tmp/lt-change.json',
    ...ltBase('/tmp/tags-subset.json'),
  ]);
  await sleep(15000);
  const ch = pc(['change', '--fp', fp, '--n', '10', '--gap-ms', '5000'], ['MAT_PERF_PW_ADMIN']);
  await lt;
  const doc = catJson('/tmp/lt-change.json');
  const delays = [];
  const unaffected = [];
  doc.clientResults.forEach((c, i) => {
    const at = c.accessChangedAtMs ?? [];
    if (['u04', 'u05', 'u06'].includes(USERS[i].name))
      for (const x of ch.changes) {
        const next = at.find((t) => t >= x.sentAtMs);
        delays.push(next ? next - x.sentAtMs : null);
      }
    else unaffected.push(at.length);
  });
  const ok = delays.filter((d) => d !== null);
  res.accessChanged = {
    changes: ch.changes.length,
    postMs: spread(ch.changes.map((x) => x.postMs)),
    delaysMs: delays,
    delayMs: {
      p50: median(ok),
      p95: [...ok].sort((a, b) => a - b)[Math.ceil(0.95 * ok.length) - 1],
      max: Math.max(...ok),
      missing: delays.length - ok.length,
    },
    unaffectedClientsMessages: unaffected,
    seqGaps: doc.summary?.totalSeqGaps,
  };
  console.error(
    'access-changed',
    JSON.stringify(res.accessChanged.delayMs),
    'post',
    JSON.stringify(res.accessChanged.postMs),
  );

  // Chi phí GET /api/v1/web/access (không tải live), có quy tắc và không quy tắc
  res.cost = {};
  for (const mode of ['set', 'clear']) {
    pc(['rules', '--fp', fp, '--mode', mode], ['MAT_PERF_PW_ADMIN']);
    await restartRuntime();
    res.cost[mode === 'set' ? 'rules' : 'none'] = pc(
      ['cost', '--fp', fp, '--n', '500'],
      ['MAT_PERF_PW'],
    );
  }
  console.error('cost', JSON.stringify(res.cost));
  stopRig();
  return res;
}

const write = (name, doc) => {
  writeFileSync(join(root, 'docs/reports', name), `${JSON.stringify(doc, null, 2)}\n`);
  console.error('wrote', name);
};
try {
  if (parts.includes('012'))
    write('012-perf-x64.json', { generatedAt: new Date().toISOString(), ...(await part012()) });
  if (parts.includes('013'))
    write('013-perf-x64.json', { generatedAt: new Date().toISOString(), ...(await part013()) });
} catch (e) {
  console.error(e);
  stopRig();
  process.exit(1);
}
