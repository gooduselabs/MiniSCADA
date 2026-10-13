// Dữ liệu mẫu cho test alarm (không vào mã chạy thật; chỉ file *.test.ts import).
import type {
  AlarmAreaInfo,
  AlarmClassInfo,
  AlarmCounts,
  AlarmInstance,
  AlarmSnapshot,
} from '../host/types.ts';
import { computeCounts } from '../alarm/alarm-format.ts';

let seq = 0;

export function inst(over: Partial<AlarmInstance> = {}): AlarmInstance {
  const n = ++seq;
  return {
    id: `ALARM_${n}`,
    alarmId: `ALARM_${n}`,
    name: `Alarm ${n}`,
    type: 'digital',
    occurrence: n,
    rev: n,
    state: 'ACTIVE_UNACK',
    class: 'major',
    priority: 'major',
    area: null,
    text: `Nội dung ${n}`,
    valueActive: true,
    qualityActive: 'GOOD',
    tsActive: 1_000_000 + n,
    clockOk: true,
    disabled: false,
    inputBad: false,
    startup: false,
    ...over,
  };
}

export const CLASSES: readonly AlarmClassInfo[] = [
  { id: 'critical', name: 'Khẩn cấp', priority: 'critical', color: 'red', blink: true, requiresAck: true, ackReturn: false, sound: 'siren', chatterLimit: 5 },
  { id: 'major', name: 'Quan trọng', priority: 'major', color: 'orange', blink: true, requiresAck: true, ackReturn: false, sound: 'double', chatterLimit: 5 },
  { id: 'minor', name: 'Nhỏ', priority: 'minor', color: 'amber', blink: false, requiresAck: true, ackReturn: false, sound: 'beep', chatterLimit: 5 },
  { id: 'advisory', name: 'Lưu ý', priority: 'advisory', color: 'blue', blink: false, requiresAck: false, ackReturn: false, sound: 'none', chatterLimit: 5 },
];

export const AREAS: readonly AlarmAreaInfo[] = [
  { id: 'bon', name: 'Bồn' },
  { id: 'dien', name: 'Điện' },
];

export function snap(
  instances: readonly AlarmInstance[],
  over: Partial<AlarmSnapshot> = {},
): AlarmSnapshot {
  const counts: AlarmCounts = over.counts ?? computeCounts(instances);
  return {
    instances,
    classes: CLASSES,
    areas: AREAS,
    counts,
    revision: Math.max(0, ...instances.map((i) => i.rev)),
    ...over,
  };
}
