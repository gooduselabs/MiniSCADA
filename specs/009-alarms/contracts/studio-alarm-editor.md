# Contract: editor Alarm của Studio

**Feature**: [spec.md](../spec.md) FR-073…FR-087, SC-001, SC-016, SC-017, SC-023 · **Data model**: [data-model.md](../data-model.md) §10 (Studio) · **Research**: R19, R20 · **ADR**: [030](../../../docs/adr/030-alarm-web-studio.md), [016](../../../docs/adr/016-studio-grid-ime.md) · **UX**: [studio-ux.md](../../../docs/architecture/studio-ux.md) §5, §6, §7 · **Mockup**: `docs/architecture/mockups/studio-alarms.html` (§13) · Mẫu: [studio-screen-editor.md](../../007-screens-widgets/contracts/studio-screen-editor.md)

Studio 0.7.0. **Không có lệnh Tauri mới**: đọc và ghi `alarms.json`, `alarm-classes.json` dùng `project_fs` có sẵn; trạng thái sống dùng `live_open` của 005 (nhận `alarmSnapshot`, `alarmDelta` qua kênh live đã có; xem [live-protocol-1.3.md](live-protocol-1.3.md) §10 về lớp Rust). Định dạng file: [project-format-0.5.md](project-format-0.5.md) và [data-model.md](../data-model.md) §1, §2. Động cơ thử: [alarm-engine.md](alarm-engine.md).

## 1. Cấu trúc mô-đun

```text
apps/studio/src/
├── model/
│   ├── alarm-doc.ts              # tài liệu alarm: thao tác bất biến, kiểm tra theo ô, ánh xạ Issue → ô, đổi tên Tag
│   ├── alarm-sim.ts              # bộ điều khiển "Thử alarm": @mat/alarm-engine + SimEngine + đồng hồ ảo
│   └── tree.ts                   # sửa: nút Alarm mở khóa (§2)
├── ui/editors/
│   ├── alarm-grid.ts             # lưới Danh sách alarm + bảng Khu vực phụ
│   ├── alarm-classes.ts          # editor Lớp alarm + xem trước
│   ├── alarm-quick-create.ts     # hộp thoại "Tạo alarm cho Tag…"
│   └── alarm-test-panel.ts       # panel "Thử alarm"
└── i18n/vi.ts                    # khóa alarm.* (§12)
packages/alarm-engine/            # @mat/alarm-engine 0.1.0 (dùng, không viết ở đây)
packages/project-schema/src/      # rules-05.ts, alarm-rules.ts, migrate.ts (validator, nâng cấp 0.4 → 0.5)
```

Lưới dùng khung lưới ảo hóa của ADR-016 (đã có ở Bảng Tag và Bảng giá trị, 006); không viết lưới thứ hai.

## 2. Cây project (`tree.ts`) và `vi.ts`

Mục **Alarm** dưới nút thiết bị, thay cho mục khóa "GĐ 4" (`PHASE_PAGES.alarm`, `phase: 'p4'`; FR-073).

```text
Alarm                       (icon bell, count = số instance, huy hiệu lỗi/cảnh báo)
├── Danh sách alarm         editor `alarms`        (count = số instance)
└── Lớp alarm               editor `alarmClasses`  (count = số lớp)
```

| Thay đổi | Chi tiết |
|---|---|
| `Phase` | bỏ `'p4'`; `PHASE_LABEL.p4`, `phase.p4` trong `vi.ts` bị xóa |
| `PhasePageKey` | bỏ `'alarm'`; `PHASE_PAGES.alarm` bị xóa |
| `EditorId` | thêm `'alarms'`, `'alarmClasses'`, `'alarmUpgrade'` |
| `NodeRef` | thêm `{type:'alarms'}`, `{type:'alarmClass', id}`, `{type:'alarm', id}` (dùng cho "Dùng ở đâu", nhảy từ lỗi); `refOfNode` nhận `alarm:`, `alarmclass:` |
| Nút `alarm` ở project **0.5** | `{ id:'alarm', label:t('tree.alarm'), icon:'bell', editor:null, count, issues, children:[alarmList, alarmClasses] }`; `alarmList`: `editor:'alarms'`, `count` = số instance; `alarmClasses`: `icon:'list'`, `editor:'alarmClasses'`, `count` = số lớp |
| Nút `alarm` ở project **0.1 đến 0.4** | vẫn hiện (cả `deviceChildren02` lẫn nhánh còn lại của `buildNodes`) nhưng cả hai nút con mở `editor:'alarmUpgrade'`: trang "Nâng cấp lên 0.5.0 để dùng alarm" với nút Nâng cấp (§11). Không còn nhãn giai đoạn "GĐ 4" |
| `TreeNode` | thêm `issues?: { errors: number; warnings: number }` (nhãn số lỗi trên cây, FR-085); `treeMarks` của So sánh thêm đối tượng `alarmList` (§10) |
| `vi.ts` | giữ `tree.alarm`, `tree.alarmList`, `tree.alarmClasses`, `tc.group.alarm` ("Alarm", nhóm Toolbox widget); bỏ `phasePage.alarm`; thêm `phasePage.alarmUpgrade` và khóa `alarm.*` ở §12 |
| `tree.test.ts` | cập nhật: mục Alarm không còn `phase`, có `count`, 0.3 và 0.4 trỏ `alarmUpgrade`; nút mở khóa; `DEFAULT_EXPANDED` không đổi |

## 3. Editor Danh sách alarm (lưới)

