// Hình học biểu đồ tròn/donut (FR-030, research R11): tổng các phần tử số ≥ 0 và hợp lệ; âm hoặc BAD bị loại khỏi
// tổng và có lý do để widget đánh dấu. Tổng 0 là trạng thái rỗng (không chia cho 0). Thuần.
export interface PieSlice {
  index: number;
  value: number | null;
  included: boolean;
  reason?: 'negative' | 'bad';
  fraction: number;
  /** Góc theta (0 = hướng lên, chiều kim đồng hồ). */
  startDeg: number;
  endDeg: number;
}

export interface PieResult {
  total: number;
  empty: boolean;
  slices: PieSlice[];
}

export function pieSlices(values: ReadonlyArray<number | null>): PieResult {
  const ok = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;
  const total = values.reduce<number>((a, v) => (ok(v) ? a + v : a), 0);
  let acc = 0;
  const slices = values.map((value, index): PieSlice => {
    if (!ok(value)) {
      const reason = value !== null && Number.isFinite(value) ? 'negative' : 'bad';
      const at = total > 0 ? (acc / total) * 360 : 0;
      return {
        index,
        value: value !== null && Number.isFinite(value) ? value : null,
        included: false,
        reason,
        fraction: 0,
        startDeg: at,
        endDeg: at,
      };
    }
    const start = total > 0 ? (acc / total) * 360 : 0;
    acc += value;
    const end = total > 0 ? (acc / total) * 360 : 0;
    return {
      index,
      value,
      included: true,
      fraction: total > 0 ? value / total : 0,
      startDeg: start,
      endDeg: end,
    };
  });
  return { total, empty: total === 0, slices };
}
