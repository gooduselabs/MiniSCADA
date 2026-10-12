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
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
/**
 * W_LOG_*: ước tính ghi/dung lượng vượt ngân sách; kết nối không xác thực máy chủ. Không chặn lưu
 * hay kích hoạt (FR-024).
 */
export type WarningCode =
  'W_UID_NOT_IN_SVG' | 'W_LOG_WRITE_BUDGET' | 'W_LOG_SIZE_CAP' | 'W_LOG_TLS_UNVERIFIED';

export interface Issue {
  code: ErrorCode | WarningCode;
  file: string;
  path: string; // JSON Pointer ("" = cả file)
  message: string;
}

/** Phiên bản runtime mà bộ kiểm tra này đại diện (so với `minRuntimeVersion`). */
export const RUNTIME_VERSION = '0.4.0';
/** v0: chấp nhận đúng 0.1.x, không hậu tố pre-release (MAJOR = 0 nên MINOR cũng phải khớp, ADR-004). */
export const SUPPORTED_SCHEMA = /^0\.1\.\d+$/;
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
