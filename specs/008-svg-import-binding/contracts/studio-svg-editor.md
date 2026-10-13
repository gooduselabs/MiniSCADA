# Contract: Studio 0.6.0, nhập SVG, chọn phần tử, inspector Gắn Tag và Sự kiện

**Feature**: [spec.md](../spec.md) US1, US2, US3, US4, US5, FR-011, FR-026…FR-031, FR-042…FR-047, FR-054, FR-057, FR-058, FR-067 · **Research**: R15, R16, R17, R24 · **ADR**: [026](../../../docs/adr/026-symbol-library-svg-editing.md) · **Mockup**: [studio-svg.html](../../../docs/architecture/mockups/studio-svg.html) (task tạo) · Chuẩn giao diện: [studio-ux.md](../../../docs/architecture/studio-ux.md) §5, §7, §9

Mở rộng editor Màn hình 0.3 của 007 ([studio-screen-editor.md](../../007-screens-widgets/contracts/studio-screen-editor.md)). Quyết định ở TS thuần (`model/`), giao diện chỉ hiển thị; mạng và file qua Rust (một lệnh mới: `svg_open`).

## 1. Mô-đun

```text
apps/studio/src/
├── model/
│   ├── svg-doc.ts              # tài liệu SVG của item: văn bản đã nhập, cây phần tử (ElementInfo), đổi tên phần tử
│   ├── svg-binding-doc.ts      # binding và sự kiện theo item: addBinding, updateBinding, removeBinding, setEvent, copyBindings, applyToMany, renameTag
│   ├── animation-catalog.ts    # 13 mục động hóa (§5): đích, phần tử hợp, kiểu Tag, phép biến đổi, đặc tả tham số
│   ├── svg-suggest.ts          # Gợi ý (§6) + bảng từ khóa tên
│   ├── svg-issues.ts           # lỗi theo dòng/phần tử từ rules-04 + kiểm SVG
│   ├── import-flow.ts          # luồng Nhập SVG và Nhập lại: svg_open → importSvg → hộp thoại → ghi tài liệu
│   ├── reimport-flow.ts        # đối chiếu, lựa chọn, áp dụng
│   ├── symbol-flow.ts          # thả ký hiệu → item svg + file; portSnap
│   └── svg-select.ts           # chọn phần tử: hit-test (elementsFromPoint), khung chọn, Alt+nhấp
├── ui/
│   ├── dialogs/import-svg.ts, import-report.ts, reimport.ts
│   ├── screen/mat-svg-overlay.ts      # khung chọn phần tử, chấm điểm gắn
│   ├── editors/svg-element-tree.ts    # cây phần tử (Details), dựng lười
│   ├── props-svg-element.ts           # thay props-element.ts: Chung, Gắn Tag, Sự kiện, Bảo mật
│   ├── props-svg-bind.ts, props-svg-events.ts, test-strip.ts
│   └── mat-taskcards.ts               # nhóm Toolbox "Ký hiệu SVG"
├── workers/import.worker.ts    # chạy importSvg ngoài luồng chính (tiến độ qua postMessage)
├── i18n/vi-svg.ts, vi-import.ts
└── src-tauri/src/svg.rs        # lệnh svg_open
```

## 2. Lệnh và phím

| Lệnh | Phím | Điều kiện |
|---|---|---|
| Thêm › Đồ họa SVG… | Ctrl+Shift+I | project 0.4 mở để sửa, editor Màn hình đang mở |
| Nhập lại SVG… | (menu ngữ cảnh item, bảng lệnh) | chọn item `svg` |
| Vào đồ họa | Enter hoặc nhấp đúp trên item `svg` | |
| Thoát đồ họa | Esc | đang vào |
| Chọn phần tử cha | Alt+nhấp, Alt+↑ | đang vào |
| Đổi tên phần tử | F2 | phần tử chọn |
| Sao chép bộ binding | Ctrl+C (khi focus inspector Gắn Tag) | |
| Dán bộ binding | Ctrl+V (khi focus inspector Gắn Tag) | |
| Thử giá trị / Đặt lại | (thanh Thử giá trị) | dòng đã gắn Tag |
| Gợi ý | (nút ở nhóm Gắn Tag) | |

Mọi lệnh có trong bảng lệnh (Ctrl+Shift+P). Phím Ctrl+Z/Ctrl+Y áp cho mọi thao tác dưới đây (một thao tác một bước, tới 100 bước).

