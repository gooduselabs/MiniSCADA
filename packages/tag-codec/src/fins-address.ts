// Địa chỉ Omron FINS của Tag ngoài (feature 018, spec FR-004, FR-005). Bản C++: drivers/fins/address.cpp; vector
// chung tests/fins-vectors/address.json.
//
//   address = area number [ "." bit ]
//   area    = "CIO" / "W" / "H" / "A" / "D" / "T" / "C" / "E" bank "_"   ; bank 0-9, A-C (hex)
//   number  = 1*5DIGIT                                                   ; cho phép số 0 đứng đầu (D00100)
//   bit     = 1*2DIGIT                                                   ; 0-15, chỉ BOOL
//
// T và C: BOOL là cờ hoàn thành (chỉ đọc), số 16 bit là giá trị hiện tại. Mã vùng chế độ CS/CJ (W342 §5-2).
import type { AddressErrorCode } from './address.ts';
import type { TagDataType } from './types.ts';

export type FinsArea = 'CIO' | 'W' | 'H' | 'A' | 'D' | 'E' | 'T' | 'C';

export interface FinsAddressOptions {
  /** Kiểu trên PLC (`source.rawType`, mặc định bằng `type`). */
  rawType: TagDataType;
  /** Bắt buộc với STRING. */
  stringLength?: number;
  access?: 'R' | 'RW';
}

export type FinsAddressResult =
  | {
      ok: true;
      /** Địa chỉ viết hoa. */
      normalized: string;
      area: FinsArea;
      /** Bank EM 0–12, null với vùng khác. */
      bank: number | null;
      /** Số word (hoặc số timer/counter). */
      offset: number;
      /** Địa chỉ word gửi đi (counter: 0x8000 + số). */
      wire: number;
      bit: number | null;
      /** Số word Tag chiếm (bit, cờ tính 1). */
      words: number;
      /** Cờ hoàn thành của timer/counter. */
      flag: boolean;
      /** Mã vùng FINS khi đọc theo word, theo bit (hex hai chữ số). */
      wordCode: string;
      bitCode: string;
      writable: boolean;
    }
  | { ok: false; error: AddressErrorCode };

const AREA_MAX: Readonly<Record<FinsArea, number>> = {
  CIO: 6143,
  W: 511,
  H: 1535,
  A: 1471,
  D: 32767,
  E: 32767,
  T: 4095,
  C: 4095,
};
const CODES: Readonly<Record<Exclude<FinsArea, 'E'>, [number, number]>> = {
  CIO: [0xb0, 0x30],
  W: [0xb1, 0x31],
  H: [0xb2, 0x32],
  A: [0xb3, 0x33],
  D: [0x82, 0x02],
  T: [0x89, 0x09],
  C: [0x89, 0x09],
};
/** A0–A447 chỉ đọc. */
const A_READ_ONLY_BELOW = 448;
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

/** Số word Tag chiếm trên PLC (BOOL 1; STRING: ceil(độ dài / 2)). */
export function finsWordCount(rawType: TagDataType, stringLength?: number): number {
  switch (rawType) {
    case 'BOOL':
    case 'INT16':
    case 'UINT16':
      return 1;
    case 'INT32':
    case 'UINT32':
    case 'FLOAT32':
      return 2;
    case 'STRING':
      return Math.ceil((stringLength ?? 0) / 2);
    default:
      return 4;
  }
}

/** Số word lớn nhất của vùng. */
export const finsAreaMax = (area: FinsArea): number => AREA_MAX[area];

const RE = /^(CIO|E([0-9A-C])_|W|H|A|D|T|C)([0-9]{1,5})(?:\.([0-9]{1,2}))?$/;

export function parseFinsAddress(address: string, opts: FinsAddressOptions): FinsAddressResult {
  const up = address.toUpperCase();
  const m = RE.exec(up);
  if (!m) return { ok: false, error: 'E_ADDR_SYNTAX' };
  const area = (m[2] !== undefined ? 'E' : m[1]) as FinsArea;
  const bank = m[2] !== undefined ? parseInt(m[2], 16) : null;
  const number = Number(m[3]);
  const bit = m[4] === undefined ? null : Number(m[4]);
  if (bit !== null && bit > 15) return { ok: false, error: 'E_ADDR_SYNTAX' };

  const timerCounter = area === 'T' || area === 'C';
  const t = opts.rawType;
  let flag = false;
  if (bit !== null) {
    if (timerCounter || t !== 'BOOL') return { ok: false, error: 'E_ADDR_AREA' };
  } else if (timerCounter) {
    if (t === 'BOOL') flag = true;
    else if (t !== 'INT16' && t !== 'UINT16') return { ok: false, error: 'E_ADDR_AREA' };
  } else if (t === 'BOOL') return { ok: false, error: 'E_ADDR_AREA' };
  const readOnlyA = area === 'A' && number < A_READ_ONLY_BELOW;
  if ((opts.access ?? 'R') === 'RW' && (flag || readOnlyA))
    return { ok: false, error: 'E_ADDR_AREA' };

  const max = AREA_MAX[area];
  const words = flag || bit !== null ? 1 : finsWordCount(t, opts.stringLength);
  if (number > max || number + words - 1 > max) return { ok: false, error: 'E_ADDR_RANGE' };

  const [wordCode, bitCode] = area === 'E' ? [0xa0 + bank!, 0x20 + bank!] : CODES[area];
  return {
    ok: true,
    normalized: up,
    area,
    bank,
    offset: number,
    wire: area === 'C' ? 0x8000 + number : number,
    bit,
    words,
    flag,
    wordCode: hex2(wordCode),
    bitCode: hex2(bitCode),
    writable: !flag && !readOnlyA,
  };
}

/** Gợi ý cho ô địa chỉ của Studio: tiền tố vùng và ví dụ. */
export const FINS_ADDRESS_HINTS: readonly { prefix: string; example: string; label: string }[] = [
  { prefix: 'D', example: 'D100', label: 'DM (D0–D32767)' },
  { prefix: 'CIO', example: 'CIO10.03', label: 'CIO (CIO0–CIO6143)' },
  { prefix: 'W', example: 'W5', label: 'Work (W0–W511)' },
  { prefix: 'H', example: 'H2', label: 'Holding (H0–H1535)' },
  { prefix: 'A', example: 'A448', label: 'Auxiliary (A0–A1471, ghi từ A448)' },
  { prefix: 'E0_', example: 'E0_100', label: 'EM bank 0–C (E0_0–EC_32767)' },
  { prefix: 'T', example: 'T5', label: 'Timer: số = PV, BOOL = cờ hoàn thành' },
  { prefix: 'C', example: 'C12', label: 'Counter: số = PV, BOOL = cờ hoàn thành' },
];
