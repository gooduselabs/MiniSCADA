# Contract: lưu trữ alarm (`alarm.db`)

**Feature**: [spec.md](../spec.md) FR-037…FR-044, FR-053, FR-054 · **Data model**: [data-model.md §3](../data-model.md) · **Động cơ**: [alarm-engine.md](alarm-engine.md) · **Mẫu**: `core/historian/local_store.cpp` (003), `core/audit/audit_log.cpp` (011)

Mã: `core/alarm/alarm_store.{hpp,cpp}` (ghi, dọn, mở, hỏng), `core/alarm/alarm_history.{hpp,cpp}` (kết nối chỉ đọc, truy vấn lịch sử), `core/alarm/alarm_service.{hpp,cpp}` (ghép động cơ, hàng đợi ghi, store). Một file `<dataDir>/alarm.db`, WAL, `synchronous=NORMAL` (D13); độ bền của hành động quan trọng nằm ở `audit.db` FULL, ghi **trước** (FR-029).

## 1. Mở file và PRAGMA

Trình tự `AlarmStore::open()` (cùng hình dạng `LocalStore::open` của 003):

1. `sqlite3_open_v2(READWRITE | CREATE)`, `sqlite3_extended_result_codes(1)`, `sqlite3_busy_timeout(5000)`.
2. PRAGMA (một lần mỗi kết nối): xem khối dưới. `page_size` chỉ có tác dụng với file mới (4 KiB mặc định; không `VACUUM`).
3. Mở không được vì file hỏng (`SQLITE_CORRUPT`, `SQLITE_NOTADB`): bước hỏng (§6).
4. `CREATE TABLE/INDEX IF NOT EXISTS` theo §2 và đọc `alarm_meta.schema`; chạy migration nội bộ nếu thấp hơn ([data-model §3](../data-model.md)).
5. Nếu `alarm_meta.clean` khác `'1'` (hoặc thiếu mà file có dữ liệu): chạy `PRAGMA integrity_check(10)`; kết quả khác một dòng `ok` thì bước hỏng (§6).
6. Ghi `clean = '0'` (một commit) rồi dựng dữ liệu cho `AlarmEngine::load` (§4.1, §4.2).
7. `makePrivate(path)`: đảm bảo `alarm.db`, `-wal`, `-shm` ở `0600` (như `audit_log.cpp`).

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA cache_size=-2048;            -- 2 MiB, FR-037
PRAGMA temp_store=MEMORY;
PRAGMA journal_size_limit=4194304;  -- WAL trở về ≤ 4 MiB sau checkpoint
PRAGMA wal_autocheckpoint=1000;
PRAGMA foreign_keys=OFF;
```

Tắt sạch: xả hàng đợi, ghi `high_water` và `clean = '1'`, `PRAGMA wal_checkpoint(TRUNCATE)`, đóng. `kill -9` hay mất điện để `clean = '0'`, lần mở sau chạy `integrity_check` (ước tính < 1,5 s cho 64 MiB trên eMMC; đo ở task ⚠️🔌).

## 2. Lược đồ SQL (phiên bản 1)

Lược đồ đầy đủ và mô tả cột nằm ở [data-model.md §3](../data-model.md) (nguồn duy nhất; mã chép nguyên văn hằng `kSchemaV1`). Tóm tắt đối tượng:

| Đối tượng | Loại | Mục đích |
|---|---|---|
| `alarm_meta(key PK, value)` | bảng `WITHOUT ROWID` | `schema`, `clean`, `high_water`, `created_ms`, `last_purge_ms` |
| `alarm_occurrence` | bảng, `id INTEGER PRIMARY KEY` | một dòng một lần xảy ra |
| `alarm_occ_ts (ts_active_ms)` | chỉ mục | khoảng thời gian, dọn theo hạn |
| `alarm_occ_alarm_ts (alarm_id, ts_active_ms)` | chỉ mục | lọc theo alarm |
| `alarm_occ_prio_ts (priority, ts_active_ms)` | chỉ mục | lọc theo ưu tiên |
| `alarm_occ_open (alarm_id) WHERE closed = 0` | chỉ mục một phần | dựng lại lần xảy ra mở nhanh; chỉ có ≤ 500 mục |
| `alarm_override (alarm_id, kind) PK` | bảng `WITHOUT ROWID` | shelve, disable bền |

Chỉ mục theo FR-044: ba chỉ mục khoảng thời gian và một chỉ mục một phần cho lần xảy ra mở. Không có chỉ mục trên `class`, `area`, `text_fold`: bộ lọc đó luôn đi kèm khoảng thời gian (mặc định 24 giờ) nên được lọc trên kết quả của chỉ mục thời gian; đo ở SC-013 (100.000 dòng ≤ 1 s x64).

## 3. Mã lần xảy ra

- `id INTEGER PRIMARY KEY` không `AUTOINCREMENT` (tránh một bảng `sqlite_sequence` và một trang ghi thêm mỗi lần chèn); động cơ **cấp mã trong RAM**: `next = max(alarm_meta.high_water, MAX(id)) + 1` lúc khởi động, rồi tăng 1 mỗi lần bật thật (lần "bóng" không cấp).
- Không dùng lại mã: trước khi xóa bất kỳ dòng nào, dọn ghi `high_water` = max(`high_water`, `MAX(id)`) **trong cùng transaction** (§8); tắt sạch cũng ghi `high_water`. Mất điện giữa chừng chỉ làm mất các hàng cuối chưa commit; mã của chúng có thể bị cấp lại sau khởi động, nhưng không ai ngoài RAM đã thấy chúng được "bền" (hàng chưa commit không có trong lịch sử; client cũ giữ `(id, occurrence)` bị `STALE` hoặc `NOT_FOUND` vì cặp gồm cả `alarm_id`, và trạng thái alarm đã được dựng lại).
- Thứ tự sự kiện là thứ tự mã và `revision`, không phải `ts_active_ms` (FR-024).

## 4. Truy vấn

Mọi tham số vào bằng `sqlite3_bind_*` (FR-054); chuỗi SQL chỉ do mã dựng từ các đoạn cố định (không có văn bản người dùng).

### 4.1 Dựng lại lần xảy ra mở (khởi động, sau khi đĩa hồi phục)

```sql
SELECT id, alarm_id, fingerprint, ts_active_ms, clock_ok, ts_ack_ms, ack_user, ts_return_ms,
       ts_return_ack_ms, return_ack_user, priority, class, area, text, value_active,
       quality_active, reason, flags, repeat_count
