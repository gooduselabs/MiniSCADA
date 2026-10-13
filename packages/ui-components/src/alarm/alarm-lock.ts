// Khóa thao tác xác nhận (contracts/ui-alarm.md §7.2, FR-064): lý do khóa theo thứ tự kiểm. Khóa KHÔNG chặn xem: viewer
// vẫn thấy đủ bảng, banner, số đếm (US1 kịch bản 8). Gọi thẳng API khi bị khóa vẫn bị thiết bị từ chối (SC-007).
import { alarmVi } from '../i18n/alarm-vi.ts';
import type { ActionHost, AlarmSource, Role, WriteBlockCode } from '../host/types.ts';

export type AlarmLockCode =
  WriteBlockCode | 'NO_SESSION' | 'ROLE' | 'LIVE_LOST' | 'SHELVED' | 'NOTHING';

export interface AlarmLock {
  code: AlarmLockCode;
  message: string;
}

const RANK: Readonly<Record<Role, number>> = {
  viewer: 0,
  operator: 1,
  engineer: 2,
  administrator: 3,
};

/** Role tối thiểu cho xác nhận, tạm ẩn, gỡ tạm ẩn (bảng quyền của device-api-1.3 §1.1). */
export const hasOperatorRole = (role: Role | undefined): boolean =>
  role !== undefined && RANK[role] >= RANK.operator;

/**
 * Khóa chung của mọi nút thao tác alarm: (1) khóa chung của 007 (`host.writeBlocked()`), (2) chưa đăng nhập,
 * (3) role dưới operator, (4) mất kết nối live. `null`: không khóa. `SHELVED` và `NOTHING` do nơi gọi thêm theo hàng.
 */
export function alarmLock(source: AlarmSource, host: ActionHost): AlarmLock | null {
  const blocked = host.writeBlocked();
  if (blocked) return { code: blocked.code, message: blocked.message };
  const s = host.session();
  if (!s) return { code: 'NO_SESSION', message: alarmVi.lock.NO_SESSION };
  if (!hasOperatorRole(s.role)) return { code: 'ROLE', message: alarmVi.lock.ROLE };
  if (source.status() !== 'live') return { code: 'LIVE_LOST', message: alarmVi.lock.LIVE_LOST };
  return null;
}
