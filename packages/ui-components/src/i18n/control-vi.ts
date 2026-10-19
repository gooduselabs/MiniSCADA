// Chuỗi tiếng Việt của điều khiển (FR-036, FR-037; research R9). S2 sở hữu i18n/vi.ts (chữ hiển thị chung).
import type { WriteOutcome, WriteStatus } from '../host/types.ts';

import type { LockCode } from '../control/lock-reasons.ts';

export function lockText(code: LockCode, detail?: string): string {
  switch (code) {
    case 'NO_SESSION':
      return 'Đăng nhập để điều khiển';
    case 'ROLE':
      return `Cần quyền ${detail ?? 'operator'}`;
    case 'INSECURE':
      return 'Mở bằng HTTPS để điều khiển';
    case 'HTTPS_DOWN':
      return 'HTTPS không chạy, không điều khiển được';
    case 'SESSION_EXPIRED':
      return 'Phiên đã hết hạn, đăng nhập lại';
    case 'LIVE_LOST':
      return 'Mất kết nối dữ liệu';
    case 'TAG_UNKNOWN':
      return 'Tag không có trên thiết bị';
    case 'TAG_READONLY':
      return 'Tag chỉ đọc';
    case 'QUALITY_BAD':
      return detail ? `Quality ${detail}` : 'Quality BAD';
    case 'NO_VALUE':
      return 'Chưa có giá trị';
    case 'BUSY':
      return 'Đang xử lý lệnh trước';
    case 'OTHER_DIALOG':
      return 'Đang có hộp xác nhận khác';
    case 'PROJECT_CHANGING':
      return 'Project đang thay đổi';
    case 'NO_PERMISSION':
      return 'Cần quyền thao tác';
    case 'PREVIEW':
      return 'Xem trước, không gửi lệnh';
  }
}

/** Nút hoặc phần tử SVG mở popup mà người dùng không được xem (feature 013). */
export const POPUP_NO_PERMISSION = 'Cần quyền xem cửa sổ này';

export const ROLE_LABEL: Record<string, string> = {
  viewer: 'viewer',
  operator: 'operator',
  engineer: 'engineer',
  administrator: 'administrator',
};

/** Bảng mã lý do của 006 (data-model §8) dịch sang tiếng Việt. */
const REASON_TEXT: Record<string, string> = {
  AUTH_REQUIRED: 'Cần đăng nhập',
  SESSION_EXPIRED: 'Phiên đã hết hạn',
  SESSION_INVALID: 'Phiên không hợp lệ',
  FORBIDDEN: 'Không đủ quyền',
  ACCESS_DENIED: 'Thiếu quyền thao tác',
  HTTPS_REQUIRED: 'Cần dùng HTTPS',
  NO_SUCH_TAG: 'Tag không tồn tại',
  READ_ONLY: 'Tag chỉ đọc',
  BAD_TYPE: 'Sai kiểu giá trị',
  NOT_FINITE: 'Giá trị không hữu hạn',
  OUT_OF_LIMITS: 'Ngoài giới hạn cho phép',
  OUT_OF_TYPE_RANGE: 'Ngoài dải của kiểu dữ liệu',
  OUT_OF_RAW_RANGE: 'Ngoài dải thô của thiết bị',
  STRING_TOO_LONG: 'Chuỗi quá dài',
  CONNECTION_BAD: 'Mất kết nối với thiết bị',
  DEVICE_NOT_ACTIVE: 'Thiết bị không hoạt động',
  DISABLED: 'Thiết bị bị tắt',
  RATE_LIMITED: 'Ghi quá nhanh',
  QUEUE_FULL: 'Hàng đợi ghi đầy',
  PROJECT_CHANGING: 'Project đang thay đổi',
  AUDIT_UNAVAILABLE: 'Không ghi được nhật ký kiểm toán',
  REQUEST_ID_CONFLICT: 'Mã yêu cầu bị trùng',
  STALE_EXPECTATION: 'Giá trị đã đổi so với lúc nhấn',
  WRITE_TIMEOUT: 'Thiết bị không trả lời khi ghi',
  READBACK_TIMEOUT: 'Thiết bị không trả lời khi đọc lại',
  READBACK_MISMATCH: 'Giá trị đọc lại khác giá trị đã ghi',
  READBACK_ERROR: 'Lỗi khi đọc lại',
  DEVICE_EXCEPTION: 'Thiết bị báo lỗi',
  NOT_SENT_READ_FAILED: 'Chưa gửi: đọc trước khi ghi lỗi',
  NO_READBACK: 'Đã ghi, không đọc lại',
  UNKNOWN_OUTCOME: 'Không rõ kết quả',
};

