// Mô hình form Kết nối và Thử kết nối (feature 006, T128, FR-030, FR-044, data-model §2, device-api §4). Không DOM:
// bảng trường theo loại kênh (nhóm, mặc định, khoảng, trợ giúp), sửa một trường thành đối tượng mới hoặc lỗi tại ô,
// kênh và thiết bị trường mới, và bộ chạy Thử kết nối (khóa kèm lý do, mỗi lúc một lần, bảng cách hiểu). Studio không
// bao giờ tự kết nối tới thiết bị trường: lần thử đi qua `DeviceLink.post` tới BL335.
import { interpretRegisters, type InterpretRow } from '@mat/tag-codec';
import type { Channel, FieldDevice, TagV1 } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import { FALSE_WORDS, TRUE_WORDS } from '../i18n/bool-words.ts';
import { isDeviceError, type ApiResult, type DeviceError } from '../platform/device-types.ts';
import {
  BACNET_CHANNEL,
  BACNET_DEVICE,
  bacnetReadBody,
  parseFound,
  parseObjects,
  type BacnetFound,
  type BacnetObjectRow,
} from './connections-bacnet.ts';

export type ChannelKind =
  'modbus-tcp' | 'modbus-rtu' | 's7' | 'fins' | 'mc' | 'bacnet' | 'opcua' | 'mqtt';
/** Nhóm của form; Modbus chỉ dùng `basic`, `advanced`. Kênh MC (feature 017) thêm Khung, Định tuyến, Gom yêu cầu, Ghi. */
export type FieldGroup = 'basic' | 'advanced' | 'frame' | 'routing' | 'batch' | 'write';
/** Thứ tự các nhóm trên form. */
export const FIELD_GROUPS: readonly FieldGroup[] = [
  'basic',
  'frame',
  'routing',
  'batch',
  'write',
  'advanced',
];
export type Obj = Record<string, unknown>;

export interface FieldSpec {
  key: string;
  target: 'channel' | 'device';
  /** Đường tới trường trong đối tượng kênh hoặc thiết bị trường. */
  path: readonly string[];
  label: MessageKey;
  help: MessageKey;
  group: FieldGroup;
  kind: 'text' | 'number' | 'select' | 'bool';
  options?: readonly string[];
  /** Danh sách chọn gồm số: lưu thành số. */
  numeric?: boolean;
  min?: number;
  max?: number;
  /** Số thực (mặc định số nguyên). */
  real?: boolean;
  default?: string | number | boolean;
  required?: boolean;
  maxLen?: number;
  mono?: boolean;
  unit?: string;
  /** Mẫu của trường chữ (TSAP của S7: 4 chữ số hex) và lỗi tại ô khi không khớp. */
  pattern?: RegExp;
  patternError?: MessageKey;
  /** Ghi chữ hoa (TSAP). */
  upper?: boolean;
  /** Số viết hex 4 chữ số (moduleIo của MC: 03FF). */
  hex?: boolean;
  /** Ghi chữ thường (SHA-256 của chứng chỉ OPC UA). */
  lower?: boolean;
}

const f = (
  target: FieldSpec['target'],
  key: string,
  path: readonly string[],
  group: FieldGroup,
  kind: FieldSpec['kind'],
  extra: Partial<FieldSpec> = {},
): FieldSpec => ({
  key,
  target,
  path,
  group,
  kind,
  label: `cn.f.${key}` as MessageKey,
  help: `cn.h.${key}` as MessageKey,
  ...extra,
});

const ch = (
  key: string,
  path: readonly string[],
  group: FieldGroup,
  kind: FieldSpec['kind'],
  extra?: Partial<FieldSpec>,
) => f('channel', key, path, group, kind, extra);
const dv = (
  key: string,
  path: readonly string[],
  group: FieldGroup,
  kind: FieldSpec['kind'],
  extra?: Partial<FieldSpec>,
) => f('device', key, path, group, kind, extra);

