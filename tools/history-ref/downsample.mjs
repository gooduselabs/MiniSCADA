// Bản tham chiếu độc lập của các phép giảm điểm (feature 010, T051): minmax, lttb, decimate, ghép bucket.
// Luật: specs/010-history-reports/contracts/history-api.md §3.2 và tests/downsample-vectors/README.md
// (các chỗ hợp đồng chưa chốt đã được chốt ở README đó). Không dùng mã sản phẩm.
import { avg, mergeAll } from './ref.mjs';

/** Chỉ số cửa sổ i của thời điểm t trong [from, to) chia `w` phần bằng nhau (số nguyên, không sai số float). */
const windowOf = (t, from, to, w) => Math.floor(((t - from) * w) / (to - from));

/**
 * minmax thô. `rows`: [[t, v|null], ...] tăng theo t, trong [from, to). Trả [[t, v|null], ...].
 * Số dòng ≤ maxPoints thì trả nguyên. Ngược lại: W = floor((maxPoints - 2) / 2) cửa sổ; mỗi cửa sổ giữ dòng nhỏ nhất
 * và lớn nhất (dòng đầu tiên nếu bằng nhau) và dòng NULL đầu tiên; thêm dòng đầu và cuối; nếu vượt maxPoints thì bỏ
 * điểm null từ cửa sổ cuối lùi về đầu.
 */
export function minmax(rows, from, to, maxPoints) {
  if (rows.length <= maxPoints) return rows.map((r) => [...r]);
  const w = Math.floor((maxPoints - 2) / 2);
  const keep = new Set([0, rows.length - 1]);
  const nullAt = []; // chỉ số dòng null đầu tiên của từng cửa sổ, theo thứ tự cửa sổ
  const byWin = new Map();
  rows.forEach((r, i) => {
    const k = windowOf(r[0], from, to, w);
    if (!byWin.has(k)) byWin.set(k, []);
    byWin.get(k).push(i);
  });
  for (const k of [...byWin.keys()].sort((a, b) => a - b)) {
    let lo = null;
    let hi = null;
    let firstNull = null;
    for (const i of byWin.get(k)) {
      const v = rows[i][1];
      if (v === null) {
        if (firstNull === null) firstNull = i;
        continue;
      }
      if (lo === null || v < rows[lo][1]) lo = i;
      if (hi === null || v > rows[hi][1]) hi = i;
    }
    if (lo !== null) keep.add(lo);
    if (hi !== null) keep.add(hi);
    if (firstNull !== null) nullAt.push(firstNull);
  }
  const nulls = new Set(nullAt);
  for (const i of nullAt) keep.add(i);
  let sel = [...keep].sort((a, b) => a - b);
  // bỏ null từ cửa sổ cuối lùi về đầu cho tới khi không vượt (trừ dòng đầu/cuối của khoảng)
  for (let j = nullAt.length - 1; j >= 0 && sel.length > maxPoints; j--) {
    const i = nullAt[j];
    if (i === 0 || i === rows.length - 1) continue;
    sel = sel.filter((x) => x !== i);
    nulls.delete(i);
  }
  return sel.map((i) => [...rows[i]]);
}

/** decimate: W = maxPoints cửa sổ; mỗi cửa sổ lấy dòng đầu tiên có t >= đầu cửa sổ nếu t < cuối cửa sổ. */
export function decimate(rows, from, to, maxPoints) {
  const out = [];
  let p = 0;
  const bound = (k) => from + Math.floor((k * (to - from)) / maxPoints);
  for (let k = 0; k < maxPoints; k++) {
    const s = bound(k);
    const e = bound(k + 1);
    while (p < rows.length && rows[p][0] < s) p++;
    if (p < rows.length && rows[p][0] < e) out.push([...rows[p]]);
  }
  return out;
}

/** LTTB (Steinarsson 2013) trên điểm đã lọc NULL: [[t, v], ...] -> [[t, v], ...], threshold = số điểm giữ. */
export function lttb(points, threshold) {
  const n = points.length;
  if (threshold >= n || threshold <= 2) return points.map((p) => [...p]);
  const out = [points[0]];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    let avgX = 0;
    let avgY = 0;
    let s = Math.floor((i + 1) * every) + 1;
    let e = Math.floor((i + 2) * every) + 1;
    e = Math.min(e, n);
    const len = e - s;
    for (; s < e; s++) {
      avgX += points[s][0];
      avgY += points[s][1];
    }
    avgX /= len;
    avgY /= len;
    let from = Math.floor(i * every) + 1;
    const to = Math.floor((i + 1) * every) + 1;
    const [ax, ay] = points[a];
    let best = -1;
    let bestIdx = from;
    for (; from < to; from++) {
      const area =
        Math.abs((ax - avgX) * (points[from][1] - ay) - (ax - points[from][0]) * (avgY - ay)) * 0.5;
      if (area > best) {
        best = area;
        bestIdx = from;
      }
    }
    out.push(points[bestIdx]);
    a = bestIdx;
  }
  out.push(points[n - 1]);
  return out.map((p) => [...p]);
}

/**
 * Ghép bucket thành tối đa `maxPoints` cửa sổ (nguồn tổng hợp). `buckets`: [{bucket, n, min, ...}] (hàng có dữ liệu,
 * tăng theo `bucket`), `res` độ dài bucket (ms). Số ô S = floor((to-1)/res) - floor(from/res) + 1; S <= maxPoints thì
 * mỗi hàng một điểm; ngược lại nhóm g = ceil(S / maxPoints) ô liền kề, điểm tại đầu nhóm.
 * Trả { t[], v[] (avg), min[], max[] }.
 */
export function mergeBuckets(buckets, from, to, res, maxPoints) {
  const s0 = Math.floor(from / res);
  const s1 = Math.floor((to - 1) / res);
  const slots = s1 - s0 + 1;
  const g = slots <= maxPoints ? 1 : Math.ceil(slots / maxPoints);
  const groups = new Map();
  for (const b of buckets) {
    const j = Math.floor((Math.floor(b.bucket / res) - s0) / g);
    if (!groups.has(j)) groups.set(j, []);
    groups
      .get(j)
      .push({
        n: b.n,
        min: b.min,
        max: b.max,
        first: b.first,
        last: b.last,
        sumw: b.sumw,
        wms: b.wms,
      });
  }
  const out = { t: [], v: [], min: [], max: [] };
  for (const j of [...groups.keys()].sort((a, b) => a - b)) {
    const m = mergeAll(groups.get(j));
    out.t.push((s0 + j * g) * res);
    out.v.push(avg(m));
    out.min.push(m.min);
    out.max.push(m.max);
  }
  return out;
}
