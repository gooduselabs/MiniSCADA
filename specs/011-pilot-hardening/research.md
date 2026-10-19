# Research: Hoàn thiện và pilot, trình vẽ SVG đầy đủ, logic v2

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Mỗi mục: vấn đề, các phương án, **Quyết định (người dùng giao toàn quyền 2026-10-11)**, lý do, rủi ro còn lại. Số R dùng trong plan và tasks.

## R1. Một feature, chín story

- **Vấn đề:** GĐ 6 gộp ba việc rất khác nhau (hoàn thiện/pilot, trình vẽ SVG, logic); roadmap ghi một giai đoạn.
- **Phương án:** (a) một feature 011; (b) ba feature (011 hoàn thiện, 012 SVG, 013 logic).
- **Quyết định:** (a), nhưng mỗi story giao riêng, có mốc và báo cáo riêng. Lý do: cùng mốc 1.0.0 và cùng bộ pilot; người dùng yêu cầu một thư mục `specs/011-pilot-hardening/`; tách sau nếu trễ không tốn gì (mỗi story đã độc lập). Rủi ro: tasks.md dài; giảm bằng pha theo story và danh sách phụ thuộc rõ.

## R2. Phiên bản 1.0.0

- **Phương án:** (a) 1.0.0 ngay khi code xong; (b) `1.0.0-rc.N` trong lúc làm, 1.0.0 khi Go/No-Go; (c) 0.7.0 rồi 1.0 sau pilot.
- **Quyết định:** (b). Lý do: 1.0.0 là lời hứa tương thích; khách pilot cần biết bản nào đã hứa. Gắn số chỉ sau số đo thật (Constitution VI: báo cáo trung thực). Studio, runtime, định dạng project, gói cập nhật cùng 1.0.0 cho ma trận hỗ trợ đơn giản (cùng MAJOR thì tương thích); API thiết bị tăng MINOR (không MAJOR vì chỉ thêm); live giữ số riêng. Hậu tố `-rc.N` đi qua `package.json`, `Cargo.toml`, `tauri.conf.json`, `CMakeLists.txt` (chuỗi phiên bản `1.0.0-rc.N` cho nhãn hiển thị; so sánh tương thích dùng `1.0.0`).
- **Rủi ro:** nâng 0.x → 1.0 khiến người dùng 0.6 phải cập nhật Studio: migration có sao lưu, runtime nhận định dạng cũ.

## R3. Phát hiện tồn của 005, 006, 007

Bảng truy vết đầy đủ ở plan ("Phát hiện tồn"). Nguyên tắc: mọi Medium có test (đỏ rồi xanh) hoặc bằng chứng; Low chỉ khi rẻ. Mục thuộc môi trường (SSH root mật khẩu, port-forward 9080) là việc người dùng: cung cấp hướng dẫn, cảnh báo trong `system/info`, task ⚠️🔌.

## R4. Allowlist `Host` chống DNS rebinding (S-M2)

- **Mối đe dọa:** trang `evil.example` (DNS trả về IP của kẻ tấn công, rồi đổi sang 192.168.1.110) chạy JS trên trình duyệt người vận hành; sau rebinding, `fetch('http://evil.example:8080/…')` tới runtime với `Host: evil.example:8080` và `Origin: http://evil.example:8080`; kiểm `Origin == "http://" + Host` của 006/007 đạt vì cả hai do kẻ tấn công kiểm soát; đọc được dữ liệu xem (đã mở cho LAN theo `viewerLogin: off`) và, nếu người vận hành đang có cookie… (cookie `__Host-`, Secure, nên chỉ HTTPS, không bị).
- **Phương án:** (a) allowlist cứng IP của card mạng; (b) IP literal luôn nhận + tên miền phải khai; (c) tự học tên từ yêu cầu đầu; (d) không làm, khuyến nghị `viewerLogin: required`.
- **Quyết định:** (b). Lý do: rebinding cần **tên** (kẻ tấn công không điều khiển được IP literal trong `Host` của trình duyệt vì origin của trang là chính tên của nó); nên IP literal an toàn; port-forward và NAT (khách dùng IP công cộng) không vỡ; tên miền do quản trị khai, một lần. (a) vỡ NAT, (c) kẻ tấn công "học" được tên của nó, (d) giữ rủi ro. Cùng cơ chế che cả HTTPS (SAN IP, nhưng hostname trong `Host` vẫn là vectơ nếu tên có trong SAN: không có) và WebSocket.
- **Chi tiết:** 421 thay vì 403 (421 Misdirected Request: đúng nghĩa "máy chủ này không phục vụ tên đó"). Tên máy của thiết bị lấy ở lúc khởi động (`gethostname`); card mạng đổi IP không ảnh hưởng (IP literal luôn nhận). `hostCheck: off` tồn tại để gỡ rối, có cảnh báo.
- **Rủi ro:** khách dùng tên miền nội bộ gặp 421 sau khi nâng cấp: `deploy.sh` nhắc, `device/identity` liệt kê, Studio hiện hướng dẫn.

## R5. Khóa đăng nhập (S-M1 và Medium thứ hai của 005)

- **Phân tích:** khóa theo tên (005) cho phép bất kỳ nguồn nào khóa tài khoản kỹ sư (DoS); lặp lại thì khóa vĩnh viễn. Đăng nhập thành công xóa bộ đếm sai theo **nguồn** nên kẻ có một tài khoản hợp lệ thử mật khẩu hàng loạt trên các tên khác.
- **Phương án:** (a) khóa theo (tên, IP) + khóa IP + giới hạn đồng thời + cảnh báo phân tán; (b) khóa theo tên có "IP đã biết" bỏ qua; (c) trễ tăng dần không khóa (tarpit).
- **Quyết định:** (a). Lý do: tấn công từ một IP bị chặn (cặp và IP); không IP nào khóa người khác; tấn công phân tán nhiều IP vào một tên bị giới hạn bởi chi phí Argon2id (~0,3 s mỗi lần, tối đa 2 đồng thời ⇒ ≤ vài lần/giây toàn thiết bị) và mật khẩu ≥ 10 ký tự; phát hiện được qua audit. (b) cần lưu IP đã biết (trạng thái bền, thêm bề mặt), (c) vẫn cho kẻ tấn công làm chậm đăng nhập hợp lệ.
- **Rủi ro còn lại:** botnet phân tán nhiều IP với mật khẩu yếu có sẵn: ngoài phạm vi sản phẩm LAN; khuyến nghị VPN và `viewerLogin`. Ghi trong threat model.

