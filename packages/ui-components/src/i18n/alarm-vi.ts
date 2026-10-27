// Chuỗi giao diện alarm dùng chung (bảng, widget; feature 009, contracts/ui-alarm.md §14). Trang runtime và Studio
// import lại từ đây để một chữ chỉ có một nơi khai báo. Không chuỗi cứng trong mã (FR-067, SC-024).
import type {
  AlarmAckResultCode,
  AlarmPriority,
  AlarmSourceStatus,
  AlarmState,
} from '../host/types.ts';

export const alarmVi = {
  // feature 029: tìm kiếm và xuất CSV của widget alarm-list
  listSearch: 'Tìm alarm',
  listExportCsv: 'Xuất CSV',
  csvHead: ['Thời điểm', 'Ưu tiên', 'Khu vực', 'Tên', 'Nội dung', 'Giá trị', 'Trạng thái'],
  priority: {
    critical: 'Khẩn cấp',
    major: 'Quan trọng',
    minor: 'Nhỏ',
    advisory: 'Lưu ý',
  } satisfies Record<AlarmPriority, string>,
  state: {
    ACTIVE_UNACK: 'Đang có, chưa xác nhận',
    ACTIVE_ACK: 'Đang có, đã xác nhận',
    RTN_UNACK: 'Đã hết, chưa xác nhận',
    NORMAL: 'Bình thường',
    shelved: 'Tạm ẩn',
    disabled: 'Vô hiệu',
    inputBad: 'đầu vào BAD',
  } satisfies Record<AlarmState | 'shelved' | 'disabled' | 'inputBad', string>,
  col: {
    time: 'Thời gian bật',
    priority: 'Ưu tiên',
    area: 'Khu vực',
    text: 'Nội dung',
    value: 'Giá trị lúc bật',
    state: 'Trạng thái',
    ackUser: 'Người xác nhận',
    remaining: 'Còn lại',
  },
  areaGeneral: 'Chung',
  clockUnsynced: 'giờ chưa đồng bộ',
  tableLabel: 'Danh sách alarm',
  sortBy: 'Sắp xếp theo',
  selectRow: (name: string) => `Chọn alarm ${name}`,
  selectAll: 'Chọn tất cả alarm đang hiện',
  actions: 'Thao tác',
  more: (n: number) => `và ${n} alarm nữa`,
  empty: 'Không có alarm',
  emptyNoSource: 'Không có dữ liệu alarm',
  emptyNoConfig: 'Không có alarm cấu hình',
  emptyShelved: 'Không có alarm nào đang tạm ẩn',
  unsupported: 'Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)',
  staleNote: 'Mất kết nối tới thiết bị: danh sách alarm có thể đã cũ',
  ack: 'Xác nhận',
  ackAll: 'Xác nhận tất cả',
  ackSending: 'Đang gửi…',
  shelve: 'Tạm ẩn…',
  unshelve: 'Gỡ tạm ẩn',
  ackResult: {
    ACKED: 'Đã xác nhận',
    ALREADY_ACKED: 'Đã được xác nhận',
    NOT_ACTIVE: 'Alarm đã hết',
    STALE: 'Alarm đã bật lại lần mới, xem lại trước khi xác nhận',
    SHELVED: 'Alarm đang tạm ẩn',
    NOT_FOUND: 'Alarm không còn trong project',
  } satisfies Record<AlarmAckResultCode, string>,
  skippedNewer: (n: number) => `${n} alarm mới bật chưa được xác nhận`,
  lock: {
    NO_SESSION: 'Cần đăng nhập với role operator',
    ROLE: 'Cần đăng nhập với role operator',
    LIVE_LOST: 'Mất kết nối tới thiết bị',
    SHELVED: 'Alarm đang tạm ẩn',
    NOTHING: 'Không có alarm nào để xác nhận',
    READ_ONLY: 'Chỉ xem: không xác nhận được ở chế độ này',
  },
  err: {
    AUDIT_UNAVAILABLE:
      'Thiết bị không ghi được nhật ký kiểm toán nên chưa xác nhận được. Thử lại hoặc báo quản trị viên',
    RATE_LIMITED: (retryAfterMs?: number) =>
      `Thao tác quá nhanh, thử lại sau ${Math.max(1, Math.ceil((retryAfterMs ?? 1000) / 1000))} giây`,
    SHELVE_RANGE: 'Lý do 1 đến 120 ký tự; thời gian từ 1 phút đến 8 giờ; tối đa 50 alarm tạm ẩn',
    ALARM_DISABLED: 'Alarm đang bị vô hiệu',
    NETWORK: 'Không gửi được tới thiết bị. Kiểm tra trạng thái rồi thử lại',
    SESSION_EXPIRED: 'Phiên đã hết hạn, đăng nhập lại',
    FORBIDDEN: 'Cần đăng nhập với role operator',
    READ_ONLY: 'Chỉ xem: không xác nhận được ở chế độ này',
    STALE: 'Dữ liệu alarm đã thay đổi, xem lại danh sách rồi thử lại',
    unknown: (code: string) => `Không thực hiện được (${code})`,
  },
  widget: {
    list: 'Bảng alarm',
    count: 'Số alarm',
    countUnacked: (n: number) => `${n} alarm chưa xác nhận`,
    countActive: (n: number) => `${n} alarm đang có`,
  },
} as const;

/** Chữ cho trạng thái nguồn khi bảng không có hàng; `null` khi nguồn bình thường. */
export function alarmStatusNote(status: AlarmSourceStatus): string | null {
  switch (status) {
    case 'unsupported':
      return alarmVi.unsupported;
    case 'stale':
    case 'offline':
      return alarmVi.staleNote;
    default:
      return null;
  }
}

/** Chữ cho lỗi của một thao tác alarm: câu của bảng chuỗi theo mã; mã lạ thì câu thiết bị gửi, hoặc mã. */
export function alarmErrorText(e: {
  code: string;
  message?: string;
  retryAfterMs?: number;
}): string {
  switch (e.code) {
    case 'AUDIT_UNAVAILABLE':
      return alarmVi.err.AUDIT_UNAVAILABLE;
    case 'RATE_LIMITED':
      return alarmVi.err.RATE_LIMITED(e.retryAfterMs);
    case 'SHELVE_RANGE':
      return alarmVi.err.SHELVE_RANGE;
    case 'ALARM_DISABLED':
      return alarmVi.err.ALARM_DISABLED;
    case 'NETWORK':
      return alarmVi.err.NETWORK;
    case 'SESSION_EXPIRED':
      return alarmVi.err.SESSION_EXPIRED;
    case 'FORBIDDEN':
      return alarmVi.err.FORBIDDEN;
    case 'READ_ONLY':
      return alarmVi.err.READ_ONLY;
    case 'STALE':
      return alarmVi.err.STALE;
    default:
      return e.message || alarmVi.err.unknown(e.code);
  }
}
