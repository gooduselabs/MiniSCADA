# Nghiệm thu feature 010 (T150): lịch sử, tổng hợp, biểu đồ, báo cáo, editor Studio

Ngày: 2026-10-16. Nhánh `worktree-agent-a42606f7b5d8cad7a`. Phiên bản: runtime 0.9.0, Studio 0.8.0, API 1.4.0, định dạng project 0.6.0, danh mục widget 0.5.0.

Cách đọc: **Đạt (x64)** là số đo hoặc test trên x64 (máy dev, container) và nằm trong ngưỡng. **Chờ BL335** và **Chờ người** là phần cần thiết bị hoặc thao tác của người: chưa đo, không bịa số. **Hoãn** là việc làm được trên x64 nhưng chưa chạy, kèm lệnh chạy lại. Ma trận FR: [010-fr-matrix.md](010-fr-matrix.md). Rà soát: [010-security-review.md](010-security-review.md), [010-code-review.md](010-code-review.md).

## Bảng theo SC

| SC | Nội dung ngắn | Trạng thái | Bằng chứng |
|---|---|---|---|
| SC-001 | Trigger: cạnh hợp lệ thành đúng một dòng, Kết hợp theo `maxIntervalMs` | Đạt (x64) | `sampler_test`, `historian_agg_test` (nhóm `HistorianTrigger`); `010-trigger-x64.json`: runtime `history-demo` 450 s, `me-tron` 3 dòng cách 120,07 s và 119,90 s |
| SC-002 | Vector tổng hợp (≥ 40 ca) cho cùng kết quả ở TS và C++ | Đạt | 44 vector dùng chung: `aggregator_test`, `agg_math_test`, `packages/history-math` |
| SC-003 | Ghép bucket khớp tính từ dòng thô ở 100 % bucket | Đạt (x64) | `010-agg-x64.json` (Historian thật, `verify-db.mjs` độc lập: 0 sai khác); `tools/history-ref` |
| SC-004 | Tổng hợp 200 Tag thêm ≤ 80 MB/ngày ghi eMMC (trần đổi từ 40, ADR-031) và ≤ 3 điểm CPU | Đạt phần ghi (x64); CPU chờ BL335 | `010-soak-x64.json`, `010-agg-write-x64.json`: thêm 64,2 MB/ngày ca xấu, 57,0 ca thưa; tổng ghi 795 MB/ngày (< 2 GB). CPU chưa đo |
| SC-005 | Sau 100 lần `kill -9`: 0 bucket trùng, 0 lệch, thiếu chỉ ở khoảng mất | Một phần: **hoãn** bản 100 lần | `010-kill100-x64.json`: số lần chạy hiện có; test `HistorianAgg` (crash, dừng sạch rồi khởi động lại, mất đúng 15 phút). Chạy lại: `.\tools\historian-it-010.ps1 -Scenario kill100 -Iterations 100` |
| SC-006 | `series` 24 giờ, 8 đường, p95 ≤ 2 s trên BL335 | x64 đạt; BL335 chờ | `010-query-200tags-x64.json`: p95 135 ms (x64, DB 7 ngày x 200 Tag) |
| SC-007 | Thô 1 giờ 16 đường p95 ≤ 1 s; `SCAN_LIMIT` ≤ 200 ms; `rows` ≤ 500 ms | x64 đạt; BL335 chờ | p95 12 ms; `SCAN_LIMIT` 9 ms; `rows` trang 200: 23 ms |
| SC-008 | Giảm điểm giữ cực trị, không vượt `maxPoints`, tất định | Đạt | `downsample_test`, vector `minmax`, `lttb`, `decimate`, `merge` |
| SC-009 | 10 client live + 2 truy vấn liên tục 10 phút + truy vấn thứ ba: RSS ≤ 150 MB, 0 mất sequence, khoảng trống live ≤ 1 s, 429 ≤ 100 ms | x64 đạt (200 Tag); CPU TB, BL335 chờ; **hoãn** bản 500 Tag mô phỏng | `010-load-200tags-x64.json`/`010-load-x64.json` (600 s): VmHWM 106 MB, 0 mất sequence, khoảng trống 277 ms, 429 chậm nhất 6,6 ms. Lần chạy trước có ngoại lệ do máy dev bận (ghi trong báo cáo). Chạy lại 500 Tag mô phỏng + nhóm 200: `.\tools\historian-it-010.ps1 -Scenario query-bench -Days 7 -Tags 200 -SimTags 500 -Keep -LoadSeconds 600` (xóa volume `w5-benchdata` trước) |
| SC-010 | Ca tấn công và tham số sai: 100 % bị từ chối đúng mã | Đạt (x64) | `010-security-review.md`; `010-api-x64.json`; `history_api_test` (41 test) |
| SC-011 | CSV 24 giờ 50 Tag ≤ 15 s; mở đúng trong Excel | x64 đạt; Excel chờ người | 332 ms, 8,2 MB (x64); mở Excel: T148 |
| SC-012 | Biểu đồ 4 đường 24 giờ ≤ 2,5 s trên BL335; khung hình p95 ≤ 16 ms | Chờ BL335; Chrome dev có số | `010-charts-fake.json`, `010-history-10-x64.json` (dữ liệu sau F5 ≤ 10 s, chậm nhất 6,5 s khi 10 phiên cùng F5) |
| SC-013 | Giá trị con trỏ khớp dữ liệu API | Đạt | e2e `history.e2e.mjs` (runtime giả), `history-source` test |
| SC-014 | Khoảng không chạy và NULL vẽ thành đoạn ngắt | Đạt | `history.e2e.mjs`, `history-math` vector `gaps`; test `HistoryApi.SeriesStatesTheCoverageAndANullCellIsNull` |
| SC-015 | Báo cáo ngày, ca, tháng 31 ngày: 100 % ô khớp tham chiếu độc lập; bar/pie cùng số với báo cáo | Đạt (runtime giả với dữ liệu tất định) | `reports.e2e.mjs` (53 kiểm, 596 ô khớp `history-ref`) |
| SC-016 | CSV, XLSX, PDF khớp 100 % ô với bảng màn hình; chữ Việt đúng dấu | Đạt tự động; mở Excel, Acrobat chờ người | `packages/report-export` tests, `reports.e2e.mjs`; `010-sc016.md`; lỗi PDF A4 ngang 12 cột ngắt giữa số đã sửa (planLayout) |
| SC-017 | Báo cáo tháng 12 cột 31 hàng ≤ 5 s; CPU BL335 thêm ≤ 5 điểm; 0 yêu cầu trong lúc dựng file | Dựng ≤ 5 s và 0 yêu cầu: đạt; CPU BL335 chờ | `reports.e2e.mjs` |
| SC-018 | Thư viện XLSX/PDF: license, ≥ 14 ngày, 0 lỗ hổng; PDF ≤ 1,2 MB gzip, XLSX ≤ 60 KB | Đạt | ADR-033; `npm run build:web`: PDF 787,7 KB, XLSX 6,2 KB, khởi động 91,8 KB (trần 244,1) |
| SC-019 | Khung ước tính ≤ 100 ms (32 nhóm x 200 Tag); số bằng `estimateLogging`; Studio, TS, C++ không sai khác; chặn mềm hoạt động | Đạt | `estimate-panel.test.ts`, `estimate-view.test.ts`, vector `v06-logging-010-estimate-*` (TS và `logging_estimate_test` C++), `logging.e2e.mjs` |
| SC-020 | Kỹ sư dựng nhóm lưu trữ và ba mẫu báo cáo hoàn toàn trong Studio, 0 dòng JSON, nạp xuống runtime x64 và mở trên Chrome | Một phần: dựng trong Studio (e2e) đạt; nạp xuống x64 và so khớp **hoãn** | `010-studio-smoke.json`, `logging.e2e.mjs`, `reports.e2e.mjs` của Studio; dựng project bằng e2e (`reports.e2e.mjs`, 36/36) ra thư mục và nạp qua API deployments xuống runtime x64 (committed 4.768 ms) đã thử; trang báo cáo chưa có số liệu vì bảng tổng hợp ghi mỗi 15 phút nên cần chờ ≥ 16 phút, và nhóm dựng trong e2e mới có 2 trong 4 chế độ. Kịch bản `tests/web-it/browser-sc020.mjs` chưa chạy trọn lần nào: `docs/reports/010-sc020-x64.json` ghi "hoãn" |
| SC-021 | Vector chung validator `logging`, `reports`, widget, `navigation` (≥ 80 ca): TS và C++ cùng kết luận | Đạt | `project_validator_test` 930/930; `packages/project-schema` 1900 test |
| SC-022 | 200 Tag onChange chạy ≥ 24 giờ trên BL335: `write_bytes` ≤ 2 GiB/ngày; DB 7 ngày trong trần | x64 đạt; BL335 chờ | x64 soak 7 ngày giả: 795 MB/ngày, db 602 MB. BL335: T143 |
| SC-023 | 100 lần `kill -9` (x64) và 100 lần cắt điện thật (BL335) | **Hoãn** / chờ người | xem SC-005; cắt điện thật: T147 |
| SC-024 | Không hồi quy: mọi kiểm tra tự động của 003...007 đạt; trang xem không phụ thuộc lịch sử khi không dùng widget lịch sử | Các bộ đã chạy trên nhánh đạt; **chưa có lượt ctest và ci-local đầy đủ** | Chạy lượt đầy đủ sau khi gộp (coordinator). Bộ nhắm đích đã xanh: `history_api_test` 41/41, `historian_agg_test` 46/46, `local_store_test`, `agg_verify_test`, `config_test`, `web_api_test`, `web_session_test`, `project_validator_test` 930/930, `logging_estimate_test`; `npx vitest` `project-schema` 1900 |
| SC-025 | Ước tính ghi và `write_bytes` chênh ≤ 30 % | Đạt (x64); BL335 chờ | soak: 795,2 so với 769,9 MB/ngày (3 %), không tổng hợp 731,0 so với 705,6 (4 %), tổng hợp thêm 64,2 so với 64,3 (ADR-034) |