## R6. Xung `pulseMs` và kill -9 (R-3, S-L6)

- **Vấn đề:** BL335 giữ nhịp xung (ghi bật, chờ, ghi nhả); `kill -9` hay mất điện giữa chờ để lại bit lệnh bật. 007 chấp nhận theo R17 và bắt PLC tự xóa bit.
- **Phương án:** (a) nhật ký xung bền + nhả khi khởi động; (b) giữ nguyên, chỉ tài liệu; (c) hai lệnh từ client (đã loại ở 007).
- **Quyết định:** (a). `arm` ghi và fsync **trước** khi ghi bit bật: nếu không ghi được nhật ký thì không bật (không bao giờ bật mà không có bản ghi nhả). Khi khởi động, nhả khi kênh nối lại (thử 5 s một lần, 10 phút), audit `pulse-recovery`. Giá trị nhả là trạng thái nghỉ do chính người khai báo xung; ghi nó an toàn hơn để bit bật dài.
- **Giới hạn nói thẳng:** mất điện lâu thì bit vẫn bật suốt thời gian đó (PLC phải có bộ hẹn giờ tự nhả); nhả sau khi lên lại chỉ rút ngắn. Tài liệu nêu: bit lệnh xung nên được PLC tự xóa sau tối đa N giây.
- **Đo:** dùng `fdatasync` mỗi lần: 2 lần mỗi xung (arm, done): cộng vào ngân sách eMMC: với tối đa 10 xung/phút ≈ 20 fsync/phút (nhỏ); trong giới hạn FR-081.

## R7. Gateway Modbus TCP nhiều unit (006 Medium #3)

- **Vấn đề:** một timeout làm driver đóng cả kết nối và BAD mọi Tag của kênh.
- **Quyết định:** với MBAP, giữ kết nối khi timeout đơn lẻ, đánh BAD Tag của yêu cầu, backoff riêng thiết bị (1 s đến 30 s), bỏ phản hồi muộn theo `transactionId`; đóng kết nối chỉ khi lỗi socket/khung hoặc ≥ 3 timeout liên tiếp trên ≥ 2 thiết bị (khi toàn kênh có vấn đề). RTU qua TCP (không MBAP) và RTU nối tiếp không phân biệt được phản hồi muộn: giữ cách cũ. Cần đổi máy trạng thái driver (006 đã nêu): chi phí chấp nhận được vì có simulator gateway và vector sẵn.
- **Rủi ro:** thiết bị trả lời muộn sau timeout làm trộn phản hồi nếu `transactionId` trùng: bộ đếm tăng đơn điệu 16 bit, bỏ qua giá trị đang chờ; kiểm 10.000 ca ngẫu nhiên (SC-005).

## R8. `persist()` giữ mutex khi fsync (005 Medium)

- **Quyết định:** sao chụp trạng thái dưới mutex (nhỏ), ghi và fsync ngoài mutex, tuần tự hóa bằng khóa ghi riêng cùng số thứ tự (bản cũ không ghi đè bản mới); lỗi `writeOp` ⇒ thao tác thất bại `PERSIST_FAILED` trước kích hoạt. Lý do: trạng thái không ghi được thì không đảm bảo khôi phục sau mất điện; "chỉ ghi log" là sai. "Ghi dư trước bước đầu": bỏ lần ghi thừa nếu trạng thái không đổi (so băm).

## R9. File thừa trong gói (005 Medium)

- **Phương án:** (a) từ chối ở mọi tầng (Studio, kiểm gói, kiểm project TS và C++); (b) bỏ qua file thừa khi tính digest; (c) giữ nguyên.
- **Quyết định:** (a) theo contract 005 §5. Lý do: digest phải tính trên một tập duy nhất; bỏ qua im lặng là cửa sau (chứa dữ liệu không kiểm). Studio loại `.mat-backup/`, `.mat-editor/` khi đóng gói. Chi phí: gói cũ có file thừa phải được Studio nâng cấp sạch; chấp nhận.

## R10. Giới hạn kết nối theo nguồn (S-M3, 005 Medium #1)

- **Phương án:** (a) đếm theo IP trong tầng ứng dụng (`init_connection` của CivetWeb) và đóng khi vượt; (b) chỉ tài liệu `nft ct count`; (c) cả hai.
- **Quyết định:** (c): (a) là mặc định bảo vệ trong sản phẩm (24, đặt được), (b) là tài liệu cho tầng mạng. Phía NAT (nhiều người một IP): 24 đủ cho 10 client WebSocket cộng kết nối keep-alive; `maxConnPerSource` đặt được tới 64. `httpsThreads` mặc định 40 (007); một nguồn không quá 60 % worker ⇒ `24/40 = 60 %`.
- **Đo:** SC-008 (RAM tăng ≤ 1 MB, đăng nhập ≤ 2 s) trên BL335.

## R11. SAST, audit phụ thuộc, license, fuzz

