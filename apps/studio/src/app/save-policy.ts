// Khi nào Studio cho lưu và cho đóng gói, nạp xuống (feature 004, FR-023). Lưu luôn được, kể cả khi
// project còn lỗi hoặc cảnh báo: lưu việc làm dở không nguy hiểm vì thiết bị và bước nạp xuống vẫn chặn
// project lỗi (Constitution V). Vì vậy không còn hàm "được lưu không" (lệnh Lưu chỉ cần có thay đổi);
// quy tắc cũ (FR-033 của Sprint 1, FR-024 của feature 003) chặn lưu khi còn lỗi hoặc cảnh báo UID.
// Khi còn lỗi, Studio nói rõ thiết bị sẽ từ chối project (checkSummary, saveNotice) và khóa đóng gói,
// nạp xuống (canPackage).
import { t, type MessageKey } from '../i18n/index.ts';

interface Coded {
  code: string;
}

/** Số lỗi; cảnh báo (mã W_) không tính. Cùng quy tắc với severityOf (issue-map.ts) và thanh trạng thái. */
export const errorCount = (issues: readonly Coded[]): number =>
  issues.filter((i) => !i.code.startsWith('W_')).length;

/**
 * Đóng gói hoặc nạp xuống: `true`, hoặc khóa i18n của lý do bị khóa ("Project còn lỗi"), cùng dạng với
 * điều kiện bật của lệnh (commands.ts). Cảnh báo không chặn.
 */
export function canPackage(issues: readonly Coded[]): true | MessageKey {
  return errorCount(issues) > 0 ? 'reason.projectErrors' : true;
}

/** Câu tóm tắt kết quả kiểm: còn lỗi thì nói thiết bị sẽ từ chối project. */
export function checkSummary(issues: readonly Coded[]): string {
  const errors = errorCount(issues);
  if (errors > 0) return t('policy.errors', { n: errors });
  const warnings = issues.length - errors;
  return warnings > 0 ? t('policy.warnings', { n: warnings }) : t('policy.valid');
}

/** Thông báo sau khi lưu: các file đã ghi; còn lỗi thì kèm câu "còn N lỗi: thiết bị sẽ từ chối…". */
export function saveNotice(files: readonly string[], issues: readonly Coded[]): string {
  const list = files.join(', ');
  const errors = errorCount(issues);
  return errors > 0
    ? t('toast.savedWithErrors', { files: list, n: errors })
    : t('toast.saved', { files: list });
}
