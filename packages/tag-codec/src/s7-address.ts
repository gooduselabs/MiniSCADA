// Địa chỉ Tag Siemens S7 (feature 016, specs/016-driver-s7/contracts/s7-driver.md §2). Cùng vector
// tests/s7-vectors/address.json với drivers/s7/address.cpp (C++).
//
//   s7-address = "DB" num "." db-item / area area-item
//   db-item    = "DBX" num "." bit / "DBB" num / "DBW" num / "DBD" num / "STRING" num / "LREAL" num
//   area       = "M" / "I" / "E" / "Q" / "A"            ; E = I, A = Q (tên tiếng Đức)
//   area-item  = num "." bit / "B" num / "W" num / "D" num
//
// Kiểu S7 suy từ cỡ trong địa chỉ và `rawType`. Chữ thường đổi thành chữ hoa; không cắt khoảng trắng.
import type { TagDataType } from './types.ts';

export type S7Area = 'DB' | 'I' | 'Q' | 'M';
export type S7Type =
  'BOOL' | 'BYTE' | 'CHAR' | 'INT' | 'WORD' | 'DINT' | 'DWORD' | 'REAL' | 'LREAL' | 'STRING';
export type S7AddressErrorCode = 'E_ADDR_SYNTAX' | 'E_ADDR_AREA' | 'E_ADDR_RANGE';

export interface S7AddressOptions {
  rawType: TagDataType;
  /** Số ký tự của CHAR/STRING. */
  stringLength?: number;
  access?: 'R' | 'RW';
}

export type S7AddressResult =
  | {
      ok: true;
      normalized: string;
      area: S7Area;
      /** Số DB (0 ngoài vùng DB). */
      db: number;
      byte: number;
      bit: number | null;
      s7Type: S7Type;
      /** Số byte Tag chiếm (bit: 1). */
      size: number;
    }
  | { ok: false; error: S7AddressErrorCode };

type Size = 'X' | 'B' | 'W' | 'D' | 'STRING' | 'LREAL';

const DB_RE =
  /^DB([0-9]{1,5})\.(?:DBX([0-9]{1,5})\.([0-9])|(DBB|DBW|DBD|STRING|LREAL)([0-9]{1,5}))$/;
const AREA_RE = /^([MIEQA])(?:([0-9]{1,5})\.([0-9])|([BWD])([0-9]{1,5}))$/;
const AREA_OF: Readonly<Record<string, S7Area>> = { M: 'M', I: 'I', E: 'I', Q: 'Q', A: 'Q' };

/** Kiểu S7 cho cỡ và rawType; undefined: không hợp. */
function typeOf(size: Size, raw: TagDataType): S7Type | undefined {
  switch (size) {
    case 'X':
      return raw === 'BOOL' ? 'BOOL' : undefined;
    case 'B':
      return raw === 'UINT16' ? 'BYTE' : raw === 'STRING' ? 'CHAR' : undefined;
    case 'W':
      return raw === 'INT16' ? 'INT' : raw === 'UINT16' ? 'WORD' : undefined;
    case 'D':
      return raw === 'INT32'
        ? 'DINT'
        : raw === 'UINT32'
          ? 'DWORD'
          : raw === 'FLOAT32'
            ? 'REAL'
            : undefined;
    case 'LREAL':
      return raw === 'FLOAT64' ? 'LREAL' : undefined;
    case 'STRING':
      return raw === 'STRING' ? 'STRING' : undefined;
  }
}

/** Số byte của một kiểu S7 (`n`: số ký tự của CHAR/STRING). */
export function s7TypeSize(t: S7Type, n = 0): number {
  switch (t) {
    case 'BOOL':
    case 'BYTE':
      return 1;
    case 'CHAR':
      return Math.max(1, n);
    case 'INT':
    case 'WORD':
      return 2;
    case 'DINT':
    case 'DWORD':
    case 'REAL':
      return 4;
    case 'LREAL':
      return 8;
    case 'STRING':
      return Math.max(1, n) + 2;
  }
}

/** Số byte một lệnh ghi gửi đi (STRING không ghi byte độ dài tối đa). */
export function s7WriteSize(t: S7Type, size: number): number {
  return t === 'STRING' ? size - 1 : size;
}

export function parseS7Address(address: string, opts: S7AddressOptions): S7AddressResult {
  const up = address.toUpperCase();
  let area: S7Area;
  let db = 0;
  let size: Size;
  let byteText: string;
  let bitText: string | undefined;
  let m = DB_RE.exec(up);
  if (m) {
    area = 'DB';
    db = Number(m[1]);
    if (m[2] !== undefined) {
      size = 'X';
      byteText = m[2];
      bitText = m[3];
    } else {
      const k = m[4]!;
      size = k === 'DBB' ? 'B' : k === 'DBW' ? 'W' : k === 'DBD' ? 'D' : (k as Size);
      byteText = m[5]!;
    }
  } else {
    m = AREA_RE.exec(up);
    if (!m) return { ok: false, error: 'E_ADDR_SYNTAX' };
    area = AREA_OF[m[1]!]!;
    if (m[2] !== undefined) {
      size = 'X';
      byteText = m[2];
      bitText = m[3];
    } else {
      size = m[4] as Size;
      byteText = m[5]!;
    }
  }
  const byte = Number(byteText);
  const bit = bitText === undefined ? null : Number(bitText);
  if ((area === 'DB' && (db < 1 || db > 65535)) || byte > 65535 || (bit !== null && bit > 7))
    return { ok: false, error: 'E_ADDR_RANGE' };
  const s7Type = typeOf(size, opts.rawType);
  if (!s7Type) return { ok: false, error: 'E_ADDR_AREA' };
  if (area === 'I' && (opts.access ?? 'R') === 'RW') return { ok: false, error: 'E_ADDR_AREA' };
  const bytes = s7TypeSize(s7Type, opts.stringLength ?? 0);
  if (byte + bytes > 65536) return { ok: false, error: 'E_ADDR_RANGE' };

  let normalized: string;
  if (area === 'DB') {
    const item =
      size === 'X'
        ? `DBX${byte}.${bit}`
        : size === 'STRING' || size === 'LREAL'
          ? `${size}${byte}`
          : `DB${size}${byte}`;
    normalized = `DB${db}.${item}`;
  } else normalized = size === 'X' ? `${area}${byte}.${bit}` : `${area}${size}${byte}`;
  return { ok: true, normalized, area, db, byte, bit, s7Type, size: bytes };
}
