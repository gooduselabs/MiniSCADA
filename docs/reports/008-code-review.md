# Rà code feature 008-svg-import-binding (năm trục)

Phạm vi: `git diff be83ae2..HEAD`, phần mã sản phẩm (svg-renderer, svg-import, binding-engine, ui-components, project-schema,
core/project-manager, Studio model + `svg.rs`). Bảo mật xem `docs/reports/008-security-review.md` (không lặp lại).
Cách làm: đọc mã, đối chiếu TS với C++ (`rules-04.ts` với `rules_04.cpp`), chạy vitest nhắm đích để xác nhận lỗi.
Không chạy ctest, e2e, ci-local, docker.

**Verdict: APPROVE sau các sửa dưới đây.** Không có phát hiện Critical. 3 phát hiện High đã sửa (test đỏ rồi xanh, mỗi sửa một
commit nhỏ). Còn 6 Medium và 5 Low chỉ liệt kê.

## Tổng hợp

| Mức | Số | Đã sửa |
|---|---|---|
| Critical | 0 | - |
| High | 3 | 3 |
| Medium | 6 | 0 (chỉ liệt kê) |
| Low | 5 | 0 (chỉ liệt kê) |

## High (đã sửa)

| # | File:dòng | Mô tả | Trạng thái |
|---|---|---|---|
| H1 | `packages/binding-engine/src/applier.ts` `blink()` (nhánh tắt, trước sửa dòng ~585) | Nhấp nháy tắt gọi `style.removeProperty(prop)` với `prop` là `opacity`, `fill` hoặc `stroke`: xóa luôn giá trị inline do binding `style.fill`, `style.stroke`, `style.opacity` khác trên cùng phần tử đã ghi (nhóm đích khác nhau nên luật cho phép cùng tồn tại). Ví dụ van đổi màu theo trạng thái và nhấp nháy `fill` theo cảnh báo: hết cảnh báo thì van mất màu trạng thái tới khi trạng thái đổi. Cả đường giảm chuyển động (giá trị tĩnh ghi đè) cũng bị. | Đã sửa, commit `368bf73`: nhớ giá trị inline trước khi ghi giá trị tĩnh (`Slot.blinkPrev`), chỉ trả lại giá trị đó; không tự xóa. Test: `applier-review.test.ts` (4 ca, đỏ 4/4 trước sửa). |
| H2 | `apps/studio/src/model/screen-edit/clipboard.ts` `pasteItems` | Ctrl+D hoặc Ctrl+C/V item `svg` sao nguyên `bindingFile`: hai item dùng chung một file binding, `rules-03` báo `E_SCHEMA` ("used by ... too"), project không Nạp được. Từ 008 item `svg` là loại phổ biến (nhập, thả ký hiệu) nên lỗi dễ gặp. `planDuplicateScreen` đã biết ràng buộc này nhưng đường dán thì không. | Đã sửa, commit `055c763`: bỏ item `svg` khỏi dán/nhân bản, trả `skippedSvg`; chỉ có item `svg` thì `rejected: 'empty'`. Test cũ "mọi loại: tag-table, svg" (khẳng định hành vi lỗi) đổi lại, thêm 1 ca. Chưa có thông báo ở giao diện (xem M2). |
| H3 | `packages/ui-components/src/screen/svg-events.ts` `apply()` (`pointerEvents`) | Phần tử có sự kiện đặt `pointer-events: all`. `all` bỏ qua `visibility`, nên nút nằm trong nhóm cha bị binding `style.visibility = hidden` vẫn nhận nhấp (cha có `pointer-events: none` nhưng con đặt riêng `all` thắng; `isHidden` chỉ xét style của chính phần tử). Trái FR-049 "phần tử ẩn không nhận nhấp" và có thể đưa tới hộp xác nhận ghi trên thứ người vận hành không thấy. | Đã sửa, commit `6a9e9f8`: dùng `visible` (vẫn nhận nhấp ở hình `fill: none`, nhưng tôn trọng visibility kế thừa). Cập nhật contract `svg-events.md` §3 và test. Spec FR-049, D16, research còn chữ `all`: cần cập nhật khi tổng kết. |

## Medium (chỉ liệt kê)

