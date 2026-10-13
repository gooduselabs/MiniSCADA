# Contract: trình vẽ SVG của Studio (mô hình tài liệu, lệnh, hình học, trạng thái)

**Feature**: [spec.md](../spec.md) FR-097 đến FR-118, SC-030 đến SC-036 · **ADR**: [038](../../../docs/adr/038-svg-editor-templates.md) · Phụ thuộc: `sanitizeSvg` (allowlist), `@mat/svg-import` (uid, nhập) của feature [008](../../008-svg-import-binding/spec.md) · Giao diện: `docs/architecture/studio-ux.md` §5, §9; mockup `studio-svg-draw.html`

## 0. Quan hệ với feature 008 (tránh trùng tên và việc)

- 008 đã có trong Studio: nhập SVG, cây phần tử, chọn phần tử và gắn Tag, thư viện ký hiệu, `model/svg-doc.ts` (văn bản SVG của item và cây `ElementInfo`), `ui/screen/mat-svg-overlay.ts`, lệnh "Vào đồ họa" (Enter hoặc nhấp đúp item `svg`) và Esc thoát; mockup `studio-svg.html`. 011 **không** thay các thứ đó.
- 011 thêm một editor **riêng** "Trình vẽ SVG" (tab) để **sửa hình**: mở bằng lệnh "Sửa trong trình vẽ" (menu ngữ cảnh của item `svg`, Ctrl+Alt+Enter) hoặc nhấp đúp tệp SVG trên cây project; nhấp đúp item `svg` trên canvas vẫn là "Vào đồ họa" của 008. Tên tránh trùng: package `@mat/svg-edit`, kiểu `DrawDoc`, mockup `studio-svg-draw.html`.
- Cả hai dùng chung văn bản SVG của item qua `project_fs` (một đường đọc/ghi); khi lưu từ trình vẽ, cây phần tử của 008 được dựng lại từ văn bản mới; binding theo `data-mat-uid` không đổi.
- Ký hiệu của `@mat/symbols` (008) là item `svg` có sẵn; **template** của 011 là mẫu có tham số gồm item (widget và svg), khác bản chất, bổ sung nhau (ví dụ ký hiệu bơm nằm trong template `bom`).

## 1. Phân lớp mã

| Lớp | Đường dẫn | Nội dung | Có DOM? |
|---|---|---|---|
| Mô hình tài liệu | `packages/svg-edit/` (`@mat/svg-edit`, mới) | `DrawDoc` chuẩn tắc, lệnh, hoàn tác, tuần tự hóa, hình học, bắt dính, căn chỉnh | Không (cây nút thuần TS; parse bằng bộ phân tích của feature 008 (`@mat/svg-import`, `sanitizeSvg`)) |
| Editor | `apps/studio/src/ui/svg/` | tab editor, canvas, công cụ, tay nắm, inspector, lớp, bàn phím | Có |
| Trạng thái | `apps/studio/src/model/svg-state.ts` | lớp khóa/ẩn, đường gióng, tự lưu, phát hiện đổi trên đĩa | Không |

`@mat/svg-edit` không phụ thuộc DOM nên chạy được trong Vitest (không jsdom) và dùng lại cho kiểm tra ở Rust/C++ không cần (chỉ Studio dùng). Constitution II: Studio không chứa logic runtime; runtime không dùng `@mat/svg-edit`.

## 2. Mô hình `DrawDoc`

```ts
interface DrawNode { id: NodeId; tag: AllowedTag; attrs: Map<string, string>; children: NodeId[]; parent: NodeId | null; text?: string }
interface DrawDoc { root: NodeId; nodes: Map<NodeId, DrawNode>; viewBox: Box; version: number }
```

