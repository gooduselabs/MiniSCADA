// Test SBOM CycloneDX 1.5 (feature 011, T089; FR-052, SC-018): node --test tools/release/sbom.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeFixtureRepo } from './lib/fixtures.mjs';
import { buildSbom } from './sbom.mjs';
import { collectComponents } from './lib/components.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const cli = join(here, 'sbom.mjs');
const temps = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'mat-sbom-'));
  temps.push(d);
  return d;
}

function runCli(root, out, extra = []) {
  return spawnSync(process.execPath, [cli, '--root', root, '--out', out, ...extra], {
    encoding: 'utf8',
  });
}

test('CycloneDX 1.5 tối thiểu: trường bắt buộc và thành phần có name, version, purl, licenses', () => {
  const dir = tmp();
  makeFixtureRepo(dir);
  const out = join(dir, 'sbom.cdx.json');
  const r = runCli(dir, out, [
    '--cargo-metadata',
    join(dir, 'cargo-metadata.json'),
    '--version',
    '1.0.0-rc.1',
  ]);
  assert.equal(r.status, 0, r.stderr);
  const bom = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.5');
  assert.match(
    bom.serialNumber,
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(bom.version, 1);
  assert.match(bom.metadata.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  assert.equal(bom.metadata.component.name, 'mAT SCADA');
  assert.equal(bom.metadata.component.version, '1.0.0-rc.1');
  assert.ok(Array.isArray(bom.metadata.tools.components));
  assert.ok(bom.components.length > 0);
  const refs = new Set();
  for (const c of bom.components) {
    for (const k of ['type', 'bom-ref', 'name', 'version', 'purl']) {
      assert.equal(typeof c[k], 'string', `${c.name}: ${k}`);
    }
    assert.ok(Array.isArray(c.licenses) && c.licenses.length === 1, `${c.name}: licenses`);
    const l = c.licenses[0];
    assert.ok(l.expression || l.license?.id || l.license?.name, `${c.name}: license rỗng`);
    assert.ok(!refs.has(c['bom-ref']), `bom-ref trùng ${c['bom-ref']}`);
    refs.add(c['bom-ref']);
  }
  const byPurl = new Map(bom.components.map((c) => [c.purl, c]));
  assert.deepEqual(byPurl.get('pkg:cargo/serde@1.0.228').licenses, [
    { expression: 'MIT OR Apache-2.0' },
  ]);
  assert.deepEqual(byPurl.get('pkg:npm/lit@3.3.3').licenses, [{ license: { id: 'BSD-3-Clause' } }]);
  assert.deepEqual(byPurl.get('pkg:generic/sqlite@3.54.0').licenses, [
    { expression: 'LicenseRef-Public-Domain' },
  ]);
  assert.equal(byPurl.get('pkg:npm/devtool@2.0.0').scope, 'excluded');
  assert.equal(byPurl.get('pkg:generic/googletest@1.15.2').scope, 'excluded');
  assert.equal(byPurl.get('pkg:cargo/serde@1.0.228').hashes[0].alg, 'SHA-256');
});

test('ổn định: hai lần chạy chỉ khác serialNumber và timestamp', () => {
  const dir = tmp();
  makeFixtureRepo(dir);
  const meta = join(dir, 'cargo-metadata.json');
  const a = join(dir, 'a.json');
  const b = join(dir, 'b.json');
  assert.equal(runCli(dir, a, ['--cargo-metadata', meta]).status, 0);
  assert.equal(runCli(dir, b, ['--cargo-metadata', meta]).status, 0);
  const strip = (p) => {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    assert.ok(j.serialNumber && j.metadata.timestamp);
    delete j.serialNumber;
    delete j.metadata.timestamp;
    return JSON.stringify(j);
  };
  const ja = JSON.parse(readFileSync(a, 'utf8'));
  const jb = JSON.parse(readFileSync(b, 'utf8'));
  assert.notEqual(ja.serialNumber, jb.serialNumber);
  assert.equal(strip(a), strip(b));
});

test('SOURCE_DATE_EPOCH cố định timestamp', () => {
  const dir = tmp();
  makeFixtureRepo(dir);
  const out = join(dir, 's.json');
  const r = spawnSync(
    process.execPath,
    [cli, '--root', dir, '--out', out, '--cargo-metadata', join(dir, 'cargo-metadata.json')],
    { encoding: 'utf8', env: { ...process.env, SOURCE_DATE_EPOCH: '1767225600' } },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).metadata.timestamp, '2026-01-01T00:00:00Z');
});

test('repo thật: 100 % gói của package-lock.json và Cargo.lock và mọi thư viện third_party có mặt', () => {
  const comps = collectComponents({ root: repoRoot, cargoMetadata: null });
  const bom = buildSbom(comps, { version: '0.0.0-test', timestamp: '2026-01-01T00:00:00Z' });
  const purls = new Set(bom.components.map((c) => c.purl));

  const lock = JSON.parse(readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'));
  const npmWanted = new Set();
  for (const [k, v] of Object.entries(lock.packages)) {
    if (k === '' || v.link) continue;
    const name = v.name ?? k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length);
    npmWanted.add(`pkg:npm/${name.replace(/^@/, '%40')}@${v.version}`);
  }
  for (const p of npmWanted) assert.ok(purls.has(p), `thiếu ${p}`);

  const cargoLock = readFileSync(join(repoRoot, 'apps/studio/src-tauri/Cargo.lock'), 'utf8');
  const crateWanted = [
    ...cargoLock.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g),
  ].map((m) => `pkg:cargo/${m[1]}@${m[2]}`);
  assert.ok(crateWanted.length > 400);
  for (const p of crateWanted) assert.ok(purls.has(p), `thiếu ${p}`);

  for (const n of ['civetweb', 'nlohmann', 'valijson', 'sqlite', 'mbedtls', 'argon2', 'miniz']) {
    assert.ok(
      [...purls].some((p) => p.startsWith(`pkg:generic/${n}@`)),
      `thiếu ${n}`,
    );
  }
  assert.equal(
    bom.components.length,
    npmWanted.size + new Set(crateWanted).size + comps.counts.vendored,
  );
});
