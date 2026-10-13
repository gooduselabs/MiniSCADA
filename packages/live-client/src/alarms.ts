// Phần alarm của giao thức live 1.3.0 (feature 009; specs/009-alarms/contracts/live-protocol-1.3.md):
//  - `subscribeAlarms` riêng, không trộn vào `delta` của Tag; chỉ gửi khi `hello.features` có "alarms" (§9);
//  - `alarmSnapshot` (có thể chia mảnh ≤ 100 instance, §3.4) và `alarmDelta` (changed đủ trường + removed, §4);
//  - sequence của alarm độc lập với Tag; đứt thì bỏ bản tin và xin lại snapshot bằng requestId mới (§6).
// Lớp này chỉ ghép mảnh, kiểm sequence và làm sạch kiểu; kho trạng thái do trang (apps/runtime-web/src/alarm) giữ.
import type { HelloInfo } from './state.ts';

export type AlarmSupport = 'unsupported' | 'none' | 'supported';

export type AlarmType = 'digital' | 'limit' | 'quality';
export type AlarmLimitName = 'HH' | 'H' | 'L' | 'LL';
export type AlarmState = 'NORMAL' | 'ACTIVE_UNACK' | 'ACTIVE_ACK' | 'RTN_UNACK';
export type AlarmPriority = 'critical' | 'major' | 'minor' | 'advisory';
export type AlarmColor = 'red' | 'orange' | 'amber' | 'blue' | 'purple' | 'teal' | 'gray' | 'green';
export type AlarmSoundKind = 'none' | 'beep' | 'double' | 'siren';

export interface LiveAlarmShelf {
  until: number;
  remainingMs: number;
  reason: string;
  user: string;
  system: boolean;
}

export interface LiveAlarmInstance {
  id: string;
  alarmId: string;
  name: string;
  type: AlarmType;
  limit?: AlarmLimitName;
  occurrence: number;
  rev: number;
  state: AlarmState;
  class: string;
  priority: AlarmPriority;
  area: string | null;
  text: string;
  valueActive: boolean | number | string | null;
  qualityActive: 'GOOD' | 'UNCERTAIN' | 'BAD';
  reason?: string;
  tsActive: number;
  clockOk: boolean;
  tsAck?: number;
  ackUser?: string;
  tsReturn?: number;
  shelved?: LiveAlarmShelf;
  disabled: boolean;
  inputBad: boolean;
  startup: boolean;
}

export interface LiveAlarmClass {
  id: string;
  name: string;
  priority: AlarmPriority;
  color: AlarmColor;
  blink: boolean;
  requiresAck: boolean;
  ackReturn: boolean;
  sound: AlarmSoundKind;
  chatterLimit: number;
}

export interface LiveAlarmArea {
  id: string;
  name: string;
}

export interface LiveAlarmCounts {
  active: number;
  unack: number;
  rtnUnack: number;
  shelved: number;
  disabled: number;
  byPriority: Record<AlarmPriority, { active: number; unack: number }>;
}

export interface AlarmSnapshotMsg {
  subscriptionId: string;
  sequence: number;
  /** Giờ treo tường của thiết bị lúc gửi (ms UTC). */
  ts: number;
  revision: number;
  instances: LiveAlarmInstance[];
  classes: LiveAlarmClass[];
  areas: LiveAlarmArea[];
  counts: LiveAlarmCounts;
}

export interface AlarmDeltaMsg {
  subscriptionId: string;
  sequence: number;
  ts: number;
  revision: number;
  changed: LiveAlarmInstance[];
  removed: string[];
  counts: LiveAlarmCounts;
}

/** Thiếu mảnh quá 10 s thì xin lại snapshot (§3.4). */
export const ALARM_PART_TIMEOUT_MS = 10_000;
/** Tối đa 5 `subscribeAlarms` trong 10 s mỗi phiên (§2). */
export const ALARM_SUBSCRIBE_LIMIT = 5;
export const ALARM_SUBSCRIBE_WINDOW_MS = 10_000;

// ---- làm sạch kiểu -----------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const oneOf = <T extends string>(set: readonly T[], v: unknown): v is T => set.includes(v as T);

