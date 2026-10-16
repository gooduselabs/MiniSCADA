# Data model — 010 Lưu trữ nâng cao, truy vấn lịch sử, báo cáo

Cấu hình: [contracts/logging-config-0.2.md](contracts/logging-config-0.2.md), [contracts/templates-config.md](contracts/templates-config.md). Dữ liệu trên thiết bị: [contracts/history-db.md](contracts/history-db.md). API: [contracts/history-api.md](contracts/history-api.md). Widget: [contracts/widget-catalog-010.md](contracts/widget-catalog-010.md). Thiết bị: [contracts/device-010.md](contracts/device-010.md). Studio: [contracts/studio-010.md](contracts/studio-010.md). Nền: [data-model của 003](../003-data-logging/data-model.md).

## 1. Cấu hình trong project

| Thực thể | Nguồn | Thêm so với trước |
|---|---|---|
| LoggingGroup | `logging.json` 0.2.0 | `mode` thêm `trigger`; `trigger{tagId, edge, threshold}`; `expectedRowsPerDay`; `aggregates{minuteRetentionDays, hourRetentionDays}` |
| LoggedTag | `logging.json` | `aggregate` (bool) |
| ReportTemplate | `reports.json` 0.1.0 (mới, khai báo `reportsFile`) | `id, name, group, period, rowMinutes?, shifts?, title, footer, paper, totals, columns[]` |
| ReportColumn | `reports.json` | `tagId, label, unit, decimals, functions[]` |
| NavigationItem | `project.json` | biến thể `{label, report, group, icon}` bên cạnh `{label, screen, …}` |
| WidgetInstance | màn hình 0.x | loại `history-trend`, `history-table`, `history-bar`, `history-pie` (danh mục 0.5.0) |

Quan hệ: `ReportTemplate.group` → LoggingGroup (phải có `aggregates`); `ReportColumn.tagId` ∈ LoggedTag của nhóm với `aggregate ≠ false` và kiểu số/BOOL; `WidgetInstance.props.group` → LoggingGroup; khe Tag → LoggedTag của nhóm; `NavigationItem.report` → ReportTemplate.

## 2. Trên thiết bị (`history.db` schema 2)

Bảng, cột, khóa, giao dịch, khôi phục: [history-db.md](contracts/history-db.md). Tóm tắt:

| Bảng | Vai trò | Ghi |
|---|---|---|
| `log_<table>` | dòng thô (003, không đổi) | historian |
| `mat_tables` (+4 cột) | thời hạn dòng thô, tổng hợp, mốc | historian |
| `mat_agg_cols` | `cid` ↔ (bảng, cột) | historian |
| `mat_agg` | bucket phút (`res` 60000) và giờ (`res` 3600000) | historian |
| `mat_runs` | các lần chạy: `start_ms`, `alive_ms` | historian (≤ 1 lần/phút) |

Kích thước hàng `mat_agg` ước tính 64 byte; thời hạn bucket phút mặc định 31 ngày, giờ 730 ngày.

## 3. Trạng thái trong bộ nhớ (runtime)

### 3.1 Sampler `trigger` (`GroupSampler`)

```text
unknown ──(Tag GOOD)──► inactive / active          (không tạo cạnh khi mới bắt đầu)
inactive ──(Tag bật)──► active      : rising → ghi (nếu edge ∈ rising|both|active)
active   ──(Tag tắt)──► inactive    : falling → ghi (nếu edge ∈ falling|both|active)
bất kỳ   ──(quality xấu)──► unknown : không ghi, không cạnh
active (edge = active): cứ mỗi periodMs kể từ lần ghi trước (đơn điệu) → ghi
```

Khoảng `minIntervalMs`: cạnh đến sớm được hoãn tới hết khoảng (một dòng mang giá trị mới nhất, trạng thái cạnh gần nhất); các cạnh xen giữa không tạo thêm dòng. Hai cờ kiểm: `lastRowMono`, `pendingEdge`.

### 3.2 Bộ cộng dồn tổng hợp (`Aggregator`, một cho mỗi cột có tổng hợp)

```text
held: giá trị | không có            since: ms UTC
cur : AggBucket (cửa sổ phút hiện tại)     hour: AggBucket (cửa sổ giờ hiện tại, ghép từ phút)
pending: danh sách (cid, res, bucket, AggBucket) chờ commit
Sự kiện: row(ts, v|null) · advance(now) · break(now) · clockJump(now)
```

