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
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type WarningCode = 'W_UID_NOT_IN_SVG';

export interface Issue {
  code: ErrorCode | WarningCode;
  file: string;
  path: string; // JSON Pointer ("" = cả file)
  message: string;
}

/** Phiên bản runtime mà bộ kiểm tra này đại diện (so với `minRuntimeVersion`). */
export const RUNTIME_VERSION = '0.2.0';
/** v0: chấp nhận đúng 0.1.x (MAJOR = 0 nên MINOR cũng phải khớp, ADR-004). */
export const SUPPORTED_SCHEMA = /^0\.1\.\d+(-[0-9A-Za-z.-]+)?$/;
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_CLIENTS_LIMIT = 10;
/** Kiểm trước khi parse/so pattern, giống hệt bản C++ (review M1, M3). */
export const MAX_JSON_DEPTH = 64;
export const MAX_STRING_BYTES = 1024;