## 3. Hộp thoại **Nhập SVG**

```text
┌─ Nhập SVG ───────────────────────────────────────────────────────────────────────────┐
│ File: tank-process.svg (412 KB)   Phần mềm: Inkscape 1.4.4 (chắc chắn)               │
│ ┌ Trước ─────────────────┐ ┌ Sau (đã làm sạch) ──────┐  Phần tử: 1.284 → 1.201       │
│ │      [xem trước]       │ │      [xem trước]        │  UID gán: 1.201   Tên: 88      │
│ └────────────────────────┘ └─────────────────────────┘  Độ sâu: 7                      │
│ Báo cáo   [Đã loại 5] [Đã chuyển 4] [Cảnh báo 2]                                      │
│  Loại     Tên            SL  Lý do                                     Vị trí ví dụ  │
│  phần tử  script          2  R_SCRIPT   Mã chạy không được phép           /svg/script │
│  thuộc tính onclick      14  R_EVENT_ATTR  Trình xử lý sự kiện …          /svg/g[2]… │
│  …                                                                                    │
│ [ ] Tối ưu (gộp hình nhỏ cùng kiểu)   (gợi ý khi vượt 20.000 phần tử)                 │
│                                          [Lưu báo cáo…]   [Hủy]   [Nhập  Enter]       │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- Các bước: chọn file (`svg_open`) → chạy `importSvg` (trong Web Worker để không chặn giao diện với file lớn; `postMessage` báo tiến độ) → hộp thoại.
- Từ chối (`ok: false`): hộp thoại một thông báo lỗi (mã, câu hướng dẫn), chỉ có [Đóng] và [Chọn file khác].
- Xem trước "Trước": dựng bản gốc **đã lọc bằng allowlist** (không bao giờ dựng bản chưa lọc trong Studio); "Sau": bản đã nhập.
- Ctrl+S trong hộp thoại: lưu báo cáo (`.json` hoặc `.md`) bằng lệnh lưu văn bản có sẵn của 006 (`csv_save`: hộp thoại lưu của hệ thống, ghi nguyên tử văn bản do giao diện đưa). Task T055 kiểm bộ lọc đuôi của `csv_save` và, nếu nó cố định `.csv`, thêm tham số bộ lọc (một dòng, không lệnh mới).
- Bấm Nhập: thêm item `svg` (D29), ghi `graphics/<slug>.svg` và `screens/<màn hình>.<item>.bindings.json` (rỗng) vào tài liệu (chưa ghi đĩa), chọn item; một bước hoàn tác.
- Trợ năng: hộp thoại `role="dialog"`, bẫy focus, Esc đóng, bảng báo cáo có tiêu đề cột, Enter nhập.

## 4. Hộp thoại **Đối chiếu lại**

```text
┌─ Đối chiếu lại: Sơ đồ bồn (bon-nuoc / svg_bon) ──────────────────────────────────────┐
│ 46 giữ nguyên · 3 mới · 2 cần chọn · 1 mồ côi có binding                              │
│ ┌ Cần chọn (2) ───────────────────────────────┐ ┌ Hai phần tử ──────────────────────┐ │
│ │ ▸ rect "Van 3"   ứng viên: Van 3 (0,2 %), … │ │ Mới [hình]        Cũ [hình]       │ │
│ │ ▸ g    "Bơm B"   ứng viên: Bơm 2 (1,4 %), … │ │ tag: rect         tag: rect       │ │
│ └─────────────────────────────────────────────┘ │ vị trí: …         vị trí: …       │ │
│ ┌ Mồ côi (1) ─────────────────────────────────┐ │ Chọn: ( ) Van 3  ( ) Van 4  (•) Mới│ │
│ │ ▸ "Cánh quạt cũ" (có 2 binding)  [Bỏ binding] [Giữ mồ côi] │ └───────────────────┘ │
│ └─────────────────────────────────────────────┘                                       │
│                                                [Hủy]  [Áp dụng  Enter]                │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

- Mặc định: phần tử "cần chọn" chọn "Mới" (an toàn: không gán UID cũ).
- Áp dụng: thay SVG của item (`graphics/…svg`: nếu dùng chung với item khác thì hỏi "áp cho mọi thể hiện" hay "tách file", mặc định tách), cập nhật `elements` và file binding (bỏ binding đã chọn "Bỏ"), một bước hoàn tác. "Giữ mồ côi" để lại `E_REF_UID`.
- Hủy: không đổi gì.

