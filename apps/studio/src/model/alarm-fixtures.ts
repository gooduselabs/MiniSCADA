// Dữ liệu mẫu cho test alarm của Studio (feature 009). Không vào bản build: chỉ file *.test.ts import.
import { migrateTo05 } from '@mat/project-schema';
import { full02 } from './test-fixtures.ts';

/** Project 0.5 mẫu: project 0.2 đầy đủ nâng lên 0.5 bằng `migrateTo05` (một lần, như Studio). */
export async function full05(): Promise<Record<string, string>> {
  const r = await migrateTo05(full02());
  if (!r.ok) throw new Error(`migrateTo05: ${JSON.stringify(r.error)}`);
  return r.files;
}

export const SAMPLE_CLASSES = [
  {
    id: 'critical',
    name: 'Khẩn cấp',
    priority: 'critical',
    color: 'red',
    blink: true,
    sound: 'siren',
  },
  {
    id: 'major',
    name: 'Quan trọng',
    priority: 'major',
    color: 'orange',
    blink: true,
    sound: 'double',
  },
  { id: 'minor', name: 'Nhỏ', priority: 'minor', color: 'amber', sound: 'beep' },
  { id: 'advisory', name: 'Lưu ý', priority: 'advisory', color: 'blue', requiresAck: false },
];

export const SAMPLE_ALARMS = [
  {
    id: 'TANK01_LEVEL',
    type: 'limit',
    name: 'Mức bồn 1',
    area: 'bon',
    tag: 'TANK01.LEVEL',
    limits: { H: { value: 80, class: 'minor' }, HH: { value: 90, class: 'critical' } },
    deadband: 2,
    onDelayMs: 3000,
  },
  {
    id: 'PUMP01_FAULT',
    type: 'digital',
    name: 'Bơm 1 lỗi',
    tag: 'PUMP01.FAULT',
    trigger: true,
    class: 'major',
    offDelayMs: 1000,
  },
  {
    id: 'METER1_COMM',
    type: 'quality',
    name: 'Đồng hồ 1 mất tín hiệu',
    tag: 'METER1.P',
    class: 'minor',
    onDelayMs: 2000,
  },
];

/** Như `full05` kèm `alarms.json` (3 alarm: ngưỡng, số, quality), `alarm-classes.json` (bốn lớp) và một khu vực. */
export async function full05WithAlarms(): Promise<Record<string, string>> {
  const files = await full05();
  const project = JSON.parse(files['project.json']!) as Record<string, unknown>;
  project.alarmFile = 'alarms.json';
  project.alarmClassFile = 'alarm-classes.json';
  files['project.json'] = JSON.stringify(project, null, 2) + '\n';
  const v = String(project.schemaVersion);
  files['alarm-classes.json'] =
    JSON.stringify({ schemaVersion: v, classes: SAMPLE_CLASSES }) + '\n';
  files['alarms.json'] =
    JSON.stringify({
      schemaVersion: v,
      areas: [{ id: 'bon', name: 'Bồn nước' }],
      alarms: SAMPLE_ALARMS,
    }) + '\n';
  return files;
}
