# mAT Studio: định hướng UX/UI

**Trạng thái:** đề xuất · **Ngày:** 2026-10-10 · **Đi kèm:** [Lộ trình v2](../plans/roadmap-v2.md). Ngăn xếp kỹ thuật (mục 8) chốt bằng ADR-008.

Tham chiếu: TIA Portal và WinCC Unified (Siemens), Ignition Designer, FUXA. Học cách tổ chức công việc của kỹ sư tự động hóa, không sao chép giao diện.

## 1. Vì sao phải làm lại

Studio Sprint 1 là một trang form với 5 tab ngang ([index.html](../../apps/studio/index.html)):

- Không có cấu trúc project (thiết bị, kết nối, Tag, màn hình, alarm). Không xem được hai thứ cùng lúc, ví dụ bảng Tag cạnh màn hình.
- Không có khái niệm **online**: không biết đang làm việc với thiết bị nào, project trên máy khác project trên thiết bị ở đâu.
- Lỗi kiểm tra nằm ở tab riêng, không dẫn tới chỗ sai.
- Bảng Tag là các ô nhập thô: không dán từ Excel, không điền hàng loạt.
- CSS cơ bản: không theme, không icon, mật độ thông tin chưa hợp một công cụ kỹ thuật.

## 2. Học gì, từ đâu

| Mẫu | TIA Portal, WinCC Unified | Ignition Designer, FUXA | Áp dụng cho mAT Studio |
|---|---|---|---|
| Bố cục kiểu IDE | Project view: cây project, vùng làm việc, inspector, task card, details view, editor bar, thanh trạng thái | Project Browser, Tag Browser, Property Editor, Component Palette | Bố cục 7 vùng, dock/thu gọn được, nhớ bố cục (mục 3) |
| Điểm bắt đầu | Portal view theo tác vụ | | Tab "Bắt đầu": project gần đây và tác vụ nhanh. Không làm chế độ riêng như Portal view |
| Tìm thiết bị | Accessible devices: chọn card mạng, Start search, Flash LED | | Hộp thoại **Thiết bị trong mạng** (mục 6.1) |
| Chế độ online | Thanh tiêu đề và khung vùng làm việc màu cam; biểu tượng so sánh trên cây | Trạng thái kết nối Gateway | Viền cam; chấm trạng thái trên cây và thanh dưới |
| Nạp xuống | Download: Load preview (kiểm tra, hành động) rồi Load results | Save và publish | **Nạp xuống** có bước xem trước và bước kết quả (mục 6.2) |
| Đọc lên, so sánh | Upload from device; Compare offline/online | | **Đọc lên**, **So sánh** (mục 6.3) |
| Bảng như Excel | PLC tag table, HMI tags: điền xuống, dán từ Excel | Nhập/xuất Tag CSV, JSON | Lưới cho Tag, Alarm, Lưu trữ, Bảng giá trị |
| Gắn động theo thuộc tính | Cột Dynamization cạnh mỗi thuộc tính; tab Events gọi system function | Binding Tag/Expression/Property + transform; panel thuộc tính của FUXA | Inspector có ô gắn Tag, biểu thức hoặc bảng giá trị cạnh mỗi thuộc tính; tab Sự kiện chọn hành động có sẵn, không script |
| Ánh xạ giá trị thành chữ | Text and graphic lists | Map transform | **Bảng giá trị** |
| Alarm | HMI alarms (discrete, analog), alarm class | Alarm cấu hình trên Tag | Bảng Alarm và lớp Alarm |
| Lưu trữ | Logging tags: Cyclic, On change, On demand | Tag history: on change, periodic, deadband | Editor lưu trữ có ước tính ghi eMMC |
| Thư viện | Library, faceplate | Template, View; widget của FUXA | Toolbox widget, thư viện ký hiệu SVG |
| Tham chiếu chéo | Cross-references | Find/Replace, tag usage | "Dùng ở đâu" cho Tag và bảng giá trị |
| Thông báo kiểm tra | Inspector, tab Info: kết quả compile, nhấp đúp tới chỗ lỗi | Output console | Inspector, tab Thông tin: lỗi validator, nhấp đúp nhảy tới ô hoặc phần tử |

**Không học:** khởi động và mở project chậm, hộp thoại lồng nhau, menu sâu, compile và nạp lâu. Studio kiểm tra liên tục khi sửa (bản hiện tại đã tự kiểm lại sau mỗi lần sửa), ít hộp thoại modal, mọi lệnh tìm được trong bảng lệnh (Ctrl+Shift+P).

## 3. Bố cục cửa sổ chính

