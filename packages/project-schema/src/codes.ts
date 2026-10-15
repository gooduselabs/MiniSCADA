// Mã lỗi dùng chung TS ↔ C++ (specs/002-vertical-slice/contracts/project-format.md).
// Contract là tập mã; câu chữ `message` có thể khác giữa hai bản.

export const ERROR_CODES = [
  'E_JSON',
  'E_SCHEMA',
  'E_SCHEMA_VERSION',
  'E_RUNTIME_TOO_OLD',
  'E_FILE_MISSING',
  'E_PATH',
  'E_SCREEN_ID',
  'E_DUP_TAG',
  'E_TAG_RANGE',
  'E_DUP_UID',
  'E_DUP_BINDING',
  'E_REF_UID',
  'E_REF_TAG',
  'E_TARGET_UNSUPPORTED',
  'E_TRANSFORM_UNSUPPORTED',
  'E_TYPE_MISMATCH',
  'E_SCALE_RANGE',
  'E_MAX_CLIENTS',
  'E_SCREEN_TAGS',
  // feature 003: logging.json (specs/003-data-logging/contracts/logging-config.md)
  'E_LOG_SECRET',
  'E_LOG_DUP_ID',
  'E_LOG_REF_TAG',
  'E_LOG_DUP_TAG',
  'E_LOG_REF_DEST',
  'E_LOG_COLUMN',
  'E_LOG_TABLE',
  'E_LOG_DEADBAND',
  'E_LOG_MAXLEN',
  'E_LOG_MODE',
  'E_LOG_LIMIT',
  'E_LOG_CONN',
  'E_LOG_TLS',
  // feature 006: định dạng 0.2 (specs/006-tags-modbus/contracts/project-format-0.2.md §7.1)
  'E_MIN_RUNTIME',
  'E_LIMIT',
  'E_DUP_ID',
  'E_REF_DEVICE',
  'E_REF_TABLE',
  'E_ADDR_SYNTAX',
  'E_ADDR_AREA',
  'E_ADDR_RANGE',
  'E_ADDR_READ_LIMIT',
  'E_ADDR_WRITE_LIMIT',
  'E_BIT_WRITE',
  'E_SCALING',
  'E_DEADBAND',
  'E_LIMITS',
  'E_TAG_ACCESS',
  'E_SIM',
  'E_INITIAL',
  'E_RETAIN',
  'E_EXPR_SYNTAX',
  'E_EXPR_UNKNOWN_TAG',
  'E_EXPR_UNKNOWN_TABLE',
  'E_EXPR_UNKNOWN_FUNC',
  'E_EXPR_ARITY',
  'E_EXPR_TYPE',
  'E_EXPR_CYCLE',
  'E_EXPR_DEPTH',
  'E_EXPR_LIMIT',
  'E_VT_OVERLAP',
  'E_VT_RANGE',
  'E_VT_TEXT',
  'E_SERIAL_PORT',
  'E_SERIAL_SHARED',
  /** Chỉ có khi validator được đưa một SerialPolicy (luật của thiết bị, không có trong vector chung). */
  'E_SERIAL_NOT_ALLOWED',
  // feature 007: định dạng 0.3 (specs/007-screens-widgets/contracts/project-format-0.3.md §7.1)
  'E_SCREEN_SIZE',
  'E_SCREEN_KIND',
  'E_ITEM_ID',
  'E_ITEM_SIZE',
  'E_WIDGET_UNKNOWN',
  'E_WIDGET_SLOT',
  'E_WIDGET_PROP',
  'E_WIDGET_TAG_TYPE',
  'E_WIDGET_LIMITS',
  'E_WIDGET_MINROLE',
  'E_WIDGET_CONFIRM',
  'E_ACTION',
  'E_ACTION_TARGET',
  'E_NAV',
  // feature 009: định dạng 0.5 (specs/009-alarms/contracts/project-format-0.5.md §5.1)
  'E_ALARM_ID_DUP',
  'E_ALARM_ID_FORMAT',
  'E_ALARM_TYPE',
  'E_ALARM_TAG_REF',
  'E_ALARM_TAG_TYPE',
  'E_ALARM_DEVICE_REF',
  'E_ALARM_CLASS_REF',
  'E_ALARM_AREA_REF',
  'E_ALARM_TRIGGER',
  'E_ALARM_ON',
  'E_ALARM_LIMIT_NONE',
  'E_ALARM_LIMIT_ORDER',
  'E_ALARM_DEADBAND',
  'E_ALARM_DELAY_RANGE',
  'E_ALARM_TEXT_LEN',
  'E_ALARM_TEXT_TOKEN',
  'E_ALARM_FIELD',
  'E_ALARM_COUNT',
  'E_ALARM_CLASS_DUP',
  'E_ALARM_CLASS_FIELD',
  'E_ALARM_AREA_DUP',
  'E_ALARM_AREA_COUNT',
  'E_ALARM_CLASS_COUNT',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
/**
 * W_LOG_*: ước tính ghi/dung lượng vượt ngân sách; kết nối không xác thực máy chủ. Không chặn lưu
 * hay kích hoạt (FR-024).
 */
export type WarningCode =
  | 'W_UID_NOT_IN_SVG'
  | 'W_LOG_WRITE_BUDGET'
  | 'W_LOG_SIZE_CAP'
  | 'W_LOG_TLS_UNVERIFIED'
  // feature 006 (contracts/project-format-0.2.md §7.2)
  | 'W_WRITE_NO_LIMITS'
  | 'W_DETECT_SLOW'
  | 'W_RTU_SCAN_TIME'
  | 'W_BIT_RMW'
  | 'W_EXPR_INT64'
  | 'W_WATCH_REF'
  | 'W_ADDR_MODICON_BASE0'
  // feature 007 (contracts/project-format-0.3.md §7.2)
  | 'W_ITEM_OUTSIDE'
  | 'W_SCREEN_EMPTY'
  | 'W_STRETCH_WIDGETS'
  | 'W_CONFIRM_NONE'
  | 'W_PULSE_READBACK'
  | 'W_ACTION_NOOP'
  | 'W_SCREEN_TAGS_MANY'
  | 'W_ITEM_COVERED'
  // feature 009 (contracts/project-format-0.5.md §5.2)
  | 'W_ALARM_COUNT_HIGH'
  | 'W_ALARM_NO_ACK_CRITICAL'
  | 'W_ALARM_CHATTER_RISK'
  | 'W_ALARM_DEVICE_EMPTY'
  // feature 009, danh mục widget 0.4.0 (contracts/ui-alarm.md §13.3)
  | 'W_WIDGET_ALARM_REF';

export interface Issue {
  code: ErrorCode | WarningCode;
  file: string;
  path: string; // JSON Pointer ("" = cả file)
  message: string;
  /** Lỗi trong biểu thức: [đầu, cuối) theo ký tự Unicode trong chuỗi `expression` (định dạng 0.2). */
  span?: [number, number];
}

/** Phiên bản runtime mà bộ kiểm tra này đại diện (so với `minRuntimeVersion`). */
export const RUNTIME_VERSION = '0.8.0';
/** v0: chấp nhận đúng 0.1.x, không hậu tố pre-release (MAJOR = 0 nên MINOR cũng phải khớp, ADR-004). */
export const SUPPORTED_SCHEMA = /^0\.1\.\d+$/;
/** Định dạng 0.2: mọi file bằng đúng `project.json.schemaVersion`, khớp mẫu này. */
export const SUPPORTED_SCHEMA_02 = /^0\.2\.\d+$/;
/** Runtime tối thiểu của project 0.2 (E_MIN_RUNTIME). */
export const MIN_RUNTIME_02 = '0.5.0';
/** Định dạng 0.3: mọi file bằng đúng `project.json.schemaVersion`, khớp mẫu này. */
export const SUPPORTED_SCHEMA_03 = /^0\.3\.\d+$/;
/** Runtime tối thiểu của project 0.3 (E_MIN_RUNTIME). */
export const MIN_RUNTIME_03 = '0.6.0';
/**
 * Định dạng 0.4 (feature 008, bản tối thiểu của nhánh 009: chỉ đổi số phiên bản so với 0.3) và 0.5 (feature 009):
 * mọi file bằng đúng `project.json.schemaVersion`.
 */
export const SUPPORTED_SCHEMA_04 = /^0\.4\.\d+$/;
export const SUPPORTED_SCHEMA_05 = /^0\.5\.\d+$/;
/** Runtime tối thiểu của project 0.4 và 0.5 (E_MIN_RUNTIME). */
export const MIN_RUNTIME_04 = '0.7.0';
export const MIN_RUNTIME_05 = '0.8.0';
/** Số Tag riêng biệt trên một màn hình (kèm popup nó mở) từ đó cảnh báo W_SCREEN_TAGS_MANY. */
export const WARN_SCREEN_TAGS = 500;
/** Trần file JSON của project. */
export const MAX_FILE_BYTES = 1024 * 1024;
/** Trần SVG mà Studio/CLI đọc (ADR-003). Bản C++ chỉ kiểm SVG có tồn tại, không đọc nội dung. */
export const MAX_SVG_BYTES = 5 * 1024 * 1024;
export const MAX_CLIENTS_LIMIT = 10;
/** Số Tag khác nhau tối đa trên một màn hình: một subscribe của giao thức live (live-ws.md). */
export const MAX_SCREEN_TAGS = 1000;
/** Kiểm trước khi parse/so pattern, giống hệt bản C++ (review M1, M3). */
export const MAX_JSON_DEPTH = 64;
export const MAX_STRING_BYTES = 1024;
