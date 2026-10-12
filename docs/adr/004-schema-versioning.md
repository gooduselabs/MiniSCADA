# ADR-004: Schema theo SemVer, migration ở Studio, validator ở cả Studio và Runtime

- **Trạng thái:** Accepted cho **nguyên tắc** (Master Plan §9.4-§9.5, Constitution V và VII). **Proposed** cho các quy tắc tương thích chi tiết ở mục "Quyết định" (điểm 3-6); xác nhận khi viết schema v0 ở Sprint 1. Phê duyệt chính thức ghi cùng quyết định Go/No-Go (T034).
- **Ngày:** 2026-10-10
- **Liên quan:** Master Plan §5 (`schemas/`), §9.1-§9.5, §11.5; Constitution V, VII; [ADR-003](003-element-uid.md).

## Bối cảnh

Project đi qua hai định dạng (Master Plan §9.1): `.matproj` (nguồn chỉnh sửa, ở Studio) và `.matscada` (gói triển khai, ở Runtime). Studio và Runtime ra đời ở các bản khác nhau và Runtime nằm trên thiết bị công nghiệp khó cập nhật, nên cần quy tắc rõ để: (1) Studio mới mở được project cũ; (2) Runtime không kích hoạt gói nó không hiểu; (3) lỗi cấu hình bị chặn **trước** khi dừng vận hành (rủi ro "Package lỗi làm dừng vận hành", mức Cao, §16).

Hiện trạng: thư mục `schemas/` và mọi file schema **chưa tồn tại** trong repo; schema v0 là việc của Sprint 1. (Cập nhật Sprint 1, 2026-10-10: `schemas/` đã có, gồm schema v0 cho project, tag, screen, binding và `protocol-version.json`.) Master Plan hiện có `schemaVersion` trong manifest và binding mẫu nhưng screen mẫu (§9.3) chưa có trường này.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| **A. Không đánh phiên bản, luôn "bản mới nhất"** | Đơn giản | Runtime không biết gói có hiểu được không; project cũ hỏng khi nâng cấp |
| **B. Phiên bản theo số nguyên tăng dần** | Dễ so sánh | Không phân biệt được thay đổi tương thích và không tương thích |
| **C. SemVer cho bộ schema + migration ở Studio + validator hai phía** (đã chọn) | Khớp §9.4; tách "thêm tương thích" khỏi "phá vỡ"; Runtime từ chối rõ ràng | Phải duy trì migration và hai cài đặt validator |

## Quyết định

1. **Ba trục phiên bản tách biệt**, không dùng lẫn: `schemaVersion` (định dạng dữ liệu, SemVer), `projectVersion` (phiên bản nội dung do người dùng đặt), `minRuntimeVersion` (Runtime thấp nhất hiểu được gói). Thêm `buildId` chỉ để truy vết (Master Plan §9.2).
2. **Một `schemaVersion` cho cả bộ schema** (`project`, `screen`, `binding`, `animation`, `tag`). Mỗi file JSON trong gói mang cùng `schemaVersion` và validator chặn khi không khớp `manifest.json`; cần thêm trường này vào screen mẫu (§9.3).
3. **Quy tắc SemVer.**
   - MAJOR: xóa/đổi tên trường, đổi kiểu hoặc ngữ nghĩa, thu hẹp allowlist (target, transform, action), đổi định dạng `elementUid`.
   - MINOR: thêm trường tùy chọn hoặc thêm giá trị vào allowlist, tương thích ngược.
   - PATCH: làm rõ schema, sửa lỗi validator mà không đổi tập hợp được chấp nhận.
