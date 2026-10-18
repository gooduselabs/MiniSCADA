// Dựng rig so cặp (tests/device-it/compose.pair.yaml) cho một bản runtime, chạy pair-011.mjs trong client và ghi
// bản ghi (specs/011-pilot-hardening T200, SC-042). Chạy được trên macOS/Linux không cần pwsh:
//   node tests/device-it/pair-011-rig.mjs --label old --src <cây nguồn 60b254bc> --build <thư mục build> --out <tệp.json>
//   node tests/device-it/pair-011-rig.mjs --label new --src . --build <thư mục build> --out <tệp.json>
// <build>/x64/bin/mat-runtime phải có sẵn (dựng trong image mat-armhf); <src>/apps/runtime-web/dist-device là trang
// xem của chính bản đó (supervise.sh dùng trang giả nếu chưa build). Mật khẩu thử sinh ngẫu nhiên, chỉ nằm trong
// biến môi trường của tiến trình này và stdin của --user-add; không ghi tệp. --keep: không dọn rig khi xong.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);
const root = resolve(here, '../..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const label = opt('--label', 'run');
const src = resolve(opt('--src', root));
const build = resolve(opt('--build', ''));
const out = opt('--out', '');
const keep = argv.includes('--keep');
// --skip-evil-host: lần đối chứng không gửi Host lạ (xem pair-011.mjs)
if (argv.includes('--skip-evil-host')) process.env.PAIR_SKIP_EVIL_HOST = '1';
const project = `mat-t200-pair-${label}`;
const compose = ['compose', '-p', project, '-f', `${here}/compose.pair.yaml`];
const rt = `${project}-rt-1`;
const client = `${project}-client-1`;

const secret = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return [...randomBytes(24)].map((b) => chars[b % chars.length]).join('');
};
const env = {
  ...process.env,
  PAIR_SRC: src,
  PAIR_BUILD: build,
  PAIR_PROJ: `${root}/projects/training-demo`,
  PAIR_CLIENT_SRC: root,
  MAT_IT_PW_ADMIN: secret(),
  MAT_IT_PW_KYSU: secret(),
  MAT_IT_PW_XEM: secret(),
};
const docker = (args, opts = {}) =>
  execFileSync('docker', args, {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

docker([...compose, 'down', '-v']);
docker([...compose, 'up', '-d']);
// --version chỉ có từ 1.0 (0.9.0 trả "tham số không hỗ trợ"): ghi nguyên văn
const versionRun = spawnSync('docker', ['exec', rt, '/build/x64/bin/mat-runtime', '--version'], {
  env,
  encoding: 'utf8',
});
const version = `${versionRun.status} ${(versionRun.stdout + versionRun.stderr).trim()}`;
// HTTPS lên (chứng chỉ tự sinh ở lần chạy đầu)
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  const r = spawnSync(
    'docker',
    [
      'exec',
      client,
      'node',
      '-e',
      "require('tls').connect({host:'172.30.71.10',port:8443,rejectUnauthorized:false},function(){process.exit(0)}).on('error',()=>process.exit(1))",
    ],
    { env },
  );
  up = r.status === 0;
  if (!up) await sleep(500);
}
if (!up) throw new Error('runtime HTTPS did not come up');
for (const [name, role, v] of [
  ['admin', 'administrator', 'MAT_IT_PW_ADMIN'],
  ['kysu', 'engineer', 'MAT_IT_PW_KYSU'],
  ['xem', 'viewer', 'MAT_IT_PW_XEM'],
])
  docker(['exec', '-e', v, rt, 'sh', '/src/tests/device-it/add-user.sh', name, role, v]);
const fpLine = docker([
  'exec',
  rt,
  '/build/x64/bin/mat-runtime',
  '--cert-fingerprint',
  '--data-dir',
  '/data',
])
  .split('\n')
  .find((l) => l.includes('Fingerprint='));
const fp = fpLine.replace(/^.*=/, '').replace(/:/g, '').toLowerCase().trim();
await sleep(3000); // users.json được đọc lại (tối đa 2 s) và giả lập đã có giá trị
const res = spawnSync(
  'docker',
  [
    'exec',
    '-e',
    'MAT_IT_PW_ADMIN',
    '-e',
    'MAT_IT_PW_KYSU',
    '-e',
    'MAT_IT_PW_XEM',
    '-e',
    'PAIR_SKIP_EVIL_HOST',
    client,
    'node',
    '--no-warnings',
    '/src/tests/device-it/pair-011.mjs',
    '--fp',
    fp,
  ],
  { env, encoding: 'utf8', maxBuffer: 64 << 20 },
);
const line = res.stdout
  .split('\n')
  .filter((l) => l.startsWith('{'))
  .at(-1);
if (!line) throw new Error(`client wrote no record: ${res.stdout} ${res.stderr}`);
const record = { label, runtimeVersionCli: version, ...JSON.parse(line) };
const logTail = docker([
  'exec',
  rt,
  'sh',
  '-c',
  'grep -c "supervise: start" /logs/runtime.log',
]).trim();
record.supervisorStarts = Number(logTail);
for (const k of Object.keys(env)) if (k.startsWith('MAT_IT_PW_')) delete env[k];
if (!keep) docker([...compose, 'down', '-v']);
const text = JSON.stringify(record, null, 2) + '\n';
if (out) writeFileSync(out, text);
else process.stdout.write(text);
console.error(`${label}: ${version}; record ${record.error ? 'WITH ERROR' : 'ok'}`);
