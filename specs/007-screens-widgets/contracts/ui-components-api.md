# Contract: `@mat/ui-components` (giao diện của thư viện widget)

**Feature**: [spec.md](../spec.md) FR-014…FR-019, FR-025…FR-037 · **Data model**: [data-model.md](../data-model.md) §6–§8 · **Research**: R7, R9–R12 · **ADR**: [019](../../../docs/adr/019-widget-library.md), [013](../../../docs/adr/013-screen-model-v1.md)

Package TypeScript thuần cộng phần tử Lit. Không gọi mạng, không Tauri, không `window.location` (nơi chứa lo). Chạy được trên jsdom (Vitest) và Chrome ≥ 120.

## 1. Bố cục package

```text
packages/ui-components/
├── package.json                  # @mat/ui-components 0.1.0; phụ thuộc lit, @mat/{binding-engine,svg-renderer,expression,project-schema}
├── src/
│   ├── index.ts
│   ├── host/                     # types.ts (TagSource, ActionHost, TagInfo…), memory-source.ts (nguồn thử cho test)
│   ├── screen/                   # mat-screen.ts, fit.ts (tính k), layers.ts, svg-item.ts
│   ├── control/                  # controller.ts (ControlController), lock-reasons.ts, confirm-dialog.ts, result-banner.ts
│   ├── format/                   # format-value.ts, quality.ts
│   ├── chart/                    # window.ts (ChartWindow), line-chart.ts (uPlot), bar-chart.ts, pie-chart.ts
│   ├── widgets/                  # card.ts, label.ts, lamp.ts, gauge.ts, level.ts, panel.ts, line.ts, bar.ts, pie.ts,
│   │                             # tag-table.ts, button.ts, switch.ts, setpoint.ts, slider.ts, select.ts, register.ts
│   ├── i18n/                     # vi.ts (chuỗi lý do khóa, kết quả ghi, trạng thái)
│   └── styles/                   # tokens.css (--mat-*), widget.css
└── README.md                     # danh mục widget (sinh từ widgets.catalog.json), cách nhúng
```

## 2. Giao diện nơi chứa

```ts
export type Quality = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE' | 'UNKNOWN'; // UNKNOWN: Tag lạ với thiết bị (trạng thái của trang)
export type TagScalar = boolean | number | string | null;

export interface TagState {
  value: TagScalar;          // INT64/UINT64: chuỗi thập phân khi ngoài ±2^53 (như live-client)
  quality: Quality;
  reason?: string;           // mã lý do của 006 (TIMEOUT, CLAMPED…)
  updatedAt?: number;        // ms UTC, giờ của BL335 khi có
}

export interface TagInfo {   // từ tags.json của project
  id: string;
  type: 'BOOL'|'INT16'|'UINT16'|'INT32'|'UINT32'|'INT64'|'UINT64'|'FLOAT32'|'FLOAT64'|'STRING';
  description?: string; unit?: string; min?: number; max?: number;
  access: 'R' | 'RW';
  kind: 'external' | 'internal' | 'calculated' | 'simulation';
  limits?: { min?: number; max?: number; maxLength?: number };
  valueTable?: string;
  deviceName?: string;       // tên thiết bị trường (connections), để hộp xác nhận hiện
}

export interface TagSource {
  info(id: string): TagInfo | undefined;
  get(id: string): TagState;                                   // luôn trả (UNKNOWN khi lạ)
  subscribe(ids: readonly string[], onChange: (changed: readonly string[]) => void): () => void;
  readonly connection: 'live' | 'stale' | 'offline';           // 'stale': mất dữ liệu; 'offline': chưa kết nối
  now(): number;                                                // giờ tham chiếu (ms UTC), ưu tiên giờ BL335
  valueTable(name: string): ValueTable | undefined;             // @mat/expression
}

export interface SessionInfo { user: string; role: 'viewer'|'operator'|'engineer'|'administrator'; }

export type WriteKind = 'write' | 'toggle' | 'pulse';
export interface WriteSpec {
  kind: WriteKind;
  tag: string;
  value: boolean | number | string;
  pulseMs?: number;           // chỉ kind = 'pulse'
  expect?: boolean;           // chỉ BOOL (toggle, switch)
  context: { screen: string; widget: string };
}

export type WriteStatus = 'ACCEPTED' | 'CONFIRMED' | 'REJECTED' | 'TIMEOUT' | 'FAILED' | 'UNKNOWN';
export interface WriteOutcome {
  status: WriteStatus;        // UNKNOWN: không lấy được kết quả sau 30 s (chỉ phía trang)
  code?: string;              // REJECTED/FAILED/TIMEOUT: mã của 006 (CONNECTION_BAD, RATE_LIMITED, STALE_EXPECTATION…)
  message?: string;           // câu của BL335 (tiếng Việt) nếu có
  retryAfterMs?: number;
  readback?: TagScalar;
}

export interface ActionHost {
  session(): SessionInfo | null;
  /** Lý do chung khiến mọi ghi bị khóa (HTTP, HTTPS không chạy, hết phiên…); null: không khóa. */
  writeBlocked(): { code: 'INSECURE' | 'HTTPS_DOWN' | 'SESSION_EXPIRED' | 'PROJECT_CHANGING'; message: string } | null;
  write(spec: WriteSpec, onPhase: (o: WriteOutcome) => void): Promise<WriteOutcome>; // onPhase: ACCEPTED rồi kết quả cuối
  navigate(screenId: string): void;
  openPopup(screenId: string): void;
  closePopup(): void;
  requestLogin(): void;       // trang: mở hộp Đăng nhập; Studio: không làm gì
}
```