- **SAST:** `cppcheck` (GPL-3, chỉ chạy như công cụ, không link) và `clang-tidy` (Apache-2.0 with LLVM exception) trong container toolchain; ESLint (có sẵn); Semgrep/CodeQL loại (cần mạng hoặc tài khoản, thêm công cụ cần rà). Cấu hình `tools/sast/` với danh sách kiểm và danh sách ngoại lệ có lý do.
- **Phụ thuộc:** `cargo audit` (RustSec, cần tải cơ sở dữ liệu: 🌐), `npm audit` (🌐, `--omit=dev` và đầy đủ). Không có mạng: bước báo "BỎ QUA", không xanh giả; kết quả lưu `docs/reports/011-audit-*.json` với ngày cơ sở dữ liệu.
- **CVE vendored:** bảng thủ công theo phiên bản trong `third_party/LICENSES.md` đối chiếu NVD/GitHub advisories (🌐), ghi ngày tra cứu.
- **License:** `tools/release/license-report.mjs` đọc `package-lock.json` (`license` của từng gói trong `node_modules`), `Cargo.lock` + `cargo metadata` (license mỗi crate), `third_party/LICENSES.md`; từ chối GPL/AGPL/LGPL link tĩnh và license không rõ; LGPL chỉ nạp động (Constitution).
- **Fuzz:** có sẵn cho Modbus (006). Thêm trình đọc gói `.matscada`, parser project JSON, bộ đọc `.matupdate`, parser biểu thức/logic, bộ lọc SVG: dùng bộ sinh tất định (hạt cố định) và libFuzzer nếu clang trong container hỗ trợ (`-fsanitize=fuzzer`), nếu không thì bộ lặp ngẫu nhiên như `fuzz-modbus.ps1`.

## R12. Gia cố thiết bị (SSH, port-forward)

- **Quyết định:** hướng dẫn `docs/deployment/hardening.md`; cảnh báo `SSH_ROOT_PASSWORD` trong `system/info` (đọc `sshd_config`); `deploy.sh` in lời nhắc. **Không** tự đổi cấu hình sshd (có thể làm mất truy cập, Constitution quy trình bước 3): task ⚠️🔌 chờ người dùng đồng ý. OTA là điều kiện để tắt SSH mật khẩu mà vẫn cập nhật được.

## R13. Đo tải, soak

- **Bộ lấy mẫu:** script sh chỉ đọc, ghi tmpfs (không làm mòn eMMC), 60 s; thu bằng SSH mỗi giờ. `/proc/<pid>/io` cho ghi theo tiến trình; `/sys/block/mmcblk*/stat` trường 7 (sector ghi) cho tổng khối (tất cả tiến trình). Phân tích: hồi quy tuyến tính, bỏ 24 giờ đầu (cache tăng lên bình thường).
- **7 ngày so với 30 ngày:** Master Plan §6.4: 7 ngày MVP, 30 ngày trước thương mại ⇒ D13.
- **Chrome headless trên thiết bị:** không (BL335 không có đồ họa); client chạy trên máy khác. Tải 10 client bằng `load-tester` (WebSocket thuần) cho soak (ổn định, ít tài nguyên máy khách) và Chrome headless cho L4, L5.

## R14. Mất điện 100 lần

- **Phương án:** (a) ổ cắm HTTP (Tasmota); (b) rơ-le USB nối tiếp; (c) người rút tay; (d) mô phỏng bằng `kill -9` và `dm-flakey`.
- **Quyết định:** (a) hoặc (b) làm chính (người cung cấp, ⚠️🔌); (c) dự phòng; (d) làm tiền kiểm x64, nêu rõ hạn chế (không mô phỏng mất dữ liệu chưa fsync ở tầng đĩa). 100 vòng × (5 s cắt + ≤ 90 s chờ + kiểm) ≈ 4 giờ tự động; vòng có chủ đích thêm 50 vòng.
- **Kiểm sau mỗi vòng:** `--check-data` (lệnh mới) vì thiết bị không có `sqlite3`; đối chiếu audit.

## R15. Authenticode

- **Công cụ:** `signtool` (Windows SDK 26100, có trên máy dev). Tauri 2 hỗ trợ `bundle.windows.signCommand`/`certificateThumbprint`; dùng `signCommand` để chạy `sign.ps1` (đủ ba chế độ). Chi tiết hành vi của bundler: mục "Kết quả spike T010" bên dưới.
- **Loại chứng chỉ:** OV hay EV: từ 2023, CA/Browser Forum yêu cầu khóa riêng ký mã nằm trong thiết bị phần cứng (FIPS 140-2 L2) hoặc dịch vụ ký đám mây; không còn tệp PFX phát hành để bỏ vào CI. Do đó có ba chế độ và máy ký riêng. SmartScreen: danh tiếng theo chứng chỉ và lượt tải; EV từng được hưởng danh tiếng tức thì nhưng chính sách do Microsoft quyết định và đổi theo thời gian: **không cam kết** hết cảnh báo ngay; ghi kết quả thật (SC-019).
- **Dấu thời gian:** bắt buộc (RFC 3161) để chữ ký sống sau khi chứng chỉ hết hạn.
- **Chứng chỉ thử:** `New-SelfSignedCertificate -Type CodeSigningCert` vào kho người dùng, không vào kho tin cậy: kiểm `NotTrusted` (đúng) thay vì sửa kho của Windows. Kiểm với gốc tin cậy trong cô lập là tùy chọn ⚠️🔌.
- **Cổng `-Release`:** từ chối chứng chỉ thử, tự ký, hết hạn, sai EKU, thiếu dấu thời gian: ngăn "phát hành nhầm bản thử".

### Kết quả spike T010 (2026-10-18)

Phiên bản đọc: `@tauri-apps/cli` 2.12.1 (khóa trong `package-lock.json`) → crate `tauri-cli` 2.12.1, phụ thuộc `tauri-bundler = "=2.10.1"`, `tauri-utils ~2.10.1` (crates.io). Mã nguồn tải từ `static.crates.io` (không có sẵn trong cache cargo vì app chỉ phụ thuộc `tauri`, không phụ thuộc bundler); `tauri-utils` 2.10.1 có trong `~/.cargo/registry/src/index.crates.io-*/`. NSIS do bundler tải là 3.11 (`nsis/mod.rs:38-39`), đọc mã ở tag `v311` của `kichik/nsis`. Đường dẫn dưới đây tương đối với gốc từng crate. Trang tài liệu `v2.tauri.app/distribute/sign/windows` chỉ nêu khóa `bundle > windows > signCommand` dạng chuỗi với `%1` ở cuối, không nói tệp nào được ký: mọi câu trả lời dưới đây lấy từ mã.

