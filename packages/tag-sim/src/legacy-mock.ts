// Bản port TS của MockTagProvider (generator `legacy`, T029; drivers/simulation/mock_tag_provider.cpp; contract
// value-tables-simulation §2.4): cùng thuật toán và hằng số với runtime 0.4, dùng `Math.sin` như bản gốc (khớp
// `tests/sim-vectors/legacy.json` trong sai số tuyệt đối 1e-9, không cần giống từng bit như các bộ sinh khác).
// Xem trước màn hình của project 0.1 đã nâng cấp (Tag `sim.kind = legacy`) và Mô phỏng của Studio dùng bản này.
//
// - bể + bơm: bơm chạy thì bể đầy, ≥ 90 % thì bơm dừng, ≤ 10 % thì bơm chạy (chu kỳ ~60 s);
// - `tank.temp` BAD `DISCONNECTED` trong 5 s của mỗi cửa sổ 20 s (vẫn mang giá trị tính được);
// - tải tùy chọn: mỗi Tag của `simTags` đổi 1 lần mỗi giây dù bước là bao nhiêu;
// - tín hiệu lạ: BAD `NO_SIGNAL`, không có giá trị.
// Thời gian tính từ lần `step` đầu tiên (lúc bật Mô phỏng), không từ đồng hồ tuyệt đối.

export interface LegacyBound {
  /** Chỉ số Tag do bên gọi đặt; trả lại nguyên trong `LegacyUpdate.tag`. */
  tag: number;
  /** tank.level, motor.run, motor.speed, tank.inflow, tank.temp; khác: BAD NO_SIGNAL. */
  signal: string;
}

export interface LegacyUpdate {
  tag: number;
  /** `null`: chưa có giá trị (tín hiệu lạ). */
  value: number | boolean | null;
  quality: 'GOOD' | 'BAD';
  reason?: string;
  sourceTs: number;
}

const FILL_RATE = 80 / 30; // %/s khi bơm chạy: 10 → 90 % trong 30 s
const DRAIN_RATE = 80 / 30; // %/s khi bơm dừng: 90 → 10 % trong 30 s
const HIGH = 90;
const LOW = 10;

/** `std::round`: nửa làm tròn ra xa số 0 (khác `Math.round`). */
const roundHalfAway = (x: number): number => {
  const r = Math.trunc(x);
  return Math.abs(x - r) >= 0.5 ? r + Math.sign(x) : r;
};

type Signal = 'level' | 'run' | 'speed' | 'inflow' | 'temp' | 'unknown';
const SIGNALS: Readonly<Record<string, Signal>> = {
  'tank.level': 'level',
  'motor.run': 'run',
  'motor.speed': 'speed',
  'tank.inflow': 'inflow',
  'tank.temp': 'temp',
};

export class LegacyMock {
  private readonly bound: { tag: number; signal: Signal }[];
  private readonly sim: number[];
  private readonly simValue: number[];
  private simCursor = 0;
  /** Số lần đổi còn nợ của tải, tính bằng Tag-ms (1000 = một lần đổi). */
  private simBudgetMs = 0;
  private rng = 0x12345678;
  private started = false;
  private t0 = 0;
  private last = 0;
  private level = 50;
  private running = true;

  constructor(bound: readonly LegacyBound[], simTags: readonly number[] = []) {
    this.bound = bound.map((b) => ({ tag: b.tag, signal: SIGNALS[b.signal] ?? 'unknown' }));
    this.sim = [...simTags];
    this.simValue = this.sim.map(() => 50);
  }

  /** Tiến tới `nowMs` (epoch ms) và trả các cập nhật (Tag không đổi vẫn được phát, như runtime 0.4). */
  step(nowMs: number): LegacyUpdate[] {
    const out: LegacyUpdate[] = [];
    if (!this.started) {
      this.started = true;
      this.t0 = this.last = nowMs;
    }
    const dtMs = Math.min(1000, Math.max(0, nowMs - this.last));
    const dt = dtMs / 1000;
    this.last = nowMs;
    const t = (nowMs - this.t0) / 1000;

    // Trễ (hysteresis) quyết định theo mực trước khi tích phân.
    if (this.running && this.level >= HIGH) this.running = false;
    else if (!this.running && this.level <= LOW) this.running = true;
    this.level += (this.running ? FILL_RATE : -DRAIN_RATE) * dt;
    this.level = Math.min(100, Math.max(0, this.level));

    const speed = this.running ? 1450 + 8 * Math.sin((2 * Math.PI * t) / 7) : 0;
    const inflow = this.running ? 12 + 1.5 * Math.sin((2 * Math.PI * t) / 11) : 0;
    const temp = 25 + 2 * Math.sin((2 * Math.PI * t) / 60);
    const tempBad = (nowMs - this.t0) % 20000 >= 15000;
    const good = (tag: number, value: number | boolean): LegacyUpdate => ({
      tag,
      value,
      quality: 'GOOD',
      sourceTs: nowMs,
    });

    for (const b of this.bound) {
      switch (b.signal) {
        case 'level':
          out.push(good(b.tag, roundHalfAway(this.level * 100) / 100));
          break;
        case 'run':
          out.push(good(b.tag, this.running));
          break;
        case 'speed':
          out.push(good(b.tag, roundHalfAway(speed * 10) / 10));
          break;
        case 'inflow':
          out.push(good(b.tag, roundHalfAway(inflow * 100) / 100));
          break;
        case 'temp': {
          const u = good(b.tag, roundHalfAway(temp * 10) / 10);
          if (tempBad) {
            u.quality = 'BAD';
            u.reason = 'DISCONNECTED';
          }
          out.push(u);
          break;
        }
        default:
          out.push({
            tag: b.tag,
            value: null,
            quality: 'BAD',
            reason: 'NO_SIGNAL',
            sourceTs: nowMs,
          });
      }
    }

    // Tải: mỗi Tag đổi một lần mỗi giây dù bước là bao nhiêu; bước ngẫu nhiên không lặp giá trị trước.
    if (this.sim.length && nowMs !== this.t0) {
      this.simBudgetMs += this.sim.length * dtMs;
      const n = Math.min(this.sim.length, Math.floor(this.simBudgetMs / 1000));
      this.simBudgetMs -= n * 1000;
      for (let k = 0; k < n; k++) {
        const j = this.simCursor;
        this.simCursor = (this.simCursor + 1) % this.sim.length;
        this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
        let delta = ((this.rng >>> 8) / 16777216 - 0.5) * 4;
        if (Math.abs(delta) < 0.01) delta = 0.5;
        let v = this.simValue[j] + delta;
        if (v < 0 || v > 100) v = this.simValue[j] - delta;
        this.simValue[j] = roundHalfAway(v * 100) / 100;
        out.push(good(this.sim[j], this.simValue[j]));
      }
    } else if (this.sim.length) {
      this.sim.forEach((tag, j) => out.push(good(tag, this.simValue[j])));
    }
    return out;
  }
}