const COMMON_CHANNEL: FieldSpec[] = [
  ch('id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  ch('name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  ch('enabled', ['enabled'], 'basic', 'bool', { default: true }),
];

const TCP_CHANNEL: FieldSpec[] = [
  ...COMMON_CHANNEL,
  ch('host', ['tcp', 'host'], 'basic', 'text', { required: true, mono: true, maxLen: 253 }),
  ch('port', ['tcp', 'port'], 'basic', 'number', { min: 1, max: 65535, default: 502, mono: true }),
  ch('connectTimeoutMs', ['tcp', 'connectTimeoutMs'], 'advanced', 'number', {
    min: 500,
    max: 30000,
    default: 3000,
    unit: 'ms',
  }),
  ch('reconnectMaxS', ['tcp', 'reconnectMaxS'], 'advanced', 'number', {
    min: 1,
    max: 60,
    default: 10,
    unit: 's',
  }),
  ch('requestGapMs', ['requestGapMs'], 'advanced', 'number', {
    min: 0,
    max: 1000,
    default: 0,
    unit: 'ms',
  }),
];

const RTU_CHANNEL: FieldSpec[] = [
  ...COMMON_CHANNEL,
  ch('serialPort', ['serial', 'port'], 'basic', 'text', {
    required: true,
    mono: true,
    maxLen: 220,
  }),
  ch('baud', ['serial', 'baud'], 'basic', 'select', {
    options: ['1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200'],
    numeric: true,
    default: 9600,
  }),
  ch('dataBits', ['serial', 'dataBits'], 'basic', 'select', {
    options: ['7', '8'],
    numeric: true,
    default: 8,
  }),
  ch('parity', ['serial', 'parity'], 'basic', 'select', {
    options: ['none', 'even', 'odd'],
    default: 'even',
  }),
  ch('stopBits', ['serial', 'stopBits'], 'basic', 'select', {
    options: ['1', '2'],
    numeric: true,
    default: 1,
  }),
  ch('rs485', ['serial', 'rs485'], 'advanced', 'bool', { default: true }),
  ch('dropEcho', ['serial', 'dropEcho'], 'advanced', 'bool', { default: false }),
  ch('silenceMs', ['serial', 'silenceMs'], 'advanced', 'number', {
    min: 0,
    max: 1000,
    real: true,
    unit: 'ms',
  }),
  ch('requestGapMs', ['requestGapMs'], 'advanced', 'number', {
    min: 0,
    max: 1000,
    default: 0,
    unit: 'ms',
  }),
];

// Kênh Omron FINS (feature 018, định dạng 1.1): một điểm cuối IP (bộ Ethernet của PLC), UDP hoặc TCP cổng 9600.
const FINS_CHANNEL: FieldSpec[] = [
  ...COMMON_CHANNEL,
  ch('finsHost', ['fins', 'host'], 'basic', 'text', { required: true, mono: true, maxLen: 253 }),
  ch('transport', ['fins', 'transport'], 'basic', 'select', {
    options: ['udp', 'tcp'],
    default: 'udp',
    mono: true,
  }),
  ch('finsPort', ['fins', 'port'], 'basic', 'number', {
    min: 1,
    max: 65535,
    default: 9600,
    mono: true,
  }),
  ch('sourceNetwork', ['fins', 'sourceNetwork'], 'advanced', 'number', {
    min: 0,
    max: 127,
    default: 0,
  }),
  ch('sourceNode', ['fins', 'sourceNode'], 'advanced', 'number', { min: 0, max: 254, default: 0 }),
  ch('localPort', ['fins', 'localPort'], 'advanced', 'number', { min: 0, max: 65535, default: 0 }),
  ch('connectTimeoutMs', ['fins', 'connectTimeoutMs'], 'advanced', 'number', {
    min: 500,
    max: 30000,
    default: 3000,
    unit: 'ms',
  }),
  ch('reconnectMaxS', ['fins', 'reconnectMaxS'], 'advanced', 'number', {
    min: 1,
    max: 60,
    default: 10,
    unit: 's',
  }),
  ch('requestGapMs', ['requestGapMs'], 'advanced', 'number', {
    min: 0,
    max: 1000,
    default: 0,
    unit: 'ms',
  }),
];

/** Thiết bị FINS: địa chỉ FINS đích (mạng, nút, unit) sau điểm cuối của kênh, chờ và gom. */
const FINS_DEVICE: FieldSpec[] = [
  dv('id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  dv('name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  dv('enabled', ['enabled'], 'basic', 'bool', { default: true }),
  dv('node', ['node'], 'basic', 'number', { min: 0, max: 254, default: 0 }),
  dv('network', ['network'], 'basic', 'number', { min: 0, max: 127, default: 0 }),
  dv('unit', ['unit'], 'basic', 'number', { min: 0, max: 255, default: 0 }),
  dv('finsByteOrder', ['byteOrder'], 'basic', 'select', {
    options: ['CDAB', 'ABCD', 'BADC', 'DCBA'],
    default: 'CDAB',
    mono: true,
  }),
  dv('finsTimeoutMs', ['timeoutMs'], 'advanced', 'number', {
    min: 100,
    max: 10000,
    default: 500,
    unit: 'ms',
  }),
  dv('finsRetries', ['retries'], 'advanced', 'number', { min: 0, max: 5 }),
  dv('maxReadWords', ['maxReadWords'], 'advanced', 'number', { min: 1, max: 999, default: 999 }),
  dv('maxGapWords', ['maxGapWords'], 'advanced', 'number', { min: 0, max: 999, default: 10 }),
  dv('multiRead', ['multiRead'], 'advanced', 'bool', { default: true }),
  dv('maxMultiItems', ['maxMultiItems'], 'advanced', 'number', { min: 1, max: 128, default: 64 }),
  dv('writeDeadlineMs', ['writeDeadlineMs'], 'advanced', 'number', {
    min: 1000,
    max: 60000,
    default: 5000,
    unit: 'ms',
  }),
];

const deviceCommon = (kind: ChannelKind): FieldSpec[] => [
  dv('id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  dv('name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  dv('enabled', ['enabled'], 'basic', 'bool', { default: true }),
  kind === 'modbus-tcp'
    ? dv('unitId', ['unitId'], 'basic', 'number', { min: 0, max: 255, default: 1 })
    : dv('slave', ['slave'], 'basic', 'number', { min: 1, max: 247, default: 1 }),
  dv('addressBase', ['addressBase'], 'basic', 'select', {
    options: ['0', '1'],
    numeric: true,
    default: 0,
  }),
  dv('byteOrder', ['byteOrder'], 'basic', 'select', {
    options: ['ABCD', 'CDAB', 'BADC', 'DCBA'],
    default: 'ABCD',
    mono: true,
  }),
  dv('timeoutMs', ['timeoutMs'], 'advanced', 'number', {
    min: 100,
    max: 10000,
    default: 1000,
    unit: 'ms',
  }),
  dv('retries', ['retries'], 'advanced', 'number', {
    min: 0,
    max: 5,
    default: kind === 'modbus-tcp' ? 0 : 1,
  }),
  dv('maxReadRegisters', ['maxReadRegisters'], 'advanced', 'number', {
    min: 1,
    max: 125,
    default: 125,
  }),
  dv('maxReadBits', ['maxReadBits'], 'advanced', 'number', { min: 1, max: 2000, default: 2000 }),
  dv('maxGapRegisters', ['maxGapRegisters'], 'advanced', 'number', {
    min: 0,
    max: 125,
    default: 10,
  }),
  dv('maxGapBits', ['maxGapBits'], 'advanced', 'number', { min: 0, max: 2000, default: 64 }),
  dv('writeDeadlineMs', ['writeDeadlineMs'], 'advanced', 'number', {
    min: 1000,
    max: 60000,
    default: 5000,
    unit: 'ms',
  }),
  dv('writeSingleRegister', ['write', 'singleRegister'], 'advanced', 'select', {
    options: ['fc06', 'fc16'],
    default: 'fc06',
    mono: true,
  }),
  dv('writeSingleCoil', ['write', 'singleCoil'], 'advanced', 'select', {
    options: ['fc05', 'fc15'],
    default: 'fc05',
    mono: true,
  }),
  dv('writeRegisterBit', ['write', 'registerBit'], 'advanced', 'select', {
    options: ['none', 'mask', 'rmw'],
    default: 'none',
    mono: true,
  }),
];

// ---------- Kênh Siemens S7 (feature 016, contracts/s7-driver.md §1) ----------

const TSAP_RE = /^[0-9A-Fa-f]{4}$/;
const tsap = { mono: true, pattern: TSAP_RE, patternError: 'cn.err.tsap', upper: true } as const;

const S7_CHANNEL: FieldSpec[] = [
  ...COMMON_CHANNEL,
  ch('host', ['tcp', 'host'], 'basic', 'text', {
    required: true,
    mono: true,
    maxLen: 253,
    help: 'cn.h.s7Host',
  }),
  ch('port', ['tcp', 'port'], 'basic', 'number', {
    min: 1,
    max: 65535,
    default: 102,
    mono: true,
    help: 'cn.h.s7Port',
  }),
  ch('rack', ['s7', 'rack'], 'basic', 'number', { min: 0, max: 7, default: 0 }),
  ch('slot', ['s7', 'slot'], 'basic', 'number', { min: 0, max: 31, default: 1 }),
  ch('pduSize', ['s7', 'pduSize'], 'advanced', 'number', {
    min: 240,
    max: 960,
    default: 480,
    unit: 'byte',
  }),
  ch('localTsap', ['s7', 'localTsap'], 'advanced', 'text', tsap),
  ch('remoteTsap', ['s7', 'remoteTsap'], 'advanced', 'text', tsap),
  ...TCP_CHANNEL.filter((s) =>
    ['connectTimeoutMs', 'reconnectMaxS', 'requestGapMs'].includes(s.key),
  ),
];

const S7_DEVICE: FieldSpec[] = [
  dv('id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  dv('name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  dv('enabled', ['enabled'], 'basic', 'bool', { default: true }),
  dv('timeoutMs', ['timeoutMs'], 'advanced', 'number', {
    min: 100,
    max: 10000,
    default: 1000,
    unit: 'ms',
  }),
  dv('retries', ['retries'], 'advanced', 'number', {
    min: 0,
    max: 5,
    default: 0,
    help: 'cn.h.s7Retries',
  }),
  dv('writeDeadlineMs', ['writeDeadlineMs'], 'advanced', 'number', {
    min: 1000,
    max: 60000,
    default: 5000,
    unit: 'ms',
  }),
  dv('maxGapBytes', ['maxGapBytes'], 'advanced', 'number', {
    min: 0,
    max: 256,
    default: 16,
    unit: 'byte',
  }),
];

// ---------- Kênh Mitsubishi MC (feature 017, specs/017-driver-mc/plan.md "Hợp đồng định dạng") ----------

const MC_CHANNEL: FieldSpec[] = [
  ...COMMON_CHANNEL,
  ch('mcHost', ['tcp', 'host'], 'basic', 'text', { required: true, mono: true, maxLen: 253 }),
  ch('mcPort', ['tcp', 'port'], 'basic', 'number', {
    min: 1,
    max: 65535,
    default: 5007,
    mono: true,
  }),
  ch('mcFrame', ['mc', 'frame'], 'frame', 'select', {
    options: ['3E', '4E'],
    default: '3E',
    mono: true,
  }),
  ch('mcCode', ['mc', 'code'], 'frame', 'select', {
    options: ['binary', 'ascii'],
    default: 'binary',
  }),
  ch('mcTransport', ['mc', 'transport'], 'frame', 'select', {
    options: ['tcp', 'udp'],
    default: 'tcp',
  }),
  ...TCP_CHANNEL.filter((s) =>
    ['connectTimeoutMs', 'reconnectMaxS', 'requestGapMs'].includes(s.key),
  ),
];

const MC_DEVICE: FieldSpec[] = [
  dv('id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  dv('name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  dv('enabled', ['enabled'], 'basic', 'bool', { default: true }),
  dv('xyNotation', ['xyNotation'], 'basic', 'select', {
    options: ['hex', 'octal'],
    default: 'hex',
    mono: true,
  }),
  dv('timeoutMs', ['timeoutMs'], 'basic', 'number', {
    min: 100,
    max: 10000,
    default: 1000,
    unit: 'ms',
  }),
  dv('retries', ['retries'], 'basic', 'number', { min: 0, max: 5, default: 0 }),
  dv('network', ['network'], 'routing', 'number', { min: 0, max: 239, default: 0, mono: true }),
  dv('station', ['station'], 'routing', 'number', { min: 0, max: 255, default: 255, mono: true }),
  dv('moduleIo', ['moduleIo'], 'routing', 'number', {
    min: 0,
    max: 65535,
    default: 1023,
    hex: true,
    mono: true,
    unit: 'hex',
  }),
  dv('moduleStation', ['moduleStation'], 'routing', 'number', {
    min: 0,
    max: 255,
    default: 0,
    mono: true,
  }),
  dv('maxBatchWords', ['maxBatchWords'], 'batch', 'number', { min: 1, max: 960, default: 960 }),
  dv('maxGapWords', ['maxGapWords'], 'batch', 'number', { min: 0, max: 960, default: 16 }),
  dv('randomRead', ['randomRead'], 'batch', 'bool', { default: true }),
  dv('maxRandomPoints', ['maxRandomPoints'], 'batch', 'number', {
    min: 1,
    max: 192,
    default: 192,
  }),
  dv('writeDeadlineMs', ['writeDeadlineMs'], 'write', 'number', {
    min: 1000,
    max: 60000,
    default: 5000,
    unit: 'ms',
  }),
  dv('mcRegisterBit', ['write', 'registerBit'], 'write', 'select', {
    options: ['none', 'rmw'],
    default: 'none',
    mono: true,
  }),
];

// ---------- Kênh OPC UA (feature 019, specs/019-driver-opcua/contracts/opcua.md §1) ----------

/** Như `connections.schema.json`. */
export const OPCUA_ENDPOINT_RE = /^opc\.tcp:\/\/[^\s/:]+(:[0-9]{1,5})?(\/\S*)?$/;
export const SHA256_RE = /^[0-9a-fA-F]{64}$/;
const SECRET_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

const OPCUA_CHANNEL: FieldSpec[] = [
  ...COMMON_CHANNEL,
  ch('endpointUrl', ['opcua', 'endpointUrl'], 'basic', 'text', {
    required: true,
    mono: true,
    maxLen: 256,
    pattern: OPCUA_ENDPOINT_RE,
    patternError: 'cn.err.endpoint',
  }),
  ch('securityMode', ['opcua', 'securityMode'], 'basic', 'select', {
    options: ['None', 'Sign', 'SignAndEncrypt'],
    default: 'None',
  }),
  ch('securityPolicy', ['opcua', 'securityPolicy'], 'basic', 'select', {
    options: ['None', 'Basic256Sha256'],
    default: 'None',
  }),
  ch('authMode', ['opcua', 'auth', 'mode'], 'basic', 'select', {
    options: ['anonymous', 'username'],
    default: 'anonymous',
  }),
  ch('username', ['opcua', 'auth', 'username'], 'basic', 'text', { maxLen: 128 }),
  ch('secretId', ['opcua', 'auth', 'secretId'], 'basic', 'text', {
    mono: true,
    maxLen: 48,
    pattern: SECRET_ID_RE,
    patternError: 'cn.err.secretId',
  }),
  ch('serverCertSha256', ['opcua', 'serverCertSha256'], 'advanced', 'text', {
    mono: true,
    pattern: SHA256_RE,
    patternError: 'cn.err.sha256',
    lower: true,
  }),
  ch('readMode', ['opcua', 'readMode'], 'advanced', 'select', {
    options: ['subscription', 'poll'],
    default: 'subscription',
  }),
  ch('sessionTimeoutMs', ['opcua', 'sessionTimeoutMs'], 'advanced', 'number', {
    min: 10000,
    max: 3600000,
    default: 60000,
    unit: 'ms',
  }),
  ch('connectTimeoutMs', ['opcua', 'connectTimeoutMs'], 'advanced', 'number', {
    min: 500,
    max: 30000,
    default: 5000,
    unit: 'ms',
    help: 'cn.h.opcuaConnectTimeoutMs',
  }),
  ch('reconnectMaxS', ['opcua', 'reconnectMaxS'], 'advanced', 'number', {
    min: 1,
    max: 60,
    default: 10,
    unit: 's',
  }),
];

const OPCUA_DEVICE: FieldSpec[] = [
  dv('id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  dv('name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  dv('enabled', ['enabled'], 'basic', 'bool', { default: true }),
  dv('timeoutMs', ['timeoutMs'], 'advanced', 'number', {
    min: 100,
    max: 10000,
    default: 2000,
    unit: 'ms',
    help: 'cn.h.opcuaTimeoutMs',
  }),
  dv('writeDeadlineMs', ['writeDeadlineMs'], 'advanced', 'number', {
    min: 1000,
    max: 60000,
    default: 5000,
    unit: 'ms',
  }),
];

// ---------- Kênh MQTT (feature 022, specs/022-driver-mqtt/spec.md) ----------

/** Như `connections.schema.json`: host, client id; topic publish không có wildcard. */
export const MQTT_HOST_RE = /^[A-Za-z0-9.:_-]+$/;
export const MQTT_CLIENT_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
export const MQTT_PUB_TOPIC_RE = /^[^#+]+$/;

const MQTT_CHANNEL: FieldSpec[] = [
  ...COMMON_CHANNEL,
  ch('host', ['mqtt', 'host'], 'basic', 'text', {
    required: true,
    mono: true,
    maxLen: 253,
    pattern: MQTT_HOST_RE,
    patternError: 'cn.err.mqttHost',
    help: 'cn.h.mqttHost',
  }),
  ch('port', ['mqtt', 'port'], 'basic', 'number', {
    min: 1,
    max: 65535,
    default: 1883,
    mono: true,
    help: 'cn.h.mqttPort',
  }),
  ch('mqttClientId', ['mqtt', 'clientId'], 'basic', 'text', {
    mono: true,
    maxLen: 64,
    pattern: MQTT_CLIENT_ID_RE,
    patternError: 'cn.err.mqttClientId',
  }),
  ch('mqttTls', ['mqtt', 'tls', 'enabled'], 'basic', 'bool', { default: false }),
  ch('mqttCertSha256', ['mqtt', 'tls', 'serverCertSha256'], 'basic', 'text', {
    mono: true,
    pattern: SHA256_RE,
    patternError: 'cn.err.sha256',
    lower: true,
  }),
  ch('mqttServerName', ['mqtt', 'tls', 'serverName'], 'advanced', 'text', {
    mono: true,
    maxLen: 253,
  }),
  ch('mqttUsername', ['mqtt', 'auth', 'username'], 'basic', 'text', { maxLen: 128 }),
  ch('mqttSecretId', ['mqtt', 'auth', 'secretId'], 'basic', 'text', {
    mono: true,
    maxLen: 48,
    pattern: SECRET_ID_RE,
    patternError: 'cn.err.secretId',
  }),
  ch('mqttKeepAliveS', ['mqtt', 'keepAliveS'], 'advanced', 'number', {
    min: 5,
    max: 3600,
    default: 30,
    unit: 's',
  }),
  ch('mqttCleanSession', ['mqtt', 'cleanSession'], 'advanced', 'bool', { default: true }),
  ch('mqttWillTopic', ['mqtt', 'will', 'topic'], 'advanced', 'text', {
    mono: true,
    maxLen: 256,
    pattern: MQTT_PUB_TOPIC_RE,
    patternError: 'cn.err.mqttTopic',
  }),
  ch('mqttWillPayload', ['mqtt', 'will', 'payload'], 'advanced', 'text', { maxLen: 1024 }),
  ch('mqttWillQos', ['mqtt', 'will', 'qos'], 'advanced', 'select', {
    options: ['0', '1'],
    numeric: true,
    default: 0,
  }),
  ch('mqttWillRetain', ['mqtt', 'will', 'retain'], 'advanced', 'bool', { default: false }),
  ch('mqttMaxPublishPerS', ['mqtt', 'maxPublishPerS'], 'advanced', 'number', {
    min: 1,
    max: 1000,
    default: 20,
    unit: '/s',
  }),
  ch('connectTimeoutMs', ['mqtt', 'connectTimeoutMs'], 'advanced', 'number', {
    min: 500,
    max: 30000,
    default: 5000,
    unit: 'ms',
    help: 'cn.h.mqttConnectTimeoutMs',
  }),
  ch('reconnectMaxS', ['mqtt', 'reconnectMaxS'], 'advanced', 'number', {
    min: 1,
    max: 60,
    default: 10,
    unit: 's',
  }),
];

const MQTT_DEVICE: FieldSpec[] = [
  dv('id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  dv('name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  dv('enabled', ['enabled'], 'basic', 'bool', { default: true }),
  dv('mqttStaleAfterMs', ['staleAfterMs'], 'basic', 'number', {
    min: 0,
    max: 86400000,
    default: 0,
    unit: 'ms',
  }),
  dv('timeoutMs', ['timeoutMs'], 'advanced', 'number', {
    min: 100,
    max: 10000,
    default: 2000,
    unit: 'ms',
    help: 'cn.h.mqttTimeoutMs',
  }),
  dv('writeDeadlineMs', ['writeDeadlineMs'], 'advanced', 'number', {
    min: 1000,
    max: 60000,
    default: 5000,
    unit: 'ms',
  }),
];

/** Kênh MQTT bật TLS mà chưa ghim chứng chỉ broker hay CA (W_MQTT_TLS_NOT_PINNED; CA chỉ đặt được trong tệp). */
export function mqttNeedsPin(channel: Channel): boolean {
  const tls = channel.mqtt?.tls;
  return (
    channel.kind === 'mqtt' &&
    tls?.enabled === true &&
    tls.serverCertSha256 === undefined &&
    tls.caCertPem === undefined
  );
}

/** Kênh MQTT có tài khoản mà không TLS (W_MQTT_PLAIN_PASSWORD). */
export const mqttPlainPassword = (channel: Channel): boolean =>
  channel.kind === 'mqtt' && channel.mqtt?.auth !== undefined && channel.mqtt.tls?.enabled !== true;

export const channelFields = (kind: ChannelKind): readonly FieldSpec[] =>
  kind === 'modbus-tcp'
    ? TCP_CHANNEL
    : kind === 's7'
      ? S7_CHANNEL
      : kind === 'fins'
        ? FINS_CHANNEL
        : kind === 'mc'
          ? MC_CHANNEL
          : kind === 'bacnet'
            ? BACNET_CHANNEL
            : kind === 'opcua'
              ? OPCUA_CHANNEL
              : kind === 'mqtt'
                ? MQTT_CHANNEL
                : RTU_CHANNEL;
export const deviceFields = (kind: ChannelKind): readonly FieldSpec[] =>
  kind === 's7'
    ? S7_DEVICE
    : kind === 'fins'
      ? FINS_DEVICE
      : kind === 'mc'
        ? MC_DEVICE
        : kind === 'bacnet'
          ? BACNET_DEVICE
          : kind === 'opcua'
            ? OPCUA_DEVICE
            : kind === 'mqtt'
              ? MQTT_DEVICE
              : deviceCommon(kind);

/** Số 16 bit viết hex 4 chữ số hoa: 1023 → `03FF`. */
export const hexText = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

/** Kênh S7 đặt `remoteTsap` cùng rack hay slot (luật E_S7_TSAP): báo ngay tại ô, không chặn. */
export function s7TsapConflict(channel: Channel): boolean {
  const s = channel.s7;
  return !!s && s.remoteTsap !== undefined && (s.rack !== undefined || s.slot !== undefined);
}

/** Trường của kênh đang hiện: kênh OPC UA anonymous ẩn username/secretId. */
export function visibleChannelFields(channel: Channel): readonly FieldSpec[] {
  const all = channelFields(channel.kind as ChannelKind);
  if (channel.kind !== 'opcua' || channel.opcua?.auth?.mode === 'username') return all;
  return all.filter((s) => s.key !== 'username' && s.key !== 'secretId');
}

/** Mode/policy hiệu lực không khớp (luật E_OPCUA_SECURITY): báo tại ô, không chặn. */
export function opcuaSecurityConflict(channel: Channel): boolean {
  if (channel.kind !== 'opcua') return false;
  const mode = channel.opcua?.securityMode ?? 'None';
  const policy = channel.opcua?.securityPolicy ?? 'None';
  return (mode === 'None') !== (policy === 'None');
}

/** Kênh có mã hóa mà chưa tin chứng chỉ server (W_OPCUA_CERT_NOT_PINNED). */
export function opcuaNeedsPin(channel: Channel): boolean {
  return (
    channel.kind === 'opcua' &&
    (channel.opcua?.securityMode ?? 'None') !== 'None' &&
    channel.opcua?.serverCertSha256 === undefined
  );
}

/** Kênh chỉ có một thiết bị trường (schema `maxItems: 1`): S7 một CPU, OPC UA một server, MQTT một broker. */
const singleDevice = (kind: string): boolean =>
  kind === 's7' || kind === 'opcua' || kind === 'mqtt';

/** Kênh còn nhận thêm thiết bị trường không. */
export const canAddDevice = (channel: Channel): boolean =>
  !singleDevice(channel.kind) || (channel.devices?.length ?? 0) === 0;

/** Lý do không thêm được thiết bị trường vào kênh một thiết bị. */
export const oneDeviceReason = (channel: Pick<Channel, 'kind'>): MessageKey =>
  channel.kind === 'opcua'
    ? 'cn.opcua.oneDevice'
    : channel.kind === 'mqtt'
      ? 'cn.mqtt.oneDevice'
      : 'cn.s7.oneDevice';

/**
 * `POST /api/v1/drivers/test` chưa hỗ trợ kênh S7 (feature 016, D8); không dùng cho kênh OPC UA (Lấy chứng chỉ thay nó,
 * feature 019 D12).
 */
export const probeSupported = (kind: string): boolean =>
  kind !== 's7' && kind !== 'opcua' && kind !== 'mqtt';

/** Chữ mặc định (để hiện ở ô trống). */
export const fieldDefault = (spec: FieldSpec): string =>
  spec.default === undefined
    ? ''
    : spec.hex && typeof spec.default === 'number'
      ? hexText(spec.default)
      : String(spec.default);

function read(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Obj)[k];
  }
  return cur;
}

/** Chữ của trường trong đối tượng; vắng khóa thì rỗng. */
export function fieldText(obj: unknown, spec: FieldSpec): string {
  const v = read(obj, spec.path);
  if (spec.hex && typeof v === 'number') return hexText(v);
  return v === undefined || v === null ? '' : String(v);
}

export interface TakenIds {
  channels: ReadonlySet<string>;
  devices: ReadonlySet<string>;
}

export type SetResult<T> = { value: T } | { error: MessageKey };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function write(obj: Obj, path: readonly string[], value: unknown): Obj {
  const out: Obj = { ...obj };
  if (path.length === 1) {
    if (value === undefined) delete out[path[0]];
    else out[path[0]] = value;
    return out;
  }
  const [head, ...rest] = path;
  const child = write((out[head] as Obj | undefined) ?? {}, rest, value);
  if (Object.keys(child).length === 0 && value === undefined) delete out[head];
  else out[head] = child;
  return out;
}

/** Đặt một trường từ chữ gõ vào; trả đối tượng mới (đối tượng cũ không đổi) hoặc lỗi tại ô. */
export function setField<T extends object>(
  obj: T,
  spec: FieldSpec,
  raw: string,
  taken: TakenIds,
): SetResult<T> {
  const text = spec.kind === 'text' ? raw.trim() : raw.trim();
  const own = obj as unknown as Obj;
  let value: unknown;
  if (text === '') {
    if (spec.required) return { error: 'cn.err.required' };
    value = undefined;
  } else if (spec.kind === 'text') {
    if (spec.maxLen !== undefined && text.length > spec.maxLen) return { error: 'cn.err.maxLen' };
    if (spec.pattern && !spec.pattern.test(text))
      return { error: spec.patternError ?? 'cn.err.option' };
    if (spec.key === 'id') {
      if (!ID_RE.test(text)) return { error: 'cn.err.idSyntax' };
      const set = spec.target === 'channel' ? taken.channels : taken.devices;
      if (text !== own.id && set.has(text)) return { error: 'cn.err.idDup' };
    }
    value = spec.upper ? text.toUpperCase() : spec.lower ? text.toLowerCase() : text;
  } else if (spec.kind === 'number' && spec.hex) {
    // Hex như GX Works: 03FF, 3ff, 0x03FF, H3FF, 03FFh
    const m = /^(?:0X|H)?([0-9A-F]{1,4})H?$/.exec(text.toUpperCase());
    if (!m) return { error: 'cn.err.hex' };
    const n = parseInt(m[1], 16);
    if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max))
      return { error: 'cn.err.range' };
    value = n;
  } else if (spec.kind === 'number') {
    if (!/^[+-]?\d+(\.\d+)?$/.test(text) || (!spec.real && !/^[+-]?\d+$/.test(text)))
      return { error: spec.real ? 'cn.err.number' : 'cn.err.integer' };
    const n = Number(text);
    if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max))
      return { error: 'cn.err.range' };
    value = n;
  } else if (spec.kind === 'select') {
    if (!spec.options?.includes(text)) return { error: 'cn.err.option' };
    value = spec.numeric ? Number(text) : text;
  } else {
    const b = TRUE_WORDS.includes(text.toLowerCase())
      ? true
      : FALSE_WORDS.includes(text.toLowerCase())
        ? false
        : undefined;
    if (b === undefined) return { error: 'cn.err.bool' };
    value = b;
  }
  // Bằng mặc định thì không ghi khóa (file gọn, như Tag).
  if (value !== undefined && spec.default !== undefined && value === spec.default)
    value = undefined;
  const next = write(own, spec.path, value);
  if (spec.path[0] === 'opcua' && spec.path[1] === 'auth')
    return { value: fixAuth(next, spec) as T };
  if (spec.path[0] === 'mqtt' && spec.path[1] === 'tls') return { value: fixMqttTls(next) as T };
  return { value: next as T };
}

/**
 * Khối `opcua.auth` sau khi sửa một trường của nó: anonymous (mặc định) bỏ cả khối, kể cả username/secretId (luật
 * E_OPCUA_AUTH); đặt username hay secretId thì `mode` là username (schema cần `mode`).
 */
function fixAuth(channel: Obj, spec: FieldSpec): Obj {
  const opcua = { ...((channel.opcua as Obj | undefined) ?? {}) };
  const auth = (opcua.auth as Obj | undefined) ?? {};
  if (spec.key === 'authMode' && auth.mode === undefined) delete opcua.auth;
  else if (Object.keys(auth).some((k) => k !== 'mode')) opcua.auth = { ...auth, mode: 'username' };
  else if (auth.mode === 'username') opcua.auth = { mode: 'username' };
  else delete opcua.auth;
  return { ...channel, opcua };
}

/**
 * Khối `mqtt.tls` sau khi sửa một trường của nó (feature 022): schema cần `enabled`, nên có trường TLS nào thì ghi
 * `enabled` rõ (false nếu chưa bật: bộ kiểm tra báo E_MQTT_TLS); chỉ còn `enabled: false` thì bỏ cả khối.
 */
function fixMqttTls(channel: Obj): Obj {
  const mqtt = { ...((channel.mqtt as Obj | undefined) ?? {}) };
  const tls = { ...((mqtt.tls as Obj | undefined) ?? {}) };
  if (tls.enabled === undefined) tls.enabled = false;
  if (tls.enabled === false && Object.keys(tls).length === 1) delete mqtt.tls;
  else mqtt.tls = tls;
  return { ...channel, mqtt };
}

function freeId(prefix: string, taken: ReadonlySet<string>): { id: string; n: number } {
  for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return { id: `${prefix}${n}`, n };
}

/**
 * Kênh mới: id `plc1`/`rtu1`/`s7-1`… chưa dùng (cả với id thiết bị trường). Kênh Modbus chưa có thiết bị trường nào; kênh S7
 * có sẵn một CPU (`cpu1`…), vì mỗi kênh S7 là đúng một CPU.
 */
export function newChannel(
  channelIds: readonly string[],
  kind: ChannelKind,
  deviceIds: readonly string[],
): Channel {
  const taken = new Set([...channelIds, ...deviceIds]);
  const prefix =
    kind === 'modbus-tcp'
      ? 'plc'
      : kind === 's7'
        ? 's7-'
        : kind === 'fins'
          ? 'omron'
          : kind === 'mc'
            ? 'mc'
            : kind === 'bacnet'
              ? 'bms'
              : kind === 'opcua'
                ? 'ua-'
                : kind === 'mqtt'
                  ? 'mqtt'
                  : 'rtu';
  const { id, n } = freeId(prefix, taken);
  const base = { id, name: t('cn.newChannel', { n }), kind, devices: [] as FieldDevice[] };
  if (kind === 's7') {
    taken.add(id);
    const cpu = freeId('cpu', taken);
    return {
      ...base,
      kind,
      tcp: { host: '192.168.0.1' },
      devices: [{ id: cpu.id, name: t('cn.newCpu', { n: cpu.n }) }],
    };
  }
  if (kind === 'fins') return { ...base, kind, fins: { host: '192.168.250.1' } };
  // Kênh MC: frame 3E, binary, TCP, cổng 5007 là mặc định nên không ghi khóa (file gọn)
  if (kind === 'mc') return { ...base, kind, tcp: { host: '192.168.3.39' } };
  // feature 020: kênh BACnet/IP dùng cổng 47808 mặc định, không bắt buộc khối `bacnet`
  if (kind === 'bacnet') return { ...base, kind };
  if (kind === 'opcua') {
    // Mỗi kênh OPC UA là đúng một server: có sẵn thiết bị trường; timeoutMs 1000 để không vượt nhóm normal.
    taken.add(id);
    const srv = freeId('srv', taken);
    return {
      ...base,
      kind,
      opcua: { endpointUrl: 'opc.tcp://192.168.1.20:4840' },
      devices: [{ id: srv.id, name: t('cn.newServer', { n: srv.n }), timeoutMs: 1000 }],
    };
  }
  if (kind === 'mqtt') {
    // feature 022: mỗi kênh MQTT là đúng một broker, có sẵn thiết bị trường
    taken.add(id);
    const br = freeId('broker', taken);
    return {
      ...base,
      kind,
      mqtt: { host: '192.0.2.30' },
      devices: [{ id: br.id, name: t('cn.newBroker', { n: br.n }) }],
    };
  }
  return kind === 'modbus-tcp'
    ? { ...base, kind, tcp: { host: '192.168.1.10' } }
    : { ...base, kind, serial: { port: '' } };
}

/** Thiết bị trường mới của kênh: id duy nhất trong cả project, `unitId` hay `slave` bằng 1; CPU của kênh S7 không có số trạm. */
export function newDevice(channel: Channel, deviceIds: readonly string[]): FieldDevice {
  const taken = new Set(deviceIds);
  if (channel.kind === 's7') {
    const cpu = freeId('cpu', taken);
    return { id: cpu.id, name: t('cn.newCpu', { n: cpu.n }) };
  }
  if (channel.kind === 'mqtt') {
    const br = freeId('broker', taken);
    return { id: br.id, name: t('cn.newBroker', { n: br.n }) };
  }
  if (channel.kind === 'opcua') {
    const srv = freeId('srv', taken);
    return { id: srv.id, name: t('cn.newServer', { n: srv.n }), timeoutMs: 1000 };
  }
  const prefix = `${channel.id.slice(0, 26)}-d`;
  const { id, n } = freeId(prefix, taken);
  // FINS: nút đích 0 = tự lấy (UDP: byte cuối IPv4 của PLC; TCP: nút của bộ Ethernet khi bắt tay).
  // MC: mạng 0, trạm FF, module 03FF là mặc định của định dạng (không ghi khóa).
  if (channel.kind === 'fins' || channel.kind === 'mc')
    return { id, name: t('cn.newDevice', { n }) };
  // BACnet (feature 020): instance và IP phải sửa lại, hoặc lấy từ Tìm thiết bị
  if (channel.kind === 'bacnet')
    return { id, name: t('cn.newDevice', { n }), deviceInstance: 1, host: '192.168.1.50' };
  return channel.kind === 'modbus-tcp'
    ? { id, name: t('cn.newDevice', { n }), unitId: 1 }
    : { id, name: t('cn.newDevice', { n }), slave: 1 };
}

/** Chữ phụ của kênh trên cây và danh sách: TCP, RTU, S7, FINS/UDP, FINS/TCP, `MC 3E`, `MC 4E UDP`. */
export function channelSub(ch: Pick<Channel, 'kind' | 'mc' | 'fins' | 'mqtt'>): string {
  switch (ch.kind) {
    case 'mc':
      return [
        `MC ${ch.mc?.frame ?? '3E'}`,
        ch.mc?.transport === 'udp' ? 'UDP' : '',
        ch.mc?.code === 'ascii' ? 'ASCII' : '',
      ]
        .filter(Boolean)
        .join(' ');
    case 'fins':
      return t('cn.fins.sub', { transport: (ch.fins?.transport ?? 'udp').toUpperCase() });
    case 's7':
      return 'S7';
    case 'bacnet':
      return 'BACnet/IP';
    case 'opcua':
      return 'OPC UA';
    case 'mqtt':
      return ch.mqtt?.tls?.enabled ? 'MQTT TLS' : 'MQTT';
    case 'modbus-rtu':
      return 'RTU';
    default:
      return 'TCP';
  }
}

/**
 * Chữ phụ của thiết bị trường: `unit 1` (TCP), `slave 1` (RTU), rack/slot hoặc TSAP đích (S7), nút FINS,
 * MC `mạng 0 · trạm FF`.
 */
export function deviceSub(
  ch: Pick<Channel, 'kind' | 's7' | 'opcua' | 'mqtt'>,
  d: FieldDevice,
): string {
  switch (ch.kind) {
    case 'mqtt': // host:cổng của broker
      return `${ch.mqtt?.host ?? ''}:${ch.mqtt?.port ?? (ch.mqtt?.tls?.enabled ? 8883 : 1883)}`;
    case 'opcua': // host:cổng của endpoint
      return (ch.opcua?.endpointUrl ?? '').replace(/^opc\.tcp:\/\//, '');
    case 'mc':
      return t('cn.sub.mcDevice', {
        network: d.network ?? 0,
        station: (d.station ?? 255).toString(16).toUpperCase().padStart(2, '0'),
      });
    case 'bacnet': // feature 020: device instance
      return `#${d.deviceInstance ?? 0}`;
    case 'fins':
      return d.node ? t('cn.fins.node', { node: d.node }) : t('cn.fins.nodeAuto');
    case 's7': {
      const s = ch.s7 ?? {};
      return s.remoteTsap !== undefined
        ? `TSAP ${s.remoteTsap}`
        : `rack ${s.rack ?? 0} · slot ${s.slot ?? 1}`;
    }
    case 'modbus-rtu':
      return `slave ${d.slave ?? 1}`;
    default:
      return `unit ${d.unitId ?? 1}`;
  }
}

/** Số Tag ngoài của từng thiết bị trường. */
export function tagsPerDevice(tags: readonly TagV1[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const tag of tags) {
    const id = tag.kind === 'external' ? tag.source?.device : undefined;
    if (id) map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

// ---------- Thử kết nối ----------

export interface ProbeRead {
  address: string;
  count: number;
}

const pick = (src: unknown, keys: readonly string[]): Obj => {
  const out: Obj = {};
  const o = (src && typeof src === 'object' ? src : {}) as Obj;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};

/** Thân của `POST /api/v1/drivers/test`: cấu hình đang sửa, chỉ gồm trường đã đặt. */
export function probeBody(channel: Channel, device: FieldDevice, read: ProbeRead | null): object {
  if (channel.kind === 'fins') {
    // feature 018: kênh và thiết bị Omron FINS (device-api, kind fins)
    const ch: Obj = {
      kind: 'fins',
      fins: pick(channel.fins, [
        'host',
        'port',
        'transport',
        'sourceNetwork',
        'sourceNode',
        'localPort',
        'connectTimeoutMs',
      ]),
    };
    return {
      channel: ch,
      device: pick(device, ['network', 'node', 'unit', 'timeoutMs']),
      ...(read ? { read: { address: read.address, count: read.count } } : {}),
    };
  }
  if (channel.kind === 'bacnet') return bacnetReadBody(channel, device, read?.address ?? '');
  const tcp = channel.kind === 'modbus-tcp';
  const ch: Obj = { kind: channel.kind };
  if (tcp) ch.tcp = pick(channel.tcp, ['host', 'port', 'connectTimeoutMs']);
  else
    ch.serial = pick(channel.serial, [
      'port',
      'baud',
      'dataBits',
      'parity',
      'stopBits',
      'rs485',
      'dropEcho',
      'silenceMs',
    ]);
  if (channel.requestGapMs !== undefined) ch.requestGapMs = channel.requestGapMs;
  const dev = pick(device, [tcp ? 'unitId' : 'slave', 'timeoutMs', 'addressBase', 'retries']);
  return {
    channel: ch,
    device: dev,
    ...(read ? { read: { address: read.address, count: read.count } } : {}),
  };
}

export interface ProbeGateInput {
  online: boolean;
  role: string | null;
}

/** Khóa kèm lý do: cần Online (đã đăng nhập) với role từ engineer. */
export function probeGate(input: ProbeGateInput): MessageKey | null {
  if (!input.online) return 'cn.probe.offline';
  if (input.role !== 'engineer' && input.role !== 'administrator') return 'cn.probe.role';
  return null;
}

export type ProbeFailure = 'busy' | 'rate' | 'badRequest' | 'audit' | 'device' | 'unknown';

export interface ProbeResult {
  ok: boolean;
  code: string;
  connectMs?: number;
  responseMs?: number;
  message?: string;
  exception?: { code: string; meaning: string };
  /** Omron FINS (feature 018): mã kết thúc lỗi, model CPU (0501), nút của bắt tay TCP, địa chỉ đã đọc. */
  endCode?: { code: string; reason: string; meaning: string };
  model?: string;
  nodes?: { client: number; server: number };
  address?: string;
  read?: { fc: number; offset: number; count: number };
  /** Thanh ghi dạng hex (4 ký tự mỗi thanh ghi). */
  hex?: string[];
  bits?: boolean[];
  /** Bảng cách hiểu: các kiểu và thứ tự byte (rỗng với bit hoặc khi không đọc thanh ghi). */
  interpret: InterpretRow[];
  /** BACnet (feature 020): lần thử nào, giá trị đọc được, thiết bị tìm thấy, đối tượng, lỗi BACnet. */
  action?: 'read' | 'whois' | 'objects';
  value?: string;
  valueKind?: string;
  devices?: BacnetFound[];
  objects?: BacnetObjectRow[];
  truncated?: boolean;
  bacnetError?: { class: number; code: number; reason: string };
  reason?: number;
  /** Có khi lần thử không tới được kết quả của thiết bị trường (yêu cầu bị từ chối hoặc lỗi mạng). */
  failure?: ProbeFailure;
  retryAfterS?: number;
  issues?: string[];
  deviceError?: DeviceError;
}

export interface ProbeState {
  running: boolean;
  /** Lý do khóa lần gần nhất; `null`: không khóa. */
  locked: MessageKey | null;
  result: ProbeResult | null;
}

export interface ProbeDeps {
  post(path: string, body: object): Promise<ApiResult | DeviceError>;
  gate(): MessageKey | null;
}

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

function resultOf(res: ApiResult | DeviceError): ProbeResult {
  const empty: ProbeResult = { ok: false, code: '', interpret: [] };
  if (isDeviceError(res)) return { ...empty, failure: 'device', deviceError: res };
  const body = isObj(res.body) ? res.body : {};
  if (res.status === 409) return { ...empty, code: 'TEST_BUSY', failure: 'busy' };
  if (res.status === 429)
    return {
      ...empty,
      code: 'TEST_RATE_LIMITED',
      failure: 'rate',
      ...(typeof body.retryAfterS === 'number' ? { retryAfterS: body.retryAfterS } : {}),
    };
  if (res.status === 400)
    return {
      ...empty,
      code: 'BAD_REQUEST',
      failure: 'badRequest',
      issues: Array.isArray(body.issues)
        ? body.issues.filter(isObj).map((i) => String(i.code ?? ''))
        : [],
    };
  if (res.status === 503) return { ...empty, code: 'AUDIT_UNAVAILABLE', failure: 'audit' };
  if (res.status < 200 || res.status >= 300)
    return { ...empty, code: String(res.status), failure: 'unknown' };
  const out: ProbeResult = { ok: body.ok === true, code: String(body.code ?? ''), interpret: [] };
  if (typeof body.connectMs === 'number') out.connectMs = body.connectMs;
  if (typeof body.responseMs === 'number') out.responseMs = body.responseMs;
  if (typeof body.message === 'string') out.message = body.message;
  if (isObj(body.exception))
    out.exception = {
      code: String(body.exception.code ?? ''),
      meaning: String(body.exception.meaning ?? ''),
    };
  if (body.action === 'read' || body.action === 'whois' || body.action === 'objects') {
    // BACnet (feature 020)
    out.action = body.action;
    if (isObj(body.read)) {
      out.address = String(body.read.address ?? '');
      out.value = String(body.read.value ?? '');
      out.valueKind = String(body.read.kind ?? '');
    }
    if (Array.isArray(body.devices)) out.devices = parseFound(body.devices);
    if (Array.isArray(body.objects)) out.objects = parseObjects(body.objects);
    if (typeof body.truncated === 'boolean') out.truncated = body.truncated;
    if (isObj(body.error))
      out.bacnetError = {
        class: Number(body.error.class),
        code: Number(body.error.code),
        reason: String(body.error.reason ?? ''),
      };
    if (typeof body.reason === 'number') out.reason = body.reason;
    return out;
  }
  if (isObj(body.endCode))
    out.endCode = {
      code: String(body.endCode.code ?? ''),
      reason: String(body.endCode.reason ?? ''),
      meaning: String(body.endCode.meaning ?? ''),
    };
  if (typeof body.model === 'string') out.model = body.model;
  if (isObj(body.nodes))
    out.nodes = { client: Number(body.nodes.client), server: Number(body.nodes.server) };
  if (isObj(body.read) && Array.isArray(body.read.words)) {
    // FINS: word big-endian, Tag nhiều word theo CDAB (word thấp trước)
    out.address = String(body.read.address ?? '');
    out.hex = body.read.words.map((x) => String(x).toUpperCase().padStart(4, '0'));
    out.interpret = interpretRegisters(out.hex.map((h) => parseInt(h, 16)));
  } else if (isObj(body.read) && body.read.fc === undefined) {
    out.address = String(body.read.address ?? '');
    if (Array.isArray(body.read.bits)) out.bits = body.read.bits.map((b) => b === true);
  } else if (isObj(body.read)) {
    const r = body.read;
    out.read = { fc: Number(r.fc), offset: Number(r.offset), count: Number(r.count) };
    if (Array.isArray(r.registers)) {
      out.hex = r.registers.map((x) => String(x).toUpperCase().padStart(4, '0'));
      out.interpret = interpretRegisters(out.hex.map((h) => parseInt(h, 16)));
    }
    if (Array.isArray(r.bits)) out.bits = r.bits.map((b) => b === true);
  }
  return out;
}

/** Bộ chạy Thử kết nối: một lần tại một thời điểm; trạng thái cho giao diện đọc và nghe. */
export class ConnectionProbe {
  state: ProbeState = { running: false, locked: null, result: null };
  private readonly deps: ProbeDeps;
  private readonly listeners = new Set<() => void>();

  constructor(deps: ProbeDeps) {
    this.deps = deps;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private set(next: Partial<ProbeState>): void {
    this.state = { ...this.state, ...next };
    for (const l of [...this.listeners]) l();
  }

  /** Cập nhật lý do khóa mà không chạy (giao diện gọi khi phiên đổi). */
  refreshLock(): void {
    const locked = this.deps.gate();
    if (locked !== this.state.locked) this.set({ locked });
  }

  async run(channel: Channel, device: FieldDevice, read: ProbeRead | null): Promise<void> {
    await this.runBody(probeBody(channel, device, read));
  }

  /** Một lần thử với thân đã dựng sẵn (BACnet: Tìm thiết bị, Duyệt đối tượng; feature 020). */
  async runBody(body: object): Promise<void> {
    if (this.state.running) return;
    const locked = this.deps.gate();
    if (locked) {
      this.set({ locked });
      return;
    }
    this.set({ running: true, locked: null, result: null });
    let result: ProbeResult;
    try {
      result = resultOf(await this.deps.post('/api/v1/drivers/test', body));
    } catch {
      result = {
        ok: false,
        code: '',
        interpret: [],
        failure: 'device',
        deviceError: { error: 'unreachable' },
      };
    }
    this.set({ running: false, result });
  }

  clear(): void {
    this.set({ result: null });
  }
}

// ---------- Lỗi của bộ kiểm tra theo trường ----------

/**
 * Khóa trường của form cho một lỗi theo JSON pointer trong \`connections.json\`: \`/channels/1/serial/port\` → kênh 1,
 * trường \`serialPort\`; \`/channels/1/devices/0/timeoutMs\` → kênh 1, thiết bị 0, trường \`timeoutMs\`. Lỗi không gắn với một
 * trường (cả đối tượng) thì \`field = null\`.
 */
export function issueField(
  path: string,
  kind: ChannelKind,
): { channel: number; device: number | null; field: string | null } | null {
  const seg = path
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (seg[0] !== 'channels' || !/^\d+$/.test(seg[1] ?? '')) return null;
  const channel = Number(seg[1]);
  const isDevice = seg[2] === 'devices' && /^\d+$/.test(seg[3] ?? '');
  const rest = (isDevice ? seg.slice(4) : seg.slice(2)).join('/');
  const specs = isDevice ? deviceFields(kind) : channelFields(kind);
  const spec = rest ? specs.find((s) => s.path.join('/') === rest) : undefined;
  return { channel, device: isDevice ? Number(seg[3]) : null, field: spec?.key ?? null };
}

// ---------- Bảng cách hiểu ----------

export interface InterpretLine {
  type: string;
  /** Giá trị theo thứ tự byte; kiểu 16 bit chỉ có \`-\`. */
  values: Partial<Record<'ABCD' | 'CDAB' | 'BADC' | 'DCBA' | '-', string>>;
  /** Thứ tự byte nào cho giá trị không hợp lệ (NaN, vô cực). */
  invalid: string[];
}

/** Gộp các dòng của \`interpretRegisters\` thành bảng: mỗi kiểu một dòng, một cột cho từng thứ tự byte. */
export function interpretTable(rows: readonly InterpretRow[]): InterpretLine[] {
  const out = new Map<string, InterpretLine>();
  for (const r of rows) {
    const line = out.get(r.type) ?? { type: r.type, values: {}, invalid: [] };
    const key = r.byteOrder ?? '-';
    line.values[key] = r.text;
    if (r.invalid) line.invalid.push(key);
    out.set(r.type, line);
  }
  return [...out.values()];
}

// ---------- Cổng serial của kênh RTU (feature 006, T171, US3-1, US3-4, US3-5; device-api-1.1 §6) ----------

export type PortKind = 'onboard' | 'usb' | 'unknown';
export type Rs485State = 'enabled' | 'supported' | 'unsupported' | 'unknown';

/** Một cổng serial do BL335 báo (data-model §11). */
export interface SerialPortInfo {
  name: string;
  path: string;
  byId?: string;
  kind: PortKind;
  driver: string;
  usb?: { vid: string; pid: string; product?: string; serial?: string };
  /** Có trong `serialPorts` của BL335. */
  allowed: boolean;
  /** Ai đang dùng: `console`, `getty`, `channel` (kèm id kênh), `lock`. */
  inUse: { by: string; detail: string } | null;
  rs485: Rs485State;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Đọc thân của `GET /api/v1/serial/ports`; `null` khi sai hình dạng. Mục thiếu tên bị bỏ. */
export function parseSerialPorts(body: unknown): SerialPortInfo[] | null {
  if (!isObj(body) || !Array.isArray(body.ports)) return null;
  const out: SerialPortInfo[] = [];
  for (const p of body.ports) {
    if (!isObj(p) || typeof p.name !== 'string' || p.name === '') continue;
    const kind: PortKind = p.kind === 'onboard' || p.kind === 'usb' ? p.kind : 'unknown';
    const rs485: Rs485State =
      p.rs485 === 'enabled' || p.rs485 === 'supported' || p.rs485 === 'unsupported'
        ? p.rs485
        : 'unknown';
    const u = isObj(p.usb) ? p.usb : null;
    const info: SerialPortInfo = {
      name: p.name,
      path: str(p.path) || `/dev/${p.name}`,
      kind,
      driver: str(p.driver),
      allowed: p.allowed === true,
      inUse: isObj(p.inUse) ? { by: str(p.inUse.by), detail: str(p.inUse.detail) } : null,
      rs485,
    };
    if (typeof p.byId === 'string' && p.byId) info.byId = p.byId;
    if (u && typeof u.vid === 'string' && typeof u.pid === 'string')
      info.usb = {
        vid: u.vid,
        pid: u.pid,
        ...(typeof u.product === 'string' ? { product: u.product } : {}),
        ...(typeof u.serial === 'string' ? { serial: u.serial } : {}),
      };
    out.push(info);
  }
  return out;
}

export type PortStatus = { usable: true } | { usable: false; reason: MessageKey; channel?: string };

/** Cổng có dùng được cho kênh `channelId` không, nếu không thì vì sao (US3-4). */
export function portStatus(p: SerialPortInfo, channelId: string): PortStatus {
  const use = p.inUse;
  if (use) {
    if (use.by === 'console') return { usable: false, reason: 'cn.port.console' };
    if (use.by === 'getty') return { usable: false, reason: 'cn.port.getty' };
    if (use.by === 'lock') return { usable: false, reason: 'cn.port.lock' };
    if (use.by === 'channel') {
      if (use.detail !== channelId)
        return { usable: false, reason: 'cn.port.byChannel', channel: use.detail };
    } else return { usable: false, reason: 'cn.port.other' };
  }
  if (!p.allowed) return { usable: false, reason: 'cn.port.notAllowed' };
  return { usable: true };
}

export interface PortChoice {
  name: string;
  path: string;
  kind: PortKind;
  rs485: Rs485State;
  usable: boolean;
  status: PortStatus;
  info: SerialPortInfo;
}

/** Danh sách chọn cổng cho kênh: cổng dùng được trước, mỗi nhóm giữ thứ tự thiết bị báo. */
export function portChoices(ports: readonly SerialPortInfo[], channelId: string): PortChoice[] {
  const all = ports.map((p): PortChoice => {
    const status = portStatus(p, channelId);
    return {
      name: p.name,
      path: p.path,
      kind: p.kind,
      rs485: p.rs485,
      usable: status.usable,
      status,
      info: p,
    };
  });
  return [...all.filter((c) => c.usable), ...all.filter((c) => !c.usable)];
}

export interface PortProblem {
  reason: MessageKey;
  port: string;
  channel?: string;
}

/**
 * Khi Online (đã đọc danh sách cổng): kiểm trước cổng người dùng nhập, ngoài danh sách của BL335 hay đang có ai dùng thì có
 * lỗi (US3-4). Chưa có danh sách hay ô trống thì không kiểm. Nhận tên (`ttyAS2`), đường dẫn (`/dev/ttyAS2`) hay `byId`.
 */
export function portProblem(
  value: string,
  ports: readonly SerialPortInfo[] | null,
  channelId: string,
): PortProblem | null {
  const v = value.trim();
  if (!v || !ports) return null;
  const p = ports.find((x) => x.name === v || x.path === v || x.byId === v);
  if (!p) return { reason: 'cn.err.portUnknown', port: v };
  const s = portStatus(p, channelId);
  return s.usable
    ? null
    : {
        reason: s.reason,
        port: p.name,
        ...(s.channel !== undefined ? { channel: s.channel } : {}),
      };
}

/** Gợi ý khi bật RS485 trên cổng mà kernel không hỗ trợ (US3-5). */
export function rs485Hint(rs485: boolean, port: SerialPortInfo | undefined): MessageKey | null {
  return rs485 && port?.rs485 === 'unsupported' ? 'cn.port.rs485Unsupported' : null;
}

/** Khóa đọc danh sách cổng: cần Online, và tài khoản từ engineer trở lên (device-api-1.1 §1). */
export function portsGate(input: ProbeGateInput): MessageKey | null {
  if (!input.online) return 'cn.ports.needOnline';
  if (input.role !== 'engineer' && input.role !== 'administrator') return 'cn.ports.needEngineer';
  return null;
}

export interface PortsState {
  loading: boolean;
  /** `null`: chưa đọc. */
  ports: SerialPortInfo[] | null;
  /** Mã lỗi của lần đọc gần nhất; danh sách cũ được giữ. */
  error: string | null;
  locked: MessageKey | null;
  /** Lần đọc gần nhất có `?probe=1` (Dò RS485). */
  probed: boolean;
}

export interface PortsDeps {
  get(path: string, query?: Record<string, string>): Promise<ApiResult | DeviceError>;
  gate(): MessageKey | null;
}

/** Đọc danh sách cổng serial (và Dò RS485) từ BL335; mỗi lúc một lần. Studio không tự mở cổng nào. */
export class SerialPortsLoader {
  state: PortsState = { loading: false, ports: null, error: null, locked: null, probed: false };
  private readonly deps: PortsDeps;
  private readonly listeners = new Set<() => void>();

  constructor(deps: PortsDeps) {
    this.deps = deps;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private set(next: Partial<PortsState>): void {
    this.state = { ...this.state, ...next };
    for (const l of [...this.listeners]) l();
  }

  /** Cập nhật lý do khóa mà không đọc (giao diện gọi khi phiên đổi). */
  refreshLock(): void {
    const locked = this.deps.gate();
    if (locked !== this.state.locked) this.set({ locked });
  }

  async load(probe: boolean): Promise<void> {
    if (this.state.loading) return;
    const locked = this.deps.gate();
    if (locked) {
      this.set({ locked });
      return;
    }
    this.set({ loading: true, locked: null });
    let res: ApiResult | DeviceError;
    try {
      res = await this.deps.get('/api/v1/serial/ports', probe ? { probe: '1' } : undefined);
    } catch {
      res = { error: 'unreachable' };
    }
    if (isDeviceError(res)) {
      this.set({ loading: false, error: res.error });
      return;
    }
    const ports = parseSerialPorts(res.body);
    if (!ports) {
      this.set({ loading: false, error: 'bad-response' });
      return;
    }
    this.set({ loading: false, ports, error: null, probed: probe });
  }

  /** Rời Online hoặc đổi thiết bị: bỏ danh sách cũ. */
  reset(): void {
    this.set({ loading: false, ports: null, error: null, locked: null, probed: false });
  }
}
