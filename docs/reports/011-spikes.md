# Báo cáo spike T008, T011, T012 (feature 011)

Ngày: 2026-10-16. Máy: macOS Apple Silicon; mọi bước build và chạy trong Docker image `mat-armhf` (Ubuntu 20.04 arm64, g++ 9.4, `arm-linux-gnueabihf-g++` 9.4, `qemu-user` 4.2.1, OpenSSL 1.1.1f). "Host" ở đây là Linux arm64, không phải x64. Mã thử của spike để ngoài repo (`/Users/lab/build/spike-011/`), không commit. Căn cứ: [tasks.md](../../specs/011-pilot-hardening/tasks.md) T008, T011, T012; [research.md](../../specs/011-pilot-hardening/research.md) R11, R13, R14, R16, R17; [contracts/update-package.md](../../specs/011-pilot-hardening/contracts/update-package.md); [ADR-035](../adr/035-release-trust-ota.md).

## 1. T008: spike `mat-update-verify`

**Đã chạy.** Chương trình C++17 ≈ 270 dòng (`/Users/lab/build/spike-011/verify/mat_update_verify.cpp`): đọc tiêu đề tar 1 (`update.json`, ≤ 256 KiB) và 2 (`update.sig`, ≤ 128 B) theo contract §1 (tổng kiểm 512 byte, magic `ustar`, `typeflag` `0`/NUL, chặn `x`/`g`/`L`/`K`, tên, trần kích thước); SHA-256 của manifest; `mbedtls_pk_verify` (ECDSA P-256, DER) thử lần lượt từng khóa PEM SPKI, in `keyId` = `sha256:` + SHA-256 của DER SPKI; manifest bằng nlohmann/json (vendored); tiêu đề 3 và băm dòng `payload.tar.gz` (khối 64 KiB) so với `payloadSha256`, `payloadSize`; khối kết thúc phải bằng 0 (không có thành viên thứ tư); in `file<TAB>path<TAB>sha256<TAB>mode`. Mbed TLS 3.6.7 (`third_party/mbedtls`). Khóa thử và chữ ký: `openssl ecparam -name prime256v1`, `openssl dgst -sha256 -sign` (OpenSSL 1.1.1f trong container) và Node 24 `crypto.sign('sha256', …)` (DER mặc định); gói dựng bằng Python `tarfile` (ustar).

**Số đo:** bảng đầy đủ ở ADR-035 mục "Số đo". Tóm tắt:

| Điều kiện | Kết quả | Đạt |
|---|---|---|
| kích thước ≤ 400 KB | tĩnh hoàn toàn: 465 KiB (có nlohmann), 397 KiB (không nlohmann); glibc động + libstdc++/libgcc tĩnh: 142 KiB (cấu hình Mbed TLS tối thiểu), 154 KiB (cấu hình của runtime) | tĩnh hoàn toàn: **không**; glibc động: **có** |
| kiểm một chữ ký ≤ 100 ms | 9,4–10,6 ms dưới **qemu** (Apple Silicon); host arm64 0,85 ms | **có dưới qemu**; Cortex-A7 chưa đo |
| vector openssl và Node | cả hai kiểm đúng; Node kiểm đúng chữ ký openssl | có |
| ca xấu | 11/11 bị từ chối đúng mã (chữ ký, khóa lạ, sửa manifest, sửa payload, thành viên thứ tư, sai thứ tự, pax, tổng kiểm, quá cỡ, cắt ngang, không khóa) | có |

**Kết luận và quyết định đề xuất:**

