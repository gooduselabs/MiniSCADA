// Kiểu của engine logic v2 (contracts/logic-engine.md; ADR-037). Kiểu tài liệu (`LogicDoc`, khối, hành động) nằm ở
// @mat/project-schema (types-10.ts) để validator và engine dùng chung.
import type { InputValue, TableSet } from '@mat/expression';
import type { LogicTagInfo } from '@mat/project-schema';

export type {
  LogicAction,
  LogicCounter,
  LogicDoc,
  LogicRule,
  LogicRunhours,
  LogicSchedule,
  LogicTimer,
  LogicTotalizer,
  LogicWrite,
  LogicTagInfo,
} from '@mat/project-schema';

/** Cấu hình của runtime.json (`logic.*`, `tzOffsetMin`) mà engine cần. */
export interface LogicConfig {
  scanMs: number;
  /** Múi giờ của thiết bị (phút), dùng khi khối lịch không có `tzOffsetMin`. */
  tzOffsetMin: number;
  /** `off`: hành động write/pulse thành SUPPRESSED (không gửi, không tính vào giới hạn). */
  writes: 'on' | 'off';
  maxWritesPerMin: number;
}

export const DEFAULT_CONFIG: LogicConfig = {
  scanMs: 100,
  tzOffsetMin: 420,
  writes: 'on',
  maxWritesPerMin: 20,
};

/** Giá trị của Tag logic: INT64 của counter là bigint, `et`/`starts` là số nguyên an toàn. */
export type LogicOutValue = boolean | number | bigint | string;

export interface OutputValue {
  /** null: chưa có giá trị (chỉ khi BAD). */
  value: LogicOutValue | null;
  quality: 'GOOD' | 'BAD';
  reason?: string;
}

/** Giá trị trong kho retain (khóa `logic/<id>/<trường>`); INT64 của counter là chuỗi thập phân. */
export type RetainValue = number | boolean | string;
export type RetainStore = Record<string, RetainValue>;

/** Đồng hồ thực cho khối lịch: `epochMs` UTC; `synced = false` hoặc `epochMs = null` ⇒ TIME_NOT_SYNCED. */
export interface WallClock {
  epochMs: number | null;
  synced: boolean;
}

/**
 * Kết quả của một hành động trong engine: `OK` (setTag/toggle, Tag nội bộ đổi ở quét sau), `QUEUED` (giao
 * WriteCoordinator, kết quả cuối báo lại bằng `writeResult`), `SUPPRESSED` (logic.writes = off), `RATE_LIMITED`,
 * `OUT_OF_LIMITS` (giá trị biểu thức ngoài `allowed`), `EXPR_ERROR` (biểu thức của giá trị không tính được),
 * `NO_VALUE` (toggle Tag chưa có giá trị GOOD).
 */
export type ActionResult =
  'OK' | 'QUEUED' | 'SUPPRESSED' | 'RATE_LIMITED' | 'OUT_OF_LIMITS' | 'EXPR_ERROR' | 'NO_VALUE';

export interface ActionOut {
  /** Thời điểm quét (ms monotonic). */
  t: number;
  rule: string;
  edgeId: number;
  edge: 'rise' | 'fall';
  /** Chỉ số hành động trong `onRise`/`onFall`. */
  index: number;
  do: 'setTag' | 'toggle' | 'write' | 'pulse';
  /** Tag đích (của `writes` với write/pulse). */
  tag: string;
  write?: string;
  /** Không có khi giá trị không tính được. */
  value?: LogicOutValue;
  ms?: number;
  result: ActionResult;
}

export type RuleStateName = 'OK' | 'SUSPENDED' | 'THROTTLED' | 'DISABLED';

export interface BlockState {
  kind: 'rule' | 'timer' | 'counter' | 'totalizer' | 'runhours' | 'schedule';
  state: RuleStateName;
  /** SUSPENDED: INPUT_BAD, EXPR_ERROR, TIME_NOT_SYNCED; schedule BAD: TIME_NOT_SYNCED. */
  reason?: string;
  /** Luật: điều kiện ổn định (null trước lần quét hợp lệ đầu tiên). */
  stable?: boolean | null;
  edgeId?: number;
  lastError?: string | null;
  /** Timer: đầu vào unknown, đầu ra là giá trị cuối. */
  degraded?: boolean;
  /** Counter: đã chạm INT64 max. */
  overflow?: boolean;
}

export interface EngineOptions {
  tags: ReadonlyMap<string, LogicTagInfo> | Readonly<Record<string, LogicTagInfo>>;
  config?: Partial<LogicConfig>;
  /** Kho retain đọc lúc khởi động; `lost`: kho hỏng ⇒ mọi khối về 0 và `retainLost = true`. */
  retain?: RetainStore | 'lost';
  tables?: TableSet;
}

/** Đọc Tag của ảnh chụp đầu quét (Tag thiết bị, nội bộ, tính toán). */
export type ReadTag = (id: string) => InputValue;
