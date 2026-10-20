# Hợp đồng: API quản trị và các thay đổi API của trang (device-api 1.6.0, feature 013)

Nguồn: [spec](../spec.md), [mô hình quyền](access-model.md). `system/info` và `diagnostics` báo `"api":"1.6.0"`. Mọi đường dưới đây **chỉ HTTPS**, nằm trong bảng `core/auth/roles.cpp`, cho cookie (`cookieAllowed`) và Bearer; yêu cầu thay đổi cần `Origin` khớp và `X-MAT-CSRF` khi đi bằng cookie (luật `AuthGate` có sẵn). Thân JSON ≤ 64 KiB (`413`), JSON sai hoặc sai kiểu `400 BAD_REQUEST` trước khi xử lý.

Lỗi theo dạng có sẵn: `{"error":"<MÃ>","message":"…"}`. `WEAK_PASSWORD` kèm `reason` một trong `TOO_SHORT`, `TOO_LONG`, `CONTAINS_NAME`, `COMMON` (`checkNewPassword` không kiểm mật khẩu phổ biến; mật khẩu không phải UTF-8 được báo `COMMON`, gần nhất trong bốn mã). `GET /api/v1/system/info` có `web.viewerLogin` (`"off"|"required"`), cả ở bản rút gọn khi chưa đăng nhập. Mã mới: `CONFLICT` (409, `rev` lệch), `LAST_ADMIN` (409), `IN_USE` (409, kèm `usedBy`), `REAUTH_REQUIRED` (403, thiếu hoặc sai `reauth`), `WEAK_PASSWORD` (400, kèm `reason`), `NOT_FOUND` (404), `EXISTS` (409), `RATE_LIMITED` (429), `ACCESS_DENIED` (403, thiếu quyền tài nguyên), `STORE_INVALID` (503).

**Xác nhận lại** (`reauth`): trường `"reauth":"<mật khẩu của admin đang gọi>"` trong thân; kiểm qua `AuthService::reauthenticate` (hàng đợi băm có sẵn); sai thì `REAUTH_REQUIRED`, tính vào khóa tạm của chính admin. Cần cho: đặt lại mật khẩu, hạ vai trò, tắt, xóa người dùng, xóa nhóm, khôi phục kho.

**Giới hạn tần suất:** các yêu cầu thay đổi dưới `/api/v1/admin/` tối đa 30/phút/phiên (`429`).

**Audit:** mọi yêu cầu (cả bị từ chối) ghi một dòng: action (bảng dưới), result, user, target, detail `{before, after}` (không bao giờ có mật khẩu, mã băm, `reauth`).

## 1. Trang (mọi vai trò)

| Phương thức, đường | Vai trò | Thân / trả về | Audit |
|---|---|---|---|
| `GET /api/v1/web/access` | viewer (cũng trả cho ẩn danh khi `viewerLogin: off`) | `EffectiveAccess` ([access-model §5](access-model.md)) | — |
| `POST /api/v1/web/password` | viewer | `{"old":"…","new":"…"}` → `204`; sai `old` → `403 REAUTH_REQUIRED`; quy tắc → `400 WEAK_PASSWORD`; hủy **các phiên khác** của người đó, giữ phiên hiện tại | `account.password` (channel Web) |

`GET /api/v1/web/session` thêm `groups` và `viewerLogin` (`"off"|"required"`).

Ghi chú cài đặt (luồng B, 2026-10-19): `GET /api/v1/web/access` nằm trong bảng với `needsSession = false` (để trả được cho ẩn danh khi `viewerLogin: off`); handler tự đọc phiên Bearer hoặc cookie của yêu cầu, không có phiên hợp lệ thì: `viewerLogin: off` và nguồn được bộ lọc nguồn phục vụ → EffectiveAccess ẩn danh, ngược lại `401 AUTH_REQUIRED`. `POST /api/v1/web/password` cũng nhận Bearer (khi đó mọi phiên của người đó bị hủy, kể cả phiên gọi).

## 2. Người dùng (administrator)

| Phương thức, đường | Thân | Trả về | Audit |
|---|---|---|---|
| `GET /api/v1/admin/users` | — | `{"rev":12,"users":[{"name","role","groups","enabled","locked":{"until":ms}\|null,"lastLoginAt","createdAt","updatedAt","sessions":n}]}` | `admin.read` (không ghi lần đọc lặp trong 60 s) |
| `POST /api/v1/admin/users` | `{"rev","name","role","groups":[],"password"?: "…", "generate"?: true}` (đúng một trong `password`, `generate`) | `201 {"rev","password"?}` (`password` chỉ khi `generate`, hiện một lần) | `account.create` |
| `POST /api/v1/admin/users/{name}` | `{"rev", "role"?, "groups"?, "enabled"?, "unlock"?: true, "reauth"?}`; `reauth` bắt buộc khi hạ vai trò hoặc `enabled:false` | `{"rev"}` | `account.role` / `account.groups` / `account.disable` / `account.enable` / `account.unlock` |
| `POST /api/v1/admin/users/{name}/password` | `{"rev","password"?|"generate"?,"reauth"}` | `{"rev","password"?}` | `account.password` |
| `POST /api/v1/admin/users/{name}/delete` | `{"rev","reauth"}` | `{"rev","accessRev"}` (gỡ người nhận `user:<name>`) | `account.delete` |

