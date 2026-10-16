// Kết nối DB ngoài và đích của nhóm trong logging.json (feature 010, FR-046, contracts/studio-010.md §1.1): hàm thuần trên
// `LoggingConfig`, mỗi hàm cho ra cấu hình mới (một sửa đổi `{ kind: 'logging' }` của người gọi). Không có mật khẩu hay token:
// bí mật nhập trên thiết bị (`--set-secret`).
import type { ConnectionType, LoggingConfig, TlsMode } from '@mat/project-schema';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const CONNECTION_TYPES: readonly ConnectionType[] = [
  'postgresql',
  'mysql',
  'mssql',
  'influxdb',
];
export const TLS_MODES: readonly TlsMode[] = ['verify-full', 'require', 'prefer', 'disable'];
export const DEFAULT_PORT: Readonly<Record<ConnectionType, number>> = {
  postgresql: 5432,
  mysql: 3306,
  mssql: 1433,
  influxdb: 8086,
};

export type ConnField =
  | 'id'
  | 'type'
  | 'host'
  | 'port'
  | 'database'
  | 'schema'
  | 'user'
  | 'url'
  | 'org'
  | 'bucket'
  | 'tls'
  | 'timeZone';

/** Trường dùng cho từng loại (trường của loại khác bị bỏ khi đổi loại). */
export const FIELDS_OF: Readonly<Record<ConnectionType, readonly ConnField[]>> = {
  postgresql: ['host', 'port', 'database', 'schema', 'user', 'tls', 'timeZone'],
  mysql: ['host', 'port', 'database', 'user', 'tls', 'timeZone'],
  mssql: ['host', 'port', 'database', 'schema', 'user', 'tls', 'timeZone'],
  influxdb: ['url', 'org', 'bucket', 'tls', 'timeZone'],
};

function uniqueId(cfg: LoggingConfig, base: string): string {
  const used = new Set((cfg.connections ?? []).map((c) => c.id));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Thêm kết nối PostgreSQL trống (người dùng điền máy chủ, DB, người dùng). */
export function addConnection(cfg: LoggingConfig): LoggingConfig {
  const next = clone(cfg);
  (next.connections ??= []).push({
    id: uniqueId(next, 'ket-noi'),
    type: 'postgresql',
    host: '',
    port: DEFAULT_PORT.postgresql,
    database: '',
    user: '',
  });
  return next;
}

/**
 * Đặt (hoặc xóa khi `undefined` / chuỗi rỗng) một trường của kết nối thứ `index`. Đổi `id` đổi theo ở đích của mọi nhóm;
 * đổi `type` bỏ trường của loại cũ và đặt cổng mặc định của loại mới (SQL).
 */
export function setConnectionField(
  cfg: LoggingConfig,
  index: number,
  field: ConnField,
  value: string | number | undefined,
): LoggingConfig {
  const cur = cfg.connections?.[index];
  if (!cur) return cfg;
  const next = clone(cfg);
  const c = next.connections![index]! as unknown as Record<string, unknown>;
  if (field === 'id') {
    const to = typeof value === 'string' ? value.trim() : '';
    if (to === '') return cfg;
    for (const g of next.groups)
      g.destinations = g.destinations?.map((d) => (d === cur.id ? to : d));
    c.id = to;
    return next;
  }
  if (field === 'type') {
    const type = value as ConnectionType;
    const keep = new Set<string>(['id', 'type', ...FIELDS_OF[type]]);
    for (const k of Object.keys(c)) if (!keep.has(k)) delete c[k];
    c.type = type;
    if (type !== 'influxdb') c.port ??= DEFAULT_PORT[type];
    return next;
  }
  if (value === undefined || value === '') delete c[field];
  else c[field] = value;
  return next;
}

/** Bật/tắt một kết nối là đích của nhóm (`destinations` rỗng thì bỏ khóa). */
export function toggleDestination(
  cfg: LoggingConfig,
  group: number,
  connId: string,
  on: boolean,
): LoggingConfig {
  if (!cfg.groups[group]) return cfg;
  const next = clone(cfg);
  const g = next.groups[group]!;
  const list = new Set(g.destinations ?? []);
  if (on) list.add(connId);
  else list.delete(connId);
  if (list.size === 0) delete g.destinations;
  else g.destinations = [...list];
  return next;
}
