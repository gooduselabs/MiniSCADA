# Contract — `logging.json` 0.2.0: chế độ trigger, tổng hợp, ước tính ghi

**Feature**: [spec.md](../spec.md) FR-001…FR-008, FR-055, FR-056 · **Nền**: [contracts/logging-config.md của 003](../../003-data-logging/contracts/logging-config.md) (trường, thứ tự kiểm, mã lỗi, công thức gốc) · **ADR**: [034](../../../docs/adr/034-trigger-mode-write-estimate.md), [031](../../../docs/adr/031-history-aggregates.md)

File này **chỉ ghi phần đổi so với 003**. Mọi trường, mã lỗi, luật và vector của 003 giữ nguyên. Schema máy đọc: `schemas/logging.schema.json` đổi `$id` thành `…/logging/0.2.json` và nhận `schemaVersion` `0.1.x` hoặc `0.2.x` (hai nhánh: các trường mới chỉ hợp lệ với `0.2.x`).

## 1. Trường mới

### LoggingGroup (thêm)

| Trường | Kiểu | Bắt buộc | Mặc định | Ràng buộc |
|---|---|---|---|---|
| `mode` | `cyclic` \| `onChange` \| **`trigger`** | có | | `trigger` chỉ ở 0.2.x |
| `trigger` | Trigger | khi `mode = trigger` | | cấm với `cyclic`, `onChange` |
| `periodMs` | int | khi `cyclic`, hoặc `trigger` với `edge = active` | | 100 … 86.400.000 |
| `minIntervalMs` | int | không | 1000 | `onChange` và `trigger` (như 003) |
| `maxIntervalMs` | int | không | không có | chỉ `onChange` (**kết hợp** = `onChange` có trường này, D2); cấm với `trigger` |
| `expectedRowsPerDay` | int | không | không có | 1 … 864.000.000; chỉ `onChange` và `trigger`; chỉ dùng cho ước tính |
| `aggregates` | Aggregates | không | không có | có mặt = bật tổng hợp |

### Trigger

| Trường | Kiểu | Bắt buộc | Mặc định | Ràng buộc |
|---|---|---|---|---|
| `tagId` | string | có | | Tag trong `tags.json`; kiểu BOOL hoặc số (không `STRING`); không cần có trong `tags` của nhóm |
| `edge` | `rising` \| `falling` \| `both` \| `active` | có | | |
| `threshold` | number | không | 0 | chỉ Tag số; Tag BOOL có `threshold` là `E_LOG_TRIGGER` |

Trạng thái bật: BOOL = đúng; số = `> threshold`. Quality khác GOOD = tắt, không tạo cạnh. Cạnh so với lần lấy mẫu trước (100 ms). Lúc runtime bắt đầu không có cạnh; `active` bắt đầu ghi theo `periodMs` nếu Tag đang bật.

| `edge` | Ghi một dòng khi |
|---|---|
| `rising` | tắt → bật |
| `falling` | bật → tắt |
| `both` | tắt → bật, hoặc bật → tắt |
| `active` | tắt → bật (dòng đầu), rồi mỗi `periodMs` khi vẫn bật, và một dòng khi bật → tắt |

Mọi `edge` bị chặn bởi `minIntervalMs` (hai dòng của cùng nhóm cách nhau ≥ `minIntervalMs`; cạnh đến sớm hơn được hoãn tới hết khoảng và mang giá trị mới nhất, như `onChange` ở 003). Dòng chứa giá trị hiện hành của mọi Tag của nhóm; Tag kích hoạt nằm trong danh sách thì có ô của nó.

### Aggregates

| Trường | Kiểu | Bắt buộc | Mặc định | Ràng buộc |
|---|---|---|---|---|
| `minuteRetentionDays` | int | không | 31 | 1 … 365 |
| `hourRetentionDays` | int | không | 730 | 1 … 3650; ≥ `minuteRetentionDays` (không thì `E_LOG_AGG`) |

### LoggedTag (thêm)

