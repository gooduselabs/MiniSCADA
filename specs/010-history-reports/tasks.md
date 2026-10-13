---

description: "Task list — Lưu trữ nâng cao, truy vấn lịch sử, biểu đồ lịch sử và báo cáo"
---

# Tasks: Lưu trữ nâng cao, truy vấn lịch sử, biểu đồ lịch sử và báo cáo

**Input**: `specs/010-history-reports/` (plan.md, spec.md, research.md R1–R16, data-model.md, contracts/, quickstart.md); ADR [031](../../docs/adr/031-history-aggregates.md), [032](../../docs/adr/032-history-query-api.md), [033](../../docs/adr/033-browser-reports.md), [034](../../docs/adr/034-trigger-mode-write-estimate.md); mockup [studio-history.html](../../docs/architecture/mockups/studio-history.html) (tạo ở T004).

**Tests**: **Bắt buộc, viết trước** (Constitution VI; spec FR-062). Mỗi task "Test" phải chạy **đỏ** trước task cài đặt tương ứng; ghi kết quả đỏ/xanh vào "**Ghi chú khi làm:**" ngay dưới task, như 003 đến 007. Task gộp test và cài ghi cả hai pha.

- **C++:** GoogleTest + CTest x64 trong Docker (`deployment/toolchain/test-x64.ps1`; `-Target`, `-Filter` để chỉ build và chạy module đang làm); test armhf dưới qemu-user; smoke armhf; build ASan + UBSan (`-DMAT_SANITIZE=ON`) cho phần xử lý đầu vào mạng (`history_api`).
- **TS:** Vitest (jsdom); e2e Chrome headless + axe-core (`npm run e2e -w @mat/runtime-web`, `npm run e2e -w @mat/studio`).
- **Vector chung:** C++ ↔ TS: `tests/project-vectors/` (ca `logging-010-*`, `report-*`), `tests/widget-catalog-vectors/` (ca `history-*`), `tests/agg-vectors/`, `tests/downsample-vectors/`, `tests/report-vectors/`; chỉ TS: `tests/migration-vectors/logging-0.1-0.2/`.
- **Tích hợp x64:** `tools/historian-it.ps1 -Scenario agg|kill100`, `tools/web-it.ps1 -Scenario history-api|history-10|reports`; kết quả `docs/reports/010-<kịch bản>-x64.json`.
- **Tham chiếu độc lập:** `tools/history-ref` (T006) tính bucket và báo cáo từ dòng thô bằng mã riêng; mọi so khớp "100 % ô" (SC-003, SC-015) so với nó.
- **Kiểm tay (cần người):** bộ gõ tiếng Việt trong editor (Telex, Unikey), mở CSV bằng Excel, mở PDF bằng Acrobat và Chrome, Chrome thật trên Windows 11.

**Quy ước**:

- **Quyền quyết định:** người dùng giao toàn quyền cho phiên chính (2026-10-11): tự duyệt mockup, tự nghiệm thu, commit mốc cục bộ (không push). Quyết định mới ghi "Quyết định (người dùng giao toàn quyền 2026-10-11)" vào task, plan hoặc ADR.
- **Số phiên bản (D23):** runtime `0.9.0`, Studio `0.8.0` (người dùng). Số API (`1.4.0`), định dạng project (`0.6.0`) là giả định; T008 căn lại theo hiện trạng mã trước khi viết schema.
- **Constitution V, thứ tự bảo mật:** không viết route `history/*` trước khi bộ test từ chối (HTTP, không phiên, tham số lạ, tên lạ, giới hạn tải: T058, T059) đỏ; mọi giá trị từ client là tham số `?`; endpoint mới khai `cookieAllowed` rõ ràng trong bảng quyền (chỉ `GET` đọc được `true`).
- **Thiết bị BL335 ⚠️🔌:** **SSH không có trong phiên viết kế hoạch**; không tìm cách vòng qua. Task chờ người dùng cho phép, hoặc người dùng tự chạy lệnh quickstart §9–§12.
  - Ghi mọi thay đổi vào `docs/reports/device-changes.md` kèm cách hoàn tác.
  - Không đụng `atscada-*`, `piano-edtech-*`. Không ghi mật khẩu vào repo. Không tự khởi động lại hay cắt điện thiết bị.
  - BL335 không có `sudo`: lệnh root chạy trực tiếp; lệnh chỉ đọc chạy bằng `runuser -u matscada --`.
- **Mockup trước code giao diện:** không viết `apps/studio/src/ui/**` của editor mới trước khi T004 xong. Giao diện theo [studio-ux.md](../../docs/architecture/studio-ux.md) §5, §7, §9; không làm giao diện dạng form cơ bản.
- **Ổ D: máy dev gần đầy:** DB thử (7 ngày × 200 Tag khoảng 1,5 GB) dựng ở `C:\build\mat-data`, không ở `D:`; xóa sau khi đo.
- **Không sửa mã sản phẩm ngoài task của feature này**; `tools/ci-local.ps1` xanh trước mỗi commit mốc.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1…US9 theo spec.md

---

## Phase 1: Setup (khung, thư viện, công cụ thử)

