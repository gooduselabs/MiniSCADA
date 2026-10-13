# Contract — `history.db` schema 2: bảng tổng hợp, dấu chạy, phép tính

**Feature**: [spec.md](../spec.md) FR-009…FR-017, FR-058 · **Nền**: [data-model.md của 003](../../003-data-logging/data-model.md) §2 · **ADR**: [031](../../../docs/adr/031-history-aggregates.md)

Phần này chỉ ghi cái **thêm** vào `${dataDir}/history.db`. `log_<table>`, `mat_meta`, `mat_tables`, `mat_forward`, `mat_forward_mark` giữ nguyên. Một writer duy nhất (thread historian); truy vấn dùng kết nối chỉ đọc riêng.

## 1. Bảng mới và cột mới

```sql
-- mat_meta.schema = '2' sau nâng cấp
ALTER TABLE mat_tables ADD COLUMN agg_minute_days INTEGER;   -- NULL = không tổng hợp
ALTER TABLE mat_tables ADD COLUMN agg_hour_days   INTEGER;
ALTER TABLE mat_tables ADD COLUMN agg_built_to    INTEGER;   -- mốc UTC ms: cuối bucket phút cuối đã ghi (mục 4)
ALTER TABLE mat_tables ADD COLUMN agg_back_to     INTEGER;   -- mốc UTC ms: dựng bù đã tới đây (mục 5); NULL = chưa cần

CREATE TABLE IF NOT EXISTS mat_agg_cols (
  cid  INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl  TEXT NOT NULL,                  -- bảng nhóm, không có tiền tố log_
  col  TEXT NOT NULL,                  -- tên cột của Tag
  UNIQUE (tbl, col)
);

CREATE TABLE IF NOT EXISTS mat_agg (
  cid    INTEGER NOT NULL,             -- mat_agg_cols.cid
  res    INTEGER NOT NULL,             -- 60000 (phút) hoặc 3600000 (giờ)
  bucket INTEGER NOT NULL,             -- đầu cửa sổ, UTC ms, bội số của res
  n      INTEGER NOT NULL,             -- số dòng thô khác NULL trong cửa sổ
  min    REAL NOT NULL,
  max    REAL NOT NULL,
  first  REAL NOT NULL,                -- giá trị tín hiệu giữ tại đầu cửa sổ
  last   REAL NOT NULL,                -- giá trị tín hiệu giữ tại cuối cửa sổ
  sumw   REAL NOT NULL,                -- tích phân giá trị x mili giây
  wms    INTEGER NOT NULL,             -- số mili giây có giá trị (<= res)
  PRIMARY KEY (cid, res, bucket)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS mat_runs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  start_ms INTEGER NOT NULL,           -- lúc runtime bắt đầu ghi (đồng hồ hợp lệ)
  alive_ms INTEGER NOT NULL            -- lần sống cuối; cập nhật tối đa mỗi 60 s
);
```

- Cột Tag của nhóm có `aggregate ≠ false` và kiểu số/BOOL nhận một `cid` khi nhóm bật tổng hợp (cấp một lần, không đổi; cột bị bỏ khỏi cấu hình giữ `cid` và dữ liệu tới hết thời hạn).
- BOOL lưu 0/1; số nguyên 64 bit lưu `REAL` (mất chính xác trên 2^53: chấp nhận cho số tổng hợp, ghi trong ADR-031).
- `min`, `max`, `first`, `last` luôn có giá trị (bucket chỉ tồn tại khi biết tín hiệu); bucket mà tín hiệu không biết trong cả cửa sổ không có hàng.
- Kích thước ước tính một hàng `mat_agg`: 64 byte (hằng số của ước tính, contracts/logging-config-0.2.md §5).
- `mat_runs` giữ 3.650 ngày, không quá 1 hàng mỗi lần chạy; hàng mới khi runtime ghi lần đầu của một lần chạy (đồng hồ hợp lệ), `alive_ms` cập nhật tối đa mỗi 60 s và khi dừng gọn.

## 2. Nâng cấp schema 1 → 2

Một giao dịch `BEGIN IMMEDIATE`: `ALTER TABLE ... ADD COLUMN` (không viết lại dữ liệu), tạo bảng mới, `UPDATE mat_meta SET value='2' WHERE key='schema'`. Thất bại thì rollback và runtime chạy tiếp ở chế độ không tổng hợp, báo `historian.lastError`. Không đổi `synchronous` (NORMAL). Mở DB schema 2 bằng runtime 0.8: bỏ qua cột và bảng lạ, chạy bình thường (các bảng `mat_agg*` không được cập nhật trong thời gian đó; được dựng bù khi nâng lại, mục 5).

## 3. Tín hiệu giữ và bộ cộng dồn

Mỗi (nhóm, cột có tổng hợp) có một bộ cộng dồn. Đầu vào: dòng thô (ts UTC ms, giá trị hoặc NULL) **theo thứ tự ghi**, cộng lời gọi `advance(nowUtc)` mỗi lượt lấy mẫu (100 ms), và các sự kiện `break()`.

