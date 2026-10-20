# Tasks: Sơ đồ khối cho editor Logic (015)

Đầu vào: [spec.md](spec.md), [plan.md](plan.md). Test viết trước (Constitution VI).

## Phase 1: Nền (model)

- [x] T001 Spec, plan, tasks (tệp này)
- [x] T002 [P] Test `packages/expression/src/parse-export.test.ts`: `parseExpression` trả cây hoặc lỗi; rồi xuất ở `index.ts`
- [x] T003 [P] Test `apps/studio/src/model/logic-layout.test.ts` (đọc khoan dung, lưới, đổi id, xóa, tên tệp phụ); rồi `logic-layout.ts`
- [x] T004 Test `apps/studio/src/model/logic-graph.test.ts` (nút, cổng, dây, cổng suy ra, Tag là đầu ra khối, sắp xếp không chồng, 550 khối < 200 ms); rồi `logic-graph.ts`
- [x] T005 Test `apps/studio/src/model/logic-graph-edit.test.ts` (nối thay đoạn, bọc AND/OR/NOT/so sánh, xóa dây gộp toán hạng, hành động write/setTag, nhân bản đổi đầu ra); rồi `logic-graph-edit.ts`
- [x] T006 Test store (`logic-layout-store.test.ts`): `logicLayoutSet` tạo `logic.layout.json`, một bước hoàn tác, đọc lại khi mở, không vào `projectFiles`; rồi `project-doc.ts`, `store.ts`

## Phase 2: Giao diện (US1, US2)

- [x] T007 Test `ui/logic/logic-diagram.test.ts`: nút Sơ đồ/Bảng, nút khối và dây, chọn → Inspector, kéo khối ghi layout, thả khối từ task card, nối dây, Delete/Ctrl+D/mũi tên, Tự sắp xếp, zoom; rồi `logic-diagram.ts`, `logic-diagram.css`, sửa `logic-editor.ts`
- [x] T008 Palette cổng AND/OR/NOT/So sánh trong task card "Khối / Tag" khi ở Sơ đồ (thả vào cổng vào)
- [x] T009 Mini-map (nhấp để tới vùng)

## Phase 3: Giá trị sống và lỗi (US3, US4)

- [x] T010 `LogicSim` dùng chung (logic-state) cho bảng Thử logic và sơ đồ; test giá trị dây, nhấp nháy khi bắn, timer còn lại
- [x] T011 Online: trạng thái khối, số lần bắn, giá trị Tag (test với thiết bị giả)
- [x] T012 Lỗi: cổng/khối đỏ theo issue path; nhấp đúp lỗi chọn khối trên sơ đồ (test)

## Phase 4: Hoàn thiện

- [x] T013 e2e `apps/studio/tests/e2e/logic-diagram.e2e.mjs` (+ axe hai theme); `logic.e2e.mjs` chuyển sang Bảng
- [x] T014 Tài liệu `docs/user/engineer-guide.md` mục Logic (sơ đồ); cảnh logic của `tools/docs-screenshots.mjs`
- [x] T015 Kiểm cuối: lint, typecheck, test gốc, e2e logic

## Ghi chú thực hiện (2026-10-20)

- Tag đầu vào vẽ kiểu FBD: hộp tên Tag gắn vào chân (đi theo khối), không phải nút chung, để dây dài không băng qua khối khác; luật xếp chung cột ngoài cùng ngay trước Ghi PLC; cột cao gập thành cột phụ (tỉ lệ đích 2,4 : 1); dây hành động là đường gấp khúc trong khe trước nút đích, vẽ trên khối.
- Thử logic ở Sơ đồ nâng khung dưới lên 380 px (Bảng: 460 px) để còn chỗ vẽ.
- Không đổi `logic.json`, schema, `core/` (C++): không cần ctest cho feature này. Vị trí ở `logic.layout.json` (ngoài `projectFiles`, không vào gói; gói có tệp thừa bị E_PACKAGE_EXTRA_FILE nên tệp phụ không được đưa vào gói).
- Kiểm cuối: lint, typecheck xanh; `npm test` gốc xanh trừ `screen-editor-grid.test.ts` (chập chờn khi chạy cả bộ, chạy riêng xanh) và `project-files.test.ts` cần `node tests/package-vectors/generate.mjs --out` trước (gói lớn không commit; chạy rồi xanh); e2e `logic-diagram` 36/36 và `logic` 47/47.
## Vòng 2 (2026-10-20, theo điều phối)

- [x] T016 Khối to hơn (rộng 248 px, chữ 12–13 px, cổng r 6), màu theo nhóm (dải trái, biểu tượng, đầu khối; cùng màu ở task card); Vừa khung không dưới 90 % (sơ đồ lớn thì cuộn)
- [x] T017 Khung dưới gập/mở (nút, Ctrl+J; `inspectorCollapsed` trong workspace, nhớ chiều cao); Thử logic ở Sơ đồ đặt khung dưới để vùng vẽ ≥ 55 %; panel Thử logic ba cột khi khung thấp
- [x] T018 Chọn nhiều khối: Shift+bấm, kéo khung trên nền (dời khung nhìn: Space + kéo, nút giữa, lăn chuột), Ctrl+A, Esc; nhóm dời/xóa/nhân bản một bước hoàn tác
- [x] T019 Dây hành động vòng qua kênh ngoài mọi khối khi đường thẳng cắt khối (`model/logic-route.ts`, test 10 luật gập cột)
- [x] T020 e2e đo vẽ 200 khối trong Chrome: ~260–280 ms (ngưỡng 500 ms)
