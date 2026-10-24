// Địa chỉ Tag BACnet (feature 020, spec FR-005..FR-007). Bản TS của drivers/bacnet/address.cpp, cùng vector
// tests/bacnet-vectors/address.json.
//
//   address  = loại ":" instance [ ":" thuộc tính ] [ "@" priority ]
//   loại     = AI | AO | AV | BI | BO | BV | MSI | MSO | MSV | DEV
//   thuộc tính = tên (present-value, status-flags, units, out-of-service, object-name, description, reliability,
//              event-state, relinquish) hoặc số 0-4194303
// `relinquish` là thuộc tính giả: Tag BOOL ghi NULL vào present-value ở priority của nó, đọc true khi
// priority-array[priority] là NULL.
import type { TagDataType as TagType } from './types.ts';

export type BacnetObjectType =
  'AI' | 'AO' | 'AV' | 'BI' | 'BO' | 'BV' | 'MSI' | 'MSO' | 'MSV' | 'DEV';
export type BacnetAddressErrorCode = 'E_ADDR_SYNTAX' | 'E_ADDR_RANGE' | 'E_ADDR_AREA';

export interface BacnetAddressOptions {
  rawType: TagType;
  access?: 'R' | 'RW';
}

export type BacnetAddressResult =
  | {
      ok: true;
      objectType: BacnetObjectType;
      instance: number;
      /** Mã thuộc tính BACnet (present-value 85 cho cả relinquish). */
      property: number;
      /** 1-16, 0 khi không có. */
      priority: number;
      relinquish: boolean;
      normalized: string;
    }
  | { ok: false; error: BacnetAddressErrorCode };

/** Mã loại đối tượng BACnet (BACnetObjectType). */
export const BACNET_OBJECT_TYPES: Record<BacnetObjectType, number> = {
  AI: 0,
  AO: 1,
  AV: 2,
  BI: 3,
  BO: 4,
  BV: 5,
  DEV: 8,
  MSI: 13,
  MSO: 14,
  MSV: 19,
};

/** Thuộc tính có tên (BACnetPropertyIdentifier). */
export const BACNET_PROPERTIES: Record<string, number> = {
  'present-value': 85,
  'status-flags': 111,
  units: 117,
  'out-of-service': 81,
  'object-name': 77,
  description: 28,
  reliability: 103,
  'event-state': 36,
};

export const BACNET_MAX_INSTANCE = 4194302;
const MAX_PROPERTY = 4194303;
const PV = 85;

const isAnalog = (t: BacnetObjectType) => t === 'AI' || t === 'AO' || t === 'AV';
const isBinary = (t: BacnetObjectType) => t === 'BI' || t === 'BO' || t === 'BV';
const isMultiState = (t: BacnetObjectType) => t === 'MSI' || t === 'MSO' || t === 'MSV';
/** AO, AV, BO, BV, MSO, MSV: loại driver ghi được present-value. */
export const bacnetCommandable = (t: BacnetObjectType): boolean =>
  t === 'AO' || t === 'AV' || t === 'BO' || t === 'BV' || t === 'MSO' || t === 'MSV';
const isNumeric = (t: TagType) => t !== 'BOOL' && t !== 'STRING';

function propertyName(id: number): string | undefined {
  return Object.keys(BACNET_PROPERTIES).find((k) => BACNET_PROPERTIES[k] === id);
}

/** FR-006: kiểu raw mà một thuộc tính của một loại đối tượng nhận. `property` -1: thuộc tính theo số. */
function typeAllowed(
  o: BacnetObjectType,
  property: number,
  relinquish: boolean,
  t: TagType,
): boolean {
  if (relinquish) return t === 'BOOL';
  switch (property) {
    case 85:
      if (isAnalog(o)) return isNumeric(t);
      if (isBinary(o)) return t === 'BOOL' || t === 'UINT16';
      if (isMultiState(o))
        return t === 'UINT16' || t === 'UINT32' || t === 'INT16' || t === 'INT32';
      return false;
    case 111:
      return o !== 'DEV' && t === 'UINT16';
    case 117:
      return isAnalog(o) && (t === 'UINT16' || t === 'UINT32');
    case 103:
    case 36:
      return t === 'UINT16' || t === 'UINT32';
    case 81:
      return o !== 'DEV' && t === 'BOOL';
    case 77:
    case 28:
      return t === 'STRING';
    default:
      return true;
  }
}

const DIGITS = /^[0-9]+$/;

