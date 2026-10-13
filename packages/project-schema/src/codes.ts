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
  // feature 008: định dạng 0.4 (specs/008-svg-import-binding/contracts/project-format-0.4.md §6)
  'E_BIND_TRANSFORM',
  'E_BIND_PARAM',
  'E_RANGE',
  'E_EVENT_ACTION',
  'E_EVENT_TAG',
  'E_EVENT_TARGET',
  'E_EVENT_CONFIRM',
  'E_EVENT_MINROLE',
  /** Chỉ bản TS (cần nội dung SVG; core/ không parse SVG, Constitution II). */
  'E_SVG_UNSAFE',
  /** Chỉ bản TS. */
  'E_SVG_LIMIT',
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
  // feature 008 (contracts/project-format-0.4.md §6); W_SVG_*, W_BIND_ELEMENT_KIND, W_BIND_CLIP_EXISTS: chỉ bản TS
  | 'W_ANIM_MANY'
  | 'W_BLINK_ONLY'
  | 'W_EVENT_CONFIRM_NONE'
  | 'W_EVENT_PULSE_READBACK'
  | 'W_SVG_HEAVY'
  | 'W_BIND_ELEMENT_KIND'
  | 'W_BIND_CLIP_EXISTS';

export interface Issue {
  code: ErrorCode | WarningCode;
  file: string;
  path: string; // JSON Pointer ("" = cả file)
  message: string;
  /** Lỗi trong biểu thức: [đầu, cuối) theo ký tự Unicode trong chuỗi `expression` (định dạng 0.2). */
  span?: [number, number];
}

/** Phiên bản runtime mà bộ kiểm tra này đại diện (so với `minRuntimeVersion`). */
export const RUNTIME_VERSION = '0.7.0';
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
/** Định dạng 0.4 (feature 008): mọi file bằng đúng `project.json.schemaVersion`, khớp mẫu này. */
export const SUPPORTED_SCHEMA_04 = /^0\.4\.\d+$/;
/** Runtime tối thiểu của project 0.4 (E_MIN_RUNTIME). */
export const MIN_RUNTIME_04 = '0.7.0';
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
