// Chuỗi giao diện của Project mới… (2026-10-20): lệnh, hộp thoại Project mới, hai nút lớn của tab Bắt đầu. Gộp vào
// viMessages ở vi.ts; quy ước như vi.ts.
export const viNewProject = {
  'cmd.project.new': 'Project mới…',

  // ---- Hộp thoại Project mới ----
  'np.title': 'Project mới',
  'np.name': 'Tên project',
  'np.namePh': 'Ví dụ: Trạm bơm Số 1',
  'np.id': 'Mã project',
  'np.idHelp':
    'Tên thư mục và projectId: chữ thường không dấu, số, gạch nối, 2–48 ký tự. Tự sinh từ tên, sửa được.',
  'np.idAuto': 'Sinh lại từ tên',
  'np.folder': 'Thư mục chứa',
  'np.folderPick': 'Chọn…',
  'np.folderPickTip': 'Chọn thư mục chứa project; Studio tạo thư mục con theo mã project',
  'np.folderDefault': 'Mặc định',
  'np.folderDefaultTip': 'Về thư mục mặc định Documents\\mAT SCADA',
  'np.target': 'Project sẽ nằm ở',
  'np.state.free': 'Thư mục mới, sẽ được tạo',
  'np.state.empty': 'Thư mục trống có sẵn, dùng được',
  'np.state.exists': 'Đã có project',
  'np.state.notEmpty': 'Có file khác',
  'np.template': 'Mẫu',
  'np.tpl.blank': 'Trống',
  'np.tpl.blankText': 'Một màn hình lưới Tổng quan với một hàng ô trống; chưa có Tag, kết nối.',
  'np.tpl.pump': 'Mẫu trạm bơm',
  'np.tpl.pumpText':
    'Tag mô phỏng, màn hình lưới Bảng điều khiển, biểu đồ xu hướng, đồng hồ, bảng Tag, faceplate bơm.',
  'np.tpl.dashboard': 'Dashboard tối',
  'np.tpl.dashboardText':
    'Một màn hình dashboard: thẻ chỉ số màu, biểu đồ có tiêu đề và đường ngưỡng, trạng thái bơm; chủ đề Tối.',
  'np.theme': 'Chủ đề giao diện',
  'np.themeHelp': 'Chủ đề của trang vận hành trên thiết bị; đổi lại được trong Thiết lập project.',
  'np.theme.vivid': 'Sáng đa sắc',
  'np.theme.industrial': 'Công nghiệp trầm',
  'np.theme.dark': 'Tối',
  'np.format': 'Định dạng project 1.1 · runtime tối thiểu 1.1.0 · thiết bị BL335',
  'np.do': 'Tạo project',
  'np.creating': 'Đang tạo…',
  'np.err.name': 'Nhập tên project.',
  'np.err.id':
    'Mã project chỉ gồm chữ thường không dấu, số, gạch nối, 2–48 ký tự, bắt đầu bằng chữ hay số, không phải con, nul, com1…',
  'np.err.exists':
    'Thư mục {path} đã có project. Đổi mã project, chọn thư mục khác, hoặc dùng Mở project… để mở nó.',
  'np.err.notEmpty': 'Thư mục {path} đã có file khác. Đổi mã project hoặc chọn thư mục khác.',
  'np.err.noParent': 'Chọn thư mục chứa project.',
  'np.err.badPath': 'Bộ file của mẫu không hợp lệ (lỗi của Studio, hãy báo nhà phát triển).',
  'np.err.io': 'Không tạo được project: {detail}',
  /** Tên màn hình và mục điều hướng của mẫu Trống (nội dung project). */
  'np.blank.screen': 'Tổng quan',
  'np.done': 'Đã tạo project {name} ở {dir}',

  // ---- Tab Bắt đầu ----
  'start.new': 'Tạo project mới',
  'start.newText': 'Từ mẫu trống hoặc mẫu trạm bơm, định dạng 1.1',
  'start.openText': 'Mở thư mục project có sẵn trên máy này',
} as const;
