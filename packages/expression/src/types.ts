// Kiểu dùng chung của @mat/expression (contract expression-language §9, value-tables-simulation §1).
// Thông báo lỗi của package là mã + tiếng Anh; chuỗi tiếng Việt chỉ nằm ở apps/studio/src/i18n.

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

export type Quality = 'GOOD' | 'UNCERTAIN' | 'BAD';

/** Kiểu của biểu thức (contract §3). */
export type ExprType = 'number' | 'bool' | 'string';

export interface ExprIssue {
  code: string;
  /** [đầu, cuối): chỉ số ký tự Unicode (code point) trong chuỗi biểu thức. */
  span: [number, number];
  message: string;
}

export interface CompileEnv {
  /** undefined: Tag không có. */
  tagType(id: string): TagDataType | undefined;
  hasTable(name: string): boolean;
  /** Kiểu của Tag tính toán nhận kết quả. */
  target: TagDataType;
}

/** Giá trị một đầu vào lúc chạy. Số nguyên 64 bit đưa vào dạng số thực 64 bit (contract §4). */
export interface InputValue {
  value: number | boolean | string | null;
  quality: Quality;
  reason?: string;
}

export interface EvalResult {
  quality: Quality;
  /** Có khi quality khác GOOD. */
  reason?: string;
  /** Không có khi BAD (Tag giữ giá trị cuối). Kiểu INT64/UINT64 là bigint, số khác là number. */
  value?: number | boolean | string | bigint;
}

export interface Program {
  readonly ops: readonly number[];
  readonly consts: readonly (number | string)[];
  /** Id Tag đầu vào theo thứ tự xuất hiện đầu tiên (chỉ số dùng trong evaluate). */
  readonly inputs: readonly string[];
  /** Tên bảng giá trị dùng bởi text(). */
  readonly tables: readonly string[];
  readonly target: TagDataType;
  readonly maxStack: number;
}

export type CompileResult =
  | { ok: true; program: Program; inputs: string[]; warnings: ExprIssue[] }
  | { ok: false; errors: ExprIssue[] };

export interface VtEntry {
  value?: number | boolean;
  from?: number;
  to?: number;
  text: string;
  color?: string;
}

export interface ValueTable {
  name?: string;
  description?: string;
  entries: VtEntry[];
  default?: { text?: string; color?: string };
}

export type TableSet = ReadonlyMap<string, ValueTable>;

export interface LookupResult {
  text: string;
  color: string | null;
  /** Chỉ số mục, "default" hoặc null. */
  entry: number | 'default' | null;
}

export type TokenKind =
  | 'number'
  | 'string'
  | 'tag'
  | 'function'
  | 'table'
  | 'keyword'
  | 'operator'
  | 'punctuation'
  | 'error';

export interface Token {
  kind: TokenKind;
  span: [number, number];
  text: string;
}
