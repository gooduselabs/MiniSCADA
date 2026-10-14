// Giảm điểm cho biểu đồ lịch sử (specs/010-history-reports/contracts/history-api.md §3.2; chi tiết chốt ở
// tests/downsample-vectors/README.md). Bản C++: core/historian/query/downsample.*.
import { avg, mergeAll, type AggBucket } from './agg.ts';

/** Dòng thô của một đường: [t (UTC ms), giá trị | null]. */
export type RawRow = [number, number | null];

const windowOf = (t: number, from: number, to: number, w: number) =>
  Math.floor(((t - from) * w) / (to - from));

/**
 * minmax: số dòng <= maxPoints thì trả nguyên; ngược lại W = floor((maxPoints - 2) / 2) cửa sổ, mỗi cửa sổ giữ dòng
 * nhỏ nhất, lớn nhất (đầu tiên nếu bằng nhau) và dòng NULL đầu tiên; thêm dòng đầu, cuối; vượt thì bỏ null từ cuối lùi.
 */
export function reduceMinMax(
  rows: RawRow[],
  from: number,
  to: number,
  maxPoints: number,
): RawRow[] {
  if (rows.length <= maxPoints) return rows.map((r) => [r[0], r[1]]);
  const w = Math.floor((maxPoints - 2) / 2);
  const keep = new Set<number>([0, rows.length - 1]);
  const byWin = new Map<number, number[]>();
  rows.forEach((r, i) => {
    const k = windowOf(r[0], from, to, w);
    const list = byWin.get(k);
    if (list) list.push(i);
    else byWin.set(k, [i]);
  });
  const nulls: number[] = [];
  for (const k of [...byWin.keys()].sort((a, b) => a - b)) {
    let lo = -1;
    let hi = -1;
    let firstNull = -1;
    for (const i of byWin.get(k)!) {
      const v = rows[i]![1];
      if (v === null) {
        if (firstNull < 0) firstNull = i;
        continue;
      }
      if (lo < 0 || v < rows[lo]![1]!) lo = i;
      if (hi < 0 || v > rows[hi]![1]!) hi = i;
    }
    if (lo >= 0) keep.add(lo);
    if (hi >= 0) keep.add(hi);
    if (firstNull >= 0) {
      keep.add(firstNull);
      nulls.push(firstNull);
    }
  }
  for (let j = nulls.length - 1; j >= 0 && keep.size > maxPoints; j--) {
    const i = nulls[j]!;
    if (i !== 0 && i !== rows.length - 1) keep.delete(i);
  }
  return [...keep].sort((a, b) => a - b).map((i) => [rows[i]![0], rows[i]![1]]);
}

/** decimate: maxPoints cửa sổ; mỗi cửa sổ lấy dòng đầu tiên có t >= đầu cửa sổ nếu t < cuối cửa sổ. */
export function decimate(rows: RawRow[], from: number, to: number, maxPoints: number): RawRow[] {
  const out: RawRow[] = [];
  const bound = (k: number) => from + Math.floor((k * (to - from)) / maxPoints);
  let p = 0;
  for (let k = 0; k < maxPoints; k++) {
    const s = bound(k);
    const e = bound(k + 1);
    while (p < rows.length && rows[p]![0] < s) p++;
    if (p < rows.length && rows[p]![0] < e) out.push([rows[p]![0], rows[p]![1]]);
  }
  return out;
}

/** LTTB (Steinarsson 2013) trên các điểm không NULL; `threshold >= n` trả nguyên. */
export function reduceLttb(
  points: Array<[number, number]>,
  threshold: number,
): Array<[number, number]> {
  const n = points.length;
  if (threshold >= n || threshold <= 2) return points.map((p) => [p[0], p[1]]);
  const out: Array<[number, number]> = [points[0]!];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    let s = Math.floor((i + 1) * every) + 1;
    const e = Math.min(Math.floor((i + 2) * every) + 1, n);
    const len = e - s;
    let avgX = 0;
    let avgY = 0;
    for (; s < e; s++) {
      avgX += points[s]![0];
      avgY += points[s]![1];
    }
    avgX /= len;
    avgY /= len;
    const [ax, ay] = points[a]!;
    let best = -1;
    let bestIdx = Math.floor(i * every) + 1;
    for (let j = Math.floor(i * every) + 1; j < Math.floor((i + 1) * every) + 1; j++) {
      const area =
        Math.abs((ax - avgX) * (points[j]![1] - ay) - (ax - points[j]![0]) * (avgY - ay)) * 0.5;
      if (area > best) {
        best = area;
        bestIdx = j;
      }
    }
    out.push(points[bestIdx]!);
    a = bestIdx;
  }
  out.push(points[n - 1]!);
  return out.map((p) => [p[0], p[1]]);
}

/** Điểm của nguồn tổng hợp sau khi ghép: t, avg, min, max. */
export interface MergedPoints {
  t: number[];
  v: number[];
  min: number[];
  max: number[];
}

/**
 * Ghép bucket thành tối đa maxPoints cửa sổ: S ô theo `res`; S <= maxPoints thì mỗi hàng một điểm, không thì nhóm
 * ceil(S / maxPoints) ô liền kề, điểm tại đầu nhóm.
 */
export function mergeToPoints(
  buckets: Array<AggBucket & { bucket: number }>,
  from: number,
  to: number,
  res: number,
  maxPoints: number,
): MergedPoints {
  const s0 = Math.floor(from / res);
  const slots = Math.floor((to - 1) / res) - s0 + 1;
  const g = slots <= maxPoints ? 1 : Math.ceil(slots / maxPoints);
  const groups = new Map<number, AggBucket[]>();
  for (const b of buckets) {
    const j = Math.floor((Math.floor(b.bucket / res) - s0) / g);
    const list = groups.get(j);
    if (list) list.push(b);
    else groups.set(j, [b]);
  }
  const out: MergedPoints = { t: [], v: [], min: [], max: [] };
  for (const j of [...groups.keys()].sort((a, b) => a - b)) {
    const m = mergeAll(groups.get(j)!)!;
    out.t.push((s0 + j * g) * res);
    out.v.push(avg(m)!);
    out.min.push(m.min);
    out.max.push(m.max);
  }
  return out;
}
