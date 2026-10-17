// Test cổng `-Release` (feature 011, T088; FR-049, SC-017; contract release-signing §2):
//   node --test tools/release/gate.test.mjs
// Phần Node (evaluateGate, CLI, trạng thái cây git) chạy mọi nơi. Phần PowerShell (đọc chứng chỉ X.509 thật bằng
// tools/release/lib/signing.ps1 rồi qua cổng) chạy khi có `pwsh` (hoặc `powershell` trên Windows) và `openssl`;
// chứng chỉ sinh vào thư mục tạm, không vào repo, không vào kho chứng chỉ.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CODES, evaluateGate, readTreeState } from './gate.mjs';
import { keyIdOf } from './lib/release-crypto.mjs';
import { findOpenssl, findPwsh, runPwsh } from './lib/pwsh.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, 'gate.mjs');
const temps = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mat-gate-'));
  temps.push(d);
  return d;
};

const NOW = new Date('2026-10-17T00:00:00Z');
const day = 86400000;

/** Chứng chỉ phát hành "tốt": CA công cộng, còn 1 năm, EKU Code Signing, RSA 3072, SHA-256. */
function goodInfo() {
  const k = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    cert: {
      thumbprint: 'A'.repeat(40),
      subject: 'CN=ATPro JSC, O=ATPro JSC, C=VN',
      issuer: 'CN=Some Public Code Signing CA R36, O=Some CA, C=GB',
      friendlyName: '',
      notBefore: new Date(NOW - 30 * day).toISOString(),
      notAfter: new Date(+NOW + 365 * day).toISOString(),
      ekus: ['1.3.6.1.5.5.7.3.3'],
      keyAlgorithm: 'RSA',
      keySize: 3072,
      signatureAlgorithm: 'sha256RSA',
      chainTrusted: true,
    },
    signature: { status: 'Valid', timestamped: true, verified: true, digest: 'sha256' },
    tree: { dirty: false, commit: 'c'.repeat(40), buildInfoCommit: 'c'.repeat(40) },
    releaseKey: { keyId: keyIdOf(k.publicKey) },
    testKeyIds: [],
  };
}

const codes = (r) => r.failures.map((f) => f.code).sort();

test('chứng chỉ tốt, chế độ phát hành: qua cổng', () => {
  const r = evaluateGate(goodInfo(), { release: true, phase: 'all', now: NOW });
  assert.deepEqual(r.failures, []);
  assert.equal(r.ok, true);
  assert.equal(r.testBuild, false);
});

test('8 điều kiện từ chối của cổng -Release, mỗi điều kiện một mã', () => {
  const cases = [
    ['CERT_TEST', (i) => (i.cert.subject = 'CN=mAT SCADA TEST - NOT FOR RELEASE')],
    ['CERT_TEST', (i) => (i.cert.friendlyName = 'my test cert')],
    ['CERT_SELF_SIGNED', (i) => (i.cert.issuer = i.cert.subject)],
    ['CERT_SELF_SIGNED', (i) => (i.cert.chainTrusted = false)],
    ['CERT_SELF_SIGNED', (i) => (i.cert.chainTrusted = null)],
    ['CERT_EXPIRING', (i) => (i.cert.notAfter = new Date(+NOW + 30 * day).toISOString())],
    ['CERT_EXPIRING', (i) => (i.cert.notAfter = new Date(+NOW - day).toISOString())],
    ['CERT_EKU', (i) => (i.cert.ekus = ['1.3.6.1.5.5.7.3.1'])],
    ['CERT_EKU', (i) => (i.cert.ekus = [])],
    ['CERT_WEAK', (i) => (i.cert.keySize = 2048)],
    ['CERT_WEAK', (i) => Object.assign(i.cert, { keyAlgorithm: 'ECDSA', keySize: 224 })],
    ['CERT_WEAK', (i) => (i.cert.signatureAlgorithm = 'sha1RSA')],
    ['CERT_WEAK', (i) => (i.signature.digest = 'sha1')],
    ['NO_TIMESTAMP', (i) => (i.signature.timestamped = false)],
    ['VERIFY_AFTER_SIGN', (i) => (i.signature.verified = false)],
    ['VERIFY_AFTER_SIGN', (i) => (i.signature.verified = null)],
    ['DIRTY_TREE', (i) => (i.tree.dirty = true)],
    ['DIRTY_TREE', (i) => (i.tree.buildInfoCommit = 'd'.repeat(40))],
    ['DIRTY_TREE', (i) => (i.tree = null)],
    ['CERT_TEST_KEY', (i) => i.testKeyIds.push(i.releaseKey.keyId)],
  ];
  const seen = new Set();
  for (const [code, mutate] of cases) {
    const info = goodInfo();
    mutate(info);
    const r = evaluateGate(info, { release: true, phase: 'all', now: NOW });
    assert.equal(r.ok, false, `${code}: ${mutate}`);
    assert.deepEqual(codes(r), [code], `${mutate}`);
    seen.add(code);
  }
  for (const c of [
    'CERT_TEST',
    'CERT_SELF_SIGNED',
    'CERT_EXPIRING',
    'CERT_EKU',
    'CERT_WEAK',
    'NO_TIMESTAMP',
    'VERIFY_AFTER_SIGN',
    'DIRTY_TREE',
  ]) {
    assert.ok(seen.has(c), c);
    assert.ok(CODES[c], `mã ${c} có mô tả`);
  }
});

