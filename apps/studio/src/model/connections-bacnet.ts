// Kênh BACnet/IP trong editor Kết nối (feature 020, spec FR-011, FR-013, FR-015). Không DOM: bảng trường của kênh và
// thiết bị BACnet, thân các lần thử qua BL335 (`read`, `whois`, `objects` của `POST /api/v1/drivers/test`), đọc kết
// quả Tìm thiết bị và Duyệt đối tượng, thiết bị và Tag mới từ kết quả. Studio không tự gửi gói BACnet nào.
import { BACNET_OBJECT_TYPES, parseBacnetAddress, type BacnetObjectType } from '@mat/tag-codec';
import type { Channel, FieldDevice, TagV1 } from '@mat/project-schema';
import type { MessageKey } from '../i18n/index.ts';

type FieldGroup = 'basic' | 'advanced';
type Obj = Record<string, unknown>;

/** Cùng hình với FieldSpec của connections.ts (khai lại để file này không phụ thuộc vòng). */
export interface BacnetFieldSpec {
  key: string;
  target: 'channel' | 'device';
  path: readonly string[];
  label: MessageKey;
  help: MessageKey;
  group: FieldGroup;
  kind: 'text' | 'number' | 'select' | 'bool';
  options?: readonly string[];
  numeric?: boolean;
  min?: number;
  max?: number;
  real?: boolean;
  default?: string | number | boolean;
  required?: boolean;
  maxLen?: number;
  mono?: boolean;
  unit?: string;
}

const f = (
  target: BacnetFieldSpec['target'],
  key: string,
  path: readonly string[],
  group: FieldGroup,
  kind: BacnetFieldSpec['kind'],
  extra: Partial<BacnetFieldSpec> = {},
): BacnetFieldSpec => ({
  key,
  target,
  path,
  group,
  kind,
  label: `cn.f.${key}` as MessageKey,
  help: `cn.h.${key}` as MessageKey,
  ...extra,
});

