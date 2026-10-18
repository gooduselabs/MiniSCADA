# Bàn giao — từ GĐ 0–5 sang GĐ 6 (feature 011 "pilot-hardening")

Lập ngày **2026-10-16**; **mục 0 (trạng thái GĐ 6) cập nhật 2026-10-19**. Dành cho người tiếp nhận: kỹ sư hoặc phiên Claude mới trên **máy mới**. Máy cũ có bộ nhớ riêng (memory) mà máy mới không có, nên mọi điều cần biết nằm ở đây. Đọc theo thứ tự: tài liệu này, `CLAUDE.md`, `.specify/memory/constitution.md` (2.0.2), `docs/plans/roadmap-v2.md`, `docs/architecture/studio-ux.md`.

Ngôn ngữ trao đổi và tài liệu: tiếng Việt. Code và identifier: tiếng Anh.

**Quan trọng về bảo mật:** repo này **công khai** (`github.com/gooduselabs/MiniSCADA`). Không bao giờ commit mật khẩu, token, địa chỉ IP công khai hoặc cổng SSH của thiết bị, hay vân tay chứng chỉ. Thông tin truy cập thiết bị do người dùng cung cấp trực tiếp, không nằm trong repo. Lịch sử đã được làm sạch các giá trị này (xem mục 9).

## 0. Trạng thái GĐ 6 ngày 2026-10-19 (đọc trước)

Nhánh làm việc `gd6` (cộng nhánh tài liệu `gd6-final-docs` chờ gộp), chưa push. Phiên bản: Studio và runtime **`1.0.0-rc.1`**; API 1.5.0, live 1.3.0, định dạng project 1.0.0, `.matupdate` 1.0.0. Chi tiết từng task ở "Ghi chú khi làm" của `specs/011-pilot-hardening/tasks.md`; tổng hợp ở `docs/reports/011-acceptance.md` (bản nháp, chờ T198) và `011-fr-matrix.md` (đếm lại 2026-10-19: **FR 108 Đạt, 1 Không đạt (FR-135: nghiệm thu còn nháp), 3 Chưa đo, 31 Chờ người; SC 27, 0, 2, 14**). Người dùng giao toàn quyền hoàn thành GĐ 6 (2026-10-16) và cho phép SSH qua LAN tới BL335 (thông tin truy cập: xem memory, không ở repo).

**Mọi việc tự làm được của GĐ 6 đã xong**, trừ các ghi chú nhỏ ở 0.5. Phần còn lại cần người, Windows, khách hàng hoặc Go/No-Go.

### 0.1 Đã xong

- **Rà soát bảo mật hai lần:** T062 và T202. 0 Critical/High mở; K1 (High, phát lại `keyset`), mọi Medium (U3, U4, M1, LG1–LG6, F1–F3, N-OTA1–3) và Low đã sửa kèm test. **O1** (rollback không ký) chấp nhận là rủi ro còn lại, **O2** (một khóa gỡ mọi khóa) hoãn sau pilot (ADR-035). Phát hiện Low của T200 (dòng 421 dùng chung ngân sách audit với đăng nhập sai) đã sửa ở `gd6-audit-budget`.
- **`1.0.0-rc.1` (T191)** và **hồi quy (T200, T059):** `ci-local` đầy đủ xanh trên gd6 cuối; `ci-local -Sanitize` ctest ASan + UBSan 5.946/5.948 (2 `MallocTuning` bỏ qua có lý do); so cặp 0.9.0 ↔ rc.1 không hồi quy (`011-regression-pair.md`). Bộ cài Studio và Authenticode chuyển sang T102/T104 (Windows).
- **Đo trên BL335:** L1 500 Tag × 10 client × 4 giờ (T079): CPU 28,9 % một lõi (14,5 % cả máy), đỉnh 50,4 %, RSS ≤ 19,5 MB, 0 mất sequence; L3, L4 (F5 ≤ 935 ms), L5 (≥ 53,4 FPS), L8 đạt; **L2 1.000 Tag (T080): 43,8 %, RSS 12,8 MB, Đạt**; **logic tối đa (T148, releaseSeq 13, quét theo sự kiện): +2,5 điểm CPU, +3,8 MB, quét 1,05 ms — Đạt**; L3 bằng `load-tester -reentry` (FR-038): đóng sạch 9 ms, im lặng 15 s; T063 (40 TLS im lặng, Host 421); T013 (eMMC qua sysfs, sshd cho root bằng mật khẩu); OTA thật T122 10/10 (ngừng 13,2–15,9 s).
- **Lượt x64** (Docker Linux arm64 trên Apple Silicon, không phải x64 thật): T075 tải; **T076 soak S0 24 giờ xong** (48/48 đoạn, 0 mất sequence, 47 `kill -9`, 9/9 nạp xuống, RSS ≤ 34,1 MB; **rig đã dừng và dọn**); **T077 mất điện xong** (100 vòng + D1, D3, D4, D5 × 10, D2 qua `update-it kill` 40/40); T078 cắt mạng 500/500; T146 `logic-it`; T147 L1 1 giờ (xem 0.5).
- **Fuzz (T058 xong):** TS và C++ ASan + UBSan mọi mục tiêu ≥ 1 giờ, 0 sự cố.
- **Báo cáo và ngân sách (T087, T201 xong 2026-10-19):** `011-load.md`, `011-soak.md`, `011-powercut.md` có trạng thái từng chỉ tiêu Master Plan §6 và test-protocols, §Kết luận; bảng tổng hợp ngân sách `011-load.md` §1.7; ADR-005 "Cập nhật 011". Quyết định: CPU đọc theo một lõi; eMMC kết luận theo phần ghi của mat (`sqlite-vfs`) vì nền thiết bị 2,6–4,7 GB/ngày khi mat tắt — chưa đo trên thiết bị, chờ soak bàn thử T196.
- **Nghiệm thu nháp (T205) và bảng FR/SC (T204)** làm mới 2026-10-19; T205 chưa đánh dấu vì cần T198.
- Khác: T010, T203 phần chữ, T206 `device-changes.md` mọi thay đổi 2026-10-17/18 kèm hoàn tác, T207 commit mốc.

