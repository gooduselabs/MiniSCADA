// Câu báo lỗi tiếng Việt cho một lỗi của API quản trị (dùng chung web và Studio, feature 027). `conflict`: câu của 409
// CONFLICT (mỗi giao diện tự nói cách tải lại).
import { AdminApiError } from './api.ts';
import { adminText, weakReason } from './text.ts';

export function adminErrorText(e: unknown, conflict: string): string {
  const E = adminText.errors;
  if (!(e instanceof AdminApiError))
    return E.unknown('ERROR', e instanceof Error ? e.message : String(e));
  const known = (E as Record<string, unknown>)[e.code];
  if (e.code === 'WEAK_PASSWORD')
    return `${E.weak}${weakReason(e.reason, e.message !== e.code ? e.message : undefined)}`;
  if (typeof known === 'string') return known;
  if (e.code === 'CONFLICT') return conflict;
  return E.unknown(e.code, e.message !== e.code ? e.message : undefined);
}
