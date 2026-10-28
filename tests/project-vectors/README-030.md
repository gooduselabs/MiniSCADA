# Vector project của feature 030 (menu 100 % theo cấu hình)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v11-nav.mjs`, hàm `navCases`, gọi trong `cases11`); tên `v11-nav-*`, cùng bộ chạy với `v11-*`: `packages/project-schema/src/vectors-11.test.ts` (TS), `core/project-manager/tests/vectors_11_test.cpp` (C++).

- Schema `project.schema.json`: mục menu `system` (`alarms`, `alarm-history`, `history`, `recipes`, `admin`; đúng một trong `screen`, `report`, `system`, `items`), `navigation.alarmBell` (boolean). Sai: `E_SCHEMA`.
- `E_NAV`: `system` hoặc `alarmBell` ở project 1.0 (chỉ có từ 1.1).
- `W_NAV_SYSTEM`: trang hệ thống mà project thiếu tính năng (Alarm, Lịch sử alarm cần `alarmFile`; Lịch sử cần `loggingFile`; Công thức cần `recipesFile`). Luật: `rules-11.ts`, `rules_11.cpp`.
