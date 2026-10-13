// Nguồn lịch sử giả cho test widget và trang (không phải mã chạy thật): ghi lại lời gọi, trả dữ liệu đặt trước,
// có thể giữ yêu cầu lại (`hold`) để thử hủy và chạy lại.
import {
  HistoryError,
  type AggregateQuery,
  type AggregateResult,
  type ExportQuery,
  type HistoryCatalog,
  type HistorySource,
  type HistoryState,
  type RowsQuery,
  type RowsResult,
  type SeriesQuery,
  type SeriesResult,
} from './history-source.ts';

export interface PendingCall<Q, R> {
  q: Q;
  signal: AbortSignal | undefined;
  resolve: (v: R) => void;
  reject: (e: unknown) => void;
}

export class FakeHistorySource implements HistorySource {
  state: HistoryState = 'ready';
  catalogData: HistoryCatalog = defaultCatalog();
  /** Hàm sinh kết quả; mặc định trả đường đều. */
  seriesFn: (q: SeriesQuery) => SeriesResult | Promise<SeriesResult> = (q) => lineSeries(q);
  aggregateFn: (q: AggregateQuery) => AggregateResult | Promise<AggregateResult> = (q) =>
    flatAggregate(q);
  rowsFn: (q: RowsQuery) => RowsResult | Promise<RowsResult> = (q) => emptyRows(q);
  /** true: mọi yêu cầu chờ `releaseSeries`/`pending*` thay vì tự trả. */
  hold = false;
  /** Lỗi trả cho mọi yêu cầu kế tiếp (null: không lỗi). */
  failWith: HistoryError | null = null;

  readonly seriesCalls: SeriesQuery[] = [];
  readonly aggregateCalls: AggregateQuery[] = [];
  readonly rowsCalls: RowsQuery[] = [];
  readonly exportCalls: ExportQuery[] = [];
  readonly pendingSeries: PendingCall<SeriesQuery, SeriesResult>[] = [];
  readonly pendingAggregate: PendingCall<AggregateQuery, AggregateResult>[] = [];
  readonly pendingRows: PendingCall<RowsQuery, RowsResult>[] = [];
  /** Tín hiệu hủy của từng lời gọi series (cùng thứ tự `seriesCalls`). */
  readonly seriesSignals: AbortSignal[] = [];
  loginRequests = 0;

  #listeners = new Set<(s: HistoryState) => void>();

