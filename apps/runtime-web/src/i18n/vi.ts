// Chuỗi tiếng Việt của trang vận hành (Constitution; feature 007 FR-022). Mọi chữ hiện cho người dùng nằm ở đây;
// chuỗi cũ của reload.ts, status.ts giữ ở file của chúng. Chuỗi của widget nằm ở @mat/ui-components.
import { alarmPanelVi } from '@mat/ui-components/alarm-panel-vi';

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
  /** Faceplate: `args` của hành động popup không khớp `params` (FR-123, FR-125). */
  popupArgsInvalid: (detail: string) => `tham số của cửa sổ sai (${detail})`,

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
  blockedNoPermission: 'Cần quyền thao tác',

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
        return vi.access.loginLocked(retryAfterS, Date.now());
      case 'LOGIN_BUSY': // 011: giới hạn đăng nhập đồng thời; AUTH_BUSY của thiết bị cũ
      case 'AUTH_BUSY':
        return 'Thiết bị đang bận kiểm tra đăng nhập khác, thử lại sau giây lát';
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

  // Đăng nhập bắt buộc, phân quyền, tài khoản của tôi (feature 013). Chữ của trang Quản trị: i18n/vi-admin.ts (tải lười).
  access: {
    adminMenu: 'Quản trị',
    redirecting: 'Phiên đã hết, đang chuyển tới trang đăng nhập…',
    httpsRequiredTitle: 'Cần mở bằng HTTPS để đăng nhập',
    httpsRequiredBody:
      'Thiết bị yêu cầu đăng nhập trước khi xem. Trang đăng nhập chỉ dùng được qua HTTPS.',
    httpsLink: 'Mở trang đăng nhập (HTTPS)',
    noAccessTitle: 'Không có quyền xem trang này',
    noAccessBody: (id: string) =>
      `Tài khoản của bạn chưa được cấp quyền xem trang "${id}", hoặc trang không còn trong project. Hỏi quản trị viên nếu bạn cần trang này.`,
    noAccessHome: 'Về trang đầu',
    noContentTitle: 'Không có nội dung bạn được xem',
    noContentBody: 'Mọi thành phần của màn hình này đều cần quyền mà tài khoản của bạn chưa có.',
    viewerLoginOff: 'Xem không cần đăng nhập',
    account: 'Tài khoản',
    accountMenu: (user: string) => `Tài khoản ${user}`,
    accountGroups: (g: string) => `Nhóm: ${g}`,
    accountNoGroup: 'Không thuộc nhóm nào',
    changePassword: 'Đổi mật khẩu của tôi',
    loginLocked: (retryAfterS: number | undefined, now: number) => {
      if (!retryAfterS) return 'Tài khoản bị khóa tạm do nhập sai nhiều lần, thử lại sau ít phút';
      const at = new Date(now + retryAfterS * 1000).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return `Tài khoản bị khóa tạm do nhập sai nhiều lần. Thử lại sau ${Math.ceil(retryAfterS / 60)} phút (lúc ${at}).`;
    },
    loginBrand: 'Hệ thống giám sát và điều khiển',
    loginNext: (to: string) => `Sau khi đăng nhập sẽ mở ${to}`,
    loginDevice: (name: string) => `Thiết bị ${name}`,
  },

  // Alarm (feature 009; contracts/ui-alarm.md §14). Chữ dùng chung với widget (trạng thái, mức ưu tiên, lỗi) ở
  // @mat/ui-components (alarmVi); ở đây là phần riêng của trang: banner, trang Alarm, hộp thoại, âm thanh, lịch sử, CSV.
  alarm: {
    menu: 'Alarm',
    menuHistory: 'Lịch sử alarm',
    menuUnsupported: 'chưa hỗ trợ',
    // Chuông và bảng thông báo (feature 026, thay banner ngang của 009).
    bell: {
      label: (n: number) =>
        n > 0 ? `Cảnh báo: ${n} chưa xác nhận` : 'Cảnh báo: không có alarm chưa xác nhận',
      labelLost: 'Cảnh báo: mất kết nối, danh sách có thể đã cũ',
      labelUnsupported: 'Cảnh báo: thiết bị chưa hỗ trợ alarm',
      panel: 'Bảng thông báo alarm',
      title: 'Cảnh báo',
      filterLabel: 'Lọc thông báo',
      tabUnack: 'Chưa xác nhận',
      tabAll: 'Tất cả',
      empty: 'Không có cảnh báo',
      emptyUnack: 'Không có cảnh báo chưa xác nhận',
      emptyHint: 'Hệ thống đang bình thường.',
      viewAll: 'Xem tất cả alarm',
      more: (n: number) => `và ${n} alarm khác`,
      ack: 'Xác nhận',
      ackRow: (text: string) => `Xác nhận: ${text}`,
      ackAll: 'Xác nhận tất cả',
      ackAllConfirm: (n: number) => `Bấm lần nữa: xác nhận ${n}`,
      ackBusy: 'Đang gửi…',
      close: 'Đóng bảng thông báo',
      state: {
        ACTIVE_UNACK: 'Chưa xác nhận',
        ACTIVE_ACK: 'Đã xác nhận',
        RTN_UNACK: 'Đã hết, chưa xác nhận',
        NORMAL: 'Bình thường',
      },
      value: (v: string) => `Giá trị ${v}`,
      justNow: 'vừa xong',
      secondsAgo: (n: number) => `${n} giây trước`,
      minutesAgo: (n: number) => `${n} phút trước`,
      hoursAgo: (n: number) => `${n} giờ trước`,
      daysAgo: (n: number) => `${n} ngày trước`,
      lost: 'Mất kết nối tới thiết bị: danh sách alarm có thể đã cũ',
      unsupported: 'Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)',
      toastTitle: 'Alarm khẩn cấp mới',
      toastMany: (n: number) => `${n} alarm khẩn cấp mới`,
      toastOpen: 'Mở bảng thông báo',
      toastClose: 'Đóng thông báo',
      sound: 'Âm thanh',
    },
    sound: {
      toggle: 'Âm thanh',
      on: 'Âm thanh: bật',
      off: 'Âm thanh: tắt',
      hintOff: 'Âm thanh đang tắt, bấm để bật',
      hintSuspended: 'Trình duyệt đã tạm dừng âm thanh, bấm để bật lại',
      mute: 'Tắt tiếng',
      muted: 'Đã tắt tiếng các alarm hiện có (chưa xác nhận)',
    },
    announce: {
      count: (n: number) => `${n} alarm chưa xác nhận`,
      newCritical: (text: string) => `Khẩn cấp: ${text}`,
      newCriticalMany: (n: number) => `${n} alarm khẩn cấp mới`,
      lost: 'Mất kết nối tới thiết bị',
    },
    // Feature 041: tab, bộ lọc, hộp thoại, lịch sử, CSV dùng chung với widget alarm-list (@mat/ui-components).
    ...alarmPanelVi,
  },
} as const;
