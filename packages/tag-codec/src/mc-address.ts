// Địa chỉ Mitsubishi MC (SLMP) của Tag ngoài (feature 017, specs/017-driver-mc/plan.md "Địa chỉ Tag MC";
// contracts/mc-protocol.md §1). Cùng vector tests/mc-vectors/address.json với drivers/mc (C++).
//
//   address = device number [ "." bit ]
//   device  = SM / SD / TN / CN / ZR / D / W / R / M / X / Y / B / L
//   number  = 1*8 DIGIT (thập phân) / 1*6 HEXDIG (X, Y, B, W) / 1*8 bát phân (X, Y khi xyNotation octal)
//   bit     = HEXDIG (0-F), chỉ thiết bị word và rawType BOOL
//
// Chữ thường đổi thành chữ hoa; không cắt khoảng trắng.
import type { AddressErrorCode } from './address.ts';
import { registerCount } from './address.ts';
import type { TagDataType } from './types.ts';

export type McDevice =
  'SM' | 'SD' | 'TN' | 'CN' | 'ZR' | 'D' | 'W' | 'R' | 'M' | 'X' | 'Y' | 'B' | 'L';

interface McDeviceInfo {
  code: number;
  bit: boolean;
  radix: 10 | 16;
}

/** Bảng thiết bị của hợp đồng §1: mã binary, thiết bị bit, cơ số khi viết địa chỉ. */
export const MC_DEVICES: Readonly<Record<McDevice, McDeviceInfo>> = {
  SM: { code: 0x91, bit: true, radix: 10 },
  SD: { code: 0xa9, bit: false, radix: 10 },
  X: { code: 0x9c, bit: true, radix: 16 },
  Y: { code: 0x9d, bit: true, radix: 16 },
  M: { code: 0x90, bit: true, radix: 10 },
  L: { code: 0x92, bit: true, radix: 10 },
  B: { code: 0xa0, bit: true, radix: 16 },
  D: { code: 0xa8, bit: false, radix: 10 },
  W: { code: 0xb4, bit: false, radix: 16 },
  TN: { code: 0xc2, bit: false, radix: 10 },
  CN: { code: 0xc5, bit: false, radix: 10 },
  R: { code: 0xaf, bit: false, radix: 10 },
  ZR: { code: 0xb0, bit: false, radix: 10 },
};

/** Số thiết bị tối đa + 1 (3 byte trên dây). */
export const MC_NUMBER_LIMIT = 0x1000000;

export interface McAddressOptions {
  rawType: TagDataType;
  stringLength?: number;
  access?: 'R' | 'RW';
  /** Cách viết X, Y của thiết bị trường (FX5/iQ-F: octal). */
  xyNotation?: 'hex' | 'octal';
}

export type McAddressResult =
  | {
      ok: true;
      normalized: string;
      device: McDevice;
      /** Mã thiết bị binary. */
      code: number;
      bitDevice: boolean;
      number: number;
      /** Số word trên dây (thiết bị bit: 1 điểm). */
      words: number;
      bit: number | null;
    }
  | { ok: false; error: AddressErrorCode };

const RE = /^(SM|SD|TN|CN|ZR|D|W|R|M|X|Y|B|L)([0-9A-F]+)(?:\.([0-9A-F]))?$/;

export function parseMcAddress(address: string, opts: McAddressOptions): McAddressResult {
  const up = address.toUpperCase();
  const m = RE.exec(up);
  if (!m) return { ok: false, error: 'E_ADDR_SYNTAX' };
  const device = m[1] as McDevice;
  const digits = m[2]!;
  const info = MC_DEVICES[device];
  const octal = opts.xyNotation === 'octal' && (device === 'X' || device === 'Y');
  const radix = octal ? 8 : info.radix;
  const digitRe = radix === 16 ? /^[0-9A-F]{1,6}$/ : radix === 8 ? /^[0-7]{1,8}$/ : /^[0-9]{1,8}$/;
  if (!digitRe.test(digits)) return { ok: false, error: 'E_ADDR_SYNTAX' };
  const number = parseInt(digits, radix);
  const bit = m[3] === undefined ? null : parseInt(m[3], 16);

  const { rawType } = opts;
  if (info.bit) {
    if (bit !== null || rawType !== 'BOOL') return { ok: false, error: 'E_ADDR_AREA' };
  } else if (bit !== null) {
    if (rawType !== 'BOOL') return { ok: false, error: 'E_ADDR_AREA' };
  } else if (rawType === 'BOOL') return { ok: false, error: 'E_ADDR_AREA' };
  if ((opts.access ?? 'R') === 'RW' && device === 'X') return { ok: false, error: 'E_ADDR_AREA' };

  const words = info.bit || bit !== null ? 1 : registerCount(rawType, opts.stringLength);
  if (number + words > MC_NUMBER_LIMIT) return { ok: false, error: 'E_ADDR_RANGE' };
  return {
    ok: true,
    normalized: up,
    device,
    code: info.code,
    bitDevice: info.bit,
    number,
    words,
    bit,
  };
}