  setState(s: HistoryState): void {
    if (s === this.state) return;
    this.state = s;
    for (const l of [...this.#listeners]) l(s);
  }

  onState(cb: (s: HistoryState) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  requestLogin(): void {
    this.loginRequests++;
  }

  catalog(): Promise<HistoryCatalog> {
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve(this.catalogData);
  }

  series(q: SeriesQuery, signal: AbortSignal): Promise<SeriesResult> {
    this.seriesCalls.push(q);
    this.seriesSignals.push(signal);
    return this.#run(q, signal, this.seriesFn, this.pendingSeries);
  }

  aggregate(q: AggregateQuery, signal: AbortSignal): Promise<AggregateResult> {
    this.aggregateCalls.push(q);
    return this.#run(q, signal, this.aggregateFn, this.pendingAggregate);
  }

  rows(q: RowsQuery, signal: AbortSignal): Promise<RowsResult> {
    this.rowsCalls.push(q);
    return this.#run(q, signal, this.rowsFn, this.pendingRows);
  }

  exportUrl(q: ExportQuery): string {
    this.exportCalls.push(q);
    const p = new URLSearchParams({ group: q.group, from: String(q.from), to: String(q.to) });
    if (q.tags?.length) p.set('tags', q.tags.join(','));
    if (q.res) p.set('res', q.res);
    if (q.fields?.length) p.set('fields', q.fields.join(','));
    if (q.bom === false) p.set('bom', '0');
    return `/api/v1/history/export.csv?${p.toString()}`;
  }

  #run<Q, R>(
    q: Q,
    signal: AbortSignal | undefined,
    fn: (q: Q) => R | Promise<R>,
    pending: PendingCall<Q, R>[],
  ): Promise<R> {
    if (signal?.aborted) return Promise.reject(new HistoryError('ABORTED', 'aborted'));
    if (this.failWith) return Promise.reject(this.failWith);
    if (!this.hold) return Promise.resolve(fn(q));
    return new Promise<R>((resolve, reject) => {
      pending.push({ q, signal, resolve, reject });
      signal?.addEventListener('abort', () => reject(new HistoryError('ABORTED', 'aborted')));
    });
  }

  /** Trả kết quả mặc định cho yêu cầu series đang giữ thứ `i`. */
  async releaseSeries(i = 0): Promise<void> {
    const c = this.pendingSeries[i];
    if (c) c.resolve(await this.seriesFn(c.q));
  }
}

export function defaultCatalog(): HistoryCatalog {
  return {
    apiVersion: '1.4.0',
    enabled: true,
    state: 'running',
    limits: {
      maxTags: 16,
      maxRowsTags: 32,
      maxPoints: 5000,
      defaultMaxPoints: 1000,
      maxBuckets: 5000,
      maxRows: 500,
      maxExportRows: 500000,
      maxRangeDays: 3650,
      maxConcurrent: 2,
      timeoutMs: 10000,
      maxScanMiB: 64,
    },
    groups: [
      {
        id: 'ap-suat',
        name: 'Áp suất',
        mode: 'onChange',
        timeZone: '+07:00',
        periodMs: null,
        minIntervalMs: 1000,
        maxIntervalMs: 60000,
        raw: { from: 0, to: 2_000_000_000_000 },
        aggregates: { minute: { from: 0, to: 2_000_000_000_000 }, hour: null },
        tags: [
          {
            tagId: 'LINE1.PRESS',
            column: 'LINE1_PRESS',
            type: 'FLOAT32',
            unit: 'bar',
            aggregated: true,
            orphan: false,
          },
          {
            tagId: 'LINE1.TEMP',
            column: 'LINE1_TEMP',
            type: 'FLOAT32',
            unit: '°C',
            aggregated: true,
            orphan: false,
          },
        ],
      },
    ],
  };
}

/** Đường tăng đều (mỗi Tag một đường lệch `base`), 20 điểm trong khoảng. */
export function lineSeries(q: SeriesQuery, base = 10): SeriesResult {
  const n = 20;
  const step = (q.to - q.from) / (n - 1);
  const t = Array.from({ length: n }, (_, i) => Math.round(q.from + i * step));
  return {
    group: q.group,
    timeZone: '+07:00',
    from: q.from,
    to: q.to,
    res: 'raw',
    reduce: 'minmax',
    approximate: false,
    maxPoints: q.maxPoints ?? 1000,
    coverage: { from: q.from, to: q.to },
    gaps: [],
    series: q.tags.map((tagId, k) => ({
      tagId,
      t,
      v: t.map((_, i) => base * (k + 1) + i),
    })),
  };
}

export function flatAggregate(q: AggregateQuery): AggregateResult {
  const off = q.offsetMs ?? 0;
  const start = Math.floor((q.from - off) / q.bucketMs) * q.bucketMs + off;
  const count = Math.max(1, Math.ceil((q.to - start) / q.bucketMs));
  const fill = <T>(v: T): T[] => Array.from({ length: count }, () => v);
  return {
    group: q.group,
    timeZone: '+07:00',
    from: q.from,
    to: q.to,
    bucketMs: q.bucketMs,
    offsetMs: off,
    start,
    count,
    source: 'minute',
    series: q.tags.map((tagId) => ({
      tagId,
      n: fill(60),
      min: fill(1),
      max: fill(3),
      first: fill(1),
      last: fill(3),
      sumw: fill(2 * q.bucketMs),
      wms: fill(q.bucketMs),
      avg: fill(2),
      sum: fill((2 * q.bucketMs) / 3_600_000),
    })),
  };
}

export function emptyRows(q: RowsQuery): RowsResult {
  return {
    group: q.group,
    timeZone: '+07:00',
    order: q.order ?? 'desc',
    columns: (q.tags ?? []).map((tagId) => ({ tagId })),
    rows: [],
    next: null,
  };
}