FROM alarm_occurrence
WHERE closed = 0
ORDER BY id;
```

Dùng chỉ mục một phần `alarm_occ_open` (điều kiện `closed = 0` phải có đúng dạng này để SQLite chọn nó). Kết quả đưa vào `LoadContext.open`.

### 4.2 Override và mã kế tiếp

```sql
SELECT alarm_id, kind, user, reason, system, ts_start_ms, clock_ok, ts_end_ms FROM alarm_override;
SELECT IFNULL(MAX(id), 0) FROM alarm_occurrence;
SELECT value FROM alarm_meta WHERE key = 'high_water';
```

### 4.3 Ghi một hàng (upsert; chỉ cột có thể đổi được cập nhật)

```sql
INSERT INTO alarm_occurrence(id, alarm_id, fingerprint, ts_active_ms, clock_ok, ts_ack_ms, ack_user,
  ts_return_ms, ts_return_ack_ms, return_ack_user, priority, class, area, text, text_fold,
  value_active, quality_active, reason, flags, repeat_count, closed, closed_by)
VALUES(:id, :alarm_id, :fingerprint, :ts_active_ms, :clock_ok, :ts_ack_ms, :ack_user,
  :ts_return_ms, :ts_return_ack_ms, :return_ack_user, :priority, :class, :area, :text, :text_fold,
  :value_active, :quality_active, :reason, :flags, :repeat_count, :closed, :closed_by)