Bố cục: thanh công cụ trên cùng; lưới chiếm phần lớn; **bảng Khu vực** phụ bên phải (thu gọn được, §5); thanh trạng thái dưới lưới: "142 instance / 500 (cảnh báo trên 200) · 3 lỗi · 1 cảnh báo".

### 3.1 Cột

| # | Cột | Kiểu ô | Ghi chú |
|---|---|---|---|
| 0 | chọn dòng | hộp chọn | |
| 1 | Id | chữ | `^[A-Za-z][A-Za-z0-9_]{1,47}$`; kéo điền tăng dần (`TANK_01`, `TANK_02`) |
| 2 | Tên | chữ | 1 đến 80 ký tự |
| 3 | Loại | danh sách | Số (`digital`), Ngưỡng (`limit`), Quality (`quality`); đổi loại xóa các ô không áp dụng (hỏi trước nếu mất dữ liệu) |
| 4 | Tag / Thiết bị | ô chọn có gợi ý | `digital`, `limit`: Tag (kiểu hợp loại); `quality`: Tag hoặc thiết bị (nhóm riêng "Thiết bị trường" trong danh sách gợi ý); hỗ trợ kéo Tag từ cây (`application/x-mat-tag`) |
| 5 | Điều kiện | danh sách | `digital`: "Khi bật" hoặc "Khi tắt" (`trigger`); `quality`: "BAD" hoặc "BAD hoặc UNCERTAIN" (`on`); `limit`: khóa (xám) |
| 6 đến 9 | HH, H, L, LL | số | chỉ `limit`; ô trống = ngưỡng không dùng; ô khác loại bị khóa |
| 10 | Deadband | số ≥ 0 | chỉ `limit` |
| 11 | Trễ bật (s) | số 0 đến 86.400 | giao diện nhập bằng giây, lưu mili-giây (FR-010); chấp nhận một chữ số thập phân |
| 12 | Trễ tắt (s) | số | |
| 13 | Lớp | danh sách | tên lớp; `limit`: hiện "HH: Khẩn cấp, H: Nhỏ" rút gọn, nhấp vào mở **cửa sổ nhỏ "Lớp theo ngưỡng"** có bốn danh sách (một mỗi ngưỡng đang dùng); chọn ở ô ngoài đặt cùng một lớp cho mọi ngưỡng |
| 14 | Khu vực | danh sách | gồm "Chung" (rỗng) |
| 15 | Nội dung | chữ | ô nhập có gợi ý thẻ và **Xem trước nội dung** (§6); `limit`: cửa sổ nhỏ có nội dung chung và bốn nội dung theo ngưỡng (trống = mặc định D9) |
| 16 | Bật | hộp tích | `enabled` |
| 17 | Trạng thái sống | chữ + chấm | chỉ khi thiết bị Online (§9) |

Ngưỡng của `limit` đặt ở một dòng (một định nghĩa); trạng thái, lịch sử và số đếm tính theo **instance** (D7); thanh trạng thái đếm instance, không đếm dòng.

### 3.2 Hành vi lưới (như ADR-016 và lưới Tag, thêm riêng cho alarm)

- **Sửa tại ô:** Enter hoặc F2 vào sửa; Enter lưu và xuống ô dưới; Tab lưu và sang ô kế; Esc hủy ô; gõ trực tiếp thay nội dung ô. Gõ tiếng Việt qua bộ gõ Telex hoặc Unikey đúng như lưới Tag (ADR-016: dùng `compositionstart/compositionend`, không xử lý phím khi đang gõ dở).
- **Điền xuống (Ctrl+D):** sao chép ô trên cùng của vùng chọn xuống các ô còn lại trong cột; riêng cột Id kéo điền tăng dần. Ô không áp dụng cho dòng (ví dụ ngưỡng của dòng `digital`) bị **bỏ qua** và thanh trạng thái báo "đã bỏ qua n ô không áp dụng". Một bước hoàn tác.
- **Dán từ Excel (TSV):** dán từ ô đang chọn, theo thứ tự cột hiển thị; nếu dòng đầu của dữ liệu dán khớp tên cột (tiếng Việt hoặc khóa) thì bỏ dòng đó và ánh xạ theo tên cột. Tăng dòng mới khi dán quá cuối lưới. Giá trị sai kiểu vẫn dán vào để **thấy lỗi theo ô** (không chặn). Số instance vượt 500: dán tới khi đủ 500, bỏ phần còn lại và hiện "đã bỏ n dòng vì vượt 500 instance" (Edge Cases: "không dán hết"). Một bước hoàn tác; 500 dòng dán ≤ 1 s.
- **Nhập CSV, xuất CSV:** lệnh "Nhập CSV…" mở hộp chọn tệp (qua `project_fs` hoặc `<input type="file">` của webview; không đọc tệp ngoài thư mục project mà không có thao tác chọn của người dùng). Cột nhận theo tên tiêu đề tiếng Việt hoặc khóa (`id`, `name`, `type`, `tag`, `device`, `trigger`, `on`, `HH`, `H`, `L`, `LL`, `deadband`, `onDelayS`, `offDelayS`, `class`, `area`, `text`, `enabled`); UTF-8 có hoặc không BOM, `,` hoặc `;` (tự nhận); chế độ "Thay thế tất cả" hoặc "Thêm vào" (gộp theo `id`, hỏi khi trùng); dòng thừa cột bị cảnh báo. "Xuất CSV…" ghi các dòng đang hiện sau lọc (hoặc tất cả) với tiêu đề tiếng Việt và thứ tự cột như lưới, trích dẫn RFC 4180, BOM, **ô chuỗi chống công thức** (thêm `'` như [ui-alarm.md](ui-alarm.md) §12.1, để mở bằng Excel an toàn).
- **Lọc, tìm, chọn cột:** Ctrl+F tìm trong lưới (tên, Id, Tag, nội dung, không phân biệt dấu); bộ lọc nhanh: Loại, Lớp, Khu vực, "Chỉ dòng lỗi", "Chỉ dòng chưa dùng ngưỡng"; chọn hiện/ẩn cột (nhớ theo project trong cấu hình Studio). Lọc không đổi dữ liệu; Ctrl+D, dán và xóa hàng loạt chỉ tác động hàng đang hiện.
- **Thêm, xóa dòng:** Insert thêm dòng cuối (Id gợi ý `ALARM_001`); Delete xóa nội dung ô; "Xóa dòng" (menu chuột phải hoặc bảng lệnh) xóa các dòng chọn; hoàn tác 100 bước (`history.ts`, `mergeKey` cho gõ liên tục).
- **Ảo hóa:** ≥ 2.000 dòng cuộn mượt (khung trung bình ≤ 16,7 ms); giới hạn 500 instance là giới hạn nội dung, không phải của lưới (SC-016).
- **Trạng thái bất thường:** dòng alarm trỏ tới Tag chưa có hiển thị ô Tag viền đỏ nhưng vẫn giữ giá trị.
- Phím của lưới chỉ có hiệu lực khi lưới có focus (không toàn cục), để không xung đột với lưới Tag (cùng cách của 007 §4).