test('chế độ thử: cho chứng chỉ TEST tự ký, bỏ điều kiện 2, 3, 6, 8; vẫn kiểm EKU, khóa yếu, kiểm lại', () => {
  const info = goodInfo();
  Object.assign(info.cert, {
    subject: 'CN=mAT SCADA TEST - NOT FOR RELEASE',
    issuer: 'CN=mAT SCADA TEST - NOT FOR RELEASE',
    chainTrusted: false,
    notAfter: new Date(+NOW + 5 * day).toISOString(),
  });
  info.signature.timestamped = false;
  info.tree.dirty = true;
  const r = evaluateGate(info, { release: false, phase: 'all', now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r.failures));
  assert.equal(r.testBuild, true);

  for (const [code, mutate] of [
    ['CERT_EKU', (i) => (i.cert.ekus = [])],
    ['CERT_WEAK', (i) => (i.cert.keySize = 2048)],
    ['VERIFY_AFTER_SIGN', (i) => (i.signature.verified = false)],
  ]) {
    const i2 = structuredClone(info);
    mutate(i2);
    assert.deepEqual(codes(evaluateGate(i2, { release: false, phase: 'all', now: NOW })), [code]);
  }
  const i3 = structuredClone(info);
  i3.signature.verified = null;
  const r3 = evaluateGate(i3, { release: false, phase: 'all', now: NOW });
  assert.equal(r3.ok, true);
  assert.ok(r3.warnings.some((w) => /kiểm lại/.test(w)));
});

test('pha pre chỉ xét chứng chỉ, cây git, khóa; pha post chỉ xét chữ ký', () => {
  const info = goodInfo();
  info.signature = null;
  assert.equal(evaluateGate(info, { release: true, phase: 'pre', now: NOW }).ok, true);
  const i2 = goodInfo();
  i2.cert.subject = 'CN=TEST';
  i2.signature.timestamped = false;
  assert.deepEqual(codes(evaluateGate(i2, { release: true, phase: 'post', now: NOW })), [
    'NO_TIMESTAMP',
  ]);
});

