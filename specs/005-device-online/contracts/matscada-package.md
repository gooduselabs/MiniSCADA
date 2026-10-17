# Contract: gói project `.matscada` (định dạng 1.0.0)

**Feature**: [spec.md](../spec.md) FR-017, FR-018, FR-027 · **Research**: R12 · **Data model**: §8

Studio (Rust) và thiết bị (C++) cùng đọc, ghi định dạng này theo đúng một bộ luật, kiểm bằng bộ vector chung `tests/package-vectors/`.

## 1. Tổng quan

- File ZIP theo **tập con chặt** ở §2, đuôi `.matscada`, MIME `application/zip`.
- Entry đầu là manifest `matscada.json` (stored). Các entry còn lại là file của project, sắp theo đường dẫn.
- Gói chỉ chứa dữ liệu (JSON, SVG). Không có mã chạy được, không có bí mật.

## 2. Tập con ZIP

**Toàn file:**

| Luật | Vi phạm |
|---|---|
| Kích thước ≤ 52.428.800 byte (50 MiB) | `E_PKG_TOO_LARGE` |
| EOCD (`50 4B 05 06`) nằm đúng 22 byte cuối; comment dài 0 | `E_PKG_FORMAT` |
| Số đĩa 0; số entry trên đĩa bằng tổng; 1 ≤ tổng ≤ 1024 | `E_PKG_FORMAT`, `E_PKG_ENTRIES` |
| `CD offset + CD size` = vị trí EOCD (central directory nằm liền trước EOCD; không còn chỗ cho bản ghi ZIP64) | `E_PKG_FORMAT` |
| Entry đầu ở offset 0; các entry liền nhau, không chồng, không khoảng trống; entry cuối kết thúc đúng ở `CD offset` | `E_PKG_FORMAT` |

**Mỗi entry (header cục bộ và central directory):**

| Trường | Luật |
|---|---|
| Phương thức | `0` (stored) hoặc `8` (deflate thô) |
| Cờ | chỉ được có bit 11 (tên UTF-8) và, với deflate, bit 1–2. Bit 0 (mã hóa), bit 3 (data descriptor), bit 6, bit 13: từ chối |
| Version needed | ≤ 20 |
| Extra field, comment của entry | dài 0 |
| CRC32, kích thước nén, kích thước gốc | có thật trong header cục bộ; bằng giá trị ở central directory |
| Tên | 1–128 byte; giống hệt nhau ở hai header; UTF-8 hợp lệ |
| Thuộc tính ngoài | host Unix (`3`): loại file trong `attr >> 16` là `0` hoặc file thường (`0100000`). Symlink, thư mục: từ chối. Host MS-DOS (`0`): bit thư mục `0x10` phải tắt |
| Disk number start | 0 |

Lệch giữa hai header, hay giá trị ngoài luật: `E_PKG_FORMAT`.

**Giải nén:**

- Deflate thô (không header zlib).
- Dừng ngay khi số byte ra vượt kích thước gốc khai báo. Kết thúc phải đúng hết dữ liệu nén và đúng kích thước gốc. CRC32 phải khớp.
- Không tin số trong header: đếm byte thật.

## 3. Manifest `matscada.json`

Entry đầu, stored, ≤ 262.144 byte, UTF-8 không BOM.

```json
{
  "format": "matscada-package",
  "formatVersion": "1.0.0",
  "project": {
    "projectId": "tank-demo",
    "projectName": "Tank demo",
    "projectVersion": "1.3.0",
    "minRuntimeVersion": "0.4.0"
  },
  "createdAt": "2026-10-20T03:10:00Z",
  "generator": { "name": "mAT Studio", "version": "0.2.0" },
  "files": [
    { "path": "project.json", "size": 812, "sha256": "…64 hex…" },
    { "path": "screens/overview.bindings.json", "size": 2310, "sha256": "…" },
    { "path": "screens/overview.screen.json", "size": 1450, "sha256": "…" },
    { "path": "screens/overview.svg", "size": 30411, "sha256": "…" },
    { "path": "tags.json", "size": 5120, "sha256": "…" }
  ],
  "digest": "sha256:…64 hex…"
}
```