## 5. Danh sách động hóa (`animation-catalog.ts`): 13 mục

| `id` | Nhãn | Đích | Phần tử hợp | Tag | Phép biến đổi (nút) | Tham số |
|---|---|---|---|---|---|---|
| `text` | Chữ hiển thị giá trị | `text.content` | `text` | mọi | Trực tiếp, Bảng giá trị, Khoảng, Rời rạc | số lẻ 0–6, tiền tố, hậu tố, đơn vị của Tag |
| `fill` | Màu nền | `style.fill` | hình, nhóm, chữ | mọi | Rời rạc, Bảng giá trị, Khoảng | màu mặc định (`default`) |
| `stroke` | Màu viền | `style.stroke` | hình, nhóm, chữ | mọi | Rời rạc, Bảng giá trị, Khoảng | màu mặc định |
| `level` | Mức chất lỏng | `geometry.levelPercent` (`rect`) hoặc `geometry.clipLevel` | hình, nhóm | số | Trực tiếp, Tuyến tính | hướng; khoảng vào (min, max) |
| `rotate` | Quay | `transform.rotate` | mọi | số | Trực tiếp, Tuyến tính, Khoảng | tâm quay (9 điểm + nhập tay) |
| `spin` | Quay liên tục | `transform.rotate` + `spin` | mọi | số, BOOL | Trực tiếp, Tuyến tính, Rời rạc | tâm quay, vòng/phút (số hoặc BOOL), chiều |
| `translateX` | Di chuyển X | `transform.translateX` | mọi | số | Trực tiếp, Tuyến tính, Khoảng | vào [min, max] → ra [min, max] |
| `translateY` | Di chuyển Y | `transform.translateY` | mọi | số | như trên | |
| `scale` | Co giãn | `transform.scale` | mọi | số | Trực tiếp, Tuyến tính, Khoảng | trục (đều, X, Y), tâm co giãn |
| `blink` | Nhấp nháy | `effect.blink` | mọi | BOOL, số | Trực tiếp, Rời rạc, Khoảng | chu kỳ (400–5000), kiểu (độ mờ, màu nền, màu viền), độ mờ thấp, màu |
| `flow` | Dòng chảy | `effect.flow` | hình có nét | BOOL, số | Trực tiếp, Tuyến tính, Rời rạc | mẫu nét, tốc độ, chiều, theo dấu |
| `visibility` | Ẩn/hiện | `style.visibility` | mọi | BOOL, số | Trực tiếp (có Đảo), Rời rạc, Khoảng | |
| `opacity` | Độ mờ | `style.opacity` | mọi | số | Trực tiếp, Tuyến tính | |

Mỗi dòng của inspector: tên; ô Tag (kéo thả hoặc nút chọn); nút phép biến đổi; vùng tham số (gập); giá trị hiện tại (Mô phỏng hoặc Online); nút xóa; chỉ báo lỗi. Dòng không hợp loại phần tử hoặc kiểu Tag: mờ kèm lý do, không nhận thả.

**Trình soạn phép biến đổi:**

- **Trực tiếp:** không tham số.
- **Rời rạc:** bảng `equals → value` (BOOL: hai ô cố định `true`, `false`; số: thêm dòng) + giá trị `default`.
- **Tuyến tính:** `inMin`, `inMax`, `outMin`, `outMax`, `clamp`; mặc định `inMin`/`inMax` lấy từ `min`/`max` của Tag (`limits` hoặc thuộc tính), `outMin`/`outMax` theo đích (mức 0–100, quay 0–360, co giãn 0,01–10, di chuyển 0–100).
- **Bảng giá trị:** chọn bảng (mặc định bảng của Tag); mở editor bảng giá trị (006) từ nút.
- **Khoảng** (`rangeMap`): bảng `từ`, `đến`, giá trị (ô màu hoặc chữ hoặc số tùy đích) + `default`; kiểm lỗi từng ô (`E_RANGE`: chồng, `từ` ≥ `đến`); sắp theo `từ`.

## 6. Gợi ý (`svg-suggest.ts`)

Khi có phần tử và Tag (kéo vào hoặc chọn), nút **Gợi ý** đề nghị (chấp nhận hoặc bỏ):

