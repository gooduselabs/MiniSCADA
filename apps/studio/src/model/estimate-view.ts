// Mô hình hiển thị của khung Ước tính ghi (feature 010, FR-047; contracts/studio-010.md §1.2): lấy số từ
// `estimateLogging` của @mat/project-schema (cùng hàm với bộ kiểm tra và bản C++, Constitution II; Studio không có công
// thức riêng) và dựng mức (xanh/vàng/cam/đỏ), thanh, bảng nhóm, cảnh báo, gợi ý. Hàm thuần.
import {
  estimateLogging,
  LOG_BUDGET_BYTES,
  LOG_EXTREME_BYTES,
  type LoggingConfig,
  type LoggingEstimate,
  type TagDataType,
  type WarningCode,
} from '@mat/project-schema';

export type Level = 'ok' | 'warn' | 'hot' | 'extreme';
export type Basis = 'exact' | 'expected' | 'upper';
export type Suggestion = 'raiseInterval' | 'useCombined' | 'fewerTags' | 'setExpected';

export interface GroupView {
  id: string;
  name: string;
  basis: Basis;
  rawBytes: number;
  aggBytes: number;
  totalBytes: number;
  rowsPerDay: number;
}

export type EstimateView =
  | { state: 'blocked' }
  | { state: 'noTags' }
  | {
      state: 'ok';
      estimate: LoggingEstimate;
      bytesPerDay: number;
      /** % của ngân sách 2 GiB/ngày. */
      percent: number;
      level: Level;
      storagePercent: number;
      daysToFillCap: number | null;
      groups: GroupView[];
      warnings: WarningCode[];
      topGroup: GroupView | null;
      suggestions: Suggestion[];
      /** Số Tag chưa tính được (không có kiểu trong danh sách Tag). */
      unknownTags: number;
    };

/** Mức theo tỉ lệ so với ngân sách ghi: < 50 % xanh, 50–100 % vàng, > 100 % cam, > 400 % đỏ ("cực lớn"). */
export function levelOf(bytesPerDay: number): Level {
  if (bytesPerDay > LOG_EXTREME_BYTES) return 'extreme';
  if (bytesPerDay > LOG_BUDGET_BYTES) return 'hot';
  if (bytesPerDay >= LOG_BUDGET_BYTES * 0.5) return 'warn';
  return 'ok';
}

const isGroupsArray = (v: unknown): v is LoggingConfig['groups'] => Array.isArray(v);

/**
 * Ước tính cho cấu hình đang sửa. `null` ở đầu vào (chưa có file hay hình dạng sai): `blocked`; chưa có danh sách kiểu
 * Tag: `noTags`. Giống bộ kiểm tra: lỗi hình dạng không ném ra ngoài.
 */
export function estimateView(
  cfg: LoggingConfig | null,
  types: ReadonlyMap<string, TagDataType> | null,
): EstimateView {
  if (!cfg || !isGroupsArray(cfg.groups)) return { state: 'blocked' };
  if (!types) return { state: 'noTags' };
  let estimate: LoggingEstimate;
  try {
    estimate = estimateLogging(cfg, types as Map<string, TagDataType>);
  } catch {
    return { state: 'blocked' };
  }
  if (!Number.isFinite(estimate.writeBytesPerDay) || !Number.isFinite(estimate.storageBytes))
    return { state: 'blocked' };
  const groups: GroupView[] = cfg.groups.map((g, i) => {
    const e = estimate.groups[i]!;
    return {
      id: g.id,
      name: g.name,
      basis: e.basis,
      rawBytes: e.rawWrite,
      aggBytes: e.aggWrite,
      totalBytes: e.rawWrite + e.aggWrite,
      rowsPerDay: e.rowsPerDay,
    };
  });
  let topGroup: GroupView | null = null;
  for (const g of groups) if (!topGroup || g.totalBytes > topGroup.totalBytes) topGroup = g;
  const unknown = new Set<string>();
  let unknownTags = 0;
  for (const g of cfg.groups)
    for (const t of g.tags ?? []) {
      if (!types.has(t.tagId) && !unknown.has(`${g.id}\u0000${t.tagId}`)) {
        unknown.add(`${g.id}\u0000${t.tagId}`);
        unknownTags++;
      }
    }
  const suggestions: Suggestion[] = [];
  if (estimate.warnings.some((w) => w === 'W_LOG_WRITE_BUDGET' || w === 'W_LOG_WRITE_EXTREME')) {
    suggestions.push('raiseInterval');
    if (cfg.groups.some((g) => g.mode === 'onChange' && g.maxIntervalMs === undefined))
      suggestions.push('useCombined');
    suggestions.push('fewerTags');
    if (
      cfg.groups.some(
        (g, i) =>
          (g.mode === 'onChange' || g.mode === 'trigger') && estimate.groups[i]!.basis === 'upper',
      )
    )
      suggestions.push('setExpected');
  } else if (estimate.warnings.includes('W_LOG_SIZE_CAP')) {
    suggestions.push('fewerTags', 'raiseInterval');
  }
  return {
    state: 'ok',
    estimate,
    bytesPerDay: estimate.writeBytesPerDay,
    percent: (estimate.writeBytesPerDay / LOG_BUDGET_BYTES) * 100,
    level: levelOf(estimate.writeBytesPerDay),
    storagePercent: (estimate.storageBytes / LOG_BUDGET_BYTES) * 100,
    daysToFillCap: estimate.daysToFillCap,
    groups,
    warnings: estimate.warnings,
    topGroup,
    suggestions,
    unknownTags,
  };
}
