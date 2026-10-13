// Luật của `alarms.json` và `alarm-classes.json` (contracts/project-format-0.5.md §5, §6). Bản C++ ở
// core/project-manager/alarm_rules.cpp cài CÙNG luật, cùng mã, cùng vị trí (`file`, `path`); vector chung ở
// tests/project-vectors (ca `v05-*`). Kiểm cấu trúc làm tay (không qua JSON Schema) để mã lỗi và vị trí đúng
// từng trường như contract; schemas/alarms.schema.json là mô tả cho công cụ ngoài.
import type { ErrorCode, Issue, WarningCode } from './codes.ts';
import { ALARM_COLORS, ALARM_PRIORITIES, ALARM_SOUNDS, ALARM_THRESHOLDS } from './types-05.ts';
import type { ConnectionsConfig, TagV1 } from './types-02.ts';

/** Trần số instance, số khu vực, số lớp, cỡ file, độ dài chuỗi (contract §5). */
export const ALARM_LIMITS = {
  instances: 500,
  warnInstances: 200,
  areas: 64,
  classes: 16,
  fileBytes: 512 * 1024,
  textChars: 200,
  nameChars: 80,
  areaNameChars: 40,
  className: 40,
  maxDelayMs: 86_400_000,
} as const;

const ALARM_ID_RE = /^[A-Za-z][A-Za-z0-9_]{1,47}$/;
const AREA_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CLASS_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const TEXT_TOKENS = new Set([
  'name',
  'tag',
  'value',
  'unit',
  'limit',
  'limitName',
  'area',
  'reason',
]);
const COMMON_KEYS = ['id', 'type', 'name', 'area', 'text', 'enabled', 'onDelayMs', 'offDelayMs'];
const TYPE_KEYS: Record<string, readonly string[]> = {
  digital: [...COMMON_KEYS, 'tag', 'trigger', 'class'],
  limit: [...COMMON_KEYS, 'tag', 'limits', 'deadband'],
  quality: [...COMMON_KEYS, 'tag', 'device', 'on', 'class'],
};
const ALL_ALARM_KEYS = new Set(Object.values(TYPE_KEYS).flat());
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
];
const INTEGER_TYPES = new Set(['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64']);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Số điểm mã Unicode (như bản C++ đếm byte không phải byte tiếp nối UTF-8). */
const cpLen = (s: string): number => [...s].length;
const esc = (k: string): string => k.replace(/~/g, '~0').replace(/\//g, '~1');

/** Mọi thẻ `{...}` của mẫu `text` hợp lệ và `{`, `}` khớp nhau. */
export function alarmTextTokensValid(s: string): boolean {
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '}') return false;
    if (c === '{') {
      const j = s.indexOf('}', i + 1);
      if (j < 0) return false;
      const inner = s.slice(i + 1, j);
      if (!TEXT_TOKENS.has(inner) && !/^value:[0-6]$/.test(inner)) return false;
      i = j + 1;
    } else i++;
  }
  return true;
}

export interface AlarmRuleInput {
  /** Tên file đã khai ở project.json (có thì file đã được đọc; `undefined` = không khai). */
  alarmFile?: string;
  alarmClassFile?: string;
  schemaVersion: string;
  /** JSON đã parse; `undefined` khi không khai hoặc không đọc được (đã có lỗi E_JSON/E_FILE_MISSING). */
  alarmsDoc?: unknown;
  alarmClassesDoc?: unknown;
  /** Số byte của file alarm (kiểm trần 512 KiB). */
  alarmsBytes?: number;
  /** `undefined`: tags.json không nạp được, bỏ qua mọi tham chiếu Tag. */
  tags?: ReadonlyArray<TagV1>;
  /** `undefined` không khai `connectionFile`: tập thiết bị rỗng. Có khai mà lỗi: `connectionsFailed`. */
  connections?: ConnectionsConfig;
  connectionsFailed?: boolean;
}

