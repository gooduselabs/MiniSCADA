// node --test tools/measure/tab-rss.test.mjs (feature 011, T079, L5 "RSS tab"): phần không cần Chrome của
// tools/measure/tab-rss.mjs: đối số, thống kê chuỗi mẫu (đầu/cuối/tối đa/độ dốc), tìm tiến trình renderer từ `ps`,
// gán pid cho tab và băm SPKI của chứng chỉ.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assignNewRenderer,
  linearSlopePerHour,
  parseArgs,
  parsePs,
  rendererPids,
  seriesStats,
} from './tab-rss.mjs';

test('parseArgs: mặc định, https cần --fingerprint hoặc --insecure tường minh', () => {
  const c = parseArgs(['--url', 'http://127.0.0.1:8080/']);
  assert.equal(c.pages, 10);
  assert.equal(c.seconds, 600);
  assert.equal(c.intervalS, 10);
  assert.equal(c.tls, 'none');
  assert.throws(() => parseArgs([]), /--url/);
  assert.throws(() => parseArgs(['--url', 'https://h:8443/']), /--fingerprint|--insecure/);
  const fp = 'AB:'.repeat(31) + 'AB';
  const p = parseArgs(['--url', 'https://h:8443/', '--fingerprint', fp, '--pages', '3']);
  assert.equal(p.tls, 'pinned');
  assert.equal(p.fingerprint, 'ab'.repeat(32));
  assert.equal(p.pages, 3);
  assert.equal(parseArgs(['--url', 'https://h:8443/', '--insecure']).tls, 'insecure');
  assert.throws(
    () => parseArgs(['--url', 'https://h:8443/', '--insecure', '--fingerprint', fp]),
    /exclude|loại trừ/,
  );
  assert.throws(() => parseArgs(['--url', 'https://h/', '--fingerprint', 'abcd']), /fingerprint/);
  assert.throws(() => parseArgs(['--url', 'http://h/', '--pages', '0']), /--pages/);
  assert.throws(() => parseArgs(['--url', 'http://h/', '--bogus']), /--bogus/);
});

test('linearSlopePerHour: bình phương tối thiểu, MB/giờ', () => {
  // +1 MB mỗi 60 s = 60 MB/giờ
  const pts = [0, 60, 120, 180].map((t, i) => [t, 100 + i]);
  assert.equal(linearSlopePerHour(pts), 60);
  assert.equal(linearSlopePerHour([[0, 5]]), null);
  assert.equal(
    linearSlopePerHour([
      [10, 5],
      [10, 6],
    ]),
    null,
  );
  assert.equal(
    linearSlopePerHour([
      [0, 50],
      [3600, 50],
    ]),
    0,
  );
});

test('seriesStats: đầu, cuối, tối đa, độ dốc; bỏ mẫu null; độ dốc sau khởi động', () => {
  const s = seriesStats(
    [
      [0, 80],
      [30, 120],
      [60, null],
      [90, 100],
      [120, 101],
    ],
    60,
  );
  assert.equal(s.start, 80);
  assert.equal(s.end, 101);
  assert.equal(s.max, 120);
  assert.equal(s.samples, 4);
  assert.equal(s.slopeAfterWarmupMBPerHour, 120); // (101-100)/30 s
  assert.ok(typeof s.slopeMBPerHour === 'number');
  const e = seriesStats([], 0);
  assert.equal(e.start, null);
  assert.equal(e.max, null);
  assert.equal(e.slopeMBPerHour, null);
});

const PS = `
  100     1  51200 /opt/chrome-headless-shell --remote-debugging-port=0 --user-data-dir=/tmp/x
  101   100  20480 /opt/chrome-headless-shell --type=gpu-process
  102   100  10240 /opt/chrome-headless-shell --type=utility --utility-sub-type=network.mojom.NetworkService
  103   100  40960 /opt/chrome-headless-shell --type=renderer --renderer-client-id=5
  104   101  30720 /opt/chrome-headless-shell --type=renderer --renderer-client-id=6
  200     1  99999 /opt/other --type=renderer
`;

test('parsePs + rendererPids: chỉ renderer con cháu của tiến trình Chrome của công cụ', () => {
  const rows = parsePs(PS);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[3], {
    pid: 103,
    ppid: 100,
    rssKB: 40960,
    command: '/opt/chrome-headless-shell --type=renderer --renderer-client-id=5',
  });
  assert.deepEqual(
    rendererPids(rows, 100).sort((a, b) => a - b),
    [103, 104],
  );
  assert.deepEqual(rendererPids(rows, 999), []);
});

test('assignNewRenderer: pid mới duy nhất; nhiều pid mới thì lấy RSS lớn nhất và ghi mơ hồ', () => {
  const rss = new Map([
    [103, 40960],
    [104, 30720],
    [105, 2048],
  ]);
  assert.deepEqual(assignNewRenderer([103, 104], new Set([103]), rss), {
    pid: 104,
    ambiguous: false,
    candidates: [104],
  });
  assert.deepEqual(assignNewRenderer([103, 104, 105], new Set([103]), rss), {
    pid: 104,
    ambiguous: true,
    candidates: [104, 105],
  });
  assert.deepEqual(assignNewRenderer([103], new Set([103]), rss), {
    pid: null,
    ambiguous: true,
    candidates: [],
  });
});
