# Contract — WebSocket PoC `/api/v1/live`

> **Đã thay thế** từ Sprint 1 bằng protocol 1.0.0: [specs/002-vertical-slice/contracts/live-ws.md](../../002-vertical-slice/contracts/live-ws.md) (ADR-006). Bản dưới đây chỉ còn đúng cho `mat-poc` (`server/poc`, load-tester `-proto 0`).

Rút gọn từ Master Plan §10.4. Chỉ áp dụng cho PoC Sprint 0 (không auth).

## Kết nối
- `GET /api/v1/live` nâng cấp lên WebSocket. Tối đa 10 phiên đang hoạt động.
- Phiên thứ 11: server gửi `{"type":"error","code":"MAX_CLIENTS_REACHED","message":"..."}` rồi đóng với **close code 4429**.

## Bản tin (JSON, UTF-8)
| Chiều | `type` | Nội dung |
|---|---|---|
| S→C | `hello` | `{serverVersion, maxClients, tagCount}` |
| C→S | `subscribe` | `{requestId, tags: "all" \| string[], mode: "delta"}` |
| S→C | `snapshot` | `{subscriptionId, sequence, tags:[{id,value,quality}]}` |
| S→C | `delta` | `{subscriptionId, sequence, tags:[[index,value,quality]]}` gom mỗi 250 ms |
| S↔C | `heartbeat` | Server gửi `{ts}` mỗi 5 s; **client phải gửi lại** (bất kỳ bản tin nào cũng giữ phiên). Server không nhận gì từ client > 15 s → đóng với **close code 4408** và giải phóng slot |
| S→C | `resync_required` | gửi khi hàng đợi client > 256 KB, rồi đóng. **PoC Sprint 0 chưa cài** (ghi đồng bộ, không có hàng đợi); làm ở Sprint 1, xem ADR-001 |
| S→C | `error` | `{code, message}` |

## Quy tắc
- `sequence` tăng dần theo subscription; client thấy bước nhảy phải xin snapshot mới. PoC bỏ qua `subscribe` lần 2 trên cùng kết nối, nên client trang thử đóng kết nối (mã 4000) rồi kết nối lại để nhận snapshot mới. Delta tới trước snapshot bị bỏ qua.
- Client coi server mất khi không nhận được gì > 15 s (đóng mã 4001, kết nối lại) và hiển thị mọi Tag là `STALE` (giữ giá trị cuối) trong lúc mất kết nối.
- Mã đóng: 4429 = đủ 10 client (client **không** thử lại); 4408 = hết thời gian heartbeat (client kết nối lại); 4000/4001 = client tự đóng để resync/khi server im lặng.
- `quality` ∈ `GOOD|BAD|UNCERTAIN|STALE`.
- Tag giả lập: 500 Tag tên `SIM.T0001`…`SIM.T0500`; mỗi giây đổi giá trị ngẫu nhiên có kiểm soát.

## HTTP tĩnh
- `GET /` và `/screens/*.svg`: file nén sẵn (`.gz`), `ETag`, `Cache-Control`.
- `GET /api/v1/system/info`: `{version, clients, maxClients, rejectedTotal, uptimeS}`.