### 3.3 Kiểm tra liên tục theo ô (FR-078)

- Mỗi lần sửa, `alarm-doc.ts` gửi tài liệu cho **worker** kiểm tra (cùng validator `@mat/project-schema` `rules-05.ts`, `alarm-rules.ts`); trả `Issue[]` (`{code, severity, path (JSON Pointer), message}`); mục tiêu: sửa ô tới lúc hiện lỗi hoặc hết lỗi ≤ 500 ms (SC-016).
- Ánh xạ `Issue.path` → ô: `/alarms/<i>/id` → (dòng i, Id); `/alarms/<i>/limits/H/value` → (dòng i, H); `/alarms/<i>/limits/H/class` → ô Lớp (và cửa sổ nhỏ); `/alarms/<i>/deadband`, `/onDelayMs`, `/offDelayMs`, `/tag`, `/device`, `/trigger`, `/on`, `/area`, `/text`, `/class`; `/classes/<j>/…` → editor Lớp; `/areas/<k>/…` → bảng Khu vực; không ánh xạ được (ví dụ `E_ALARM_COUNT`) → dòng thanh trạng thái. Hàm `issueCell(issue)` nằm trong `alarm-doc.ts` (có bảng ca thử).
- Hiển thị: ô viền đỏ (lỗi) hoặc vàng hổ phách (cảnh báo) kèm biểu tượng; chi tiết (mã `E_ALARM_*`, câu tiếng Việt) ở tab **Thông tin** của khung dưới; nhấp đôi một dòng lỗi nhảy tới ô và đưa focus vào; tooltip ô hiện nội dung lỗi.
- **Lưu được khi còn lỗi** (khung mới của studio-ux §9); **Nạp xuống bị khóa** khi còn lỗi `E_ALARM_*` (FR-013); cảnh báo `W_ALARM_*` không chặn (`W_ALARM_COUNT_HIGH`, `W_ALARM_NO_ACK_CRITICAL`, `W_ALARM_CHATTER_RISK`, `W_ALARM_DEVICE_EMPTY`).
- Mã lỗi hiển thị đầy đủ theo FR-011: `E_ALARM_ID_DUP`, `_ID_FORMAT`, `_TYPE`, `_TAG_REF`, `_TAG_TYPE`, `_DEVICE_REF`, `_CLASS_REF`, `_AREA_REF`, `_TRIGGER`, `_ON`, `_LIMIT_NONE`, `_LIMIT_ORDER`, `_DEADBAND`, `_DELAY_RANGE`, `_TEXT_LEN`, `_TEXT_TOKEN`, `_FIELD`, `_COUNT`, `_CLASS_DUP`, `_CLASS_FIELD`, `_AREA_DUP`, `_AREA_COUNT`, `_CLASS_COUNT`.

## 4. Editor Lớp alarm (`alarm-classes.ts`)

Lưới nhỏ cộng panel **xem trước** bên phải.

| Cột | Ô | Ghi chú |
|---|---|---|
| Id | chữ | `^[a-z][a-z0-9_]{1,31}$` |
| Tên | chữ | 1 đến 40 |
| Ưu tiên | danh sách | Khẩn cấp, Quan trọng, Nhỏ, Lưu ý (`critical`…`advisory`) (kèm số 1 đến 4 trong tooltip) |
| Màu | ô chọn tám ô màu | tên màu kèm ô vuông; không ô màu tự do (D24) |
| Nhấp nháy | hộp tích | |
| Cần xác nhận | hộp tích | `requiresAck` |
| Xác nhận khi hết | hộp tích | `ackReturn`; khóa khi không `requiresAck` |
| Âm thanh | danh sách | Không, Bíp, Bíp đôi, Còi (`none`, `beep`, `double`, `siren`) |
| Chập chờn (lần/60 s) | số 0 đến 50 | `chatterLimit`; 0 là tắt; mặc định 5 |
| Đang dùng | số | số instance dùng lớp; nhấp liệt kê |

