// Kiểu dữ liệu của động cơ alarm (contracts/alarm-engine.md §2, §13; data-model.md §4–§6).
// Không phụ thuộc DOM; thời gian luôn do người gọi tiêm vào.

export type AlarmState = 'NORMAL' | 'ACTIVE_UNACK' | 'ACTIVE_ACK' | 'RTN_UNACK';
export type Priority = 'critical' | 'major' | 'minor' | 'advisory';
export type ClosedBy = 'return' | 'config' | 'disabled' | 'restart-lost';
export type Quality = 'GOOD' | 'UNCERTAIN' | 'BAD';
export type AlarmKind = 'digital' | 'limit' | 'quality';
export type LimitName = 'HH' | 'H' | 'L' | 'LL';
export type QualityOn = 'bad' | 'notGood';

export interface TagSample {
  /** `false` nếu Tag chưa từng có giá trị (revision 0). Thiếu = `true`. */
  known?: boolean;
  value: number;
  quality: Quality;
  reason?: string;
}

export interface AlarmTagInfo {
  unit?: string;
  labels?: Record<string, string>;
  isBool?: boolean;
}

export interface AlarmEngineOptions {
  chatterWindowS?: number;
  chatterShelveS?: number;
  maxShelved?: number;
  /** Ngưỡng `clockOk`: giờ treo tường >= ngưỡng thì coi là đã đồng bộ. */
  clockFloorMs?: number;
}

export type Command =
  | { kind: 'ack'; id: string; occurrence: number; user: string }
  | {
      kind: 'shelve';
      id: string;
      reason: string;
      durationS: number;
      user: string;
      system?: boolean;
    }
  | { kind: 'unshelve'; id: string; user: string }
  | { kind: 'disable'; id: string; reason: string; user: string }
  | { kind: 'enable'; id: string; user: string };

export type CommandResultCode =
  | 'ACKED'
  | 'ALREADY_ACKED'
  | 'NOT_ACTIVE'
  | 'STALE'
  | 'SHELVED'
  | 'NOT_FOUND'
  | 'OK'
  | 'NOT_SHELVED'
  | 'ALREADY_DISABLED'
  | 'NOT_DISABLED'
  | 'SHELVE_RANGE';

export interface AlarmClass {
  id: string;
  name: string;
  priority: Priority;
  color: string;
  blink: boolean;
  requiresAck: boolean;
  ackReturn: boolean;
  sound: string;
  chatterLimit: number;
}

export interface AlarmArea {
  id: string;
  name: string;
}

/** Một instance đã bung (data-model §4). */
export interface InstanceDef {
  id: string;
  defId: string;
  limitName: LimitName | '';
  kind: AlarmKind;
  name: string;
  /** Id Tag theo dõi ('' với alarm quality theo thiết bị). */
  tagId: string;
  /** Id thiết bị ('' nếu không phải alarm quality theo thiết bị). */
  deviceId: string;
  threshold: number | null;
  deadband: number;
  trigger: boolean | null;
  on: QualityOn | null;
  onDelayMs: number;
  offDelayMs: number;
  classId: string;
  areaId: string;
  /** Mẫu nội dung đã chọn (ngưỡng > alarm); null = mẫu mặc định. */
  text: string | null;
  fingerprint: string;
}

export interface AlarmDefs {
  instances: InstanceDef[];
  classes: AlarmClass[];
  areas: AlarmArea[];
  /** Tag theo dõi, khử trùng, theo thứ tự xuất hiện đầu tiên. */
  tagIds: string[];
  /** Với mỗi thiết bị: chỉ số vào `tagIds`. */
  deviceTags: Record<string, number[]>;
}

/** Hàng `alarm_occurrence` (JSON camelCase, 0/1 cho cờ; cột NULL thì vắng khóa). */
export interface OccurrenceRow {
  id: number;
  alarmId: string;
  fingerprint: string;
  tsActiveMs: number;
  clockOk: 0 | 1;
  tsAckMs?: number;
  ackUser?: string;
  tsReturnMs?: number;
  tsReturnAckMs?: number;
  returnAckUser?: string;
  priority: number;
  class: string;
  area?: string;
  text: string;
  textFold: string;
  valueActive?: number;
  qualityActive: Quality;
  reason?: string;
  flags: number;
  repeatCount: number;
  closed: 0 | 1;
  closedBy?: ClosedBy;
}

