// Logic trong xem trước Nạp xuống và chip "Ghi PLC" (feature 011, T143; FR-082, FR-083, FR-096; mockup studio-logic.html
// cảnh 3; T007 quyết định 1, 4, 5): hàm thuần. Danh sách Tag mà logic sẽ TỰ ĐỘNG ghi xuống PLC (mục `writes` và luật dùng
// chúng), trạng thái `system/info.logic.writes` của thiết bị đích, cảnh báo W_LOGIC_WRITES_OFF, bắt buộc xác nhận.
import type { LogicDoc, LogicWrite } from '@mat/project-schema';
import type { Role } from '../platform/device-types.ts';
import { deviceSupport, type DeviceInfo } from './device.ts';
import { writesUsage } from './logic-doc.ts';

/** Ghi PLC của logic trên thiết bị: tắt, bật, dừng (administrator), chưa hỗ trợ (runtime cũ), không rõ (chưa hỏi được). */
export type LogicDeviceWrites = 'off' | 'on' | 'stopped' | 'unsupported' | 'unknown';

export function logicDeviceWrites(info: DeviceInfo | null | undefined): LogicDeviceWrites {
  if (!info) return 'unknown';
  const s = deviceSupport(info);
  return s.logic ? s.logicWrites : 'unsupported';
}

export interface LogicChip {
  state: Exclude<LogicDeviceWrites, 'unknown'> | 'unknown';
  /** "Dừng ghi của logic…" dùng được. */
  canStop: boolean;
  /** Lý do khóa lệnh dừng: không phải administrator, ghi không đang bật, thiết bị không hỗ trợ. */
  stopBlocked: 'role' | 'not-on' | 'unsupported' | null;
  /** Bật lại không có trong Studio: chỉ root sửa runtime.json (API trả 403 LOGIC_ENABLE_ROOT_ONLY). */
  enableBlocked: 'LOGIC_ENABLE_ROOT_ONLY';
}

export function logicChip(info: DeviceInfo | null | undefined, role: Role | null): LogicChip {
  const state = logicDeviceWrites(info);
  const stopBlocked =
    state === 'unsupported' || state === 'unknown'
      ? 'unsupported'
      : state !== 'on'
        ? 'not-on'
        : role !== 'administrator'
          ? 'role'
          : null;
  return {
    state,
    canStop: stopBlocked === null,
    stopBlocked,
    enableBlocked: 'LOGIC_ENABLE_ROOT_ONLY',
  };
}

export interface AutoWrite {
  write: string;
  tag: string;
  allowed: LogicWrite['allowed'];
  minIntervalMs: number | null;
  maxPerHour: number | null;
  /** Luật có hành động write/pulse qua mục này. */
  rules: string[];
  /** Có hành động xung qua mục này: độ dài xung (ms) lớn nhất. */
  pulseMs: number | null;
}

export interface LogicDeployPreview {
  writes: AutoWrite[];
  /** Số Tag thiết bị khác nhau logic sẽ ghi. */
  tagCount: number;
  device: LogicDeviceWrites;
  /** W_LOGIC_WRITES_OFF khi thiết bị đích đang tắt ghi PLC của logic. */
  warning: 'W_LOGIC_WRITES_OFF' | null;
  /** Có ghi tự động: phải tích "Tôi đã xem danh sách" (cả khi thiết bị đang tắt ghi). */
  needsAck: boolean;
}

/** `null` khi project không có logic hoặc logic không khai mục `writes` nào. */
export function logicDeployPreview(
  doc: LogicDoc | null | undefined,
  info: DeviceInfo | null | undefined,
): LogicDeployPreview | null {
  const list = doc?.writes ?? [];
  if (!list.length) return null;
  const usage = writesUsage(doc);
  const pulse = new Map<string, number>();
  for (const r of doc?.rules ?? [])
    for (const a of [...(r.onRise ?? []), ...(r.onFall ?? [])])
      if (a.do === 'pulse' && typeof a.write === 'string' && typeof a.ms === 'number')
        pulse.set(a.write, Math.max(pulse.get(a.write) ?? 0, a.ms));
  const writes = list.map((w): AutoWrite => ({
    write: w.id,
    tag: w.tag,
    allowed: w.allowed,
    minIntervalMs: typeof w.minIntervalMs === 'number' ? w.minIntervalMs : null,
    maxPerHour: typeof w.maxPerHour === 'number' ? w.maxPerHour : null,
    rules: usage.get(w.id) ?? [],
    pulseMs: pulse.get(w.id) ?? null,
  }));
  const device = logicDeviceWrites(info);
  return {
    writes,
    tagCount: new Set(writes.map((w) => w.tag)).size,
    device,
    warning: device === 'off' ? 'W_LOGIC_WRITES_OFF' : null,
    needsAck: true,
  };
}
