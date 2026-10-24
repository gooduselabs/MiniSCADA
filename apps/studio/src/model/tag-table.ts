// Adapter Bảng Tag cho mat-grid (feature 006, T122, FR-045, FR-015, data-model §1, §13.2): bộ cột theo loại Tag, chữ của
// ô, trình sửa ô (danh sách chọn), đổi chữ thành sửa đổi project, điền xuống tăng địa chỉ, mức dùng tags.json.
// Project 0.1 mở qua cùng lớp này với bộ cột của 004 (`version: '0.1'`). Chữ số luôn viết dấu chấm thập phân.
import {
  BACNET_ADDRESS_HINTS,
  BACNET_PROPERTIES,
  FINS_ADDRESS_HINTS,
  parseAddress,
  parseBacnetAddress,
  parseFinsAddress,
  parseMcAddress,
  parseOpcUaNodeId,
  parseS7Address,
  registerCount,
  type AddressResult,
  type BacnetAddressResult,
  type McAddressResult,
  type OpcUaNodeIdResult,
  type S7AddressResult,
  type TagDataType,
} from '@mat/tag-codec';
import { mcAddressError, mcDefaultStep, mcExamples, mcStepAddress } from './mc.ts';
import { LIMITS_02, formatTagsFile, type TagV1 } from '@mat/project-schema';
import { fold, t, type MessageKey } from '../i18n/index.ts';
import { nextTagId } from './tag-ids.ts';
import type { AnyTag, ProjectEdit } from './project-doc.ts';
import type {
  ApplyResult,
  CellChange,
  ColKind,
  GridAdapter,
  GridColumn,
  Rejected,
} from './grid/types.ts';

/** Trần số Tag của project 0.2 (data-model §1, FR-016). */
export const MAX_TAG_ROWS = LIMITS_02.tags;
/** Trần `tags.json` mà thiết bị chấp nhận (R2): 1 MiB. */
export const TAGS_FILE_LIMIT = 1024 * 1024;
/** Cảnh báo khi dùng từ 85 % trần. */
const WARN_RATIO = 0.85;

export type ColumnSet = 'all' | 'external' | 'internal' | 'calculated' | 'simulation';

export interface DeviceInfo {
  id: string;
  name: string;
  addressBase?: 0 | 1;
  byteOrder?: string;
  /** Loại kênh chứa thiết bị trường (`modbus-tcp`, `modbus-rtu`, `s7`); vắng: Modbus. */
  kind?: string;
  /** Loại kênh chứa thiết bị trường (feature 017: `mc` đọc địa chỉ theo ngữ pháp MC). Vắng: Modbus. */
  channelKind?: string;
  /** Cách viết X, Y của thiết bị MC. */
  xyNotation?: 'hex' | 'octal';
  /** Thiết bị của kênh Omron FINS (feature 018): địa chỉ FINS, thứ tự word mặc định CDAB. */
  fins?: boolean;
  /** Thiết bị của kênh BACnet/IP (feature 020): địa chỉ `AI:1`, `AV:5@8`… */
  bacnet?: boolean;
}

/** Thứ tự chuẩn của mọi cột 0.2 (bộ cột "tất cả"). */
const ALL: readonly string[] = [
  'id',
  'kind',
  'type',
  'description',
  'unit',
  'device',
  'address',
  'fc',
  'offset',
  'regs',
  'scanGroup',
  'rawType',
  'byteOrder',
  'access',
  'min',
  'max',
  'valueTable',
  'rawMin',
  'rawMax',
  'engMin',
  'engMax',
  'limMin',
  'limMax',
  'deadband',
  'initial',
  'retain',
  'expression',
  'simKind',
];

export const COLUMN_SETS: Readonly<Record<ColumnSet, readonly string[]>> = {
  all: ALL,
  external: [
    'id',
    'description',
    'type',
    'unit',
    'device',
    'address',
    'fc',
    'offset',
    'regs',
    'scanGroup',
    'access',
    'min',
    'max',
    'valueTable',
    'rawMin',
    'rawMax',
    'engMin',
    'engMax',
    'limMin',
    'limMax',
    'deadband',
  ],
  internal: [
    'id',
    'description',
    'type',
    'unit',
    'initial',
    'retain',
    'access',
    'min',
    'max',
    'valueTable',
  ],
  calculated: ['id', 'description', 'type', 'unit', 'expression', 'min', 'max', 'valueTable'],
  simulation: [
    'id',
    'description',
    'type',
    'unit',
    'simKind',
    'access',
    'min',
    'max',
    'valueTable',
  ],
};

/** Cột của project 0.1 (như Bảng Tag của 004). */
const COLUMNS_01: readonly string[] = ['id', 'type', 'source', 'unit', 'min', 'max', 'description'];

const TYPES: readonly TagDataType[] = [
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
];
const NUMERIC = new Set<string>(TYPES.filter((x) => x !== 'BOOL' && x !== 'STRING'));
const INTEGER = new Set<string>(['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64']);
const KINDS = ['external', 'internal', 'calculated', 'simulation'] as const;

/** Cột phụ chỉ có ở Inspector của Tag (không hiện trong lưới). */
const EXTRA_DEFS: Readonly<Record<string, ColDef>> = {
  stringLength: { kind: 'number', width: 90 },
  stringByteOrder: { kind: 'select', width: 90 },
  readback: { kind: 'select', width: 90 },
  clamp: { kind: 'select', width: 90 },
  maxLength: { kind: 'number', width: 90 },
  simValue: { kind: 'text', width: 90 },
  simFrom: { kind: 'number', width: 90 },
  simTo: { kind: 'number', width: 90 },
  simPeriodMs: { kind: 'number', width: 90 },
  simCenter: { kind: 'number', width: 90 },
  simAmplitude: { kind: 'number', width: 90 },
  simPhase: { kind: 'number', width: 90 },
  simMin: { kind: 'number', width: 90 },
  simMax: { kind: 'number', width: 90 },
  simSeed: { kind: 'number', width: 90 },
  simDuty: { kind: 'number', width: 90 },
  simInitial: { kind: 'text', width: 90 },
  simSignal: { kind: 'text', width: 140 },
};
/** Cột phụ của mô phỏng → khóa trong `sim`. */
const SIM_COL: ReadonlyMap<string, string> = new Map([
  ['simValue', 'value'],
  ['simFrom', 'from'],
  ['simTo', 'to'],
  ['simCenter', 'center'],
  ['simAmplitude', 'amplitude'],
  ['simMin', 'min'],
  ['simMax', 'max'],
  ['simPeriodMs', 'periodMs'],
  ['simPhase', 'phase'],
  ['simSeed', 'seed'],
  ['simDuty', 'duty'],
  ['simInitial', 'initial'],
  ['simSignal', 'signal'],
]);
const SIM_TEXT_OK: ReadonlySet<string> = new Set(['value', 'initial']);
/** Tham số của từng kiểu mô phỏng (data-model §5). */
const SIM_PARAMS: Readonly<Record<string, readonly string[]>> = {
  const: ['value'],
  ramp: ['from', 'to', 'periodMs'],
  sine: ['center', 'amplitude', 'periodMs', 'phase'],
  random: ['min', 'max', 'periodMs', 'seed'],
  square: ['periodMs', 'duty'],
  manual: ['initial'],
  legacy: ['signal'],
};

export interface PropField {
  /** Khóa cột của adapter (cột của lưới hoặc cột phụ). */
  col: string;
  kind: 'text' | 'number' | 'select' | 'multiline' | 'readonly';
  mono?: boolean;
}

export interface PropGroup {
  key: 'general' | 'source' | 'scaling' | 'limits' | 'initial' | 'expression' | 'simulation';
  fields: PropField[];
}

