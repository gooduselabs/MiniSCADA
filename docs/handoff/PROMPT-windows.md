# Prompt cho phiên làm việc trên Windows (build và ký Studio, feature 011)

Dán nguyên khối dưới đây vào Claude Code (hoặc trợ lý AI tương đương) chạy trên máy Windows 10/11 x64.

---

Bạn là kỹ sư build/phát hành của dự án mAT SCADA (repo `gooduselabs/MiniSCADA`, nhánh `gd6`). Trao đổi và tài liệu bằng tiếng Việt; tên trong mã bằng tiếng Anh. Máy này là Windows; phiên trước làm trên macOS nên mọi bước chỉ chạy được trên Windows còn để lại cho bạn.

**1. Lấy mã và đọc trước khi làm**

```powershell
git clone https://github.com/gooduselabs/MiniSCADA.git
cd MiniSCADA
git checkout gd6
```

Đọc theo thứ tự: `CLAUDE.md`; `docs/handoff/gd5-to-gd6.md` (mục 0 là trạng thái mới nhất); `.specify/memory/constitution.md` (test viết trước: đỏ rồi xanh); `specs/011-pilot-hardening/quickstart.md` §0 và §4; `specs/011-pilot-hardening/contracts/release-signing.md`; `specs/011-pilot-hardening/research.md` mục R15 "Kết quả spike T010" (cách `tauri-bundler` gọi `signCommand`); các task T009, T088, T091–T094, T098, T102 trong `specs/011-pilot-hardening/tasks.md` cùng "Ghi chú khi làm" của chúng.

**2. Công cụ cần có** (kiểm từng cái, thiếu thì cài, ghi phiên bản vào báo cáo):
- Node.js 22 LTS và npm; PowerShell 7 (`pwsh`); Git.
- Rust qua rustup (toolchain stable, target `x86_64-pc-windows-msvc`), Visual Studio Build Tools 2022 (workload "Desktop development with C++").
- Windows SDK 10.0.26100 (có `signtool.exe`, thường ở `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\`).
- WebView2 Runtime (có sẵn trên Windows 11).
- OpenSSL (đi kèm Git for Windows: `C:\Program Files\Git\usr\bin\openssl.exe`) cho `sign-sums.ps1`.

**3. Kiểm nhanh trước khi build**

```powershell
npm ci
node tests/package-vectors/generate.mjs --out
node tools/release/make-update.mjs --vectors --test --out
npm run lint; npm run typecheck; npm test
cd apps/studio/src-tauri; cargo test --lib; cd ../../..
node --test "tools/release/*.test.mjs"
```

Đỏ ở đâu thì dừng, tìm nguyên nhân (thường là khác biệt đường dẫn, CRLF, PowerShell 5.1 và 7) và sửa theo test-first.

**4. Việc cần làm trên Windows (theo tasks.md)**

1. **T009** spike `signtool` và chứng chỉ thử: đường dẫn `signtool.exe`, `New-SelfSignedCertificate -Type CodeSigningCert` vào `Cert:\CurrentUser\My`, ký một `.exe` thử, `Get-AuthenticodeSignature`. Ghi kết quả vào `research.md` R15.
2. **T091** viết `tools/release/make-test-cert.ps1`: tạo và gỡ (`-Remove`) chứng chỉ thử trong `Cert:\CurrentUser\My`; **không** đụng kho tin cậy (Root/TrustedPublisher).
3. **T092, T088** chạy `tools/release/sign.ps1` ở ba chế độ `store`, `command`, `test` và các test `node --test tools/release/sign.test.mjs gate.test.mjs verify-release.test.mjs` trên Windows. Kiểm riêng các đường chỉ Windows: PowerShell 5.1 trong `tools/pilot/collect.ps1` (ghim chứng chỉ ở mọi kết nối), chế độ `.cmd` của `sign.ps1` (đường dẫn qua `%MAT_SIGN_FILE%`, từ chối ký tự `& | < > ^ % ! "`), `icacls` của `keygen.ps1`, đường dẫn tuyệt đối `powershell.exe` của Studio (`signature.rs`).
4. **T093** nối Tauri với `sign.ps1` theo kết quả spike T010: trong `apps/studio/src-tauri/tauri.conf.json` thêm `bundle.windows.signCommand` dạng đối tượng `{"cmd":"powershell","args":["-NoProfile","-ExecutionPolicy","Bypass","-File","../../../tools/release/sign.ps1","-Path","%1"]}` (không đặt `%1` trong nháy; chế độ ký lấy từ biến môi trường `MAT_SIGN_*`). Dựng bộ cài thử bằng chứng chỉ thử; kiểm `mat-studio.exe`, bộ cài setup và `uninstall.exe` đều có chữ ký (`NotTrusted` là đúng với chứng chỉ thử). Lưu ý từ T010: bản `target/release/mat-studio.exe` trong cây build **không** ký — lấy bản đã ký bằng cài thử im lặng (`setup.exe /S /D=<thư mục tạm>`); ký `uninstall.exe` hỏng thì NSIS không báo lỗi, nên `release.ps1` phải tự coi đó là lỗi.
5. **T094** chạy `tools/release/verify-release.ps1` với đủ 12 ca hỏng (ca 1–5 Authenticode chỉ chạy được trên Windows).
6. **T098, T102** chạy thử toàn bộ quy trình ở chế độ thử (không `-Release`):
   ```powershell
   pwsh tools/release/release.ps1
   ```
   (có thể thêm `-SkipCi` nếu đã chạy test ở bước 3). Ghi thời gian, kích thước, kết quả 12 ca vào `docs/reports/011-release-dryrun.md` (thêm mục "Lượt Windows").
7. **T203** (phần còn lại): xem lại ảnh chụp trong `docs/user/img/` (chụp trên macOS bằng Chrome headless); nếu khác rõ trên Windows thì chụp lại bằng `node tools/docs-screenshots.mjs`.

**5. Không được làm**
- Không mua, nhập hay dùng chứng chỉ ký mã thật, không chạy `release.ps1 -Release` (T103, T104 cần công ty và người phụ trách).
- Không commit khóa riêng, mật khẩu, PIN token, chứng chỉ `.pfx`, thư mục `release/`, địa chỉ IP thiết bị hay dấu vân tay thiết bị (repo công khai).
- Không thêm chứng chỉ thử vào kho tin cậy của Windows; gỡ chứng chỉ thử khi xong (`make-test-cert.ps1 -Remove`).
- Không đụng thiết bị BL335 (phiên Windows không cần thiết bị).

**6. Cách làm việc**
- Làm trên nhánh mới tách từ `gd6`, ví dụ `gd6-windows`; mỗi phần một commit kiểu `feat(011): …` / `fix(011): …` / `docs(011): …` (tiếng Việt).
- Test viết trước rồi mới sửa (constitution). Với mỗi task xong: thêm "Ghi chú khi làm (<ngày>, nhánh gd6-windows): …" dưới task trong `tasks.md` và đánh dấu `[x]` chỉ khi đạt đủ tiêu chí của task; chưa đủ thì ghi rõ còn gì.
- Chạy `node tools/docs-check.mjs` (0 lỗi) trước khi commit tài liệu.
- Chỉ push khi người dùng yêu cầu. Cuối phiên, báo cáo ngắn bằng tiếng Việt: đã làm gì, lệnh đã chạy và kết quả, task nào đã đánh dấu, việc còn lại.
