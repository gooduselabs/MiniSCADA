// Định dạng giờ địa phương của nhóm cho widget lịch sử (số dùng formatValue/fixed như các widget khác). Không dùng `Date` cục bộ: dịch ms theo độ lệch
// `±HH:MM` của nhóm rồi đọc bằng getter UTC. (Hàm thuần của history-math thay cho file này khi gói đó xuất đủ;
// hợp đồng giữ nguyên: tz là chuỗi `±HH:MM`.)
import { tzOffsetMs } from './history-plot.ts';

const p2 = (n: number) => String(n).padStart(2, '0');

/** `dd/MM/yyyy HH:mm:ss` theo giờ địa phương của nhóm. */
export function localTime(ms: number, tz: string): string {
  const d = new Date(ms + tzOffsetMs(tz));
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

/** Nhãn trục: giờ khi khoảng ≤ 2 ngày (kèm ngày lúc nửa đêm), ngày/tháng khi dài hơn. */
export function axisTime(ms: number, spanMs: number, tz: string): string {
  const d = new Date(ms + tzOffsetMs(tz));
  const hm = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
  if (spanMs <= 5 * 60_000) return `${hm}:${p2(d.getUTCSeconds())}`;
  if (spanMs <= 2 * 86_400_000) {
    return d.getUTCHours() === 0 && d.getUTCMinutes() === 0
      ? `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}`
      : hm;
  }
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}`;
}

/** `dd/MM/yyyy HH:mm:ss.SSS` theo giờ địa phương của nhóm. */
export function localTimeMs(ms: number, tz: string): string {
  return `${localTime(ms, tz)}.${String(((ms % 1000) + 1000) % 1000).padStart(3, '0')}`;
}
