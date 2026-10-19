// Thứ tự kiểm khóa của widget điều khiển (contracts/ui-components-api.md §5; FR-037). Hàm thuần.
import { POPUP_NO_PERMISSION, lockText } from '../i18n/control-vi.ts';
import type { ActionHost, Role, TagSource } from '../host/types.ts';

export type LockCode =
  | 'NO_SESSION'
  | 'ROLE'
  | 'INSECURE'
  | 'HTTPS_DOWN'
  | 'SESSION_EXPIRED'
  | 'LIVE_LOST'
  | 'TAG_UNKNOWN'
  | 'TAG_READONLY'
  | 'QUALITY_BAD'
  | 'NO_VALUE'
  | 'BUSY'
  | 'OTHER_DIALOG'
  | 'PROJECT_CHANGING'
  | 'NO_PERMISSION'
  | 'PREVIEW';

export interface Lock {
  code: LockCode;
  message: string;
}

export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  engineer: 2,
  administrator: 3,
};

export interface LockInput {
  tag: string | undefined;
  minRole: Exclude<Role, 'viewer'>;
  source: TagSource;
  host: ActionHost;
  /** Đang gửi lệnh, hoặc kết quả UNKNOWN còn giữ. */
  busy: boolean;
  /** Có hộp xác nhận của widget khác. */
  otherDialog: boolean;
  /** Feature 013: màn hình và item để hỏi `host.itemBlocked` (quyền `operate`). */
  item?: { screen: string; item: string };
}

const lock = (code: LockCode, detail?: string): Lock => ({ code, message: lockText(code, detail) });

/** Feature 013: khóa của nút/phần tử mở popup `popup` (người dùng không được xem popup đó), hoặc null. */
export function popupLock(host: ActionHost | undefined, popup: string): Lock | null {
  const b = host?.popupBlocked?.(popup) ?? null;
  return b ? { code: 'NO_PERMISSION', message: b.message || POPUP_NO_PERMISSION } : null;
}

/** Trả lý do khóa đầu tiên theo thứ tự cố định, hoặc null. UNCERTAIN không khóa. */
export function lockOf(i: LockInput): Lock | null {
  const blocked = i.host.writeBlocked();
  if (blocked) return { code: blocked.code, message: blocked.message || lockText(blocked.code) };
  const session = i.host.session();
  if (!session) return lock('NO_SESSION');
  if (ROLE_RANK[session.role] < ROLE_RANK[i.minRole]) return lock('ROLE', i.minRole);
  const itemBlock = i.item ? (i.host.itemBlocked?.(i.item) ?? null) : null;
  if (itemBlock)
    return { code: itemBlock.code, message: itemBlock.message || lockText(itemBlock.code) };
  if (i.source.connection !== 'live') return lock('LIVE_LOST');
  const info = i.tag ? i.source.info(i.tag) : undefined;
  const state = i.tag ? i.source.get(i.tag) : undefined;
  if (!info || !state || state.quality === 'UNKNOWN') return lock('TAG_UNKNOWN');
  if (info.access !== 'RW' || info.kind === 'calculated') return lock('TAG_READONLY');
  if (state.quality === 'BAD' || state.quality === 'STALE') {
    return lock('QUALITY_BAD', state.reason ? `${state.quality}: ${state.reason}` : state.quality);
  }
  if (state.value === null || state.value === undefined) return lock('NO_VALUE');
  if (i.busy) return lock('BUSY');
  if (i.otherDialog) return lock('OTHER_DIALOG');
  return null;
}
