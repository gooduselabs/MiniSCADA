# Ký số bản phát hành mAT SCADA

Tài liệu cho người phát hành. Quy định kỹ thuật: [contract release-signing](../../specs/011-pilot-hardening/contracts/release-signing.md); quyết định: [ADR-035](../adr/035-release-trust-ota.md). Quy trình từng bước: [process.md](process.md). Khi lộ khóa: [incident-keys.md](incident-keys.md).

## Hiện trạng (2026-10-17)

| Hạng mục | Trạng thái |
|---|---|
| Chứng chỉ ký mã Authenticode thật (OV hoặc EV) | **chưa có**, công ty quyết định và mua (task T103, cần người) |
| Máy ký, dấu vân tay chứng chỉ, URL dấu thời gian | **chưa có** (T103); `tools/release/timestamp-urls.json` để rỗng |
| Hai khóa phát hành ECDSA (chính, dự phòng) | **chưa sinh** (T103); `deployment/keys/` chỉ có README |
| Công cụ: `sign.ps1`, `verify-release.ps1`, `release.ps1`, `keygen.ps1`, `sign-sums.ps1`, SBOM, rà license | có, test trên macOS (phần Node, cú pháp PowerShell); phần Authenticode chạy thật trên Windows ở T091–T093, T102 |
| Bộ cài ký bằng chứng chỉ thật, cài thử trên Windows 10 và 11 sạch | chưa đo (T104, T105) |

Bộ cài hiện **chưa ký**: Studio hiện "chưa ký (bản dựng nội bộ)" ở hộp "Giới thiệu".

## Hai loại chữ ký

| Đối tượng | Chữ ký | Ai kiểm | Khóa |
|---|---|---|---|
| Bộ cài Studio, `mat-studio.exe`, trình gỡ cài đặt | Authenticode SHA-256 kèm dấu thời gian RFC 3161 | Windows (SmartScreen, UAC, Explorer, `signtool`) | chứng chỉ ký mã do CA công cộng cấp |
| `SHA256SUMS`, gói `.matupdate`, `mat-runtime-armhf.tar.gz` (qua `SHA256SUMS`) | ECDSA P-256 + SHA-256 | `mat-update-verify` trên thiết bị (có từ bản 1.0) và `verify-release.ps1` | khóa phát hành riêng của dự án, ngoại tuyến |

## Chứng chỉ Authenticode

- **Loại:** OV (Organization Validation) hoặc EV (Extended Validation). Từ tháng 6 năm 2023, quy định của CA/Browser Forum bắt khóa riêng của chứng chỉ ký mã nằm trong thiết bị phần cứng đạt FIPS 140-2 mức 2 (token USB, HSM) hoặc dịch vụ ký đám mây của CA. Không còn tệp PFX để chép vào máy hay CI.
- **Nơi mua và chi phí:** là quyết định của công ty (T103). Tài liệu này không chọn nhà cung cấp; khi mua ghi vào mục "Hiện trạng": CA, loại, hạn, dấu vân tay, URL dấu thời gian, người giữ token.
- **Người giữ:** người phát hành được chỉ định giữ token (hoặc tài khoản dịch vụ ký đám mây). Mã PIN không ghi ở đâu cả; trình điều khiển token tự hỏi khi ký.
- **Máy ký:** một máy Windows dành riêng (có Windows SDK cho `signtool`, Node, Rust, Visual Studio C++). Không cài phần mềm không cần thiết; không dùng làm máy dev hằng ngày.

## Ba chế độ của `tools/release/sign.ps1`

| Chế độ | Cách ký | Dùng khi |
|---|---|---|
| `store` | `signtool sign /fd SHA256 /sha1 <dấu vân tay> /tr <URL> /td SHA256` | chứng chỉ trong kho Windows hoặc trên token |
| `command` | chạy lệnh ngoài, `{file}` thay bằng đường dẫn tệp | dịch vụ ký đám mây; bí mật của lệnh lấy từ biến môi trường của người chạy, không đặt trong `-Command` |
| `test` | như `store` với chứng chỉ thử (CN chứa `TEST`), dấu thời gian không bắt buộc | máy dev |

Mỗi lần ký, script in dấu vân tay, chủ thể, hạn của chứng chỉ và URL dấu thời gian, kiểm lại bằng `Get-AuthenticodeSignature` và `signtool verify /pa /v`, rồi ghi một mục vào `signing-log.json` (không có bí mật; giá trị từ 4 ký tự của biến môi trường có tên giống mật khẩu, PIN, token, khóa bị che thành `***` trong log và đầu ra; chế độ `command` chỉ ghi tên chương trình ký, không ghi cả lệnh). Chế độ `command`: `{file}` được truyền như đối số riêng (`sh -c "<lệnh>" sh <tệp>`, trên Windows qua biến `MAT_SIGN_FILE`), không ghép vào chuỗi lệnh, nên tên tệp lạ không chạy được lệnh. Mặc định lấy từ biến môi trường để Tauri gọi được với một tham số: `MAT_SIGN_MODE`, `MAT_SIGN_THUMBPRINT`, `MAT_SIGN_COMMAND`, `MAT_SIGNING_LOG`, `MAT_SIGN_RELEASE=1`.

Ví dụ trên máy ký:

```powershell
powershell -NoProfile -File tools/release/sign.ps1 -Mode store -Thumbprint <dấu vân tay> -Path "mAT Studio_1.0.0_x64-setup.exe" -Release
```