## Quyết định đã duyệt trong feature

- Trần SC-004 từ 40 lên 80 MB/ngày (ca xấu: 64-73 MB đo được); ADR-031 ghi từng biện pháp: khóa `(res, bucket, cid)`, ghi mỗi 15 phút (từ 5), NULL cho `max`/`first`/`last` bằng `min`. Việc sau: mã hóa float32; số đo cuối trên BL335.
- `webMaxSessions` mặc định từ 8 lên 12 (ADR-032, sửa D33 của 007; đo RSS 35,4 so với 35,8 MB).
- Hằng số ước tính: `COMMIT_PAGES` 6, `AGG_WRITE_FACTOR` 3,6 (ADR-034).

## Rà soát code và các lỗi đã sửa trong lúc nghiệm thu

C1 (dừng sạch rồi khởi động lại đếm đôi phút đang mở), I1 (giờ đang chạy thiếu ở cửa sổ giờ), I2 (khoảng rỗng của widget cột/tròn), I3 (một câu `cid IN` thay vì một câu mỗi Tag), I4 (hủy truy vấn khi client ngắt kết nối; thêm `mg_peer_closed` vào CivetWeb vendored, ghi ở `third_party/LICENSES.md`), I5 (catalog 429 khi hồ đọc bận), M1, M3, M4. Chi tiết ở `010-code-review.md`.

## Việc chờ thiết bị hoặc người (không làm ở nhánh này)

T142-T149: deploy 0.9.0 lên BL335, SC-022, SC-004 (CPU), SC-006, SC-007, SC-009, SC-011, SC-017 trên thiết bị; thử tay Excel, Acrobat, Telex/Unikey, NVDA; cắt điện thật 100 lần; rollback thật. Hoãn trên x64: kill -9 100 lần, T140 với 500 Tag mô phỏng, SC-020 nạp xuống x64 (lệnh chạy lại ở các hàng trên).