Trạng thái: `held` (giá trị hoặc không có), `since` (ms mà `held` có hiệu lực từ đó), bộ cộng dồn của cửa sổ phút hiện tại: `n, min, max, first, last, sumw, wms`.

Quy tắc:

1. **Dòng có giá trị v tại t:** `advance(t)` (cộng đoạn giữ cũ tới t, đóng các cửa sổ phút đã qua), rồi `held = v`, `since = t`, `n += 1` cho cửa sổ chứa t, `min/max` gộp v. Nếu `first` của cửa sổ chưa có (không có tín hiệu mang tới) thì `first = v`.
2. **Dòng NULL tại t:** `advance(t)`, rồi `held = không có`.
3. **`advance(t)`:** nếu có `held`: với mỗi cửa sổ phút `[b, b+60000)` giao với `[since, t)`, cộng đoạn giao: `sumw += held × độ dài`, `wms += độ dài`, `min/max` gộp `held` (độ dài > 0), `last = held`; đầu cửa sổ mới mà có `held` thì `first = held` (giá trị mang từ cửa sổ trước). Cửa sổ có `b + 60000 ≤ t` được **đóng**: nếu `wms > 0` hoặc `n > 0` thì thành hàng chờ ghi; rồi mở cửa sổ kế.
4. **`break()`** (gọi khi: runtime khởi động, đồng hồ chưa hợp lệ hoặc nhảy, ghi tạm dừng vì đĩa, historian ở trạng thái `error`, cấu hình nạp lại): `advance(now)` tới thời điểm sự kiện, rồi `held = không có`; cửa sổ dở được đóng và ghi (hoặc bỏ nếu rỗng); sau đó không mang tín hiệu.
5. **Không** có tín hiệu giữ vượt quá `break()`; `first` của cửa sổ đầu sau `break()` là giá trị dòng thô đầu tiên.
6. Cửa sổ giờ được ghép từ cửa sổ phút theo `merge` (mục 6) khi giờ đóng.

Cửa sổ phút được ghi là cửa sổ **đã đóng**: ghi bằng upsert có ghép (mục 6) để một lần khởi động lại giữa phút không tạo bucket trùng:

```sql
INSERT INTO mat_agg (cid,res,bucket,n,min,max,first,last,sumw,wms) VALUES (?,60000,?,?,?,?,?,?,?,?)
ON CONFLICT (cid,res,bucket) DO UPDATE SET
  n = n + excluded.n,
  min = MIN(min, excluded.min), max = MAX(max, excluded.max),
  last = excluded.last,
  sumw = sumw + excluded.sumw, wms = wms + excluded.wms;     -- first giữ nguyên
```

Cửa sổ giờ ghi bằng `INSERT OR REPLACE` (luôn dựng đầy đủ từ mọi cửa sổ phút của giờ, mục 4).

**Giao dịch:** cửa sổ đóng ở lượt lấy mẫu nào nằm trong giao dịch commit cùng dòng thô của lượt đó hoặc sau đó, không bao giờ trước dòng thô nó bao phủ. Giao dịch commit cùng lúc cập nhật `mat_tables.agg_built_to` = đầu của cửa sổ phút mở hiện tại (cuối cửa sổ đã đóng gần nhất) khi có cửa sổ phút mới được ghi. Không thêm lần ghi eMMC riêng cho mốc.

## 4. Khôi phục sau khởi động lại

Với mỗi bảng có tổng hợp: `W = agg_built_to` (NULL → bảng chưa dựng, xử lý ở mục 5).

1. Đọc dòng thô có `ts ≥ W` theo thứ tự `ts`; chạy bộ cộng dồn (không mang tín hiệu từ trước W, vì ranh giới chạy lại là `break()`), đóng mọi cửa sổ phút tới cửa sổ chứa dòng cuối, **kể cả cửa sổ chứa dòng cuối** (đóng tại ts dòng cuối). Ghi bằng upsert ghép; đặt `agg_built_to` = cuối cửa sổ chứa dòng cuối.
2. Dựng bộ cộng dồn giờ của giờ hiện tại từ các hàng `mat_agg` phút của giờ đó (đọc, ghép); khi giờ đóng, ghi bằng `INSERT OR REPLACE`. Giờ đã qua mà chưa có hàng giờ (do mất điện lúc giờ đóng): dựng từ hàng phút và ghi.
3. Bộ cộng dồn bắt đầu với `break()` (mục 3.4): dòng thô đầu tiên của lần chạy mới thành `first`.

Lần chạy mới có thể trùng cửa sổ phút với bucket vừa khôi phục (khởi động lại trong cùng phút): upsert ghép giữ PK duy nhất.

## 5. Dựng bù (nhóm bật tổng hợp mà đã có dữ liệu thô)

`agg_back_to` là mốc UTC ms: mọi dòng thô có `ts ≥ agg_back_to` và `< agg_built_to_at_enable` đã được dựng. Khi nhóm bật tổng hợp lần đầu (hoặc lên schema 2) và có dòng thô:

- đặt `agg_built_to` = đầu cửa sổ phút hiện tại (dòng thô trước đó không được bộ cộng dồn trực tiếp xử lý); `agg_back_to` = cùng giá trị;
- bảo trì (mỗi lượt ≤ 20 ms, như dọn của 003) đọc lùi một lát (≤ 1 giờ dòng thô, bội số giờ) từ `agg_back_to` về trước, chạy bộ cộng dồn, ghi bucket (upsert ghép cho cửa sổ ranh giới), cập nhật `agg_back_to`; dừng khi tới ranh giới thời hạn bucket phút hoặc hết dòng thô;
- **mang tín hiệu qua ranh giới lát:** tín hiệu giữ ở đầu lát được gieo từ dòng thô cuối trước lát nếu giữa dòng đó và lát không có `mat_runs.start_ms` (không có lần chạy mới) và dòng đó không NULL;
- sau khi xong các phút của một giờ thì ghép giờ.

Dòng thô không còn (đã xóa theo thời hạn) thì bucket không dựng được; không lỗi. Tiến độ (`agg_back_to`, số hàng dựng) hiện trong `system/info`.

## 6. Phép ghép và đại lượng suy ra

Ghép `A` (trước) với `B` (sau), cửa sổ liền kề hoặc cách nhau (lỗ):

```text
merge(A, B).n    = A.n + B.n
merge(A, B).min  = min(A.min, B.min)       max tương tự
merge(A, B).first = A.first                (nếu A rỗng thì B.first)
merge(A, B).last  = B.last                 (nếu B rỗng thì A.last)
merge(A, B).sumw = A.sumw + B.sumw
merge(A, B).wms  = A.wms + B.wms
```

Hàng rỗng (không có dữ liệu) là phần tử đơn vị. Đại lượng suy ra (cùng hàm trong TS `packages/history-math` và C++ `core/historian/agg_math.*`, cùng vector):

```text
avg(b)   = b.wms > 0 ? b.sumw / b.wms : b.last          (n = 0 và wms = 0: không có bucket)
sum(b)   = b.sumw / 3 600 000                            (đơn vị × giờ: kW → kWh, BOOL → giờ chạy)
delta(b) = b.last − b.first
coverage(b, độ dài cửa sổ L) = b.wms / L
```

`delta` cộng đúng qua các cửa sổ liền kề khi tín hiệu được mang qua ranh giới: Σ delta = last(cuối) − first(đầu). Không đúng tuyệt đối qua `break()` (khởi động lại, dựng bù khi chạy lại): chênh lệch tối đa bằng thay đổi của Tag trong khoảng gián đoạn; ghi trong tài liệu.

## 7. Thời hạn lưu và trần dung lượng

- Thời hạn bucket phút = `mat_tables.agg_minute_days`, giờ = `agg_hour_days`; dọn cùng lượt với dòng thô (`deleteExpired` mở rộng), từng phần nhỏ: với mỗi `cid`, `DELETE FROM mat_agg WHERE cid=? AND res=? AND bucket < ? LIMIT`-tương-đương (xóa theo PK, tối đa 2.000 hàng mỗi lượt).
- Trần dung lượng: khi `usedBytes()` vượt trần, xóa theo thứ tự (D25): dòng thô cũ nhất (`purgeOldest`, như 003) → khi không còn dòng thô: bucket phút cũ nhất → bucket giờ cũ nhất; mỗi lượt ≤ 20 ms; trạng thái ghi `capRowsDeleted` tách `raw`, `minute`, `hour`.
- Bảng của nhóm đã bỏ khỏi project: bucket giữ tới hết thời hạn cuối cùng đã biết (như dòng thô).

## 8. Bộ vector tổng hợp (`tests/agg-vectors/*.json`, dùng chung TS và C++)

```json
{
  "name": "hold-across-bucket",
  "description": "...",
  "tags": [ { "col": "A", "type": "FLOAT64" } ],
  "events": [
    { "t": 0, "op": "break" },
    { "t": 1000, "op": "row", "values": { "A": 10 } },
    { "t": 70000, "op": "row", "values": { "A": 20 } },
    { "t": 130000, "op": "advance" }
  ],
  "expect": {
    "A": { "60000": [ { "bucket": 0, "n": 1, "min": 10, "max": 10, "first": 10, "last": 10, "sumw": 590000, "wms": 59000 } ] }
  }
}
```

Mỗi vector: dãy sự kiện (`row` kể cả NULL = `null`, `advance`, `break`, `jump` đồng hồ) và danh sách bucket phút, giờ mong đợi; dung sai so số thực 1e-9 tương đối. Ca tối thiểu (SC-002 ≥ 40): dòng đều; dòng thưa; qua nửa đêm UTC; NULL đầu/giữa/cuối cửa sổ; `break` giữa cửa sổ; nhảy lùi, nhảy tiến; cửa sổ chỉ có tín hiệu mang; BOOL bật/tắt; số rất lớn và rất nhỏ; ghép phút → giờ; ghép hai nửa cửa sổ (khởi động lại); dựng bù có gieo tín hiệu và không gieo; `delta` cộng qua 24 giờ. Vector của `merge` và đại lượng suy ra nằm cùng thư mục (`merge-*.json`).