### 0.2 Đang chạy

Không có. Soak x64 (compose project `mat-soak-x64`) đã thu kết quả, dừng và dọn.

### 0.3 Thiết bị BL335 lúc này

Runtime **`1.0.0-rc.1` releaseSeq 13** (cài bằng `deploy.sh` 2026-10-18 12:32, commit `af6d129a`), `.prev` là releaseSeq 12; project `tank-demo` 0.1.0; `runtime.json` gốc (SHA-256 khớp); OTA tắt; không khóa tin cậy; tài khoản tạm `mat-t079-*`, `mat-t122-adm` ở trạng thái tắt. **OTA chỉ nhận gói có `releaseSeq` > 13**, trừ khi cài lại bằng `deploy.sh` (không chặn releaseSeq thấp hơn).

### 0.4 Bẫy môi trường học được ở GĐ 6

- **Máy ảo Docker khoảng 2,8 GB RAM:** build C++ dùng `-j1` hoặc `-j2` (build ASan `-j2` bị OOM-kill `cc1plus` 25 lần); `test-armhf.sh` đọc `MAT_BUILD_JOBS` (mặc định 2). Hai build C++ cùng lúc hoặc build cạnh tải đo làm số đo sai (lượt cắt mạng đầu có 16 lần > 35 s vì vậy).
- **`pwsh` bị chặn trong agent con chạy ở worktree:** script `.ps1` (`ci-local.ps1`, `release.ps1`, `web-it.ps1`, …) phải do phiên chính chạy; agent con dùng bản Node tương ứng (`tools/logic-it/run.mjs`, `tools/powercut/x64-run.mjs`, `tools/load/x64.mjs`) hoặc bản shell của `package-runtime.ps1`.
- **`release.ps1` trên macOS:** không truyền `-Verifier` (bản `mat-update-verify` armhf không chạy được trên máy này; dùng bộ kiểm Node).
- **`maxLiveClientsPerSource` mặc định 5:** bàn đo 10 client từ một máy phải đặt `"maxLiveClientsPerSource": 10` trong `runtime.json` (thiết bị: đặt tạm rồi khôi phục, ghi `device-changes.md`); `driver-it` truyền `--max-live-clients-per-source 10`.
- **Sinh lại vector trước test:** `node tests/package-vectors/generate.mjs --out` trước ctest trên cây mới (thiếu thì 14 ca `PackageVector` đỏ); mỗi lần `cmake` configure đóng dấu `MAT_BUILD_EPOCH_S` mới nên build lại gần hết cây: configure một lần.
- Dưới ASan, `RulesLogic.TheOrderOfALongChainNeedsNoDeepStack` cần chạy riêng (hết RAM khi `-j3`); `AlarmStorm` bỏ kiểm thời gian khi có ASan; `MallocTuning` bỏ qua dưới ASan.
- Gói runtime phải chép mọi bộ `schemas/<bản>/` (lỗi thiếu `schemas/0.6` ở 1.0.0 đã sửa, `deploy.sh` đòi `schemas/0.6`).

### 0.5 Việc còn lại

**Ghi chú còn mở, không chặn rc (tự làm được nếu muốn):**

