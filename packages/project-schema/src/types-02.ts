// Định dạng 0.2 (specs/006-tags-modbus/data-model.md §1–§5, contracts/project-format-0.2.md). Kiểu của 0.1
// nằm ở types.ts và không đổi.
import type {
  Binding,
  LoggingConfig,
  Project,
  Scalar,
  Screen,
  TagDataType,
  Transform,
} from './types.ts';

export type TagKind = 'external' | 'internal' | 'calculated' | 'simulation';
export type ByteOrder = 'ABCD' | 'CDAB' | 'BADC' | 'DCBA';
export type ScanGroupName = 'fast' | 'normal' | 'slow';

export interface TagSource {
  device: string;
  address: string;
  scanGroup?: ScanGroupName;
  rawType?: TagDataType;
  byteOrder?: ByteOrder;
  stringLength?: number;
  stringByteOrder?: 'AB' | 'BA';
  readback?: boolean;
}

export interface TagScaling {
  rawMin: number;
  rawMax: number;
  engMin: number;
  engMax: number;
  clamp?: boolean;
}

export type SimKind = 'const' | 'ramp' | 'sine' | 'random' | 'square' | 'manual' | 'legacy';
export interface SimConfig {
  kind: SimKind;
  value?: Scalar;
  from?: number;
  to?: number;
  center?: number;
  amplitude?: number;
  periodMs?: number;
  phase?: number;
  min?: number;
  max?: number;
  seed?: number;
  duty?: number;
  initial?: Scalar;
  signal?: string;
}

export interface TagLimits {
  min?: number;
  max?: number;
  maxLength?: number;
}

/** Tag v1 (`tags.json` 0.2). */
export interface TagV1 {
  id: string;
  kind: TagKind;
  type: TagDataType;
  description?: string;
  unit?: string;
  min?: number;
  max?: number;
  access?: 'R' | 'RW';
  limits?: TagLimits;
  valueTable?: string;
  deadband?: number;
  source?: TagSource;
  scaling?: TagScaling;
  initial?: Scalar;
  retain?: boolean;
  expression?: string;
  sim?: SimConfig;
}

export interface TagListV1 {
  schemaVersion: string;
  tags: TagV1[];
}

export interface FieldDevice {
  id: string;
  name: string;
  enabled?: boolean;
  /** Chỉ Modbus TCP. */
  unitId?: number;
  /** Chỉ Modbus RTU. */
  slave?: number;
  addressBase?: 0 | 1;
  maxReadRegisters?: number;
  maxReadBits?: number;
  maxGapRegisters?: number;
  maxGapBits?: number;
  byteOrder?: ByteOrder;
  timeoutMs?: number;
  retries?: number;
  writeDeadlineMs?: number;
  write?: {
    singleRegister?: 'fc06' | 'fc16';
    singleCoil?: 'fc05' | 'fc15';
    registerBit?: 'none' | 'mask' | 'rmw';
  };
}

export interface Channel {
  id: string;
  name: string;
  kind: 'modbus-tcp' | 'modbus-rtu';
  enabled?: boolean;
  requestGapMs?: number;
  tcp?: { host: string; port?: number; connectTimeoutMs?: number; reconnectMaxS?: number };
  serial?: {
    port: string;
    baud?: number;
    dataBits?: 7 | 8;
    parity?: 'none' | 'even' | 'odd';
    stopBits?: 1 | 2;
    rs485?: boolean;
    dropEcho?: boolean;
    silenceMs?: number;
  };
  devices: FieldDevice[];
}

export interface ConnectionsConfig {
  schemaVersion: string;
  scanGroups?: Partial<Record<ScanGroupName, number>>;
  channels: Channel[];
}

export interface ValueTableEntry {
  value?: boolean | number;
  from?: number;
  to?: number;
  text: string;
  color?: string;
}

export interface ValueTableDoc {
  schemaVersion: string;
  name: string;
  description?: string;
  entries: ValueTableEntry[];
  default?: { text?: string; color?: string };
}

export interface WatchRow {
  tag: string;
  format?: 'auto' | 'dec' | 'hex' | 'bin' | 'bool';
  decimals?: number;
  writeValue?: string;
}

export interface WatchTableDoc {
  schemaVersion: string;
  id: string;
  name: string;
  rows: WatchRow[];
}

/** Transform `valueTable` của binding 0.2 (contract §8). */
export interface ValueTableTransform {
  kind: 'valueTable';
  table?: string;
  output: 'text' | 'color';
}

export type Binding02 = Omit<Binding, 'transform'> & { transform: Transform | ValueTableTransform };
export interface ElementBindings02 {
  elementUid: string;
  bindings: Binding02[];
}
export interface BindingSet02 {
  schemaVersion: string;
  screenId: string;
  elements: ElementBindings02[];
}

export interface LoadedScreen02 {
  screen: Screen;
  bindings: BindingSet02;
}

/** Project 0.2 đã nạp và qua kiểm tra. */
export interface LoadedProject02 {
  project: Project;
  tags: TagListV1;
  connections?: ConnectionsConfig;
  valueTables: Record<string, ValueTableDoc>;
  watchTables: Record<string, WatchTableDoc>;
  screens: Record<string, LoadedScreen02>;
  logging?: LoggingConfig;
}
