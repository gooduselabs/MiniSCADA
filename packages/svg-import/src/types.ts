// Kiểu công khai của @mat/svg-import (contract svg-import §1, §6; data-model §3).

export interface ImportLimits {
  /** Kích thước byte tối đa của file, kiểm trước mọi việc khác. */
  maxBytes: number;
  /** Phần tử tối đa sau chuẩn hóa (và Tối ưu). */
  maxNodes: number;
  maxDepth: number;
  /** Phần tử thô tối đa, trước làm sạch. */
  rawNodeCap: number;
  /** Phần tử hiệu dụng tối đa sau mở `use`. */
  useExpansionCap: number;
  maxFilters: number;
  maxFilterPrimitives: number;
  maxImages: number;
  maxImageBytes: number;
}

export const DEFAULT_IMPORT_LIMITS: Readonly<ImportLimits> = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxNodes: 20_000,
  maxDepth: 32,
  rawNodeCap: 100_000,
  useExpansionCap: 100_000,
  maxFilters: 8,
  maxFilterPrimitives: 64,
  maxImages: 16,
  maxImageBytes: 2 * 1024 * 1024,
});

export type ImportErrorCode =
  | 'E_IMPORT_LIMIT'
  | 'E_IMPORT_PARSE'
  | 'E_IMPORT_ENCODING'
  | 'E_IMPORT_ROOT'
  | 'E_IMPORT_DTD'
  | 'E_IMPORT_USE_BOMB'
  | 'E_IMPORT_SIZE'
  | 'E_IMPORT_EXT';

export interface ImportOptions {
  /** Chỉ để báo cáo. */
  fileName?: string;
  /** Mặc định false (D22). */
  optimize?: boolean;
  /** Bộ sinh UID; mặc định bộ sinh mật mã; test dùng makeSeededUid. */
  uid?: () => string;
  /** Giới hạn tùy chỉnh. Chỉ dùng được giá trị chặt hơn hoặc bằng trong test. */
  limits?: Partial<ImportLimits>;
  /** Nhập lại: bản đang dùng (đã chuẩn hóa). Importer gọi `matchTrees` (match.ts) và trả `match`. */
  previous?: {
    svg: string;
    uids?: ReadonlySet<string>;
    /** UID đang có binding / sự kiện (để báo mồ côi). */
    bound?: ReadonlySet<string>;
    events?: ReadonlySet<string>;
  };
}

export interface ElementInfo {
  uid: string;
  tag: string;
  name: string;
  /** UID của tổ tiên gắn được gần nhất; null nếu ở mức cao nhất. */
  parent: string | null;
  /** Số tổ tiên gắn được. */
  depth: number;
  /** Có khi tên đến từ nhãn (`inkscape:label`, `data-name`, `id` có nghĩa); ghi thành `data-mat-name`. */
  label?: string;
}

export type RemovedKind =
  | 'element'
  | 'attribute'
  | 'css-property'
  | 'css-rule'
  | 'css-at'
  | 'namespace'
  | 'pi'
  | 'dtd'
  | 'image'
  | 'font'
  | 'definition'
  | 'reference';

export interface ImportReport {
  tool: string;
  file: { name: string; bytes: number; sha256: string };
  generator: {
    name: string;
    certainty: 'chắc chắn' | 'có dấu hiệu' | 'không rõ';
    evidence: string[];
  };
  counts: {
    elementsBefore: number;
    elementsAfter: number;
    depth: number;
    uidAssigned: number;
    named: number;
  };
  viewBox: [number, number, number, number] | null;
  removed: Array<{
    kind: RemovedKind;
    name: string;
    count: number;
    code: string;
    reason: string;
    examples: string[];
  }>;
  converted: Array<{ what: string; count: number; code: string; note: string }>;
  warnings: Array<{ code: string; count: number; message: string }>;
  optimize: { enabled: boolean; merged: number; elementsSaved: number };
  fonts: { used: string[]; mapped: Array<{ from: string; to: string }>; fallback: string[] };
  match: null | { kept: number; added: number; ambiguous: number; orphans: number };
}

/** Kết quả đối chiếu nhập lại (T099 cài `matchSvg`); khai báo ở đây để `ImportResult` dùng chung. */
export interface MatchResult {
  pairs: Array<{ newPath: string; oldUid: string; step: 1 | 2 | 3 | 4; d: number }>;
  ambiguous: Array<{ newPath: string; candidates: Array<{
      oldUid: string;
      d: number;
      name: string;
      hasBinding: boolean;
      hasEvent: boolean;
    }> }>;
  added: string[];
  orphans: Array<{ oldUid: string; name: string; hasBinding: boolean; hasEvent: boolean }>;
}

export type ImportResult =
  | {
      ok: true;
      svg: string;
      viewBox: [number, number, number, number];
      elements: ElementInfo[];
      report: ImportReport;
      match?: MatchResult;
    }
  | { ok: false; error: { code: ImportErrorCode; message: string }; report: ImportReport };
