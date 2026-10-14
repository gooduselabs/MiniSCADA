// Tài liệu alarm của Studio (feature 009, T073, FR-074, FR-075, FR-082, FR-084; contract studio-alarm-editor §3, §6, §9):
// một tài liệu bất biến cho hai file `alarms.json`, `alarm-classes.json` (khu vực, alarm, lớp); ô của lưới ↔ trường của
// alarm; thao tác (sửa ô, điền xuống, dán, thêm, xóa, nhân bản); "Tạo alarm cho Tag…"; tham chiếu chéo (đổi tên Tag, dùng
// lớp, khu vực); ánh xạ Issue của bộ kiểm tra → ô. Hàm thuần, không DOM. Chữ sai kiểu vẫn được giữ nguyên trong tài liệu
// để bộ kiểm tra (cùng luật với runtime) báo lỗi tại ô thay vì chặn người dùng khi dán.
import {
  ALARM_COLORS,
  ALARM_LIMITS,
  ALARM_PRIORITIES,
  ALARM_SOUNDS,
  ALARM_THRESHOLDS,
  type AlarmArea,
  type AlarmClassDef,
  type AlarmClassesFile,
  type AlarmColor,
  type AlarmDef,
  type AlarmLimitDef,
  type AlarmPriority,
  type AlarmSound,
  type AlarmThresholdName,
  type AlarmsFile,
  type Issue,
  type TagV1,
} from '@mat/project-schema';
import { fold, t } from '../i18n/index.ts';
import type { ProjectEdit } from './project-doc.ts';

// ---------------------------------------------------------------------------------------------
// Tài liệu

export interface AlarmDoc {
  readonly areas: readonly AlarmArea[];
  readonly alarms: readonly AlarmDef[];
  readonly classes: readonly AlarmClassDef[];
}

export const EMPTY_ALARM_DOC: AlarmDoc = { areas: [], alarms: [], classes: [] };

type Obj = Record<string, unknown>;
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const asObj = (a: unknown): Obj => a as Obj;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Tài liệu từ hai file của project (thiếu file là rỗng). */
export function alarmDocOf(files: {
  alarms?: AlarmsFile | null;
  alarmClasses?: AlarmClassesFile | null;
}): AlarmDoc {
  return {
    areas: clone(files.alarms?.areas ?? []),
    alarms: clone(files.alarms?.alarms ?? []),
    classes: clone(files.alarmClasses?.classes ?? []),
  };
}

/** Bốn lớp mặc định của project mới (data-model §2, mockup). */
export function defaultClasses(): AlarmClassDef[] {
  return [
    {
      id: 'critical',
      name: t('alarm.class.default.critical'),
      priority: 'critical',
      color: 'red',
      blink: true,
      requiresAck: true,
      sound: 'siren',
    },
    {
      id: 'major',
      name: t('alarm.class.default.major'),
      priority: 'major',
      color: 'orange',
      blink: true,
      requiresAck: true,
      sound: 'double',
    },
    {
      id: 'minor',
      name: t('alarm.class.default.minor'),
      priority: 'minor',
      color: 'amber',
      blink: false,
      requiresAck: true,
      sound: 'beep',
    },
    {
      id: 'advisory',
      name: t('alarm.class.default.advisory'),
      priority: 'advisory',
      color: 'blue',
      blink: false,
      requiresAck: false,
      sound: 'none',
    },
  ];
}

/**
 * Sửa đổi project để đưa tài liệu `base` thành `next` (chỉ phần đổi). Khi có alarm mà chưa có lớp nào thì thêm bốn lớp
 * mặc định (tránh E_ALARM_CLASS_REF). `version` là `schemaVersion` của project (file mới phải khớp). `hadFiles` cho biết
 * file đã có (không tạo file rỗng khi chưa có nội dung đầu tiên).
 */
export function docEdits(
  base: AlarmDoc,
  next: AlarmDoc,
  version: string,
  hadFiles: { alarms: boolean; classes: boolean },
): ProjectEdit[] {
  const edits: ProjectEdit[] = [];
  let classes = next.classes;
  if (next.alarms.length > 0 && classes.length === 0) classes = defaultClasses();
  const alarmsChanged =
    !same(base.areas, next.areas) || !same(base.alarms, next.alarms) || !hadFiles.alarms;
  const hasContent = next.alarms.length > 0 || next.areas.length > 0;
  if (alarmsChanged && (hadFiles.alarms || hasContent)) {
    const doc: AlarmsFile = {
      schemaVersion: version,
      ...(next.areas.length > 0 ? { areas: clone([...next.areas]) } : {}),
      alarms: clone([...next.alarms]),
    };
    edits.push({ kind: 'alarmsSet', doc });
  }
  const classesChanged = !same(base.classes, classes) || (!hadFiles.classes && classes.length > 0);
  if (classesChanged && (hadFiles.classes || classes.length > 0))
    edits.push({
      kind: 'alarmClassesSet',
      doc: { schemaVersion: version, classes: clone([...classes]) },
    });
  return edits;
}