- [X] T001 [P] Khung `packages/history-math` (`package.json` `@mat/history-math` 0.1.0, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`); thêm vào workspace và tham chiếu `tsconfig`; không phụ thuộc DOM (chạy trong Node, Chrome, Studio).
  - **Ghi chú khi làm (2026-10-13, w5-ts):** workspace `packages/*` nhận tự động (không có `tsconfig` gốc để tham chiếu); `npm install` chỉ thêm liên kết workspace vào `package-lock.json` (kiểm bằng diff); `tsc --noEmit` xanh, `vitest run` chưa có test nên chưa chạy xanh (có từ T015).
- [X] T002 [P] Khung `packages/report-export` (`@mat/report-export` 0.1.0; `src/{csv,xlsx,pdf}/`; phụ thuộc `@mat/history-math`); `devDependencies` chỉ cho test (bộ đọc XLSX, bộ trích chữ PDF); mã xuất tải lười bằng `import()`.
  - **Ghi chú khi làm (2026-10-13, w5-ts):** khung `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`; phụ thuộc `fflate`, `pdfmake` và devDependencies bộ đọc thêm ở T005/T102 sau khi chốt phiên bản. Thư mục con `csv/`, `xlsx/`, `pdf/` tạo cùng mã ở T102 (thư mục rỗng không vào git).
- [ ] T003 [P] CMake: thư mục `core/historian/query/`, target `mat_historian_query` (phụ thuộc `mat_historian`, `mat_sqlite`) và đăng ký test; build x64 và armhf không lỗi, chưa có logic.
- [X] T004 [P] Mockup `docs/architecture/mockups/studio-history.html` theo contracts/studio-010.md: editor Lưu trữ (lưới nhóm, lưới Tag, inspector, khung Ước tính ghi ở ba mức xanh/vàng/đỏ), hộp thoại chặn mềm, editor Mẫu báo cáo với xem trước, trang runtime biểu đồ lịch sử và báo cáo, theme sáng và tối; dữ liệu mẫu của `projects/history-demo`. Phiên chính tự duyệt (người dùng giao toàn quyền): ghi ngày duyệt và điểm chỉnh vào "Ghi chú khi làm".
  - **Ghi chú khi làm:** [X] Xong 2026-10-13 (agent w5-ui). `docs/architecture/mockups/studio-history.html` (một tệp, không thư viện ngoài, 4 màn: editor Lưu trữ, editor Mẫu báo cáo, runtime Lịch sử, runtime Báo cáo; theme tự động/sáng/tối; bộ chọn ước tính xanh/vàng/cam/đỏ; hộp thoại chặn mềm với Hủy mặc định và ô gõ lại tên project cho mức cực lớn). Tự duyệt (người dùng giao toàn quyền 2026-10-11). Điểm chỉnh: (1) khung Ước tính đặt cột phải full-height thay vì dưới lưới để luôn thấy khi sửa; (2) Tag trùng cột và Tag ngoài nhóm hiện lỗi theo ô (viền đỏ), không hộp thoại; (3) mức "cam" và "đỏ" tách bằng nhãn chữ, không chỉ màu (trợ năng); (4) xem trước báo cáo tô vàng ô thiếu dữ liệu kèm chú thích "Dữ liệu đủ X %" và hàng "chưa tới"; (5) chuỗi trạng thái FR-035 liệt kê trong lớp phủ biểu đồ.
- [ ] T005 Rà soát thư viện web (research R10): `npm view` license, `time`, `dist.unpackedSize`, `dependencies` của `fflate`, `pdfmake` (và `jspdf`, `pdf-lib` dự phòng); `npm pack` vào thư mục riêng mới (không chạy script, không chạy mã trong đó), đo gzip bản sẽ dùng; tra lỗ hổng đã công bố; dựng thử PDF có chữ Việt (phông Roboto) và trích chữ để kiểm. Chốt phiên bản, ghi bảng vào ADR-033 và `third_party/LICENSES.md`, ghim phiên bản trong `packages/report-export/package.json`. Không đạt ngưỡng (license, ≥ 14 ngày, chunk PDF ≤ 1,2 MB gzip, XLSX ≤ 60 KB, 0 lỗ hổng chưa vá): áp phương án dự phòng của R10 và ghi lý do.
- [X] T006 [P] `tools/history-ref/` (TS, Node): bản tham chiếu **độc lập** tính bucket phút/giờ và báo cáo từ dòng thô theo luật history-db.md §3 bằng thuật toán chậm, đơn giản (duyệt từng đoạn giữ, không dùng mã của runtime hay `history-math`); đầu vào JSON hoặc CSV; có test nhỏ với ca tính tay (`hold-across-bucket`, NULL giữa cửa sổ, `delta` qua hai cửa sổ, BOOL 15 phút/giờ).
  - **Ghi chú khi làm (2026-10-13, w5-ts):** `tools/history-ref/ref.mjs` (JS thuần, không import mã sản phẩm): dựng đoạn giữ theo từng lần chạy rồi giao với từng cửa sổ (chậm, đơn giản), có `aggregateStore` (bucket phút và giờ, `break`/`jump`, upsert ghép), `mergeBuckets`, `avg/sum/delta/coverage`, `windowsFromMinutes`, `reportPeriod`, `reportTable`, `formatVi`. Quy ước `first` do ref chốt (README của `tests/agg-vectors`): `first` = giá trị còn giữ ngay trước đầu cửa sổ nếu có (kể cả khi dòng tới đúng đầu cửa sổ), không thì giá trị tại thời điểm có tín hiệu đầu tiên của cửa sổ; nhờ đó Σ delta qua cửa sổ liền kề = last − first. `node --test "tools/history-ref/*.test.mjs"`: 11 test (tính tay: hold-across-bucket, NULL giữa cửa sổ, bộ đếm tăng, break giữa phút, cửa sổ chỉ có tín hiệu mang, giờ ghép từ phút, merge/derive, kỳ báo cáo ca/tháng 29 ngày/+05:30, dòng tổng, hàng chưa tới); ref và test viết cùng lượt nên không có pha đỏ riêng (ca tính tay nằm trong test, một ca đỏ do tôi tính sai `offsetMs` rồi sửa test).
- [ ] T007 [P] `historian_tool fill-agg` (`core/historian/tests/historian_tool.cpp`, làm sau T024): dựng DB thử theo mô hình tất định (sin, ramp, bậc, bộ đếm tăng, BOOL theo ca, khoảng thiếu, nhiều lần chạy ghi `mat_runs`); tham số số ngày, số Tag, chế độ ghi; ghi bằng giao dịch lớn (7 ngày × 200 Tag ≤ 5 phút trên x64, trên `C:`) và xuất dòng thô tương ứng ra file cho `history-ref`. Test: số dòng, `mat_runs`, bảng tổng hợp rỗng (để thử dựng bù).
- [ ] T008 Căn số phiên bản (D23): đọc hằng định dạng project và `schemas/` hiện hành, `kDeviceApiVersion`, danh mục widget; ghi vào "Ghi chú khi làm" số thực sẽ dùng (chuỗi dự kiến: 3b runtime 0.7.0/Studio 0.6.0/định dạng 0.4.0; alarm runtime 0.8.0/Studio 0.7.0/định dạng 0.5.0/API 1.3.0/danh mục 0.4.0; feature này định dạng 0.6.0, API 1.4.0, danh mục 0.5.0; nếu 3b hay alarm chưa vào mã thì dùng số MINOR kế tiếp của hiện trạng) và cập nhật D23 trong spec cùng contracts nếu khác giả định; đổi tên trong `projects/history-demo` theo đó.
- [ ] T009 Checkpoint: `npm install`, `npm test`, `deployment/toolchain/test-x64.ps1` xanh (chưa có logic mới).

---

## Phase 2: Foundational (chặn mọi user story)

**Mục đích:** cấu hình 0.2 và validator, ước tính v2, phép ghép bucket hai ngôn ngữ, schema 2 của `history.db`, đo ghi eMMC.

### Test trước (phải đỏ)

- [ ] T010 [P] Vector `logging-010-*` trong `tests/project-vectors/generate.mjs` theo contracts/logging-config-0.2.md §6: mỗi vector `project/` đủ file, `expected.json` có `errors`, `warnings`; vector ước tính có `estimate` với **số cố định** của §5 (không tính lại bằng công thức); thêm `valid-history-demo` sau T033.
- [ ] T011 [P] Test TS (đỏ) `packages/project-schema/src/logging.test.ts`: duyệt mọi vector T010; `trigger`, `aggregates`, `aggregate`, `expectedRowsPerDay`; `estimateLogging` v2 (sáu ví dụ §5, ±1 byte, `basis`, `daysToFillCap`); 0.1 giữ kết luận.
- [ ] T012 [P] Test C++ (đỏ) `core/project-manager/tests/logging_estimate_test.cpp`, `project_validator_test.cpp`: duyệt cùng vector, so `estimate` và tập mã lỗi/cảnh báo với TS.
- [ ] T013 [P] Vector `tests/agg-vectors/merge-*.json`, `derive-*.json`: `merge` (hai cửa sổ, ba cửa sổ, hàng rỗng, cửa sổ lỗ), `avg` (có `wms`, `wms = 0`), `sum`, `delta`, `coverage`; số tính tay, có chú thích từng ca (≥ 15 ca).
- [ ] T014 [P] Test C++ (đỏ) `core/historian/tests/agg_math_test.cpp`: duyệt T013, dung sai 1e-9 tương đối.
- [ ] T015 [P] Test TS (đỏ) `packages/history-math/src/agg.test.ts`: duyệt T013.
- [ ] T016 [P] Test C++ (đỏ) `core/historian/tests/local_store_test.cpp` mở rộng: nâng schema 1 → 2 trên fixture do bản 0.8 tạo (dữ liệu cũ nguyên; `mat_meta.schema` = 2; bốn cột và ba bảng mới); chạy lại không đổi; mở DB schema 2 hai lần; cấp `cid` ổn định và không đổi khi cột bị bỏ; `mat_runs` thêm hàng mới và cập nhật `alive_ms`; lỗi giữa chừng rollback và runtime chạy tiếp không tổng hợp.
- [ ] T017 [P] Test C++ (đỏ) `core/historian/tests/io_meter_test.cpp`: nguồn `write_bytes` tiêm vào; vòng 1.440 ô; `writeBytes1h`, `writeBytes24h`, `coverageS`; ngoại suy `bytesPerDay` (null khi `coverageS < 600`); `unavailable` khi không đọc được.

### Cài đặt

- [ ] T018 `schemas/logging.schema.json` 0.2 (`$id` `…/logging/0.2.json`; hai nhánh `0.1.x` và `0.2.x`; trường mới chỉ ở nhánh 0.2) theo data-model và contracts/logging-config-0.2.md §1; cập nhật `schemas/README.md`.
- [ ] T019 TS: `packages/project-schema/src/logging.ts` (kiểu, luật `E_LOG_TRIGGER`, `E_LOG_AGG`, `estimateLogging` v2 với kết quả theo §5), `codes.ts` (`E_LOG_TRIGGER`, `E_LOG_AGG`, `W_LOG_WRITE_EXTREME`) → T011 xanh.
- [ ] T020 C++: `core/historian/logging_config.*` (model `trigger`, `aggregates`, `expectedRowsPerDay`, `aggregate` mỗi Tag), `core/project-manager/logging_estimate.*` v2, `core/project-manager/rules_010.*` (phần logging), nối vào `project_validator.*` → T012 xanh; hai bản cùng thứ tự phép cộng.
- [ ] T021 Migration `logging.json` 0.1.x → 0.2.0 (Studio, TS): bộ chuyển đổi, vector `tests/migration-vectors/logging-0.1-0.2/` (đầu vào 0.1 các dạng, đầu ra 0.2 chỉ đổi `schemaVersion`), test Vitest.
- [ ] T022 `core/historian/agg_math.*` (`mergeBuckets`, `avg`, `sum`, `delta`, `coverage`; hàng rỗng là phần tử đơn vị) → T014 xanh.
- [ ] T023 `packages/history-math/src/agg.ts` (cùng hàm, kiểu `AggBucket`) → T015 xanh.
- [ ] T024 `core/historian/local_store.*` schema 2: `migrateToSchema2()` (một giao dịch `BEGIN IMMEDIATE`, thêm cột, tạo bảng, đặt `schema = 2`), `ensureAggCols()` (cấp `cid`), `touchRun()` (`mat_runs`), truy vấn đọc chung; `synchronous` giữ `NORMAL` → T016 xanh.
- [ ] T025 `core/historian/io_meter.*` (vòng 1.440 ô, nguồn tiêm được, mặc định đọc `/proc/self/io`) → T017 xanh.
- [ ] T026 `tools/project-validator` (Node CLI) hỗ trợ `logging.json` 0.2 qua `@mat/project-schema`; `node --test tools/project-validator` xanh.
- [ ] T027 Checkpoint: `test-x64.ps1` và `npm test` xanh; hai validator cho cùng kết luận trên mọi vector `logging-010-*` và 0.1 cũ; ghi số test.

---

## Phase 3: User Story 1 — Ghi theo Tag kích hoạt và chế độ kết hợp (Priority: P1) 🎯 MVP

**Goal:** nhóm `trigger` và Kết hợp ghi đúng, `projects/history-demo` chạy được trên x64.

**Independent Test:** `sampler_test`, `historian_test`, rồi quickstart §2.

- [ ] T028 [P] [US1] Test (đỏ) `core/historian/tests/sampler_test.cpp`: `trigger` (`rising`, `falling`, `both`, `active` với `periodMs`, ngưỡng số, Tag BOOL, quality xấu = tắt không cạnh, không cạnh lúc bắt đầu, `active` đang bật lúc bắt đầu, `minIntervalMs` hoãn cạnh và mang giá trị mới nhất, xung 300 ms luôn có dòng, Tag kích hoạt nhấp nháy 200 ms ≤ 1 dòng mỗi `minIntervalMs`); **Kết hợp** (`onChange` + `maxIntervalMs`: đổi vượt deadband đặt lại bộ đếm, im lặng 5 phút ra dòng mỗi `maxIntervalMs` ± 250 ms).
- [ ] T029 [P] [US1] Test (đỏ) `core/historian/tests/historian_test.cpp`: nhóm `trigger` với Tag kích hoạt **ngoài** danh sách Tag (snapshot thêm); `status().groups[].triggerState`; bộ đếm `rows24h` theo nhóm (24 ô theo giờ, đồng hồ giả); project 0.1 không đổi hành vi.
- [ ] T030 [US1] Cài `core/historian/sampler.*` chế độ `trigger` (research R1; trạng thái `active`, `pendingEdge`, `lastRowMono`; `active` căn theo thời gian đơn điệu) → T028 xanh.
- [ ] T031 [US1] `core/historian/historian.*`: snapshot Tag kích hoạt, `triggerState`, bộ đếm `rows24h` → T029 xanh.
- [ ] T032 [P] [US1] `projects/history-demo/` (định dạng theo T008): `project.json`, `tags.json` (Tag mô phỏng: áp suất, nhiệt độ, `BATCH.DONE` (xung), `METER1.KWH` (bộ đếm), `METER1.KW`, `PUMP1.RUN`), `logging.json` 0.2.0 với nhóm `ap-suat` (Kết hợp, tổng hợp), `me-tron` (`trigger` rising), `dien` (`cyclic` 60 s, tổng hợp), `van-hanh` (`onChange`); chưa có màn hình và `reports.json` (thêm ở T089, T104, T112).
- [ ] T033 [US1] Thêm `valid-history-demo` vào `tests/project-vectors` (hợp lệ, không cảnh báo); `projects/history-demo` qua `npm run validate:project` và validator C++.
- [ ] T034 [US1] Chạy quickstart §2 trên x64 (runtime với `history-demo`, Tag mô phỏng tạo cạnh): xuất CSV bằng `--export-history`, đối chiếu số dòng và thời điểm với kịch bản 1–6 của US1; ghi `docs/reports/010-trigger-x64.json`.
- [ ] T035 [US1] Checkpoint: US1 chạy độc lập trên x64; `test-x64.ps1` xanh.

---

## Phase 4: User Story 2 — Bảng tổng hợp 1 phút và 1 giờ (Priority: P1)

**Goal:** `mat_agg` đúng, nguyên tử với dòng thô, khôi phục sau crash, dựng bù, dọn theo thời hạn và trần.

**Independent Test:** vector tổng hợp chung; `--verify-aggregates` = 0 sai khác trên DB `fill-agg`.

### Test trước (phải đỏ)

- [ ] T036 [P] [US2] Vector `tests/agg-vectors/agg-*.json` (≥ 40 ca theo history-db.md §8: dòng đều, dòng thưa, qua nửa đêm UTC, NULL đầu/giữa/cuối, `break` giữa cửa sổ, nhảy lùi và tiến, cửa sổ chỉ có tín hiệu mang, BOOL, số rất lớn/nhỏ, ghép phút → giờ, ghép hai nửa cửa sổ, dựng bù có và không có gieo, `delta` qua 24 giờ); `expected` sinh bằng `tools/history-ref` (T006), 10 ca khó kiểm tay và ghi chú trong file.
- [ ] T037 [P] [US2] Test C++ (đỏ) `core/historian/tests/aggregator_test.cpp` duyệt T036 (dung sai 1e-9 tương đối; `n`, `first`, `last`, `min`, `max` tuyệt đối).
- [ ] T038 [P] [US2] Test TS (đỏ) `packages/history-math/src/aggregator.test.ts` duyệt T036 (bản TS dùng cho nguồn mô phỏng của Studio).
- [ ] T039 [P] [US2] Test C++ (đỏ) `local_store_test.cpp`: upsert ghép (hai nửa của một phút không tạo hàng trùng, tổng đúng), `INSERT OR REPLACE` giờ, dọn bucket theo `agg_minute_days`/`agg_hour_days` từng phần ≤ 2.000 hàng, thứ tự xóa khi chạm trần (thô → phút → giờ) và đếm theo loại, khôi phục từ `agg_built_to` (bỏ Historian giữa phút, mở lại), dựng bù lùi theo lát có gieo tín hiệu qua `mat_runs` (kết quả bằng chạy trực tiếp), không trùng.
- [ ] T040 [P] [US2] Test C++ (đỏ) `historian_test.cpp`: bucket đóng ghi cùng giao dịch với dòng thô (giả lập commit lỗi: cả hai không có), `break` khi đồng hồ chưa hợp lệ / nhảy / ghi tạm dừng / `error` / nạp lại cấu hình, `agg_built_to` cập nhật mỗi phút (đếm số lần ghi `mat_tables`: ≤ 1 mỗi phút), `mat_runs` bắt đầu/alive (≤ 1 lần/60 s)/dừng gọn, dựng bù mỗi lượt ≤ 20 ms (đồng hồ giả).

### Cài đặt

- [ ] T041 [US2] `core/historian/aggregator.*` (bộ cộng dồn tín hiệu giữ theo history-db.md §3: `row`, `advance`, `break`, `clockJump`, hàng chờ ghi; Tag số và BOOL; ghép giờ từ phút) → T037 xanh.
- [ ] T042 [P] [US2] `packages/history-math/src/aggregator.ts` (cùng quy tắc) → T038 xanh.
- [ ] T043 [US2] `core/historian/local_store.*`: `upsertAgg`, `replaceHourAgg`, `readAggRange`, `deleteExpiredAgg`, `purgeOldestAgg`, `agg_built_to`/`agg_back_to`, `lastRowBefore(ts)`, `runStartsBetween(a, b)`; mở rộng `purgeOldest` (thứ tự thô → phút → giờ) → T039 xanh.
- [ ] T044 [US2] `core/historian/historian.*`: nối `Aggregator` vào lượt lấy mẫu (dòng, `advance`, `break`), đưa hàng chờ vào commit, cập nhật mốc mỗi phút, ghi `mat_runs` (bắt đầu, `alive_ms` ≤ 60 s, dừng gọn), khôi phục sau mở (history-db.md §4), → T040 xanh.
- [ ] T045 [US2] `historian.*` bảo trì: dựng bù nền (lát ≤ 1 giờ, ≤ 20 ms mỗi lượt, gieo tín hiệu), dọn bucket theo thời hạn, trần dung lượng theo thứ tự, chia ngân sách thời gian chung với dọn dòng thô; test thêm vào `historian_test.cpp`.
- [ ] T046 [US2] `core/historian/status.*` và `server/main.cpp`: khối `historian.aggregates` (số hàng theo `res`, tiến độ dựng bù, `capRowsDeleted` theo loại, `schema`), `groupsInfo[].aggregates`; test `status_test.cpp` (không có secret).
- [ ] T047 [P] [US2] `server/cli/verify_aggregates.*` và `server/cli/history_stats.*` (device-010.md §3): dựng lại bucket từ dòng thô bằng cùng bộ cộng dồn, áp `mat_runs`, so với `mat_agg`; mã thoát 0/1/2; `--json`; chỉ đọc; test với DB cố ý sai (xóa, sửa một bucket, thêm bucket thừa).
- [ ] T048 [US2] `tools/historian-it.ps1 -Scenario agg`: `fill-agg` 31 ngày × 24 Tag, dựng bù qua runtime x64, `--verify-aggregates` = 0 sai khác, so từng bucket với `history-ref` (SC-003, SC-002); ghi `docs/reports/010-agg-x64.json`.
- [ ] T049 [US2] Đo trên x64 (SC-004 phần x64): chạy 1 giờ profile 200 Tag `onChange` có và không `aggregates`, ghi `write_bytes` mỗi cấu hình và CPU (`tools/measure`); ghi hiệu và ngoại suy MB/ngày vào `docs/reports/010-agg-write-x64.json`. BL335 ở T143.
- [ ] T050 [US2] Checkpoint: US1 + US2 chạy trên x64; `--verify-aggregates` sạch sau `kill -9` lẻ (3 lần thử tay); `test-x64.ps1` xanh.

---

## Phase 5: User Story 3 — API truy vấn lịch sử (Priority: P1)

**Goal:** `GET /api/v1/history/{catalog,series,aggregate,rows,export.csv}` đúng, nhanh, an toàn, có giới hạn tải.

**Independent Test:** `history_query_test` trên DB dựng sẵn; `tools/web-it.ps1 -Scenario history-api` trên runtime x64 (HTTPS, đăng nhập thật).

### Test trước (phải đỏ)

- [ ] T051 [P] [US3] Vector `tests/downsample-vectors/*.json`: `minmax` (gai đơn, nhiều cửa sổ, NULL, cửa sổ rỗng, đúng `maxPoints`), `lttb` (ba chuỗi chuẩn: đường thẳng, sin, bậc), `decimate` (khoảng đều, có lỗ), ghép bucket (`merge` thành `maxPoints`); kết quả tính tay hoặc từ bản tham chiếu (≥ 20 ca).
- [ ] T052 [P] [US3] Test C++ (đỏ) `core/historian/tests/downsample_test.cpp` (duyệt T051; tính chất: không vượt `maxPoints`, giữ cực trị mỗi cửa sổ với `minmax`, tất định, thứ tự `t` tăng; SC-008).
- [ ] T053 [P] [US3] Test TS (đỏ) `packages/history-math/src/reduce.test.ts` (bản TS của `minmax`, `lttb`, ghép bucket, duyệt T051).
- [ ] T054 [P] [US3] Test C++ (đỏ) `source_select_test.cpp`: mọi nhánh của history-api.md §3.1 (cửa sổ giờ/phút/thô, tổng hợp phủ < 50 %, quá `SCAN_LIMIT` có và không có tổng hợp, `res` rõ ràng + `NO_AGGREGATES`/`SCAN_LIMIT`), ước tính quét bằng hiệu `seq`.
- [ ] T055 [P] [US3] Test C++ (đỏ) `query_limiter_test.cpp` (đồng thời tối đa, một yêu cầu mỗi phiên, xuất CSV riêng, RAII nhả khi ngoại lệ, bộ đếm, p95 vòng 256) và `reader_pool_test.cpp` (`query_only` ghi là lỗi, `cache_size`, tạo lười, đóng sau rảnh, hạn bằng progress handler, cờ hủy, tối đa 3, WAL không chặn writer).
- [ ] T056 [P] [US3] Test C++ (đỏ) `history_query_test.cpp` trên DB dựng sẵn (`fill-agg` nhỏ): `series` thô/`1m`/`1h`/`decimate`, ô NULL thành `null`, `gaps` từ `mat_runs`, `coverage`, `aggregate` (cửa sổ, `offsetMs`, ghép từ bảng giờ hay phút, cửa sổ rỗng), `rows` phân trang `seq` (không trùng, không sót kể cả cùng `ts`), DB hỏng → `HISTORY_UNAVAILABLE`; so với `history-ref` ở mọi ca.
- [ ] T057 [P] [US3] Test C++ (đỏ) `csv_writer_test.cpp`: `,`, `\r\n`, nháy kép, `%.15g` locale C, ô rỗng, BOM, giờ địa phương (+07:00 và +05:30, qua nửa đêm), khối ≤ 64 KiB, tiêu đề cột `<cột>.<trường>`, ô chuỗi bắt đầu `=`, `+`, `-`, `@` được thêm `'`; thêm `server/tests/export_history_cli_test.cpp` (lệnh `--export-history` với `--res raw|1m|1h`, `--fields`, `--no-bom` cho cùng byte với `export.csv`).
- [ ] T058 [P] [US3] Test C++ (đỏ) `core/auth/tests/roles_test.cpp` và `auth_gate` test: năm dòng `history/*` có `cookieAllowed = true`, role tối thiểu `viewer`, HTTP bị `HTTPS_REQUIRED`, `Sec-Fetch-Site` lạ bị `FETCH_SITE`, token Bearer và cookie cùng chạy, phương thức khác `GET` bị 405, không có đường vào bằng `viewerAccess` hay `viewerLogin: off`.
- [ ] T059 [P] [US3] Test C++ (đỏ) `server/tests/history_api_test.cpp` (máy chủ CivetWeb thử, SQLite thật): bảng mã lỗi §1.3; bộ tấn công và tham số sai của SC-010 (HTTP, không phiên, phiên hết hạn, cookie sang API khác, nhóm và Tag lạ, chuỗi giống SQL ở mọi tham số, số tràn, `from ≥ to`, `maxPoints` ngoài khoảng, tham số lặp hoặc lạ, `tags` > 16); 429 `BUSY` khi vượt giới hạn có `Retry-After`; `QUERY_TIMEOUT` (hạn thử ngắn); hủy khi đóng kết nối; `export.csv` (BOM, chunk, `EXPORT_TOO_LARGE` trước byte đầu, audit `history.export`); phản hồi không chứa tên bảng, đích, đường dẫn.

### Cài đặt

- [ ] T060 [US3] `core/historian/query/downsample.*` (`reduceMinMax`, `reduceLttb`, `decimate`, ghép bucket) → T052 xanh.
- [ ] T061 [P] [US3] `packages/history-math/src/reduce.ts` → T053 xanh.
- [ ] T062 [US3] `core/historian/query/source_select.*` → T054 xanh.
- [ ] T063 [US3] `core/historian/query/query_limiter.*`, `reader_pool.*` (`sqlite3_open_v2` chỉ đọc, `PRAGMA query_only=1`, `cache_size`, `mmap_size=0`, progress handler kiểm hạn và cờ hủy, `setpriority` theo luồng) → T055 xanh.
- [ ] T064 [US3] `core/historian/query/history_query.*` (`series`, `aggregate`, `rows`, `gaps`, `coverage`; câu lệnh dùng tham số `?`, tên bảng/cột từ cấu hình đã kiểm và luôn trích dẫn) → T056 xanh.
- [ ] T065 [P] [US3] `core/historian/query/csv_writer.*` (tái dùng `formatLocal` của `clock.*`) và `server/cli/export_history.*` (thêm `--res`, `--fields`, `--no-bom`, dùng chung `csv_writer`; FR-061) → T057 xanh.
- [ ] T066 [US3] `core/auth/roles.*`: năm dòng `history/*` (`viewer`, `cookieAllowed = true`, chỉ `GET`) và nhánh kiểm `Sec-Fetch-Site` cho `GET` bằng cookie → T058 xanh.
- [ ] T067 [US3] `server/config.*`: `historyApi`, `historyMaxConcurrent`, `historyQueryTimeoutMs`, `historyMaxScanMiB`, `historyReaderCacheKiB` (khoảng giá trị và từ chối khóa lạ như 003; test `config_test`).
- [ ] T068 [US3] `server/http/history_api.*`: định tuyến, kiểm tham số (allowlist, regex số nguyên, tra nhóm/Tag từ `catalog`), thứ tự bảo vệ của plan, lỗi theo §1.3, JSON và CSV phát dần, `Cache-Control: no-store`, audit `history.export` (thêm loại sự kiện vào `core/audit`); nối vào `server/main.cpp`; `kDeviceApiVersion` 1.4.0 (`server/device_state.hpp`) → T059 xanh.
- [ ] T069 [US3] `system/info`: khối `historian.query` (bộ đếm, p95, `lastError`), `historian.io` (từ `IoMeter`, `estimateBytesPerDay` từ `estimateLogging`), `groupsInfo[].rows24h`; test `status_test.cpp` (không secret, không tên bảng).
- [ ] T070 [US3] Ngân sách bộ nhớ: kiểm lúc khởi động tổng `cache_size` (ghi 8 MiB + `historyReaderCacheKiB` × 3 + luồng gửi ≈ 8 MiB + `alarm.db` 2 MiB + audit 0,25 MiB) ≤ 32 MiB, vượt thì hạ cache đọc và ghi cảnh báo vào journal; kiểm `WebOptions::httpThreads` mặc định ≥ 10 phiên live + 2 truy vấn + 1 xuất + dự phòng (nâng nếu thiếu, ghi lý do); test đơn vị cho phép tính; đo RSS x64 khi 3 kết nối đọc đều mở và ghi vào `docs/reports/010-query-x64.json` (BL335 ở T145).
- [ ] T071 [P] [US3] `tools/web-it.ps1 -Scenario history-api` (client Node, HTTPS, đăng nhập Bearer và cookie): luồng thường (catalog, series 24 giờ, aggregate, rows, CSV), bộ tấn công SC-010, 3 truy vấn đồng thời (thứ ba 429 ≤ 100 ms), hủy giữa chừng, CSV mở lại bằng bộ đọc; ghi `docs/reports/010-api-x64.json`.
- [ ] T072 [P] [US3] Mở rộng `tools/load-tester` (Go): chế độ truy vấn (N luồng gọi `series`/`aggregate` định kỳ) chạy cùng 10 phiên live; ghi khoảng trống live lớn nhất, mất sequence, thời gian truy vấn (SC-009 phần x64).
- [ ] T073 [US3] Đo hiệu năng truy vấn trên x64 với DB 7 ngày × 200 Tag (`fill-agg`, ở `C:`): 24 giờ 8 đường `auto`, thô 1 giờ 16 đường, `decimate`, `SCAN_LIMIT`, CSV 24 giờ 50 Tag; ghi p50/p95 và so ngân sách vào `docs/reports/010-query-x64.json` ("BL335 chưa đo"); nếu `auto` 24 giờ > 500 ms trên x64 thì xem lại truy vấn và chỉ mục trước khi đo BL335.
- [ ] T074 [US3] Checkpoint: US1–US3 chạy độc lập trên x64; ASan + UBSan sạch cho `history_api`; `test-x64.ps1` xanh.

---

## Phase 6: User Story 4 — Biểu đồ lịch sử và bảng dữ liệu lịch sử (Priority: P1)

**Goal:** `history-trend`, `history-table` và trang `#/history` chạy trên Chrome với dữ liệu thật của runtime x64.

**Independent Test:** Chrome headless trên runtime x64 với DB dựng sẵn (`web-it -Scenario history-10`); thử tay trên Chrome và Windows 11.

### Test trước (phải đỏ)

- [ ] T075 [P] [US4] Test TS (đỏ) `packages/history-math/src/format.test.ts`: `formatLocal` (+07:00, +05:30, sang ngày mới, 29/02), `formatNumber` vi-VN, nhãn trục thời gian theo khoảng, `chooseSource` (bản TS cho xem trước), `nearestPoint` cho con trỏ; không dùng `Date` cục bộ (test chạy dưới `TZ` khác nhau).
- [ ] T076 [P] [US4] Vector danh mục `tests/widget-catalog-vectors/history-*.json` (≥ 30 ca: mỗi widget hợp lệ; mỗi mã `E_WIDGET_HISTORY_GROUP`, `E_WIDGET_HISTORY_TAG`, `E_WIDGET_HISTORY_AGG`, `E_WIDGET_PROP` (gồm tổ hợp `bucket`/`period` ngoài bảng §2.1, `yMin` lẻ), `E_WIDGET_SLOT_TYPE`); test (đỏ) `packages/project-schema/src/catalog.test.ts` và `core/project-manager/tests/widget_catalog_test.cpp` duyệt chúng.
- [X] T077 [P] [US4] Test TS (đỏ) `apps/runtime-web/src/history-source.test.ts`: hàng đợi tối đa 2, ưu tiên yêu cầu người dùng, hủy bằng `AbortController`, 429 → nghỉ theo `Retry-After` và lùi 1→2→4→8 s tối đa 30 s ± 25 % (hạt giống tiêm), 401 và HTTP → `login-required`, 404 `NO_HISTORY` → `disabled`, 503 → `error` thử lại, bộ nhớ đệm (≤ 32 mục, hết hạn 30 s cho khoảng chạm "bây giờ"), không có lỗi trắng.
  - **Ghi chú khi làm:** Đỏ: chạy lần đầu lỗi không có module history-source (2026-10-13). Xanh: 16 test sau khi cài T086. Phủ: hàng đợi tối đa 2 và ưu tiên người dùng, hủy (đang chờ/đang bay), 429 lùi max(Retry-After, 1/2/4/8/16/30 s) ±25 % theo hạt giống tiêm, 401 và HTTP thành login-required, 404 NO_HISTORY thành disabled, 503 và lỗi mạng thành error, đệm 32 mục + hết hạn 30 s cho khoảng chạm bây giờ, BAD_RESPONSE.
- [ ] T078 [P] [US4] Test TS (đỏ) `packages/ui-components/src/widgets/history-trend.test.ts` (với `FakeHistorySource`): dựng đường theo `series`, `null` và `gaps` thành khoảng đứt, vùng min–max khi nguồn tổng hợp, bậc thang cho nhóm `onChange`/`trigger`, kéo chọn phóng, cuộn phóng/thu quanh con trỏ, Shift+kéo dịch, bấm đúp về gốc, con trỏ hiện thời điểm giờ địa phương và giá trị mỗi đường, bật/tắt đường ở chú giải, bàn phím (mũi tên, `+`/`-`, `Home`), gọi lại API sau 250 ms với `maxPoints` đúng, hủy yêu cầu cũ, giữ hình cũ khi chờ, `follow` làm mới 10 s, mọi trạng thái FR-035.
- [ ] T079 [P] [US4] Test TS (đỏ) `history-table.test.ts` (phân trang theo `seq`, `order`, đổi khoảng, định dạng giá trị và bảng giá trị, liên kết Xuất CSV đúng tham số) và `chart/history-plot.test.ts` (hàm dựng dữ liệu, chèn `NaN` tại khoảng đứt, quy đổi tọa độ).

### Cài đặt

- [ ] T080 [US4] `schemas/widgets.catalog.json` 0.5.0 (bốn widget, nhóm `history`, `kind: logGroup`, cờ khe `inGroup`, `needsAggregate`) + luật TS (`packages/project-schema/src/rules-010.ts`) + C++ (`core/project-manager/rules_010.*`, `widget_catalog.*`); chạy lại `tests/widget-catalog-vectors` → T076 xanh; `node tools/gen-widget-docs.mjs` sinh tài liệu.
- [ ] T081 [P] [US4] `packages/history-math/src/format.ts` (`formatLocal`, `formatNumber`, nhãn trục, `nearestPoint`, `chooseSource` TS) → T075 xanh.
- [X] T082 [P] [US4] `packages/ui-components/src/host/history-source.ts` (giao diện `HistorySource` theo contracts/widget-catalog-010.md §4) và `src/host/fake-history-source.ts (không để ở testing/: .gitignore chặn Testing/ không phân biệt hoa thường trên Windows)`.
  - **Ghi chú khi làm:** Xong: `packages/ui-components/src/host/history-source.ts` (giao diện + kiểu JSON API 1.4.0 + HistoryError/isAbort; thêm trường tùy chọn `priority` vào truy vấn để hàng đợi ưu tiên) và `src/host/fake-history-source.ts (không để ở testing/: .gitignore chặn Testing/ không phân biệt hoa thường trên Windows)` (FakeHistorySource: ghi lời gọi, hold/pending, failWith, setState). Xuất qua index.ts. Sai lệch nhỏ so với contract: kiểu kết quả định nghĩa ở ui-components, không ở history-math.
- [ ] T083 [US4] `packages/ui-components/src/chart/history-plot.ts` (uPlot tải lười: dữ liệu `Float64Array`, `bands`, bậc thang, `NaN` tại khoảng đứt, trục theo `formatLocal`, kéo chọn, cuộn, Shift+kéo, con trỏ) → T079 (phần plot) xanh.
- [ ] T084 [US4] `packages/ui-components/src/widgets/history-trend.ts` (+ `i18n`, `styles`): trạng thái FR-035, chọn khoảng, gọi lại API, `follow`, trợ năng (`role`, `aria-live`, phím tắt) → T078 xanh.
- [ ] T085 [P] [US4] `packages/ui-components/src/widgets/history-table.ts` → T079 xanh; đăng ký trong `register.ts` (trend tải lười).
- [X] T086 [US4] `apps/runtime-web/src/history-source.ts` (`HttpHistorySource`: `fetch` bằng cookie, hàng đợi chung, backoff, bộ nhớ đệm, trạng thái; nút Đăng nhập tới `/login` của 007 rồi quay lại) → T077 xanh.
  - **Ghi chú khi làm:** Xong cùng T077: `apps/runtime-web/src/history-source.ts` (HttpHistorySource). Nút Đăng nhập: trang cấp `requestLogin` (nối ở T087). Typecheck sạch.
- [ ] T087 [US4] `apps/runtime-web/src/history-page.ts`, `route.ts`, `menu.ts`: trang `#/history` (chọn nhóm, ≤ 16 Tag, khoảng; lựa chọn trong đường dẫn; hiện khi `catalog.enabled` và có phiên), mục menu "Lịch sử"; test `route.test.ts`, `menu.test.ts`, `history-page.test.ts`.
- [ ] T088 [P] [US4] Tích hợp `<mat-screen>` (007): item widget lịch sử nhận `HistorySource` từ nơi chứa; widget lịch sử không đăng ký live (không tính giới hạn 1.000 Tag của màn hình); test `screen` thêm ca.
- [ ] T089 [US4] `projects/history-demo` thêm màn hình (`ap-suat`: 1 `history-trend` 4 đường, 1 `history-table`; chưa có bar/pie), `navigation`; qua validator hai bản; cập nhật vector `valid-history-demo`.
- [ ] T090 [US4] e2e Chrome headless `apps/runtime-web/tests/history.e2e.mjs` (runtime x64 + DB dựng sẵn + tài khoản viewer): mở màn hình ≤ 2,5 s trong LAN giả; phóng/dịch; con trỏ khớp dữ liệu API 100 % (SC-013); khoảng đứt ở mọi `gaps` và NULL (SC-014); chưa đăng nhập hiện "Đăng nhập để xem lịch sử"; BUSY tự thử lại; bảng phân trang duyệt hết không trùng; `#/history` giữ lựa chọn khi F5; đo p95 khung hình 8 đường × 2.000 điểm ≤ 16 ms (SC-012); ghi `docs/reports/010-charts-x64.json`.
- [ ] T091 [US4] `tools/web-it.ps1 -Scenario history-10`: 10 phiên Chrome headless cùng F5 màn hình có 4 biểu đồ lịch sử: mọi biểu đồ có dữ liệu ≤ 10 s, 0 phiên mất live, 0 mất sequence (SC-009 phần x64); ghi `docs/reports/010-history-10-x64.json`.
- [ ] T092 [P] [US4] Trợ năng: axe-core trên trang `#/history` và widget lịch sử (theme sáng/tối): 0 lỗi critical/serious, tương phản ≥ 4,5:1, dùng được bằng bàn phím.
- [ ] T093 [P] [US4] Cổng kích thước và an toàn: `tools/lint-rules` cấm `innerHTML`, `eval`, `new Function` trong mã mới (`apps/runtime-web`, `packages/ui-components`, `packages/history-math`); script đo gzip tải khởi động ≤ 250 KB và chunk uPlot/lịch sử (SC-024 của 007); đưa vào `tools/ci-local.ps1`.
- [ ] T094 [US4] Checkpoint: US1–US4 chạy độc lập; `npm test`, `npm run e2e -w @mat/runtime-web`, `test-x64.ps1` xanh.

---

## Phase 7: User Story 5 — Báo cáo ngày, ca, tháng (Priority: P2)

**Goal:** mẫu `reports.json`, trang `#/report/<id>`, dựng CSV/XLSX/PDF trên trình duyệt, số khớp bản tham chiếu.

**Independent Test:** bộ vector báo cáo, `web-it -Scenario reports` so với `history-ref` trên dữ liệu 31 ngày.

### Test trước (phải đỏ)

- [ ] T095 [P] [US5] Vector `tests/project-vectors/report-*` (hợp lệ ba kỳ; `E_RPT_DUP_ID`, `E_RPT_REF_GROUP`, `E_RPT_REF_TAG`, `E_RPT_NO_AGG` (nhóm không tổng hợp, Tag `aggregate:false`, Tag chuỗi), `E_RPT_PERIOD`, `E_RPT_SHIFT`, `E_RPT_FN`, `E_RPT_LIMIT`, `E_NAV_REPORT`, `E_PATH`, `E_FILE_MISSING`, `E_SCHEMA`) cùng test TS và C++ (đỏ) duyệt chúng.
- [ ] T096 [P] [US5] Vector `tests/report-vectors/*.json` (≥ 20 ca): ngày (60/30/15 phút), ca qua nửa đêm (3 ca bắt đầu 06:00; 2 ca bắt đầu 22:00), tháng 28/29/30/31 ngày, kỳ đang chạy (hàng "chưa tới"), thiếu dữ liệu (`coverage < 0,95`), cửa sổ rỗng, `delta` qua các hàng và dòng tổng ghép, `tz` +07:00 và +05:30; số tính từ `history-ref`.
- [ ] T097 [P] [US5] Test TS (đỏ) `packages/history-math/src/report.test.ts` duyệt T096 (`periodRange`, `buildReport`, tổng, thiếu dữ liệu, nhãn hàng, `formatNumber`, chia lô ≤ 16 Tag).
- [ ] T098 [P] [US5] Test TS (đỏ) `packages/report-export/src/*.test.ts`: CSV (hai kiểu, BOM, escape, số, ô chuỗi bắt đầu `=`, `+`, `-`, `@` thêm `'`), XLSX (một sheet, ô số là số `numFmt` theo `decimals`, freeze panes, đọc lại bằng bộ đọc devDependency khớp 100 % ô, XML hợp lệ, chuỗi có `&<>"`, tiếng Việt và ô bắt đầu `=+-@`), PDF (khổ và hướng, lặp hàng tiêu đề, trích chữ khớp 100 % ô, dấu Việt, trang > 1), tên file làm sạch, tải lười (không nằm trong chunk chính).

### Cài đặt

- [ ] T099 [US5] `schemas/reports.schema.json` (draft-07, `additionalProperties:false`); `schemas/project.schema.json` thêm `reportsFile` và `navigation[].report` (oneOf `screen`/`report`); cập nhật bản sao theo phiên bản (`schemas/<phiên bản>/` như 007) và `schemas/README.md`.
- [ ] T100 [US5] Luật `E_RPT_*`, `E_NAV_REPORT` ở TS (`packages/project-schema/src/reports.ts`, `rules-010.ts`) và C++ (`core/project-manager/rules_010.*`, đọc `reportsFile` trong `project_validator.*`; runtime không kích hoạt project lỗi) → T095 xanh.
- [ ] T101 [P] [US5] `packages/history-math/src/report.ts` (`periodRange`, `buildReport` → `ReportTable`, tổng ghép, thiếu dữ liệu, chia lô, nhãn hàng) → T097 xanh.
- [ ] T102 [P] [US5] `packages/report-export/src/csv/*`, `xlsx/*` (ZIP bằng `fflate`, XML viết tay), `pdf/*` (`pdfmake`, phông tiếng Việt), `index.ts` (tải lười), `filename.ts` → T098 xanh; dùng phiên bản chốt ở T005.
- [ ] T103 [US5] `apps/runtime-web/src/report-page.ts` + `route.ts` + `menu.ts`: trang `#/report/<id>` (chọn kỳ, Xem, bảng cố định đầu, dòng tổng, chú thích thiếu dữ liệu, bốn nút xuất, trạng thái FR-035, đường dẫn `?d=`/`?m=`), mục menu tự thêm khi project không có `navigation`; yêu cầu qua `HttpHistorySource`; test `report-page.test.ts`.
- [ ] T104 [P] [US5] `projects/history-demo`: `reports.json` ba mẫu (`dien-ngay` kỳ ngày, `dien-ca` 3 ca bắt đầu 06:00, `dien-thang` kỳ tháng) và `navigation` có mục báo cáo; vector `valid-history-demo` cập nhật.
- [ ] T105 [US5] e2e + tích hợp `tools/web-it.ps1 -Scenario reports`: dữ liệu 31 ngày dựng sẵn; Chrome headless mở ba mẫu, so **100 % ô** với `history-ref` (≤ 1e-6 tương đối, SC-015); tải CSV, XLSX, PDF và đối chiếu từng ô với bảng trên màn hình (SC-016); đếm yêu cầu tới runtime trong lúc dựng file = 0 (SC-017 phần x64); thời gian dựng báo cáo tháng 12 cột ≤ 5 s (máy dev); ghi `docs/reports/010-reports-x64.json`.
- [ ] T106 [P] [US5] Trợ năng và an toàn trang báo cáo (axe, bàn phím, `lint` không `innerHTML`; tên mẫu và nhãn chứa `<script>` hiện dạng chữ, SC-020 của 007); cổng kích thước chunk XLSX ≤ 60 KB và PDF ≤ 1,2 MB gzip, tải khởi động không đổi (SC-018, SC-024).
- [ ] T107 [US5] Checkpoint: US5 chạy độc lập; `npm test`, e2e, `test-x64.ps1` xanh.

---

## Phase 8: User Story 6 — Biểu đồ cột và tròn trên số tổng hợp (Priority: P2)

- [ ] T108 [P] [US6] Test TS (đỏ) `packages/history-math/src/period.test.ts`: `periodRange` mọi `period` (đặc biệt `thisShift`, `lastShift`, `today`, `lastMonth` năm nhuận, `tz` +05:30) và `barModel`, `pieModel` (hạng mục theo `bucket`, loại Tag âm/thiếu, tổng 0, phần trăm) với vector `tests/report-vectors/period-*.json`.
- [ ] T109 [P] [US6] Test TS (đỏ) `history-bar.test.ts`, `history-pie.test.ts` (với `FakeHistorySource`): số cột, nhãn ngày + ca, giá trị khớp `buildReport` cùng kỳ (SC-015), làm mới mỗi `refreshSec`, chuyển ca ≤ 60 s, trạng thái FR-035, trợ năng (bảng tương đương cho trình đọc màn hình).
- [ ] T110 [US6] `packages/history-math/src/period.ts` (`periodRange`, `barModel`, `pieModel`) → T108 xanh.
- [ ] T111 [P] [US6] `packages/ui-components/src/widgets/history-bar.ts`, `history-pie.ts` (SVG tự viết như `bar`, `pie` của 007; dùng chung bộ vẽ hình học) → T109 xanh.
- [ ] T112 [US6] `projects/history-demo`: màn hình "Điện năng" (bar theo ca 7 ngày, pie 5 Tag hôm nay); qua validator hai bản.
- [ ] T113 [US6] e2e (Chrome headless) màn hình "Điện năng": số trên bar và pie khớp báo cáo cùng kỳ và `history-ref` (SC-015); trạng thái chưa đăng nhập, BUSY; axe sạch.
- [ ] T114 [US6] Checkpoint: US6 chạy độc lập.

---

## Phase 9: User Story 7 — Studio: editor Lưu trữ có ước tính ghi (Priority: P2)

**Gate:** T004 (mockup đã duyệt) phải xong trước khi viết `apps/studio/src/ui/**`.

### Test trước (phải đỏ)

- [ ] T115 [P] [US7] Test TS (đỏ) `apps/studio/src/model/logging-doc.test.ts`: mô hình nhóm/Tag/kết nối trong `project-doc`; chuyển Chế độ ↔ trường (`Kết hợp` = `onChange` + `maxIntervalMs`, mặc định 60 s khi chọn; bỏ `maxIntervalMs` về `Thay đổi`), `Kích hoạt` tạo `trigger`; `aggregate` mỗi Tag; kéo Tag từ cây; đổi tên Tag cập nhật tham chiếu (cơ chế 006); hoàn tác/làm lại; lưu khi còn lỗi.
- [ ] T116 [P] [US7] Test TS (đỏ) `logging-editor.test.ts` và `estimate-panel.test.ts`: lưới nhóm và lưới Tag (điền xuống, dán, ô mờ theo kiểu Tag, lỗi theo ô), inspector theo chế độ, khung Ước tính tính bằng `estimateLogging` (không công thức riêng), cập nhật ≤ 100 ms với 32 nhóm × 200 Tag (SC-019), nhãn cơ sở `chính xác`/`theo dự kiến`/`cận trên`, "chưa tính n Tag", văn bản tương đương cho trình đọc màn hình, gợi ý theo cảnh báo.
- [ ] T117 [P] [US7] Test TS (đỏ) `apps/studio/src/ui/dialogs/budget-confirm.test.ts`: hộp thoại chặn mềm khi nạp xuống (`W_LOG_WRITE_BUDGET`/`SIZE_CAP`: nút mặc định Hủy, "Tôi hiểu, vẫn nạp" mới đi tiếp; `W_LOG_WRITE_EXTREME`: gõ lại tên project); xác nhận nhớ cho đúng băm của ước tính, mất khi số đổi; ghi nhật ký thao tác; lưu và xem trước không bị chặn; Hủy không đổi gì (FR-048).
- [ ] T118 [P] [US7] Test TS (đỏ) `logging-online.test.ts` (lớp phiên giả): cột "Đo thực" từ `system/info` (`io.bytesPerDay`, `groupsInfo[].rows24h`), nút "Dùng số đo" điền `expectedRowsPerDay` (một lệnh hoàn tác), thiếu số đo thì ẩn; nâng 0.1 → 0.2 (chỉ đọc, băng nâng cấp, hoàn tác).

### Cài đặt

- [ ] T119 [US7] `apps/studio/src/model/logging-doc.ts` (+ nối `project-doc`, `issue-map`) → T115 xanh.
- [ ] T120 [US7] `apps/studio/src/ui/editors/logging-editor.ts` + `.css` (thay `logging-view.*`; lưới nhóm, lưới Tag, inspector Chung/Chế độ/Lưu trữ/Đích/Tổng hợp, form Kết nối không mật khẩu) và đăng ký trong `registry.ts`; xóa `logging-view.*` cùng test cũ sau khi test mới phủ đủ → T116 xanh (phần editor).
- [ ] T121 [P] [US7] `apps/studio/src/ui/estimate-panel.ts` (khung Ước tính ghi: thanh, bảng nhóm, cảnh báo, gợi ý, cột Đo thực) → T116 xanh (phần khung).
- [ ] T122 [US7] `apps/studio/src/ui/dialogs/budget-confirm.ts` và nối vào luồng Nạp xuống (`app/` deploy flow): xem trước cảnh báo từ `validate()` trước bước nạp; băm ước tính; nhật ký thao tác → T117 xanh.
- [ ] T123 [US7] Online: nối `system/info` vào editor (`logging-online`), tóm tắt lưu trữ của `device-page.ts` thêm ghi eMMC đo, truy vấn, tiến độ dựng bù → T118 xanh.
- [ ] T124 [P] [US7] Chuỗi `i18n` (vi, en), biểu tượng, mục cây `Lưu trữ`; kiểm `lint-rules` (không `innerHTML`, không chuỗi cứng).
- [ ] T125 [US7] e2e Studio (Chrome headless + lớp Tauri giả) `apps/studio/tests/logging.e2e.mjs`: dựng nhóm cho cả bốn chế độ + tổng hợp bằng thao tác (kéo Tag, điền xuống); đổi chu kỳ 1 s → 100 ms: khung chuyển cảnh báo ≤ 100 ms (đo bằng đồng hồ trong test); nạp xuống hiện hộp xác nhận, Hủy không nạp; kiểm tra sau mỗi lần sửa hiện lỗi ≤ 500 ms và lưu được khi còn lỗi (FR-054); kiểm tra bằng validator hai bản cho cùng kết luận (SC-019, SC-021).
- [ ] T126 [P] [US7] Trợ năng (axe) và bảng đối chiếu quy tắc studio-ux §5 cho editor Lưu trữ (SC-016 của 007); khớp mockup T004; thử tay bộ gõ tiếng Việt khi nhập tên nhóm (người).
- [ ] T127 [US7] Checkpoint: US7 chạy độc lập; `npm test`, `npm run e2e -w @mat/studio` xanh.

---

## Phase 10: User Story 8 — Studio: editor Mẫu báo cáo và Toolbox lịch sử (Priority: P2)

- [ ] T128 [P] [US8] Test TS (đỏ) `apps/studio/src/model/reports-doc.test.ts`: mẫu/cột/hàm trong `project-doc`, chỉ nhóm có `aggregates` và Tag có `aggregate ≠ false`, hàm mờ theo kiểu Tag, ca (số ca trong {2, 3, 4, 6, 8, 12}, nhãn ca, từ chối số ca không chia đều), gợi ý đơn vị theo hàm, lỗi theo ô (`E_RPT_*`), kéo Tag từ cây, hoàn tác.
- [ ] T129 [P] [US8] Test TS (đỏ) `templates-editor.test.ts` và `report-preview.test.ts`: xem trước bằng `SimHistorySource` dựng đúng bảng (`buildReport`), cập nhật ≤ 300 ms khi đổi hàm hoặc thứ tự cột, nguồn "Dữ liệu thiết bị" (phiên giả, token Bearer, BUSY/401), nút xuất thử bốn định dạng gọi `report-export` (lưu qua lệnh Tauri giả).
- [ ] T130 [P] [US8] Test TS (đỏ) `packages/tag-sim/src/sim-history.test.ts` (`SimHistorySource`: tất định, có khoảng thiếu giả, bucket tính bằng `aggregator.ts`, trả đúng `SeriesResult`/`AggregateResult`).
- [ ] T131 [US8] `packages/tag-sim/src/sim-history.ts` (`SimHistorySource`) → T130 xanh; `apps/studio/src/platform/device-history.ts` (`DeviceHistorySource`: token Bearer qua lớp Tauri, hàng đợi chung).
- [ ] T132 [US8] `apps/studio/src/model/reports-doc.ts` → T128 xanh.
- [ ] T133 [US8] `apps/studio/src/ui/editors/templates-editor.ts` + `.css` (form chung, lưới cột, inspector, xem trước, nút xuất thử) → T129 xanh; mục cây `Báo cáo` và đăng ký `registry.ts`.
- [ ] T134 [P] [US8] Toolbox nhóm "Lịch sử" (4 widget), inspector sinh từ danh mục 0.5.0 (thuộc tính `group` là danh sách nhóm; thả Tag ngoài nhóm báo lỗi ngay), xem trước màn hình với `SimHistorySource`/`DeviceHistorySource`; `navigation-editor.ts` thêm mục loại Báo cáo; test thêm vào `mat-palette.test.ts`, `props-widget` và `navigation-editor`.
- [ ] T135 [P] [US8] Chuỗi `i18n`, biểu tượng, `lint-rules`; trợ năng (axe); bảng đối chiếu studio-ux §5 cho editor mới; khớp mockup T004.
- [ ] T136 [US8] e2e Studio `apps/studio/tests/reports.e2e.mjs`: dựng **hoàn toàn bằng thao tác** nhóm lưu trữ có tổng hợp, ba mẫu báo cáo (ngày, ca, tháng), màn hình có bốn widget lịch sử và mục menu báo cáo (0 dòng JSON viết tay); Kiểm tra không lỗi; nạp xuống runtime x64; mở trên Chrome headless và khớp xem trước (SC-020); ghi `docs/reports/010-studio-smoke.json`.
- [ ] T137 [US8] Checkpoint: US7 + US8 chạy; `npm test`, e2e hai app xanh.

---

## Phase 11: User Story 9 — Nghiệm thu ngân sách và độ bền (Priority: P2)

**Phần x64 làm trước; phần ⚠️🔌 chờ người dùng cho phép SSH và người ở cạnh thiết bị.**

- [ ] T138 [US9] `tools/historian-it.ps1 -Scenario kill100` (x64): `fill-agg` nền + chạy runtime với `history-demo`, 100 lần `kill -9` ngẫu nhiên (khoảng chờ 1–12 s, hạt giống ghi lại) khi đang ghi, tổng hợp, gửi bù (4 DB thử) và truy vấn; sau mỗi lần `integrity_check` và `--verify-aggregates`; báo cáo số lần ok, bucket trùng/lệch, dòng mất trên thiết bị so với khoảng gom ghi (SC-005, SC-023 phần x64); ghi `docs/reports/010-kill100-x64.json`.
- [ ] T139 [US9] `tools/historian-it.ps1 -Scenario soak7d-compressed` (x64, đồng hồ giả nén thời gian): 200 Tag `onChange` + tổng hợp chạy 7 ngày giả; kiểm DB nằm trong trần, thời hạn lưu xóa đúng, ước tính `estimateLogging` so với số dòng thực và `write_bytes` đo trên 1 giờ thực (SC-025 phần x64: lệch ≤ 30 %; nếu lệch hơn, hiệu chỉnh hằng số `aggRowBytes`/hệ số WAL ở cả hai bản và ghi ADR-034); ghi `docs/reports/010-soak-x64.json`.
- [ ] T140 [US9] Tải x64 tổng hợp (SC-009 phần x64): runtime với `history-demo` mở rộng (500 Tag mô phỏng `bench-500` + nhóm 200 Tag), 10 phiên live (`load-tester`) + 2 truy vấn đồng thời liên tục 10 phút + 1 truy vấn thứ ba: CPU, RSS, mất sequence, khoảng trống live, 429 ≤ 100 ms; ghi `docs/reports/010-load-x64.json`.
- [ ] T141 [US9] Kiểm tương thích: runtime 0.9.0 mở `history.db` do 0.8 tạo (schema 1 → 2, dữ liệu nguyên) và runtime 0.8 mở `history.db` schema 2 (chạy bình thường, bỏ qua bảng lạ) trên x64 (build bản 0.8 từ tag/commit trước hoặc fixture); project 0.1–0.3 cũ chạy y như trước; ghi `docs/reports/010-compat-x64.json`.
- [ ] T142 ⚠️🔌 [US9] **(cần người dùng cho phép)** Deploy runtime 0.9.0 lên BL335 bằng `deployment/device/deploy.sh` (giữ `history.db`, secrets); ghi `docs/reports/device-changes.md` kèm cách hoàn tác; `integrity_check` sau nâng schema 2; nếu bản cũ cần giữ thì chép `history.db` ra nơi an toàn trước (ổ trống ≥ kích thước DB).
- [ ] T143 ⚠️🔌 [US9] **(cần người dùng cho phép)** SC-022, SC-004 trên BL335: nạp project `history-demo` mở rộng 200 Tag `onChange` + tổng hợp với Tag mô phỏng; chạy ≥ 24 giờ cùng 10 client live; mỗi 10 phút ghi `system/info` (`io.writeBytes24h`, `bytesPerDay`, `dbBytes`, CPU, RSS bằng `tools/measure`); so ước tính và số đo; chạy lại có và không `aggregates` để lấy hiệu (SC-004); ghi `docs/reports/010-bl335-write.json`. Chạy 7 ngày liên tục là tùy chọn; chưa chạy thì ghi "chưa đo".
- [ ] T144 ⚠️🔌 [US9] **(cần người dùng cho phép)** SC-006, SC-007 trên BL335: dựng DB 7 ngày × 200 Tag (`fill-agg` trên x64 rồi chép sang, hoặc dựng ngay trên thiết bị); với cache nguội (`sync; echo 3 > /proc/sys/vm/drop_caches`, lệnh root) và nóng, 20 lần mỗi loại, 10 client live: `series` 24 giờ 8 đường `auto`, nhóm không tổng hợp (`decimate`), thô 1 giờ 16 đường, `SCAN_LIMIT`, `rows` mỗi trang; ghi p50/p95; nếu p95 24 giờ > 2 s thì phân tích (I/O hay CPU) và chỉnh (`historyMaxScanMiB`, chỉ mục, cache) rồi đo lại; ghi `docs/reports/010-bl335-query.json`.
- [ ] T145 ⚠️🔌 [US9] **(cần người dùng cho phép)** SC-009, SC-011, SC-017 trên BL335: 10 phiên live (`load-tester`) + 2 truy vấn đồng thời + truy vấn thứ ba (CPU trung bình ≤ 30 %, RSS ≤ 150 MB, 0 mất sequence, khoảng trống live ≤ 1 s, 429 ≤ 100 ms); xuất CSV 24 giờ nhóm 50 Tag (≤ 15 s, RSS thêm ≤ 10 MB); CPU khi dựng báo cáo tháng (≤ +5 điểm); ghi `docs/reports/010-bl335-load.json`.
- [ ] T146 ⚠️🔌 [US9] **(cần người dùng cho phép)** SC-012 trên Chrome thật: mở màn hình lịch sử của `history-demo` qua LAN tới BL335: biểu đồ ≤ 2,5 s, phóng/dịch ≤ 1,5 s; 10 client cùng F5 (ghi số); Chrome ≥ 120 và bản ổn định hiện tại.
- [ ] T147 ⚠️🔌 [US9] **(cần người ở cạnh thiết bị)** SC-023 phần thiết bị: cắt điện BL335 100 lần trong khi chạy `history-demo` (ổ cắm/relay hẹn giờ do người dùng cung cấp; mỗi lần chờ khởi động xong, `integrity_check` và `--verify-aggregates` bằng script của quickstart §11); ghi `docs/reports/010-bl335-powercut.csv`. Chưa làm được: ghi "chưa đo" kèm lý do, phần `kill -9` ở T138 thay thế một phần.
- [ ] T148 ⚠️🔌 [US9] **(cần người)** Thử tay trên Windows 11: CSV mở bằng Excel (tiếng Việt, giờ +07:00, hai kiểu CSV), XLSX mở bằng Excel, PDF mở bằng Acrobat và Chrome; bộ gõ tiếng Việt trong editor Lưu trữ và Mẫu báo cáo (Telex, Unikey); ghi kết quả vào `docs/reports/010-manual.md`.
- [ ] T149 ⚠️🔌 [US9] **(cần người dùng cho phép)** Rollback thật trên BL335: `deployment/device/rollback.sh` về 0.8: runtime 0.8 chạy với `history.db` schema 2 và project cũ; sau đó deploy lại 0.9.0 và kiểm bucket được dựng bù; ghi `device-changes.md`.
- [ ] T150 [US9] Tổng hợp kết quả vào `docs/reports/010-acceptance.md` (bảng theo SC-001…SC-025: đạt/chưa đạt/chưa đo kèm lý do, bằng chứng); mục chưa đo giữ "chưa đo", không đánh dấu xong thay.
- [ ] T151 [US9] Checkpoint: mọi story chạy trên x64; số đo BL335 có hoặc ghi "chưa đo".

---

## Phase 12: Polish & nghiệm thu

- [ ] T152 [P] Nâng phiên bản: `RUNTIME_VERSION` 0.9.0, `kDeviceApiVersion` (T008), `@mat/studio` 0.8.0 (`package.json`, `tauri.conf.json`, `Cargo.toml`), `@mat/ui-components`, `@mat/project-schema` MINOR kế tiếp, `minRuntimeVersion` của `projects/history-demo` 0.9.0; cập nhật mọi test kiểm phiên bản.
- [ ] T153 [P] `docs/deployment/mat-runtime.md`: truy vấn lịch sử (giới hạn, cấu hình `runtime.json`), tổng hợp, `--verify-aggregates`, `--history-stats`, đo ghi eMMC, cách bật tổng hợp cho nhóm có dữ liệu, kiosk và đăng nhập cho lịch sử, rollback; `docs/architecture/studio-ux.md` §9: mục "Đã làm của GĐ 5".
- [ ] T154 [P] `third_party/LICENSES.md`: `fflate`, `pdfmake` (và phông) với phiên bản, license, ngày phát hành, kích thước (từ T005).
- [ ] T155 [P] ADR 031–034: cập nhật "Số đo / bằng chứng" và trạng thái (Accepted khi có số đo x64, ghi rõ phần chờ BL335); `docs/adr/README.md` đồng bộ.
- [ ] T156 Rà soát bảo mật (skill `agent-protocols:security-and-hardening`) cho `history_api`, `export.csv`, `HttpHistorySource`, mã xuất báo cáo (XLSX/PDF: chống chèn công thức `=`, `+`, `-`, `@` ở đầu ô chuỗi trong CSV/XLSX, escape XML, kích thước đầu vào); ghi `docs/reports/010-security-review.md`; sửa mọi mục Critical/High, ghi mục còn lại.
- [ ] T157 Rà soát hiệu năng (skill `agent-protocols:performance-optimization`) với số đo T073, T140, T143–T145; chỉnh giới hạn mặc định nếu số đo đòi hỏi (ghi lý do vào ADR-032).
- [ ] T158 Code review năm trục (skill `agent-protocols:code-review-and-quality`) cho thay đổi của feature; sửa mọi mục Important trở lên.
- [ ] T159 Chạy toàn bộ `tools/ci-local.ps1` (clang-format, armhf + smoke qemu, x64, Go, lint, typecheck, test TS, build web, cổng kích thước, e2e) xanh; ghi `docs/reports/010-ci-local.txt`.
- [ ] T160 Chạy lại quickstart §1–§8 từ đầu trên máy sạch (clone mới, `npm ci`), sửa quickstart theo sai khác thật; ghi `docs/reports/010-quickstart-rerun.md`.
- [ ] T161 Ma trận FR → test/kiểm (`docs/reports/010-fr-matrix.md`): mỗi FR-001…FR-064 trỏ tới task hoặc test; FR chưa phủ bị chặn đóng feature.
- [ ] T162 Constitution Check lần cuối (plan) và cập nhật `docs/plans/roadmap-v2.md` §4.6 (trạng thái thật: xong gì, chờ gì); không sửa Constitution (không cần: không có ngoại lệ mới).
- [ ] T163 Commit mốc cục bộ trên nhánh `010-history-reports` (không push) khi `ci-local` xanh; ghi hash vào `010-acceptance.md`.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 → Phase 2:** T008 (căn phiên bản) trước T018; T005 (thư viện) trước T102; T004 (mockup) trước mọi file `apps/studio/src/ui/**` mới (T120, T121, T122, T133, T134).
- **Phase 2 chặn mọi story.** Trong Phase 2: test (T010–T017) trước cài đặt (T018–T025); T024 trước T007 (`fill-agg` cần schema 2).
- **US1 (T028–T035)** cần T020, T027. **US2 (T036–T050)** cần US1 xong về `historian.*` (T031) và T022–T025. **US3 (T051–T074)** cần US2 (bảng tổng hợp để truy vấn) và T006, T007. **US4** cần US3 (API) và T080 (danh mục). **US5** cần US3 và T099; **US6** cần US5 (`history-math`) và US4 (widget nền). **US7** cần Phase 2 (ước tính v2), T004, T119; **US8** cần US5, US7 (mô hình), T131. **US9** cần mọi story trên x64.
- **Phase 12** sau US9 (phần x64); các task ⚠️🔌 không chặn Phase 12 nhưng chặn dòng "xong trên BL335" của `010-acceptance.md`.

### Song song

- Trong mỗi story, mọi task "Test" [P] chạy song song; cài đặt cùng file chạy tuần tự.
- US4 (web) và US7 (Studio) có thể làm song song sau US3 vì khác thư mục, miễn dùng chung hợp đồng `HistorySource` (T082) và `estimateLogging` (T019).

## Parallel Example: User Story 3

```text
# Test (song song, đều phải đỏ):
Task: "Test core/historian/tests/downsample_test.cpp (T052) + vector T051"
Task: "Test core/historian/tests/source_select_test.cpp (T054)"
Task: "Test core/historian/tests/query_limiter_test.cpp, reader_pool_test.cpp (T055)"
Task: "Test core/historian/tests/csv_writer_test.cpp (T057)"
Task: "Test core/auth/tests/roles_test.cpp (T058)"

# Cài đặt độc lập (sau test tương ứng):
Task: "core/historian/query/downsample.* (T060)"
Task: "packages/history-math/src/reduce.ts (T061)"
Task: "core/historian/query/csv_writer.* (T065)"
```

---

## Implementation Strategy

### MVP

1. Phase 1 + 2.
2. US1 (trigger, Kết hợp) và US2 (tổng hợp): **dừng và kiểm** theo quickstart §2–§3.
3. US3 (API): nền của mọi thứ người dùng thấy; **dừng và kiểm** theo quickstart §4.
4. US4 (biểu đồ lịch sử): bản dùng được đầu tiên cho người vận hành.

Bốn story P1 này là bản tối thiểu có giá trị.

### Incremental Delivery

- US5 (báo cáo) và US6 (bar/pie): giá trị cho quản lý.
- US7, US8 (Studio): làm song song với US5–US6 khi có người.
- US9 + Polish: nghiệm thu; đo BL335 cần cho phép.

Mỗi bước giữ `test-x64.ps1` và `npm test` xanh.

---

## Notes

- `[P]` = khác file, không phụ thuộc task chưa xong.
- Task có sai lệch so với kế hoạch: thêm "**Ghi chú khi làm:**" ngay trong task (như tasks.md của 002, 003, 007).
- Không commit khi người dùng chưa yêu cầu, trừ commit mốc cục bộ theo quyền toàn quyền (T163). Làm trên nhánh `010-history-reports`.
- Mục chưa đo trên BL335 ghi "chưa đo" kèm lý do; không báo "xong" thay cho "chưa đo" (Constitution VI).