Nơi chứa phải đảm bảo: `TagSource.get` và `subscribe` không ném lỗi; `ActionHost.write` không bao giờ tự gửi lại; `write` trả lời khi có kết quả cuối (`CONFIRMED`, `REJECTED`, `TIMEOUT`, `FAILED`, `UNKNOWN`).

## 3. `<mat-screen>`

```ts
class MatScreen extends LitElement {
  screen: ScreenModel;                      // mô hình v1 (toScreenModel)
  popup: ScreenModel | null;                // popup đang mở (lớp phủ)
  tags: TagSource; host: ActionHost;
  loadSvg: (path: string) => Promise<string>;
  loadBindings: (path: string) => Promise<ElementBindings02[]>;
  mode: 'run' | 'edit';                     // edit: widget pointer-events none, không hành động, không hộp xác nhận
  viewport: { width: number; height: number } | 'auto';   // 'auto': theo phần tử chứa (ResizeObserver)
  readonly scale: number;                   // k hiện tại
  /** Tập Tag cần đăng ký của màn hình (+ popup), bỏ item hidden; ≤ 1000 (đã kiểm ở validator). */
  tagIds(): string[];
  /** Hình chữ nhật item theo đơn vị thiết kế (cho lớp phủ của Studio). */
  itemRect(id: string): { x: number; y: number; width: number; height: number } | null;
  dispose(): void;
}
```

- Dựng theo [ADR-013](../../../docs/adr/013-screen-model-v1.md): khung `size`, item tuyệt đối, `transform: scale(k)`; vùng chứa tô `background`.
- Item `svg`: `mountScreen` (Shadow DOM riêng), `DomApplier` với binding đã tải; `elements` không có trong SVG thì cảnh báo console một lần (như hiện nay).
- Item widget: tạo `mat-w-<loại>`, gán `.item`, `.tags`, `.source`, `.host`, `.mode`, `.context = { screen: screen.id, widget: item.id }`.
- Mỗi lần `screen` đổi: dựng lại bằng so khóa theo `id` item (giữ phần tử khi cùng `id` và cùng `widget` để Studio không nhấp nháy khi sửa).
- `mode = 'edit'`: không gọi `host`; vẫn nhận `TagSource` (để xem giá trị mô phỏng).

## 4. Hợp đồng chung của widget

Mọi `mat-w-*` là `LitElement` với các thuộc tính JS (không phải thuộc tính HTML):

| Thuộc tính | Kiểu | Ý nghĩa |
|---|---|---|
| `item` | `WidgetItem` | cấu hình (props, tags, events, security) |
| `source` | `TagSource` | |
| `host` | `ActionHost` | widget hiển thị không dùng |
| `mode` | `'run' \| 'edit'` | |
| `context` | `{ screen, widget }` | gắn vào `WriteSpec.context` |