/**
 * Nhóm thuộc tính của một Tag cho Inspector (FR-047): chỉ nhóm và trường dùng được cho loại và kiểu của Tag. `s7`: Tag của
 * CPU Siemens S7 (không có mã hàm, offset, thanh ghi, thứ tự byte).
 */
export function propertyGroups(
  tag: unknown,
  opts: { s7?: boolean; opcua?: boolean } = {},
): PropGroup[] {
  // Tag của CPU S7 (016) hay server OPC UA (019): không mã hàm, offset, thanh ghi, thứ tự byte
  const s7 = opts.s7 === true || opts.opcua === true;
  const tg = obj(tag);
  const kind = tg.kind as Kind | undefined;
  const numeric = NUMERIC.has(String(tg.type));
  const f = (col: string, k: PropField['kind'] = 'text', mono = false): PropField => ({
    col,
    kind: k,
    ...(mono ? { mono } : {}),
  });
  const groups: PropGroup[] = [
    {
      key: 'general',
      fields: [
        f('id', 'text', true),
        f('kind', 'select'),
        f('type', 'select'),
        f('description'),
        f('unit'),
        ...(numeric ? [f('min', 'number'), f('max', 'number'), f('deadband', 'number')] : []),
        ...(kind !== 'calculated' ? [f('access', 'select')] : []),
        f('valueTable', 'select'),
      ],
    },
  ];
  const src = obj(tg.source);
  const isString = (src.rawType ?? tg.type) === 'STRING';
  const wide = ['INT32', 'UINT32', 'FLOAT32', 'INT64', 'UINT64', 'FLOAT64'].includes(
    String(src.rawType ?? tg.type),
  );
  if (kind === 'external') {
    groups.push({
      key: 'source',
      fields: [
        f('device', 'select', true),
        f('address', 'text', true),
        ...(s7
          ? []
          : [f('fc', 'readonly', true), f('offset', 'readonly', true), f('regs', 'readonly')]),
        f('scanGroup', 'select'),
        f('rawType', 'select'),
        ...(wide && !s7 ? [f('byteOrder', 'select', true)] : []),
        ...(isString ? [f('stringLength', 'number')] : []),
        ...(isString && !s7 ? [f('stringByteOrder', 'select', true)] : []),
        f('readback', 'select'),
      ],
    });
    if (numeric)
      groups.push({
        key: 'scaling',
        fields: [
          f('rawMin', 'number'),
          f('rawMax', 'number'),
          f('engMin', 'number'),
          f('engMax', 'number'),
          ...(tg.scaling ? [f('clamp', 'select')] : []),
        ],
      });
  }
  if (kind !== 'calculated')
    groups.push({
      key: 'limits',
      fields: [
        ...(numeric ? [f('limMin', 'number'), f('limMax', 'number')] : []),
        ...(tg.type === 'STRING' ? [f('maxLength', 'number')] : []),
      ],
    });
  if (kind === 'internal')
    groups.push({ key: 'initial', fields: [f('initial'), f('retain', 'select')] });
  if (kind === 'calculated')
    groups.push({ key: 'expression', fields: [f('expression', 'multiline', true)] });
  if (kind === 'simulation') {
    const k = String(obj(tg.sim).kind);
    const cols = [...SIM_COL.entries()]
      .filter(([, key]) => (SIM_PARAMS[k] ?? []).includes(key))
      .map(([col]) => col);
    groups.push({
      key: 'simulation',
      fields: [
        f('simKind', 'select'),
        ...cols.map((c) =>
          f(c, c === 'simValue' || c === 'simInitial' || c === 'simSignal' ? 'text' : 'number'),
        ),
      ],
    });
  }
  return groups.filter((g) => g.fields.length > 0);
}
type Kind = (typeof KINDS)[number];
const SCAN = ['fast', 'normal', 'slow'] as const;
const ORDERS = ['ABCD', 'CDAB', 'BADC', 'DCBA'] as const;
const SIMS = ['const', 'ramp', 'sine', 'random', 'square', 'manual'] as const;
const ID_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

interface ColDef {
  kind: ColKind;
  width: number;
  mono?: boolean;
  name?: boolean;
  end?: boolean;
}

const DEFS: Readonly<Record<string, ColDef>> = {
  id: { kind: 'text', width: 160, mono: true, name: true },
  kind: { kind: 'select', width: 92 },
  type: { kind: 'select', width: 88 },
  description: { kind: 'text', width: 220 },
  unit: { kind: 'text', width: 64 },
  device: { kind: 'select', width: 130, mono: true },
  address: { kind: 'text', width: 100, mono: true },
  fc: { kind: 'readonly', width: 92, mono: true },
  offset: { kind: 'readonly', width: 66, mono: true, end: true },
  regs: { kind: 'readonly', width: 72, end: true },
  scanGroup: { kind: 'select', width: 90 },
  rawType: { kind: 'select', width: 96 },
  byteOrder: { kind: 'select', width: 84, mono: true },
  access: { kind: 'select', width: 64 },
  min: { kind: 'number', width: 70, end: true },
  max: { kind: 'number', width: 70, end: true },
  valueTable: { kind: 'select', width: 130 },
  rawMin: { kind: 'number', width: 92, end: true },
  rawMax: { kind: 'number', width: 92, end: true },
  engMin: { kind: 'number', width: 104, end: true },
  engMax: { kind: 'number', width: 104, end: true },
  limMin: { kind: 'number', width: 92, end: true },
  limMax: { kind: 'number', width: 92, end: true },
  deadband: { kind: 'number', width: 84, end: true },
  initial: { kind: 'text', width: 96 },
  retain: { kind: 'select', width: 120 },
  expression: { kind: 'text', width: 260, mono: true },
  simKind: { kind: 'select', width: 110 },
  value: { kind: 'live', width: 110, end: true },
  quality: { kind: 'live', width: 84 },
  reason: { kind: 'live', width: 200 },
  source: { kind: 'readonly', width: 170 },
};

const LABEL01: Readonly<Record<string, MessageKey>> = {
  id: 'grid.col.id',
  type: 'grid.col.type',
  source: 'grid.col.source',
  unit: 'grid.col.unit',
  min: 'grid.col.min',
  max: 'grid.col.max',
  description: 'grid.col.description',
};

const LABEL: Readonly<Record<string, MessageKey>> = Object.fromEntries(
  Object.keys(DEFS).map((k) => [k, `tt.col.${k}` as MessageKey]),
);

export interface ColumnChoice {
  set: ColumnSet;
  /** Cột chọn tay; `null`: theo bộ cột. */
  columns: string[] | null;
}

const CHOICE_KEY = 'mat.studio.tagColumns';
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadColumnChoice(storage: StorageLike | null): ColumnChoice {
  const none: ColumnChoice = { set: 'all', columns: null };
  try {
    const raw = storage?.getItem(CHOICE_KEY);
    if (!raw) return none;
    const v = JSON.parse(raw) as { set?: unknown; columns?: unknown };
    const set = typeof v.set === 'string' && v.set in COLUMN_SETS ? (v.set as ColumnSet) : 'all';
    const columns =
      Array.isArray(v.columns) && v.columns.every((c) => typeof c === 'string')
        ? (v.columns as string[])
        : null;
    return { set, columns };
  } catch {
    return none;
  }
}

export function saveColumnChoice(storage: StorageLike | null, choice: ColumnChoice): void {
  try {
    storage?.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    /* storage bị chặn: chỉ là tiện ích */
  }
}

export interface TagTableOptions {
  tags: readonly AnyTag[];
  devices?: readonly DeviceInfo[];
  valueTables?: readonly string[];
  set?: ColumnSet;
  columns?: readonly string[] | null;
  version?: '0.1' | '0.2';
  readOnly?: boolean;
  /** Thêm cột giá trị sống, quality, lý do sau cột tên. */
  live?: boolean;
  liveText?: (tagId: string, col: 'value' | 'quality' | 'reason') => string;
}