export interface AlarmRuleResult {
  errors: Issue[];
  warnings: Issue[];
  /** Số instance đang hoạt động (alarm `enabled` !== false; mỗi ngưỡng một instance). */
  instances: number;
}

const byIssue = (a: Issue, b: Issue): number =>
  a.file < b.file
    ? -1
    : a.file > b.file
      ? 1
      : a.path < b.path
        ? -1
        : a.path > b.path
          ? 1
          : a.code < b.code
            ? -1
            : a.code > b.code
              ? 1
              : 0;

class Sink {
  errors: Issue[] = [];
  warnings: Issue[] = [];
  private seen = new Set<string>();
  err(code: ErrorCode, file: string, path: string, message: string): void {
    const k = `${code}\u0000${file}\u0000${path}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    this.errors.push({ code, file, path, message });
  }
  warn(code: WarningCode, file: string, path: string, message: string): void {
    const k = `${code}\u0000${file}\u0000${path}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    this.warnings.push({ code, file, path, message });
  }
}

const isInt = (v: unknown, lo: number, hi: number): boolean =>
  typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= lo && v <= hi;

/** Kiểm cả hai file. Chỉ chạy các luật cần file đã nạp được. */
export function runAlarmRules(input: AlarmRuleInput): AlarmRuleResult {
  const out = new Sink();
  let instances = 0;

  // ---- alarm-classes.json ----
  let classes: Map<string, Obj> | undefined =
    input.alarmClassFile === undefined ? new Map() : undefined;
  if (input.alarmClassFile !== undefined && input.alarmClassesDoc !== undefined)
    classes = checkClasses(out, input.alarmClassFile, input.alarmClassesDoc, input.schemaVersion);

  // ---- alarms.json ----
  if (input.alarmFile !== undefined && input.alarmsDoc !== undefined) {
    const tagInfo = input.tags
      ? new Map(input.tags.map((t) => [t.id, t] as const).reverse())
      : undefined;
    let devices: Set<string> | undefined;
    if (input.connectionsFailed !== true) {
      devices = new Set();
      for (const ch of input.connections?.channels ?? [])
        for (const d of ch.devices ?? []) devices.add(d.id);
    }
    instances = checkAlarms(
      out,
      input.alarmFile,
      input.alarmsDoc,
      input.schemaVersion,
      input.alarmsBytes,
      tagInfo,
      devices,
      classes,
      input.tags,
    );
  }

  out.errors.sort(byIssue);
  out.warnings.sort(byIssue);
  return { errors: out.errors, warnings: out.warnings, instances };
}

function checkVersion(out: Sink, file: string, doc: Obj, project: string): void {
  const v = doc.schemaVersion;
  if (typeof v !== 'string')
    out.err('E_SCHEMA', file, '/schemaVersion', 'schemaVersion is required');
  else if (v !== project)
    out.err(
      'E_SCHEMA_VERSION',
      file,
      '/schemaVersion',
      `schemaVersion ${v} differs from project.json (${project}): every file must match`,
    );
}

