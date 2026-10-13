// Định dạng giờ địa phương của nhóm và số vi-VN cho widget lịch sử. Không dùng `Date` cục bộ: dịch ms theo độ lệch
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

const nf = new Map<number, Intl.NumberFormat>();
/** Số kiểu vi-VN (nghìn `.`, thập phân `,`) với tối đa `decimals` chữ số lẻ. */
export function num(v: number, decimals = 2): string {
  let f = nf.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: decimals });
    nf.set(decimals, f);
  }
  return f.format(v);
}