export const BACNET_CHANNEL: BacnetFieldSpec[] = [
  f('channel', 'id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  f('channel', 'name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  f('channel', 'enabled', ['enabled'], 'basic', 'bool', { default: true }),
  f('channel', 'bacnetLocalPort', ['bacnet', 'localPort'], 'basic', 'number', {
    min: 0,
    max: 65535,
    default: 47808,
    mono: true,
  }),
  f('channel', 'bacnetBroadcast', ['bacnet', 'broadcast'], 'basic', 'text', {
    mono: true,
    maxLen: 15,
    default: '255.255.255.255',
  }),
  f('channel', 'bacnetBindAddress', ['bacnet', 'bindAddress'], 'advanced', 'text', {
    mono: true,
    maxLen: 15,
  }),
  f('channel', 'bacnetBbmdHost', ['bacnet', 'bbmd', 'host'], 'advanced', 'text', {
    mono: true,
    maxLen: 253,
  }),
  f('channel', 'bacnetBbmdPort', ['bacnet', 'bbmd', 'port'], 'advanced', 'number', {
    min: 1,
    max: 65535,
    default: 47808,
  }),
  f('channel', 'bacnetBbmdTtlS', ['bacnet', 'bbmd', 'ttlS'], 'advanced', 'number', {
    min: 30,
    max: 65535,
    default: 300,
    unit: 's',
  }),
  f('channel', 'reconnectMaxS', ['bacnet', 'reconnectMaxS'], 'advanced', 'number', {
    min: 1,
    max: 60,
    default: 10,
    unit: 's',
  }),
  f('channel', 'requestGapMs', ['requestGapMs'], 'advanced', 'number', {
    min: 0,
    max: 1000,
    default: 0,
    unit: 'ms',
  }),
];

export const BACNET_DEVICE: BacnetFieldSpec[] = [
  f('device', 'id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  f('device', 'name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  f('device', 'enabled', ['enabled'], 'basic', 'bool', { default: true }),
  f('device', 'bacnetInstance', ['deviceInstance'], 'basic', 'number', {
    required: true,
    min: 0,
    max: 4194302,
    mono: true,
  }),
  f('device', 'bacnetHost', ['host'], 'basic', 'text', { required: true, mono: true, maxLen: 253 }),
  f('device', 'bacnetPort', ['port'], 'basic', 'number', { min: 1, max: 65535, default: 47808 }),
  f('device', 'bacnetWritePriority', ['writePriority'], 'basic', 'select', {
    options: ['1', '2', '3', '4', '5', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16'],
    numeric: true,
    default: 16,
  }),
  f('device', 'bacnetNetwork', ['network'], 'advanced', 'number', { min: 1, max: 65534 }),
  f('device', 'bacnetMac', ['mac'], 'advanced', 'text', { mono: true, maxLen: 12 }),
  f('device', 'bacnetMaxApdu', ['maxApdu'], 'advanced', 'select', {
    options: ['50', '128', '206', '480', '1024', '1476'],
    numeric: true,
    default: 1476,
  }),
  f('device', 'bacnetTimeoutMs', ['timeoutMs'], 'advanced', 'number', {
    min: 100,
    max: 30000,
    default: 500,
    unit: 'ms',
  }),
  f('device', 'bacnetRetries', ['retries'], 'advanced', 'number', { min: 0, max: 5, default: 1 }),
  f('device', 'bacnetUseRpm', ['useRpm'], 'advanced', 'bool', { default: true }),
  f('device', 'bacnetMaxRpmProps', ['maxRpmProps'], 'advanced', 'number', {
    min: 1,
    max: 128,
    default: 32,
  }),
  f('device', 'writeDeadlineMs', ['writeDeadlineMs'], 'advanced', 'number', {
    min: 1000,
    max: 60000,
    default: 5000,
    unit: 'ms',
  }),
];

const pick = (src: unknown, keys: readonly string[]): Obj => {
  const out: Obj = {};
  const o = (src && typeof src === 'object' ? src : {}) as Obj;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};

const channelPart = (channel: Channel): Obj => ({
  kind: 'bacnet',
  bacnet: pick(channel.bacnet, ['localPort', 'bindAddress', 'broadcast', 'bbmd']),
});
const devicePart = (device: FieldDevice): Obj =>
  pick(device, ['deviceInstance', 'host', 'port', 'network', 'mac', 'timeoutMs']);

/** Thử kết nối: đọc object-name của Device (không địa chỉ) hoặc một địa chỉ BACnet. */
export function bacnetReadBody(channel: Channel, device: FieldDevice, address: string): object {
  return {
    channel: channelPart(channel),
    device: devicePart(device),
    action: 'read',
    ...(address.trim() ? { read: { address: address.trim() } } : {}),
  };
}

/** Tìm thiết bị: Who-Is (broadcast của kênh hoặc qua BBMD), chờ `waitMs`. */
export function bacnetWhoIsBody(channel: Channel, waitMs = 3000): object {
  return { channel: channelPart(channel), action: 'whois', whois: { waitMs } };
}

/** Duyệt đối tượng: object-list của thiết bị (kèm tên của 500 đối tượng đầu). */
export function bacnetObjectsBody(channel: Channel, device: FieldDevice): object {
  return { channel: channelPart(channel), device: devicePart(device), action: 'objects' };
}

export interface BacnetFound {
  instance: number;
  host: string;
  port: number;
  network: number;
  mac: string;
  maxApdu: number;
  vendorId: number;
}

export interface BacnetObjectRow {
  type: number;
  instance: number;
  /** `AI:1`…; rỗng với loại driver không đọc. */
  address: string;
  name: string;
}

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function parseFound(list: unknown): BacnetFound[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isObj).map((d) => ({
    instance: num(d.instance),
    host: String(d.host ?? ''),
    port: num(d.port, 47808),
    network: num(d.network),
    mac: String(d.mac ?? ''),
    maxApdu: num(d.maxApdu, 1476),
    vendorId: num(d.vendorId),
  }));
}

export function parseObjects(list: unknown): BacnetObjectRow[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isObj).map((o) => ({
    type: num(o.type),
    instance: num(o.instance),
    address: typeof o.address === 'string' ? o.address : '',
    name: typeof o.name === 'string' ? o.name : '',
  }));
}

/** Thiết bị mới từ một dòng I-Am (null khi instance đã có trong kênh). */
export function deviceFromFound(
  found: BacnetFound,
  channel: Channel,
  deviceIds: readonly string[],
): FieldDevice | null {
  if ((channel.devices ?? []).some((d) => d.deviceInstance === found.instance)) return null;
  const taken = new Set(deviceIds);
  let id = `dev${found.instance}`.slice(0, 32);
  for (let n = 2; taken.has(id); n++) id = `dev${found.instance}-${n}`.slice(0, 32);
  const d: FieldDevice = {
    id,
    name: `Device ${found.instance}`,
    deviceInstance: found.instance,
    host: found.host,
  };
  if (found.port !== 47808) d.port = found.port;
  if (found.network) {
    d.network = found.network;
    if (found.mac) d.mac = found.mac;
  }
  if (found.maxApdu && found.maxApdu < 1476)
    d.maxApdu = [50, 128, 206, 480, 1024].filter((x) => x <= found.maxApdu).at(-1) ?? 50;
  return d;
}

const ANALOG = new Set(['AI', 'AO', 'AV']);
const BINARY = new Set(['BI', 'BO', 'BV']);
const WRITABLE = new Set(['AO', 'AV', 'BO', 'BV', 'MSO', 'MSV']);

/** Tag mới cho một đối tượng (null với Device hay loại driver không đọc); id `<THIẾT BỊ>.<LOẠI>_<instance>`. */
export function tagFromObject(
  o: BacnetObjectRow,
  deviceId: string,
  takenIds: ReadonlySet<string>,
): TagV1 | null {
  const type = o.address.split(':')[0] as BacnetObjectType;
  if (!o.address || !(type in BACNET_OBJECT_TYPES) || type === 'DEV') return null;
  const tagType = ANALOG.has(type) ? 'FLOAT32' : BINARY.has(type) ? 'BOOL' : 'UINT16';
  const access = WRITABLE.has(type) ? 'RW' : 'R';
  if (!parseBacnetAddress(o.address, { rawType: tagType, access }).ok) return null;
  let prefix = deviceId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (!/^[A-Z]/.test(prefix)) prefix = `D${prefix}`;
  let id = `${prefix}.${type}_${o.instance}`.slice(0, 64);
  for (let n = 2; takenIds.has(id); n++) id = `${prefix}.${type}_${o.instance}_${n}`.slice(0, 64);
  const tag: TagV1 = {
    id,
    kind: 'external',
    type: tagType,
    ...(access === 'RW' ? { access: 'RW' as const } : {}),
    source: { device: deviceId, address: o.address },
  } as TagV1;
  if (o.name) (tag as unknown as Obj).description = o.name.slice(0, 256);
  return tag;
}