- **Bốn lớp mặc định** của project mới (`critical`, `major`, `minor`, `advisory`, FR-076); giá trị đề xuất khớp mockup (nguồn là [data-model.md](../data-model.md) §2): `critical` đỏ, nhấp nháy, cần xác nhận, còi; `major` cam, nhấp nháy, cần xác nhận, bíp đôi; `minor` hổ phách, không nhấp nháy, cần xác nhận, bíp; `advisory` xanh dương, không nhấp nháy, không cần xác nhận, không âm thanh; `ackReturn` tắt; `chatterLimit` 5.
- Tối đa 16 lớp (`E_ALARM_CLASS_COUNT`); id trùng `E_ALARM_CLASS_DUP`; trường sai `E_ALARM_CLASS_FIELD`.
- **Xóa lớp đang dùng:** hộp liệt kê các alarm dùng lớp (id, ngưỡng) và hỏi xác nhận; nếu xác nhận, các chỗ dùng thành lỗi `E_ALARM_CLASS_REF` (không tự đổi sang lớp khác); hoàn tác một bước.
- **Panel xem trước** (lớp đang chọn): ba hàng mẫu của bảng alarm cho `ACTIVE_UNACK` (nhấp nháy nếu `blink`, đúng như trang), `ACTIVE_ACK`, `RTN_UNACK`; biểu tượng mức ưu tiên và màu hai theme (sáng, tối) cạnh nhau; nút **Nghe thử** phát đúng kiểu âm thanh theo `SOUND_PATTERNS` của `@mat/ui-components` ([ui-alarm.md](ui-alarm.md) §9.1) bằng một `AudioContext` tạo trong thao tác bấm (chính sách tự phát), nút đổi thành "Dừng"; tôn trọng giảm chuyển động của hệ điều hành (nhấp nháy thành viền tĩnh).

## 5. Khu vực (bảng phụ trong trang Danh sách alarm)

- Bảng nhỏ bên phải lưới (id, tên, số alarm); thêm, đổi tên (F2), xóa; "Chung" là mục hệ thống không sửa. Id gợi ý từ tên (bỏ dấu, `-` thay khoảng trắng, `^[a-z0-9][a-z0-9-]{0,31}$`); tối đa 64 (`E_ALARM_AREA_COUNT`), trùng `E_ALARM_AREA_DUP`.
- Đổi tên (hiển thị) không đổi id; đổi id là thao tác riêng cập nhật mọi alarm (một bước hoàn tác).
- **Xóa khu vực đang dùng:** liệt kê nơi dùng, hỏi xác nhận; xác nhận thì các alarm đó chuyển về "Chung" (**khác** lớp: khu vực không bắt buộc), một bước hoàn tác.
- Nhấp một khu vực lọc lưới theo khu vực đó (nhấp lại bỏ lọc).

## 6. Hộp thoại "Tạo alarm cho Tag…" (`alarm-quick-create.ts`)

Mở từ: menu chuột phải một hoặc nhiều Tag ở cây và ở Bảng Tag; menu chuột phải ở lưới alarm; bảng lệnh (lệnh `alarm.quickCreate`). Hộp thoại IDE (không form thô): hai cột, bên trái nhập, bên phải **xem trước** các dòng và instance sẽ tạo.

| Vùng | Nội dung |
|---|---|
| Tag | Tag đang chọn (nhiều Tag: tạo mỗi Tag một alarm với cùng mẫu; danh sách thu gọn) |
| Loại | thẻ chuyển: **Ngưỡng** (cho Tag số), **Số** (cho BOOL hoặc số nguyên), **Quality**; loại không hợp Tag bị khóa kèm lý do |
| Ngưỡng | bốn dòng LL, L, H, HH mỗi dòng có hộp tích, giá trị, lớp gợi ý; mặc định bật H và HH |
| Chung | Deadband, Trễ bật, Trễ tắt, Khu vực |
| Xem trước | bảng các dòng sẽ tạo (id, ngưỡng, lớp, nội dung mặc định đã chèn mẫu), cảnh báo trùng id |

- **Gợi ý ngưỡng** (FR-075): nếu Tag có `min` và `max` (hoặc `limits`), giá trị gợi ý là phần trăm của khoảng: LL 10 %, L 20 %, H 80 %, HH 90 % (US2: Tag 0 đến 100 cho H = 80, HH = 90); Tag không có khoảng thì để trống để người dùng nhập. Gợi ý deadband = 2 % của khoảng (hoặc 1 nếu không có khoảng), trễ bật 3 s, trễ tắt 3 s. Người dùng luôn quyết định.
- **Lớp gợi ý theo ngưỡng:** HH → `critical`, H → `minor`, L → `minor`, LL → `critical` (nếu project thiếu lớp đó thì lớp ưu tiên gần nhất; không có lớp nào thì tạo lớp mặc định bốn lớp trước, kèm thông báo).
- **Id gợi ý:** từ id Tag, thay `.` và ký tự lạ bằng `_`, cắt ≤ 48 ký tự, thêm `_2`, `_3` khi trùng (`TANK01.LEVEL` thành `TANK01_LEVEL`); alarm số giữ id Tag đã chuẩn hóa; alarm quality thêm hậu tố `_COMM` (tránh trùng với alarm số hoặc ngưỡng trên cùng Tag).
- **Số:** chọn `trigger` (mặc định "Khi bật") và lớp (mặc định `major`). **Quality:** chọn Tag hoặc thiết bị (nếu Tag thuộc thiết bị trường, gợi ý "Cả thiết bị"), `on` (mặc định `bad`), trễ bật 0, lớp `minor`.
- **Tạo:** thêm dòng vào lưới trong **một bước hoàn tác**, chọn và cuộn tới dòng mới, mở ô Tên; Kiểm tra chạy ngay. Nếu thêm làm vượt 500 instance: nút Tạo khóa kèm lý do.
- Nội dung mặc định theo D9 (ví dụ H: `{name} cao: {value} {unit} (ngưỡng {limit})`) hiển thị ở xem trước đã chèn mẫu bằng giá trị giữa khoảng.
- Phím: Enter tạo, Esc đóng, Tab qua các ô; bẫy focus; ARIA `role="dialog"`.