- `NodeId` là mã nội bộ của phiên soạn thảo (không lưu vào file). `data-mat-uid` (GĐ 3b) là danh tính ổn định lưu trong file.
- Chỉ nhận thẻ trong **allowlist** của `sanitizeSvg` (feature 008, ADR-023) (`svg`, `g`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`, `text`, `tspan`, `defs`, `linearGradient`, `radialGradient`, `stop`, `clipPath`, `use`, `symbol`, và các thẻ giữ nguyên không sửa sâu); thẻ hay thuộc tính ngoài allowlist không bao giờ vào `DrawDoc` (bị loại lúc phân tích, kèm báo cáo).
- Giới hạn: tệp ≤ 5 MB, ≤ 20.000 nút, độ sâu ≤ 32 (Constitution V); lệnh làm vượt là bị từ chối `SVG_LIMIT`.
- Phần tử **giữ nguyên, không sửa sâu**: `mask`, `filter`, `pattern`, `svg` lồng, và con của chúng: chọn và di chuyển/đổi cỡ như một khối (qua `transform` của khối), không sửa bên trong; cảnh báo hiện ở inspector.

## 3. Lệnh (command) và hoàn tác

```ts
interface Command { kind: string; apply(doc: DrawDoc): void; invert(doc: DrawDoc): Command; mergeKey?: string }
```

Lệnh nguyên tử: `SetAttr(node, name, value|null)`, `SetText(node, text)`, `InsertNode(parent, index, subtree)`, `RemoveNode(node)` (lưu cây con để đảo), `MoveNode(node, newParent, newIndex)`. Mọi thao tác người dùng là **một lô** (`Batch(cmds[])`) và là **một bước** hoàn tác.

- Ngăn xếp: tối đa `SVG_UNDO_DEPTH = 100` lô; lô thứ 101 đẩy lô cũ nhất ra; thao tác mới sau hoàn tác xóa phần làm lại.
- Gộp: lệnh cùng `mergeKey` và cùng đích liên tiếp trong một cử chỉ (kéo, gõ phím mũi tên giữ, kéo thanh màu) gộp thành một lô; gõ chữ gộp theo 1,5 s không gõ.
- `invert` không chụp lại cả cây: chỉ lưu giá trị cũ của thuộc tính hoặc cây con bị xóa.
- Mỗi lệnh kiểm giới hạn (§2) và allowlist **trước** khi áp dụng; lệnh bị từ chối không đổi tài liệu và không vào ngăn xếp.
- `doc.version` tăng sau mỗi lô áp dụng, hoàn tác hay làm lại; giao diện chỉ vẽ lại phần tử bị ảnh hưởng (theo `NodeId` trong lô).
- Kiểm thuộc tính (property test, hạt cố định): chuỗi lệnh ngẫu nhiên N ≤ 100 rồi hoàn tác hết cho `canonical(doc) == canonical(doc ban đầu)`; làm lại hết cho trạng thái cuối.

## 4. Hình học

- Ma trận 2D affine `[a b c d e f]` (SVG). `parseTransform` xử lý `matrix`, `translate`, `scale`, `rotate` (kể cả `rotate(a cx cy)`), `skewX`, `skewY`, danh sách nhiều phép; `serializeTransform` ưu tiên dạng ngắn (`translate`, `rotate`, `scale`) khi chính xác, ngược lại `matrix`.
- Ma trận tích lũy `CTM(node)` = tích ma trận từ gốc tới nút; hộp bao `bbox(node)` trong hệ của tài liệu (có tính `stroke-width` tùy chọn); hộp bao của `text` ước tính bằng đo trên canvas (trình duyệt) và có giá trị tạm trong test thuần (hộp tính từ `font-size` và độ dài; có sai số, bộ ca ghi rõ).
- Điều chỉnh (di chuyển, đổi cỡ, xoay) cho một nút `n` với phép `T` trong hệ tài liệu: `M_new = CTM(parent)^-1 · T · CTM(parent) · M_old` (với `M_old` là `transform` của nút).
- **Bake** (ghi vào thuộc tính hình học thay vì `transform`) khi `T` là đồng dạng tách được và nút là một trong: `rect` (`x y width height`, `rx ry` nhân tỉ lệ), `ellipse` (`cx cy rx ry`), `circle` (`cx cy r`; co không đều thì đổi `circle` thành `ellipse`), `line` (`x1 y1 x2 y2`), `polyline`/`polygon` (`points`). Điều kiện chính xác: ma trận không có nghiêng (c·a + d·b ≈ 0 và a·d − b·c > 0); xoay chỉ bake với bội 90° của `rect`, `ellipse`, `circle` (đổi vai `width`/`height`); xoay khác ghi `transform="rotate(...)"`. Sai số cho phép 1e-6 (đơn vị) khi so với bản không bake.
- Nút `g`, `path`, `text`, `use`, `symbol`, khối giữ nguyên: ghi vào `transform`.
- `stroke-width` không bị nhân theo co (mặc định: `vector-effect` không đặt, nên khi **không bake** nét co theo `transform`; khi bake, nét giữ nguyên): quy ước hiển thị này được nêu ở inspector ("Co cả nét" bật tắt cho nút cần `transform`).
- Làm tròn khi ghi: tối đa 3 chữ số thập phân, bỏ số 0 thừa, `-0` thành `0`.
- Nhóm: `group(nodes)` tạo `g` tại vị trí của nút trên cùng, chuyển các nút vào (giữ thứ tự), **không** đổi hiển thị (các nút cùng cha, nếu khác cha thì mỗi nút nhận `transform` bù để giữ vị trí); `ungroup(g)` đẩy `transform` của `g` xuống con (bake nếu chính xác, nếu không nhân vào `transform` của con), `data-mat-uid` của con giữ, `g` bị xóa. Nhóm mới có `data-mat-uid` mới; nhóm rỗng tự bị xóa.
- Đường (`path`): phân tích tập lệnh M, L, H, V, Z (hoa/thường) thành danh sách nút khi **chỉ** có các lệnh đó (`isPolygonPath`); có C, S, Q, T, A: `isPolygonPath = false`, chỉ biến đổi ma trận. Ghi lại dùng lệnh tuyệt đối. Đa tuyến, đa giác: điểm là danh sách số.

## 5. Bắt dính, căn chỉnh, xếp lớp

Hàm thuần (`packages/svg-edit/src/snap.ts`, `align.ts`, `order.ts`), nhận danh sách hộp bao trong hệ tài liệu và cấu hình, trả kết quả cùng danh sách đường gióng:

- **Bắt dính**: lưới `grid` (mặc định 10), cạnh/tâm của hộp khác (ngưỡng `6 / zoom` đơn vị tài liệu), điểm đầu cuối của `line`/`polyline`/`path` đa giác, góc 15° (khi giữ Shift, quanh điểm neo). Thứ tự ưu tiên khi nhiều ứng viên cùng ngưỡng: điểm > cạnh/tâm > lưới; hòa thì gần hơn, rồi theo `NodeId` tăng.
- **Căn chỉnh** theo hộp bao chung của vùng chọn (hoặc theo phần tử khóa/đầu tiên khi Alt): `left`, `centerH`, `right`, `top`, `centerV`, `bottom`.
- **Phân bố** đều khoảng cách ngang/dọc (≥ 3 nút), **cùng rộng/cao** (theo nút tham chiếu = nút chọn đầu).
- **Xếp lớp**: đưa lên trên/xuống dưới cùng, lên/xuống một bậc **trong cùng cha**; khác cha thì chuyển cha (lệnh `MoveNode`).
- Bắt dính và căn chỉnh làm việc theo hộp bao trong hệ tài liệu kể cả khi cha có `transform`; kết quả quy về hệ của cha theo §4.
- Bộ ca thuần ≥ 150 ca (SC-031).

## 6. Lớp và trạng thái soạn thảo

- **Lớp** = `<g data-mat-layer="<tên>">` con trực tiếp của gốc; tên ≤ 64 byte, duy nhất. Phần tử không thuộc lớp nào (con trực tiếp của gốc) nằm ở "Lớp mặc định" ảo.
- Đổi tên, tạo, xóa (kèm hỏi: xóa luôn nội dung hay chuyển sang lớp mặc định), chuyển phần tử, đổi thứ tự lớp đều là lô lệnh.
- **Ẩn** và **khóa** là trạng thái soạn thảo, ở `<project>/.mat-editor/svg-state.json`:

```json
{ "version": 1, "files": { "svg/bom.svg": { "layers": { "Bơm": { "hidden": false, "locked": true } }, "guides": [ { "axis": "x", "pos": 120.5 } ] } } }
```

  Tệp này **không** vào gói, không vào digest, bị Studio loại khi đóng gói; mất tệp không mất dữ liệu thiết kế. Phần tử trong lớp ẩn không vẽ trong editor (vẫn có trong file và trong Chrome); lớp khóa không chọn được trên canvas nhưng chọn được qua panel Lớp.
- **Tự lưu**: mỗi 30 s nếu `doc.version` đổi, ghi `.mat-editor/autosave/<tên tệp>.<giờ>.svg` (ghi tạm rồi đổi tên); giữ tối đa 3 bản mỗi tệp; xóa khi lưu thật thành công. Mở project mà có bản tự lưu mới hơn tệp thật: hộp "Khôi phục bản tự lưu" (Khôi phục, Bỏ, Xem khác biệt).
- **Phát hiện đổi trên đĩa**: lúc lấy focus cửa sổ và mỗi 5 s khi tab đang mở, so `mtime` và băm của tệp với bản đã nạp; khác thì hộp "Tệp đã đổi bên ngoài" (Nạp lại, Giữ bản đang sửa, So sánh); không bao giờ ghi đè im lặng.
- Lưu: tuần tự hóa chuẩn tắc (§7), ghi tạm rồi đổi tên, giữ mtime mới.

## 7. Tuần tự hóa chuẩn tắc

- Thứ tự thuộc tính: theo thứ tự xuất hiện ban đầu trong file; thuộc tính mới thêm theo bảng ưu tiên (`id`, `data-mat-*`, hình học, `transform`, `fill`, `stroke`, `stroke-*`, `opacity`, còn lại theo bảng chữ cái).
- Số theo §4; giữ nguyên chuỗi số của thuộc tính **không sửa** (không định dạng lại byte nếu không đổi).
- Phần tử và thuộc tính **không sửa**: giữ nguyên byte (kể cả `style` nội tuyến, chú thích, thứ tự), chỉ chuẩn hóa xuống dòng và thụt đầu dòng khi **chính nút đó** thay đổi.
- Mở rồi lưu không sửa: **cùng byte** với tệp mở; mở, sửa một thuộc tính, lưu: chỉ khác ở nút bị sửa.
- `data-mat-uid` giữ; nút mới nhận uid theo bộ sinh uid của `@mat/svg-import` (feature 008).

## 8. Công cụ

| Công cụ | Phím | Thao tác | Kết quả (lô) |
|---|---|---|---|
| Chọn | V | nhấp, Shift+nhấp, khung chọn, nhấp đúp vào nhóm, Esc thoát nhóm | không đổi tài liệu |
| Hình chữ nhật | R | kéo; Shift vuông; Alt từ tâm | `InsertNode rect` |
| Ellipse | E | kéo; Shift tròn | `InsertNode ellipse` (hoặc `circle` khi tròn) |
| Đường thẳng | L | kéo; Shift khóa 15° | `InsertNode line` |
| Đa tuyến/Đa giác | P | nhấp từng điểm; Enter xong; nhấp điểm đầu thì đóng thành `polygon` | `InsertNode polyline/polygon` |
| Văn bản | T | nhấp, gõ; Esc xong | `InsertNode text` + `SetText` |
| Sửa nút | N | chọn đa tuyến/đa giác/path đa giác; kéo điểm; nhấp đôi cạnh thêm điểm; Delete xóa điểm | `SetAttr points`/`d` |

Mặc định phần tử mới: `fill` `#cfd8dc`, `stroke` `#37474f`, `stroke-width` 2 (rect/ellipse); `fill` `none`, `stroke` `#37474f`, `stroke-width` 2 (line, polyline); `text`: `fill` `#263238`, `font-size` 16, `font-family` `sans-serif`, `text-anchor` `start`.

Văn bản nhập qua `textarea` giữ focus (ADR-016) đặt chồng đúng vị trí; chỉ `text` một dòng; Enter xong. Phông trong danh sách an toàn: `sans-serif`, `serif`, `monospace`, `Arial`, `Segoe UI`, `Roboto`; phông khác được nhập thì cảnh báo `W_SVG_FONT`.

## 9. Bàn phím

Tab/Shift+Tab chọn phần tử kế/trước (theo thứ tự tài liệu), mũi tên dịch 1 (Shift 10, Ctrl theo lưới), Enter vào nhóm/sửa văn bản, Esc thoát, Delete xóa, Ctrl+D nhân bản (lệch 20), Ctrl+C/X/V, Ctrl+G/Ctrl+Shift+G, Ctrl+Z/Y, Ctrl+A, `[` và `]` xuống/lên một bậc, Ctrl+`[` và Ctrl+`]` xuống/lên cùng, +/- zoom, 0 vừa khung, Space kéo canvas, F2 đổi tên. Mọi lệnh có mục menu và có trong Palette lệnh (Ctrl+Shift+P).

## 10. Clipboard và nhập SVG

- Sao chép trong tài liệu: giữ cây con (kèm `defs` cần thiết như gradient được tham chiếu), cấp `data-mat-uid` mới, không sao chép binding (tùy chọn "Dán kèm binding" sao chép bản ghi binding sang uid mới).
- Dán từ clipboard hệ thống (văn bản bắt đầu bằng `<svg` hoặc `<?xml`): kiểm kích thước ≤ 5 MB **trước** khi phân tích; phân tích bằng bộ phân tích của feature 008 (`@mat/svg-import`, `sanitizeSvg`) (DOM thật, không regex), lọc allowlist, kiểm giới hạn; báo "đã loại N phần tử và M thuộc tính" kèm danh sách; nếu kết quả rỗng thì không dán.
- Sao chép giữa hai tài liệu: `id` trùng được đổi (`-copy`, đánh số), tham chiếu `url(#id)` trong cây con được cập nhật.

## 11. Hiệu năng

- Vẽ editor: dùng DOM thật của `<svg>` trong Shadow DOM của tab (cùng bộ dựng với runtime), lớp phủ chọn/tay nắm riêng; cập nhật chỉ các nút bị ảnh hưởng.
- Chọn bằng khung: duyệt hộp bao đã lưu đệm (đệm hộp theo `doc.version` và `NodeId`).
- Mục tiêu (máy dev): 2.000 phần tử kéo một phần tử p95 ≤ 16,7 ms mỗi khung; mở 20.000 nút ≤ 3 s; hoàn tác một bước ≤ 100 ms; chọn khung ≤ 50 ms (SC-033). Dự phòng: khi kéo ≥ 200 nút cùng lúc, hiện bản xem nhanh (hộp bao) đến khi thả.

## 12. Bộ test

| Bộ | Nội dung | Đường dẫn |
|---|---|---|
| Hình học thuần | transform lồng 3 tầng, bake/không bake, nhóm/bỏ nhóm, bắt dính, căn chỉnh, phân bố, xếp lớp, sửa nút | `packages/svg-edit/src/*.test.ts` |
| Lệnh/hoàn tác | từng lệnh và đảo, gộp, độ sâu 100, property test 1.000 chuỗi | `packages/svg-edit/src/command.test.ts` |
| Tuần tự hóa | round-trip ≥ 20 fixture, cùng byte, uid giữ, ảnh dựng ≤ 1 % khác | `tests/svg-editor-fixtures/`, `packages/svg-edit/src/roundtrip.test.ts` |
| An toàn | fuzz lệnh 100.000 chuỗi, 10 SVG độc dán | `packages/svg-edit/src/fuzz.test.ts`, `tests/svg-editor-fixtures/malicious/` |
| e2e | công cụ, phím, lớp, tự lưu, đổi trên đĩa, axe-core | `apps/studio/tests/e2e/svg-editor.e2e.mjs` |
| Thử tay ⚠️🔌 | bộ gõ Telex/Unikey cho văn bản, trình đọc màn hình | quickstart §8 |
