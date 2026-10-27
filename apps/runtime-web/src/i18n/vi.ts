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
    pageTitle: 'Alarm',
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
    tabsLabel: 'Nhóm alarm',
    tabActive: (n: number) => `Đang có (${n})`,
    tabShelved: (n: number) => `Tạm ẩn (${n})`,
    filters: {
      label: 'Bộ lọc alarm',
      area: 'Khu vực',
      allAreas: 'Mọi khu vực',
      cls: 'Lớp',
      allClasses: 'Mọi lớp',
      priority: 'Mức ưu tiên',
      allPriorities: 'Mọi mức',
      state: 'Trạng thái',
      allStates: 'Mọi trạng thái',
      unack: 'Chưa xác nhận',
      ack: 'Đã xác nhận',
      rtn: 'Đã hết, chưa xác nhận',
      searchLabel: 'Tìm chữ',
      searchPlaceholder: 'Tìm chữ (bỏ dấu)',
      clear: 'Xóa lọc',
      summaryArea: (names: string) => `khu vực ${names}`,
      summaryPriority: (names: string) => `mức ${names}`,
      summaryClass: (names: string) => `lớp ${names}`,
      summaryState: (names: string) => `trạng thái ${names}`,
      summaryText: (q: string) => `chữ "${q}"`,
    },
    actions: {
      label: 'Thao tác alarm',
      ack: 'Xác nhận',
      ackAll: 'Xác nhận tất cả',
      shelve: 'Tạm ẩn…',
      selected: (n: number) => `${n} hàng đã chọn`,
      keyHint: 'Shift+A xác nhận · Ctrl+Shift+A tất cả · S tạm ẩn',
    },
    ackAll: {
      title: 'Xác nhận tất cả',
      body: (n: number, filter: string) => `Xác nhận ${n} alarm đang hiện${filter}?`,
      note: 'Chỉ các alarm đang hiện lúc bấm được xác nhận.',
      confirm: (n: number) => `Xác nhận ${n} alarm`,
      cancel: 'Hủy',
      none: 'Không có alarm nào đang hiện để xác nhận',
    },
    shelve: {
      title: 'Tạm ẩn alarm',
      reason: 'Lý do (bắt buộc, tối đa 120 ký tự)',
      count: (n: number) => `${n} / 120`,
      duration: 'Thời lượng',
      d15: '15 phút',
      d60: '1 giờ',
      d240: '4 giờ',
      d480: '8 giờ',
      minutesLabel: 'Số phút',
      minutesPlaceholder: '1-480',
      or: 'hoặc',
      minutesUnit: 'phút',
      hint: 'Alarm vẫn được ghi lịch sử nhưng không hiện ở banner, không có tiếng. Tự gỡ khi hết hạn.',
      confirm: 'Tạm ẩn',
      cancel: 'Hủy',
      close: 'Đóng',
      reasonRequired: 'Nhập lý do (tối đa 120 ký tự)',
      minutesRange: 'Số phút từ 1 đến 480',
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
    history: {
      title: 'Lịch sử alarm',
      rangeLabel: 'Khoảng thời gian',
      r1h: '1 giờ',
      r8h: '8 giờ',
      r24h: '24 giờ',
      r7d: '7 ngày',
      r30d: '30 ngày',
      from: 'Từ',
      to: 'đến',
      rangeTooLong: 'Khoảng thời gian tối đa 366 ngày',
      rangeInvalid: 'Thời điểm bắt đầu phải trước thời điểm kết thúc',
      area: 'Khu vực',
      allAreas: 'Mọi khu vực',
      minPriority: 'Mức tối thiểu',
      minFrom: (p: string) => `Từ ${p} trở lên`,
      finalState: 'Trạng thái cuối',
      stateAll: 'Mọi',
      stateActive: 'Đang có',
      stateAcked: 'Đã xác nhận',
      stateClosed: 'Đã đóng',
      alarmId: 'Mã alarm',
      follow: 'Theo dõi',
      exportCsv: 'Xuất CSV',
      more: (n: number) => `Tải thêm (${n} dòng)`,
      loaded: (n: number) => `Đã tải ${n} dòng`,
      noMore: 'Đã hết dữ liệu trong khoảng này',
      empty: 'Không có lần xảy ra nào trong khoảng này',
      loading: 'Đang tải…',
      col: {
        tsActive: 'Bật lúc',
        ack: 'Xác nhận lúc · người',
        tsReturn: 'Hết lúc',
        duration: 'Thời lượng',
        value: 'Giá trị',
        priority: 'Ưu tiên',
        area: 'Khu vực',
        text: 'Nội dung',
        state: 'Trạng thái',
      },
      stateOpen: 'Đang có',
      stateReturned: 'Đã hết',
      clockUnsynced: 'giờ chưa đồng bộ',
      closedConfig: 'Đóng do đổi cấu hình',
      closedDisabled: 'Đóng do vô hiệu',
      closedRestart: 'Đóng do khởi động lại',
      err: {
        BAD_QUERY: 'Bộ lọc không hợp lệ, kiểm tra lại khoảng thời gian và chữ tìm',
        ALARM_HISTORY_BUSY: 'Thiết bị đang bận truy vấn lịch sử, thử lại sau ít giây',
        ALARM_LOG_UNAVAILABLE: 'Kho lịch sử alarm chưa sẵn sàng trên thiết bị',
        NETWORK: 'Không kết nối được tới thiết bị',
        unknown: (code: string) => `Không tải được lịch sử (${code})`,
      },
    },
    csv: {
      progress: (n: number) => `Đang xuất CSV: ${n} dòng`,
      cancel: 'Hủy',
      done: (n: number) => `Đã xuất ${n} dòng`,
      cancelled: 'Đã hủy xuất CSV',
      truncated: (n: number, more: string) =>
        `Đã cắt còn ${n} dòng${more}; hãy thu hẹp khoảng thời gian`,
      moreRows: (n: number) => ` (còn khoảng ${n} dòng nữa)`,
      yes: 'Có',
      statusActive: 'Đang có',
      statusReturned: 'Đã hết',
      statusConfig: 'Đóng do đổi cấu hình',
      statusDisabled: 'Đóng do vô hiệu',
      statusRestart: 'Đóng do khởi động lại',
      area: 'Chung',
      header: [
        'Mã lần xảy ra',
        'Mã alarm',
        'Tên alarm',
        'Khu vực',
        'Lớp',
        'Mức ưu tiên',
        'Nội dung',
        'Giá trị lúc bật',
        'Chất lượng lúc bật',
        'Lý do chất lượng',
        'Bật lúc',
        'Xác nhận lúc',
        'Người xác nhận',
        'Hết lúc',
        'Xác nhận hết lúc',
        'Người xác nhận hết',
        'Thời lượng (giây)',
        'Trạng thái',
        'Giờ chưa đồng bộ',
        'Sau khởi động',
      ],
    },
  },
} as const;