## 7. "Thử alarm" (`alarm-test-panel.ts`, `alarm-sim.ts`)

Panel ở **khung dưới** (cạnh Thông tin, Đầu ra), mở bằng nút "Thử alarm" trên thanh công cụ editor hoặc lệnh `alarm.test`; cũng có thể tách thành tab editor. Chạy **bản TS** `@mat/alarm-engine` với `SimEngine` của 006 (D36); không chạy runtime. Kết quả khớp động cơ C++ trên bộ vector chung (SC-017).

### 7.1 Đồng hồ ảo và điều khiển tốc độ

- Một **đồng hồ ảo** (`virtualNowMs`, đồng hồ đơn điệu ảo) bắt đầu tại 0. Mỗi **tick ảo** = 250 ms ảo (cỡ tick của thiết bị). `SimEngine` (nguồn Tag mô phỏng của 006) và `AlarmEngine.step(nowMonoMs, nowEpochMs, tags)` đều nhận **thời gian tiêm vào** từ đồng hồ ảo, không dùng `Date.now()` (yêu cầu của `SimEngine` được kiểm trong task; nếu 006 chưa tiêm được thời gian thì bọc bằng bộ chuyển đổi).
- Tốc độ: nút **1×**, **5×**, **20×**: mỗi 250 ms thật chạy 1, 5, 20 tick ảo liên tiếp (giữ ngữ nghĩa tick: trễ và deadband đúng, không "nhảy" qua điều kiện). Với 500 instance và 20× chi phí không đáng kể (≤ 80 bước/giây).
- Nút: **Chạy/Dừng** (Space khi panel có focus), **Bước** (một tick ảo, phím `.`), **Đặt lại** (R; xóa trạng thái, đồng hồ về 0, nạp lại Tag mô phỏng), phím 1, 2, 3 chọn 1×, 5×, 20×. Phím chỉ có hiệu lực khi panel có focus.
- Hiển thị đồng hồ ảo `mm:ss.s` và tốc độ.

### 7.2 Nguồn Tag và nhập tay

- Bảng "Nguồn" liệt kê Tag mà alarm tham chiếu (và Tag thiết bị cho alarm `quality`): mỗi Tag một dòng, chế độ **Mô phỏng** (theo định nghĩa mô phỏng của 006: ramp, sine, random có hạt giống cố định) hoặc **Nhập tay** (ô số, công tắc BOOL, thanh trượt trong `min`/`max` của Tag). Tag không có định nghĩa mô phỏng mặc định ở **Nhập tay** với giá trị 0.
- **Quality:** nút chuyển GOOD, UNCERTAIN, BAD (kèm ô `reason` TIMEOUT, CLAMPED…) cho từng Tag nhập tay, để thử alarm `quality` và hành vi `inputBad`.
- Nút nhanh cho alarm `limit` đang chọn: "Vượt ngưỡng H" (đặt giá trị = ngưỡng + deadband/2 hoặc ngưỡng + 1), "Về bình thường" (về giữa vùng): giúp thử trễ bật/tắt mà không gõ số.
- Đổi Tag sang **Nhập tay** áp ngay và ghi vào nhật ký ("Nhập tay TANK01.LEVEL = 85").

### 7.3 Bảng alarm và hành động thử

- Bảng alarm đang có dùng **cùng** `<mat-alarm-table>` như trang vận hành ([ui-alarm.md](ui-alarm.md) §4), `mode: 'run'`, nguồn `AlarmSource` từ `alarm-sim.ts` (bọc `AlarmEngine`), `ActionHost` thử: **xác nhận thử**, **tạm ẩn thử** (lý do, thời lượng như thật; hết hạn theo đồng hồ ảo), gỡ tạm ẩn; role giả `operator`. Không audit, không gọi thiết bị.
- Công tắc **Bật/Tắt từng alarm** (vô hiệu thử) trong bảng "Danh sách" của panel; chỉ có tác dụng trong phiên thử, không đổi `enabled` của project.
- Cờ `inputBad`, `startup` (mô phỏng "khởi động": nút "Khởi động lại engine" dựng lại engine với Tag hiện tại để thấy lần xảy ra `startup`), chập chờn (tự cách ly sau `chatterLimit`) hiện đúng như thiết bị.
- Alarm hợp lệ chạy được khi project còn lỗi: panel chạy các alarm hợp lệ và liệt kê alarm bị bỏ qua kèm mã lỗi ("2 alarm bị bỏ qua vì lỗi", nhấp nhảy tới ô; Edge Cases).

### 7.4 Nhật ký chuyển trạng thái