**1. Tên khóa, dạng giá trị.** `bundle.windows.signCommand` (bí danh `sign-command`), `tauri-utils/src/config.rs:1083`. Kiểu `CustomSignCommandConfig` (`config.rs:1008-1032`, serde `untagged`) nhận **hai dạng**:
- chuỗi: `tauri-cli/src/helpers/config.rs:120-135` tách bằng **một dấu cách** (`command.split(' ')`), phần đầu là chương trình, phần sau là đối số. Không có xử lý nháy: `-Path "%1"` cho ra đối số `"%1"` (có nháy), hai dấu cách liền nhau cho ra đối số rỗng.
- đối tượng `{ "cmd": "...", "args": ["...", "%1"] }`: chuyển nguyên (`config.rs:131-133`). Dùng khi đường dẫn hay đối số có khoảng trắng.

**2. Chỗ giữ chỗ `%1`.** `tauri-bundler/src/bundle/windows/sign.rs:135-159`: chỉ đối số **bằng đúng** `"%1"` mới được thay bằng đường dẫn tệp (`if arg == "%1"`, dòng 145); `"%1"` có nháy, `--file=%1` hay `x%1` **không** được thay khi bundler gọi trực tiếp. Đối số khác nếu là đường dẫn tương đối **tồn tại** thì đổi thành tuyệt đối theo thư mục hiện tại (dòng 148-152; lý do ghi trong mã: `!uninstfinalize` của NSIS chạy ở thư mục khác). Thư mục hiện tại là `apps/studio/src-tauri` (`tauri-cli/src/build.rs:166`, `bundle.rs:149`: `set_current_dir(dirs.tauri)`), nên `../../tools/...` trỏ tới `apps/tools/...` (sai); đúng là `../../../tools/release/sign.ps1`.

**3. Cách gọi và môi trường.** `Command::new(cmd)` + `args` (`sign.rs:143`), **không qua shell**: `%MAT_SIGN_MODE%` hay `$env:...` trong `signCommand` không được mở rộng khi bundler gọi trực tiếp. Không gọi `env_clear`/`env`, nên tiến trình ký **thừa hưởng toàn bộ biến môi trường** của `tauri build` (kể cả `MAT_SIGN_MODE`, `MAT_SIGN_THUMBPRINT`, `MAT_SIGN_COMMAND`, `MAT_SIGNING_LOG`, `MAT_SIGN_RELEASE` do `release.ps1:97-100` đặt). Chạy bằng `output_ok` (`tauri-bundler/src/utils/mod.rs:48-107`): stdout/stderr bị bắt, chỉ in ở mức debug (cần `tauri build -v` để xem khi lỗi); thành công thì in stdout ở mức info (`sign.rs:210-213`). Không có stdin tương tác (stdin mặc định thừa hưởng; hộp PIN của trình điều khiển token là GUI nên không bị ảnh hưởng).

**4. Ký tệp nào, theo thứ tự nào (target `nsis`, máy Windows).** Điều kiện chung `can_sign()` = có `signCommand` **hoặc** `certificateThumbprint` (`settings.rs:620-622`); cờ `--no-sign` bỏ qua tất cả (`sign.rs:249-256`, `bundle.rs:348-351`, `nsis/mod.rs:306-309`).
1. `sign_binaries_if_needed` (`bundle.rs:129`, `345-388`): các binary **không phải** binary chính của Cargo (Studio chỉ có `mat-studio`: không có), rồi sidecar `externalBin` (không có; trên Windows sidecar đã có chữ ký thì bỏ qua qua `signtool verify /pa`, `TAURI_SKIP_SIDECAR_SIGNATURE_CHECK=true` bỏ hẳn: dòng 362-375).
2. Binary chính `mat-studio.exe`, **sau khi vá** (binary patching) cho từng loại gói (`bundle.rs:153-170`).
3. Năm DLL plugin NSIS (`NSISdl.dll`, `StartMenu.dll`, `System.dll`, `nsDialogs.dll`, `additional/nsis_tauri_utils.dll`) trong bản sao `target/release/nsis/x64/Plugins/x86-unicode` (`nsis/mod.rs:61-67`, `200-262`, `672-684`).
4. Tài nguyên có đuôi `.exe`/`.dll` chưa ký (`should_sign`, `sign.rs:266-284`; `nsis/mod.rs:838-839`): `docs-html/` không có tệp như vậy. `WebView2Loader.dll` chỉ với toolchain `-gnu` (`nsis/mod.rs:793-799`). Bộ cài WebView2 offline **không** bị bundler ký lại (giữ chữ ký Microsoft).
5. **Trình gỡ** `uninstall.exe`: bundler dựng chuỗi lệnh bằng `format!("{:?}", sign_command("%1", ...))` (`nsis/mod.rs:310-311`; `Debug` của `Command` trên Windows in chương trình và từng đối số trong nháy kép, gạch chéo ngược nhân đôi: `rust 1.99.1 library/std/src/sys/process/windows.rs:442-454`), đưa vào `!uninstfinalize '${UNINSTALLERSIGNCOMMAND}'` (`installer.nsi:70`, `101-103`). `makensis` thay mọi `%1` trong chuỗi bằng đường dẫn tạm của trình gỡ (`nsis build.cpp:4196-4221`) rồi chạy qua `%COMSPEC% /C IF 1==1 <lệnh>` (`util.cpp:1216-1237`): ở bước này lệnh **đi qua cmd.exe**, nên `%VAR%` được mở rộng (khác bước 2, 3, 6), và vì `makensis` thay `%1` theo chuỗi con nên nếu dùng chuỗi giữ chỗ khác `%1` đúng nguyên dạng thì hai đường ký sẽ khác nhau.
6. **Bộ cài** `bundle/nsis/mAT Studio_<ver>_x64-setup.exe`, sau khi `makensis` xong và đổi tên (`nsis/mod.rs:717-718`).

Mỗi tệp một lần gọi, `%1` đúng một đường dẫn: `sign.ps1` sẽ được gọi khoảng 8 lần (1 exe + 5 DLL + trình gỡ + bộ cài) cho mỗi lần dựng, mỗi lần một mục trong `signing-log.json`.

