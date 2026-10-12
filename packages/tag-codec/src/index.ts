// @mat/tag-codec: địa chỉ Modbus, đổi thanh ghi <-> giá trị, scaling, bit (FR-011, FR-013, FR-015).
// Cùng vector tests/codec-vectors với drivers/modbus (C++).
export * from './types.ts';
export { parseAddress, registerCount } from './address.ts';
export type { Area, AddressErrorCode, AddressOptions, AddressResult } from './address.ts';
export { decodeNumber, encodeNumber, WORDS } from './numeric.ts';
export type { DecodeResult, NumericValue } from './numeric.ts';
export { decodeString, encodeString } from './string.ts';
export type { EncodeStringResult } from './string.ts';
export { scaleRead, scaleWrite } from './scaling.ts';
export type { ScaleReadResult, ScaleWriteResult, Scaling } from './scaling.ts';
export { applyBit, maskWrite, packBits, registerBit, unpackBits } from './bits.ts';
export { interpretBits, interpretRegisters } from './interpret.ts';
export type { BitRow, InterpretRow } from './interpret.ts';