Bảng cuộn (vòng 2.000 dòng): cột **Giờ ảo** (`mm:ss.sss`), **Instance**, **Chuyển** (`NORMAL → ACTIVE_UNACK`), **Lý do**, **Chi tiết**. Lý do dùng từ vựng cố định của động cơ: `on-delay` (hết trễ bật), `off-delay` (hết trễ tắt), `deadband` (về khỏi vùng deadband), `ack` (xác nhận thử), `ack-return`, `shelve`, `shelve-expired`, `unshelve`, `chatter-isolate`, `chatter-release`, `disable`, `enable`, `input-bad`, `input-good`, `restart`. Dòng ví dụ: `00:03.250 · TANK01_LEVEL.H · NORMAL → ACTIVE_UNACK · on-delay · giá trị 85, ngưỡng 80, trễ 3 s`. Lọc theo instance (nhấp vào dòng bảng alarm), tìm chữ, nút "Sao chép nhật ký" (TSV, ô chuỗi chống công thức như CSV) và "Xóa nhật ký".

### 7.5 Xem trước màn hình

Ở xem trước chế độ **Mô phỏng** của editor Màn hình (007), `StudioActionHost` và nguồn cấp `AlarmSource` từ `alarm-sim.ts` cho widget `alarm-list`, `alarm-count` (FR-081); chế độ **Thiết bị** cấp từ live của thiết bị Online, chỉ đọc (ba hàm của `ActionHost` về `READ_ONLY`). Chế độ **Tắt**: widget hiện "Không có dữ liệu alarm".

## 8. Cột trạng thái sống khi Online

- Khi phiên thiết bị Online (`monitoring` hoặc `relogin`), Studio gửi `subscribeAlarms` trên kênh live đã mở ([live-protocol-1.3.md](live-protocol-1.3.md)) nếu `hello.features` có `alarms`; cột **Trạng thái sống** (viền cam theo studio-ux §7: "cam là đang online") hiện chấm màu + chữ trạng thái instance (Bình thường, Chưa xác nhận, Đã xác nhận, Đã hết chưa xác nhận, Tạm ẩn, Vô hiệu) kèm thời gian bật.
- Dòng `limit` gom bốn ngưỡng: hiện trạng thái nặng nhất (ưu tiên cao nhất, rồi chưa xác nhận trước) và số "2/4" (số ngưỡng đang có); tooltip liệt kê từng ngưỡng. Dòng chưa có trên thiết bị (chưa nạp xuống) hiện "—" kèm tooltip "Chưa có trên thiết bị".
- Thiết bị `unsupported` (runtime < 0.8.0): cột vắng, dải thông báo "Thiết bị chưa hỗ trợ alarm" (và Nạp xuống project có alarm bị khóa, FR-014).
- **Sửa định nghĩa khi Online không đổi gì trên thiết bị** tới khi Nạp xuống (US2 kịch bản 8): cảnh báo khác biệt với thiết bị trên thanh công cụ ("Khác thiết bị: n"), không tự đẩy (Edge Cases).
- Cột này chỉ **đọc**: Studio không xác nhận hay tạm ẩn alarm (D31).

## 9. Đổi tên và xóa Tag, "Dùng ở đâu"

- **Đổi tên Tag** (006) mở rộng: cập nhật `tag` của mọi alarm (cả `digital`, `limit`, `quality` có `tag`) trong **cùng một bước hoàn tác** với các nơi đã có (màn hình, Tag tính toán, lưu trữ, bảng theo dõi). `alarm-doc.ts` xuất `renameTagRefs(doc, from, to)`; test: mọi đường tham chiếu (FR-082).
- **Xóa Tag đang có alarm:** hộp liệt kê các alarm dùng Tag (id, loại), hỏi xác nhận; xác nhận thì Tag bị xóa và các alarm thành lỗi `E_ALARM_TAG_REF` (như màn hình thành lỗi ở 007); hoàn tác một bước. Xóa thiết bị trường làm alarm `device` thành `E_ALARM_DEVICE_REF`.
- **"Dùng ở đâu"** của Tag liệt kê cả alarm (id, ngưỡng nếu có), nhấp nhảy tới dòng trong lưới.

## 10. So sánh theo đối tượng (FR-083)

Tab So sánh ([studio-ux.md](../../../docs/architecture/studio-ux.md) §6.3) so alarm và lớp **theo id**, không theo dòng JSON: ba loại đối tượng `alarm` (id định nghĩa), `alarmClass`, `alarmArea`. Ký hiệu `=`, `≠`, `+`, `-`; chi tiết hiện trường khác nhau ("H: 80 → 85", "Lớp HH: critical → major", "Trễ bật: 3 → 5 s"). Thứ tự dòng trong tệp không tạo khác biệt. Trên cây khi Online, nút `alarmList` (và `alarmClasses`) gộp ký hiệu từ các đối tượng (`rollUp` có sẵn). Định dạng ghi `alarms.json` ổn định (thứ tự khóa chuẩn, không ghi trường bằng mặc định, mỗi alarm một khối gọn) để diff dòng cũng đọc được (FR-084).

## 11. Nâng cấp 0.3 → 0.5.0 trong Studio (FR-012, FR-085)

