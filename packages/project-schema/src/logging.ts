// Luật của logging.json (specs/003-data-logging/contracts/logging-config.md). Bản C++
// (core/project-manager/project_validator.cpp, logging_estimate.cpp) cho cùng tập mã lỗi và cảnh báo.
import type { ErrorCode, Issue, WarningCode } from './codes.ts';
import type { LoggingConfig, LoggingGroup, TagDataType } from './types.ts';

const SECRET_WORDS = ['password', 'passwd', 'pwd', 'secret', 'token', 'apikey', 'api_key'];
/** Chữ thường kiểu ASCII như bản C++ (toLowerCase đổi cả K KELVIN SIGN thành k: review S13). */
const lowerAscii = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** JSON Pointer của khóa đầu tiên giống bí mật (chứa một từ trên, không phân biệt hoa/thường). */
export function findSecretKey(v: unknown, path = ''): string | null {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findSecretKey(v[i], `${path}/${i}`);
      if (r !== null) return r;
    }
    return null;
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, child] of Object.entries(v)) {
      const p = `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      const lower = lowerAscii(k);
      if (SECRET_WORDS.some((w) => lower.includes(w))) return p;
      const r = findSecretKey(child, p);
      if (r !== null) return r;
    }
  }
  return null;
}

/** URL của kết nối có tài khoản/mật khẩu (`https://user:pass@host`, review bảo mật L4). */
export function findUrlCredentials(v: unknown): string | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const conns = (v as Record<string, unknown>).connections;
  if (!Array.isArray(conns)) return null;
  for (let i = 0; i < conns.length; i++) {
    const c: unknown = conns[i];
    if (c === null || typeof c !== 'object' || Array.isArray(c)) continue;
    const url = (c as Record<string, unknown>).url;
    if (typeof url !== 'string') continue;
    const scheme = url.indexOf('://');
    const rest = scheme < 0 ? url : url.slice(scheme + 3);
    const end = rest.search(/[/?#]/);
    if ((end < 0 ? rest : rest.slice(0, end)).includes('@')) return `/connections/${i}/url`;
  }
  return null;
}

/** "van-hanh" → "van_hanh", "3pha" → "t_3pha" (bảng mặc định của nhóm, data-model §1). */
export const defaultTableName = (groupId: string) => {
  const t = groupId.replace(/-/g, '_');
  return /^[0-9]/.test(t) ? `t_${t}` : t;
};
/** "TANK01.LEVEL" → "TANK01_LEVEL" (cột mặc định của Tag). */
export const defaultColumnName = (tagId: string) => tagId.replace(/\./g, '_');

const TABLE_RE = /^[a-z][a-z0-9_]{0,47}$/;
const COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
/**
 * Tên cột dành riêng (so chữ thường): cột của runtime; rowid của SQLite (che rowid thật, review C2);
 * cột hệ thống của PostgreSQL (review I5); tag `source` và tên bắt đầu bằng `_` của InfluxDB.
 */
const RESERVED_COLUMNS = new Set([
  'id',
  'time',
  'seq',
  'ts',
  'rowid',
  'oid',
  '_rowid_',
  'xmin',
  'xmax',
  'cmin',
  'cmax',
  'ctid',
  'tableoid',
  'source',
]);
const reservedColumn = (key: string) => RESERVED_COLUMNS.has(key) || key.startsWith('_');
const NUMERIC = new Set<TagDataType>([
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
]);
const SQL_FIELDS = ['host', 'port', 'database', 'schema', 'user', 'timeZone'] as const;
const INFLUX_FIELDS = ['url', 'org', 'bucket'] as const;
export const MAX_STRING_TAGS_PER_GROUP = 64;

function checkMode(g: LoggingGroup): boolean {
  // Chế độ trigger (feature 010): mọi sai trường là E_LOG_TRIGGER, không có E_LOG_MODE.
  if (g.mode === 'trigger') return true;
  if (g.mode === 'cyclic')
    return (
      g.periodMs !== undefined && g.minIntervalMs === undefined && g.maxIntervalMs === undefined
    );
  if (g.periodMs !== undefined) return false;
  return g.maxIntervalMs === undefined || (g.minIntervalMs ?? 1000) <= g.maxIntervalMs;
}

/**
 * Luật E_LOG_* (bước 6 của contract) trên logging.json đã qua schema. `tagTypes` là undefined khi
 * tags.json lỗi: các luật cần kiểu Tag bị bỏ qua.
 */
export function loggingRules(
  cfg: LoggingConfig,
  file: string,
  tagTypes: Map<string, TagDataType> | undefined,
): Issue[] {
  const issues: Issue[] = [];
  const add = (code: ErrorCode, path: string, message: string) =>
    issues.push({ code, file, path, message });
  const connections = cfg.connections ?? [];
  const connIds = new Set(connections.map((c) => c.id));

  const groupIds = new Set<string>();
  const tables = new Set<string>();
  cfg.groups.forEach((g, i) => {
    const p = `/groups/${i}`;
    if (groupIds.has(g.id)) add('E_LOG_DUP_ID', `${p}/id`, `id nhóm '${g.id}' bị trùng`);
    groupIds.add(g.id);

    const table = g.table ?? defaultTableName(g.id);
    if (!TABLE_RE.test(table) || table.startsWith('mat_'))
      add(
        'E_LOG_TABLE',
        p,
        `Tên bảng '${table}' không hợp lệ (a-z, 0-9, _, không bắt đầu bằng mat_)`,
      );
    else if (tables.has(table)) add('E_LOG_TABLE', p, `Bảng '${table}' trùng với nhóm khác`);
    tables.add(table);

    if (!checkMode(g))
      add(
        'E_LOG_MODE',
        p,
        g.mode === 'cyclic'
          ? 'cyclic cần periodMs và không dùng minIntervalMs/maxIntervalMs'
          : 'onChange không dùng periodMs; maxIntervalMs phải ≥ minIntervalMs',
      );

    triggerRules(g, p, tagTypes, add);
    aggregateRules(g, p, tagTypes, add);

    (g.destinations ?? []).forEach((d, k) => {
      if (!connIds.has(d))
        add('E_LOG_REF_DEST', `${p}/destinations/${k}`, `Không có kết nối '${d}'`);
    });

    const seenTags = new Set<string>();
    const columns = new Set<string>();
    let strings = 0;
    g.tags.forEach((t, j) => {
      const tp = `${p}/tags/${j}`;
      if (seenTags.has(t.tagId)) {
        add('E_LOG_DUP_TAG', `${tp}/tagId`, `Tag '${t.tagId}' lặp trong nhóm`);
        return; // mục lặp không bị kiểm thêm E_LOG_COLUMN
      }
      seenTags.add(t.tagId);
      if (tagTypes) {
        const type = tagTypes.get(t.tagId);
        if (!type) {
          add('E_LOG_REF_TAG', `${tp}/tagId`, `Tag '${t.tagId}' không có trong tags.json`);
        } else {
          if (t.deadband !== undefined && !NUMERIC.has(type))
            add(
              'E_LOG_DEADBAND',
              `${tp}/deadband`,
              `deadband chỉ dùng cho Tag số ('${t.tagId}' là ${type})`,
            );
          if (t.maxLength !== undefined && type !== 'STRING')
            add(
              'E_LOG_MAXLEN',
              `${tp}/maxLength`,
              `maxLength chỉ dùng cho Tag STRING ('${t.tagId}' là ${type})`,
            );
          if (type === 'STRING') strings++;
        }
      }
      const col = t.column ?? defaultColumnName(t.tagId);
      const key = lowerAscii(col);
      if (!COLUMN_RE.test(col) || reservedColumn(key))
        add('E_LOG_COLUMN', tp, `Tên cột '${col}' không hợp lệ hoặc là tên dành riêng`);
      else if (columns.has(key))
        add('E_LOG_COLUMN', tp, `Cột '${col}' trùng trong nhóm (không phân biệt hoa/thường)`);
      columns.add(key);
    });
    if (strings > MAX_STRING_TAGS_PER_GROUP)
      add(
        'E_LOG_LIMIT',
        `${p}/tags`,
        `Nhóm có ${strings} Tag STRING (tối đa ${MAX_STRING_TAGS_PER_GROUP})`,
      );
  });

  const seenConn = new Set<string>();
  connections.forEach((c, i) => {
    const p = `/connections/${i}`;
    if (seenConn.has(c.id)) add('E_LOG_DUP_ID', `${p}/id`, `id kết nối '${c.id}' bị trùng`);
    seenConn.add(c.id);
    const rec = c as unknown as Record<string, unknown>;
    const has = (k: string) => rec[k] !== undefined;
    if (c.type === 'influxdb') {
      if (!INFLUX_FIELDS.every(has) || SQL_FIELDS.some(has))
        add('E_LOG_CONN', p, 'influxdb cần url, org, bucket và không dùng trường của SQL');
    } else {
      const own = c.type === 'mysql' ? SQL_FIELDS.filter((k) => k !== 'schema') : SQL_FIELDS;
      const foreign = [
        ...INFLUX_FIELDS,
        ...SQL_FIELDS.filter((k) => !(own as readonly string[]).includes(k)),
      ];
      if (!['host', 'database', 'user'].every(has) || foreign.some(has))
        add('E_LOG_CONN', p, `${c.type} cần host, database, user và chỉ dùng trường của loại này`);
    }
    if (c.tls !== undefined) {
      const url = c.url ?? '';
      const bad =
        (c.type === 'influxdb' && url.startsWith('http://') && c.tls !== 'disable') ||
        (c.type === 'influxdb' &&
          url.startsWith('https://') &&
          (c.tls === 'disable' || c.tls === 'prefer'));
      if (bad) add('E_LOG_TLS', `${p}/tls`, `tls '${c.tls}' không dùng được với kết nối này`);
    }
  });
  return issues;
}

type AddFn = (code: ErrorCode, path: string, message: string) => void;

const isNumericOrBool = (t: TagDataType | undefined) => t === 'BOOL' || (t && NUMERIC.has(t));

/** E_LOG_TRIGGER (contracts/logging-config-0.2.md §3) và E_LOG_REF_TAG của `trigger.tagId`. */
function triggerRules(
  g: LoggingGroup,
  p: string,
  tagTypes: Map<string, TagDataType> | undefined,
  add: AddFn,
): void {
  if (g.mode !== 'trigger') {
    if (g.trigger !== undefined)
      add('E_LOG_TRIGGER', `${p}/trigger`, `trigger chỉ dùng với mode trigger`);
    if (g.mode === 'cyclic' && g.expectedRowsPerDay !== undefined)
      add('E_LOG_TRIGGER', `${p}/expectedRowsPerDay`, 'expectedRowsPerDay không dùng với cyclic');
    return;
  }
  const t = g.trigger;
  if (t === undefined) {
    add('E_LOG_TRIGGER', p, 'mode trigger cần trường trigger');
  } else {
    if (tagTypes) {
      const type = tagTypes.get(t.tagId);
      if (!type)
        add('E_LOG_REF_TAG', `${p}/trigger/tagId`, `Tag '${t.tagId}' không có trong tags.json`);
      else if (!isNumericOrBool(type))
        add('E_LOG_TRIGGER', `${p}/trigger/tagId`, `Tag kích hoạt '${t.tagId}' kiểu ${type}`);
      else if (type === 'BOOL' && t.threshold !== undefined)
        add('E_LOG_TRIGGER', `${p}/trigger/threshold`, 'threshold không dùng với Tag BOOL');
    }
    if (t.edge === 'active' && g.periodMs === undefined)
      add('E_LOG_TRIGGER', p, 'edge active cần periodMs');
    if (t.edge !== 'active' && g.periodMs !== undefined)
      add('E_LOG_TRIGGER', `${p}/periodMs`, 'periodMs chỉ dùng với edge active');
  }
  if (g.maxIntervalMs !== undefined)
    add('E_LOG_TRIGGER', `${p}/maxIntervalMs`, 'maxIntervalMs không dùng với trigger');
}

/** E_LOG_AGG (contracts/logging-config-0.2.md §3). */
function aggregateRules(
  g: LoggingGroup,
  p: string,
  tagTypes: Map<string, TagDataType> | undefined,
  add: AddFn,
): void {
  g.tags.forEach((t, j) => {
    if (t.aggregate === true && tagTypes?.get(t.tagId) === 'STRING')
      add('E_LOG_AGG', `${p}/tags/${j}/aggregate`, `Tag chuỗi '${t.tagId}' không tổng hợp được`);
  });
  const a = g.aggregates;
  if (a === undefined) return;
  if (tagTypes && aggregatedTags(g, tagTypes) === 0)
    add('E_LOG_AGG', `${p}/aggregates`, 'nhóm không có Tag số hoặc BOOL nào được tổng hợp');
  if ((a.hourRetentionDays ?? DEFAULT_HOUR_DAYS) < (a.minuteRetentionDays ?? DEFAULT_MINUTE_DAYS))
    add('E_LOG_AGG', `${p}/aggregates`, 'hourRetentionDays phải >= minuteRetentionDays');
}

const DEFAULT_MINUTE_DAYS = 31;
const DEFAULT_HOUR_DAYS = 730;

/** Số Tag số/BOOL có `aggregate` khác false (0 nếu nhóm không có `aggregates`). */
function aggregatedTags(g: LoggingGroup, types: Map<string, TagDataType>): number {
  if (g.aggregates === undefined) return 0;
  return g.tags.filter((t) => t.aggregate !== false && isNumericOrBool(types.get(t.tagId))).length;
}

const LOOPBACK = /^(localhost|127(\.[0-9]{1,3}){3}|\[::1\])(:[0-9]+)?$/i;

/**
 * Chỉ số các kết nối mà một nhóm gửi tới nhưng không xác thực máy chủ (W_LOG_TLS_UNVERIFIED, review
 * bảo mật M2): SQL có `tls` khác `verify-full` (thiếu `tls` là `verify-full`, Constitution V); InfluxDB `https` với
 * `require`, hoặc `http` tới máy khác (token đi dạng rõ).
 */
export function unverifiedConnections(cfg: LoggingConfig): number[] {
  const used = new Set(cfg.groups.flatMap((g) => g.destinations ?? []));
  const out: number[] = [];
  (cfg.connections ?? []).forEach((c, i) => {
    if (!used.has(c.id)) return;
    if (c.type !== 'influxdb') {
      if ((c.tls ?? 'verify-full') !== 'verify-full') out.push(i);
      return;
    }
    const url = c.url ?? '';
    if (url.startsWith('https://')) {
      if (c.tls === 'require') out.push(i);
      return;
    }
    const host = url.slice(url.indexOf('://') + 3).split(/[/?#]/)[0] ?? '';
    if (!LOOPBACK.test(host)) out.push(i);
  });
  return out;
}

// ---- Ước tính (cùng hằng số với core/project-manager/logging_estimate.cpp) ----

export const LOG_BUDGET_BYTES = 2 * 1024 ** 3;
const DAY_MS = 86_400_000;
const COMMITS_PER_DAY = DAY_MS / 5000;
const PAGE_BYTES = 4096;
/** Số trang SQLite sửa mỗi commit (hiệu chỉnh theo số đo x64, ADR-034 mục 5). */
const COMMIT_PAGES = 6;
/** Hệ số ghi của tổng hợp so với kích thước hàng (số đo x64: +57 MB/ngày cho 200 Tag). */
const AGG_WRITE_FACTOR = 3.6;

export function cellBytes(type: TagDataType | undefined, maxLength = 255): number {
  switch (type) {
    case 'BOOL':
      return 2;
    case 'INT16':
    case 'UINT16':
      return 3;
    case 'INT32':
    case 'UINT32':
      return 5;
    case 'STRING':
      return 2 + Math.min(maxLength, 64);
    default:
      return 9;
  }
}

export interface GroupEstimate {
  rowsPerDay: number;
  basis: 'exact' | 'expected' | 'upper';
  rowBytes: number;
  rawWrite: number;
  aggWrite: number;
  rawStorage: number;
  aggStorage: number;
  aggTags: number;
}

/** Kết quả ước tính v2 (contracts/logging-config-0.2.md §5): cùng trường với bản C++. */
export interface LoggingEstimate {
  writeBytesPerDay: number;
  rawWriteBytesPerDay: number;
  aggWriteBytesPerDay: number;
  storageBytes: number;
  dailyGrowthBytes: number;
  /** floor(2 GiB / dailyGrowthBytes); null khi không có nhóm hoặc không tăng. */
  daysToFillCap: number | null;
  warnings: WarningCode[];
  groups: GroupEstimate[];
}

/** Một hàng `mat_agg` ước tính 64 byte; mỗi Tag một ngày có 1.440 hàng phút và 24 hàng giờ. */
const AGG_ROW_BYTES = 64;
export const LOG_EXTREME_BYTES = 8 * 1024 ** 3;

export function estimateLogging(
  cfg: LoggingConfig,
  tagTypes: Map<string, TagDataType>,
  /** W_LOG_WRITE_EXTREME chỉ có ở định dạng 0.6 (mặc định bật; luật 0.1-0.3 tắt). */
  extremeWarning = true,
): LoggingEstimate {
  let writeBytesPerDay = 0;
  let rawWriteBytesPerDay = 0;
  let aggWriteBytesPerDay = 0;
  let storageBytes = 0;
  let dailyGrowthBytes = 0;
  const groups: GroupEstimate[] = [];
  // Thứ tự cộng theo thứ tự nhóm trong file (bản C++ cộng cùng thứ tự).
  for (const g of cfg.groups) {
    // Nhóm chưa có Tag không ghi gì (sửa lỗi 042: trước đây vẫn tính hàng rỗng + commit, 0 Tag ra ~429 MB/ngày).
    if (g.tags.length === 0) {
      groups.push({
        rowsPerDay: 0,
        basis: 'exact',
        rowBytes: 0,
        rawWrite: 0,
        aggWrite: 0,
        rawStorage: 0,
        aggStorage: 0,
        aggTags: 0,
      });
      continue;
    }
    let rowBytes = 24;
    for (const t of g.tags) rowBytes += cellBytes(tagTypes.get(t.tagId), t.maxLength);
    const periodic = g.mode === 'cyclic' || (g.mode === 'trigger' && g.trigger?.edge === 'active');
    const upper = DAY_MS / (periodic ? (g.periodMs ?? DAY_MS) : (g.minIntervalMs ?? 1000));
    const hasExpected = !periodic && g.expectedRowsPerDay !== undefined;
    const rowsPerDay = hasExpected ? Math.min(g.expectedRowsPerDay!, upper) : upper;
    const basis = periodic ? 'exact' : hasExpected ? 'expected' : 'upper';
    const rawWrite =
      2 * rowsPerDay * rowBytes + Math.min(COMMITS_PER_DAY, rowsPerDay) * COMMIT_PAGES * PAGE_BYTES;
    const aggTags = aggregatedTags(g, tagTypes);
    const perDayAgg = aggTags * (1440 + 24) * AGG_ROW_BYTES;
    const aggWrite = AGG_WRITE_FACTOR * perDayAgg;
    const rawStorage = rowsPerDay * rowBytes * g.retentionDays;
    const minuteDays = g.aggregates?.minuteRetentionDays ?? DEFAULT_MINUTE_DAYS;
    const hourDays = g.aggregates?.hourRetentionDays ?? DEFAULT_HOUR_DAYS;
    const aggStorage = aggTags * (1440 * minuteDays + 24 * hourDays) * AGG_ROW_BYTES;
    rawWriteBytesPerDay += rawWrite;
    aggWriteBytesPerDay += aggWrite;
    writeBytesPerDay += rawWrite + aggWrite;
    storageBytes += rawStorage + aggStorage;
    dailyGrowthBytes += rowsPerDay * rowBytes + perDayAgg;
    groups.push({
      rowsPerDay,
      basis,
      rowBytes,
      rawWrite,
      aggWrite,
      rawStorage,
      aggStorage,
      aggTags,
    });
  }
  const warnings: WarningCode[] = [];
  if (writeBytesPerDay > LOG_BUDGET_BYTES) warnings.push('W_LOG_WRITE_BUDGET');
  if (extremeWarning && writeBytesPerDay > LOG_EXTREME_BYTES) warnings.push('W_LOG_WRITE_EXTREME');
  if (storageBytes > LOG_BUDGET_BYTES) warnings.push('W_LOG_SIZE_CAP');
  const daysToFillCap =
    dailyGrowthBytes > 0 ? Math.floor(LOG_BUDGET_BYTES / dailyGrowthBytes) : null;
  return {
    writeBytesPerDay,
    rawWriteBytesPerDay,
    aggWriteBytesPerDay,
    storageBytes,
    dailyGrowthBytes,
    daysToFillCap,
    warnings,
    groups,
  };
}
