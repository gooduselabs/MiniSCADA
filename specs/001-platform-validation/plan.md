# Implementation Plan: Kiểm chứng nền tảng (Sprint 0)

**Branch**: `001-platform-validation` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-platform-validation/spec.md`

## Summary

Chứng minh BL335 đủ sức làm thiết bị đích trước khi đầu tư các sprint sau. Cách làm: build chéo bằng container Ubuntu 20.04 (cùng glibc 2.31 với thiết bị) để ra binary armhf; viết PoC máy chủ C++17 (CivetWeb là mặc định, Drogon là ứng viên so sánh) phục vụ file tĩnh + WebSocket đẩy 500 Tag giả lập/giây với bộ đếm 10 client; viết công cụ tải bằng Go mô phỏng 10 + 1 client; đo RAM/CPU qua `/proc` trên thiết bị; dựng monorepo + CI; khởi tạo Studio Tauri 2; chuẩn bị SVG mẫu; kết thúc bằng báo cáo Go/No-Go và 5 ADR. Chi tiết quyết định: [research.md](research.md).

## Technical Context

**Language/Version**: C++17 (PoC, GCC 9.4 trong Ubuntu 20.04); TypeScript 5 / Node 24 (Studio, runtime-web); Go 1.26 (load-tester); PowerShell + POSIX sh (script đo)

**Primary Dependencies**: CivetWeb (MIT; HTTP + WebSocket), Drogon (so sánh, build tách riêng); Tauri 2 + Vite (Studio); Vitest; CTest (test C++ dùng macro CHECK tự viết, chưa dùng GoogleTest); CMake + Ninja

**Storage**: Tệp (kết quả đo CSV/JSON, báo cáo Markdown). Chưa dùng SQLite ở Sprint 0

**Testing**: Vitest (TS), CTest với macro CHECK tự viết (C++; GoogleTest chưa dùng), `go test` (load-tester); kiểm thử chấp nhận trên thiết bị theo [quickstart.md](quickstart.md)

**Target Platform**: BL335 Linux armv7l (Ubuntu 20.04.5, kernel 5.4.61, glibc 2.31); Chrome ≥ 120; Studio trên Windows 10/11 x64

**Project Type**: monorepo đa thành phần (embedded runtime C++ + web client + desktop app + tools)

**Performance Goals**: 500 Tag/giây × 10 client; mở SVG ≤ 2 s; độ trễ gom delta 100–250 ms

**Constraints**: RAM OS rảnh ≤ 250 MB; RSS PoC ≤ 60 MB; CPU PoC trung bình ≤ 30%; client 11 bị từ chối (close code 4429); heartbeat timeout 15 s; hàng đợi gửi mỗi client ≤ 256 KB

**Scale/Scope**: 1 thiết bị, 10 client + 1 client dư, 500 Tag, ≥ 10 SVG mẫu, 5 ADR

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Nguyên tắc | Đánh giá | Ghi chú |
|---|---|---|
| I. Vertical slice trên thiết bị thật | ✅ | Mọi số đo thực hiện trên BL335, không chỉ x64 |
| II. Ranh giới kiến trúc | ✅ | PoC chỉ có HTTP/WS + Mock Tag; chưa có driver. Cấu trúc thư mục theo Master Plan §5 |
| III. Ngân sách tài nguyên | ✅ | Sprint này chính là nơi đo và xác nhận ngân sách |
| IV. Chrome + 10 client | ✅ | Session manager giới hạn 10, mã 4429 |
| V. An toàn mặc định | ✅ (phạm vi) | PoC trong LAN, không auth; ghi rõ "không dùng cho vận hành". Thao tác phá hủy trên thiết bị cần người dùng đồng ý |
| VI. Test-first | ✅ | Session manager và load-tester có test trước |
| VII. Đơn giản | ✅ | Không SQLite/driver/TLS ở Sprint 0 |

Không có vi phạm; mục Complexity Tracking để trống. Re-check sau Phase 1: vẫn đạt.

## Project Structure

### Documentation (this feature)

```text
specs/001-platform-validation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── live-ws.md          # giao thức WebSocket PoC
│   └── measurement.schema.json
├── checklists/requirements.md
└── tasks.md                # /speckit-tasks
```

### Source Code (repository root)

```text
CMakeLists.txt
core/session-manager/         # giới hạn 10 client (C++, có unit test)
server/                       # PoC HTTP + WS (CivetWeb)
server/poc-drogon/            # PoC so sánh
apps/runtime-web/             # trang thử hiển thị SVG + nhận delta
apps/studio/                  # Tauri 2 khởi tạo
tools/load-tester/            # Go
tools/measure/                # script đo RAM/CPU trên thiết bị
tests/fixtures/svg/           # ≥ 10 SVG mẫu
deployment/toolchain/         # Dockerfile build armhf
deployment/systemd/
docs/adr/                     # 5 ADR
docs/reports/                 # hồ sơ thiết bị, báo cáo Go/No-Go
.github/workflows/
```

**Structure Decision**: theo đúng cây thư mục Master Plan §5; chỉ tạo các thư mục Sprint 0 cần, phần còn lại tạo ở sprint sau.

## Complexity Tracking

Không có vi phạm cần biện minh.
