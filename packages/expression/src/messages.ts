// Thông báo lỗi tiếng Anh (package dùng chung: không có chuỗi tiếng Việt; Studio dịch theo mã ở i18n).
const MESSAGES: Readonly<Record<string, string>> = {
  E_EXPR_SYNTAX: 'syntax error',
  E_EXPR_UNKNOWN_TAG: 'unknown tag',
  E_EXPR_UNKNOWN_TABLE: 'unknown value table',
  E_EXPR_UNKNOWN_FUNC: 'unknown function',
  E_EXPR_ARITY: 'wrong number of arguments',
  E_EXPR_TYPE: 'type mismatch',
  E_EXPR_LIMIT: 'expression limit exceeded',
  E_EXPR_CYCLE: 'circular reference between calculated tags',
  E_EXPR_DEPTH: 'dependency chain deeper than 16 levels',
  W_EXPR_INT64: 'INT64/UINT64 inputs lose precision beyond 2^53',
};

export function messageOf(code: string): string {
  return MESSAGES[code] ?? code;
}