ON CONFLICT(id) DO UPDATE SET
  ts_ack_ms = excluded.ts_ack_ms, ack_user = excluded.ack_user,
  ts_return_ms = excluded.ts_return_ms, ts_return_ack_ms = excluded.ts_return_ack_ms,
  return_ack_user = excluded.return_ack_user, repeat_count = excluded.repeat_count,
  closed = excluded.closed, closed_by = excluded.closed_by;
```

Hàng đợi chứa **bản đầy đủ** của hàng (không phải delta), nên mất một thay đổi trung gian không để lại hàng sai: bản mới nhất thắng.

### 4.4 Lịch sử với bộ lọc và `beforeId`

Dựng động từ các đoạn cố định; chỉ thêm đoạn khi tham số có mặt:

```sql
SELECT id, alarm_id, ts_active_ms, clock_ok, ts_ack_ms, ack_user, ts_return_ms, ts_return_ack_ms,
       return_ack_user, priority, class, area, text, value_active, quality_active, reason, flags,
       repeat_count, closed, closed_by
FROM alarm_occurrence
WHERE ts_active_ms >= :from AND ts_active_ms <= :to
  /* AND alarm_id = :alarm_id */
  /* AND area = :area            (area rỗng: AND area IS NULL) */
  /* AND class = :class */
  /* AND priority <= :priority   (1 = critical; "từ mức này trở lên") */
  /* state: active → AND closed = 0 ; acked → AND ts_ack_ms IS NOT NULL ;
            closed → AND closed = 1 ; all → không thêm */
  /* AND text_fold LIKE '%' || :q || '%' ESCAPE '\'   (:q đã foldText và thoát %, _, \) */
  /* beforeId: AND (ts_active_ms < :before_ts OR (ts_active_ms = :before_ts AND id < :before_id)) */
ORDER BY ts_active_ms DESC, id DESC
LIMIT :limit_plus_one;
```

- `limit_plus_one` = `limit + 1` (1 đến 501): có dòng thứ `limit + 1` thì `nextBeforeId` = `id` của dòng thứ `limit`, ngược lại `null`.
- `beforeId` được đổi thành khóa keyset: `SELECT ts_active_ms FROM alarm_occurrence WHERE id = :before_id` (không dùng OFFSET; `beforeId` không tồn tại thì 400 `BAD_QUERY`). Sắp theo `(ts_active_ms DESC, id DESC)` để dùng chỉ mục thời gian; nếu giờ treo tường nhảy lùi thì thứ tự hiển thị theo giờ, còn mã vẫn cho thứ tự thật (FR-024).
- `q`: `foldText(q)`, rồi thay `\` thành `\\`, `%` thành `\%`, `_` thành `\_`; rỗng sau khi gấp thì bỏ điều kiện; ≤ 80 ký tự trước khi gấp.
- `state` giữ nghĩa: `active` = `closed` 0; `acked` = đã có `ts_ack_ms`; `closed` = `closed` 1.
- Kế hoạch: `EXPLAIN QUERY PLAN` kiểm trong test (`alarm_occ_ts`, `alarm_occ_alarm_ts` hoặc `alarm_occ_prio_ts`); test chặn quét toàn bảng khi có `from`.
- Ngắt truy vấn: `sqlite3_progress_handler` hủy sau 5 s thực; trả 503 (mã chung) và ghi nhật ký; một truy vấn bị hủy không ảnh hưởng ghi hay tick.

### 4.5 Đếm (system/info, giám sát)

```sql
SELECT COUNT(*) FROM alarm_occurrence WHERE closed = 0;        -- chỉ mục một phần
SELECT COUNT(*) FROM alarm_occurrence;                          -- mỗi 60 s, ở luồng ghi
PRAGMA page_count; PRAGMA freelist_count; PRAGMA page_size;     -- kích thước dùng và file
```

### 4.6 Shelve và disable

```sql
INSERT INTO alarm_override(alarm_id, kind, user, reason, system, ts_start_ms, clock_ok, ts_end_ms)
VALUES(:alarm_id, :kind, :user, :reason, :system, :ts_start_ms, :clock_ok, :ts_end_ms)
ON CONFLICT(alarm_id, kind) DO UPDATE SET user = excluded.user, reason = excluded.reason,
  system = excluded.system, ts_start_ms = excluded.ts_start_ms, clock_ok = excluded.clock_ok,
  ts_end_ms = excluded.ts_end_ms;

