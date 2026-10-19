// Test kiểm thư mục phát hành (feature 011, T088; FR-051, FR-052, SC-017; contract release-signing §5, §8):
//   node --test tools/release/verify-release.test.mjs
// Ca hỏng 6–12 (SHA256SUMS, chữ ký ECDSA, tệp thừa/thiếu, `.matupdate`) chạy bằng Node mọi nơi. Ca 1–5 (Authenticode)
// chỉ chạy trong verify-release.ps1 trên Windows; ở nơi khác script in "BỎ QUA" cho từng ca và không báo xanh.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { packEnvelope, readEnvelope } from './lib/envelope.mjs';
import { makeRelease as makeReleaseIn } from './lib/make-release-fixture.mjs';
import { findOpenssl, findPwsh, runPwsh } from './lib/pwsh.mjs';
import { runBreakCases, verifyRelease } from './verify-release.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sumsCli = join(here, 'sums.mjs');
const verifyCli = join(here, 'verify-release.mjs');
const temps = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mat-vr-'));
  temps.push(d);
  return d;
};

const makeRelease = () => makeReleaseIn(tmp());

const ALLOW = ['installer'];

test('envelope: đóng gói rồi đọc lại đúng ba thành viên', () => {
  const buf = packEnvelope([
    ['update.json', Buffer.from('{}')],
    ['update.sig', Buffer.from([1, 2])],
    ['payload.tar.gz', Buffer.alloc(0)],
  ]);
  assert.equal(buf.length % 512, 0);
  const env = readEnvelope(buf);
  assert.equal(env.manifest.toString(), '{}');
  assert.deepEqual([...env.signature], [1, 2]);
  assert.throws(() => readEnvelope(buf.subarray(0, 600)), /ENVELOPE/);
  const bad = Buffer.from(buf);
  bad[100] ^= 1; // mode trong tiêu đề 1: tổng kiểm sai
  assert.throws(() => readEnvelope(bad), /ENVELOPE_HEADER/);
});

test('thư mục phát hành hợp lệ: qua mọi kiểm (bộ cài được phép thiếu khi không phải Windows)', () => {
  const { dir, keys } = makeRelease();
  const r = verifyRelease(dir, { keysDir: keys, allowMissing: ALLOW });
  assert.deepEqual(r.failures, []);
  assert.equal(r.ok, true);
  assert.ok(r.checks.some((c) => /SHA256SUMS\.sig/.test(c)));
  const strict = verifyRelease(dir, { keysDir: keys });
  assert.deepEqual(
    strict.failures.map((f) => f.code),
    ['ARTIFACT_MISSING'],
    'thiếu bộ cài là lỗi khi không cho phép',
  );
});

test('12 ca hỏng: ca 6–12 bị từ chối đúng mã; ca 1–5 (Authenticode) chỉ chạy trên Windows', () => {
  const { dir, keys, other } = makeRelease();
  const res = runBreakCases(dir, { keysDir: keys, otherKeysDir: other, allowMissing: ALLOW });
  assert.equal(res.length, 12);
  const byId = new Map(res.map((r) => [r.id, r]));
  for (const id of [1, 2, 3, 4, 5]) {
    assert.ok(byId.get(id).skipped, `ca ${id} bỏ qua ở Node`);
  }
  const expected = {
    6: 'SIG_INVALID',
    7: 'SIG_INVALID',
    8: 'KEY_UNKNOWN',
    9: 'HASH_MISMATCH',
    10: 'EXTRA_FILE',
    11: 'MISSING_FILE',
    12: 'MATUPDATE_SIG_INVALID',
  };
  for (const [id, code] of Object.entries(expected)) {
    const r = byId.get(Number(id));
    assert.equal(r.rejected, true, `ca ${id} phải bị từ chối`);
    assert.ok(r.codes.includes(code), `ca ${id}: ${code} ∉ ${r.codes}`);
    assert.equal(r.codeMatches, true);
  }
  // Thư mục gốc không bị ca hỏng làm bẩn (ca chạy trên bản sao).
  assert.equal(verifyRelease(dir, { keysDir: keys, allowMissing: ALLOW }).ok, true);
});

test('sums.mjs verify: mã thoát như mat-update-verify (0 đúng, 3 chữ ký sai, 4 khóa lạ, 5 định dạng sai)', () => {
  const { dir, keys, other } = makeRelease();
  const verify = (sums, sig, keysDir, extra = []) =>
    spawnSync(
      process.execPath,
      [sumsCli, 'verify', sums, '--sig', sig, '--keys', keysDir, ...extra],
      {
        encoding: 'utf8',
      },
    ).status;
  const sums = join(dir, 'SHA256SUMS');
  const sig = join(dir, 'SHA256SUMS.sig');
  const bi = JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8'));
  assert.equal(verify(sums, sig, keys), 0);
  const w = tmp();
  const s2 = join(w, 'SHA256SUMS');
  writeFileSync(
    s2,
    readFileSync(sums, 'utf8').replace(/^./, (c) => (c === '0' ? '1' : '0')),
  );
  assert.equal(verify(s2, sig, keys), 3);
  assert.equal(
    verify(sums, sig, other, ['--expect-key-id', bi.signing.releaseKeyId]),
    4,
    'khóa ký không nằm trong khóa tin cậy',
  );
  assert.equal(verify(sums, sig, other), 3, 'không biết khóa ký: chỉ nói được chữ ký không khớp');
  const s3 = join(w, 'BAD');
  writeFileSync(s3, 'không phải dòng sha256sum\n');
  assert.equal(verify(s3, sig, keys), 5);
  const empty = join(w, 'empty-keys');
  mkdirSync(empty);
  assert.equal(verify(sums, sig, empty), 4, 'không có khóa tin cậy nào');
});