- Tên tài khoản như cũ `^[a-z][a-z0-9._-]{2,31}$`; vai trò một trong 4; nhóm phải tồn tại.
- `LAST_ADMIN` khi thao tác làm không còn administrator nào đang bật (xóa, tắt, hạ vai trò) — cả khi admin tự sửa mình.
- Đổi vai trò, nhóm, `enabled`, mật khẩu, xóa → hủy mọi phiên của người đó (kể cả chính admin nếu tự đổi; trả `{"rev","signedOut":true}`).
- `createdAt`, `updatedAt`, `lastLoginAt` trong danh sách là ms UTC (hoặc `null`); tệp giữ `createdAt`/`updatedAt` dạng ISO (access-model §1.1). Một yêu cầu không đổi gì (giá trị như cũ) trả `{"rev"}` với `rev` cũ, không ghi tệp, không audit. Danh sách có thêm `storeState: "invalid"` khi `users.json` hỏng.

## 3. Nhóm (administrator)

| Phương thức, đường | Thân | Trả về | Audit |
|---|---|---|---|
| `GET /api/v1/admin/groups` | — | `{"rev","groups":[{"id","name","members":["vh1"],"rules":n}]}` | — |
| `POST /api/v1/admin/groups` | `{"rev","id","name"}` | `201 {"rev"}` | `group.create` |
| `POST /api/v1/admin/groups/{id}` | `{"rev","name"}` | `{"rev"}` | `group.rename` |
| `POST /api/v1/admin/groups/{id}/delete` | `{"rev","reauth"}` | `{"rev"}`; còn thành viên hoặc quy tắc → `409 IN_USE {"usedBy":{"users":[…],"rules":[…]}}` | `group.delete` |

`rev` của nhóm và quy tắc là `rev` của `access.json`.

## 4. Quy tắc (administrator)

| Phương thức, đường | Thân | Trả về | Audit |
|---|---|---|---|
| `GET /api/v1/admin/access` | — | `{"rev","viewerLogin","storeState":"ok"\|"invalid","resources":[…],"rules":[…],"orphans":[{"resource","level"}]}` | — |
| `POST /api/v1/admin/access` | `{"rev","set":[{"resource","level","grantees":[…]\|null}]}` (`null` xóa quy tắc, về mặc định; tối đa 500 phần tử) | `{"rev"}` | `access.rule` (một dòng mỗi phần tử, detail before/after) |
| `POST /api/v1/admin/access/cleanup` | `{"rev"}` | `{"rev","removed":n}` (xóa quy tắc mồ côi) | `access.cleanup` |
| `POST /api/v1/admin/access/restore` | `{"reauth"}` | `{"rev"}` (chép `.bak` về; `rev` mới = `rev` của bản sao + 2, để yêu cầu làm trên tệp hỏng hay tệp trước đó đều 409); không có hoặc hỏng `.bak` → `409 NO_BACKUP` | `access.restore` (started rồi ok/failed) |
| `GET /api/v1/admin/effective?user=<name>` | — | `EffectiveAccess` của người đó (xem với tư cách, FR-043), thêm `enabled` | `admin.view-as` |
| `GET /api/v1/admin/effective?users=a,b,c` | — (tối đa 200 tên; không dùng cùng `user`) | `{"effective":{"a":EffectiveAccess,…}}` (tên không còn tồn tại bị bỏ) — cho "ai thấy, ai thao tác" | — |

`resources[]`: `{"id","kind":"screen"|"popup"|"item"|"page"|"history"|"report","title","screen"?,"widget"?,"levels":["view","operate"?],"defaults":{"view":"viewer","operate"?:"operator"}}`. Luật kiểm của `set`: tài nguyên phải có trong project đang chạy (`400 NOT_FOUND` kèm `resource`), `operate` chỉ cho tài nguyên có mức đó, người nhận phải tồn tại, không trùng; quy tắc `page:admin` bị từ chối.

## 5. Nhật ký (administrator, cookie)

`GET /api/v1/admin/audit?from&to&user&action&beforeId&limit` — cùng kết quả với `GET /api/v1/audit` (đã có, Bearer) nhưng cho cookie; action lọc theo tiền tố (`auth.`, `access.`, `account.`, `group.`, `admin.`). Phân trang bằng `beforeId` (nhận cả `before` làm bí danh); trả `{"records":[…],"next":<beforeId kế>|null}`, bản ghi cùng hình `GET /api/v1/audit`. Ghi `audit.read` như đường cũ (channel `web` khi đi bằng cookie).

## 6. Thực thi trên các đường có sẵn