DELETE FROM alarm_override WHERE alarm_id = :alarm_id AND kind = :kind;      -- unshelve, hết hạn, enable
DELETE FROM alarm_override WHERE kind = 'shelve' AND alarm_id = :alarm_id;   -- instance bị xóa khỏi project
```

`disable` của instance không còn trong project được giữ (áp dụng khi alarm xuất hiện lại).

### 4.7 Xóa theo thời hạn và trần (xem §8)

```sql
DELETE FROM alarm_occurrence WHERE id IN (
  SELECT id FROM alarm_occurrence
  WHERE closed = 1 AND clock_ok = 1 AND ts_active_ms < :cutoff
  ORDER BY id LIMIT :batch);

DELETE FROM alarm_occurrence WHERE id IN (
  SELECT id FROM alarm_occurrence WHERE closed = 1 ORDER BY id LIMIT :batch);
```

## 5. Ghi gom

Luồng riêng `alarm-writer` (không bao giờ là luồng tick, FR-039). Động cơ không biết SQLite; `alarm_service` chuyển `AlarmEvent` thành thay đổi và đẩy vào `WriteQueue`.

**Hàng đợi (`WriteQueue`):**

- `rows: map<occurrenceId, Row>`: bản đầy đủ mới nhất; chèn hay cập nhật cùng một khóa thì bản sau thay bản trước (gộp trong bộ đệm). Khóa sắp theo `id` tăng.
- `overrides: vector<OverrideChange>` theo thứ tự đến (`Upsert`, `Delete`); `meta: map<key, value>`.
- Khóa ngắn `mutex`; động cơ chỉ giữ khóa lúc đẩy (một vài cấu trúc nhỏ); luồng ghi **hoán đổi** toàn bộ hàng đợi ra bản riêng rồi mới ghi, nên động cơ không bao giờ chờ SQLite.

**Chu kỳ ghi:** luồng ghi thức dậy khi (a) đủ `alarmCommitMs` (2.000) kể từ thay đổi đầu tiên chưa ghi, hoặc (b) đủ `alarmCommitRows` (200) thay đổi (hàng và override), hoặc (c) yêu cầu xả (tắt, kết thúc test). Mỗi lần: `BEGIN IMMEDIATE`, upsert theo `id` tăng, override, meta, `COMMIT`. Không ghi nhiều lần trong một giây trừ trường hợp (b).

**Bộ đệm tối đa 5.000** (`alarmBufferMax`): đếm số hàng và thay đổi override đang chờ. Vượt: bỏ các hàng **đã đóng** (`closed = 1`) có `id` nhỏ nhất trước (đó là thay đổi lịch sử cũ nhất), tăng `droppedChanges`; hàng đang mở và mọi thay đổi override, meta **không** bị bỏ (≤ 500 + vài chục). Nếu vẫn vượt mà chỉ còn hàng mở: vượt tạm, vì số hàng mở bị chặn ≤ 500 bởi giới hạn instance.

**Thất bại tạm thời (`SQLITE_BUSY`, `IOERR`, `FULL`):** giữ nguyên hàng đợi (không mất), thử lại sau 10 s (như `history.db`), `logState = error` sau 3 lần liên tiếp; tự về `running` khi một lần ghi thành công. Quyết định commit chỉ xóa hàng khỏi hàng đợi **sau** `COMMIT` thành công.

**Thứ tự với audit:** hàng của một xác nhận được đẩy vào hàng đợi chỉ **sau** khi API đã ghi `alarm.ack` vào `audit.db` và động cơ đã áp dụng lệnh; do đó `alarm.db` không bao giờ chứa `ts_ack_ms` mà `audit.db` thiếu (SC-008). Ngược lại (audit có, `alarm.db` thiếu) là hướng an toàn: trạng thái dựng lại ở `ACTIVE_UNACK`.

**Audit hệ thống:** `alarm.shelve` (chập chờn), `alarm.unshelve` (hết hạn), `alarm.purged`: luồng ghi gọi `AuditLog::append` sau `COMMIT` tương ứng; lỗi audit chỉ ghi nhật ký, không chặn ghi lịch sử.

## 6. Hỏng, đĩa đầy, lỗi

**File hỏng** (mở không được, `integrity_check` lỗi, hoặc `SQLITE_CORRUPT`/`SQLITE_NOTADB` lúc đang ghi):

1. đóng kết nối;
2. đổi tên **`-wal`, `-shm` trước, file chính sau** thành `alarm.db.corrupt-<epoch>` (hậu tố `-n` nếu trùng trong cùng giây), như `LocalStore::renameAndRecreate`; lỗi đổi tên thì dừng, không mở lại file hỏng như file mới;
3. tạo file mới (§1 bước 2, 4) và hàng đợi nhận lại **toàn bộ hàng đang mở của động cơ** (`resyncOpen`: `alarm_service` yêu cầu `AlarmView` và đẩy bản đầy đủ), nên trạng thái đang có không mất; lịch sử đã đóng của file hỏng nằm ở file đổi tên;
4. ghi audit `alarm.purged` (`reason: corrupt`, `renamedTo`, `code: DB_CORRUPT`), `system/info.alarms` đặt cờ `recoveredAt`;
5. chạy tiếp. Khởi động với file hỏng: không có hàng mở để dựng lại, các alarm hiện được đánh giá lại từ điều kiện (US6 kịch bản 5).

Không dùng `.recover` hay sửa tại chỗ. Số file `alarm.db.corrupt-*` giữ tối đa 3 (xóa cũ nhất lúc tạo mới) để không ăn đĩa; ghi trong audit.

**Đĩa gần đầy:** trước mỗi `COMMIT` luồng ghi gọi `statvfs(dataDir)`; `free < minFreeBytes` (dùng chung với `history.db`):

- `logState = paused`; luồng ghi **không** ghi thay đổi lịch sử; hàng đợi tiếp tục nhận và gộp tới 5.000 (xử lý vượt như §5); override và meta vẫn được thử ghi (rất nhỏ);
- động cơ, hàng đợi live, trang vẫn chạy bình thường (FR-043); xác nhận vẫn được (audit có ngoại lệ riêng của nó); `system/info` có `logState`;
- tiếp tục khi `free ≥ minFreeBytes × 1,1` (đệm 10 %); lúc tiếp tục luồng ghi yêu cầu `resyncOpen` để hàng mở trong RAM đè lên bản cũ trong file.

**`SQLITE_FULL` bất ngờ** (đĩa đầy giữa transaction): `ROLLBACK`, coi như lỗi tạm (thử lại 10 s); không bao giờ đóng runtime vì lỗi ghi alarm.

**Hỏng bằng `schemaTooNew`** (file do runtime mới hơn tạo): `logState = error`, không mở, không đổi tên; động cơ chạy trong RAM (FR-043).

## 7. Tìm chữ không phân biệt hoa thường và dấu tiếng Việt

**Giải pháp:** cột `text_fold` được tính **lúc chèn** bằng `foldText(text + ' ' + alarm_id + ' ' + tên khu vực)`; truy vấn so `text_fold LIKE '%' || :qfold || '%' ESCAPE '\'` với `:qfold = foldText(q)` (rồi thoát `%`, `_`, `\`). Lý do chọn cột đã gấp thay vì hàm SQL tự đăng ký hoặc FTS5: (a) mã hàm SQL chạy trên mỗi dòng của tập lọc (100.000 dòng) tốn CPU thiết bị; (b) FTS5 và ICU tăng cỡ nhị phân, thêm bảng và ghi, không cần cho tìm chuỗi con ngắn; (c) cột có thể tính ở hai nơi bằng một hàm chung có vector.

