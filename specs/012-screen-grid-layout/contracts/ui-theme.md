# Hợp đồng: chủ đề, token, biểu đồ

Mở rộng token `--mat-*` hiện có ([tokens.css](../../../packages/ui-components/src/styles/tokens.css)).

## 1. Chọn chủ đề

- `:root[data-mat-theme="vivid" | "industrial" | "dark"]`; không đặt = `industrial` (giá trị token hiện tại, không đổi).
- `data-theme="dark"` và `prefers-color-scheme` hiện có giữ cho `industrial`; `dark` là chủ đề riêng.
- Studio đặt theo `project.json` `theme` ở canvas và xem trước; khung IDE của Studio giữ chủ đề riêng của người dùng.

## 2. Token mới (mọi chủ đề phải khai đủ)

| Token | Ý nghĩa |
|---|---|
| `--mat-chart-1` … `--mat-chart-12` | màu nét chuỗi (8 token cũ giữ tên, thêm 9 đến 12) |
| `--mat-chart-1-soft` … `--mat-chart-12-soft` | màu vùng, nền nhạt |
| `--mat-seq-1` … `--mat-seq-9` | thang tuần tự (bản đồ nhiệt) |
| `--mat-div-1` … `--mat-div-9` | thang phân kỳ |
| `--mat-radius-lg` | bo góc card (vivid: 10px) |
| `--mat-shadow-card` | bóng card |
| `--mat-motion` | thời lượng hoạt ảnh (0ms khi `prefers-reduced-motion: reduce`) |
| `--mat-font` | `'Inter Variable', 'Segoe UI', system-ui, …` ở vivid |

Kiểm tự động: mọi cặp chữ/nền khai trong bảng cặp của test đạt ≥ 4,5:1 ở cả ba chủ đề.

## 3. Biểu đồ

- Widget đọc màu chuỗi từ token, không mã màu cứng; màu project đặt (`props.series[i].color`) thắng token.
- `bar`, `pie` (thêm `props.donut`), `gauge`: vẽ bằng ECharts (sau spike R2), nạp lười qua `chart/echarts-lite.ts` (`loadECharts(): Promise<EChartsLite>`); thuộc tính `props` hiện có giữ nguyên ý nghĩa.
- `line`, `history-*`: uPlot, đọc token mới cho lưới, trục, tooltip.
- `card`: thêm `props.sparkline` (bool, mặc định false) và `props.trend` (bool): đường nhỏ 60 điểm gần nhất từ bộ đệm sống và mũi tên tăng/giảm.
- Danh mục widget (`widgets.catalog.json`) thêm `minHeight` cho mỗi widget (dùng bởi hàng `auto` của lưới).
