# Handoff — Sprint 1 "Vertical slice trên thiết bị"

Trạng thái ngày **2026-10-10 (khoảng 17:00 giờ VN)**. Dành cho người tiếp nhận (kỹ sư hoặc phiên Claude mới). Mọi tài liệu và trao đổi bằng tiếng Việt; code/identifier tiếng Anh (CLAUDE.md).

## 1. Tóm tắt

- `mat-runtime` (C++17, CivetWeb) **đang chạy trên BL335 bằng systemd** và phục vụ màn hình mẫu "bồn nước + bơm" theo Mock Tag. Đã đo trên thiết bị:
  - 10 client × 500 Tag: RSS trung bình 3,1 MB, CPU trung bình 11,9 %, 0 mất sequence;
  - client thứ 11 nhận 4429;
  - client chậm không ảnh hưởng client khác.
- **Tasks: 90/94 xong**, xem [specs/002-vertical-slice/tasks.md](../../specs/002-vertical-slice/tasks.md). 4 task mở ở mục 3.
- Đã qua 2 review độc lập (code + bảo mật). Lỗi Critical/High/Important đã vá và deploy lên thiết bị.
- `tools/ci-local.ps1` xanh toàn bộ ở lần chạy cuối:
  - C++ GoogleTest 97;
  - Vitest 165 (project-schema 47, svg-renderer 38, live-client 27, binding-engine 23, runtime-web 15, studio 15);
  - Go đạt;
  - Rust Studio 4/4.
- Báo cáo đầy đủ (số đo, review, hạn chế): [docs/reports/sprint1-acceptance.md](../reports/sprint1-acceptance.md).
- **Repo chưa phải git repository**: chưa có commit nào. Nên khởi tạo git (người dùng quyết định).

## 2. Đang chạy / chưa có kết quả

- **Workflow kiểm tra độ đầy đủ** (5 agent audit + 5 agent kiểm chứng: spec ↔ mã, tasks ↔ file, tài liệu ↔ hành vi, báo cáo ↔ số đo gốc, vệ sinh mã) được khởi chạy lúc bàn giao, **chưa xong**. Run ID `wf_bea101bb-082`. Kết quả (nếu đã chạy xong) nằm trong `journal.jsonl` của thư mục `C:\Users\TDH\.claude\projects\d--ATPro-RD-MiniSCADA\c8b3eb0f-7ef9-4ec7-9ea2-f46074e1c40b\subagents\workflows\wf_bea101bb-082\`.
  - Đọc trường `confirmed` ở bản ghi cuối: đó là các khoảng trống đã được kiểm chứng.
  - Nếu file không có hoặc workflow chưa xong: chạy lại một vòng audit tương đương.
  - **Chưa có kết luận nào từ workflow này**: đừng coi là "không có lỗi".

## 3. Việc còn lại (theo thứ tự ưu tiên)

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| 1 | **T063:** viết `server/tests/startup_test.cpp` (project lỗi → `system/info.project.status = "invalid"`, `/api/v1/projects/active` 503, tiến trình không thoát) | dev | Hành vi đã có và đã kiểm tay trên x64. Gợi ý: tách đoạn kích hoạt project trong `server/main.cpp` (dựng `projectInfo`, allowlist, `activeJson`) thành hàm thuần rồi test bằng GoogleTest với `tests/project-vectors/invalid-ref-tag` |
| 2 | Xử lý các khoảng trống workflow audit xác nhận (mục 2), rồi chạy lại `ci-local.ps1` | dev | |
| 3 | **Build lại bộ cài Studio** trước khi đưa người dùng: bộ cài hiện có (16:18) cũ hơn mã Studio (16:38, truyền kiểu Tag cho xem trước) | dev | `$env:CARGO_TARGET_DIR='C:\build\mat-studio'; npm run studio:build` |
| 4 | **T088 / SC-012:** thao tác Studio đầu-cuối (mở `projects/tank-demo` bằng hộp thoại, sửa/lưu, xem trước, mở web, đo ≤ 5 phút) | người dùng | Quickstart §9. Phần tự động đã đạt: [sprint1-studio-smoke.json](../reports/sprint1-studio-smoke.json) |
| 5 | **T078:** nghiệm thu Chrome thật: 10 tab trên ≥ 2 máy, tab thứ 11 (banner đầy), rút cáp ≥ 30 s, F5 đồng loạt (SC-001, SC-002 phần giao diện, SC-003 rút cáp thật, SC-007) | người dùng | Quickstart §5. URL từ xa: `http://198.51.100.200:9080/` |
| 6 | **T074:** khởi động lại BL335 để kiểm SC-010/SC-013 sau reboot | cần người dùng **cho phép rõ** | Chưa làm vì thao tác có thể ảnh hưởng dịch vụ sản phẩm cũ trên thiết bị (Constitution, mục quy trình 3) |
| 7 | **Quyết định bảo mật:** runtime chưa có xác thực (Sprint 5) nhưng đang mở ra Internet qua port-forward 9080 → khuyến nghị đóng khi không demo | người dùng | Xem review bảo mật trong báo cáo nghiệm thu |
| 8 | Test tích hợp x64 cho `CivetLiveTransport` (ghi một phần, hạn chót đóng sau close frame, frame quá lớn) | dev | Hai bản vá CivetWeb mới kiểm bằng unit test và đọc mã, **chưa có kiểm hồi quy** trên thiết bị/tích hợp. Nên làm test in-process trên x64, không cần thiết bị |
| 9 | Việc treo từ Sprint 0: T034 (Tech Lead duyệt Go/No-Go), T036 (SVG thật từ Illustrator/CorelDRAW), giới hạn import 20.000 node, ngưỡng RAM OS 200 hay 250 MB, timer `atscada-admin-recover` (5 s) của sản phẩm cũ | Tech Lead / người dùng | Không tự tắt timer |
| 10 | Nợ chuyển Sprint 2: sanitizer SVG vẫn là denylist (Constitution V cần allowlist + giới hạn node/độ sâu), importer (T059 Sprint 0), theo dõi bản vá upstream CivetWeb (CVE-2025-55763) | Sprint 2 | |