- Mở project 0.1 đến 0.4: hộp thoại **Nâng cấp** như 006 FR-003 và 007 FR-007: nói đổi gì ("chỉ đổi `schemaVersion` của mọi tệp và nâng runtime tối thiểu lên 0.8.0, thêm nơi chứa alarm trống; nội dung giữ nguyên"), nơi sao lưu (thư mục `.mat-backup/<thời điểm>` ngay trước lần lưu đầu), nút **Nâng cấp**, **Mở chỉ đọc**, **Hủy**. 0.1, 0.2 và 0.3 nâng qua các bước trung gian (qua 0.4 của 3b) trong một lần.
- Nâng cấp **không tạo** tệp alarm rỗng; mục Alarm trên cây mở khóa; lưới trống có dòng gợi ý "Thêm alarm đầu tiên" và nút "Tạo alarm cho Tag…". Tệp `alarms.json` và `alarm-classes.json` chỉ được tạo khi có nội dung đầu tiên (và `alarm-classes.json` kèm bốn lớp mặc định khi thêm alarm đầu tiên, nếu chưa có).
- Trang `alarmUpgrade` (project < 0.5): giải thích ngắn, nút "Nâng cấp lên 0.5.0" (cùng hộp thoại), không có nhãn giai đoạn.
- Project 0.6 trở lên: Studio 0.7 từ chối mở (như 006 FR-005).
- Tương thích runtime: cột Tương thích runtime của Nạp xuống khóa khi project 0.5 **có alarm** và thiết bị chạy runtime < 0.8.0, lý do "cần runtime ≥ 0.8.0" (US2 kịch bản 9).

## 12. Phím tắt và lệnh trong bảng lệnh

Bảng lệnh (Ctrl+Shift+P): mọi lệnh dùng được bằng bàn phím. Phím của editor alarm **chỉ có hiệu lực khi lưới (hoặc panel) có focus**; phím toàn cục của 004 đến 007 (Ctrl+S, Ctrl+Z, Ctrl+Y, Ctrl+K, Ctrl+M, Ctrl+L, Ctrl+F, Ctrl+Shift+P, F2, F6, F7) giữ nguyên; `shortcuts.test.ts` kiểm không xung đột.

| Lệnh (khóa) | Nhãn bảng lệnh | Phím (khi có focus) |
|---|---|---|
| `alarm.open` | Mở danh sách alarm | |
| `alarm.classes.open` | Mở lớp alarm | |
| `alarm.areas.focus` | Chuyển tới bảng khu vực | |
| `alarm.new` | Thêm alarm | Insert (lưới) |
| `alarm.quickCreate` | Tạo alarm cho Tag… | |
| `alarm.fillDown` | Điền xuống | Ctrl+D (lưới) |
| `alarm.import` | Nhập CSV… | |
| `alarm.export` | Xuất CSV… | |
| `alarm.filter.errors` | Chỉ hiện dòng lỗi | |
| `alarm.deleteRows` | Xóa dòng đã chọn | |
| `alarm.test.open` | Thử alarm | |
| `alarm.test.run` | Thử alarm: chạy hoặc dừng | Space (panel) |
| `alarm.test.step` | Thử alarm: một bước | `.` (panel) |
| `alarm.test.reset` | Thử alarm: đặt lại | R (panel) |
| `alarm.test.speed1` / `speed5` / `speed20` | Thử alarm: 1×, 5×, 20× | 1, 2, 3 (panel) |
| `alarm.upgrade` | Nâng cấp project lên 0.5.0 | |

Lệnh và phím có nhãn tiếng Việt trong bảng chuỗi; mỗi lệnh có điều kiện bật (ví dụ `alarm.test.*` khi project có ≥ 1 alarm hợp lệ; `alarm.quickCreate` khi có Tag).

### 12.1 Chuỗi giao diện (`i18n/vi.ts`, tiền tố `alarm.`)

Mọi chuỗi mới nằm ở bảng chuỗi (FR-067, SC-024); khóa chính: `alarm.grid.col.*` (tên cột §3.1), `alarm.grid.type.digital|limit|quality`, `alarm.grid.trigger.on|off`, `alarm.grid.qualityOn.bad|notGood`, `alarm.grid.status` ("{n} instance / 500 · {e} lỗi · {w} cảnh báo"), `alarm.grid.skipped` ("đã bỏ qua {n} ô không áp dụng"), `alarm.grid.pasteOverLimit` ("đã bỏ {n} dòng vì vượt 500 instance"), `alarm.classes.*` (cột §4, `alarm.classes.preview`, `alarm.classes.listen`, `alarm.classes.stop`, `alarm.classes.inUse`), `alarm.area.*`, `alarm.quick.*` (tiêu đề, loại, ngưỡng, gợi ý, "Tạo"), `alarm.text.preview` ("Xem trước nội dung"), `alarm.text.tokenHint`, `alarm.test.*` (nút, bảng nguồn, cột nhật ký, lý do `on-delay`… bằng chữ: "hết trễ bật", "hết trễ tắt", "ra khỏi vùng deadband", "xác nhận", "tạm ẩn", "tự cách ly do chập chờn"…), `alarm.live.*` (Online), `alarm.upgrade.*`, `alarm.error.*` (một câu tiếng Việt cho mỗi mã `E_ALARM_*` và `W_ALARM_*`), `alarm.cmd.*` (nhãn lệnh §12). Phần dùng chung với trang (trạng thái, mức ưu tiên, lỗi thao tác) lấy từ `@mat/ui-components` ([ui-alarm.md](ui-alarm.md) §14), không nhân đôi.

## 13. Mockup `studio-alarms.html`

`docs/architecture/mockups/studio-alarms.html`, mở trực tiếp bằng Chrome (như `studio-screens.html`), dữ liệu lấy từ một project mẫu (`TANK01`, `PUMP1`, `METER3`…). **Task chặn** (FR-086, D40): tạo và tự duyệt **trước** khi viết giao diện Studio; đầu tệp ghi ngày duyệt và danh sách điểm đã chốt; khác biệt khi làm ra phải ghi vào `docs/reports/009-sc016.md`. Ba cảnh bắt buộc:

1. **Danh sách alarm (lưới).** Khung Studio với cây (mục Alarm mở), lưới ≥ 20 dòng gồm đủ ba loại, một dòng `limit` với bốn ngưỡng và cửa sổ "Lớp theo ngưỡng" mở, hai ô lỗi (ngưỡng sai thứ tự, Tag không có) kèm tab Thông tin có `E_ALARM_*`, một cảnh báo, bảng Khu vực bên phải, thanh công cụ (lọc, Nhập/Xuất CSV, Thử alarm), thanh trạng thái đếm instance; công tắc chuyển Online để thấy cột Trạng thái sống viền cam.
2. **Lớp alarm và Tạo alarm cho Tag.** Lưới bốn lớp với ô chọn màu, panel xem trước ba hàng nhấp nháy (có nút Nghe thử và công tắc giảm chuyển động) hai theme; chồng lên là hộp thoại "Tạo alarm cho Tag…" với bốn ngưỡng, gợi ý, xem trước các dòng sẽ tạo.
3. **Thử alarm.** Panel khung dưới: điều khiển 1×/5×/20×, đồng hồ ảo, bảng Nguồn (một Tag Nhập tay đang đặt giá trị, một Tag quality BAD), bảng alarm đang có (một hàng nhấp nháy, một `RTN_UNACK`, một shelved), nhật ký chuyển trạng thái.

Mockup có công tắc theme sáng và tối, và một mục chú giải màu, biểu tượng mức ưu tiên (bốn hình) và trạng thái. Studio làm theo bố cục này; đối chiếu quy tắc studio-ux §5 và §7 ở `docs/reports/009-sc016.md`.

## 14. Test

- Vitest thuần: `alarm-doc.test.ts` (thao tác bất biến, dán và điền xuống, giới hạn 500 instance, `issueCell` mọi mã, `renameTagRefs`, nhập và xuất CSV vòng tròn, chống công thức), `alarm-sim.test.ts` (đồng hồ ảo, 1×/5×/20× cho cùng chuỗi chuyển trạng thái, nhập tay, nhật ký, khớp **bộ vector chung** `tests/alarm-vectors/` đọc bằng cùng bộ nạp với test của `@mat/alarm-engine`: SC-017), `tree.test.ts` cập nhật, `migrate.test.ts` (cặp 0.4 → 0.5, chỉ đổi `schemaVersion`), `shortcuts.test.ts`, `alarm-quick-create.test.ts` (gợi ý ngưỡng, id, lớp), `alarm-classes.test.ts` (xóa lớp đang dùng, khóa `ackReturn`).
- e2e Chrome headless (lớp Tauri giả, axe-core, `apps/studio/tests/e2e/alarm-*.e2e.mjs`): `alarm-build` (từ project 0.3 của 007: nâng cấp, dựng 200 alarm gồm ba loại, ≥ 4 lớp, ≥ 5 khu vực bằng dán CSV, "Tạo alarm cho Tag…", kéo điền; Kiểm tra không lỗi; Nạp xuống runtime x64; Đọc lên và So sánh "giống": SC-001), `alarm-test-panel` (Thử alarm, vector), `alarm-grid-perf` (SC-016: mở 200 dòng ≤ 1 s, sửa ô → lỗi ≤ 500 ms, cuộn 2.000 dòng), `alarm-a11y` (axe, chỉ bàn phím), `alarm-compare` (So sánh theo đối tượng), `alarm-upgrade`.
- Thử tay (cần người, [quickstart.md](../quickstart.md) §7): bộ gõ Telex và Unikey ở ô Tên và Nội dung; NVDA ở lưới; một kỹ sư chưa dùng editor làm trọn kịch bản ≤ 10 phút (SC-023; không có người thì ghi "tự đo" kèm các chỗ vấp).

## Điểm cần sửa spec

- **Cột điều kiện cho alarm số và quality.** Đã xử lý trong spec (FR-074: thêm cột Điều kiện).
- **Lớp và nội dung theo ngưỡng trong một dòng lưới.** FR-002 và FR-004 cho mỗi ngưỡng một `class` và `text` riêng, nhưng FR-074 chỉ có một cột Lớp và một cột Nội dung. Hợp đồng dùng cửa sổ nhỏ "Lớp theo ngưỡng" và nội dung theo ngưỡng (§3.1). Đề nghị ghi rõ trong FR-074.
- **Gợi ý ngưỡng.** Đã xử lý trong spec (FR-075: gợi ý 10/20/80/90 %).
- **Âm thanh trong Studio:** editor Lớp alarm cần nghe thử cùng bảng mẫu với trang; `SOUND_PATTERNS` đặt ở `@mat/ui-components` (`alarm-format.ts`) để dùng chung. Danh sách tệp của digest chỉ có `apps/runtime-web/src/alarm/sound.ts`; đề nghị ghi vào plan.
- **Mặc định bốn lớp** (§4) không được spec nêu giá trị; nguồn phải là [data-model.md](../data-model.md) §2 và [project-format-0.5.md](project-format-0.5.md). Hai nơi phải khớp.
- **`SimEngine` và thời gian tiêm vào** (§7.1): spec D36 giả định đồng hồ ảo cho mô phỏng 006; cần xác nhận `SimEngine` nhận thời gian từ ngoài (nếu không thì thêm task bọc).