| Phần tử | Tag | Đề nghị |
|---|---|---|
| `text` | số | `text`: Trực tiếp, 1 số lẻ, đơn vị của Tag |
| `text` | Tag có bảng giá trị | `text`: Bảng giá trị |
| hình hoặc nhóm tên chứa từ khóa mức (`liquid`, `water`, `level`, `nước`, `mức`, `chất lỏng`) | số | `level`: Tuyến tính theo `min`–`max` của Tag |
| hình hoặc nhóm | BOOL | `fill`: Rời rạc (`true` #43a047, `false` #9e9e9e) |
| hình hoặc nhóm | Tag có bảng giá trị | `fill`: Bảng giá trị |
| nhóm hoặc hình tên chứa từ khóa quay (`rotor`, `impeller`, `fan`, `blade`, `cánh`, `quạt`, `trục`) | BOOL hoặc số | `spin` |
| đường, đường gấp khúc, `path` có nét | BOOL | `flow` |
| hình tên chứa từ khóa cảnh báo (`alarm`, `warn`, `cảnh báo`, `báo động`) | BOOL | `blink` kèm `fill` Rời rạc (để nhấp nháy không là tín hiệu duy nhất) |

Từ khóa nằm trong dữ liệu (`svg-suggest-keywords.ts`), so khớp không phân biệt hoa thường và dấu. Gợi ý không bao giờ tự áp dụng.

## 7. Thanh **Thử giá trị**

- Hiện ở đầu nhóm Gắn Tag khi dòng đang chọn đã có Tag.
- Điều khiển theo kiểu Tag: BOOL = công tắc; số = thanh trượt (khoảng `min`–`max` của Tag hoặc `inMin`–`inMax`) cộng ô số; chuỗi/bảng giá trị = danh sách chọn.
- Đặt giá trị cho Tag trong `SimEngine` (006) ở chế độ nhập tay và chuyển canvas sang hiển thị Mô phỏng tạm thời **chỉ cho item đang vào**; Đặt lại, bỏ chọn hoặc đóng editor thì khôi phục giá trị mô phỏng cũ.
- Không ghi vào project, không tới thiết bị (kể cả khi Online).

## 8. Nhóm **Sự kiện** (`props-svg-events.ts`)

- Một ô "Nhấp chuột" với danh sách hành động: Không có, Chuyển màn hình, Mở popup, Đóng popup, Ghi giá trị, Đảo, Xung.
- Chuyển màn hình: danh sách màn hình `screen`; Mở popup: danh sách màn hình `popup` (có nút tạo popup mới); Ghi/Đảo/Xung: ô Tag (chỉ Tag RW không `calculated`; kéo thả), giá trị (theo kiểu Tag), `durationMs` (xung), xác nhận (Luôn, Không, chỉ BOOL), quyền tối thiểu, nhãn đọc.
- Lỗi theo `E_EVENT_*` hiện ở đúng ô; nhắc "Xung trên Tag bật đọc lại" (`W_EVENT_PULSE_READBACK`).
- Nhóm **Bảo mật** (đã có): `minRole` của sự kiện hiển thị ở đây và ở nhóm Sự kiện cùng một giá trị.

## 9. Toolbox **Ký hiệu SVG** và dính điểm gắn

- Nhóm trong `mat-taskcards`: lưới biểu tượng theo nhóm (Bồn, Bơm, Van, Motor, Ống), ô tìm; kéo thả vào canvas (HTML5 DnD như widget của 007).
- Thả: tạo thể hiện theo [symbol-library.md](symbol-library.md) §5.
- Khi kéo thể hiện hoặc ký hiệu lại gần điểm gắn tương thích: hiện chấm gắn (xanh), dính (`portSnap`); Alt tắt.
- **Gắn nhanh:** inspector khi chọn item `svg` có `parts` trong manifest: danh sách bộ phận (nhãn, `suggest`); bấm vào một bộ phận → vào item, chọn phần tử của bộ phận, mở nhóm Gắn Tag cuộn tới dòng gợi ý đầu tiên.

## 10. Chọn phần tử (`svg-select.ts`, `mat-svg-overlay.ts`)

- "Vào" item: lưu `enteredItemId` ở trạng thái editor; canvas vẫn dựng bằng `<mat-screen mode="edit">`; con trỏ chuột chữ thập; thanh trạng thái hiện đường dẫn "Màn hình › Item › Phần tử".
- Hit-test: `root.elementsFromPoint(clientX, clientY)` của Shadow DOM item; lấy phần tử đầu danh sách có `data-mat-uid`; Alt+nhấp: phần tử có UID kế tiếp trong danh sách (cha); Shift+nhấp: thêm vào vùng chọn (cùng item).
- Khung chọn: `getBoundingClientRect()` quy về đơn vị thiết kế bằng zoom của viewport và vị trí canvas; vẽ ở lớp phủ; tính lại khi zoom, pan, đổi cỡ; không sửa DOM của SVG.
- Cây phần tử (Details): dựng lười (con của nút khi mở); hiển thị tên (`data-mat-name`), thẻ, biểu tượng có binding hoặc sự kiện; lọc theo tên; chọn đồng bộ với canvas; ≥ 20.000 nút vẫn mở ≤ 300 ms (chỉ dựng cấp trên cùng).
- Phím trong cây: ↑↓ di chuyển, ←→ gập mở, Enter mở inspector, F2 đổi tên.
- Thoát: Esc hoặc nhấp ngoài item.

## 11. Hoàn tác, nâng cấp, đổi tên Tag, "Dùng ở đâu"

- `svg-binding-doc` và `svg-doc` đẩy mỗi thao tác một bước vào `history.ts` có sẵn.
- Nâng cấp 0.3 → 0.4: hộp thoại như 007 (`migrate03to04`).
- Đổi tên Tag (`rename-flow.ts`, 006): thêm duyệt `svg-binding-doc` của mọi item và sự kiện; cùng một bước hoàn tác.
- "Dùng ở đâu" (`xref.ts`): thêm loại `svgElement` (màn hình, item, tên phần tử, thuộc tính/sự kiện).
- Khi xóa màn hình: liệt kê cả sự kiện SVG trỏ tới (như widget).

## 12. Rust: `svg_open`

```rust
#[tauri::command]
pub async fn svg_open(app: AppHandle) -> Result<Option<SvgFile>, SvgError>;
// SvgFile { name: String /* chỉ tên file */, bytes: Vec<u8> }
// SvgError: TooLarge (> 5 MiB + 64 B), BadExtension (không .svg), Io(String)
```

Hộp thoại hệ thống lọc `*.svg`; `None` khi hủy. Test `cargo test --lib`: trả đúng byte, từ chối quá lớn, từ chối đuôi sai, hủy. Đăng ký ở `lib.rs` (thêm một dòng); capability `dialog` đã có.

## 13. Trợ năng và đối chiếu studio-ux §5

- Hộp thoại: `role="dialog"`, `aria-modal`, bẫy focus, Esc.
- Cây phần tử: `role="tree"` với `treeitem`, `aria-expanded`, `aria-selected`; có phần tử con đầu tiên khi không rỗng (bẫy axe: `role=tree` rỗng).
- Inspector: mỗi dòng là `role="group"` có nhãn; lỗi `aria-invalid` và `aria-describedby`.
- Bảng đối chiếu từng quy tắc studio-ux §5 và §7 ghi ở `docs/reports/008-sc019.md` (SC-019).

## 14. Kịch bản e2e "dựng lại màn hình bồn nước + motor" (SC-004)

1. Mở project mô phỏng có Tag của `tank-demo` (sinh bằng `tools/dashboard-demo`); thêm màn hình `bon-nuoc`.
2. Kéo `tank-vertical`, `pump-centrifugal`, `motor-ac`, `valve-gate`, hai `pipe-h` vào canvas; dính điểm gắn.
3. Nhập thêm một SVG (fixture `inkscape-02`) làm nền nhãn.
4. Vào bồn → chọn `liquid` → kéo `TANK.LEVEL` vào Mức; chọn `text` → kéo vào Chữ (1 số lẻ, đơn vị).
5. Chọn `lamp` của motor → `MOTOR.STATE` vào Màu nền (bảng giá trị `TrangThaiBom`); chọn `rotor` → `MOTOR.RUN` vào Quay liên tục.
6. Chọn `flow` của ống → `PUMP.RUN` vào Dòng chảy.
7. Chọn `hit` của bơm → Sự kiện: Xung `PUMP.RUN_CMD` 500 ms, xác nhận, operator.
8. Thử giá trị trên Mức và Quay; Xem trước Mô phỏng; Kiểm tra (0 lỗi); Lưu; Nạp xuống runtime x64; mở Chrome: kiểm các phần tử đích và nhấp "bơm" (xác nhận, `CONFIRMED`, audit).
9. So với `tank-demo`: cùng Tag, cùng đích (chữ, màu, mức, quay).

Số thao tác và thời gian của kịch bản ghi vào báo cáo (SC-004, SC-020).
