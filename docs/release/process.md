# Quy trình phát hành mAT SCADA

Checklist cho mỗi bản phát hành (rc hoặc chính thức). Ký số: [signing.md](signing.md). Sự cố khóa: [incident-keys.md](incident-keys.md). Contract: [release-signing](../../specs/011-pilot-hardening/contracts/release-signing.md) §7–§9.

## Số phiên bản và thẻ git

- SemVer: `1.0.0-rc.1`, `1.0.0-rc.2`, …, `1.0.0`. Phiên bản phải đồng nhất ở `apps/studio/package.json`, `apps/studio/src-tauri/tauri.conf.json`, `apps/studio/src-tauri/Cargo.toml`, `kRuntimeVersion` của runtime và `project(... VERSION ...)` của `CMakeLists.txt` nếu có khai báo (CMake chỉ nhận phần số). Kiểm: `node tools/release/build-info.mjs versions --expect <ver>`.
- `releaseSeq`: số nguyên tăng dần theo thứ tự phát hành (chống hạ cấp khi cập nhật từ xa), giữ ở `release/releaseSeq.txt` trên máy ký; `release.ps1 -Release` đọc, cộng 1, ghi lại khi xong. Sao lưu tệp này cùng thư mục lưu trữ bản phát hành.
- Thẻ git: `v<ver>` trên đúng commit trong `build-info.json`, tạo sau khi kiểm xong.

## Checklist

**Trước khi dựng**

- [ ] CI xanh trên nhánh phát hành; `tools/ci-local.ps1` xanh trên máy Windows.
- [ ] Hồi quy: các báo cáo nghiệm thu của feature (thư mục `docs/reports/`) cập nhật; không còn lỗi Critical/High mở.
- [ ] Kiểm phụ thuộc: `npm audit`, `npm audit --omit=dev`, `cargo audit`; tra CVE thư viện vendored, cập nhật bảng ở `third_party/LICENSES.md` (ngày tra cứu).
- [ ] Nâng phiên bản ở mọi nơi; viết ghi chú phát hành `docs/release/notes/<ver>.md`.
- [ ] Commit, cây git sạch.

**Dựng và ký (máy ký Windows)**

- [ ] Cắm token; kiểm `tools/release/timestamp-urls.json` có URL; có khóa ECDSA chính và `deployment/keys/`.
- [ ] Chạy `powershell -NoProfile -File tools/release/release.ps1 -Release -SigningKey <khóa riêng> -Keys deployment/keys -SignMode store -Thumbprint <dấu vân tay>`. Script làm 9 bước, dừng ở lỗi đầu tiên: cổng điều kiện; `ci-local.ps1`; dựng, ký, kiểm Studio; gói runtime armhf; gói `.matupdate`; SBOM và `licenses.md`; `RELEASE-NOTES.md` và `build-info.json`; `SHA256SUMS` và chữ ký; `verify-release.ps1` với 12 ca hỏng.
- [ ] Kết quả `release/<ver>/` có đủ: bộ cài, `mat-runtime-armhf.tar.gz` và `.sha256`, `.matupdate`, `SHA256SUMS`, `SHA256SUMS.sig`, `sbom.cdx.json`, `licenses.md`, `RELEASE-NOTES.md`, `build-info.json` (`release = true`), `signing-log.json`.
- [ ] Kiểm lại độc lập: `powershell -NoProfile -File tools/release/verify-release.ps1 -Dir release/<ver> -Keys deployment/keys -Release`; `Get-AuthenticodeSignature` trên bộ cài trả `Valid`.

**Cài thử**

- [ ] Windows 10 (1809 trở lên) và Windows 11 sạch, offline: ghi `winver`, hộp UAC hiện đúng tên nhà phát hành, SmartScreen (nguyên văn), dấu vân tay khớp [signing.md](signing.md), gỡ cài đặt sạch.
- [ ] BL335: cài bằng `deploy.sh` từ gói trong `release/<ver>/`, chạy project mẫu, kiểm `system/info` có `releaseSeq` đúng; nếu bật cập nhật từ xa, nâng từ bản trước bằng `.matupdate`.

**Sau khi phát hành**

- [ ] Lưu trữ `release/<ver>/` (bản sao ngoài máy ký, chỉ đọc) và `release/releaseSeq.txt`.
- [ ] Tạo thẻ git `v<ver>`, đẩy lên.
- [ ] Cất token và khóa ECDSA về nơi giữ.
- [ ] Gửi ghi chú phát hành cho khách hàng pilot.

## Chạy thử (không phát hành)

Trên máy dev, không cần chứng chỉ hay khóa thật: `release.ps1` không `-Release` dùng chứng chỉ thử của Windows (`make-test-cert.ps1`, có từ bản 1.0, T091) và khóa ECDSA thử sinh ngoài repo, in "BẢN THỬ, KHÔNG PHÁT HÀNH". Ngoài Windows (macOS, Linux) bước Studio và Authenticode in "BỎ QUA" và vẫn chạy các bước còn lại:

```powershell
pwsh -File tools/release/release.ps1 -SkipCi -Skip studio -RuntimeTarball <mat-runtime-armhf.tar.gz> -OutDir <thư mục ngoài repo> -Force
```

Kết quả chạy thử gần nhất: [docs/reports/011-release-dryrun.md](../reports/011-release-dryrun.md).
