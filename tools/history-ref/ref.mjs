// Bản tham chiếu ĐỘC LẬP của phép tính lịch sử (feature 010, T006).
// Không dùng mã của runtime (C++) hay của @mat/history-math: thuật toán chậm và đơn giản, tính từ dòng thô
// bằng cách dựng danh sách đoạn giữ [bắt đầu, kết thúc) rồi giao từng đoạn với từng cửa sổ.
// Luật: specs/010-history-reports/contracts/history-db.md §3 (tín hiệu giữ), §6 (ghép, đại lượng suy ra),
// contracts/templates-config.md §4 (báo cáo). Dùng để sinh `tests/agg-vectors`, `tests/report-vectors`
// và để so khớp "100 % ô" (SC-003, SC-015).

export const MIN_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------------------------
// Bucket: { n, min, max, first, last, sumw, wms }. null = bucket rỗng (phần tử đơn vị của merge).

/** Ghép A (trước) với B (sau); null là phần tử đơn vị (history-db.md §6). */
export function mergeBuckets(a, b) {
  if (a === null || a === undefined) return b ?? null;
  if (b === null || b === undefined) return a;
  return {
    n: a.n + b.n,
    min: Math.min(a.min, b.min),
    max: Math.max(a.max, b.max),
    first: a.first,
    last: b.last,
    sumw: a.sumw + b.sumw,
    wms: a.wms + b.wms,
  };
}

/** Ghép dãy bucket theo thứ tự (null bị bỏ qua). */
export function mergeAll(list) {
  let acc = null;
  for (const b of list) acc = mergeBuckets(acc, b);
  return acc;
}

/** Điều `INSERT ... ON CONFLICT DO UPDATE` của history-db.md §3 làm với hàng đã có: `first` giữ nguyên. */
function upsert(old, add) {
  if (!old) return { ...add };
  return {
    n: old.n + add.n,
    min: Math.min(old.min, add.min),
    max: Math.max(old.max, add.max),
    first: old.first,
    last: add.last,
    sumw: old.sumw + add.sumw,
    wms: old.wms + add.wms,
  };
}

export const avg = (b) => (b === null ? null : b.wms > 0 ? b.sumw / b.wms : b.last);
export const sum = (b) => (b === null ? null : b.sumw / HOUR_MS);
export const delta = (b) => (b === null ? null : b.last - b.first);
export const coverage = (b, windowMs) => (b === null ? 0 : b.wms / windowMs);

