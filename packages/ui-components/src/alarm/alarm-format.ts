// Hàm thuần của giao diện alarm (feature 009; contracts/ui-alarm.md §4.1, §8, §9): lọc, sắp xếp, gấp dấu tiếng Việt,
// nhãn trạng thái, đếm, chọn alarm hiện ở banner, bảng dữ liệu âm thanh dùng chung với Studio, đồng hồ nhấp nháy.
// Không gọi mạng; BlinkClock là phần duy nhất có trạng thái (một bộ hẹn giờ cho cả trang).
import { alarmVi } from '../i18n/alarm-vi.ts';
import type {
  AlarmCounts,
  AlarmFilter,
  AlarmInstance,
  AlarmPriority,
  AlarmSnapshot,
  AlarmSoundKind,
  AlarmState,
} from '../host/types.ts';
import { vi } from '../i18n/vi.ts';
import type { AlarmIconName } from './alarm-icons.ts';

export type AlarmColumn = 'time' | 'priority' | 'area' | 'text' | 'value' | 'state' | 'ackUser';
export const ALARM_COLUMNS: readonly AlarmColumn[] = [
  'time',
  'priority',
  'area',
  'text',
  'value',
  'state',
  'ackUser',
];
export interface AlarmSort {
  column: AlarmColumn;
  dir: 'asc' | 'desc';
}
/** Bộ lọc của bảng: như `AlarmFilter` cộng mức tối thiểu (widget). */
export interface AlarmQuery extends AlarmFilter {
  minPriority?: AlarmPriority;
}

export const PRIORITIES: readonly AlarmPriority[] = ['critical', 'major', 'minor', 'advisory'];
/** Càng cao càng nghiêm trọng. */
export const PRIORITY_RANK: Readonly<Record<AlarmPriority, number>> = {
  critical: 3,
  major: 2,
  minor: 1,
  advisory: 0,
};

const STATE_ORDER: Readonly<Record<AlarmState, number>> = {
  ACTIVE_UNACK: 0,
  RTN_UNACK: 1,
  ACTIVE_ACK: 2,
  NORMAL: 3,
};
/** HH trước H, LL trước L (cùng định nghĩa). */
const LIMIT_ORDER: Readonly<Record<string, number>> = { HH: 0, H: 1, LL: 2, L: 3 };

// ---- chữ ---------------------------------------------------------------------------------------------------------

/** NFD, bỏ dấu kết hợp, `đ` → `d`, hạ chữ thường: so khớp không phân biệt hoa thường và dấu. */
export function foldVi(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/đ/g, 'd');
}

// ---- lọc và sắp xếp ----------------------------------------------------------------------------------------------

export function filterInstances(list: readonly AlarmInstance[], f: AlarmQuery): AlarmInstance[] {
  const areas = f.areas?.length ? new Set(f.areas) : null;
  const classes = f.classes?.length ? new Set(f.classes) : null;
  const prios = f.priorities?.length ? new Set(f.priorities) : null;
  const states = f.states?.length ? new Set<AlarmState>(f.states) : null;
  const min = f.minPriority ? PRIORITY_RANK[f.minPriority] : null;
  const q = f.q && f.q.trim() ? foldVi(f.q.trim()) : null;
  return list.filter((i) => {
    if (areas && !areas.has(i.area ?? '-')) return false;
    if (classes && !classes.has(i.class)) return false;
    if (prios && !prios.has(i.priority)) return false;
    if (min !== null && PRIORITY_RANK[i.priority] < min) return false;
    if (states && !states.has(i.state)) return false;
    if (q && !foldVi(i.text).includes(q) && !foldVi(i.name).includes(q)) return false;
    return true;
  });
}

