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
  openPopup(screenId: string): void;
  closePopup(): void;
  /** Trang: mở hộp Đăng nhập; Studio: không làm gì. */
  requestLogin(): void;
}