4. **Runtime chấp nhận** gói khi: cùng MAJOR với Runtime, MINOR không lớn hơn MINOR Runtime hỗ trợ, và `minRuntimeVersion` <= phiên bản Runtime (§9.4). Ngược lại từ chối **cả gói** kèm mã lỗi rõ; không kích hoạt một phần. Runtime **không** tự migrate gói. Việc Runtime có hỗ trợ MAJOR trước trong thời gian chuyển tiếp hay không: chưa quyết định.
5. **Migration chỉ ở Studio.** Chuỗi hàm thuần `vN -> vN+1`, kiểm thử bằng cặp file vàng (golden) cũ/mới. Trước khi migrate lưu bản sao `.matproj` cũ (Master Plan §9.4); sau migrate chạy validator; thất bại thì để nguyên bản gốc. Studio gặp project có `schemaVersion` mới hơn mức nó hiểu thì từ chối mở và báo lỗi rõ (không đoán, không ghi đè).
6. **Validator ở cả hai phía** (Constitution V): nguồn sự thật duy nhất là các file JSON Schema trong `schemas/`; kiểm tra ngữ nghĩa theo danh sách §9.5 (reference, ID duy nhất, allowlist, expression, checksum, path traversal, quota, `maxClients <= 10`, ước tính chu kỳ quét) được cài ở TypeScript (Studio, `tools/project-validator`) và C++ (Runtime). Hai bản dùng chung một **bộ ca kiểm thử hợp lệ/không hợp lệ** dưới `tests/` để cho kết quả giống nhau, theo cùng cách với expression engine (Master Plan §5.1, Constitution II). Runtime không kích hoạt project nếu validator thất bại, kể cả khi Studio đã báo hợp lệ.
7. **Ngoài phạm vi ADR:** phiên bản giao thức WebSocket live (`schemas/protocol-version.json`, trường `hello`): chưa quyết định, để Sprint 1. PoC hiện chỉ gửi `serverVersion`, `maxClients`, `tagCount`. **Cập nhật Sprint 1:** đã quyết định ở [ADR-006](006-live-protocol-v1.md) (`protocolVersion` 1.0.0 trong `hello`, client từ chối MAJOR khác).

## Số đo/bằng chứng

**Chưa đo.** Sprint 0 không có schema hay validator để đo. Điều chưa biết và cần số đo sau này:

- Thời gian và RAM của validator C++ trên Cortex-A7 với gói lớn nhất cho phép (quota mặc định 50 MB, §9.5 mục 7): chưa đo, chờ Sprint 6. Không được vượt ngân sách `mat-runtime` ≤ 150 MB ([ADR-005](005-resource-budget.md)).
- Thư viện JSON Schema cho C++ chưa chọn; phải rà license (Constitution "Ràng buộc công nghệ") và kích thước/RSS trước khi đưa vào.

## Hệ quả

- **Tốt:** Runtime từ chối rõ ràng thay vì chạy sai; Studio nâng cấp project cũ có bản sao lưu; hai phía kiểm tra độc lập nên lỗi gói bị chặn trước khi kích hoạt.
- **Xấu:** hai cài đặt validator phải giữ đồng bộ; mỗi thay đổi schema kéo theo test vàng và có thể một migration; MINOR đòi Runtime đủ mới nên khó rollout lẻ.
- **Rủi ro:** (1) hai validator bất đồng: gói qua Studio nhưng Runtime từ chối (an toàn nhưng gây khó chịu) hoặc ngược lại (nguy hiểm). Giảm thiểu: bộ ca chung chạy trong CI ở cả hai phía. (2) Quy tắc "từ chối cả gói khi MINOR cao hơn" có thể quá chặt; có thể nới sau khi có số liệu vận hành. (3) Gói do Runtime cũ không hiểu có thể bị kẹt trên thiết bị: cần đường quay về bản trước (atomic activation, §11.4).

## Điều kiện xem xét lại

- Validator C++ vượt ngân sách thời gian/RAM trên thiết bị (Sprint 6).
- Cần Runtime chạy nhiều MAJOR song song (khách hàng không nâng cấp đồng loạt).
- Thêm loại dữ liệu có vòng đời riêng cần phiên bản độc lập (ví dụ symbol library, cấu hình thiết bị): có thể tách `schemaVersion` theo thành phần.
- Quyết định về phiên bản giao thức live ở Sprint 1 ảnh hưởng quy tắc chấp nhận ở điểm 4.
