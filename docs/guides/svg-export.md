# Xuất SVG từ Inkscape, Illustrator và CorelDRAW để nhập vào Studio

Dành cho người vẽ sơ đồ và kỹ sư nhập file vào Studio (**Thêm, Đồ họa SVG...**, `Ctrl+Shift+I`). Studio luôn làm sạch file qua allowlist trước khi dùng: script, thuộc tính sự kiện, ảnh ngoài, DTD khai báo thực thể và `foreignObject` bị loại hoặc file bị từ chối. Làm theo hướng dẫn dưới đây thì báo cáo nhập ngắn, hình giống bản gốc và gắn Tag nhanh hơn. Nền tảng: [svg-dialects.md](../architecture/svg-dialects.md) (khác biệt giữa các phần mềm), [ADR-023](../adr/023-svg-import-allowlist-uid.md), contract [svg-import.md](../../specs/008-svg-import-binding/contracts/svg-import.md).

> **Mức kiểm chứng:** phần Inkscape dựa trên file xuất thật bằng Inkscape 1.4.3 (fixture `tests/fixtures/svg-import/inkscape-*`). Phần Illustrator và CorelDRAW dựa trên đặc trưng cấu trúc đã biết của file hai phần mềm này và trên fixture **mô phỏng** viết tay; tên menu và tùy chọn có thể khác theo phiên bản và ngôn ngữ giao diện, và chưa kiểm trên phần mềm thật (task T120 của feature 008 chờ file thật từ người dùng). Khi lệch, theo nguyên tắc: thuộc tính trình bày thay vì class, chuyển hoặc nhúng ảnh, giữ tên đối tượng có nghĩa, bỏ tùy chọn giản lược.

## Quy tắc chung (mọi phần mềm)

1. **Một màn hình hoặc một thiết bị một file.** File gọn dưới 1 MiB (từ 1 MiB Studio cảnh báo `W_SVG_HEAVY`: file phục vụ không nén trên BL335, nhiều client mở cùng lúc sẽ chậm). Giới hạn cứng: 5 MiB, 20.000 phần tử sau chuẩn hóa, độ sâu 32, 100.000 phần tử thô.
2. **Đặt `viewBox`** (hoặc cả `width` và `height`). Thiếu cả hai thì file bị từ chối (`E_IMPORT_SIZE`). Đơn vị `mm`, `cm`, `in`, `pt`, `pc` ở `width`/`height` được quy về px.
3. **Nhúng ảnh**, đừng liên kết. Chỉ nhận ảnh nhúng `data:image/png|jpeg|gif|webp;base64`; ảnh liên kết (`file:///C:/...`, `http:`) bị loại (`R_IMAGE_LINKED`, `R_HREF_EXTERNAL`) và không hiển thị trên máy khác. Tối đa 16 ảnh, tổng 2 MiB sau giải mã; ưu tiên vẽ bằng hình vector.
4. **Chữ:** dùng chữ thường (`text`) với họ font phổ biến (Arial, Segoe UI, sans-serif), hoặc chuyển chữ thành đường nét (outline) khi cần đúng hình chữ. Tránh chữ khung của Inkscape (`flowRoot`, `shape-inside`): Studio chuyển thành `text` một dòng kèm cảnh báo `W_IMPORT_FLOWTEXT_NOWRAP`, mất xuống dòng tự động. Font PostScript (`MyriadPro-Regular`) được đổi sang font dự phòng (`W_IMPORT_FONT_FALLBACK`); font SVG nhúng (`<font>`, `<glyph>`) bị loại.
5. **Đặt tên có nghĩa** cho nhóm và đối tượng sẽ gắn Tag ("Bồn 1", "Nước", "Cánh bơm"): Studio lấy tên hiển thị từ `inkscape:label`, `data-name` hoặc `id` có nghĩa; `path1234`, `SVGID_1_`, `Layer_1` bị bỏ qua và phần tử mang tên "loại số thứ tự". Gom phần tử cần động hóa vào **nhóm riêng** hoặc hình riêng (ví dụ lớp nước là một `rect`, kim đồng hồ là một nhóm có gốc ở tâm quay).
6. **Đừng dùng:** script, `onclick`/`onload`, hoạt ảnh SMIL (`animate`, `set`), `foreignObject` (HTML), `<style>` với `@import`, `url()` ra ngoài, filter nặng (tối đa 8 `filter`, 64 phần tử `fe*`). Hoạt ảnh làm bằng binding trong Studio, không làm trong file SVG.
7. **Không cần thiết kế lại khi sửa:** sửa file rồi dùng **Nhập lại SVG...** trên item: Studio đối chiếu với bản đang dùng để giữ UID và binding. Giữ nguyên thuộc tính `data-mat-uid` (Inkscape giữ `data-*`) cho kết quả đối chiếu chắc chắn nhất; mất cả `id` và `data-*` (ví dụ xuất lại qua LibreOffice) thì phải dựa vào cấu trúc và hình học, phần tử mơ hồ vào danh sách để chọn tay.

