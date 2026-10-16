// Cửa sổ dữ liệu của biểu đồ đường (FR-029, research R11, ADR-020): bộ đệm vòng cố định, thuần TS, không biết
// uPlot hay Tag. Thời điểm tính bằng ms UTC đầu vào, xuất ra giây cho uPlot.

/**
 * Đồng hồ lùi quá chừng này (ms) so với mẫu cuối thì đặt lại cửa sổ (T041, FR-026, D32): NTP hay chỉnh giờ tay lùi
 * một giờ làm biểu đồ đứng hình một giờ. Lùi nhỏ hơn (lệch giờ giữa nguồn) thì bỏ mẫu như trước.
 */
export const CLOCK_BACK_RESET_MS = 2000;

export interface ChartWindowOptions {
  series: number;
  /** Số mẫu tối đa mỗi đường (3600). */
  capacity: number;
  windowSec: number;
  sampleMs: number;
}

export class ChartWindow {
  readonly series: number;
  readonly capacity: number;
  windowSec: number;
  sampleMs: number;

  readonly #t: Float64Array;
  readonly #y: Float64Array[];
  #head = 0; // vị trí ghi kế tiếp
  #count = 0;

  constructor(opt: ChartWindowOptions) {
    this.series = opt.series;
    this.capacity = opt.capacity;
    this.windowSec = opt.windowSec;
    this.sampleMs = opt.sampleMs;
    this.#t = new Float64Array(opt.capacity);
    this.#y = Array.from({ length: opt.series }, () => new Float64Array(opt.capacity));
  }

  get count(): number {
    return this.#count;
  }

  #lastIndex(): number {
    return (this.#head - 1 + this.capacity) % this.capacity;
  }

  #push(t: number, values: ReadonlyArray<number | null> | null): void {
    const i = this.#head;
    this.#t[i] = t;
    for (let s = 0; s < this.series; s++) {
      const v = values ? values[s] : NaN;
      this.#y[s]![i] = v === null || v === undefined || !Number.isFinite(v) ? NaN : v;
    }
    this.#head = (i + 1) % this.capacity;
    if (this.#count < this.capacity) this.#count++;
  }

  /**
   * Ghi một mẫu cho mọi đường tại t (ms). Mẫu cũ hơn mẫu cuối tới `CLOCK_BACK_RESET_MS` bị bỏ; cũ hơn nữa (đồng hồ lùi)
   * thì đặt lại cửa sổ rồi ghi; bằng thì ghi đè mẫu cuối.
   */
  sample(t: number, values: ReadonlyArray<number | null>): void {
    if (this.#count > 0) {
      const li = this.#lastIndex();
      const last = this.#t[li]!;
      if (t < last) {
        if (last - t <= CLOCK_BACK_RESET_MS) return;
        this.reset();
        this.#push(t, values);
        return;
      }
      if (t === last) {
        for (let s = 0; s < this.series; s++) {
          const v = values[s];
          this.#y[s]![li] = v === null || v === undefined || !Number.isFinite(v) ? NaN : v;
        }
        return;
      }
      // Thiếu quá 3 x sampleMs: một điểm NaN ngay sau mẫu cuối để đứt đường (không nội suy).
      if (t - last > 3 * this.sampleMs) this.#push(last + this.sampleMs, null);
    }
    this.#push(t, values);
  }

  /** [x (giây), y0, y1…] cho các mẫu trong [now − windowSec, now]. */
  snapshot(now: number): Float64Array[] {
    const from = now - this.windowSec * 1000;
    const start = (this.#head - this.#count + this.capacity) % this.capacity;
    let n = 0;
    for (let k = 0; k < this.#count; k++) {
      const t = this.#t[(start + k) % this.capacity]!;
      if (t >= from && t <= now) n++;
    }
    const out = [new Float64Array(n), ...this.#y.map(() => new Float64Array(n))];
    let w = 0;
    for (let k = 0; k < this.#count; k++) {
      const i = (start + k) % this.capacity;
      const t = this.#t[i]!;
      if (t < from || t > now) continue;
      out[0]![w] = t / 1000;
      for (let s = 0; s < this.series; s++) out[s + 1]![w] = this.#y[s]![i]!;
      w++;
    }
    return out;
  }

  reset(): void {
    this.#head = 0;
    this.#count = 0;
  }
}