- **T079** (chưa đánh dấu): cài/chạy `mat-sample` trên BL335, L1 xen kẽ 8443 (cần `wss://` trong `load-tester`), RSS tab ở L5. Các ngưỡng của SC-011 đã Đạt; lỗi gói thiếu `schemas/0.6` đã sửa.
- **T147** (chưa đánh dấu): L7 trên x64 64 bit RSS +5,4 MiB (ngưỡng +5 MB) ở L1 1 giờ; BL335 +3,8 MB đạt nên chỉ báo. Nếu cần: lấy `smaps`, hoặc đo cặp project có cùng 200 Tag nội bộ ở hai bên (`011-load.md` §1.6).
- T189: collector dùng viewer nhưng `audit` đòi administrator (ghi `FORBIDDEN`).

**Cần Windows:** T009 (spike signtool), T088, T091–T094, T098, T102 (dựng bộ cài NSIS, ký thử, `release.ps1` đủ 9 bước, ca hỏng 1–5), T167 (Telex/Unikey, NVDA), ảnh chụp Studio cho T203, đo lại `screen-perf` trên Windows.

**Cần người, công ty hoặc khách hàng:** T064 (gia cố SSH, đổi mật khẩu root, có người ở cạnh), T082 (datasheet eMMC), T083–T086 và T123 (bộ điều khiển nguồn, cắt mạng), T149 (PLC hoặc giả lập do người dùng chọn), T103–T105 (chứng chỉ ký mã thật, khóa phát hành ngoại tuyến, Windows sạch), T150, T186 (người thử, huấn luyện), T192–T197 (pilot, gồm soak 30 ngày bàn thử và eMMC ở T196).

**Cuối cùng:** **T198** (Go/No-Go, Tech Lead ký; không có pilot thật thì "Chưa đo" và không gắn 1.0.0), rồi đánh dấu T205 và **T208** (`/speckit-analyze` cuối; ADR 035–038 Accepted chỉ khi Go).

**Không làm ở GĐ 6:** T081 (soak 7 ngày BL335): **hủy theo quyết định người dùng 2026-10-18**; thay bằng T076, T079 L1 4 giờ và soak 30 ngày bàn thử khi pilot (T196). SC-013 ghi "Chưa đo — hoãn theo quyết định người dùng".

## 1. Tóm tắt

mAT SCADA là SCADA mini chạy trên BL335 (Allwinner T113-i, armhf, 1 GB RAM): `mat-runtime` (C++17) phục vụ trang xem trên Chrome; `mAT Studio` (Tauri 2, Windows) để thiết kế project và nạp xuống thiết bị. Lộ trình v2 chia thành GĐ 0–6.

**GĐ 0–5 đã xong về mã và test trên x64 (và qemu armhf):**

| GĐ | Feature | Nội dung |
|---|---|---|
| 0 | 001, 002, 003 | Xác thực nền tảng, vertical slice, lưu trữ dữ liệu Tag |
| 1 | 004 studio-shell, 005 device-online | Khung Studio kiểu IDE (TIA Portal), HTTPS, đăng nhập Argon2id, role, audit, tìm thiết bị, nạp xuống atomic, đọc lên, so sánh |
| 2 | 006 tags-modbus | Tag Engine, driver Modbus TCP/RTU, đường ghi, biểu thức TS/C++ dùng chung vector |
| 3a | 007 screens-widgets | Màn hình, 15 widget, ghi từ Chrome (cookie + CSRF) |
| 3b | 008 svg-import-binding | Nhập SVG (allowlist), 13 loại hoạt ảnh, gắn Tag, ký hiệu, nhập lại giữ UID |
| 4 | 009 alarms | Alarm theo ISA-18.2, `alarm.db`, banner, trang alarm |
| 5 | 010 history-reports | Lịch sử, tổng hợp, biểu đồ, báo cáo XLSX/PDF |

**Phiên bản lúc bàn giao GĐ 5 (2026-10-16):** runtime 0.9.0; API 1.4.0; live 1.3.0; định dạng project 0.6.0 (schema 0.3–0.5 đóng băng trong `schemas/`); Studio 0.8.0; `@mat/ui-components` 0.3.0. **Hiện tại (2026-10-18):** xem mục 0 (`1.0.0-rc.1`).

**Triển khai:** ngày 2026-10-16 BL335 chạy runtime 0.9.0, project `tank-demo` 0.1.0 (`docs/reports/release-0.9.0.md`). Hiện chạy `1.0.0-rc.1` releaseSeq 13 (mục 0.3; `docs/reports/device-changes.md` mục 2026-10-18).

**GĐ 6 (feature 011):** đang làm từ 2026-10-16, trạng thái ở mục 0; spec/plan/tasks tại `specs/011-pilot-hardening/`. Constitution 2.0.2 (PATCH, 2026-10-16) đã mở khóa ghi PLC từ logic và OTA.

## 2. Bắt đầu trên máy mới

```
git clone https://github.com/gooduselabs/MiniSCADA.git
cd MiniSCADA
git config user.name "Trần Đức Hải"
git config user.email "info@gooduselabs.com"
git checkout -b gd6 main
```

