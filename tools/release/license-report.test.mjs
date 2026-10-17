// Test rà license (feature 011, T057; FR-027, D16): node --test tools/release/license-report.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectComponents } from './lib/components.mjs';
import { makeFixtureRepo } from './lib/fixtures.mjs';
import { classifyLicense } from './lib/license-policy.mjs';
import { buildLicenseReport, renderLicensesMd } from './license-report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const cli = join(here, 'license-report.mjs');
const temps = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

function fixture(opt) {
  const dir = mkdtempSync(join(tmpdir(), 'mat-lic-'));
  temps.push(dir);
  makeFixtureRepo(dir, opt);
  return dir;
}

function run(dir, extra = []) {
  const out = join(dir, 'licenses.md');
  const r = spawnSync(
    process.execPath,
    [cli, '--root', dir, '--cargo-metadata', join(dir, 'cargo-metadata.json'), '--out', out, ...extra],
    { encoding: 'utf8' },
  );
  return { ...r, out };
}

test('chính sách license: cho phép, có điều kiện, từ chối, không rõ', () => {
  const cases = [
    ['MIT', 'allowed'],
    ['MIT OR Apache-2.0', 'allowed'],
    ['MIT/Apache-2.0', 'allowed'],
    ['Apache-2.0 / MIT', 'allowed'],
    ['(MIT AND Zlib)', 'allowed'],
    ['(MIT OR Apache-2.0) AND Unicode-3.0', 'allowed'],
    ['Apache-2.0 WITH LLVM-exception', 'allowed'],
    ['Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT', 'allowed'],
    ['MIT OR Apache-2.0 OR LGPL-2.1-or-later', 'allowed'],
    ['CDLA-Permissive-2.0', 'allowed'],
    ['BlueOak-1.0.0', 'allowed'],
    ['LicenseRef-Public-Domain', 'allowed'],
    ['MPL-2.0', 'conditional'],
    ['GPL-3.0-only', 'denied'],
    ['GPL-2.0-or-later', 'denied'],
    ['LGPL-2.1-or-later', 'denied'],
    ['AGPL-3.0', 'denied'],
    ['GPL-2.0 AND MIT', 'denied'],
    ['SSPL-1.0', 'denied'],
    ['', 'unknown'],
    [null, 'unknown'],
    ['SEE LICENSE IN LICENSE.txt', 'unknown'],
    ['UNLICENSED', 'unknown'],
    ['Foo-1.0', 'unknown'],
  ];
  for (const [expr, verdict] of cases) {
    assert.equal(classifyLicense(expr).verdict, verdict, `${expr} → ${verdict}`);
  }
  assert.equal(classifyLicense('MIT OR Apache-2.0 OR LGPL-2.1-or-later').chosen, 'MIT');
  assert.equal(classifyLicense('MPL-2.0 OR MIT').verdict, 'allowed');
});

test('gom thành phần: npm (bỏ link, gộp trùng, đọc node_modules, ghi đè), Cargo, third_party', () => {
  const dir = fixture();
  const meta = JSON.parse(readFileSync(join(dir, 'cargo-metadata.json'), 'utf8'));
  const { components, counts, overridesUsed } = collectComponents({ root: dir, cargoMetadata: meta });
  const byRef = new Map(components.map((c) => [`${c.ecosystem}:${c.name}@${c.version}`, c]));

  assert.equal(counts.npm, 7, 'npm: lit, @lit/reactive-element, nolic, png-js, devtool, other, @mat/foo');
  assert.equal(counts.cargo, 4);
  assert.equal(counts.vendored, 4);
  assert.ok(!byRef.has('npm:fixture@0.0.0'), 'gốc workspace là metadata.component, không phải thành phần');
  assert.equal(byRef.get('npm:lit@3.3.3').paths.length, 2, 'lit ở hai chỗ gộp làm một');
  assert.equal(byRef.get('npm:nolic@1.0.0').license, 'ISC');
  assert.equal(byRef.get('npm:nolic@1.0.0').licenseSource, 'node_modules');
  assert.equal(byRef.get('npm:png-js@1.1.0').license, 'MIT');
  assert.equal(byRef.get('npm:png-js@1.1.0').licenseSource, 'override');
  assert.deepEqual(overridesUsed, ['npm:png-js@1.1.0']);
  assert.equal(byRef.get('npm:devtool@2.0.0').dev, true);
  assert.equal(byRef.get('npm:@mat/foo@0.1.0').own, true);
  assert.equal(byRef.get('npm:lit@3.3.3').purl, 'pkg:npm/lit@3.3.3');
  assert.equal(
    byRef.get('npm:@lit/reactive-element@2.1.2').purl,
    'pkg:npm/%40lit/reactive-element@2.1.2',
  );
  assert.equal(byRef.get('npm:lit@3.3.3').hashes[0].alg, 'SHA-512');

  assert.equal(byRef.get('cargo:serde@1.0.228').license, 'MIT OR Apache-2.0');
  assert.equal(byRef.get('cargo:serde@1.0.228').hashes[0].content, 'ab'.repeat(32));
  assert.equal(byRef.get('cargo:mat-studio@0.8.0').own, true);

  const civet = byRef.get('vendored:civetweb@1.16');
  assert.ok(civet, 'CivetWeb từ third_party/LICENSES.md');
  assert.equal(civet.license, 'MIT');
  assert.equal(civet.purl, 'pkg:generic/civetweb@1.16');
  assert.equal(byRef.get('vendored:googletest@1.15.2').dev, true);
  assert.equal(byRef.get('vendored:sqlite@3.54.0').license, 'LicenseRef-Public-Domain');
  assert.equal(byRef.get('vendored:sqlite@3.54.0').hashes[0].alg, 'SHA3-256');
  const mbed = byRef.get('vendored:mbedtls@3.6.7');
  assert.equal(mbed.license, 'Apache-2.0', 'license đã chọn, không phải biểu thức gốc');
});

