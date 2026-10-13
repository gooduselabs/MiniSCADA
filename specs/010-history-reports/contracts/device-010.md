# Contract — thiết bị: `system/info`, `runtime.json`, lệnh CLI, ghi eMMC đo thực

**Feature**: [spec.md](../spec.md) FR-014, FR-027, FR-031, FR-057, FR-061 · **Nền**: [system-info.md](../../003-data-logging/contracts/system-info.md), [device.md](../../003-data-logging/contracts/device.md) của 003 · **ADR**: [034](../../../docs/adr/034-trigger-mode-write-estimate.md)

Chỉ ghi phần thêm. Khối `historian` của `GET /api/v1/system/info` giữ mọi khóa của 003; thêm các khóa dưới đây. Trang `system/info` đầy đủ vẫn theo `viewerLogin` (007); bản tối thiểu công khai không có khối `historian`. **Không** khóa nào chứa secret, tên người dùng, địa chỉ DB, tên bảng, đường dẫn.

## 1. Khối `historian` (thêm)

```json
"historian": {
  "…": "(khóa của 003)",
  "warnings": ["W_LOG_WRITE_BUDGET"],
  "groupsInfo": [
    { "id": "ap-suat", "mode": "onChange", "rows24h": 18234, "triggerState": null,
      "aggregates": true }
  ],
  "query": {
    "enabled": true, "inFlight": 0, "served": 1234, "rejectedBusy": 3, "rejectedLimit": 1,
    "timeouts": 0, "errors": 0, "p95Ms": 85, "lastError": null
  },
  "aggregates": {
    "enabled": true, "groups": 1,
    "rows": { "minute": 288000, "hour": 4800 },
    "backfill": { "active": false, "group": null, "progress": null },
    "capRowsDeleted": { "raw": 0, "minute": 0, "hour": 0 },
    "schema": 2
  },
  "io": {
    "source": "proc-self-io",
    "writeBytes1h": 23000000,
    "writeBytes24h": 540000000,
    "coverageS": 86400,
    "bytesPerDay": 540000000,
    "estimateBytesPerDay": 565002240,
    "budgetBytesPerDay": 2147483648
  }
}
```

| Trường | Ý nghĩa |
|---|---|
| `groupsInfo[].rows24h` | số dòng thô ghi trong 24 giờ trượt (bộ đếm theo giờ, 24 ô); Studio dùng cho "Dùng số đo" (FR-049) |
| `groupsInfo[].triggerState` | nhóm `trigger`: `active`, `inactive`, `unknown` (quality xấu); nhóm khác `null` |
| `query.served`, `rejectedBusy`, `rejectedLimit`, `timeouts`, `errors` | bộ đếm từ lúc khởi động; `rejectedLimit` = `SCAN_LIMIT` + `RANGE_TOO_LARGE` + `EXPORT_TOO_LARGE` |
| `query.p95Ms` | p95 thời gian 256 truy vấn gần nhất |
| `query.lastError` | `{ code, at }` (mã lỗi của contract API; không có thông điệp của SQLite) |
| `aggregates.rows` | số hàng `mat_agg` theo độ phân giải (đếm bằng `COUNT(*)` mỗi 10 phút, hoặc `null` nếu chưa đếm) |
| `aggregates.backfill` | tiến độ dựng bù: `active`, nhóm, `progress` 0–1 (theo `agg_back_to`); lúc không dựng `active: false` |
| `io.writeBytes1h`, `writeBytes24h` | tổng `write_bytes` của **tiến trình runtime** trong cửa sổ (`/proc/self/io`, mẫu mỗi 60 s, vòng 1.440 ô) |
| `io.coverageS` | số giây thực có số đo trong cửa sổ 24 giờ (< 86.400 nếu mới khởi động) |
| `io.bytesPerDay` | `writeBytes24h × 86.400 / coverageS` (ngoại suy tốc độ ghi); `null` khi `coverageS < 600` |
| `io.estimateBytesPerDay` | ước tính của `estimateLogging` (C++) cho cấu hình đang chạy (so với `bytesPerDay`) |
| `io.source` | `proc-self-io` hoặc `unavailable` (không đọc được `/proc/self/io`: các số `null`) |

