// Ước tính thời gian một vòng quét của kênh Modbus RTU (W_RTU_SCAN_TIME; contracts/project-format-0.2.md §7.2)
// và gộp yêu cầu đọc (contracts/modbus-driver.md §7). Hàm thuần.

export interface Span {
  /** Chỉ số đầu (gồm). */
  start: number;
  /** Chỉ số cuối (không gồm). */
  end: number;
}

/**
 * Gộp các khoảng của một (thiết bị trường, vùng, nhóm quét) thành khối đọc:
 * sắp theo (đầu, cuối); gộp khoảng kế tiếp khi khe trống <= maxGap và độ dài khối <= maxLen.
 */
export function planBlocks(ranges: readonly Span[], maxGap: number, maxLen: number): Span[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks: Span[] = [];
  for (const r of sorted) {
    const last = blocks[blocks.length - 1];
    if (last && r.start - last.end <= maxGap && Math.max(last.end, r.end) - last.start <= maxLen)
      last.end = Math.max(last.end, r.end);
    else blocks.push({ start: r.start, end: r.end });
  }
  return blocks;
}

export interface SerialFormat {
  baud: number;
  dataBits: number;
  parity: 'none' | 'even' | 'odd';
  stopBits: number;
}

/** Số bit mỗi ký tự: 1 (start) + bit dữ liệu + parity (nếu có) + bit stop. */
export const charBits = (f: SerialFormat): number =>
  1 + f.dataBits + (f.parity === 'none' ? 0 : 1) + f.stopBits;

/** Khoảng lặng 3,5 ký tự (ms); từ trên 19.200 baud cố định 1,75 ms. */
export const t35Ms = (f: SerialFormat): number =>
  f.baud <= 19200 ? (3.5 * charBits(f) * 1000) / f.baud : 1.75;

/**
 * Thời gian một yêu cầu đọc (ms): (byte yêu cầu + byte trả lời) x bit mỗi ký tự / tốc độ + 2 x t3.5 + 10 ms
 * (thời gian thiết bị trường xử lý, ước tính). Yêu cầu 8 byte (địa chỉ, 5 byte PDU, CRC);
 * trả lời 5 + n byte với n là số byte dữ liệu.
 */
export function requestTimeMs(f: SerialFormat, dataBytes: number): number {
  const bytes = 8 + (5 + dataBytes);
  return (bytes * charBits(f) * 1000) / f.baud + 2 * t35Ms(f) + 10;
}

/** Số byte dữ liệu của một khối: 2 x thanh ghi, hoặc ⌈bit / 8⌉. */
export const blockDataBytes = (area: 'C' | 'DI' | 'IR' | 'HR', size: number): number =>
  area === 'C' || area === 'DI' ? Math.ceil(size / 8) : 2 * size;
