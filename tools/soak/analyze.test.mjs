// Tests for the soak analyzer tools/soak/analyze.mjs (feature 011, T067; FR-037, FR-039, FR-045, SC-013, SC-016;
// contract test-protocols §2 and §3). Synthetic samples in the format of deployment/device/mat-sample.sh.
// Every criterion is "pass", "fail" or "not-measured"; missing data is never "pass".
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  analyze,
  lifeEstimate,
  loadSamples,
  main,
  parseExtcsd,
  parseSysfsLifeTime,
  renderSvg,
  NO_DATASHEET_TEXT,
} from './analyze.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const DAY = 86_400_000;
const T0 = Date.parse('2026-11-01T00:00:00Z');
const temps = [];
after(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/**
 * Synthetic soak: one sample every 10 min for `days` days. Options shape each series.
 * rssLeakMbPerDay: linear RSS growth; fdAt(tMs) / threads: values; boots: change of boot id at given ms offsets.
 */
function synth({
  days = 4,
  stepMin = 10,
  rssLeakMbPerDay = 0,
  fdAt = () => 40,
  threadsAt = () => 27,
  bootChangeAt = null,
  restartsAt = () => 0,
  sectorsPerDay = 1_000_000,
  ioWritePerDay = 50_000_000,
  io = true,
  wal = 4_000_000,
  dmesgAt = () => 0,
  emmc = { source: 'sysfs', lifeA: 1, lifeB: 1, preEol: 1 },
} = {}) {
  const out = [];
  const n = Math.round((days * 24 * 60) / stepMin);
  let sectors = 0;
  let lastT = 0;
  for (let i = 0; i <= n; i++) {
    const dt = i * stepMin * 60_000;
    const rebooted = bootChangeAt !== null && dt >= bootChangeAt;
    if (rebooted && lastT < bootChangeAt) sectors = 0; // counter resets at boot
    sectors += i === 0 ? 0 : (sectorsPerDay * (stepMin * 60_000)) / DAY;
    lastT = dt;
    out.push({
      t: new Date(T0 + dt).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      boot: rebooted ? 'boot-2' : 'boot-1',
      rssKb: Math.round(50_000 + (rssLeakMbPerDay * 1024 * dt) / DAY),
      hwmKb: 60_000,
      utime: i * 10,
      stime: i * 3,
      fd: fdAt(dt),
      threads: threadsAt(dt),
      ioRead: io ? 1000 : null,
      ioWrite: io ? Math.round((ioWritePerDay * dt) / DAY) : null,
      blkSectorsWritten: { mmcblk0: Math.round(sectors), mmcblk0boot0: 0 },
      dbSizes: {
        'history.db': 10_000_000,
        'history.db-wal': wal,
        'audit.db': 100_000,
        'alarm.db': 50_000,
        'pulse.journal': null,
        retain: 300,
      },
      dfData: { totalKb: 7_000_000, usedKb: 1_000_000, availKb: 6_000_000 },
      dfTmp: { totalKb: 250_000, usedKb: 9_000, availKb: 241_000 },
      memAvailKb: 300_000,
      tempMilliC: 48_000,
      emmc,
      restarts: restartsAt(dt),
      dmesgErr: dmesgAt(dt),
    });
  }
  return out;
}

test('flat RSS over 4 days: slope and max pass', () => {
  const r = analyze(synth());
  assert.equal(r.criteria.rssSlope.status, 'pass');
  assert.ok(Math.abs(r.criteria.rssSlope.value) < 0.01, String(r.criteria.rssSlope.value));
  assert.equal(r.criteria.rssMax.status, 'pass');
});

test('a 1 MB/day leak fails the 0.5 MB/day slope (first 24 h dropped)', () => {
  const r = analyze(synth({ rssLeakMbPerDay: 1 }));
  assert.equal(r.criteria.rssSlope.status, 'fail');
  assert.ok(Math.abs(r.criteria.rssSlope.value - 1) < 0.01, String(r.criteria.rssSlope.value));
  assert.equal(r.criteria.rssSlope.threshold, 0.5);
  assert.equal(r.overall, 'fail');
});

test('the first 24 h are not used for the slope: a warm-up ramp on day 1 does not fail', () => {
  const s = synth();
  for (const x of s) {
    const dt = Date.parse(x.t) - T0;
    if (dt < DAY) x.rssKb = 20_000 + Math.round((30_000 * dt) / DAY);
  }
  assert.equal(analyze(s).criteria.rssSlope.status, 'pass');
});

test('less than 24 h of data after the warm-up: slope is not-measured, never pass', () => {
  const r = analyze(synth({ days: 1.5 }));
  assert.equal(r.criteria.rssSlope.status, 'not-measured');
});

test('RSS above 150 MB fails rssMax', () => {
  const s = synth();
  s[100].rssKb = 160 * 1024;
  assert.equal(analyze(s).criteria.rssMax.status, 'fail');
});

test('a boot id change is an unplanned restart (power loss)', () => {
  const r = analyze(synth({ bootChangeAt: 2.5 * DAY }));
  assert.equal(r.criteria.restarts.status, 'fail');
  assert.equal(r.criteria.restarts.value.bootChanges, 1);
});

test('NRestarts increasing within one boot is an unplanned restart', () => {
  const r = analyze(synth({ restartsAt: (dt) => (dt > 3 * DAY ? 1 : 0) }));
  assert.equal(r.criteria.restarts.status, 'fail');
  assert.equal(r.criteria.restarts.value.serviceRestarts, 1);
});

test('no restart and no boot change passes; restarts unknown (null) is not-measured', () => {
  assert.equal(analyze(synth()).criteria.restarts.status, 'pass');
  const r = analyze(synth({ restartsAt: () => null }));
  assert.equal(r.criteria.restarts.status, 'not-measured');
});

test('FD +6 % against the day-2 median fails; +4 % passes; threads likewise', () => {
  const fd6 = analyze(synth({ fdAt: (dt) => (dt > 3 * DAY ? 53 : 50) }));
  assert.equal(fd6.criteria.fd.status, 'fail');
  const fd4 = analyze(synth({ fdAt: (dt) => (dt > 3 * DAY ? 52 : 50) }));
  assert.equal(fd4.criteria.fd.status, 'pass');
  const th = analyze(synth({ threadsAt: (dt) => (dt > 3 * DAY ? 40 : 27) }));
  assert.equal(th.criteria.threads.status, 'fail');
  assert.equal(th.criteria.fd.status, 'pass');
});

test('FD with no data after day 2 is not-measured', () => {
  assert.equal(analyze(synth({ days: 1.9 })).criteria.fd.status, 'not-measured');
});

test('disk write per day from blkSectorsWritten x 512 (all devices), per day and across a reboot', () => {
  const r = analyze(synth({ sectorsPerDay: 2_000_000 }));
  const c = r.criteria.diskWriteDaily;
  assert.equal(c.status, 'pass');
  assert.equal(c.days.length, 4);
  for (const d of c.days)
    assert.ok(Math.abs(d.bytes - 2_000_000 * 512) < 2 * 512 * 200, `${d.bytes}`);
  // 5 M sectors/day = 2.56 GB > 2 GiB
  assert.equal(analyze(synth({ sectorsPerDay: 5_000_000 })).criteria.diskWriteDaily.status, 'fail');
  // the counter reset at boot is not a negative write
  const rb = analyze(synth({ sectorsPerDay: 2_000_000, bootChangeAt: 1.5 * DAY })).criteria
    .diskWriteDaily;
  for (const d of rb.days) assert.ok(d.bytes > 0 && d.bytes < 2_100_000 * 512, `${d.bytes}`);
});

test('process write per day from ioWrite; null ioWrite (BL335) is not-measured', () => {
  const r = analyze(synth({ ioWritePerDay: 100_000_000 }));
  assert.equal(r.criteria.diskWriteProcess.status, 'pass');
  assert.ok(Math.abs(r.criteria.diskWriteProcess.days[1].bytes - 100_000_000) < 1000);
  assert.equal(analyze(synth({ io: false })).criteria.diskWriteProcess.status, 'not-measured');
});

test('no blkSectorsWritten at all (Docker x64) is not-measured', () => {
  const s = synth().map((x) => ({ ...x, blkSectorsWritten: null }));
  assert.equal(analyze(s).criteria.diskWriteDaily.status, 'not-measured');
});

test('dmesg errors: 0 passes, any fails, all null is not-measured', () => {
  assert.equal(analyze(synth()).criteria.dmesg.status, 'pass');
  assert.equal(
    analyze(synth({ dmesgAt: (dt) => (dt === DAY ? 1 : 0) })).criteria.dmesg.status,
    'fail',
  );
  assert.equal(analyze(synth({ dmesgAt: () => null })).criteria.dmesg.status, 'not-measured');
});

test('WAL above 64 MB fails', () => {
  assert.equal(analyze(synth()).criteria.wal.status, 'pass');
  assert.equal(analyze(synth({ wal: 70 * 1024 * 1024 })).criteria.wal.status, 'fail');
  assert.equal(analyze(synth({ wal: null })).criteria.wal.status, 'not-measured');
});

test('the end-of-period --check-data is not-measured unless given', () => {
  const r = analyze(synth());
  assert.equal(r.criteria.checkData.status, 'not-measured');
  assert.equal(r.overall, 'incomplete');
  const ok = analyze(synth(), { checkData: { exitCode: 0, result: 'ok' } });
  assert.equal(ok.criteria.checkData.status, 'pass');
});

test('extcsd fixtures are parsed', () => {
  const read = (f) => parseExtcsd(readFileSync(join(fixtures, f), 'utf8'));
  assert.deepEqual(read('extcsd-healthy.txt'), {
    extCsdRev: 8,
    mmcVersion: '5.1',
    lifeA: 1,
    lifeB: 1,
    preEol: 1,
  });
  assert.deepEqual(read('extcsd-worn.txt'), {
    extCsdRev: 8,
    mmcVersion: '5.1',
    lifeA: 9,
    lifeB: 10,
    preEol: 2,
  });
  assert.deepEqual(read('extcsd-eol.txt'), {
    extCsdRev: 8,
    mmcVersion: '5.1',
    lifeA: 11,
    lifeB: 11,
    preEol: 3,
  });
  assert.deepEqual(read('extcsd-emmc45-no-health.txt'), {
    extCsdRev: 6,
    mmcVersion: '4.5',
    lifeA: null,
    lifeB: null,
    preEol: null,
  });
});

test('sysfs life_time / pre_eol_info are parsed', () => {
  assert.deepEqual(parseSysfsLifeTime('0x02 0x03\n', '0x01\n'), { lifeA: 2, lifeB: 3, preEol: 1 });
  assert.deepEqual(parseSysfsLifeTime('', ''), { lifeA: null, lifeB: null, preEol: null });
});

test('eMMC health: healthy passes, worn and eol fail, eMMC 4.5 without health lines is not-measured', () => {
  const at = (f) => ({
    extcsdStart: readFileSync(join(fixtures, f), 'utf8'),
    extcsdEnd: readFileSync(join(fixtures, f), 'utf8'),
  });
  const s = synth({ emmc: null });
  assert.equal(analyze(s, at('extcsd-healthy.txt')).criteria.emmcHealth.status, 'pass');
  assert.equal(analyze(s, at('extcsd-worn.txt')).criteria.emmcHealth.status, 'fail');
  assert.equal(analyze(s, at('extcsd-eol.txt')).criteria.emmcHealth.status, 'fail');
  assert.equal(
    analyze(s, at('extcsd-emmc45-no-health.txt')).criteria.emmcHealth.status,
    'not-measured',
  );
  assert.equal(analyze(s).criteria.emmcHealth.status, 'not-measured');
  // from the samples (sysfs) when no file is given
  assert.equal(analyze(synth()).criteria.emmcHealth.status, 'pass');
});

test('life estimate: no TBW gives the exact Vietnamese text and not-measured', () => {
  const r = analyze(synth());
  assert.equal(NO_DATASHEET_TEXT, 'chưa tính được tuổi thọ tuyệt đối: cần datasheet của eMMC');
  assert.equal(r.life.tbw.status, 'not-measured');
  assert.equal(r.life.tbw.text, NO_DATASHEET_TEXT);
});

test('life estimate by TBW: (TBW / WAF) / (W_day_max x 365); contract example 24 TB, 2 GB/day = 6.6 years', () => {
  const e = lifeEstimate({ tbwBytes: 24e12, waf: 5, wDayMaxBytes: 2e9, periodDays: 7 });
  assert.ok(Math.abs(e.tbw.years - 6.575) < 0.01, String(e.tbw.years));
  assert.equal(e.tbw.status, 'pass');
  const bad = lifeEstimate({ tbwBytes: 24e12, waf: 5, wDayMaxBytes: 4e9, periodDays: 7 });
  assert.equal(bad.tbw.status, 'fail');
});

test('life estimate by EXT_CSD step: step up gives years, no step gives a weak lower bound (not-measured)', () => {
  // 30 days, 1 -> 2: (10 - 2) x 30 / 1 / 365 = 0.66 years
  const up = lifeEstimate({ startLevel: 1, endLevel: 2, periodDays: 30 });
  assert.ok(Math.abs(up.extCsd.years - (8 * 30) / 365) < 1e-9);
  assert.equal(up.extCsd.status, 'fail');
  const flat = lifeEstimate({ startLevel: 1, endLevel: 1, periodDays: 30 });
  assert.equal(flat.extCsd.status, 'not-measured');
  assert.ok(Math.abs(flat.extCsd.lowerBoundYears - 300 / 365) < 1e-9);
  assert.match(flat.extCsd.text, /cận dưới yếu/);
  // pessimistic of both
  const both = lifeEstimate({
    tbwBytes: 24e12,
    waf: 5,
    wDayMaxBytes: 1e9,
    startLevel: 1,
    endLevel: 2,
    periodDays: 30,
  });
  assert.equal(both.pessimisticYears, both.extCsd.years);
});

test('eMMC step over the period: more than one step fails', () => {
  const s = synth({ emmc: null });
  const r = analyze(s, {
    extcsdStart: readFileSync(join(fixtures, 'extcsd-healthy.txt'), 'utf8'),
    extcsdEnd: readFileSync(join(fixtures, 'extcsd-worn.txt'), 'utf8'),
  });
  assert.equal(r.criteria.emmcStep.status, 'fail');
});

test('SVG has the three panels (RSS, disk write per day, FD) and no script', () => {
  const s = synth();
  const svg = renderSvg(s, analyze(s));
  assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /RSS/);
  assert.match(svg, /FD/);
  assert.match(svg, /<polyline/);
  assert.match(svg, /<rect/);
  assert.doesNotMatch(svg, /<script/i);
});