export interface AddressInfo {
  ok: boolean;
  normalized?: string;
  fc?: string;
  offset?: number;
  regs?: number;
  /** Tag của CPU S7: vùng, kiểu S7, số byte (thay cho mã hàm, offset, thanh ghi). */
  s7?: { area: string; type: string; size: number };
  /** Tag của server OPC UA (feature 019): namespace và loại NodeId. */
  opcua?: { ns: number; idType: string };
  /** Địa chỉ Mitsubishi MC (feature 017): thiết bị, số, số word, bit trong word. */
  /** Địa chỉ BACnet hợp lệ (feature 020): đối tượng, thuộc tính, priority. */
  bacnet?: { object: string; property: string; priority: number };
  mc?: { device: string; bitDevice: boolean; number: number; words: number; bit: number | null };
  /** Khóa chuỗi lỗi khi `ok = false`. */
  error?: MessageKey;
}

/** Địa chỉ FINS đã kiểm (feature 018), cùng các trường mà cột fc/offset/regs đọc. */
interface FinsParsed {
  ok: true;
  fins: true;
  normalized: string;
  offset: number;
  registers: number;
  /** Lệnh và mã vùng: `0101/0102 · 82`. */
  codeText: string;
}
type ModbusOrFins = AddressResult | FinsParsed;

const fcText = (r: Extract<ModbusOrFins, { ok: true }>): string =>
  'fins' in r
    ? r.codeText
    : String(r.fcRead).padStart(2, '0') +
      (r.fcWrite.length ? ` / ${r.fcWrite.map((n) => String(n).padStart(2, '0')).join(', ')}` : '');

const ADDR_ERR: Record<string, MessageKey> = {
  E_ADDR_SYNTAX: 'tt.err.address',
  E_ADDR_AREA: 'tt.err.addressArea',
  E_ADDR_RANGE: 'tt.err.addressRange',
};

const OPCUA_ADDR_ERR: Record<string, MessageKey> = {
  E_ADDR_SYNTAX: 'tt.err.opcuaNodeId',
  E_ADDR_RANGE: 'tt.err.opcuaNodeIdRange',
};

const S7_ADDR_ERR: Record<string, MessageKey> = {
  E_ADDR_SYNTAX: 'tt.err.s7Address',
  E_ADDR_AREA: 'tt.err.s7AddressArea',
  E_ADDR_RANGE: 'tt.err.s7AddressRange',
};

/** Câu của một địa chỉ hợp lệ (dòng gợi ý, Inspector): mã hàm, offset, thanh ghi; Tag S7: vùng, kiểu S7, số byte. */
export function addressInfoText(info: AddressInfo): string {
  if (info.opcua)
    return t('tt.hint.opcuaNodeId', {
      ns: info.opcua.ns,
      idType: t(`tt.opcuaIdType.${info.opcua.idType}` as MessageKey),
    });
  if (info.bacnet)
    return t('tt.hint.bacnet', {
      object: info.bacnet.object,
      property: info.bacnet.property,
      priority: info.bacnet.priority ? ` @${info.bacnet.priority}` : '',
    });
  const m = info.mc;
  if (m)
    return m.bit !== null
      ? t('tt.hint.mcBit', {
          device: m.device,
          bit: m.bit.toString(16).toUpperCase(),
          number: m.number,
        })
      : t('tt.hint.mc', {
          device: m.device,
          area: t(m.bitDevice ? 'tt.mc.area.bit' : 'tt.mc.area.word'),
          number: m.number,
          words: m.words,
        });
  return info.s7
    ? t('tt.hint.s7Address', { area: info.s7.area, type: info.s7.type, size: info.s7.size })
    : t('tt.hint.address', { fc: info.fc ?? '', offset: info.offset ?? 0, regs: info.regs ?? 0 });
}

/** Gợi ý cú pháp địa chỉ BACnet (feature 020). */
export const bacnetHint = (): string =>
  t('tagTable.bacnetHint', {
    examples: BACNET_ADDRESS_HINTS.slice(0, 5)
      .map((h) => h.example)
      .join(', '),
  });

/** Dòng gợi ý của địa chỉ (ô địa chỉ, Thuộc tính): lỗi, hoặc câu của địa chỉ hợp lệ (feature 017). */
export function addressHintText(info: AddressInfo): string {
  if (!info.ok) return info.error ? t(info.error) : '';
  return addressInfoText(info);
}

/** Địa chỉ đã phân tích của một dòng: theo Modbus hoặc theo S7 (thiết bị trường thuộc kênh S7). */
type Parsed = { s7: false; r: ModbusOrFins } | { s7: true; r: S7AddressResult };

export class TagTable implements GridAdapter {
  readonly columns: readonly GridColumn[];
  readonly maxRows: number;
  private readonly tags: readonly Obj[];
  private readonly devices: readonly DeviceInfo[];
  private readonly tables: readonly string[];
  private readonly set: ColumnSet;
  private readonly v01: boolean;
  private readonly readOnly: boolean;
  private readonly liveText: TagTableOptions['liveText'];
  private readonly addrCache = new Map<number, Parsed | null>();
  private readonly mcCache = new Map<number, McAddressResult | null>();
  private readonly bacnetCache = new Map<number, BacnetAddressResult | null>();
  private readonly opcuaCache = new Map<number, OpcUaNodeIdResult | null>();
  private readonly opts: TagTableOptions;

  constructor(opts: TagTableOptions) {
    this.opts = opts;
    this.tags = opts.tags as unknown as readonly Obj[];
    this.devices = opts.devices ?? [];
    this.tables = opts.valueTables ?? [];
    this.set = opts.set ?? 'all';
    this.v01 = opts.version === '0.1';
    this.readOnly = !!opts.readOnly;
    this.liveText = opts.liveText;
    this.maxRows = this.readOnly ? 0 : this.v01 ? 2000 : MAX_TAG_ROWS;
    const base = this.v01 ? COLUMNS_01 : COLUMN_SETS[this.set];
    let keys: string[];
    if (!this.v01 && opts.columns && opts.columns.length) {
      const wanted = new Set(opts.columns);
      keys = ALL.filter((k) => k === 'id' || wanted.has(k));
    } else keys = [...base];
    if (opts.live && !this.v01) keys.splice(1, 0, 'value', 'quality', 'reason');
    else if (opts.live) keys.splice(1, 0, 'value', 'quality');
    this.columns = keys.map((key) => {
      const d = DEFS[key];
      const label = t(this.v01 ? (LABEL01[key] ?? LABEL[key]) : LABEL[key]);
      return { key, label, kind: d.kind, width: d.width, mono: d.mono, name: d.name, end: d.end };
    });
  }

  rowCount(): number {
    return this.tags.length;
  }

  // ---------- Đọc ô ----------

  private tag(row: number): Obj {
    return this.tags[row] ?? {};
  }

  private deviceOf(tag: Obj): DeviceInfo | undefined {
    const id = obj(tag.source).device;
    return this.devices.find((d) => d.id === id);
  }

  /** Tag ngoài của một CPU Siemens S7 (thiết bị trường thuộc kênh `s7`). */
  private isOpcUa(tag: Obj): boolean {
    return tag.kind === 'external' && this.deviceOf(tag)?.kind === 'opcua';
  }

  /** Tag S7 (016) hay OPC UA (019): không có thứ tự byte của Modbus. */
  private noByteOrder(tag: Obj): boolean {
    return this.isS7(tag) || this.isOpcUa(tag);
  }

  private opcuaParsed(row: number): OpcUaNodeIdResult | null {
    const hit = this.opcuaCache.get(row);
    if (hit !== undefined) return hit;
    const r = this.opcuaParseFor(this.tag(row));
    this.opcuaCache.set(row, r);
    return r;
  }

