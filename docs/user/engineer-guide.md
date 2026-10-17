# Hướng dẫn kỹ sư: dựng project bằng mAT Studio

Dành cho kỹ sư tự động hóa dựng project, nạp xuống BL335 và chẩn đoán. Làm theo thứ tự các mục; mỗi mục có tác vụ kiểm tra ở [mục 14](#14-bảng-tác-vụ-kiểm-tra). Bài thực hành dùng project mẫu `projects/training-demo/`.

Áp dụng cho bản 1.0: Studio 1.0, runtime 1.0.0 (API thiết bị 1.5.0), định dạng project 1.0.0. Studio vẫn mở được project định dạng 0.1 đến 0.6 (mục 3); logic, template và faceplate cần định dạng 1.0.0 và runtime 1.0.0 trở lên. Thuật ngữ: [glossary.md](glossary.md). Mã lỗi: [error-codes.md](error-codes.md).

Ảnh chụp màn hình: chờ (tài liệu chưa có ảnh; tên nút, menu và thông báo được trích nguyên văn từ Studio).

## 1. Chuẩn bị

- Máy Windows 10/11 đã cài mAT Studio. Cài đặt: [admin-guide.md](admin-guide.md) mục 2.
- Tài khoản trên thiết bị có vai trò `engineer` (nạp xuống, đọc lên, khôi phục) hoặc `administrator`.
- PLC thật, hoặc PLC giả lập trên máy tính (dưới đây).
- Bản sao của `projects/training-demo/` (chép cả thư mục sang chỗ làm việc của bạn).

**PLC giả lập Modbus TCP** (cần Node.js, chạy từ thư mục mã nguồn của mAT SCADA):

```sh
node tools/modbus-sim/sim.mjs --tcp 1502 --control 1503 --map tools/modbus-sim/maps/training-demo.json
```

Giả lập mở cổng 1502 trên máy tính, có mức bồn (`HR100`) và lưu lượng (`HR101`) dao động, mức đặt (`HR200`), lệnh bơm (`C10`), bit lỗi bơm (`HR12.3`). Giả lập chỉ dùng cho huấn luyện và thử, không dùng ở nhà máy.

<a id="help-studio"></a>

## 2. Giao diện Studio

Studio bố trí như một công cụ kỹ thuật: cây project bên trái, vùng editor theo tab ở giữa, Inspector bên phải, thanh trạng thái ở dưới.

- Menu: **Project**, **Sửa**, **Xem**, **Online**, **Công cụ**, **Trợ giúp**.
- Thanh công cụ: Lưu, hoàn tác, **Kiểm tra**, **Nạp xuống**, **Đọc lên**, **So sánh**, **Online**/**Offline**, **Thiết bị**, **Mô phỏng**, **Tìm lệnh…** (Ctrl+Shift+P).
- Thanh trạng thái: trạng thái thiết bị ("Không kết nối", "Đang theo dõi", "Online"), tài khoản, số lỗi và cảnh báo, chip so sánh với thiết bị, nhãn "MÔ PHỎNG" khi đang mô phỏng.
- Chế độ Online có viền cam quanh cửa sổ.
- Task card bên phải đổi theo editor đang mở: **Toolbox** (widget, ký hiệu) ở editor Màn hình, **Khối / Tag** ở editor Logic, **Công cụ vẽ** (công cụ và bảng màu tô, màu viền) ở trình vẽ SVG.
- Phím tắt: menu **Trợ giúp** > **Phím tắt**.
- Tài liệu này: menu **Trợ giúp** > **Hướng dẫn sử dụng** (F1) mở bản HTML đi kèm bộ cài, đúng mục của editor đang mở; không cần mạng.

<a id="help-project"></a>

## 3. Mở và tạo project

Studio chưa có lệnh "tạo project trống". Có hai cách bắt đầu:

- **Từ project mẫu:** chép `projects/training-demo/` thành thư mục mới, mở bằng **Project** > **Mở project…** (Ctrl+O). Đổi tên trong **Thiết lập project**.
- **Từ thiết bị:** **Online** > **Thiết bị trong mạng…** > chọn thiết bị > **Đọc lên thành project mới** (mục 10).

Lưu bằng Ctrl+S. Studio cho lưu cả khi còn lỗi ("Đã lưu … Còn n lỗi: thiết bị sẽ từ chối project này."), nhưng không cho nạp xuống.

Thư mục project gồm các tệp JSON đọc được: `project.json`, `tags.json`, `connections.json`, `screens/<id>.screen.json`, `alarms.json`, `alarm-classes.json`, `logging.json`, `reports.json`, `graphics/*.svg`; project 1.0.0 có thêm `logic.json` (mục 9) và `templates/<id>.template.json` (mục 8). Nên quản lý thư mục này bằng git hoặc sao lưu định kỳ.

Project định dạng cũ hơn (0.1 đến 0.6, ví dụ `training-demo` đang ở 0.6.0): Studio hỏi "Mở project định dạng …" với **Nâng cấp**, **Mở chỉ đọc**, **Hủy**. Hộp liệt kê việc nâng cấp sẽ làm; nâng cấp lên 1.0.0 chỉ đổi trong bộ nhớ, đĩa chỉ đổi khi bấm Lưu. Ở lần lưu đầu Studio sao lưu bản cũ vào `.mat-backup/<định dạng cũ>-<giờ UTC>/` trong thư mục project. Project 1.0.0 cần runtime 1.0.0: nạp xuống thiết bị chạy runtime cũ hơn bị chặn kèm hướng dẫn cập nhật runtime.

<a id="help-modbus"></a>

## 4. Kết nối Modbus

Mở **Kết nối** trên cây project.

1. **Thêm kênh Modbus TCP**: điền tên, **Địa chỉ máy** (IP của PLC), **Cổng TCP** (thường 502; giả lập: 1502).
2. **Thêm kênh Modbus RTU** (RS485): chọn **Cổng serial** từ danh sách của thiết bị, **Tốc độ baud**, bit dữ liệu, **Chẵn lẻ**, bit dừng. Cổng phải có trong `serialPorts` của thiết bị, nếu không Studio báo `E_SERIAL_NOT_ALLOWED`.
3. Chọn kênh, **Thêm thiết bị trường**: **Unit ID** (TCP) hoặc **Địa chỉ slave** (RTU), **Thứ tự byte**, **Chờ trả lời**, **Số lần thử lại**.
4. **Thử kết nối** (cần Online, tài khoản engineer): nhập **Địa chỉ đọc thử** và **Số thanh ghi hoặc bit**. Kết quả "Kết nối được" kèm **Giá trị thô (hex)** và **Cách hiểu**, hoặc "Không thành công" kèm lý do. Lệnh thử chạy trên thiết bị, nên thiết bị phải thấy được mạng của PLC.

Với `training-demo`, kênh "PLC giả lập (huấn luyện)" trỏ `127.0.0.1:1502`. Khi runtime chạy trên BL335 và giả lập chạy trên máy tính, đổi **Địa chỉ máy** thành IP của máy tính.

**Nhóm quét**: Nhanh (250 ms), Thường (1 s), Chậm (5 s). Đặt Tag quan trọng vào nhóm Nhanh, đừng đặt tất cả.

<a id="help-tags"></a>

## 5. Tag

Mở **Tag** > **Bảng Tag mặc định**. Mỗi dòng là một Tag.

| Loại | Dùng khi | Ví dụ trong `training-demo` |
|---|---|---|
| Ngoài | đọc/ghi từ PLC | `BON.MUC` (`HR100`, thô INT16, đổi thang 0–27648 → 0–100 %) |
| Nội bộ | giá trị chỉ có trên runtime, có thể giữ qua mất điện | `BON.NGUONG_CAO` (giữ qua mất điện) |
| Tính toán | biểu thức từ Tag khác, chỉ đọc | `BON.THE_TICH` = `BON.MUC * 0.125` |
| Mô phỏng | tín hiệu giả để thử màn hình | `HL.SONG` (hình sin) |

- Tên Tag: chữ, số, gạch dưới, các đoạn cách nhau bằng dấu chấm (`BON.MUC`). Đổi tên bằng **Đổi tên Tag…** để Studio sửa mọi chỗ dùng.
- Kiểu: BOOL, INT16, UINT16, INT32, UINT32, INT64, UINT64, FLOAT32, FLOAT64, STRING.
- Địa chỉ: `HR100` (holding register), `IR`, `C10` (coil), `DI`, bit trong thanh ghi `HR12.3`. Sai cú pháp: `E_ADDR_SYNTAX`.
- **Quyền** `RW` để ghi được. Tag ghi được nên có **Ghi tối thiểu**/**Ghi tối đa**: runtime từ chối giá trị ngoài khoảng (`OUT_OF_LIMITS`).
- **Giữ qua mất điện** chỉ cho Tag nội bộ (`E_RETAIN`).
- Nhiều Tag: **Thêm hàng loạt…**, **Nhập CSV…**, **Dán từ Excel**.
- **Tag tính toán**: editor riêng có ô **Biểu thức**, danh sách **Tag đầu vào**, **Xem trước**. Lỗi thường gặp: `E_EXPR_SYNTAX`, `E_EXPR_UNKNOWN_TAG`, `E_EXPR_CYCLE`.

<a id="help-screens"></a>

## 6. Màn hình và widget

Mở **Màn hình** trên cây. **Thêm màn hình** hoặc **Thêm popup**; **Đặt làm màn hình đầu** cho màn hình mở đầu tiên; **Mở Điều hướng** để sửa menu của trang vận hành.

Hộp công cụ có các nhóm widget:

- Hiển thị: **Thẻ giá trị**, **Nhãn**, **Đèn báo**, **Đồng hồ kim**, **Mức chất lỏng**, **Khung nhóm**.
- Biểu đồ: **Biểu đồ đường**, **Biểu đồ cột**, **Biểu đồ tròn**; bảng: **Bảng Tag sống**.
- Điều khiển: **Nút bấm**, **Công tắc**, **Đặt giá trị**, **Thanh trượt**, **Chọn từ danh sách**.
- Alarm: **Danh sách alarm**, **Đếm alarm**; lịch sử: **Lịch sử: biểu đồ đường**, **Lịch sử: bảng dòng**, **Lịch sử: biểu đồ cột**, **Lịch sử: biểu đồ tròn**.
- **Ký hiệu SVG**: bơm, van, bồn… (ô tìm "Tìm bơm, van, bồn...").

Inspector có các tab **Chung**, **Hiển thị**, **Gắn Tag**, **Sự kiện**, **Bảo mật**.

**Gắn Tag:** kéo Tag từ Details thả vào ô của widget, hoặc **Chọn Tag…**. **Dùng đơn vị, bảng, giới hạn của Tag** điền sẵn đơn vị và giới hạn.

**Sự kiện** "Khi bấm": **Ghi giá trị**, **Đảo giá trị**, **Ghi xung**, **Chuyển màn hình**, **Mở popup**, **Đóng popup**. **Hộp xác nhận** bắt buộc với mọi lệnh ghi giá trị số; chỉ nút hoặc công tắc BOOL mới được bỏ xác nhận. **Vai trò tối thiểu** mặc định là `operator`; đặt `engineer` cho chỉnh thông số (ví dụ "Ngưỡng mức cao" trong `training-demo`).

**Nút xung:** runtime giữ nhịp bật rồi nhả. Chương trình PLC vẫn phải tự xóa bit lệnh xung sau một thời gian (ví dụ gấp đôi độ dài xung): runtime nhả lại xung dở khi khởi động lại, nhưng không thay được bảo vệ trong PLC.

**Xem trước:** chế độ **Mô phỏng** (thanh công cụ) chạy Tag mô phỏng ngay trong Studio, không cần thiết bị. Chế độ **Thiết bị** hiện giá trị sống khi Online.

## 7. Đồ họa SVG

<a id="help-svg-import"></a>

### 7.1. Nhập SVG vẽ bằng công cụ khác

1. **Sửa** > **Thêm đồ họa SVG…** (Ctrl+Shift+I) hoặc nút **Nhập SVG…** trên thanh công cụ màn hình.
2. Hộp **Nhập SVG** hiện **Trước** và **Sau (đã làm sạch)**; báo cáo có tab **Đã loại**, **Đã chuyển**, **Cảnh báo**. Script, liên kết ngoài, phần tử lạ bị loại.
3. Bật **Tối ưu (gộp hình nhỏ cùng kiểu)** cho bản vẽ lớn. Bấm **Nhập**.
4. Sửa bản vẽ ở ngoài rồi **Nhập lại SVG…**: Studio đối chiếu theo UID, giữ binding đã gắn.

Tệp SVG từ 1 MiB có cảnh báo `W_SVG_HEAVY`; từ 5 MiB là lỗi `E_SVG_LIMIT`. Cách xuất SVG từ Inkscape, Illustrator, CorelDRAW: [svg-export.md](../guides/svg-export.md).

### 7.2. Gắn Tag cho phần tử SVG

Chọn item SVG, Enter (hoặc nhấp đúp) để **vào đồ họa**, chọn phần tử, tab **Gắn Tag**. Có 13 loại hoạt ảnh: **Chữ hiển thị giá trị**, **Màu nền**, **Màu viền**, **Mức chất lỏng**, **Quay**, **Quay liên tục**, **Di chuyển X**, **Di chuyển Y**, **Co giãn**, **Nhấp nháy**, **Dòng chảy**, **Ẩn/hiện**, **Độ mờ**. Cách đổi giá trị: **Trực tiếp**, **Tuyến tính**, **Rời rạc**, **Bảng giá trị**, **Khoảng**. Thanh **Thử giá trị** cho xem trước. Ký hiệu có sẵn có **Gắn nhanh**.

<a id="help-svg-editor"></a>

### 7.3. Trình vẽ SVG

Tab editor riêng để vẽ và sửa SVG đơn giản ngay trong Studio, không cần Inkscape. Có ở project định dạng 0.3 trở lên. Tệp SVG vẫn là tệp của project (`graphics/…`); binding gắn theo `data-mat-uid` nên sửa hình, di chuyển, đổi màu không làm mất Tag đã gắn.

**Mở tệp**

- Cây project, mục **Đồ họa SVG**: nhấp một tệp để mở tab trình vẽ. Mục cuối **Mới: SVG trống…** mở tab tạo tệp mới.
- Trên màn hình, chọn một item svg rồi **Sửa trong trình vẽ** (menu chuột phải, Ctrl+Alt+Enter) mở đúng tệp của item. Enter hoặc nhấp đúp item svg vẫn là "vào đồ họa" để gắn Tag (mục 7.2).
- **Mới: SVG trống**: đặt tên (tệp `graphics/<tên>.svg`; trùng tên thì nút **Tạo và mở** bị khóa), chọn kích thước viewBox (Ký hiệu 100 × 100, Nhỏ 200 × 160, Vừa 400 × 300, Màn hình 1280 × 720, hoặc tự nhập W, H từ 1 đến 10.000), bước lưới, tên lớp đầu, nền trắng (lớp "Nền" khóa sẵn). Tệp mới có dấu chưa lưu; chỉ ghi xuống đĩa khi **Lưu**.

**Bố cục**: thanh công cụ của trình vẽ ở trên (Lưu, Hoàn tác, Làm lại, số bước hoàn tác, nhóm, căn chỉnh, phân bố, cùng cỡ, thứ tự, bật tắt bắt dính, bước lưới, Hiện lưới, chip tự lưu); Toolbox công cụ dọc bên trái; canvas có thước, lưới, tay nắm, đường gióng; bên phải panel **Lớp** (trên) và **Thuộc tính** (dưới); dải trạng thái dưới cùng (tọa độ con trỏ, zoom, phần tử đang chọn, công cụ, kiểu bắt dính). Tab **Thuộc tính** của dock dưới cho biết viewBox, số nút / 20.000, độ sâu / 32, cỡ / 5 MB và các cảnh báo của tệp (`W_SVG_FONT`, đường cong khóa sửa nút, phần tử giữ nguyên).

**Công cụ** (phím trong ngoặc; phím có tác dụng khi canvas có focus):

| Công cụ | Cách dùng |
|---|---|
| Chọn (V) | nhấp chọn; Shift+nhấp thêm/bớt; kéo vùng trống để chọn bằng khung (lấy phần tử nằm trọn trong khung); Ctrl+nhấp chọn sâu phần tử bên trong nhóm; nhấp đúp vào nhóm để vào nhóm, Esc để ra; kéo phần tử để dời (Shift khóa trục); 8 tay nắm đổi cỡ (Shift giữ tỉ lệ, Alt đổi từ tâm), tay nắm tròn phía trên để xoay (Shift bắt bội 15°) |
| Sửa nút (N) | với đa tuyến, đa giác, đường chỉ gồm đoạn thẳng: kéo một nút; nhấp đúp lên cạnh để thêm nút; Delete xóa nút đang chọn; lệnh **Đóng/mở đường** trong bảng lệnh |
| Hình chữ nhật (R) | kéo; Shift vuông; Alt vẽ từ tâm |
| Ellipse (E) | kéo; Shift ra hình tròn (`circle`) |
| Đường thẳng (L) | kéo; Shift khóa góc theo bội 15° |
| Đa tuyến/Đa giác (P) | nhấp từng điểm; Enter hoặc nhấp đúp để xong (đa tuyến); nhấp lại điểm đầu để đóng thành đa giác; Esc khi chưa đủ điểm thì hủy |
| Văn bản (T) | nhấp rồi gõ trong ô nhập đặt ngay trên canvas (gõ được bằng Telex, Unikey); Enter hoặc Esc để xong; chỉ một dòng. Nhấp đúp vào chữ có sẵn (hoặc Enter khi đang chọn) để sửa |
| Kéo canvas (H) | kéo để cuộn; cũng có thể giữ Space hoặc nhấn nút chuột giữa |

Phần tử mới nhận `data-mat-uid` mới và mặc định của Studio: hình kín tô `#cfd8dc`, viền `#37474f` dày 2; đường không tô; chữ `#263238`, cỡ 16, phông `sans-serif`. Phần tử mới vẽ vào lớp đang chọn ở panel Lớp (lớp đang khóa hoặc ẩn thì không vẽ được và có lời nhắn).

**Phím**

| Phím | Việc |
|---|---|
| Tab / Shift+Tab | chọn phần tử kế / trước (theo thứ tự trong tệp, ở cấp đang làm việc) |
| Mũi tên | dịch 1 đơn vị; Shift: 10; Ctrl: một bước lưới. Giữ phím là một bước hoàn tác |
| Enter / Esc | vào nhóm hoặc sửa chữ / ra khỏi nhóm, hủy thao tác, bỏ chọn |
| Delete | xóa (phần tử có binding thì hỏi trước, xem dưới) |
| Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+D | chọn hết, sao chép, cắt, dán, nhân bản (lệch 20) |
| Ctrl+G / Ctrl+Shift+G | nhóm / bỏ nhóm |
| `]` `[` / Ctrl+`]` Ctrl+`[` | lên, xuống một bậc / lên trên cùng, xuống dưới cùng |
| `+` `-` `0` | phóng to, thu nhỏ, vừa khung; Ctrl + bánh xe để thu phóng tại con trỏ |
| F2 | đổi tên hiển thị của phần tử (`data-mat-name`) |
| Ctrl+Z / Ctrl+Y | hoàn tác / làm lại của tệp đang mở (100 bước, mỗi tệp riêng) |
| Ctrl+S | lưu mọi tệp chưa lưu (kể cả tệp SVG) |
| Alt (khi kéo) | tắt bắt dính tạm thời |

Mọi lệnh của trình vẽ có trong **Bảng lệnh** (Ctrl+Shift+P), tìm được không dấu (ví dụ "bo nhom").

**Bắt dính và căn chỉnh**: bắt theo lưới (5, 10, 20; mặc định 10), cạnh và tâm của phần tử khác (trong 6 điểm ảnh màn hình), điểm đầu cuối của đường, góc 15° khi giữ Shift. Khi dính, đường gióng màu hồng hiện kèm nhãn ("dính cạnh", "dính tâm"…). Bốn nút trên thanh công cụ bật tắt từng kiểu. Nhấp đúp lên thước để thêm đường gióng cố định (xanh, nét đứt) làm đích bắt dính; nhấp đúp gần đường có sẵn để bỏ; đường gióng lưu ở `.mat-editor/svg-state.json` như mắt và khóa. Căn trái, giữa, phải, trên, giữa dọc, dưới (≥ 2 phần tử), phân bố đều (≥ 3), cùng rộng, cùng cao (theo phần tử chọn đầu tiên).

**Lớp**: lớp là nhóm `<g data-mat-layer="tên">` ở cấp đầu của tệp; phần tử không thuộc lớp nào nằm ở "Lớp mặc định". Panel Lớp: thêm, đưa lên, đưa xuống, xóa (hỏi: **Xóa luôn nội dung** hay **Chuyển sang Lớp mặc định**); nhấp tên để chọn lớp nhận phần tử mới, nhấp đúp hoặc F2 để đổi tên; nhấp phần tử để chọn nó (chọn được cả khi lớp đang khóa). Nút mắt ẩn lớp trong editor, nút khóa làm lớp không chọn được trên canvas. Mắt và khóa chỉ lưu ở `.mat-editor/svg-state.json` trong thư mục project: không đổi tệp SVG, không vào gói nạp xuống; mất tệp này không mất gì của bản vẽ. Chuyển phần tử sang lớp khác: ô **Lớp** ở tab Chung.

**Thuộc tính** (panel phải dưới):

- **Chung**: thẻ, tên hiển thị, `id` (kiểm cú pháp, không trùng), lớp, uid.
- **Hình học**: X, Y, Rộng, Cao (của hộp bao trong hệ tọa độ tệp), khóa tỉ lệ, góc, bo góc (`rect`), bán kính (`circle`). Ô số nhận dấu phẩy; nhập sai thì ô viền đỏ kèm lời nhắn và tệp không đổi. "Ghi vào" cho biết Studio ghi thẳng vào thuộc tính hình học (khi chính xác: không nghiêng, xoay bội 90°) hay vào `transform`; khi ghi `transform` có tùy chọn nét không co theo transform.
- **Hiển thị**: tô và viền (bộ chọn màu kèm mã hex, ∅ để không tô), độ dày, nét đứt, đầu mút, độ mờ (0–1), `visibility`. Màu khai trong `style` được sửa ngay trong `style`. Tô gradient có sẵn được giữ, không sửa được.
- **Văn bản**: nội dung, phông trong danh sách an toàn (`sans-serif`, `serif`, `monospace`, Arial, Segoe UI, Roboto; phông khác có cảnh báo `W_SVG_FONT`), cỡ, đậm, nghiêng, canh.
- **Gắn Tag**: tóm tắt binding của phần tử (theo uid, ở mọi item svg dùng tệp này); nút **Mở Gắn Tag…** mở màn hình chứa item, vào đồ họa và chọn đúng phần tử để sửa đủ 13 loại hoạt ảnh (mục 7.2).

**Xóa phần tử có binding**: Delete trên phần tử (hoặc nhóm chứa phần tử) đang gắn Tag mở hộp "Xóa …: sẽ mất N binding" liệt kê uid, màn hình, item và binding. **Xóa và bỏ N binding** xóa cả phần tử lẫn bản ghi binding; **Ctrl+Z** khôi phục cả hai.

**Sao chép, dán**: sao chép giữa hai tệp đang mở giữ hình và cấp uid mới (không chép binding). Dán SVG dạng chữ từ chương trình khác: Studio kiểm cỡ ≤ 5 MB trước, lọc qua allowlist như khi nhập (mục 7.1) và hiện hộp "Đã dán SVG từ clipboard (đã lọc)" kê những gì đã loại (script, `on…`, `foreignObject`, liên kết ra ngoài).

**Lưu, tự lưu, tệp đổi bên ngoài**

- **Lưu** (Ctrl+S) ghi tệp chuẩn tắc: phần không sửa giữ nguyên từng byte, mọi `data-mat-uid` giữ nguyên; ghi tạm rồi đổi tên. Cây phần tử ở mục 7.2 thấy nội dung mới ngay.
- Tự lưu mỗi 30 s khi có thay đổi vào `.mat-editor/autosave/` (tối đa 3 bản mỗi tệp, xóa khi lưu thật; không vào gói). Studio tắt đột ngột: lần mở project sau có hộp **Khôi phục bản tự lưu** (chọn bản cho từng tệp, **Khôi phục** hoặc **Bỏ**, **Xem khác biệt**); khôi phục mở tệp ở trạng thái chưa lưu, tệp trên đĩa chỉ đổi khi bấm Lưu.
- Studio kiểm tệp trên đĩa khi cửa sổ lấy focus và mỗi 5 s (so mtime và băm). Chưa sửa gì thì tự nạp lại và báo. Đang có thay đổi thì hộp **Tệp đã đổi bên ngoài**: **Nạp lại từ đĩa** (bỏ thay đổi, xóa lịch sử hoàn tác), **Giữ bản đang sửa** (lần Lưu sau sẽ hỏi Ghi đè / Tải lại / Hủy) hoặc **So sánh** (số nút, cỡ, binding sẽ mồ côi). Studio không bao giờ ghi đè im lặng.

**Giới hạn có chủ ý** (nút ⓘ cuối Toolbox): không có bút Bézier tự do, phép toán boolean, bộ lọc (filter), mặt nạ (mask), sửa gradient, văn bản theo đường, văn bản nhiều dòng. Đường có đoạn cong (C, S, Q, T, A) chỉ di chuyển, đổi cỡ, xoay, đổi màu; Sửa nút báo "Đường có đoạn cong… sửa nút trong Inkscape". `mask`, `filter`, `pattern` và `svg` lồng giữ nguyên, chỉ biến đổi như một khối. Tệp tối đa 5 MB, 20.000 phần tử, độ sâu 32. Cần các tính năng trên thì vẽ bằng Inkscape rồi **Nhập lại SVG…** (mục 7.1) để giữ binding.

<a id="help-templates"></a>

## 8. Template và faceplate

Dùng khi nhà máy có nhiều thiết bị giống nhau (ví dụ 20 bơm).

Cần project định dạng 1.0.0 (mục 3); project cũ hơn thì các lệnh template bị khóa với lý do "Cần project định dạng 1.0.0 (nâng cấp project)". Ví dụ đầy đủ: màn hình "Bơm" của `projects/dashboard-demo/` (template `bom`, 20 bản sao, popup `bom-chi-tiet`).

- **Template**: một nhóm widget vẽ một lần, có tham số, lưu ở `templates/<id>.template.json`. Chọn các widget trên màn hình, nhấp phải, **Tạo template…** (hoặc tìm "Tạo template" trong **Tìm lệnh…**). Hộp "Tạo template từ vùng chọn" cho đặt id, tên, tối đa 16 tham số và chọn chỗ nào thay bằng tham số. Tham số có kiểu `tagPrefix`, `string`, `number`, `color`; trong item viết `{tên}`, ví dụ `{prefix}.RUN`. Đây là thay chuỗi thuần, không phải biểu thức, không lồng. Template tối đa 120 item và chỉ gồm widget: item SVG không đưa vào template được.
- Mọi template nằm ở mục **Template** trên cây; trang của một template có danh sách bản sao (màn hình, trạng thái "khớp template" hay "lệch template"), các nút **Thêm bản sao…**, **Tham số…**, **Xóa template…**.
- **Bản sao**: **Thêm bản sao…**, chọn màn hình, đặt **Id bản sao** và giá trị tham số (ví dụ `prefix` = `PUMP07`; ô trống lấy mặc định). Khi lưu, bản sao được bung thành item thường, id dạng `<bản sao>.<item>` (ví dụ `pump7.lamp`); runtime không cần biết template.
- Sửa template rồi **Cập nhật mọi bản sao (n)**: giữ riêng vị trí, cỡ, giá trị tham số và id của từng bản sao; một bước hoàn tác (Ctrl+Z). Item thêm tay vào bản sao bị xóa khi cập nhật (inspector báo `W_TEMPLATE_DRIFT`); muốn giữ thì **Bung thành item thường** cho bản sao đó trước. Xóa template còn bản sao: các bản sao được giữ lại dạng item thường.
- **Faceplate**: màn hình popup có tham số. Mở màn hình popup, trong inspector bấm **Tạo faceplate (tham số cho popup)**: Studio đổi tiền tố Tag chung của popup thành tham số `prefix`. Ở nút gọi popup, hành động **Mở popup** có ô **args…** để truyền giá trị, ví dụ mở `bom-chi-tiet` với `prefix` = `PUMP07`. Nút thuộc bản sao template lấy `args` từ tham số của template (chỉ xem). Studio kiểm trước mọi tổ hợp `args` được gọi; tham số sai thì báo `E_TEMPLATE_PARAM` hoặc `E_POPUP_ARGS`, Tag không có thì `E_TEMPLATE_TAG_REF`. Trên trang vận hành, popup chỉ đăng ký các Tag có trong project; `args` sai thì popup không mở và báo "tham số của cửa sổ sai (…)".

<a id="help-logic"></a>

## 9. Logic

Logic chạy trên runtime 1.0.0, theo chu kỳ quét (`logic.scanMs`, mặc định 100 ms). Mọi khối nằm trong `logic.json`, sửa ở nút **Logic** trên cây (các nhóm Luật, Timer, Counter, Cộng dồn, Giờ chạy, Lịch, Ghi PLC; tất cả mở chung tab "Logic"). Project chưa có logic: bấm **Tạo logic.json**. Project định dạng cũ hơn 1.0.0: editor báo "Logic cần project định dạng 1.0.0", nâng cấp project trước (mục 3).

Thao tác trong tab: **Thêm khối** (Insert), **Xóa** (Delete), **Chuyển lên**/**Chuyển xuống**, F2 đổi id (Studio cập nhật mọi tham chiếu), ô "Tìm id, tên, Tag", ô "Chỉ dòng lỗi", **Kiểm tra** (F7). Dock dưới có **Inspector** (trường của khối đang chọn), **Thông tin** (lỗi và cảnh báo, nhấp đúp để nhảy tới ô; F8 / Shift+F8 tới lỗi kế / trước ở bất kỳ đâu trong editor) và **Thử logic**. Task card **Khối / Tag** bên phải: kéo một khối vào bảng (hoặc nhấp đúp) để thêm, kéo một Tag vào ô biểu thức. Giới hạn: 200 luật, 100 timer, 100 counter, 50 cộng dồn, 50 giờ chạy, 50 lịch, 100 mục ghi (`E_LOGIC_LIMIT`).

| Khối | Dùng khi | Trường chính |
|---|---|---|
| Luật | "khi điều kiện đúng thì làm" | Khi (biểu thức BOOL), Giữ (ms), Khi lên, Khi xuống, Lặp |
| Timer | trễ bật, trễ tắt, xung | Kiểu `ton`/`tof`/`tp`, Vào, pt |
| Counter | đếm số lần khởi động | Đếm lên, Đếm xuống, Đặt lại, Preset |
| Cộng dồn | tổng lưu lượng | Nguồn, Đơn vị gốc, Hệ số, Cutoff |
| Giờ chạy | giờ chạy và lịch bảo dưỡng | Chạy, Bảo dưỡng mỗi (h) |
| Lịch | bật theo giờ trong tuần | Khung hằng tuần, Ngoại lệ |

Chi tiết từng khối (theo engine của runtime; **Thử logic** trong Studio dùng cùng bộ vector kiểm):

- **Timer** `ton` (trễ bật): đầu ra lên khi **Vào** đúng liên tục đủ `pt` ms; `tof` (trễ tắt): đầu ra lên ngay khi Vào đúng, xuống sau khi Vào sai đủ `pt` ms; `tp` (xung): cạnh lên của Vào cho đầu ra đúng trong `pt` ms, không kéo dài khi Vào lặp lại. `pt` nhỏ hơn chu kỳ quét được nâng lên bằng chu kỳ quét. Đầu ra phụ: thời gian đã chạy (ms).
- **Counter**: cạnh lên của **Đếm lên**/**Đếm xuống** tăng, giảm 1; cạnh lên của **Đặt lại** về 0; đầu ra giá trị và cờ "đạt **Preset**" (giá trị ≥ Preset).
- **Cộng dồn**: tích phân hình thang của **Nguồn** (lưu lượng) theo thời gian, nhân **Hệ số**, chia theo **Đơn vị gốc** của lưu lượng (`s`, `min`, `h`, `d`: m³/h thì chọn `h`). Giá trị dưới **Cutoff** tính là 0 (bỏ nhiễu khi bơm dừng). Nguồn BAD hoặc khoảng giữa hai lần quét quá 5 s thì không cộng; thời gian bỏ qua cộng vào đầu ra "giây trống" để biết tổng thiếu bao nhiêu. Có thể đặt ngưỡng quay vòng (về 0 khi vượt) và biểu thức đặt lại (cạnh lên).
- **Giờ chạy**: đếm giờ khi **Chạy** đúng và số lần khởi động; đầu ra "đến hạn bảo dưỡng" khi số giờ ≥ **Bảo dưỡng mỗi (h)**. Kỹ sư đặt lại sau bảo dưỡng bằng **Đặt lại về 0 trên thiết bị** (Online).
- **Lịch**: các khung hằng tuần (ngày trong tuần, giờ từ, giờ đến; khung qua nửa đêm được) và **Ngoại lệ** theo ngày (ngày lễ: bật hoặc tắt cả ngày). Giờ tính theo giờ địa phương cố định của project (không giờ mùa hè).
- Counter, cộng dồn, giờ chạy mặc định **Giữ khi tắt máy**; trạng thái lưu bị mất (tệp hỏng) thì bắt đầu lại từ 0 và thiết bị báo `LOGIC_RETAIN_LOST`.

- Luật: điều kiện **Khi** phải đúng liên tục trong **Giữ** (ms) mới thành cạnh. Tag đầu vào BAD, STALE hoặc lỗi biểu thức thì luật tạm treo (SUSPENDED): không hành động, không sinh cạnh giả. **Lặp** (≥ 10.000 ms, chỉ cho Khi lên) lặp lại hành động khi điều kiện còn đúng. Mặc định luật không bắn lúc runtime khởi động, trừ khi tích **Bắn khi khởi động**.
- Đầu ra của khối là "Tag logic" chỉ đọc, tên `LOGIC.<ID>.…` (ví dụ đầu ra `q` của timer). Ghi tay vào Tag logic bị từ chối `OWNED_BY_LOGIC`. Counter, cộng dồn, giờ chạy có ô **Giữ khi tắt máy**: giữ qua mất điện, mất tối đa một chu kỳ ghi (`logic.flushS`, mặc định 60 s).
- Lịch không theo giờ mùa hè; khi đồng hồ thiết bị chưa đồng bộ, đầu ra của lịch là BAD (`TIME_NOT_SYNCED`) và luật dùng nó tạm treo.
- Hành động (**Khi lên**, **Khi xuống**): **Đặt Tag**, **Đảo** (Tag nội bộ), **Ghi PLC**, **Xung**. Ghi xuống PLC chỉ qua mục đã khai ở nhóm **Ghi PLC**: mỗi mục là một **Tag thiết bị (RW)** kèm **Giá trị cho phép** (danh sách hoặc khoảng min đến max), **Cách nhau tối thiểu** (≥ 1.000 ms) và **Tối đa mỗi giờ**. Hành động ghi mục chưa khai là lỗi `E_LOGIC_WRITE_UNDECLARED`. Toàn thiết bị còn giới hạn `logic.maxWritesPerMin` (mặc định 20 lệnh mỗi phút); vượt thì lệnh bị từ chối và luật sang THROTTLED.
- Ghi từ logic **mặc định tắt trên thiết bị** (`logic.writes` = `off`): luật vẫn chạy, nhưng không lệnh nào tới PLC. Chỉ quản trị viên bật được, bằng quyền root trên thiết bị ([admin-guide.md](admin-guide.md) mục 9). Mỗi lệnh ghi của logic có audit với người thực hiện `logic:<id luật>`.
- **Dừng khẩn:** administrator dừng mọi lệnh ghi PLC của logic từ Studio (**Dừng ghi của logic…**); có hiệu lực ngay và giữ qua khởi động lại; luật, timer, counter vẫn chạy. Chỉ root bỏ được lệnh dừng, bằng `mat-runtime --logic-writes-reset` trên thiết bị (không có nút bật lại trong Studio: API trả `LOGIC_ENABLE_ROOT_ONLY`). Chi tiết: [admin-guide.md](admin-guide.md) mục 9.
- **Thử logic** (dock dưới): chạy mô phỏng ngay trong Studio, không cần thiết bị. **Chạy**/**Dừng** (Space), **Một quét**, tua ×1, ×10, ×100; **Đặt tay** giá trị và quality (GOOD, UNCERTAIN, BAD) của từng đầu vào; đường thời gian đầu vào, đầu ra (co giãn theo thời gian đã chạy, tối đa 5 phút, 30 phút, 2 giờ theo tốc độ) và danh sách hành động phát sinh. Lệnh ghi trong mô phỏng chỉ áp vào Tag mô phỏng ("Không gửi gì tới thiết bị"). **Lưu kịch bản…** lưu ca thử thành tệp JSON.
- **Online**: bảng khối có thêm cột **Trạng thái**, **Lần bắn cuối**, **Số lần** đọc từ thiết bị; thanh công cụ của tab có chip "Ghi PLC: tắt", "Ghi PLC: bật" hoặc "Ghi PLC: dừng" (nhấp để xem chi tiết; administrator có **Dừng ghi của logic…**, xem [admin-guide.md](admin-guide.md) mục 9). Inspector của counter, cộng dồn, giờ chạy có nút **Đặt lại về 0 trên thiết bị** (engineer, có audit).
- Khi nạp xuống project có ghi từ logic, hộp xem trước có mục "Logic sẽ tự động ghi N Tag xuống PLC" kèm bảng Tag, giá trị cho phép, tần suất và luật ghi, và trạng thái ghi PLC của thiết bị đích (thiết bị đang tắt ghi thì có cảnh báo `W_LOGIC_WRITES_OFF`). Phải tích "Tôi đã xem danh sách…" mới nạp xuống được.
- Logic không thay logic an toàn của PLC: khóa liên động và dừng khẩn phải nằm trong PLC.

<a id="help-online"></a>

## 10. Online: thêm thiết bị, nạp xuống, đọc lên, so sánh

### 10.1. Thêm thiết bị và đăng nhập

1. **Online** > **Thiết bị trong mạng…**: Studio tìm runtime trong mạng LAN. Không thấy (khác mạng con, VPN): **Thêm theo địa chỉ…**.
2. Lần đầu, hộp "Xác nhận chứng chỉ" hiện **Fingerprint SHA-256 của chứng chỉ thiết bị**. So **từng cặp ký tự** với fingerprint do quản trị viên đọc trên thiết bị. Khớp thì **Ghim và tiếp tục**. Không khớp: dừng, báo quản trị viên.
3. **Đăng nhập…**: nhập tài khoản engineer.
4. Fingerprint đổi sau này ("Chứng chỉ đã đổi"): chỉ **Gỡ ghim và xác nhận lại** khi quản trị viên xác nhận đã sinh lại chứng chỉ.

### 10.2. Nạp xuống

1. Lưu, **Kiểm tra** (F7): 0 lỗi.
2. **Online** > **Nạp xuống…** (Ctrl+L).
3. Đọc **xem trước**: Kiểm tra project, Tương thích runtime, Thay project đang chạy, Client sẽ tải lại, Dung lượng gói, Lưu trữ dữ liệu. Tích **Tôi đã đọc các cảnh báo**, bấm **Nạp xuống**.
4. Thiết bị chạy các bước: Gửi gói lên thiết bị, Kiểm tra gói, Kiểm tra project, Sao lưu bản đang chạy, Kích hoạt bản mới, Kiểm tra sức khỏe (15 s).
5. Lỗi trước bước kích hoạt: thiết bị không đổi gì. Kích hoạt xong mà kiểm tra sức khỏe không đạt: thiết bị **tự quay về** bản trước.
6. Trang vận hành đang mở tự tải lại ("Đang nạp project mới…").

Nạp xuống nên làm ngoài giờ cao điểm và báo trước cho người vận hành.

### 10.3. Khôi phục bản trước

**Online** > **Khôi phục bản trước…**: danh sách các bản thiết bị đang giữ (bản chạy và 3 bản dự phòng) kèm người nạp và thời điểm. Chọn, **Khôi phục**.

### 10.4. Đọc lên và so sánh

- **Đọc lên…** > **Thành project mới**: lấy project đang chạy trên thiết bị về máy (dùng khi mất bản trên máy, hoặc tiếp quản từ người khác).
- **So sánh với thiết bị**: bảng `=` giống, `≠` khác, `+` chỉ có trên máy, `-` chỉ có trên thiết bị; **Đọc lên phần chọn** hoặc **Nạp xuống phần khác**. Thanh trạng thái hiện "project … khớp thiết bị" hoặc "khác thiết bị".

### 10.5. Cập nhật runtime

Kỹ sư không cập nhật runtime: việc này cần tài khoản administrator và thiết bị đã bật OTA ([admin-guide.md](admin-guide.md) mục 7.2). Khi cần runtime mới (ví dụ nạp xuống bị chặn `E_RUNTIME_TOO_OLD` vì project 1.0.0), báo quản trị viên. Trong lúc thiết bị đang cập nhật, nạp xuống bị từ chối `DEVICE_BUSY`; ngược lại, đang nạp xuống thì không cập nhật được. Sau cập nhật, project đang chạy giữ nguyên; nếu bản mới không chạy được project thì thiết bị từ chối gói trước khi cài (`UPDATE_PROJECT_INCOMPATIBLE`).

<a id="help-diagnostics"></a>

## 11. Theo dõi và chẩn đoán

- **Bảng theo dõi**: thêm Tag, xem giá trị và quality sống; ghi thử bằng **Ghi dòng đã chọn…** (Ctrl+Shift+Enter), có hộp **Xác nhận ghi**.
- **Chẩn đoán driver**: theo từng nhóm quét, số lần đọc, lỗi, thời gian; **Đặt lại phần tăng** để đếm lại từ bây giờ.
- Inspector của thiết bị, tab **Chẩn đoán**: CPU, RAM runtime, RAM hệ thống, dung lượng trống, giờ thiết bị, số phiên.
- Cảnh báo của thiết bị (ví dụ `SSH_ROOT_PASSWORD`, `PULSE_STUCK`, `HOST_CHECK_OFF`, `LOGIC_WRITES_OFF`, `LOGIC_THROTTLED`, `LOGIC_RETAIN_LOST`, `TIME_NOT_SYNCED`, `UPDATE_ROLLED_BACK`) hiện ở thông tin thiết bị. Bảng đủ mã kèm việc cần làm: [admin-guide.md](admin-guide.md#cảnh-báo-của-thiết-bị); mã lỗi khác: [error-codes.md](error-codes.md).
- Logic trên thiết bị: tab "Logic" khi Online (trạng thái từng khối, chip "Ghi PLC", mục 9).
- Số liệu chạy dài hạn của thiết bị (thời gian chạy, số lần khởi động lại và nguyên nhân, RSS, CPU, ghi đĩa trong ngày, tuổi thọ eMMC, độ trễ dữ liệu sống): `GET /api/v1/diagnostics`, xem [admin-guide.md](admin-guide.md) mục 8.
- **Audit của thiết bị** (chỉ administrator): ai đăng nhập, ai ghi gì, ai nạp xuống.

<a id="help-alarm"></a>

## 12. Alarm, lưu trữ, báo cáo

- **Alarm** > **Danh sách alarm**: loại **Số** (bit), **Ngưỡng** (HH, H, L, LL, Deadband, Trễ bật, Trễ tắt), **Quality**. **Lớp alarm**: ưu tiên, màu, nhấp nháy, cần xác nhận, âm thanh. **Thử alarm** để xem trước.
- **Lưu trữ**: nhóm theo **Chu kỳ**, **Thay đổi**, **Kết hợp** hoặc **Kích hoạt**; khung **Ước tính ghi** cho số MB/ngày. Vượt ngân sách ghi thì Studio hỏi trước khi nạp xuống. Ghi nhiều làm mòn bộ nhớ eMMC: chỉ lưu Tag cần.
- **Báo cáo**: mẫu theo ngày, ca, tháng; **Xem trước báo cáo** với dữ liệu mô phỏng hoặc dữ liệu thiết bị.

<a id="help-errors"></a>

## 13. Lỗi thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Nút **Nạp xuống** bị khóa, "Project còn lỗi" | còn lỗi kiểm tra | mở tab **Thông tin** (Inspector), nhấp đúp từng lỗi để tới chỗ sai |
| `E_RUNTIME_TOO_OLD` | project cần runtime mới hơn | nhờ quản trị viên cập nhật runtime (mục 10.5) |
| Nạp xuống bị từ chối `DEVICE_BUSY` | thiết bị đang cập nhật runtime hoặc có người khác đang nạp xuống | chờ xong rồi nạp lại |
| Tag luôn BAD, lý do "Hết thời gian chờ thiết bị" | sai IP, cổng, Unit ID, hoặc tường lửa | **Thử kết nối**; kiểm tra mạng từ thiết bị tới PLC |
| Giá trị sai hẳn (rất lớn, âm lạ) | sai **Thứ tự byte** hoặc kiểu thô | đổi Thứ tự byte (ABCD, CDAB…), so với tài liệu PLC |
| `E_ADDR_SYNTAX`, `E_ADDR_AREA` | địa chỉ sai dạng hoặc ghi vào vùng chỉ đọc | dùng `HR`, `C` cho Tag ghi được |
| Ghi bị REJECTED `OUT_OF_LIMITS` | giá trị ngoài Ghi tối thiểu/tối đa | sửa giới hạn hoặc giá trị |
| Ghi TIMEOUT liên tục | PLC chậm, **Chờ trả lời** quá ngắn | tăng Chờ trả lời; kiểm tra tải của PLC |
| `E_SERIAL_NOT_ALLOWED` | cổng RS485 chưa được phép trên thiết bị | quản trị viên thêm vào `serialPorts` |
| Studio không thấy thiết bị | khác mạng con, tường lửa chặn UDP 8446 | **Thêm theo địa chỉ…** |
| "Chứng chỉ đã đổi" | thiết bị sinh lại chứng chỉ, hoặc nhầm thiết bị | hỏi quản trị viên trước khi gỡ ghim |
| `AUTH_LOCKED` khi đăng nhập | sai mật khẩu 5 lần từ máy này | chờ 5 phút, hoặc nhờ quản trị viên mở khóa |
| `E_EXPR_CYCLE` | Tag tính toán tham chiếu vòng | bỏ vòng (A dùng B, B dùng A) |
| Màn hình mở chậm | SVG quá lớn (`W_SVG_HEAVY`) | nhập lại với **Tối ưu**, bỏ ảnh nhúng lớn |
| `E_LOGIC_WRITE_UNDECLARED` | hành động **Ghi PLC** trỏ mục chưa khai | thêm mục ở nhóm **Ghi PLC** (mục 9) |
| Ghi bị REJECTED `OWNED_BY_LOGIC` | ghi tay vào Tag logic `LOGIC.…` | Tag logic chỉ đọc; đổi luật hoặc dùng Tag nội bộ khác |
| Luật chạy nhưng PLC không đổi | thiết bị tắt ghi từ logic (chip "Ghi PLC: tắt", `LOGIC_WRITES_OFF`) | quản trị viên bật `logic.writes` sau khi duyệt danh sách ghi |
| `E_TEMPLATE_TAG_REF`, `E_POPUP_ARGS` | tham số template hoặc `args` của popup cho Tag không có | sửa giá trị tham số hoặc thêm Tag |

## 14. Bảng tác vụ kiểm tra

Mỗi tác vụ dùng `projects/training-demo` và PLC giả lập (mục 1). Giáo trình: [docs/training/engineer.md](../training/engineer.md).

| # | Mục tiêu | Các bước | Kết quả mong đợi |
|---|---|---|---|
| K1 | Mở project | chép `training-demo`, **Mở project…**, **Kiểm tra** | thanh trạng thái "0 lỗi" |
| K2 | Mô phỏng không cần thiết bị | bật **Mô phỏng**, mở màn hình "Xu hướng" | đường `HL.SONG` dao động; nhãn "MÔ PHỎNG" |
| K3 | Thêm kết nối | thêm kênh Modbus TCP thứ hai tới giả lập, một thiết bị trường Unit ID 1 | **Kiểm tra** không có lỗi mới |
| K4 | Thêm Tag ngoài | thêm `BOM.LOI2` kiểu BOOL, địa chỉ `HR12.4` | Tag xuất hiện; không lỗi |
| K5 | Thêm Tag tính toán | thêm `BON.PHAN_TRAM_TRONG` = `100 - BON.MUC` | **Xem trước** cho giá trị đúng |
| K6 | Dựng màn hình | thêm màn hình "Bơm", một **Đèn báo** gắn `BOM.LOI`, một **Công tắc** gắn `BOM.LENH_CHAY` | thấy trong xem trước; mục menu mới khi thêm vào Điều hướng |
| K7 | Bảo mật nút | đặt **Vai trò tối thiểu** `engineer` cho công tắc vừa thêm | trên trang vận hành, tài khoản operator thấy "Cần quyền engineer" |
| K8 | Nhập SVG | nhập một SVG bồn đơn giản, gắn **Mức chất lỏng** với `BON.MUC` | **Thử giá trị** 50 cho thấy nửa bồn |
| K9 | Ghim chứng chỉ, đăng nhập | **Thiết bị trong mạng…**, so fingerprint, **Ghim và tiếp tục**, **Đăng nhập…** | thanh trạng thái "Online", viền cam |
| K10 | Nạp xuống | **Nạp xuống…**, đọc xem trước, xác nhận | kết quả thành công; trang vận hành tự tải lại project mới |
| K11 | Thử kết nối | **Kết nối** > **Thử kết nối**, địa chỉ `HR100`, 1 thanh ghi | "Kết nối được", có giá trị thô |
| K12 | Theo dõi và ghi thử | **Bảng theo dõi**: thêm `BON.MUC_DAT`, ghi `40` | dòng hiện 40, quality GOOD |
| K13 | So sánh | sửa mô tả một Tag (không nạp), **So sánh với thiết bị** | dòng Tag đó hiện `≠` |
| K14 | Khôi phục | **Khôi phục bản trước…**, chọn bản trước | thiết bị chạy lại bản cũ; So sánh khớp bản cũ |
| K15 | Đọc lên | **Đọc lên…** > **Thành project mới** vào thư mục trống | project mở được, **Kiểm tra** 0 lỗi |
| K16 | Chẩn đoán lỗi kết nối | dừng giả lập; xem Tag và **Chẩn đoán driver**; chạy lại giả lập | Tag BAD rồi về GOOD; bộ đếm lỗi tăng |
| K17 | Alarm | đặt mức giả lập vượt 80 % (chờ dao động); xem trang Alarm | alarm "Mức bồn" mức Nhỏ hiện, xác nhận được |
| K18 | Logic | project đã nâng cấp lên 1.0.0 (mục 3); thêm Tag nội bộ BOOL `BON.BAO_CAO`; **Logic** > **Tạo logic.json**; thêm luật: khi `BON.MUC > BON.NGUONG_CAO` giữ 5000 ms thì **Đặt Tag** `BON.BAO_CAO = true`; **Thử logic**, đặt tay `BON.MUC` = 90, **Chạy** | hành động phát sinh sau 5 s; "Không gửi gì tới thiết bị" |
| K19 | Template | project 1.0.0; thêm Tag nội bộ BOOL `BOM2.LOI`, `BOM2.LENH_CHAY`; chọn đèn và công tắc ở K6, nhấp phải, **Tạo template…** id `bom`, tham số `prefix` (`tagPrefix`, mặc định `BOM`); **Thêm bản sao…** `bom2` với `prefix` = `BOM2` | 2 bản sao gắn đúng Tag; đổi màu đèn trong template rồi **Cập nhật mọi bản sao** đổi cả hai |
| K20 | Trình vẽ SVG | **Đồ họa SVG** > **Mới: SVG trống…** tên `bom-tay`, 200 × 160; vẽ thân bơm (R), cánh quạt (E, Shift), ống (L), nhãn "P-01" (T); chọn cả bốn, Ctrl+G; Ctrl+S | tệp `graphics/bom-tay.svg` có 4 phần tử trong một nhóm, mỗi phần tử có `data-mat-uid`; Ctrl+Z bỏ nhóm |