/** Trả bảng lớp theo id; `undefined` khi file hỏng cấp tệp (E_SCHEMA): bỏ qua tham chiếu lớp. */
function checkClasses(
  out: Sink,
  file: string,
  doc: unknown,
  project: string,
): Map<string, Obj> | undefined {
  if (!isObj(doc)) {
    out.err('E_SCHEMA', file, '', 'alarm-classes.json must be an object');
    return undefined;
  }
  checkVersion(out, file, doc, project);
  for (const k of Object.keys(doc))
    if (k !== 'schemaVersion' && k !== 'classes')
      out.err('E_ALARM_CLASS_FIELD', file, `/${esc(k)}`, `unknown key '${k}'`);
  const list = doc.classes;
  if (!Array.isArray(list)) {
    out.err('E_SCHEMA', file, '/classes', 'classes must be an array');
    return undefined;
  }
  if (list.length < 1 || list.length > ALARM_LIMITS.classes)
    out.err('E_ALARM_CLASS_COUNT', file, '/classes', 'classes must have 1 to 16 entries');
  const map = new Map<string, Obj>();
  list.forEach((c, i) => {
    const p = `/classes/${i}`;
    if (!isObj(c)) {
      out.err('E_ALARM_CLASS_FIELD', file, p, 'class must be an object');
      return;
    }
    for (const k of Object.keys(c))
      if (!CLASS_KEYS.includes(k))
        out.err('E_ALARM_CLASS_FIELD', file, `${p}/${esc(k)}`, `unknown key '${k}'`);
    const id = c.id;
    if (typeof id !== 'string' || !CLASS_ID_RE.test(id))
      out.err('E_ALARM_CLASS_FIELD', file, `${p}/id`, 'class id must match ^[a-z][a-z0-9_]{1,31}$');
    if (typeof id === 'string') {
      if (map.has(id)) out.err('E_ALARM_CLASS_DUP', file, `${p}/id`, `class '${id}' is duplicated`);
      else map.set(id, c);
    }
    if (typeof c.name !== 'string' || cpLen(c.name) < 1 || cpLen(c.name) > ALARM_LIMITS.className)
      out.err('E_ALARM_CLASS_FIELD', file, `${p}/name`, 'name must have 1 to 40 characters');
    const oneOf = (key: string, set: readonly string[], required: boolean) => {
      const v = c[key];
      if (v === undefined ? required : typeof v !== 'string' || !set.includes(v))
        out.err('E_ALARM_CLASS_FIELD', file, `${p}/${key}`, `${key} is not allowed`);
    };
    oneOf('priority', ALARM_PRIORITIES, true);
    oneOf('color', ALARM_COLORS, true);
    oneOf('sound', ALARM_SOUNDS, false);
    for (const key of ['blink', 'requiresAck', 'ackReturn'])
      if (c[key] !== undefined && typeof c[key] !== 'boolean')
        out.err('E_ALARM_CLASS_FIELD', file, `${p}/${key}`, `${key} must be a boolean`);
    if (c.chatterLimit !== undefined && !isInt(c.chatterLimit, 0, 100))
      out.err(
        'E_ALARM_FIELD',
        file,
        `${p}/chatterLimit`,
        'chatterLimit must be an integer 0 to 100',
      );
    if (c.priority === 'critical' && c.requiresAck === false)
      out.warn(
        'W_ALARM_NO_ACK_CRITICAL',
        file,
        `${p}/requiresAck`,
        'a critical class does not require acknowledgement',
      );
  });
  return map;
}

