// Giao diện nơi chứa (contracts/ui-components-api.md §2). Gói không gọi mạng, Tauri hay window.location:
// nơi chứa (trang runtime, Studio, test) cấp TagSource và ActionHost.
import type { ValueTable } from '@mat/expression';

/** `UNKNOWN`: Tag lạ với thiết bị (trạng thái của trang, không phải của giao thức live). */
export type Quality = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE' | 'UNKNOWN';
export type TagScalar = boolean | number | string | null;

export interface TagState {
  /** INT64/UINT64: chuỗi thập phân khi ngoài ±2^53 (như live-client). */
  value: TagScalar;
  quality: Quality;
  /** Mã lý do của 006 (TIMEOUT, CLAMPED…). */
  reason?: string;
  /** ms UTC, giờ của BL335 khi có. */
  updatedAt?: number;
}

export type TagType =
  | 'BOOL'
  | 'INT16'
  | 'UINT16'
  | 'INT32'
  | 'UINT32'
  | 'INT64'
  | 'UINT64'
  | 'FLOAT32'
  | 'FLOAT64'
  | 'STRING';

/** Từ tags.json của project. */
export interface TagInfo {
  id: string;
  type: TagType;
  description?: string;
  unit?: string;
  min?: number;
  max?: number;
  access: 'R' | 'RW';
  kind: 'external' | 'internal' | 'calculated' | 'simulation';
  limits?: { min?: number; max?: number; maxLength?: number };
  valueTable?: string;
  /** Tên thiết bị trường (connections), để hộp xác nhận hiện. */
  deviceName?: string;
}

export interface TagSource {
  info(id: string): TagInfo | undefined;
  /** Luôn trả giá trị (UNKNOWN khi lạ); không ném lỗi. */
  get(id: string): TagState;
  subscribe(ids: readonly string[], onChange: (changed: readonly string[]) => void): () => void;
  /** `stale`: mất dữ liệu; `offline`: chưa kết nối. */
  readonly connection: 'live' | 'stale' | 'offline';
  /** Giờ tham chiếu (ms UTC), ưu tiên giờ BL335. */
  now(): number;
  valueTable(name: string): ValueTable | undefined;
}

export type Role = 'viewer' | 'operator' | 'engineer' | 'administrator';
export interface SessionInfo {
  user: string;
  role: Role;
}

export type WriteKind = 'write' | 'toggle' | 'pulse';
export interface WriteSpec {
  kind: WriteKind;
  tag: string;
  value: boolean | number | string;
  /** Chỉ kind = 'pulse'. */
  pulseMs?: number;
  /** Chỉ BOOL (toggle, switch). */
  expect?: boolean;
  context: { screen: string; widget: string };
}

export type WriteStatus = 'ACCEPTED' | 'CONFIRMED' | 'REJECTED' | 'TIMEOUT' | 'FAILED' | 'UNKNOWN';
export interface WriteOutcome {
  /** UNKNOWN: không lấy được kết quả sau 30 s (chỉ phía trang). */
  status: WriteStatus;
  /** Mã của 006 (CONNECTION_BAD, RATE_LIMITED, STALE_EXPECTATION…). */
  code?: string;
  /** Câu của BL335 (tiếng Việt) nếu có. */
  message?: string;
  retryAfterMs?: number;
  readback?: TagScalar;
}

export type WriteBlockCode = 'INSECURE' | 'HTTPS_DOWN' | 'SESSION_EXPIRED' | 'PROJECT_CHANGING';

export interface ActionHost {
  session(): SessionInfo | null;
  /** Lý do chung khiến mọi ghi bị khóa; null: không khóa. */
  writeBlocked(): { code: WriteBlockCode; message: string } | null;
  /** onPhase: ACCEPTED rồi kết quả cuối. Không bao giờ tự gửi lại. */
  write(spec: WriteSpec, onPhase: (o: WriteOutcome) => void): Promise<WriteOutcome>;
  navigate(screenId: string): void;
  /** `args`: tham số của faceplate (định dạng 1.0, §5); vắng ở popup thường. */
  openPopup(screenId: string, args?: Record<string, string>): void;
  closePopup(): void;
  /** Trang: mở hộp Đăng nhập; Studio: không làm gì. */
  requestLogin(): void;
  /** Feature 009: xác nhận alarm (`POST /api/v1/alarms/ack`). Không ném lỗi, không tự gửi lại. */
  ackAlarms(req: AlarmAckRequest): Promise<AlarmAckOutcome>;
  /** Feature 009: tạm ẩn một alarm (`POST /api/v1/alarms/shelve`). */
  shelveAlarm(req: AlarmShelveRequest): Promise<AlarmActionOutcome>;
  /** Feature 009: gỡ tạm ẩn (`POST /api/v1/alarms/unshelve`). */
  unshelveAlarm(id: string): Promise<AlarmActionOutcome>;
}

// ---- Alarm (feature 009; specs/009-alarms/contracts/ui-alarm.md §2, §3) ------------------------------------------