const TYPES = ['digital', 'limit', 'quality'] as const;
const LIMITS = ['HH', 'H', 'L', 'LL'] as const;
const STATES = ['NORMAL', 'ACTIVE_UNACK', 'ACTIVE_ACK', 'RTN_UNACK'] as const;
const PRIORITIES = ['critical', 'major', 'minor', 'advisory'] as const;
const COLORS = ['red', 'orange', 'amber', 'blue', 'purple', 'teal', 'gray', 'green'] as const;
const SOUNDS = ['none', 'beep', 'double', 'siren'] as const;
const QUALITIES = ['GOOD', 'UNCERTAIN', 'BAD'] as const;

function parseShelf(v: unknown): LiveAlarmShelf | undefined {
  if (!isObj(v) || !isNum(v.until) || !isNum(v.remainingMs)) return undefined;
  return {
    until: v.until,
    remainingMs: v.remainingMs,
    reason: isStr(v.reason) ? v.reason : '',
    user: isStr(v.user) ? v.user : '',
    system: v.system === true,
  };
}

/** Một instance của snapshot/delta; hình dạng hỏng thì `null` (bản tin vẫn dùng được phần còn lại). */
export function parseAlarmInstance(raw: unknown): LiveAlarmInstance | null {
  if (!isObj(raw)) return null;
  if (!isStr(raw.id) || raw.id === '') return null;
  if (!oneOf(STATES, raw.state)) return null;
  const type = oneOf(TYPES, raw.type) ? raw.type : 'digital';
  const priority = oneOf(PRIORITIES, raw.priority) ? raw.priority : 'minor';
  const i: LiveAlarmInstance = {
    id: raw.id,
    alarmId: isStr(raw.alarmId) ? raw.alarmId : raw.id,
    name: isStr(raw.name) ? raw.name : raw.id,
    type,
    occurrence: isNum(raw.occurrence) ? raw.occurrence : 0,
    rev: isNum(raw.rev) ? raw.rev : 0,
    state: raw.state,
    class: isStr(raw.class) ? raw.class : '',
    priority,
    area: isStr(raw.area) && raw.area !== '' ? raw.area : null,
    text: isStr(raw.text) ? raw.text : '',
    valueActive:
      typeof raw.valueActive === 'boolean' || isNum(raw.valueActive) || isStr(raw.valueActive)
        ? raw.valueActive
        : null,
    qualityActive: oneOf(QUALITIES, raw.qualityActive) ? raw.qualityActive : 'GOOD',
    tsActive: isNum(raw.tsActive) ? raw.tsActive : 0,
    clockOk: raw.clockOk !== false,
    disabled: raw.disabled === true,
    inputBad: raw.inputBad === true,
    startup: raw.startup === true,
  };
  if (type === 'limit' && oneOf(LIMITS, raw.limit)) i.limit = raw.limit;
  if (isStr(raw.reason) && raw.reason !== '') i.reason = raw.reason;
  if (isNum(raw.tsAck)) i.tsAck = raw.tsAck;
  if (isStr(raw.ackUser)) i.ackUser = raw.ackUser;
  if (isNum(raw.tsReturn)) i.tsReturn = raw.tsReturn;
  const shelf = parseShelf(raw.shelved);
  if (shelf) i.shelved = shelf;
  return i;
}

function parseInstances(v: unknown): LiveAlarmInstance[] {
  if (!Array.isArray(v)) return [];
  const out: LiveAlarmInstance[] = [];
  for (const r of v) {
    const i = parseAlarmInstance(r);
    if (i) out.push(i);
  }
  return out;
}

const n0 = (v: unknown): number => (isNum(v) ? v : 0);

export function parseAlarmCounts(v: unknown): LiveAlarmCounts {
  const o = isObj(v) ? v : {};
  const by = isObj(o.byPriority) ? o.byPriority : {};
  const one = (p: AlarmPriority): { active: number; unack: number } => {
    const x = isObj(by[p]) ? (by[p] as Obj) : {};
    return { active: n0(x.active), unack: n0(x.unack) };
  };
  return {
    active: n0(o.active),
    unack: n0(o.unack),
    rtnUnack: n0(o.rtnUnack),
    shelved: n0(o.shelved),
    disabled: n0(o.disabled),
    byPriority: {
      critical: one('critical'),
      major: one('major'),
      minor: one('minor'),
      advisory: one('advisory'),
    },
  };
}