```text
┌─ mAT Studio · TankDemo ───────────────────────────────────────── ● Online: BL335-01 ─┐
│ Project   Sửa   Xem   Online   Công cụ   Trợ giúp                                    │
│ [Lưu] [Hoàn tác] [Làm lại] | [Kiểm tra] | [Nạp xuống] [Đọc lên] [So sánh] | [Online] │
├─────────────────────┬─────────────────────────────────────────────┬──────────────────┤
│ CÂY PROJECT         │ [Bắt đầu] [Bảng Tag ×] [Tổng quan ×]        │ TOOLBOX          │
│ ▼ TankDemo          │                                             │ ► Hiển thị       │
│   ▼ BL335-01  ●     │                                             │ ► Điều khiển     │
│     ► Kết nối       │                                             │ ► Biểu đồ        │
│     ► Tag           │           VÙNG LÀM VIỆC (editor)            │ ► Alarm          │
│     ► Bảng giá trị  │   bảng, form hoặc canvas màn hình           │ ► Ký hiệu SVG    │
│     ► Alarm         │                                             ├──────────────────┤
│     ► Lưu trữ       │                                             │ THƯ VIỆN         │
│     ▼ Màn hình      ├─────────────────────────────────────────────┤ CÔNG CỤ ONLINE   │
│         Tổng quan * │ INSPECTOR  [Thuộc tính] Thông tin Chẩn đoán │                  │
│         Bơm (popup) │ Chung Hiển thị [Gắn Tag] Sự kiện Bảo mật    │                  │
├─────────────────────┤ Giá trị    TANK01.LEVEL         [Tag ▼]     │                  │
│ DETAILS             │ Định dạng  0.0 "%"                          │                  │
│ TANK01.LEVEL FLOAT32│ Màu nền    TankState            [Bảng ▼]    │                  │
│ PUMP01.RUN   BOOL   │                                             │                  │
├─────────────────────┴─────────────────────────────────────────────┴──────────────────┤
│ ● BL335-01  192.168.1.110  runtime 0.2.0  project 1.3 = khớp  0 lỗi  2 cảnh báo      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

| Vùng | Nội dung | Hành vi |
|---|---|---|
| Thanh tiêu đề, menu | Project, Sửa, Xem, Online, Công cụ, Trợ giúp; chỉ báo online | Viền cam khi online |
| Thanh công cụ | Lưu, hoàn tác, làm lại, Kiểm tra, Nạp xuống, Đọc lên, So sánh, Online/Offline, Mô phỏng | Icon kèm tooltip có phím tắt |
| Cây project (trái, trên) | Cấu trúc project (mục 4) | Thu gọn được; chấm trạng thái khi online |
| Details (trái, dưới) | Danh sách phần tử của nút đang chọn, ví dụ Tag của một bảng | Kéo Tag thả vào thuộc tính |
| Vùng làm việc (giữa) | Editor dạng tab, tách đôi được | Tab có dấu khi chưa lưu |
| Task card (phải) | Toolbox, Thư viện, Công cụ online (chẩn đoán), Tìm và thay thế | Đổi theo editor đang mở |
| Inspector (giữa, dưới) | Thuộc tính, Thông tin, Chẩn đoán | Thuộc tính theo đối tượng đang chọn |
| Thanh trạng thái | Thiết bị, IP, phiên bản runtime, project khớp hay khác, số lỗi và cảnh báo, tiến trình | Nhấp số lỗi mở tab Thông tin |

## 4. Cây project

```text
TankDemo
├─ Bắt đầu
├─ BL335-01 (192.168.1.110)            ● online · khớp
│  ├─ Thiết lập thiết bị                mạng, thời gian, số client
│  ├─ Kết nối
│  │  ├─ PLC_Bom                        Modbus TCP
│  │  └─ RS485_1                        Modbus RTU
│  ├─ Tag
│  │  ├─ Bảng Tag mặc định
│  │  └─ Tag tính toán
│  ├─ Bảng giá trị
│  ├─ Alarm
│  │  ├─ Danh sách alarm
│  │  └─ Lớp alarm
│  ├─ Lưu trữ
│  ├─ Màn hình
│  │  ├─ Tổng quan                      màn hình đầu
│  │  └─ Bơm                            popup
│  ├─ Báo cáo
│  └─ Người dùng và quyền
└─ Thư viện project                     ký hiệu, widget mẫu
```

Hiện mỗi project có một thiết bị; cấu trúc chừa chỗ cho nhiều thiết bị sau này.

## 5. Các kiểu editor

| Editor | Dùng cho | Quy tắc |
|---|---|---|
| Lưới | Tag, Alarm, Lưu trữ, Bảng giá trị, Người dùng | Ảo hóa, mượt với ≥ 2.000 dòng; sửa tại ô; lỗi theo ô (viền đỏ, chi tiết ở tab Thông tin); điền xuống (Ctrl+D) và kéo điền tăng dần (`TANK_01`, `TANK_02`…); dán từ Excel; sửa nhiều dòng cùng lúc; lọc, tìm, chọn cột; nhập/xuất CSV; khi online có thêm cột giá trị sống và quality |
| Form | Kết nối, Thiết lập thiết bị, Project | Chia nhóm; nút "Thử kết nối"; trợ giúp ngay dưới ô |
| Màn hình | Màn hình, popup | Canvas zoom/pan/lưới/snap; Toolbox bên phải; Inspector bên dưới; thước, căn chỉnh, xếp lớp; nút Xem trước (mô phỏng hoặc thiết bị) |
| So sánh | Máy này và thiết bị, hai phiên bản | Cây hai cột có biểu tượng trạng thái; chi tiết khác biệt theo trường |

Inspector, tab Thuộc tính, cho đối tượng trên màn hình chia nhóm Chung, Hiển thị, Gắn Tag, Sự kiện, Bảo mật. Mỗi dòng thuộc tính gồm: tên, giá trị tĩnh, nút gắn động (Tag, biểu thức hoặc bảng giá trị), giống cột Dynamization của WinCC.

## 6. Ba luồng online chính

### 6.1 Thiết bị trong mạng

```text
┌─ Thiết bị trong mạng ──────────────────────────────────────────────────────────────┐
│ Card mạng: [Ethernet 2 · 192.168.1.20/24 ▼]    [Tìm lại]    [ ] Nháy LED thiết bị  │
│                                                                                    │
│   Tên        IP              Runtime   Project          Trạng thái                 │
│ ● BL335-01   192.168.1.110   0.2.0     TankDemo 1.3     Đang chạy                  │
│ ○ BL335-02   192.168.1.111   0.2.0     —                Chưa có project            │
│ ● BL335-07   192.168.1.117   0.1.0     PlantA 2.0       Project lỗi                │
│                                                                                    │
│ [+ Thêm theo địa chỉ...]                      [Đọc lên thành project mới] [Online] │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- Quét tự động khi mở hộp thoại, xong trong ≤ 3 s; chọn một dòng thì hiện thêm model, MAC, serial, fingerprint chứng chỉ.
- Thiết bị khác subnet hoặc qua WAN: **Thêm theo địa chỉ** (broadcast không qua router).
- Lần kết nối đầu: hiện fingerprint chứng chỉ để xác nhận rồi ghim; sau đó hỏi tài khoản thiết bị.
- "Nháy LED" chỉ có nếu phần cứng BL335 có LED điều khiển được (cần kiểm).