/** Mặc định: ưu tiên (nghiêm trọng trước), rồi bật gần nhất trước; hòa: `occurrence` giảm dần, rồi ngưỡng. */
function defaultCompare(a: AlarmInstance, b: AlarmInstance): number {
  return (
    PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] ||
    b.tsActive - a.tsActive ||
    b.occurrence - a.occurrence ||
    (LIMIT_ORDER[a.limit ?? ''] ?? 9) - (LIMIT_ORDER[b.limit ?? ''] ?? 9) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

const textCompare = (a: string, b: string): number => a.localeCompare(b, 'vi');

function valueCompare(a: AlarmInstance['valueActive'], b: AlarmInstance['valueActive']): number {
  const an = typeof a === 'number';
  const bn = typeof b === 'number';
  if (an && bn) return (a as number) - (b as number);
  if (an !== bn) return an ? -1 : 1; // số trước chữ
  return textCompare(String(a ?? ''), String(b ?? ''));
}

/**
 * So sánh hai instance theo cột; `sort` null: thứ tự mặc định. Khi bằng nhau theo cột thì rơi về thứ tự mặc định
 * (ổn định). `areaName`: tên khu vực cho cột `area` (mặc định theo id).
 */
export function compareInstances(
  a: AlarmInstance,
  b: AlarmInstance,
  sort: AlarmSort | null,
  areaName?: (id: string | null) => string,
): number {
  if (!sort) return defaultCompare(a, b);
  const dir = sort.dir === 'asc' ? 1 : -1;
  let c = 0;
  switch (sort.column) {
    case 'time':
      c = a.tsActive - b.tsActive;
      break;
    case 'priority':
      // tăng dần: nghiêm trọng trước
      c = PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority];
      break;
    case 'area':
      c = textCompare(
        areaName ? areaName(a.area) : (a.area ?? ''),
        areaName ? areaName(b.area) : (b.area ?? ''),
      );
      break;
    case 'text':
      c = textCompare(a.text, b.text);
      break;
    case 'value':
      c = valueCompare(a.valueActive, b.valueActive);
      break;
    case 'state':
      c = STATE_ORDER[a.state] - STATE_ORDER[b.state];
      break;
    case 'ackUser':
      c = textCompare(a.ackUser ?? '', b.ackUser ?? '');
      break;
  }
  return c * dir || defaultCompare(a, b);
}

/** Bản sao đã sắp xếp (không đổi mảng gốc). */
export function sortInstances(
  list: readonly AlarmInstance[],
  sort: AlarmSort | null,
  areaName?: (id: string | null) => string,
): AlarmInstance[] {
  return [...list].sort((a, b) => compareInstances(a, b, sort, areaName));
}

/** Instance của tab: 'active' là state ≠ NORMAL và không shelved; 'shelved' là đang shelved. */
export function inTab(i: AlarmInstance, tab: 'active' | 'shelved'): boolean {
  return tab === 'shelved'
    ? i.shelved !== undefined
    : i.shelved === undefined && i.state !== 'NORMAL';
}

/** Alarm chưa xác nhận nên hiện ở banner (§6): bỏ shelved; ưu tiên cao nhất, rồi bật mới nhất, rồi occurrence lớn nhất. */
export function topUnacked(s: AlarmSnapshot): AlarmInstance | null {
  let best: AlarmInstance | null = null;
  for (const i of s.instances) {
    if (i.state !== 'ACTIVE_UNACK' || i.shelved) continue;
    if (
      !best ||
      PRIORITY_RANK[i.priority] > PRIORITY_RANK[best.priority] ||
      (i.priority === best.priority &&
        (i.tsActive > best.tsActive ||
          (i.tsActive === best.tsActive && i.occurrence > best.occurrence)))
    )
      best = i;
  }
  return best;
}

/** Số đếm theo §3.3 (Studio, MemoryAlarmSource, test): máy chủ gửi sẵn `counts` nên trang không dùng hàm này. */
export function computeCounts(list: readonly AlarmInstance[]): AlarmCounts {
  const by = (): { active: number; unack: number } => ({ active: 0, unack: 0 });
  const c: AlarmCounts = {
    active: 0,
    unack: 0,
    rtnUnack: 0,
    shelved: 0,
    disabled: 0,
    byPriority: { critical: by(), major: by(), minor: by(), advisory: by() },
  };
  for (const i of list) {
    if (i.disabled) c.disabled++;
    if (i.shelved) {
      c.shelved++;
      continue;
    }
    if (i.state === 'NORMAL') continue;
    c.active++;
    c.byPriority[i.priority].active++;
    if (i.state === 'ACTIVE_UNACK') {
      c.unack++;
      c.byPriority[i.priority].unack++;
    } else if (i.state === 'RTN_UNACK') c.rtnUnack++;
  }
  return c;
}

// ---- nhãn và biểu tượng ------------------------------------------------------------------------------------------

export type AlarmStateKind = AlarmState | 'shelved' | 'disabled';

/** Trạng thái hiển thị: tạm ẩn và vô hiệu nổi lên trên `state` (NORMAL kèm cờ, §5.1). */
export function stateKind(i: AlarmInstance): AlarmStateKind {
  if (i.shelved) return 'shelved';
  if (i.state === 'NORMAL' && i.disabled) return 'disabled';
  return i.state;
}

export function stateLabel(kind: AlarmStateKind, inputBad = false): string {
  const t = alarmVi.state[kind];
  return inputBad ? `${t} (${alarmVi.state.inputBad})` : t;
}