| Khóa | Luật |
|---|---|
| `format` | đúng `"matscada-package"` |
| `formatVersion` | SemVer. MAJOR khác `1`: `E_PKG_FORMAT_VERSION`. MINOR lớn hơn: đọc được |
| `project.*` | bằng giá trị cùng tên trong `project.json` của gói; khác thì `E_PKG_IDENTITY` |
| `createdAt`, `generator` | chỉ để hiển thị; không vào digest |
| `files[]` | 1–1023 mục; `path` duy nhất, sắp tăng dần theo byte UTF-8; `size` số nguyên ≥ 0; `sha256` 64 hex chữ thường. Không có `matscada.json` |
| `digest` | như §4 |

- Khóa lạ ở cấp đầu, trong `project` và trong `generator` được bỏ qua, để bản MINOR sau thêm khóa được.
- Mỗi mục của `files[]` có đúng ba khóa `path`, `size`, `sha256`.
- Khóa đã biết mà thiếu hoặc sai kiểu: `E_PKG_MANIFEST`.
- Schema: `schemas/package-manifest.schema.json` (task tạo). C++ kiểm bằng valijson; Rust kiểm bằng serde.

## 4. Digest nội dung

```text
lines  = với mỗi f trong files, sắp theo path (byte UTF-8):  f.sha256 + " " + f.size + " " + f.path + "\n"
digest = "sha256:" + hex( SHA-256( UTF-8(nối các lines) ) )
```

- `size` viết thập phân, không có số 0 ở đầu.
- Đường dẫn không chứa ký tự điều khiển (§5), nên không lẫn với `\n`.
- Manifest không nằm trong digest.

**Ví dụ** (cũng là vector `digest-basic`). Ba file, nội dung kết thúc bằng `\n`:

| path | nội dung | size | sha256 |
|---|---|---|---|
| `project.json` | `{"projectId":"demo"}` | 21 | `c2de611dec8c30e06c2e27e6cbf5ea4a95e27c75b88f4791c0ad700b62ac8310` |
| `screens/main.svg` | `<svg xmlns="http://www.w3.org/2000/svg"/>` | 42 | `fb91f9a03c202c5f160eef644da6f2f704b19ac5c5f8b4c124e1b0b485ad57a0` |
| `tags.json` | `{"schemaVersion":"0.1.0","tags":[]}` | 36 | `b7869ffaa4571f9761542fbb1656a6e75e11bb2cfc4284dc844241dbdc6ba0f2` |

Digest: `sha256:c337083b40dd7b12f8db0ace06bfb5fb8bb682931ef795cbf030dfcd0e14e119`.

## 5. Đường dẫn và loại file

Mọi đường dẫn (tên entry, `files[].path`):

1. đạt `isSafeRelPath` hiện có: 1–128 byte UTF-8, không bắt đầu bằng `/`, không `\` hay `:`, không ký tự điều khiển, không đoạn rỗng, `.` hay `..`;
2. không chứa `<`, `>`, `"`, `|`, `?`, `*`;
3. không đoạn nào kết thúc bằng `.` hay khoảng trắng;
4. không đoạn nào là tên thiết bị của Windows, không phân biệt hoa thường, có hay không có đuôi, kể cả khoảng trắng trước đuôi (`con .json`, T062): `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`;
5. sâu tối đa 8 đoạn;
6. đuôi `.json` hoặc `.svg`, chữ thường;
7. không trùng nhau khi đổi A–Z thành a–z;
8. chỉ manifest được tên `matscada.json`.

Vi phạm 1–5, 7, 8: `E_PKG_PATH`. Vi phạm 6: `E_PKG_TYPE`.

Từ T062 (rà soát bảo mật 011, S2), luật 3 và 4 cũng thuộc `isSafeRelPath` của bộ kiểm project (TS, C++; mã `E_PATH`), `safeRelPath` của kho project trên thiết bị và `check_rel` của Studio (`bad-path`): một tên bị gói từ chối thì cũng không vào được project. Vector chung: `path-device-name`, `path-device-name-space`, `path-trailing-dot`, `path-trailing-space` (gói); `v10-logic-path-device-name`, `v10-logic-path-device-space`, `v10-logic-path-trailing-dot` (project).

**Tập file:** mọi entry (trừ manifest) phải có trong `files` (`E_PKG_UNLISTED`), và mọi mục của `files` phải có entry (`E_PKG_MISSING`). Bộ kiểm tra project chạy sau, nên file thừa không được tham chiếu cũng bị từ chối ở đây.

## 6. Giới hạn và mã lỗi