1. ECDSA P-256 với `mbedtls_pk_verify` dùng được, không cần thư viện mới; chữ ký DER của openssl và Node tương thích.
2. Kích thước bản tĩnh do glibc tĩnh quyết định (≈ 330–370 KB chỉ cho `puts`/`std::string`), không phải Mbed TLS (≈ 30 KB). Đề xuất cho T111: liên kết Mbed TLS và libstdc++ tĩnh, **glibc động** (phụ thuộc `libc.so.6`, `ld-linux-armhf.so.3`, ký hiệu cao nhất `GLIBC_2.25`, giống `mat-runtime`), dùng lại `mat_mbedtls` với cấu hình hiện có (`--gc-sections` loại phần TLS: 154 KiB); điều kiện T008 đổi thành "≤ 400 KB, chỉ phụ thuộc libc".
3. Thời gian trên Cortex-A7 chưa biết; qemu không đại diện. T122 chạy `--bench 50` trên BL335. Nếu > 100 ms thì cân nhắc bỏ thử nhiều khóa (đọc `keyId` trước) và vẫn giữ P-256.
4. Phát hiện cho thiết kế: phải kiểm chữ ký **trước** khi phân tích JSON (mã spike làm vậy); khi thử nhiều khóa, mỗi khóa sai tốn thêm một lần kiểm (17,8 ms cho hai khóa dưới qemu): nên giới hạn số khóa trong `trusted-keys` (đề xuất ≤ 4).

## 2. T011: spike SAST trong container

**Đã chạy.** Kiểm `cppcheck`, `clang-tidy` trong `mat-armhf`: **cả hai không có** (đúng dự đoán). Không sửa `deployment/toolchain/Dockerfile` (việc của T056). Chạy trong container dùng một lần (`docker run --rm --name sast-spike-… -v <repo>:/src:ro mat-armhf`), `apt-get install cppcheck clang-tidy` (13 s, cần mạng), cấu hình CMake x64 Debug với `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` ở `/Users/lab/build/spike-011/sast/build` (502 mục). Phạm vi: 16 tệp `.cpp` của `core/auth/` và `drivers/modbus/` (≈ 4 860 dòng, không gồm `tests/`), `-j2`.

**Phiên bản gói (Ubuntu 20.04):** `cppcheck` 1.90-4build1 (Cppcheck 1.90); `clang-tidy` 1:10.0-50~exp1 → `clang-tidy-10` 1:10.0.0-4ubuntu1 (LLVM 10.0.0).

| Công cụ, bộ kiểm | Thời gian | Phát hiện trong phạm vi |
|---|---|---|
| cppcheck `--enable=warning,style,performance,portability` | 1 s | 11 (1 warning, 10 style) + 1 ở `core/audit/audit_actions.hpp` (ngoài phạm vi, kéo vào qua include) |
| clang-tidy mặc định (`clang-analyzer-*`, `clang-diagnostic-*`) | 13 s | 1 |
| clang-tidy mở rộng (`clang-analyzer-*,bugprone-*,cert-*,performance-*,portability-*,concurrency-*`, bỏ `bugprone-easily-swappable-parameters`), có và không `-header-filter` cho hai thư mục | 19–20 s | 2 |

Chi tiết:

- cppcheck `useStlAlgorithm` ×9 (gợi ý `std::find_if`/`transform`/`accumulate`; phong cách, không phải lỗi), `noExplicitConstructor` ×1 (`core/auth/account_store.hpp:115`, `AccountStore` một đối số không `explicit`), `virtualCallInConstructor` ×1 (`drivers/modbus/modbus_tcp_driver.hpp:123`: `stop()` ảo gọi trong hủy `~ModbusTcpDriver()`).
- clang-tidy `clang-analyzer-optin.cplusplus.VirtualCall` (`drivers/modbus/modbus_tcp_driver.cpp:155`, cùng chỗ với cppcheck); `performance-inefficient-vector-operation` (`drivers/modbus/codec.cpp:71`, thiếu `reserve`).
- Đánh giá: không có phát hiện mức lỗi bảo mật. Gọi `stop()` ảo trong hủy chỉ sai nếu có lớp con ghi đè `stop()`; hiện không có lớp con: sửa bằng `final` cho lớp hoặc gọi `ModbusTcpDriver::stop()` tường minh (task sửa riêng, không làm trong spike).

