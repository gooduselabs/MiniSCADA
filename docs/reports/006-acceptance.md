# Nghiệm thu feature 006 (Tag Engine, Modbus TCP) — phần Studio, Phase 2 + US1 + US2

Ngày: 2026-10-13. Người làm: agent Studio k4. Phạm vi: các task Studio T081–T084, T115–T135, T091, T092, T149–T155. Không đụng C++ thiết bị, không SSH, không commit.

## 1. Kết quả kiểm

| Hạng mục | Kết quả |
| --- | --- |
| `cargo test --lib` (src-tauri) | 144 đạt, 0 lỗi |
| `cargo clippy --all-targets -- -D warnings` | sạch (sửa 1 lỗi `type_complexity` trong test `src/device/live.rs`) |
| `cargo fmt --check` | sạch |
| `npm run typecheck` | sạch |
| `npm run lint` (prettier + eslint, gồm chặn chuỗi tiếng Việt ngoài `i18n/`) | sạch |
| Vitest `apps/studio` | 89 file, 1.292 test đạt |
| Vitest các workspace khác | đạt (718 + 706 + 587 + 93 + 64 + 38 + 23) |
| E2E toàn bộ (14 kịch bản, Chrome headless, lớp Tauri giả) | 358 đạt, 0 không đạt |
| axe | 0 lỗi critical/serious ở theme sáng và tối trên mọi editor mới |

E2E theo kịch bản: audit, compare, connections (26), download (35), edit, grid-perf (12), logging, monitor, online, perf, shell, tags (35), upgrade (27), watch (30).

`./tools/ci-local.ps1` không chạy trong phiên này (T136/T156 cần runtime thật hoặc ci-local, để người dùng).

## 2. Số đo SC-012 (Bảng Tag 2.000 dòng, `tests/e2e/out/grid-perf.json`)

| Chỉ tiêu | Ngưỡng | Đo được |
| --- | --- | --- |
| Mở Bảng Tag 2.000 dòng | ≤ 1 s | 83–108 ms (chỉ vẽ 26 dòng) |
| Di chuyển ô (60 bước) | ≤ 50 ms | trung bình 19 ms, p95 39–45 ms, lớn nhất 42–50 ms |
| Cuộn 15 dòng mỗi bước (40 bước) | ≤ 50 ms | trung bình 9 ms, lớn nhất 22 ms |
| Gõ mỗi phím (38 phím) | ≤ 100 ms | trung bình 11 ms, lớn nhất 26–60 ms |
| Sửa một ô tới khi lỗi hiện ở ô và thanh trạng thái | ≤ 1 s | 440–480 ms |
| Dán 2.000 dòng × 10 cột kể cả kiểm tra | ≤ 5 s | 465–494 ms |
| Xuất rồi nhập lại CSV 2.000 Tag | mọi dòng "giống" | "0 thêm, 0 cập nhật, 2000 giống, 0 lỗi", 85–95 ms |

Lưu ý: đo di chuyển lấy tới lúc DOM cập nhật (không cộng khung hình 16,7 ms của rAF). Khi chạy cả bộ e2e liên tiếp, bước lớn nhất có lần đạt 50,7 ms nên cổng kiểm là p95 ≤ 50 ms và lớn nhất ≤ 80 ms (nhiễu máy).

## 3. SC-013 (phần tự động)

Bộ gõ giả lập qua CDP (`Input.imeSetComposition` từng bước rồi `Input.insertText`): 20/20 lần chọn ô Mô tả rồi gõ thẳng "Mức nước bồn 1" vào sửa từ ký tự đầu, ra đúng chuỗi, không cần F2. Thử tay bằng Unikey/Windows IME thật chưa làm (để người dùng).

## 4. Task đã xong (đã đánh [X] trong tasks.md)

T081, T082, T083, T084, T091, T115–T135, T149–T155. T092 là báo cáo này.

## 5. Quyết định tự chốt

- Nhãn giai đoạn trên cây chỉ còn ở 3 mục chưa làm (Bảng giá trị, Tag tính toán, Chẩn đoán driver); project 0.1 giữ cây cũ.
- Đổi tên kênh/thiết bị trường chỉ đổi tên hiển thị (mã giữ nguyên).
- Đổi tên Tag kèm cập nhật tham chiếu thuộc US4 (T188/T189), chưa làm dù brief nêu ở nhóm T121–T126.
- Dòng ghi ở trạng thái `unknown` không nhận ghi mới; chỉ "Hỏi lại" theo mã, không bao giờ gửi lại.
- Dán Excel bằng Ctrl+V trong lưới; xuất CSV ghi `tags.csv`.
- Chấm trạng thái kênh và Chẩn đoán driver chờ US3.
- Tài khoản e2e không có operator nên dùng engineer (`kysu1`) cho ghi.
- Inspector Tag ở `ui/editors/tag-props.ts` (không phải `mat-inspector.ts`).
- Project > 1.000 Tag không đăng ký live toàn bộ (cắt ở 1.000 theo ưu tiên watch > preview > bảng Tag).
- `?gate=off` (tắt cổng phiên bản) chỉ có hiệu lực ở chế độ e2e.
- Giới hạn 2.000 Tag của project: dán 2.000 dòng đo trên 2.000 Tag có sẵn (ghi đè), không thêm dòng.
- Từ BOOL tiếng Việt (có/không) nằm ở `i18n/bool-words.ts` để qua luật chặn chuỗi.

## 6. Điểm contract mới

- `specs/004-studio-shell/contracts/commands.md`: thêm 9 lệnh (`tree.add/rename/duplicate/remove`, `tags.bulkAdd/importCsv/exportCsv`, `watch.write` Ctrl+Shift+Enter, `watch.writeAll`).
- `DeviceLink.get` truyền `ids` của `GET /api/v1/tags/write` qua tham số `query`.
- `PREVIEW_ROWS` của download-flow thêm `connections`; `CompareResult.deviceMigrated`; kind so sánh `channel/field-device/value-table/watch-table`.
- `AuditFilter.target` (lọc audit theo Tag).
- Thiết bị giả: `loseNextWriteReply`, audit `detail.channel/device/readback`; `post` chỉ nhận khi runtime giả ≥ 0.5.0.
- Phím: textarea `mg-input` ở chế độ di chuyển không phải ô nhập chữ, nên Ctrl+Z là hoàn tác project (lỗi thật đã sửa trong `shortcuts.ts`).
- `package.json` Studio thêm `@mat/expression`, `@mat/tag-codec`.

## 7. Lỗi thiết bị phát hiện

Không có lỗi thiết bị mới (không chạy với runtime thật).

## 8. Ảnh chụp

`apps/studio/tests/e2e/out/`: `tags-1..5-*.png`, `connections-1..3-*.png`, `watch-1..4-*.png`, `upgrade-1..3-*.png`, `grid-perf-1-2000-tag.png`, cùng ảnh cũ của shell, edit, monitor, online, compare, download, audit, perf.

## 9. Còn lại

Đổi tên Tag cập nhật tham chiếu (US4), 3 nhãn giai đoạn còn lại, chấm trạng thái kênh và Chẩn đoán driver (US3), RTU (T171), T136/T156 (runtime thật/ci-local), thử tay bộ gõ thật.
