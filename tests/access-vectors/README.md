# Vector quyền dùng chung (feature 013)

Sinh bởi `generate.mjs` (`node tests/access-vectors/generate.mjs`; Node thuần, không gọi bộ tính: `expected` viết tay theo luật). Hợp đồng: [access-model.md](../../specs/013-access-control/contracts/access-model.md) §2 đến §4, §7. Bộ chạy: `packages/access-model/src/compute.test.ts` (TS, Vitest) và `core/auth/tests/access_vectors_test.cpp` (C++, gtest). Thư mục ca được commit.

Mỗi ca là một thư mục `<tên>/`:

| Tệp | Nội dung |
|---|---|
| `catalog.json` | danh mục tài nguyên (§7): `screens[]` (`id`, `popup`, `view`, `items[]` gồm `id`, `operable`, `view`, `operate` chỉ khi `operable`, `tags`), `historyGroups[]`, `reports[]` (`id`, `tags`), `alarms[]` (`id`, `tag`). `view`/`operate` đã là mặc định project sau §3 |
| `access.json` | kho quy tắc §1.2 (`schemaVersion` 1.0.0, `rev`, `groups`, `rules`) |
| `principal.json` | `{ "user": "vh1" \| null, "role": "...", "groups": [...] }`; `user: null` là phiên ẩn danh |
| `expected.json` | `screens`, `hiddenItems`, `lockedItems`, `pages`, `admin`, `liveTags`, `historyTags`, `alarms`, `orphans` |

Danh mục nền: màn hình `tong-quan`, `bom-1`, `bao-tri` và popup `popup-bom`; nhóm lưu trữ `ap-suat` (P1, TANK.LEVEL) và `nang-luong` (E1); mẫu báo cáo `dien-ngay` (E1, E2); năm alarm, trong đó `a-ap` (Tag P1) không có Tag nguồn trên màn hình nào. Ca sửa danh mục khi cần (mặc định project cao hơn).

## Quy ước bộ tính phải theo (C++ và TS giống hệt)

1. **Thứ hạng** `viewer < operator < engineer < administrator`. `allowed(P, res, level)` đúng như §4: administrator luôn được; dưới sàn (`viewer` cho `view`, `operator` cho `operate`) là không; dưới mặc định project là không; có quy tắc `(res, level)` thì cần một người nhận khớp; không có quy tắc thì được.
2. **Người nhận:** `*` khớp khi `user` khác null; `user:<n>` khớp khi `user == n` (ẩn danh không khớp gì); `group:<id>` khớp khi `id ∈ groups` (không kiểm nhóm có trong `access.json`); `role:<r>` khớp khi `rank(role) ≥ rank(r)` và **không cần đăng nhập** (`role:viewer` khớp cả ẩn danh); `role:` với tên vai trò lạ và mọi dạng khác không khớp.
3. **Mặc định project** của tài nguyên: màn hình, popup, item lấy `view`/`operate` ở danh mục; `page:alarms`, `page:history`, `page:reports`, `history:*`, `report:*` là `viewer`; `page:watch` là `operator`.
4. **Cha:** `item:S/I` `view` cần `screen:S` `view`; `item:S/I` `operate` cần `item:S/I` `view` và `operable`.
5. **Mồ côi** (`orphans`, không áp khi tính): quy tắc có tài nguyên không có trong danh mục, **hoặc** mức không áp được cho tài nguyên đó. Mức áp được: `view` cho `screen:`, `item:`, `history:`, `report:`, `page:alarms|history|reports|watch`; `operate` chỉ cho `item:` có `operable: true`. Vì vậy `page:admin` (không có quy tắc), `page:<lạ>`, tiền tố lạ, `operate` trên màn hình, nhóm lưu trữ hay item không operable đều là mồ côi. Mồ côi không phụ thuộc chủ thể (administrator cũng thấy).
6. **Kết quả:**
   - `screens`: màn hình và popup được `view`, theo thứ tự danh mục.
   - `hiddenItems`: với mỗi màn hình **được xem**, item không được `view`. Màn hình bị cấm không có khóa ở đây.
   - `lockedItems`: với mỗi màn hình được xem, item `operable` **được xem** nhưng không được `operate` (item ẩn không bị tính là khóa).
   - `pages`: các tên `alarms`, `history`, `reports`, `watch` được `view` (không có `admin`); `admin` là `role == administrator`.
   - `liveTags`: hợp Tag của mọi item được xem (trên màn hình được xem).
   - `historyTags`: `liveTags` ∪ Tag của `history:<g>` được xem nếu `page:history` được xem ∪ Tag của `report:<id>` được xem nếu `page:reports` được xem.
   - `alarms`: id alarm có `tag` thuộc `liveTags`, **không phụ thuộc** `page:alarms` (widget alarm trên màn hình vẫn dùng); trang Alarm chỉ mở khi `alarms ∈ pages`. Alarm có `tag: null` (của thiết bị, driver) thuộc `alarms` khi `alarms ∈ pages` (quyết định 2026-10-20; ca `alarm-without-tag-*`). Feature 040: alarm có `tag` không nằm ở màn hình, nhóm lưu trữ hay mẫu báo cáo nào (không quy tắc nào giới hạn được Tag đó) cũng thuộc `alarms` khi `alarms ∈ pages` (ca `alarm-tag-unrestricted-*`).
   - Administrator: mọi màn hình, không ẩn, không khóa, bốn trang, mọi Tag của item (`liveTags`), cộng mọi Tag của nhóm và mẫu (`historyTags`), mọi alarm.
7. **Thứ tự:** mọi mảng sắp theo chuỗi (byte; tên toàn ASCII) và không trùng, trừ `screens`; `orphans` sắp theo `resource` rồi `level`. `hiddenItems`/`lockedItems` chỉ có khóa khi danh sách khác rỗng (đối tượng rỗng `{}` khi không có gì).

Bộ chạy so `expected.json` bằng so sánh sâu (thứ tự khóa của đối tượng không quan trọng).