export type AlarmType = 'digital' | 'limit' | 'quality';
export type AlarmLimitName = 'HH' | 'H' | 'L' | 'LL';
export type AlarmState = 'NORMAL' | 'ACTIVE_UNACK' | 'ACTIVE_ACK' | 'RTN_UNACK';
export type AlarmPriority = 'critical' | 'major' | 'minor' | 'advisory';
export type AlarmColor = 'red' | 'orange' | 'amber' | 'blue' | 'purple' | 'teal' | 'gray' | 'green';
export type AlarmSoundKind = 'none' | 'beep' | 'double' | 'siren';

export interface AlarmClassInfo {
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
export interface AlarmAreaInfo {
  id: string;
  name: string;
}

export interface AlarmShelf {
  /** ms UTC (giờ thiết bị): chỉ để hiển thị. */
  until: number;
  /** Tại thời điểm `AlarmSnapshot.ts`; trang đếm ngược bằng đồng hồ cục bộ. */
  remainingMs: number;
  reason: string;
  user: string;
  /** true: tự cách ly do chập chờn. */
  system: boolean;
}

export interface AlarmInstance {
  /** id instance: "PUMP1_FAULT" hoặc "TANK_B1_LEVEL.HH". */
  id: string;
  alarmId: string;
  name: string;
  type: AlarmType;
  limit?: AlarmLimitName;
  /** Mã lần xảy ra; 0 khi chưa có (shelved/disabled ở NORMAL). */
  occurrence: number;
  rev: number;
  state: AlarmState;
  class: string;
  priority: AlarmPriority;
  area: string | null;
  /** Chữ thô, chỉ vào DOM bằng textContent. */
  text: string;
  valueActive: boolean | number | string | null;
  qualityActive: 'GOOD' | 'UNCERTAIN' | 'BAD';
  reason?: string;
  tsActive: number;
  clockOk: boolean;
  tsAck?: number;
  ackUser?: string;
  tsReturn?: number;
  shelved?: AlarmShelf;
  disabled: boolean;
  inputBad: boolean;
  startup: boolean;
}

export interface AlarmCounts {
  active: number;
  unack: number;
  rtnUnack: number;
  shelved: number;
  disabled: number;
  byPriority: Record<AlarmPriority, { active: number; unack: number }>;
}

export interface AlarmSnapshot {
  instances: readonly AlarmInstance[];
  classes: readonly AlarmClassInfo[];
  areas: readonly AlarmAreaInfo[];
  counts: AlarmCounts;
  /** Giá trị làm `upToRevision` khi "Xác nhận tất cả". */
  revision: number;
}

/**
 * `none`: project không có alarm. `unsupported`: thiết bị < 1.3.0. `stale`: mất kết nối, dữ liệu cũ.
 * `offline`: chưa kết nối.
 */
export type AlarmSourceStatus = 'live' | 'stale' | 'offline' | 'unsupported' | 'none';

export interface AlarmSource {
  /** Luôn trả (rỗng khi chưa có dữ liệu); không ném lỗi; cùng một đối tượng cho tới khi có thay đổi. */
  snapshot(): AlarmSnapshot;
  /**
   * `changed`: id instance đổi hoặc bị xóa; 'all' khi snapshot mới thay toàn bộ (kết nối lại) hoặc `status` đổi.
   * Gọi lại ở cuối microtask, gộp một bản tin. Trả hàm hủy.
   */
  subscribe(onChange: (changed: readonly string[] | 'all') => void): () => void;
  counts(): AlarmCounts;
  classes(): readonly AlarmClassInfo[];
  areas(): readonly AlarmAreaInfo[];
  status(): AlarmSourceStatus;
  /** Giờ tham chiếu (ms UTC), cùng nguồn với TagSource.now(). */
  now(): number;
}

export type AlarmAckResultCode =
  'ACKED' | 'ALREADY_ACKED' | 'NOT_ACTIVE' | 'STALE' | 'SHELVED' | 'NOT_FOUND';

/** Dùng chung cho bảng và "Xác nhận tất cả". */
export interface AlarmFilter {
  /** '-' là "Chung". */
  areas?: readonly string[];
  classes?: readonly string[];
  /** Chính xác các mức này. */
  priorities?: readonly AlarmPriority[];
  states?: readonly ('ACTIVE_UNACK' | 'ACTIVE_ACK' | 'RTN_UNACK')[];
  q?: string;
}

export type AlarmAckRequest =
  | { items: readonly { id: string; occurrence: number }[] }
  | { all: true; upToRevision: number; filter: AlarmFilter };

export interface AlarmActionError {
  code: string;
  message: string;
  field?: string;
  retryAfterMs?: number;
}

export interface AlarmAckOutcome {
  /** false: không có thay đổi (lỗi toàn bộ yêu cầu). */
  ok: boolean;
  /** AUDIT_UNAVAILABLE, RATE_LIMITED, FORBIDDEN, SESSION_EXPIRED, NETWORK… */
  error?: AlarmActionError;
  results: readonly { id: string; occurrence: number; result: AlarmAckResultCode }[];
  acked: number;
  skippedNewer: number;
}

export interface AlarmShelveRequest {
  id: string;
  reason: string;
  durationS: number;
}
export interface AlarmActionOutcome {
  ok: boolean;
  error?: AlarmActionError;
  changed?: boolean;
}