Nhánh `main` là toàn bộ công việc GĐ 0–5 (lịch sử đã làm sạch). Làm việc trên nhánh riêng và commit cục bộ từng mốc; **chỉ push khi người dùng yêu cầu**.

**Công cụ cần có (Windows 10/11):**

- Git (Git Bash), Node.js LTS + npm, Rust (MSVC) qua rustup, Visual Studio với workload C++ (hoặc Build Tools), WebView2.
- Docker Desktop (toolchain armhf, test x64, qemu). Image `mat-armhf` được dựng từ `deployment/toolchain/` bởi các script.
- Inkscape 1.4.x CLI (so ảnh render), Chrome ≥ 120 (puppeteer-core dùng Chrome cài sẵn).
- PowerShell 5.1 (có sẵn). Các script `.ps1` giữ chuỗi Write-Host thuần ASCII.
- Python không cần.

**Lần đầu:** `npm install` ở gốc (workspaces), rồi `npm run typecheck`, `npm test`.

**Nhập memory của Claude từ máy cũ:** `bash docs/handoff/memory/import-memory.sh` (xem `docs/handoff/memory/README.md`). File `bl335-ssh-access.md` gốc (địa chỉ, mật khẩu thiết bị) không nằm trong repo; người dùng chuyển tay.

### Máy mới là macOS (đã kiểm chứng 2026-10-16, MacBook Apple Silicon)

Toàn bộ công việc GĐ 0–5 làm trên Windows. Từ 2026-10-16 việc phát triển chuyển sang macOS (Apple Silicon, arm64). Các script đã được sửa để chạy trên cả hai.

**Cài đặt (một lần):**

```
brew install go rustup && rustup default stable          # rustup: thêm /opt/homebrew/opt/rustup/bin vào PATH
npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/mat-chrome
export CHROME_PATH=~/.cache/mat-chrome/chrome-headless-shell/<bản>/chrome-headless-shell-mac-arm64/chrome-headless-shell
```

- **PowerShell 7 (`pwsh`):** `brew install --cask powershell` cần sudo; nếu không có quyền admin, giải nén bản `powershell-<ver>-osx-arm64.tar.gz` (kiểm SHA-256 theo `hashes.sha256` của bản phát hành) vào `~/.local/pwsh` và link `~/.local/bin/pwsh`. Chạy script bằng `pwsh -File tools/ci-local.ps1 ...`.
- **Chrome:** Google Chrome bản thường (155) không chạy headless khi khởi chạy từ tiến trình nền (lỗi `FATAL: Failed to get the path for 1001`). Dùng `chrome-headless-shell` (Chrome for Testing) như trên; mọi runner đọc `CHROME_PATH`, danh sách dự phòng có thêm đường dẫn `/Applications/Google Chrome.app`.
- **Inkscape:** `make-inkscape.ps1` tự tìm `/Applications/Inkscape.app` hoặc `inkscape` trên PATH.

**Đã sửa để chạy trên macOS (nhánh `gd6`):**

- `tools/lib/platform.ps1` (mới): thư mục build gốc `MAT_BUILD_ROOT`, mặc định `C:\build` trên Windows và `~/build` trên macOS/Linux; `curl.exe`/`curl`, `NUL`/`/dev/null`, `$env:TEMP`, đuôi `.exe` của `load-tester`. Mọi `tools/*.ps1` có mặc định `C:\build\<tên>` giờ dùng `Get-MatBuildDir '<tên>'`. Các lệnh trong tài liệu ghi `C:\build\<tên>` thì trên Mac là `~/build/<tên>`.
- Runtime-web e2e: LibreSSL của macOS bỏ qua `-pkeyopt ec_paramgen_curve` và ghi khóa EC có tham số đường cong tường minh, client TLS từ chối (`ERR_SSL_PROTOCOL_ERROR`). `fake-runtime.mjs` giờ sinh khóa P-256 bằng Node, `openssl` chỉ ký chứng chỉ.
- Studio e2e: trên macOS `Ctrl+A` trong ô chữ là "về đầu dòng", không phải chọn hết. Helper `press()` gửi thêm lệnh soạn thảo `selectAll` cho `Control+a` (ứng dụng vẫn nhận Ctrl+A như trên Windows).
- `tests/package-vectors/out/` không commit: chạy `node tests/package-vectors/generate.mjs --out` trước ctest trên máy mới (thiếu thì 14 ca `PackageVector` đỏ, đúng thiết kế).

**Docker Desktop cho Mac:** image `mat-armhf` dựng native arm64 không cần `--platform` (Ubuntu 20.04 arm64 có đủ `gcc-arm-linux-gnueabihf` 9.4, cùng phiên bản với bản amd64). Build armhf ra đúng ELF ARM 32-bit EABI5. Test "x64" thực chất chạy trên Linux arm64 (`char` không dấu như armhf). Máy ảo Docker mặc định 4 CPU, 3 GB RAM: dùng `-Parallel 4 -BuildJobs 3`, không chạy hai build C++ cùng lúc. Khi Docker đang bận, Vitest của `@mat/svg-import` có thể đỏ do quá thời gian (3 ca); chạy lại khi máy rảnh.