### 6.2 Nạp xuống

```text
┌─ Nạp xuống BL335-01: xem trước ────────────────────────────────────────────────────┐
│ Trạng thái  Mục                      Thông tin, hành động                          │
│ [OK]        Kiểm tra project         0 lỗi, 2 cảnh báo (xem)                       │
│ [OK]        Tương thích runtime      Project cần ≥ 0.2.0, thiết bị 0.2.1           │
│ [!]         Thay project đang chạy   TankDemo 1.2 -> 1.3 (so sánh)                 │
│ [!]         Client đang kết nối      4 client sẽ tự tải lại trang                  │
│ [OK]        Dung lượng               1,2 MB / 50 MB                                │
│                                                                                    │
│ [ ] Lưu kèm nguồn project (để đọc lên lại đầy đủ)                                  │
│                                                        [Hủy]  [Nạp xuống  Ctrl+L]  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- Có lỗi thì nút Nạp xuống bị khóa; cảnh báo thì cần đọc và xác nhận.
- Sau khi bấm: thanh tiến trình theo từng bước stage, validate, backup, activate, health check; rồi màn hình kết quả. Thất bại thì thiết bị tự rollback, Studio hiện lý do và nút **Khôi phục bản trước**.

### 6.3 So sánh máy này và thiết bị

```text
┌─ So sánh: TankDemo (máy này) <-> BL335-01 ─────────────────────────────────────────┐
│     Đối tượng                        Máy này      Thiết bị                         │
│  =  Kết nối / PLC_Bom                giống        giống                            │
│  ≠  Tag / Bảng Tag mặc định          52 Tag       50 Tag        (chi tiết)         │
│  +  Màn hình / Bơm (popup)           có           —                                │
│  -  Alarm / AL_TANK_LOW              —            có                               │
│                                                                                    │
│  = giống   ≠ khác   + chỉ có trên máy   - chỉ có trên thiết bị                     │
│                                     [Đọc lên phần chọn]  [Nạp xuống]  [Đóng]       │
└────────────────────────────────────────────────────────────────────────────────────┘
```

- So theo digest từng file trước, rồi so theo đối tượng (Tag, alarm, màn hình) để hiện khác biệt có nghĩa thay vì khác biệt dòng JSON.
- Khi online, cây project hiện cùng biểu tượng `=`, `≠`, `+`, `-` cạnh từng nút.

## 7. Hệ thống thiết kế

- **Token:** màu, chữ, khoảng cách, bo góc khai báo bằng CSS custom properties; theme sáng và tối; component không dùng mã màu cứng.
- **Màu:** nền xám trung tính, một màu nhấn (màu thương hiệu, chờ chốt). Màu trạng thái cố định trong cả Studio và runtime: xanh lá là tốt/online, vàng hổ phách là cảnh báo, đỏ là lỗi/alarm, xanh dương là thông tin, cam là đang online (viền), xám là offline/không rõ. Tương phản chữ ≥ 4,5:1 ở cả hai theme. Màu không bao giờ là tín hiệu duy nhất: luôn kèm icon hoặc chữ.
- **Chữ:** Segoe UI Variable (Windows 11) hoặc Segoe UI, 13 px cho giao diện, 12 px trong lưới dày; Cascadia Mono hoặc Consolas cho địa chỉ, biểu thức, mã lỗi.
- **Mật độ:** dòng lưới và cây cao 24 px (gọn) hoặc 28 px (thoáng); khoảng cách theo bội số 4 px.
- **Icon:** một bộ duy nhất, ví dụ Fluent UI System Icons (MIT) cho hợp Windows; 16 px trong cây và lưới, 20 px trên thanh công cụ.
- **Phím tắt:** Ctrl+S lưu, Ctrl+Z và Ctrl+Y, Ctrl+F tìm, Ctrl+Shift+P bảng lệnh, Ctrl+D điền xuống, F2 đổi tên. Giữ giống TIA cho người đã quen: Ctrl+K online, Ctrl+M offline, Ctrl+L nạp xuống.
- **Chuyển động:** ≤ 150 ms; tắt khi Windows bật giảm hiệu ứng.
- **Bàn phím và trợ năng:** mọi lệnh dùng được bằng bàn phím; viền focus rõ; ARIA cho cây, lưới, tab.
- **Ngôn ngữ:** tiếng Việt mặc định; chuỗi giao diện tách file riêng để thêm tiếng Anh.

## 8. Ngăn xếp kỹ thuật đề xuất (chốt bằng ADR-008)

| Phần | Đề xuất | Lý do |
|---|---|---|
| Khung | Giữ Tauri 2, TypeScript, Vite | Constitution, đã chạy ổn |
| Component | Lit (web component, BSD-3-Clause, khoảng 5 KB nén) | Dùng chung cho widget runtime (`packages/ui-components`) và Studio (Constitution II); không cần framework nặng; chạy được dưới CSP `script-src 'self'` |
| Docking | dockview-core (MIT, không phụ thuộc framework) | Tab, tách vùng, kéo thả panel, lưu bố cục |
| Lưới | So sánh trong ADR: tự viết lưới ảo hóa trên Lit hoặc thư viện MIT | Cần sửa tại ô, dán Excel, ≥ 2.000 dòng |
| Canvas | SVG.js, interact.js | Đã chọn trong Master Plan §4 |
| Biểu đồ | uPlot (MIT) | Đã chọn; dùng chung với runtime |
| Icon | Fluent UI System Icons (MIT) | Hợp giao diện Windows |

Giữ quy tắc hiện có: không `innerHTML` với dữ liệu project, không `eval`, CSP chặt, giao diện không tự đọc/ghi file ngoài thư mục project (lệnh Rust kiểm soát).

## 9. Làm theo giai đoạn

| GĐ | Phần giao diện |
|---|---|
| 1 | Khung mới, tab Bắt đầu, cây project, inspector, thanh trạng thái, theme; Thiết bị trong mạng, Online, Đọc lên, So sánh, Nạp xuống; chuyển cấu hình, bảng Tag, kiểm tra, xem trước cũ sang khung mới |
| 2 | Lưới (Tag, Bảng giá trị), form Kết nối, Tag tính toán, Bảng theo dõi online, chẩn đoán driver, mô phỏng |
| 3a | Editor màn hình, Toolbox widget, inspector Gắn Tag và Sự kiện |
| 3b | Import SVG, cây phần tử SVG, gắn Tag cho phần tử, thư viện ký hiệu |
| 4, 5 | Editor Alarm, Lưu trữ, mẫu báo cáo |

Trước khi code GĐ 1 nên làm một **mockup HTML tương tác** của khung mới (cây, tab, inspector, ba hộp thoại online) để chốt bố cục và màu với người dùng.
