// Test build-info.json và kiểm phiên bản đồng nhất (feature 011, T098; FR-052, FR-055; data-model `build-info.json`):
//   node --test tools/release/build-info.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkVersions, nextReleaseSeq, readVersions } from './build-info.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const cli = join(here, 'build-info.mjs');
const temps = [];
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

function fixture(v = {}) {
  const d = mkdtempSync(join(tmpdir(), 'mat-bi-'));
  temps.push(d);
  const put = (rel, text) => {
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    writeFileSync(join(d, rel), text);
  };
  put(
    'apps/studio/package.json',
    JSON.stringify({ name: '@mat/studio', version: v.pkg ?? '1.0.0-rc.1' }),
  );
  put(
    'apps/studio/src-tauri/tauri.conf.json',
    JSON.stringify({ version: v.tauri ?? '1.0.0-rc.1' }),
  );
  put(
    'apps/studio/src-tauri/Cargo.toml',
    `[package]\nname = "mat-studio"\nversion = "${v.cargo ?? '1.0.0-rc.1'}"\n\n[dependencies]\nserde = { version = "1" }\n`,
  );
  put(
    'CMakeLists.txt',
    v.cmake === null
      ? 'project(mat_scada LANGUAGES C CXX)\n'
      : `project(mat_scada VERSION ${v.cmake ?? '1.0.0'} LANGUAGES C CXX)\n`,
  );
  put(
    'core/project-manager/project_validator.hpp',
    `constexpr const char* kRuntimeVersion = "${v.runtime ?? '1.0.0-rc.1'}";\n`,
  );
  return d;
}

test('đọc phiên bản từ năm nguồn', () => {
  const v = readVersions(fixture());
  assert.deepEqual(v, {
    studioPackage: '1.0.0-rc.1',
    tauriConf: '1.0.0-rc.1',
    cargoToml: '1.0.0-rc.1',
    cmake: '1.0.0',
    runtime: '1.0.0-rc.1',
  });
});

test('đồng nhất: CMake so phần số (CMake không nhận hậu tố -rc), lệch thì nêu nguồn', () => {
  assert.equal(checkVersions(readVersions(fixture())).consistent, true);
  assert.equal(
    checkVersions(readVersions(fixture({ cmake: null }))).consistent,
    true,
    'CMake không khai VERSION: bỏ qua',
  );
  const bad = checkVersions(readVersions(fixture({ runtime: '0.9.0' })));
  assert.equal(bad.consistent, false);
  assert.match(bad.mismatches.join('\n'), /runtime.*0\.9\.0/);
  const exp = checkVersions(readVersions(fixture()), '1.0.0-rc.2');
  assert.equal(exp.consistent, false);
  assert.equal(checkVersions(readVersions(fixture({ cmake: '1.0.1' }))).consistent, false);
});

test('repo thật: đọc được cả năm nguồn (CMake có thể chưa khai VERSION)', () => {
  const v = readVersions(repoRoot);
  for (const k of ['studioPackage', 'tauriConf', 'cargoToml', 'runtime']) {
    assert.match(v[k], /^\d+\.\d+\.\d+/, k);
  }
});

test('releaseSeq: tệp có số thì cộng 1, không có tệp thì 1, nội dung lạ thì lỗi', () => {
  const d = fixture();
  const f = join(d, 'releaseSeq.txt');
  assert.equal(nextReleaseSeq(f), 1);
  writeFileSync(f, '11\n');
  assert.equal(nextReleaseSeq(f), 12);
  writeFileSync(f, 'x');
  assert.throws(() => nextReleaseSeq(f), /releaseSeq/);
});

test('CLI write: build-info.json đủ trường của data-model', () => {
  const d = fixture();
  const out = join(d, 'build-info.json');
  const r = spawnSync(
    process.execPath,
    [
      cli,
      'write',
      '--root',
      repoRoot,
      '--out',
      out,
      '--version',
      '1.0.0-rc.1',
      '--release-seq',
      '7',
      '--sign-mode',
      'test',
      '--thumbprint',
      'AB'.repeat(20),
      '--release-key-id',
      'sha256:' + '0'.repeat(64),
      '--skipped',
      'studio,update',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  const bi = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(bi.version, '1.0.0-rc.1');
  assert.equal(bi.releaseSeq, 7);
  assert.match(bi.commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof bi.dirty, 'boolean');
  assert.match(bi.builtAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(bi.release, false, 'mặc định là bản thử');
  assert.equal(bi.tools.node, process.version);
  assert.deepEqual(bi.signing, {
    mode: 'test',
    thumbprint: 'AB'.repeat(20),
    timestampUrl: null,
    releaseKeyId: 'sha256:' + '0'.repeat(64),
  });
  assert.deepEqual(bi.skipped, ['studio', 'update']);
  assert.ok(bi.versions.studioPackage);
});

test('CLI versions: mã thoát 1 khi lệch', () => {
  const ok = spawnSync(process.execPath, [cli, 'versions', '--root', fixture()], {
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0, ok.stderr);
  const bad = spawnSync(
    process.execPath,
    [cli, 'versions', '--root', fixture({ tauri: '0.8.0' })],
    {
      encoding: 'utf8',
    },
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stdout + bad.stderr, /tauriConf/);
});
