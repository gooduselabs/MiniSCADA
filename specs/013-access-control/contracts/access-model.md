# Hợp đồng: mô hình quyền và kho trên thiết bị (feature 013)

Nguồn: [spec](../spec.md) FR-010 đến FR-037, [kế hoạch](../../../docs/plans/screen-grid-layout.md) mục 10, D16 đến D26. Áp dụng cho runtime C++ (`core/auth/`, `server/`) và cho mã TypeScript tính "ai thấy, ai thao tác được" trên trang Quản trị (`packages/access-model`). Hai bản tính phải cho cùng kết quả trên vector chung `tests/access-vectors/`.

## 1. Nơi lưu

| Tệp | Chủ, quyền | Ai ghi | Nội dung |
|---|---|---|---|
| `/var/lib/mat-runtime/auth/users.json` | `matscada:matscada` 0600 | runtime (API quản trị) và CLI (root, ghi xong chown về matscada) | tài khoản, schemaVersion `1.1.0` |
| `/var/lib/mat-runtime/auth/access.json` | như trên | runtime và CLI | nhóm và quy tắc, schemaVersion `1.0.0` |
| `/etc/mat-runtime/users.json` | `root:matscada` 0640 (như cũ) | CLI cũ | **chỉ là nguồn khởi tạo**: khi `auth/users.json` chưa có, runtime và CLI chép nó sang (một lần, audit `account.migrate`), từ đó không đọc nữa |

- Thư mục `auth/` 0700. Đọc từ chối tệp là liên kết, không phải tệp thường, hoặc nhóm/người khác ghi được (giữ luật của `readUsersFile`).
- **Ghi:** khóa `flock` loại trừ trên chính thư mục `auth/` (cả runtime và CLI; luồng B, 2026-10-19: khóa thư mục thay cho tệp `auth/.lock`, để root và matscada mở được mà không phải đổi chủ một tệp khóa), đọc lại, kiểm `rev`, ghi tệp tạm cùng thư mục, fsync, rename, fsync thư mục; giữ bản trước là `<tệp>.bak` (một bản, tạo bằng hard link trước khi rename, nên người đọc không bao giờ thấy tệp bị thiếu).
- Mỗi tệp có `rev` (số nguyên tăng mỗi lần ghi). Mọi yêu cầu sửa của API mang `rev` đã đọc; khác thì `409 CONFLICT`.
- Runtime đọc lại khi tệp đổi (như `AccountStore::refresh`, tối đa 2 s/lần) để CLI sửa cũng có hiệu lực.
- **Hỏng** (JSON sai, sai schemaVersion, vượt giới hạn): runtime ghi log và audit `access.store-invalid`, coi như **mọi quy tắc từ chối** trừ `administrator` (FR-036); trang Quản trị hiện lỗi và nút **Khôi phục bản trước** (`.bak`). `users.json` hỏng giữ hành vi cũ (không ai đăng nhập được, CLI phục hồi).

### 1.1. `users.json` 1.1.0

```json
{
  "schemaVersion": "1.1.0",
  "rev": 12,
  "users": [
    { "name": "vh1", "role": "operator", "enabled": true, "groups": ["ca-a"],
      "passwordHash": "$argon2id$...", "rev": 3, "unlockSeq": 0,
      "createdAt": "2026-10-20T03:00:00Z", "updatedAt": "2026-10-20T03:00:00Z", "lastLoginAt": 1792410000000 }
  ]
}
```

- Thêm `rev` của tệp (thiếu = 0), `groups` (mảng id nhóm, thiếu = rỗng, tối đa 16), `lastLoginAt` (ms UTC, tùy chọn; runtime cập nhật **không quá 1 lần/giờ/người** để giữ ngân sách ghi eMMC). Tệp 1.0.0 đọc được (thiếu trường mới); lần ghi đầu nâng lên 1.1.0.
- Lệch so với bản nháp (luồng B, 2026-10-19): giữ khóa `users` và `createdAt`/`updatedAt` dạng ISO 8601 của 1.0.0 (tệp 1.0.0 đọc nguyên trạng, CLI cũ và `--user-list` không đổi); API quản trị trả hai trường này dạng ms. Ghi `lastLoginAt` **không** tăng `rev` của tệp (không làm 409 một chỉnh sửa đang dở của admin) và không tăng `rev` của tài khoản (phiên không bị hủy).
- Đổi `groups` của một tài khoản tăng `rev` của tài khoản (phiên bị hủy, D23). Khởi tạo từ `/etc` giữ nguyên `rev` từng tài khoản (phiên đang mở không bị hủy), `rev` của tệp = 1.
- Giới hạn: 200 tài khoản (nới từ 64), tệp ≤ 512 KiB.