  /** NodeId của Tag thuộc kênh `opcua` (giữ hoa/thường và dấu cách bên trong, chỉ bỏ cách hai đầu); khác thì `null`. */
  private opcuaParseFor(tag: Obj, address?: string): OpcUaNodeIdResult | null {
    const src = obj(tag.source);
    const text = address ?? (typeof src.address === 'string' ? src.address : '');
    if (text.trim() === '' || !this.isOpcUa(tag)) return null;
    return parseOpcUaNodeId(text.trim());
  }

  /** Dòng là Tag của một server OPC UA (feature 019). */
  isOpcUaRow(row: number): boolean {
    return this.isOpcUa(this.tag(row));
  }

  /** Tag ngoài của một CPU Siemens S7 (thiết bị trường thuộc kênh `s7`). */
  private isS7(tag: Obj): boolean {
    return tag.kind === 'external' && this.deviceOf(tag)?.kind === 's7';
  }

  /** Địa chỉ Modbus của dòng (Tag S7 hay chưa có địa chỉ: `null`); cho các cột mã hàm, offset, thanh ghi. */
  private modbus(row: number): ModbusOrFins | null {
    const p = this.parsed(row);
    return p && !p.s7 ? p.r : null;
  }

  private parsed(row: number): Parsed | null {
    const hit = this.addrCache.get(row);
    if (hit !== undefined) return hit;
    const r = this.parseFor(this.tag(row));
    this.addrCache.set(row, r);
    return r;
  }

  /** Thiết bị trường của Tag thuộc kênh BACnet/IP (feature 020). */
  private isBacnet(tag: Obj): boolean {
    return tag.kind === 'external' && !!this.deviceOf(tag)?.bacnet;
  }

  private bacnetParsed(row: number): BacnetAddressResult | null {
    const hit = this.bacnetCache.get(row);
    if (hit !== undefined) return hit;
    const r = this.bacnetParseFor(this.tag(row));
    this.bacnetCache.set(row, r);
    return r;
  }

  /** Địa chỉ BACnet của Tag ngoài có thiết bị thuộc kênh `bacnet`; khác thì `null`. */
  private bacnetParseFor(tag: Obj, address?: string): BacnetAddressResult | null {
    const src = obj(tag.source);
    const text = address ?? (typeof src.address === 'string' ? src.address : '');
    if (text.trim() === '' || !this.isBacnet(tag)) return null;
    const raw = (typeof src.rawType === 'string' ? src.rawType : tag.type) as TagDataType;
    return parseBacnetAddress(text.trim(), {
      rawType: raw,
      access: tag.access === 'RW' ? 'RW' : 'R',
    });
  }

  /** Dòng là Tag của thiết bị BACnet (feature 020): gợi ý cú pháp BACnet thay cho Modbus. */
  isBacnetRow(row: number): boolean {
    return this.isBacnet(this.tag(row));
  }

  /** Thiết bị trường của Tag thuộc kênh Mitsubishi MC (feature 017). */
  private isMc(tag: Obj): boolean {
    return this.deviceOf(tag)?.channelKind === 'mc';
  }

  private mcParsed(row: number): McAddressResult | null {
    const hit = this.mcCache.get(row);
    if (hit !== undefined) return hit;
    const r = this.mcParseFor(this.tag(row));
    this.mcCache.set(row, r);
    return r;
  }

  /** Địa chỉ MC của Tag ngoài có thiết bị thuộc kênh `mc`; khác thì `null`. */
  private mcParseFor(tag: Obj, address?: string): McAddressResult | null {
    const src = obj(tag.source);
    const text = address ?? (typeof src.address === 'string' ? src.address : '');
    if (tag.kind !== 'external' || text.trim() === '' || !this.isMc(tag)) return null;
    const raw = (typeof src.rawType === 'string' ? src.rawType : tag.type) as TagDataType;
    return parseMcAddress(text.trim(), {
      rawType: raw,
      stringLength: typeof src.stringLength === 'number' ? src.stringLength : undefined,
      access: tag.access === 'RW' ? 'RW' : 'R',
      xyNotation: this.deviceOf(tag)?.xyNotation ?? 'hex',
    });
  }

  private parseFor(tag: Obj, address?: string): Parsed | null {
    const src = obj(tag.source);
    const text = address ?? (typeof src.address === 'string' ? src.address : '');
    if (
      tag.kind !== 'external' ||
      text.trim() === '' ||
      this.isMc(tag) ||
      this.isBacnet(tag) ||
      this.isOpcUa(tag)
    )
      return null;
    const raw = (typeof src.rawType === 'string' ? src.rawType : tag.type) as TagDataType;
    if (this.deviceOf(tag)?.fins) {
      const r = parseFinsAddress(text.trim(), {
        rawType: raw,
        stringLength: typeof src.stringLength === 'number' ? src.stringLength : undefined,
        access: tag.access === 'RW' ? 'RW' : 'R',
      });
      if (!r.ok) return { s7: false, r };
      const code = r.flag || r.bit !== null ? r.bitCode : r.wordCode;
      return {
        s7: false,
        r: {
          ok: true,
          fins: true,
          normalized: r.normalized,
          offset: r.wire,
          registers: r.words,
          codeText: `0101${r.writable ? '/0102' : ''} · ${code}`,
        },
      };
    }
    const opts = {
      rawType: raw,
      stringLength: typeof src.stringLength === 'number' ? src.stringLength : undefined,
      access: tag.access === 'RW' ? ('RW' as const) : ('R' as const),
    };
    if (this.isS7(tag)) return { s7: true, r: parseS7Address(text.trim(), opts) };
    return {
      s7: false,
      r: parseAddress(text.trim(), { ...opts, addressBase: this.deviceOf(tag)?.addressBase ?? 0 }),
    };
  }

  /** Dòng của Tag ngoài trên thiết bị Omron FINS (feature 018). */
  isFinsRow(row: number): boolean {
    const tg = this.tag(row);
    return tg.kind === 'external' && this.deviceOf(tg)?.fins === true;
  }

  /** Gợi ý cú pháp địa chỉ FINS cho ô địa chỉ (feature 018). */
  finsHint(): string {
    return t('tagTable.finsHint', {
      examples: FINS_ADDRESS_HINTS.map((h) => h.example).join(', '),
    });
  }

  /** Thông tin địa chỉ của dòng: dùng cho dòng gợi ý và cột chỉ đọc. */
  addressInfo(row: number): AddressInfo | null {
    const u = this.opcuaParsed(row);
    if (u) {
      if (!u.ok) return { ok: false, error: OPCUA_ADDR_ERR[u.error] };
      return { ok: true, normalized: u.normalized, opcua: { ns: u.ns, idType: u.idType } };
    }
    const b = this.bacnetParsed(row);
    if (b) {
      if (!b.ok) return { ok: false, error: ADDR_ERR[b.error] };
      const name = Object.keys(BACNET_PROPERTIES).find((k) => BACNET_PROPERTIES[k] === b.property);
      return {
        ok: true,
        normalized: b.normalized,
        bacnet: {
          object: `${b.objectType}:${b.instance}`,
          property: b.relinquish ? 'relinquish' : (name ?? String(b.property)),
          priority: b.priority,
        },
      };
    }
    const m = this.mcParsed(row);
    if (m) {
      if (!m.ok) {
        const src = obj(this.tag(row).source);
        return {
          ok: false,
          error: mcAddressError(
            m.error,
            str(src.address),
            this.deviceOf(this.tag(row))?.xyNotation,
          ),
        };
      }
      return {
        ok: true,
        normalized: m.normalized,
        offset: m.number,
        regs: m.words,
        mc: {
          device: m.device,
          bitDevice: m.bitDevice,
          number: m.number,
          words: m.words,
          bit: m.bit,
        },
      };
    }
    const p = this.parsed(row);
    if (!p) return null;
    if (p.s7) {
      const r = p.r;
      if (!r.ok) return { ok: false, error: S7_ADDR_ERR[r.error] };
      return {
        ok: true,
        normalized: r.normalized,
        s7: { area: r.area, type: r.s7Type, size: r.size },
      };
    }
    const r = p.r;
    if (!r.ok) return { ok: false, error: ADDR_ERR[r.error] };
    return {
      ok: true,
      normalized: r.normalized,
      fc: fcText(r),
      offset: r.offset,
      regs: r.registers,
    };
  }

