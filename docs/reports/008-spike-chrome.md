# 008 — Spike Chrome (T006)

Ngày đo: 2026-10-13. Trình duyệt: Chrome/155.0.8059.40 headless (puppeteer-core), x64 Windows, `deviceScaleFactor` 1.
Script tái chạy: `node tools/svg-import/spike-chrome.mjs [--out docs/reports/008-spike-chrome.json]` (mã thoát 0 = mọi kiểm đạt). Kết quả thô: [008-spike-chrome.json](008-spike-chrome.json).
Mọi phần tử dựng trong **Shadow DOM** (đúng như item `svg` của trang), có một `clipPath` cùng id đặt ở cây thường làm mồi.

**Kết luận: cả năm kiểm đạt, giả định R9 và R10 đúng; không cần dùng phương án dự phòng (phần tử bọc `<g>`, `clip-path: inset()`).**

| Kiểm | Câu hỏi | Kết quả | Đạt |
|---|---|---|---|
| a1 | Chuỗi `translate(tx,ty) matrix(M0) translate(cr) rotate() translate(-cr) translate(cs) scale() translate(-cs)` đúng vị trí? 6 `M0` (dời, quay 90, co giãn, lệch, hợp cả bốn, đơn vị) × 4 bộ tham số (kể cả pivot quay khác pivot co giãn) | hộp bao so với tính bằng `DOMMatrix`: sai lệch lớn nhất 0,000015 px | có |
| a2 | Ca tính tay: `M0 = rotate(90)`, dời (200, 100), hình (10, 20, 60, 30) | hộp (150, 110)-(180, 170), đúng bằng tay | có |
| a3 | CSS `transform` che thuộc tính `transform` gốc (lỗi im lặng của 0.2) | xác nhận | có |
| b1 | Hoạt ảnh Web Animations hai khung `rotate(0)` → `rotate(360deg)` cùng cấu trúc, `matrix()` M0 gồm quay, co giãn, lệch ở trong: có giật? | tua 40 mốc: sai lệch lớn nhất 0,000007 px so với tính tay | có |
| b2 | Chạy thật 1,5 s | 137 khung, sai lệch so với `currentTime` của khung 0,0000 px | có |
| b3 | `updatePlaybackRate(3)` giữ thời gian | `currentTime` 2431,4 → 2431,4 ms; sau 300 ms thực chạy thêm ≈ 930 ms (đúng tốc độ 3) | có |
| b4 | `setKeyframes` khi đổi `tx`, `sx` giữa lúc quay | `currentTime` giữ nguyên (3361,3 ms); hình đúng theo tx, sx mới (0,000015 px) | có |
| b5 | Chi phí `setKeyframes` | 0,018 ms/lần (1.000 lần, chuỗi mới mỗi lần) | có |
| c1 | `clipPath` `userSpaceOnUse` tạo lúc chạy trong `<defs>` của Shadow DOM, `clip-path="url(#id)"`, phần tử có `transform` dời | phần trong đỏ, phần ngoài trắng (đọc điểm ảnh); không lẫn với `clipPath` cùng id ở cây thường | có |
| c2 | Như c1, `transform` dời + quay 90 | đúng | có |
| c3 | Như c1, nhưng CSS `transform` kiểu R9 (`translate matrix(M0)`, M0 dời + co giãn 1,5) | đúng (clip đi theo hệ tọa độ có `transform`) | có |
| c4, c5 | Dự phòng `clip-path: inset(60% 0 0 0)` trên phần tử (dời; quay 90) | đúng cả hai | có |
| c6 | Đổi `y`/`height` của `rect` cắt sau khi dựng | hình đổi theo ngay | có |
| d | `shadowRoot.elementsFromPoint` trên SVG 20.002 phần tử (20.000 `line`/`polygon`/`rect` trong 2 nhóm có `transform`) | trung vị 1,8 ms, p95 2,7 ms, lớn nhất 4,0 ms (200 điểm); **lần gọi đầu 60 ms** (dựng cây hit-test); `elementFromPoint` một điểm cũng nhanh | có (ngưỡng ≤ 50 ms áp cho lần gọi thường; lần đầu cần khởi động trước) |
| e | `pointer-events: all` trên hình `fill="none"` | thuộc tính `pointer-events="all"` và `style` đều nhận; mặc định (kể cả có nét, nhấp giữa hình) không nhận; có nét + `all` nhận giữa hình | có |

## Ý nghĩa cho thiết kế

- **R9 (applier):** giữ nguyên thiết kế: một `style.transform` hợp, `transform-origin: 0 0`, `transform-box: view-box`; `spin` bằng hoạt ảnh hai khung, tốc độ bằng `updatePlaybackRate`, đổi dời/co giãn bằng `setKeyframes`. Không cần phần tử bọc `<g>`.
- **R10:** `clipPath` userSpaceOnUse trong Shadow DOM phân giải đúng trong cây của item (không lẫn cây thường) và theo `transform` của phần tử. `clip-path: inset()` cũng đúng trên Chrome 155 (dự phòng dùng được, nhưng không cần).
- **Hit-test (ADR-026):** nhận được hình `fill="none"` nhờ `pointer-events: all` (đặt bằng thuộc tính hoặc style). Lần `elementsFromPoint` đầu tiên của một item lớn mất ≈ 60 ms: Studio nên gọi một lần thử (khởi động) sau khi dựng item hoặc chấp nhận độ trễ ở lần nhấp đầu; các lần sau ≈ 2–3 ms.

## Giới hạn của spike

Chỉ đo Chrome 155 trên máy dev x64; chưa đo WebView2 của Studio (cùng lõi Chromium, nên kỳ vọng giống) và Chrome yếu của máy văn phòng (SC-005, SC-008 đo trong task riêng). Đo ảnh là điểm ảnh sau ảnh chụp màn hình (không dùng canvas).
