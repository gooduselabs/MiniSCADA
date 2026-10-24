// @mat/tag-codec: địa chỉ Modbus, đổi thanh ghi <-> giá trị, scaling, bit (FR-011, FR-013, FR-015).
// Cùng vector tests/codec-vectors với drivers/modbus (C++).
export * from './types.ts';
export { parseAddress, registerCount } from './address.ts';
export type { Area, AddressErrorCode, AddressOptions, AddressResult } from './address.ts';
export { parseS7Address, s7TypeSize, s7WriteSize } from './s7-address.ts';
export type {
  S7Area,
  S7Type,
  S7AddressErrorCode,
  S7AddressOptions,
  S7AddressResult,
} from './s7-address.ts';
// feature 018: địa chỉ Omron FINS (tests/fins-vectors, cùng drivers/fins)
export {
  FINS_ADDRESS_HINTS,
  finsAreaMax,
  finsWordCount,
  parseFinsAddress,
} from './fins-address.ts';
export type { FinsAddressOptions, FinsAddressResult, FinsArea } from './fins-address.ts';
export { parseOpcUaNodeId } from './opcua-node-id.ts';
export type { OpcUaIdType, OpcUaNodeIdErrorCode, OpcUaNodeIdResult } from './opcua-node-id.ts';
export { decodeNumber, encodeNumber, WORDS } from './numeric.ts';
export type { DecodeResult, NumericValue } from './numeric.ts';
export { decodeString, encodeString } from './string.ts';
export type { EncodeStringResult } from './string.ts';
export { scaleRead, scaleWrite } from './scaling.ts';
export type { ScaleReadResult, ScaleWriteResult, Scaling } from './scaling.ts';
export { applyBit, maskWrite, packBits, registerBit, unpackBits } from './bits.ts';
export { interpretBits, interpretRegisters } from './interpret.ts';
export type { BitRow, InterpretRow } from './interpret.ts';
export { MC_DEVICES, MC_NUMBER_LIMIT, parseMcAddress } from './mc-address.ts';
export type { McAddressOptions, McAddressResult, McDevice } from './mc-address.ts';
// Địa chỉ BACnet (feature 020), cùng vector tests/bacnet-vectors/address.json với drivers/bacnet.
export {
  BACNET_ADDRESS_HINTS,
  BACNET_MAX_INSTANCE,
  BACNET_OBJECT_TYPES,
  BACNET_PROPERTIES,
  bacnetCommandable,
  parseBacnetAddress,
} from './bacnet-address.ts';
export type {
  BacnetAddressErrorCode,
  BacnetAddressOptions,
  BacnetAddressResult,
  BacnetObjectType,
} from './bacnet-address.ts';