export const priorityLabel = (p: AlarmPriority): string => alarmVi.priority[p];

const STATE_ICONS: Readonly<Record<AlarmStateKind, AlarmIconName>> = {
  ACTIVE_UNACK: 'state-active-unack',
  ACTIVE_ACK: 'state-active-ack',
  RTN_UNACK: 'state-rtn-unack',
  shelved: 'state-shelved',
  disabled: 'state-disabled',
  NORMAL: 'state-active-ack',
};
export const stateIcon = (k: AlarmStateKind): AlarmIconName => STATE_ICONS[k];

const PRIO_ICONS: Readonly<Record<AlarmPriority, AlarmIconName>> = {
  critical: 'prio-critical',
  major: 'prio-major',
  minor: 'prio-minor',
  advisory: 'prio-advisory',
};
export const priorityIcon = (p: AlarmPriority): AlarmIconName => PRIO_ICONS[p];

/** Thời gian còn lại ≥ 0 của hạn tạm ẩn, trừ thời gian trôi cục bộ kể từ bản tin. */
export function shelvedRemaining(i: AlarmInstance, elapsedLocalMs: number): number {
  return i.shelved ? Math.max(0, i.shelved.remainingMs - elapsedLocalMs) : 0;
}

const p2 = (n: number): string => String(n).padStart(2, '0');