**Chỉ làm được trên Windows:** bộ cài Studio NSIS (`npm run tauri build` ra `.exe`), smoke chạy Studio thật bằng WebView2 (`tools/measure/studio-smoke.mjs --exe`), ký số bộ cài (US3 của 011), kiểm NVDA. Trên Mac chạy được (đã kiểm): e2e Studio và runtime-web trong Chrome headless (puppeteer-core + axe), `cargo test --lib` (147 ca), toàn bộ C++ trong Docker, Vitest, lint.

- **Mẹo shell:** các bẫy `\\` và backtick ở trên áp dụng cho mọi shell; dùng công cụ ghi file cho nội dung có regex hay Markdown. macOS không có `timeout`; `openssl req` không có `-new` sẽ chờ đọc stdin.
- Ghi chú về ổ D: gần đầy và Visual Studio trong `memory/dev-machine-env.md` chỉ áp dụng cho máy cũ.

**Bẫy môi trường đã gặp (đọc trước khi build):**

- Ổ chứa repo nên có ≥ 15 GB trống. Đặt thư mục build ngoài repo (`C:\build\<tên>`): test C++ dùng `deployment/toolchain/test-x64.ps1 -BuildDir C:\build\x64 -Filter <regex> -Target <target>`; build Rust Studio đặt `CARGO_TARGET_DIR` ngoài repo.
- Test C++ chạy mỗi ca vector khoảng 5 giây trên bind mount Windows. Để chạy cả bộ nhanh: chép mã vào một Docker volume rồi `ctest -j12` (khoảng 5 phút). `test-x64.ps1` có tham số `-Parallel` và `-BuildJobs`.
- **Không chạy ASan khi chưa cần.** Vòng `DEADLYSIGNAL` từng ghi log hàng chục GB. `tools/ci-local.ps1` chỉ chạy ASan khi có `-Sanitize`.
- Docker Desktop có thể tắt sau khi máy ngủ; khởi động lại rồi chờ `docker info`.
- Mỗi `docker run` phải có `--name` riêng; không `docker kill` theo image (có thể có container của dự án khác trên máy).
- Công cụ shell: ký tự `\\` trong heredoc có thể bị nuốt; backtick và `${...}` trong `node -e "..."` bị shell mở rộng. File có regex/Markdown/template literal thì dùng công cụ ghi file, đừng dùng `node -e` hay heredoc không có dấu nháy.
- Vitest trong worktree git: `node_modules` là junction ngoài worktree, Vite báo "Denied ID" khi đọc CSS (uPlot). Chạy ở checkout chính thì bình thường.
- `.claude/worktrees/` đã trong `.gitignore`. Không `git add -A` khi có worktree.

## 3. Quy tắc làm việc (từ người dùng; giữ nguyên)

1. **Toàn quyền quyết định, tự chủ.** Người dùng đã giao toàn quyền (2026-10-11): quyết các câu hỏi mở, tự đánh giá, ghi quyết định và lý do vào spec/plan/ADR. Không hỏi "có tiếp tục không". Báo cáo ngắn.
2. **Làm theo lô lớn:** gộp nhiều tính năng cho mỗi lượt, chỉ chạy test nhắm đích giữa chừng (vẫn viết test trước và phải đỏ trước, Constitution VI), một lượt kiểm tra đầy đủ ở cuối mỗi lô. Người dùng không thích chờ lâu.
3. **Giao diện Studio phải như một công cụ kỹ thuật kiểu IDE** (mô hình TIA Portal/WinCC): cây project, tab, inspector, thẻ nhiệm vụ, thanh trạng thái, chế độ Online viền cam. Người dùng từ chối giao diện dạng form đơn giản. Theo `docs/architecture/studio-ux.md`; nên đưa mockup trước khi dựng bố cục mới.
4. **Commit cục bộ từng mốc (mỗi commit phải build).** Chỉ push khi người dùng yêu cầu. Kết thúc thông điệp commit bằng dòng `Co-Authored-By: ...` theo hướng dẫn của công cụ đang dùng.
5. **Báo cáo trung thực:** test fail hoặc bước bỏ qua phải nêu rõ; không tuyên bố đã đo khi chưa đo (số x64 qua loopback không thay số BL335).
6. **Tài liệu và trao đổi bằng tiếng Việt.**

## 4. Thiết bị BL335

