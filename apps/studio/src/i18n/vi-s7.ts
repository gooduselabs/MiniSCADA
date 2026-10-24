// Chuỗi giao diện của driver Siemens S7 (feature 016, US4): form kênh và CPU, Bảng Tag với địa chỉ S7, Chẩn đoán driver, lý do
// quality và lỗi của bộ kiểm tra. Gộp vào viMessages ở vi.ts; quy ước như vi.ts. Câu của lý do quality theo
// schemas/error-codes.json (viết thường đầu câu như tagReason.* khác).
export const viS7 = {
  // ---- Kết nối: kênh S7 ----
  'cn.kind.s7': 'Siemens S7',
  'cn.add.s7': 'Thêm kênh Siemens S7',
  'cn.newCpu': 'CPU {n}',
  'cn.h.s7Host': 'IPv4 hoặc tên máy của CPU S7 (hoặc CP Ethernet), ví dụ 192.168.0.1.',
  'cn.h.s7Port': '1–65535. Mặc định 102 (ISO-on-TCP).',
  'cn.f.rack': 'Rack',
  'cn.h.rack': '0–7. Mặc định 0. S7-1200/1500: 0.',
  'cn.f.slot': 'Slot',
  'cn.h.slot': '0–31. Mặc định 1. S7-1200/1500: 1; S7-300: 2; S7-400: theo cấu hình phần cứng.',
  'cn.f.pduSize': 'PDU xin',
  'cn.h.pduSize':
    '240–960 byte. Mặc định 480. PLC trả kích thước thật khi kết nối (xem Chẩn đoán driver).',
  'cn.f.localTsap': 'TSAP nguồn',
  'cn.h.localTsap': '4 chữ số hex, ví dụ 0100. Để trống thì dùng 0100 (kiểu PG).',
  'cn.f.remoteTsap': 'TSAP đích',
  'cn.h.remoteTsap':
    '4 chữ số hex, ví dụ 0301. Thay cho rack và slot (LOGO!, CP cấu hình riêng): nhập TSAP thì bỏ trống rack và slot.',
  'cn.h.s7Retries': '0–5, chỉ cho lệnh đọc. Mặc định 0.',
  'cn.f.maxGapBytes': 'Khoảng trống gộp (byte)',
  'cn.h.maxGapBytes':
    '0–256. Mặc định 16. Hai Tag cùng vùng cách nhau không quá số byte này thì đọc chung một lần.',
  'cn.err.tsap': 'TSAP gồm đúng 4 chữ số hex (0–9, A–F), ví dụ 0301',
  'cn.s7.tsapConflict':
    'Đã nhập TSAP đích: bỏ trống rack và slot (hoặc xóa TSAP đích để dùng rack và slot)',
  'cn.s7.needs11':
    'Kênh Siemens S7 cần project định dạng 1.1: project này chưa ở định dạng 1.1 nên chưa nạp xuống được.',
  'cn.s7.oneDevice': 'Mỗi kênh Siemens S7 là một CPU: thêm kênh S7 mới cho CPU khác',
  'cn.s7.probeTitle': 'Thử kết nối',
  'cn.s7.probeNote':
    'Thử kết nối chưa hỗ trợ kênh Siemens S7; nạp xuống và xem Chẩn đoán driver (PDU đã thương lượng, lỗi của PLC).',
  'cn.s7.putget':
    'PLC S7-1200/1500: bật “Permit access with PUT/GET” và tắt “Optimized block access” của DB cần đọc trong TIA Portal.',

  // ---- Bảng Tag: địa chỉ S7 ----
  'tt.err.s7Address':
    'Địa chỉ S7 không đúng cú pháp. Ví dụ: DB1.DBX0.0, DB1.DBW2, DB1.DBD4, DB1.STRING10, MW10, I0.1, Q0.0',
  'tt.err.s7AddressArea':
    'Địa chỉ S7 không hợp với kiểu thô hoặc quyền của Tag (vùng I chỉ đọc; W: INT16/UINT16, D: INT32/UINT32/FLOAT32, LREAL: FLOAT64)',
  'tt.err.s7AddressRange': 'Địa chỉ S7 ngoài khoảng (DB 1–65535, byte 0–65535, bit 0–7)',
  'tt.hint.s7Syntax':
    'Địa chỉ S7: DB1.DBX0.0, DB1.DBW2, DB1.DBD4, DB1.STRING10, DB1.LREAL8, MW10, I0.1, Q0.0',
  'tt.hint.s7Address': 'Vùng {area} · kiểu S7 {type} · {size} byte',
  'tt.err.s7ByteOrder': 'PLC S7 luôn big-endian: không đặt thứ tự byte cho Tag S7',

  // ---- Chẩn đoán driver ----
  'dd.kind.s7': 'Siemens S7',
  'dd.channel.pdu': 'PDU đã thương lượng: {n} byte',
  'dd.channel.tsap': 'TSAP nguồn {local} · đích {remote}',
  'dd.row.s7item': 'Lỗi PLC {code}',
  's7Ex.1': 'lỗi phần cứng',
  's7Ex.3': 'truy cập bị từ chối',
  's7Ex.5': 'địa chỉ ngoài vùng',
  's7Ex.6': 'kiểu không hỗ trợ',
  's7Ex.7': 'kiểu không khớp',
  's7Ex.10': 'DB không có',
  's7Ex.33028': 'chưa bật PUT/GET',
  's7Ex.other': 'lỗi khác của PLC',

  // ---- Lý do quality và lỗi kênh (schemas/error-codes.json) ----
  'tagReason.S7_ACCESS_DENIED':
    'PLC S7 từ chối truy cập vùng nhớ (DB đang bật “Optimized block access” hoặc bị bảo vệ)',
  'tagReason.S7_ADDRESS_OUT_OF_RANGE': 'địa chỉ S7 vượt quá kích thước DB hoặc vùng nhớ của PLC',
  'tagReason.S7_HARDWARE_FAULT': 'PLC S7 báo lỗi phần cứng khi đọc vùng nhớ',
  'tagReason.S7_ITEM_ERROR': 'PLC S7 báo lỗi khác khi đọc hoặc ghi vùng nhớ',
  'tagReason.S7_OBJECT_NOT_FOUND': 'DB không có trên PLC S7',
  'tagReason.S7_PDU_TOO_SMALL': 'Tag lớn hơn một lần đọc với kích thước PDU mà PLC S7 chấp nhận',
  'tagReason.S7_REQUEST_ERROR': 'PLC S7 từ chối yêu cầu (lỗi ở đầu khung trả lời)',
  'tagReason.S7_TYPE_INCONSISTENT': 'PLC S7 báo kiểu dữ liệu không khớp',
  'tagReason.S7_TYPE_NOT_SUPPORTED': 'PLC S7 không hỗ trợ kiểu dữ liệu được yêu cầu',
  'tagReason.S7_FUNCTION_NOT_AVAILABLE':
    'PLC S7 từ chối đọc/ghi: thường do chưa bật “Permit access with PUT/GET” trong TIA Portal',
  'tagReason.S7_CONNECT_REJECTED': 'PLC S7 từ chối kết nối ISO-on-TCP (sai rack/slot hoặc TSAP)',
  'tagReason.S7_SETUP_FAILED': 'PLC S7 không chấp nhận thương lượng PDU (Setup Communication)',

  // ---- Lỗi của bộ kiểm tra ----
  'issue.E_DRIVER_VERSION':
    'kênh Siemens S7 cần project định dạng 1.1 (nâng cấp project trước khi thêm kênh S7)',
  'issue.E_S7_TSAP': 'kênh S7: nhập TSAP đích (remoteTsap) thì bỏ rack và slot, hoặc ngược lại',
  'issue.E_ADDR_SYNTAX.s7':
    'địa chỉ S7 không đúng cú pháp (ví dụ DB1.DBX0.0, DB1.DBW2, DB1.DBD4, DB1.STRING10, MW10, I0.1, Q0.0)',
  'issue.E_ADDR_AREA.s7': 'địa chỉ S7 không hợp với kiểu thô hoặc quyền của Tag',
  'issue.E_ADDR_RANGE.s7': 'địa chỉ S7 ngoài khoảng (DB 1–65535, byte 0–65535, bit 0–7)',
  'issue.E_ADDR_READ_LIMIT.s7': 'Tag lớn hơn một lần đọc với PDU của kênh S7 (PDU − 18 byte)',
  'issue.E_ADDR_WRITE_LIMIT.s7':
    'Tag ghi được lớn hơn một lần ghi với PDU của kênh S7 (PDU − 28 byte)',
  'issue.E_SCHEMA.s7ByteOrder': 'Tag S7 không có thứ tự byte (PLC S7 luôn big-endian)',
} as const;
