// Địa chỉ Modbus của Tag ngoài (contract project-format-0.2 §3, FR-015).
//
//   address      = area-form / modicon-form
//   area-form    = ("C" / "DI" / "IR" / "HR") number [ "." bit ]   ; bit chỉ với IR, HR
//   modicon-form = ("0" / "1" / "3" / "4") (4DIGIT / 5DIGIT) [ "." bit ]
//
// Chữ thường được đổi thành chữ hoa; không cắt khoảng trắng (Studio cắt trước khi gọi).
import type { TagDataType } from './types.ts';

export type Area = 'C' | 'DI' | 'IR' | 'HR';
export type AddressErrorCode = 'E_ADDR_SYNTAX' | 'E_ADDR_AREA' | 'E_ADDR_RANGE';

export interface AddressOptions {
  /** Số trong địa chỉ trừ đi giá trị này ra offset gửi đi. */
  addressBase: 0 | 1;
  /** Kiểu trên thiết bị trường (`source.rawType`, mặc định bằng `type`). */
  rawType: TagDataType;
  /** Bắt buộc với STRING. */
  stringLength?: number;
  access?: 'R' | 'RW';
}

export type AddressResult =
  | {
      ok: true;
      /** Địa chỉ viết hoa. */
      normalized: string;
      area: Area;
      /** Mã hàm đọc. */
      fcRead: number;
      /** Mã hàm ghi một và nhiều; rỗng với vùng chỉ đọc (DI, IR). */
      fcWrite: number[];
      /** Offset gửi đi (0–65535). */
      offset: number;
      /** Số thanh ghi chiếm (bit của C/DI và bit trong thanh ghi tính 1). */
      registers: number;
      /** Chỉ số bit trong thanh ghi (0–15), hoặc null. */
      bit: number | null;
      warnings: string[];
    }
  | { ok: false; error: AddressErrorCode };

const AREAS: Readonly<Record<Area, { fcRead: number; fcWrite: number[] }>> = {
  C: { fcRead: 1, fcWrite: [5, 15] },
  DI: { fcRead: 2, fcWrite: [] },
  IR: { fcRead: 4, fcWrite: [] },
  HR: { fcRead: 3, fcWrite: [6, 16] },
};
const MODICON: Readonly<Record<string, Area>> = { '0': 'C', '1': 'DI', '3': 'IR', '4': 'HR' };
const REGS: Readonly<Record<string, number>> = {
  INT16: 1,
  UINT16: 1,
  INT32: 2,
  UINT32: 2,
  FLOAT32: 2,
  INT64: 4,
  UINT64: 4,
  FLOAT64: 4,
};

/** Số thanh ghi Tag chiếm (không tính C/DI, 1 bit). */
export function registerCount(rawType: TagDataType, stringLength?: number): number {
  if (rawType === 'STRING') return Math.ceil((stringLength ?? 0) / 2);
  if (rawType === 'BOOL') return 1;
  return REGS[rawType]!;
}

export function parseAddress(address: string, opts: AddressOptions): AddressResult {
  const up = address.toUpperCase();
  let area: Area;
  let number: number;
  let bitText: string | undefined;
  let modicon = false;
  let m = /^(C|DI|IR|HR)([0-9]{1,5})(?:\.([0-9]{1,2}))?$/.exec(up);
  if (m) {
    area = m[1] as Area;
    number = Number(m[2]);
    bitText = m[3];
  } else {
    m = /^([0134])([0-9]{4,5})(?:\.([0-9]{1,2}))?$/.exec(up);
    if (!m) return { ok: false, error: 'E_ADDR_SYNTAX' };
    area = MODICON[m[1]!]!;
    number = Number(m[2]);
    bitText = m[3];
    modicon = true;
  }
  const bit = bitText === undefined ? null : Number(bitText);
  if (bit !== null && bit > 15) return { ok: false, error: 'E_ADDR_SYNTAX' };

  const { rawType } = opts;
  const bitArea = area === 'IR' || area === 'HR';
  if (bit !== null) {
    if (!bitArea || rawType !== 'BOOL') return { ok: false, error: 'E_ADDR_AREA' };
  } else if (area === 'C' || area === 'DI') {
    if (rawType !== 'BOOL') return { ok: false, error: 'E_ADDR_AREA' };
  } else if (rawType === 'BOOL') return { ok: false, error: 'E_ADDR_AREA' };
  if ((opts.access ?? 'R') === 'RW' && (area === 'DI' || area === 'IR'))
    return { ok: false, error: 'E_ADDR_AREA' };

  const offset = number - opts.addressBase;
  const registers = area === 'C' || area === 'DI' ? 1 : registerCount(rawType, opts.stringLength);
  if (offset < 0 || offset > 65535 || offset + registers > 65536)
    return { ok: false, error: 'E_ADDR_RANGE' };

  const warnings = modicon && opts.addressBase === 0 ? ['W_ADDR_MODICON_BASE0'] : [];
  return {
    ok: true,
    normalized: up,
    area,
    fcRead: AREAS[area].fcRead,
    fcWrite: [...AREAS[area].fcWrite],
    offset,
    registers,
    bit,
    warnings,
  };
}
