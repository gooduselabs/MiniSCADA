# Implementation Plan: Driver OPC UA client (019)

**Spec**: [spec.md](spec.md) · **ADR**: [047](../../docs/adr/047-driver-opcua.md)

## Kỹ thuật

- C++17 trên SDK driver (`drivers/sdk`), open62541 1.4.21 (C, `third_party/open62541`, target `mat_open62541`), Mbed TLS 3.6.7 dùng chung (`mat_mbedtls`).
- TS: `@mat/tag-codec` (NodeId), `@mat/project-schema` (luật), Studio (Kết nối, Bảng Tag, Chẩn đoán, hộp Duyệt node).

## Cấu trúc mã

```
third_party/open62541/            open62541.c/.h (amalgamation), LICENSE, LICENSE-CC0, VERSION.txt, amalgamate.sh
drivers/opcua/node_id.{hpp,cpp}   NodeId dạng chuỗi (thuần, không phụ thuộc open62541; validator dùng) → mat_opcua_codec
drivers/opcua/status_map.{hpp,cpp} StatusCode → quality/lý do (thuần)
drivers/opcua/value_codec.{hpp,cpp} UA_Variant ↔ TagScalar theo kiểu Tag (D5)
drivers/opcua/client_cert.{hpp,cpp} chứng chỉ client tự sinh, SHA-256 chứng chỉ server, kiểm ghim (D9, D10)
drivers/opcua/opcua_driver.{hpp,cpp} driver (luồng, kết nối, subscription/poll, ghi, chẩn đoán)
drivers/opcua/browse.{hpp,cpp}    kết nối tạm: endpoints, browse (D12)
drivers/opcua/tests/              test đơn vị + test driver với server open62541 trong tiến trình (test_server.hpp)
core/tag-engine/opcua_factory.*   kênh opcua của model → driver; bí mật từ secrets.json
server/http/opcua_api.cpp         POST /api/v1/drivers/opcua/browse
tools/opcua-sim/opcua_sim.c(pp)   giả lập (mat-opcua-sim, x64)
tests/opcua-vectors/nodeid.json   vector NodeId chung TS/C++
tests/project-vectors/v11-opcua.mjs  vector project
tests/driver-it-opcua/, tools/driver-it-opcua.ps1  rig tích hợp
```

## Tích hợp runtime (theo khuôn của 016)

- `ChannelModel.kind`, `RuntimeEngine::driversByChannel()` (`drv::Driver*`), `write_glue` và chẩn đoán theo `drv::Driver*`, `ChannelDiag.details` — giống hệt thay đổi của nhánh 016 để gộp dễ (khi gộp: giữ một bản).
- `mat-runtime` link `-Wl,--gc-sections` để bỏ phần server của open62541.

## Kiểm thử

1. Vector NodeId (TS + C++), vector project v11-opcua-* (TS + C++).
2. `opcua_status_test`, `opcua_value_test`, `opcua_cert_test` (thuần).
3. `opcua_driver_test`: server open62541 trong tiến trình trên cổng ngẫu nhiên: đọc mọi kiểu, node lạ, ghi + readback, node chỉ đọc, poll và fallback, server dừng/chạy lại, Basic256Sha256 + username, ghim sai, thiếu bí mật.
4. Rig Docker `driver-it-opcua`: runtime x64 + `mat-opcua-sim`; đo 500 node.
5. Studio: Vitest + e2e `connections-opcua.e2e.mjs`.

## Rủi ro

- RAM của open62541 (bộ đệm 64 KiB × 2 mỗi kết nối, chứng chỉ RSA): đo ở T030.
- CPU RSA 2048 trên Cortex-A7 khi bắt tay (một lần mỗi kết nối, ~vài trăm ms): chấp nhận, đo qemu chỉ mang tính tương đối.