/** Hàng `alarm_override`. */
export interface OverrideRow {
  alarmId: string;
  kind: 'shelve' | 'disable';
  user: string;
  reason: string;
  system: 0 | 1;
  tsStartMs: number;
  clockOk: 0 | 1;
  tsEndMs?: number;
}

export interface AlarmEvent {
  kind:
    | 'state'
    | 'shelve'
    | 'unshelve'
    | 'disable'
    | 'enable'
    | 'chatter'
    | 'command'
    | 'removed'
    | 'resync';
  tMono: number;
  tEpoch: number;
  clockOk: boolean;
  instance: string;
  from?: AlarmState;
  to?: AlarmState;
  occurrence?: number;
  closedBy?: ClosedBy;
  text?: string;
  value?: number;
  quality?: Quality;
  reason?: string;
  flags?: { startup: boolean; inputBad: boolean };
  result?: CommandResultCode;
  /** Với `chatter`: số lần bật gộp. */
  count?: number;
  revision: number;
  row?: OccurrenceRow;
  /** Với shelve/disable: hàng override mới; `null` (unshelve/enable) = xóa. */
  override?: OverrideRow | null;
}

export interface LoadContext {
  open?: OccurrenceRow[];
  overrides?: OverrideRow[];
  nowMonoMs: number;
  nowEpochMs: number;
  processStart: boolean;
  nextOccurrence?: number;
}

export interface AlarmItem {
  id: string;
  defId: string;
  limit?: LimitName;
  name: string;
  class: string;
  area?: string;
  priority: Priority;
  state: AlarmState;
  shelve?: { user: string; reason: string; untilMs: number; remainingS: number; system: boolean };
  disabled?: boolean;
  inputBad: boolean;
  occurrence: number;
  rev: number;
  tsActiveMs?: number;
  clockOk?: boolean;
  tsAckMs?: number;
  ackUser?: string;
  tsReturnMs?: number;
  value?: number;
  quality?: Quality;
  reason?: string;
  text?: string;
  startup?: boolean;
  repeat?: number;
}

export interface AlarmCounts {
  active: number;
  unacked: number;
  rtnUnack: number;
  shelved: number;
  disabled: number;
  unackedByPriority: Record<Priority, number>;
  activeByPriority: Record<Priority, number>;
}

export interface AlarmView {
  revision: number;
  ts: number;
  clockOk: boolean;
  clockJumpWhileOpen: boolean;
  counts: AlarmCounts;
  items: AlarmItem[];
}

export interface AckRequest {
  area?: string;
  class?: string;
  /** "Từ mức này trở lên". */
  priority?: Priority;
  state?: 'unack' | 'rtn';
  q?: string;
  upToRevision?: number;
}

export interface AckTarget {
  id: string;
  occurrence: number;
}

// ---- Dạng project (alarms.json / alarm-classes.json 0.5) mà compileAlarms nhận ----

export interface AlarmLimitJson {
  value: number;
  class: string;
  text?: string;
}

export interface AlarmDefJson {
  id: string;
  type: AlarmKind;
  name: string;
  area?: string;
  text?: string;
  enabled?: boolean;
  onDelayMs?: number;
  offDelayMs?: number;
  tag?: string;
  device?: string;
  trigger?: boolean;
  on?: QualityOn;
  limits?: Partial<Record<LimitName, AlarmLimitJson>>;
  deadband?: number;
  class?: string;
}

export interface AlarmClassJson {
  id: string;
  name: string;
  priority: Priority;
  color: string;
  blink?: boolean;
  requiresAck?: boolean;
  ackReturn?: boolean;
  sound?: string;
  chatterLimit?: number;
}

export interface ProjectLike {
  alarms?: { areas?: AlarmArea[]; alarms: AlarmDefJson[] };
  alarmClasses?: { classes: AlarmClassJson[] };
  /** Thiết bị trường → Tag đọc từ thiết bị đó (không tính Tag tính toán/mô phỏng). */
  devices?: Record<string, string[]>;
}

export const PRIORITY_NUM: Record<Priority, number> = {
  critical: 1,
  major: 2,
  minor: 3,
  advisory: 4,
};
