// Giao diện uPlot mới (feature 012, T045, FR-034): 12 màu và 12 kiểu nét, trục chữ theo phông token, lưới nét đứt,
// điểm con trỏ viền màu đường trên nền bề mặt, vùng tô nhạt khi chỉ một đường. Hàm thuần, dùng chung cho line và
// history-trend (history-plot.ts).
import { describe, expect, it } from 'vitest';
import { readChartTheme } from './echarts-lite.ts';
import {
  areaFill,
  axisStyle,
  clockLabels,
  cursorPoints,
  FALLBACK_SERIES_COLORS,
  SERIES_DASHES,
  singleSeriesFill,
} from './line-chart.ts';

describe('bảng màu và kiểu nét chuỗi', () => {
  it('12 màu dự phòng = 12 token --mat-chart-N của industrial (cùng nguồn với ECharts lite)', () => {
    expect(FALLBACK_SERIES_COLORS).toHaveLength(12);
    expect(new Set(FALLBACK_SERIES_COLORS).size).toBe(12);
    expect(readChartTheme(document.body).colors).toEqual(FALLBACK_SERIES_COLORS);
  });
  it('12 kiểu nét khác nhau từng đôi (phân biệt không chỉ bằng màu, FR-031)', () => {
    expect(SERIES_DASHES).toHaveLength(12);
    expect(new Set(SERIES_DASHES.map((d) => d.join(','))).size).toBe(12);
  });
});

describe('kiểu trục, lưới, con trỏ', () => {
  it('trục: chữ theo phông token, không vạch chia, lưới nét đứt mảnh', () => {
    const a = axisStyle({
      axisColor: '#56646a',
      gridColor: '#d2d9dc',
      grid: true,
      font: "'Inter Variable', sans-serif",
    });
    expect(a.stroke).toBe('#56646a');
    expect(a.font).toBe("11px 'Inter Variable', sans-serif");
    expect(a.grid).toEqual({ show: true, stroke: '#d2d9dc', width: 1, dash: [3, 3] });
    expect(a.ticks.show).toBe(false);
    expect(axisStyle({ axisColor: '#000000', gridColor: '#111111', grid: false }).grid.show).toBe(
      false,
    );
  });
  it('điểm con trỏ: viền màu đường, ruột màu bề mặt', () => {
    const p = cursorPoints(['#aa0000', '#00aa00'], '#ffffff');
    expect(p.show).toBe(true);
    expect(p.size).toBeGreaterThanOrEqual(7);
    expect(p.stroke(null, 1)).toBe('#aa0000');
    expect(p.stroke(null, 2)).toBe('#00aa00');
    expect(p.fill(null, 1)).toBe('#ffffff');
  });
  it('vùng tô: rgba từ #rrggbb; màu không hợp lệ thì không tô', () => {
    expect(areaFill('#0b7285', 0.12)).toBe('rgba(11, 114, 133, 0.12)');
    expect(areaFill('url(x)', 0.12)).toBeUndefined();
  });
  it('chỉ tô vùng khi đúng một đường hiện', () => {
    const s = (show: boolean, color = '#0b7285') => ({ color, show });
    expect(singleSeriesFill([s(true)])).toEqual(['rgba(11, 114, 133, 0.12)']);
    expect(singleSeriesFill([s(true), s(false)])).toEqual(['rgba(11, 114, 133, 0.12)', undefined]);
    expect(singleSeriesFill([s(true), s(true)])).toEqual([undefined, undefined]);
  });
});

// Trục thời gian của biểu đồ đường thời gian thực theo kiểu Việt Nam 24 giờ (T054: trước đó là mặc định của uPlot
// "10/20/26 7:04am", ":25", ":30" trên giao diện tiếng Việt).
describe('nhãn trục thời gian (clockLabels)', () => {
  const sec = (y: number, mo: number, d: number, h: number, mi: number, s = 0): number =>
    new Date(y, mo - 1, d, h, mi, s).getTime() / 1000;
  it('vạch lẻ giây: HH:mm:ss', () => {
    expect(clockLabels([sec(2026, 10, 20, 7, 4, 25), sec(2026, 10, 20, 7, 4, 30)])).toEqual([
      '07:04:25',
      '07:04:30',
    ]);
  });
  it('vạch tròn phút: HH:mm', () => {
    expect(clockLabels([sec(2026, 10, 20, 7, 0), sec(2026, 10, 20, 7, 5)])).toEqual([
      '07:00',
      '07:05',
    ]);
  });
  it('sang ngày khác: vạch đầu và vạch đổi ngày kèm dd/MM', () => {
    expect(
      clockLabels([sec(2026, 10, 19, 22, 0), sec(2026, 10, 20, 0, 0), sec(2026, 10, 20, 2, 0)]),
    ).toEqual(['19/10 22:00', '20/10 00:00', '02:00']);
  });
  it('rỗng và giá trị không hữu hạn', () => {
    expect(clockLabels([])).toEqual([]);
    expect(clockLabels([Number.NaN])).toEqual(['']);
  });
});