**5. Lỗi ký có dừng bản dựng không.** Bước 1, 2, 3, 4, 6: **có**. `output_ok` trả `Err("failed to run <cmd>")` khi mã thoát khác 0 (`utils/mod.rs:102-107`), lan qua `?` ở `try_sign` (`sign.rs:259`) và mọi chỗ gọi (`bundle.rs:169`, `359`, `379`; `nsis/mod.rs:679`, `718`, `839`). Bước 5 (trình gỡ): **không**. `!uninstfinalize` chỉ có một đối số nên NSIS đặt `cmpop = 4` "Just a command, ignore the exit code" (`scriptpp.cpp:1136-1137`), `check_external_exitcode` trả `-1` (`build.cpp:4240`), `makensis` chỉ in "UninstFinalize command returned N" và đóng gói **trình gỡ chưa ký** vào bộ cài đã ký. Hệ quả: phải kiểm `uninstall.exe` sau khi dựng (contract §4 đã có, nay là bắt buộc chứ không phải phòng xa).

**6. Binary chính trong cây dựng không có chữ ký.** Bundler sao binary chính chưa ký ra tệp tạm (`bundle.rs:133-144`) và **chép đè lại bản chưa ký, chưa vá** sau mỗi loại gói (`bundle.rs:212-218`). Vậy `target/release/mat-studio.exe` sau `tauri build` là bản **NotSigned**; bản có chữ ký chỉ nằm trong bộ cài. `mat-studio.exe` để kiểm (SC-017, `verify-release.ps1 -StudioExe`) phải lấy từ bản cài thử im lặng (`/S /D=...`), cùng chỗ lấy `uninstall.exe`.

**7. Quan hệ với `certificateThumbprint`, `digestAlgorithm`, `timestampUrl`, `tsp`.** Chỉ dùng cho lệnh mặc định `signtool sign /fd <digest> /sha1 <thumbprint> /d <productName> [/tr <url> /td <digest> | /t <url>] <file>` (`sign.rs:161-186`; digest mặc định `sha256`, dòng 20-25). Có `signCommand` thì `sign()`/`sign_command()` luôn chọn lệnh tùy biến (`sign.rs:188-198`, `237-247`): ba khóa kia bị **bỏ qua** khi ký; `certificateThumbprint` chỉ còn tác dụng bật `can_sign()`. `signtool` vẫn được tìm (`TAURI_WINDOWS_SIGNTOOL_PATH` hoặc Windows SDK, `sign.rs:52-119`) cho `verify` của sidecar và tài nguyên `.exe`/`.dll` (bước 1, 4); Studio không có loại tệp đó. Ngoài Windows, chỉ ký được khi có `signCommand` (`sign.rs:194-196`, `244-245`).

**Đối chiếu với tích hợp hiện có (T093 chưa làm, `tauri.conf.json` chưa có `signCommand`):**

| # | Hiện trạng | Bundler làm gì | Cần đổi |
|---|---|---|---|
| a | contract §4 ghi `powershell -NoProfile -File ../../tools/release/sign.ps1 -Mode %MAT_SIGN_MODE% -Path "%1"` | dạng chuỗi tách theo dấu cách, `"%1"` có nháy không được thay (mục 2); `%MAT_SIGN_MODE%` không mở rộng khi gọi trực tiếp nhưng có mở rộng ở `!uninstfinalize` (mục 3, 4.5); `../../` sai gốc (mục 2) | dùng dạng đối tượng, `%1` trơn, bỏ `-Mode` (sign.ps1 đọc `MAT_SIGN_MODE` từ môi trường, `sign.ps1:35`): `{"cmd": "powershell", "args": ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "../../../tools/release/sign.ps1", "-Path", "%1"]}`. Đã sửa contract §4 (chỉ tài liệu) |
| b | contract §4: "Tauri gọi lệnh này cho tệp thực thi, bộ cài và trình gỡ" | còn ký 5 DLL plugin NSIS (mục 4.3) | đã ghi vào contract; `sign.ps1` ký được DLL như exe, không cần đổi mã |
| c | contract §4, `release.ps1:157`: `mat-studio.exe` lấy từ `target/release/` | bản đó chưa ký (mục 6) | T093/T098: lấy `mat-studio.exe` và `uninstall.exe` từ bản cài thử im lặng; `release.ps1:157-168` đang truyền `$env:CARGO_TARGET_DIR/release/mat-studio.exe` cho `verify-release.ps1` sẽ báo `NotSigned`. Chưa sửa (chỉ chạy trên Windows) |
| d | ký trình gỡ lỗi thì bản dựng vẫn qua (mục 5) | | `release.ps1` phải coi `uninstall.exe` `NotSigned` là lỗi dừng (T093) |
| e | `release.ps1:158-166` ký bộ cài khi bộ cài `NotSigned` | khi đã có `signCommand`, bộ cài luôn được ký hoặc bản dựng dừng | giữ làm đường lùi; không ký lại bộ cài đã ký (ký hai lần tạo chữ ký kép) |
| f | máy dev Windows chưa có chứng chỉ thử | có `signCommand` thì mọi `tauri build` gọi `sign.ps1` (mặc định `test`), không có chứng chỉ thử thì `sign.ps1` thoát 2 và bản dựng dừng | T093: ghi trong `studio-install`/README "chạy `make-test-cert.ps1` hoặc `tauri build --no-sign`"; `npm run tauri dev` không bị ảnh hưởng (chỉ bundler ký) |
| g | lỗi ký chỉ hiện "failed to run powershell" | stdout/stderr chỉ ở mức debug (mục 3) | `release.ps1` gọi `studio:build` với `-- --verbose` hoặc đọc `signing-log.json` khi lỗi (T093) |

Không đổi `tauri.conf.json` trong spike: thêm `signCommand` làm mọi bản dựng Windows phụ thuộc chứng chỉ thử (mục f), không kiểm được trên macOS; việc này thuộc T093 cùng bản dựng thử bằng chứng chỉ thử và kiểm ba tệp (SC-017).

## R16. Khóa phát hành ECDSA P-256