## Cổng chống phát hành nhầm

`release.ps1 -Release` và `sign.ps1 -Release` dừng (mã thoát 1, không tạo `release/<ver>/`) khi gặp một trong các điều kiện sau. Logic nằm ở `tools/release/gate.mjs`, có test cho từng điều kiện.

| # | Điều kiện | Tên trong thông báo |
|---|---|---|
| 1 | chủ thể hoặc tên thân thiện của chứng chỉ chứa `TEST` | CERT_TEST |
| 2 | chứng chỉ tự ký, hoặc không dựng được chuỗi tới gốc tin cậy của Windows | CERT_SELF_SIGNED |
| 3 | chứng chỉ hết hạn hoặc còn 30 ngày trở xuống | CERT_EXPIRING |
| 4 | thiếu EKU Code Signing `1.3.6.1.5.5.7.3.3` | CERT_EKU |
| 5 | khóa dưới RSA 3072 hoặc ECDSA P-256, băm dưới SHA-256 | CERT_WEAK |
| 6 | ký xong mà không có dấu thời gian | NO_TIMESTAMP |
| 7 | chữ ký không kiểm lại được sau khi ký | VERIFY_AFTER_SIGN |
| 8 | cây git có thay đổi chưa commit, hoặc commit khác `build-info.json` | DIRTY_TREE |
| – | khóa ECDSA ký `SHA256SUMS` là khóa thử (`tests/update-vectors/keys/`) hoặc nằm trong repo | CERT_TEST_KEY |

Không có `-Release` (chạy thử): bỏ điều kiện 2, 3, 6, 8, cho phép chứng chỉ thử, nhưng luôn in "BẢN THỬ, KHÔNG PHÁT HÀNH" và ghi `build-info.json` với `release = false`.

## Dấu thời gian

- Bắt buộc khi phát hành: chữ ký có dấu thời gian còn hợp lệ sau khi chứng chỉ hết hạn.
- URL máy chủ RFC 3161 do CA cung cấp; điền vào `tools/release/timestamp-urls.json` (mảng `urls`). `sign.ps1` thử tối đa ba lần qua các URL theo thứ tự. Mảng rỗng thì `-Release` từ chối.
- Máy ký cần ra Internet tới máy chủ dấu thời gian khi ký (chỉ cổng HTTP/HTTPS tới URL đó).

## Gia hạn, thu hồi, lộ khóa

- **Gia hạn:** mua chứng chỉ mới trước ngày hết hạn ít nhất 60 ngày (cổng từ chối khi còn 30 ngày). Chữ ký cũ có dấu thời gian vẫn hợp lệ.
- **Thu hồi, lộ khóa Authenticode, lộ khóa ECDSA:** [incident-keys.md](incident-keys.md).

## Khóa phát hành ECDSA P-256

- Hai khóa: `release-primary` (người phát hành giữ, trên token hoặc USB mã hóa) và `release-backup` (két công ty, ở nơi khác). Sinh trên máy không nối mạng: `tools/release/keygen.ps1 -OutDir <thư mục ngoài repo>`; openssl hỏi mật khẩu AES-256 cho khóa riêng. Script từ chối thư mục trong repo và bắt khóa dạng named curve (khóa sinh với tham số đường cong tường minh có keyId khác thiết bị).
- Khóa công khai chép vào `deployment/keys/` ([README](../../deployment/keys/README.md)); `deploy.sh` cài chúng vào `/etc/mat-runtime/trusted-keys/` ở lần cài đầu.
- Ký `SHA256SUMS`: `tools/release/sign-sums.ps1 -Sums <SHA256SUMS> -Key <khóa riêng> -Keys deployment/keys` (dùng `openssl dgst -sha256 -sign`, rồi tự kiểm lại và in keyId). Có `-Verifier` thì kiểm thêm bằng `mat-update-verify`; keyId luôn được tính từ khóa công khai kiểm được chữ ký và qua cổng `gate.mjs` (pha `key`): `-Release` mà là khóa thử thì `CERT_TEST_KEY`.
- Ký `.matupdate`: `release.ps1` bước 5 giải nén gói runtime rồi gọi `make-update.mjs --from <cây> --key <khóa riêng>`. Khóa có mật khẩu: `make-update.mjs` lấy mật khẩu từ `MAT_SIGN_PASSPHRASE` hoặc hỏi trên terminal (không hiện ký tự gõ; không bao giờ qua tham số dòng lệnh). `make-update.mjs` từ chối khóa thử (`tests/update-vectors/keys/`) nếu không có `--test` (chế độ thử của `release.ps1` tự thêm `--test`, `-Release` thì không).
- Xoay khóa mỗi 24 tháng bằng gói `keyset`: [incident-keys.md](incident-keys.md).

## SmartScreen: điều không cam kết

Microsoft SmartScreen chấm danh tiếng theo chứng chỉ và lượt tải. Chứng chỉ mới (kể cả EV) có thể vẫn hiện cảnh báo "Windows protected your PC" một thời gian; chính sách do Microsoft quyết định và thay đổi. Không cam kết hết cảnh báo ngay; kết quả thật trên Windows 10 và 11 sạch ghi ở T105 (`docs/reports/011-install.md` khi làm). Không có chứng chỉ thật thì ghi "chưa đo", không ghi "đạt".
