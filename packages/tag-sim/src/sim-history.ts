// Nguồn lịch sử mô phỏng của Studio (feature 010, T131; contracts/studio-010.md §2 và §3): cho xem trước mẫu báo cáo và widget
// lịch sử mà chưa cần thiết bị. Dữ liệu sinh từ bộ sinh mô phỏng tất định (`simValue`) tại thời điểm t của lịch, không cần lưu:
// cùng cấu hình và cùng đồng hồ cho cùng kết quả. Có khoảng thiếu dữ liệu GIẢ (tất định theo id nhóm) để thử cảnh báo "dữ liệu
// đủ X %". Bucket tính bằng `Aggregator` của history-math, cùng quy tắc với runtime (history-db.md §3); không có dữ liệu tương
// lai. Trả đúng dạng JSON của API 1.4.0 (`HistorySource` của ui-components, chỉ import kiểu).
import {
  Aggregator,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  evalFn,
  mergeBuckets,
  reduceMinMax,
  type AggBucket,
  type MaybeBucket,
  type RawRow,
} from '@mat/history-math';
import type {
  AggregateLine,
  AggregateQuery,
  AggregateResult,
  ExportQuery,
  HistoryCatalog,
  HistorySource,
  HistoryState,
  RowsQuery,
  RowsResult,
  SeriesLine,
  SeriesQuery,
  SeriesResult,
} from '@mat/ui-components';
import { fnv1a32 } from './hash.ts';
import { simValue, type SimConfig, type TagDataType } from './generators.ts';

export interface SimHistoryTag {
  tagId: string;
  type: TagDataType;
  unit?: string;
  sim: SimConfig;
  /** false: Tag không có tổng hợp (mặc định true cho Tag số và BOOL). */
  aggregate?: boolean;
}

export interface SimHistoryGroup {
  id: string;
  name: string;
  mode: 'cyclic' | 'onChange' | 'trigger';
  /** `±HH:MM`, mặc định `+07:00`. */
  timeZone?: string;
  periodMs?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  /** Nhóm có tổng hợp (`aggregates`). */
  aggregates: boolean;
  tags: SimHistoryTag[];
}

export interface SimHistoryOptions {
  groups: readonly SimHistoryGroup[];
  /** Đồng hồ (epoch ms); mặc định `Date.now`. Không có dữ liệu sau `now()`. */
  now?: () => number;
  /** Bật khoảng thiếu giả (mặc định bật). */
  gaps?: boolean;
}

/** Khối 6 giờ UTC; khoảng 1/3 số khối có một chỗ thiếu 10–29 phút (tất định theo id nhóm). */
const BLOCK_MS = 6 * HOUR_MS;

/** Khoảng thiếu giả của nhóm trong `[from, to)`, đã cắt theo khoảng và xếp theo thời gian. */
export function simGaps(groupId: string, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let b = Math.floor(from / BLOCK_MS) - 1; b * BLOCK_MS < to; b++) {
    const h = fnv1a32(`${groupId}:${b}`);
    if (h % 3 !== 0) continue;
    const start = b * BLOCK_MS + ((h >>> 8) % 240) * MINUTE_MS;
    const end = start + (10 + ((h >>> 16) % 20)) * MINUTE_MS;
    if (end > from && start < to) out.push([Math.max(start, from), Math.min(end, to)]);
  }
  return out;
}

/** Cắt khoảng theo `[from, to)` rồi bỏ khoảng rỗng (gap đã được `simGaps` cắt sẵn; hàm giữ cho rõ nghĩa). */
const inGap = (gaps: ReadonlyArray<[number, number]>, t: number): boolean =>
  gaps.some(([a, b]) => t >= a && t < b);

function simError(code: string, message: string, status: number): Error {
  return Object.assign(new Error(message), { name: 'HistoryError', code, status });
}

const abortError = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' });

const numeric = (v: unknown): number | null =>
  typeof v === 'number'
    ? v
    : typeof v === 'boolean'
      ? v
        ? 1
        : 0
      : typeof v === 'bigint'
        ? Number(v)
        : null;

const LIMITS = {
  maxTags: 16,
  maxRowsTags: 32,
  maxPoints: 5000,
  defaultMaxPoints: 1000,
  maxBuckets: 5000,
  maxRows: 500,
  maxExportRows: 500_000,
  maxRangeDays: 3650,
  maxConcurrent: 2,
  timeoutMs: 10_000,
  maxScanMiB: 64,
} as const;

export class SimHistorySource implements HistorySource {
  readonly state: HistoryState = 'ready';
  readonly #groups: Map<string, SimHistoryGroup>;
  readonly #now: () => number;
  readonly #gaps: boolean;

  constructor(o: SimHistoryOptions) {
    this.#groups = new Map(o.groups.map((g) => [g.id, g]));
    this.#now = o.now ?? (() => Date.now());
    this.#gaps = o.gaps ?? true;
  }

  onState(): () => void {
    return () => undefined;
  }