- Người dùng cung cấp cách truy cập trực tiếp (SSH). **Không** ghi vào repo. Đã dùng SSH qua LAN với tài khoản root; mật khẩu hiện là mật khẩu yếu mặc định.
- Được phép: triển khai `mat-runtime`, đo, kiểm tra chỉ đọc. Mọi thay đổi ghi vào `docs/reports/device-changes.md` kèm lệnh hoàn tác, sao lưu trước.
- **Không bao giờ:** reboot hoặc cắt điện (cần người ở cạnh), đụng unit `atscada-*` (kể cả timer `atscada-admin-recover`) hay container `piano-edtech-*`, đổi mật khẩu root hay cấu hình sshd.
- Cách triển khai: `deployment/device/deploy.sh` (atomic, giữ bản trước ở `/opt/mat-runtime.prev`, `deployment/device/rollback.sh`). Xem `docs/deployment/mat-runtime.md` và `docs/reports/release-0.9.0.md`. Thiết bị không có `curl` (có `wget`). Chép thư mục lên bằng `tar -C <dir> -cf - . | ssh ... 'cd <đích> && tar xf -'`. Trên Git Bash có thể dùng `SSH_ASKPASS` với script `.cmd` ở thư mục tạm ngoài repo.
- Nạp project dùng `tools/measure/device-api.mjs` (login, deploy, restore). Tài khoản tạm tạo bằng `mat-runtime --user-add ... --password-stdin` rồi tắt (`--user-disable`).
- Trạng thái cuối 2026-10-16: runtime 0.9.0, `tank-demo` 0.1.0, RSS rảnh 8,1 MB, CPU rảnh 0,94%, dịch vụ ổn định (`NRestarts=0`). **Trạng thái 2026-10-19:** mục 0.3 (`1.0.0-rc.1` releaseSeq 13, `mat-updater` đã cài, OTA tắt). Giữ `viewerAccess:any` và `simLoad:true` (cảnh báo `VIEWER_PUBLIC`); đổi về `private` khi không demo.
- **Cần người dùng xử lý (ngoài khả năng của phiên làm việc):**
  - Thiết bị bị dò mật khẩu root từ Internet: cần đổi mật khẩu root hoặc đóng chuyển tiếp cổng SSH trên router.
  - Thiết bị khởi động lại ngày 2026-10-16 lúc khoảng 08:13 không rõ nguyên nhân (nghi mất điện hoặc watchdog phần cứng 16 giây).
  - Tài khoản tạm `mat-tmp-eng`, `mat-tmp-op` còn trong `users.json` ở trạng thái tắt.
  - Thư mục `/root/matpoc` (8,2 MB, PoC của Sprint 0): xóa hay giữ.
- Kernel 5.4.61 của BL335 không có `/proc/<pid>/io`: ghi eMMC của mat được đo bằng VFS SQLite đếm byte (ADR-039, `historian.io.source = "sqlite-vfs"`), là cận trên của ghi flash.

## 5. Quyết định kỹ thuật quan trọng đã chốt (đừng đảo ngược khi chưa đọc lý do)

- **Chuỗi định dạng project:** 0.3 (007) → 0.4 (008, SVG) → 0.5 (009, alarm) → 0.6 (010, lịch sử/báo cáo). Mỗi bản là tập siêu của bản trước. Schema đóng băng ở `schemas/0.4/` và `schemas/0.5/`, gốc `schemas/` là 0.6; hash SHA-256 kiểm trong `meta-schema.test.ts`. Mã lỗi và luật không bao giờ bị mất; validator TS và C++ dùng chung vector `tests/project-vectors` (v01–v06).
- **Constitution 2.0.2:** ghi từ logic là lệnh ghi Tag được ủy quyền bởi người nạp xuống (engineer) + danh sách `writes`, chủ thể `logic:<ruleId>`; OTA chỉ bật khi có HTTPS, đăng nhập, role, audit; `audit.db` dùng `synchronous=FULL` (ngoại lệ 2.0.1).
- **Mật khẩu:** Argon2id với tham số `m=19456, t=1, p=1` (đo trên BL335: t=2 mất 883 ms; lệch khuyến nghị OWASP, ghi ở ADR-011).
- **`webMaxSessions` mặc định 12** (trước là 8, mâu thuẫn với "10 client"); RSS gần như không đổi (ADR-032).
- **Ghi aggregate lịch sử:** flush 15 phút; trần SC-004 là 80 MB/ngày cho 200 Tag ở ca xấu nhất (đo 64,2 MB; ADR-031 và ADR-034). `AGG_WRITE_FACTOR` là 3,6. Tổng ghi 003+010 khoảng 795 MB/ngày, dưới ngân sách 2 GB/ngày.
- **`alarmCommitMaxMs` mặc định 60 giây** (spec nói 30 giây; theo số đo tải bão; ADR-028). Nội dung alarm dùng dấu thập phân là dấu chấm.
- **`mulDivTrunc`** (số học 64 bit) thay `__int128` vì armhf không có `__int128`.
- **Số luồng của runtime là 73:** 24 luồng HTTP và 40 luồng HTTPS của CivetWeb theo thiết kế (ADR-010, ADR-021). Giảm `httpsThreads` là quyết định chưa chốt.
- **Nâng cấp project 0.1–0.3 lên 0.4:** làm sạch SVG, giữ nguyên `id` và `data-mat-uid`, liệt kê phần bị bỏ trong hộp thoại nâng cấp.
- `el_motor_fan` của tank-demo lệch ở chuỗi `style` quay giữa 0.2 và 0.4: có chủ ý theo ADR-024 mục 4.