test('báo cáo sạch: mã thoát 0, licenses.md có đủ mục', () => {
  const dir = fixture();
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const md = readFileSync(r.out, 'utf8');
  assert.match(md, /# License các thành phần/);
  assert.match(md, /civetweb/);
  assert.match(md, /png-js.*MIT.*ghi đè/);
  assert.match(md, /MPL-2\.0/);
  assert.match(md, /Từ chối: 0/);
});

test('GPL hoặc LGPL trong bản phân phối thì từ chối, nêu tên gói', () => {
  const dir = fixture({
    extraNpm: { 'node_modules/badgpl': { version: '1.2.3', license: 'GPL-3.0-only' } },
    extraCrates: [{ name: 'lgpl-only', version: '0.1.0', license: 'LGPL-2.1-or-later' }],
  });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /badgpl@1\.2\.3/);
  assert.match(r.stderr, /lgpl-only@0\.1\.0/);
});

test('license không rõ thì từ chối; gói chỉ khi phát triển chỉ cảnh báo', () => {
  const unknown = fixture({ extraNpm: { 'node_modules/mystery': { version: '0.0.1' } } });
  const r1 = run(unknown);
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /mystery@0\.0\.1/);

  const devOnly = fixture({
    extraNpm: { 'node_modules/gpltool': { version: '1.0.0', dev: true, license: 'GPL-2.0-only' } },
  });
  const r2 = run(devOnly);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout + r2.stderr, /gpltool@1\.0\.0/);
});

test('crate không có license trong cargo metadata thì từ chối; thiếu cargo metadata thì báo rõ', () => {
  const dir = fixture({ extraCrates: [{ name: 'nolic-crate', version: '1.0.0', license: null }] });
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nolic-crate@1\.0\.0/);

  const dir2 = fixture();
  const r2 = spawnSync(
    process.execPath,
    [cli, '--root', dir2, '--cargo-metadata', 'none', '--out', join(dir2, 'l.md')],
    { encoding: 'utf8' },
  );
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /cargo metadata/);
});

test('buildLicenseReport và renderLicensesMd ổn định (cùng đầu vào cùng đầu ra)', () => {
  const dir = fixture();
  const meta = JSON.parse(readFileSync(join(dir, 'cargo-metadata.json'), 'utf8'));
  const a = renderLicensesMd(buildLicenseReport(collectComponents({ root: dir, cargoMetadata: meta })));
  const b = renderLicensesMd(buildLicenseReport(collectComponents({ root: dir, cargoMetadata: meta })));
  assert.equal(a, b);
});

test('repo thật: third_party/LICENSES.md đọc được đủ thư viện vendored', () => {
  const { components } = collectComponents({ root: repoRoot, cargoMetadata: null, npm: false, cargo: false });
  const names = components.map((c) => c.name).sort();
  for (const n of ['argon2', 'civetweb', 'mbedtls', 'miniz', 'nlohmann', 'sqlite', 'valijson']) {
    assert.ok(names.includes(n), `thiếu ${n}`);
  }
  for (const c of components) {
    assert.notEqual(classifyLicense(c.license).verdict, 'unknown', `${c.name}: ${c.license}`);
  }
});
