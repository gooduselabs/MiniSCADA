# Contract — bốn widget lịch sử và `HistorySource`

**Feature**: [spec.md](../spec.md) FR-032…FR-039, FR-044, FR-045, FR-053 · **Nền**: [widget-catalog.md của 007](../../007-screens-widgets/contracts/widget-catalog.md), [ui-components-api.md](../../007-screens-widgets/contracts/ui-components-api.md) · **ADR**: [032](../../../docs/adr/032-history-query-api.md)

`schemas/widgets.catalog.json` lên `catalogVersion` `0.5.0` (`0.4.0` là của widget alarm, feature 009; thêm 4 widget, một loại thuộc tính và hai cờ khe; 15 widget cũ không đổi). Danh mục vẫn là nguồn duy nhất cho validator TS (`packages/project-schema`), validator C++ (`core/project-manager/widget_catalog.*`), inspector và Toolbox của Studio, `<mat-screen>`. Sau khi sửa phải chạy lại `tests/widget-catalog-vectors`.

## 1. Thêm vào danh mục

| Mới | Ý nghĩa |
|---|---|
| nhóm `history` | nhóm Toolbox "Lịch sử" |
| `kind: "logGroup"` | thuộc tính là id nhóm lưu trữ trong `logging.json` (Studio hiện danh sách nhóm; validator tra) |
| cờ khe `inGroup: "<tên thuộc tính>"` | Tag của khe phải thuộc nhóm đặt ở thuộc tính đó (`E_WIDGET_HISTORY_TAG`) |
| cờ khe `needsAggregate: true` | Tag phải có tổng hợp trong nhóm (`E_WIDGET_HISTORY_AGG`) |

Khe của widget lịch sử **không** là khe Tag sống: widget không đăng ký live cho Tag của nó (không gọi `TagSource`), chỉ hỏi `HistorySource`. Do đó widget lịch sử không tính vào giới hạn đăng ký live của màn hình.

## 2. Bốn widget

| `id` | Cỡ (mặc định / tối thiểu) | Khe | Thuộc tính |
|---|---|---|---|
| `history-trend` | 640×320 / 280×160 | `series` bắt buộc, `multi`, `max` 8, `inGroup: group`: number, bool | `group` (logGroup, bắt buộc); `range` (enum `1h`, `8h`, `24h`, `7d`, `30d`, `today`, `yesterday`; `24h`); `follow` (bool, true); `controls` (bool, true: hiện chọn khoảng); `legend` (true); `grid` (true); `showBand` (true: vùng min–max khi nguồn tổng hợp); `step` (enum `auto`, `on`, `off`; `auto` = bậc thang cho nhóm `onChange`/`trigger`); `labels` (mảng ≤ 8 chuỗi ≤ 40); `axes` (mảng ≤ 8 của `left` \| `right`; `left`); `yMin`, `yMax` (số; cả hai vắng = tự co; một trong hai là `E_WIDGET_PROP`) |
| `history-table` | 640×320 / 280×160 | `columns` bắt buộc, `multi`, `max` 32, `inGroup: group`: number, bool, string | `group` (bắt buộc); `range` (như trên; `24h`); `pageSize` (int 10–500; 100); `order` (`asc` \| `desc`; `desc`); `controls` (true); `labels` (≤ 32) |
| `history-bar` | 480×280 / 200×140 | `series` bắt buộc, `multi`, `max` 4, `inGroup: group`, `needsAggregate`: number, bool | `group` (bắt buộc); `fn` (`sum`, `avg`, `min`, `max`, `first`, `last`, `delta`, `count`; `delta`); `bucket` (`hour`, `shift`, `day`; `shift`); `period` (`last24h`, `last7d`, `last30d`, `today`, `yesterday`, `thisShift`, `lastShift`, `thisMonth`, `lastMonth`; `last7d`); `shiftCount` (2, 3, 4, 6, 8, 12; 3); `shiftStart` (`HH:MM`; `06:00`); `decimals` (0–6; 1); `showValues` (true); `labels` (≤ 4); `refreshSec` (int 30–3600; 60) |
| `history-pie` | 320×320 / 140×140 | `series` bắt buộc, `multi`, `max` 8, `inGroup: group`, `needsAggregate`: number, bool | `group` (bắt buộc); `fn` (`sum`, `delta`, `avg`; `delta`); `period` (như `history-bar`; `today`); `shiftCount`, `shiftStart` (như trên); `donut` (true); `decimals` (0–6; 1); `showPercent` (true); `showTotal` (false); `labels` (≤ 8); `refreshSec` (30–3600; 60) |

