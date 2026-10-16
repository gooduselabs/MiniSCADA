// Giao diện nội bộ giữa engine và từng loại khối.
import type { TableSet } from '@mat/expression';
import type {
  ActionOut,
  BlockState,
  LogicConfig,
  LogicOutValue,
  ReadTag,
  RetainStore,
  WallClock,
} from './types.ts';

/** Ngữ cảnh của một lần quét. */
export interface ScanCtx {
  readonly now: number;
  /** Tag của ảnh chụp đầu quét, hoặc đầu ra logic hiện tại (khối đứng trước theo thứ tự tô-pô đã cập nhật). */
  readonly read: ReadTag;
  readonly wall: WallClock | undefined;
  readonly tables: TableSet;
  readonly config: LogicConfig;
  setOut(tag: string, value: LogicOutValue | null, bad?: string): void;
  emit(a: ActionOut): void;
}

export interface Block {
  readonly id: string;
  step(ctx: ScanCtx): void;
  state(now: number): BlockState;
  /** Ghi trường retain của khối vào `out` (chỉ khi khối có retain). */
  retain(out: RetainStore): void;
  /** Đầu ra ban đầu (trước lần quét đầu). */
  init(ctx: Pick<ScanCtx, 'setOut'>): void;
}

/** Số nguyên an toàn từ kho retain (thiếu hoặc sai kiểu: 0). */
export function retainNum(store: RetainStore | undefined, key: string): number {
  const v = store?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