test('loadSamples reads files and dirs, dedupes lines and sorts by time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'soak-an-'));
  temps.push(dir);
  const s = synth({ days: 0.1 });
  mkdirSync(join(dir, 'pull1'));
  writeFileSync(
    join(dir, 'pull1', 'samples-1.jsonl'),
    s
      .slice(5)
      .map((x) => JSON.stringify(x))
      .join('\n'),
  );
  writeFileSync(
    join(dir, 'samples-0.jsonl'),
    s
      .slice(0, 8)
      .map((x) => JSON.stringify(x))
      .join('\n') + '\nnot json\n',
  );
  const got = loadSamples([dir]);
  assert.equal(got.samples.length, s.length);
  assert.equal(got.badLines, 1);
  assert.deepEqual(
    got.samples.map((x) => x.t),
    s.map((x) => x.t),
  );
});

test('CLI writes the JSON report and the SVG; exit 1 when a criterion fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'soak-cli-'));
  temps.push(dir);
  writeFileSync(
    join(dir, 'in.jsonl'),
    synth({ rssLeakMbPerDay: 1 })
      .map((x) => JSON.stringify(x))
      .join('\n'),
  );
  const out = join(dir, 'r.json');
  const svg = join(dir, 'r.svg');
  const code = await main([join(dir, 'in.jsonl'), '--out', out, '--svg', svg], { log: () => {} });
  assert.equal(code, 1);
  const rep = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(rep.schema, 'mat-soak-report/1');
  assert.equal(rep.criteria.rssSlope.status, 'fail');
  assert.ok(rep.notMeasured.includes('checkData'));
  assert.match(readFileSync(svg, 'utf8'), /<svg/);
});
