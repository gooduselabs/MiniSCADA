# Tasks: Sơ đồ khối cho editor Logic (015)

Đầu vào: [spec.md](spec.md), [plan.md](plan.md). Test viết trước (Constitution VI).

## Phase 1: Nền (model)

- [ ] T001 Spec, plan, tasks (tệp này)
- [ ] T002 [P] Test `packages/expression/src/parse-export.test.ts`: `parseExpression` trả cây hoặc lỗi; rồi xuất ở `index.ts`
- [ ] T003 [P] Test `apps/studio/src/model/logic-layout.test.ts` (đọc khoan dung, lưới, đổi id, xóa, tên tệp phụ); rồi `logic-layout.ts`
- [ ] T004 Test `apps/studio/src/model/logic-graph.test.ts` (nút, cổng, dây, cổng suy ra, Tag là đầu ra khối, sắp xếp không chồng, 550 khối < 200 ms); rồi `logic-graph.ts`
- [ ] T005 Test `apps/studio/src/model/logic-graph-edit.test.ts` (nối thay đoạn, bọc AND/OR/NOT/so sánh, xóa dây gộp toán hạng, hành động write/setTag, nhân bản đổi đầu ra); rồi `logic-graph-edit.ts`
- [ ] T006 Test store (`logic-layout-store.test.ts`): `logicLayoutSet` tạo `logic.layout.json`, một bước hoàn tác, đọc lại khi mở, không vào `projectFiles`; rồi `project-doc.ts`, `store.ts`

## Phase 2: Giao diện (US1, US2)

- [ ] T007 Test `ui/logic/logic-diagram.test.ts`: nút Sơ đồ/Bảng, nút khối và dây, chọn → Inspector, kéo khối ghi layout, thả khối từ task card, nối dây, Delete/Ctrl+D/mũi tên, Tự sắp xếp, zoom; rồi `logic-diagram.ts`, `logic-diagram.css`, sửa `logic-editor.ts`
- [ ] T008 Palette cổng AND/OR/NOT/So sánh trong task card "Khối / Tag" khi ở Sơ đồ (thả vào cổng vào)
- [ ] T009 Mini-map (nhấp để tới vùng)

## Phase 3: Giá trị sống và lỗi (US3, US4)

- [ ] T010 `LogicSim` dùng chung (logic-state) cho bảng Thử logic và sơ đồ; test giá trị dây, nhấp nháy khi bắn, timer còn lại
- [ ] T011 Online: trạng thái khối, số lần bắn, giá trị Tag (test với thiết bị giả)
- [ ] T012 Lỗi: cổng/khối đỏ theo issue path; nhấp đúp lỗi chọn khối trên sơ đồ (test)

## Phase 4: Hoàn thiện

- [ ] T013 e2e `apps/studio/tests/e2e/logic-diagram.e2e.mjs` (+ axe hai theme); `logic.e2e.mjs` chuyển sang Bảng
- [ ] T014 Tài liệu `docs/user/engineer-guide.md` mục Logic (sơ đồ); cảnh logic của `tools/docs-screenshots.mjs`
- [ ] T015 Kiểm cuối: lint, typecheck, test gốc, e2e logic