function parseClasses(v: unknown): LiveAlarmClass[] {
  if (!Array.isArray(v)) return [];
  const out: LiveAlarmClass[] = [];
  for (const r of v) {
    if (!isObj(r) || !isStr(r.id)) continue;
    out.push({
      id: r.id,
      name: isStr(r.name) ? r.name : r.id,
      priority: oneOf(PRIORITIES, r.priority) ? r.priority : 'minor',
      color: oneOf(COLORS, r.color) ? r.color : 'gray',
      blink: r.blink === true,
      requiresAck: r.requiresAck !== false,
      ackReturn: r.ackReturn === true,
      sound: oneOf(SOUNDS, r.sound) ? r.sound : 'none',
      chatterLimit: n0(r.chatterLimit),
    });
  }
  return out;
}

function parseAreas(v: unknown): LiveAlarmArea[] {
  if (!Array.isArray(v)) return [];
  const out: LiveAlarmArea[] = [];
  for (const r of v)
    if (isObj(r) && isStr(r.id)) out.push({ id: r.id, name: isStr(r.name) ? r.name : r.id });
  return out;
}

/** Quy tắc quyết định của client (§9): `protocolVersion` MINOR ≥ 3 và `features` có "alarms". */
export function alarmSupportOf(hello: HelloInfo): AlarmSupport {
  const m = /^(\d+)\.(\d+)\./.exec(hello.protocolVersion);
  if (!m) return 'unsupported';
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major !== 1 || minor < 3) return 'unsupported';
  return hello.features?.includes('alarms') ? 'supported' : 'none';
}

// ---- nguồn cấp ---------------------------------------------------------------------------------------------------

export interface AlarmFeedDeps {
  send: (m: object) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
  now: () => number;
}

interface PartBuffer {
  sequence: number;
  total: number;
  parts: Map<number, LiveAlarmInstance[]>;
  tail: AlarmSnapshotMsg | null;
  timer: unknown;
}

export class AlarmFeed {
  support: AlarmSupport | 'unknown' = 'unknown';
  onSupport: ((s: AlarmSupport) => void) | null = null;
  onSnapshot: ((s: AlarmSnapshotMsg) => void) | null = null;
  onDelta: ((d: AlarmDeltaMsg) => void) | null = null;
  /** Thấy sequence đứt hoặc thiếu mảnh: đã xin lại snapshot, dữ liệu hiện có là cũ cho tới khi snapshot mới tới. */
  onResync: (() => void) | null = null;

  readonly #d: AlarmFeedDeps;
  #wanted = false;
  #subscribed = false;
  #n = 0;
  #expected = '';
  #seq = 0;
  #has = false;
  #buf: PartBuffer | null = null;
  #times: number[] = [];
  #retry: unknown = null;

  constructor(deps: AlarmFeedDeps) {
    this.#d = deps;
  }

  get wanted(): boolean {
    return this.#wanted;
  }