  /** Dòng là Tag của một CPU Siemens S7. */
  isS7Row(row: number): boolean {
    return this.isS7(this.tag(row));
  }

  /**
   * Câu gợi ý định dạng địa chỉ khi ô còn trống: theo loại kênh của thiết bị trường (Modbus, S7, hay ví dụ MC theo kiểu
   * Tag và cách viết X, Y của feature 017).
   */
  addressSyntaxHint(row: number): string {
    const tg = this.tag(row);
    if (this.isS7(tg)) return t('tt.hint.s7Syntax');
    if (this.isOpcUa(tg)) return t('tt.hint.opcuaSyntax');
    if (!this.isMc(tg)) return t('tt.hint.syntax');
    const raw = (obj(tg.source).rawType ?? tg.type) as TagDataType | undefined;
    return t('tt.hint.mcSyntax', {
      examples: mcExamples(raw, this.deviceOf(tg)?.xyNotation).join(', '),
    });
  }

  text(row: number, col: string): string {
    const tg = this.tag(row);
    const src = obj(tg.source);
    const kind = tg.kind as Kind | undefined;
    switch (col) {
      case 'value':
      case 'quality':
      case 'reason':
        return this.liveText?.(String(tg.id ?? ''), col) ?? '';
      case 'id':
      case 'type':
      case 'description':
      case 'unit':
        return str(tg[col]);
      case 'kind':
        return kind ? t(`tt.kind.${kind}` as MessageKey) : '';
      case 'min':
      case 'max':
      case 'deadband':
        return num(tg[col]);
      case 'access':
        return tg.access === 'RW' ? 'RW' : 'R';
      case 'device':
        return kind === 'external' ? str(src.device) : '';
      case 'address':
        return kind === 'external' ? str(src.address) : '';
      case 'scanGroup':
        return kind === 'external' ? str(src.scanGroup) || 'normal' : '';
      case 'rawType':
        return kind === 'external' ? str(src.rawType) || str(tg.type) : '';
      case 'byteOrder':
        return kind === 'external' && this.wide(tg) && !this.noByteOrder(tg)
          ? str(src.byteOrder) || this.deviceOf(tg)?.byteOrder || 'ABCD'
          : '';
      case 'fc': {
        const r = this.modbus(row);
        return r?.ok ? fcText(r) : '';
      }
      case 'offset': {
        const m = this.mcParsed(row);
        if (m) return m.ok ? String(m.number) : '';
        const r = this.modbus(row);
        return r?.ok ? String(r.offset) : '';
      }
      case 'regs': {
        const m = this.mcParsed(row);
        if (m) return m.ok ? String(m.words) : '';
        const r = this.modbus(row);
        return r?.ok ? String(r.registers) : '';
      }
      case 'valueTable':
        return str(tg.valueTable);
      case 'rawMin':
      case 'rawMax':
      case 'engMin':
      case 'engMax':
        return kind === 'external' ? num(obj(tg.scaling)[col]) : '';
      case 'limMin':
        return num(obj(tg.limits).min);
      case 'limMax':
        return num(obj(tg.limits).max);
      case 'initial':
        return kind === 'internal' && tg.initial !== undefined ? String(tg.initial) : '';
      case 'retain':
        return kind === 'internal' ? t(tg.retain === true ? 'tt.bool.true' : 'tt.bool.false') : '';
      case 'expression':
        return kind === 'calculated' ? str(tg.expression) : '';
      case 'simKind': {
        if (kind !== 'simulation') return '';
        const k = str(obj(tg.sim).kind);
        return k ? t(`tt.sim.${k}` as MessageKey) : '';
      }
      case 'stringLength':
        return kind === 'external' ? num(src.stringLength) : '';
      case 'stringByteOrder':
        return kind === 'external' && this.isString(tg) && !this.noByteOrder(tg)
          ? str(src.stringByteOrder) || 'AB'
          : '';
      case 'readback':
        return kind === 'external'
          ? t(src.readback === false ? 'tt.bool.false' : 'tt.bool.true')
          : '';
      case 'clamp':
        return kind === 'external' && tg.scaling
          ? t(obj(tg.scaling).clamp === true ? 'tt.bool.true' : 'tt.bool.false')
          : '';
      case 'maxLength':
        return num(obj(tg.limits).maxLength);
      case 'source': {
        const s = tg.source;
        if (!s || typeof s !== 'object') return '';
        const o = s as Obj;
        return o.kind === 'mock'
          ? t('grid.source.mock', { signal: str(o.signal) })
          : JSON.stringify(s);
      }
      default:
        break;
    }
    const sim = SIM_COL.get(col);
    if (sim)
      return kind === 'simulation'
        ? obj(tg.sim)[sim] === undefined
          ? ''
          : String(obj(tg.sim)[sim])
        : '';
    return '';
  }

  private isString(tg: Obj): boolean {
    return (obj(tg.source).rawType ?? tg.type) === 'STRING';
  }

  private wide(tg: Obj): boolean {
    const raw = obj(tg.source).rawType ?? tg.type;
    return ['INT32', 'UINT32', 'FLOAT32', 'INT64', 'UINT64', 'FLOAT64'].includes(String(raw));
  }

  editable(row: number, col: string): boolean {
    if (this.readOnly) return false;
    const def = DEFS[col];
    if (!def || def.kind === 'readonly' || def.kind === 'live') return false;
    if (this.v01) return ['id', 'type', 'description', 'unit', 'min', 'max'].includes(col);
    return this.applicable(this.tag(row), col);
  }

  /** Ô còn sửa được trên bản đang dựng của dòng (loại Tag có thể vừa đổi trong cùng lần sửa). */
  private cellOpen(row: number, work: Obj, col: string): boolean {
    if (this.readOnly) return false;
    if (this.v01) return this.editable(row, col);
    const def = DEFS[col] ?? EXTRA_DEFS[col];
    return !!def && def.kind !== 'readonly' && def.kind !== 'live' && this.applicable(work, col);
  }

  /** Bản có đủ cột (mọi cột 0.2) cho nhập và xuất CSV. */
  full(): TagTable {
    return new TagTable({ ...this.opts, set: 'all', columns: null, live: false });
  }

  /** Ô có dùng cho loại Tag của dòng không (theo data-model §1). */
  private applicable(tg: Obj, col: string): boolean {
    const kind = tg.kind as Kind | undefined;
    const numeric = NUMERIC.has(String(tg.type));
    switch (col) {
      case 'device':
      case 'address':
      case 'scanGroup':
      case 'rawType':
        return kind === 'external';
      case 'byteOrder':
        return kind === 'external' && this.wide(tg) && !this.noByteOrder(tg);
      case 'rawMin':
      case 'rawMax':
      case 'engMin':
      case 'engMax':
        return kind === 'external' && numeric;
      case 'stringLength':
        return kind === 'external' && this.isString(tg);
      case 'stringByteOrder':
        return kind === 'external' && this.isString(tg) && !this.noByteOrder(tg);
      case 'readback':
        return kind === 'external';
      case 'clamp':
        return kind === 'external' && !!tg.scaling;
      case 'maxLength':
        return kind !== 'calculated' && tg.type === 'STRING';
      case 'initial':
      case 'retain':
        return kind === 'internal';
      case 'expression':
        return kind === 'calculated';
      case 'simKind':
        return kind === 'simulation';
      case 'access':
      case 'limMin':
      case 'limMax':
        return kind !== 'calculated';
      default:
        break;
    }
    const simKey = SIM_COL.get(col);
    if (simKey)
      return kind === 'simulation' && (SIM_PARAMS[String(obj(tg.sim).kind)] ?? []).includes(simKey);
    switch (col) {
      case 'min':
      case 'max':
      case 'deadband':
        return numeric;
      default:
        return true;
    }
  }

