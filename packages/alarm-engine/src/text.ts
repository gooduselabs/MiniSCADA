// Định dạng nội dung alarm, gấp dấu, số ngắn nhất, dấu vân tay (contracts/alarm-engine.md §2, §11; alarm-store.md §7).
// Phải khớp từng ký tự với core/alarm/alarm_text.cpp (vector tests/alarm-vectors/).

import type { InstanceDef } from './types.ts';

export type TextTemplate = string;

export interface TextContext {
  name: string;
  /** Id Tag; với alarm theo thiết bị là id thiết bị. */
  tag: string;
  /** Giá trị lúc bật; `undefined` hoặc không hữu hạn → `n/a`. */
  value?: number;
  unit: string;
  limit?: number | null;
  limitName: string;
  area: string;
  reason: string;
  isBool?: boolean;
  labels?: Record<string, string>;
}

// ---------------------------------------------------------------- số

/** Chuỗi thập phân ngắn nhất khứ hồi của `v`, không có `e`; `-0` thành `0`. */
export function shortestDouble(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const neg = v < 0;
  const s = expandExponent(String(Math.abs(v)));
  return neg ? `-${s}` : s;
}

function expandExponent(s: string): string {
  const m = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (m === null) return s;
  const digits = m[1] + (m[2] ?? '');
  const point = m[1].length + Number(m[3]);
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/** Làm tròn chuỗi thập phân `text` ("-12.345") đến `n` chữ số thập phân, nửa ra xa 0; dấu chấm; đệm 0. */
export function roundDecimalText(text: string, n: number): string {
  let neg = false;
  let t = text;
  if (t.startsWith('-')) {
    neg = true;
    t = t.slice(1);
  }
  const dot = t.indexOf('.');
  const ip = dot < 0 ? t : t.slice(0, dot);
  const fp = dot < 0 ? '' : t.slice(dot + 1);
  let digits: string; // phần nguyên + n chữ số thập phân, dạng số nguyên
  if (fp.length <= n) {
    digits = ip + fp + '0'.repeat(n - fp.length);
  } else {
    digits = incrementIf(ip + fp.slice(0, n), fp.charCodeAt(n) >= 53);
  }
  digits = digits.replace(/^0+(?=\d)/, '');
  if (digits.length < n + 1) digits = '0'.repeat(n + 1 - digits.length) + digits;
  const out =
    n === 0 ? digits : `${digits.slice(0, digits.length - n)}.${digits.slice(digits.length - n)}`;
  const zero = /^[0.]+$/.test(out);
  return neg && !zero ? `-${out}` : out;
}

function incrementIf(digits: string, up: boolean): string {
  if (!up) return digits;
  const a = digits.split('');
  let i = a.length - 1;
  while (i >= 0) {
    if (a[i] === '9') {
      a[i] = '0';
      i--;
    } else {
      a[i] = String(Number(a[i]) + 1);
      return a.join('');
    }
  }
  return `1${a.join('')}`;
}

/** `{value:N}` của số hữu hạn. */
export function formatNumber(v: number, n: number): string {
  return roundDecimalText(shortestDouble(v), n);
}

/** `{value}` = `{value:6}` bỏ số 0 thừa ở cuối và dấu thập phân thừa. */
export function formatNumberPlain(v: number): string {
  const s = formatNumber(v, 6);
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/[.]$/, '');
}

function valueText(ctx: TextContext, n: number | null): string {
  const v = ctx.value;
  if (v === undefined || !Number.isFinite(v)) return 'n/a';
  if (Number.isInteger(v)) {
    const label = ctx.labels?.[String(v)];
    if (label !== undefined) return label;
    if (ctx.isBool === true && (v === 0 || v === 1)) return v === 1 ? 'Bật' : 'Tắt';
  }
  return n === null ? formatNumberPlain(v) : formatNumber(v, n);
}

// ---------------------------------------------------------------- nội dung

const WS = /[ \t\n\r\f\v]+/g;
const MAX_TEXT_CP = 200;

function isCombining(cp: number): boolean {
  return cp >= 0x300 && cp <= 0x36f;
}

