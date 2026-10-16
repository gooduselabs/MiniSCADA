# Phát hành 0.9.0 (runtime) và Studio 0.8.0

Ngày 2026-10-16, từ nhánh `003-data-logging` (đã gộp 008, 009, 010). Chưa triển khai lên BL335.

## Thành phần

| Thành phần | Phiên bản |
|---|---|
| mat-runtime | 0.9.0 |
| API | 1.4.0 |
| Giao thức live | 1.3.0 |
| Định dạng project | 0.6.0 (schema 0.3 đến 0.5 đóng băng kèm theo) |
| mAT Studio | 0.8.0 |

## Sản phẩm

| Sản phẩm | Đường dẫn | SHA-256 |
|---|---|---|
| Gói runtime armhf (5.033.347 B) | `D:\ATPro\RD\MiniSCADA\build\mat-runtime-armhf.tar.gz` (+ `.sha256`) | `654b6de3527f8b8eba8fd34597c70c7191f8391516054e829ad0022215922cd0` |
| Bộ cài Studio NSIS (220.588.188 B) | `C:\build\mat-studio-release\release\bundle\nsis\mAT Studio_0.8.0_x64-setup.exe` | `5462a20750330602c161315c5768a9cecab21d5d8e5ec4f3becaa41e24dfc86d` |

Nhị phân không commit. Gói chứa `schemas/0.3`, `0.4`, `0.5`, schema gốc 0.6, `schemas/widgets.catalog.json`, `deploy.sh`, `rollback.sh`, `mat-runtime.service`, `runtime.json` mẫu; script đóng gói không báo file bị cấm.

## Kiểm tra

- Build armhf (`deployment/toolchain/build.ps1`, Release): lần đầu **hỏng** vì `__int128` không có trên armhf (`core/historian/query/downsample.cpp`, `history_query.cpp`, mã của 010). Sửa tối thiểu: hàm `mulDivTrunc` (số học 64 bit) trong `downsample.hpp`. Phạm vi an toàn: chia lấy phần nguyên theo `a/c` rồi `(a%c)*b`, với `c` <= 1e13 ms, `b` <= 1e4.
- `smoke-armhf.sh` (qemu) trên bản vừa build: OK; `system/info` báo runtime 0.9.0, api 1.4.0, protocol 1.3.0. Kiểm phiên bản trong script đã cập nhật từ api 1.3.0 sang 1.4.0 (script cũ lỗi thời).
- `tools/measure/studio-smoke.mjs --exe` với `mat-studio.exe` vừa build: PASS (mở tới tab Bắt đầu 1263 ms, mở tank-demo 89 ms, IPC `app_info` 0.8.0, không lỗi console/CSP). Chạy trực tiếp file exe, chưa chạy trình cài đặt.
- Chưa chạy ctest đầy đủ trong đợt này (việc của agent kiểm tra); test x64 của `mulDivTrunc` chưa chạy riêng.

## Triển khai lên BL335

Theo [mat-runtime.md](../deployment/mat-runtime.md) mục 3: kiểm cổng 8080, chép `build/mat-runtime-armhf.tar.gz` và `.sha256` cùng `deploy.sh`, `rollback.sh` lên thiết bị rồi chạy `deploy.sh` (checksum, stage, validate, backup, activate, health check 15 s, tự rollback nếu hỏng). Nâng schema lịch sử (feature 010) xảy ra lúc runtime mở `history.db`; project nạp xuống cần định dạng 0.6. Ghi mọi thay đổi vào [device-changes.md](device-changes.md). Mục 5g nêu giới hạn đã biết.

## Hoàn tác

`sh /opt/mat-runtime/deployment/rollback.sh` (mục 6). Rollback runtime về < 0.9 thì rollback cả project (runtime 0.8 từ chối `logging.json` 0.6); `history.db` schema 2 mở được bằng 0.8. Studio: gỡ bằng trình gỡ cài đặt Windows, cài lại bộ cài 0.7.x.

## Còn lại

- Bộ cài 220 MB lớn bất thường, chưa điều tra nguyên nhân (nghi tài nguyên đóng gói).
- Chưa thử gói trên BL335 (đo RAM, ghi eMMC, mất điện: chờ người).