- Widget không giữ trạng thái giá trị riêng ngoài ánh xạ `TagState`; render là hàm của (`item`, `TagState`, trạng thái điều khiển).
- Đăng ký giá trị: `connectedCallback` gọi `source.subscribe(tagIds(item))`, `disconnectedCallback` hủy; cập nhật dùng `requestUpdate` (Lit gom theo microtask; `<mat-screen>` giới hạn `requestAnimationFrame` cho cả màn hình ở chế độ ẩn tab).
- **Quy tắc quality (FR-018):** hàm `qualityView(state, mode)` trả `{ cls, badge, tooltip }` cho mọi widget: `BAD` (viền `--mat-bad`, nhãn "BAD", giá trị mờ), `STALE` (xám, "STALE"), `UNCERTAIN` (viền `--mat-warn`, chấm), `UNKNOWN` ("?" và khóa), `GOOD` (không gì). Luôn có chữ hoặc biểu tượng, không chỉ màu.
- **Vai trò ARIA:** `card`/`label`/`lamp`: `role="group"` hoặc `status` không `aria-live`; `gauge`, `level`: `role="meter"` với `aria-valuemin/max/now`; `line`/`bar`/`pie`: `role="img"` + `aria-label` mô tả (tên, giá trị hiện tại) và bảng dữ liệu ẩn có thể đọc (`tag-table` ẩn cho trình đọc màn hình ở `line`); `tag-table`: `role="table"`; `button`: `<button>`; `switch`: `role="switch"` `aria-checked`; `setpoint`: `<input inputmode="decimal">` có nhãn; `slider`: `<input type="range">`; `select`: `<select>`.

## 5. `ControlController`

```ts
type LockCode = 'NO_SESSION' | 'ROLE' | 'INSECURE' | 'HTTPS_DOWN' | 'SESSION_EXPIRED' | 'LIVE_LOST'
  | 'TAG_UNKNOWN' | 'TAG_READONLY' | 'QUALITY_BAD' | 'NO_VALUE' | 'BUSY' | 'OTHER_DIALOG' | 'PROJECT_CHANGING';

type ControlState =
  | { phase: 'locked'; code: LockCode; message: string }
  | { phase: 'ready' }
  | { phase: 'confirming'; draft: Draft }
  | { phase: 'sending'; requestId: string; draft: Draft; since: number }
  | { phase: 'result'; outcome: WriteOutcome; draft: Draft };

interface Draft { spec: WriteSpec; info: TagInfo; current: TagState; confirm: 'always' | 'none'; text?: string }

class ControlController {
  constructor(deps: { item: WidgetItem; source: TagSource; host: ActionHost; now(): number; uuid(): string; modal: ModalRegistry });
  readonly state: ControlState;
  onChange: (() => void) | null;
  /** Người dùng đề xuất một lệnh (nhấp nút, Enter ở ô, thả thanh trượt, chọn mục). Trả về false nếu khóa. */
  propose(kind: WriteKind, value: boolean | number | string, opts?: { pulseMs?: number }): boolean;
  confirm(): void;           // phase confirming → sending (gọi host.write)
  cancel(): void;            // confirming → ready
  dismissResult(): void;     // result → ready
  recompute(): void;         // gọi khi TagSource/ActionHost đổi (đổi lock, cập nhật dòng "hiện tại")
}
```

**Thứ tự kiểm khóa** (`lockOf`): `INSECURE`/`HTTPS_DOWN`/`SESSION_EXPIRED`/`PROJECT_CHANGING` (từ `host.writeBlocked()`; đứng đầu vì trên HTTP không thể đăng nhập, nên lý do đúng là "Mở bằng HTTPS", không phải "Đăng nhập") → `NO_SESSION` (chưa có phiên) → `ROLE` (role < `security.minRole`) → `LIVE_LOST` (`source.connection` ≠ `live`) → `TAG_UNKNOWN` → `TAG_READONLY` (`info.access` ≠ RW hoặc `kind` = `calculated`) → `QUALITY_BAD` (BAD hoặc STALE) → `NO_VALUE` (chưa có giá trị) → `BUSY` (đang `sending` hoặc `result` chưa đóng cho lỗi nặng) → `OTHER_DIALOG` (`modal` có hộp khác). UNCERTAIN không khóa.

**Chuyển trạng thái:**

- `propose`: kiểm `lockOf`; kiểm giá trị (kiểu, giới hạn widget ∩ Tag; thông báo "Ngoài giới hạn a–b", "Dùng dấu chấm thập phân"); `confirm` = `none` và Tag BOOL thì đi thẳng tới `sending`; ngược lại `confirming`.
- `confirm`: kiểm lại `lockOf` (đổi giữa chừng thì về `locked`, không gửi); sinh `requestId`; `host.write(spec, onPhase)`; `onPhase` cập nhật `sending` → có `ACCEPTED` thì hiện "đang chờ đọc lại".
- Kết quả cuối: `result`; `CONFIRMED` tự về `ready` sau 4 s; mọi kết quả khác ở lại tới `dismissResult`; `UNKNOWN` giữ khóa `BUSY` 10 s rồi cho đóng.
- Không bao giờ gọi `host.write` hai lần cho một `requestId`.