/** `mm:ss`, hoặc `h:mm:ss` từ 1 giờ: thời gian còn lại của tạm ẩn (làm tròn xuống giây). */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${p2(m)}:${p2(s % 60)}` : `${p2(m)}:${p2(s % 60)}`;
}

/** `HH:mm:ss` theo múi giờ trình duyệt; kèm `dd/MM` nếu khác ngày với `nowMs` (§4 cột `time`). */
export function formatAlarmClock(ts: number, nowMs: number): string {
  const d = new Date(ts);
  const n = new Date(nowMs);
  const hms = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  const same =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  return same ? hms : `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${hms}`;
}

/** Giá trị lúc bật dạng chữ thô (nơi chứa có TagSource thì định dạng bằng `formatValue` của 007). */
export function formatAlarmValue(v: AlarmInstance['valueActive']): string {
  if (v === null) return vi.noValue;
  if (typeof v === 'boolean') return v ? vi.on : vi.off;
  return String(v);
}

// ---- âm thanh (§9.1) ---------------------------------------------------------------------------------------------

export interface SoundSegment {
  startMs: number;
  durMs: number;
  fromHz: number;
  toHz: number;
  /** Bao biên độ tuyến tính: tăng, giữ, giảm (tổng ≤ durMs). */
  attackMs: number;
  holdMs: number;
  releaseMs: number;
}
export interface SoundPattern {
  kind: Exclude<AlarmSoundKind, 'none'>;
  wave: 'sine' | 'triangle';
  /** Biên độ đỉnh (cố định 0,25: không giật mình). */
  peak: number;
  cycleMs: number;
  segments: readonly SoundSegment[];
  /** Không có khoảng im giữa các chu kỳ (còi hú). */
  continuous: boolean;
  /** Độ "mạnh" để chọn khi nhiều kiểu cùng lúc. */
  strength: number;
  /** Bao biên độ lúc dừng đột ngột (ms) để tránh tiếng lách tách. */
  stopReleaseMs: number;
}

const PEAK = 0.25;

/** Bảng dữ liệu thuần của bốn kiểu âm thanh; Studio dùng lại để nghe thử ở editor Lớp alarm. */
export const SOUND_PATTERNS: Readonly<Record<AlarmSoundKind, SoundPattern | null>> = {
  none: null,
  beep: {
    kind: 'beep',
    wave: 'sine',
    peak: PEAK,
    cycleMs: 2000,
    continuous: false,
    strength: 1,
    stopReleaseMs: 40,
    segments: [
      { startMs: 0, durMs: 200, fromHz: 880, toHz: 880, attackMs: 10, holdMs: 150, releaseMs: 40 },
    ],
  },
  double: {
    kind: 'double',
    wave: 'sine',
    peak: PEAK,
    cycleMs: 2000,
    continuous: false,
    strength: 2,
    stopReleaseMs: 40,
    segments: [
      { startMs: 0, durMs: 150, fromHz: 880, toHz: 880, attackMs: 10, holdMs: 100, releaseMs: 40 },
      {
        startMs: 250,
        durMs: 150,
        fromHz: 880,
        toHz: 880,
        attackMs: 10,
        holdMs: 100,
        releaseMs: 40,
      },
    ],
  },
  siren: {
    kind: 'siren',
    wave: 'triangle',
    peak: PEAK,
    cycleMs: 1600,
    continuous: true,
    strength: 3,
    stopReleaseMs: 60,
    segments: [
      { startMs: 0, durMs: 800, fromHz: 600, toHz: 1100, attackMs: 30, holdMs: 770, releaseMs: 0 },
      { startMs: 800, durMs: 800, fromHz: 1100, toHz: 600, attackMs: 0, holdMs: 800, releaseMs: 0 },
    ],
  },
};

/** Kiểu mạnh nhất trong danh sách (`none` khi rỗng hoặc toàn `none`). */
export function strongestSound(kinds: readonly AlarmSoundKind[]): AlarmSoundKind {
  let best: AlarmSoundKind = 'none';
  let rank = 0;
  for (const k of kinds) {
    const p = SOUND_PATTERNS[k];
    if (p && p.strength > rank) {
      rank = p.strength;
      best = k;
    }
  }
  return best;
}

// ---- đồng hồ nhấp nháy (§8) --------------------------------------------------------------------------------------

export type BlinkPhase = 'on' | 'off';

export interface BlinkClockOptions {
  /** Phần tử nhận `data-blink-phase`; mặc định `document.documentElement`. */
  root?: HTMLElement;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  reducedMotion?: () => boolean;
  hidden?: () => boolean;
  periodMs?: number;
}

/**
 * Một bộ hẹn giờ 500 ms đổi `data-blink-phase="on|off"` ở gốc trang (chu kỳ 1 s = 1 Hz, WCAG 2.3.1): mọi hàng nhấp nháy
 * đồng pha. Chỉ chạy khi có người đăng ký, tab hiện và không `prefers-reduced-motion` (khi đó viền đậm tĩnh bằng CSS).
 */
export class BlinkClock {
  phase: BlinkPhase = 'on';
  readonly #root: HTMLElement;
  readonly #set: (fn: () => void, ms: number) => unknown;
  readonly #clear: (h: unknown) => void;
  readonly #reduced: () => boolean;
  readonly #hidden: () => boolean;
  readonly #period: number;
  readonly #listeners = new Set<(p: BlinkPhase) => void>();
  #refs = 0;
  #timer: unknown = null;
  #wired = false;

  constructor(o: BlinkClockOptions = {}) {
    this.#root = o.root ?? document.documentElement;
    this.#set = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clear = o.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.#reduced =
      o.reducedMotion ??
      (() =>
        typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.#hidden = o.hidden ?? (() => typeof document !== 'undefined' && document.hidden);
    this.#period = o.periodMs ?? 500;
  }

  /** Đăng ký một nơi dùng nhấp nháy; trả hàm hủy. `listener` nhận pha mỗi lần đổi. */
  acquire(listener?: (p: BlinkPhase) => void): () => void {
    this.#refs++;
    if (listener) this.#listeners.add(listener);
    this.#wire();
    this.#sync();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.#refs--;
      if (listener) this.#listeners.delete(listener);
      this.#sync();
    };
  }

  #wire(): void {
    if (this.#wired || typeof document === 'undefined') return;
    this.#wired = true;
    document.addEventListener('visibilitychange', () => this.#sync());
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener?.('change', () => this.#sync());
    }
  }

  #running(): boolean {
    return this.#refs > 0 && !this.#reduced() && !this.#hidden();
  }

  #sync(): void {
    if (this.#running()) {
      if (this.#timer === null) {
        this.#setPhase('on');
        this.#arm();
      }
    } else if (this.#timer !== null) {
      this.#clear(this.#timer);
      this.#timer = null;
      this.#setPhase('on');
    } else if (this.#refs > 0) this.#setPhase('on');
  }

  #arm(): void {
    this.#timer = this.#set(() => {
      this.#timer = null;
      this.#setPhase(this.phase === 'on' ? 'off' : 'on');
      if (this.#running()) this.#arm();
    }, this.#period);
  }

  #setPhase(p: BlinkPhase): void {
    this.phase = p;
    this.#root.dataset.blinkPhase = p;
    for (const l of [...this.#listeners]) l(p);
  }
}

const clocks = new WeakMap<Document, BlinkClock>();

/** Đồng hồ nhấp nháy chung của tài liệu (bảng, widget, banner dùng chung một pha). */
export function sharedBlinkClock(doc: Document = document): BlinkClock {
  let c = clocks.get(doc);
  if (!c) {
    c = new BlinkClock({ root: doc.documentElement });
    clocks.set(doc, c);
  }
  return c;
}
