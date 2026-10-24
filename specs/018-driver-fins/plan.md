# Implementation Plan: Driver Omron FINS

**Branch**: `018-driver-fins` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

## Summary

Driver FINS tự viết C++17 theo khuôn driver Modbus TCP (một luồng 256 KiB mỗi kênh, `Scheduler`, `planBlocks`/`splitBlock`, `Backoff`, `DiagCounters`, `Transport` giả trong test, chế độ `manual` + `pump()`), codec dùng lại `modbus::decodeNumber`/`encodeNumber`/`decodeString` với thứ tự `CDAB`/`AB`. Địa chỉ FINS có hai bản (TS `@mat/tag-codec` `parseFinsAddress`, C++ `drivers/fins/address`) trên một vector JSON. Định dạng 1.1 thêm kênh `fins` và `source.bcd`; luật kiểm ở `rules-fins.ts` và `rules_fins.cpp`, gọi từ chỗ Modbus kiểm địa chỉ.

## Technical Context

- C++17, CMake + Ninja, GoogleTest; thư viện mới `mat_fins_codec` (địa chỉ, thuần, cho validator ở `mat_core`) và `mat_fins` (khung, mã kết thúc, UDP, driver, thử kết nối).
- TS: `packages/tag-codec` (địa chỉ), `packages/project-schema` (luật), `apps/studio` (editor Kết nối, bảng Tag, chẩn đoán).
- Giả lập: `tools/fins-sim` (Node ≥ 22, `node:dgram`, `node:net`, không phụ thuộc mới).
- Không thư viện ngoài, không license mới.

## Constitution Check

| Nguyên tắc | Đánh giá |
|---|---|
| I Thiết bị thật | Đo x64 và armhf qemu trong feature; đo BL335 và PLC thật **chờ người dùng** (ghi ở báo cáo và ADR-046) |
| II Ranh giới | Driver chỉ phát qua `EngineSink`; Studio dùng `@mat/tag-codec` chung; validator hai bản cùng vector |
| III Ngân sách | Một luồng/kênh, bộ đệm ≤ 2 KiB/khung, không cấp phát theo Tag mỗi vòng ngoài vector kết quả; đo RSS/CPU x64 500 Tag |
| V An toàn | Ghi qua write coordinator (quyền, giới hạn, audit); không gửi lại lệnh ghi; bộ giải mã có giới hạn độ dài, fuzz |
| VI Test trước | gtest khung/địa chỉ/driver viết trước; vector chung; driver-it |
| VII Phiên bản | Chỉ thêm vào dòng 1.1 (MINOR), `E_CHANNEL_VERSION` chặn ở 1.0; driver phát hành cần số đo BL335 (chờ) |

Đạt (Constitution 2.0.2). Không có Complexity Tracking.

## Quyết định (tự chốt)

1. **Một kênh = một điểm cuối IP**, thiết bị = địa chỉ FINS đích (mạng, nút, unit) sau điểm cuối đó (giống cổng nối Modbus nhiều unit id).
2. **Driver riêng `FinsDriver : Driver`**, không mở rộng `TagBinding` của Modbus (giữ Modbus nguyên, gộp dễ với 016/017): `FinsTagBinding` riêng trong `drivers/fins`.
3. **Runtime**: `RuntimeEngine` giữ thêm danh sách `drv::Driver*` theo thứ tự kênh của model (`allDrivers()`); `driverOf(tag)` trả `drv::Driver*`; chẩn đoán nhận `const drv::Driver*`. Modbus giữ `channelDrivers()` cho RTU probe.
4. **ChannelModel** thêm `kind` (chuỗi kind của project) và khối `fins`; **DeviceModel** thêm `fins` (mạng, nút, unit, giới hạn); **TagSourceModel** thêm `finsAddr` và `bcd`.
5. **Mã lỗi**: `E_CHANNEL_VERSION` mới; địa chỉ dùng lại `E_ADDR_*`. Lý do quality `FINS_*` (FR-008) đăng ký ở `schemas/error-codes.json`.
6. **UDP transport** `drivers/fins/udp_link` (socket UDP `connect()` tới PLC: chỉ nhận datagram từ PLC; `read` trả một datagram). Không đặt vào `drivers/sdk` để không đụng chỗ dùng chung với 016/017.
7. **0104**: chỉ đọc word đơn hoặc cờ; Tag nhiều word chiếm nhiều phần tử liền. Lỗi 11xx trên 0104 → tách về các khối 0101 riêng (vòng sau).

## Project Structure

```text
drivers/fins/
  address.{hpp,cpp}        # cú pháp, mã vùng, tầm (mat_fins_codec)
  frame.{hpp,cpp}          # mã hóa/giải mã khung FINS, đầu FINS/TCP, 0101/0102/0104/0501
  end_codes.{hpp,cpp}      # MRES/SRES -> lý do, thông điệp
  bcd.{hpp,cpp}            # BCD 4/8 chữ số
  udp_link.{hpp,cpp}       # Transport UDP
  fins_driver.{hpp,cpp}    # driver
  tests/                   # gtest: address, frame (vector W342), driver (fake PLC), fuzz
core/tag-engine/fins_factory.{hpp,cpp}
core/project-manager/rules_fins.{hpp,cpp}
packages/tag-codec/src/fins-address.ts
packages/project-schema/src/rules-fins.ts
tests/fins-vectors/{address.json,frames.json}
tests/project-vectors/v11-fins.mjs (+ thư mục v11-fins-*)
tools/fins-sim/            # giả lập UDP + TCP
tests/driver-it/           # kịch bản fins-*
```
