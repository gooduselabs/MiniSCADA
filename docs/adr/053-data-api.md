# ADR-053: API dữ liệu cho hệ thống khác bằng API key theo mô hình quyền 013

- **Trạng thái:** Proposed (2026-10-25). Có mã và test (gtest lõi key, API dữ liệu, API quản trị; Vitest, e2e tab API key; test khớp OpenAPI; tích hợp x64 với giả lập Modbus); chưa thử trên BL335.
- **Ngày:** 2026-10-25
- **Liên quan:** spec [025](../../specs/025-data-api/spec.md), phân quyền 013 ([ADR-042](042-access-control.md)), write coordinator (feature 006/007), lịch sử 010, alarm 009, driver MQTT 022 ([ADR-050](050-driver-mqtt.md)), [threat-model I-18](../architecture/threat-model.md).

## Bối cảnh

ERP, MES, BI và script cần đọc giá trị, lịch sử, alarm và đôi khi ghi Tag. Phiên của người (`mats_` Bearer, cookie `matw_`) hết hạn khi rỗi, gắn địa chỉ đăng nhập và cần mật khẩu: dùng cho máy thì phải lưu mật khẩu người ở máy khác. Cần một danh tính riêng cho máy, quyền hẹp, thu hồi được, không thêm mô hình quyền thứ hai.

## Quyết định

1. **API key** `matk_` + 43 ký tự base64url (32 byte `getrandom`). Thiết bị chỉ giữ SHA-256 (token đủ entropy nên không cần hàm băm chậm, như phiên) và 12 ký tự đầu để nhận diện; token hiện một lần trong câu trả lời tạo key. Kho `<dataDir>/auth/api-keys.json` 0600, `rev` cả tệp, ghi nguyên tử có `.bak`, tối đa 32 key; tệp hỏng → mọi key bị từ chối (`APIKEY_STORE`).
2. **Quyền = mô hình 013.** Key là một `Principal` (`user` = `apikey:<id>`, vai trò viewer hoặc operator, nhóm của `access.json`) đưa vào `computeAccess`; không bao giờ là "công cụ kỹ sư" thấy hết. Đọc = `liveTags`, lịch sử = `historyTags`, alarm = `alarmAllowed` (+ trang Alarm), ghi = Tag trong binding của item `operate` được phép, cộng `writeMinRole`. Không có danh sách Tag riêng cho key: một nguồn sự thật cho người và máy. Hệ quả: muốn cho máy ghi một Tag không có trên màn hình nào thì thêm một màn hình ẩn khỏi menu.
3. **Mặc định hẹp:** viewer, chỉ đọc; tạo key ghi được (hoặc sửa thành ghi được) cần nhập lại mật khẩu quản trị. Tùy chọn danh sách IP/CIDR, hạn, giới hạn gọi (token bucket, 10–6000/phút, mặc định 600, dồn tối đa một phần mười). Nguồn gửi key sai 20 lần/phút bị chặn đến hết phút.
4. **Đường riêng có phiên bản** `/api/v1/data/*` (13 dòng trong bảng quyền, `needsSession = false`: cổng chỉ kiểm HTTPS và method; `DataApi` kiểm key). Cookie và token phiên của người không mở được đường này; key không mở được đường khác. Lịch sử gọi thẳng `HistoryApi` với quyết định cổng tổng hợp (cùng truy vấn, giới hạn, phân trang, CSV của 010); alarm gọi `alarmsapi::getList/getHistory` với bộ lọc của key.
5. **Ghi qua write coordinator** như trang (audit trước khi gửi, giới hạn, trạng thái liên kết, tốc độ mỗi phiên = mỗi key). Hộp xác nhận của trang không áp cho máy: thay bằng `requestId` (UUID v4, khóa idempotency: coordinator trả `duplicate`) và `expect` (BOOL, `STALE_EXPECTATION`). Không có xung (`pulseMs`) cho máy. Audit `tag.write` kênh `https`, người `apikey:<id>`, `context` `{screen: "api-key", widget: "key-<id>"}`. Không thêm kênh audit mới để khỏi đổi CHECK của `audit.db`.
6. **Audit:** `apikey.create`, `apikey.update` (trước/sau), `apikey.revoke` trước khi đổi tệp; `apikey.denied` cho mọi lần gọi bị từ chối, gộp và giới hạn như `access.denied`. Lần dùng cuối và số gọi chỉ trong RAM (không ghi eMMC mỗi lần gọi, ADR-039), về 0 khi khởi động lại.
7. **Tài liệu là hợp đồng:** OpenAPI 3.1 `docs/api/data-api.openapi.yaml`; `tools/data-api-openapi.test.mjs` kiểm tập (method, đường) bằng đúng bảng quyền, và hướng dẫn `docs/user/data-api.md` nhắc mọi đường.
8. **Đẩy ra MQTT** dùng nhóm publish của 022, thêm hai khóa nhỏ (định dạng 1.1, chỉ thêm): `tagPatterns` (mẫu `*`/`?`, mở rộng lúc nạp model, `E_MQTT_GROUP_PATTERN` khi mẫu không khớp Tag nào hoặc nhóm quá 500 Tag; vector chung TS/C++) và `timestamps` (`sourceTs` từng Tag trong tin). Nhóm publish không theo quyền người dùng: là cấu hình của kỹ sư, tài liệu yêu cầu chỉ đưa Tag được phép ra ngoài.

## Phương án đã cân nhắc

- **Tài khoản người dùng loại "máy" với mật khẩu:** phải giữ mật khẩu ở máy khác, Argon2id mỗi lần gọi quá nặng cho BL335; phiên vẫn hết hạn. Loại.
- **Danh sách Tag riêng trên mỗi key:** linh hoạt hơn nhưng là mô hình quyền thứ hai, dễ lệch với trang. Loại; nếu cần sẽ thành tài nguyên mới của 013.
- **OAuth2 client credentials / mTLS:** nặng cho thiết bị nhúng và cho script nhà máy. Để sau.
- **Ghi thống kê dùng vào tệp:** mòn eMMC theo số gọi. Loại (RAM).

## Hệ quả

- Thêm `core/auth/api_keys.*`, `server/http/data_api.*`, nhánh `/admin/apikeys` của `AdminApi`, 17 dòng bảng quyền, 4 hành động audit, 7 mã lỗi; tính năng `data-api` trong `device/identity`.
- Trang Quản trị có tab "API key"; Studio không đổi.
- Key là bí mật dài hạn ở hệ thống khác (RR-18): giảm nhẹ bằng IP cho phép, hạn, chỉ đọc mặc định, thu hồi tức thì và audit.
