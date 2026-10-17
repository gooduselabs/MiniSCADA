// KPI của pilot từ dữ liệu thu của tools/pilot/collect.ps1 (feature 011, T188; FR-138, FR-139; contract test-protocols
// §5, §6; data-model §6 "Pilot"). Quy tắc khoảng trống, đồng hồ nhảy, ước tính khởi động lại, loại trừ: tests/pilot-kpi/README.md.
//
//   node tools/pilot/kpi.mjs --site <tên> --from <yyyy-mm-dd> --to <yyyy-mm-dd>
//        [--data docs/pilot/data] [--incidents docs/pilot/incident-log.md] [--tz +07:00] [--json]
//
// --from và --to là ngày địa phương (cả hai ngày đều tính, kỳ đo = [from 00:00, to + 1 ngày 00:00)); cũng nhận thời điểm
// ISO đầy đủ (khi đó --to là mốc cuối, không tính). Múi giờ: --tz, nếu không có thì lấy từ trường "t" của mẫu đầu tiên.
// Mã thoát: 0 đã tính (kể cả có tiêu chí Không đạt), 2 dùng sai.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** Khoảng giữa hai mẫu dài hơn mức này là khoảng trống dữ liệu (contract §6). */
export const GAP_MS = 30 * MIN_MS;
/** Chênh lệch giữa giờ tường và uptimeS lớn hơn mức này là đồng hồ nhảy (mẫu 15 phút, uptimeS là số nguyên giây). */
export const CLOCK_JUMP_S = 60;
/** Sự kiện không có khung giờ trong cột "Tác động": lấy "Phát hiện" ± 60 phút. */
export const INCIDENT_WINDOW_MS = 60 * MIN_MS;

/** Ngưỡng của docs/pilot/criteria.md (X1, X3, X4, X11). 2 GB/ngày là 2 GiB như tools/soak/analyze.mjs (ADR-039). */
export const THRESHOLDS = {
  uptimeRatio: 0.999,
  liveLagP95Ms: 500,
  diskWriteBytesPerDay: 2 * 1024 ** 3,
  emmcStepsMax: 1,
  rssMb: 150,
  cpuWeeklyAvgPct: 30,
  s2OpenMax: 2,
};

export const PASS = 'Đạt';
export const FAIL = 'Không đạt';
export const NOT_MEASURED = 'Chưa đo';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, d) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const pad = (n) => String(n).padStart(2, '0');

// ---------- thời gian ----------

