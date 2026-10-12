# ADR-012: Gói project `.matscada`, kho project, nạp xuống và đọc lên atomic

- **Trạng thái:** Proposed (feature 005; plan và câu hỏi của plan đã chốt ngày 2026-10-11, người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11). Chưa có số đo trên BL335.
- **Ngày:** 2026-10-11
- **Liên quan:** [specs/005-device-online](../../specs/005-device-online/plan.md), research R12–R15; contracts [matscada-package.md](../../specs/005-device-online/contracts/matscada-package.md), [device-api.md](../../specs/005-device-online/contracts/device-api.md), [live-protocol-1.1.md](../../specs/005-device-online/contracts/live-protocol-1.1.md); Constitution II, V, VII (deploy atomic); [ADR-004](004-schema-versioning.md), [ADR-006](006-live-protocol-v1.md), [ADR-011](011-auth-roles-audit.md).

## Bối cảnh

Hôm nay project đi chung gói runtime (`package-runtime.ps1`), chép bằng SSH, kích hoạt bằng `deploy.sh`. Spec 005 yêu cầu:

- **gói project riêng**, có manifest và checksum; chặn ZIP bomb và path traversal; tối đa 50 MB; không chứa bí mật;
- **nạp xuống** qua chuỗi kiểm tra, sao lưu, kích hoạt atomic, kiểm tra sức khỏe, tự rollback; giữ 3 bản trước; mất điện ở bất kỳ bước nào vẫn khởi động với bản hợp lệ;
- **đọc lên** cho đúng digest vừa nạp, kể cả với thiết bị cài theo cách cũ;
- **so sánh** theo đối tượng.

Runtime nạp project lúc khởi động (`TagStore`, `LiveHub`, `HttpApi`, historian), chạy bằng user `matscada`, và chỉ ghi được vào `/var/lib/mat-runtime`.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Định dạng gói | tar.gz; ZIP với thư viện đầy đủ (libzip, minizip-ng, API zip của miniz, crate `zip`); **ZIP tập con chặt, tự viết đọc/ghi** | ZIP tập con: stored hoặc deflate; không ZIP64, mã hóa, extra field; header cục bộ khớp central; entry liền nhau. Giải nén bằng `tinfl` (miniz 3.1.2) và `flate2` |
| Digest | SHA-256 của byte gói; **SHA-256 của danh sách (sha256, size, path) đã sắp** | theo nội dung, không phụ thuộc cách nén |
| Nơi giữ project | `/opt/mat-runtime/project` (đi theo runtime); **kho riêng `/var/lib/mat-runtime/projects`** | kho riêng: `v/<seq>/`, `state.json` |
| Kích hoạt | đổi project trong tiến trình; symlink `current` + để systemd chạy lại; **`state.json` (rename) + `execv`** | `state.json` là nguồn sự thật duy nhất; `execv` chính binary |
| Kiểm tra sức khỏe | script ngoài (như `deploy.sh`); **chính tiến trình mới**, có đếm số lần khởi động | tiến trình mới kiểm trong ≤ 15 s; chết 2 lần thì rollback |
| Báo client tải lại | client hỏi định kỳ; bản tin mới; **mã đóng 1012 + digest trong `hello`** | giao thức live 1.1.0 |
| So sánh | diff văn bản JSON; trong Rust; **TS thuần trong `packages/project-schema`** | theo file, rồi theo đối tượng (Tag, thiết lập, nhóm lưu trữ, màn hình, binding) |

## Quyết định

1. **Gói:**
   - Manifest `matscada.json` ở đầu: định dạng 1.0.0, mã, tên, phiên bản project, runtime tối thiểu, thời điểm, công cụ, `files` (path, size, sha256), digest.
   - Giới hạn: gói ≤ 50 MiB; ≤ 1024 entry; JSON ≤ 1 MiB, SVG ≤ 5 MiB; tổng sau giải nén ≤ 200 MiB; tỉ lệ nén ≤ 100.
   - Đường dẫn an toàn trên cả Linux và Windows; chỉ `.json` và `.svg`.
   - Kiểm bí mật (`E_PKG_SECRET`). Mã lỗi `E_PKG_*`.
   - Đóng gói tất định (giờ cố định, thứ tự cố định).
   - Bộ vector chung cho C++, Rust và (phần digest) TS.
