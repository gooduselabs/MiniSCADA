// Hình học biểu đồ cột (FR-030, ADR-020): thuần. Từ feature 012 widgets/bar.ts vẽ bằng ECharts và chỉ dùng resolveScale
// (thang trục giá trị giữ nguyên ý nghĩa của min/max); barLayout giữ cho test hình học.
export interface BarArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bar {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  value: number | null;
}

export interface BarLayout {
  min: number;
  max: number;
  /** Vị trí đường 0: y (dọc) hoặc x (ngang). */
  zero: number;
  bars: Bar[];
}

export interface BarLayoutOptions {
  min?: number;
  max?: number;
  orientation: 'vertical' | 'horizontal';
  area: BarArea;
  /** Tỉ lệ cột trong dải (mặc định 0,6). */
  fill?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Thang tự co từ 0: min = min(0, nhỏ nhất), max = max(0, lớn nhất); suy biến thì max = min + 1. */
export function resolveScale(
  values: ReadonlyArray<number | null>,
  opt: Pick<BarLayoutOptions, 'min' | 'max'>,
): { min: number; max: number } {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  let min = typeof opt.min === 'number' ? opt.min : Math.min(0, ...finite);
  let max = typeof opt.max === 'number' ? opt.max : Math.max(0, ...finite);
  if (!Number.isFinite(min)) min = 0;
  if (!Number.isFinite(max)) max = min + 1;
  if (!(max > min)) max = min + 1;
  return { min, max };
}

export function barLayout(values: ReadonlyArray<number | null>, opt: BarLayoutOptions): BarLayout {
  const { min, max } = resolveScale(values, opt);
  const { area } = opt;
  const vertical = opt.orientation === 'vertical';
  const fill = opt.fill ?? 0.6;
  const n = values.length;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const along = vertical ? area.height : area.width;
  const pos = (v: number): number => {
    const f = (clamp(v) - min) / (max - min);
    return vertical ? area.y + area.height - f * along : area.x + f * along;
  };
  const zero = pos(0);
  const band = n > 0 ? (vertical ? area.width : area.height) / n : 0;
  const thick = band * fill;
  const bars: Bar[] = values.map((value, index) => {
    const off = (vertical ? area.x : area.y) + band * index + (band - thick) / 2;
    const p = value !== null && Number.isFinite(value) ? pos(value) : zero;
    const lo = Math.min(p, zero);
    const len = Math.abs(p - zero);
    const v = value !== null && Number.isFinite(value) ? value : null;
    return vertical
      ? { index, x: r2(off), y: r2(lo), width: r2(thick), height: r2(len), value: v }
      : { index, x: r2(lo), y: r2(off), width: r2(len), height: r2(thick), value: v };
  });
  return { min, max, zero: r2(zero), bars };
}
