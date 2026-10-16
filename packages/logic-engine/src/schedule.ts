// Lịch (contracts/logic-engine.md §7; R23). Giờ địa phương = UTC + tzOffsetMin (khối, không thì thiết bị); không DST,
// không tzdata. Ngày (civil) tính bằng thuật toán days-from-civil (H. Hinnant), thứ: 1 là thứ Hai … 7 là Chủ nhật.
// Khung nửa mở [from, to) theo phút; from > to là qua nửa đêm, phần sau nửa đêm thuộc ngày bắt đầu và chỉ tính khi
// ngày bắt đầu không có ngoại lệ. Ngoại lệ đè toàn bộ ngày địa phương của nó. Chưa đồng bộ giờ: BAD TIME_NOT_SYNCED
// (giữ giá trị cuối).
import type { Block, ScanCtx } from './block.ts';
import type { BlockState, LogicSchedule } from './types.ts';

const DAY_MS = 86_400_000;

/** Ngày civil của số ngày kể từ 1970-01-01 (UTC hay địa phương tùy đầu vào). */
export function civilFromDays(days: number): { y: number; m: number; d: number } {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

const pad = (n: number, w: number) => String(n).padStart(w, '0');
export function dateKey(days: number): string {
  const c = civilFromDays(days);
  return `${pad(c.y, 4)}-${pad(c.m, 2)}-${pad(c.d, 2)}`;
}
/** Thứ ISO (1 là thứ Hai) của số ngày kể từ 1970-01-01 (thứ Năm). */
export const isoWeekday = (days: number): number => ((((days + 3) % 7) + 7) % 7) + 1;
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Kết quả của lịch tại `epochMs` (UTC) với múi giờ `tz` phút. */
export function scheduleAt(s: LogicSchedule, epochMs: number, tz: number): boolean {
  const local = epochMs + tz * 60000;
  const day = Math.floor(local / DAY_MS);
  const minute = Math.floor((local - day * DAY_MS) / 60000);
  const exc = new Map((s.exceptions ?? []).map((x) => [x.date, x.mode]));
  const today = exc.get(dateKey(day));
  if (today !== undefined) return today === 'on';
  const dow = isoWeekday(day);
  const prevDow = isoWeekday(day - 1);
  const prevFree = !exc.has(dateKey(day - 1));
  for (const w of s.weekly) {
    const f = minutesOf(w.from);
    const t = minutesOf(w.to);
    if (f < t) {
      if (w.days.includes(dow) && minute >= f && minute < t) return true;
    } else {
      if (w.days.includes(dow) && minute >= f) return true;
      if (prevFree && w.days.includes(prevDow) && minute < t) return true;
    }
  }
  return false;
}

export class ScheduleBlock implements Block {
  readonly id: string;
  private value: boolean | null = null;
  private bad = true;
  private readonly def: LogicSchedule;

  constructor(def: LogicSchedule) {
    this.id = def.id;
    this.def = def;
  }

  init(ctx: Pick<ScanCtx, 'setOut'>): void {
    ctx.setOut(this.def.out, null, 'TIME_NOT_SYNCED');
  }

  step(ctx: ScanCtx): void {
    const w = ctx.wall;
    if (!w || !w.synced || w.epochMs === null) {
      this.bad = true;
      ctx.setOut(this.def.out, this.value, 'TIME_NOT_SYNCED');
      return;
    }
    this.bad = false;
    this.value = scheduleAt(this.def, w.epochMs, this.def.tzOffsetMin ?? ctx.config.tzOffsetMin);
    ctx.setOut(this.def.out, this.value);
  }

  state(): BlockState {
    return this.bad
      ? { kind: 'schedule', state: 'OK', reason: 'TIME_NOT_SYNCED' }
      : { kind: 'schedule', state: 'OK' };
  }

  retain(): void {}
}