/** Số instance: mỗi alarm số hoặc quality một, mỗi ngưỡng của alarm ngưỡng một; alarm tắt không tính. */
export function instanceCount(alarms: readonly AlarmDef[]): number {
  let n = 0;
  for (const a of alarms) {
    if (a.enabled === false) continue;
    if (a.type === 'limit') n += Object.keys(a.limits ?? {}).length;
    else n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------------------------
// Ngữ cảnh: Tag, thiết bị

export interface TagLite {
  id: string;
  type: string;
  kind?: string;
  unit?: string;
  min?: number;
  max?: number;
  limits?: { min?: number; max?: number };
}

export const tagLiteOf = (x: TagV1): TagLite => ({
  id: x.id,
  type: x.type,
  ...(x.kind !== undefined ? { kind: x.kind } : {}),
  ...(x.unit !== undefined ? { unit: x.unit } : {}),
  ...(x.min !== undefined ? { min: x.min } : {}),
  ...(x.max !== undefined ? { max: x.max } : {}),
  ...(x.limits ? { limits: { ...x.limits } } : {}),
});

export interface AlarmCtx {
  tags: ReadonlyMap<string, TagLite>;
  devices: ReadonlySet<string>;
}

export const EMPTY_CTX: AlarmCtx = { tags: new Map(), devices: new Set() };

export function ctxOf(tags: readonly TagV1[], deviceIds: Iterable<string>): AlarmCtx {
  return {
    tags: new Map(tags.map((x) => [x.id, tagLiteOf(x)] as const)),
    devices: new Set(deviceIds),
  };
}

const INTEGER = new Set(['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64']);
/** Tag hợp loại alarm (luật của validator): số cần BOOL hoặc nguyên, ngưỡng cần số, quality mọi kiểu. */
export function tagFits(tag: TagLite, type: 'digital' | 'limit' | 'quality'): boolean {
  if (type === 'digital') return tag.type === 'BOOL' || INTEGER.has(tag.type);
  if (type === 'limit') return tag.type !== 'BOOL' && tag.type !== 'STRING';
  return true;
}

// ---------------------------------------------------------------------------------------------
// Cột và ô

export const ALARM_COLS = [
  'id',
  'name',
  'type',
  'tag',
  'cond',
  'HH',
  'H',
  'L',
  'LL',
  'deadband',
  'onDelay',
  'offDelay',
  'class',
  'area',
  'text',
  'enabled',
] as const;
export type AlarmCol = (typeof ALARM_COLS)[number];
export const isAlarmCol = (s: string): s is AlarmCol =>
  (ALARM_COLS as readonly string[]).includes(s);

/** Khóa CSV của từng cột (contract §3.2); `limit` thêm các khóa lớp theo ngưỡng ở alarm-csv. */
export const ALARM_COL_CSV: Readonly<Record<AlarmCol, string>> = {
  id: 'id',
  name: 'name',
  type: 'type',
  tag: 'tag',
  cond: 'trigger',
  HH: 'HH',
  H: 'H',
  L: 'L',
  LL: 'LL',
  deadband: 'deadband',
  onDelay: 'onDelayS',
  offDelay: 'offDelayS',
  class: 'class',
  area: 'area',
  text: 'text',
  enabled: 'enabled',
};

const THRESHOLD_SET = new Set<string>(ALARM_THRESHOLDS);
const isThreshold = (c: string): c is AlarmThresholdName => THRESHOLD_SET.has(c);

/** Ô có áp dụng cho dòng này không (ngưỡng chỉ của `limit`, điều kiện không của `limit`…). */
export function cellApplicable(def: AlarmDef, col: AlarmCol): boolean {
  const type = asObj(def).type;
  if (isThreshold(col) || col === 'deadband') return type === 'limit';
  if (col === 'cond') return type === 'digital' || type === 'quality';
  return true;
}

const trimNum = (n: number): string => {
  const s = String(Math.round(n * 1e6) / 1e6);
  return s;
};

/** Số giây hiển thị của một độ trễ mili-giây (một chữ số thập phân khi cần). */
export const delaySeconds = (ms: unknown): string =>
  typeof ms === 'number' && Number.isFinite(ms)
    ? trimNum(ms / 1000)
    : ms === undefined
      ? ''
      : String(ms);

const nameOf = <T extends { id: string; name: string }>(list: readonly T[], id: string): string =>
  list.find((x) => x.id === id)?.name ?? id;

export const typeLabel = (type: unknown): string =>
  type === 'digital' || type === 'limit' || type === 'quality'
    ? t(`alarm.type.${type}`)
    : String(type ?? '');

/** Lớp theo ngưỡng của alarm `limit` rút gọn: một lớp chung hoặc "HH: Khẩn cấp, H: Nhỏ". */
export function limitClassSummary(def: AlarmDef, classes: readonly AlarmClassDef[]): string {
  if (def.type !== 'limit') return '';
  const parts: Array<[string, string]> = [];
  for (const name of [...ALARM_THRESHOLDS].reverse()) {
    const l = def.limits?.[name];
    if (l) parts.push([name, String(l.class ?? '')]);
  }
  if (parts.length === 0) return '';
  if (parts.every((p) => p[1] === parts[0]![1])) return nameOf(classes, parts[0]![1]);
  return parts.map(([n, c]) => `${n}: ${nameOf(classes, c)}`).join(', ');
}

/** Chữ của ô (cũng là chữ ban đầu khi sửa, khi sao chép). */
export function cellText(def: AlarmDef | undefined, col: AlarmCol, doc: AlarmDoc): string {
  if (!def) return '';
  const a = asObj(def);
  switch (col) {
    case 'id':
      return String(a.id ?? '');
    case 'name':
      return String(a.name ?? '');
    case 'type':
      return typeLabel(a.type);
    case 'tag':
      return a.tag !== undefined ? String(a.tag) : a.device !== undefined ? String(a.device) : '';
    case 'cond':
      if (a.type === 'digital')
        return a.trigger === undefined
          ? ''
          : t(a.trigger === true ? 'alarm.trigger.on' : 'alarm.trigger.off');
      if (a.type === 'quality')
        return t(a.on === 'notGood' ? 'alarm.qualityOn.notGood' : 'alarm.qualityOn.bad');
      return '';
    case 'HH':
    case 'H':
    case 'L':
    case 'LL': {
      const l = asObj(a.limits ?? {})[col];
      if (a.type !== 'limit' || l === undefined) return '';
      const v = asObj(l).value;
      return v === undefined ? '' : String(v);
    }
    case 'deadband':
      return a.type === 'limit' && a.deadband !== undefined ? String(a.deadband) : '';
    case 'onDelay':
      return delaySeconds(a.onDelayMs);
    case 'offDelay':
      return delaySeconds(a.offDelayMs);
    case 'class':
      return a.type === 'limit'
        ? limitClassSummary(def, doc.classes)
        : a.class === undefined
          ? ''
          : nameOf(doc.classes, String(a.class));
    case 'area':
      return a.area === undefined || a.area === '' ? '' : nameOf(doc.areas, String(a.area));
    case 'text':
      return a.text === undefined ? '' : String(a.text);
    case 'enabled':
      return t(a.enabled === false ? 'alarm.enabled.off' : 'alarm.enabled.on');
  }
}

/** Giá trị đọc từ chữ: số hữu hạn (chấp nhận dấu phẩy), không thì giữ chữ để bộ kiểm tra báo tại ô. */
export function parseNumberText(text: string): number | string {
  const s = text.trim().replace(',', '.');
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return text.trim();
}

const TRUE_WORDS = new Set(['true', '1', 'x', 'yes', 'co', 'bat', 'on', 'khi bat']);
const FALSE_WORDS = new Set(['false', '0', 'no', 'khong', 'tat', 'off', 'khi tat']);

/** Đọc "bật"/"tắt" (nhãn tiếng Việt, từ khóa, 1/0). `undefined` khi không hiểu. */
export function parseBoolText(text: string): boolean | undefined {
  const s = fold(text.trim());
  if (TRUE_WORDS.has(s)) return true;
  if (FALSE_WORDS.has(s)) return false;
  return undefined;
}

export interface CellResult {
  def: AlarmDef;
  /** Khóa chuỗi báo lỗi (ô không đổi được); `def` giữ nguyên. */
  error?: string;
  /** Tên các trường bị bỏ khi đổi loại (để hỏi hoặc báo). */
  lost?: string[];
}

function parseType(text: string): 'digital' | 'limit' | 'quality' | undefined {
  const s = fold(text.trim());
  if (s === 'digital' || s === fold(t('alarm.type.digital'))) return 'digital';
  if (s === 'limit' || s === fold(t('alarm.type.limit'))) return 'limit';
  if (s === 'quality' || s === fold(t('alarm.type.quality'))) return 'quality';
  return undefined;
}

/** Tìm lớp theo id hoặc tên (không dấu); không thấy thì giữ chữ gõ để lỗi hiện tại ô. */
function resolveId<T extends { id: string; name: string }>(
  list: readonly T[],
  text: string,
): string {
  const s = text.trim();
  if (list.some((x) => x.id === s)) return s;
  const f = fold(s);
  return list.find((x) => fold(x.name) === f || fold(x.id) === f)?.id ?? s;
}

/** Đổi loại alarm: giữ trường chung và Tag, bỏ trường không áp dụng. */
export function changeType(
  def: AlarmDef,
  to: 'digital' | 'limit' | 'quality',
  classes: readonly AlarmClassDef[],
): { def: AlarmDef; lost: string[] } {
  const a = asObj(def);
  if (a.type === to) return { def, lost: [] };
  const lost: string[] = [];
  const out: Obj = {};
  for (const k of ['id', 'name', 'area', 'text', 'enabled', 'onDelayMs', 'offDelayMs'])
    if (a[k] !== undefined) out[k] = a[k];
  out.type = to;
  if (a.tag !== undefined) out.tag = a.tag;
  const oldClass =
    a.type === 'limit'
      ? ([...ALARM_THRESHOLDS]
          .reverse()
          .map((n) => asObj(asObj(a.limits ?? {})[n] ?? {}).class)
          .find((c) => c !== undefined) as string | undefined)
      : (a.class as string | undefined);
  const fallbackClass = oldClass ?? defaultClassFor('H', classes) ?? '';
  if (a.type === 'limit') {
    if (a.limits && Object.keys(a.limits as Obj).length > 0) lost.push('limits');
    if (a.deadband !== undefined) lost.push('deadband');
  }
  if (a.type === 'digital' && a.trigger !== undefined) lost.push('trigger');
  if (a.type === 'quality') {
    if (a.device !== undefined) lost.push('device');
    if (a.on !== undefined) lost.push('on');
  }
  if (to === 'digital') {
    out.trigger = true;
    out.class = fallbackClass;
  } else if (to === 'quality') {
    out.class = fallbackClass;
  } else {
    out.limits = {};
  }
  return { def: out as unknown as AlarmDef, lost };
}

/** Lớp mặc định cho một ngưỡng (contract §6): HH, LL khẩn cấp, H, L nhỏ; thiếu thì lớp ưu tiên gần nhất. */
export function defaultClassFor(
  name: AlarmThresholdName | 'digital' | 'quality',
  classes: readonly AlarmClassDef[],
): string | undefined {
  const wish: AlarmPriority =
    name === 'HH' || name === 'LL' ? 'critical' : name === 'digital' ? 'major' : 'minor';
  const direct = classes.find((c) => c.id === (wish === 'major' ? 'major' : wish));
  if (direct) return direct.id;
  const byPriority = classes.find((c) => c.priority === wish);
  if (byPriority) return byPriority.id;
  const rank = (p: AlarmPriority): number => ALARM_PRIORITIES.indexOf(p);
  const sorted = [...classes].sort(
    (x, y) => Math.abs(rank(x.priority) - rank(wish)) - Math.abs(rank(y.priority) - rank(wish)),
  );
  return sorted[0]?.id;
}

const COND_ON = new Set(['bad']);
const COND_NOTGOOD = new Set([
  'notgood',
  'bad hoac uncertain',
  'bad or uncertain',
  'bad/uncertain',
]);

/**
 * Áp chữ của một ô lên một alarm. Ô không áp dụng cho loại alarm này: `error`. Chữ sai kiểu (số, danh sách) được giữ để
 * bộ kiểm tra báo lỗi tại ô, trừ chọn loại, điều kiện không hiểu được (`error`, `def` giữ nguyên).
 */
export function applyCell(
  def: AlarmDef,
  col: AlarmCol,
  text: string,
  doc: AlarmDoc,
  ctx: AlarmCtx = EMPTY_CTX,
): CellResult {
  const a: Obj = { ...asObj(def) };
  const type = a.type;
  const done = (): CellResult => ({ def: a as unknown as AlarmDef });
  const reject = (error: string): CellResult => ({ def, error });
  if (col === 'type') {
    const to = parseType(text);
    if (!to) return reject('alarm.err.type');
    const r = changeType(def, to, doc.classes);
    return { def: r.def, lost: r.lost };
  }
  if (!cellApplicable(def, col)) return reject('alarm.err.notApplicable');
  const setOpt = (key: string, v: unknown): void => {
    if (v === undefined || v === '') delete a[key];
    else a[key] = v;
  };
  switch (col) {
    case 'id':
      a.id = text.trim();
      return done();
    case 'name':
      a.name = text;
      return done();
    case 'tag': {
      const s = text.trim();
      if (type === 'quality') {
        delete a.tag;
        delete a.device;
        if (s === '') return done();
        if (!ctx.tags.has(s) && ctx.devices.has(s)) a.device = s;
        else a.tag = s;
        return done();
      }
      a.tag = s;
      return done();
    }
    case 'cond': {
      const s = fold(text.trim());
      if (type === 'digital') {
        const b = parseBoolText(text);
        if (b === undefined) return reject('alarm.err.cond');
        a.trigger = b;
        return done();
      }
      if (COND_ON.has(s) || s === fold(t('alarm.qualityOn.bad'))) a.on = 'bad';
      else if (COND_NOTGOOD.has(s) || s === fold(t('alarm.qualityOn.notGood'))) a.on = 'notGood';
      else return reject('alarm.err.cond');
      return done();
    }
    case 'HH':
    case 'H':
    case 'L':
    case 'LL': {
      const limits: Obj = { ...asObj(a.limits ?? {}) };
      const s = text.trim();
      if (s === '') {
        delete limits[col];
      } else {
        const old = asObj(limits[col] ?? {});
        const l: Obj = { value: parseNumberText(s) };
        l.class = old.class ?? defaultClassFor(col, doc.classes) ?? '';
        if (old.text !== undefined) l.text = old.text;
        limits[col] = l;
      }
      // Thứ tự khóa chuẩn LL, L, H, HH.
      const ordered: Obj = {};
      for (const n of ALARM_THRESHOLDS) if (limits[n] !== undefined) ordered[n] = limits[n];
      a.limits = ordered;
      return done();
    }
    case 'deadband':
      setOpt('deadband', text.trim() === '' ? undefined : parseNumberText(text));
      return done();
    case 'onDelay':
    case 'offDelay': {
      const key = col === 'onDelay' ? 'onDelayMs' : 'offDelayMs';
      if (text.trim() === '') {
        delete a[key];
        return done();
      }
      const n = parseNumberText(text);
      a[key] = typeof n === 'number' ? Math.round(n * 1000) : n;
      return done();
    }
    case 'class': {
      const s = text.trim();
      if (type !== 'limit') {
        a.class = resolveId(doc.classes, s);
        return done();
      }
      const limits: Obj = { ...asObj(a.limits ?? {}) };
      // "HH: x, H: y" (hoặc "HH=x") đặt riêng; một lớp đặt cho mọi ngưỡng đang dùng.
      const perThreshold = /^\s*(HH|H|L|LL)\s*[:=]/.test(s)
        ? s.split(/[,;]/).map((p) => /^\s*(HH|H|L|LL)\s*[:=]\s*(.*?)\s*$/.exec(p))
        : null;
      if (perThreshold) {
        for (const m of perThreshold) {
          if (!m) return reject('alarm.err.classList');
          const name = m[1] as AlarmThresholdName;
          const cur = limits[name];
          if (cur === undefined) return reject('alarm.err.limitMissing');
          limits[name] = { ...asObj(cur), class: resolveId(doc.classes, m[2]!) };
        }
      } else {
        const id = resolveId(doc.classes, s);
        for (const n of ALARM_THRESHOLDS)
          if (limits[n] !== undefined) limits[n] = { ...asObj(limits[n]), class: id };
      }
      a.limits = limits;
      return done();
    }
    case 'area': {
      const s = text.trim();
      if (s === '' || fold(s) === fold(t('alarm.area.common'))) delete a.area;
      else a.area = resolveId(doc.areas, s);
      return done();
    }
    case 'text':
      setOpt('text', text);
      return done();
    case 'enabled': {
      const b = parseBoolText(text);
      if (b === undefined) return reject('alarm.err.bool');
      if (b) delete a.enabled;
      else a.enabled = false;
      return done();
    }
  }
}

/** Giá trị riêng của một ngưỡng (nội dung theo ngưỡng, lớp theo ngưỡng) của alarm `limit`. */
export function setThresholdField(
  def: AlarmDef,
  name: AlarmThresholdName,
  field: 'class' | 'text',
  value: string,
): AlarmDef {
  if (def.type !== 'limit' || !def.limits?.[name]) return def;
  const cur: AlarmLimitDef = { ...def.limits[name]! };
  if (field === 'text') {
    if (value === '') delete cur.text;
    else cur.text = value;
  } else cur.class = value;
  return { ...def, limits: { ...def.limits, [name]: cur } };
}

// ---------------------------------------------------------------------------------------------
// Thêm, xóa, nhân bản, dán

const ID_MAX = 48;

/** Id còn trống theo mẫu `PREFIX_001` (hoặc thêm `_2`, `_3`). */
export function freeId(base: string, taken: ReadonlySet<string>): string {
  const clean = sanitizeId(base);
  if (!taken.has(clean)) return clean;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const cand = clean.slice(0, ID_MAX - suffix.length) + suffix;
    if (!taken.has(cand)) return cand;
  }
}

/** Id Tag thành id alarm hợp lệ: `.` và ký tự lạ thành `_`, chữ đầu là chữ cái, cắt ≤ 48. */
export function sanitizeId(src: string): string {
  let s = src.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_');
  s = s.replace(/_+$/, '');
  if (!/^[A-Za-z]/.test(s)) s = `A_${s}`;
  if (s.length < 2) s = `${s}_1`;
  return s.slice(0, ID_MAX);
}

const idsOf = (alarms: readonly AlarmDef[]): Set<string> =>
  new Set(alarms.map((a) => String(asObj(a).id)));

/** Một alarm số mới ở cuối bảng: id `ALARM_001`…, Tag trống, lớp mặc định. */
export function newAlarm(doc: AlarmDoc): AlarmDef {
  const taken = idsOf(doc.alarms);
  let n = doc.alarms.length + 1;
  let id = `ALARM_${String(n).padStart(3, '0')}`;
  while (taken.has(id)) id = `ALARM_${String(++n).padStart(3, '0')}`;
  return {
    id,
    type: 'digital',
    name: id,
    tag: '',
    trigger: true,
    class: defaultClassFor('digital', doc.classes) ?? '',
  } as AlarmDef;
}

export const addAlarm = (doc: AlarmDoc, def?: AlarmDef): AlarmDoc => ({
  ...doc,
  alarms: [...doc.alarms, def ?? newAlarm(doc)],
});

export const removeAlarms = (doc: AlarmDoc, rows: readonly number[]): AlarmDoc => {
  const drop = new Set(rows);
  return { ...doc, alarms: doc.alarms.filter((_, i) => !drop.has(i)) };
};

/** Nhân bản các dòng (ngay sau dòng gốc nhóm cuối): id mới `<id>_COPY`…, bỏ qua khi vượt 500 instance. */
export function duplicateAlarms(
  doc: AlarmDoc,
  rows: readonly number[],
): { doc: AlarmDoc; added: number[]; dropped: number } {
  const taken = idsOf(doc.alarms);
  const alarms = [...doc.alarms];
  const added: number[] = [];
  let dropped = 0;
  for (const r of [...rows].sort((x, y) => x - y)) {
    const src = doc.alarms[r];
    if (!src) continue;
    if (instanceCount([...alarms, src]) > ALARM_LIMITS.instances) {
      dropped++;
      continue;
    }
    const id = freeId(`${asObj(src).id}_COPY`, taken);
    taken.add(id);
    const copy = clone(src);
    asObj(copy).id = id;
    added.push(alarms.length);
    alarms.push(copy);
  }
  return { doc: { ...doc, alarms }, added, dropped };
}

export interface CellEdit {
  row: number;
  col: AlarmCol;
  text: string;
}
export interface RejectedCell {
  row: number;
  col: AlarmCol;
  text: string;
  reason: string;
}

/** Sửa nhiều ô (một bước). Ô không áp dụng hoặc không hiểu: trả trong `rejected`, phần còn lại vẫn áp. */
export function setCells(
  doc: AlarmDoc,
  edits: readonly CellEdit[],
  ctx: AlarmCtx = EMPTY_CTX,
): { doc: AlarmDoc; rejected: RejectedCell[]; lost: string[] } {
  const alarms = [...doc.alarms];
  const rejected: RejectedCell[] = [];
  const lost = new Set<string>();
  // Đổi loại trước để các ô cùng dòng sau đó áp trên loại mới (dán cả dòng).
  const ordered = [...edits].sort(
    (x, y) => (x.col === 'type' ? 0 : 1) - (y.col === 'type' ? 0 : 1),
  );
  for (const e of ordered) {
    const cur = alarms[e.row];
    if (!cur) {
      rejected.push({ ...e, reason: 'alarm.err.row' });
      continue;
    }
    const r = applyCell(cur, e.col, e.text, { ...doc, alarms }, ctx);
    if (r.error) rejected.push({ ...e, reason: r.error });
    else alarms[e.row] = r.def;
    for (const l of r.lost ?? []) lost.add(l);
  }
  return { doc: { ...doc, alarms }, rejected, lost: [...lost] };
}

/** Dòng mới từ các ô của một dòng dán (không có loại: có ô ngưỡng thì `limit`, không thì `digital`). */
export function alarmFromCells(
  doc: AlarmDoc,
  cells: Partial<Record<AlarmCol, string>>,
  ctx: AlarmCtx = EMPTY_CTX,
): { def: AlarmDef; rejected: Array<{ col: AlarmCol; text: string; reason: string }> } {
  const guessLimit = (['HH', 'H', 'L', 'LL'] as const).some((c) => (cells[c] ?? '').trim() !== '');
  const typeText = cells.type?.trim();
  const type = typeText ? (parseType(typeText) ?? 'digital') : guessLimit ? 'limit' : 'digital';
  const base = newAlarm(doc);
  let def: AlarmDef = changeType(base, type, doc.classes).def;
  const rejected: Array<{ col: AlarmCol; text: string; reason: string }> = [];
  if (type === 'digital' || type === 'quality') delete asObj(def).trigger;
  if (type === 'digital') asObj(def).trigger = true;
  if (typeText && !parseType(typeText))
    rejected.push({ col: 'type', text: typeText, reason: 'alarm.err.type' });
  for (const col of ALARM_COLS) {
    if (col === 'type') continue;
    const text = cells[col];
    if (text === undefined) continue;
    const r = applyCell(def, col, text, doc, ctx);
    if (r.error) rejected.push({ col, text, reason: r.error });
    else def = r.def;
  }
  if (cells.id === undefined || cells.id.trim() === '') asObj(def).id = asObj(base).id;
  if (cells.name === undefined) asObj(def).name = String(asObj(def).id);
  return { def, rejected };
}

/**
 * Thêm các dòng (dán, nhập CSV): dừng khi vượt 500 instance (Edge Cases: không dán hết), phần còn lại bỏ và đếm.
 */
export function insertAlarms(
  doc: AlarmDoc,
  defs: readonly AlarmDef[],
): { doc: AlarmDoc; added: number; dropped: number } {
  const alarms = [...doc.alarms];
  let added = 0;
  let dropped = 0;
  for (const d of defs) {
    if (instanceCount([...alarms, d]) > ALARM_LIMITS.instances) {
      dropped++;
      continue;
    }
    alarms.push(d);
    added++;
  }
  return { doc: { ...doc, alarms }, added, dropped };
}

/**
 * Điền xuống: chép ô của dòng `from` xuống các dòng `rows` ở cột `col`; cột Id tăng dần (`TANK_01` thành `TANK_02`).
 * Ô không áp dụng cho dòng đích bị bỏ qua (đếm trong `skipped`).
 */
export function fillDown(
  doc: AlarmDoc,
  col: AlarmCol,
  from: number,
  rows: readonly number[],
  ctx: AlarmCtx = EMPTY_CTX,
): { doc: AlarmDoc; skipped: number; rejected: RejectedCell[] } {
  const source = doc.alarms[from];
  if (!source) return { doc, skipped: 0, rejected: [] };
  const text = cellText(source, col, doc);
  const alarms = [...doc.alarms];
  let skipped = 0;
  const rejected: RejectedCell[] = [];
  let step = 0;
  for (const r of rows) {
    const target = alarms[r];
    if (!target || r === from) continue;
    step++;
    if (!cellApplicable(target, col)) {
      skipped++;
      continue;
    }
    const value = col === 'id' ? incrementName(text, step) : text;
    const res = applyCell(
      target,
      col,
      col === 'class' && source.type !== 'limit' && target.type === 'limit'
        ? classIdText(source, doc)
        : value,
      { ...doc, alarms },
      ctx,
    );
    if (res.error) rejected.push({ row: r, col, text: value, reason: res.error });
    else alarms[r] = res.def;
  }
  return { doc: { ...doc, alarms }, skipped, rejected };
}

const classIdText = (d: AlarmDef, doc: AlarmDoc): string => cellText(d, 'class', doc);

/** `TANK_01` + 1 thành `TANK_02` (giữ số chữ số); không có số cuối thì thêm `_2`. */
export function incrementName(name: string, by: number): string {
  const m = /^(.*?)(\d+)$/.exec(name);
  if (!m) return `${name}_${by + 1}`;
  const next = String(Number(m[2]) + by).padStart(m[2]!.length, '0');
  return `${m[1]}${next}`;
}

// ---------------------------------------------------------------------------------------------
// Tham chiếu chéo: Tag, lớp, khu vực

export interface AlarmUse {
  /** Chỉ số dòng trong tài liệu. */
  row: number;
  id: string;
  type: string;
  threshold?: AlarmThresholdName;
}

/** Alarm dùng Tag (cả `tag` của quality). */
export function usageOfTag(doc: AlarmDoc, tagId: string): AlarmUse[] {
  const out: AlarmUse[] = [];
  doc.alarms.forEach((a, row) => {
    if (asObj(a).tag === tagId)
      out.push({ row, id: String(asObj(a).id), type: String(asObj(a).type) });
  });
  return out;
}

/** Alarm dùng thiết bị trường (alarm quality theo thiết bị). */
export function usageOfDevice(doc: AlarmDoc, deviceId: string): AlarmUse[] {
  const out: AlarmUse[] = [];
  doc.alarms.forEach((a, row) => {
    if (asObj(a).device === deviceId)
      out.push({ row, id: String(asObj(a).id), type: String(asObj(a).type) });
  });
  return out;
}

/** Đổi tên Tag trong mọi alarm (FR-082): trả tài liệu mới và số alarm đã đổi. */
export function renameTagRefs(
  doc: AlarmDoc,
  from: string,
  to: string,
): { doc: AlarmDoc; count: number } {
  let count = 0;
  const alarms = doc.alarms.map((a) => {
    if (asObj(a).tag !== from) return a;
    count++;
    return { ...asObj(a), tag: to } as unknown as AlarmDef;
  });
  return { doc: count ? { ...doc, alarms } : doc, count };
}

/** Chỗ dùng một lớp (id alarm, ngưỡng). */
export function usageOfClass(doc: AlarmDoc, classId: string): AlarmUse[] {
  const out: AlarmUse[] = [];
  doc.alarms.forEach((a, row) => {
    const o = asObj(a);
    if (o.type === 'limit') {
      for (const n of ALARM_THRESHOLDS) {
        const l = asObj(o.limits ?? {})[n];
        if (l && asObj(l).class === classId)
          out.push({ row, id: String(o.id), type: 'limit', threshold: n });
      }
    } else if (o.class === classId) out.push({ row, id: String(o.id), type: String(o.type) });
  });
  return out;
}

/** Xóa một lớp: chỗ dùng thành lỗi `E_ALARM_CLASS_REF` (không tự đổi sang lớp khác). */
export const removeClass = (doc: AlarmDoc, classId: string): AlarmDoc => ({
  ...doc,
  classes: doc.classes.filter((c) => c.id !== classId),
});

export function usageOfArea(doc: AlarmDoc, areaId: string): AlarmUse[] {
  const out: AlarmUse[] = [];
  doc.alarms.forEach((a, row) => {
    if (asObj(a).area === areaId)
      out.push({ row, id: String(asObj(a).id), type: String(asObj(a).type) });
  });
  return out;
}

/** Xóa khu vực: các alarm đó về "Chung" (khác lớp: khu vực không bắt buộc). */
export function removeArea(doc: AlarmDoc, areaId: string): AlarmDoc {
  return {
    ...doc,
    areas: doc.areas.filter((a) => a.id !== areaId),
    alarms: doc.alarms.map((a) => {
      if (asObj(a).area !== areaId) return a;
      const { area: _area, ...rest } = asObj(a);
      void _area;
      return rest as unknown as AlarmDef;
    }),
  };
}

/** Id khu vực gợi ý từ tên: bỏ dấu, `-` thay khoảng trắng, `^[a-z0-9][a-z0-9-]{0,31}$`, thêm `-2` khi trùng. */
export function suggestAreaId(name: string, taken: ReadonlySet<string>): string {
  let s = fold(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  if (!s) s = 'khu-vuc';
  if (!taken.has(s)) return s;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const cand = s.slice(0, 32 - suffix.length) + suffix;
    if (!taken.has(cand)) return cand;
  }
}

export function addArea(
  doc: AlarmDoc,
  name: string,
): { doc: AlarmDoc; id: string } | { error: string } {
  const n = name.trim();
  if (!n || [...n].length > ALARM_LIMITS.areaNameChars) return { error: 'alarm.area.err.name' };
  if (doc.areas.length >= ALARM_LIMITS.areas) return { error: 'alarm.area.err.max' };
  const id = suggestAreaId(n, new Set(doc.areas.map((a) => a.id)));
  return { doc: { ...doc, areas: [...doc.areas, { id, name: n }] }, id };
}

/** Đổi tên hiển thị của khu vực (id giữ nguyên). */
export const renameArea = (doc: AlarmDoc, id: string, name: string): AlarmDoc => ({
  ...doc,
  areas: doc.areas.map((a) => (a.id === id ? { ...a, name } : a)),
});

/** Đổi id khu vực và cập nhật mọi alarm (một thao tác). */
export function changeAreaId(doc: AlarmDoc, from: string, to: string): AlarmDoc {
  return {
    ...doc,
    areas: doc.areas.map((a) => (a.id === from ? { ...a, id: to } : a)),
    alarms: doc.alarms.map((a) =>
      asObj(a).area === from ? ({ ...asObj(a), area: to } as unknown as AlarmDef) : a,
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// Lớp alarm: cột và ô của editor Lớp

export const CLASS_COLS = [
  'id',
  'name',
  'priority',
  'color',
  'blink',
  'requiresAck',
  'ackReturn',
  'sound',
  'chatterLimit',
  'inUse',
] as const;
export type ClassCol = (typeof CLASS_COLS)[number];

export const CLASS_DEFAULTS = {
  blink: false,
  requiresAck: true,
  ackReturn: false,
  sound: 'none',
  chatterLimit: 5,
} as const;

const word = <T extends string>(
  list: readonly T[],
  text: string,
  label: (v: T) => string,
): T | undefined => {
  const f = fold(text.trim());
  return list.find((v) => v === text.trim() || fold(v) === f || fold(label(v)) === f);
};

export const priorityLabel = (p: AlarmPriority): string => t(`alarm.priority.${p}`);
export const colorLabel = (c: AlarmColor): string => t(`alarm.color.${c}`);
export const soundLabel = (s: AlarmSound): string => t(`alarm.sound.${s}`);

export function classCellText(c: AlarmClassDef | undefined, col: ClassCol, doc: AlarmDoc): string {
  if (!c) return '';
  switch (col) {
    case 'id':
      return c.id;
    case 'name':
      return c.name;
    case 'priority':
      return ALARM_PRIORITIES.includes(c.priority) ? priorityLabel(c.priority) : String(c.priority);
    case 'color':
      return ALARM_COLORS.includes(c.color) ? colorLabel(c.color) : String(c.color);
    case 'blink':
      return t(c.blink === true ? 'alarm.enabled.on' : 'alarm.enabled.off');
    case 'requiresAck':
      return t(c.requiresAck === false ? 'alarm.enabled.off' : 'alarm.enabled.on');
    case 'ackReturn':
      return t(c.ackReturn === true ? 'alarm.enabled.on' : 'alarm.enabled.off');
    case 'sound':
      return soundLabel(c.sound ?? 'none');
    case 'chatterLimit':
      return String(c.chatterLimit ?? CLASS_DEFAULTS.chatterLimit);
    case 'inUse':
      return String(usageOfClass(doc, c.id).length);
  }
}

/** Áp chữ của ô lên một lớp; `ackReturn` bị khóa khi không `requiresAck`. */
export function applyClassCell(
  c: AlarmClassDef,
  col: ClassCol,
  text: string,
): { def: AlarmClassDef; error?: string } {
  const o: Obj = { ...asObj(c) };
  const ok = (): { def: AlarmClassDef } => ({ def: o as unknown as AlarmClassDef });
  const bad = (error: string): { def: AlarmClassDef; error: string } => ({ def: c, error });
  switch (col) {
    case 'id':
      o.id = text.trim();
      return ok();
    case 'name':
      o.name = text;
      return ok();
    case 'priority': {
      const v = word(ALARM_PRIORITIES, text, priorityLabel);
      if (!v) return bad('alarm.err.priority');
      o.priority = v;
      return ok();
    }
    case 'color': {
      const v = word(ALARM_COLORS, text, colorLabel);
      if (!v) return bad('alarm.err.color');
      o.color = v;
      return ok();
    }
    case 'blink':
    case 'requiresAck':
    case 'ackReturn': {
      const b = parseBoolText(text);
      if (b === undefined) return bad('alarm.err.bool');
      if (col === 'ackReturn' && o.requiresAck === false) return bad('alarm.err.ackReturnLocked');
      o[col] = b;
      if (col === 'requiresAck' && !b) o.ackReturn = false;
      return ok();
    }
    case 'sound': {
      const v = word(ALARM_SOUNDS, text, soundLabel);
      if (!v) return bad('alarm.err.sound');
      o.sound = v;
      return ok();
    }
    case 'chatterLimit': {
      const n = parseNumberText(text);
      o.chatterLimit = n;
      return ok();
    }
    case 'inUse':
      return bad('alarm.err.notApplicable');
  }
}

/** Lớp mới ở cuối bảng (id `class_1`…). */
export function addClass(doc: AlarmDoc): { doc: AlarmDoc; row: number } | { error: string } {
  if (doc.classes.length >= ALARM_LIMITS.classes) return { error: 'alarm.classes.err.max' };
  const taken = new Set(doc.classes.map((c) => c.id));
  let n = doc.classes.length + 1;
  while (taken.has(`class_${n}`)) n++;
  const c: AlarmClassDef = {
    id: `class_${n}`,
    name: t('alarm.classes.newName', { n }),
    priority: 'minor',
    color: 'gray',
    requiresAck: true,
  };
  return { doc: { ...doc, classes: [...doc.classes, c] }, row: doc.classes.length };
}

// ---------------------------------------------------------------------------------------------
// "Tạo alarm cho Tag…" (FR-075)

export const THRESHOLD_PERCENT: Readonly<Record<AlarmThresholdName, number>> = {
  LL: 10,
  L: 20,
  H: 80,
  HH: 90,
};

/** Khoảng giá trị của Tag: `min`/`max` hoặc `limits.min`/`limits.max`. */
export function tagRange(tag: TagLite): { min: number; max: number } | null {
  const min = tag.min ?? tag.limits?.min;
  const max = tag.max ?? tag.limits?.max;
  return min !== undefined && max !== undefined && max > min ? { min, max } : null;
}

const roundNice = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Ngưỡng gợi ý theo phần trăm của khoảng (Tag 0..100: H = 80, HH = 90); không có khoảng thì không gợi ý. */
export function suggestThreshold(tag: TagLite, name: AlarmThresholdName): number | undefined {
  const r = tagRange(tag);
  return r ? roundNice(r.min + ((r.max - r.min) * THRESHOLD_PERCENT[name]) / 100) : undefined;
}

export function suggestDeadband(tag: TagLite): number {
  const r = tagRange(tag);
  return r ? roundNice((r.max - r.min) * 0.02) : 1;
}

export interface QuickCreateInput {
  tag: TagLite;
  kind: 'limit' | 'digital' | 'quality';
  thresholds?: Partial<
    Record<AlarmThresholdName, { value: number | undefined; class: string } | null>
  >;
  trigger?: boolean;
  on?: 'bad' | 'notGood';
  /** Quality: theo thiết bị thay vì Tag. */
  device?: string;
  class?: string;
  deadband?: number;
  onDelayS?: number;
  offDelayS?: number;
  area?: string;
  name?: string;
}

/** Giá trị mặc định của hộp thoại (ngưỡng bật H và HH, trễ 3 s, deadband 2 %). */
export function quickDefaults(tag: TagLite, classes: readonly AlarmClassDef[]): QuickCreateInput {
  const kind: QuickCreateInput['kind'] = tagFits(tag, 'limit')
    ? 'limit'
    : tagFits(tag, 'digital')
      ? 'digital'
      : 'quality';
  const thresholds: NonNullable<QuickCreateInput['thresholds']> = {};
  for (const n of ALARM_THRESHOLDS) {
    const cls = defaultClassFor(n, classes) ?? '';
    const value = suggestThreshold(tag, n);
    thresholds[n] = n === 'H' || n === 'HH' ? { value, class: cls } : null;
  }
  return {
    tag,
    kind,
    thresholds,
    trigger: true,
    on: 'bad',
    class:
      kind === 'quality'
        ? (defaultClassFor('quality', classes) ?? '')
        : (defaultClassFor('digital', classes) ?? ''),
    deadband: suggestDeadband(tag),
    onDelayS: 3,
    offDelayS: 3,
  };
}

/** Id gợi ý (contract §6): quality thêm `_COMM`. */
export function quickId(
  tagId: string,
  kind: QuickCreateInput['kind'],
  taken: ReadonlySet<string>,
): string {
  const base = sanitizeId(tagId);
  const withSuffix = kind === 'quality' ? `${base.slice(0, ID_MAX - 5)}_COMM` : base;
  return freeId(withSuffix, taken);
}

export interface QuickPlan {
  alarm?: AlarmDef;
  /** Chặn tạo (lý do: khóa chuỗi). */
  blocked?: string;
  warnings: string[];
}

/** Dòng alarm sẽ tạo cho một Tag; `taken` là tập id đã dùng (cả các dòng cùng đợt). */
export function quickPlan(
  input: QuickCreateInput,
  doc: AlarmDoc,
  taken: ReadonlySet<string>,
): QuickPlan {
  const warnings: string[] = [];
  if (!tagFits(input.tag, input.kind))
    return { blocked: `alarm.quick.err.type.${input.kind}`, warnings };
  const id = quickId(input.tag.id, input.kind, taken);
  const name = input.name ?? input.tag.id;
  const common: Obj = { id, type: input.kind, name };
  const addCommon = (): void => {
    if (input.area) common.area = input.area;
  };
  const delays = (): Obj => {
    const o: Obj = {};
    if (input.onDelayS) o.onDelayMs = Math.round(input.onDelayS * 1000);
    if (input.offDelayS) o.offDelayMs = Math.round(input.offDelayS * 1000);
    return o;
  };
  if (input.kind === 'limit') {
    const limits: Obj = {};
    for (const n of ALARM_THRESHOLDS) {
      const th = input.thresholds?.[n];
      if (!th) continue;
      if (th.value === undefined || !Number.isFinite(th.value))
        return { blocked: 'alarm.quick.err.noValue', warnings };
      limits[n] = { value: th.value, class: th.class };
    }
    if (Object.keys(limits).length === 0)
      return { blocked: 'alarm.quick.err.noThreshold', warnings };
    addCommon();
    const alarm: Obj = { ...common, tag: input.tag.id, limits };
    if (input.deadband) alarm.deadband = input.deadband;
    Object.assign(alarm, delays());
    if (input.area) alarm.area = input.area;
    return { alarm: alarm as unknown as AlarmDef, warnings };
  }
  if (input.kind === 'digital') {
    addCommon();
    const alarm: Obj = {
      ...common,
      tag: input.tag.id,
      trigger: input.trigger !== false,
      class: input.class ?? '',
    };
    Object.assign(alarm, delays());
    return { alarm: alarm as unknown as AlarmDef, warnings };
  }
  addCommon();
  const alarm: Obj = { ...common };
  if (input.device) alarm.device = input.device;
  else alarm.tag = input.tag.id;
  if (input.on === 'notGood') alarm.on = 'notGood';
  alarm.class = input.class ?? '';
  if (input.onDelayS) alarm.onDelayMs = Math.round(input.onDelayS * 1000);
  void doc;
  return { alarm: alarm as unknown as AlarmDef, warnings };
}

/**
 * Tạo alarm cho nhiều Tag (cùng một mẫu): trả tài liệu mới (thêm lớp mặc định khi project chưa có lớp nào), các dòng đã
 * thêm và các Tag bị chặn. Vượt 500 instance thì chặn toàn bộ (`blocked`).
 */
export function quickCreate(
  doc: AlarmDoc,
  inputs: readonly QuickCreateInput[],
): {
  doc: AlarmDoc;
  added: number[];
  blocked?: string;
  skipped: Array<{ tag: string; reason: string }>;
} {
  let working: AlarmDoc = doc.classes.length === 0 ? { ...doc, classes: defaultClasses() } : doc;
  const taken = idsOf(working.alarms);
  const defs: AlarmDef[] = [];
  const skipped: Array<{ tag: string; reason: string }> = [];
  for (const input of inputs) {
    // Lớp rỗng (project vừa thêm lớp mặc định) lấy theo gợi ý.
    const fixed = fixClasses(input, working.classes);
    const plan = quickPlan(fixed, working, taken);
    if (plan.blocked || !plan.alarm) {
      skipped.push({ tag: input.tag.id, reason: plan.blocked ?? 'alarm.quick.err.noValue' });
      continue;
    }
    taken.add(String(asObj(plan.alarm).id));
    defs.push(plan.alarm);
  }
  if (instanceCount([...working.alarms, ...defs]) > ALARM_LIMITS.instances)
    return { doc, added: [], blocked: 'alarm.quick.err.over500', skipped };
  const first = working.alarms.length;
  working = { ...working, alarms: [...working.alarms, ...defs] };
  return { doc: working, added: defs.map((_, i) => first + i), skipped };
}

function fixClasses(input: QuickCreateInput, classes: readonly AlarmClassDef[]): QuickCreateInput {
  const has = (id: string | undefined): boolean => !!id && classes.some((c) => c.id === id);
  const out: QuickCreateInput = { ...input };
  if (input.kind === 'digital' && !has(input.class))
    out.class = defaultClassFor('digital', classes) ?? '';
  if (input.kind === 'quality' && !has(input.class))
    out.class = defaultClassFor('quality', classes) ?? '';
  if (input.thresholds) {
    const th: NonNullable<QuickCreateInput['thresholds']> = {};
    for (const n of ALARM_THRESHOLDS) {
      const x = input.thresholds[n];
      th[n] = x
        ? { value: x.value, class: has(x.class) ? x.class : (defaultClassFor(n, classes) ?? '') }
        : x;
    }
    out.thresholds = th;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Issue → ô

export type IssueTarget =
  | { kind: 'cell'; row: number; col: AlarmCol; threshold?: AlarmThresholdName }
  | { kind: 'row'; row: number }
  | { kind: 'class'; row: number; field?: string }
  | { kind: 'area'; row: number; field?: string }
  | { kind: 'status' };

const UNESCAPE = (s: string): string => s.replace(/~1/g, '/').replace(/~0/g, '~');

/** Vị trí của một lỗi hoặc cảnh báo (`path` là JSON Pointer trong file) thành ô, dòng lớp, dòng khu vực hoặc thanh trạng thái. */
export function issueCell(issue: Pick<Issue, 'path'>): IssueTarget {
  const seg = issue.path.split('/').slice(1).map(UNESCAPE);
  if (seg[0] === 'classes' && /^\d+$/.test(seg[1] ?? ''))
    return { kind: 'class', row: Number(seg[1]), ...(seg[2] ? { field: seg[2] } : {}) };
  if (seg[0] === 'areas' && /^\d+$/.test(seg[1] ?? ''))
    return { kind: 'area', row: Number(seg[1]), ...(seg[2] ? { field: seg[2] } : {}) };
  if (seg[0] !== 'alarms' || !/^\d+$/.test(seg[1] ?? '')) return { kind: 'status' };
  const row = Number(seg[1]);
  const field = seg[2];
  if (field === undefined) return { kind: 'row', row };
  switch (field) {
    case 'id':
    case 'name':
    case 'type':
    case 'area':
    case 'text':
    case 'enabled':
    case 'class':
    case 'deadband':
      return { kind: 'cell', row, col: field };
    case 'tag':
    case 'device':
      return { kind: 'cell', row, col: 'tag' };
    case 'trigger':
    case 'on':
      return { kind: 'cell', row, col: 'cond' };
    case 'onDelayMs':
      return { kind: 'cell', row, col: 'onDelay' };
    case 'offDelayMs':
      return { kind: 'cell', row, col: 'offDelay' };
    case 'limits': {
      const name = seg[3];
      if (name && isThreshold(name)) {
        const sub = seg[4];
        return {
          kind: 'cell',
          row,
          col: sub === 'class' ? 'class' : sub === 'text' ? 'text' : name,
          threshold: name,
        };
      }
      return { kind: 'cell', row, col: 'H' };
    }
    default:
      return { kind: 'row', row };
  }
}

/** Lỗi và cảnh báo của một file alarm theo ô: khóa `dòng:cột` → danh sách `{severity, text}`. */
export function issuesByCell(
  issues: readonly Issue[],
  alarmFile: string,
  describe: (i: Issue) => string,
): {
  errors: Map<string, string[]>;
  warns: Map<string, string[]>;
  status: Issue[];
  rows: Map<number, 'error' | 'warn'>;
} {
  const errors = new Map<string, string[]>();
  const warns = new Map<string, string[]>();
  const rows = new Map<number, 'error' | 'warn'>();
  const status: Issue[] = [];
  const add = (m: Map<string, string[]>, k: string, v: string): void =>
    void m.set(k, [...(m.get(k) ?? []), v]);
  for (const i of issues) {
    if (i.file !== alarmFile) continue;
    const isErr = i.code.startsWith('E_');
    const tg = issueCell(i);
    if (tg.kind === 'status' || tg.kind === 'class' || tg.kind === 'area') {
      if (tg.kind === 'status') status.push(i);
      continue;
    }
    const col: AlarmCol = tg.kind === 'cell' ? tg.col : 'id';
    add(isErr ? errors : warns, `${tg.row}:${col}`, describe(i));
    const prev = rows.get(tg.row);
    if (isErr) rows.set(tg.row, 'error');
    else if (!prev) rows.set(tg.row, 'warn');
  }
  return { errors, warns, status, rows };
}

/** Lỗi theo lớp và khu vực (editor Lớp, bảng Khu vực): khóa `dòng:cột`. */
export function issuesByClass(
  issues: readonly Issue[],
  classFile: string,
  describe: (i: Issue) => string,
): { errors: Map<string, string[]>; warns: Map<string, string[]> } {
  const errors = new Map<string, string[]>();
  const warns = new Map<string, string[]>();
  for (const i of issues) {
    if (i.file !== classFile) continue;
    const tg = issueCell(i);
    if (tg.kind !== 'class') continue;
    const k = `${tg.row}:${tg.field ?? 'id'}`;
    const m = i.code.startsWith('E_') ? errors : warns;
    m.set(k, [...(m.get(k) ?? []), describe(i)]);
  }
  return { errors, warns };
}