**Hàm gấp `foldText(utf8) → utf8`** (`core/alarm/alarm_text.cpp` và `packages/alarm-engine/src/text.ts`, dùng chung hai bản **và** cho bộ lọc phía client của trang Alarm, widget `alarm-list`, Studio):

1. giải mã UTF-8 (chuỗi không hợp lệ: ký tự thay thế U+FFFD; không ném);
2. bỏ mọi dấu kết hợp U+0300 đến U+036F (xử lý dạng NFD: `a` + U+0301 thành `a`; sừng U+031B của `ơ`, `ư` nằm trong khoảng này);
3. với mỗi điểm mã (dạng NFC) trong bảng dưới: thay bằng chữ Latin cơ sở **thường**; `đ`, `Đ` thành `d`;
4. chữ Latin cơ bản `A-Z` thành `a-z`; mọi ký tự khác giữ nguyên;
5. không gộp khoảng trắng, không cắt (người gọi lo).

| Gấp thành | Điểm mã (cả hoa và thường) |
|---|---|
| `a` | `à á ả ã ạ ă ằ ắ ẳ ẵ ặ â ầ ấ ẩ ẫ ậ` và `À Á Ả Ã Ạ Ă Ằ Ắ Ẳ Ẵ Ặ Â Ầ Ấ Ẩ Ẫ Ậ` |
| `e` | `è é ẻ ẽ ẹ ê ề ế ể ễ ệ` và `È É Ẻ Ẽ Ẹ Ê Ề Ế Ể Ễ Ệ` |
| `i` | `ì í ỉ ĩ ị` và `Ì Í Ỉ Ĩ Ị` |
| `o` | `ò ó ỏ õ ọ ô ồ ố ổ ỗ ộ ơ ờ ớ ở ỡ ợ` và `Ò Ó Ỏ Õ Ọ Ô Ồ Ố Ổ Ỗ Ộ Ơ Ờ Ớ Ở Ỡ Ợ` |
| `u` | `ù ú ủ ũ ụ ư ừ ứ ử ữ ự` và `Ù Ú Ủ Ũ Ụ Ư Ừ Ứ Ử Ữ Ự` |
| `y` | `ỳ ý ỷ ỹ ỵ` và `Ỳ Ý Ỷ Ỹ Ỵ` |
| `d` | `đ Đ` |

