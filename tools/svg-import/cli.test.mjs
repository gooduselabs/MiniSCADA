// Test CLI nhập SVG (feature 008, T050, FR-025): `svg-inspect.mjs --import [--optimize] [--report-dir] [--out]`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const cli = join(root, 'tools/svg-inspect/svg-inspect.mjs');
const fixtures = join(root, 'tests/fixtures/svg-import');
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const tmp = () => mkdtempSync(join(tmpdir(), 'svg-cli-'));

test('--import: 10 fixture đều nhập được, mã thoát 0', () => {
  const r = run('--import', fixtures);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /10 file/);
  assert.match(r.stdout, /0 lỗi/);
});

test('--import --report-dir --out: ghi báo cáo .md/.json và SVG đã nhập', () => {
  const rep = tmp();
  const out = tmp();
  const f = join(fixtures, 'inkscape-02-motor-pump.svg');
  const r = run('--import', f, '--report-dir', rep, '--out', out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(rep, 'inkscape-02-motor-pump.report.md')));
  const json = JSON.parse(readFileSync(join(rep, 'inkscape-02-motor-pump.report.json'), 'utf8'));
  assert.equal(json.file.name, 'inkscape-02-motor-pump.svg');
  assert.ok(json.counts.uidAssigned > 0);
  const svg = readFileSync(join(out, 'inkscape-02-motor-pump.svg'), 'utf8');
  assert.match(svg, /data-mat-uid=/);
  assert.doesNotMatch(svg, /sodipodi/);
});

test('--optimize: bật Tối ưu trong báo cáo', () => {
  const rep = tmp();
  const f = join(fixtures, 'inkscape-01-tank-process.svg');
  const r = run('--import', '--optimize', f, '--report-dir', rep);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const json = JSON.parse(readFileSync(join(rep, 'inkscape-01-tank-process.report.json'), 'utf8'));
  assert.equal(json.optimize.enabled, true);
});

test('--import: file bị từ chối (script ở mức không nhập được) cho mã thoát 1', () => {
  const dir = tmp();
  const bad = join(dir, 'bad.svg');
  writeFileSync(bad, '<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>');
  const r = run('--import', bad);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /1 lỗi/);
});

test('--import thư mục bỏ qua reimport/ (cặp v1/v2 không phải fixture)', () => {
  const r = run('--import', fixtures);
  assert.doesNotMatch(r.stdout, /v1\.svg/);
});

test('--import thư mục bỏ qua malicious/ và out/', () => {
  const r = run('--import', fixtures);
  assert.doesNotMatch(r.stdout, /m01-script/);
  assert.ok(readdirSync(fixtures).includes('malicious'));
});

test('không --import: hành vi cũ (phân tích) giữ nguyên', () => {
  const r = run(join(fixtures, 'corel-01-mm-css.svg'));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Nguồn:/);
});