- **Phương án:** Ed25519 (Mbed TLS 3.6 chưa hỗ trợ), RSA-3072 (kích thước và chậm trên Cortex-A7), ECDSA P-256 (Mbed TLS có sẵn, OpenSSL và Node ký được).
- **Quyết định:** ECDSA P-256 + SHA-256, DER. Khóa công khai trong `/etc/mat-runtime/trusted-keys/`, **ngoài** cây `/opt/mat-runtime` được cập nhật (gói không thể tự thay khóa tin cậy của chính nó); xoay khóa bằng gói `keyset` ký bởi khóa đang tin cậy. Hai khóa (chính, dự phòng). Khóa ngoại tuyến ở máy ký/ token.
- **Không dùng** PKI X.509 cho gói (chuỗi, hạn, thu hồi phức tạp, thiết bị không có đồng hồ chắc chắn): khóa trực tiếp, thu hồi bằng `keyset`.

## R17. OTA: kiến trúc

- **Phương án:** (A) chỉ thủ công; (B) runtime tự thay (`matscada` ghi `/opt`); (C) `mat-updater` root nhỏ do systemd kích hoạt; (D) A/B phân vùng (Buildroot).
- **Quyết định:** (C) làm mặc định tắt, giữ (A) làm đường song song. Lý do chi tiết ở spec D5. (B) phá sandbox (`ProtectSystem=strict`, `ReadOnlyPaths`, `NoNewPrivileges`, `CapabilityBoundingSet=` rỗng): runtime bị chiếm là ghi được mã chạy: loại. (D) cần image: ngoài phạm vi, ghi vào backlog; thiết kế (C) giữ cùng bố cục `.prev` để dễ chuyển.
- **Bề mặt root:** `mat-update-verify` (nhỏ, tự viết) + sh (`mat-updater`): tar chỉ qua `tar` GNU với danh sách đã kiểm; không phân tích JSON bằng sh (manifest do `mat-update-verify` in ra dạng dòng `path<TAB>sha256<TAB>mode`).
- **TOCTOU:** root sao chép gói sang thư mục của root rồi kiểm lại toàn bộ (R18).
- **Không làm:** tải gói từ Internet (thiết bị không tự kéo), kênh cập nhật tự động. Quản trị viên chủ động tải lên từ Studio.

## R18. `mat-updater`: các bước và an toàn

Xem [contracts/update-package.md](contracts/update-package.md) §4. Điểm chính: 8 bước, trạng thái ghi trước mỗi bước, `mat-updater-recover.service` chạy trước `mat-runtime.service` để xử lý gián đoạn; kiểm sức khỏe 60 s; quay về nguyên tử bằng đổi tên; một bản `.failed` giữ để điều tra. Thời gian ngừng ≈ dừng dịch vụ (≤ 5 s), đổi tên (ms), khởi động (≤ 10 s trên BL335 theo 005), kiểm sức khỏe: mục tiêu ≤ 30 s ngừng phục vụ.
- **Thiết lập quyền runtime:** runtime viết `request.json` vào thư mục thuộc `matscada`; `mat-updater` không tin nội dung (chỉ lấy `updateId` và băm, kiểm lại gói). Kẻ chiếm `matscada` chỉ có thể kích hoạt cập nhật một gói hợp lệ ký đúng (hoặc làm DoS bằng cách kích hoạt liên tục: `mat-updater` bỏ qua yêu cầu khi không có gói `ready` hợp lệ và giới hạn 1 lần mỗi 5 phút).
- **Xác thực lại mật khẩu:** thao tác đặc quyền cao nhất; token Bearer bị đánh cắp (XSS ở Studio, không phải trình duyệt) không đủ.

## R19. SBOM

- CycloneDX 1.5 JSON tự sinh bằng `tools/release/sbom.mjs` từ `package-lock.json` (`packages[].version`, `license`, `integrity` → hash), `Cargo.lock` (+ `cargo metadata` nếu có), `third_party/LICENSES.md` (bảng Markdown), không thêm phụ thuộc. Kiểm lược đồ bằng bộ kiểm tối thiểu viết tay (trường bắt buộc) vì không thêm trình kiểm CycloneDX.
- SPDX: không (không cần); xuất thêm nếu khách hàng yêu cầu.

## R20. Logic v2: mô hình

- **Phương án:** (a) luật/khối khai báo (`logic.json`); (b) ngôn ngữ ladder/FBD đồ họa; (c) script (Lua, JS); (d) máy trạng thái hữu hạn tổng quát.
- **Quyết định:** (a). Constitution V loại (c); (b) tốn editor đồ họa lớn và không cần cho ca dùng đã nêu (điều kiện → đặt Tag, timer, counter, cộng dồn, giờ chạy, lịch); (d) mạnh nhưng khó kiểm và dễ vòng. (a) kiểm được tĩnh (validator), mô phỏng được (engine TS), hai bản dùng chung vector.
- **Ngôn ngữ biểu thức:** dùng lại ADR-015 (đã có hai bản, vector, không FMA), không thêm hàm có trạng thái: trạng thái nằm ở khối (timer, counter…), không trong biểu thức.
- **Ngữ nghĩa quan trọng** (D19): BAD ⇒ `SUSPENDED` không cạnh giả; `fireOnStart: false`; `hold` thay timer rời cho ca phổ biến; `edgeId` khử trùng lặp; hành động tuần tự theo id.
- **Thứ tự quét và vòng:** sắp xếp tô-pô; `E_LOGIC_CYCLE`; hiệu ứng `setTag` có hiệu lực quét sau; `E_LOGIC_SELF_TRIGGER`.
- **Thời gian:** monotonic cho timer, totalizer, giờ chạy (NTP nhảy không ảnh hưởng); realtime chỉ cho lịch.
- **Độ chính xác:** totalizer hình thang, `double`, không FMA; giới hạn quét `scanMs` ≥ 50 ms; counter không bù cạnh nhanh hơn chu kỳ quét (ghi giới hạn; khuyến nghị counter PLC cho > 5 Hz).

## R21. Ghi PLC từ logic