export function formatAlarmText(tpl: TextTemplate, ctx: TextContext): string {
  let s = tpl.replace(
    /\{(name|tag|value|unit|limit|limitName|area|reason)\}|\{value:([0-6])\}/g,
    (_m, tok?: string, n?: string) => {
      if (n !== undefined) return valueText(ctx, Number(n));
      switch (tok) {
        case 'name':
          return ctx.name;
        case 'tag':
          return ctx.tag;
        case 'value':
          return valueText(ctx, null);
        case 'unit':
          return ctx.unit;
        case 'limit':
          return ctx.limit === undefined || ctx.limit === null ? '' : formatNumberPlain(ctx.limit);
        case 'limitName':
          return ctx.limitName;
        case 'area':
          return ctx.area;
        case 'reason':
          return ctx.reason;
        default:
          return '';
      }
    },
  );
  s = s.replace(/\([ \t\n\r\f\v]*\)/g, '');
  s = s.replace(WS, ' ').trim();
  const cps = Array.from(s);
  if (cps.length > MAX_TEXT_CP) {
    let end = MAX_TEXT_CP - 1;
    while (end > 0 && isCombining(cps[end].codePointAt(0) ?? 0)) end--;
    s = `${cps.slice(0, end).join('')}…`;
  }
  return s;
}

/** Mẫu mặc định (D9). */
export function defaultTemplate(d: Pick<InstanceDef, 'kind' | 'limitName'>): string {
  if (d.kind === 'digital') return '{name}';
  if (d.kind === 'quality') return '{name}: mất tín hiệu ({reason})';
  switch (d.limitName) {
    case 'HH':
      return '{name} rất cao: {value} {unit} (ngưỡng {limit})';
    case 'H':
      return '{name} cao: {value} {unit} (ngưỡng {limit})';
    case 'L':
      return '{name} thấp: {value} {unit} (ngưỡng {limit})';
    default:
      return '{name} rất thấp: {value} {unit} (ngưỡng {limit})';
  }
}

// ---------------------------------------------------------------- foldText

const FOLD_LISTS: ReadonlyArray<readonly [string, string]> = [
  ['a', 'àáảãạăằắẳẵặâầấẩẫậ'],
  ['e', 'èéẻẽẹêềếểễệ'],
  ['i', 'ìíỉĩị'],
  ['o', 'òóỏõọôồốổỗộơờớởỡợ'],
  ['u', 'ùúủũụưừứửữự'],
  ['y', 'ỳýỷỹỵ'],
];

const FOLD_MAP: ReadonlyMap<number, string> = (() => {
  const m = new Map<number, string>();
  for (const [base, chars] of FOLD_LISTS) {
    for (const ch of chars) {
      m.set(ch.codePointAt(0) as number, base);
      m.set(ch.toUpperCase().codePointAt(0) as number, base);
    }
  }
  m.set(0x111, 'd');
  m.set(0x110, 'd');
  return m;
})();

/** Số cặp trong bảng gấp (kiểm bởi test: 134). */
export const FOLD_TABLE_SIZE = FOLD_MAP.size;

/** Gấp dấu tiếng Việt và hạ chữ (alarm-store.md §7). Không chuẩn hóa NFC/NFD. */
export function foldText(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        out += s.slice(i, i + 2);
        i++;
        continue;
      }
      cp = 0xfffd;
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      cp = 0xfffd;
    }
    if (isCombining(cp)) continue;
    const mapped = FOLD_MAP.get(cp);
    if (mapped !== undefined) out += mapped;
    else if (cp >= 0x41 && cp <= 0x5a) out += String.fromCharCode(cp + 32);
    else out += String.fromCharCode(cp);
  }
  return out;
}

// ---------------------------------------------------------------- dấu vân tay

const MASK64 = 0xffffffffffffffffn;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

/** FNV-1a 64 bit trên UTF-8, 16 ký tự hex thường. */
export function fnv1a64Hex(s: string): string {
  let h = FNV_OFFSET;
  for (const b of new TextEncoder().encode(s)) {
    h ^= BigInt(b);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

type FingerprintSource = Pick<
  InstanceDef,
  'kind' | 'tagId' | 'deviceId' | 'limitName' | 'threshold' | 'trigger' | 'on'
>;

export function fingerprintString(d: FingerprintSource): string {
  const target = d.deviceId !== '' ? `device:${d.deviceId}` : d.tagId;
  const threshold = d.threshold === null ? '' : shortestDouble(d.threshold);
  const trigger = d.trigger === null ? '' : d.trigger ? '1' : '0';
  return [d.kind, target, d.limitName, threshold, trigger, d.on ?? ''].join('|');
}

export function fingerprintHex(d: FingerprintSource): string {
  return fnv1a64Hex(fingerprintString(d));
}