  /** Người dùng cần alarm: đăng ký ngay nếu `hello` đã báo hỗ trợ; nếu chưa, đăng ký khi nhận `hello`. */
  want(): void {
    if (this.#wanted) return;
    this.#wanted = true;
    if (this.support === 'supported') this.#subscribe();
  }

  unwant(): void {
    if (!this.#wanted) return;
    this.#wanted = false;
    this.#clearBuf();
    if (this.#retry !== null) this.#d.clearTimer(this.#retry);
    this.#retry = null;
    if (this.#subscribed) this.#d.send({ type: 'unsubscribeAlarms' });
    this.#subscribed = false;
    this.#expected = '';
    this.#has = false;
  }

  /** Socket mới: trạng thái của kết nối cũ bỏ hết. */
  reset(): void {
    this.#clearBuf();
    if (this.#retry !== null) this.#d.clearTimer(this.#retry);
    this.#retry = null;
    this.#subscribed = false;
    this.#expected = '';
    this.#has = false;
    this.#seq = 0;
    this.#times = [];
    this.support = 'unknown';
  }

  onHello(hello: HelloInfo): void {
    this.support = alarmSupportOf(hello);
    this.onSupport?.(this.support);
    if (this.support === 'supported' && this.#wanted) this.#subscribe();
  }

  /** Xử lý `alarmSnapshot`, `alarmDelta`; trả true nếu bản tin thuộc alarm. */
  handle(msg: Record<string, unknown>): boolean {
    if (msg.type === 'alarmSnapshot') {
      this.#onSnapshot(msg);
      return true;
    }
    if (msg.type === 'alarmDelta') {
      this.#onDelta(msg);
      return true;
    }
    return false;
  }

  // ---- gửi -----------------------------------------------------------------------------------------------------

  #subscribe(): void {
    const now = this.#d.now();
    this.#times = this.#times.filter((t) => now - t < ALARM_SUBSCRIBE_WINDOW_MS);
    if (this.#times.length >= ALARM_SUBSCRIBE_LIMIT) {
      // Quá giới hạn của thiết bị: chờ cửa sổ trượt rồi thử một lần (client lỗi không xin snapshot vòng lặp).
      if (this.#retry === null) {
        const wait = this.#times[0]! + ALARM_SUBSCRIBE_WINDOW_MS - now + 1;
        this.#retry = this.#d.setTimer(
          () => {
            this.#retry = null;
            if (this.#wanted && this.support === 'supported') this.#subscribe();
          },
          Math.max(1, wait),
        );
      }
      return;
    }
    this.#times.push(now);
    const requestId = `a${++this.#n}`;
    this.#expected = requestId;
    this.#subscribed = true;
    this.#has = false;
    this.#clearBuf();
    this.#d.send({ type: 'subscribeAlarms', requestId });
  }

  #resync(): void {
    this.#has = false;
    this.#clearBuf();
    this.#subscribe();
    this.onResync?.();
  }

  #clearBuf(): void {
    if (this.#buf && this.#buf.timer !== null) this.#d.clearTimer(this.#buf.timer);
    this.#buf = null;
  }

  // ---- nhận ----------------------------------------------------------------------------------------------------

  #onSnapshot(m: Record<string, unknown>): void {
    if (!this.#wanted || !isStr(m.subscriptionId) || m.subscriptionId !== this.#expected) return;
    const snap: AlarmSnapshotMsg = {
      subscriptionId: m.subscriptionId,
      sequence: n0(m.sequence),
      ts: n0(m.ts),
      revision: n0(m.revision),
      instances: parseInstances(m.instances),
      classes: parseClasses(m.classes),
      areas: parseAreas(m.areas),
      counts: parseAlarmCounts(m.counts),
    };
    const part = m.part;
    const parts = m.parts;
    if (
      Number.isInteger(part) &&
      Number.isInteger(parts) &&
      (parts as number) >= 2 &&
      (part as number) >= 1 &&
      (part as number) <= (parts as number)
    ) {
      this.#addPart(snap, part as number, parts as number);
      return;
    }
    this.#clearBuf();
    this.#apply(snap);
  }

  #addPart(snap: AlarmSnapshotMsg, part: number, total: number): void {
    let b = this.#buf;
    if (!b || b.sequence !== snap.sequence || b.total !== total) {
      this.#clearBuf();
      b = { sequence: snap.sequence, total, parts: new Map(), tail: null, timer: null };
      b.timer = this.#d.setTimer(() => {
        this.#buf = null;
        this.#resync();
      }, ALARM_PART_TIMEOUT_MS);
      this.#buf = b;
    }
    b.parts.set(part, snap.instances);
    if (part === total || b.tail === null) b.tail = snap;
    if (b.parts.size < total) return;
    const instances: LiveAlarmInstance[] = [];
    for (let p = 1; p <= total; p++) instances.push(...(b.parts.get(p) ?? []));
    const tail = b.tail ?? snap;
    this.#clearBuf();
    this.#apply({ ...tail, instances });
  }

  #apply(snap: AlarmSnapshotMsg): void {
    this.#seq = snap.sequence;
    this.#has = true;
    this.onSnapshot?.(snap);
  }

  #onDelta(m: Record<string, unknown>): void {
    if (!this.#wanted || !isStr(m.subscriptionId) || m.subscriptionId !== this.#expected) return;
    if (!this.#has) return; // trước snapshot (hoặc đang chờ snapshot mới): bỏ, không phải sequence đứt
    const seq = n0(m.sequence);
    if (seq !== this.#seq + 1) {
      this.#resync();
      return;
    }
    this.#seq = seq;
    const removed = Array.isArray(m.removed) ? m.removed.filter(isStr) : [];
    this.onDelta?.({
      subscriptionId: m.subscriptionId,
      sequence: seq,
      ts: n0(m.ts),
      revision: n0(m.revision),
      changed: parseInstances(m.changed),
      removed,
      counts: parseAlarmCounts(m.counts),
    });
  }
}
