# ADR-003: Định danh đối tượng bằng `elementUid` bất biến, tách khỏi `id` của SVG

- **Trạng thái:** Accepted cho **nguyên tắc** (đã nêu ở Master Plan §7.4). **Proposed** cho định dạng UID và thuật toán đối chiếu khi import lại; xác nhận bằng fixture ở Sprint 2. Phê duyệt chính thức ghi cùng quyết định Go/No-Go (T034).
- **Ngày:** 2026-10-10
- **Liên quan:** Master Plan §7.4, §8.2 (binding dùng `elementUid`), §9.5 (validator), Sprint 2; Constitution V, VII.

## Bối cảnh

Binding, animation và action (Master Plan §8) gắn vào **phần tử** của màn hình SVG. Chúng phải sống sót qua: chỉnh sửa trong Studio (di chuyển, đổi kích thước, nhóm/bỏ nhóm, đổi thứ tự lớp), lưu/mở lại `.matproj`, đóng gói `.matscada`, hiển thị ở Runtime, và import lại một SVG đã được vẽ lại ngoài công cụ ngoài (Inkscape/Illustrator/CorelDRAW).

`id` gốc của SVG không đủ làm khóa: nó do phần mềm vẽ sinh, có thể đổi mỗi lần xuất, có thể trùng khi ghép nhiều file, và còn bị `use`/`clipPath`/gradient tham chiếu nên không thể tự do đổi. (Mức độ đổi `id` của từng phần mềm là kinh nghiệm chung, **chưa kiểm chứng bằng fixture**: thư mục `tests/fixtures/svg/` có các file mẫu tạo trong Sprint 0 nhưng chưa có SVG xuất từ Illustrator/CorelDRAW và chưa ai thử xuất lại để quan sát `id`, xem T035/T036.) Riêng việc **trùng `id` khi ghép nhiều file đã được tái hiện**: hai SVG kiểu Illustrator Export cùng id `linear-gradient` đặt chung một trang thì file thứ hai lấy nhầm gradient của file đầu ([svg-dialects.md](../architecture/svg-dialects.md), thử nghiệm 3). Ngoài ra một file **xuất thật** qua LibreOffice Draw cho thấy: mở rồi xuất lại một màn hình làm **mất toàn bộ `id` và `data-*`** (31 → 280 phần tử) dù hình gần như không đổi. Vì vậy quy tắc import lại không thể chỉ dựa vào `id`/`data-mat-uid`; các bước 3–4 (cấu trúc, hình học) là bắt buộc.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Dùng `id` SVG làm khóa** | Không cần cơ chế riêng | Không ổn định giữa các lần xuất; có thể trùng/thiếu; sanitizer hoặc chuẩn hóa có thể phải sửa `id`; binding hỏng im lặng khi vẽ lại |
| **B. UID suy ra từ đường dẫn cấu trúc/hash** | Tái tạo được mà không lưu | Đổi khi cấu trúc đổi (nhóm/bỏ nhóm, chèn phần tử) nên chính các thao tác chỉnh sửa MVP sẽ làm hỏng binding |
| **C. UID sinh một lần, lưu cùng project, độc lập với `id`** (đã chọn) | Bất biến qua mọi thao tác chỉnh sửa; binding trỏ vào một khóa duy nhất; `id` gốc vẫn giữ nguyên cho tham chiếu nội bộ SVG | Phải lưu và mang UID theo SVG; cần thuật toán đối chiếu khi import lại; UID không tự đọc được (Studio hiển thị tên thân thiện riêng) |

## Quyết định

Dùng phương án **C**:

1. **Định dạng.** `elementUid` là chuỗi mờ (opaque) khớp `^el_[a-z0-9_]{3,40}$`. Studio sinh `el_` + 10 ký tự base32 ngẫu nhiên. Giá trị viết tay như `el_pump_01` (ví dụ ở Master Plan §8.2) vẫn hợp lệ, cần cho vertical slice Sprint 1. UID **không mang ý nghĩa** và không đọc `id` hay vị trí.
2. **Phạm vi duy nhất.** Duy nhất trong một screen; validator chặn trùng. Tham chiếu liên screen luôn kèm `screenId`.
3. **Quan hệ với `id` SVG.** `id` gốc được giữ nguyên trên phần tử (cần cho `use`, `clipPath`, gradient) và ghi lại trong model như `sourceId` chỉ để đối chiếu. **Binding không bao giờ dùng `id`.**
4. **Mang UID theo SVG.** SVG chuẩn hóa lưu/đóng gói mang UID ở thuộc tính `data-mat-uid`. Allowlist sanitizer (Master Plan §7.3) phải cho phép đúng thuộc tính này và không cho `data-*` khác. Khi import từ nguồn ngoài, **mọi `data-mat-uid` có sẵn đều bị coi là không tin cậy**: chỉ dùng làm gợi ý đối chiếu ở bước import lại, không được ghi thẳng vào model. Chi tiết cài đặt nhập SVG (mọi `data-mat-uid` nguồn bị bỏ, UID `el_` + 10 ký tự base32 gán lúc nhập, thêm `data-mat-name`) xem [ADR-023](023-svg-import-allowlist-uid.md) (feature 008).
5. **Sinh UID.** Khi import lần đầu, mọi phần tử trong model nhận UID mới. Khi tạo mới, nhân bản hoặc dán sang screen khác: phần tử mới nhận UID mới. Khi nhóm: nhóm nhận UID mới, con giữ UID. Khi bỏ nhóm: con giữ UID, UID của nhóm bị xóa và Studio phải cảnh báo nếu nhóm đang có binding (Master Plan §7.4: nhóm có binding riêng). Undo/redo khôi phục đúng UID cũ (command history, không snapshot DOM).
6. **Quy tắc import lại** một SVG đã chỉnh sửa, theo thứ tự ưu tiên, dừng ở khớp đầu tiên đáng tin:
   1. `data-mat-uid` (nếu phần mềm vẽ giữ lại và UID tồn tại trong project);
   2. `id` gốc + cùng tên thẻ;
   3. đường dẫn cấu trúc (chuỗi chỉ số con + tên thẻ);
   4. hình học (hộp bao, thuộc tính chính) trong dung sai.
   Khớp mơ hồ (nhiều ứng viên) hoặc độ tin cậy thấp **không** tự gán: đưa vào danh sách chờ remap để người dùng chọn. Phần tử mới nhận UID mới. Phần tử cũ không còn khớp mà đang có binding thành "mồ côi", và **chặn build** cho tới khi xử lý (validator §9.5, mục 2: reference phải tồn tại). Dung sai số cụ thể do Sprint 2 hiệu chỉnh bằng fixture; ADR không ấn định.
7. **Ánh xạ khi render.** Dựng `Map<elementUid, SVGElement>` một lần khi tải screen và hủy khi đổi screen (Master Plan §8.3, tránh rò rỉ).

## Số đo/bằng chứng

**Chưa đo.** Sprint 0 chưa có importer (ngoài phạm vi, Sprint 2) và chưa có bộ fixture đã xác nhận nguồn phần mềm vẽ (T035/T036 chưa đóng). ADR này dựa trên Master Plan §7.4/§8.2/§9.5, không dựa trên số liệu. Tỷ lệ khớp đúng khi import lại từ 3 phần mềm là điều Sprint 2 phải đo.

## Hệ quả

- **Tốt:** chỉnh sửa, nhóm/bỏ nhóm, lưu/mở lại không làm mất binding; một khóa chung cho Studio và Runtime (Constitution II); vá được lỗi "binding hỏng im lặng" bằng chặn build khi mồ côi.
- **Xấu:** thêm thuộc tính `data-mat-uid` làm tăng kích thước SVG (với 300-500 phần tử là không đáng kể; giới hạn 20.000 node/5 MB vẫn là trần); thuật toán import lại phức tạp và cần UI remap.
- **Rủi ro:** (1) khớp sai gán binding vào nhầm phần tử: hiển thị sai trạng thái thiết bị. Giảm thiểu: khớp mơ hồ phải hỏi người dùng, có test fixture cho từng bước đối chiếu; (2) phần mềm vẽ làm rơi `data-*` thì bước 1 vô hiệu, phải dựa vào bước 2-4 (chưa biết tỷ lệ); (3) UID giả mạo trong SVG độc hại: đã chặn bằng quy tắc "không tin cậy" ở mục 4; (4) thay đổi định dạng UID là thay đổi không tương thích, tăng MAJOR theo [ADR-004](004-schema-versioning.md).

## Điều kiện xem xét lại

- Fixture Sprint 2 cho thấy tỷ lệ khớp sai/mơ hồ khi import lại quá cao ở một phần mềm vẽ nào đó (cần ngưỡng do Tech Lead đặt khi bắt đầu Sprint 2).
- Cần UID duy nhất toàn project (ví dụ binding chéo screen không kèm `screenId`).
- Yêu cầu UID đọc được cho người vận hành (ví dụ trong audit hoặc log).
- Có kết luận ở Sprint 2 rằng thuộc tính `data-mat-uid` bị allowlist/phần mềm vẽ xung đột.