## 4. Thiết bị BL335

- **Truy cập:** SSH `198.51.100.200` cổng **2222** (IP công cộng; máy dev không còn ở LAN của thiết bị). Web runtime: `http://198.51.100.200:9080/` (router chuyển 9080 → 8080 của thiết bị). **Cổng 8080 công cộng là một máy chủ IIS khác của công ty, không phải BL335.** Trong LAN: `192.168.1.110`, cổng 22 và 8080.
- **Mật khẩu không ghi trong repo**: xem memory của Claude Code (`bl335-ssh-access`) hoặc hỏi người dùng. Máy dev không có `sshpass`: dùng `SSH_ASKPASS` với file tạm trong scratchpad và xóa sau khi dùng.
- **Trạng thái hiện tại:**
  - `/opt/mat-runtime` = deploy lần 5;
  - `/opt/mat-runtime.prev` = deploy lần 4;
  - `/etc/systemd/system/mat-runtime.service` (bản gia cố) và `.service.prev`;
  - `/etc/mat-runtime/runtime.json`;
  - user hệ thống `matscada`;
  - dịch vụ `active`, `enabled`.
- **Nhật ký mọi thay đổi + cách hoàn tác:** [docs/reports/device-changes.md](../reports/device-changes.md). Mỗi thay đổi mới phải thêm dòng ở đây.
- **Không đụng:** các unit `atscada-*` của sản phẩm cũ (kể cả timer `atscada-admin-recover`), trừ khi người dùng yêu cầu rõ.
- Trên thiết bị có `wget` nhưng **không có `curl`**.
- **Triển khai và rollback:** [docs/deployment/mat-runtime.md](../deployment/mat-runtime.md). Chuỗi Constitution VII:
  1. kiểm SHA-256;
  2. stage;
  3. `--check-project` chạy bằng `matscada`;
  4. backup;
  5. activate;
  6. health check;
  7. tự rollback, khôi phục cả unit.
  Rollback tay: `sh /opt/mat-runtime/deployment/rollback.sh`.

## 5. Lệnh thường dùng (máy dev Windows)

```powershell
./tools/ci-local.ps1                         # kiểm toàn bộ (cần Docker Desktop đang chạy)
./deployment/toolchain/build.ps1             # build chéo armhf → build/armhf/bin/mat-runtime
./deployment/toolchain/test-x64.ps1          # build x64 + ctest
npm run build:web                            # apps/runtime-web/dist (dev + lab) và dist-device (gói thiết bị)
./deployment/package-runtime.ps1             # → build/mat-runtime-armhf.tar.gz + .sha256 (chặn fixture/lab)
./deployment/toolchain/run-x64.ps1           # mat-runtime x64 trong Docker → http://localhost:8080/
npm run validate:project                     # kiểm projects/tank-demo bằng validator TS
cd tools/load-tester; go build -o ../../build/load-tester.exe .
```

Đo và kiểm (đều có trong README gốc):