Không có sự kiện hay hành động ghi (`events: []`); nút Xuất CSV của `history-table` và chọn khoảng của `history-trend` là điều khiển nội bộ, không ghi Tag.

### 2.1 Số hạng mục của `history-bar` (validator `E_WIDGET_PROP`)

Số cột (hạng mục theo `bucket` trong `period`) phải ≤ 48; `bucket` và `period` hợp lệ:

| `bucket` | `period` được phép | Số hạng mục |
|---|---|---|
| `hour` | `last24h`, `today`, `yesterday` | ≤ 24 |
| `shift` | `last24h`, `last7d`, `today`, `yesterday`, `thisShift`, `lastShift` (`shiftCount` hạng mục/ngày; `last7d` 7 ngày) | ≤ `shiftCount × 7` ≤ 84: vượt 48 là lỗi (ví dụ 12 ca × 7 ngày) |
| `day` | `last7d`, `last30d`, `thisMonth`, `lastMonth` | ≤ 31 |

Kết hợp ngoài bảng: `E_WIDGET_PROP`. `thisShift`, `lastShift` cho `history-bar` chỉ với `bucket: shift`; với `history-pie` hợp lệ mọi lúc.

### 2.2 Quy tắc thời gian của kỳ (`history-math`)

`periodRange(period, now, tz, shiftCount, shiftStart)` trả `[from, to)` làm tròn xuống phút theo giờ địa phương `tz` của nhóm: `last24h` = `[now − 24 h, now)`, `last7d`, `last30d` tương tự; `today` = `[nửa đêm địa phương, now)`; `yesterday` = ngày trước đó đủ 24 giờ; `thisMonth`, `lastMonth` theo lịch; `thisShift` = ca chứa `now` (cùng cách tính ca với báo cáo, templates-config.md §4), `lastShift` = ca ngay trước. `history-bar` gọi `aggregate` một lần với `bucketMs` theo `bucket` (3.600.000, độ dài ca, 86.400.000) và `offsetMs` tương ứng; `history-pie` gọi một lần với `bucketMs = to − from` làm tròn lên bội số 60.000 và `offsetMs = from mod bucketMs`, rồi lấy cửa sổ duy nhất. Hàm tính (`fn`) dùng `history-math` như báo cáo, nên bar, pie và báo cáo cùng kỳ cho cùng số (SC-015).

## 3. Kiểm tra (hai validator, cùng mã)

| Mã | Khi nào | Vị trí |
|---|---|---|
| `E_WIDGET_HISTORY_GROUP` | `group` không có trong `logging.json` (hoặc project không có `loggingFile`) | `/items/i/props/group` |
| `E_WIDGET_HISTORY_TAG` | Tag ở khe có `inGroup` không thuộc nhóm | `/items/i/slots/<tên>/j` |
| `E_WIDGET_HISTORY_AGG` | khe có `needsAggregate` mà nhóm không bật `aggregates` hoặc Tag `aggregate:false` hay kiểu chuỗi | như trên |
| `E_WIDGET_PROP` | giá trị thuộc tính ngoài ràng buộc (mã đã có của 007), gồm tổ hợp `bucket`/`period` ngoài bảng §2.1 và `yMin`/`yMax` lẻ | `/items/i/props/<tên>` |
| `E_WIDGET_SLOT_TYPE`, `E_WIDGET_SLOT_MISSING` | như 007 | |

Tag của `history-table` kiểu chuỗi hợp lệ; của `history-trend` kiểu chuỗi là `E_WIDGET_SLOT_TYPE` (khe chỉ number, bool). Bộ vector `tests/widget-catalog-vectors/history-*.json` (≥ 30 ca: mỗi widget hợp lệ và mỗi mã lỗi) dùng chung hai bản (SC-021).

## 4. `HistorySource` (nơi chứa cấp, widget không gọi mạng)

