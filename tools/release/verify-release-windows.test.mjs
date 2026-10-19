// Test verify-release.ps1 trên Windows (feature 011, T088, T094; SC-017): kiểm Authenticode bằng chứng chỉ thử THẬT và
// 12 ca hỏng (ca 1–5 là Authenticode, chỉ chạy được ở đây; ca 6–12 do verify-release.mjs). Ngoài Windows mọi ca bị bỏ
// qua (phần chung nằm ở verify-release.test.mjs). Chứng chỉ thử được gỡ ở `after`; không đụng kho tin cậy.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeRelease } from './lib/make-release-fixture.mjs';
import { findPwsh, runPwsh } from './lib/pwsh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const isWin = process.platform === 'win32';
const pwsh = findPwsh();
const skip = !isWin ? 'chỉ Windows' : !pwsh ? 'không có PowerShell' : false;

const temps = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mat-vrwin-'));
  temps.push(d);
  return d;
};
const script = (name, args, env = {}) =>
  runPwsh(pwsh, ['-File', join(here, name), ...args], { env: { ...process.env, ...env } });
const ps = (cmd) => {
  const r = runPwsh(pwsh, ['-Command', cmd]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout.trim();
};
const count = (store, like) =>
  Number(ps(`@(Get-ChildItem '${store}' | Where-Object Subject -like '${like}').Count`));

let cert = null;
before(() => {
  if (skip) return;
  script('make-test-cert.ps1', ['-Remove']);
  const r = script('make-test-cert.ps1', ['-Json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  cert = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
});
after(() => {
  if (!skip) script('make-test-cert.ps1', ['-Remove']);
  temps.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

/** .exe nhỏ chưa ký (csc.exe của .NET Framework), rồi ký bằng chứng chỉ thử qua sign.ps1. */
function signedExe(dir, name) {
  const src = join(dir, 'f.cs');
  writeFileSync(src, 'class P { static int Main() { return 0; } }');
  const csc = join(
    process.env.WINDIR ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  );
  const raw = join(dir, `raw-${name}`);
  const c = spawnSync(csc, ['/nologo', `/out:${raw}`, src], { encoding: 'utf8' });
  assert.equal(c.status, 0, c.stdout + c.stderr);
  const out = join(dir, name);
  copyFileSync(raw, out);
  const s = script('sign.ps1', [
    '-Mode',
    'test',
    '-Path',
    out,
    '-LogPath',
    join(dir, 'sign-log.json'),
  ]);
  assert.equal(s.status, 0, s.stdout + s.stderr);
  return out;
}

function fixture() {
  const work = tmp();
  const setupName = 'mat-studio-1.0.0-rc.0-setup.exe';
  const exe = signedExe(work, 'mat-studio.exe');
  const setup = signedExe(work, setupName);
  const rel = makeRelease(tmp(), { [setupName]: readFileSync(setup) });
  return { ...rel, exe, setupPath: join(rel.dir, setupName) };
}

test(
  'verify-release.ps1: bộ cài và mat-studio.exe ký bằng chứng chỉ thử → đạt, đúng dấu vân tay',
  { skip },
  () => {
    const { dir, keys, exe } = fixture();
    const r = script('verify-release.ps1', [
      '-Dir',
      dir,
      '-Keys',
      keys,
      '-StudioExe',
      exe,
      '-Thumbprint',
      cert.thumbprint,
    ]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /OK {2}Authenticode mat-studio-1\.0\.0-rc\.0-setup\.exe/);
    assert.match(r.stdout, /OK {2}Authenticode mat-studio\.exe/);
    assert.match(r.stdout, /BẢN THỬ/);
  },
);

test('verify-release.ps1: sai dấu vân tay người ký → không đạt', { skip }, () => {
  const { dir, keys, exe } = fixture();
  const r = script('verify-release.ps1', [
    '-Dir',
    dir,
    '-Keys',
    keys,
    '-StudioExe',
    exe,
    '-Thumbprint',
    'A'.repeat(40),
  ]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /khác/);
});

test(
  'verify-release.ps1 -Release với chứng chỉ thử: không đạt (cần Valid và dấu thời gian)',
  { skip },
  () => {
    const { dir, keys, exe } = fixture();
    const r = script('verify-release.ps1', [
      '-Dir',
      dir,
      '-Keys',
      keys,
      '-StudioExe',
      exe,
      '-Release',
    ]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /chế độ phát hành cần Valid|NO_TIMESTAMP/);
  },
);

test(
  'verify-release.ps1: bộ cài bị sửa sau khi ký → không đạt (HashMismatch và SHA256SUMS)',
  { skip },
  () => {
    const { dir, keys, exe, setupPath } = fixture();
    const b = readFileSync(setupPath);
    b[1000] ^= 1;
    writeFileSync(setupPath, b);
    const r = script('verify-release.ps1', ['-Dir', dir, '-Keys', keys, '-StudioExe', exe]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /Authenticode/);
  },
);

test(
  'verify-release.ps1 -BreakCases: đủ 12 ca bị từ chối, không để lại chứng chỉ rác',
  { skip },
  () => {
    const { dir, keys, other, exe } = fixture();
    const r = script('verify-release.ps1', [
      '-Dir',
      dir,
      '-Keys',
      keys,
      '-OtherKeys',
      other,
      '-StudioExe',
      exe,
      '-Thumbprint',
      cert.thumbprint,
      '-BreakCases',
    ]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (let i = 1; i <= 5; i++) {
      assert.match(r.stdout, new RegExp(`ca ${i} từ chối`), `ca ${i}`);
    }
    assert.doesNotMatch(r.stdout, /KHÔNG bị từ chối/);
    assert.doesNotMatch(r.stdout, /ca \d+ BỎ QUA/);
    assert.match(r.stdout, /12\/12/);
    // Ca 4 tạo chứng chỉ khác tạm thời: phải gỡ sạch (My và bản sao CA), chỉ còn chứng chỉ thử chính.
    assert.equal(count('Cert:\\CurrentUser\\My', '*verify-release case 4*'), 0);
    assert.equal(count('Cert:\\CurrentUser\\CA', '*mAT SCADA TEST*'), 0);
    for (const s of ['Root', 'TrustedPublisher']) {
      assert.equal(count(`Cert:\\CurrentUser\\${s}`, '*mAT SCADA TEST*'), 0, s);
    }
  },
);
