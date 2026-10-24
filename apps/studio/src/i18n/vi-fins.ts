// Chuỗi giao diện của driver Omron FINS (feature 018): form kênh và thiết bị FINS, nút thêm kênh, Thử kết nối (mã kết
// thúc, model CPU), lý do quality FINS_*, chẩn đoán, gợi ý địa chỉ của bảng Tag.
export const viFins = {
  'cn.add.fins': 'Thêm kênh Omron FINS',
  'cn.kind.fins': 'Omron FINS',
  'dd.kind.fins': 'Omron FINS',
  'dd.row.endCode': 'Mã kết thúc {code}',
  'cn.fins.sub': 'FINS/{transport}',
  'cn.fins.node': 'nút {node}',
  'cn.fins.nodeAuto': 'nút tự động',

  // ---- kênh ----
  'cn.f.finsHost': 'Địa chỉ PLC',
  'cn.h.finsHost':
    'IPv4 hoặc tên máy của bộ Ethernet (CJ1W-ETN21, CJ2 built-in, CP1L-E), ví dụ 192.168.250.1.',
  'cn.f.transport': 'Giao thức',
  'cn.h.transport':
    'udp (mặc định) hoặc tcp. FINS/UDP nhẹ, gửi lại khi mất gói; FINS/TCP giữ kết nối và tự nhận nút khi bắt tay.',
  'cn.f.finsPort': 'Cổng FINS',
  'cn.h.finsPort': '1–65535. Mặc định 9600 (cổng FINS của PLC, đặt trong Unit Setup).',
  'cn.f.sourceNetwork': 'Mạng nguồn (SNA)',
  'cn.h.sourceNetwork': '0–127. Mặc định 0 (mạng cục bộ). Chỉ đặt khi PLC có bảng định tuyến.',
  'cn.f.sourceNode': 'Nút nguồn (SA1)',
  'cn.h.sourceNode':
    '0–254. Để 0: UDP lấy byte cuối IPv4 của BL335, TCP để PLC cấp khi bắt tay. Không trùng nút của PLC.',
  'cn.f.localPort': 'Cổng UDP nguồn',
  'cn.h.localPort':
    '0–65535. Mặc định 0 (hệ điều hành chọn). Đặt 9600 khi bộ Ethernet cũ chỉ trả lời về cổng 9600.',

  // ---- thiết bị ----
  'cn.f.node': 'Nút đích (DA1)',
  'cn.h.node':
    '0–254. Để 0: UDP lấy byte cuối IPv4 của PLC, TCP lấy nút của bộ Ethernet khi bắt tay. Đặt rõ khi đi qua cầu nối.',
  'cn.f.network': 'Mạng đích (DNA)',
  'cn.h.network': '0–127. Mặc định 0 (cùng mạng). Khác 0 thì PLC phải có bảng định tuyến.',
  'cn.f.unit': 'Unit đích (DA2)',
  'cn.h.unit': '0–255. Mặc định 0 (CPU).',
  'cn.f.finsByteOrder': 'Thứ tự word',
  'cn.h.finsByteOrder':
    'Kiểu 32 và 64 bit. Mặc định CDAB: word thấp ở địa chỉ thấp như PLC Omron lưu DINT, REAL, LREAL.',
  'cn.f.finsTimeoutMs': 'Chờ trả lời',
  'cn.h.finsTimeoutMs': '100–10.000 ms. Mặc định 500.',
  'cn.f.finsRetries': 'Số lần gửi lại',
  'cn.h.finsRetries':
    '0–5, chỉ cho lệnh đọc, mỗi lần một SID mới. Để trống: 1 với UDP, 0 với TCP. Lệnh ghi không bao giờ gửi lại.',
  'cn.f.maxReadWords': 'Tối đa word mỗi lần đọc',
  'cn.h.maxReadWords': '1–999. Mặc định 999 (giới hạn khung FINS).',
  'cn.f.maxGapWords': 'Khoảng trống gộp (word)',
  'cn.h.maxGapWords': '0–999. Mặc định 10. Tag cách nhau không quá số này được đọc chung một lệnh.',
  'cn.f.multiRead': 'Đọc nhiều vùng (0104)',
  'cn.h.multiRead': 'Gom Tag rời vào một lệnh Multiple Memory Area Read. Mặc định bật.',
  'cn.f.maxMultiItems': 'Tối đa phần tử mỗi lệnh 0104',
  'cn.h.maxMultiItems': '1–128. Mặc định 64.',

  // ---- Thử kết nối ----
  'cn.probe.finsHelp':
    'Để trống địa chỉ: đọc model CPU (lệnh 0501). Có địa chỉ (D100, CIO10.03, T5…): đọc 1–4 word hoặc bit.',
  'cn.probe.model': 'Model CPU: {model}',
  'cn.probe.nodes': 'Nút do PLC cấp khi bắt tay TCP: BL335 {client}, PLC {server}',
  'cn.probe.endCode': 'Mã kết thúc {code}: {meaning}',
  'cn.probe.finsRead': 'Đã đọc {address}, {count} phần tử',
  'probeCode.END_CODE': 'PLC trả lời bằng mã kết thúc lỗi',
  'probeCode.DISCONNECTED': 'kết nối bị đóng giữa chừng',

  // ---- lý do quality ----
  'tagReason.FINS_ROUTING': 'không tới được nút FINS đích (mạng, nút, unit hoặc bảng định tuyến)',
  'tagReason.FINS_ADDRESS': 'địa chỉ ngoài vùng nhớ của PLC Omron',
  'tagReason.FINS_MODE': 'PLC Omron không cho ở chế độ hiện tại (ví dụ PROGRAM)',
  'tagReason.FINS_READ_DENIED': 'PLC Omron không cho đọc vùng này',
  'tagReason.FINS_WRITE_DENIED': 'PLC Omron không cho ghi vùng này',
  'tagReason.FINS_UNSUPPORTED': 'PLC Omron không hỗ trợ lệnh này',
  'tagReason.FINS_FORMAT': 'PLC Omron báo lỗi định dạng lệnh',
  'tagReason.FINS_UNIT_ERROR': 'lỗi unit hoặc thiết bị của PLC Omron',
  'tagReason.FINS_ACCESS': 'PLC Omron từ chối (bảo vệ, quyền truy cập)',
  'tagReason.FINS_CANCELED': 'PLC Omron hủy dịch vụ',
  'tagReason.FINS_OTHER': 'mã kết thúc FINS lạ',

  // ---- bảng Tag: địa chỉ FINS ----
  'tagTable.finsHint': 'Địa chỉ FINS: {examples}',
  'issue.E_CHANNEL_VERSION': 'Kênh Omron FINS hoặc BCD cần project định dạng 1.1',
} as const;