  options(_row: number, col: string): readonly string[] | null {
    switch (col) {
      case 'kind':
        return KINDS.map((k) => t(`tt.kind.${k}` as MessageKey));
      case 'type':
      case 'rawType':
        return TYPES;
      case 'device':
        return this.devices.map((d) => d.id);
      case 'scanGroup':
        return SCAN;
      case 'byteOrder':
        return ORDERS;
      case 'access':
        return ['R', 'RW'];
      case 'valueTable':
        return ['', ...this.tables];
      case 'retain':
      case 'readback':
      case 'clamp':
        return [t('tt.bool.true'), t('tt.bool.false')];
      case 'stringByteOrder':
        return ['AB', 'BA'];
      case 'simKind':
        return SIMS.map((s) => t(`tt.sim.${s}` as MessageKey));
      default:
        return null;
    }
  }

  searchText(row: number): string {
    const tg = this.tag(row);
    return [tg.id, tg.description, obj(tg.source).address, obj(tg.source).device]
      .map((x) => (typeof x === 'string' ? x : ''))
      .join(' ');
  }

  // ---------- Sửa ----------

  apply(changes: readonly CellChange[]): ApplyResult {
    const rejected: Rejected[] = [];
    const groups = new Map<string, CellChange[]>();
    for (const c of changes) {
      const key = c.row === null ? `+${c.newIndex ?? 0}` : String(c.row);
      const list = groups.get(key);
      if (list) list.push(c);
      else groups.set(key, [c]);
    }
    const taken = new Set(this.tags.map((x) => String(x.id)));
    const edits: ProjectEdit[] = [];
    const created: Array<{ order: number; tag: Obj }> = [];
    const renamed = new Map<number, string>();
    for (const list of groups.values()) {
      const first = list[0];
      const isNew = first.row === null;
      const orig = isNew ? null : this.tag(first.row!);
      const work: Obj = isNew ? this.blank() : structuredClone(orig!);
      const fail = (c: CellChange, reason: MessageKey) =>
        rejected.push({ row: c.row, newIndex: c.newIndex, col: c.col, text: c.text, reason });
      let idFailed = false;
      // Địa chỉ xét sau cùng vì phụ thuộc kiểu, thiết bị và quyền đã đổi trong cùng lần dán.
      // Loại Tag xét đầu tiên vì quyết định ô nào còn dùng được.
      const rank = (col: string) => (col === 'kind' ? -1 : col === 'address' ? 1 : 0);
      const ordered = [...list].sort((a, b) => rank(a.col) - rank(b.col));
      for (const c of ordered) {
        if (c.col === 'id') {
          const err = this.checkId(c.text.trim(), taken, isNew ? null : String(orig!.id));
          if (err) {
            idFailed = true;
            fail(c, err);
            continue;
          }
          const id = c.text.trim();
          if (!isNew && String(orig!.id) !== id) {
            taken.delete(String(orig!.id));
            renamed.set(first.row!, id);
          }
          taken.add(id);
          work.id = id;
          continue;
        }
        if (!isNew && !this.cellOpen(first.row!, work, c.col)) {
          fail(c, 'tt.err.notApplicable');
          continue;
        }
        const err = this.v01 ? this.set01(work, c.col, c.text) : this.setCell(work, c.col, c.text);
        if (err) fail(c, err);
      }
      if (isNew) {
        if (idFailed) continue;
        if (typeof work.id !== 'string') work.id = '';
        created.push({ order: first.newIndex ?? 0, tag: work });
      } else {
        const index = first.row!;
        const keys = new Set([...Object.keys(orig!), ...Object.keys(work)]);
        for (const k of keys) {
          if (JSON.stringify(orig![k]) === JSON.stringify(work[k])) continue;
          edits.push({
            kind: 'tagField',
            index,
            field: k as never,
            ...(work[k] === undefined ? {} : { value: work[k] }),
          });
        }
      }
    }
    for (const { tag } of created.sort((a, b) => a.order - b.order))
      edits.push({ kind: 'tagUpsert', tag: tag as unknown as AnyTag });
    return { edits, rejected };
  }

  /** Tag mới: loại theo bộ cột đang xem, kiểu FLOAT32. */
  private blank(): Obj {
    if (this.v01) return { id: '', type: 'FLOAT32' };
    const kind: Kind = this.set === 'all' ? 'external' : this.set;
    const tag: Obj = { id: '', kind, type: 'FLOAT32' };
    this.enter(tag, kind);
    return tag;
  }

  private checkId(id: string, taken: ReadonlySet<string>, self: string | null): MessageKey | null {
    if (id === '') return 'tt.err.idRequired';
    if (id.length > 64 || !ID_RE.test(id)) return 'tt.err.idSyntax';
    if (id !== self && taken.has(id)) return 'tt.err.idDup';
    return null;
  }

  /** Thêm phần mặc định của loại Tag khi vào loại đó. */
  private enter(tag: Obj, kind: Kind): void {
    if (kind === 'external') tag.source = { device: this.devices[0]?.id ?? '', address: '' };
    else if (kind === 'calculated') tag.expression = '';
    else if (kind === 'simulation') tag.sim = this.simDefault('const', String(tag.type));
  }

  private leave(tag: Obj, kind: Kind): void {
    if (kind === 'external') {
      delete tag.source;
      delete tag.scaling;
    } else if (kind === 'internal') {
      delete tag.initial;
      delete tag.retain;
    } else if (kind === 'calculated') delete tag.expression;
    else delete tag.sim;
  }

  private simDefault(kind: (typeof SIMS)[number], type: string): Obj {
    const bool = type === 'BOOL';
    switch (kind) {
      case 'const':
        return { kind, value: bool ? false : type === 'STRING' ? '' : 0 };
      case 'ramp':
        return { kind, from: 0, to: 100, periodMs: 10000 };
      case 'sine':
        return { kind, center: 50, amplitude: 50, periodMs: 10000 };
      case 'random':
        return { kind, min: 0, max: 100, periodMs: 1000, seed: 1 };
      case 'square':
        return { kind, periodMs: 2000 };
      case 'manual':
        return { kind, initial: bool ? false : type === 'STRING' ? '' : 0 };
    }
  }

