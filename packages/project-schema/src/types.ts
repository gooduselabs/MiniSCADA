// Kiểu TS khớp schemas/*.schema.json (schema v0). Nguồn chuẩn là file schema.

export type TagDataType =
  | 'BOOL'
  | 'INT16'
  | 'UINT16'
  | 'INT32'
  | 'UINT32'
  | 'INT64'
  | 'UINT64'
  | 'FLOAT32'
  | 'FLOAT64'
  | 'STRING';

export type Scalar = boolean | number | string;

export interface Project {
  format: 'matscada-project';
  schemaVersion: string;
  projectId: string;
  projectName: string;
  projectVersion: string;
  minRuntimeVersion: string;
  entryScreen: string;
  screens: string[];
  tagFile: string;
  maxClients: number;
  supportedBrowsers?: Array<{ engine: 'chromium'; minVersion: number }>;
  /** logging.json (feature 003). Không có thì không lưu trữ. */
  loggingFile?: string;
  /** Định dạng 0.2: connections.json, tên bảng giá trị (value-tables/<tên>.json), id bảng theo dõi. */
  connectionFile?: string;
  valueTables?: string[];
  watchTables?: string[];
  /** Định dạng 0.6 (feature 010): reports.json. Không có thì không có báo cáo. */
  reportsFile?: string;
}

// ---- Lưu trữ dữ liệu (schemas/logging.schema.json, specs/003-data-logging/data-model.md) ----

export type LoggingMode = 'cyclic' | 'onChange' | 'trigger';
export type ConnectionType = 'mysql' | 'mssql' | 'postgresql' | 'influxdb';
export type TlsMode = 'disable' | 'prefer' | 'require' | 'verify-full';

export interface LoggedTag {
  tagId: string;
  column?: string;
  /** Dòng 1.x (042): nhãn hiển thị của cột ở Lịch sử, báo cáo, biểu đồ, file xuất; runtime cũ từ chối khóa này. */
  label?: string;
  deadband?: number;
  maxLength?: number;
  /** Định dạng 0.6 (feature 010): false loại Tag khỏi tổng hợp; mặc định true cho Tag số/BOOL. */
  aggregate?: boolean;
}

/** Định dạng 0.6 (feature 010, contracts/logging-config-0.2.md §1). */
export interface LoggingTrigger {
  tagId: string;
  edge: 'rising' | 'falling' | 'both' | 'active';
  threshold?: number;
}
export interface LoggingAggregates {
  minuteRetentionDays?: number;
  hourRetentionDays?: number;
}

export interface LoggingGroup {
  id: string;
  name: string;
  table?: string;
  mode: LoggingMode;
  periodMs?: number;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  retentionDays: number;
  destinations?: string[];
  tags: LoggedTag[];
  /** Định dạng 0.6 (feature 010). */
  trigger?: LoggingTrigger;
  expectedRowsPerDay?: number;
  aggregates?: LoggingAggregates;
}

/** Kết nối DB ngoài. Không có mật khẩu/token: bí mật nằm trên thiết bị. */
export interface Connection {
  id: string;
  type: ConnectionType;
  host?: string;
  port?: number;
  database?: string;
  schema?: string;
  user?: string;
  url?: string;
  org?: string;
  bucket?: string;
  tls?: TlsMode;
  timeZone?: string;
}

export interface LoggingConfig {
  schemaVersion: string;
  timeZone?: string;
  groups: LoggingGroup[];
  connections?: Connection[];
}

export interface TagDefinition {
  id: string;
  type: TagDataType;
  description?: string;
  unit?: string;
  min?: number;
  max?: number;
  source: { kind: 'mock'; signal: string };
}

export interface TagList {
  schemaVersion: string;
  tags: TagDefinition[];
}

export interface ElementRef {
  elementUid: string;
  name?: string;
  kind?: 'shape' | 'group' | 'text';
}

export interface Screen {
  schemaVersion: string;
  id: string;
  name: string;
  svgFile: string;
  viewBox: [number, number, number, number];
  fitMode: 'contain' | 'cover' | 'stretch';
  background?: string;
  bindingFile: string;
  elements: ElementRef[];
}

export const SUPPORTED_TARGETS = [
  'style.fill',
  'style.stroke',
  'style.opacity',
  'style.visibility',
  'text.content',
  'transform.rotate',
  'geometry.levelPercent',
] as const;
export type SupportedTarget = (typeof SUPPORTED_TARGETS)[number];
export type BindingTarget =
  | SupportedTarget
  | 'transform.translateX'
  | 'transform.translateY'
  | 'transform.scale'
  | 'component.state';

export type Transform =
  | { kind: 'direct' }
  | { kind: 'discreteMap'; cases: Array<{ equals: Scalar; value: Scalar }>; default?: Scalar }
  | {
      kind: 'linearScale';
      inMin: number;
      inMax: number;
      outMin: number;
      outMax: number;
      clamp?: boolean;
    };

export interface Binding {
  id: string;
  target: BindingTarget;
  source: { type: 'tag'; tagId: string };
  transform: Transform;
  onBadQuality?: { mode: 'hold' | 'override'; value?: Scalar };
  animation?: 'spin';
  direction?: 'up' | 'down' | 'left' | 'right';
  format?: { decimals?: number; suffix?: string };
}

export interface ElementBindings {
  elementUid: string;
  bindings: Binding[];
}

export interface BindingSet {
  schemaVersion: string;
  screenId: string;
  elements: ElementBindings[];
}

export interface LoadedScreen {
  screen: Screen;
  bindings: BindingSet;
}

export interface LoadedProject {
  project: Project;
  tags: TagList;
  screens: Record<string, LoadedScreen>;
  /** Có khi project khai báo `loggingFile`. */
  logging?: LoggingConfig;
}
