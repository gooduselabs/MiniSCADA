// Định dạng 0.5 (contracts/project-format-0.5.md §1, §10): hằng số phiên bản và định dạng ghi của Studio cho
// `alarms.json`, `alarm-classes.json` (mỗi khu vực, mỗi alarm, mỗi lớp một dòng gọn; khóa theo thứ tự chuẩn;
// không ghi trường bằng mặc định; cùng đầu vào cùng byte, UTF-8 không BOM, kết thúc bằng một dòng trống).
import type { AlarmClassesFile, AlarmsFile } from './types-05.ts';
import { ALARM_DEFAULTS } from './types-05.ts';

/** Chuỗi phiên bản định dạng của feature alarm (D28). Bản C++: `kProjectFormatAlarms`. */
export const PROJECT_FORMAT_ALARMS = '0.5.0';

type Obj = Record<string, unknown>;
const ALARM_KEYS = [
  'id',
  'type',
  'name',
  'area',
  'tag',
  'device',
  'trigger',
  'on',
  'limits',
  'deadband',
  'class',
  'text',
  'onDelayMs',
  'offDelayMs',
  'enabled',
] as const;
const LIMIT_KEYS = ['value', 'class', 'text'] as const;
const CLASS_KEYS = [
  'id',
  'name',
  'priority',
  'color',
  'blink',
  'requiresAck',
  'ackReturn',
  'sound',
  'chatterLimit',
] as const;

const pick = (o: Obj, keys: readonly string[], skipDefaults: boolean): Obj => {
  const out: Obj = {};
  for (const k of keys) {
    const v = o[k];
    if (v === undefined) continue;
    if (skipDefaults && k in ALARM_DEFAULTS && v === (ALARM_DEFAULTS as Obj)[k]) continue;
    out[k] = v;
  }
  return out;
};

/** Một alarm ở dạng chuẩn (khóa theo thứ tự §3, ngưỡng theo LL, L, H, HH, bỏ giá trị mặc định). */
export function canonicalAlarm(a: Obj): Obj {
  const out = pick(a, ALARM_KEYS, true);
  const lim = a.limits;
  if (lim !== null && typeof lim === 'object' && !Array.isArray(lim)) {
    const l: Obj = {};
    for (const name of ['LL', 'L', 'H', 'HH'])
      if ((lim as Obj)[name] !== undefined) {
        const t = (lim as Obj)[name];
        l[name] = t !== null && typeof t === 'object' ? pick(t as Obj, LIMIT_KEYS, false) : t;
      }
    out.limits = l;
  }
  return out;
}

export function canonicalAlarmClass(c: Obj): Obj {
  return pick(c, CLASS_KEYS, true);
}

/** `alarms.json`: thụt 2 dấu cách ở cấp tệp; mỗi khu vực và mỗi alarm một dòng gọn. */
export function formatAlarmsFile(doc: AlarmsFile): string {
  const lines: string[] = [`  "schemaVersion": ${JSON.stringify(doc.schemaVersion)}`];
  if (doc.areas !== undefined && doc.areas.length > 0)
    lines.push(
      `  "areas": [\n${doc.areas.map((a) => '    ' + JSON.stringify({ id: a.id, name: a.name })).join(',\n')}\n  ]`,
    );
  lines.push(
    doc.alarms.length > 0
      ? `  "alarms": [\n${doc.alarms.map((a) => '    ' + JSON.stringify(canonicalAlarm(a as unknown as Obj))).join(',\n')}\n  ]`
      : '  "alarms": []',
  );
  return `{\n${lines.join(',\n')}\n}\n`;
}

/** `alarm-classes.json`: mỗi lớp một dòng gọn. */
export function formatAlarmClassesFile(doc: AlarmClassesFile): string {
  const classes =
    doc.classes.length > 0
      ? `  "classes": [\n${doc.classes.map((c) => '    ' + JSON.stringify(canonicalAlarmClass(c as unknown as Obj))).join(',\n')}\n  ]`
      : '  "classes": []';
  return `{\n  "schemaVersion": ${JSON.stringify(doc.schemaVersion)},\n${classes}\n}\n`;
}