test('sums.mjs: make, sign (khóa không mã hóa), keyid', () => {
  const { dir, privateKey } = makeRelease();
  const w = tmp();
  const keyFile = join(w, 'k.pem');
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const run = (...a) => spawnSync(process.execPath, [sumsCli, ...a], { encoding: 'utf8' });
  const copy = join(w, 'rel');
  cpSync(dir, copy, { recursive: true });
  rmSync(join(copy, 'SHA256SUMS'));
  rmSync(join(copy, 'SHA256SUMS.sig'));
  assert.equal(run('make', '--dir', copy).status, 0);
  const lines = readFileSync(join(copy, 'SHA256SUMS'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 7);
  assert.ok(lines.every((l) => /^[0-9a-f]{64} {2}\S/.test(l)));
  assert.deepEqual(
    lines.map((l) => l.slice(66)),
    [...lines.map((l) => l.slice(66))].sort(),
    'thứ tự theo tên',
  );
  const r = run(
    'sign',
    '--key',
    keyFile,
    '--in',
    join(copy, 'SHA256SUMS'),
    '--out',
    join(copy, 'SHA256SUMS.sig'),
  );
  assert.equal(r.status, 0, r.stderr);
  const kid = run('keyid', keyFile).stdout.trim();
  assert.match(kid, /^sha256:[0-9a-f]{64}$/);
  const bi = JSON.parse(readFileSync(join(copy, 'build-info.json'), 'utf8'));
  assert.equal(kid, bi.signing.releaseKeyId, 'keyId của khóa riêng bằng keyId của khóa công khai');
});

test('sums.mjs genkey: khóa thử P-256 ngoài repo; từ chối ghi khóa riêng vào repo', () => {
  const w = tmp();
  const run = (...a) => spawnSync(process.execPath, [sumsCli, ...a], { encoding: 'utf8' });
  const r = run('genkey', '--out-dir', w, '--name', 'dry');
  assert.equal(r.status, 0, r.stderr);
  const priv = readFileSync(join(w, 'dry.key.pem'), 'utf8');
  assert.match(priv, /BEGIN PRIVATE KEY/);
  assert.equal(
    run('keyid', join(w, 'dry.key.pem')).stdout,
    run('keyid', join(w, 'dry.pub.pem')).stdout,
  );
  const inRepo = run('genkey', '--out-dir', join(here, 'should-not-exist'), '--name', 'x');
  assert.equal(inRepo.status, 2);
  assert.match(inRepo.stderr, /repo/);
});

test('verify-release.mjs CLI: --json và --break-cases', () => {
  const { dir, keys, other } = makeRelease();
  const r = spawnSync(
    process.execPath,
    [
      verifyCli,
      '--dir',
      dir,
      '--keys',
      keys,
      '--other-keys',
      other,
      '--allow-missing',
      'installer',
      '--break-cases',
      '--json',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.breakCases.filter((c) => c.rejected).length, 7);
  assert.equal(j.breakCases.filter((c) => c.skipped).length, 5);
  const bad = spawnSync(
    process.execPath,
    [verifyCli, '--dir', dir, '--keys', other, '--allow-missing', 'installer'],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /KEY_UNKNOWN/);
});

const openssl = findOpenssl();
test(
  'khóa P-256 tham số tường minh (LibreSSL genpkey mặc định) bị từ chối: keyId sẽ khác thiết bị',
  { skip: openssl ? false : 'không có openssl' },
  () => {
    const w = tmp();
    const key = join(w, 'explicit.key.pem');
    const g = spawnSync(
      openssl,
      [
        'ecparam',
        '-name',
        'prime256v1',
        '-param_enc',
        'explicit',
        '-genkey',
        '-noout',
        '-out',
        key,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(g.status, 0, g.stderr);
    const r = spawnSync(process.execPath, [sumsCli, 'keyid', key], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /named curve/);
  },
);

const pwsh = findPwsh();
test(
  'verify-release.ps1: chạy phần Node, ca Authenticode in BỎ QUA khi không phải Windows',
  {
    skip: !pwsh
      ? 'không có PowerShell'
      : process.platform === 'win32'
        ? 'chạy thật trên Windows (T102)'
        : false,
  },
  () => {
    const { dir, keys, other } = makeRelease();
    const r = runPwsh(pwsh, [
      '-File',
      join(here, 'verify-release.ps1'),
      '-Dir',
      dir,
      '-Keys',
      keys,
      '-OtherKeys',
      other,
      '-BreakCases',
    ]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /BỎ QUA.*Authenticode/);
    assert.match(r.stdout, /7\/7/);
    assert.match(r.stdout, /BẢN THỬ/);
    const rel = runPwsh(pwsh, [
      '-File',
      join(here, 'verify-release.ps1'),
      '-Dir',
      dir,
      '-Keys',
      keys,
      '-Release',
    ]);
    assert.notEqual(rel.status, 0, 'chế độ phát hành không cho bỏ qua Authenticode');
  },
);
