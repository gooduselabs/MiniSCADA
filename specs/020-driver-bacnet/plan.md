# Implementation Plan: Driver BACnet/IP client

**Branch**: `020-driver-bacnet` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md) | **ADR**: [048](../../docs/adr/048-driver-bacnet.md)

## Tóm tắt kỹ thuật

C++17 tự viết theo khuôn SDK driver (như S7 016, FINS 018 trên nhánh riêng); TS cho địa chỉ và luật; Node cho giả lập; Lit cho Studio. Không thư viện mới, không thay đổi giấy phép (`third_party/LICENSES.md` không đổi).

| Phần | Tệp |
| --- | --- |
| Địa chỉ Tag (thuần) | `drivers/bacnet/address.{hpp,cpp}` ↔ `packages/tag-codec/src/bacnet-address.ts`, vector `tests/bacnet-vectors/address.json` |
| Mã hóa BACnet/IP (thuần) | `drivers/bacnet/codec.{hpp,cpp}`: tag ASN.1, BVLC, NPDU, APDU, RP/RPM/WP/Who-Is/I-Am; vector `tests/bacnet-vectors/frames.json` (Annex F) |
| UDP | `drivers/bacnet/udp_port.{hpp,cpp}`: `DatagramPort` (giao diện, giả được trong test), `UdpPort` (poll + self-pipe) |
| Yêu cầu confirmed | `drivers/bacnet/client.{hpp,cpp}`: invoke ID, gửi lại cùng ID, khớp nguồn/ID/dịch vụ/SNET |
| Driver | `drivers/bacnet/bacnet_driver.{hpp,cpp}`: kế hoạch RPM theo maxApdu, status-flags → quality, fallback RP, chia đôi khi Abort, ghi + đọc lại, relinquish, BBMD, `probeBacnet` (read/whois/objects) |
| Runtime | `core/tag-engine/{tag_model,bacnet_factory}`, `server/runtime_engine` (`allDrivers`), `server/write_glue`, `server/http/drivers_api` (kind `bacnet`, khóa exception `error:/reject:/abort:`), `server/main.cpp` |
| Định dạng 1.1 | `schemas/connections.schema.json` (`bacnetChannel`, `bacnetDevice`), `tag.schema.json` (địa chỉ 32 ký tự), `rules-bacnet.ts` ↔ `rules_bacnet.cpp`, `E_CHANNEL_VERSION`, vector `v11-bacnet-*` |
| Mã lỗi | `schemas/error-codes.json` (`BACNET_*`, `BBMD_NAK`, `E_CHANNEL_VERSION`), sinh lại `docs/user/error-codes.md` |
| Giả lập | `tools/bacnet-sim/` (codec, server, sim, maps, test node) |
| driver-it | `tests/driver-it-bacnet/` (compose 172.30.20.0/24, projects, `bacnet-it.mjs`), `tools/driver-it-bacnet.ps1` |
| Studio | `model/connections-bacnet.ts`, `model/connections.ts`, `ui/editors/connections-bacnet.ts` (Tìm thiết bị, Thử, Duyệt đối tượng), `connections-editor.ts`, `tag-table.ts`, `driver-diagnostics.ts`, `i18n/vi-bacnet.ts`; e2e `connections-bacnet.e2e.mjs` |

## Quyết định tự chốt (giả định ghi ở spec)

1. Tự viết thay bacnet-stack (ADR-048 §1).
2. IP thiết bị bắt buộc; Who-Is chỉ cho Studio.
3. Không segmentation, không COV ở bản này.
4. Mặc định 500 ms × (1 + 1 gửi lại) để không cảnh báo `W_DETECT_SLOW` ở chu kỳ 1 s.
5. Relinquish là thuộc tính giả `relinquish@p` trên Tag BOOL (API ghi Tag không có giá trị NULL).
6. Lỗi địa chỉ dùng lại `E_ADDR_SYNTAX/RANGE/AREA` (không thêm mã mới).
7. Rig driver-it riêng (mạng 172.30.20.0/24) để chạy song song các driver khác.

## Kiểm

- gtest: `bacnet_codec_test` (vector), `bacnet_driver_test` (thiết bị giả: RPM, status-flags, fallback, chia đôi, timeout cùng invoke ID, ghi priority, relinquish, router, BBMD, cổng bận, probe), `bacnet_fuzz_test`, `bacnet_factory_test`, `drivers_bacnet_api_test`, `vectors_11_test` (C++ trên `v11-bacnet-*`).
- vitest: `bacnet-address.test.ts`, `vectors-11.test.ts`, `connections-bacnet.test.ts`; node test: `tools/bacnet-sim/sim.test.mjs` (đáp án giả lập = vector Annex F).
- e2e Studio `connections-bacnet`; driver-it x64 `read`, `write`, `errors`, `load`; armhf qemu (`test-armhf.sh`).