function checkAlarms(
  out: Sink,
  file: string,
  doc: unknown,
  project: string,
  bytes: number | undefined,
  tags: Map<string, TagV1> | undefined,
  devices: Set<string> | undefined,
  classes: Map<string, Obj> | undefined,
  tagList: ReadonlyArray<TagV1> | undefined,
): number {
  if (!isObj(doc)) {
    out.err('E_SCHEMA', file, '', 'alarms.json must be an object');
    return 0;
  }
  checkVersion(out, file, doc, project);
  for (const k of Object.keys(doc))
    if (k !== 'schemaVersion' && k !== 'areas' && k !== 'alarms')
      out.err('E_ALARM_FIELD', file, `/${esc(k)}`, `unknown key '${k}'`);

  // khu vực
  let areaIds: Set<string> | undefined = new Set();
  if (doc.areas !== undefined) {
    if (!Array.isArray(doc.areas)) {
      out.err('E_ALARM_FIELD', file, '/areas', 'areas must be an array');
      areaIds = undefined;
    } else {
      if (doc.areas.length > ALARM_LIMITS.areas)
        out.err('E_ALARM_AREA_COUNT', file, '/areas', 'more than 64 areas');
      doc.areas.forEach((a: unknown, i: number) => {
        const p = `/areas/${i}`;
        if (!isObj(a)) {
          out.err('E_ALARM_FIELD', file, p, 'area must be an object');
          return;
        }
        for (const k of Object.keys(a))
          if (k !== 'id' && k !== 'name')
            out.err('E_ALARM_FIELD', file, `${p}/${esc(k)}`, `unknown key '${k}'`);
        if (typeof a.id !== 'string' || !AREA_ID_RE.test(a.id))
          out.err('E_ALARM_FIELD', file, `${p}/id`, 'area id must match ^[a-z0-9][a-z0-9-]{0,31}$');
        if (typeof a.id === 'string') {
          if (areaIds!.has(a.id))
            out.err('E_ALARM_AREA_DUP', file, `${p}/id`, `area '${a.id}' is duplicated`);
          else areaIds!.add(a.id);
        }
        if (
          typeof a.name !== 'string' ||
          cpLen(a.name) < 1 ||
          cpLen(a.name) > ALARM_LIMITS.areaNameChars
        )
          out.err('E_ALARM_FIELD', file, `${p}/name`, 'area name must have 1 to 40 characters');
      });
    }
  }

  const list = doc.alarms;
  if (!Array.isArray(list)) {
    out.err('E_SCHEMA', file, '/alarms', 'alarms must be an array');
    return 0;
  }

  const deviceHasTag = (id: string): boolean =>
    (tagList ?? []).some(
      (t) => t.kind === 'external' && (t.source as { device?: string } | undefined)?.device === id,
    );
  const seenIds = new Set<string>();
  let instances = 0;

  const checkText = (v: unknown, p: string) => {
    if (typeof v !== 'string') {
      out.err('E_ALARM_FIELD', file, p, 'text must be a string');
      return;
    }
    if (cpLen(v) > ALARM_LIMITS.textChars)
      out.err('E_ALARM_TEXT_LEN', file, p, 'text is longer than 200 characters');
    if (!alarmTextTokensValid(v))
      out.err('E_ALARM_TEXT_TOKEN', file, p, 'text has an unknown or unbalanced token');
  };
  const checkClassRef = (v: unknown, p: string) => {
    if (typeof v !== 'string' || v === '')
      out.err('E_ALARM_CLASS_REF', file, p, 'class is required');
    else if (classes !== undefined && !classes.has(v))
      out.err('E_ALARM_CLASS_REF', file, p, `class '${v}' does not exist`);
  };
  /** `kind`: loại kiểm kiểu Tag; undefined = mọi kiểu (quality). */
  const checkTagRef = (v: unknown, p: string, kind?: 'digital' | 'limit') => {
    if (v === undefined) {
      out.err('E_ALARM_TAG_REF', file, p, 'tag is required');
      return;
    }
    if (typeof v !== 'string') {
      out.err('E_ALARM_FIELD', file, p, 'tag must be a string');
      return;
    }
    if (tags === undefined) return;
    const t = tags.get(v);
    if (!t) {
      out.err('E_ALARM_TAG_REF', file, p, `tag '${v}' does not exist`);
      return;
    }
    if (kind === 'digital' && !(t.type === 'BOOL' || INTEGER_TYPES.has(t.type)))
      out.err(
        'E_ALARM_TAG_TYPE',
        file,
        p,
        `a digital alarm needs a BOOL or integer Tag, '${v}' is ${t.type}`,
      );
    if (kind === 'limit' && (t.type === 'BOOL' || t.type === 'STRING'))
      out.err(
        'E_ALARM_TAG_TYPE',
        file,
        p,
        `a limit alarm needs a numeric Tag, '${v}' is ${t.type}`,
      );
  };

  list.forEach((a: unknown, i: number) => {
    const p = `/alarms/${i}`;
    if (!isObj(a)) {
      out.err('E_ALARM_FIELD', file, p, 'alarm must be an object');
      return;
    }
    const type =
      typeof a.type === 'string' && Object.prototype.hasOwnProperty.call(TYPE_KEYS, a.type)
        ? (a.type as 'digital' | 'limit' | 'quality')
        : undefined;
    if (type === undefined)
      out.err('E_ALARM_TYPE', file, `${p}/type`, 'type must be digital, limit or quality');
    for (const k of Object.keys(a))
      if (!(type ? TYPE_KEYS[type]! : [...ALL_ALARM_KEYS]).includes(k))
        out.err('E_ALARM_FIELD', file, `${p}/${esc(k)}`, `unknown key '${k}'`);

    if (typeof a.id !== 'string' || !ALARM_ID_RE.test(a.id))
      out.err('E_ALARM_ID_FORMAT', file, `${p}/id`, 'id must match ^[A-Za-z][A-Za-z0-9_]{1,47}$');
    else if (seenIds.has(a.id))
      out.err('E_ALARM_ID_DUP', file, `${p}/id`, `alarm '${a.id}' is duplicated`);
    else seenIds.add(a.id);

    if (typeof a.name !== 'string' || cpLen(a.name) < 1 || cpLen(a.name) > ALARM_LIMITS.nameChars)
      out.err('E_ALARM_FIELD', file, `${p}/name`, 'name must have 1 to 80 characters');
    if (a.area !== undefined) {
      if (typeof a.area !== 'string')
        out.err('E_ALARM_FIELD', file, `${p}/area`, 'area must be a string');
      else if (areaIds !== undefined && !areaIds.has(a.area))
        out.err('E_ALARM_AREA_REF', file, `${p}/area`, `area '${a.area}' does not exist`);
    }
    if (a.enabled !== undefined && typeof a.enabled !== 'boolean')
      out.err('E_ALARM_FIELD', file, `${p}/enabled`, 'enabled must be a boolean');
    for (const k of ['onDelayMs', 'offDelayMs'])
      if (a[k] !== undefined && !isInt(a[k], 0, ALARM_LIMITS.maxDelayMs))
        out.err('E_ALARM_DELAY_RANGE', file, `${p}/${k}`, `${k} must be an integer 0 to 86400000`);
    if (a.text !== undefined) checkText(a.text, `${p}/text`);

    let count = 0;
    if (type === 'digital') {
      checkTagRef(a.tag, `${p}/tag`, 'digital');
      if (typeof a.trigger !== 'boolean')
        out.err('E_ALARM_TRIGGER', file, `${p}/trigger`, 'trigger must be a boolean');
      checkClassRef(a.class, `${p}/class`);
      count = 1;
    } else if (type === 'quality') {
      const hasTag = a.tag !== undefined;
      const hasDevice = a.device !== undefined;
      if (hasTag === hasDevice)
        out.err(
          'E_ALARM_DEVICE_REF',
          file,
          `${p}/device`,
          'a quality alarm needs exactly one of tag, device',
        );
      if (hasTag) checkTagRef(a.tag, `${p}/tag`);
      if (hasDevice) {
        if (typeof a.device !== 'string')
          out.err('E_ALARM_FIELD', file, `${p}/device`, 'device must be a string');
        else if (devices !== undefined) {
          if (!devices.has(a.device))
            out.err(
              'E_ALARM_DEVICE_REF',
              file,
              `${p}/device`,
              `device '${a.device}' does not exist`,
            );
          else if (tags !== undefined && !deviceHasTag(a.device))
            out.warn(
              'W_ALARM_DEVICE_EMPTY',
              file,
              `${p}/device`,
              `device '${a.device}' has no Tag read from it`,
            );
        }
      }
      if (a.on !== undefined && a.on !== 'bad' && a.on !== 'notGood')
        out.err('E_ALARM_ON', file, `${p}/on`, 'on must be bad or notGood');
      checkClassRef(a.class, `${p}/class`);
      count = 1;
    } else if (type === 'limit') {
      checkTagRef(a.tag, `${p}/tag`, 'limit');
      const lim = a.limits;
      const names = isObj(lim) ? Object.keys(lim) : [];
      if (
        !isObj(lim) ||
        names.length === 0 ||
        names.some((k) => !(ALARM_THRESHOLDS as readonly string[]).includes(k))
      )
        out.err('E_ALARM_LIMIT_NONE', file, `${p}/limits`, 'limits needs 1 to 4 of LL, L, H, HH');
      const present: Array<{ name: string; value?: number }> = [];
      if (isObj(lim))
        for (const name of ALARM_THRESHOLDS) {
          if (!(name in lim)) continue;
          const t = lim[name];
          const lp = `${p}/limits/${name}`;
          if (!isObj(t)) {
            out.err('E_ALARM_FIELD', file, lp, 'threshold must be an object');
            present.push({ name });
            continue;
          }
          for (const k of Object.keys(t))
            if (k !== 'value' && k !== 'class' && k !== 'text')
              out.err('E_ALARM_FIELD', file, `${lp}/${esc(k)}`, `unknown key '${k}'`);
          const ok = typeof t.value === 'number' && Number.isFinite(t.value);
          if (!ok)
            out.err('E_ALARM_LIMIT_ORDER', file, `${lp}/value`, 'value must be a finite number');
          present.push(ok ? { name, value: t.value as number } : { name });
          checkClassRef(t.class, `${lp}/class`);
          if (t.text !== undefined) checkText(t.text, `${lp}/text`);
        }
      count = present.length;
      // thứ tự LL < L < H < HH giữa các ngưỡng có giá trị hợp lệ; lỗi báo ở ngưỡng thấp của cặp
      const valued = present.filter((x) => x.value !== undefined);
      let orderOk = valued.length === present.length;
      for (let k = 0; k + 1 < valued.length; k++)
        if (!(valued[k]!.value! < valued[k + 1]!.value!)) {
          orderOk = false;
          out.err(
            'E_ALARM_LIMIT_ORDER',
            file,
            `${p}/limits/${valued[k]!.name}/value`,
            'thresholds must satisfy LL < L < H < HH',
          );
        }
      const db = a.deadband;
      if (db !== undefined) {
        if (typeof db !== 'number' || !Number.isFinite(db) || db < 0)
          out.err(
            'E_ALARM_DEADBAND',
            file,
            `${p}/deadband`,
            'deadband must be a finite number >= 0',
          );
        else if (orderOk)
          for (let k = 0; k + 1 < valued.length; k++)
            if (!(db < valued[k + 1]!.value! - valued[k]!.value!))
              out.err(
                'E_ALARM_DEADBAND',
                file,
                `${p}/deadband`,
                'deadband must be smaller than the gap to the next threshold',
              );
      }
      if (
        (a.deadband === undefined || a.deadband === 0) &&
        (a.onDelayMs === undefined || a.onDelayMs === 0) &&
        (a.offDelayMs === undefined || a.offDelayMs === 0)
      )
        out.warn(
          'W_ALARM_CHATTER_RISK',
          file,
          p,
          'no deadband and no delay: the alarm may chatter',
        );
    }
    if (a.enabled !== false) instances += count;
  });

  if (instances > ALARM_LIMITS.instances)
    out.err(
      'E_ALARM_COUNT',
      file,
      '/alarms',
      `more than ${ALARM_LIMITS.instances} alarm instances`,
    );
  if (instances > ALARM_LIMITS.warnInstances)
    out.warn(
      'W_ALARM_COUNT_HIGH',
      file,
      '/alarms',
      `more than ${ALARM_LIMITS.warnInstances} alarm instances`,
    );
  if (bytes !== undefined && bytes > ALARM_LIMITS.fileBytes)
    out.err('E_ALARM_COUNT', file, '/alarms', 'alarms.json is larger than 512 KiB');
  return instances;
}