Bảng nằm trong mã dưới dạng mảng `(điểm mã, ký tự gấp)` sắp theo điểm mã, tra nhị phân; nguồn chung là `tests/alarm-vectors/fold-table.json` (liệt kê cả 134 cặp) và test chạy mỗi bản qua toàn bảng. Vector `text-fold-vietnamese`, `text-fold-combining` kiểm các ví dụ: `"Bồn B1 QUÁ ÁP"` gấp thành `"bon b1 qua ap"`; `"ơ"` dạng NFC và dạng `o` + U+031B cùng gấp thành `o`.

**Hệ quả:** tìm `bon` thấy `Bồn`; tìm `BỒN` thấy `bồn`; tìm `ap` thấy `áp` (chuỗi con: có thể thấy `ấp`, `áp`, `ập`; chấp nhận như hành vi không dấu của mọi bộ tìm kiếm tiếng Việt). Nếu lỗi bảng gấp được sửa ở phiên bản sau, `schema` tăng và migration tính lại `text_fold` theo mẻ (không có ở phiên bản 1).

## 8. Bảo trì: thời hạn và trần

Luồng ghi chạy mỗi `alarmPurgeIntervalS` (3.600 s) **và** khi kích thước dùng vượt trần:

1. **Thời hạn** (chỉ khi `clockOk` hiện tại): `cutoff = nowEpoch − alarmRetentionDays × 86.400.000`. Lặp: `BEGIN IMMEDIATE`; cập nhật `high_water` (câu dưới); `DELETE` mẻ ≤ `alarmPurgeBatch` (1.000) hàng đã đóng có `clock_ok = 1` và `ts_active_ms < cutoff` (§4.7); `COMMIT`; ngủ 50 ms giữa các mẻ để không giãn khung live quá 250 ms (SC-010); dừng khi không còn hàng hoặc sau 100 mẻ.
2. **Trần** (`alarmMaxBytes`): kích thước dùng `(page_count − freelist_count) × page_size`; vượt trần thì lặp mẻ xóa hàng đã đóng cũ nhất theo `id` (§4.7, câu thứ hai) cho tới khi ≤ 95 % trần hoặc không còn hàng đóng. File không co lại (không `VACUUM`) nhưng trang rảnh được tái dùng nên kích thước file ≤ trần + 5 % (SC-010); `PRAGMA incremental_vacuum` không dùng (`auto_vacuum` = NONE).
3. Ghi **một** dòng audit `alarm.purged` cho cả lượt (tổng hàng, lý do `retention` hoặc `size`) nếu có xóa.
4. Không bao giờ xóa hàng `closed = 0` (cả hai câu xóa lọc `closed = 1`).
5. Cập nhật `alarm_meta.last_purge_ms`.

