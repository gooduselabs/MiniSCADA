#!/usr/bin/env node
// Soak analyzer (feature 011, T070; FR-037, FR-039, FR-045, SC-013, SC-016; contract test-protocols.md §2 and §3).
//
// Input: JSON-lines files written by deployment/device/mat-sample.sh (files or directories, searched recursively for
// *.jsonl; identical lines from overlapping pulls are counted once). Output: a JSON report where every criterion is
// "pass", "fail" or "not-measured" (data missing is never "pass"), and optionally an SVG chart (RSS, disk write per
// day, FD over time).
//
// Usage:
//   node tools/soak/analyze.mjs <file|dir>... [--out report.json] [--svg chart.svg]
//        [--skip-hours 24] [--planned-restarts 0] [--check-data check.json]
//        [--extcsd-start start.txt] [--extcsd-end end.txt] [--tbw 24TB] [--waf 5]
// Exit code: 0 no criterion failed (the report may still be "incomplete"), 1 a criterion failed, 2 usage error.
//
// Decisions (documented for the report):
// - "Day" is a soak day counted from the first sample (day 1 = first 24 h), not a calendar day. An interval between
//   two samples belongs to the day of its midpoint.
// - Disk write per day sums blkSectorsWritten over every device of the object (mmcblk0 and its boot partitions),
//   x 512 bytes. A counter that goes down (reboot, or process restart for ioWrite) restarts from 0: the new value is
//   the write since the reset.
// - 2 GB per day is taken as 2 GiB (2^31 bytes), the budget of Constitution III / ADR-039; 64 MB as 64 MiB.
// - RSS slope: least squares of rssKb over time after dropping the first --skip-hours (24); needs >= 24 h after that.
// - FD and threads: every sample after day 2 within 5 % of the median of day 2.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const NO_DATASHEET_TEXT = 'chưa tính được tuổi thọ tuyệt đối: cần datasheet của eMMC';

const DAY_MS = 86_400_000;
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

export const THRESHOLDS = {
  rssSlopeMbPerDay: 0.5,
  rssMaxMb: 150,
  fdThreadsChange: 0.05,
  diskWriteBytesPerDay: 2 * GIB,
  walBytes: 64 * MIB,
  tmpfsUsedKb: 64 * 1024,
  dmesgErrors: 0,
  emmcStepsPerPeriod: 1,
  lifeYears: 5,
  waf: 5,
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------- input ----------

function listJsonl(path, out) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const e of readdirSync(path).sort()) {
      const p = join(path, e);
      const s = statSync(p);
      if (s.isDirectory() || e.endsWith('.jsonl')) listJsonl(p, out);
    }
  } else out.push(path);
}