2. **Kho:**
   - `v/<seq>/` gồm `package.matscada` (đúng byte đã nhận), `project/`, `meta.json` (ghi sau cùng).
   - `state.json` thay bằng ghi tạm + `fsync` + `rename` + `fsync` thư mục.
   - Giữ bản đang chạy cộng 3 bản dự phòng (`projectBackups`, 1–10).
   - Lần đầu chạy 0.4.0: runtime tự đóng gói project cài theo cách cũ thành bản 1.
3. **Nạp xuống:**
   - Chuỗi: upload → kiểm gói → kiểm project (bộ kiểm tra C++) → sao lưu → kích hoạt → kiểm tra sức khỏe.
   - Chạy nền; Studio hỏi tiến trình mỗi 500 ms.
   - Mỗi lúc một thao tác (`DEVICE_BUSY`). `X-Mat-Base-Digest` chống ghi đè lần nạp của người khác.
   - Lỗi trước khi kích hoạt: không đổi gì. Lỗi sau khi kích hoạt: rollback bằng `execv` lần nữa.
   - Khôi phục bản trước dùng cùng chuỗi, từ bước kiểm project.
4. **Mất điện:**
   - `state.json` luôn là bản cũ hoặc bản mới đầy đủ.
   - `pending` buộc lần khởi động sau kiểm sức khỏe hoặc quay về.
   - Bản `v/<seq>` thiếu `meta.json` bị xóa.
5. **Client:** máy chủ đóng phiên live bằng 1012 trước `execv`. Client 1.1.0 thử lại mỗi 1 s; trang xem tải lại khi `hello.project.digest` đổi.
6. **Đọc lên:**
   - Trả đúng byte đã lưu: digest giống hệt lần nạp.
   - Studio kiểm gói như thiết bị; chỉ giải nén vào thư mục rỗng (`create_new`).
7. **So sánh:** `packages/project-schema/src/compare.ts`. Đọc lên phần chọn thành một bước sửa hoàn tác được của Studio.
8. **Script có sẵn:**
   - `deploy.sh` vẫn cập nhật runtime. Bước validate kiểm project đang chạy trong kho bằng binary mới, và không đụng kho.
   - `rollback.sh` không đổi. Rollback runtime về < 0.4.0 thì chạy project đi kèm gói cũ (ghi trong tài liệu).

## Hệ quả

- **Tốt:**
  - Project tách khỏi runtime (FR-019): cập nhật runtime không mất project, nạp project không đụng runtime.
  - Một đường khởi động duy nhất cho kích hoạt, rollback và phục hồi sau mất điện.
  - Hai phía đọc gói theo cùng luật.
  - Digest so được giữa máy kỹ sư và thiết bị mà không cần đóng gói.
- **Xấu:**
  - Mỗi lần nạp xuống ngắt mọi kết nối khoảng 1–3 s; vốn dĩ client phải tải lại.
  - Phiên đăng nhập phải đi qua `execv` (file tmpfs).
  - Tự viết đọc/ghi ZIP ở hai ngôn ngữ phải giữ khớp nhau bằng bộ vector.
  - Kho giữ tới 4 bản (mỗi bản: gói cộng thư mục đã giải nén) trên eMMC; với project thường (< 10 MB) không đáng kể.
  - Giao thức live lên 1.1.0 (alarm của GĐ 4 sẽ là 1.2.0).
  - Rollback runtime qua mốc 0.4.0 bỏ qua kho.

## Số đo / bằng chứng