| # | File:dòng | Mô tả | Gợi ý |
|---|---|---|---|
| M1 | `apps/studio/src/model/reimport-flow.ts` `declared()` ~dòng 98 | Phần tử có nhãn trong SVG mới luôn lấy `name` từ nhãn, bỏ tên người dùng đã sửa trong `item.elements`. Chưa chạy xác nhận. | Ưu tiên tên cũ khi UID được giữ và tên cũ khác tên sinh từ nhãn cũ. |
| M2 | `apps/studio/src/ui/editors/screen-editor.ts` ~dòng 156-170 | Sau H2, giao diện chưa báo `skippedSvg` (dán chỉ svg thì lặng lẽ không làm gì). | Thêm thông báo i18n như `scr.pasteMissing`. Lâu dài: cho nhân bản item `svg` kèm sao file binding (cần sửa nhiều file trong một bước hoàn tác). |
| M3 | `packages/ui-components/src/screen/svg-item.ts` `rewire` ~dòng 168 | So sánh `elements` bằng tham chiếu: nếu nơi gọi tạo mảng mới mỗi lần cập nhật item thì mỗi lần kéo/đổi cỡ item gây `#reload` (tải lại file binding, tháo rồi dựng lại bộ áp, khôi phục DOM). Chưa đo. | Đo ở Studio khi kéo item `svg`; nếu có, so sánh theo nội dung (danh sách uid). |
| M4 | `packages/binding-engine/src/applier.ts` `blink()` | Màu cơ sở của nhấp nháy `fill`/`stroke` lấy một lần lúc tạo hoạt ảnh: nếu binding `style.fill` đổi màu trong lúc đang nhấp nháy thì khung hình "bật" vẫn là màu cũ. | Tạo lại hoạt ảnh khi giá trị inline đổi, hoặc dùng `currentColor`/biến CSS. |
| M5 | `apps/studio/src/model/svg-binding-doc.ts` `checkEvent` ~dòng 325 | Kiểm giá trị `write` ở phía Studio thiếu so với `writeValueError` (số nguyên cho kiểu nguyên, miền của kiểu, `limits.maxLength` cho chuỗi): giao diện nhận giá trị rồi bộ kiểm project mới báo `E_EVENT_TAG`. | Dùng chung `writeValueError` của `@mat/project-schema`. |
| M6 | `packages/ui-components/src/screen/svg-events.ts` `#syncTitle` + `applier.ts` `text.content` | Lời nhắc khóa `<title data-mat-runtime>` là con của phần tử; binding `text.content` ghi `textContent` xóa nó (đến lần `apply` kế mới dựng lại). Chỉ ảnh hưởng tooltip lý do khóa trên phần tử `text`. | Đặt `title` ở phần tử không bị `text.content` ghi, hoặc dựng lại sau mỗi lần ghi chữ. |

## Low (chỉ liệt kê)

| # | File:dòng | Mô tả |
|---|---|---|
| L1 | `packages/ui-components/src/screen/svg-events.ts` `Bound` | Hai sự kiện cùng `elementUid` (chỉ bị chặn bởi `E_DUP_UID` lúc kiểm) làm hai `Bound` lưu thuộc tính đã sửa của nhau; `dispose` trả lại thuộc tính sai. Runtime nên bỏ bản thứ hai. |
| L2 | `packages/binding-engine/src/applier.ts` `dispose` | Không bật `restoreOnDispose` thì `<clipPath>` rỗng và `stroke-dasharray` do flow ghi không được gỡ (runtime hủy cả màn hình nên vô hại; Studio luôn bật). Khi gỡ clipPath, `<defs>` rỗng do bộ áp tạo ra còn lại. |
| L3 | `packages/project-schema/src/migrate.ts` `migrate03to04` ~dòng 373 | Nếu `project.json` không có khóa `minRuntimeVersion`, `MIN_RUNTIME_RE.replace` không làm gì nhưng báo cáo ghi đã nâng `minRuntime`. Schema có thể bắt buộc khóa này (chưa kiểm). |
| L4 | `packages/project-schema/src/rules-04.ts` ~dòng 552 và `rules_04.cpp` ~dòng 368 | `W_EVENT_PULSE_READBACK`: TS coi `kind` vắng là không phải `external`, C++ mặc định `external`. Khác biệt chỉ xuất hiện khi Tag thiếu `kind` (schema yêu cầu `kind` nên khó gặp). Hai bản còn lại khớp (đã đối chiếu bảng đích, tham số, `rangeMap`, sự kiện, đếm hoạt ảnh, `writeValueError`). |
| L5 | Môi trường | `packages/ui-components` `mat-screen.test.ts`, `svg-item-rewire.test.ts` không nạp được trong worktree (`Denied ID .../uplot.min.css?raw`: vite chặn đọc ngoài thư mục worktree). Không phải lỗi mã; chạy ở checkout chính. Hai suite này không được chạy lại sau H3, chỉ `svg-events.test.ts` (33 ca xanh). |

## Đã đọc và thấy ổn

- `match.ts`: bốn bước đối chiếu có kiểm đối xứng (không có ứng viên đối thủ ở cả hai phía, kiểm ngược), `workCap` chặn bậc hai; `applyMatch` loại lựa chọn trùng UID đã dùng; `ReimportFlow.choose` nhả UID khi chọn lại. Không thấy gán sai UID tự động.
- `reimport-flow.ts` `commit`: một lần `apply`, tách tệp khi dùng chung (`split`) hay áp mọi thể hiện (`all`), xử lý chung màn hình.
- `rules-04.ts` và `rules_04.cpp`: khớp từng luật.
- `svg-item.ts` `rewire`/`#reload`: tháo bộ áp và sự kiện cũ trước khi dựng lại, bộ áp cũ khôi phục DOM (`restoreOnDispose`), lượt `rewire` cũ bị bỏ khi có lượt mới.
- `svg.rs`: đọc có trần `take(MAX+1)`, kiểm đuôi trước khi mở, chỉ trả tên file.
- `transform-parse.ts`, `transform-state.ts`: thứ tự hợp ma trận đúng (M0 trước, quay quanh tâm hộp bao cục bộ).

## Ghi chú xác minh

- `packages/binding-engine`: 102/102 xanh sau H1.
- `apps/studio` `src/model`: 1255/1255 xanh sau H2.
- `packages/ui-components` `svg-events.test.ts` và các suite nạp được: 33/33 xanh sau H3 (2 suite khác không nạp được, xem L5).
