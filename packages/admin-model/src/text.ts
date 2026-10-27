// Chuỗi tiếng Việt mà logic dùng chung cần (feature 027): tên vai trò, nhãn người nhận của quy tắc, thời gian tương đối,
// lỗi của cấu hình email. Trang Quản trị web (`vi-admin.ts`) và Studio cùng dùng các chuỗi này, không chép.
export const ROLE_NAMES: Readonly<Record<string, string>> = {
  viewer: 'Người xem',
  operator: 'Vận hành',
  engineer: 'Kỹ sư',
  administrator: 'Quản trị viên',
};

export const adminText = {
  grantees: {
    all: 'Mọi người',
    allHint: 'mọi người đã đăng nhập',
    role: (r: string) => `Vai trò ${ROLE_NAMES[r] ?? r}+`,
    roleShort: (r: string) => `${ROLE_NAMES[r] ?? r}+`,
    group: (n: string) => `Nhóm ${n}`,
    user: (n: string) => `Người dùng ${n}`,
    catAll: 'Chung',
    catRoles: 'Vai trò',
    catGroups: 'Nhóm',
    catUsers: 'Người dùng',
    nobody: 'Không ai (trừ quản trị viên)',
  },
  neverLogin: 'chưa đăng nhập',
  time: {
    now: 'vừa xong',
    minutes: (n: number) => `${n} phút trước`,
    hours: (n: number) => `${n} giờ trước`,
    days: (n: number) => `${n} ngày trước`,
  },
  errors: {
    LAST_ADMIN: 'Phải còn ít nhất một quản trị viên đang bật.',
    REAUTH_REQUIRED: 'Mật khẩu xác nhận không đúng.',
    RATE_LIMITED: 'Thao tác quá nhanh (tối đa 30 lần mỗi phút). Chờ một chút rồi thử lại.',
    EXISTS: 'Tên đã có, chọn tên khác.',
    NOT_FOUND: 'Không tìm thấy (có thể đã bị xóa bởi người khác).',
    FORBIDDEN: 'Tài khoản của bạn không còn quyền quản trị.',
    ACCESS_DENIED: 'Không có quyền.',
    STORE_INVALID: 'Kho quyền bị hỏng: khôi phục bản trước rồi thử lại.',
    BAD_REQUEST: 'Dữ liệu gửi đi không hợp lệ.',
    NETWORK: 'Không kết nối được tới thiết bị.',
    AUDIT_UNAVAILABLE: 'Thiết bị chưa ghi được nhật ký kiểm toán, thử lại sau.',
    APIKEY_LIMIT: 'Đã có 32 API key: thu hồi bớt key không dùng rồi tạo lại.',
    APIKEY_STORE: 'Kho API key trên thiết bị bị hỏng: mọi key đang bị từ chối.',
    unknown: (code: string, message?: string) =>
      message ? `${message} (${code})` : `Thao tác không thành công (${code})`,
    weak: 'Mật khẩu chưa đạt quy tắc',
  },
  emailBad: {
    host: 'Cần máy chủ SMTP và địa chỉ gửi khi bật email',
    address: (a: string) => `Địa chỉ không hợp lệ: ${a}`,
    rule: (n: number) => `Quy tắc ${n} cần ít nhất một địa chỉ hoặc một nhóm`,
  },
};

/** Lý do mật khẩu yếu (`reason` của WEAK_PASSWORD) thành phần đuôi câu. */
export function weakReason(reason?: string, message?: string): string {
  switch (reason) {
    case 'TOO_SHORT':
      return ': cần ít nhất 15 ký tự';
    case 'TOO_LONG':
      return ': tối đa 128 ký tự';
    case 'SAME_AS_NAME':
    case 'CONTAINS_NAME':
      return ': không được chứa tên tài khoản';
    case 'COMMON':
      return ': mật khẩu quá phổ biến';
    default:
      return message ? `: ${message}` : reason ? ` (${reason})` : '';
  }
}