```sql
INSERT INTO alarm_meta(key, value)
VALUES('high_water', CAST((SELECT IFNULL(MAX(id), 0) FROM alarm_occurrence) AS TEXT))
ON CONFLICT(key) DO UPDATE SET value =
  CASE WHEN CAST(excluded.value AS INTEGER) > CAST(value AS INTEGER) THEN excluded.value ELSE value END;
```

Đồng hồ không hợp lệ: bước 1 bị bỏ qua hoàn toàn (như `audit.db`); bước 2 vẫn chạy (theo kích thước).

## 9. Kết nối chỉ đọc riêng

`AlarmHistoryReader` (như `HistoryReader` của 003): kết nối thứ hai, `SQLITE_OPEN_READONLY`, `busy_timeout 2000`, `PRAGMA query_only=ON`, `cache_size=-1024`; một mutex trong chính reader (HTTP có thể gọi từ nhiều luồng); không chặn luồng ghi (WAL cho phép đọc song song) và không bao giờ chạm luồng tick. Khi store đổi tên file hỏng, `generation` tăng và reader mở lại lúc truy vấn kế tiếp. `integrityCheck(maxLines)` có sẵn để test và công cụ (`tools/alarm-it.ps1 -Scenario killloop` gọi sau mỗi lần `kill -9`).

## 10. Ước tính kích thước dòng và ghi eMMC

**Kích thước một dòng** (đầu vào: tên alarm 20 ký tự, nội dung 60 ký tự tiếng Việt ≈ 75 byte UTF-8, `text_fold` ≈ 90 byte vì có thêm id và khu vực):

| Thành phần | Byte (ước tính) |
|---|---|
| cột số, cờ, `quality_active`, `closed` (13 cột) | ≈ 70 |
| `alarm_id` + `fingerprint` (16) | ≈ 36 |
| `ack_user`, `return_ack_user` (nếu có), `class`, `area`, `reason` | ≈ 35 |
| `text` + `text_fold` | ≈ 165 |
| tiêu đề bản ghi và rowid | ≈ 15 |
| **dòng bảng** | **≈ 320** |
| ba chỉ mục thời gian (13 + 30 + 13 byte mục) | ≈ 56 |
| hệ số lấp đầy trang (≈ 70 %) | × 1,4 |
| **tổng trên đĩa mỗi dòng** | **≈ 530** |

100.000 lần xảy ra ≈ 53 MB; trần 64 MiB ≈ 126.000 dòng. Tải chuẩn (20 lần xảy ra/giờ, 480/ngày) giữ 180 ngày ≈ 86.000 dòng ≈ 46 MB: trong trần. Tải bão sau tự cách ly: vài nghìn dòng mỗi ngày.

**Ghi eMMC** (đo thật ở SC-009 bằng `/proc/<pid>/io`; đây là ước tính thiết kế):

