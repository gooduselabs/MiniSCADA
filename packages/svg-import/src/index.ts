// @mat/svg-import: nhập SVG (chỉ Studio, CLI, test; không vào gói của trang runtime). Contract:
// specs/008-svg-import-binding/contracts/svg-import.md. `matchSvg`/`applyMatch` (nhập lại) do T099 thêm.
export { importSvg, assertAllowlisted } from './import.ts';
export { optimizeSvg } from './optimize.ts';
export type { OptimizeResult } from './optimize.ts';
export { writeSvg } from './write.ts';
export { prescan } from './prescan.ts';
export type { PrescanResult } from './prescan.ts';
export { parseXml } from './dom.ts';
export { parseStylesheet, applyCss } from './css.ts';
export { normalizePre, normalizePost } from './normalize.ts';
export { assignUids, isBindable, makeCryptoUid, makeSeededUid } from './uid.ts';
export { deriveName, isMeaninglessId, decodeIdEscapes } from './name.ts';
export { ReportBuilder, reportToMarkdown, sha256Hex, fileNameOf } from './report.ts';
export { VI_IMPORT, viMessage } from './i18n/vi-import.ts';
export { DEFAULT_IMPORT_LIMITS } from './types.ts';
export type {
  ElementInfo,
  ImportErrorCode,
  ImportLimits,
  ImportOptions,
  ImportReport,
  ImportResult,
  MatchResult,
  RemovedKind,
} from './types.ts';
