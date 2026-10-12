// Chuỗi giao diện của phần làm việc với thiết bị (feature 005, US1): hộp thoại Thiết bị trong mạng, xác
// nhận chứng chỉ, đăng nhập; lệnh Đăng nhập, Đăng xuất; thanh trạng thái khi Online. Gộp vào viMessages ở
// vi.ts; quy ước như vi.ts. Câu theo mockup đã duyệt (docs/architecture/mockups/studio-shell.html).
export const viOnline = {
  // ---- Lệnh mới (specs/004-studio-shell/contracts/commands.md) ----
  'cmd.online.login': 'Đăng nhập…',
  'cmd.online.logout': 'Đăng xuất',
  'reason.loggedIn': 'Đã đăng nhập thiết bị',
  'reason.notLoggedIn': 'Chưa đăng nhập thiết bị',

  // ---- Lý do lỗi mới của phiên thiết bị (model/device-session.ts) ----
  'device.err.cert-unpinned': 'chưa ghim chứng chỉ của thiết bị',
  'device.err.cert-mismatch':
    'chứng chỉ của thiết bị khác chứng chỉ đã ghim, Studio đã chặn kết nối',
  'device.err.tls': 'bắt tay TLS với thiết bị không được',
  'device.err.auth-required': 'chưa đăng nhập thiết bị',
  'device.err.session-expired': 'phiên đăng nhập đã hết hạn',
  'device.err.session-invalid':
    'phiên đăng nhập bị hủy (tài khoản bị tắt hoặc máy này đổi địa chỉ mạng)',
  'device.err.forbidden': 'tài khoản không đủ quyền',
  'device.err.runtime-old': 'runtime cần cập nhật để nạp xuống',
  'device.err.https-unreachable': 'không tới được cổng HTTPS của thiết bị',
  'device.err.viewer-private':
    'thiết bị chỉ phục vụ trang xem trong mạng riêng: hãy Online (đăng nhập) để xem',

  // ---- Mã lỗi của lệnh Rust (ui/device-errors.ts; contracts/tauri-commands.md §1–7, §10) ----
  'deverr.bad-address': 'địa chỉ thiết bị không hợp lệ',
  'deverr.closed': 'kết nối dữ liệu sống đã đóng',
  'deverr.too-large': 'bản tin quá lớn (tối đa 96 KiB)',
  'deverr.not-tls': 'cổng không trả lời HTTPS (runtime cũ hoặc sai cổng)',
  'deverr.bad-response': 'phản hồi không phải của runtime mAT',
  'deverr.no-such-device': 'thiết bị không còn trong danh sách đã lưu',
  'deverr.pin-mismatch': 'ghim chứng chỉ đã đổi hoặc chưa ghim: mở lại để xác nhận',
  'deverr.not-observed': 'chưa dò lại chứng chỉ của thiết bị: thử lại',
  'deverr.setup-required': 'thiết bị chưa có tài khoản nào',
  'deverr.cert-unpinned': 'chưa ghim chứng chỉ của thiết bị',
  'deverr.timeout': 'thiết bị không trả lời kịp',
  'deverr.unreachable': 'không tới được thiết bị',
  'deverr.busy': 'đang có lượt quét khác, thử lại sau vài giây',
  'deverr.auth-failed': 'tên tài khoản hoặc mật khẩu không đúng',
  'deverr.auth-busy': 'thiết bị đang bận xử lý lần đăng nhập khác',
  'deverr.audit-unavailable': 'thiết bị không ghi được audit nên từ chối thao tác',
  'deverr.auth-required': 'chưa đăng nhập thiết bị',
  'deverr.session-expired': 'phiên đăng nhập đã hết hạn',
  'deverr.session-invalid':
    'phiên đăng nhập bị hủy (tài khoản bị tắt hoặc máy này đổi địa chỉ mạng)',
  'deverr.forbidden': 'tài khoản không đủ quyền',
  'deverr.bad-path': 'Studio gọi đường dẫn không được phép',
  'deverr.too-many': 'đã lưu tối đa 64 thiết bị',
  'deverr.ipc': 'lớp Studio gọi thiết bị không trả lời',
  'deverr.tls': 'bắt tay TLS với thiết bị không được',
  'deverr.tlsDetail': 'bắt tay TLS với thiết bị không được ({detail})',
  'deverr.http': 'thiết bị trả lỗi HTTP',
  'deverr.httpDetail': 'thiết bị trả lỗi HTTP {detail}',
  'deverr.network': 'lỗi mạng',
  'deverr.networkDetail': 'lỗi mạng: {detail}',
  'deverr.locked': 'tài khoản tạm khóa',
  'deverr.lockedDetail': 'tài khoản tạm khóa, thử lại sau {time}',
  'deverr.cert-mismatch': 'chứng chỉ của thiết bị khác chứng chỉ đã ghim, Studio đã chặn kết nối',
  'deverr.other': 'lỗi không rõ của thiết bị hoặc Studio ({code})',

  // ---- Hộp thoại Thiết bị trong mạng ----
  'devices.title': 'Thiết bị trong mạng',
  'devices.nic': 'Card mạng',
  'devices.nicAll': 'Mọi card mạng ({n})',
  'devices.nicOption': '{name} · {cidr}',
  'devices.nicVpn': '{name} · {cidr} (VPN: dùng Thêm theo địa chỉ)',
  'devices.nicNoBroadcast': '{name} · {cidr} (không gửi broadcast được)',
  'devices.rescan': 'Tìm lại',
  'devices.led': 'Nháy LED thiết bị',
  'devices.ledTip': 'Chỉ có khi phần cứng BL335 có LED điều khiển được (cần kiểm)',
  'devices.scanning': 'Đang tìm trong {where}… {s} s',
  'devices.scanAll': 'các card mạng',
  'devices.scanDone': 'Tìm xong trong {s} s · {n} thiết bị trả lời',
  'devices.scanError': 'Không quét được: {reason}',
  'devices.scanFailedIface': 'Card {names} không gửi được gói tìm.',
  'devices.vpnHint':
    'Card VPN thường không chuyển broadcast: thiết bị ở xa (qua VPN, port-forward) thêm bằng Thêm theo địa chỉ.',
  'devices.table': 'Thiết bị tìm thấy và đã lưu',
  'devices.col.name': 'Tên',
  'devices.col.address': 'Địa chỉ',
  'devices.col.runtime': 'Runtime',
  'devices.col.project': 'Project',
  'devices.col.status': 'Trạng thái',
  'devices.waiting': 'Đang chờ thiết bị trả lời…',
  'devices.none':
    'Không thấy thiết bị nào. Kiểm tường lửa Windows (cho phép mAT Studio trong mạng riêng) và card mạng, hoặc dùng Thêm theo địa chỉ.',
  'devices.noneIface':
    'Card đã chọn không gửi được gói tìm (card VPN hoặc không có broadcast): dùng Thêm theo địa chỉ.',
  'devices.status.running': 'Đang chạy',
  'devices.status.no-project': 'Chưa có project',
  'devices.status.project-error': 'Project lỗi',
  'devices.status.activating': 'Đang kích hoạt',
  'devices.status.unknown': 'Không rõ',
  'devices.status.saved': 'Đã lưu',
  'devices.status.checking': 'Đang kiểm tra…',
  'devices.project': '{name} {version}',
  'devices.pinnedTip': 'Đã ghim chứng chỉ',
  'devices.detail.model': 'Model',
  'devices.detail.mac': 'MAC',
  'devices.detail.https': 'HTTPS',
  'devices.detail.httpsOff': 'tắt (HTTPS tắt hoặc chứng chỉ lỗi trên thiết bị)',
  'devices.detail.api': 'API thiết bị',
  'devices.detail.cert': 'Chứng chỉ',
  'devices.detail.pinned': 'đã ghim',
  'devices.detail.unpinned': 'chưa ghim, xác nhận ở lần kết nối đầu',
  'devices.detail.fingerprint': 'Fingerprint SHA-256 (gói tìm, chỉ để tham khảo)',
  'devices.detail.lastUser': 'Tài khoản dùng gần nhất',
  'devices.detail.notSeen':
    'Không trả lời lượt quét này: thiết bị khác subnet, qua VPN, tắt tìm thiết bị hoặc chạy runtime cũ.',
  'devices.detail.forget': 'Bỏ khỏi danh sách đã lưu',
  'devices.unknown': '—',
  'devices.add': 'Thêm theo địa chỉ…',
  'devices.addLabel': 'Địa chỉ thiết bị',
  'devices.addPlaceholder': 'IP hoặc tên:cổng HTTPS, ví dụ 10.8.0.21:8443',
  'devices.addSubmit': 'Thêm',
  'devices.addCancel': 'Hủy',
  'devices.addErr.empty': 'Nhập IP hoặc tên thiết bị',
  'devices.addErr.scheme': 'Thiết bị dùng HTTPS: bỏ http:// hoặc ghi https://',
  'devices.addErr.address': 'Địa chỉ thiết bị không hợp lệ',
  'devices.addErr.port': 'Cổng không hợp lệ (1–65535)',
  'devices.addErr.too-many': 'Đã lưu tối đa 64 thiết bị: bỏ bớt thiết bị không dùng',
  'devices.addErr.http-port': 'Cổng HTTP không hợp lệ (1–65535)',
  'devices.advanced': 'Nâng cao',
  'devices.httpPortLabel': 'Cổng HTTP',
  'devices.httpPortHelp':
    'Trang xem và theo dõi chỉ đọc; thiết bị runtime cũ (chưa có HTTPS) qua port-forward thì ghi cổng HTTP đã chuyển. Để trống: 8080.',
  'devices.detail.http': 'HTTP',
  'devices.addErr.other': 'Không thêm được thiết bị: {reason}',
  'devices.help':
    'Thiết bị khác subnet hoặc ở xa (qua VPN, port-forward) không trả lời gói tìm: dùng Thêm theo địa chỉ. Gói trả lời chỉ có tên, model, địa chỉ, phiên bản, trạng thái; không có mật khẩu hay khóa.',
  'devices.upload': 'Đọc lên thành project mới',
  'devices.online': 'Online',
  'devices.probing': 'Đang kiểm chứng chỉ {name}…',
  'devices.onlineError': 'Không kết nối được {name}: {reason}',
  'devices.httpsOffTip':
    'Thiết bị tắt HTTPS hoặc chứng chỉ lỗi: chỉ theo dõi chỉ đọc được (Online › Thiết bị…, Ctrl+K)',

  // ---- Thiết bị gắn với project, trang Thiết bị (T085a, FR-031) ----
  'device.bound.legend': 'Thiết bị của project',
  'device.bound.noProject':
    'Mở project để gắn thiết bị: Online (Ctrl+K) kết nối tới thiết bị gắn với project đang mở.',
  'device.bound.none':
    'Project chưa gắn thiết bị. Online (Ctrl+K) mở Thiết bị trong mạng để chọn hoặc thêm thiết bị.',
  'device.bound.choose': 'Chọn thiết bị…',
  'device.bound.change': 'Đổi thiết bị…',
  'device.bound.pinned': 'đã ghim chứng chỉ',
  'device.bound.unpinned': 'chưa ghim chứng chỉ',
  'device.bound.lastUser': 'tài khoản gần nhất {user}',
  'device.bound.onlineTip': 'Online tới thiết bị của project (Ctrl+K)',
  'device.bound.offlineTip': 'Offline (Ctrl+M)',
  'device.bound.help':
    'Chọn (Online) hoặc thêm thiết bị trong Thiết bị trong mạng thì thiết bị đó gắn với project. Lưu trên máy này theo thư mục project, không ghi vào file project.',
  'device.addr.err.https':
    'Thiết bị có HTTPS kết nối bằng Online (Ctrl+K) hoặc Online › Thiết bị trong mạng…, có ghim chứng chỉ và đăng nhập. Ô này chỉ để theo dõi chỉ đọc qua HTTP (thiết bị runtime cũ).',
  'device.addr.openDevices': 'Mở Thiết bị trong mạng…',

  // ---- Hộp thoại xác nhận chứng chỉ ----
  'pin.title': 'Xác nhận chứng chỉ · {name}',
  'pin.first': 'Lần đầu kết nối tới {name} ({address}).',
  'pin.text':
    'Thiết bị dùng chứng chỉ tự sinh. So fingerprint dưới đây với fingerprint in ra lúc cài runtime trên thiết bị (lệnh mat-runtime --cert-fingerprint). Khớp thì ghim: các lần sau Studio tự kiểm và chặn kết nối nếu chứng chỉ bị đổi.',
  'pin.fpLabel': 'Fingerprint SHA-256 của chứng chỉ thiết bị',
  'pin.discoveredDiffers':
    'Fingerprint này khác fingerprint thiết bị gửi trong gói tìm ({short}…). Có thể có máy khác giả làm thiết bị trong mạng. Chỉ ghim khi khớp với fingerprint in trên thiết bị.',
  'pin.probing': 'Đang dò chứng chỉ của {name}…',
  'pin.back': 'Quay lại',
  'pin.confirm': 'Ghim và tiếp tục',
  'pin.busy': 'Đang ghim…',
  'pin.mismatchTitle': 'Chứng chỉ đã đổi · {name}',
  'pin.mismatchHead': 'Chứng chỉ của {name} khác chứng chỉ đã ghim. Studio đã chặn kết nối.',
  'pin.mismatchText':
    'Có thể chứng chỉ vừa được tạo lại trên thiết bị (mat-runtime --regen-cert), hoặc có máy khác giả làm thiết bị để lấy mật khẩu của bạn. Đừng đăng nhập khi chưa rõ lý do.',
  'pin.pinnedLabel': 'Fingerprint đã ghim',
  'pin.seenLabel': 'Fingerprint thiết bị gửi bây giờ',
  'pin.seenUnknown': 'không dò lại được',
  'pin.unpinCheck':
    'Tôi đã kiểm fingerprint mới trên thiết bị (mat-runtime --cert-fingerprint) và muốn gỡ ghim cũ',
  'pin.unpinHelp': 'Gỡ ghim xong, Studio dò lại và hỏi bạn xác nhận fingerprint mới như lần đầu.',
  'pin.unpin': 'Gỡ ghim và xác nhận lại',
  'pin.close': 'Đóng',

  // ---- Hộp thoại đăng nhập ----
  'login.title': 'Đăng nhập · {name}',
  'login.reloginTitle': 'Đăng nhập lại · {name}',
  'login.relogin':
    'Phiên đăng nhập đã hết hạn (30 phút không thao tác với thiết bị). Đăng nhập lại để tiếp tục; thay đổi chưa lưu trong Studio vẫn giữ nguyên.',
  'login.user': 'Tài khoản',
  'login.password': 'Mật khẩu',
  'login.passwordPlaceholder': 'Mật khẩu tài khoản thiết bị',
  'login.help':
    'Role engineer: online, đọc lên, nạp xuống. Sai 5 lần thì tài khoản bị khóa tạm 5 phút. Mọi lần đăng nhập ghi vào audit của thiết bị.',
  'login.remember': 'Studio nhớ tên tài khoản dùng gần nhất, không lưu mật khẩu.',
  'login.submit': 'Đăng nhập',
  'login.busy': 'Đang đăng nhập…',
  'login.back': 'Quay lại',
  'login.later': 'Để sau',
  'login.needUser': 'Nhập tên tài khoản',
  'login.needPassword': 'Nhập mật khẩu',
  'login.err.auth-failed': 'Tên tài khoản hoặc mật khẩu không đúng.',
  'login.err.locked': 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau {time}.',
  'login.err.unlocked': 'Hết thời gian khóa tạm: có thể đăng nhập lại.',
  'login.err.auth-busy': 'Thiết bị đang bận xử lý lần đăng nhập khác. Thử lại sau vài giây.',
  'login.err.audit-unavailable':
    'Thiết bị không ghi được audit nên từ chối đăng nhập. Kiểm bộ nhớ của thiết bị.',
  'login.err.setup-required':
    'Thiết bị chưa có tài khoản nào. Trên thiết bị, chạy bằng quyền root: mat-runtime --user-add admin --role administrator, rồi tạo tài khoản cho kỹ sư.',
  'login.err.unreachable': 'Không tới được thiết bị. Kiểm mạng rồi thử lại.',
  'login.err.timeout': 'Thiết bị không trả lời kịp. Thử lại.',
  'login.err.failed': 'Không đăng nhập được: {reason}.',
  'login.time.ms': '{m} phút {s} giây',
  'login.time.s': '{s} giây',

  // ---- Thanh trạng thái, chip, thông báo khi Online ----
  'online.state.online': 'Online',
  'online.state.probing': 'Đang kiểm chứng chỉ {name}…',
  'online.state.pin': 'Chờ xác nhận chứng chỉ {name}',
  'online.state.login': 'Chờ đăng nhập {name}',
  'online.state.relogin': 'Phiên hết hạn, cần đăng nhập lại',
  'online.account': '{user} · {role}',
  'online.accountTip': 'Tài khoản và role trên thiết bị',
  'online.reloginButton': 'Đăng nhập lại',
  'online.chip': 'Online: {name}',
  'online.chipRelogin': 'Online: {name} · phiên hết hạn',
  'online.toast.online':
    'Đã online {name} (tài khoản {user} · {role}). Viền cam: đang làm việc với thiết bị.',
  'online.toast.runtimeOld':
    '{name} chạy runtime {version}: chỉ theo dõi chỉ đọc. Runtime cần cập nhật để nạp xuống.',
  'online.toast.relogin':
    'Phiên đăng nhập {name} đã hết hạn: đăng nhập lại để tiếp tục. Thay đổi chưa lưu vẫn giữ.',
  'online.toast.sessionInvalid':
    'Phiên đăng nhập bị hủy (tài khoản bị tắt hoặc máy này đổi địa chỉ mạng): Studio về Offline.',
  'online.toast.loggedOut': 'Đã đăng xuất {name}.',
  'online.toast.certMismatch': 'Chứng chỉ của {name} đã đổi: Studio chặn kết nối.',
  'validate.uidNotInSvg': 'SVG \'{svg}\' không có phần tử data-mat-uid="{uid}"',
} as const;
