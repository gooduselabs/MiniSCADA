// Vòng Nạp xuống rồi Đọc lên của project SVG với runtime x64 thật (feature 008, T103, FR-029; contract studio-svg-editor):
//   node tests/web-it/roundtrip-svg.mjs --fp <fingerprint>
// Làm đúng các lệnh API mà Studio dùng (POST /project/deployments, GET /project/package; cùng gói .matscada), KHÔNG lái giao diện
// Studio. Với từng project (projects/svg-demo, màn hình chuẩn 3b): Nạp xuống, chờ committed, Đọc lên, so digest ("So sánh: giống"
// khi digest trùng gói đã gửi), bung gói ra thư mục rồi chạy tools/svg-demo/uid-roundtrip.mjs (UID, binding, `elements` giữ nguyên).
// In đúng một dòng JSON { scenario, checks, measures, pass }. Mật khẩu: MAT_IT_PW_KYSU1; cổng: MAT_IT_HTTPS_PORT.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deployPackage,
  fetchPackage,
  login,
  waitOperation,
} from '../../tools/measure/device-api.mjs';
import { buildPackage, readProjectDir } from '../device-it/pack.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../..');
const args = process.argv.slice(2);
const fp = args.includes('--fp') ? args[args.indexOf('--fp') + 1] : '';
const BASE = `https://127.0.0.1:${process.env.MAT_IT_HTTPS_PORT ?? 18443}`;
const checks = [];
const measures = {};
const check = (name, pass, detail = '') =>
  checks.push({ name, pass: Boolean(pass), detail: detail === '' ? undefined : String(detail) });

/** Bung gói ZIP "stored" của buildPackage / runtime: { đường dẫn: Buffer } (bỏ matscada.json). */
function unzipStored(bytes) {
  const out = {};
  let p = 0;
  while (bytes.readUInt32LE(p) === 0x04034b50) {
    const flags = bytes.readUInt16LE(p + 6);
    const method = bytes.readUInt16LE(p + 8);
    const csize = bytes.readUInt32LE(p + 18);
    const n = bytes.readUInt16LE(p + 26);
    const m = bytes.readUInt16LE(p + 28);
    if (method !== 0 || (flags & 0x8) !== 0) throw new Error('gói không phải ZIP stored');
    const name = bytes.subarray(p + 30, p + 30 + n).toString('utf8');
    out[name] = bytes.subarray(p + 30 + n + m, p + 30 + n + m + csize);
    p += 30 + n + m + csize;
  }
  return out;
}

async function token() {
  const lg = await login(BASE, fp, 'kysu1', process.env.MAT_IT_PW_KYSU1 ?? '');
  if (lg.status !== 200) throw new Error(`đăng nhập kysu1 ${lg.status}`);
  return lg.json.token;
}

async function round(label, dir, after) {
  let t = await token();
  const cur = await fetchPackage(BASE, fp, t);
  const baseDigest = cur.headers['x-mat-digest'];
  check(
    `${label}: đọc được gói đang chạy (digest nền)`,
    cur.status === 200 && Boolean(baseDigest),
    cur.status,
  );
  const files = readProjectDir(join(REPO, dir));
  const pkg = buildPackage(files);
  const dep = await deployPackage(BASE, fp, t, pkg.bytes, pkg.digest, baseDigest, {
    timeoutMs: 60000,
  });
  check(
    `${label}: Nạp xuống được nhận (202)`,
    dep.status === 202,
    `${dep.status} ${dep.body.slice(0, 120)}`,
  );
  const op = await waitOperation(BASE, fp, t, dep.json?.opId, {
    timeoutMs: 120000,
    reauth: token,
  });
  measures[`${label}DeployMs`] = Math.round(op.ms);
  check(
    `${label}: Nạp xuống hoàn tất (committed) trong ${Math.round(op.ms)} ms`,
    op.op?.result === 'committed',
    JSON.stringify(op.op?.error ?? op.op?.result),
  );
  t = await token();
  const back = await fetchPackage(BASE, fp, t, undefined, { timeoutMs: 60000 });
  check(`${label}: Đọc lên được (200)`, back.status === 200, back.status);
  check(
    `${label}: So sánh "giống": digest gói đọc lên trùng gói đã gửi`,
    back.headers['x-mat-digest'] === pkg.digest,
    `${back.headers['x-mat-digest']} / ${pkg.digest}`,
  );
  rmSync(after, { recursive: true, force: true });
  const entries = unzipStored(back.bodyBytes);
  let n = 0;
  for (const [name, data] of Object.entries(entries)) {
    if (name === 'matscada.json') continue;
    const p = join(after, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
    n++;
  }
  measures[`${label}Files`] = n;
  measures[`${label}Bytes`] = back.bodyBytes.length;
  const report = join(here, 'out', `uid-roundtrip-${label}.json`);
  const r = spawnSync(
    process.execPath,
    ['tools/svg-demo/uid-roundtrip.mjs', '--before', dir, '--after', after, '--out', report],
    { cwd: REPO, encoding: 'utf8' },
  );
  const lines = r.stdout.split('\n').filter((l) => /^[✔✘]/.test(l));
  check(
    `${label}: uid-roundtrip.mjs thoát 0 (${lines.length} kiểm: UID, binding, elements, tập tệp)`,
    r.status === 0,
    lines.filter((l) => l.startsWith('✘')).join(' | '),
  );
  measures[`${label}UidChecks`] = lines.length;
}

try {
  await round('svg-demo', 'projects/svg-demo', join(here, 'out', 'roundtrip-svg-demo'));
  await round('chuan-3b', 'tests/web-it/out/std-3b', join(here, 'out', 'roundtrip-3b'));
} catch (e) {
  check('chạy hết kịch bản', false, e.stack ?? String(e));
}
console.log(
  JSON.stringify({
    scenario: 'uid-roundtrip',
    checks,
    measures,
    pass: checks.every((c) => c.pass),
  }),
);
process.exit(0);