- **Rủi ro:** máy tự ghi xuống PLC không có người bấm; lỗi cấu hình hay đầu vào nhiễu có thể ghi lặp.
- **Biện pháp** (nhiều lớp): (1) khai báo `writes` (Tag, giá trị cho phép, tần suất), mọi hành động ghi phải tham chiếu; (2) giới hạn `minIntervalMs`, `maxPerHour`, `logic.maxWritesPerMin`; (3) mặc định `logic.writes: off` ở `runtime.json` (root) ⇒ bật là quyết định cố ý; (4) dừng khẩn cấp bởi administrator qua API, giữ qua khởi động lại; (5) audit bền trước khi gửi, kèm điều kiện; (6) `hold` và `SUSPENDED` chống nhiễu; (7) Studio hiện danh sách ghi tự động ở bước xem trước Nạp xuống và chip trạng thái; (8) interlock ở PLC (tài liệu).
- **Chủ thể ghi:** `logic:<ruleId>`; ủy quyền bởi người nạp xuống (engineer) cộng `writes`; cần làm rõ trong Constitution (PATCH 2.0.2, D22). Không tạo "tài khoản logic" có mật khẩu (không có người đăng nhập).
- **Ngân sách audit:** ≤ 20 lệnh/phút × 30 KB/lệnh (số đo 006: 30.379 byte/lệnh) ≈ 0,9 GB/ngày < 2 GB/ngày; trần này dùng làm mặc định `maxWritesPerMin`.

## R22. Lưu trạng thái logic

- **Quyết định:** `RetainStore` của 006 (ghi tạm, fsync, đổi tên), chu kỳ `flushS` = 60 s khi có thay đổi (và SIGTERM). Mất tối đa 60 s cộng dồn khi mất điện: chấp nhận và ghi rõ (đồ thị cộng dồn lưu lượng tính theo ngày: sai số ≤ 60 s × lưu lượng). Muốn ít mất hơn: giảm `flushS` (đổi lấy ghi eMMC, validator ước tính).
- **Không** ghi mỗi thay đổi: totalizer đổi mỗi quét ⇒ 10 lần/giây ⇒ mòn eMMC.
- **Không thể giảm:** sau retain hỏng ⇒ về 0 và cảnh báo (không đoán).

## R23. Lịch và múi giờ

- Offset cố định, không DST/tzdata (Việt Nam không có DST; tzdata có thể thiếu trên BL335). `tzOffsetMin` toàn thiết bị (mặc định 420) và ghi đè theo khối. Giờ chưa đồng bộ: BAD thay vì đoán (lịch sai làm bật/tắt máy sai giờ). Quy tắc "nửa mở `[from, to)`" tránh trùng điểm; qua nửa đêm thuộc ngày bắt đầu.
- `timeSynced`: từ `chronyc`/`timedatectl show -p NTPSynchronized` (đọc chỉ-đọc) hoặc cờ RTC; không có cách đọc thì coi là đồng bộ nếu năm ≥ 2026 (giả định có RTC pin) và ghi cảnh báo `TIME_NOT_SYNCED` khi ngược lại. Ghi ở plan.

## R24. Trình vẽ SVG: cách làm

- **Phương án:** (a) mô hình tài liệu thuần TS (`@mat/svg-edit`) + lệnh + editor trên DOM thật; (b) SVG.js + interact.js như Master Plan §4; (c) Fabric/Konva (canvas); (d) nhúng Inkscape/SVG-edit.
- **Quyết định:** (a). Lý do: (1) 007 đã chọn Pointer Events tự viết thay interact.js (ADR-022): chọn, đổi cỡ, bắt dính tự viết, dùng lại; (2) canvas (c) mất DOM nên không dùng chung bộ dựng với runtime, vi phạm "Shared renderer" (parity); (3) (d) thêm phụ thuộc lớn, license, không theo chuẩn IDE; (4) mô hình thuần không DOM kiểm được bằng Vitest nhanh, hoàn tác bằng lệnh theo Master Plan §7.4; (5) SVG.js thêm phụ thuộc cho thứ nhỏ làm tay.
- **Phạm vi** (D23) bám Master Plan §7.5 "MVP" và giới hạn có chủ đích; thêm sửa nút cho path đa giác.
- **Đọc/ghi:** parser của GĐ 3b (DOM thật, allowlist); ghi bằng tuần tự hóa chuẩn tắc giữ byte phần không sửa.

## R25. Bake transform

- **Vấn đề:** ghi `transform` cho mọi thay đổi làm hình học khó sửa tiếp, nét bị co. Nhưng bake sai làm méo hình.
- **Quyết định:** bake khi **chính xác** (đồng dạng không nghiêng; xoay bội 90° cho rect/ellipse); còn lại `transform`. `circle` co không đều ⇒ đổi thành `ellipse`. Mọi phép kiểm so sánh hộp bao và điểm mẫu trước và sau (sai số 1e-6). Bộ ca ≥ 150.
- **Không** hỗ trợ nghiêng khi bake (`skewX/Y` giữ trong `transform`).

## R26. Hoàn tác bằng lệnh

- Lệnh nguyên tử đảo ngược được, lô theo thao tác, gộp theo `mergeKey`; 100 bước; không chụp lại cây (Master Plan §7.4). Kiểm bằng property test (1.000 chuỗi). Lưu `RemoveNode` giữ cây con (ngân sách bộ nhớ: tối đa 20.000 nút trong ngăn xếp tổng; vượt thì loại bước cũ nhất và ghi "đã giảm độ sâu").

## R27. Template và faceplate

- **Phương án:** (a) template bung khi lưu + faceplate popup có tham số thay lúc chạy; (b) mọi thứ thay lúc chạy (runtime hiểu `instance`); (c) chỉ template, không faceplate.
- **Quyết định:** (a). Template thuần không đổi runtime (Constitution II, rủi ro thấp), nhưng nhân bản hàng chục lần ở file màn hình (chấp nhận: 250 item/màn hình, giới hạn đã có). Faceplate cần thay lúc chạy vì mục đích là **một** popup cho N thiết bị; thay chuỗi thuần, validator bung tĩnh mọi tổ hợp nên không thể tạo Tag ngoài tập kiểm được (và runtime kiểm lại: Tag không có trong tập đã công bố thì không đăng ký).
- **Ngoài:** tham số kiểu danh sách/đối tượng, điều kiện, lồng template, template chứa faceplate.

