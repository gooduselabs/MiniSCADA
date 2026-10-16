# tests/downsample-vectors

Vector giảm điểm dùng chung TS (`packages/history-math/src/reduce.ts`) và C++ (`core/historian/query/downsample.*`), feature 010. Luật gốc: [contracts/history-api.md](../../specs/010-history-reports/contracts/history-api.md) §3.2; các chỗ hợp đồng chưa chốt được chốt ở đây (bản tham chiếu `tools/history-ref/downsample.mjs`). Sinh bằng `node tests/downsample-vectors/generate.mjs`; ca có số tính tay được kiểm ngay lúc sinh (`hand-*`).

Tên file `<kind>-<tên>.json`, `kind` ∈ `minmax`, `lttb`, `decimate`, `merge`. Thời gian là UTC ms, số nguyên. So sánh: `t` bằng nhau tuyệt đối; giá trị với dung sai 1e-9 tương đối; số phần tử bằng nhau.

## Đầu vào và `expect`

| `kind` | Đầu vào | `expect` |
|---|---|---|
| `minmax`, `decimate` | `from`, `to`, `maxPoints`, `rows`: `[[t, v], ...]` tăng theo `t`, trong `[from, to)`, `v` là số hoặc `null` | `{ "t": [...], "v": [...] }` (`v[i]` số hoặc `null`) |
| `lttb` | `maxPoints` (ngưỡng), `points`: `[[t, v], ...]` (không có `null`) | `{ "t", "v" }` |
| `merge` | `from`, `to`, `res` (60000 hoặc 3600000), `maxPoints`, `buckets`: `[{ bucket, n, min, max, first, last, sumw, wms }, ...]` (chỉ hàng có dữ liệu, tăng theo `bucket`) | `{ "t", "v", "min", "max" }` |

## Luật

**`minmax`** (thô):

- Số dòng `<= maxPoints`: trả nguyên.
- Ngược lại `W = floor((maxPoints - 2) / 2)` cửa sổ; dòng `t` thuộc cửa sổ `floor((t - from) * W / (to - from))` (số nguyên chính xác). Mỗi cửa sổ giữ dòng nhỏ nhất, dòng lớn nhất (dòng **đầu tiên** nếu bằng nhau; trùng một dòng thì một điểm) và dòng `NULL` đầu tiên của cửa sổ. Thêm dòng đầu và dòng cuối của khoảng. Kết quả theo thứ tự dòng.
- Nếu vẫn `> maxPoints` (do điểm null): bỏ điểm null từ cửa sổ cuối lùi về đầu cho tới khi đủ; dòng đầu/cuối của khoảng không bị bỏ.

**`decimate`**: `maxPoints` cửa sổ, biên `from + floor(k * (to - from) / maxPoints)`; mỗi cửa sổ lấy dòng đầu tiên có `t >=` đầu cửa sổ, nếu `t <` cuối cửa sổ (dòng đó có thể là `NULL`, thành điểm `null`). Cửa sổ không có dòng thì bỏ.

**`lttb`**: LTTB chuẩn (Steinarsson 2013; `every = (n - 2) / (threshold - 2)`, ô trung bình dùng `floor`, diện tích tam giác, dòng có diện tích lớn nhất đầu tiên thắng); `threshold >= n` trả nguyên. Chuỗi có đoạn `NULL` (mỗi đoạn một lần LTTB, mỗi đoạn tối thiểu 2 điểm, giữ điểm null ở ranh giới) cài theo history-api.md §3.2; **chưa có vector**.

**`merge`** (nguồn tổng hợp): `s0 = floor(from / res)`, `s1 = floor((to - 1) / res)`, số ô `S = s1 - s0 + 1`. `S <= maxPoints`: mỗi hàng một điểm tại `bucket`. Ngược lại nhóm `g = ceil(S / maxPoints)` ô liền kề (nhóm `j` gồm ô `s0 + j*g … s0 + (j+1)*g - 1`), ghép các hàng của nhóm bằng `merge` (history-db.md §6, hàng thiếu bỏ qua), điểm tại đầu nhóm `(s0 + j*g) * res` (có thể sớm hơn `from` khi `from` không thẳng hàng); `v = avg` (`sumw / wms`, `last` khi `wms = 0`), `min`, `max` của hàng ghép. Nhóm không có hàng không sinh điểm.