**Quyết định đề xuất cho T056:** thêm `cppcheck` và `clang-tidy` (gói `clang-tidy`, tức clang-tidy-10) vào `deployment/toolchain/Dockerfile` (image tăng vài trăm MB, cần đo khi build); cổng CI dùng bộ kiểm mở rộng ở trên và cppcheck `warning,performance,portability` (để `style` ở mức báo cáo, vì 9/11 là `useStlAlgorithm`); cơ sở: 0 phát hiện mức `warning` sau khi sửa hoặc ghi ngoại lệ có lý do ở `tools/sast/` cho 2 chỗ trên. Thời gian cho hai thư mục ≈ 20 s với `-j2`; toàn bộ `core/`, `drivers/`, `server/` ước 3–5 phút (chưa đo). clang-tidy cần `compile_commands.json` (cấu hình CMake trước, 0–1 s khi đã có build dir).

## 3. T012: spike thu thập eMMC

**Đã chạy.** Trong Docker không có eMMC thật nên không đo. Để định dạng không dựa vào trí nhớ: cài `mmc-utils` **0+git20180327.b4fe0c8c-1** trong container dùng một lần và trích chuỗi `printf` của lệnh `mmc extcsd read` bằng `strings` (không truy cập mạng ngoài kho apt). Các dòng sức khỏe xác nhận nguyên văn:

```text
eMMC Life Time Estimation A [EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_A]: 0x%02x
eMMC Life Time Estimation B [EXT_CSD_DEVICE_LIFE_TIME_EST_TYP_B]: 0x%02x
eMMC Pre EOL information [EXT_CSD_PRE_EOL_INFO]: 0x%02x
```

và tiêu đề `Extended CSD rev 1.%d (MMC %s)` giữa hai dòng `=====`; ba dòng sức khỏe chỉ có khi EXT_CSD rev ≥ 7.

**Đã tạo** trong `tools/soak/fixtures/`: `extcsd-healthy.txt` (0x01/0x01/0x01), `extcsd-worn.txt` (0x09/0x0a/0x02), `extcsd-eol.txt` (0x0b/0x0b/0x03), `extcsd-emmc45-no-health.txt` (rev 1.6, không có dòng sức khỏe), và `README.md` (nguồn định dạng, giải mã JEDEC, biểu thức chính quy gợi ý cho `analyze.mjs`, lệnh chỉ đọc cho T013, danh sách lệnh `mmc` ghi cấm chạy).

**Giới hạn (ghi rõ):** giá trị là giả lập; thứ tự các dòng khác theo thứ tự chuỗi trong nhị phân; dải `VENDOR_SPECIFIC_FIELD`, `CONTEXT_CONF` theo bố cục JEDEC, chưa kiểm từ mã nguồn; chưa đối chiếu với đầu ra thật của BL335 và bản `mmc-utils` mới hơn có thể khác. Bộ phân tích chỉ nên dựa vào 3 dòng khóa và dòng rev.

**Quyết định đề xuất:** T013 kiểm cả hai đường: `mmc extcsd read` (nếu có `mmc-utils`) và sysfs `/sys/block/mmcblk0/device/life_time`, `pre_eol_info` (nếu nhân có); chép đầu ra thật vào `tools/soak/fixtures/extcsd-bl335.txt`. `analyze.mjs` nhận cả hai nguồn; không có nguồn nào thì báo "không đo được tuổi thọ eMMC" (không xanh giả) và chỉ dùng `/sys/block/mmcblk*/stat` trường 7 (sector đã ghi) cho ước lượng ghi/ngày (R13).

## 4. Tệp đã đổi trong repo

- `docs/adr/035-release-trust-ota.md`: thêm mục "Số đo" (T008).
- `docs/reports/011-spikes.md` (tệp này).
- `tools/soak/fixtures/README.md`, `tools/soak/fixtures/extcsd-*.txt` (4 tệp).