| Giới hạn | Giá trị | Mã |
|---|---|---|
| Gói | ≤ 50 MiB | `E_PKG_TOO_LARGE` |
| Số entry | 1–1024 (gồm manifest) | `E_PKG_ENTRIES` |
| File `.json` sau giải nén | ≤ 1 MiB (như bộ kiểm tra hiện có) | `E_PKG_SIZE` |
| File `.svg` sau giải nén | ≤ 5 MiB (ADR-003) | `E_PKG_SIZE` |
| Tổng sau giải nén | ≤ 200 MiB | `E_PKG_SIZE` |
| Tỉ lệ nén, entry > 64 KiB | ≤ 100 | `E_PKG_RATIO` |

| Mã | Khi nào |
|---|---|
| `E_PKG_FORMAT` | không đúng tập con §2; dữ liệu deflate hỏng |
| `E_PKG_MANIFEST` | không có manifest ở entry đầu; manifest sai JSON hoặc schema; `files` trùng hoặc chưa sắp xếp |
| `E_PKG_FORMAT_VERSION` | MAJOR khác 1 |
| `E_PKG_CHECKSUM` | CRC32, SHA-256 hoặc kích thước khác manifest |
| `E_PKG_DIGEST` | `digest` khác giá trị tính lại; khác header `X-Mat-Digest` (nạp xuống) hoặc khác digest mong đợi (đọc lên) |
| `E_PKG_IDENTITY` | trường project của manifest khác `project.json` |
| `E_PKG_SECRET` | khóa JSON giống bí mật (cùng danh sách từ với `E_LOG_SECRET`: `password`, `passwd`, `pwd`, `secret`, `token`, `apikey`, `api_key`) trong file JSON bất kỳ; URL kết nối có tài khoản; chuỗi `-----BEGIN` … `PRIVATE KEY-----` trong file bất kỳ |
| `E_PKG_PATH`, `E_PKG_TYPE`, `E_PKG_UNLISTED`, `E_PKG_MISSING`, `E_PKG_SIZE`, `E_PKG_RATIO`, `E_PKG_ENTRIES`, `E_PKG_TOO_LARGE` | xem trên |

Mỗi lỗi kèm `path` của entry khi có. Gặp lỗi đầu tiên thì dừng: không giải nén tiếp.

## 7. Ghi gói tất định

Studio đóng gói project đang mở; thiết bị đóng gói project cài theo cách cũ (một lần, khi nhận vào kho).

- Manifest là entry đầu, stored. Các file sắp theo `path` (byte UTF-8).
- Giờ DOS `0x0000`, ngày DOS `0x0021` (1980-01-01 00:00:00).
- Cờ: bit 11. "Version made by" `20` (MS-DOS); thuộc tính trong và ngoài `0`.
- Không extra field, không comment, không data descriptor.
- Phương thức:
  - Studio: deflate (mức 6, `flate2`), trừ khi bản nén không nhỏ hơn bản gốc thì stored;
  - thiết bị: stored.
- `createdAt` lấy giờ lúc đóng gói, `generator` là tên và phiên bản công cụ.

Cùng nội dung và cùng phiên bản công cụ cho cùng byte. Digest (§4) giống nhau bất kể công cụ, mức nén hay thời điểm.

## 8. Giải nén

**Thiết bị** (bước `verify-package`):

- Ghi vào `staging/<opId>/project/` do runtime tạo (`0700`).
- Thư mục con tạo bằng `mkdirat` theo file descriptor của thư mục cha; không đi theo symlink.
- File mở bằng `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`, quyền `0600`.
- `fsync` từng file, rồi từng thư mục.

**Studio** ("đọc lên thành project mới"):

- Chỉ vào thư mục rỗng do người dùng chọn bằng hộp thoại.
- Mở file bằng `create_new`: lỗi nếu file đã có. Điều này cũng bắt trùng tên không phân biệt hoa thường trên NTFS.
- Sau khi ghi, đọc lại và so SHA-256.

## 8a. Quyết định bổ sung (2026-10-11)

Các luật dưới đây (phiên làm việc chốt ngày 2026-10-11 (người dùng giao toàn quyền quyết định), theo các điểm mơ hồ agent viết vector T013/T014 nêu ra) bổ sung §2–§8. Bộ đọc C++ và Rust, và bộ vector `tests/package-vectors/` theo đúng các luật này.