/** Giá trị hàm `fn` của bucket (báo cáo, bar, pie). */
export function evalFn(fn, b) {
  if (b === null) return null;
  switch (fn) {
    case 'min':
      return b.min;
    case 'max':
      return b.max;
    case 'avg':
      return avg(b);
    case 'sum':
      return sum(b);
    case 'first':
      return b.first;
    case 'last':
      return b.last;
    case 'delta':
      return delta(b);
    case 'count':
      return b.n;
    default:
      throw new Error(`hàm lạ: ${fn}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Từ dòng thô tới bucket.

/**
 * Một "đoạn" của một lần chạy (epoch): các điểm (t, v) theo thứ tự và thời điểm kết thúc `end`.
 * Mỗi điểm khác null mở một đoạn giữ [t, tOfNextPoint | end) với giá trị v; điểm null kết thúc tín hiệu.
 */
function segmentsOf(points, end) {
  const segs = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].v === null) continue;
    const s = points[i].t;
    const e = i + 1 < points.length ? points[i + 1].t : end;
    segs.push({ s, e: Math.max(e, s), v: points[i].v });
  }
  return segs;
}

/** Chỉ số nhỏ nhất trong [0, n) thỏa `pred` (đơn điệu: false... true...), n nếu không có. */
function lowerBound(n, pred) {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Phần bucket của cửa sổ [b, b + res) trong một lần chạy; null nếu rỗng (không có dòng và không có tín hiệu). */
function pieceOf(points, segs, b, res) {
  const w1 = b + res;
  let n = 0;
  let min = Infinity;
  let max = -Infinity;
  let sumw = 0;
  let wms = 0;
  let first = null; // [thời điểm, giá trị]
  let last = null;
  const consider = (t, v, endTime) => {
    if (first === null || t < first[0]) first = [t, v];
    if (last === null || endTime >= last[0]) last = [endTime, v];
  };
  for (let i = lowerBound(points.length, (k) => points[k].t >= b); i < points.length; i++) {
    const p = points[i];
    if (p.t >= w1) break;
    if (p.v !== null) {
      n += 1;
      min = Math.min(min, p.v);
      max = Math.max(max, p.v);
    }
  }
  const j0 = lowerBound(segs.length, (k) => segs[k].e >= b); // đoạn kết thúc trước b không giao cửa sổ
  for (let j = j0; j < segs.length; j++) {
    const g = segs[j];
    if (g.s >= w1) break;
    const lo = Math.max(g.s, b);
    const hi = Math.min(g.e, w1);
    if (hi > lo) {
      const len = hi - lo;
      wms += len;
      sumw += g.v * len;
      min = Math.min(min, g.v);
      max = Math.max(max, g.v);
      consider(lo, g.v, hi);
    } else if (g.s === g.e && g.s >= b && g.s < w1) {
      consider(g.s, g.v, g.s); // đoạn dài 0 ms: tín hiệu có giá trị đúng một thời điểm
    }
  }
  if (n === 0 && wms === 0) return null;
  // Tín hiệu mang vào đầu cửa sổ (còn giữ ngay trước thời điểm b, kể cả khi dòng tới đúng b): first = giá trị mang.
  const carry = j0 < segs.length && segs[j0].s < b ? segs[j0] : undefined;
  return { n, min, max, first: carry ? carry.v : first[1], last: last[1], sumw, wms };
}

/**
 * Dựng nội dung `mat_agg` (bucket phút và giờ) cho một cột từ dãy sự kiện (định dạng tests/agg-vectors).
 * Chỉ cửa sổ ĐÃ ĐÓNG mới có hàng: cửa sổ phút đóng khi thời gian vượt cuối cửa sổ hoặc khi `break`/`jump`.
 * Trả về { 60000: [bucket có thêm `bucket`], 3600000: [...] } sắp theo `bucket`.
 */
export function aggregateStore(events, col) {
  const epochs = []; // { points, end, broken }
  let cur = { points: [], end: null, broken: false };
  let tMax = -Infinity;
  const note = (t) => {
    cur.end = cur.end === null ? t : Math.max(cur.end, t);
    tMax = Math.max(tMax, t);
  };
  for (const e of events) {
    if (e.op === 'row') {
      note(e.t);
      if (e.values && Object.hasOwn(e.values, col)) cur.points.push({ t: e.t, v: e.values[col] });
    } else if (e.op === 'advance') {
      note(e.t);
    } else if (e.op === 'break' || e.op === 'jump') {
      note(e.t);
      cur.broken = true;
      epochs.push(cur);
      cur = { points: [], end: null, broken: false };
    } else {
      throw new Error(`op lạ: ${e.op}`);
    }
  }
  epochs.push(cur);

  const minuteRows = new Map(); // bucket -> bucket
  for (const ep of epochs) {
    if (ep.points.length === 0 || ep.end === null) continue;
    const segs = segmentsOf(ep.points, ep.end);
    const w0 = Math.floor(ep.points[0].t / MIN_MS) * MIN_MS;
    const wN = Math.floor(ep.end / MIN_MS) * MIN_MS;
    for (let b = w0; b <= wN; b += MIN_MS) {
      const closed = ep.broken || b + MIN_MS <= ep.end;
      if (!closed) continue;
      const p = pieceOf(ep.points, segs, b, MIN_MS);
      if (p === null) continue;
      minuteRows.set(b, upsert(minuteRows.get(b), p));
    }
  }
  const out = { [MIN_MS]: [], [HOUR_MS]: [] };
  for (const b of [...minuteRows.keys()].sort((x, y) => x - y)) {
    out[MIN_MS].push({ bucket: b, ...minuteRows.get(b) });
  }
  // Giờ: ghép các hàng phút của giờ khi giờ đóng (thời gian cuối ≥ cuối giờ).
  const hours = new Set([...minuteRows.keys()].map((b) => Math.floor(b / HOUR_MS) * HOUR_MS));
  for (const h of [...hours].sort((x, y) => x - y)) {
    if (h + HOUR_MS > tMax) continue;
    const rows = [...minuteRows.keys()]
      .filter((b) => b >= h && b < h + HOUR_MS)
      .sort((x, y) => x - y)
      .map((b) => minuteRows.get(b));
    out[HOUR_MS].push({ bucket: h, ...mergeAll(rows) });
  }
  return out;
}

/**
 * Bucket của các cửa sổ `[start + k × bucketMs)` ghép từ hàng phút (như API `aggregate`):
 * trả mảng độ dài `count`, phần tử null khi cửa sổ không có dữ liệu.
 */
export function windowsFromMinutes(minuteRows, start, bucketMs, count) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const a = start + k * bucketMs;
    const rows = minuteRows
      .filter((r) => r.bucket >= a && r.bucket < a + bucketMs)
      .sort((x, y) => x.bucket - y.bucket);
    out.push(mergeAll(rows));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Báo cáo (contracts/templates-config.md §4).

/** `+07:00` -> mili giây; ném lỗi nếu sai khuôn. */
export function tzOffsetMs(tz) {
  const m = /^([+-])(\d\d):(\d\d)$/.exec(tz);
  if (!m) throw new Error(`tz sai: ${tz}`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * HOUR_MS + Number(m[3]) * MIN_MS);
}

/** Ngày dân sự (y, m, d) -> số ngày kể từ 1970-01-01 (thuật toán của Howard Hinnant). */
function daysFromCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Số ngày kể từ 1970-01-01 -> [y, m, d]. */
function civilFromDays(z0) {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [m <= 2 ? y + 1 : y, m, d];
}

/** Nửa đêm địa phương của ngày (y, m, d) theo độ lệch `tz` ms, tính bằng UTC ms. */
export function localMidnight(y, m, d, tz) {
  return daysFromCivil(y, m, d) * DAY_MS - tz;
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Thời điểm UTC ms -> { y, m, d, hh, mm } theo giờ địa phương `tz` ms. */
export function localParts(ts, tz) {
  const t = ts + tz;
  const days = Math.floor(t / DAY_MS);
  const rem = t - days * DAY_MS;
  const [y, m, d] = civilFromDays(days);
  return { y, m, d, hh: Math.floor(rem / HOUR_MS), mm: Math.floor((rem % HOUR_MS) / MIN_MS) };
}

export const hhmm = (ts, tz) => {
  const p = localParts(ts, tz);
  return `${pad(p.hh)}:${pad(p.mm)}`;
};
export const ddmm = (ts, tz) => {
  const p = localParts(ts, tz);
  return `${pad(p.d)}/${pad(p.m)}`;
};

/** Số dạng vi-VN: nghìn `.`, thập phân `,`, làm tròn nửa ra xa số 0 theo `decimals`. */
export function formatVi(v, decimals) {
  if (v === null) return '';
  const neg = v < 0;
  const scaled = Math.round(Math.abs(v) * 10 ** decimals + 1e-9);
  const digits = String(scaled).padStart(decimals + 1, '0');
  const intPart = digits.slice(0, digits.length - decimals);
  const frac = decimals > 0 ? ',' + digits.slice(digits.length - decimals) : '';
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg && scaled !== 0 ? '-' : '') + grouped + frac;
}

/**
 * Kỳ báo cáo: { from, to, bucketMs, offsetMs, rows: [{ start, end, label }], periodLabel }.
 * `sel`: { d: 'YYYY-MM-DD' } (day, shift) hoặc { m: 'YYYY-MM' } (month).
 */
export function reportPeriod(tpl, sel, tz, shiftWord = 'Ca') {
  let from;
  let to;
  let bucketMs;
  let periodLabel;
  const rows = [];
  if (tpl.period === 'month') {
    const [y, m] = sel.m.split('-').map(Number);
    from = localMidnight(y, m, 1, tz);
    to = m === 12 ? localMidnight(y + 1, 1, 1, tz) : localMidnight(y, m + 1, 1, tz);
    bucketMs = DAY_MS;
    periodLabel = `${pad(m)}/${y}`;
    for (let s = from; s < to; s += DAY_MS)
      rows.push({ start: s, end: s + DAY_MS, label: ddmm(s, tz) });
  } else {
    const [y, m, d] = sel.d.split('-').map(Number);
    periodLabel = `${pad(d)}/${pad(m)}/${y}`;
    if (tpl.period === 'day') {
      from = localMidnight(y, m, d, tz);
      to = from + DAY_MS;
      bucketMs = (tpl.rowMinutes ?? 60) * MIN_MS;
      for (let s = from; s < to; s += bucketMs)
        rows.push({
          start: s,
          end: s + bucketMs,
          label: `${ddmm(s, tz)} ${hhmm(s, tz)}–${hhmm(s + bucketMs, tz)}`,
        });
    } else {
      const [sh, sm] = tpl.shifts.start.split(':').map(Number);
      from = localMidnight(y, m, d, tz) + sh * HOUR_MS + sm * MIN_MS;
      to = from + DAY_MS;
      bucketMs = DAY_MS / tpl.shifts.count;
      for (let i = 0; i < tpl.shifts.count; i++) {
        const s = from + i * bucketMs;
        rows.push({
          start: s,
          end: s + bucketMs,
          label: `${shiftWord} ${i + 1} ${hhmm(s, tz)}–${hhmm(s + bucketMs, tz)}`,
        });
      }
    }
  }
  const offsetMs = ((from % bucketMs) + bucketMs) % bucketMs;
  return { from, to, bucketMs, offsetMs, rows, periodLabel };
}

/**
 * Bảng báo cáo từ bucket cửa sổ. `buckets[tagId]` = mảng bucket (null = rỗng) theo hàng của kỳ.
 * Cột: một cho mỗi (cột mẫu, hàm), theo thứ tự khai báo. Hàng có start ≥ now: "chưa tới" (ô null, không đóng góp).
 */
export function reportTable(tpl, period, buckets, now, tagInfo = {}) {
  const columns = [];
  for (const c of tpl.columns)
    for (const fn of c.functions) {
      const info = tagInfo[c.tagId] ?? {};
      columns.push({
        key: `${c.tagId}.${fn}`,
        tagId: c.tagId,
        fn,
        label: c.label ?? info.description ?? c.tagId,
        unit: c.unit ?? info.unit ?? '',
        decimals: c.decimals ?? 2,
      });
    }
  const tagIds = [...new Set(tpl.columns.map((c) => c.tagId))];
  const rows = [];
  let wmsSum = 0;
  let arrived = 0;
  const merged = Object.fromEntries(tagIds.map((t) => [t, null]));
  period.rows.forEach((r, i) => {
    const pending = r.start >= now;
    const cells = columns.map((col) =>
      pending ? null : evalFn(col.fn, buckets[col.tagId][i] ?? null),
    );
    let w = 0;
    if (!pending) {
      arrived += 1;
      for (const t of tagIds) {
        const b = buckets[t][i] ?? null;
        w += b === null ? 0 : b.wms;
        merged[t] = mergeBuckets(merged[t], b);
      }
      wmsSum += w;
    }
    rows.push({
      label: r.label,
      cells,
      coverage: pending ? 0 : w / (tagIds.length * period.bucketMs),
      pending,
    });
  });
  const totals =
    tpl.totals === false
      ? null
      : columns.map((col) => (arrived === 0 ? null : evalFn(col.fn, merged[col.tagId])));
  const cov = arrived === 0 ? 0 : wmsSum / (tagIds.length * arrived * period.bucketMs);
  return { columns, rows, totals, coverage: cov, periodLabel: period.periodLabel };
}