| Trường | Kiểu | Bắt buộc | Mặc định | Ràng buộc |
|---|---|---|---|---|
| `aggregate` | bool | không | `true` cho Tag số và BOOL | `true` tường minh cho Tag `STRING` là `E_LOG_AGG`; `false` loại Tag khỏi tổng hợp; chỉ có tác dụng khi nhóm có `aggregates` |

## 2. Ví dụ

```json
{
  "schemaVersion": "0.2.0",
  "timeZone": "+07:00",
  "groups": [
    { "id": "ap-suat", "name": "Áp suất", "mode": "onChange",
      "minIntervalMs": 1000, "maxIntervalMs": 60000, "expectedRowsPerDay": 20000,
      "retentionDays": 30,
      "aggregates": { "minuteRetentionDays": 31, "hourRetentionDays": 730 },
      "tags": [ { "tagId": "LINE1.PRESS", "deadband": 0.2 }, { "tagId": "LINE1.TEMP", "deadband": 0.5 } ] },
    { "id": "me-tron", "name": "Mẻ trộn", "mode": "trigger", "minIntervalMs": 5000,
      "trigger": { "tagId": "BATCH.DONE", "edge": "rising" },
      "retentionDays": 365,
      "tags": [ { "tagId": "BATCH.WEIGHT" }, { "tagId": "BATCH.RECIPE", "maxLength": 32 } ] }
  ],
  "connections": []
}
```

## 3. Mã lỗi mới

| Mã | Khi nào | Vị trí |
|---|---|---|
| `E_LOG_TRIGGER` | `mode = trigger` thiếu `trigger`; `trigger` với mode khác; `tagId` kiểu `STRING`; `threshold` với Tag BOOL; `periodMs` thiếu khi `edge = active` hoặc có khi `edge` khác; `maxIntervalMs` có mặt với `trigger`; `expectedRowsPerDay` với `cyclic` | `/groups/i`, `/groups/i/trigger/...` |
| `E_LOG_AGG` | `aggregates` mà nhóm không có Tag số/BOOL nào có tổng hợp; `aggregate: true` cho Tag `STRING`; `hourRetentionDays < minuteRetentionDays` | `/groups/i/aggregates`, `/groups/i/tags/j/aggregate` |

`tagId` của `trigger` không có trong `tags.json` → `E_LOG_REF_TAG` (vị trí `/groups/i/trigger/tagId`). Giới hạn số (`expectedRowsPerDay`, retention) do schema chặn → `E_SCHEMA`. Trường 0.2 trong file `schemaVersion` `0.1.x` → `E_SCHEMA`.

Thứ tự kiểm giữ như 003 (bước 6 thêm hai luật trên). Chỉ khi hết `E_LOG_*` mới tính cảnh báo.

## 4. Cảnh báo (không chặn)

| Mã | Khi nào |
|---|---|
| `W_LOG_WRITE_BUDGET` | ước tính ghi eMMC > 2 GiB/ngày (công thức §5) |
| `W_LOG_SIZE_CAP` | ước tính dung lượng cần để giữ đủ thời hạn (thô + tổng hợp) > 2 GiB |
| `W_LOG_WRITE_EXTREME` | **mới**: ước tính ghi > 8 GiB/ngày (4 lần ngân sách). Studio cần xác nhận mạnh hơn khi nạp xuống |
| `W_LOG_TLS_UNVERIFIED` | như 003 |

Cả bốn đều không chặn lưu, nạp xuống hay chạy (Constitution VII). Runtime đưa chúng vào `historian.warnings`.

## 5. Công thức ước tính v2 (TS và C++ cùng hằng số, cùng thứ tự tính)

Giữ `cellBytes`, `rowBytes`, `commitsPerDay` của 003. Thêm:

```text
upper(g)  = 86 400 000 / periodMs            (cyclic; trigger với edge = active)
          = 86 400 000 / minIntervalMs       (onChange; trigger với edge khác)
rowsPerDay(g) = upper(g)                                      (cyclic, hoặc không có expectedRowsPerDay)
              = min(expectedRowsPerDay, upper(g))             (onChange, trigger có expectedRowsPerDay)
basis(g)  = "exact" (cyclic) | "expected" (có expectedRowsPerDay) | "upper"

rawWrite(g)    = 2 × rowsPerDay(g) × rowBytes(g) + min(commitsPerDay, rowsPerDay(g)) × 3 × 4 096
aggTags(g)     = số Tag số/BOOL có aggregate ≠ false     (0 nếu không có aggregates)
aggWrite(g)    = 2 × aggTags(g) × (1 440 + 24) × 64
writeBytesPerDay = Σ_g [ rawWrite(g) + aggWrite(g) ]

rawStorage(g)  = rowsPerDay(g) × rowBytes(g) × retentionDays(g)
aggStorage(g)  = aggTags(g) × (1 440 × minuteRetentionDays + 24 × hourRetentionDays) × 64
storageBytes   = Σ_g [ rawStorage(g) + aggStorage(g) ]

dailyGrowthBytes = Σ_g [ rowsPerDay(g) × rowBytes(g) + aggTags(g) × (1 440 + 24) × 64 ]
daysToFillCap    = floor( 2 GiB / dailyGrowthBytes )         (0 nhóm → null)

W_LOG_WRITE_BUDGET  ⇔ writeBytesPerDay > 2 × 1024³
W_LOG_WRITE_EXTREME ⇔ writeBytesPerDay > 8 × 1024³
W_LOG_SIZE_CAP      ⇔ storageBytes     > 2 × 1024³
```

`aggRowBytes` = 64 là hằng số của ước tính (một hàng `mat_agg` gồm khóa và 7 giá trị); số đo thật ghi ở báo cáo nghiệm thu (SC-025).

Kết quả của `estimateLogging` (TS) và `estimateLogging` (C++) MUST có cùng các trường: `writeBytesPerDay`, `rawWriteBytesPerDay`, `aggWriteBytesPerDay`, `storageBytes`, `dailyGrowthBytes`, `daysToFillCap`, `warnings[]` và `groups[]` (mỗi nhóm: `rowsPerDay`, `basis`, `rowBytes`, `rawWrite`, `aggWrite`, `rawStorage`, `aggStorage`, `aggTags`). Thứ tự phép cộng theo thứ tự nhóm trong file (để hai bản cho cùng số thực).

Ví dụ (tính tay, dùng làm vector):

| Cấu hình | `writeBytesPerDay` | Cảnh báo |
|---|---|---|
| 1 nhóm 200 Tag FLOAT32, `onChange` min 1 s, không `expectedRowsPerDay`, tổng hợp bật | 565.002.240 (≈ 0,526 GiB): thô 527.523.840 (315.187.200 + 212.336.640) + tổng hợp 37.478.400 | không |
| như trên, `expectedRowsPerDay` 20.000 | 322.775.040 (thô 285.296.640 + tổng hợp 37.478.400) | không |
| 4 nhóm × 200 Tag FLOAT32 `cyclic` 1 s, tổng hợp bật | 2.260.008.960 (≈ 2,105 GiB) | `W_LOG_WRITE_BUDGET` |
| 200 Tag FLOAT32 `cyclic` 1 s, `retentionDays` 30, không tổng hợp | ghi 527.523.840; dung lượng 4.727.808.000 (≈ 4,40 GiB) | `W_LOG_SIZE_CAP` |
| 200 Tag FLOAT32 `cyclic` 100 ms, một nhóm | thô 2×864.000×1.824 + 17.280×12.288 = 3.151.872.000 + 212.336.640 = 3.364.208.640 (≈ 3,13 GiB) | `W_LOG_WRITE_BUDGET`, `W_LOG_SIZE_CAP` (retention 7 ngày) |
| 4 nhóm như dòng trước | ≈ 12,5 GiB | `W_LOG_WRITE_BUDGET`, `W_LOG_WRITE_EXTREME`, `W_LOG_SIZE_CAP` |