## 6. Việc còn lại, theo thứ tự ưu tiên

1. **Kiểm tra tích hợp sau merge: xong trên macOS (2026-10-16, nhánh `gd6`).** `pwsh tools/ci-local.ps1 -BuildName mac -Parallel 4 -BuildJobs 3` chạy hết mọi bước từ build armhf đến `web-it` xanh trong một lượt (clang-format chạy riêng ngay trước, xanh sau khi định dạng 13 file của commit ADR-039); `alarm-it` đỏ 3 kịch bản, đã sửa (dưới) và chạy lại riêng tập CI `state,quality,restart,auth,attack,compat,history` xanh 183/183. Số liệu: ctest x64 4955/4955, `alarm_*_tests` tuần tự xanh, armhf qemu xanh, Studio e2e 1053/1053, runtime-web e2e 388/388, `cargo test --lib` 147/147.
   - Sửa trong lượt này: `TcpProbe.ConnectionAloneIsOkAndSendsNothing` (tranh chấp với luồng accept của PLC giả); `alarm-it restart` (token Bearer cũ sau khởi động lại cho dạng khách không `ackUser` của M1, test giờ bỏ token khi runtime start lại); `alarm-it attack` (lần từ chối gộp vào cửa sổ 60 s của `auth` chạy trước, test chờ cửa sổ hết); `alarm-it history` (thư mục seed trong `/var/folders` không gắn được vào Docker trên Mac); vector gói lớn sinh trước ctest (cả GitHub CI).
   - **Chưa chạy:** các kịch bản web-it mở rộng (`svg`, `svg-events`, `open-svg`, `f5x10-svg`, `history-10`, `reports`), `historian-it-010` (compat, query-bench nhỏ), smoke armhf bản phát hành, các kịch bản chạy tay (killloop, storm, latency, budget của alarm-it; retain của driver-it; fuzz 1 giờ).
   - **`screen-perf` "kéo 100 item"**: xanh trên Mac (2 lượt Studio e2e đều đạt ngưỡng 16,7 ms); số đo Windows 20–22 ms/khung trước đây chưa đo lại trên máy Windows rảnh. Số Mac không thay số Windows.
2. **Build lại gói runtime** (VFS đếm byte ghi mới, ADR-039 chưa vào gói 0.9.0 đã triển khai) và triển khai lại lên BL335; đo ghi eMMC thật bằng `io.sqliteVfs` (SC-022, T130/T143 của 010). **2026-10-16:** gói đã build lại trên Mac (`package-runtime.ps1`, entry chủ root, không metadata macOS, GNU tar giải nén sạch); **chưa triển khai**: BL335 không liên lạc được (LAN: ping mất 100 %, ARP không phân giải; cổng chuyển tiếp từ Internet hết giờ). Cần người kiểm tra nguồn điện và mạng của thiết bị.
3. **Cập nhật tài liệu 011 theo Constitution 2.0.2: xong 2026-10-16** (plan, tasks, ADR-035, mục lục ADR, Sync Impact Report).
4. **GĐ 6 / feature 011: đang làm (từ 2026-10-16, nhánh `gd6`). Trạng thái và việc còn lại cập nhật 2026-10-19 ở mục 0; đoạn dưới là lịch sử lô 1.** Trạng thái chi tiết từng task và quyết định ở "Ghi chú khi làm" trong `tasks.md`. Cách làm: nhiều agent song song, mỗi agent một git worktree và một nhánh `gd6-<việc>` tách từ `gd6`, phiên chính gộp (`git merge --no-ff`), xử lý xung đột (thường chỉ `docs/user/error-codes.md`: sinh lại bằng `node tools/gen-error-codes.mjs`), rồi chạy `pwsh tools/ci-local.ps1 -BuildName mac -Parallel 4 -BuildJobs 3` đầy đủ. Lưu ý: worktree của agent có thể được tạo từ `main` thay vì `gd6`; agent phải `git checkout -B <nhánh> gd6` và kiểm commit đầu. Đã gộp lô 1: Phase 1–2 (trừ T009, T010 cần Windows, T013 cần BL335), US1 phần Host, khóa đăng nhập, nhật ký xung, SSH, các mục Low của 008, định dạng 1.0.0 TS và C++. `ci-local` toàn bộ xanh 2026-10-17. Phạm vi gốc: `specs/011-pilot-hardening/tasks.md` (12 phase, 9 user story): rà soát bảo mật tổng và xử lý mọi phát hiện (gồm T209–T220 từ rà soát 008 và các phát hiện Medium của 005/006/007: kiểm tra Host chống DNS rebinding, khóa đăng nhập theo tên bị DoS, bit xung sau `kill -9`), tải/soak 7 ngày/cắt điện 100 lần, bộ cài Studio có chữ ký số, OTA, logic v2, trình vẽ SVG đầy đủ, faceplate/template, tài liệu và huấn luyện, nghiệm thu pilot, phát hành 1.0.0.
5. **Việc hoãn của 009/010** (kèm lệnh chạy lại trong `tasks.md` và báo cáo nghiệm thu): mô phỏng 500 Tag (T140), `kill -9` đủ 100 lần (FR-058), T143–T145 dữ liệu 7 ngày trên thiết bị, SC-020 (nạp project dựng bằng Studio lên runtime x64 rồi so khớp trang báo cáo), rollback thật trên BL335.
6. **Phát hiện chưa sửa:** 010 M2, M5–M8; 008 M2 (giao diện chưa báo `skippedSvg`) và các mục Low; 009 R3 phần còn lại; spec 008 còn chữ `pointer-events: all` ở FR-049, D16, research (đã đổi thành `visible` trong mã).

