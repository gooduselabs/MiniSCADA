// Chuỗi giao diện của kênh Mitsubishi MC (feature 017, US4, FR-011; specs/017-driver-mc/plan.md "Hợp đồng định dạng",
// contracts/mc-protocol.md §1, §4): lệnh Thêm kênh, trường của form kênh và thiết bị trường, gợi ý tại ô, địa chỉ Tag MC,
// lý do quality theo end code, chẩn đoán. Gộp vào viMessages ở vi.ts; quy ước như vi.ts.
export const viMc = {
  // ---- Lệnh, loại kênh ----
  'cmd.connections.addMc': 'Thêm kênh Mitsubishi MC',
  'cn.add.mc': 'Thêm kênh Mitsubishi MC',
  'cn.kind.mc': 'Mitsubishi MC',
  'dd.kind.mc': 'Mitsubishi MC',
  'cn.sub.mcDevice': 'mạng {network} · trạm {station}',
  'cn.mc.need11':
    'Kênh Mitsubishi MC cần project định dạng 1.1 (nâng cấp project ở Cài đặt project)',
  'issue.E_CHANNEL_VERSION': 'loại kênh này cần project định dạng 1.1 (nâng cấp project)',

  // ---- Nhóm của form ----
  'cn.group.frame': 'Khung',
  'cn.group.routing': 'Định tuyến',
  'cn.group.batch': 'Gom yêu cầu',
  'cn.group.write': 'Ghi',

  // ---- Trường của kênh MC ----
  'cn.f.mcHost': 'Địa chỉ máy',
  'cn.h.mcHost':
    'IPv4 hoặc tên máy của CPU có cổng Ethernet hay module Ethernet của PLC, ví dụ 192.168.3.39.',
  'cn.f.mcPort': 'Cổng',
  'cn.h.mcPort':
    '1–65535. Mặc định 5007. Phải trùng cổng đã mở cho SLMP/MC protocol trong GX Works (thiết lập Ethernet).',
  'cn.f.mcFrame': 'Khung',
  'cn.h.mcFrame':
    '3E (mặc định) cho đa số PLC; 4E có thêm số thứ tự để ghép yêu cầu và trả lời (iQ-R, iQ-F, Q mới).',
  'cn.f.mcCode': 'Mã truyền',
  'cn.h.mcCode': 'binary (mặc định) hoặc ascii. Phải trùng "mã truyền" đã đặt trong PLC.',
  'cn.f.mcTransport': 'Giao thức',
  'cn.h.mcTransport': 'tcp (mặc định) hoặc udp. PLC phải mở cổng cùng loại.',

  // ---- Trường của thiết bị trường MC ----
  'cn.f.xyNotation': 'Cách viết X, Y',
  'cn.h.xyNotation':
    'hex (mặc định: Q, L, iQ-R) hoặc octal (FX5U, iQ-F: X17 là điểm thứ 15). Áp cho địa chỉ X, Y của Tag.',
  'cn.f.network': 'Mạng (network No.)',
  'cn.h.network': '0–239. Mặc định 0: PLC nối trực tiếp, không qua mạng khác.',
  'cn.f.station': 'Trạm (PC No.)',
  'cn.h.station':
    '0–255. Mặc định 255 (FF): CPU nối trực tiếp. Qua mạng khác: số trạm của PLC đích.',
  'cn.f.moduleIo': 'Module I/O đích',
  'cn.h.moduleIo':
    'Viết hex 0000–FFFF. Mặc định 03FF: CPU nối trực tiếp. 03E0–03E3: CPU 1–4 của hệ nhiều CPU.',
  'cn.f.moduleStation': 'Trạm module đích',
  'cn.h.moduleStation': '0–255. Mặc định 0. Chỉ đổi khi nối nhiều trạm (multidrop).',
  'cn.f.maxBatchWords': 'Tối đa word mỗi lần đọc',
  'cn.h.maxBatchWords':
    '1–960. Mặc định 960 (giới hạn đọc khối của MC). Tag dài hơn số này báo lỗi E_ADDR_READ_LIMIT.',
  'cn.f.maxGapWords': 'Khoảng trống gộp (word)',
  'cn.h.maxGapWords':
    '0–960. Mặc định 16. Hai Tag cùng thiết bị cách nhau không quá số word này thì đọc chung một khối.',
  'cn.f.randomRead': 'Đọc rải (Random Read)',
  'cn.h.randomRead':
    'Gom các Tag lẻ ở nhiều thiết bị (D, W, M…) vào một yêu cầu. Mặc định bật; tắt nếu PLC không hỗ trợ lệnh 0403.',
  'cn.f.maxRandomPoints': 'Tối đa điểm mỗi lần đọc rải',
  'cn.h.maxRandomPoints': '1–192. Mặc định 192.',
  'cn.f.mcRegisterBit': 'Ghi bit trong word',
  'cn.h.mcRegisterBit':
    'Tag D100.5 ghi được: none (mặc định, không cho ghi) hoặc rmw (đọc word, đổi bit, ghi lại).',

  // ---- Gợi ý tại ô (cảnh báo mềm, không chặn) ----
  'mc.hint.port502': 'Cổng 502 là cổng Modbus TCP; PLC Mitsubishi thường mở 5007 hoặc cổng tự đặt',
  'mc.hint.ascii': 'Khung ASCII dài gấp đôi binary: chỉ chọn khi PLC đặt mã truyền ASCII',
  'mc.hint.udp': 'UDP không nối lại: gói mất thì tính là hết thời gian chờ và đọc lại ở chu kỳ sau',
  'mc.hint.stationDirect': 'Mạng 0 là PLC nối trực tiếp: trạm thường là 255 (FF)',
  'mc.hint.stationRemote': 'Qua mạng khác: cần số trạm của PLC đích (thường 1–120), không phải FF',
  'mc.hint.moduleIo':
    'Module I/O lạ: 03FF là CPU nối trực tiếp, 03E0–03E3 là CPU 1–4, 03D0–03D3 là hệ dự phòng',
  'mc.hint.randomOff': 'Đã tắt đọc rải: giá trị này không dùng',
  'mc.hint.rmw':
    'Ghi kiểu đọc-sửa-ghi có thể đè thay đổi của chương trình PLC giữa hai bước (W_BIT_RMW)',
  'mc.hint.gapOverBatch': 'Khoảng trống gộp lớn hơn số word mỗi lần đọc: chỉ có tác dụng tới {n}',
  'cn.err.hex': 'Cần số hex 0000–FFFF (ví dụ 03FF)',

  // ---- Thử kết nối ----
  'cn.probe.mcLater':
    'Thử kết nối cho kênh Mitsubishi MC chưa có ở bản này. Hãy Nạp xuống rồi xem trang Chẩn đoán driver.',

  // ---- Địa chỉ Tag MC (Bảng Tag, Thuộc tính) ----
  'tt.err.mcAddress': 'Địa chỉ MC không đúng cú pháp (ví dụ D100, M10, X1F, D100.5, ZR1000)',
  'tt.err.mcOctal': 'Thiết bị trường viết X, Y bát phân: chỉ dùng chữ số 0–7 (ví dụ X17)',
  'tt.err.mcAddressArea':
    'Thiết bị MC không hợp với kiểu hoặc quyền: X, Y, M, L, B, SM chỉ BOOL; D100.5 chỉ BOOL; D, W, R… không BOOL nếu không có .bit; X chỉ đọc',
  'tt.err.mcAddressRange': 'Số thiết bị vượt giới hạn FFFFFF',
  'tt.hint.mcSyntax': 'Địa chỉ Mitsubishi MC: {examples}',
  'tt.hint.mc': 'MC {device} ({area}) · số {number} · {words} word',
  'tt.hint.mcBit': 'MC {device} (bit {bit} trong word) · số {number} · 1 word',
  'tt.mc.area.bit': 'thiết bị bit',
  'tt.mc.area.word': 'thiết bị word',

  // ---- Lý do quality theo end code (contracts/mc-protocol.md §4) ----
  'tagReason.MC_END_RANGE': 'PLC báo địa chỉ hoặc số điểm ngoài vùng',
  'tagReason.MC_END_DEVICE': 'PLC báo thiết bị không đọc/ghi được hoặc chỉ định sai',
  'tagReason.MC_END_COMMAND':
    'PLC không nhận lệnh: lệnh, độ dài hoặc mã binary/ASCII không khớp cấu hình PLC',
  'tagReason.MC_END_OTHER': 'PLC trả end code lỗi khác',

  // ---- Chẩn đoán driver ----
  'dd.row.mcEndCode': 'End code {code}: {meaning}',
  'mc.end.MC_END_RANGE': 'địa chỉ hoặc số điểm ngoài vùng',
  'mc.end.MC_END_DEVICE': 'thiết bị không đọc/ghi được',
  'mc.end.MC_END_COMMAND': 'lệnh hoặc mã không khớp cấu hình PLC',
  'mc.end.MC_END_OTHER': 'lỗi khác của PLC',
} as const;