## Inkscape (1.x)

- **Lưu:** *Tệp, Lưu thành...* chọn **Inkscape SVG** (giữ `data-*`, nhãn lớp và nhóm) hoặc **Plain SVG** (nhỏ hơn, bỏ namespace Inkscape, **giữ `id`** nhưng có thể mất `inkscape:label`). Cả hai nhập được; chọn Inkscape SVG nếu muốn giữ nhãn làm tên phần tử. Không chọn "Optimized SVG" nếu bật tùy chọn xóa `id` (sẽ mất điểm neo khi nhập lại).
- **Kiểu (style):** *Tùy chọn, Đầu ra SVG, Thuộc tính kiểu*: cả `style="..."` lẫn thuộc tính trình bày đều nhập được; khối `<style>` với class (hay gặp khi dán từ file khác) được chuyển thành thuộc tính đúng thứ tự cascade (`C_CSS`). Báo cáo có `W_IMPORT_CSS_PARTIAL` khi gặp bộ chọn chưa hỗ trợ.
- **Ảnh:** *Tệp, Nhúng ảnh* hoặc khi nhập ảnh chọn **Nhúng**; kiểm bằng *Mở rộng, Ảnh, Nhúng ảnh*. Liên kết `file:///` bị loại.
- **Chữ:** *Đường dẫn, Đối tượng thành đường dẫn* (Shift+Ctrl+C) nếu cần giữ đúng hình chữ; hoặc dùng chữ thường một dòng, không dùng khung chữ.
- **Đơn vị:** file đơn vị mm có `viewBox` đi kèm là bình thường; nhập quy về px.
- **Kiểm tra bằng dòng lệnh** (không cần Studio): `npm run svg:inspect -- --import file.svg --report-dir out/` ghi `file.report.json` và `file.report.md`.

## Adobe Illustrator

- **Lưu bản mới:** *Tệp, Xuất, Xuất dạng...* (Export As) chọn **SVG**, hoặc *Xuất cho màn hình*; trong hộp tùy chọn đặt **Kiểu: Thuộc tính trình bày** (Presentation Attributes) thay vì "Nội tuyến" hoặc "Thuộc tính trình bày" kèm class; **Font: Chuyển thành đường viền** (Convert to outline) hoặc SVG; **Hình ảnh: Nhúng**; **ID đối tượng: Tên lớp** (hoặc Tên đối tượng) để giữ tên có nghĩa; bỏ chọn **Giảm thiểu** (Minify) và **Trả đáp ứng** (Responsive) nếu không cần. Tên đối tượng đặt ở bảng Lớp (Layers) trở thành `id`/`data-name`.
- **Bản cũ "Lưu thành" (Save As, SVG 1.1):** vẫn nhập được: Studio thay các thực thể Adobe đã biết trong DOCTYPE rồi bỏ DTD (`C_ENTITY`), mở nhánh dự phòng của `<switch>` (`C_SWITCH`), loại `foreignObject` và dữ liệu `i:pgf` (có thể rất lớn) cùng namespace Adobe. Nên chọn **Tùy chọn SVG, Chỉ định dạng chữ: SVG, Thuộc tính trình bày, Không "Giữ khả năng chỉnh sửa Illustrator"** (bỏ chọn *Preserve Illustrator Editing Capabilities*) để file nhỏ và sạch.
- **Chuyển đổi chữ:** nếu font không có trên máy khác, chọn chuyển chữ thành đường viền (mất khả năng sửa chữ, giữ đúng hình). Chữ động hóa bằng "Chữ hiển thị giá trị" của Studio thì **giữ là chữ** và dùng font phổ biến.
- **Gradient và id:** Illustrator đặt id gradient cố định (`linear-gradient`, `linear-gradient-2`...) giống nhau giữa mọi file; Studio thêm tiền tố theo từng file khi nhập nên ghép nhiều file vẫn đúng màu.

## CorelDRAW

- **Xuất:** *Tệp, Xuất...* hoặc *Xuất cho web...* (SVG). Trong hộp thoại SVG chọn **Kiểu: Thuộc tính trình bày** hoặc để mặc định (class CSS `.fil0`, `.str0`, `.fnt0` trong `<![CDATA[...]]>` vẫn được chuyển thành thuộc tính); **Văn bản: Chuyển thành đường cong** nếu cần đúng hình chữ, hoặc giữ văn bản với font phổ biến; **Bitmap: Nhúng**; bỏ chọn tùy chọn nén/giản lược nếu có.
- **Đơn vị:** CorelDRAW ghi `width`/`height` theo mm cùng `viewBox` 100 đơn vị/mm; Studio giữ `viewBox` và quy `width`/`height` về px (`C_UNITS`). Metadata `xodm` và `CorelCorpID` bị loại (`R_META`/`R_NAMESPACE`).
- **Id:** id kiểu `Layer_x0020_1` được giữ nếu hợp lệ; nên đặt tên đối tượng trong Trình quản lý đối tượng trước khi xuất.

