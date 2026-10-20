// Chuỗi tiếng Việt của "Đổi mật khẩu của tôi" và lý do WEAK_PASSWORD (feature 013). Tải lười cùng hộp đổi mật khẩu
// và trang Quản trị: không vào gói khởi động của trang vận hành.
/** Lý do `WEAK_PASSWORD` của máy chủ (admin-api §1) → phần đuôi câu. */
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

export const viAccount = {
  pwTitle: 'Đổi mật khẩu của tôi',
  pwOld: 'Mật khẩu hiện tại',
  pwNew: 'Mật khẩu mới',
  pwRepeat: 'Nhập lại mật khẩu mới',
  pwRule: '15 đến 128 ký tự. Nên dùng một câu dễ nhớ.',
  pwCount: (n: number) => `${n} / 128 ký tự`,
  pwShort: (n: number) => `Còn thiếu ${15 - n} ký tự`,
  pwOk: 'Đủ độ dài',
  pwTooLong: 'Quá 128 ký tự',
  pwMismatch: 'Hai lần nhập mật khẩu mới không khớp',
  pwSame: 'Mật khẩu mới phải khác mật khẩu hiện tại',
  pwEmptyOld: 'Nhập mật khẩu hiện tại',
  pwSubmit: 'Đổi mật khẩu',
  pwBusy: 'Đang đổi…',
  pwCancel: 'Hủy',
  pwDone: 'Đã đổi mật khẩu. Các phiên khác của bạn đã bị đăng xuất.',
  pwClose: 'Đóng',
  pwError: (code: string, reason?: string, message?: string, retryAfterS?: number): string => {
    switch (code) {
      case 'REAUTH_REQUIRED':
        return 'Mật khẩu hiện tại không đúng';
      case 'WEAK_PASSWORD':
        return `Mật khẩu mới chưa đạt quy tắc${weakReason(reason, message)}`;
      case 'RATE_LIMITED':
        return retryAfterS
          ? `Thử quá nhiều lần, chờ ${retryAfterS} giây rồi thử lại`
          : 'Thử quá nhiều lần, chờ ít phút rồi thử lại';
      case 'AUTH_LOCKED':
        return 'Tài khoản đang bị khóa tạm do nhập sai nhiều lần';
      case 'NETWORK':
        return 'Không kết nối được tới thiết bị';
      case 'SESSION_EXPIRED':
        return 'Phiên đã hết, đăng nhập lại';
      default:
        return message ? `${message} (${code})` : `Không đổi được mật khẩu (${code})`;
    }
  },
};
