// Hình chữ nhật cắt của `geometry.clipLevel` (contract binding-animation §4.3): hàm thuần theo hộp bao cục bộ.
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LevelDirection = 'up' | 'down' | 'left' | 'right';

const round2 = (n: number): number => Math.round(n * 100) / 100 || 0;

/** `percent` kẹp [0, 100]; kết quả làm tròn 2 chữ số thập phân (như `levelPercent` của 0.2). */
export function clipRect(bbox: Box, direction: LevelDirection, percent: number): Box {
  const p = Math.min(100, Math.max(0, percent)) / 100;
  const { x, y, width, height } = bbox;
  switch (direction) {
    case 'up':
      return {
        x: round2(x),
        y: round2(y + height * (1 - p)),
        width: round2(width),
        height: round2(height * p),
      };
    case 'down':
      return { x: round2(x), y: round2(y), width: round2(width), height: round2(height * p) };
    case 'right':
      return { x: round2(x), y: round2(y), width: round2(width * p), height: round2(height) };
    case 'left':
      return {
        x: round2(x + width * (1 - p)),
        y: round2(y),
        width: round2(width * p),
        height: round2(height),
      };
  }
}
