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

export interface LoggingEstimate {
  writeBytesPerDay: number;
  storageBytes: number;
  warnings: WarningCode[];
}

export function estimateLogging(
  cfg: LoggingConfig,
  tagTypes: Map<string, TagDataType>,
): LoggingEstimate {
  let writeBytesPerDay = 0;
  let storageBytes = 0;
  for (const g of cfg.groups) {
    let rowBytes = 24;
    for (const t of g.tags) rowBytes += cellBytes(tagTypes.get(t.tagId), t.maxLength);
    const interval = g.mode === 'cyclic' ? (g.periodMs ?? DAY_MS) : (g.minIntervalMs ?? 1000);
    const rowsPerDay = DAY_MS / interval;
    writeBytesPerDay +=
      2 * rowsPerDay * rowBytes + Math.min(COMMITS_PER_DAY, rowsPerDay) * 3 * PAGE_BYTES;
    storageBytes += rowsPerDay * rowBytes * g.retentionDays;
  }
  const warnings: WarningCode[] = [];
  if (writeBytesPerDay > LOG_BUDGET_BYTES) warnings.push('W_LOG_WRITE_BUDGET');
  if (storageBytes > LOG_BUDGET_BYTES) warnings.push('W_LOG_SIZE_CAP');
  return { writeBytesPerDay, storageBytes, warnings };
}
