// node --test tools/pilot/kpi.test.mjs (feature 011, T187, T188; FR-138, SC-041; contract test-protocols §6).
// Each folder of tests/pilot-kpi/ is one scenario: data/<site>/<yyyy-mm-dd>.jsonl, incident-log.md and expected.json
// (values worked out by hand from the rules of tests/pilot-kpi/README.md). expected.json lists only the keys it checks:
// objects match on the keys given, arrays match element by element and must have the same length.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { computeKpi, loadSamples, parseIncidentLog, runKpi } from './kpi.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scenariosDir = join(root, 'tests/pilot-kpi');
const cli = join(root, 'tools/pilot/kpi.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'pilot-kpi-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** Partial deep match: every key of `exp` must equal the same key of `act` (recursively). */
function match(act, exp, path = '$') {
  if (Array.isArray(exp)) {
    assert.ok(Array.isArray(act), `${path}: expected an array, got ${JSON.stringify(act)}`);
    assert.equal(act.length, exp.length, `${path}: length (got ${JSON.stringify(act)})`);
    exp.forEach((e, i) => match(act[i], e, `${path}[${i}]`));
  } else if (exp !== null && typeof exp === 'object') {
    assert.ok(
      act !== null && typeof act === 'object',
      `${path}: expected an object, got ${JSON.stringify(act)}`,
    );
    for (const k of Object.keys(exp)) match(act[k], exp[k], `${path}.${k}`);
  } else {
    assert.equal(act, exp, `${path}`);
  }
}

const scenarios = readdirSync(scenariosDir)
  .filter((d) => statSync(join(scenariosDir, d)).isDirectory())
  .sort();

test('bộ dữ liệu mẫu có ít nhất 7 kịch bản, mỗi kịch bản đủ tệp', () => {
  assert.ok(scenarios.length >= 7, `chỉ có ${scenarios.length} kịch bản`);
  for (const s of scenarios) {
    for (const f of ['expected.json', 'incident-log.md', 'data'])
      assert.ok(statSync(join(scenariosDir, s, f)), `${s}/${f}`);
  }
});

for (const s of scenarios) {
  test(`kịch bản ${s}`, () => {
    const dir = join(scenariosDir, s);
    const exp = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
    const kpi = runKpi({
      ...exp.args,
      data: join(dir, 'data'),
      incidents: join(dir, 'incident-log.md'),
    });
    match(kpi, exp.expect);
  });
}

test('mẫu thu không có tên Tag hay giá trị: chỉ các khóa của data-model §6', () => {
  const info = new Set(['version', 'releaseSeq', 'bootId', 'uptimeS', 'warnings']);
  const diagAllowed = [
    'restarts',
    'rssMb',
    'cpuPct',
    'fdCount',
    'ioWriteBytesToday',
    'emmcLife',
    'emmcLifeReason',
    'liveLagP95Ms',
    'clients',
    'timeSynced',
  ];
  for (const s of scenarios) {
    for (const row of loadSamples(join(scenariosDir, s, 'data'), 'lab')) {
      assert.deepEqual(Object.keys(row).sort(), ['diag', 'info', 'site', 't'], s);
      for (const k of Object.keys(row.info)) assert.ok(info.has(k), `${s}: info.${k}`);
      for (const k of Object.keys(row.diag)) assert.ok(diagAllowed.includes(k), `${s}: diag.${k}`);
    }
  }
});

test('nhật ký sự cố: đọc theo tên cột, lọc theo site, nhận cả cột "Loại trừ uptime" của data-model', () => {
  const real = parseIncidentLog(
    readFileSync(join(scenariosDir, '06-planned-update-excluded', 'incident-log.md'), 'utf8'),
  );
  assert.equal(real.length, 4); // the sample row of another site is parsed, filtered later by site
  assert.deepEqual(
    real.map((r) => [r.id, r.level, r.kind, r.status]),
    [
      ['INC-mau-00', 'S3', 'product', 'mở'],
      ['INC-lab-01', 'S3', 'product', 'mở'],
      ['INC-lab-02', '-', 'planned', 'đóng'],
      ['INC-lab-03', 'S2', 'product', 'mở'],
    ],
  );
  const alt = parseIncidentLog(
    [
      '## Sự cố',
      '',
      '| ID | Phát hiện | Mức | Mô tả | Tác động | Nguyên nhân | Xử lý | Bản vá | Hồi quy | Đóng | Loại trừ uptime |',
      '|---|---|---|---|---|---|---|---|---|---|---|',
      '| INC-a-01 | 2026-11-02 08:00 | - | mất điện | | | | | | x | site-power |',
      '| INC-a-02 | 2026-11-02 09:00 | S2 | lỗi | | rò bộ nhớ | | | | | không |',
      '',
      '| Khác | bảng |',
      '|---|---|',
      '| INC-a-99 | không phải sự cố |',
    ].join('\n'),
  );
  assert.deepEqual(
    alt.map((r) => [r.id, r.level, r.kind]),
    [
      ['INC-a-01', '-', 'site'],
      ['INC-a-02', 'S2', 'product'],
    ],
  );
});

test('khung giờ trong cột Tác động; không có thì lấy Phát hiện ± 60 phút', () => {
  const [a, b] = parseIncidentLog(
    [
      '| Mã | Phát hiện | Mức | Loại | Mô tả | Tác động | Nguyên nhân | Xử lý | Bản vá | Hồi quy | Trạng thái | Người đóng |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|',
      '| INC-x-01 | 2026-11-02 10:30 | - | site | | ngừng 2026-11-02 08:00 đến 2026-11-02 10:00 | | | | | đóng | |',
      '| INC-x-02 | 2026-11-02 13:05 | - | planned | | | | | | | đóng | |',
    ].join('\n'),
    420,
  );
  assert.equal(a.windowFrom, Date.parse('2026-11-02T08:00:00+07:00'));
  assert.equal(a.windowTo, Date.parse('2026-11-02T10:00:00+07:00'));
  assert.equal(b.windowFrom, Date.parse('2026-11-02T12:05:00+07:00'));
  assert.equal(b.windowTo, Date.parse('2026-11-02T14:05:00+07:00'));
});

test('không có mẫu nào: X1, X4, X11 Chưa đo, không bao giờ Đạt', () => {
  const k = computeKpi({
    site: 'lab',
    from: '2026-11-02',
    to: '2026-11-02',
    samples: [],
    incidents: [],
  });
  assert.equal(k.criteria.X1, 'Chưa đo');
  assert.equal(k.criteria.X4, 'Chưa đo');
  assert.equal(k.criteria.X11, 'Chưa đo');
  assert.equal(k.criteria.X2, 'Đạt'); // log read, no incident for this site
  assert.equal(k.uptime.ratio, null);
});

test('không có nhật ký sự cố: X2 Chưa đo', () => {
  const dir = join(scenariosDir, '01-normal');
  const k = runKpi({
    site: 'lab',
    from: '2026-11-02',
    to: '2026-11-02',
    data: join(dir, 'data'),
    incidents: join(tmp, 'khong-co.md'),
  });
  assert.equal(k.criteria.X2, 'Chưa đo');
  assert.equal(k.incidents, null);
});

test('ghi đĩa > 2 GiB một ngày: X4 Không đạt kể cả khi thiếu emmcLife; S1: X2 Không đạt', () => {
  const t = (h) => `2026-11-02T${String(h).padStart(2, '0')}:00:00+07:00`;
  const samples = [0, 1, 2].map((h) => ({
    t: t(h),
    site: 'lab',
    info: {
      version: '1.0.0-rc.1',
      releaseSeq: 11,
      bootId: 'b',
      uptimeS: 3600 * (h + 1),
      warnings: [],
    },
    diag: { rssMb: 40, cpuPct: 5, ioWriteBytesToday: { total: 1.1e9 * (h + 1) }, emmcLife: null },
  }));
  const k = computeKpi({
    site: 'lab',
    from: '2026-11-02',
    to: '2026-11-02',
    samples,
    incidents: [
      {
        id: 'INC-lab-01',
        level: 'S1',
        kind: 'product',
        detectedAt: Date.parse(t(1)),
        status: 'đã vá',
      },
    ],
  });
  assert.equal(k.ioWrite.maxDayBytes, 3.3e9);
  assert.equal(k.criteria.X4, 'Không đạt');
  assert.equal(k.criteria.X2, 'Không đạt');
  assert.equal(k.incidents.S1, 1);
});

test('CLI: --json in KPI; không --json in bảng X1..X11; sai đối số mã 2', () => {
  const dir = join(scenariosDir, '02-restart-mid-period');
  const base = ['--site', 'lab', '--from', '2026-11-02', '--to', '2026-11-02'];
  const io = ['--data', join(dir, 'data'), '--incidents', join(dir, 'incident-log.md')];
  const j = spawnSync(process.execPath, [cli, ...base, ...io, '--json'], { encoding: 'utf8' });
  assert.equal(j.status, 0, j.stderr);
  const k = JSON.parse(j.stdout);
  assert.equal(k.uptime.downtimeMin, 10);
  assert.equal(k.criteria.X1, 'Không đạt');

  const txt = spawnSync(process.execPath, [cli, ...base, ...io], { encoding: 'utf8' });
  assert.equal(txt.status, 0, txt.stderr);
  for (const x of ['X1', 'X4', 'X11', 'Không đạt', 'Chưa đo'])
    assert.match(txt.stdout, new RegExp(x));

  const bad = spawnSync(process.execPath, [cli, '--site', 'lab'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  const bad2 = spawnSync(process.execPath, [cli, ...base, '--bogus'], { encoding: 'utf8' });
  assert.equal(bad2.status, 2);
});

test('CLI: thư mục dữ liệu mặc định docs/pilot/data/<site> (không có thì vẫn chạy, Chưa đo)', () => {
  const data = join(tmp, 'data');
  mkdirSync(join(data, 'x'), { recursive: true });
  writeFileSync(
    join(data, 'x', '2026-11-02.jsonl'),
    '{"t":"2026-11-02T00:00:00Z","site":"x"\nkhông phải json\n',
  );
  const r = spawnSync(
    process.execPath,
    [cli, '--site', 'x', '--from', '2026-11-02', '--to', '2026-11-02', '--data', data, '--json'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  const k = JSON.parse(r.stdout);
  assert.equal(k.samples, 0);
  assert.equal(k.badLines, 2);
  assert.equal(k.criteria.X1, 'Chưa đo');
});