/** "+07:00" | "-03:30" | "Z" -> phút lệch UTC; null khi không đọc được. */
export function parseTz(s) {
  if (s === 'Z' || s === 'z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(String(s ?? ''));
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : null;
}

function tzSuffix(tzMin) {
  if (tzMin === 0) return 'Z';
  const a = Math.abs(tzMin);
  return `${tzMin < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** ms UTC -> ISO giờ địa phương kèm độ lệch, ví dụ 2026-11-02T12:10:00+07:00. */
export function fmtLocal(ms, tzMin) {
  const d = new Date(ms + tzMin * MIN_MS);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${tzSuffix(tzMin)}`;
}
const localDate = (ms, tzMin) => fmtLocal(ms, tzMin).slice(0, 10);

/** "2026-11-02 08:00" (giờ địa phương, như nhật ký sự cố) -> ms UTC. */
function parseLocal(s, tzMin) {
  const m = /(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00${tzSuffix(tzMin)}`);
  return Number.isNaN(ms) ? null : ms;
}

/** Kỳ đo [fromMs, toMs): ngày địa phương (to tính cả ngày) hoặc thời điểm ISO. */
export function periodOf(from, to, tzMin) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const fromMs = day.test(from)
    ? Date.parse(`${from}T00:00:00${tzSuffix(tzMin)}`)
    : Date.parse(from);
  const toMs = day.test(to)
    ? Date.parse(`${to}T00:00:00${tzSuffix(tzMin)}`) + DAY_MS
    : Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs))
    throw new UsageError('--from/--to: ngày yyyy-mm-dd hoặc ISO');
  if (toMs <= fromMs) throw new UsageError('--to phải sau --from');
  return { fromMs, toMs };
}

class UsageError extends Error {}

// ---------- đọc dữ liệu ----------

/** Đọc mọi <dir>/*.jsonl theo thứ tự tên tệp rồi thứ tự dòng; bỏ dòng trùng y hệt. */
export function loadSamplesWithStats(dir, site) {
  const samples = [];
  let badLines = 0;
  if (!existsSync(dir)) return { samples, badLines };
  const seen = new Set();
  for (const f of readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl'))
    .sort()) {
    for (const raw of readFileSync(join(dir, f), 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || seen.has(line)) continue;
      seen.add(line);
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        badLines++;
        continue;
      }
      if (!o || typeof o !== 'object' || Number.isNaN(Date.parse(o.t))) {
        badLines++;
        continue;
      }
      if (site && o.site && o.site !== site) continue;
      samples.push(o);
    }
  }
  return { samples, badLines };
}

/** Mẫu của một site: <dataDir>/<site>/*.jsonl. */
export const loadSamples = (dataDir, site) =>
  loadSamplesWithStats(join(dataDir, site), site).samples;

const HEADER = {
  id: ['mã', 'id'],
  detected: ['phát hiện'],
  level: ['mức'],
  kind: ['loại'],
  excl: ['loại trừ uptime'],
  impact: ['tác động'],
  cause: ['nguyên nhân'],
  status: ['trạng thái'],
  closed: ['đóng'],
};
const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/**
 * Bảng "Sự cố" của docs/pilot/incident-log.md (đọc theo tên cột, không theo vị trí). Nhận cả cột của data-model §6
 * ("ID", "Đóng", "Loại trừ uptime" = site-power | planned | không). Kết quả: { id, detectedAt, level (S1..S4 | "-"),
 * kind (product | site | planned | user | …), impact, cause, status, windowFrom, windowTo }.
 */
export function parseIncidentLog(text, tzMin = 0) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
    const head = cellsOf(lines[i]).map((h) => h.toLowerCase());
    const col = {};
    for (const [k, names] of Object.entries(HEADER))
      col[k] = head.findIndex((h) => names.includes(h));
    if (col.id < 0 || col.level < 0 || col.detected < 0) continue;
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j++) {
      const c = cellsOf(lines[j]);
      const get = (k) => (col[k] >= 0 ? (c[col[k]] ?? '') : '');
      const id = get('id');
      if (!/^INC-/i.test(id)) continue;
      const lv = get('level').toUpperCase();
      let kind;
      if (col.kind >= 0) kind = get('kind').toLowerCase() || 'product';
      else {
        const x = get('excl').toLowerCase();
        kind = x.startsWith('site') ? 'site' : x === 'planned' ? 'planned' : 'product';
      }
      if (kind === 'site-power') kind = 'site';
      const status = col.status >= 0 ? get('status').toLowerCase() : get('closed') ? 'đóng' : 'mở';
      const detectedAt = parseLocal(get('detected'), tzMin);
      const impact = get('impact');
      const stamps = [...impact.matchAll(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/g)].map((m) =>
        parseLocal(m[0], tzMin),
      );
      let windowFrom = null;
      let windowTo = null;
      if (stamps.length >= 2) [windowFrom, windowTo] = [Math.min(...stamps), Math.max(...stamps)];
      else if (detectedAt !== null)
        [windowFrom, windowTo] = [detectedAt - INCIDENT_WINDOW_MS, detectedAt + INCIDENT_WINDOW_MS];
      out.push({
        id,
        detectedAt,
        level: /^S[1-4]$/.test(lv) ? lv : '-',
        kind,
        impact,
        cause: get('cause'),
        status,
        windowFrom,
        windowTo,
      });
    }
  }
  return out;
}

// ---------- tính KPI ----------

const uptimeOf = (s) =>
  isNum(s.info?.uptimeS) ? s.info.uptimeS : isNum(s.diag?.uptimeS) ? s.diag.uptimeS : null;
const restartsOf = (s) => {
  const r = s.diag?.restarts;
  return isNum(r) ? r : isNum(r?.total) ? r.total : null;
};

/** p95 theo hạng gần nhất: phần tử thứ ceil(0,95 n) của dãy tăng dần. */
function stats(values) {
  if (!values.length) return { n: 0, avg: null, p95: null, max: null };
  const v = [...values].sort((a, b) => a - b);
  const sum = v.reduce((a, b) => a + b, 0);
  return {
    n: v.length,
    avg: round(sum / v.length, 1),
    p95: v[Math.ceil(0.95 * v.length) - 1],
    max: v[v.length - 1],
  };
}

const overlaps = (inc, a, b) => inc.windowFrom !== null && inc.windowFrom <= b && inc.windowTo >= a;

function inferTz(samples) {
  for (const s of samples) {
    const m = /(Z|[+-]\d{2}:\d{2})$/.exec(String(s.t));
    if (m) return parseTz(m[1]);
  }
  return 0;
}

/**
 * Hàm thuần: KPI của một site trong kỳ [from, to]. `samples`: các dòng JSON của collect.ps1 theo thứ tự thu;
 * `incidents`: kết quả parseIncidentLog (mọi site; lọc theo mã INC-<site>-) hoặc null khi không có nhật ký.
 */
export function computeKpi({ site, from, to, samples, incidents = null, tzOffsetMin }) {
  const tz = isNum(tzOffsetMin) ? tzOffsetMin : inferTz(samples);
  const { fromMs, toMs } = periodOf(from, to, tz);
  const rows = samples
    .map((s) => ({ s, t: Date.parse(s.t) }))
    .filter((r) => !Number.isNaN(r.t) && r.t >= fromMs && r.t < toMs);
  const fmt = (ms) => fmtLocal(ms, tz);
  const mine = incidents
    ? incidents.filter(
        (x) =>
          x.id.startsWith(`INC-${site}-`) &&
          (x.detectedAt === null || (x.detectedAt >= fromMs && x.detectedAt < toMs)),
      )
    : [];
  const excluder = (a, b) =>
    mine.find((x) => (x.kind === 'site' || x.kind === 'planned') && overlaps(x, a, b));
  const productConfirm = (a, b) => mine.find((x) => x.kind === 'product' && overlaps(x, a, b));

  // ---- uptime: khởi động lại, khoảng trống, đồng hồ nhảy ----
  let downtimeMs = 0;
  const excluded = [];
  const restarts = [];
  const gaps = [];
  const clockJumps = [];
  const addGap = (a, b, elapsedMs) => {
    const inc = productConfirm(a, b);
    gaps.push({
      from: fmt(a),
      to: fmt(b),
      minutes: round(elapsedMs / MIN_MS, 1),
      counted: !!inc,
      incident: inc?.id ?? null,
    });
    if (inc) downtimeMs += elapsedMs;
  };
  if (rows.length) {
    if (rows[0].t - fromMs > GAP_MS) addGap(fromMs, rows[0].t, rows[0].t - fromMs);
  }
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const [ua, ub] = [uptimeOf(a.s), uptimeOf(b.s)];
    const [ra, rb] = [restartsOf(a.s), restartsOf(b.s)];
    const [ba, bb] = [a.s.info?.bootId, b.s.info?.bootId];
    const counted = isNum(ra) && isNum(rb) && rb > ra;
    const bootChanged = !!(ba && bb && ba !== bb);
    const restarted = (isNum(ua) && isNum(ub) && ub < ua) || counted || bootChanged;
    if (restarted) {
      const start = isNum(ub) ? b.t - ub * 1000 : b.t;
      const down = Math.min(Math.max(start - a.t, 0), Math.max(b.t - a.t, 0));
      const end = a.t + down;
      const inc = excluder(a.t, end);
      const minutes = round(down / MIN_MS, 1);
      restarts.push({
        at: fmt(start),
        reason: counted ? (b.s.diag?.restarts?.lastReason ?? 'unknown') : 'unknown',
        bootChanged: bootChanged || (counted && b.s.diag?.restarts?.bootChanged === true),
        downtimeMin: minutes,
        excluded: inc?.kind ?? null,
        incident: inc?.id ?? null,
      });
      if (inc)
        excluded.push({ from: fmt(a.t), to: fmt(end), minutes, kind: inc.kind, incident: inc.id });
      else downtimeMs += down;
      continue;
    }
    let elapsed = b.t - a.t;
    if (isNum(ua) && isNum(ub)) {
      const shiftS = (b.t - a.t) / 1000 - (ub - ua);
      if (Math.abs(shiftS) > CLOCK_JUMP_S)
        clockJumps.push({ at: fmt(b.t), shiftS: Math.round(shiftS) });
      elapsed = (ub - ua) * 1000;
    }
    if (elapsed > GAP_MS) addGap(a.t, b.t, elapsed);
  }
  if (rows.length) {
    const last = rows[rows.length - 1].t;
    if (toMs - last > GAP_MS) addGap(last, toMs, toMs - last);
  }
  const uptime = {
    ratio: rows.length ? round(1 - downtimeMs / (toMs - fromMs), 6) : null,
    downtimeMin: rows.length ? round(downtimeMs / MIN_MS, 1) : null,
    excluded,
  };

  // ---- RSS, CPU, liveLag theo tuần ----
  const nWeeks = Math.ceil((toMs - fromMs) / WEEK_MS);
  const weekOf = (t) => Math.min(Math.floor((t - fromMs) / WEEK_MS), nWeeks - 1);
  const byWeek = (key) => {
    const w = Array.from({ length: nWeeks }, () => []);
    for (const r of rows) if (isNum(r.s.diag?.[key])) w[weekOf(r.t)].push(r.s.diag[key]);
    return w;
  };
  const weekly = (key) =>
    byWeek(key).map((v, k) => ({
      week: k + 1,
      from: localDate(fromMs + k * WEEK_MS, tz),
      ...stats(v),
    }));
  const rssWeekly = weekly('rssMb');
  const cpuWeekly = weekly('cpuPct');
  const maxOf = (arr) => {
    const v = arr.filter(isNum);
    return v.length ? Math.max(...v) : null;
  };
  const rss = { weekly: rssWeekly, max: maxOf(rssWeekly.map((w) => w.max)) };
  const cpu = { weekly: cpuWeekly, maxWeeklyAvg: maxOf(cpuWeekly.map((w) => w.avg)) };
  const liveLag = {
    weeklyMaxP95Ms: byWeek('liveLagP95Ms').map((v) => (v.length ? Math.max(...v) : null)),
  };

  // ---- ghi đĩa mỗi ngày: tổng các đoạn của bộ đếm (bộ đếm về 0 lúc 00:00 và khi tiến trình khởi động) ----
  const days = new Map();
  for (const r of rows) {
    let io = r.s.diag?.ioWriteBytesToday;
    if (isNum(io)) io = { total: io };
    if (!io || typeof io !== 'object' || !isNum(io.total)) continue;
    const d = localDate(r.t, tz);
    if (!days.has(d)) days.set(d, { done: [], cur: null });
    const day = days.get(d);
    if (day.cur && io.total < day.cur.total) {
      day.done.push(day.cur);
      day.cur = null;
    }
    if (!day.cur) day.cur = { total: 0, comp: {} };
    day.cur.total = Math.max(day.cur.total, io.total);
    for (const [k, v] of Object.entries(io))
      if (k !== 'total' && isNum(v)) day.cur.comp[k] = Math.max(day.cur.comp[k] ?? 0, v);
  }
  const perDay = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, { done, cur }]) => {
      const segs = cur ? [...done, cur] : done;
      const components = {};
      for (const s of segs)
        for (const [k, v] of Object.entries(s.comp)) components[k] = (components[k] ?? 0) + v;
      return { date, bytes: segs.reduce((a, s) => a + s.total, 0), components };
    });
  const ioWrite = {
    perDay,
    maxDayBytes: maxOf(perDay.map((d) => d.bytes)),
    limitBytes: THRESHOLDS.diskWriteBytesPerDay,
  };

  // ---- eMMC ----
  const life = rows.map((r) => r.s.diag?.emmcLife).filter((e) => e && typeof e === 'object');
  const pick = (e) => ({
    typeA: e.typeA ?? null,
    typeB: e.typeB ?? null,
    preEol: e.preEol ?? null,
  });
  let emmc;
  if (life.length) {
    const [s, e] = [pick(life[0]), pick(life[life.length - 1])];
    const steps = [e.typeA - s.typeA, e.typeB - s.typeB].filter(isNum);
    emmc = { start: s, end: e, stepsIncreased: steps.length ? Math.max(0, ...steps) : null };
  } else {
    const reasons = rows.map((r) => r.s.diag?.emmcLifeReason).filter(Boolean);
    emmc = {
      start: null,
      end: null,
      stepsIncreased: null,
      reason: reasons.length ? reasons[reasons.length - 1] : null,
    };
  }

  // ---- sự cố ----
  let incidentCounts = null;
  if (incidents) {
    incidentCounts = { S1: 0, S2: 0, S3: 0, S4: 0, events: 0 };
    for (const x of mine) {
      if (x.level === '-') incidentCounts.events++;
      else incidentCounts[x.level]++;
    }
  }

  // ---- tiêu chí X1..X11 ----
  const notes = {};
  const crit = {};
  crit.X1 = !rows.length ? NOT_MEASURED : uptime.ratio >= THRESHOLDS.uptimeRatio ? PASS : FAIL;
  if (!incidents) {
    crit.X2 = NOT_MEASURED;
    notes.X2 = 'không có nhật ký sự cố';
  } else {
    const sev = mine.filter((x) => x.level === 'S1' || x.level === 'S2');
    const closed = (x) => x.status === 'đóng' || x.status === 'đã vá';
    const s2Open = mine.filter((x) => x.level === 'S2' && !closed(x));
    const noCause = sev.filter((x) => !x.cause || /chưa rõ/i.test(x.cause));
    const why = [];
    if (incidentCounts.S1) why.push(`${incidentCounts.S1} sự cố S1`);
    if (s2Open.length > THRESHOLDS.s2OpenMax) why.push(`${s2Open.length} S2 chưa đóng (> 2)`);
    if (s2Open.some((x) => x.status === 'mở')) why.push('S2 mở chưa có cách tránh');
    if (noCause.length) why.push(`chưa rõ nguyên nhân: ${noCause.map((x) => x.id).join(', ')}`);
    crit.X2 = why.length ? FAIL : PASS;
    if (why.length) notes.X2 = why.join('; ');
  }
  const lagMax = maxOf(liveLag.weeklyMaxP95Ms);
  if (isNum(lagMax) && lagMax > THRESHOLDS.liveLagP95Ms) {
    crit.X3 = FAIL;
    notes.X3 = `liveLagP95Ms lớn nhất ${lagMax} ms > 500 ms`;
  } else {
    crit.X3 = NOT_MEASURED;
    notes.X3 = isNum(lagMax)
      ? `liveLagP95Ms ≤ 500 ms mọi tuần (lớn nhất ${lagMax} ms); còn đo đầu-cuối Chrome ≥ 3 lần (load-tester --latency)`
      : 'không có liveLagP95Ms; còn đo đầu-cuối Chrome';
  }
  const ioFail = perDay.some((d) => d.bytes > THRESHOLDS.diskWriteBytesPerDay);
  const emmcFail = isNum(emmc.stepsIncreased) && emmc.stepsIncreased > THRESHOLDS.emmcStepsMax;
  if (ioFail || emmcFail) {
    crit.X4 = FAIL;
    notes.X4 = [
      ioFail ? 'có ngày ghi > 2 GiB' : '',
      emmcFail ? `EXT_CSD tăng ${emmc.stepsIncreased} bậc` : '',
    ]
      .filter(Boolean)
      .join('; ');
  } else if (!perDay.length || emmc.stepsIncreased === null) {
    crit.X4 = NOT_MEASURED;
    notes.X4 = !perDay.length
      ? 'không có ioWriteBytesToday'
      : `không có emmcLife (${emmc.reason ?? 'không rõ lý do'})`;
  } else crit.X4 = PASS;
  for (const x of ['X5', 'X6', 'X7', 'X8', 'X9', 'X10']) crit[x] = NOT_MEASURED;
  notes.X5 = 'ước tính tuổi thọ: tools/soak/analyze.mjs (contract §3)';
  notes.X6 = 'mat-runtime --check-data sau mỗi lần mất điện';
  notes.X7 = 'rà soát bảo mật và đối chiếu audit';
  notes.X8 = 'biên bản acceptance-minutes.md';
  notes.X9 = 'phiếu đánh giá huấn luyện';
  notes.X10 = 'biên bản có chữ ký';
  const rssFail = isNum(rss.max) && rss.max > THRESHOLDS.rssMb;
  const cpuFail = isNum(cpu.maxWeeklyAvg) && cpu.maxWeeklyAvg > THRESHOLDS.cpuWeeklyAvgPct;
  if (rssFail || cpuFail) {
    crit.X11 = FAIL;
    notes.X11 = [
      rssFail ? `RSS lớn nhất ${rss.max} MB > 150 MB` : '',
      cpuFail ? `CPU tuần ${cpu.maxWeeklyAvg} % > 30 %` : '',
    ]
      .filter(Boolean)
      .join('; ');
  } else {
    crit.X11 = NOT_MEASURED;
    notes.X11 = isNum(rss.max)
      ? `RSS ≤ 150 MB, CPU tuần ≤ 30 %; tmpfs ≤ 64 MB không có trong dữ liệu thu (đo bằng mat-sample)`
      : 'không có rssMb, cpuPct';
  }

  const versions = [...new Set(rows.map((r) => r.s.info?.version).filter(Boolean))];
  return {
    site,
    from,
    to,
    tz: tzSuffix(tz),
    samples: rows.length,
    versions,
    uptime,
    restarts,
    gaps,
    clockJumps,
    rss,
    cpu,
    ioWrite,
    liveLag,
    emmc,
    incidents: incidentCounts,
    criteria: crit,
    criteriaNotes: notes,
  };
}

/** Đọc tệp rồi tính: data = thư mục chứa <site>/, incidents = đường dẫn incident-log.md (không có thì X2 Chưa đo). */
export function runKpi({ site, from, to, data, incidents, tz }) {
  const { samples, badLines } = loadSamplesWithStats(join(data, site), site);
  const tzOffsetMin = tz !== undefined && tz !== null ? parseTz(tz) : inferTz(samples);
  if (tzOffsetMin === null) throw new UsageError('--tz: dạng +07:00');
  const log =
    incidents && existsSync(incidents)
      ? parseIncidentLog(readFileSync(incidents, 'utf8'), tzOffsetMin)
      : null;
  return { ...computeKpi({ site, from, to, samples, incidents: log, tzOffsetMin }), badLines };
}

// ---------- CLI ----------

const USAGE =
  'Dùng: node tools/pilot/kpi.mjs --site <tên> --from <yyyy-mm-dd> --to <yyyy-mm-dd> [--data <thư mục>] [--incidents <tệp>] [--tz +07:00] [--json]';

function parseArgs(argv) {
  const o = {
    data: join(root, 'docs/pilot/data'),
    incidents: join(root, 'docs/pilot/incident-log.md'),
    json: false,
  };
  const valued = {
    '--site': 'site',
    '--from': 'from',
    '--to': 'to',
    '--data': 'data',
    '--incidents': 'incidents',
    '--tz': 'tz',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (valued[a]) {
      if (i + 1 >= argv.length) throw new UsageError(`${a}: thiếu giá trị`);
      o[valued[a]] = argv[++i];
    } else throw new UsageError(`đối số không biết: ${a}`);
  }
  if (o.help) return o;
  for (const k of ['site', 'from', 'to']) if (!o[k]) throw new UsageError(`thiếu --${k}`);
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(o.site)) throw new UsageError('--site: chữ, số, . _ -');
  return o;
}

const bytesText = (b) => (isNum(b) ? `${(b / 1024 ** 2).toFixed(1)} MiB` : '-');

export function renderText(k) {
  const L = [];
  L.push(`KPI pilot site ${k.site}, ${k.from} đến ${k.to} (${k.tz}), ${k.samples} mẫu`);
  if (k.badLines) L.push(`Dòng hỏng bỏ qua: ${k.badLines}`);
  if (k.versions.length) L.push(`Phiên bản: ${k.versions.join(', ')}`);
  const u = k.uptime;
  L.push(
    `Uptime: ${u.ratio === null ? '-' : (u.ratio * 100).toFixed(3) + ' %'}, ngừng ngoài kế hoạch ${u.downtimeMin ?? '-'} phút, loại trừ ${u.excluded.length}`,
  );
  for (const r of k.restarts)
    L.push(
      `  khởi động lại ${r.at}: ${r.reason}, ${r.downtimeMin} phút${r.excluded ? ` (loại trừ ${r.excluded}, ${r.incident})` : ''}`,
    );
  for (const g of k.gaps)
    L.push(
      `  khoảng trống ${g.from} đến ${g.to}: ${g.minutes} phút${g.counted ? ` (tính, ${g.incident})` : ' (không tính)'}`,
    );
  for (const c of k.clockJumps) L.push(`  đồng hồ nhảy ${c.at}: ${c.shiftS} s`);
  L.push(
    `RSS lớn nhất ${k.rss.max ?? '-'} MB; CPU trung bình tuần lớn nhất ${k.cpu.maxWeeklyAvg ?? '-'} %`,
  );
  L.push(
    `liveLagP95Ms lớn nhất theo tuần: ${k.liveLag.weeklyMaxP95Ms.map((v) => v ?? '-').join(', ')}`,
  );
  L.push(
    `Ghi đĩa ngày lớn nhất: ${bytesText(k.ioWrite.maxDayBytes)} (ngưỡng ${bytesText(k.ioWrite.limitBytes)})`,
  );
  L.push(
    `eMMC: ${k.emmc.start ? `${JSON.stringify(k.emmc.start)} -> ${JSON.stringify(k.emmc.end)}, tăng ${k.emmc.stepsIncreased} bậc` : `không có (${k.emmc.reason ?? '-'})`}`,
  );
  L.push(
    `Sự cố: ${
      k.incidents
        ? Object.entries(k.incidents)
            .map(([a, b]) => `${a} ${b}`)
            .join(', ')
        : 'không có nhật ký'
    }`,
  );
  L.push('', '| # | Trạng thái | Ghi chú |', '|---|---|---|');
  for (const [x, v] of Object.entries(k.criteria))
    L.push(`| ${x} | ${v} | ${k.criteriaNotes[x] ?? ''} |`);
  return L.join('\n') + '\n';
}

export function main(argv) {
  let o;
  try {
    o = parseArgs(argv);
    if (o.help) {
      process.stdout.write(USAGE + '\n');
      return 0;
    }
    const k = runKpi(o);
    process.stdout.write(o.json ? JSON.stringify(k, null, 2) + '\n' : renderText(k));
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`${e.message}\n${USAGE}\n`);
      return 2;
    }
    throw e;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  process.exitCode = main(process.argv.slice(2));