`AggBucket` = `{n, min, max, first, last, sumw, wms}` (rỗng khi `wms = 0` và `n = 0`). Quy tắc: [history-db.md](contracts/history-db.md) §3.

### 3.3 Giới hạn tải truy vấn (`QueryLimiter`)

`inFlight` (≤ `historyMaxConcurrent`), `exportInFlight` (≤ 1), tập phiên đang chạy (≤ 1 mỗi phiên). `tryAcquire(session, kind)` trả `ok` hoặc `busy`; nhả trong destructor (RAII). Bộ đếm `served`, `rejectedBusy`, `rejectedLimit`, `timeouts`, `errors`; vòng 256 thời gian cho p95.

### 3.4 Đo ghi eMMC (`IoMeter`)

Vòng 1.440 ô `write_bytes` (mẫu mỗi 60 s từ `/proc/self/io`; có thêm một vòng như thế cho bộ đếm VFS SQLite, ADR-039); `writeBytes1h` = 60 ô gần nhất; `writeBytes24h`; `coverageS`. Không có ô khi không đọc được (`unavailable`).

### 3.5 Trạng thái lịch sử phía trình duyệt (`HistorySource.state`)

```text
ready ──401 hoặc HTTP──► login-required ──(đăng nhập)──► ready
ready ──429 BUSY──► busy (tự thử lại, lùi 1→2→4→8…30 s ±25 %) ──► ready
ready ──404 NO_HISTORY──► disabled ──(catalog.enabled)──► ready
ready ──503/mạng──► error ──(thử lại)──► ready
```

## 4. Mô hình dữ liệu phía trình duyệt (`packages/history-math`, `packages/ui-components`)

```ts
type AggBucket = { n: number; min: number; max: number; first: number; last: number; sumw: number; wms: number };
type SeriesResult = { group: string; res: 'raw'|'1m'|'1h'; reduce: string; approximate: boolean;
  gaps: [number, number][]; coverage: { from: number; to: number } | null;
  series: { tagId: string; t: number[]; v: (number|null)[]; min?: (number|null)[]; max?: (number|null)[] }[] };
type AggregateResult = { start: number; count: number; bucketMs: number;
  series: { tagId: string; n: number[]; min: (number|null)[]; /* … first, last, sumw, wms, avg, sum */ }[] };
type ReportTable = { title: string; periodLabel: string; columns: { key: string; label: string; unit: string; decimals: number }[];
  rows: { label: string; cells: (number|null)[]; coverage: number; pending: boolean }[]; totals: (number|null)[] | null;
  coverage: number; generatedAt: number; tz: string };
```

Hàm thuần (đều có vector): `merge`, `avg`, `sum`, `delta`, `periodRange`, `buildReport`, `formatLocal`, `formatNumber`, `reduceMinMax`, `reduceLttb` (chỉ để xem trước khớp), `chooseSource`.

## 5. Studio (mô hình tài liệu)

- `LoggingDoc` (nhóm, Tag, kết nối) trong `project-doc`; truy vấn dẫn xuất: `estimate` (kết quả `estimateLogging`), `warnings`, `confirmedEstimateHash` (chỉ trong phiên, ghi vào nhật ký thao tác, không vào project).
- `ReportsDoc` (mẫu, cột) và nguồn xem trước (`sim` | `device`).
- Chế độ hiển thị của nhóm: `Chu kỳ` (`cyclic`), `Thay đổi` (`onChange`, không `maxIntervalMs`), `Kết hợp` (`onChange` có `maxIntervalMs`), `Kích hoạt` (`trigger`).

## 6. Bất biến

- Mỗi `(cid, res, bucket)` có tối đa một hàng; hàng giờ bằng ghép các hàng phút của giờ đó (kiểm bằng `--verify-aggregates`).
- Một dòng thô ảnh hưởng đúng một lần tới bucket phút (mốc `agg_built_to` + giao dịch chung).
- `Σ delta` qua các bucket liền kề trong một lần chạy = `last(cuối) − first(đầu)` (không qua `break`).
- Mọi thời gian trên dây là epoch ms UTC; hiển thị theo `timeZone` của nhóm.
- Không chuỗi nào của client xuất hiện trong câu lệnh SQL; tên bảng/cột lấy từ cấu hình đã kiểm.
- Cache SQLite tổng ≤ 32 MiB; ≤ 3 kết nối đọc; ≤ 2 truy vấn và 1 xuất CSV đồng thời.
