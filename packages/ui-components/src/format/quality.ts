// Quy tắc hiển thị quality chung cho mọi widget (FR-018): luôn có chữ hoặc biểu tượng, không chỉ màu.
import { qualityReasonText, vi } from '../i18n/vi.ts';
import type { Quality, TagState } from '../host/types.ts';

export interface QualityView {
  /** Lớp CSS: q-good, q-uncertain, q-bad, q-stale, q-unknown. */
  cls: string;
  /** Nhãn ngắn ("BAD", "STALE", "?", "●"); rỗng khi GOOD. */
  badge: string;
  tooltip: string;
  /** Giá trị mờ (BAD, STALE). */
  dim: boolean;
  /** Tag lạ: widget điều khiển khóa. */
  locked: boolean;
  /** Chữ cho trình đọc màn hình (rỗng khi GOOD). */
  aria: string;
}

const CLS: Record<Quality, string> = {
  GOOD: 'q-good',
  UNCERTAIN: 'q-uncertain',
  BAD: 'q-bad',
  STALE: 'q-stale',
  UNKNOWN: 'q-unknown',
};

/** `mode` giữ cho tương lai (Studio có thể ẩn nhãn khi chưa có mô phỏng); hiện hai chế độ như nhau. */
export function qualityView(state: TagState, mode: 'run' | 'edit' = 'run'): QualityView {
  void mode;
  const q = state.quality;
  const base = vi.quality[q];
  const tooltip = state.reason
    ? `${base}: ${qualityReasonText(state.reason)}`
    : q === 'GOOD'
      ? ''
      : base;
  return {
    cls: CLS[q],
    badge: vi.qualityBadge[q],
    tooltip,
    dim: q === 'BAD' || q === 'STALE',
    locked: q === 'UNKNOWN',
    aria: q === 'GOOD' ? '' : q === 'BAD' || q === 'STALE' ? q : base,
  };
}