## Phần mềm khác

- **draw.io:** xuất SVG với tùy chọn chuyển chữ HTML thành chữ SVG ("Text is not SVG" nghĩa là nhãn nằm trong `foreignObject`; Studio dùng chữ dự phòng, mất định dạng HTML).
- **LibreOffice Draw:** nhập được nhưng cấu trúc đổi hẳn (gradient thành nhiều `path`, mất `id` và `data-*`, font SVG nhúng); chỉ nên dùng khi không có công cụ khác, và đừng chỉnh bằng LibreOffice một file đã gắn Tag.
- Visio, AutoCAD (DWG sang SVG), Figma: chưa kiểm chứng; xuất SVG theo quy tắc chung rồi xem báo cáo nhập.

## Đọc báo cáo nhập

Sau khi chọn file, hộp thoại **Nhập SVG** liệt kê từng mục đã loại (`R_*`), đã đổi (`C_*`) và cảnh báo (`W_IMPORT_*`) kèm số lượng và tối đa 3 vị trí ví dụ. Mục `R_` là nội dung bị bỏ vì an toàn hoặc vì ngoài allowlist; mục `C_` là đã chuyển đổi mà hình không đổi; mục `W_` là hình có thể khác bản gốc. Đây là báo cáo của bốn file Inkscape trong `tests/fixtures/svg-import/` (chạy `npm run svg:inspect -- --import tests/fixtures/svg-import --report-dir out/`):

```text
inkscape-01-tank-process.svg: Inkscape, 21 -> 20 phần tử, 9 UID, loại 2 mục, chuyển 2, cảnh báo 0
inkscape-03-panel-text.svg:   Inkscape, 15 -> 10 phần tử, 7 UID, loại 3 mục, chuyển 3, cảnh báo 1
inkscape-04-pipes-flow.svg:   Inkscape, 15 -> 14 phần tử, 5 UID, loại 2 mục, chuyển 0, cảnh báo 0
```

Chi tiết của `inkscape-03-panel-text.svg` (có chữ khung `flowRoot`):

| Phần | Mã | Số lần | Ý nghĩa |
|---|---|---|---|
| Đã loại | `R_ATTR_NOT_ALLOWED` | 11 | thuộc tính ngoài danh sách cho phép (dữ liệu riêng của Inkscape) |
| Đã loại | `R_EMPTY` | 1 | `defs` rỗng |
| Đã loại | `R_NAMESPACE` | 1 | `sodipodi:namedview` (namespace của phần mềm vẽ) |
| Đã chuyển | `C_CSS` | 16 | khai báo CSS và `style` thành thuộc tính trình bày |
| Đã chuyển | `C_FLOWROOT` | 1 | chữ khung thành `text` một dòng |
| Đã chuyển | `C_XLINK` | 1 | `xlink:href` thành `href` |
| Cảnh báo | `W_IMPORT_FLOWTEXT_NOWRAP` | 1 | chữ khung mất xuống dòng: sửa bằng cách dùng chữ thường nhiều dòng riêng |

Phần mềm nhận diện ghi "Inkscape (có dấu hiệu)" vì Inkscape 1.4.3 không ghi `inkscape:version` khi xuất lại bằng dòng lệnh; vẫn nhập bình thường.

Nếu một mục `R_` làm hình mất thứ bạn cần (ví dụ ảnh liên kết, chữ khung), xuất lại theo hướng dẫn ở trên rồi nhập lại. Mã lỗi từ chối hẳn (`E_IMPORT_*`): `E_IMPORT_ENCODING` (không phải UTF-8: lưu lại dạng UTF-8), `E_IMPORT_PARSE` (XML hỏng), `E_IMPORT_ROOT` (gốc không phải `<svg>` hoặc sai namespace), `E_IMPORT_SIZE` (thiếu `viewBox` và kích thước), `E_IMPORT_LIMIT` (quá giới hạn: giảm độ phức tạp hoặc bật **Tối ưu** nếu chỉ vượt 20.000 phần tử), `E_IMPORT_DTD`, `E_IMPORT_USE_BOMB`, `E_IMPORT_EXT` (DTD hoặc `use` nguy hiểm, thực thể ngoài).

## Sau khi nhập

- Gắn Tag trong inspector (nhóm Gắn Tag và Sự kiện): xem mục "Nhập SVG và gắn Tag" của [apps/studio/README.md](../../apps/studio/README.md).
- Studio không có thư viện ký hiệu và không vẽ ([ADR-055](../adr/055-studio-config-only.md)): bơm, van, bồn… vẽ hoặc lấy từ thư viện của phần mềm vẽ rồi nhập như mọi bản vẽ khác.
- Hoạt ảnh chạy trên máy khách: mỗi màn hình tối đa 64 hoạt ảnh vô hạn không cảnh báo (`W_ANIM_MANY` ở trên 64, lỗi `E_LIMIT` ở trên 256).