Cách tính dòng thứ hai: `rowsPerDay` = min(20.000, 86.400) = 20.000; `rawWrite` = 2 × 20.000 × 1.824 = 72.960.000, cộng `min(17.280, 20.000) × 12.288` = 212.336.640, ra 285.296.640. Các số trong bảng là giá trị mong đợi cố định của vector; `generate.mjs` không tính lại bằng công thức mà ghi thẳng các số này, để lỗi công thức ở một bản bị bắt (hai bản được so với số cố định, không chỉ so với nhau).

## 6. Vector mới (`tests/project-vectors/logging-010-*`, dùng chung TS và C++)

`expected.json` có `errors`, `warnings` như 003; thêm `estimate` (các số của §5, so sai lệch tuyệt đối ≤ 1 byte) cho vector ước tính.

| Vector | errors | warnings |
|---|---|---|
| `logging-010-valid-trigger-rising`, `-falling`, `-both`, `-active` | — | — |
| `logging-010-valid-trigger-numeric` (Tag số, `threshold` 50) | — | — |
| `logging-010-valid-hybrid` (`onChange` + `maxIntervalMs`) | — | — |
| `logging-010-valid-aggregates` (đủ trường), `-aggregates-defaults` | — | — |
| `logging-010-valid-aggregate-false` (Tag `aggregate:false`) | — | — |
| `logging-010-valid-expected` | — | — |
| `logging-010-valid-v01-unchanged` (0.1.0 như 003) | — | như 003 |
| `logging-010-invalid-trigger-string` | `E_LOG_TRIGGER` | |
| `logging-010-invalid-trigger-missing` (mode trigger không có `trigger`) | `E_LOG_TRIGGER` | |
| `logging-010-invalid-trigger-on-cyclic` | `E_LOG_TRIGGER` | |
| `logging-010-invalid-trigger-active-no-period` | `E_LOG_TRIGGER` | |
| `logging-010-invalid-trigger-period-with-rising` | `E_LOG_TRIGGER` | |
| `logging-010-invalid-trigger-threshold-bool` | `E_LOG_TRIGGER` | |
| `logging-010-invalid-trigger-max-interval` | `E_LOG_TRIGGER` | |
| `logging-010-invalid-trigger-ref-tag` | `E_LOG_REF_TAG` | |
| `logging-010-invalid-expected-cyclic` | `E_LOG_TRIGGER` | |
| `logging-010-invalid-agg-no-numeric` (toàn Tag chuỗi) | `E_LOG_AGG` | |
| `logging-010-invalid-agg-string-tag` (`aggregate:true` cho chuỗi) | `E_LOG_AGG` | |
| `logging-010-invalid-agg-retention` (giờ < phút) | `E_LOG_AGG` | |
| `logging-010-invalid-v01-new-field` (0.1.0 có `trigger`) | `E_SCHEMA` | |
| `logging-010-invalid-version` (`0.3.0`) | `E_SCHEMA_VERSION` | |
| `logging-010-warn-budget-4x200` | — | `W_LOG_WRITE_BUDGET` |
| `logging-010-warn-extreme` | — | `W_LOG_WRITE_BUDGET`, `W_LOG_WRITE_EXTREME`, `W_LOG_SIZE_CAP` |
| `logging-010-warn-size-cap-agg` (thô ngắn, tổng hợp 365/3650) | — | `W_LOG_SIZE_CAP` |
| `logging-010-estimate-*` (6 vector của §5) | — | theo bảng |

Sau cập nhật, `valid-tank-demo` và các vector 0.1 của 003 giữ nguyên kết luận; `projects/tank-demo` giữ 0.1.0 (kiểm tương thích), `projects/history-demo` (task tạo) dùng 0.2.0.

## 7. Migration (Studio)

`logging.json` 0.1.x → 0.2.0: chỉ đổi `schemaVersion` (mọi trường 0.1 hợp lệ ở 0.2). Studio ghi nhận trong `migration-vectors` (`tests/migration-vectors/logging-0.1-0.2/`). Không có đường lùi 0.2 → 0.1 khi file có trường 0.2 (Studio cảnh báo trước khi lưu ở bản cũ, không tự xóa trường).