| Hoạt động | Khung WAL (4.120 byte) |
|---|---|
| chèn một hàng (1 trang bảng + 3 chỉ mục thời gian + 1 chỉ mục mở) | ≈ 5 |
| xác nhận (cập nhật hàng; không đổi cột có chỉ mục) | ≈ 1 |
| hết (cập nhật hàng) | ≈ 1 |
| xác nhận hết, đóng (hàng + chỉ mục mở) | ≈ 2 |
| **một lần xảy ra đủ vòng đời, mỗi bước một commit riêng** | **≈ 9 khung ≈ 37 KB** |

- Tải chuẩn, 480 lần xảy ra/ngày, mỗi bước một commit (bi quan, vì các bước cách nhau hàng chục giây): 480 × 37 KB ≈ **18 MB WAL** cộng checkpoint (trang riêng biệt ghi một lần mỗi ~1.000 khung, ≈ 4 đến 5 MB) ≈ **22 MB/ngày**; nếu nhiều bước trùng một commit 2 s thì còn khoảng 12 đến 15 MB/ngày. Cả hai nằm trong mức ≤ 25 MB/ngày đã nới của SC-009 và rất xa trần 2 GB/ngày (≈ 1 %). Giảm được ít: bỏ `alarm_occ_prio_ts` (−1 khung chèn) hay tăng `alarmCommitMs` không đủ vì các bước thưa.
- Tải bão: 200 alarm bật rồi tắt cùng nhịp, `chatterLimit` 5: mỗi đợt ≈ 1.000 hàng ≈ 0,5 MB dữ liệu thô ≈ 2 đến 5 MB ghi thật (khuếch đại trang, hai lần ghi WAL và checkpoint); với phương án tự cách ly ngắn hơn đã xét ban đầu (≈ 130 đợt/ngày) ước **250 đến 650 MB/ngày**, không đạt 0,1 GB/ngày nếu cả 200 alarm chập chờn liên tục; D43 chọn tự cách ly 30 phút (≈ 48 đợt/ngày), cộng cửa sổ commit thích ứng `alarmCommitMs` → `alarmCommitMaxMs` (FR-039) và hai chỉ mục phụ có thể bỏ (FR-044) để đạt SC-009 (≤ 0,1 GB/ngày). Xem Điểm cần sửa spec (đã xử lý).

Số trên phải được đo ở task ⚠️🔌 và `tools/alarm-it.ps1 -Scenario budget` (x64: đếm byte ghi của tiến trình).

## Điểm cần sửa spec

1. **FR-042/SC-009 (tải chuẩn):** Đã xử lý trong spec (SC-009: tải chuẩn ≤ 25 MB/ngày; FR-039 cửa sổ commit thích ứng; FR-044 hai chỉ mục phụ có thể bỏ).
2. **FR-035/SC-009 (tải bão):** Đã xử lý trong spec (D43, FR-035: tự cách ly 30 phút; bão ≤ 0,1 GB/ngày; FR-039).
3. **FR-038 thiếu cột** `fingerprint`, `text_fold`, `repeat_count`, `closed`: Đã xử lý trong spec (FR-038).
4. **FR-044 nói "chỉ mục một phần cho lần xảy ra mở"** nhưng không nói khóa; tài liệu chọn `(alarm_id) WHERE closed = 0`.
5. **FR-053 sắp xếp "mới nhất trước":** theo `(ts_active_ms, id)` để dùng chỉ mục; khi đồng hồ nhảy lùi thứ tự hiển thị có thể lệch thứ tự mã (FR-024 chỉ ràng buộc thứ tự sự kiện, không ràng buộc thứ tự bảng lịch sử).
6. **Tìm chữ (FR-054, SC-013):** `q` khớp thêm cả `alarm_id` và tên khu vực (đã gộp vào `text_fold`), rộng hơn "tìm trong nội dung" của US4 kịch bản 2; cần xác nhận hoặc bỏ khỏi `text_fold`.
