// Cửa sổ dữ liệu của biểu đồ đường (FR-029, research R11, ADR-020): bộ đệm vòng cố định, thuần TS, không biết
// uPlot hay Tag. Thời điểm tính bằng ms UTC đầu vào, xuất ra giây cho uPlot.

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

  /** Ghi một mẫu cho mọi đường tại t (ms). Mẫu cũ hơn mẫu cuối bị bỏ; bằng thì ghi đè mẫu cuối. */
  sample(t: number, values: ReadonlyArray<number | null>): void {
    if (this.#count > 0) {
      const li = this.#lastIndex();
      const last = this.#t[li]!;
      if (t < last) return;
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
