// Câu tiếng Việt cho mọi mã báo cáo nhập SVG (contract svg-import §6). Chuỗi hiển thị chỉ nằm ở đây.

export const VI_IMPORT: Readonly<Record<string, string>> = Object.freeze({
  // Loại bỏ
  R_SCRIPT: 'Phần tử script bị loại: file SVG nhập vào không được chứa mã chạy',
  R_EVENT_ATTR:
    'Thuộc tính sự kiện (onclick, onload...) bị loại: sự kiện chỉ lấy từ dữ liệu binding',
  R_FOREIGN: 'Phần tử foreignObject bị loại: không nhúng được nội dung HTML trong SVG nhập vào',
  R_NAMESPACE:
    'Phần tử hoặc thuộc tính thuộc namespace khác SVG bị loại (dữ liệu riêng của phần mềm vẽ)',
  R_ELEMENT_NOT_ALLOWED: 'Phần tử không có trong danh sách cho phép nên bị loại cùng phần tử con',
  R_ATTR_NOT_ALLOWED: 'Thuộc tính không có trong danh sách cho phép nên bị loại',
  R_VALUE_INVALID: 'Giá trị thuộc tính không hợp lệ nên thuộc tính bị loại',
  R_HREF_EXTERNAL: 'Liên kết href không phải tham chiếu nội bộ (#id) nên bị loại',
  R_URL_EXTERNAL: 'Giá trị url() trỏ ra ngoài file nên bị loại',
  R_DATA_ATTR: 'Thuộc tính data-* của nguồn bị loại (chỉ giữ UID và tên do công cụ gán)',
  R_CSS_PROP: 'Thuộc tính CSS không có trong danh sách cho phép nên bị loại',
  R_CSS_RULE: 'Luật CSS có bộ chọn không hỗ trợ nên bị loại',
  R_CSS_AT: 'Luật at-rule của CSS (@import, @media, @font-face...) bị loại',
  R_PI: 'Chỉ thị xử lý XML (ví dụ xml-stylesheet) bị loại',
  R_DTD: 'Khai báo DOCTYPE bị loại trước khi đọc file',
  R_IMAGE_LINKED: 'Ảnh liên kết ngoài hoặc tệp cục bộ bị loại: hãy nhúng ảnh vào file SVG',
  R_IMAGE_BAD: 'Ảnh nhúng không hợp lệ (loại, chữ ký hoặc base64 sai) nên bị loại',
  R_IMAGE_LIMIT: 'Ảnh nhúng vượt giới hạn số lượng, dung lượng hoặc tổng điểm ảnh nên bị loại',
  R_FILTER_HEAVY: 'Bộ lọc quá nặng (độ mờ quá lớn) đã được giảm hoặc loại',
  R_FILTER_LIMIT: 'Số bộ lọc hoặc phần tử lọc vượt giới hạn nên phần dư bị loại',
  R_FONT_SVG: 'Font SVG nhúng bị loại: trình duyệt không hỗ trợ',
  R_SMIL: 'Hoạt ảnh SMIL bị loại: hoạt ảnh chỉ thiết lập bằng binding',
  R_META: 'Phần tử metadata hoặc desc bị loại',
  R_EMPTY: 'Phần tử rỗng bị loại',
  R_UNUSED_DEF: 'Định nghĩa không được dùng bị loại',
  R_DANGLING_REF: 'Tham chiếu tới id không tồn tại bị loại',
  R_TEXT_LONG: 'Nút chữ quá dài bị cắt bớt',
  // Chuyển đổi
  C_CSS: 'Luật CSS và thuộc tính style được chuyển thành thuộc tính trình bày',
  C_UNITS: 'Đơn vị độ dài của gốc svg được quy về điểm ảnh (px)',
  C_SWITCH: 'Phần tử switch được thay bằng nhánh dự phòng đầu tiên không phải foreignObject',
  C_FLOWROOT: 'Chữ khung flowRoot được chuyển thành phần tử text một dòng',
  C_FONT_MAP: 'Tên font PostScript được đổi sang tên họ font',
  C_ENTITY: 'Thực thể namespace của Illustrator được thay bằng đường dẫn namespace',
  C_XLINK: 'Thuộc tính xlink:href được chuẩn hóa thành href',
  C_ROUND: 'Số có quá nhiều chữ số thập phân được làm tròn',
  C_DUP_ID: 'id bị trùng được đổi tên để duy nhất',
  // Cảnh báo
  W_IMPORT_CSS_PARTIAL:
    'Một số luật CSS không được hỗ trợ nên có thể làm sai màu hoặc kiểu: hãy kiểm tra hình',
  W_IMPORT_FLOWTEXT_NOWRAP: 'Chữ khung flowRoot mất xuống dòng khi chuyển thành chữ một dòng',
  W_IMPORT_NO_DRAWABLE: 'File không còn phần tử vẽ được nào sau khi làm sạch',
  W_IMPORT_FONT_FALLBACK: 'Font không có trong bảng nên dùng sans-serif làm dự phòng',
  W_IMPORT_HEAVY: 'File sau chuẩn hóa từ 1 MiB trở lên: nặng cho thiết bị và mạng yếu',
  // Lỗi từ chối
  E_IMPORT_LIMIT:
    'File vượt giới hạn (dung lượng, số phần tử hoặc độ sâu): hãy đơn giản hóa hoặc bật Tối ưu',
  E_IMPORT_PARSE: 'File không phải XML hợp lệ',
  E_IMPORT_ENCODING: 'File phải dùng mã hóa UTF-8 hợp lệ',
  E_IMPORT_ROOT: 'Phần tử gốc phải là svg thuộc namespace SVG',
  E_IMPORT_DTD: 'File chứa DOCTYPE hoặc thực thể không được phép (nguy cơ mở rộng thực thể)',
  E_IMPORT_USE_BOMB: 'Các phần tử use mở rộng quá lớn hoặc tạo vòng tham chiếu',
  E_IMPORT_SIZE: 'Không xác định được kích thước: thiếu cả viewBox lẫn width/height',
  E_IMPORT_EXT: 'File tham chiếu tài nguyên ngoài không được phép',
});

export function viMessage(code: string): string {
  return VI_IMPORT[code] ?? `Mã không rõ: ${code}`;
}
