// node --test tests/web-it/load-011.test.mjs (feature 011, T071): phần không cần Chrome của f5-storm.mjs (L4) và svg-load.mjs (L5):
// đọc đối số, --dry-run (không mở Chrome, không kết nối), tổng hợp số đo, dựng màn hình SVG đo. Không chạy với thiết bị nào.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseF5, summarizeRounds } from './f5-storm.mjs';
import { buildSvgScreen, parseArgs as parseSvg, summarizeFps } from './svg-load.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const node = (script, ...args) =>
  spawnSync(process.execPath, [join(here, script), ...args], { encoding: 'utf8', timeout: 20000 });

test('f5-storm: mặc định L4 = 10 trang, 50 vòng, màn hình 250 item, ngưỡng 5 s, runtime x64 loopback', () => {
  const c = parseF5([], {});
  assert.equal(c.pages, 10);
  assert.equal(c.rounds, 50);
  assert.equal(c.items, 250);
  assert.equal(c.limitMs, 5000);
  assert.equal(c.screen, 'tong-quan');
  assert.equal(c.base, 'https://127.0.0.1:18443');
  assert.equal(parseF5([], { MAT_IT_HTTPS_PORT: '28443' }).base, 'https://127.0.0.1:28443');
  const d = parseF5(['--base', 'https://10.0.0.5:8443', '--rounds', '3', '--login', '--dry-run']);
  assert.deepEqual([d.base, d.rounds, d.login, d.dryRun], ['https://10.0.0.5:8443', 3, true, true]);
  for (const bad of [
    ['--rounds', '0'],
    ['--pages', 'x'],
    ['--base', 'https://h:1/duong'],
    ['--screen', '../x'],
    ['--out'],
    ['--la'],
  ])
    assert.throws(() => parseF5(bad, {}), undefined, bad.join(' '));
});

test('f5-storm: tổng hợp vòng, Infinity là không có dữ liệu sống (không đạt)', () => {
  const s = summarizeRounds(
    [
      [1200, 1500, 900],
      [2000, 6000, 1000],
    ],
    5000,
  );
  assert.deepEqual(s.worstMsPerRound, [1500, 6000]);
  assert.equal(s.overLimit, 1);
  assert.equal(s.pass, false);
  assert.equal(s.maxMs, 6000);
  const f = summarizeRounds([[1000, Infinity]], 5000);
  assert.equal(f.failed, 1);
  assert.equal(f.pass, false);
  assert.deepEqual(f.worstMsPerRound, [null]);
  assert.equal(summarizeRounds([[1000, 4999]], 5000).pass, true);
  assert.equal(summarizeRounds([], 5000).pass, false);
});

test('f5-storm --dry-run: in cấu hình, mã 0; đối số sai: mã 2', () => {
  const r = node('f5-storm.mjs', '--dry-run', '--rounds', '2');
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.scenario, 'L4');
  assert.equal(doc.config.rounds, 2);
  assert.equal(node('f5-storm.mjs', '--rounds', '-1').status, 2);
});

test('svg-load: mặc định L5 = 400 phần tử, 50 hoạt ảnh, ngưỡng 30 FPS; giới hạn 300 đến 500', () => {
  const c = parseSvg([]);
  assert.deepEqual([c.elements, c.animations, c.minFps], [400, 50, 30]);
  assert.equal(parseSvg(['--elements', '300']).elements, 300);
  assert.equal(parseSvg(['--elements', '500']).elements, 500);
  for (const bad of [['--elements', '299'], ['--elements', '501'], ['--animations', '0'], ['--x']])
    assert.throws(() => parseSvg(bad), undefined, bad.join(' '));
});

test('svg-load: màn hình SVG có đúng số phần tử và số hoạt ảnh', () => {
  for (const [n, a] of [
    [300, 50],
    [500, 50],
  ]) {
    const s = buildSvgScreen(n, a);
    assert.equal((s.svg.match(/data-mat-uid=/g) ?? []).length, n);
    assert.equal(s.bindings.elements.length, a);
    const targets = s.bindings.elements.map((e) => e.bindings[0].target);
    assert.ok(targets.includes('effect.blink') && targets.includes('effect.flow'));
    assert.ok(s.bindings.elements.some((e) => e.bindings[0].animation === 'spin'));
  }
});

test('svg-load: FPS mỗi trang, trang chậm nhất quyết định', () => {
  const s = summarizeFps(
    [
      { frames: 1800, seconds: 60 },
      { frames: 1500, seconds: 60 },
    ],
    30,
  );
  assert.deepEqual(s.fpsPerPage, [30, 25]);
  assert.equal(s.minFps, 25);
  assert.equal(s.pass, false);
  assert.equal(summarizeFps([{ frames: 3600, seconds: 60 }], 30).pass, true);
  assert.equal(summarizeFps([], 30).pass, false);
});

test('svg-load --dry-run: mã 0, không mở Chrome', () => {
  const r = node('svg-load.mjs', '--dry-run', '--elements', '300');
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.scenario, 'L5');
  assert.equal(doc.config.elements, 300);
  assert.equal(node('svg-load.mjs', '--elements', '1000').status, 2);
});