**Chữ tiếng Việt** (`i18n/vi.ts`): khóa → câu (ví dụ `NO_SESSION` "Đăng nhập để điều khiển", `ROLE` "Cần quyền operator", `INSECURE` "Mở bằng HTTPS để điều khiển", `LIVE_LOST` "Mất kết nối dữ liệu", `QUALITY_BAD` "Quality BAD: {lý do}", `TAG_READONLY` "Tag chỉ đọc"); kết quả (`CONFIRMED` "Đã ghi và xác nhận", `ACCEPTED` "Đã nhận, đang chờ", `TIMEOUT` "Không chắc đã ghi, kiểm tra giá trị thực trước khi thử lại", …); mã lý do của 006 (`CONNECTION_BAD`, `RATE_LIMITED`, `STALE_EXPECTATION`…) ánh xạ qua bảng một chỗ.

## 6. `ChartWindow`

```ts
class ChartWindow {
  constructor(opt: { series: number; capacity: number /* 3600 */; windowSec: number; sampleMs: number });
  /** Gọi mỗi sampleMs (hoặc khi tab hiện lại): ghi một mẫu cho mọi đường tại thời điểm t. */
  sample(t: number, values: ReadonlyArray<number | null>): void;   // null/NaN → ngắt đoạn
  /** Dữ liệu cho uPlot: [x[], y0[], y1[]…] chỉ trong cửa sổ cuối; x tính bằng giây. */
  snapshot(now: number): Float64Array[];
  reset(): void;
}
```

- Mẫu thiếu quá `3 × sampleMs` giữa hai lần `sample` thì chèn một điểm `NaN` để đứt (không nội suy).
- Bộ đệm vòng cố định `capacity`; không cấp phát mới sau khi khởi tạo.
- `ChartWindow` không biết uPlot, không biết Tag; `mat-w-line` nối `TagSource` → `sample` → `setData`.

## 7. `formatValue` và bảng giá trị

```ts
formatValue(state: TagState, info: TagInfo | undefined,
  opt: { decimals?: number; unit?: string | null; table?: ValueTable | null; boolWords?: [string, string] }
): { text: string; color?: string; unit: string }
```

Quy tắc ở [research.md](../research.md) R12. Dùng chung bởi card, label, lamp, bảng, hộp xác nhận, setpoint (hiển thị giá trị hiện tại), chú giải biểu đồ.

## 8. Token CSS (`--mat-*`)

`--mat-bg`, `--mat-surface`, `--mat-text`, `--mat-text-muted`, `--mat-accent`, `--mat-border`, `--mat-good`, `--mat-warn`, `--mat-bad`, `--mat-info`, `--mat-online`, `--mat-offline`, `--mat-radius`, `--mat-font`, `--mat-font-mono`, `--mat-chart-1`…`--mat-chart-8` (bảng màu series), cùng giá trị với token của Studio ([studio-ux.md](../../../docs/architecture/studio-ux.md) §7); sáng và tối theo `:root[data-theme]` và `prefers-color-scheme`. Widget không dùng mã màu cứng ngoài màu do project đặt.

## 9. Sự kiện của widget

Widget không phát sự kiện DOM ra ngoài để điều khiển (mọi tác động qua `host`). `<mat-screen>` phát `mat-ready` (đã dựng), `mat-tags` (`detail.ids`: tập Tag đổi) cho nơi chứa đăng ký live.

## 10. Test

Vitest (jsdom, thêm `puppeteer-core` cho kiểm bố cục thật ở e2e):

- `controller.test.ts`: mọi cặp (điều kiện → `LockCode`), thứ tự ưu tiên, các chuyển trạng thái, không gửi hai lần, đổi lock giữa `confirming`;
- `fit.test.ts`: `k` theo từng `fitMode` và kích thước cửa sổ;
- `window.test.ts`: vòng, đứt đoạn, mẫu lệch giờ, tab ẩn;
- `format-value.test.ts`: số, BOOL, bảng giá trị, INT64 chuỗi, STRING;
- `quality.test.ts`;
- từng widget: dựng với `MemoryTagSource`, kiểm `shadowRoot` (văn bản, ARIA), XSS (`<script>`, `"><img onerror>` hiện dạng chữ).