- `build/load-tester.exe -host <ip> -port <cổng> [-clients 10 -extra 1 -tags sim | -slow 1 | -origin URL | -resub 100 -tags demo | -slot-test]`
- `node tools/measure/runtime-smoke.mjs <url>`
- `node tools/measure/http-check.mjs <url>`
- `node tools/measure/reconnect-check.mjs <url> --cut … --restore …`
- `node tools/measure/studio-smoke.mjs <host:port>`: cần Studio đang chạy với `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`.
- Lấy mẫu RAM/CPU trên thiết bị: `ssh … "sh -s <kịch bản> <giây> <pid>" < tools/measure/sample.sh > file.csv`.

## 6. Kiến trúc và quyết định cần biết

- **Spec, plan, contract:** [spec.md](../../specs/002-vertical-slice/spec.md) (có mục Clarifications: 4429 tự thử lại sau 30 s, Studio tối thiểu, cổng 8080, …), [plan.md](../../specs/002-vertical-slice/plan.md), [contracts/](../../specs/002-vertical-slice/contracts/):
  - live protocol 1.0.0;
  - HTTP;
  - config;
  - định dạng project và mã lỗi.
- **ADR mới:**
  - [ADR-006](../adr/006-live-protocol-v1.md): giao thức live, hàng đợi 256 KB/phiên, Origin, giới hạn đầu vào.
  - [ADR-007](../adr/007-screen-isolation.md): Shadow DOM mỗi màn hình.
- **Package dùng chung** `packages/*`: `project-schema` (validator TS), `svg-renderer`, `binding-engine`, `live-client`. Runtime web và Studio Preview dùng chung (Constitution II).
- **Validator có 2 bản** (TS và C++), phải cho cùng **tập mã lỗi** trên `tests/project-vectors/` (38 vector, sinh bằng `node tests/project-vectors/generate.mjs`). Đổi luật thì sửa **cả hai** và thêm vector.
- **CivetWeb vendored có bản vá cục bộ:**
  - giới hạn frame 96 KiB trước khi cấp phát;
  - hàm `mg_mat_force_close`.
  `mat-runtime` link bản build `NO_FILES`, tự phục vụ `/`, `/assets/`, `/project/` theo allowlist. Chi tiết: [third_party/LICENSES.md](../../third_party/LICENSES.md). Nâng cấp CivetWeb thì **áp lại bản vá**.
- **Client chậm có 2 đường bảo vệ:**
  - 4409 khi hàng đợi > 256 KB;
  - cắt khi ghi quá hạn 10 s (thường xảy ra trước).
  Cả hai trả slot ngay.
- **Project mẫu và định dạng file:** JSON 2 dấu cách + xuống dòng cuối là định dạng chuẩn do Studio ghi. `projects/` và `tests/project-vectors/` nằm trong `.prettierignore`.

## 7. Bẫy môi trường đã gặp

- **Ổ D: gần đầy** (khoảng 1 GB). Rust target đặt `C:\build\mat-studio`. Build C++ ghi `build/` trên D: (nhỏ).
- **Docker Desktop phải đang chạy** (build armhf, x64, clang-format). Không đụng các container `piano-edtech-*`.
- **Proxy cổng của Docker Desktop chặn cả hai chiều khi client ngừng đọc**: test client chậm phải chạy với thiết bị thật, không chạy với localhost Docker.
- **Bash tool:**
  - trong `node -e "…"`, dấu backtick và `${…}` bị bash thực thi;
  - `\\` và `\n` có thể bị biến đổi cả trong heredoc;
  - `grep -v` trong chuỗi `&&` trả 1 khi lọc hết dòng.
  Với nội dung có backtick/escape: dùng Write/Edit hoặc file script.
- **Windows PowerShell 5.1** đọc `.ps1` không BOM theo ANSI: thông báo `Write-Host` để không dấu.
- **Đo độ trễ dựa trên đồng hồ hai máy** dễ sai khi có bước nhảy giờ: load-tester đã dùng đồng hồ monotonic phía client. Phía thiết bị vẫn là giờ hệ thống.
- **Bộ cài Studio** cần Internet ở lần build đầu (NSIS, WebView2 offline); file khoảng 208 MiB.

## 8. Sai lệch so với kế hoạch (đã ghi trong tasks.md)

- T024/T025: `static_handler.cpp` và `api_handlers.cpp` gộp vào `server/http/http_api.cpp`.
- T068: thay test C++ bằng công cụ `tools/measure/http-check.mjs` chạy với máy chủ thật.
- T057: test client chậm chuyển từ x64 sang BL335 (do proxy Docker).
- T005: chỉ có `schemas/README.md`.
- Giới hạn bản tin client đổi từ 16 KB (thiết kế ban đầu) lên **96 KiB** sau review.
- Mọi đo đạc đi **qua Internet** thay vì LAN.
