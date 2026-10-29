// Giao diện nguồn lịch sử (specs/010-history-reports/contracts/widget-catalog-010.md §4, history-api.md).
// Nơi chứa (trang runtime, Studio, test) cấp HistorySource; widget lịch sử không gọi mạng và không đăng ký live.
// Kiểu ở đây là dạng JSON của API 1.4.0 (thời gian là epoch ms UTC).

export type HistoryState = 'ready' | 'login-required' | 'busy' | 'disabled' | 'error';

export type HistoryRes = 'raw' | '1m' | '1h';

export interface HistoryCatalogTag {
  tagId: string;
  column: string;
  /** Nhãn hiển thị của cột (logging.json `label`, 042); vắng khi chưa đặt hoặc runtime cũ. */
  label?: string;
  type: string;
  unit?: string;
  aggregated: boolean;
  orphan: boolean;
}

export interface HistoryRange {
  from: number;
  to: number;
}

export interface HistoryCatalogGroup {
  id: string;
  name: string;
  mode: 'cyclic' | 'onChange' | 'trigger';
  /** `±HH:MM`: múi giờ hiển thị của nhóm (không theo trình duyệt). */
  timeZone: string;
  periodMs: number | null;
  minIntervalMs: number | null;
  maxIntervalMs: number | null;
  raw: HistoryRange | null;
  aggregates: { minute: HistoryRange | null; hour: HistoryRange | null } | null;
  tags: HistoryCatalogTag[];
}

export interface HistoryLimits {
  maxTags: number;
  maxRowsTags: number;
  maxPoints: number;
  defaultMaxPoints: number;
  maxBuckets: number;
  maxRows: number;
  maxExportRows: number;
  maxRangeDays: number;
  maxConcurrent: number;
  timeoutMs: number;
  maxScanMiB: number;
}

export interface HistoryCatalog {
  apiVersion: string;
  enabled: boolean;
  state: string;
  limits: HistoryLimits;
  groups: HistoryCatalogGroup[];
}

/** `priority: 'user'`: yêu cầu do thao tác của người dùng, được chạy trước yêu cầu nền (làm mới định kỳ). */
export interface HistoryQueryBase {
  group: string;
  from: number;
  to: number;
  priority?: 'user' | 'background';
}

export interface SeriesQuery extends HistoryQueryBase {
  tags: string[];
  maxPoints?: number;
  res?: 'auto' | HistoryRes;
  reduce?: 'minmax' | 'lttb' | 'decimate';
}

export interface SeriesLine {
  tagId: string;
  column?: string;
  type?: string;
  unit?: string;
  t: number[];
  v: (number | null)[];
  min?: (number | null)[];
  max?: (number | null)[];
}

export interface SeriesResult {
  group: string;
  timeZone: string;
  from: number;
  to: number;
  res: HistoryRes;
  reduce: string;
  approximate: boolean;
  maxPoints: number;
  coverage: HistoryRange | null;
  gaps: [number, number][];
  series: SeriesLine[];
}

export interface AggregateQuery extends HistoryQueryBase {
  tags: string[];
  bucketMs: number;
  offsetMs?: number;
}

export interface AggregateLine {
  tagId: string;
  type?: string;
  unit?: string;
  n: number[];
  min: (number | null)[];
  max: (number | null)[];
  first: (number | null)[];
  last: (number | null)[];
  sumw: (number | null)[];
  wms: number[];
  avg: (number | null)[];
  sum: (number | null)[];
}

export interface AggregateResult {
  group: string;
  timeZone: string;
  from: number;
  to: number;
  bucketMs: number;
  offsetMs: number;
  /** Đầu cửa sổ đầu tiên; cửa sổ `k` bắt đầu ở `start + k × bucketMs`. */
  start: number;
  count: number;
  source: 'hour' | 'minute';
  series: AggregateLine[];
}

export interface RowsQuery extends HistoryQueryBase {
  tags?: string[];
  limit?: number;
  order?: 'asc' | 'desc';
  after?: number;
}

export interface RowsResult {
  group: string;
  timeZone: string;
  order: 'asc' | 'desc';
  columns: { tagId: string; column?: string; type?: string }[];
  /** `[seq, ts, v1, v2, …]`; giá trị là số, chuỗi, bool hay null. */
  rows: (number | string | boolean | null)[][];
  /** `seq` của hàng cuối (làm `after` cho trang kế); null khi hết khoảng. */
  next: number | null;
}

export interface ExportQuery extends HistoryQueryBase {
  tags?: string[];
  res?: HistoryRes;
  fields?: string[];
  bom?: boolean;
}

export interface HistorySource {
  readonly state: HistoryState;
  onState(cb: (s: HistoryState) => void): () => void;
  catalog(signal?: AbortSignal): Promise<HistoryCatalog>;
  series(q: SeriesQuery, signal: AbortSignal): Promise<SeriesResult>;
  aggregate(q: AggregateQuery, signal: AbortSignal): Promise<AggregateResult>;
  rows(q: RowsQuery, signal: AbortSignal): Promise<RowsResult>;
  /** URL cùng nguồn gốc, không dựng chuỗi SQL. */
  exportUrl(q: ExportQuery): string;
  /** Trang: mở hộp đăng nhập; nguồn khác: không làm gì. */
  requestLogin?(): void;
}

/** Lỗi của HistorySource: `code` là mã của API (`BUSY`, `RANGE_TOO_LARGE`…) hoặc `ABORTED`, `NETWORK`. */
export class HistoryError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'HistoryError';
    this.code = code;
    this.status = status;
  }
}

export const isAbort = (e: unknown): boolean =>
  e instanceof HistoryError
    ? e.code === 'ABORTED'
    : typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
