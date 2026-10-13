# tests/agg-vectors

Vector tổng hợp dùng chung TS (`packages/history-math`) và C++ (`core/historian`, feature 010). Luật: [specs/010-history-reports/contracts/history-db.md](../../specs/010-history-reports/contracts/history-db.md) §3, §6.

Sinh bằng `node tests/agg-vectors/generate.mjs` (kết quả được commit; test chỉ đọc). `merge-*` và `derive-*` là số tính tay; `agg-*` có `expect` sinh bằng bản tham chiếu độc lập `tools/history-ref` (không dùng mã sản phẩm), mười lăm ca có `note` còn được kiểm với số tính tay ngay lúc sinh.

## Bucket

Đối tượng JSON `{ "n", "min", "max", "first", "last", "sumw", "wms" }` (số). Trong `agg-*` có thêm `"bucket"` (đầu cửa sổ, UTC ms). **`null` là bucket rỗng**: phần tử đơn vị của `merge`; C++ dựng `AggBucket{}` (`n = 0` và `wms = 0`).

So sánh: `n`, `wms`, `bucket` là số nguyên (so bằng); `min`, `max`, `first`, `last`, `sumw` so với dung sai **1e-9 tương đối** (`|a - b| <= 1e-9 * max(1, |b|)`).

## `merge-*.json`

```json
{ "name": "...", "description": "...", "kind": "merge", "inputs": [bucket|null, ...], "expect": bucket|null }
```

Gấp từ trái: `acc = merge(acc, inputs[i])` (`merge(A, B)`: A trước, B sau; `first` của A, `last` của B; `null` bị bỏ qua). Kết quả `null` khi mọi đầu vào rỗng.

## `derive-*.json`

```json
{ "name": "...", "description": "...", "kind": "derive", "fn": "avg|sum|delta|coverage", "bucket": bucket|null,
  "windowMs": 3600000, "expect": number|null }
```

`windowMs` chỉ có với `coverage`. `bucket: null` (bucket rỗng): `avg`, `sum`, `delta` trả `null` (C++: `std::optional` rỗng); `coverage` trả 0.

## `agg-*.json`

```json
{ "name": "...", "description": "...", "note": "...",
  "tags": [ { "col": "A", "type": "FLOAT64" } ],
  "events": [ { "t": 0, "op": "break" }, { "t": 1000, "op": "row", "values": { "A": 10 } },
              { "t": 130000, "op": "advance" } ],
  "expect": { "A": { "60000": [ { "bucket": 0, "n": 1, ... } ], "3600000": [ ... ] } } }
```

Sự kiện (theo thứ tự thời gian; `t` là UTC ms; không có hai `row` cùng `t` trong một cột):

| `op` | Ý nghĩa |
|---|---|
| `row` | dòng thô: `advance(t)` rồi ghi `values[col]` (số hoặc `null`; BOOL là 0/1). Cột không có trong `values` không bị tác động |
| `advance` | `advance(t)` mọi cột (đóng cửa sổ phút đã qua) |
| `break` | `break(t)`: `advance(t)`, đóng và ghi cửa sổ phút dở (bỏ nếu rỗng), bỏ tín hiệu giữ |
| `jump` | đồng hồ nhảy: như `break(t)` tại `t`; các sự kiện sau dùng đồng hồ mới (`to` chỉ để đọc, bằng `t` của sự kiện kế) |

`expect[col]["60000"]` và `["3600000"]` là các hàng `mat_agg` mà bộ cộng dồn ĐÃ GHI sau khi chạy hết `events` (sắp tăng theo `bucket`):

- **Hàng phút:** cửa sổ phút đã đóng, tức `bucket + 60000 <=` thời điểm một sự kiện nào đó, hoặc bị `break`/`jump` đóng. Cửa sổ rỗng (`n = 0` và `wms = 0`) không có hàng. Cửa sổ ghi lần thứ hai (sau `break` hoặc `jump` lùi) được ghép bằng upsert của history-db.md §3: `n`, `sumw`, `wms` cộng; `min`, `max` cực trị; `last` của lần sau; **`first` giữ của lần đầu**. Sau `jump` lùi `wms` có thể lớn hơn độ dài cửa sổ.
- **Hàng giờ:** có khi tồn tại sự kiện có `t >=` cuối giờ; nội dung là `merge` của mọi hàng phút của giờ theo thứ tự `bucket`. Giờ không có hàng phút thì không có hàng. Vector có `jump` không có hàng giờ.
- **Quy ước `first`:** nếu ngay trước đầu cửa sổ tín hiệu còn được giữ (kể cả khi dòng mới đến đúng đầu cửa sổ, kể cả khi dòng đó là `NULL`) thì `first` là giá trị giữ đó; ngược lại `first` là giá trị tại thời điểm đầu tiên có tín hiệu trong cửa sổ. Nhờ đó tổng `delta` các cửa sổ liền kề (cùng một lần chạy) bằng `last` cuối trừ `first` đầu. `min`, `max` chỉ gộp đoạn giữ có độ dài dương trong cửa sổ và các dòng khác `NULL` của cửa sổ, nên `first` mang vào có thể nằm ngoài `[min, max]`.
- **`last`:** giá trị tín hiệu ở thời điểm cuối cùng có tín hiệu trong cửa sổ (dòng đến đúng lúc `break` cũng đặt `last`).
- **`n`:** số dòng khác `NULL` có `t` trong cửa sổ (`NULL` không đếm). `wms`: tổng độ dài đoạn giữ trong cửa sổ.

Ca ranh giới đáng chú ý nếu bản C++ cách hiểu khác: `boundary-null-then-row`, `row-at-boundary-with-carry`, `zero-wms`, `jump-back`, `jump-forward`. Báo bằng `specs/010-history-reports/handoff-notes.md` thay vì tự sửa vector; phía TS sẽ chỉnh luật hoặc vector.