test('CLI: mã thoát 1 và mã lỗi khi từ chối; chế độ thử in "BẢN THỬ, KHÔNG PHÁT HÀNH"', () => {
  const d = tmp();
  const info = goodInfo();
  info.cert.subject = 'CN=mAT SCADA TEST - NOT FOR RELEASE';
  const f = join(d, 'info.json');
  writeFileSync(f, JSON.stringify(info));
  const r1 = spawnSync(
    process.execPath,
    [cli, '--info', f, '--release', '--now', NOW.toISOString()],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /CERT_TEST/);
  const r2 = spawnSync(process.execPath, [cli, '--info', f, '--now', NOW.toISOString()], {
    encoding: 'utf8',
  });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /BẢN THỬ, KHÔNG PHÁT HÀNH/);
  const r3 = spawnSync(process.execPath, [cli, '--info', f, '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(r3.stdout).testBuild, true);
});

test('trạng thái cây git: sạch, có thay đổi, commit khác build-info', () => {
  const d = tmp();
  const git = (...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  writeFileSync(join(d, 'a.txt'), '1');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'x');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  assert.deepEqual(readTreeState(d), { dirty: false, commit: head, buildInfoCommit: null });
  writeFileSync(join(d, 'a.txt'), '2');
  assert.equal(readTreeState(d).dirty, true);
  writeFileSync(join(d, 'a.txt'), '1');
  writeFileSync(join(d, 'b.txt'), 'mới');
  assert.equal(readTreeState(d).dirty, true, 'tệp chưa theo dõi cũng là bẩn');
  rmSync(join(d, 'b.txt'));
  const bi = join(d, 'build-info.json');
  writeFileSync(bi, JSON.stringify({ commit: 'f'.repeat(40) }));
  const t = readTreeState(d, { buildInfo: bi, ignore: ['build-info.json'] });
  assert.equal(t.dirty, false);
  assert.equal(t.buildInfoCommit, 'f'.repeat(40));
  const info = goodInfo();
  info.tree = t;
  assert.deepEqual(codes(evaluateGate(info, { release: true, phase: 'pre', now: NOW })), [
    'DIRTY_TREE',
  ]);
});

// ---- PowerShell: đọc chứng chỉ thật (lib/signing.ps1, ConvertTo-MatCertInfo) rồi qua cổng ----
const pwsh = findPwsh();
const openssl = findOpenssl();
const psSkip = !pwsh ? 'không có PowerShell' : !openssl ? 'không có openssl' : false;

function makeCert(dir, name, { subj, days, eku = 'codeSigning', bits = 3072 }) {
  const key = join(dir, `${name}.key`);
  const crt = join(dir, `${name}.crt`);
  const cnf = join(dir, `${name}.cnf`);
  writeFileSync(
    cnf,
    [
      '[req]',
      'distinguished_name = dn',
      'x509_extensions = ext',
      'prompt = no',
      '[dn]',
      `CN = ${subj}`,
      '[ext]',
      'basicConstraints = CA:FALSE',
      'keyUsage = digitalSignature',
      ...(eku ? [`extendedKeyUsage = ${eku}`] : []),
      '',
    ].join('\n'),
  );
  const r = spawnSync(
    openssl,
    [
      'req',
      '-x509',
      '-newkey',
      `rsa:${bits}`,
      '-nodes',
      '-sha256',
      '-days',
      String(days),
      '-keyout',
      key,
      '-out',
      crt,
      '-config',
      cnf,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  return crt;
}

test(
  'PowerShell: ConvertTo-MatCertInfo đọc chứng chỉ X.509 và cổng từ chối đúng mã',
  { skip: psSkip },
  () => {
    const d = tmp();
    const lib = join(here, 'lib', 'signing.ps1');
    const certs = {
      test: makeCert(d, 'test', { subj: 'mAT SCADA TEST - NOT FOR RELEASE', days: 90 }),
      weak: makeCert(d, 'weak', { subj: 'ATPro Weak', days: 400, bits: 2048 }),
      noeku: makeCert(d, 'noeku', { subj: 'ATPro NoEku', days: 400, eku: null }),
      expiring: makeCert(d, 'exp', { subj: 'ATPro Expiring', days: 10 }),
    };
    const script = join(d, 'probe.ps1');
    writeFileSync(
      script,
      [
        'param([string]$Lib, [string]$Cert)',
        '$ErrorActionPreference = "Stop"',
        '. $Lib',
        '$c = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $Cert',
        'ConvertTo-MatCertInfo -Certificate $c | ConvertTo-Json -Compress -Depth 5',
        '',
      ].join('\n'),
    );
    const info = {};
    for (const [k, crt] of Object.entries(certs)) {
      const r = runPwsh(pwsh, ['-File', script, '-Lib', lib, '-Cert', crt]);
      assert.equal(r.status, 0, r.stderr);
      info[k] = JSON.parse(r.stdout.trim().split('\n').pop());
    }
    assert.equal(info.test.keyAlgorithm, 'RSA');
    assert.equal(info.test.keySize, 3072);
    assert.match(info.test.thumbprint, /^[0-9A-F]{40}$/);
    assert.deepEqual(info.test.ekus, ['1.3.6.1.5.5.7.3.3']);
    assert.match(info.test.signatureAlgorithm, /sha256/i);
    assert.equal(info.test.chainTrusted, false);

    const gate = (cert) => {
      const g = goodInfo();
      g.cert = cert;
      return codes(evaluateGate(g, { release: true, phase: 'pre', now: new Date() }));
    };
    assert.deepEqual(gate(info.test), ['CERT_SELF_SIGNED', 'CERT_TEST']);
    assert.ok(gate(info.weak).includes('CERT_WEAK'));
    assert.ok(gate(info.noeku).includes('CERT_EKU'));
    assert.ok(gate(info.expiring).includes('CERT_EXPIRING'));
  },
);

test('PowerShell: Invoke-MatGate gọi gate.mjs và trả kết quả', { skip: psSkip }, () => {
  const d = tmp();
  const info = goodInfo();
  info.cert.subject = 'CN=mAT SCADA TEST - NOT FOR RELEASE';
  const f = join(d, 'i.json');
  writeFileSync(f, JSON.stringify(info));
  const script = join(d, 'g.ps1');
  writeFileSync(
    script,
    [
      'param([string]$Lib, [string]$Info)',
      '. $Lib',
      '$o = Get-Content -Raw -LiteralPath $Info | ConvertFrom-Json',
      '$r = Invoke-MatGate -Info $o -Release -Phase all',
      'Write-Output ("OK=" + $r.ok + " CODES=" + (($r.failures | ForEach-Object { $_.code }) -join ","))',
      '',
    ].join('\n'),
  );
  const r = runPwsh(pwsh, ['-File', script, '-Lib', join(here, 'lib', 'signing.ps1'), '-Info', f]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /OK=False CODES=CERT_TEST/);
});
