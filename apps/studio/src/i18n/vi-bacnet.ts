// Chuỗi giao diện của driver BACnet/IP (feature 020): form kênh và thiết bị BACnet, nút thêm kênh, Tìm thiết bị
// (Who-Is), Thử kết nối và Duyệt đối tượng (object-list), lý do quality BACNET_*, chẩn đoán, gợi ý địa chỉ của Bảng Tag.
export const viBacnet = {
  'cn.add.bacnet': 'Thêm kênh BACnet/IP',
  'cn.kind.bacnet': 'BACnet/IP',
  'dd.kind.bacnet': 'BACnet/IP',
  'dd.row.bacnetError': 'Lỗi BACnet {code}',
  'dd.row.bacnetReject': 'Reject {code}',
  'dd.row.bacnetAbort': 'Abort {code}',

  // ---- kênh ----
  'cn.f.bacnetLocalPort': 'Cổng UDP cục bộ',
  'cn.h.bacnetLocalPort':
    '0–65535. Mặc định 47808 (BAC0). Thiết bị trả lời về cổng nguồn; đổi khi một chương trình khác trên BL335 đã giữ 47808.',
  'cn.f.bacnetBroadcast': 'Địa chỉ broadcast',
  'cn.h.bacnetBroadcast':
    'IPv4 broadcast cho Tìm thiết bị (Who-Is), ví dụ 192.168.1.255. Mặc định 255.255.255.255.',
  'cn.f.bacnetBindAddress': 'Địa chỉ IP cục bộ',
  'cn.h.bacnetBindAddress':
    'Để trống: mọi giao diện mạng. Đặt IPv4 của BL335 khi có nhiều cổng mạng.',
  'cn.f.bacnetBbmdHost': 'BBMD',
  'cn.h.bacnetBbmdHost':
    'IPv4 hoặc tên máy của BBMD khi thiết bị ở subnet khác. Có BBMD: BL335 đăng ký foreign device và Who-Is đi qua BBMD.',
  'cn.f.bacnetBbmdPort': 'Cổng BBMD',
  'cn.h.bacnetBbmdPort': '1–65535. Mặc định 47808.',
  'cn.f.bacnetBbmdTtlS': 'Thời hạn đăng ký',
  'cn.h.bacnetBbmdTtlS': '30–65535 s. Mặc định 300; BL335 đăng ký lại sau nửa thời hạn.',

  // ---- thiết bị ----
  'cn.f.bacnetInstance': 'Device instance',
  'cn.h.bacnetInstance':
    '0–4194302, duy nhất trong mạng BACnet. Lấy từ Tìm thiết bị hoặc cấu hình của bộ điều khiển.',
  'cn.f.bacnetHost': 'Địa chỉ IP',
  'cn.h.bacnetHost':
    'IPv4 của thiết bị, hoặc của router BACnet khi thiết bị nằm sau router (MS/TP): khi đó đặt cả Mạng đích và MAC.',
  'cn.f.bacnetPort': 'Cổng UDP',
  'cn.h.bacnetPort': '1–65535. Mặc định 47808.',
  'cn.f.bacnetWritePriority': 'Priority ghi mặc định',
  'cn.h.bacnetWritePriority':
    '1–16 (trừ 6, dành cho minimum on/off). Mặc định 16 (thấp nhất). Tag có @p trong địa chỉ dùng priority của Tag.',
  'cn.f.bacnetNetwork': 'Mạng đích (DNET)',
  'cn.h.bacnetNetwork': '1–65534. Chỉ đặt khi thiết bị ở sau router BACnet.',
  'cn.f.bacnetMac': 'MAC đích (DADR)',
  'cn.h.bacnetMac': '1–6 byte hex, ví dụ 07 cho MS/TP. Cần Mạng đích.',
  'cn.f.bacnetMaxApdu': 'APDU tối đa',
  'cn.h.bacnetMaxApdu':
    'Byte. Mặc định 1476. Driver không dùng segmentation: mỗi ReadPropertyMultiple vừa giới hạn này cả chiều gửi lẫn trả lời.',
  'cn.f.bacnetTimeoutMs': 'Chờ trả lời',
  'cn.h.bacnetTimeoutMs':
    '100–30.000 ms. Mặc định 500. Thiết bị sau router MS/TP thường cần 1000–3000.',
  'cn.f.bacnetRetries': 'Số lần gửi lại',
  'cn.h.bacnetRetries':
    '0–5, cùng invoke ID, chỉ cho lệnh đọc. Mặc định 1. Lệnh ghi không bao giờ gửi lại.',
  'cn.f.bacnetUseRpm': 'Dùng ReadPropertyMultiple',
  'cn.h.bacnetUseRpm':
    'Gom nhiều điểm vào một yêu cầu. Mặc định bật; thiết bị không hỗ trợ thì driver tự chuyển sang ReadProperty.',
  'cn.f.bacnetMaxRpmProps': 'Tối đa thuộc tính mỗi RPM',
  'cn.h.bacnetMaxRpmProps': '1–128. Mặc định 32.',

  // ---- Tìm thiết bị ----
  'cn.bac.discover.title': 'Tìm thiết bị BACnet',
  'cn.bac.discover.help':
    'BL335 gửi Who-Is (broadcast của kênh, hoặc qua BBMD) và chờ 3 giây. Cần Online với tài khoản engineer.',
  'cn.bac.discover.run': 'Tìm thiết bị',
  'cn.bac.discover.none': 'Không có thiết bị nào trả lời I-Am.',
  'cn.bac.discover.count': '{n} thiết bị trả lời',
  'cn.bac.col.instance': 'Instance',
  'cn.bac.col.address': 'Địa chỉ',
  'cn.bac.col.route': 'Mạng / MAC',
  'cn.bac.col.apdu': 'APDU',
  'cn.bac.col.vendor': 'Vendor',
  'cn.bac.col.name': 'Tên',
  'cn.bac.col.object': 'Đối tượng',
  'cn.bac.discover.add': 'Thêm',
  'cn.bac.discover.have': 'Đã có',
  'cn.bac.discover.added': 'Đã thêm thiết bị {id}',

  // ---- Thử kết nối và Duyệt đối tượng ----
  'cn.bac.probe.help':
    'Để trống địa chỉ: đọc tên thiết bị (object-name của Device). Có địa chỉ (AI:1, BO:2, MSV:3:units…): đọc một thuộc tính.',
  'cn.bac.probe.value': 'Giá trị {address}: {value} ({kind})',
  'cn.bac.error': 'Lỗi BACnet {reason} (lớp {class}, mã {code})',
  'cn.bac.reason': 'Lý do {reason}',
  'cn.bac.browse.title': 'Duyệt đối tượng',
  'cn.bac.browse.help':
    'Đọc object-list của thiết bị và tên đối tượng; chọn đối tượng để thêm Tag (present-value, kiểu theo loại đối tượng).',
  'cn.bac.browse.run': 'Duyệt đối tượng',
  'cn.bac.browse.count': '{n} đối tượng',
  'cn.bac.browse.truncated': 'Danh sách bị cắt (quá 2000 đối tượng hoặc quá thời gian).',
  'cn.bac.browse.all': 'Chọn mọi đối tượng đọc được',
  'cn.bac.browse.addTags': 'Thêm {n} Tag',
  'cn.bac.browse.added': 'Đã thêm {n} Tag vào Bảng Tag',
  'cn.bac.browse.skip': 'không đọc được',
  'probeCode.BACNET_ERROR': 'thiết bị BACnet trả lời bằng lỗi',
  'probeCode.BACNET_REJECT': 'thiết bị BACnet từ chối yêu cầu',
  'probeCode.BACNET_ABORT': 'thiết bị BACnet hủy giao dịch',
  'probeCode.BACNET_SEGMENTATION': 'câu trả lời cần segmentation (không hỗ trợ)',

  // ---- lý do quality ----
  'tagReason.BACNET_UNKNOWN_OBJECT': 'thiết bị BACnet không có đối tượng này',
  'tagReason.BACNET_UNKNOWN_PROPERTY': 'đối tượng BACnet không có thuộc tính này',
  'tagReason.BACNET_WRITE_DENIED': 'thiết bị BACnet không cho ghi',
  'tagReason.BACNET_VALUE_RANGE': 'giá trị ngoài tầm thiết bị BACnet chấp nhận',
  'tagReason.BACNET_DATA_TYPE': 'sai kiểu dữ liệu BACnet',
  'tagReason.BACNET_ERROR': 'thiết bị BACnet báo lỗi',
  'tagReason.BACNET_REJECT': 'thiết bị BACnet từ chối yêu cầu',
  'tagReason.BACNET_ABORT': 'thiết bị BACnet hủy giao dịch',
  'tagReason.BACNET_SEGMENTATION': 'câu trả lời BACnet quá lớn (cần segmentation)',
  'tagReason.BACNET_TYPE': 'giá trị BACnet không đổi được sang kiểu của Tag',
  'tagReason.BACNET_FAULT': 'đối tượng BACnet báo lỗi (fault)',
  'tagReason.BACNET_OUT_OF_SERVICE': 'đối tượng BACnet out-of-service',
  'tagReason.BACNET_OVERRIDDEN': 'đối tượng BACnet bị ghi đè tại chỗ',

  // ---- Bảng Tag: địa chỉ BACnet ----
  'tagTable.bacnetHint': 'Địa chỉ BACnet: {examples}',
  'tt.hint.bacnet': 'Đối tượng {object} · thuộc tính {property}{priority}',
  'issue.E_CHANNEL_VERSION': 'Kênh loại mới (BACnet/IP) cần project định dạng 1.1',
} as const;
