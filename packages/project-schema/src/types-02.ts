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
  /** Định dạng 1.1, feature 018: số BCD trên PLC Omron (INT16/UINT16 4 chữ số, INT32/UINT32 8 chữ số). */
  bcd?: boolean;
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
  /**
   * Định dạng 1.0 (feature 011, T209): role tối thiểu để ghi Tag này; máy chủ kiểm ở `POST /tags/write`
   * (403 `FORBIDDEN`). Không có: `operator`. Khác `minRole` của nút/sự kiện SVG (chỉ khóa giao diện).
   */
  writeMinRole?: 'operator' | 'engineer' | 'administrator';
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
  /** Chỉ S7 (feature 016): khe byte tối đa khi gộp khoảng đọc. */
  maxGapBytes?: number;
  write?: {
    singleRegister?: 'fc06' | 'fc16';
    singleCoil?: 'fc05' | 'fc15';
    registerBit?: 'none' | 'mask' | 'rmw';
  };
  /** Chỉ Omron FINS (feature 018): địa chỉ FINS đích (mạng, nút, unit) và giới hạn gom. */
  network?: number;
  node?: number;
  unit?: number;
  maxReadWords?: number;
  maxGapWords?: number;
  multiRead?: boolean;
  maxMultiItems?: number;
  // Mitsubishi MC (feature 017, kênh `mc`; specs/017-driver-mc/plan.md)
  station?: number;
  moduleIo?: number;
  moduleStation?: number;
  xyNotation?: 'hex' | 'octal';
  maxBatchWords?: number;
  randomRead?: boolean;
  maxRandomPoints?: number;
  /** Chỉ BACnet/IP (feature 020): thiết bị đích và cách đọc/ghi. */
  deviceInstance?: number;
  host?: string;
  port?: number;
  mac?: string;
  maxApdu?: number;
  writePriority?: number;
  useRpm?: boolean;
  maxRpmProps?: number;
  /** Chỉ MQTT (feature 022): quá hạn này không có tin thì Tag UNCERTAIN MQTT_STALE (0: không bao giờ). */
  staleAfterMs?: number;
}

export interface Channel {
  id: string;
  name: string;
  kind: 'modbus-tcp' | 'modbus-rtu' | 's7' | 'fins' | 'mc' | 'bacnet' | 'opcua' | 'mqtt';
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
  /** Kênh `s7` (feature 016, định dạng 1.1): rack/slot hoặc TSAP, PDU xin. */
  s7?: { rack?: number; slot?: number; localTsap?: string; remoteTsap?: string; pduSize?: number };
  /** Kênh Omron FINS (định dạng 1.1, feature 018). */
  fins?: {
    host: string;
    port?: number;
    transport?: 'udp' | 'tcp';
    sourceNetwork?: number;
    sourceNode?: number;
    localPort?: number;
    connectTimeoutMs?: number;
    reconnectMaxS?: number;
  };
  /** Chỉ kênh `mc` (feature 017). */
  mc?: { frame?: '3E' | '4E'; code?: 'binary' | 'ascii'; transport?: 'tcp' | 'udp' };
  /** Kênh BACnet/IP (định dạng 1.1, feature 020). */
  bacnet?: {
    localPort?: number;
    bindAddress?: string;
    broadcast?: string;
    bbmd?: { host: string; port?: number; ttlS?: number };
    reconnectMaxS?: number;
  };
  /** Kênh opcua (feature 019, định dạng 1.1; specs/019-driver-opcua/contracts/opcua.md §1). */
  opcua?: OpcUaChannelConfig;
  /** Kênh mqtt (feature 022, định dạng 1.1; specs/022-driver-mqtt/spec.md). */
  mqtt?: MqttChannelConfig;
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

/** Khối opcua của kênh OPC UA (feature 019). */
export interface OpcUaChannelConfig {
  endpointUrl: string;
  securityMode?: 'None' | 'Sign' | 'SignAndEncrypt';
  securityPolicy?: 'None' | 'Basic256Sha256';
  serverCertSha256?: string;
  auth?: { mode: 'anonymous' | 'username'; username?: string; secretId?: string };
  readMode?: 'subscription' | 'poll';
  sessionTimeoutMs?: number;
  connectTimeoutMs?: number;
  reconnectMaxS?: number;
}

/** Một nhóm publish của kênh MQTT (feature 022): giá trị nhiều Tag thành một tin JSON. */
export interface MqttPublishGroup {
  topic: string;
  tags: string[];
  intervalMs?: number;
  onChange?: boolean;
  qos?: 0 | 1;
  retain?: boolean;
}

/** Khối mqtt của kênh MQTT (feature 022). */
export interface MqttChannelConfig {
  host: string;
  port?: number;
  clientId?: string;
  keepAliveS?: number;
  cleanSession?: boolean;
  tls?: { enabled: boolean; serverCertSha256?: string; caCertPem?: string; serverName?: string };
  auth?: { username: string; secretId: string };
  will?: { topic: string; payload?: string; qos?: 0 | 1; retain?: boolean };
  maxPublishPerS?: number;
  publishGroups?: MqttPublishGroup[];
  connectTimeoutMs?: number;
  reconnectMaxS?: number;
}
