# Implementation Plan: Lưu trữ nâng cao, truy vấn lịch sử, biểu đồ lịch sử và báo cáo

**Branch**: `010-history-reports` | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/010-history-reports/spec.md`

## Summary

GĐ 5 của lộ trình v2, phần còn lại sau 003. Bốn khối:

- **Thiết bị (C++):**
  - chế độ ghi `trigger` (kết hợp là `onChange` + `maxIntervalMs`, đã có);
  - **bảng tổng hợp** 1 phút và 1 giờ (`mat_agg`, tín hiệu giữ, ghi cùng giao dịch với dòng thô, khôi phục và dựng bù);
  - **API truy vấn** `GET /api/v1/history/*` (HTTPS, viewer, giảm điểm `minmax`/`lttb`/`decimate`, giới hạn tải, CSV phát dần);
  - ghi eMMC đo thực (`/proc/self/io`), dấu chạy `mat_runs`.
- **Web (Chrome):**
  - bốn widget lịch sử (`history-trend` bằng uPlot có phóng/dịch/con trỏ, `history-table`, `history-bar`, `history-pie`);
  - trang `#/history`, trang báo cáo `#/report/<id>` với dựng CSV/XLSX/PDF trên trình duyệt (`fflate`, `pdfmake` tải lười).
- **Studio 0.8.0:**
  - editor **Lưu trữ** có sửa, khung Ước tính ghi cập nhật khi sửa, chặn mềm khi nạp xuống;
  - editor **Mẫu báo cáo** có xem trước;
  - Toolbox nhóm "Lịch sử".
- **Dùng chung (`packages/*`):**
  - `history-math` (ghép bucket, hàm báo cáo, kỳ, định dạng giờ địa phương, bản TS của giảm điểm cho xem trước);
  - `report-export`;
  - `project-schema` mở rộng (logging 0.2, `reports.json`, ước tính v2, widget lịch sử).

Chi tiết quyết định: [research.md](research.md) R1–R16; ADR 031–034.

## Technical Context

**Language/Version**:
- C++17 (GCC 9 trong Docker Ubuntu 20.04; cross `arm-linux-gnueabihf`);
- TypeScript (packages, runtime-web, Studio);
- PowerShell và Node cho công cụ.

**Primary Dependencies**:
- Có sẵn: SQLite 3.54.0 vendored (003), CivetWeb, nlohmann/json, valijson, Lit, uPlot 1.6.32 (ADR-020), `@mat/tag-sim`, `@mat/project-schema`.
- **Mới ở web (tải lười, chỉ khi bấm xuất):** `fflate` (MIT) cho XLSX; `pdfmake` (MIT) cho PDF; phiên bản cố định, rà ở task T005 (ADR-033). Không thư viện C++ mới.
- Chỉ để kiểm thử (không vào bản build): bộ đọc XLSX và bộ trích chữ PDF trong `devDependencies` của `packages/report-export`.

**Storage**: `${dataDir}/history.db` nâng lên schema 2 (thêm `mat_agg`, `mat_agg_cols`, `mat_runs` và 4 cột của `mat_tables`; không viết lại dữ liệu).

**Testing**:
- GoogleTest + CTest (x64 Docker): aggregator, agg_math, downsample, chọn nguồn, query limiter, reader pool, history query trên DB dựng sẵn, CSV, `roles`, validator, ước tính, IoMeter.
- Vitest: `history-math`, `report-export`, `project-schema` (vector), widget, `HistorySource`, editor Studio.
- Vector chung: `tests/agg-vectors`, `tests/report-vectors`, `tests/project-vectors/logging-010-*`, `tests/widget-catalog-vectors/history-*`, `tests/migration-vectors/logging-0.1-0.2`.
- Tích hợp: `tools/historian-it.ps1` (thêm `kill100`, `agg`), `tools/web-it.ps1` (Chrome headless: biểu đồ, báo cáo, tải), `tools/history-ref` (bản tham chiếu độc lập).
- Đo trên BL335 (cần người dùng cho phép).

**Target Platform**: BL335 (armv7l, Ubuntu 20.04.5, systemd 245, eMMC, RTC không đọc được); Chrome ≥ 120; Studio Windows 10/11.

**Project Type**: dịch vụ nhúng C++ (mở rộng `mat-runtime`), thư viện TS dùng chung, ứng dụng web (runtime-web), ứng dụng desktop (Studio).

**Performance Goals**:
- truy vấn 24 giờ, 8 đường, `auto`: p95 ≤ 2 s trên BL335 với 10 client live (SC-006);
- ghi eMMC ≤ 2 GB/ngày ở cấu hình chuẩn 200 Tag onChange (SC-022);
- tổng hợp 200 Tag thêm ≤ 40 MB/ngày và ≤ 3 điểm CPU (SC-004);
- 10 client live + 2 truy vấn: CPU ≤ 30 %, RSS ≤ 150 MB, khoảng trống live ≤ 1 s (SC-009);
- biểu đồ lịch sử vẽ ≤ 2,5 s, phóng/dịch ≤ 1,5 s (SC-012).

**Constraints**:
- SQLite cache tổng ≤ 32 MiB (ghi 8 + đọc 3 × 4 + gửi ≈ 8 + `alarm.db` 2 của 009 + audit 0,25 ≈ 30,3 MiB, dư 1,7 MiB);
- ≤ 2 truy vấn đồng thời, 1 xuất CSV, quét thô ≤ 64 MiB, hạn 10 s;
- API chỉ HTTPS + đăng nhập; không SQL từ client;
- tải khởi động trang ≤ 250 KB gzip (SC-024 của 007): mã lịch sử và báo cáo tải lười;
- không sửa `schemas/0.1`, `0.2` cũ; ổ D: máy dev gần đầy (DB thử dựng ở `C:` hoặc thư mục tạm).

**Scale/Scope**: ≤ 32 nhóm, ≤ 200 Tag mỗi nhóm (003); ≤ 16 mẫu báo cáo, ≤ 24 cột; ≤ 8 đường mỗi biểu đồ lịch sử; 10 client.

## Constitution Check

*GATE: kiểm trước Phase 0, kiểm lại sau Phase 1.*

| Nguyên tắc | Đánh giá | Ghi chú |
|---|---|---|
| I. Vertical slice trên thiết bị trước | ✅ (cần đo) | Mọi thứ chạy trên x64 trước; nghiệm thu trên BL335 là điều kiện đóng (SC-006, SC-009, SC-022, SC-023 là task ⚠️🔌). Cấu hình JSON viết tay chạy được trước, editor Studio sau (US7, US8) |
| II. Ranh giới kiến trúc | ✅ | Truy vấn nằm ở `core/historian/query` (không mã UI); trình duyệt không chạm DB, chỉ qua API. Báo cáo, ước tính, ghép bucket viết một lần trong `packages/*` cho Studio và Chrome. Hai bản (TS/C++) của `agg_math`, `downsample`, validator, ước tính có vector chung (như expression). `apps/runtime-web` chỉ hiển thị và gọi API; `history-source.ts` chỉ là lớp HTTP |
| III. Ngân sách tài nguyên | ✅ (cần đo) | Ghi: tổng hợp thêm ≈ 37 MB/ngày cho 200 Tag (SC-004) vào ngân sách 2 GB; mốc `agg_built_to` mỗi phút thay vì mỗi commit (R3). Đọc: giới hạn đồng thời, quét, hạn, cache 4 MiB × 3; không tăng RSS nền khi không có truy vấn (kết nối đọc tạo lười, đóng sau 60 s rảnh). Xuất CSV phát dần. Báo cáo dựng ở trình duyệt. Đo SC-006, SC-009 trên BL335 |
| IV. Chrome + 10 client | ✅ | Không thêm phiên live; lịch sử qua HTTPS GET; hàng đợi 2 yêu cầu mỗi trang; Chrome ≥ 120 (uPlot, `fflate`, `pdfmake` đều chạy) |
| V. An toàn mặc định | ✅ | API đọc: HTTPS + đăng nhập viewer, `Sec-Fetch-Site`, tham số allowlist, mọi giá trị là tham số `?`, tên bảng/cột từ cấu hình, không lộ đích/đường dẫn; xuất CSV có audit. Không `eval` (kiểm lint cho `apps/runtime-web`, `packages/*`; `pdfmake` kiểm bản build). Mẫu báo cáo là văn bản thuần; không HTML. Validator hai bản; runtime không kích hoạt project lỗi |
| VI. Test-first | ✅ | Test viết trước cho aggregator (vector), downsample, chọn nguồn, limiter, CSV, validator, ước tính, history-math, báo cáo, widget; tích hợp HTTPS, kill100. Báo cáo trung thực: mục chưa đo ghi "chưa đo" |
| VII. Đơn giản và có phiên bản | ✅ | Đúng phạm vi GĐ 5; **vượt ngân sách chỉ cảnh báo** (chặn mềm ở Studio, không chặn lưu/chạy; D18); schema `logging` 0.2.0, `reports` 0.1.0, `history.db` 2, danh mục 0.5.0 có migration/tương thích; kết hợp không thêm `mode` (D2); không thêm thư viện C++; MQTT ngoài phạm vi (D21) |
| Ràng buộc công nghệ | ✅ | C++17/CMake/Ninja/armhf; SQLite WAL `synchronous=NORMAL` (không ngoại lệ mới: mốc `agg_built_to` và mọi giao dịch mới ở `NORMAL`; `mat_runs` cũng `NORMAL`); cache ≤ 32 MiB; license `fflate` MIT, `pdfmake` MIT (ghi `third_party/LICENSES.md`, ADR-033) |
| Quy trình | ✅ | Spec Kit; ADR 031–034; thao tác BL335 chỉ khi người dùng cho phép, ghi `device-changes.md`; không đụng `atscada-*` |

**Kết quả:** đạt. Có 5 điểm cần biện minh ở Complexity Tracking. Kiểm lại sau Phase 1 (data model, contracts, quickstart): không phát sinh vi phạm mới; một điểm theo dõi: ngân sách cache (30,3 MiB trên 32 MiB, kể cả `alarm.db` của 009) phải đo ở T070.

## Project Structure

### Documentation (this feature)

```text
specs/010-history-reports/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── logging-config-0.2.md   # trigger, tổng hợp, mã lỗi, ước tính v2, vector
│   ├── history-db.md           # schema 2, bộ cộng dồn, khôi phục, dựng bù, phép ghép
│   ├── history-api.md          # catalog, series, aggregate, rows, export.csv, giới hạn, lỗi
│   ├── templates-config.md     # reports.json, navigation, phép tính báo cáo, xuất file
│   ├── widget-catalog-010.md   # 4 widget, HistorySource, hành vi biểu đồ
│   ├── device-010.md           # system/info, runtime.json, CLI, ghi eMMC đo
│   └── studio-010.md           # editor Lưu trữ, Mẫu báo cáo, Toolbox, chặn mềm
├── checklists/
│   └── requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
core/historian/
├── logging_config.*            # + trigger, aggregates, expectedRowsPerDay
├── sampler.*                   # + chế độ trigger
├── aggregator.*                # mới: tín hiệu giữ, cửa sổ phút/giờ, break/clockJump
├── agg_math.*                  # mới: merge, avg, sum, delta (vector chung với history-math)
├── local_store.*               # + schema 2, upsert bucket, dọn bucket, mat_runs, khôi phục, dựng bù
├── historian.*                 # + nối aggregator, IoMeter, dấu chạy, dựng bù ở nền
├── io_meter.*                  # mới: /proc/self/io
├── query/
│   ├── reader_pool.*           # kết nối chỉ đọc, hạn, hủy
│   ├── query_limiter.*         # 429 BUSY, bộ đếm, p95
│   ├── source_select.*         # res=auto, ước tính quét
│   ├── downsample.*            # minmax, lttb, decimate, merge bucket
│   ├── history_query.*         # series, aggregate, rows, gaps, coverage
│   └── csv_writer.*            # CSV phát dần, giờ địa phương
└── tests/                      # + aggregator_test, agg_math_test, downsample_test, source_select_test,
                                #   history_query_test, csv_writer_test, io_meter_test, historian_tool fill-agg

core/project-manager/
├── logging_estimate.*          # ước tính v2
├── rules_010.*                 # E_LOG_TRIGGER/AGG, E_RPT_*, E_WIDGET_HISTORY_*, E_NAV_REPORT
├── project_validator.*         # + reportsFile, navigation.report
└── widget_catalog.*            # + 4 widget, kind logGroup, cờ khe

core/auth/roles.*               # + 5 dòng history/*, cookieAllowed

server/
├── http/history_api.*          # mới: routing, tham số, lỗi, audit export
├── cli/export_history.*        # + --res, --fields
├── cli/verify_aggregates.*, cli/history_stats.*   # mới
├── config.*                    # + historyApi, historyMaxConcurrent, historyQueryTimeoutMs, historyMaxScanMiB, historyReaderCacheKiB
└── main.cpp, device_state.hpp  # nối; apiVersion 1.4.0; system/info (khối historian)

schemas/
├── logging.schema.json         # 0.2 (nhánh 0.1.x và 0.2.x)
├── reports.schema.json         # mới
├── project.schema.json         # + reportsFile, navigation[].report
└── widgets.catalog.json        # 0.5.0

packages/
├── history-math/               # mới: merge/avg/sum/delta, kỳ, báo cáo, định dạng, giảm điểm (bản TS), chọn nguồn
├── report-export/              # mới: CSV, XLSX (fflate), PDF (pdfmake), tải lười, tên file
├── project-schema/src/         # logging 0.2 (types, luật, ước tính), reports.ts, codes.ts, rules-010.ts
├── ui-components/src/
│   ├── widgets/history-trend.ts, history-table.ts, history-bar.ts, history-pie.ts
│   ├── host/history-source.ts  # giao diện
│   └── chart/history-plot.ts   # uPlot + phóng/dịch/con trỏ/bậc thang/vùng
└── tag-sim/                    # + nguồn lịch sử mô phỏng (SimHistorySource)

apps/runtime-web/src/
├── history-source.ts           # HttpHistorySource: hàng đợi, backoff, lưu đệm
├── history-page.ts             # #/history
├── report-page.ts              # #/report/<id>
└── route.ts, menu.ts           # + hai tuyến, mục báo cáo

apps/studio/src/ui/editors/
├── logging-editor.*            # thay logging-view.*: lưới nhóm/Tag, inspector, khung Ước tính ghi, chặn mềm
├── templates-editor.*          # mới: mẫu báo cáo + xem trước
├── navigation-editor.ts        # + mục báo cáo
└── device-page.ts              # + số đo lưu trữ

projects/history-demo/          # project 0.2 mẫu: 4 chế độ, tổng hợp, 3 mẫu báo cáo, màn hình lịch sử
tests/{agg-vectors,report-vectors,migration-vectors,historian-it,web-it}/
tools/{history-ref, historian-it.ps1 (+kill100, agg), web-it.ps1, load-tester (+truy vấn)}
docs/
├── adr/031…034-*.md
├── architecture/mockups/studio-history.html
├── deployment/mat-runtime.md   # + truy vấn, giới hạn, đo ghi
└── reports/                    # số đo 010 (acceptance, bench)
```

**Structure Decision:** `core/historian/query` tách khỏi `historian` ghi để truy vấn dùng kết nối riêng và test được trên DB dựng sẵn mà không cần thread ghi. Phần "nói chuyện HTTP" (`server/http/history_api.*`) mỏng: kiểm tham số, gọi `history_query`, định dạng JSON/CSV. Phép ghép và hàm suy ra có hai bản (C++ `agg_math`, TS `history-math`) kiểm bằng cùng vector. `packages/history-math` không phụ thuộc DOM (chạy trong Studio, Chrome, Node test); `packages/report-export` tách riêng để tải lười.

### Ghi chú thiết kế chính

- **Thread:**
  - `historian` (có sẵn) thêm: bộ cộng dồn chạy trong cùng lượt lấy mẫu 100 ms; bảo trì thêm dọn bucket và dựng bù (≤ 20 ms mỗi lượt, chung ngân sách với dọn dòng thô); `IoMeter` lấy mẫu mỗi 60 s;
  - truy vấn chạy trên luồng worker CivetWeb của yêu cầu (có giới hạn đồng thời), dùng kết nối từ `reader_pool` (tối đa 3, tạo lười, đóng sau 60 s rảnh), hạ ưu tiên luồng khi bắt đầu và khôi phục khi xong;
  - không thêm luồng nền cố định.
- **Thứ tự bảo vệ** khi trả lời một yêu cầu: tham số → quyền → giới hạn đồng thời → ước tính quét → mở giao dịch đọc → chạy với hạn và cờ hủy → định dạng → nhả. Mọi nhánh từ chối trước bước mở giao dịch không chạm dữ liệu.
- **Tương thích:** project không có `reportsFile` hay `aggregates` chạy như 003/007. Runtime 0.8 gặp `logging.json` 0.2 từ chối (`E_SCHEMA_VERSION`); gặp DB schema 2 vẫn chạy. Runtime 0.9.0: `RUNTIME_VERSION`, `kDeviceApiVersion` = 1.4.0.
- **Hiệu năng ghi:** bucket mỗi phút gom vào commit gần nhất; mốc `agg_built_to` cùng giao dịch; `mat_runs.alive_ms` mỗi 60 s; không thêm commit mới.
- **Khôi phục khởi động:** thứ tự mở DB → nâng schema → `ensureTables` (thêm `cid`) → khôi phục bucket từ mốc → ghi `mat_runs` → bật bộ cộng dồn với `break()` → bắt đầu thread; dựng bù chạy nền sau cùng.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Thêm tối đa 3 kết nối SQLite đọc và luồng hạ ưu tiên | FR-028: truy vấn không chặn writer; WAL cho đọc song song; hạn và hủy bằng progress handler | Dùng kết nối của historian: truy vấn chặn ghi (một writer duy nhất, kết nối không thread-safe). Tiến trình riêng: thêm RAM và IPC, xem lại nếu đo cho thấy cần (ADR-032) |
| Bảng tổng hợp ghi thêm khoảng 37 MB/ngày cho 200 Tag | Truy vấn 24 giờ ≤ 2 s và báo cáo không thể đọc dòng thô (R4) | Chỉ dòng thô: 24 giờ phải quét ≈ 150 MB, vượt 2 s và gây tranh chấp với ghi. Tổng hợp khi truy vấn: chính là chi phí cần tránh |
| Hai bản `agg_math` (C++) và `history-math` (TS), hai bản giảm điểm | Máy chủ ghép bucket và giảm điểm; trình duyệt ghép tiếp và dựng báo cáo; Studio xem trước bằng mô phỏng | Chỉ làm ở máy chủ: báo cáo phải gọi nhiều lần theo kỳ, tốn CPU BL335. Chỉ làm ở TS: C++ vẫn cần `avg`/`sum` cho CSV. Vector chung bắt lệch (như expression) |
| Hai thư viện web mới (`fflate`, `pdfmake`) | FR-042: XLSX và PDF dựng trên trình duyệt; tiếng Việt trong PDF cần phông và bố cục bảng | Tự viết PDF: phải tự nhúng TrueType, rủi ro lớn. In của trình duyệt: không có tệp để kiểm tự động; chỉ là phương án dự phòng (ADR-033) |
| Hai package mới `history-math`, `report-export` | Constitution II: một nơi cho Studio và Chrome; tải lười phần xuất | Đặt trong `apps/runtime-web`: Studio không dùng được, vi phạm II |
| Thêm 4 widget thay vì mở rộng `line/bar/pie` | Nguồn dữ liệu và tương tác khác (R11, D17) | Cờ `source: history` trong widget thời gian thực: hai chế độ trong một widget, bộ đệm và trạng thái xung đột, kiểm tra phức tạp |
