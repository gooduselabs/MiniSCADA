// Dòng chảy trong ống (contract binding-animation §4.6, research R12): `stroke-dashoffset` hoạt ảnh.

export const DEFAULT_DASH = '12 8';
/** Tốc độ gốc của hoạt ảnh (đơn vị/giây); tốc độ thật đặt bằng updatePlaybackRate(s / 60). */
export const BASE_SPEED = 60;

/** Tổng mẫu nét; số phần tử lẻ thì nhân đôi (như SVG). Mẫu hỏng: 20. */
export function dashTotal(dash: string): number {
  const nums = dash
    .split(',')
    .join(' ')
    .split(' ')
    .filter((t) => t !== '')
    .map(Number);
  if (nums.length === 0 || nums.some((n) => !Number.isFinite(n) || n < 0)) return 20;
  const sum = nums.reduce((a, n) => a + n, 0);
  const p = nums.length % 2 === 1 ? sum * 2 : sum;
  return p > 0 ? p : 20;
}

export function flowKeyframes(total: number): Array<{ strokeDashoffset: string }> {
  return [{ strokeDashoffset: '0' }, { strokeDashoffset: String(-total) }];
}

export function flowDuration(total: number): number {
  return (total / BASE_SPEED) * 1000;
}

/** Chiều ngược = `reverse` XOR (`byValueSign` và giá trị < 0). */
export function flowReversed(reverse: boolean, byValueSign: boolean, value: number): boolean {
  return reverse !== (byValueSign && value < 0);
}