  catalog(): Promise<HistoryCatalog> {
    const now = this.#now();
    const range = { from: now - LIMITS.maxRangeDays * DAY_MS, to: now };
    return Promise.resolve({
      apiVersion: '1.4.0',
      enabled: true,
      state: 'running',
      limits: { ...LIMITS },
      groups: [...this.#groups.values()].map((g) => ({
        id: g.id,
        name: g.name,
        mode: g.mode,
        timeZone: g.timeZone ?? '+07:00',
        periodMs: g.periodMs ?? null,
        minIntervalMs: g.minIntervalMs ?? null,
        maxIntervalMs: g.maxIntervalMs ?? null,
        raw: range,
        aggregates: g.aggregates ? { minute: range, hour: range } : null,
        tags: g.tags.map((t) => ({
          tagId: t.tagId,
          column: t.tagId.replace(/\./g, '_'),
          type: t.type,
          ...(t.unit !== undefined ? { unit: t.unit } : {}),
          aggregated: g.aggregates && t.aggregate !== false && t.type !== 'STRING',
          orphan: false,
        })),
      })),
    });
  }

  #group(id: string): SimHistoryGroup {
    const g = this.#groups.get(id);
    if (!g) throw simError('NO_SUCH_GROUP', `Không có nhóm '${id}'`, 404);
    return g;
  }

  #tags(g: SimHistoryGroup, ids: readonly string[] | undefined): SimHistoryTag[] {
    if (!ids || ids.length === 0) return g.tags;
    return ids.map((id) => {
      const t = g.tags.find((x) => x.tagId === id);
      if (!t) throw simError('NO_SUCH_TAG', `Nhóm '${g.id}' không có Tag '${id}'`, 404);
      return t;
    });
  }

  #gapsOf(g: SimHistoryGroup, from: number, to: number): Array<[number, number]> {
    return this.#gaps ? simGaps(g.id, from, to) : [];
  }

  /** Bước lấy mẫu thô của nhóm (ms), nới ra khi khoảng quá dài để không quá 20.000 dòng mỗi Tag. */
  #rawStep(g: SimHistoryGroup, from: number, to: number): number {
    const base = Math.max(g.periodMs ?? g.minIntervalMs ?? MINUTE_MS, 1000);
    const wide = Math.ceil((to - from) / 20_000 / 1000) * 1000;
    return Math.max(base, wide);
  }

  /** Dòng thô của một Tag tại các mốc `step` trong `[from, to]`, không quá `now`, bỏ khoảng thiếu. */
  #raw(
    tag: SimHistoryTag,
    from: number,
    to: number,
    step: number,
    gaps: ReadonlyArray<[number, number]>,
  ): RawRow[] {
    const last = Math.min(to, this.#now());
    const out: RawRow[] = [];
    for (let t = Math.ceil(from / step) * step; t <= last; t += step) {
      if (inGap(gaps, t)) continue;
      out.push([t, numeric(simValue(tag.sim, t, tag.type))]);
    }
    return out;
  }

  series(q: SeriesQuery, signal: AbortSignal): Promise<SeriesResult> {
    return this.#run(signal, () => {
      const g = this.#group(q.group);
      const tags = this.#tags(g, q.tags);
      const maxPoints = q.maxPoints ?? LIMITS.defaultMaxPoints;
      const gaps = this.#gapsOf(g, q.from, q.to);
      const step = this.#rawStep(g, q.from, q.to);
      let approximate = false;
      let first = Infinity;
      let lastT = -Infinity;
      const series: SeriesLine[] = tags.map((tag) => {
        let rows = this.#raw(tag, q.from, q.to, step, gaps);
        if (rows.length > maxPoints) {
          rows = reduceMinMax(rows, q.from, q.to, maxPoints);
          approximate = true;
        }
        if (rows.length) {
          first = Math.min(first, rows[0]![0]);
          lastT = Math.max(lastT, rows.at(-1)![0]);
        }
        return {
          tagId: tag.tagId,
          column: tag.tagId.replace(/\./g, '_'),
          type: tag.type,
          ...(tag.unit !== undefined ? { unit: tag.unit } : {}),
          t: rows.map((r) => r[0]),
          v: rows.map((r) => r[1]),
        };
      });
      return {
        group: g.id,
        timeZone: g.timeZone ?? '+07:00',
        from: q.from,
        to: q.to,
        res: 'raw',
        reduce: q.reduce ?? 'minmax',
        approximate,
        maxPoints,
        coverage: first <= lastT ? { from: first, to: lastT } : null,
        gaps,
        series,
      };
    });
  }

  aggregate(q: AggregateQuery, signal: AbortSignal): Promise<AggregateResult> {
    return this.#run(signal, () => {
      const g = this.#group(q.group);
      if (!g.aggregates) throw simError('NO_AGGREGATES', `Nhóm '${g.id}' không có tổng hợp`, 404);
      const tags = this.#tags(g, q.tags);
      const off = (((q.offsetMs ?? 0) % q.bucketMs) + q.bucketMs) % q.bucketMs;
      const start = Math.floor((q.from - off) / q.bucketMs) * q.bucketMs + off;
      const count = Math.max(1, Math.ceil((q.to - start) / q.bucketMs));
      const gaps = this.#gapsOf(g, start, start + count * q.bucketMs);
      const series: AggregateLine[] = tags.map((tag) => {
        const windows: MaybeBucket[] = Array.from({ length: count }, () => null);
        for (const b of this.#minuteBuckets(
          tag,
          start,
          Math.min(q.to, start + count * q.bucketMs),
          gaps,
        )) {
          const k = Math.floor((b.bucket - start) / q.bucketMs);
          if (k >= 0 && k < count) windows[k] = mergeBuckets(windows[k]!, b);
        }
        const field = (f: (b: AggBucket) => number): Array<number | null> =>
          windows.map((w) => (w === null ? null : f(w)));
        return {
          tagId: tag.tagId,
          type: tag.type,
          ...(tag.unit !== undefined ? { unit: tag.unit } : {}),
          n: windows.map((w) => w?.n ?? 0),
          min: field((w) => w.min),
          max: field((w) => w.max),
          first: field((w) => w.first),
          last: field((w) => w.last),
          sumw: field((w) => w.sumw),
          wms: windows.map((w) => w?.wms ?? 0),
          avg: windows.map((w) => evalFn('avg', w)),
          sum: windows.map((w) => evalFn('sum', w)),
        };
      });
      return {
        group: g.id,
        timeZone: g.timeZone ?? '+07:00',
        from: q.from,
        to: q.to,
        bucketMs: q.bucketMs,
        offsetMs: off,
        start,
        count,
        source: q.bucketMs % HOUR_MS === 0 ? 'hour' : 'minute',
        series,
      };
    });
  }

  /** Cửa sổ phút của một Tag: mỗi phút một dòng thô; khoảng thiếu ngắt tín hiệu như runtime (`break`). */
  #minuteBuckets(
    tag: SimHistoryTag,
    from: number,
    to: number,
    gaps: ReadonlyArray<[number, number]>,
  ): Array<AggBucket & { bucket: number }> {
    const last = Math.min(to, this.#now());
    const agg = new Aggregator();
    let broken = false;
    for (let t = Math.ceil(from / MINUTE_MS) * MINUTE_MS; t <= last; t += MINUTE_MS) {
      if (inGap(gaps, t)) {
        if (!broken) agg.break(t);
        broken = true;
        continue;
      }
      broken = false;
      const v = numeric(simValue(tag.sim, t, tag.type));
      if (v !== null) agg.row(t, v);
    }
    if (last > from && !broken) agg.advance(last);
    return agg.drain();
  }

  rows(q: RowsQuery, signal: AbortSignal): Promise<RowsResult> {
    return this.#run(signal, () => {
      const g = this.#group(q.group);
      const tags = this.#tags(g, q.tags);
      const gaps = this.#gapsOf(g, q.from, q.to);
      const step = this.#rawStep(g, q.from, q.to);
      const limit = Math.min(q.limit ?? 100, LIMITS.maxRows);
      const all: Array<(number | string | boolean | null)[]> = [];
      const last = Math.min(q.to, this.#now());
      for (let t = Math.ceil(q.from / step) * step; t <= last; t += step) {
        if (inGap(gaps, t)) continue;
        all.push([
          Math.floor(t / step),
          t,
          ...tags.map((tag) => {
            const v = simValue(tag.sim, t, tag.type);
            return typeof v === 'bigint' ? Number(v) : v;
          }),
        ]);
      }
      const order = q.order ?? 'asc';
      if (order === 'desc') all.reverse();
      const after = q.after;
      const rest =
        after === undefined
          ? all
          : all.filter((r) =>
              order === 'asc' ? (r[0] as number) > after : (r[0] as number) < after,
            );
      const rows = rest.slice(0, limit);
      return {
        group: g.id,
        timeZone: g.timeZone ?? '+07:00',
        order,
        columns: tags.map((t) => ({
          tagId: t.tagId,
          column: t.tagId.replace(/\./g, '_'),
          type: t.type,
        })),
        rows,
        next: rest.length > limit ? (rows.at(-1)![0] as number) : null,
      };
    });
  }

  exportUrl(q: ExportQuery): string {
    const p = new URLSearchParams({ group: q.group, from: String(q.from), to: String(q.to) });
    if (q.tags?.length) p.set('tags', q.tags.join(','));
    if (q.res) p.set('res', q.res);
    if (q.fields?.length) p.set('fields', q.fields.join(','));
    if (q.bom === false) p.set('bom', '0');
    return `/api/v1/history/export.csv?${p.toString()}`;
  }

  #run<R>(signal: AbortSignal | undefined, fn: () => R): Promise<R> {
    if (signal?.aborted) return Promise.reject(abortError());
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e);
    }
  }
}
