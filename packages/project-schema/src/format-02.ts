// Định dạng ghi của Studio 0.2 (data-model §1, research R2): mỗi Tag một dòng JSON gọn, khóa theo thứ tự chuẩn,
// không ghi trường bằng mặc định; file khác thụt 2 dấu cách. Cùng đầu vào cho cùng byte.
import type { TagListV1, TagV1 } from './types-02.ts';

const TAG_KEYS = [
  'id',
  'kind',
  'type',
  'description',
  'unit',
  'min',
  'max',
  'access',
  'limits',
  'valueTable',
  'deadband',
  'source',
  'scaling',
  'initial',
  'retain',
  'expression',
  'sim',
] as const;
const SOURCE_KEYS = [
  'device',
  'address',
  'scanGroup',
  'rawType',
  'byteOrder',
  'stringLength',
  'stringByteOrder',
  'readback',
];
const SCALING_KEYS = ['rawMin', 'rawMax', 'engMin', 'engMax', 'clamp'];
const LIMITS_KEYS = ['min', 'max', 'maxLength'];
const SIM_KEYS = [
  'kind',
  'value',
  'from',
  'to',
  'center',
  'amplitude',
  'periodMs',
  'phase',
  'min',
  'max',
  'seed',
  'duty',
  'initial',
  'signal',
];

type Obj = Record<string, unknown>;
const pick = (o: Obj, keys: readonly string[]): Obj => {
  const out: Obj = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};

export interface FormatDefaults {
  /** Thứ tự byte mặc định của thiết bị trường (để bỏ `byteOrder` bằng nó). Vắng: giữ `byteOrder`. */
  deviceByteOrder?: (deviceId: string) => string | undefined;
}

/** Tag ở dạng chuẩn: bỏ trường bằng mặc định, sắp khóa. */
export function canonicalTag(t: TagV1, d: FormatDefaults = {}): Obj {
  const o = t as unknown as Obj;
  const out = pick(o, TAG_KEYS);
  if (out.access === 'R') delete out.access;
  if (out.retain === false) delete out.retain;
  if (out.limits) out.limits = pick(out.limits as Obj, LIMITS_KEYS);
  if (out.scaling) {
    const s = pick(out.scaling as Obj, SCALING_KEYS);
    if (s.clamp === false) delete s.clamp;
    out.scaling = s;
  }
  if (out.source) {
    const s = pick(out.source as Obj, SOURCE_KEYS);
    if (s.scanGroup === 'normal') delete s.scanGroup;
    if (s.rawType === t.type) delete s.rawType;
    if (s.readback === true) delete s.readback;
    if (s.stringByteOrder === 'AB') delete s.stringByteOrder;
    if (s.byteOrder !== undefined && d.deviceByteOrder?.(String(s.device)) === s.byteOrder)
      delete s.byteOrder;
    out.source = s;
  }
  if (out.sim) {
    const s = pick(out.sim as Obj, SIM_KEYS);
    if (s.phase === 0) delete s.phase;
    if (s.seed === 1) delete s.seed;
    if (s.duty === 0.5) delete s.duty;
    out.sim = s;
  }
  return out;
}

/** Chuỗi JSON chuẩn của file nhiều dòng: thụt 2 dấu cách, kết thúc bằng xuống dòng. */
export const serialize = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

/** `tags.json` 0.2: phần ngoài thụt 2 dấu cách, mỗi Tag một dòng. */
export function formatTagsFile(doc: TagListV1, d: FormatDefaults = {}): string {
  const lines = doc.tags.map((t) => '    ' + JSON.stringify(canonicalTag(t, d)));
  const body = lines.length ? `\n${lines.join(',\n')}\n  ` : '';
  return `{\n  "schemaVersion": ${JSON.stringify(doc.schemaVersion)},\n  "tags": [${body}]\n}\n`;
}
