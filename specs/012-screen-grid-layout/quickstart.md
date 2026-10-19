# Quickstart: kiểm 012

## Chuẩn bị

```powershell
npm ci
node tests/project-vectors/generate.mjs
```

## 1. Định dạng và hai bộ kiểm

```powershell
npx vitest run packages/project-schema/src/vectors-11.test.ts
cmake --build <build x64> --target vectors_11_test; <build x64>/bin/vectors_11_test
```

Mong đợi: mọi ca `v11-*` cùng kết quả ở TS và C++ ([contracts/project-format-1.1.md](contracts/project-format-1.1.md) §3, §5).

## 2. Studio: dựng màn hình lưới (US1)

1. Mở `projects/grid-demo` (mới, định dạng 1.1).
2. **Thêm màn hình** → bố cục **Lưới**; **Thêm hàng** `4+4+4`, `8+4`, `12`.
3. Thả Thẻ giá trị, Đồng hồ, Đèn báo vào hàng 1; Biểu đồ đường, Danh sách alarm vào hàng 2; Bảng Tag sống vào hàng 3.
4. Kéo đường chia hàng 1 thành `6+2+4`, Ctrl+Z về `4+4+4`.
5. Lưu, đóng, mở lại: bố cục giữ nguyên, tab Thông tin "Không có lỗi".

Mong đợi: SC-001 (≤ 3 phút, không nhập tọa độ).

## 3. Trang vận hành (US2)

1. Nạp xuống `grid-demo` lên runtime 1.1 (máy x64 hoặc BL335).
2. Mở trang vận hành ở 1920, 1366, 600 px.

Mong đợi: SC-002; ở 600 px các ô xếp chồng, không cuộn ngang. Nạp xuống runtime 1.0: bị chặn kèm lời nhắc.

## 4. Giao diện (US3)

```powershell
npx vitest run packages/ui-components/src/styles
node tools/docs-screenshots.mjs --build
```

Mong đợi: test tương phản xanh ở 3 chủ đề (SC-007); ảnh chụp 6 màn hình chuẩn để người dùng duyệt (SC-008); kích thước bundle trang vận hành tăng ≤ 400 KB gzip (`npm run build -w @mat/runtime-web`, so `dist/assets`).

## 5. Báo cáo (US4)

Xuất báo cáo ca của `history-demo` ra PDF và XLSX từ trang Báo cáo. Mong đợi: SC-009.

## 6. Chuyển đổi (US5)

Mở `tank-demo` (sau nâng cấp 1.1), màn hình `tank-motor` → **Chuyển sang bố cục lưới** → xem trước → Áp. Mong đợi: SC-010, Ctrl+Z về bản tự do.
