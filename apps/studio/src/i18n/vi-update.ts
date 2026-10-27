// Chuỗi giao diện của "Cập nhật runtime" (OTA, feature 011, T119; FR-068; contracts/device-api-011.md §3): task card trong
// trang Thiết bị và Công cụ online, hộp Cập nhật runtime (chọn file, tải lên, kế hoạch, mật khẩu, theo dõi, kết quả, quay về
// bản trước). Mã lỗi của thiết bị (UPDATE_*…) giữ nguyên tiếng Anh, kèm câu tiếng Việt. Gộp vào viMessages ở vi.ts.
export const viUpdate = {
  // ---- Task card ----
  'ota.card.title': 'Cập nhật runtime',
  'ota.card.text':
    'Tải gói .matupdate đã ký lên thiết bị, xem kế hoạch rồi áp dụng. Kiểm tra sức khỏe không đạt thì thiết bị tự quay về bản trước.',
  'ota.card.open': 'Cập nhật runtime…',
  'ota.card.disabled': 'OTA đang tắt: bật trong Thiết bị › Thiết lập thiết bị (administrator)',

  // ---- Hộp thoại ----
  'ota.title': 'Cập nhật runtime: {name}',
  'ota.rb.title': 'Quay về bản trước: {name}',
  'ota.loading': 'Đang đọc trạng thái cập nhật của thiết bị…',
  'ota.current': 'Runtime đang chạy',
  'ota.unknown': 'không rõ',
  'ota.close': 'Đóng',
  'ota.cancel': 'Hủy',
  'ota.back': 'Quay lại',

  // Chọn file
  'ota.pick.lead':
    'Chọn gói cập nhật đã ký (.matupdate). Thiết bị kiểm chữ ký, phiên bản, kiến trúc và chỗ trống trước khi cho áp dụng.',
  'ota.pick.file': 'Gói cập nhật',
  'ota.pick.none': 'Chưa chọn file',
  'ota.pick.size': '{name} ({size})',
  'ota.pick.choose': 'Chọn file…',
  'ota.pick.upload': 'Tải lên và kiểm',
  'ota.prev': 'Bản trước trên thiết bị',
  'ota.prev.none': 'Không có',
  'ota.rollback': 'Quay về bản trước',

  // Tải lên
  'ota.upload.lead': 'Đang tải gói lên thiết bị. Thiết bị kiểm gói ngay khi nhận xong.',
  'ota.upload.progress': 'Đã gửi {sent} / {total}',
  'ota.upload.bar': 'Tiến trình tải gói lên thiết bị',
  'ota.upload.foot': 'Đang tải lên…',

  // Kế hoạch
  'ota.plan.lead': 'Thiết bị đã kiểm gói. Xem kế hoạch rồi nhập lại mật khẩu để áp dụng.',
  'ota.plan.version': 'Phiên bản',
  'ota.plan.versionText': '{from} → {to}',
  'ota.plan.release': 'Số phát hành',
  'ota.plan.project': 'Project đang chạy',
  'ota.plan.compatible': 'Tương thích',
  'ota.plan.incompatible': 'Không tương thích với runtime mới',
  'ota.plan.downtime': 'Thời gian ngừng ước tính',
  'ota.plan.downtimeText': 'khoảng {s} s',
  'ota.plan.signer': 'Người ký',
  'ota.plan.notes': 'Ghi chú',
  'ota.plan.warn':
    'Trong lúc cập nhật, runtime ngừng đọc PLC, ghi lịch sử và phục vụ trang xem; client tự kết nối lại sau đó. Kiểm tra sức khỏe không đạt trong 60 s thì thiết bị tự quay về {from}.',
  'ota.plan.incompatibleWarn':
    'Project đang chạy không chạy được trên runtime mới: nạp project phù hợp trước hoặc dùng gói khác.',
  'ota.password': 'Mật khẩu của {user}',
  'ota.passwordHelp':
    'Nhập lại mật khẩu để xác nhận. Studio không lưu mật khẩu; sai nhiều lần thì bị khóa như đăng nhập.',
  'ota.apply': 'Cập nhật',
  'ota.cancelPackage': 'Hủy gói',

  // Theo dõi
  'ota.follow.applying': 'Thiết bị đang áp dụng bản cập nhật…',
  'ota.follow.rollback': 'Thiết bị đang quay về bản trước…',
  'ota.follow.restarting': 'Dịch vụ runtime đang khởi động lại, Studio chờ thiết bị trả lời…',
  'ota.follow.step': 'Bước của thiết bị: {step}',
  'ota.follow.note':
    'Không tắt nguồn thiết bị. Studio chờ tối đa 120 s thiết bị không trả lời trước khi báo mất kết nối.',
  'ota.follow.foot': 'Đang theo dõi thiết bị…',

  // Kết quả
  'ota.res.committed': 'Đã cập nhật runtime lên {version}',
  'ota.res.committedText': 'Thiết bị đã kiểm tra sức khỏe xong. Bản {from} được giữ làm bản trước.',
  'ota.res.rolledBack': 'Không cập nhật được: thiết bị đang chạy {version}',
  'ota.res.rolledBackText': 'Thiết bị đã tự quay về bản trước.',
  'ota.res.reason': 'Lý do: {reason}',
  'ota.res.lost': 'Mất kết nối với thiết bị quá 120 s',
  'ota.res.lostText':
    'Studio không biết kết quả. Đợi vài phút rồi Online lại và mở Cập nhật runtime để xem kết quả, hoặc trên thiết bị chạy mat-runtime --update-status (root). Không tắt nguồn thiết bị khi chưa rõ.',
  'ota.res.session': 'Thiết bị đã chạy lại nhưng phiên đăng nhập không còn',
  'ota.res.sessionText': 'Đăng nhập lại rồi mở Cập nhật runtime để xem kết quả của lần cập nhật.',
  'ota.res.rbDone': 'Đã quay về runtime {version}',
  'ota.res.rbFailed': 'Không quay về được bản trước',
  'ota.res.audit': 'Thiết bị ghi audit system.update.* kèm tài khoản {user}.',

  // Quay về bản trước
  'ota.rb.lead':
    'Thiết bị chuyển về runtime {version} (bản chạy trước lần cập nhật gần nhất) rồi khởi động lại dịch vụ.',
  'ota.rb.go': 'Quay về {version}',

  // Lỗi
  'ota.err': '{text} ({code})',
  'ota.errDetail': '{text} ({code}: {detail})',
  'ota.err.badFile': 'File không phải gói .matupdate, hoặc rỗng',
  'ota.err.noFile': 'File đã chọn không còn trong bộ nhớ của Studio: chọn lại file',
  'ota.code.UPDATE_PACKAGE_INVALID': 'Gói hỏng hoặc sai định dạng',
  'ota.code.UPDATE_SIGNATURE_INVALID': 'Chữ ký của gói không hợp lệ',
  'ota.code.UPDATE_KEY_UNKNOWN': 'Gói được ký bằng khóa thiết bị không tin cậy',
  'ota.code.UPDATE_DISABLED':
    'OTA đang tắt trên thiết bị (administrator bật trong Thiết bị › Thiết lập thiết bị)',
  'ota.code.UPDATE_DOWNGRADE': 'Gói không mới hơn bản đang chạy (không cho hạ cấp)',
  'ota.code.UPDATE_PROJECT_INCOMPATIBLE': 'Project đang chạy không tương thích với runtime mới',
  'ota.code.UPDATE_TOO_LARGE': 'Gói vượt cỡ tối đa của thiết bị (update.maxPackageMiB)',
  'ota.code.UPDATE_ARCH_MISMATCH': 'Gói dành cho kiến trúc khác',
  'ota.code.UPDATER_MANUAL_ONLY': 'Gói có mat-updater mới: chỉ cài được bằng deploy.sh',
  'ota.code.INSUFFICIENT_SPACE': 'Thiết bị không đủ chỗ trống',
  'ota.code.UPDATE_RECEIVE_ABORTED': 'Gửi gói quá chậm hoặc bị ngắt: thử lại',
  'ota.code.UPDATE_KEYS_MISSING': 'Thiết bị chưa có khóa tin cậy để kiểm chữ ký',
  'ota.code.REAUTH_FAILED': 'Mật khẩu không đúng',
  'ota.code.UPDATE_NOT_FOUND': 'Gói đã hết hạn (30 phút) hoặc đã bị hủy: tải lại gói',
  'ota.code.UPDATE_NO_PREVIOUS': 'Thiết bị không còn bản trước',
  'ota.code.other': 'Thiết bị từ chối',
} as const;
