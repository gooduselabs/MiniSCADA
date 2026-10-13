// Định dạng 0.5 (specs/009-alarms/data-model.md §1-§2, contracts/project-format-0.5.md): hai file tùy chọn
// `alarms.json` và `alarm-classes.json`, khai bằng `alarmFile`, `alarmClassFile` ở project.json.
import type { LoadedProject03, Navigation, Project03 } from './types-03.ts';

/** Bốn ngưỡng của alarm `limit`, theo thứ tự tăng dần của giá trị (LL < L < H < HH). */
export const ALARM_THRESHOLDS = ['LL', 'L', 'H', 'HH'] as const;
export type AlarmThresholdName = (typeof ALARM_THRESHOLDS)[number];
export const ALARM_TYPES = ['digital', 'limit', 'quality'] as const;
export type AlarmType = (typeof ALARM_TYPES)[number];
export const ALARM_PRIORITIES = ['critical', 'major', 'minor', 'advisory'] as const;
export type AlarmPriority = (typeof ALARM_PRIORITIES)[number];
/** Tám token màu của thiết kế (D24). */
export const ALARM_COLORS = [
  'red',
  'orange',
  'amber',
  'blue',
  'purple',
  'teal',
  'gray',
  'green',
] as const;
export type AlarmColor = (typeof ALARM_COLORS)[number];
export const ALARM_SOUNDS = ['none', 'beep', 'double', 'siren'] as const;
export type AlarmSound = (typeof ALARM_SOUNDS)[number];
export type AlarmOn = 'bad' | 'notGood';

/** Mặc định không ghi ra file (contract §10). */
export const ALARM_DEFAULTS = {
  enabled: true,
  onDelayMs: 0,
  offDelayMs: 0,
  deadband: 0,
  on: 'bad',
  blink: false,
  requiresAck: true,
  ackReturn: false,
  sound: 'none',
  chatterLimit: 5,
} as const;

export interface AlarmArea {
  id: string;
  name: string;
}

interface AlarmBase {
  id: string;
  name: string;
  area?: string;
  text?: string;
  enabled?: boolean;
  onDelayMs?: number;
  offDelayMs?: number;
}

export interface DigitalAlarmDef extends AlarmBase {
  type: 'digital';
  tag: string;
  trigger: boolean;
  class: string;
}

export interface AlarmLimitDef {
  value: number;
  class: string;
  text?: string;
}

export interface LimitAlarmDef extends AlarmBase {
  type: 'limit';
  tag: string;
  limits: Partial<Record<AlarmThresholdName, AlarmLimitDef>>;
  deadband?: number;
}

export interface QualityAlarmDef extends AlarmBase {
  type: 'quality';
  /** Đúng một trong `tag`, `device`. */
  tag?: string;
  device?: string;
  on?: AlarmOn;
  class: string;
}

export type AlarmDef = DigitalAlarmDef | LimitAlarmDef | QualityAlarmDef;

export interface AlarmsFile {
  schemaVersion: string;
  areas?: AlarmArea[];
  alarms: AlarmDef[];
}

export interface AlarmClassDef {
  id: string;
  name: string;
  priority: AlarmPriority;
  color: AlarmColor;
  blink?: boolean;
  requiresAck?: boolean;
  ackReturn?: boolean;
  sound?: AlarmSound;
  chatterLimit?: number;
}

export interface AlarmClassesFile {
  schemaVersion: string;
  classes: AlarmClassDef[];
}

export type Project05 = Omit<Project03, 'navigation'> & {
  alarmFile?: string;
  alarmClassFile?: string;
  navigation?: Navigation & { alarms?: boolean };
};

/** Project 0.5 đã nạp và qua kiểm tra: như 0.3 cộng hai file alarm (khi project khai). */
export interface LoadedProject05 extends Omit<LoadedProject03, 'project'> {
  project: Project05;
  alarms?: AlarmsFile;
  alarmClasses?: AlarmClassesFile;
}