export function reasonText(code: string | undefined): string | null {
  if (!code) return null;
  if (REASON_TEXT[code]) return REASON_TEXT[code];
  if (code.startsWith('NOT_SENT_')) return 'Chưa gửi tới thiết bị';
  return null;
}

export type ResultSeverity = 'ok' | 'pending' | 'warn' | 'error';

export interface ResultView {
  severity: ResultSeverity;
  icon: string;
  /** Câu chính. */
  title: string;
  /** Lý do/mã chi tiết, hoặc rỗng. */
  detail: string;
}

const TITLES: Record<WriteStatus, { sev: ResultSeverity; icon: string; text: string }> = {
  ACCEPTED: { sev: 'pending', icon: '⏳', text: 'Đã nhận, đang chờ đọc lại' },
  CONFIRMED: { sev: 'ok', icon: '✔', text: 'Đã ghi và xác nhận' },
  REJECTED: { sev: 'error', icon: '✖', text: 'Bị từ chối' },
  TIMEOUT: {
    sev: 'warn',
    icon: '⚠',
    text: 'Không chắc đã ghi, kiểm tra giá trị thực trước khi thử lại',
  },
  FAILED: { sev: 'error', icon: '✖', text: 'Ghi thất bại' },
  UNKNOWN: { sev: 'warn', icon: '⚠', text: 'Không rõ kết quả, kiểm tra giá trị thực' },
};

export function resultView(o: WriteOutcome): ResultView {
  const t = TITLES[o.status];
  const parts: string[] = [];
  const r = reasonText(o.code);
  if (o.message) parts.push(o.message);
  else if (r) parts.push(r);
  if (o.code) parts.push(`(${o.code})`);
  if (o.retryAfterMs !== undefined && o.retryAfterMs > 0) {
    parts.push(`Thử lại sau ${Math.ceil(o.retryAfterMs / 100) / 10} s`);
  }
  return { severity: t.sev, icon: t.icon, title: t.text, detail: parts.join(' ') };
}

export const SENDING_TEXT = 'Đang gửi…';

/** Lỗi kiểm giá trị ở `propose`. */
export const VALUE_ERR = {
  decimalDot: 'Dùng dấu chấm thập phân',
  notNumber: 'Giá trị không phải số hợp lệ',
  notInteger: 'Cần số nguyên',
  notBool: 'Cần giá trị BẬT hoặc TẮT',
  notString: 'Cần chuỗi',
  tooLong: (max: number) => `Chuỗi tối đa ${max} ký tự`,
  pulseMs: 'Thời gian xung phải từ 100 đến 10000 ms',
  noTarget: 'Widget chưa gán Tag đích',
  range: (min: number | undefined, max: number | undefined) => {
    if (min !== undefined && max !== undefined) return `Ngoài giới hạn ${min}–${max}`;
    if (min !== undefined) return `Ngoài giới hạn: tối thiểu ${min}`;
    return `Ngoài giới hạn: tối đa ${max}`;
  },
} as const;

/** Chữ của hộp xác nhận. */
export const DIALOG = {
  title: 'Xác nhận ghi giá trị',
  tag: 'Tag',
  description: 'Mô tả',
  device: 'Thiết bị trường',
  value: 'Giá trị',
  unit: 'Đơn vị',
  limits: 'Giới hạn',
  account: 'Tài khoản',
  cancel: 'Hủy',
  confirm: 'Xác nhận',
  uncertain: 'Giá trị hiện tại có quality UNCERTAIN (chưa chắc chắn).',
  pulse: (ms: number) => `Xung ${ms} ms rồi trả về giá trị ngược`,
  none: '—',
  on: 'Bật',
  off: 'Tắt',
  dismiss: 'Đóng',
} as const;