## R28. Tài liệu và huấn luyện

- Ba hướng dẫn (kỹ sư, vận hành, quản trị) + danh mục lỗi + thuật ngữ; giáo trình ba nhóm với bài thực hành trên `projects/training-demo` (dựng ở task). Kiểm bằng `docs-check` (liên kết, lệnh CLI so với `--help`, mã lỗi so với danh mục sinh từ mã nguồn `tools/gen-error-codes.mjs`) và bảng tác vụ thử với người. Tài liệu đi kèm bộ cài ở dạng HTML tĩnh (script không thêm phụ thuộc: chuyển Markdown sang HTML bằng bộ chuyển tối giản trong `tools/` hoặc dùng `marked` nếu đã có trong workspace; nếu chưa thì viết bộ chuyển đủ cho tập tính năng Markdown đã dùng, kiểm bằng test).
- Ngôn ngữ: tiếng Việt, thuật ngữ như spec; không dịch tên API.

## R29. Pilot

- **Site:** 1 đến 2 + bàn thử; thời gian ≥ 30 ngày; bản rc cố định; tiêu chí ra X1 đến X11 (contracts/test-protocols.md §5). 99,9 % uptime ≈ 43 phút/30 ngày: đủ chặt để lộ sự cố, đủ lỏng để không phạt một lần khởi động lại do cập nhật có kế hoạch (loại trừ).
- **Đo độ trễ:** `liveLagP95Ms` phía thiết bị (commit → ghi khung) + đo đầu-cuối bằng Chrome ở ≥ 3 lần; không dựa vào đồng hồ trình duyệt của người dùng.
- **Tuổi thọ:** hai cách (TBW, bậc `EXT_CSD`); thiếu datasheet thì nói thẳng.
- **Dữ liệu:** chỉ số đo kỹ thuật (D38).
- **Không có site:** pilot chạy ở bàn thử và 1.0.0 không gắn (FR-142): không "đạt giả".

## R30. Mảng sau pilot

Kế hoạch ở spec (bảng "Ngoài phạm vi") và `docs/plans/post-1.0-backlog.md`: thông báo alarm ngoài (đòi đường ra Internet và bí mật trên thiết bị: thiết kế riêng), recipe (ghi nhiều Tag một lô: nền là `writes` và audit lô), API dữ liệu ra (token riêng, role `api`, chỉ đọc; MQTT publish), mobile (bố cục đáp ứng), Buildroot (A/B), driver đợt 2 đến 4. Không có mã ở 011.

## R31. Constitution

Hai điểm cần làm rõ trước khi viết mã (task T004): (1) ghi từ luật logic đã triển khai là "lệnh ghi Tag" được ủy quyền bởi người nạp xuống (engineer, role đã kiểm lúc nạp xuống) và danh sách `writes` đã khai, và lệnh nhả xung dở khi khởi động là phần của lệnh xung đã được ủy quyền và audit từ đầu; vẫn qua chuỗi kiểm và audit (nguyên tắc V); (2) cập nhật runtime qua mạng thuộc nhóm "nạp xuống qua mạng" chỉ bật khi HTTPS, đăng nhập, role, audit (nguyên tắc V). Đề xuất PATCH 2.0.2 (không đổi nguyên tắc, chỉ làm rõ); không có thay đổi ngân sách (III). Ngoại lệ `synchronous=FULL` của audit đã bao phủ audit của logic và OTA (số lượng giới hạn, R21).

## R32. Ma trận tương thích

| Studio | Runtime | Hành vi |
|---|---|---|
| 1.0 | 1.0 | đầy đủ |
| 1.0 | 0.6, 0.5 | Studio nhận biết bằng `system/info` (khóa `update`, `logic` vắng): ẩn OTA và logic; **không** nạp xuống project 1.0.0 cho runtime cũ (runtime 0.6 không nhận 1.0.0): Studio chặn kèm hướng dẫn nâng cấp runtime. Không có "xuất 0.3" (YAGNI) |
| 0.5 (Studio) | 1.0 | Studio cũ mở project 1.0.0 từ chối (như 006 FR-005); nạp xuống project 0.3 vẫn chạy |

Ghi vào `docs/user/admin-guide.md`.

### Kết quả spike T009 (2026-10-19, Windows 11 build 26200)

- `signtool.exe`: `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe` (4.00); `sign.ps1` tự tìm bản mới nhất trong `Windows Kits\10\bin`.
- `New-SelfSignedCertificate -Type CodeSigningCert` vào `Cert:\CurrentUser\My` (không cần quyền admin); `signtool sign /sha1 <dấu vân tay> /fd SHA256` ký được.
- `Get-AuthenticodeSignature` trả **`UnknownError`** (`StatusMessage`: "A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider"), **không phải `NotTrusted`**, trên cả Windows PowerShell 5.1 và pwsh 7; dấu vân tay người ký đúng. Mã chấp nhận cả hai (`Get-MatSignatureInfo`, `signature.rs`).
- `signtool verify /pa /v`: mã 1, "A certificate chain processed, but terminated in a root certificate which is not trusted"; in băm SHA-256 của tệp.
- Sửa 1 byte trong ảnh PE → `HashMismatch` (byte cuối nằm trong khối chữ ký cho lỗi khác).
- Bẫy: tệp hệ thống (ví dụ `whoami.exe`) ký bằng catalog nên `Get-AuthenticodeSignature` báo `Valid` của Microsoft dù đã ký thêm; dùng `.exe` chưa ký thật (test biên dịch bằng `csc.exe`).
- Bẫy: `New-SelfSignedCertificate` thêm bản sao (chỉ khóa công khai) vào `Cert:\CurrentUser\CA` (kho trung gian, không phải kho tin cậy); `make-test-cert.ps1` gỡ.
- Bẫy: Windows PowerShell 5.1 do pwsh 7 sinh ra thừa hưởng `PSModulePath` của PS7; module Security của PS7 nạp vào 5.1 làm `Cert:` lỗi. `sign.ps1` loại các đường dẫn PS7 khỏi `PSModulePath`.
- Đã gỡ chứng chỉ sau spike; Root và TrustedPublisher không đổi.
