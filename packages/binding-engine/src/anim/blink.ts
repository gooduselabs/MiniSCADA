// Nhấp nháy bằng Web Animations (contract binding-animation §4.5, research R11): hai trạng thái, chung pha.

/** Hai trạng thái bật/tắt gọn. (`steps(1, jump-none)` của contract không hợp lệ: jump-none cần ≥ 2 bước.) */
export const BLINK_EASING = 'steps(2, jump-none)';
export const DEFAULT_BLINK_PERIOD = 1000;
export const DEFAULT_MIN_OPACITY = 0.2;

export type BlinkMode = 'opacity' | 'fill' | 'stroke';

/** Pha chung: bội nguyên của `period` theo đồng hồ trang, làm tròn xuống. */
export function blinkStartTime(now: number, period: number): number {
  return Math.floor(now / period) * period;
}

/** Khung hình: trạng thái "bật" trước, "tắt" sau. `base` = giá trị hiện tại của fill/stroke. */
export function blinkKeyframes(
  mode: BlinkMode,
  minOpacity: number,
  color: string | undefined,
  base: string,
): Array<Record<string, string>> {
  if (mode === 'opacity') return [{ opacity: '1' }, { opacity: String(minOpacity) }];
  return [{ [mode]: base }, { [mode]: color ?? base }];
}

/** Giá trị tĩnh của trạng thái "bật" khi giảm chuyển động. */
export function blinkStaticOn(mode: BlinkMode, color: string | undefined): [string, string] {
  return mode === 'opacity' ? ['opacity', '1'] : [mode, color ?? 'currentColor'];
}