### 1.2. `access.json` 1.0.0

```json
{
  "schemaVersion": "1.0.0",
  "rev": 7,
  "groups": [ { "id": "ca-a", "name": "Vận hành ca A" } ],
  "rules": [
    { "resource": "screen:bao-tri", "level": "view", "grantees": ["group:bao-tri", "role:engineer"] },
    { "resource": "item:tong-quan/chay-bom", "level": "operate", "grantees": ["group:quan-doc"] }
  ]
}
```

- `groups[].id`: `^[a-z][a-z0-9-]{1,31}$`, duy nhất; `name` 1 đến 64 ký tự, không ký tự điều khiển. Tối đa 50 nhóm.
- `rules[]`: tối đa 5.000; cặp (`resource`, `level`) duy nhất; `grantees` 0 đến 64 phần tử, không trùng. `grantees: []` nghĩa là **không ai** (ngoài administrator). `resource` phải đúng cú pháp một loại của §2 (`page:admin` bị từ chối); `group:` phải là nhóm trong tệp. Tệp ≤ 2 MiB, quyền 0600 (nhóm và người khác không đọc, không ghi), không phải liên kết.
- Người nhận: `group:<id>` (nhóm phải tồn tại), `user:<name>` (tài khoản phải tồn tại), `role:<viewer|operator|engineer|administrator>` (khớp người có **đúng hoặc cao hơn** vai trò đó), `*` (mọi người đã đăng nhập).
- Xóa nhóm hoặc người dùng gỡ người nhận tương ứng khỏi mọi quy tắc (cùng một lần ghi, audit).

## 2. Tài nguyên

Suy từ project đang chạy (không lưu trong kho):

| Mã | Từ đâu | Mức | Tag mà nó cấp (tập Tag được phép) |
|---|---|---|---|
| `screen:<id>` | mọi màn hình và popup | `view` | không trực tiếp (qua item) |
| `item:<screen>/<item>` | mọi item của màn hình | `view`; `operate` nếu widget thuộc nhóm `control` của danh mục widget hoặc item có sự kiện ghi (SVG) | Tag trong binding của item (đọc và ghi) |
| `page:alarms`, `page:history`, `page:reports`, `page:watch` | trang hệ thống (luôn có) | `view` | không |
| `history:<groupId>` | nhóm lưu trữ của project | `view` | Tag của nhóm, **chỉ cho truy vấn lịch sử** |
| `report:<id>` | mẫu báo cáo | `view` | Tag của mẫu, **chỉ cho truy vấn lịch sử** |
| `page:admin` | trang Quản trị | — | chỉ administrator, không có quy tắc |

Quy tắc trỏ tới tài nguyên không có trong project đang chạy là **mồ côi**: bỏ qua khi tính, liệt kê ở `GET /api/v1/admin/access`.

## 3. Mặc định từ project (khi không có quy tắc)

- Màn hình: `screen.security.view` (vai trò tối thiểu), thiếu = `viewer`.
- Item: `item.security.view`, thiếu = `viewer`; `item.security.operate`, thiếu = `item.security.minRole` (cũ), thiếu nữa = `operator`.
- Trang hệ thống, nhóm lưu trữ, mẫu báo cáo: `viewer`; riêng `page:watch` = `operator` (như hiện nay).

## 4. Tính quyền hiệu lực

Chủ thể `P = {user?, role, groups}`; phiên ẩn danh (chỉ khi `viewerLogin: off`) là `{user: none, role: viewer, groups: []}`.

```
match(P, g)   = g == "*"              → P.user có
              | g == "user:" + n       → P.user == n
              | g == "group:" + id     → id ∈ P.groups
              | g == "role:" + r       → rank(P.role) ≥ rank(r)
floor(level)  = viewer cho view, operator cho operate
allowed(P, res, level) =
    P.role == administrator                                → true
  | rank(P.role) < rank(floor(level))                      → false
  | rank(P.role) < rank(projectDefault(res, level))        → false     (quyền không vượt mặc định vai trò của project)
  | có quy tắc (res, level)                                → ∃ g ∈ grantees: match(P, g)
  | không có quy tắc                                       → true
```

Thêm điều kiện cha:

- `item:S/I` `view` cần `screen:S` `view`.
- `item:S/I` `operate` cần `item:S/I` `view` và item thao tác được (bảng mục 2).
- Popup mở từ màn hình: tự nó là `screen:<id>`.

**Tập Tag được phép** của `P`:

- `live(P)` = hợp các Tag của mọi `item` được `view`.
- `history(P)` = `live(P)` ∪ Tag của `history:*` và `report:*` được `view` (cần thêm `page:history` hoặc `page:reports` tương ứng được `view`).
- `alarm(P)` = alarm có Tag nguồn thuộc `live(P)` (D21); trang Alarm cần `page:alarms`. Alarm **không có Tag nguồn** (chất lượng của thiết bị) thuộc `alarm(P)` khi `P` xem được `page:alarms` (quyết định của luồng B, 2026-10-19). Administrator: mọi thứ.
- Tag của **bảng theo dõi** (watch tables của project) thuộc `live(P)` khi `P` xem được `page:watch` (trang Bảng theo dõi đăng ký chúng); không thuộc danh mục của vector §7.
- Kho hỏng: mọi tài nguyên từ chối mọi người trừ administrator (kể cả khi không có quy tắc).

Bộ tính phải là hàm thuần (`computeAccess(project, store, P) → EffectiveAccess`), tính trước khi đăng nhập, khi nạp project, khi `rev` của kho đổi, giữ trong phiên; tra cứu bằng bảng băm (SC-006).

## 5. `EffectiveAccess` (JSON, cùng hình ở C++ và TS, trả bởi `GET /api/v1/web/access`)

```json
{
  "user": "vh1", "role": "operator", "groups": ["ca-a"], "anonymous": false,
  "storeRev": 7, "usersRev": 12, "projectHash": "sha256:…",
  "screens": ["tong-quan", "bom-1"],
  "hiddenItems": { "tong-quan": ["chi-phi"] },
  "lockedItems": { "tong-quan": ["chay-bom"] },
  "pages": ["alarms", "history", "reports"],
  "admin": false
}
```

- `screens`: màn hình và popup được xem (thứ tự theo project). `hiddenItems`: item **không** được xem trên màn hình được xem. `lockedItems`: item thao tác được về loại nhưng không có `operate`.
- Không chứa danh sách Tag (không cần ở trang; máy chủ tự lọc).

## 6. Hủy phiên (D23, FR-014)

Sửa vai trò, nhóm, trạng thái, mật khẩu, xóa tài khoản → hủy mọi phiên của người đó (`SessionStore::removeUser`, audit `auth.session-revoked`). Sửa quy tắc hoặc nhóm (tên) → **không** hủy phiên; mọi phiên tính lại quyền ở lần gọi kế tiếp (so `storeRev`), live hub gỡ đăng ký Tag không còn được phép trong 2 s và gửi `{"type":"access-changed"}` để trang tải lại quyền.

## 7. Vector chung `tests/access-vectors/`

Bộ tính làm việc trên **danh mục tài nguyên** trừu tượng (`ResourceCatalog`), không trên project thô; mỗi bản cài đặt có một hàm riêng dựng danh mục từ project đã nạp (C++: từ `LoadedProject`; TS: từ tài liệu project của `@mat/project-schema`).

```json
{
  "screens": [
    { "id": "tong-quan", "popup": false, "view": "viewer",
      "items": [ { "id": "chay-bom", "operable": true, "view": "viewer", "operate": "operator", "tags": ["PUMP01.RUN_CMD"] } ] }
  ],
  "historyGroups": [ { "id": "ap-suat", "tags": ["P1"] } ],
  "reports": [ { "id": "dien-ngay", "tags": ["E1"] } ],
  "alarms": [ { "id": "a1", "tag": "P1" } ]
}
```

`view`/`operate` ở danh mục đã là mặc định project sau khi áp mục 3. Mỗi ca là một thư mục `tests/access-vectors/<tên>/` gồm `catalog.json`, `access.json` (§1.2, `rev` tùy ý), `principal.json` (`{"user":"vh1"|null,"role":"operator","groups":["ca-a"]}`; ẩn danh là `user: null`), `expected.json`:

```json
{ "screens": [...], "hiddenItems": {...}, "lockedItems": {...}, "pages": [...], "admin": false,
  "liveTags": [...], "historyTags": [...], "alarms": [...], "orphans": [{"resource","level"}] }
```

Mảng sắp xếp theo thứ tự chuỗi (trừ `screens` theo thứ tự danh mục); khóa của `hiddenItems`/`lockedItems` chỉ có khi danh sách khác rỗng. Bộ sinh `tests/access-vectors/generate.mjs` (Node, không phụ thuộc gói) ghi các ca; bộ chạy TS (Vitest) và C++ (gtest `access_vectors_test`) đọc cùng thư mục. Tối thiểu 40 ca: mặc định, mọi loại người nhận, nhiều nhóm, vai trò sàn, mặc định project cao hơn quy tắc, cha màn hình, item không thao tác được, quy tắc rỗng, mồ côi, ẩn danh, administrator, popup, nhóm lưu trữ, mẫu báo cáo, Tag dùng ở cả trang được và bị cấm.
