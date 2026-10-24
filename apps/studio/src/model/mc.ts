// Phần Studio của kênh Mitsubishi MC (feature 017, US4, FR-011; specs/017-driver-mc/plan.md, contracts/mc-protocol.md §1,
// §4). Hàm thuần, không DOM: gợi ý mềm tại ô của form kênh và thiết bị trường, địa chỉ Tag MC (thông báo lỗi, ví dụ
// theo kiểu, bước tăng khi điền xuống và Thêm hàng loạt), end code của chẩn đoán (hex kèm nghĩa).
import {
  MC_DEVICES,
  MC_NUMBER_LIMIT,
  registerCount,
  type AddressErrorCode,
  type TagDataType,
} from '@mat/tag-codec';
import type { Channel, FieldDevice } from '@mat/project-schema';
import type { MessageKey } from '../i18n/index.ts';

export type McXyNotation = 'hex' | 'octal';

// ---------- Gợi ý tại ô ----------

export interface McHint {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/** Module I/O hay gặp: CPU nối trực tiếp, CPU 1–4 của hệ nhiều CPU, hệ dự phòng. */
const KNOWN_MODULE_IO = new Set([
  0x03ff, 0x03e0, 0x03e1, 0x03e2, 0x03e3, 0x03d0, 0x03d1, 0x03d2, 0x03d3,
]);

/**
 * Gợi ý mềm (không chặn) cho một trường của form MC, theo giá trị đang lưu: cổng Modbus, ASCII, UDP, trạm không khớp mạng,
 * module I/O lạ, Random Read tắt, ghi bit đọc-sửa-ghi. `null`: không có gì để nói.
 */
export function mcFieldHint(
  key: string,
  target: 'channel' | 'device',
  obj: Channel | FieldDevice,
): McHint | null {
  if (target === 'channel') {
    const c = obj as Channel;
    if (key === 'mcPort' && c.tcp?.port === 502) return { key: 'mc.hint.port502' };
    if (key === 'mcCode' && c.mc?.code === 'ascii') return { key: 'mc.hint.ascii' };
    if (key === 'mcTransport' && c.mc?.transport === 'udp') return { key: 'mc.hint.udp' };
    return null;
  }
  const d = obj as FieldDevice;
  const network = d.network ?? 0;
  const station = d.station ?? 255;
  switch (key) {
    case 'station':
      if (network === 0 && station !== 255) return { key: 'mc.hint.stationDirect' };
      if (network !== 0 && station === 255) return { key: 'mc.hint.stationRemote' };
      return null;
    case 'moduleIo':
      return KNOWN_MODULE_IO.has(d.moduleIo ?? 0x03ff) ? null : { key: 'mc.hint.moduleIo' };
    case 'maxRandomPoints':
      return d.randomRead === false ? { key: 'mc.hint.randomOff' } : null;
    case 'maxGapWords': {
      const batch = d.maxBatchWords ?? 960;
      return (d.maxGapWords ?? 16) > batch
        ? { key: 'mc.hint.gapOverBatch', params: { n: batch } }
        : null;
    }
    case 'mcRegisterBit':
      return d.write?.registerBit === 'rmw' ? { key: 'mc.hint.rmw' } : null;
    default:
      return null;
  }
}

// ---------- Địa chỉ Tag MC ----------

const ADDR_RE = /^(SM|SD|TN|CN|ZR|D|W|R|M|X|Y|B|L)([0-9A-F]+)(?:\.([0-9A-F]))?$/;

/** Khóa thông báo cho lỗi của `parseMcAddress`; X, Y có chữ số 8, 9 hay hex khi thiết bị viết bát phân: lỗi riêng. */
export function mcAddressError(
  code: AddressErrorCode,
  address: string,
  xyNotation: McXyNotation | undefined,
): MessageKey {
  if (code === 'E_ADDR_AREA') return 'tt.err.mcAddressArea';
  if (code === 'E_ADDR_RANGE') return 'tt.err.mcAddressRange';
  if (xyNotation === 'octal' && /^[XY][0-9A-F]+$/.test(address.trim().toUpperCase()))
    return 'tt.err.mcOctal';
  return 'tt.err.mcAddress';
}

/** Ví dụ địa chỉ hợp với kiểu của Tag (dòng gợi ý của ô địa chỉ). */
export function mcExamples(rawType: TagDataType | undefined, xyNotation?: McXyNotation): string[] {
  const x = xyNotation === 'octal' ? 'X17' : 'X1F';
  if (rawType === 'BOOL') return ['M10', x, 'Y20', 'D100.5', 'B1A', 'SM400'];
  return ['D100', 'W1A', 'R200', 'ZR1000', 'TN5', 'SD8000'];
}

const isBitDevice = (dev: string): boolean =>
  (MC_DEVICES as Record<string, { bit: boolean }>)[dev]?.bit === true;

/** Số đơn vị địa chỉ một Tag MC chiếm: thiết bị bit và bit trong word là 1, word theo kiểu. */
export function mcDefaultStep(
  address: string,
  type: TagDataType | undefined,
  stringLength?: number,
): number {
  const m = ADDR_RE.exec(address.trim().toUpperCase());
  if (!m || m[3] !== undefined || isBitDevice(m[1]) || !type) return 1;
  return registerCount(type, stringLength) || 1;
}

/**
 * Địa chỉ MC sau `steps` bước `per`: giữ cơ số của thiết bị (X, Y, B, W hex; X, Y bát phân khi `octal`) và độ dài chữ số;
 * bit trong word tăng chỉ số bit (0–F). Ra ngoài giới hạn hay không đọc được thì `undefined`.
 */
export function mcStepAddress(
  address: string,
  per: number,
  steps: number,
  xyNotation?: McXyNotation,
): string | undefined {
  const m = ADDR_RE.exec(address.trim().toUpperCase());
  if (!m) return undefined;
  const [, dev, digits, bit] = m;
  if (bit !== undefined) {
    const b = parseInt(bit, 16) + per * steps;
    return b <= 15 ? `${dev}${digits}.${b.toString(16).toUpperCase()}` : undefined;
  }
  const info = (MC_DEVICES as Record<string, { radix: number }>)[dev]!;
  const radix = xyNotation === 'octal' && (dev === 'X' || dev === 'Y') ? 8 : info.radix;
  const n = parseInt(digits, radix);
  if (Number.isNaN(n)) return undefined;
  const next = n + per * steps;
  if (next >= MC_NUMBER_LIMIT) return undefined;
  return `${dev}${next.toString(radix).toUpperCase().padStart(digits.length, '0')}`;
}

// ---------- End code của chẩn đoán (contracts/mc-protocol.md §4) ----------

export type McEndReason = 'MC_END_RANGE' | 'MC_END_DEVICE' | 'MC_END_COMMAND' | 'MC_END_OTHER';

const RANGE = new Set([0xc051, 0xc052, 0xc053, 0xc054, 0xc056, 0x4030, 0x4031]);
const DEVICE = new Set([0xc05b, 0xc05c, 0xc060]);
const COMMAND = new Set([0xc050, 0xc058, 0xc059, 0xc05f, 0xc061, 0xc06f]);

/** Nhóm lý do của một end code (cùng bảng với driver C++). */
export function mcEndReason(code: number): McEndReason {
  if (RANGE.has(code)) return 'MC_END_RANGE';
  if (DEVICE.has(code)) return 'MC_END_DEVICE';
  if (COMMAND.has(code)) return 'MC_END_COMMAND';
  return 'MC_END_OTHER';
}

/**
 * Khóa của bộ đếm `exceptions` của thiết bị MC (end code, 4 chữ hex như thiết bị trả: `"C056"`) → hex in hoa và
 * nhóm lý do: `"C056"` → MC_END_RANGE. Khóa khác dạng thì giữ nguyên chữ, nhóm khác.
 */
export function mcEndCode(key: string): { hex: string; reason: McEndReason } {
  const hex = key.toUpperCase();
  if (!/^[0-9A-F]{4}$/.test(hex)) return { hex, reason: 'MC_END_OTHER' };
  return { hex, reason: mcEndReason(parseInt(hex, 16)) };
}
