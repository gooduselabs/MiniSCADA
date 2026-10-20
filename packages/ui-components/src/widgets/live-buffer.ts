// Bộ đệm giá trị sống của widget (feature 014): 60 điểm gần nhất cho đường nhỏ và mũi tên xu hướng của stat-tile, kpi.
// Cùng quy tắc với card (feature 012): một điểm mỗi lần trạng thái của Tag đổi (giá trị, quality hoặc giờ cập nhật); BAD,
// STALE, UNKNOWN và giá trị không phải số thành NaN (làm đứt đường).
import { numberOf } from '../format/format-value.ts';
import type { TagState } from '../host/types.ts';

export const LIVE_POINTS = 60;

export class LiveBuffer {
  readonly values: number[] = [];
  #lastKey = '';
  #tag: string | undefined;

  /** Ghi trạng thái hiện tại của `tag`; đổi Tag thì xóa bộ đệm. Trả `true` khi có điểm mới. */
  record(tag: string | undefined, s: TagState): boolean {
    if (tag !== this.#tag) {
      this.#tag = tag;
      this.values.length = 0;
      this.#lastKey = '';
    }
    if (tag === undefined) return false;
    const key = `${String(s.value)}|${s.quality}|${s.updatedAt ?? ''}`;
    if (key === this.#lastKey) return false;
    this.#lastKey = key;
    const n = numberOf(s.value);
    const ok =
      typeof s.value !== 'string' &&
      Number.isFinite(n) &&
      (s.quality === 'GOOD' || s.quality === 'UNCERTAIN');
    this.values.push(ok ? n : Number.NaN);
    if (this.values.length > LIVE_POINTS) this.values.splice(0, this.values.length - LIVE_POINTS);
    return true;
  }

  /** Hướng so với điểm trước: null khi chưa đủ hai điểm số liền nhau. */
  direction(): 'up' | 'down' | 'flat' | null {
    const b = this.values;
    if (b.length < 2) return null;
    const cur = b[b.length - 1]!;
    const prev = b[b.length - 2]!;
    if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
    return cur > prev ? 'up' : cur < prev ? 'down' : 'flat';
  }
}