- **Thứ tự kiểm** (lỗi đầu tiên gặp là mã trả về): kích thước gói (`E_PKG_TOO_LARGE`) → EOCD và số entry (`E_PKG_ENTRIES`, `E_PKG_FORMAT`) → từng entry: luật đường dẫn 1–5, 7, 8 của §5 trước luật 6 → manifest → giải nén, kích thước, tỉ lệ → checksum → tập file → digest, identity, formatVersion → bí mật.
- **Thuộc tính file:** symlink (`S_IFLNK`) và thư mục (`S_IFDIR` hoặc bit DOS 0x10) → `E_PKG_PATH`; loại file Unix khác ngoài file thường → `E_PKG_FORMAT`. "Host" trong "version made by" chỉ nhận 0 (MS-DOS) và 3 (Unix); giá trị khác → `E_PKG_FORMAT`.
- **Tên entry:** dài hơn 128 byte hoặc không phải UTF-8 hợp lệ → `E_PKG_PATH` (tên là đường dẫn). Hai entry trùng tên (kể cả chỉ khác hoa thường) → `E_PKG_PATH`; đường dẫn trùng trong `files[]` của manifest → `E_PKG_MANIFEST`.
- **Kích thước khai báo nhỏ hơn dữ liệu thật** (thừa dữ liệu sau khi đủ kích thước khai báo) → `E_PKG_FORMAT` kèm `path`.
- **Lỗi bố cục** (entry chồng lấn, khoảng trống, dữ liệu thừa trước entry đầu hay sau EOCD) → `E_PKG_FORMAT`, không có `path`.
- **Manifest:** là entry đầu tiên, `stored` (method 0); nén deflate → `E_PKG_MANIFEST`. `matscada.json` xuất hiện trong `files[]` → `E_PKG_MANIFEST`. Manifest cũng được quét bí mật (`E_PKG_SECRET`). Schema của manifest **không** đặt pattern cho `files[].path`: đường dẫn được kiểm bằng luật §5 và trả `E_PKG_PATH`, không phải `E_PKG_MANIFEST`.
- **"Tổng sau giải nén"** tính mọi entry, kể cả manifest.
- **Thứ tự entry:** bộ ghi phải ghi theo đường dẫn tăng dần (byte UTF-8) sau manifest; bộ đọc không bắt buộc thứ tự (digest không phụ thuộc thứ tự entry).
- **Ghi gói:** "version needed to extract" = 20; "version made by" = 0x0314 (Unix, 2.0) hoặc 20 (MS-DOS) — cả hai bộ ghi dùng cùng một giá trị cố định để gói tất định.

## 9. Vector test (`tests/package-vectors/`)

Mỗi vector: file `.matscada` (hoặc script sinh ra nó) và `expected.json` (`ok` + digest, hoặc mã lỗi + `path`). Bắt buộc có:

- **Hợp lệ:** `tank-demo` do Studio đóng gói; `tank-demo` do thiết bị đóng gói (stored) → cùng digest; project có tên file tiếng Việt.
- **ZIP bomb:**
  - một entry 1 MiB nén còn khoảng 1 KiB (tỉ lệ > 100);
  - tổng sau giải nén > 200 MiB;
  - entry chồng lấn (kiểu "zip bomb không đệ quy" của Fifield);
  - kích thước khai báo nhỏ hơn dữ liệu thật.
- **Đường dẫn:** `../x.json`, `/etc/x.json`, `a\b.json`, `C:x.json`, `CON.json`, `a./b.json`, `A.json` cùng `a.json`, symlink (thuộc tính Unix), entry thư mục, sâu 9 cấp, đuôi `.js`.
- **Cấu trúc:** ZIP64, mã hóa, data descriptor, extra field, comment, dữ liệu thừa trước entry đầu, dữ liệu thừa sau EOCD, header cục bộ khác central.
- **Nội dung:** checksum sai, kích thước sai, file ngoài manifest, manifest thiếu file, digest sai, `projectId` của manifest khác `project.json`, `formatVersion` 2.0.0, khóa `password` trong `tags.json`, khóa riêng PEM trong SVG.
- **Kích thước:** gói 50 MiB + 1 byte; 1025 entry.
- **Digest:** `digest-basic` (§4); thứ tự đường dẫn có chữ hoa và ký tự UTF-8.

C++, Rust và TS (chỉ phần digest) chạy cùng bộ vector.
