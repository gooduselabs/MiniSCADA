# Thời gian mở SVG trên Chrome từ BL335 (US3 — T039, SC-005)

Dữ liệu thô của lần đo mới nhất: [svg-load.json](svg-load.json). Fixture: [tests/fixtures/svg/](../../tests/fixtures/svg/README.md). Trang đo: [apps/runtime-web](../../apps/runtime-web). Công cụ: [tools/measure/svg-load.mjs](../../tools/measure/svg-load.mjs). Khác biệt định dạng giữa các phần mềm: [svg-dialects.md](../architecture/svg-dialects.md).

## Kết luận

**19/19 file hiển thị trong ≤ 2 s** ở lần đo mới nhất (lớn nhất 554 ms, ở file Inkscape 4,34 MB / 27.025 phần tử sau lọc). Lần đo đầu với 13 file cũng đạt (lớn nhất 936 ms). Chuỗi "BL335 phục vụ file `.gz` → Chrome dựng SVG" đạt ngưỡng với biên lớn. Đây là kết luận **trong điều kiện đo ghi bên dưới**, chưa phải bằng chứng cuối cùng cho SC-005 vì các hạn chế ở mục "Hạn chế".

## Các lần đo

| Lần | Thời điểm (2026-10-10) | Trang thử | Số file | Lớn nhất | Ghi chú |
|---|---|---|---|---|---|
| 1 | 11:21 | bản đầu: chèn SVG thẳng vào trang, bộ lọc denylist | 13 | 936 ms (file stress; một lần tải 605 ms do Wi-Fi) | số liệu chi tiết ở lịch sử của file này |
| 2 | 13:09 | **bản cuối**: Shadow DOM, bộ lọc theo namespace/localName, nhận diện định dạng (`inspect`), CSP | 19 (thêm 5 file mô phỏng và 1 file LibreOffice thật) | **554 ms** (file stress) | bảng bên dưới; `mat-poc` build từ mã đã clang-format |

## Cách đo

- Máy dev gọi `mat-poc` armhf (CivetWeb, `--docroot /root/matpoc/web`, cổng 8080) chạy trên BL335; Chrome **154.0.8037.98** chạy headless trên máy dev do `puppeteer-core` điều khiển.
- Mỗi file tải **5 lần**, `fetch(..., {cache: 'no-store'})` (không dùng cache của trình duyệt), xen kẽ tuần tự.
- "Tổng" = từ lúc bắt đầu `fetch` đến sau **khung hình thứ hai** khi SVG đã được chèn vào DOM (`requestAnimationFrame` ×2). Gồm: tải, parse XML, nhận diện định dạng, bộ lọc, chèn vào Shadow DOM, style/layout/paint ở luồng chính.
- Kiểm tra chéo ở lần 1 (chạy tay 5 lần, file stress): đến khi `page.screenshot()` trả về, tức đã raster và xuất khung hình: 590–946 ms (DOM xong 407–575 ms). Vẫn ≤ 2 s.
- Thiết bị phục vụ bản **nén sẵn** (`.gz`): file stress 4.551.595 B → 554.399 B trên đường truyền.

## Kết quả lần 2 (bản trang thử cuối)

`Truyền` là `transferSize` của trình duyệt, gồm cả header HTTP. `Phần tử` là số phần tử sau lọc. `Nguồn` và `Cảnh báo` do `inspect.ts` nhận diện.

| Tệp | Gốc | Truyền (gzip) | Phần tử | Trung vị (ms) | Lớn nhất (ms) | Nguồn (inspect) | Cảnh báo | Kết luận |
|---|---|---|---|---|---|---|---|---|
| clippath.svg | 1.0 KB | 1.3 KB | 15 | 40.6 | 90.2 | không rõ | 0 | ✓ |
| factory-isometric-stress.svg | 4.34 MB | 541.7 KB | 27025 | 482.2 | 554 | Inkscape 1.4.4 (chắc chắn) | 4 | ✓ |
| gauge.svg | 1.5 KB | 0.9 KB | 20 | 13.9 | 90.4 | không rõ | 0 | ✓ |
| gradients.svg | 1.7 KB | 0.9 KB | 23 | 13.8 | 14 | không rõ | 1 | ✓ |
| icon-set.svg | 1.1 KB | 0.8 KB | 18 | 13.8 | 14 | không rõ | 0 | ✓ |
| motor.svg | 1.4 KB | 0.9 KB | 21 | 13.7 | 13.9 | không rõ | 0 | ✓ |
| nested-groups.svg | 1.4 KB | 0.8 KB | 18 | 13.9 | 14 | không rõ | 0 | ✓ |
| pipe.svg | 1.2 KB | 0.9 KB | 16 | 13.8 | 13.9 | không rõ | 0 | ✓ |
| process-overview.svg | 2.5 KB | 1.2 KB | 31 | 13.9 | 14.1 | không rõ | 0 | ✓ |
| real-libreoffice-draw.svg | 38.3 KB | 10.4 KB | 280 | 13.9 | 19.5 | LibreOffice (chắc chắn) | 2 | ✓ |
| synthetic-coreldraw.svg | 1.5 KB | 1.2 KB | 11 | 13.7 | 14 | CorelDRAW (chắc chắn) | 1 | ✓ |
| synthetic-drawio.svg | 3.2 KB | 1.5 KB | 18 | 13.8 | 27.9 | draw.io (chắc chắn) | 1 | ✓ |
| synthetic-illustrator-export.svg | 1.5 KB | 1.1 KB | 16 | 13.8 | 13.9 | Adobe Illustrator (Export As) (có dấu hiệu) | 0 | ✓ |
| synthetic-illustrator-saveas.svg | 2.1 KB | 1.5 KB | 14 | 13.9 | 14.1 | Adobe Illustrator 28.0.0 (chắc chắn) | 4 | ✓ |
| synthetic-inkscape-features.svg | 2.3 KB | 1.5 KB | 15 | 13.8 | 16 | Inkscape 1.4.4 (chắc chắn) | 4 | ✓ |
| tank.svg | 1.3 KB | 0.9 KB | 20 | 13.9 | 13.9 | không rõ | 0 | ✓ |
| unsafe-elements.svg | 1.2 KB | 1.0 KB | 6 | 13.8 | 13.9 | không rõ | 2 | ✓ |
| use-symbol.svg | 1.2 KB | 0.8 KB | 16 | 13.8 | 13.9 | không rõ | 0 | ✓ |
| valve.svg | 0.8 KB | 1.1 KB | 10 | 13.8 | 13.8 | không rõ | 0 | ✓ |

