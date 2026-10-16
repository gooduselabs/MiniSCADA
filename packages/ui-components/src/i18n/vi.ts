// Chuỗi giao diện chung của widget hiển thị (trạng thái, quality, biểu đồ). Chuỗi điều khiển nằm ở control-vi.ts.
import type { Quality } from '../host/types.ts';

export const vi = {
  on: 'Bật',
  off: 'Tắt',
  noValue: '—',
  unknownValue: '?',
  quality: {
    GOOD: 'Tốt',
    UNCERTAIN: 'Không chắc',
    BAD: 'Lỗi',
    STALE: 'Mất dữ liệu',
    UNKNOWN: 'Tag lạ với thiết bị',
  } satisfies Record<Quality, string>,
  qualityBadge: {
    GOOD: '',
    UNCERTAIN: '●',
    BAD: 'BAD',
    STALE: 'STALE',
    UNKNOWN: '?',
  } satisfies Record<Quality, string>,
  reason: {
    TIMEOUT: 'Hết thời gian chờ thiết bị',
    CLAMPED: 'Giá trị bị cắt về giới hạn',
    CONNECTION_BAD: 'Mất kết nối thiết bị',
    DEVICE_ERROR: 'Thiết bị báo lỗi',
    NOT_CONNECTED: 'Chưa kết nối thiết bị',
    DISCONNECTED: 'Mất kết nối dữ liệu',
    SIM: 'Giá trị mô phỏng',
  } as Record<string, string>,
  screen: {
    unsupportedWidget: 'Widget không hỗ trợ',
    popupClose: 'Đóng',
    popupLabel: 'Hộp thoại',
    unknownItem: 'Item không hợp lệ',
    svgFailed: 'Không tải được đồ họa',
    /** Faceplate: Tag sau khi thay `{param}` không có trong project (FR-125). */
    tagMissing: 'Tag không có',
  },
  chart: {
    noTag: 'không có Tag',
    loadFailed: 'Không tải được biểu đồ',
    negative: 'âm',
    noData: 'Không có dữ liệu',
    excluded: 'bị loại',
    total: 'Tổng',
    realtime: 'thời gian thực',
    seriesTable: 'Dữ liệu biểu đồ',
    series: 'Đường',
    value: 'Giá trị',
    time: 'Thời điểm',
    percent: 'Phần trăm',
    cursorHint: 'Di chuột để đọc giá trị',
  },
  table: {
    label: 'Tag',
    value: 'Giá trị',
    unit: 'Đơn vị',
    quality: 'Chất lượng',
    updated: 'Cập nhật',
    sortAsc: 'tăng dần',
    sortDesc: 'giảm dần',
    sortBy: 'Sắp xếp theo',
    empty: 'Không có Tag',
  },
  widget: {
    card: 'Thẻ',
    label: 'Nhãn',
    lamp: 'Đèn',
    gauge: 'Đồng hồ',
    level: 'Mức',
    panel: 'Khung',
    line: 'Biểu đồ đường',
    bar: 'Biểu đồ cột',
    pie: 'Biểu đồ tròn',
    'tag-table': 'Bảng Tag',
    'alarm-list': 'Bảng alarm',
    'alarm-count': 'Số alarm',
  } as Record<string, string>,
} as const;

/** Chữ cho mã lý do của 006; mã lạ hiện nguyên mã. */
export function qualityReasonText(code: string): string {
  return vi.reason[code] ?? code;
}