- **Ước tính** nạp xuống project < 1 MB qua LAN: tổng khoảng 5–8 s (gửi < 1 s, kiểm 0,5 s, kiểm project 0,2–0,5 s, `execv` 1–2 s, kiểm sức khỏe 2–3 s). Client tải lại sau khoảng 2–5 s.
- **Mốc hiện có:** `deploy.sh` trên BL335 qua health check sau 1 s; `kill -9` rồi systemd chạy lại sau 3–4 s ([003-acceptance.md](../reports/003-acceptance.md)).
- **Digest mẫu** `sha256:c337083b40dd7b12f8db0ace06bfb5fb8bb682931ef795cbf030dfcd0e14e119` (contract §4): tính bằng Node `crypto` ngày 2026-10-11.
- **Bộ đọc/ghi gói C++** (`core/package`, T087–T095, đo ngày 2026-10-12; chương trình đo tạm, không commit; mỗi pha một tiến trình, RSS đỉnh là `VmHWM`):
  - Cách đọc: gói đọc bằng `pread`, không bao giờ nạp cả gói. Bộ đệm lớn nhất là một entry (≤ 5 MiB, sau khi đã kiểm kích thước khai báo), cộng manifest (≤ 256 KiB) và 64 KiB dữ liệu nén.
  - Ba gói hợp lệ sát giới hạn:
    - gói stored 52.304.121 byte (11 SVG);
    - gói deflate 52.163.983 byte, 70 MB sau giải nén, dữ liệu gần như không nén được;
    - gói deflate 2,4 MB, 204.479.204 byte (≈ 195 MiB) sau giải nén, tỉ lệ ≈ 85.

  | Pha | x64 (Docker trên máy dev) | armhf dưới qemu-user (chỉ tham khảo) |
  |---|---|---|
  | `checkPackage`, gói stored 50 MiB | 0,26–0,30 s; RSS đỉnh ≈ 9 MiB (lúc đầu 3,7 MiB) | 1,3–1,7 s; RSS đỉnh ≈ 24 MiB (qemu đã chiếm ≈ 16 MiB lúc đầu) |
  | `checkPackage`, deflate 50 MiB (70 MB ra) | 1,0–1,2 s; ≈ 9 MiB | 2,5–6,2 s; ≈ 24,7 MiB |
  | `checkPackage`, 195 MiB sau giải nén | 1,05–1,07 s; ≈ 9,5 MiB | 3,2–3,4 s; ≈ 24,8 MiB |
  | `extractPackage` (fsync thật, overlayfs của Docker) | 0,53 s / 1,37 s / 2,25 s | 1,7 s / 3,1 s / 4,5 s |
  | `writeStoredPackage` 50 MiB (sinh nội dung trong bộ nhớ) | 1,0–1,2 s; ≈ 24 MiB | 6,7–6,9 s; ≈ 30 MiB |

  - RSS tăng thêm khi kiểm gói chừng 5–8 MiB, đúng bằng bộ đệm một entry: xa ngân sách 150 MB của `mat-runtime` (Constitution III).
  - Thời gian trên BL335 thật (Cortex-A7) chưa đo. qemu-user không phản ánh tốc độ thật; số armhf chỉ để thấy bậc độ lớn.
  - Ước tính 0,5 s cho bước kiểm và giải nén (R13) đúng với project thường (< 1 MB). Gói 50 MiB tốn vài giây.
- **Chưa đo:**
  - tích hợp x64: ≥ 20 lần giết tiến trình ở từng bước;
  - task ⚠️🔌: ≥ 3 lần cắt điện thật trên BL335, 10 lần nạp xuống và đọc lên với 3 project, thời gian client tải lại.

## Điều kiện xem xét lại

- Nạp xuống cần không ngắt kết nối, ví dụ khi GĐ 2 có ghi Tag và alarm đang chạy: xét đổi project ngay trong tiến trình.
- Project lớn (nhiều SVG, > 50 MB) hoặc gói cần thêm loại file (ảnh, phông chữ ở GĐ 3a): nâng định dạng gói (MINOR hoặc MAJOR theo ADR-004).
- Cập nhật runtime qua mạng (GĐ 6): dùng lại chuỗi kích hoạt và kiểm sức khỏe cho gói runtime.