/** Chữ của loại viết hoa, của thuộc tính viết thường; không cắt khoảng trắng. */
export function parseBacnetAddress(
  address: string,
  opts: BacnetAddressOptions,
): BacnetAddressResult {
  const fail = (error: BacnetAddressErrorCode): BacnetAddressResult => ({ ok: false, error });
  let body = address;
  let prio: string | undefined;
  const at = body.indexOf('@');
  if (at >= 0) {
    prio = body.slice(at + 1);
    body = body.slice(0, at);
  }
  const c1 = body.indexOf(':');
  if (c1 < 0) return fail('E_ADDR_SYNTAX');
  const c2 = body.indexOf(':', c1 + 1);
  const type = body.slice(0, c1).toUpperCase();
  const inst = c2 < 0 ? body.slice(c1 + 1) : body.slice(c1 + 1, c2);
  const prop = c2 < 0 ? '' : body.slice(c2 + 1).toLowerCase();
  if (c2 >= 0 && prop === '') return fail('E_ADDR_SYNTAX');
  if (!(type in BACNET_OBJECT_TYPES)) return fail('E_ADDR_SYNTAX');
  const objectType = type as BacnetObjectType;
  if (!DIGITS.test(inst) || inst.length > 8) return fail('E_ADDR_SYNTAX');
  let property = PV;
  let relinquish = false;
  let numericProp = false;
  if (prop === '' || prop === 'present-value') {
    property = PV;
  } else if (prop === 'relinquish') {
    relinquish = true;
  } else if (prop in BACNET_PROPERTIES) {
    property = BACNET_PROPERTIES[prop]!;
  } else {
    if (!DIGITS.test(prop) || prop.length > 8) return fail('E_ADDR_SYNTAX');
    property = Number(prop);
    if (property > MAX_PROPERTY) return fail('E_ADDR_RANGE');
    numericProp = propertyName(property) === undefined;
  }
  if (prio !== undefined && (!DIGITS.test(prio) || prio.length > 3)) return fail('E_ADDR_SYNTAX');
  if (relinquish && prio === undefined) return fail('E_ADDR_SYNTAX');
  const instance = Number(inst);
  if (instance > BACNET_MAX_INSTANCE) return fail('E_ADDR_RANGE');
  const priority = prio === undefined ? 0 : Number(prio);
  if (prio !== undefined && (priority < 1 || priority > 16 || priority === 6))
    return fail('E_ADDR_RANGE');
  if (prio !== undefined && (property !== PV || !bacnetCommandable(objectType)))
    return fail('E_ADDR_AREA');
  if (relinquish && !bacnetCommandable(objectType)) return fail('E_ADDR_AREA');
  if (!typeAllowed(objectType, numericProp ? -1 : property, relinquish, opts.rawType))
    return fail('E_ADDR_AREA');
  if (opts.access === 'RW' && (property !== PV || !bacnetCommandable(objectType)))
    return fail('E_ADDR_AREA');
  let normalized = `${objectType}:${instance}`;
  if (relinquish) normalized += ':relinquish';
  else if (property !== PV) normalized += `:${propertyName(property) ?? property}`;
  if (priority) normalized += `@${priority}`;
  return { ok: true, objectType, instance, property, priority, relinquish, normalized };
}

/** Gợi ý địa chỉ cho Bảng Tag và form (ví dụ hợp lệ với kiểu đi kèm). */
export const BACNET_ADDRESS_HINTS: { example: string; rawType: TagType; text: string }[] = [
  { example: 'AI:1', rawType: 'FLOAT32', text: 'Analog Input 1, present-value' },
  { example: 'AV:5@8', rawType: 'FLOAT32', text: 'Analog Value 5, ghi ở priority 8' },
  { example: 'BO:2', rawType: 'BOOL', text: 'Binary Output 2' },
  { example: 'MSV:3', rawType: 'UINT16', text: 'Multi-state Value 3 (1, 2, 3, ...)' },
  { example: 'AI:1:units', rawType: 'UINT16', text: 'Đơn vị (BACnetEngineeringUnits)' },
  {
    example: 'AI:1:status-flags',
    rawType: 'UINT16',
    text: 'Cờ trạng thái: bit 0 in-alarm, 1 fault, 2 overridden, 3 out-of-service',
  },
  { example: 'DEV:1001:object-name', rawType: 'STRING', text: 'Tên thiết bị' },
  { example: 'AO:1:relinquish@8', rawType: 'BOOL', text: 'Nhả priority 8 (ghi NULL)' },
];