| Đường | Thay đổi |
|---|---|
| `GET /project/<screen>.screen.json` (và `.bindings.json`, `.svg`) | không `view` màn hình → `403 ACCESS_DENIED` + audit `access.denied`. Được xem: bỏ khỏi `items[]` các item bị ẩn; ô lưới trỏ item đó bỏ khóa `item`; bỏ binding của item bị ẩn. |
| `GET /project/navigation.json` (và mục menu trong `projects/active`) | chỉ gồm màn hình được xem |
| `GET /project/<khác>` (mẫu báo cáo, ký hiệu…) | mẫu báo cáo cần `report:<id>` `view`; tệp khác như cũ |
| `GET /api/v1/projects/active` | danh sách màn hình, nhóm lưu trữ, mẫu báo cáo lọc theo quyền; danh mục Tag (nếu có) lọc theo `history(P)` (⊇ `live(P)`; trang Lịch sử và Báo cáo cần tên và đơn vị của Tag của nhóm và mẫu được xem — luồng B, 2026-10-19); `entryScreen` không được xem → màn hình đầu tiên được xem |
| WebSocket `/api/v1/live` | `subscribe` Tag ngoài `live(P)` → Tag vào `denied` (như `unknown`, không có giá trị); khi quyền đổi: gỡ và gửi `{"type":"access-changed"}` |
| (giao thức live) | **1.4.0** (luồng B, 2026-10-19; ADR-006: bản tin và trường mới là MINOR): `snapshot.denied` (chỉ có khi khác rỗng), `{"type":"access-changed"}`. Tag bị gỡ giữ vị trí trong đăng ký (các Tag khác không đổi vị trí) nhưng không còn delta; trang tải lại quyền rồi đăng ký lại. Hub hỏi lại quyền của mỗi phiên mỗi 1 s; quy tắc sửa trên web có hiệu lực ở lần hỏi kế (≤ 1 s), sửa bằng CLI cũng ≤ 2 s (luồng B, 2026-10-20: runtime xem lại `access.json` tối đa mỗi 1 s, `kAccessRecheckMs`, một `lstat`; trước là 2 s nên tới ~3 s). Nhóm của tài khoản sửa bằng CLI (`--user-groups`) đi qua `users.json` (xem lại mỗi 2 s) và hủy phiên của người đó. Alarm (subscribeAlarms) cũng lọc theo `alarm(P)`. |
| `GET /api/v1/history/*` | Tag ngoài `history(P)` bị bỏ; yêu cầu chỉ có Tag bị cấm → `403 ACCESS_DENIED` |
| `GET /api/v1/alarms`, `/alarms/history` | chỉ alarm có Tag nguồn trong `live(P)`; cần `page:alarms` (`403`). `counts` chỉ đếm alarm thuộc `alarm(P)` (luồng B, 2026-10-20: cả `counts` của câu trả lời ack/shelve/unshelve/disable/enable, `alarmSnapshot`/`alarmDelta` của live và khối `alarms` của `GET /api/v1/system/info` — `instances`, `active`, `unacked`, `shelved`, `disabled`); administrator: tất cả. Quyền của phiên đổi → hub gửi `access-changed` rồi một `alarmSnapshot` mới của cùng đăng ký (bỏ alarm đã mất, `counts` mới) |
| `POST /api/v1/alarms/ack|shelve|unshelve` | alarm ngoài tập được phép → `403 ACCESS_DENIED` |
| `POST /api/v1/tags/write` (cookie) | bắt buộc `context.screen` và `context.widget`; item phải `operate` **và** binding của item chứa Tag ghi; thiếu hoặc sai → kết quả `REJECTED` mã `ACCESS_DENIED` + audit. Bearer: như cũ (công cụ kỹ sư). |
| `/` và `/login` khi `viewerLogin: required` | như có sẵn (302 `/login`); `/login?next=<hash>` — trang tự kiểm `next` (mục 7) |

## 7. Địa chỉ quay lại (FR-002)

Trang đăng nhập nhận `next` chỉ khi khớp `^#/[A-Za-z0-9/_\-.]{0,200}$` (một đường dẫn hash trong trang vận hành); khác thì bỏ, về `/`. Trang vận hành gặp 401 hoặc live đóng 4401 → `location.assign('/login?next=' + encodeURIComponent(location.hash))`.

## 8. Dòng lệnh

`mat-runtime --user-*` ghi `auth/users.json` (sau khi khởi tạo từ `/etc`), dưới cùng khóa tệp; thêm `--user-groups <name> <g1,g2|->` (`-`: không nhóm nào), `--user-remove <name>` (gỡ cả `user:<name>` khỏi quy tắc), `--group-add <id> <name>`, `--group-remove <id>`, `--access-reset` (xóa mọi quy tắc, giữ nhóm; đường phục hồi; `access.json` hỏng thì ghi tệp mới rỗng). `--group-remove` là đường phục hồi: gỡ nhóm khỏi mọi tài khoản và quy tắc rồi xóa (không chặn `IN_USE` như API). `access.json` hỏng: các lệnh đổi nhóm, quy tắc trả mã 6. Mọi lệnh audit started rồi ok/failed như các lệnh tài khoản cũ.