```ts
// packages/ui-components/src/host/history-source.ts (giao diện); thực thi ở apps/runtime-web, apps/studio
export interface HistorySource {
  readonly state: 'ready' | 'login-required' | 'busy' | 'disabled' | 'error';
  onState(cb: (s: HistorySource['state']) => void): () => void;
  catalog(signal?: AbortSignal): Promise<HistoryCatalog>;            // lưu đệm, làm mới khi 'disabled' → 'ready'
  series(q: SeriesQuery, signal: AbortSignal): Promise<SeriesResult>;
  aggregate(q: AggregateQuery, signal: AbortSignal): Promise<AggregateResult>;
  rows(q: RowsQuery, signal: AbortSignal): Promise<RowsResult>;
  exportUrl(q: ExportQuery): string;                                  // URL cùng nguồn gốc, không dựng chuỗi SQL
}
```

- `apps/runtime-web/src/history-source.ts` (`HttpHistorySource`): gọi `fetch` tới `/api/v1/history/*` bằng cookie phiên; **một hàng đợi dùng chung của trang**, tối đa 2 yêu cầu bay đồng thời, ưu tiên yêu cầu người dùng vừa thao tác; `AbortController` cho mỗi yêu cầu; 429 `BUSY` → hàng đợi nghỉ theo `Retry-After` và thử lại với khoảng chờ 1 → 2 → 4 → 8 s tối đa 30 s cộng ngẫu nhiên ±25 %; 401 → `state = login-required`; HTTP (không phải HTTPS) → `login-required` kèm hướng dẫn mở HTTPS; 404 `NO_HISTORY` → `disabled`; 503 → `error` có thử lại; bộ nhớ đệm các khoảng `series` đã tải (≤ 32 mục, khóa theo nhóm, Tag, khoảng làm tròn, `maxPoints`, `res`, hết hạn 30 s với khoảng chạm "bây giờ").
- `apps/studio/src/...` : `SimHistorySource` (dữ liệu từ `@mat/tag-sim`, tất định, không mạng) cho xem trước mô phỏng; `DeviceHistorySource` (token Bearer qua lớp Tauri của 005, cùng hàng đợi) cho xem trước với thiết bị.
- Widget chỉ biết `HistorySource`; kiểm thử widget dùng `FakeHistorySource` (trong `packages/ui-components/src/testing`).

## 5. Hành vi biểu đồ (`history-trend`)

- Dùng uPlot 1.6.32 (ADR-020, tải lười), dữ liệu mỗi đường là `Float64Array` do widget dựng từ `series`; `null` và `gaps` thành khoảng đứt (`spanGaps: false` cộng điểm `NaN` chèn tại khoảng); vùng min–max (`showBand`) bằng `bands` của uPlot khi `min`, `max` có mặt.
- **Tương tác:** kéo chọn vùng = phóng (X); cuộn chuột = phóng/thu quanh con trỏ (±25 % mỗi nấc); Shift+kéo hoặc kéo nút giữa = dịch; bấm đúp = về khoảng ban đầu (`range`); con trỏ hiện thời điểm theo giờ địa phương và giá trị mỗi đường (và `min`/`max` của bucket khi nguồn tổng hợp); chú giải bật/tắt đường; bàn phím: mũi tên trái/phải dịch con trỏ một điểm, `Shift`+mũi tên dịch cả khung, `+`/`-` phóng/thu, `Home` về gốc.
- **Gọi API:** khoảng đổi → sau 250 ms hủy yêu cầu cũ, gọi `series` với `maxPoints = min(2000, 2 × bề rộng vùng vẽ px)`; khi chờ dữ liệu mới giữ hình cũ với chỉ báo "đang cập nhật" (không xóa trắng); khoảng đã nằm trong bộ nhớ đệm đủ mịn thì không gọi.
- **Theo dõi (`follow`):** khi khoảng kết thúc ở "bây giờ" (các `range` tương đối và `today`) làm mới mỗi 10 s bằng cách hỏi lại khoảng mới và nối; ngừng khi người dùng phóng/dịch ra khỏi "bây giờ"; nút "Theo dõi" bật lại.
- Trục thời gian theo `timeZone` của nhóm (không theo múi giờ trình duyệt): uPlot nhận hàm định dạng trục từ `history-math` (không `Date` cục bộ).
- Trạng thái (FR-035): lớp phủ chữ ở giữa widget, có `role="status"`; nút đăng nhập mở `/login` của 007 rồi quay lại.
