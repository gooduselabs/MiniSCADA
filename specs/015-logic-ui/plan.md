# Implementation Plan: Sơ đồ khối cho editor Logic (015)

**Branch**: `015-logic-ui` | **Spec**: [spec.md](spec.md)

## Tóm tắt

Thêm khung nhìn Sơ đồ (SVG tự vẽ bằng Lit, không thư viện mới) cho editor Logic. Đồ thị là hàm thuần của `logic.json` + Tag + layout; mọi sửa đi qua `logicSet` / `logicLayoutSet` của store (hoàn tác sẵn có). Không đổi định dạng, không đổi C++.

## Bối cảnh kỹ thuật

- TypeScript, Lit 3.3.3 (light DOM, `AppElement`), Vitest + jsdom, e2e puppeteer-core trên Chrome (`apps/studio/tests/e2e`), axe-core.
- Không thêm phụ thuộc runtime (cổng giấy phép không cần).
- Ngân sách: 550 khối (giới hạn FR-095 của 011) vẽ < 200 ms trên máy dev; kéo chỉ cập nhật vị trí tạm trong phần tử, ghi store khi thả.

## Constitution Check

- II: không luật kiểm mới; lỗi trên sơ đồ lấy từ `checkLogic` (TS, cùng vector C++). Không đổi `core/`.
- V: không script; nối dây chỉ sinh biểu thức ADR-015 và hành động khai báo (write qua `writes`).
- VI: test model và giao diện viết trước.
- VII: `logic.json` không đổi; tệp phụ `logic.layout.json` là dữ liệu riêng của Studio, ngoài tập file project.

## Thiết kế

| Phần | Tệp | Vai trò |
|---|---|---|
| Cây cú pháp | `packages/expression/src/index.ts` | xuất `parseExpression(src)` (cây của parser sẵn có, không đổi ngữ nghĩa) |
| Layout | `apps/studio/src/model/logic-layout.ts` | kiểu tệp phụ, đọc khoan dung, đặt/đổi id/xóa vị trí, lưới 16 px |
| Đồ thị | `apps/studio/src/model/logic-graph.ts` | nút, cổng, dây, cổng suy ra từ biểu thức; sắp xếp tự động theo hạng phụ thuộc |
| Sửa trên đồ thị | `apps/studio/src/model/logic-graph-edit.ts` | nối, bọc cổng, xóa dây, nhân bản khối |
| Store | `model/project-doc.ts`, `app/store.ts` | sửa đổi `logicLayoutSet`, đọc tệp phụ, sửa được |
| Mô phỏng chung | `ui/logic/logic-state.ts` | `LogicSim` dùng chung giữa bảng Thử logic và sơ đồ, báo nhịp |
| Giao diện | `ui/logic/logic-diagram.ts`, `logic-diagram.css` | SVG, kéo thả, dây, zoom/pan, mini-map, giá trị sống, bàn phím |
| Editor | `ui/logic/logic-editor.ts`, `logic-card.ts` | nút Sơ đồ/Bảng, palette cổng |
| Chuỗi | `i18n/vi-logic-diagram.ts` | tiếng Việt |

Kích thước: khối 196 px rộng, đầu 28 px, mỗi hàng cổng 22 px; cổng suy ra 84 px, xếp cây về bên trái cổng vào của khối, đi theo khối. Sắp xếp: hạng 0 = Tag đầu vào, khối = 1 + hạng lớn nhất của khối cấp đầu vào (bỏ cạnh ngược khi có vòng), Ghi PLC/Tag đích = hạng luật + 1; trong cột xếp theo trọng tâm nguồn rồi thứ tự tài liệu.

## Rủi ro

- Biểu thức dài → cây cổng lớn: giới hạn độ sâu 4; sâu hơn gói thành nút "Biểu thức".
- Hai nguồn sự thật (layout và logic.json) lệch: layout chỉ là gợi ý; id lạ bị bỏ khi ghi.
