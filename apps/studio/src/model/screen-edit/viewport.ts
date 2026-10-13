// Viewport của canvas Màn hình: zoom/pan và đổi tọa độ màn hình ↔ thiết kế (feature 007, T097).
// Hàm thuần, không DOM. Quy ước: `màn hình = thiết kế × zoom + pan` (pan là điểm ảnh màn hình).

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Area {
  width: number;
  height: number;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;
export const WHEEL_STEP = 1.1;

/** Zoom lưu tới 4 chữ số thập phân để các bước nhân không tích lũy sai số. */
const roundZoom = (z: number): number => Math.round(z * 1e4) / 1e4;
export const clampZoom = (z: number): number =>
  roundZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1)));

export const toScreen = (v: Viewport, p: Pt): Pt => ({
  x: p.x * v.zoom + v.panX,
  y: p.y * v.zoom + v.panY,
});
export const toDesign = (v: Viewport, p: Pt): Pt => ({
  x: (p.x - v.panX) / v.zoom,
  y: (p.y - v.panY) / v.zoom,
});

/** Nhân zoom với `factor` quanh điểm màn hình `anchor`; pan làm tròn về điểm ảnh nguyên. */
export function zoomAt(v: Viewport, factor: number, anchor: Pt): Viewport {
  const zoom = clampZoom(v.zoom * factor);
  if (zoom === v.zoom) return v;
  const d = toDesign(v, anchor);
  return {
    zoom,
    panX: Math.round(anchor.x - d.x * zoom),
    panY: Math.round(anchor.y - d.y * zoom),
  };
}
export const zoomIn = (v: Viewport, anchor: Pt): Viewport => zoomAt(v, ZOOM_STEP, anchor);
export const zoomOut = (v: Viewport, anchor: Pt): Viewport => zoomAt(v, 1 / ZOOM_STEP, anchor);

/** Đặt zoom tuyệt đối (phím `1`: 100 %). */
export const zoomTo = (v: Viewport, zoom: number, anchor: Pt): Viewport =>
  zoomAt(v, clampZoom(zoom) / v.zoom, anchor);

/** Ctrl+lăn chuột: `deltaY < 0` phóng to ×1,1; `> 0` thu nhỏ; 0 giữ nguyên. */
export function zoomWheel(v: Viewport, deltaY: number, anchor: Pt): Viewport {
  if (deltaY === 0) return v;
  return zoomAt(v, deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, anchor);
}

export const panBy = (v: Viewport, dx: number, dy: number): Viewport => ({
  zoom: v.zoom,
  panX: Math.round(v.panX + dx),
  panY: Math.round(v.panY + dy),
});

export const zoomPercent = (v: Viewport): number => Math.round(v.zoom * 100);

/** "Vừa khung": zoom lớn nhất (làm tròn xuống) để cả `size` nằm trong `area` trừ lề, căn giữa. */
export function fitViewport(area: Area, size: Area, margin = 0): Viewport {
  const aw = Math.max(0, area.width - 2 * margin);
  const ah = Math.max(0, area.height - 2 * margin);
  const raw = Math.min(aw / size.width, ah / size.height);
  const zoom = clampZoom(Math.floor(raw * 1e4) / 1e4);
  return {
    zoom,
    panX: Math.round(margin + (aw - size.width * zoom) / 2),
    panY: Math.round(margin + (ah - size.height * zoom) / 2),
  };
}