  private setCell(w: Obj, col: string, raw: string): MessageKey | null {
    const text = raw.trim();
    const dropEmpty = (key: string, v: unknown): void => {
      if (v === undefined || v === '') delete w[key];
      else w[key] = v;
    };
    switch (col) {
      case 'description':
      case 'unit':
        if (raw.length > (col === 'unit' ? 16 : 200)) return 'tt.err.maxLen';
        dropEmpty(col, raw);
        return null;
      case 'kind': {
        const k = KINDS.find(
          (x) => fold(text) === x || fold(text) === fold(t(`tt.kind.${x}` as MessageKey)),
        );
        if (!k) return 'tt.err.kind';
        const old = w.kind as Kind;
        if (k === old) return null;
        this.leave(w, old);
        w.kind = k;
        this.enter(w, k);
        if (k === 'calculated') delete w.access;
        return null;
      }
      case 'type': {
        const up = text.toUpperCase();
        if (!(TYPES as readonly string[]).includes(up)) return 'tt.err.type';
        w.type = up;
        return null;
      }
      case 'min':
      case 'max':
      case 'deadband': {
        const n = readNumber(text);
        if (n === 'bad') return 'tt.err.number';
        if (col === 'deadband' && typeof n === 'number' && n < 0) return 'tt.err.negative';
        dropEmpty(col, n);
        return null;
      }
      case 'access': {
        const up = text.toUpperCase();
        if (up !== 'R' && up !== 'RW') return 'tt.err.access';
        if (up === 'R') delete w.access;
        else w.access = 'RW';
        return null;
      }
      case 'device': {
        const d = this.devices.find((x) => x.id === text || fold(x.name) === fold(text));
        if (!d) return 'tt.err.device';
        const src: Obj = { ...obj(w.source), device: d.id };
        // PLC S7 luôn big-endian: thứ tự byte của Modbus không áp (bộ kiểm tra báo E_SCHEMA nếu còn).
        if (d.kind === 's7' || d.kind === 'opcua') {
          delete src.byteOrder;
          delete src.stringByteOrder;
        }
        w.source = src;
        return null;
      }
      case 'address': {
        const src = { ...obj(w.source) };
        const info =
          this.parseFor(w, text)?.r ??
          this.mcParseFor(w, text) ??
          this.bacnetParseFor(w, text) ??
          this.opcuaParseFor(w, text);
        // NodeId OPC UA giữ nguyên chữ (chuỗi `s=` là nguyên văn)
        src.address = info?.ok
          ? info.normalized
          : this.isOpcUa(w)
            ? text.trim()
            : text.toUpperCase();
        w.source = src;
        return null;
      }
      case 'scanGroup': {
        const s = text.toLowerCase();
        if (!(SCAN as readonly string[]).includes(s)) return 'tt.err.scanGroup';
        const src = { ...obj(w.source) };
        if (s === 'normal') delete src.scanGroup;
        else src.scanGroup = s;
        w.source = src;
        return null;
      }
      case 'rawType': {
        const up = text.toUpperCase();
        if (!(TYPES as readonly string[]).includes(up)) return 'tt.err.type';
        const src = { ...obj(w.source) };
        if (up === w.type) delete src.rawType;
        else src.rawType = up;
        w.source = src;
        return null;
      }
      case 'byteOrder': {
        if (this.isS7(w)) return 'tt.err.s7ByteOrder';
        if (this.isOpcUa(w)) return 'tt.err.opcuaByteOrder';
        const up = text.toUpperCase();
        if (!(ORDERS as readonly string[]).includes(up)) return 'tt.err.byteOrder';
        w.source = { ...obj(w.source), byteOrder: up };
        return null;
      }
      case 'valueTable':
        if (text !== '' && !this.tables.includes(text)) return 'tt.err.valueTable';
        dropEmpty('valueTable', text);
        return null;
      case 'rawMin':
      case 'rawMax':
      case 'engMin':
      case 'engMax': {
        const n = readNumber(text);
        if (n === 'bad') return 'tt.err.number';
        const cur = obj(w.scaling);
        const has = Object.keys(cur).length > 0;
        if (n === undefined) {
          // Xóa một giá trị: chỉ hợp lệ khi xóa cả thang đo (người dùng xóa đủ bốn ô).
          if (!has) return null;
          const left = { ...cur };
          delete left[col];
          if (Object.keys(left).length === 0) delete w.scaling;
          else return 'tt.err.scalingNeed';
          return null;
        }
        w.scaling = has
          ? { ...cur, [col]: n }
          : { rawMin: 0, rawMax: 100, engMin: 0, engMax: 100, [col]: n };
        return null;
      }
      case 'limMin':
      case 'limMax': {
        const n = readNumber(text);
        if (n === 'bad') return 'tt.err.number';
        const lim = { ...obj(w.limits) };
        const key = col === 'limMin' ? 'min' : 'max';
        if (n === undefined) delete lim[key];
        else lim[key] = n;
        if (Object.keys(lim).length) w.limits = lim;
        else delete w.limits;
        return null;
      }
      case 'initial': {
        if (text === '') {
          delete w.initial;
          return null;
        }
        const v = this.initialValue(String(w.type), raw);
        if (v === undefined) return 'tt.err.initial';
        w.initial = v;
        return null;
      }
      case 'retain': {
        const b = readBool(text);
        if (b === undefined) return 'tt.err.bool';
        if (b) w.retain = true;
        else delete w.retain;
        return null;
      }
      case 'expression':
        if (raw.length > 1000) return 'tt.err.expressionLong';
        w.expression = raw;
        return null;
      case 'simKind': {
        const k = SIMS.find(
          (s) => fold(text) === s || fold(text) === fold(t(`tt.sim.${s}` as MessageKey)),
        );
        if (!k) return 'tt.err.sim';
        if (obj(w.sim).kind !== k) w.sim = this.simDefault(k, String(w.type));
        return null;
      }
      case 'stringLength': {
        const n = readNumber(text);
        if (n === 'bad' || n === undefined || !Number.isInteger(n) || n < 1 || n > 250)
          return 'tt.err.stringLength';
        w.source = { ...obj(w.source), stringLength: n };
        return null;
      }
      case 'stringByteOrder': {
        if (this.isS7(w)) return 'tt.err.s7ByteOrder';
        if (this.isOpcUa(w)) return 'tt.err.opcuaByteOrder';
        const up = text.toUpperCase();
        if (up !== 'AB' && up !== 'BA') return 'tt.err.stringByteOrder';
        const src = { ...obj(w.source) };
        if (up === 'AB') delete src.stringByteOrder;
        else src.stringByteOrder = up;
        w.source = src;
        return null;
      }
      case 'readback': {
        const b = readBool(text);
        if (b === undefined) return 'tt.err.bool';
        const src = { ...obj(w.source) };
        if (b) delete src.readback;
        else src.readback = false;
        w.source = src;
        return null;
      }
      case 'clamp': {
        const b = readBool(text);
        if (b === undefined) return 'tt.err.bool';
        const sc = { ...obj(w.scaling) };
        if (b) sc.clamp = true;
        else delete sc.clamp;
        w.scaling = sc;
        return null;
      }
      case 'maxLength': {
        const n = readNumber(text);
        if (n === 'bad') return 'tt.err.number';
        const lim = { ...obj(w.limits) };
        if (n === undefined) delete lim.maxLength;
        else if (!Number.isInteger(n) || n < 1) return 'tt.err.integer';
        else lim.maxLength = n;
        if (Object.keys(lim).length) w.limits = lim;
        else delete w.limits;
        return null;
      }
      default: {
        const key = SIM_COL.get(col);
        if (!key) return 'tt.err.notApplicable';
        const sim = { ...obj(w.sim) };
        if (key === 'signal') {
          if (!/^[a-z][a-z0-9_.]{0,63}$/.test(text)) return 'tt.err.signal';
          sim.signal = text;
        } else if (SIM_TEXT_OK.has(key) && String(w.type) === 'STRING') sim[key] = raw;
        else if (key === 'value' || key === 'initial') {
          const v = this.initialValue(String(w.type), raw);
          if (v === undefined) return 'tt.err.initial';
          sim[key] = v;
        } else {
          const n = readNumber(text);
          if (n === 'bad' || n === undefined) return 'tt.err.number';
          sim[key] = n;
        }
        w.sim = sim;
        return null;
      }
    }
  }

  /** Cột của 0.1: chỉ id, type, description, unit, min, max. */
  private set01(w: Obj, col: string, raw: string): MessageKey | null {
    if (['id'].includes(col)) return null;
    if (!['type', 'description', 'unit', 'min', 'max'].includes(col)) return 'tt.err.notApplicable';
    return this.setCell(w, col, raw);
  }

  private initialValue(type: string, raw: string): boolean | number | string | undefined {
    if (type === 'STRING') return raw;
    if (type === 'BOOL') return readBool(raw.trim());
    const n = readNumber(raw.trim());
    if (typeof n !== 'number') return undefined;
    if (INTEGER.has(type) && !Number.isInteger(n)) return undefined;
    return n;
  }

  remove(rows: readonly number[]): ProjectEdit[] {
    return [...rows].sort((a, b) => b - a).map((index) => ({ kind: 'tagRemove', index }));
  }

