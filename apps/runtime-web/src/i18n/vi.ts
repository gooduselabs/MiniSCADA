// Chuỗi tiếng Việt của trang vận hành (Constitution; feature 007 FR-022). Mọi chữ hiện cho người dùng nằm ở đây;
// chuỗi cũ của reload.ts, status.ts giữ ở file của chúng. Chuỗi của widget nằm ở @mat/ui-components.
export const vi = {
  appName: 'mAT SCADA',
  chromeTooOld: (need: number, have: number | null) =>
    `Cần Chrome/Chromium ≥ ${need} (hiện tại: ${have ?? 'không phải Chrome'})`,

  noProjectTitle: 'Không có project hợp lệ trên thiết bị',
  startErrorTitle: 'Lỗi khởi động trang',
  loginRequiredTitle: 'Cần đăng nhập để xem',
  loginRequiredBody: 'Thiết bị yêu cầu đăng nhập trước khi xem dữ liệu.',

  // Thanh trên, menu
  menu: 'Menu',
  menuOpen: 'Mở menu',
  menuClose: 'Đóng menu',
  navLabel: 'Điều hướng màn hình',
  screenRegion: 'Màn hình vận hành',
  screenTitle: (project: string, screen: string) => `${project} · ${screen}`,
  windowTitle: (project: string) => `${project} — mAT SCADA`,
  userLabel: (user: string, role: string) => `${user} (${role})`,
  login: 'Đăng nhập',
  logout: 'Đăng xuất',
  notLoggedIn: 'Chưa đăng nhập',

  // Màn hình
  screenLoading: 'Đang tải màn hình…',
  screenFailedTitle: (name: string) => `Không mở được màn hình "${name}"`,
  screenRetry: 'Thử lại',
  unknownScreen: (id: string) => `Không có màn hình "${id}", đang hiện màn hình đầu.`,
  dismiss: 'Đóng',
  popupClose: 'Đóng cửa sổ',

  // Phiên và chế độ chỉ xem
  viewOnlyBand: 'Chế độ chỉ xem. Mở bằng HTTPS để điều khiển.',
  viewOnlyLink: 'Mở bằng HTTPS',
  viewOnlyHttpsDown: 'Chế độ chỉ xem. Cổng HTTPS của thiết bị không chạy, chưa điều khiển được.',
  sessionExpiredBanner: 'Phiên đã hết hạn, đăng nhập lại.',
  sessionLoginAgain: 'Đăng nhập lại',
  blocked: {
    INSECURE: 'Mở bằng HTTPS để điều khiển',
    HTTPS_DOWN: 'HTTPS không chạy, không điều khiển được',
    SESSION_EXPIRED: 'Phiên đã hết hạn, đăng nhập lại',
    PROJECT_CHANGING: 'Project đang thay đổi',
  },

  // Hộp Đăng nhập
  loginTitle: 'Đăng nhập',
  loginUser: 'Tài khoản',
  loginPass: 'Mật khẩu',
  loginSubmit: 'Đăng nhập',
  loginCancel: 'Hủy',
  loginBusy: 'Đang đăng nhập…',
  loginEmpty: 'Nhập tài khoản và mật khẩu',
  loginError: (code: string, retryAfterS?: number): string => {
    switch (code) {
      case 'AUTH_FAILED':
        return 'Sai tài khoản hoặc mật khẩu';
      case 'AUTH_LOCKED':
        return retryAfterS
          ? `Đăng nhập bị khóa tạm, thử lại sau ${Math.ceil(retryAfterS / 60)} phút`
          : 'Đăng nhập bị khóa tạm, thử lại sau ít phút';
      case 'HTTPS_REQUIRED':
      case 'INSECURE':
        return 'Chỉ đăng nhập được qua HTTPS';
      case 'ORIGIN_MISMATCH':
        return 'Trang được mở từ địa chỉ không khớp với thiết bị';
      case 'AUDIT_UNAVAILABLE':
        return 'Thiết bị chưa ghi được nhật ký kiểm toán, thử lại sau';
      case 'NETWORK':
        return 'Không kết nối được tới thiết bị';
      case 'BAD_REQUEST':
      case 'BAD_RESPONSE':
        return 'Thiết bị trả lời không đúng định dạng';
      default:
        return `Đăng nhập không thành công (${code})`;
    }
  },

  // Kết quả ghi do máy chủ trả (câu của thiết bị được ưu tiên)
  writeNoSession: 'Chưa đăng nhập',
  writeNetwork:
    'Mất liên lạc với thiết bị khi gửi lệnh: không chắc lệnh đã tới, kiểm tra giá trị thực trước khi thử lại',
  writeNoAnswer:
    'Không lấy được kết quả sau 30 giây: không chắc đã ghi, kiểm tra giá trị thực trước khi thử lại',

  // Trang /login
  loginPageTitle: 'Đăng nhập mAT SCADA',
  loginPageHttps: 'Trang đăng nhập chỉ dùng được qua HTTPS.',
  loginPageCert: 'Tải chứng chỉ của thiết bị',
  loginPageFingerprint: 'Vân tay chứng chỉ (SHA-256)',
  loginPageFingerprintHint: 'Đối chiếu với vân tay ghi trên thiết bị trước khi tin chứng chỉ.',
  loginPageDone: 'Đã đăng nhập, đang chuyển trang…',
} as const;