`write_bytes` gồm mọi ghi của tiến trình (log lỗi, audit, `history.db`, state), không chỉ lưu trữ; ghi chú trong tài liệu. Không có số đo cấp thiết bị (`/sys/block/mmcblk*/stat`): ngoài tiến trình và khuếch đại ghi bên trong eMMC không đo được.

## 2. `runtime.json` (thêm)

| Khóa | Kiểu | Mặc định | Ràng buộc |
|---|---|---|---|
| `historyApi` | bool | `true` | `false` tắt toàn bộ `history/*` (404 `NO_HISTORY`); ghi dữ liệu không đổi |
| `historyMaxConcurrent` | int | 2 | 1 … 4 |
| `historyQueryTimeoutMs` | int | 10000 | 1000 … 30000 |
| `historyMaxScanMiB` | int | 64 | 8 … 256 |
| `historyReaderCacheKiB` | int | 4096 | 1024 … 8192; tổng `cache_size` của mọi kết nối (ghi + đọc + gửi) ≤ 32 MiB (kiểm khi khởi động; vượt thì hạ cache đọc và ghi cảnh báo vào journal) |

Khóa lạ vẫn bị từ chối như các khóa khác của `runtime.json`. Đổi giới hạn cần khởi động lại runtime: `runtime.json` chỉ được đọc lúc khởi động (như 003).

## 3. Lệnh CLI (`mat-runtime`)

| Lệnh | Việc |
|---|---|
| `--export-history <nhóm> --from <iso> --to <iso> [--res raw\|1m\|1h] [--fields avg,min,max,last]` | mở rộng lệnh của 003: thêm `--res` và `--fields`; cùng định dạng CSV với `export.csv` (BOM tùy chọn `--no-bom`); thời gian `--from`, `--to` theo giờ địa phương của nhóm (`2026-10-12 06:00`) hoặc epoch ms |
| `--verify-aggregates <nhóm> [--from … --to …] [--json]` | dựng lại bucket từ dòng thô bằng cùng bộ cộng dồn (áp `mat_runs` để ngắt tín hiệu) rồi so với `mat_agg`: báo bucket thiếu, thừa, lệch (`n`, `min`, `max`, `first`, `last` tuyệt đối; `sumw`, `wms` dung sai tương đối 1e-9); phút → giờ nhất quán. Thoát 0 = khớp, 1 = có sai khác, 2 = lỗi. Đọc chỉ đọc, chạy được khi runtime đang chạy |
| `--history-stats [--json]` | số hàng và dung lượng theo bảng (`log_*`, `mat_agg`, `mat_runs`), khoảng thời gian, schema; chỉ đọc |

Lệnh chạy ở chế độ chỉ đọc (`query_only`), không đụng secret; tài liệu `docs/deployment/mat-runtime.md` mô tả.

## 3.1 Trạng thái trigger (nội bộ)

Sampler của nhóm `trigger` giữ `active` (bool, lần lấy mẫu trước), `lastRowMono`; không có trạng thái bền (sau khởi động lại không có cạnh, contracts/logging-config-0.2.md §1).

## 4. Triển khai

- `deploy.sh`, `rollback.sh` giữ `history.db` (và `-wal`, `-shm`) như 003; nâng schema 2 xảy ra lúc runtime mở DB, không do `deploy.sh`.
- Rollback về runtime 0.8: `history.db` schema 2 vẫn mở được (history-db.md §2); cấu hình `logging.json` 0.2 bị runtime 0.8 từ chối (`E_SCHEMA_VERSION`) nên khi rollback cả project cũng rollback (cơ chế `state.json` của 005).
- Không thêm thư viện hệ thống; không đổi sandbox systemd; `StateDirectory` giữ nguyên.
