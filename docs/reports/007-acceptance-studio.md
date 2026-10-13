# 007 - Nghiệm thu phần Studio (US2, US6, Phase 2 phía Studio)

Ngày: 2026-10-13. Tác giả: agent s1.

## Kết quả kiểm thử

| Bộ | Kết quả |
|---|---|
| Vitest Studio | 1852 đạt |
| Vitest project-schema | 1579 đạt |
| Vitest ui-components | 432 đạt |
| Typecheck mọi workspace | sạch |
| ESLint apps/packages | sạch |
| e2e Studio đầy đủ | 648 đạt, 0 không đạt |

`npm run lint` gốc chỉ lỗi Prettier ở `eslint.config.mjs` (thay đổi của s2, không thuộc phạm vi).

### Lỗi đã sửa: ô đang gõ bị ghi đè (connections)
Các ca e2e "Mọi mã kết quả" lỗi vì editor Kết nối vẽ lại giữa lúc gõ (kết quả thử hoặc kiểm tra nền về sớm) và `live(value)` ghi đè chữ chưa xác nhận (host thành `refuse.local.local`). Sửa gốc ở `connections-editor.ts` (giữ chữ đang gõ cho tới khi xác nhận); test đơn vị đỏ rồi xanh. e2e `connections` 42/42, hai lần liên tiếp.

## Đo hiệu năng (màn hình 250 item, 3840x2160; `tests/e2e/out/screen-perf.json`)

| Chỉ số | Ngưỡng | Đo |
|---|---|---|
| Mở màn hình | <= 1 s | 47 ms |
| Kéo 100 item, khoảng khung trung bình | <= 16,7 ms | 15,5 ms (p95 39,9; max 60,1) |
| Undo | <= 100 ms | 15,3 ms |
| Validate sau sửa | <= 500 ms | 198 ms |

## Chưa làm
- T124: nạp vào runtime x64 và so với Chrome (phần Studio xong).
- T129: `tools/ci-local.ps1` do s2/phiên chính chạy.
- T130: thử tay Telex/Unikey/NVDA (cần người).
- T133, T134, T136, T137: thuộc runtime-web/web-it hoặc cần runtime thật.

## Đã xử lý thêm
- Màu bảng giá trị của dashboard-demo: bảng riêng sinh bởi generator, màu sáng trên nền tối cố định trong SVG (>= 4,5:1 ở cả hai theme); không cần sửa widget.
- Studio 0.5.0; T135 có e2e `screen-lifecycle.e2e.mjs`.
- Panel Details/Lớp không còn tràn xuống thanh trạng thái.