  append(): { edits: ProjectEdit[]; row: number } {
    const tag = this.blank();
    // Tên tự tăng số theo Tag cuối (FR-020 của 004), không trùng tên đã có.
    const last = this.tags.at(-1);
    tag.id = nextTagId(
      last ? String(last.id ?? '') : '',
      this.tags.map((x) => String(x.id ?? '')),
    );
    return { edits: [{ kind: 'tagUpsert', tag: tag as unknown as AnyTag }], row: this.tags.length };
  }

  fillNext(row: number, col: string, above: string, steps: number): string | undefined {
    if (col !== 'address') return undefined;
    const tg = this.tag(row);
    const raw = (obj(tg.source).rawType ?? tg.type) as TagDataType | undefined;
    const sl = obj(tg.source).stringLength;
    if (this.isMc(tg))
      return mcStepAddress(
        above,
        mcDefaultStep(above, raw, typeof sl === 'number' ? sl : undefined),
        steps,
        this.deviceOf(tg)?.xyNotation,
      );
    if (this.isOpcUa(tg)) return stepOpcUaNodeId(above, steps);
    if (this.isS7(tg))
      return raw
        ? stepS7Address(above, raw, typeof sl === 'number' ? sl : undefined, steps)
        : undefined;
    return stepAddress(
      above,
      defaultStep(above, raw, typeof sl === 'number' ? sl : undefined),
      steps,
    );
  }
}

/**
 * NodeId sau `steps` dòng khi điền xuống: id số tăng `steps` (`ns=2;i=1001` → `ns=2;i=1002`); id chuỗi kết thúc bằng số
 * tăng số cuối, giữ số chữ số (`ns=2;s=Pump01.Speed` không đổi được; `ns=2;s=Tag09` → `ns=2;s=Tag10`). Không tăng được:
 * `undefined`.
 */
export function stepOpcUaNodeId(address: string, steps: number): string | undefined {
  const r = parseOpcUaNodeId(address.trim());
  if (!r.ok) return undefined;
  const prefix = r.ns === 0 ? '' : `ns=${r.ns};`;
  if (r.idType === 'i') {
    const n = Number(r.id) + steps;
    return n > 4294967295 ? undefined : `${prefix}i=${n}`;
  }
  if (r.idType !== 's') return undefined;
  const m = /^(.*?)(\d+)$/.exec(r.id);
  if (!m) return undefined;
  const n = String(Number(m[2]) + steps).padStart(m[2].length, '0');
  return `${prefix}s=${m[1]}${n}`;
}

/**
 * Địa chỉ S7 sau `steps` Tag cùng kiểu: bit tăng chỉ số bit (sang byte kế sau bit 7), kiểu khác tăng byte theo cỡ kiểu S7
 * (STRING n: n + 2). Không đọc được hoặc vượt byte 65535: `undefined`.
 */
export function stepS7Address(
  address: string,
  rawType: TagDataType,
  stringLength: number | undefined,
  steps: number,
): string | undefined {
  const r = parseS7Address(address.trim(), { rawType, stringLength });
  if (!r.ok) return undefined;
  const prefix = /^(.*?)\d+(?:\.\d)?$/.exec(r.normalized)?.[1] ?? '';
  if (r.bit !== null) {
    const pos = r.byte * 8 + r.bit + steps;
    const byte = Math.floor(pos / 8);
    return byte > 65535 ? undefined : `${prefix}${byte}.${pos % 8}`;
  }
  const byte = r.byte + r.size * steps;
  return byte + r.size > 65536 ? undefined : `${prefix}${byte}`;
}

/** Số đơn vị địa chỉ một Tag chiếm (bit: 1; coil và DI: 1; thanh ghi: theo kiểu). */
export function defaultStep(
  address: string,
  type: TagDataType | undefined,
  stringLength?: number,
): number {
  const up = address.trim().toUpperCase();
  if (/\.\d{1,2}$/.test(up) || /^(C|DI)\d/.test(up) || /^[01]\d{4,5}$/.test(up)) return 1;
  if (!type) return 1;
  return registerCount(type, stringLength) || 1;
}

/** Địa chỉ sau `steps` bước `per` (bit trong thanh ghi thì tăng chỉ số bit, tối đa 15); không đọc được thì `undefined`. */
export function stepAddress(address: string, per: number, steps: number): string | undefined {
  const up = address.trim().toUpperCase();
  const bit = /^((?:C|DI|IR|HR)\d{1,5})\.(\d{1,2})$/.exec(up) ?? /^(\d{4,5})\.(\d{1,2})$/.exec(up);
  if (bit) {
    const b = Number(bit[2]) + steps * per;
    return b <= 15 ? `${bit[1]}.${b}` : undefined;
  }
  const m = /^(C|DI|IR|HR)(\d{1,5})$/.exec(up) ?? /^()(\d{4,5})$/.exec(up);
  if (!m) return undefined;
  const next = Number(m[2]) + per * steps;
  if (next > 99999) return undefined;
  return `${m[1]}${String(next).padStart(m[2].length, '0')}`;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): string => (typeof v === 'number' ? String(v) : '');

function readNumber(text: string): number | undefined | 'bad' {
  if (text === '') return undefined;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return 'bad';
  const n = Number(text);
  return Number.isFinite(n) ? n : 'bad';
}

function readBool(text: string): boolean | undefined {
  const f = fold(text);
  if (['co', 'true', '1', 'yes', 'x'].includes(f)) return true;
  if (['khong', 'false', '0', 'no', ''].includes(f)) return false;
  return undefined;
}

export function tagTable(opts: TagTableOptions): TagTable {
  return new TagTable(opts);
}

export interface TagsUsage {
  bytes: number;
  limit: number;
  ratio: number;
  level: 'ok' | 'warn' | 'full';
}

/** Dung lượng `tags.json` khi ghi ra (định dạng chuẩn của Studio) so với trần 1 MiB; cảnh báo từ 85 %. */
export function tagsFileUsage(tags: readonly unknown[], schemaVersion = '0.2.0'): TagsUsage {
  const text = formatTagsFile({ schemaVersion, tags: tags as TagV1[] });
  const bytes = new TextEncoder().encode(text).length;
  const ratio = bytes / TAGS_FILE_LIMIT;
  return {
    bytes,
    limit: TAGS_FILE_LIMIT,
    ratio,
    level: ratio > 1 ? 'full' : ratio >= WARN_RATIO ? 'warn' : 'ok',
  };
}

/** Dữ liệu Bảng Tag lấy từ outline của project: Tag, thiết bị trường (từ Kết nối) và tên bảng giá trị. */
export function tableInputs(outline: {
  tags: { tags: unknown[] } | null;
  connections: {
    channels: Array<{
      kind?: string;
      devices?: Array<{
        id: string;
        name: string;
        addressBase?: 0 | 1;
        byteOrder?: string;
        xyNotation?: 'hex' | 'octal';
      }>;
    }>;
  } | null;
  valueTables: Array<{ name: string }>;
}): Pick<TagTableOptions, 'tags' | 'devices' | 'valueTables'> {
  return {
    tags: (outline.tags?.tags ?? []) as AnyTag[],
    devices: (outline.connections?.channels ?? []).flatMap((c) =>
      (c.devices ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        addressBase: d.addressBase,
        // Omron FINS (feature 018): word thấp trước theo mặc định
        byteOrder: d.byteOrder ?? (c.kind === 'fins' ? 'CDAB' : undefined),
        kind: c.kind,
        ...(c.kind === 'fins' ? { fins: true } : {}),
        ...(c.kind === 'bacnet' ? { bacnet: true } : {}),
        ...(c.kind === 'mc' ? { channelKind: c.kind, xyNotation: d.xyNotation ?? 'hex' } : {}),
      })),
    ),
    valueTables: outline.valueTables.map((v) => v.name),
  };
}
