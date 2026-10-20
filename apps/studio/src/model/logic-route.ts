// Đường đi của dây hành động trên sơ đồ Logic (feature 015): luật → mục Ghi PLC / Tag đích. Hàm thuần.
// Mặc định gấp khúc trong khe ngay trước nút đích (khe giữa cột luật và cột Ghi PLC trống). Khi đoạn ngang đi qua khối khác
// (cột luật gập thành nhiều cột phụ) thì đi vòng: ra khe bên phải luật, lên (xuống) kênh ngoài mọi khối, sang khe trước đích,
// rồi vào đích. Mỗi dây vòng một làn riêng để không chồng nhau. Góc bo.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Khoảng cách từ đường dọc tới mép nút đích (px). */
export const ROUTE_INSET = 22;
const LANE = 7;

/** Đường gấp khúc qua các điểm, góc bo `r`. */
export function roundedPath(pts: ReadonlyArray<readonly [number, number]>, r = 6): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1]!;
    const [x, y] = pts[i]!;
    const [nx, ny] = pts[i + 1]!;
    const l1 = Math.hypot(x - px, y - py);
    const l2 = Math.hypot(nx - x, ny - y);
    const k = Math.min(r, l1 / 2, l2 / 2);
    if (k < 0.5) {
      d += `L${x} ${y}`;
      continue;
    }
    const ax = x - ((x - px) / l1) * k;
    const ay = y - ((y - py) / l1) * k;
    const bx = x + ((nx - x) / l2) * k;
    const by = y + ((ny - y) / l2) * k;
    d += `L${ax} ${ay}Q${x} ${y} ${bx} ${by}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d}L${last[0]} ${last[1]}`;
}

/** Đoạn ngang tại `y` từ `xa` tới `xb` cắt một khối (trừ mép). */
function crosses(y: number, xa: number, xb: number, rects: readonly Rect[]): boolean {
  const lo = Math.min(xa, xb) + 1;
  const hi = Math.max(xa, xb) - 1;
  return rects.some((r) => y > r.y - 2 && y < r.y + r.h + 2 && r.x < hi && r.x + r.w > lo);
}

/**
 * Điểm của dây hành động từ (x1, y1) tới (x2, y2); null khi đích ở bên trái (dùng đường cong thường). `obstacles`: các nút
 * khác (không gồm nguồn và đích); `bounds`: khung bao sơ đồ; `lane`: số thứ tự của dây vòng (0, 1, …).
 */
export function actionRoute(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: readonly Rect[],
  bounds: Rect,
  lane: number,
): { points: Array<[number, number]>; detour: boolean } | null {
  if (x2 < x1 + 40) return null;
  const xm = x2 - ROUTE_INSET;
  if (!crosses(y1, x1, xm, obstacles))
    return {
      points: [
        [x1, y1],
        [xm, y1],
        [xm, y2],
        [x2, y2],
      ],
      detour: false,
    };
  const xa = x1 + 18 + (lane % 4) * 4;
  const top = bounds.y - 18 - lane * LANE;
  const bottom = bounds.y + bounds.h + 18 + lane * LANE;
  const mid = (y1 + y2) / 2;
  const yc = mid - top < bottom - mid ? top : bottom;
  return {
    points: [
      [x1, y1],
      [xa, y1],
      [xa, yc],
      [xm, yc],
      [xm, y2],
      [x2, y2],
    ],
    detour: true,
  };
}