/** Reads sample files and dirs; returns { samples (sorted by t), files, badLines }. */
export function loadSamples(paths) {
  const files = [];
  for (const p of paths) listJsonl(resolve(p), files);
  const seen = new Set();
  const samples = [];
  let badLines = 0;
  for (const f of files) {
    for (const raw of readFileSync(f, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      try {
        const s = JSON.parse(line);
        if (s && typeof s.t === 'string' && Number.isFinite(Date.parse(s.t))) samples.push(s);
        else badLines++;
      } catch {
        badLines++;
      }
    }
  }
  samples.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  return { samples, files, badLines };
}

// ---------- eMMC ----------

const RE_REV = /^\s*Extended CSD rev 1\.(\d+) \(MMC ([0-9.]+)\)$/m;
const RE_LIFE =
  /^eMMC Life Time Estimation ([AB]) \[EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_[AB]\]: 0x([0-9a-fA-F]{2})$/gm;
const RE_EOL = /^eMMC Pre EOL information \[EXT_CSD_PRE_EOL_INFO\]: 0x([0-9a-fA-F]{2})$/m;

/** Parses the output of `mmc extcsd read` (only the key lines, see fixtures/README.md). */
export function parseExtcsd(text) {
  const t = String(text).replace(/\r/g, '');
  const rev = RE_REV.exec(t);
  const out = {
    extCsdRev: rev ? Number(rev[1]) : null,
    mmcVersion: rev ? rev[2] : null,
    lifeA: null,
    lifeB: null,
    preEol: null,
  };
  for (const m of t.matchAll(RE_LIFE)) out[`life${m[1]}`] = parseInt(m[2], 16);
  const eol = RE_EOL.exec(t);
  if (eol) out.preEol = parseInt(eol[1], 16);
  return out;
}

const hex = (s) => (/^0x[0-9a-fA-F]+$/.test(s ?? '') ? parseInt(s, 16) : null);

/** Parses sysfs `life_time` ("0xAA 0xBB") and `pre_eol_info` ("0x01"). */
export function parseSysfsLifeTime(lifeTime, preEolInfo) {
  const [a, b] = String(lifeTime ?? '')
    .trim()
    .split(/\s+/);
  return { lifeA: hex(a), lifeB: hex(b), preEol: hex(String(preEolInfo ?? '').trim()) };
}

const level = (e) => {
  if (!e) return null;
  const v = [e.lifeA, e.lifeB].filter(isNum);
  return v.length ? Math.max(...v) : null;
};

/** Life estimate of contract §3: TBW method (needs the datasheet) and EXT_CSD step method; the pessimistic one. */
export function lifeEstimate({
  tbwBytes = null,
  waf = THRESHOLDS.waf,
  wDayMaxBytes = null,
  startLevel = null,
  endLevel = null,
  periodDays = null,
} = {}) {
  let tbw;
  if (!isNum(tbwBytes) || tbwBytes <= 0) {
    tbw = { status: 'not-measured', years: null, text: NO_DATASHEET_TEXT };
  } else if (!isNum(wDayMaxBytes) || wDayMaxBytes <= 0) {
    tbw = {
      status: 'not-measured',
      years: null,
      text: 'chưa tính được: không có số ghi mỗi ngày (blkSectorsWritten)',
    };
  } else {
    const years = tbwBytes / waf / (wDayMaxBytes * 365);
    tbw = {
      status: years >= THRESHOLDS.lifeYears ? 'pass' : 'fail',
      years,
      tbwBytes,
      waf,
      wDayMaxBytes,
      formula: 'years = (TBW / WAF) / (W_day_max x 365)',
    };
  }
  let extCsd;
  if (!isNum(startLevel) || !isNum(endLevel) || !isNum(periodDays) || periodDays <= 0) {
    extCsd = {
      status: 'not-measured',
      years: null,
      text: 'chưa tính được: cần EXT_CSD (life time) đầu và cuối kỳ',
    };
  } else {
    const steps = endLevel - startLevel;
    if (steps >= 1) {
      const years = ((10 - endLevel) * (periodDays / steps)) / 365;
      extCsd = {
        status: years >= THRESHOLDS.lifeYears ? 'pass' : 'fail',
        years,
        startLevel,
        endLevel,
        steps,
        periodDays,
        formula: 'years = (10 - level) x (days / steps) / 365',
      };
    } else {
      const lowerBoundYears = (periodDays * 10) / 365;
      extCsd = {
        status: 'not-measured',
        years: null,
        lowerBoundYears,
        startLevel,
        endLevel,
        steps,
        periodDays,
        text: `≥ ${lowerBoundYears.toFixed(2)} năm (cận dưới yếu: bậc EXT_CSD không tăng trong ${periodDays.toFixed(1)} ngày)`,
      };
    }
  }
  const ys = [tbw.years, extCsd.years].filter(isNum);
  return { tbw, extCsd, pessimisticYears: ys.length ? Math.min(...ys) : null };
}

// ---------- helpers ----------

function median(v) {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function slopePerDay(points) {
  const n = points.length;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

const nm = (detail, extra = {}) => ({ status: 'not-measured', value: null, detail, ...extra });

function sumBlk(v) {
  if (isNum(v)) return v;
  if (v && typeof v === 'object') {
    const vals = Object.values(v).filter(isNum);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  return null;
}

/** Bytes written per soak day from a cumulative counter (getter returns bytes or null). */
function dailyWrites(samples, t0, getter) {
  const days = new Map();
  let measured = false;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const va = getter(a);
    const vb = getter(b);
    if (!isNum(va) || !isNum(vb)) continue;
    measured = true;
    const ta = Date.parse(a.t);
    const tb = Date.parse(b.t);
    const reset = (a.boot ?? null) !== (b.boot ?? null) || vb < va;
    const delta = reset ? vb : vb - va;
    const idx = Math.floor(((ta + tb) / 2 - t0) / DAY_MS);
    const d = days.get(idx) ?? {
      day: idx + 1,
      start: new Date(t0 + idx * DAY_MS).toISOString(),
      bytes: 0,
      coverageH: 0,
    };
    d.bytes += delta;
    d.coverageH += (tb - ta) / 3_600_000;
    days.set(idx, d);
  }
  const list = [...days.values()].sort((x, y) => x.day - y.day);
  for (const d of list) d.coverageH = Math.round(d.coverageH * 100) / 100;
  return { measured, days: list };
}

function writeCriterion(samples, t0, getter, what) {
  const { measured, days } = dailyWrites(samples, t0, getter);
  if (!measured) return { ...nm(`không có ${what}`), days: [] };
  const max = Math.max(...days.map((d) => d.bytes));
  return {
    status: max <= THRESHOLDS.diskWriteBytesPerDay ? 'pass' : 'fail',
    value: max,
    unit: 'bytes/day (max)',
    threshold: THRESHOLDS.diskWriteBytesPerDay,
    days,
  };
}

function changeCriterion(samples, t0, key) {
  const day2 = samples.filter((s) => {
    const dt = Date.parse(s.t) - t0;
    return dt >= DAY_MS && dt < 2 * DAY_MS && isNum(s[key]);
  });
  const later = samples.filter((s) => Date.parse(s.t) - t0 >= 2 * DAY_MS && isNum(s[key]));
  if (!day2.length || !later.length) return nm(`cần ${key} của ngày 2 và sau ngày 2`);
  const med = median(day2.map((s) => s[key]));
  if (med === 0) return nm(`trung vị ${key} của ngày 2 bằng 0`);
  const dev = Math.max(...later.map((s) => Math.abs(s[key] - med) / med));
  return {
    status: dev <= THRESHOLDS.fdThreadsChange ? 'pass' : 'fail',
    value: dev,
    unit: 'max relative change',
    threshold: THRESHOLDS.fdThreadsChange,
    medianDay2: med,
    min: Math.min(...later.map((s) => s[key])),
    max: Math.max(...later.map((s) => s[key])),
  };
}

function maxCriterion(samples, getter, threshold, unit, what) {
  const v = samples.map(getter).filter(isNum);
  if (!v.length) return nm(`không có ${what}`);
  const max = Math.max(...v);
  return {
    status: max <= threshold ? 'pass' : 'fail',
    value: max,
    unit,
    threshold,
    last: v[v.length - 1],
  };
}

// ---------- analysis ----------

/**
 * @param {object[]} samples sorted samples
 * @param {object} opts skipHours, plannedRestarts, checkData {exitCode,result}, extcsdStart/extcsdEnd (text),
 *   tbwBytes, waf
 */
export function analyze(samples, opts = {}) {
  const skipMs = (opts.skipHours ?? 24) * 3_600_000;
  const planned = opts.plannedRestarts ?? 0;
  const s = [...samples].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const criteria = {};
  const t0 = s.length ? Date.parse(s[0].t) : 0;
  const tN = s.length ? Date.parse(s[s.length - 1].t) : 0;
  const periodDays = (tN - t0) / DAY_MS;

  // RSS slope and max
  const after = s.filter((x) => Date.parse(x.t) - t0 >= skipMs && isNum(x.rssKb));
  const afterSpan = after.length
    ? Date.parse(after[after.length - 1].t) - Date.parse(after[0].t)
    : 0;
  if (after.length < 3 || afterSpan < DAY_MS) {
    criteria.rssSlope = nm(`cần ≥ 24 giờ dữ liệu RSS sau ${skipMs / 3_600_000} giờ đầu`);
  } else {
    const slope = slopePerDay(after.map((x) => [(Date.parse(x.t) - t0) / DAY_MS, x.rssKb / 1024]));
    criteria.rssSlope = {
      status: slope <= THRESHOLDS.rssSlopeMbPerDay ? 'pass' : 'fail',
      value: slope,
      unit: 'MB/day',
      threshold: THRESHOLDS.rssSlopeMbPerDay,
      points: after.length,
      skippedHours: skipMs / 3_600_000,
    };
  }
  criteria.rssMax = maxCriterion(
    s,
    (x) => (isNum(x.rssKb) ? x.rssKb / 1024 : null),
    THRESHOLDS.rssMaxMb,
    'MB',
    'rssKb',
  );

  // unplanned restarts
  let bootChanges = 0;
  let serviceRestarts = 0;
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1];
    const b = s[i];
    if (a.boot && b.boot && a.boot !== b.boot) bootChanges++;
    else if (
      a.boot === b.boot &&
      isNum(a.restarts) &&
      isNum(b.restarts) &&
      b.restarts > a.restarts
    ) {
      serviceRestarts += b.restarts - a.restarts;
    }
  }
  const bootMeasured = s.some((x) => typeof x.boot === 'string' && x.boot);
  const restartsMeasured = s.some((x) => isNum(x.restarts));
  const unplanned = Math.max(0, bootChanges + serviceRestarts - planned);
  const rv = {
    bootChanges,
    serviceRestarts,
    plannedRestarts: planned,
    bootMeasured,
    restartsMeasured,
  };
  if (unplanned > 0) criteria.restarts = { status: 'fail', value: rv, threshold: 0 };
  else if (bootMeasured && restartsMeasured)
    criteria.restarts = { status: 'pass', value: rv, threshold: 0 };
  else {
    criteria.restarts = nm(
      `thiếu ${bootMeasured ? '' : 'boot '}${restartsMeasured ? '' : 'restarts (systemctl NRestarts)'}`.trim(),
      { partial: rv },
    );
  }

  criteria.fd = changeCriterion(s, t0, 'fd');
  criteria.threads = changeCriterion(s, t0, 'threads');

  criteria.diskWriteDaily = writeCriterion(
    s,
    t0,
    (x) => {
      const v = sumBlk(x.blkSectorsWritten);
      return isNum(v) ? v * 512 : null;
    },
    'blkSectorsWritten',
  );
  criteria.diskWriteProcess = writeCriterion(s, t0, (x) => x.ioWrite, 'ioWrite (/proc/<pid>/io)');

  const dm = s.map((x) => x.dmesgErr).filter(isNum);
  criteria.dmesg = dm.length
    ? {
        status: dm.reduce((a, b) => a + b, 0) === 0 ? 'pass' : 'fail',
        value: dm.reduce((a, b) => a + b, 0),
        unit: 'lines',
        threshold: 0,
      }
    : nm('dmesg không đọc được');

  criteria.wal = maxCriterion(
    s,
    (x) => x.dbSizes?.['history.db-wal'],
    THRESHOLDS.walBytes,
    'bytes',
    'history.db-wal',
  );
  criteria.tmpfs = maxCriterion(
    s,
    (x) => x.dfTmp?.usedKb,
    THRESHOLDS.tmpfsUsedKb,
    'KiB used',
    'dfTmp',
  );

  const cd = opts.checkData;
  criteria.checkData = cd
    ? {
        status: cd.exitCode === 0 ? 'pass' : 'fail',
        value: { exitCode: cd.exitCode ?? null, result: cd.result ?? null },
        threshold: 0,
      }
    : nm('cần --check-data cuối kỳ (mat-runtime --check-data --json)');

  // eMMC
  const fromSamples = s.map((x) => x.emmc).filter((e) => e && typeof e === 'object');
  const start = opts.extcsdStart ? parseExtcsd(opts.extcsdStart) : (fromSamples[0] ?? null);
  const end = opts.extcsdEnd
    ? parseExtcsd(opts.extcsdEnd)
    : (fromSamples[fromSamples.length - 1] ?? null);
  const last = end ?? start;
  const hasHealth = (e) => e && [e.lifeA, e.lifeB, e.preEol].some(isNum);
  if (!hasHealth(last)) {
    criteria.emmcHealth = nm(
      'không có DEVICE_LIFE_TIME_EST / PRE_EOL_INFO (không hỗ trợ hoặc không đọc được)',
    );
  } else {
    const lv = level(last);
    const bad = (isNum(lv) && lv >= 0x0a) || (isNum(last.preEol) && last.preEol >= 2);
    criteria.emmcHealth = {
      status: bad ? 'fail' : 'pass',
      value: { lifeA: last.lifeA, lifeB: last.lifeB, preEol: last.preEol },
      threshold: 'life < 0x0A, PRE_EOL_INFO = 0x01',
    };
  }
  const startLevel = level(start);
  const endLevel = level(end);
  const twoReadings = (opts.extcsdStart && opts.extcsdEnd) || fromSamples.length >= 2;
  if (!twoReadings || !isNum(startLevel) || !isNum(endLevel)) {
    criteria.emmcStep = nm('cần life time đầu và cuối kỳ');
  } else {
    const steps = endLevel - startLevel;
    criteria.emmcStep = {
      status: steps <= THRESHOLDS.emmcStepsPerPeriod ? 'pass' : 'fail',
      value: steps,
      unit: 'steps',
      threshold: THRESHOLDS.emmcStepsPerPeriod,
      startLevel,
      endLevel,
    };
  }
  const wDayMax =
    criteria.diskWriteDaily.status === 'not-measured' ? null : criteria.diskWriteDaily.value;
  const life = lifeEstimate({
    tbwBytes: opts.tbwBytes ?? null,
    waf: opts.waf ?? THRESHOLDS.waf,
    wDayMaxBytes: wDayMax,
    startLevel: twoReadings ? startLevel : null,
    endLevel: twoReadings ? endLevel : null,
    periodDays,
  });
  criteria.emmcLife = isNum(life.pessimisticYears)
    ? {
        status: life.pessimisticYears >= THRESHOLDS.lifeYears ? 'pass' : 'fail',
        value: life.pessimisticYears,
        unit: 'years',
        threshold: THRESHOLDS.lifeYears,
      }
    : nm(life.tbw.text ?? 'chưa tính được');

  const statuses = Object.values(criteria).map((c) => c.status);
  const notMeasured = Object.entries(criteria)
    .filter(([, c]) => c.status === 'not-measured')
    .map(([k]) => k);
  return {
    schema: 'mat-soak-report/1',
    generatedAt: new Date().toISOString(),
    input: {
      samples: s.length,
      firstT: s[0]?.t ?? null,
      lastT: s[s.length - 1]?.t ?? null,
      spanHours: Math.round(((tN - t0) / 3_600_000) * 100) / 100,
      boots: [...new Set(s.map((x) => x.boot).filter(Boolean))],
    },
    thresholds: THRESHOLDS,
    criteria,
    emmc: { start, end },
    life,
    overall: statuses.includes('fail')
      ? 'fail'
      : statuses.includes('not-measured')
        ? 'incomplete'
        : 'pass',
    notMeasured,
  };
}

// ---------- SVG ----------

const esc = (v) =>
  String(v).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

/** Three stacked single-series panels (one y-axis each): RSS (MB), disk write per day (GiB), FD. */
export function renderSvg(samples, report) {
  const W = 900;
  const PH = 200;
  const ML = 64;
  const MR = 24;
  const MT = 34;
  const GAP = 46;
  const plotW = W - ML - MR;
  const s = [...samples].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const t0 = s.length ? Date.parse(s[0].t) : 0;
  const tN = s.length ? Date.parse(s[s.length - 1].t) : 1;
  const spanDays = Math.max((tN - t0) / DAY_MS, 1 / 24);
  const parts = [];
  const panel = (i, title, unitLabel, yMax, body) => {
    const top = MT + i * (PH + GAP);
    const y = (v) => top + PH - (v / yMax) * PH;
    parts.push(`<g transform="translate(0,0)">`);
    parts.push(`<text class="title" x="${ML}" y="${top - 12}">${esc(title)}</text>`);
    for (let k = 0; k <= 4; k++) {
      const v = (yMax * k) / 4;
      parts.push(`<line class="grid" x1="${ML}" x2="${W - MR}" y1="${y(v)}" y2="${y(v)}"/>`);
      parts.push(
        `<text class="tick" x="${ML - 6}" y="${y(v) + 4}" text-anchor="end">${esc(+v.toFixed(2))}</text>`,
      );
    }
    for (let d = 0; d <= Math.ceil(spanDays); d++) {
      const x = ML + (d / spanDays) * plotW;
      if (x > W - MR + 0.5) break;
      parts.push(
        `<text class="tick" x="${x}" y="${top + PH + 14}" text-anchor="middle">${esc(`ngày ${d}`)}</text>`,
      );
    }
    parts.push(`<text class="tick" x="${ML}" y="${top - 1}" dx="-56">${esc(unitLabel)}</text>`);
    body(y, top);
    parts.push('</g>');
  };
  const xOf = (t) => ML + ((t - t0) / DAY_MS / spanDays) * plotW;
  const line = (getter, title) => (y) => {
    const pts = s
      .map((x) => [Date.parse(x.t), getter(x)])
      .filter(([, v]) => isNum(v))
      .map(([t, v]) => `${xOf(t).toFixed(1)},${y(v).toFixed(1)}`);
    if (pts.length) {
      parts.push(
        `<polyline class="series" points="${pts.join(' ')}"><title>${esc(title)}</title></polyline>`,
      );
    } else {
      parts.push(`<text class="tick" x="${ML + 8}" y="${y(0) - 8}">chưa đo</text>`);
    }
  };
  const rss = s.map((x) => (isNum(x.rssKb) ? x.rssKb / 1024 : null)).filter(isNum);
  panel(0, 'RSS mat-runtime (MB)', 'MB', niceMax(Math.max(150, ...rss)), (y) => {
    parts.push(
      `<line class="limit" x1="${ML}" x2="${W - MR}" y1="${y(150)}" y2="${y(150)}"><title>ngưỡng 150 MB</title></line>`,
    );
    line((x) => (isNum(x.rssKb) ? x.rssKb / 1024 : null), 'RSS (MB)')(y);
  });
  const days = report?.criteria?.diskWriteDaily?.days ?? [];
  const gib = days.map((d) => d.bytes / GIB);
  panel(1, 'Ghi đĩa mỗi ngày, tổng khối (GiB)', 'GiB', niceMax(Math.max(2, ...gib)), (y) => {
    const bw = Math.max(2, plotW / spanDays - 6);
    for (const d of days) {
      const x = ML + ((d.day - 1) / spanDays) * plotW + 3;
      const v = d.bytes / GIB;
      const yy = y(v);
      parts.push(
        `<rect class="bar" x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${Math.min(bw, W - MR - x).toFixed(1)}" height="${Math.max(0, y(0) - yy).toFixed(1)}" rx="2"><title>${esc(`ngày ${d.day}: ${v.toFixed(3)} GiB (${d.coverageH} h dữ liệu)`)}</title></rect>`,
      );
    }
    if (!days.length) parts.push(`<text class="tick" x="${ML + 8}" y="${y(0) - 8}">chưa đo</text>`);
    parts.push(
      `<line class="limit" x1="${ML}" x2="${W - MR}" y1="${y(2)}" y2="${y(2)}"><title>ngưỡng 2 GiB/ngày</title></line>`,
    );
  });
  const fds = s.map((x) => x.fd).filter(isNum);
  panel(
    2,
    'FD đang mở của mat-runtime',
    'FD',
    niceMax(Math.max(1, ...fds)),
    line((x) => x.fd, 'FD'),
  );
  const H = MT + 3 * (PH + GAP);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="soak: RSS, ghi đĩa mỗi ngày, FD">`,
    '<style>',
    ':root{--bg:#ffffff;--ink:#1f2328;--muted:#656d76;--grid:#e6e8eb;--series:#2563c9;--limit:#9a6700}',
    '@media (prefers-color-scheme: dark){:root{--bg:#161b22;--ink:#e6edf3;--muted:#9198a1;--grid:#30363d;--series:#6ea8fe;--limit:#d29922}}',
    'svg{background:var(--bg);font-family:system-ui,sans-serif}',
    '.title{fill:var(--ink);font-size:14px;font-weight:600}.tick{fill:var(--muted);font-size:11px}',
    '.grid{stroke:var(--grid);stroke-width:1}.limit{stroke:var(--limit);stroke-width:1.5;stroke-dasharray:6 4}',
    '.series{fill:none;stroke:var(--series);stroke-width:2;stroke-linejoin:round}.bar{fill:var(--series)}',
    '</style>',
    `<rect width="${W}" height="${H}" fill="var(--bg)"/>`,
    ...parts,
    '</svg>',
    '',
  ].join('\n');
}

// ---------- CLI ----------

/** "24TB", "8GB", "1.5e12" -> bytes (decimal units: TB = 1e12, as datasheets use). */
export function parseBytes(v) {
  const m = /^\s*([0-9.]+(?:e[0-9]+)?)\s*(|B|KB|MB|GB|TB|PB)\s*$/i.exec(String(v));
  if (!m) return null;
  const mul = { '': 1, B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, PB: 1e15 }[m[2].toUpperCase()];
  const n = Number(m[1]) * mul;
  return Number.isFinite(n) ? n : null;
}

export async function main(argv, { log = console.log, error = console.error } = {}) {
  const inputs = [];
  const o = {};
  const VALUE = new Set([
    '--out',
    '--svg',
    '--skip-hours',
    '--planned-restarts',
    '--check-data',
    '--extcsd-start',
    '--extcsd-end',
    '--tbw',
    '--waf',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      log(
        'node tools/soak/analyze.mjs <file|dir>... [--out r.json] [--svg r.svg] [--skip-hours 24]',
      );
      log(
        '  [--planned-restarts N] [--check-data c.json] [--extcsd-start a.txt] [--extcsd-end b.txt]',
      );
      log('  [--tbw 24TB] [--waf 5]');
      return 0;
    }
    if (VALUE.has(a)) {
      if (i + 1 >= argv.length) {
        error(`thiếu giá trị cho ${a}`);
        return 2;
      }
      o[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) {
      error(`tùy chọn không biết: ${a}`);
      return 2;
    } else inputs.push(a);
  }
  if (!inputs.length) {
    error('cần ít nhất một tệp hoặc thư mục .jsonl');
    return 2;
  }
  for (const p of inputs) {
    if (!existsSync(p)) {
      error(`không thấy ${p}`);
      return 2;
    }
  }
  const opts = {};
  if (o['skip-hours'] !== undefined) opts.skipHours = Number(o['skip-hours']);
  if (o['planned-restarts'] !== undefined) opts.plannedRestarts = Number(o['planned-restarts']);
  if (o['check-data']) opts.checkData = JSON.parse(readFileSync(o['check-data'], 'utf8'));
  if (o['extcsd-start']) opts.extcsdStart = readFileSync(o['extcsd-start'], 'utf8');
  if (o['extcsd-end']) opts.extcsdEnd = readFileSync(o['extcsd-end'], 'utf8');
  if (o.tbw !== undefined) {
    opts.tbwBytes = parseBytes(o.tbw);
    if (opts.tbwBytes === null) {
      error(`--tbw không hợp lệ: ${o.tbw}`);
      return 2;
    }
  }
  if (o.waf !== undefined) opts.waf = Number(o.waf);
  const { samples, files, badLines } = loadSamples(inputs);
  const report = analyze(samples, opts);
  report.input.files = files;
  report.input.badLines = badLines;
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (o.out) writeFileSync(o.out, text);
  else log(text);
  if (o.svg) writeFileSync(o.svg, renderSvg(samples, report));
  for (const [k, c] of Object.entries(report.criteria)) error(`${k}: ${c.status}`);
  error(`overall: ${report.overall}`);
  return report.overall === 'fail' ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