## 7. Việc cần người dùng hoặc người ở cạnh thiết bị

SSH/mạng tới BL335 (nếu máy mới ở mạng khác); đổi mật khẩu root và xử lý bị dò mật khẩu; cắt điện thật; PLC và RS485 thật; thử tay bộ gõ Telex/Unikey, NVDA trên Windows; thử Excel/Acrobat với file xuất; file thật từ Illustrator và CorelDRAW (hiện chỉ có fixture mô phỏng); thử với kỹ sư; chuyển repo GitHub sang private nếu muốn.

## 8. Sản phẩm không nằm trong git

Gói và bộ cài là nhị phân, không commit. Tái tạo trên máy mới:

- **Gói runtime armhf:** `deployment/toolchain/build.ps1 -BuildDir C:\build\armhf` rồi `deployment/package-runtime.ps1` → `build/mat-runtime-armhf.tar.gz`. Bản 0.9.0 đã build: SHA-256 `654b6de3527f8b8eba8fd34597c70c7191f8391516054e829ad0022215922cd0` (chưa có VFS đếm byte ghi).
- **Bộ cài Studio 0.8.0:** `apps/studio`, `npm run tauri build` với `CARGO_TARGET_DIR` ngoài repo; ra `bundle/nsis/mAT Studio_0.8.0_x64-setup.exe`. Bản đã build: SHA-256 `5462a20750330602c161315c5768a9cecab21d5d8e5ec4f3becaa41e24dfc86d`. Smoke: `node tools/measure/studio-smoke.mjs --exe <mat-studio.exe>`.
- Chi tiết: `docs/reports/release-0.9.0.md`.
- **`1.0.0-rc.1` (2026-10-18):** `pwsh tools/release/release.ps1` chế độ thử (không `-Release`, `-SkipCi`, khóa thử ngoài repo; trên macOS không `-Verifier`) tạo `release/1.0.0-rc.1/` (không commit). Gói runtime armhf cài lên BL335 dựng từ commit `8db76073` (releaseSeq 12). Bộ cài Studio rc.1 chưa dựng (Windows). Xem `docs/reports/011-release-dryrun.md` mục "Lượt T191".

## 9. Về lịch sử git

Nhánh `main` trên GitHub là lịch sử đã làm sạch: địa chỉ IP công khai, cổng SSH, vân tay chứng chỉ của thiết bị và email cũ của tác giả đã được thay thế bằng giá trị cùng độ dài. Nhánh nguồn trên máy cũ (`003-data-logging`) giữ lịch sử gốc nên hash khác `main`. Máy mới tiếp tục từ `main`; không cần và không nên lấy lại lịch sử gốc. Không đưa lại các giá trị nhạy cảm vào commit mới.

## 10. Danh mục tài liệu nên đọc khi cần

- `docs/plans/roadmap-v2.md` (lộ trình), `docs/architecture/studio-ux.md` (giao diện Studio), `docs/deployment/mat-runtime.md` (triển khai), `docs/adr/README.md` (mục lục ADR 001–039).
- Mỗi feature: `specs/<NNN>/{spec,plan,research,data-model,tasks,quickstart}.md` và `contracts/`; báo cáo nghiệm thu ở `docs/reports/<NNN>-acceptance.md` (và `-fr-matrix.md` nếu có).
- Quy trình Spec Kit: `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`, `/speckit-implement`; spec ở `specs/<NNN-feature>/`; `.specify/feature.json` trỏ tới feature đang làm.