File stress, 5 lần (ms): tải 75–160, parse + nhận diện + lọc 170–239, dựng 164–194, tổng 421–554.

- Bộ lọc: `window.__svgPwned` vẫn `null` sau khi mở `unsafe-elements.svg` (script, `onload`, `onclick`, `javascript:` không chạy). Không có lỗi JavaScript trong trang.
- WebSocket trên BL335 trong lúc đo: đang nhận delta, 0 mất sequence (client mới có resync/STALE).

## Phía thiết bị trong lúc đo

- RSS `mat-poc` **2,1 MB**, đỉnh (`VmHWM`) 2.144 kB ở lần 2; lần 1 đỉnh 2,17 MB dù có cả 1 lần tải file 4,55 MB không nén. Phục vụ file tĩnh lớn không làm RSS tăng (đo theo tiến trình; không tính page cache của kernel).
- Lần 1 ghi `loadavg` 0,33 / 0,33 / 0,36 và `free -m` used 68 MB ngay sau đo. Chưa lấy mẫu CPU liên tục như baseline.

## Phụ thuộc vào file stress: giới hạn import của Master Plan

`factory-isometric-stress.svg` có 27.029 phần tử trước lọc, **vượt** giới hạn node mặc định 20.000 của Master Plan §7.3 (kích thước 4,34 MB và độ sâu 5 thì nằm trong giới hạn 5 MB / 32). Về hiệu năng hiển thị, Chrome vẫn dựng file này dưới 0,6 s ở lần đo mới nhất. Việc nâng giới hạn hay tối ưu file là **quyết định của Tech Lead**, chưa đưa ra ([svg-dialects.md](../architecture/svg-dialects.md)).

## Hạn chế (điều gì chưa được chứng minh)

1. **Fixture chưa đủ "thực tế".**
   - 12 file là SVG viết tay nhỏ (≤ 2,6 KB); 5 file là **mô phỏng** đặc trưng Illustrator/CorelDRAW/draw.io/Inkscape.
   - Chỉ 2 file **xuất thật**: file stress (Inkscape, người dùng xác nhận) và `real-libreoffice-draw.svg` (LibreOffice Draw).
   - **Chưa có SVG xuất thật từ Illustrator/CorelDRAW** (T036; FR-011 "≥ 3 phần mềm" chưa đạt).
   - Số liệu của các file nhỏ gần như chỉ phản ánh độ trễ mạng và 2 khung hình.
2. **Môi trường đo chưa đúng chuẩn SC-005** ("LAN 100 Mbps, PC văn phòng").
   - Máy dev nối **Wi-Fi** (Windows báo liên kết 1,2 Gbps), không phải cáp.
   - Tốc độ cổng `eth1` của BL335 **không đọc được** (`/sys/class/net/eth1/speed` rỗng; carrier = 1).
   - Thông lượng thực đo bằng `curl`: 4,55 MB trong 0,56 s ≈ 65 Mbps. Con số này gần trần 100 Mbps, nên nhiều khả năng cổng thiết bị là nút cổ chai, nhưng đây là suy luận.
3. **Một client.** Chưa đo cold load 10 client cùng lúc (Master Plan §6.2, ≤ 5 s) và chưa đo khi 10 client đang nhận 500 Tag/s.
4. **Chrome 154**, không phải bản tối thiểu 120; chưa thử Chrome 120.
5. **Bộ lọc là bản tối thiểu**, không phải importer/sanitizer allowlist của sản phẩm (Sprint 2). Thời gian chuẩn hóa của importer thật (CSS → thuộc tính, đổi id…) chưa nằm trong số đo.
6. Trong số đo "dựng" (rAF ×2), phần raster không đảm bảo xong. Kiểm tra chéo bằng ảnh chụp ở lần 1 bù một phần, và chỉ cho file stress.
7. Chưa thử Windows/Chrome khác nhau, màn hình độ phân giải cao, hay đồng thời nhiều tab trên cùng máy.

## Việc kéo theo

- Nếu có cáp LAN 100 Mbps: chạy lại `node tools/measure/svg-load.mjs http://192.168.1.110:8080/ --runs 5 --out docs/reports/svg-load.json`. Cần chạy `mat-poc` trên thiết bị trước; xem [quickstart](../../specs/001-platform-validation/quickstart.md) mục 6.
- Khi có SVG Illustrator/CorelDRAW: thêm vào fixtures, chạy `npm run svg:inspect -- tests/fixtures/svg`, đo lại, cập nhật báo cáo này.
