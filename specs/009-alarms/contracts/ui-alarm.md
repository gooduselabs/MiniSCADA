# Contract: giao diện alarm của `@mat/ui-components` 0.3.0 và trang runtime

**Feature**: [spec.md](../spec.md) FR-055…FR-072, SC-012, SC-014, SC-020, SC-024 · **Data model**: [data-model.md](../data-model.md) §9 (phía trang và widget) · **Research**: R16, R18 · **ADR**: [030](../../../docs/adr/030-alarm-web-studio.md), [019](../../../docs/adr/019-widget-library.md) · Mẫu: [ui-components-api.md](../../007-screens-widgets/contracts/ui-components-api.md), [widget-catalog.md](../../007-screens-widgets/contracts/widget-catalog.md)

Phần dùng chung (giao diện nơi chứa, thành phần bảng, widget) nằm ở `packages/ui-components` (không gọi mạng, không Tauri); phần riêng của trang (banner, trang Alarm, trang Lịch sử, huy hiệu, tiêu đề tab, âm thanh, CSV) nằm ở `apps/runtime-web/src/alarm/`. Bản tin và API: [live-protocol-1.3.md](live-protocol-1.3.md), [device-api-1.3.md](device-api-1.3.md).

## 1. Bố cục mã

```text
packages/ui-components/src/
├── host/types.ts                 # thêm: kiểu alarm, AlarmSource, mở rộng ActionHost
├── host/memory-source.ts         # thêm: MemoryAlarmSource, FakeActionHost.ackAlarms/shelveAlarm/unshelveAlarm
└── alarm/
    ├── alarm-source.ts           # AlarmSource, AlarmSnapshot, kiểu dữ liệu (xuất lại từ host/types.ts)
    ├── alarm-format.ts           # sắp xếp, lọc, gấp dấu tiếng Việt, nhãn trạng thái, SOUND_PATTERNS, BlinkClock
    ├── alarm-table.ts            # <mat-alarm-table>: thành phần bảng dùng chung
    ├── mat-alarm-list.ts         # widget alarm-list
    └── mat-alarm-count.ts        # widget alarm-count
apps/runtime-web/src/
├── alarm/
│   ├── alarm-client.ts           # AlarmSource dựa trên live 1.3.0 (LiveAlarmSource), AlarmActionClient (REST)
│   ├── banner.ts                 # banner (mô hình thuần + dựng DOM)
│   ├── alarm-page.ts             # trang #/alarms
│   ├── history-page.ts           # trang #/alarm-history
│   ├── csv.ts                    # sinh CSV ở trình duyệt
│   ├── sound.ts                  # bộ phát Web Audio
│   └── badge.ts                  # huy hiệu menu và tiêu đề tab
└── i18n/vi.ts                    # chuỗi giao diện của trang (khóa alarm.*)
```

`@mat/ui-components` lên 0.3.0 (3b dùng 0.2.0) (MINOR: thêm giao diện, thêm hai widget). Sau khi sửa `ActionHost` (§3) mọi nơi chứa phải cài ba hàm mới; `FakeActionHost` của test được cập nhật, `StudioActionHost` và `WebActionHost` cài thật.

## 2. Giao diện `AlarmSource`

```ts
export type AlarmType = 'digital' | 'limit' | 'quality';
export type AlarmLimitName = 'HH' | 'H' | 'L' | 'LL';
export type AlarmState = 'NORMAL' | 'ACTIVE_UNACK' | 'ACTIVE_ACK' | 'RTN_UNACK';
export type AlarmPriority = 'critical' | 'major' | 'minor' | 'advisory';
export type AlarmColor = 'red' | 'orange' | 'amber' | 'blue' | 'purple' | 'teal' | 'gray' | 'green';
export type AlarmSoundKind = 'none' | 'beep' | 'double' | 'siren';

export interface AlarmClassInfo {
  id: string; name: string; priority: AlarmPriority; color: AlarmColor;
  blink: boolean; requiresAck: boolean; ackReturn: boolean; sound: AlarmSoundKind; chatterLimit: number;
}
export interface AlarmAreaInfo { id: string; name: string }

export interface AlarmShelf {
  until: number;          // ms UTC (giờ thiết bị): chỉ để hiển thị
  remainingMs: number;    // tại thời điểm AlarmSnapshot.ts; trang đếm ngược bằng đồng hồ cục bộ
  reason: string; user: string;
  system: boolean;        // true: tự cách ly do chập chờn
}

export interface AlarmInstance {
  id: string;             // id instance: "PUMP1_FAULT" hoặc "TANK_B1_LEVEL.HH"
  alarmId: string; name: string; type: AlarmType; limit?: AlarmLimitName;
  occurrence: number;     // mã lần xảy ra; 0 khi chưa có (shelved/disabled ở NORMAL)
  rev: number;
  state: AlarmState;
  class: string; priority: AlarmPriority; area: string | null;
  text: string;           // chữ thô, chỉ vào DOM bằng textContent
  valueActive: boolean | number | string | null;
  qualityActive: 'GOOD' | 'UNCERTAIN' | 'BAD';
  reason?: string;
  tsActive: number; clockOk: boolean;
  tsAck?: number; ackUser?: string; tsReturn?: number;
  shelved?: AlarmShelf;
  disabled: boolean; inputBad: boolean; startup: boolean;
}

export interface AlarmCounts {
  active: number; unack: number; rtnUnack: number; shelved: number; disabled: number;
  byPriority: Record<AlarmPriority, { active: number; unack: number }>;
}

export interface AlarmSnapshot {
  instances: readonly AlarmInstance[];
  classes: readonly AlarmClassInfo[];
  areas: readonly AlarmAreaInfo[];
  counts: AlarmCounts;
  revision: number;      // giá trị làm upToRevision khi "Xác nhận tất cả"
}

/** `none`: project không có alarm. `unsupported`: thiết bị < 1.3.0. `stale`: mất kết nối, dữ liệu cũ. `offline`: chưa kết nối. */
export type AlarmSourceStatus = 'live' | 'stale' | 'offline' | 'unsupported' | 'none';

export interface AlarmSource {
  /** Luôn trả (rỗng khi chưa có dữ liệu); không ném lỗi; cùng một đối tượng cho tới khi có thay đổi. */
  snapshot(): AlarmSnapshot;
  /** `changed`: id instance đổi hoặc bị xóa; 'all' khi snapshot mới thay toàn bộ (kết nối lại) hoặc `status` đổi. Trả hàm hủy. */
  subscribe(onChange: (changed: readonly string[] | 'all') => void): () => void;
  counts(): AlarmCounts;
  classes(): readonly AlarmClassInfo[];
  areas(): readonly AlarmAreaInfo[];
  status(): AlarmSourceStatus;
  /** Giờ tham chiếu (ms UTC), cùng nguồn với TagSource.now(); để đếm ngược hạn tạm ẩn và tính thời lượng. */
  now(): number;
}
```

Quy tắc:

- `snapshot()` trả **bản chụp bất biến**: một đối tượng mới mỗi khi có thay đổi (so sánh bằng `===` đủ để biết đổi). Bảng, banner và widget dùng chung một nguồn.
- Nơi chứa phải đảm bảo `snapshot`, `subscribe`, `counts`, `classes`, `areas`, `status`, `now` **không ném lỗi** (như `TagSource`). `subscribe` gọi lại ở cuối microtask, gộp nhiều thay đổi của một bản tin live thành một lần gọi.
- Trang runtime cấp `LiveAlarmSource` (`alarm-client.ts`) dựa trên `@mat/live-client` 1.3.0; xem trước của Studio cấp bản dựa trên `@mat/alarm-engine` ([studio-alarm-editor.md](studio-alarm-editor.md) §7); `MemoryAlarmSource` (test) giữ snapshot do test đặt.
- Chọn trạng thái từ `hello` ([live-protocol-1.3.md](live-protocol-1.3.md) §9): `protocolVersion` < 1.3.0 là `unsupported`; ≥ 1.3.0 mà không có `features.alarms` là `none`; có `alarms` là `live` sau snapshot đầu, `stale` khi mất kết nối, `offline` trước khi kết nối lần đầu.
- Widget **không** có khe Tag và không gọi mạng (FR-069): chỉ đọc `AlarmSource` và gọi `ActionHost`.

## 3. Mở rộng `ActionHost`

```ts
export type AlarmAckResultCode = 'ACKED' | 'ALREADY_ACKED' | 'NOT_ACTIVE' | 'STALE' | 'SHELVED' | 'NOT_FOUND';

export interface AlarmFilter {            // dùng chung cho bảng và "Xác nhận tất cả"
  areas?: readonly string[];              // '-' là "Chung"
  classes?: readonly string[];
  priorities?: readonly AlarmPriority[];  // chính xác các mức này
  states?: readonly ('ACTIVE_UNACK' | 'ACTIVE_ACK' | 'RTN_UNACK')[];
  q?: string;
}

export type AlarmAckRequest =
  | { items: readonly { id: string; occurrence: number }[] }
  | { all: true; upToRevision: number; filter: AlarmFilter };

export interface AlarmActionError { code: string; message: string; field?: string; retryAfterMs?: number }

export interface AlarmAckOutcome {
  ok: boolean;                            // false: không có thay đổi (lỗi toàn bộ yêu cầu)
  error?: AlarmActionError;               // AUDIT_UNAVAILABLE, RATE_LIMITED, FORBIDDEN, SESSION_EXPIRED, NETWORK…
  results: readonly { id: string; occurrence: number; result: AlarmAckResultCode }[];
  acked: number; skippedNewer: number;
}

export interface AlarmShelveRequest { id: string; reason: string; durationS: number }
export interface AlarmActionOutcome { ok: boolean; error?: AlarmActionError; changed?: boolean }

export interface ActionHost {
  // … các hàm của 0.1.0 giữ nguyên …
  ackAlarms(req: AlarmAckRequest): Promise<AlarmAckOutcome>;
  shelveAlarm(req: AlarmShelveRequest): Promise<AlarmActionOutcome>;
  unshelveAlarm(id: string): Promise<AlarmActionOutcome>;
}
```

- `ackAlarms` ánh xạ `POST /api/v1/alarms/ack`; `shelveAlarm` ánh xạ `…/shelve`; `unshelveAlarm` ánh xạ `…/unshelve`. Cả ba **không bao giờ tự gửi lại**, không ném lỗi (lỗi vào `error`), trả khi có kết quả cuối (hoặc lỗi mạng sau 10 s: `error.code = 'NETWORK'`).
- `disable` và `enable` **không** có ở `ActionHost` và không có giao diện trên trang: vô hiệu là việc của kỹ sư dùng công cụ Bearer (Studio, `curl`); trang chỉ **hiện** cờ `disabled` (FR-032, D31).
- Khóa thao tác (FR-064): dùng `host.session()` và `host.writeBlocked()` có sẵn, cộng trạng thái nguồn: bảng `lockOf(source, host, role)` ở §7.2.
- `StudioActionHost` (xem trước Mô phỏng) chuyển ba hàm cho `@mat/alarm-engine` cục bộ (xác nhận thử, tạm ẩn thử, không audit); xem trước Thiết bị: **chỉ đọc** (ba hàm trả `ok:false`, `error.code = 'READ_ONLY'`, nút bị khóa, FR-081).

## 4. Thành phần bảng dùng chung `<mat-alarm-table>`

Một phần tử Lit dùng ở trang Alarm (`#/alarms`), widget `alarm-list` và panel "Thử alarm" của Studio (FR-070): một cách hiển thị.

```ts
class MatAlarmTable extends LitElement {
  alarms: AlarmSource;
  host: ActionHost;
  mode: 'run' | 'edit';                       // edit: không gọi host, không nhấp nháy
  columns: readonly AlarmColumn[];            // thứ tự hiển thị
  filter: AlarmFilter & { minPriority?: AlarmPriority };
  tab: 'active' | 'shelved';                  // 'active': state ≠ NORMAL và không shelved; 'shelved': đang shelved
  sort: { column: AlarmColumn; dir: 'asc' | 'desc' } | null;   // null: mặc định (ưu tiên, rồi bật gần nhất trước)
  maxRows: number | null;                     // widget: cắt tại đây; trang: null
  selectable: boolean;                        // hộp chọn từng hàng
  showAck: boolean;                           // cột nút Xác nhận mỗi hàng
  showShelve: boolean;                        // nút Tạm ẩn (chỉ trang)
  readonly selection: ReadonlySet<string>;    // id instance đang chọn
  /** Hàng đang hiện sau lọc, theo thứ tự hiển thị (cho banner "Xác nhận tất cả"). */
  visibleRows(): readonly AlarmInstance[];
  focusRow(id: string): void;
}
type AlarmColumn = 'time' | 'priority' | 'area' | 'text' | 'value' | 'state' | 'ackUser';
```

- **Cập nhật theo `id`** (FR-066): dựng bằng `repeat(rows, r => r.id, …)` của Lit; chỉ hàng đổi mới dựng lại; gom bằng một `requestAnimationFrame`; 200 hàng cập nhật liên tục có thời gian khung trung bình ≤ 16,7 ms (đo ở e2e).
- **Sắp xếp mặc định:** ưu tiên (`critical` trước), rồi `tsActive` giảm dần; hòa: `occurrence` giảm dần; instance cùng định nghĩa (ngưỡng): HH trước H, LL trước L (edge cases). Bấm tiêu đề cột đổi sắp xếp (`aria-sort`).
- **Lọc** (`filterInstances`): `areas` (`-` khớp `area === null`), `classes`, `priorities` (chính xác), `minPriority` (từ mức này trở lên), `states`, `q`; `q` khớp `text` và `name` không phân biệt hoa thường **và dấu tiếng Việt** (`foldVi`: NFD, bỏ dấu kết hợp, `đ`→`d`, hạ chữ thường; hàm thuần, có bảng ca thử).
- **Cột:**

| Cột | Hiển thị |
|---|---|
| `time` | `tsActive` theo múi giờ của trình duyệt `HH:mm:ss` (kèm ngày nếu khác hôm nay); `clockOk` = false: thêm "giờ chưa đồng bộ" |
| `priority` | biểu tượng riêng từng mức + tên mức (§5.2) |
| `area` | tên khu vực, hoặc "Chung" |
| `text` | `text` |
| `value` | `valueActive` (định dạng giá trị bằng `formatValue` của 007 khi nơi chứa có `TagSource`, nếu không thì chuỗi thô) |
| `state` | biểu tượng + chữ trạng thái (§5.1); thêm "(đầu vào BAD)" khi `inputBad`; thêm "Vô hiệu" khi `disabled` |
| `ackUser` | người xác nhận; tab "Tạm ẩn": thay bằng "Còn lại" (`remainingMs` trừ thời gian trôi cục bộ) |

- **Nút trên hàng** (`showAck`): "Xác nhận" cho `ACTIVE_UNACK` và `RTN_UNACK`, `host.ackAlarms({items:[{id, occurrence}]})`; khóa theo `lockOf` kèm lý do (§7.2) bằng `aria-disabled` + chú thích (không bỏ nút khỏi DOM để người dùng thấy vì sao khóa).
- **Trạng thái trống:** nguồn `none` hoặc không có hàng: dòng "Không có alarm" (§9); `unsupported`: "Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)"; `offline` hoặc `stale`: bảng mờ (`opacity`, thuộc tính `data-stale`) kèm dòng "Mất kết nối tới thiết bị: danh sách alarm có thể đã cũ"; widget `alarm-list` không nguồn: "Không có dữ liệu alarm" (US5 kịch bản 4); project 0.5 không có alarm: "Không có alarm cấu hình" (FR-071).
- **DOM an toàn:** mọi chuỗi do project cung cấp (`text`, `name`, tên khu vực, tên lớp, `reason`, `ackUser`) vào bằng `textContent`; không `innerHTML`, không `unsafeHTML` (lint của 007 áp dụng; FR-062, SC-020).

### 4.1 Hàm thuần `alarm-format.ts`

| Hàm | Việc |
|---|---|
| `compareInstances(a, b, sort)` | so sánh theo §4 |
| `filterInstances(list, filter, now)` | lọc |
| `foldVi(s)` | gấp dấu tiếng Việt |
| `stateLabel(state, inputBad)`, `priorityLabel(p)`, `stateIcon`, `priorityIcon` | nhãn và tên biểu tượng từ bảng i18n |
| `shelvedRemaining(inst, nowLocalElapsedMs)` | còn lại ≥ 0 |
| `topUnacked(snapshot)` | alarm chưa xác nhận nên hiện ở banner: bỏ shelved, ưu tiên cao nhất, trong cùng mức thì `tsActive` mới nhất, hòa thì `occurrence` lớn nhất (§6) |
| `SOUND_PATTERNS` | dữ liệu thuần của bốn kiểu âm thanh (§9); Studio dùng lại để nghe thử |
| `BlinkClock` | đồng hồ nhấp nháy chung (§8) |

## 5. Trạng thái, mức ưu tiên, màu

### 5.1 Trạng thái

Luôn có **chữ và biểu tượng** cùng màu (FR-058): màu không là tín hiệu duy nhất.

| Trạng thái | Chữ (khóa `alarm.state.*`) | Biểu tượng | Nhấp nháy |
|---|---|---|---|
| `ACTIVE_UNACK` | "Đang có, chưa xác nhận" | chuông đặc | có, nếu lớp `blink` |
| `ACTIVE_ACK` | "Đang có, đã xác nhận" | chuông đặc, dấu tích nhỏ | không |
| `RTN_UNACK` | "Đã hết, chưa xác nhận" | chuông gạch, dấu hỏi nhỏ | không (viền đậm tĩnh) |
| `NORMAL` + `shelved` | "Tạm ẩn" | đồng hồ cát | không |
| `NORMAL` + `disabled` | "Vô hiệu" | vòng gạch chéo | không |

### 5.2 Mức ưu tiên (hình riêng từng mức)

| Mức | Tên | Biểu tượng (hình khác nhau) |
|---|---|---|
| `critical` | Khẩn cấp | tam giác đặc có dấu chấm than |
| `major` | Quan trọng | hình thoi đặc |
| `minor` | Nhỏ | hình tròn đặc |
| `advisory` | Lưu ý | hình vuông viền, chữ "i" |

Biểu tượng thêm vào bộ `apps/runtime-web/src/icons.ts` (`IconName`) và `packages/ui-components` (nội tuyến SVG, không tài nguyên ngoài).

### 5.3 Tám màu thiết kế

Token CSS cho cả hai theme (sáng, tối), mỗi màu có ba biến thể: `--mat-alarm-<màu>` (nền hoặc dải), `--mat-alarm-<màu>-soft` (nền nhạt dùng khi nhấp nháy pha tối và cho hàng đã xác nhận), `--mat-alarm-<màu>-ink` (chữ trên nền màu). Giá trị cụ thể ghi ở `styles/tokens.css`; yêu cầu: chữ trên mọi nền ≥ 4,5:1 ở cả hai theme (kiểm bằng axe và bảng tính tương phản trong test). Tên màu: `red`, `orange`, `amber`, `blue`, `purple`, `teal`, `gray`, `green` (D24).

## 6. Banner alarm

Dải ở đầu trang runtime, dưới thanh trạng thái, trên mọi màn hình (FR-055). Là phần dựng sẵn của trang (D26), không phải màn hình của project.

**Mô hình thuần** `bannerModel(snapshot, status, session, nowMs) → BannerModel | null`:

| Điều kiện | Kết quả |
|---|---|
| `status` = `none` hoặc `counts.unack` = 0 và nguồn `live` | `null`: banner ẩn |
| `status` = `unsupported` | một dòng: "Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)", tông `warn`, không nút |
| `status` = `stale` hoặc `offline` | "Mất kết nối tới thiết bị: danh sách alarm có thể đã cũ", tông `bad`, không nút |
| còn lại có `unack` > 0 | `{ top: topUnacked(...), n: counts.unack, byPriority, canAck }` |

Nội dung (thứ tự cố định): **mức ưu tiên · nội dung · tổng chưa xác nhận**, ví dụ "Khẩn cấp · Bồn B1 mức rất cao: 91.2 % (ngưỡng 90) · 2 chưa xác nhận". Kèm các chip nhỏ đếm theo mức (`byPriority.*.unack` > 0), mỗi chip có biểu tượng và số.

- `topUnacked`: lấy alarm `ACTIVE_UNACK` không shelved có mức ưu tiên cao nhất, trong cùng mức thì `tsActive` mới nhất (US1 kịch bản 7). `RTN_UNACK` không làm banner nhấp nháy: nếu **chỉ** có `RTN_UNACK` thì banner hiện tông nhạt, không nhấp nháy, nội dung "n đã hết, chưa xác nhận".
- Màu và nhấp nháy theo lớp của alarm hiện ở banner (`blink` của lớp, `color` của lớp).
- Bấm vào thân banner: `location.hash = '#/alarms'`. Nút **Xác nhận** trong banner chỉ xác nhận **alarm đang hiện ở banner** (đúng một `{id, occurrence}`), không phải "tất cả" (US1 kịch bản 7).
- Nút Xác nhận ở banner khóa theo `lockOf` (§7.2); lý do hiện ở chú thích.
- Banner ẩn khi không có alarm chưa xác nhận.
- Vùng đọc cho trình đọc màn hình: xem §10.

## 7. Trang Alarm (`#/alarms`)

Bố cục dọc: tiêu đề và chỉ báo âm thanh; hàng tab; thanh lọc; thanh hành động; `<mat-alarm-table>`.

### 7.1 Thành phần

| Vùng | Nội dung |
|---|---|
| Tab | "Đang có (n)", "Tạm ẩn (m)"; số lấy từ `counts.active` và `counts.shelved` |
| Thanh lọc | khu vực (danh sách chọn nhiều, gồm "Chung"), lớp, mức ưu tiên (nhiều lựa chọn, **tối thiểu** ở widget; trang lọc theo tập đã chọn), trạng thái (Chưa xác nhận, Đã xác nhận, Đã hết chưa xác nhận), ô tìm chữ (`q`); nút "Xóa lọc"; bộ lọc và sắp xếp **giữ** khi tải lại trang nhờ `sessionStorage` bọc `try/catch` và khi hộp đăng nhập (FR-064) |
| Hành động | "Xác nhận" (hàng chọn), "Xác nhận tất cả" (theo bộ lọc đang hiện), "Tạm ẩn…" (một hàng chọn), số hàng đã chọn |
| Cột mặc định | thời gian bật, ưu tiên, khu vực, nội dung, giá trị lúc bật, trạng thái, người xác nhận |

### 7.2 Khóa và lý do (FR-064)

`lockOf(source, host)` trả mã khóa theo thứ tự kiểm:

| Thứ tự | Mã | Chữ (khóa `alarm.lock.*`) | Khi |
|---|---|---|---|
| 1 | `INSECURE` / `HTTPS_DOWN` / `SESSION_EXPIRED` / `PROJECT_CHANGING` | như 007 (`host.writeBlocked()`) | |
| 2 | `NO_SESSION` | "Cần đăng nhập với role operator" | chưa có phiên; nhấp nút mở hộp đăng nhập (`host.requestLogin()`), không mất bộ lọc |
| 3 | `ROLE` | "Cần đăng nhập với role operator" | phiên có role < operator |
| 4 | `LIVE_LOST` | "Mất kết nối tới thiết bị" | `source.status()` ≠ `live` |
| 5 | `SHELVED` | "Alarm đang tạm ẩn" | (chỉ cho nút Xác nhận của hàng shelved) |
| 6 | `NOTHING` | "Không có alarm nào để xác nhận" | |

Khóa **không chặn xem**: viewer thấy đủ bảng, banner, số đếm (US1 kịch bản 8). Gọi thẳng API xác nhận khi bị khóa vẫn bị thiết bị từ chối (SC-007).

### 7.3 Xác nhận, xác nhận tất cả, tạm ẩn

- **Xác nhận** hàng đã chọn (hoặc nút trên hàng): gửi ngay (không hộp, không lý do). Trạng thái hàng "đang gửi" (`aria-busy`, nút xoay), rồi kết quả theo mục:

| Kết quả | Chữ (`alarm.ack.result.*`) | Hiển thị |
|---|---|---|
| `ACKED` | "Đã xác nhận" | thông báo thoáng 3 s; hàng đổi trạng thái khi nhận `alarmDelta` |
| `ALREADY_ACKED` | "Đã được xác nhận" | thông báo nhẹ (không lỗi) |
| `NOT_ACTIVE` | "Alarm đã hết" | |
| `STALE` | "Alarm đã bật lại lần mới, xem lại trước khi xác nhận" | hàng nhấn mạnh |
| `SHELVED` | "Alarm đang tạm ẩn" | |
| `NOT_FOUND` | "Alarm không còn trong project" | |

- **Xác nhận tất cả:** hộp xác nhận nhỏ nêu số lượng và bộ lọc ("Xác nhận 7 alarm đang hiện (khu vực Bồn, từ Quan trọng)?"); gửi `{all:true, upToRevision: snapshot.revision tại lúc mở hộp, filter}`. Chỉ các alarm đã hiện lúc bấm được xác nhận (US1 kịch bản 4); `skippedNewer` > 0 thì hiện "n alarm mới bật chưa được xác nhận". Quyết định: hộp xác nhận cho "tất cả" nhưng **không** cho xác nhận từng hàng (nhanh khi nhiều alarm, an toàn khi hàng loạt).
- **Tạm ẩn…:** hộp có ô `reason` (bắt buộc, ≤ 120, đếm ký tự) và thời lượng chọn: 15 phút, **1 giờ (mặc định)**, 4 giờ, 8 giờ, hoặc nhập số phút (1 đến 480); giải thích "Alarm vẫn được ghi lịch sử nhưng không hiện ở banner, không có tiếng". Lỗi `SHELVE_RANGE` hiện ngay ở ô tương ứng (`field`).
- Lỗi toàn yêu cầu (`AUDIT_UNAVAILABLE`, `RATE_LIMITED`, 401/403, `NETWORK`) hiện thành dải lỗi của trang (bảng chuỗi §12), không mất lựa chọn; 401/403 mở hộp đăng nhập của 007 và giữ bộ lọc (FR-064, FR-065).
- Tab "Tạm ẩn": cột "Còn lại" đếm ngược (cập nhật mỗi giây bằng một bộ hẹn giờ chung), nút "Gỡ tạm ẩn" mỗi hàng (`host.unshelveAlarm`).

## 8. Nhấp nháy và giảm chuyển động

- **Tối đa 1 Hz** (FR-058, D25): chu kỳ 1 s, nửa sáng nửa tối (không nhanh hơn 3 lần/giây, WCAG 2.3.1).
- **`BlinkClock`** (đơn lẻ trên trang): một bộ hẹn giờ 500 ms đổi thuộc tính `data-blink-phase="on|off"` ở phần tử gốc của trang; CSS của hàng và banner phản ứng theo `:root[data-blink-phase="off"] .mat-alarm-blink`. Mọi hàng nhấp nháy **đồng pha** (tốt hơn CSS animation theo từng phần tử). Dừng khi `document.hidden`. Chỉ chạy khi có ít nhất một phần tử đăng ký nhấp nháy.
- **Hàng nhấp nháy** khi: `ACTIVE_UNACK` **và** lớp `blink`. Pha tối đổi nền sang `--mat-alarm-<màu>-soft`; chữ không đổi.
- **Thiết lập project "Chuyển động của widget" Tắt** (ADR-056 thay `prefers-reduced-motion`, vốn không còn tắt nhấp nháy báo động): `BlinkClock` không khởi động, `still` đúng, phần tử nhận `data-blink-still` và vẽ **viền đậm tĩnh** 3 px quanh hàng/nút. Theo dõi thay đổi bằng sự kiện `mat-motion` (`onMotionChange`).
- `RTN_UNACK`: không nhấp nháy mạnh; viền 2 px nét đứt màu của lớp.
- Chế độ `edit` (Studio): không có `BlinkClock`, trạng thái hiển thị tĩnh theo pha "sáng".
- Tab ẩn: trình duyệt tự giảm nhấp nháy; tiêu đề tab báo thay (§11, FR-066).

## 9. Âm thanh (`sound.ts`, Web Audio)

Do **trang** lo, không phải widget (FR-059, FR-072). Không tải tệp âm thanh, không tài nguyên ngoài. Mặc định **tắt** (D23, D38).

### 9.1 Bốn kiểu (`SOUND_PATTERNS`)

Mọi kiểu dùng một `OscillatorNode` + một `GainNode` (bao biên độ) trong một `AudioContext` duy nhất; **biên độ đỉnh 0,25** (cố định, không âm lượng người dùng trong bản này) để không gây giật mình; mọi lần bật và tắt có bao biên độ tuyến tính (tránh tiếng lách tách).

| Kiểu | Sóng | Tần số | Nhịp (một chu kỳ) | Bao biên độ |
|---|---|---|---|---|
| `none` | không phát | | | |
| `beep` | sine | 880 Hz cố định | một tiếng 200 ms, im 1 800 ms: chu kỳ 2,0 s | tăng 10 ms, giữ 150 ms, giảm 40 ms |
| `double` | sine | 880 Hz cố định | hai tiếng 150 ms cách nhau 100 ms, im 1 600 ms: chu kỳ 2,0 s | mỗi tiếng: tăng 10 ms, giữ 100 ms, giảm 40 ms |
| `siren` | triangle | quét tuyến tính 600 Hz lên 1 100 Hz trong 0,8 s rồi xuống 600 Hz trong 0,8 s | liên tục, chu kỳ 1,6 s, không im | gain không đổi 0,25; tăng 30 ms lúc bắt đầu, giảm 60 ms lúc dừng |

`SOUND_PATTERNS` là bảng dữ liệu thuần (kiểu, sóng, bước tần số, thời lượng, bao); `sound.ts` chỉ là bộ phát trên bảng này. Studio dùng lại bảng để nghe thử ở editor Lớp alarm ([studio-alarm-editor.md](studio-alarm-editor.md) §4). Lặp: bộ phát lên lịch chu kỳ kế bằng `AudioContext.currentTime` (không `setInterval` thô), dừng ngay khi hết điều kiện.

### 9.2 Luật phát

- Chọn **một** kiểu tại một thời điểm: kiểu của lớp của alarm `ACTIVE_UNACK` **không shelved** có mức ưu tiên cao nhất; cùng mức thì kiểu "mạnh" hơn (`siren` > `double` > `beep`). Không phát chồng nhiều kiểu.
- Phát lặp khi còn ít nhất một alarm `ACTIVE_UNACK` có `sound` ≠ `none` thuộc lớp đó; ngừng khi mọi alarm của lớp đã xác nhận, shelve, hết, hoặc người dùng **Tắt tiếng**.
- **Tắt tiếng:** dừng tiếng của các alarm hiện có, **không xác nhận** alarm nào (US1 kịch bản 9); một alarm `ACTIVE_UNACK` **mới** (lần xảy ra mới, kể cả hết hạn tạm ẩn) bật tiếng lại.
- Alarm shelve, `ACTIVE_ACK`, `RTN_UNACK`, `advisory` không có `sound`: không tiếng.
- **Chính sách tự phát của Chrome:** `AudioContext` chỉ được tạo/`resume()` trong xử lý một thao tác người dùng. Công tắc "Âm thanh" ở thanh trên (nút chuyển có `aria-pressed`) bật bằng một nhấp; khi chưa bật mà có alarm có `sound`, hiện chỉ báo "Âm thanh đang tắt, bấm để bật" (không lỗi console, không thử phát lặp lại). Trạng thái `suspended` sau bật (tab nền): nút hiện lại chỉ báo.
- Tùy chọn bật/tắt lưu `localStorage` khóa `mat.alarm.sound` ("on"/"off") bọc `try/catch`; vắng thì "off" (FR-059). Không lưu nhớ "đã tắt tiếng tạm" qua tải lại.
- Tab ẩn vẫn phát nếu đã bật (người vận hành cần nghe); không hiện nhấp nháy.

## 10. Trợ năng (a11y)

- **Vùng đọc (live region):** hai vùng ẩn thị giác ở gốc trang. `role="status"` `aria-live="polite"` `aria-atomic="true"`: báo thay đổi số lượng, gộp và giới hạn một lần mỗi 3 giây ("3 alarm chưa xác nhận"). `role="alert"` (`assertive`): chỉ cho alarm **mới** mức `critical` ("Khẩn cấp: Bồn B1 mức rất cao"); nhiều alarm trong 3 giây gộp thành "n alarm khẩn cấp mới". Mất kết nối cũng báo bằng vùng `status`.
- **Huy hiệu menu:** `aria-label` đọc được ("3 alarm chưa xác nhận"); số hiện bằng chữ, không chỉ màu.
- **Bảng:** phần tử `<table>` (`role="table"`), hàng tiêu đề `<th scope="col">` với `aria-sort`; hàng có hộp chọn `<input type="checkbox">` có nhãn "Chọn alarm <tên>"; trạng thái hàng đọc được qua chữ trong ô (không chỉ biểu tượng; biểu tượng `aria-hidden`).
- **Bàn phím** (khi bảng có focus; roving tabindex một hàng): ↑ ↓ Home End di chuyển hàng; Space chọn hoặc bỏ chọn hàng; Ctrl+A chọn tất cả hàng đang hiện; Shift+A "Xác nhận" (hàng chọn, hoặc hàng đang focus nếu chưa chọn gì); Ctrl+Shift+A "Xác nhận tất cả" (mở hộp xác nhận); S "Tạm ẩn…" cho hàng đang focus; Esc xóa chọn. Phím chỉ có hiệu lực khi bảng có focus (không toàn cục), kiểm không xung đột trong test. Mọi chức năng có nút tương ứng.
- **Hộp thoại** (xác nhận tất cả, tạm ẩn, đăng nhập): `role="dialog"` `aria-modal`, bẫy focus, Esc đóng, trả focus về nút gọi.
- **Banner:** vùng có nhãn `aria-label="Alarm"`; nút Xác nhận là `<button>` thật.
- **Âm thanh:** nút công tắc `aria-pressed`; chỉ báo "Âm thanh đang tắt" là chữ (không chỉ biểu tượng loa gạch).
- **Tương phản:** chữ ≥ 4,5:1 ở hai theme; viền trạng thái ≥ 3:1; axe 0 vi phạm serious/critical (SC-012).

## 11. Huy hiệu menu và tiêu đề tab (`badge.ts`)

- Menu có mục **"Alarm"** (trỏ `#/alarms`) và **"Lịch sử alarm"** (`#/alarm-history`) **khi** `status` ∈ {`live`, `stale`, `offline`} và `navigation.alarms` ≠ `false` (D26); `none` thì không có hai mục. `buildMenu` của `menu.ts` thêm hai mục hệ thống sau các mục project (hoặc thành nhóm "Alarm" khi menu có nhóm); project không có alarm: **không** có hai mục (US1 kịch bản 12); menu trước đây "ẩn khi ≤ 1 màn hình" nay hiện nếu có alarm (mục Alarm đủ làm menu có ≥ 2 mục).
- Huy hiệu = `counts.unack` (instance không shelved); ẩn khi 0. Màu theo mức ưu tiên cao nhất trong các alarm **chưa xác nhận** (`byPriority`), kèm số bằng chữ. `unsupported`: mục menu có chú thích "chưa hỗ trợ", không huy hiệu.
- **Tiêu đề tab:** `document.title` = `(n) <tiêu đề gốc>` khi `unack` > 0 (ví dụ `(3) Tổng quan`); `n` > 99 hiện `99+`. Khôi phục tiêu đề gốc khi 0. Dùng cả khi tab ẩn (FR-057, FR-066).

## 12. Trang Lịch sử (`#/alarm-history`)

- Bộ chọn khoảng: nhanh "1 giờ, 8 giờ, 24 giờ (mặc định), 7 ngày, 30 ngày" và tùy chọn từ–đến (`<input type="datetime-local">`, múi giờ trình duyệt); tối đa 366 ngày (vượt: hiện lý do, không gửi).
- Bộ lọc như `GET /api/v1/alarms/history` ([device-api-1.3.md](device-api-1.3.md) §2.2): khu vực, lớp, **mức ưu tiên tối thiểu**, trạng thái cuối (Mọi, Đang có, Đã xác nhận, Đã đóng), mã alarm, ô tìm chữ.
- Bảng: cột bật lúc, xác nhận lúc và người, hết lúc, thời lượng, giá trị lúc bật, ưu tiên, khu vực, nội dung, trạng thái ("Đang có" khi chưa hết; "Đóng do đổi cấu hình" khi `closedBy` = `config`, v.v.). Sắp xếp cột chỉ trên các trang đã tải.
- Phân trang bằng `beforeId` (nút "Tải thêm", 100 dòng mỗi lần); không `OFFSET`. Chế độ "Theo dõi": khi bật, trang đăng ký `AlarmSource` và tải lại **trang đầu** (mỗi khi có thay đổi, gộp ≤ 1 lần/2 s); mặc định tắt (US4 kịch bản 5).
- Lỗi `BAD_QUERY`, `ALARM_HISTORY_BUSY`, `ALARM_LOG_UNAVAILABLE` hiện bằng chữ tiếng Việt từ bảng chuỗi.
- Viewer không đăng nhập xem và xuất được (đọc); khách ngoài mạng riêng theo lọc nguồn như các API đọc.

### 12.1 Xuất CSV (`csv.ts`)

Sinh **ở trình duyệt** (không tốn CPU BL335, D22): lấy lần lượt các trang 500 dòng theo bộ lọc hiện hành, tối đa **100.000 dòng**; vượt thì cắt, thông báo "Đã cắt còn 100.000 dòng; còn khoảng n dòng nữa, hãy thu hẹp khoảng thời gian" (n chỉ khi biết). Tiến độ hiện thanh và nút Hủy (hủy giữa chừng bỏ file). Ghi `Blob` (`type: 'text/csv;charset=utf-8'`) và tải bằng thẻ `<a download>`.

- Tên file: `alarm-history-<từ>-<đến>.csv`, `<từ>` và `<đến>` dạng `yyyyMMddTHHmm` theo giờ trình duyệt.
- Mã hóa **UTF-8 có BOM** (`﻿` ở đầu); dấu phân cách `,`; xuống dòng `\r\n`; RFC 4180.
- **Cột** (tiêu đề tiếng Việt, theo thứ tự):

| # | Tiêu đề | Nguồn |
|---|---|---|
| 1 | Mã lần xảy ra | `id` |
| 2 | Mã alarm | `alarmId` |
| 3 | Tên alarm | `name` |
| 4 | Khu vực | tên khu vực ("Chung" khi rỗng) |
| 5 | Lớp | tên lớp |
| 6 | Mức ưu tiên | Khẩn cấp / Quan trọng / Nhỏ / Lưu ý |
| 7 | Nội dung | `text` |
| 8 | Giá trị lúc bật | `valueActive` |
| 9 | Chất lượng lúc bật | `qualityActive` |
| 10 | Lý do chất lượng | `reason` |
| 11 | Bật lúc | `tsActive`, ISO 8601 có độ lệch |
| 12 | Xác nhận lúc | `tsAck` |
| 13 | Người xác nhận | `ackUser` |
| 14 | Hết lúc | `tsReturn` |
| 15 | Xác nhận hết lúc | `tsReturnAck` |
| 16 | Người xác nhận hết | `returnAckUser` |
| 17 | Thời lượng (giây) | `tsReturn − tsActive`, số nguyên; trống nếu chưa hết |
| 18 | Trạng thái | Đang có / Đã hết / Đóng do đổi cấu hình / Đóng do vô hiệu / Đóng do khởi động lại |
| 19 | Giờ chưa đồng bộ | `Có` nếu `clockOk` = false, ngược lại trống |
| 20 | Sau khởi động | `Có` nếu `flags.startup` |

- **Ví dụ** (hai dòng):

```text
"Mã lần xảy ra","Mã alarm","Tên alarm","Khu vực","Lớp","Mức ưu tiên","Nội dung","Giá trị lúc bật","Chất lượng lúc bật","Lý do chất lượng","Bật lúc","Xác nhận lúc","Người xác nhận","Hết lúc","Xác nhận hết lúc","Người xác nhận hết","Thời lượng (giây)","Trạng thái","Giờ chưa đồng bộ","Sau khởi động"
4412,"TANK_B1_LEVEL.HH","Mức bồn B1","Bồn","Khẩn cấp","Khẩn cấp","Mức bồn B1 rất cao: 91.2 % (ngưỡng 90)",91.2,"GOOD","","2026-10-13T02:10:03.000+07:00","2026-10-13T02:10:30.000+07:00","vanhanh1","2026-10-13T02:20:00.000+07:00","","",597,"Đã hết","",""
4413,"PUMP1_FAULT","Bơm 1 lỗi","Chung","Quan trọng","Quan trọng","'=HYPERLINK(""http://x"")",true,"GOOD","","2026-10-13T03:00:00.000+07:00","","","","","","","Đang có","",""
```

- **Quy tắc chống công thức (SC-020, FR-061):** mọi ô **chuỗi** có ký tự đầu là `=`, `+`, `-`, `@`, tab (`\t`) hoặc CR (`\r`) được thêm `'` ở đầu **trước** khi trích dẫn; sau đó mọi ô chuỗi được đặt trong dấu nháy kép và `"` bên trong nhân đôi. Cột số (mã, giá trị số, thời lượng) sinh từ kiểu `number` và khớp `^-?\d+(\.\d+)?$` **không** gắn `'` (số âm như `-5.2` vẫn là số). Bộ mẫu thử có ≥ 30 chuỗi nguy hiểm (kể cả chuỗi có khoảng trắng, BOM hoặc ký tự điều khiển Unicode đứng trước `=`: bị vô hiệu hóa nếu **sau khi bỏ** các ký tự đó ký tự đầu thuộc tập nguy hiểm, vì Excel có thể bỏ chúng) và chuỗi chứa `"`, `,`, xuống dòng.
- Hiệu năng: 50.000 dòng ≤ 10 s trên Chrome (SC-013), xử lý theo khối (không giữ toàn bộ chuỗi một lần: ghép `Blob` từng khối).

## 13. Widget `alarm-list` và `alarm-count`

Danh mục `schemas/widgets.catalog.json` lên **0.4.0**, thêm nhóm `alarm` và hai widget (17 widget, FR-068). Cả hai: **không khe Tag** (`slots: []`), không `events`; dùng `AlarmSource` và `ActionHost` do nơi chứa cấp (`.alarms` thêm vào hợp đồng chung của `mat-w-*`: `item`, `source`, `host`, `mode`, `context`, **`alarms`**).

### 13.1 `alarm-list` (Bảng alarm)

Cỡ mặc định / tối thiểu: 640×260 / 320×120.

| Thuộc tính | Kiểu | Khoảng, ràng buộc | Mặc định |
|---|---|---|---|
| `areas` | mảng chuỗi | ≤ 64 id khu vực (hoặc `-` "Chung"); rỗng = mọi khu vực | `[]` |
| `classes` | mảng chuỗi | ≤ 16 id lớp; rỗng = mọi lớp | `[]` |
| `minPriority` | enum | `advisory`, `minor`, `major`, `critical` | `advisory` |
| `states` | mảng enum | tập con không trùng của `ACTIVE_UNACK`, `ACTIVE_ACK`, `RTN_UNACK`; không rỗng | cả ba |
| `columns` | mảng enum | tập con không trùng, không rỗng, của `time`, `priority`, `area`, `text`, `value`, `state`, `ackUser`; thứ tự là thứ tự hiển thị | `["time","priority","text","value","state"]` |
| `maxRows` | int | 1…50 | 8 |
| `showAck` | bool | | `true` |

Hành vi: hiện đúng tập alarm đang có thỏa bộ lọc (không gồm shelved), sắp xếp mặc định (§4), cắt `maxRows` (hiện "và n alarm nữa" khi còn); nút Xác nhận mỗi hàng khi `showAck` và `host.session()` đủ role; khóa kèm lý do nếu không (viewer: "Cần đăng nhập với role operator"); không có hộp chọn, không "Xác nhận tất cả", không tạm ẩn (việc của trang, giữ widget gọn). Không có nguồn: "Không có dữ liệu alarm"; project không alarm: "Không có alarm cấu hình".

### 13.2 `alarm-count` (Số alarm)

Cỡ mặc định / tối thiểu: 120×48 / 48×32.

| Thuộc tính | Kiểu | Khoảng, ràng buộc | Mặc định |
|---|---|---|---|
| `areas` | mảng chuỗi | như trên | `[]` |
| `minPriority` | enum | như trên | `advisory` |
| `mode` | enum | `unacked` (đếm `ACTIVE_UNACK` và `RTN_UNACK`), `active` (đếm mọi trạng thái khác `NORMAL`, không shelved) | `unacked` |
| `target` | đối tượng | `{ "kind": "alarms" \| "screen" \| "none", "screen"?: id }`; `screen` bắt buộc khi `kind` = `screen` và phải là màn hình `screen` (`E_ACTION_TARGET`) | `{"kind":"alarms"}` |

Hành vi: đèn (hình tròn) có số; màu theo mức ưu tiên cao nhất trong tập đếm (màu của lớp đó), xám khi 0; **nhấp nháy theo lớp** khi có `ACTIVE_UNACK` (§8); cập nhật ≤ 1 s sau thay đổi (SC-014); bấm: `kind: alarms` đi `#/alarms` (`host.navigate`-tương đương cho trang riêng: `location.hash`); `screen` gọi `host.navigate(screen)`; `none` không làm gì. `<button>` với `aria-label` "n alarm chưa xác nhận" (hoặc "đang có").

### 13.3 Đoạn JSON của danh mục 0.4.0

```json
{
  "catalogVersion": "0.4.0",
  "widgets": [
    { "id": "alarm-list", "group": "alarm", "label": "widget.alarm-list",
      "defaultSize": [640, 260], "minSize": [320, 120],
      "slots": [],
      "props": [
        { "name": "areas", "kind": "array", "items": { "kind": "string", "maxLength": 32 }, "maxItems": 64, "default": [], "group": "general" },
        { "name": "classes", "kind": "array", "items": { "kind": "string", "maxLength": 32 }, "maxItems": 16, "default": [], "group": "general" },
        { "name": "minPriority", "kind": "enum", "options": ["advisory", "minor", "major", "critical"], "default": "advisory", "group": "general" },
        { "name": "states", "kind": "array", "items": { "kind": "enum", "options": ["ACTIVE_UNACK", "ACTIVE_ACK", "RTN_UNACK"] },
          "minItems": 1, "maxItems": 3, "unique": true, "default": ["ACTIVE_UNACK", "ACTIVE_ACK", "RTN_UNACK"], "group": "general" },
        { "name": "columns", "kind": "array", "items": { "kind": "enum", "options": ["time", "priority", "area", "text", "value", "state", "ackUser"] },
          "minItems": 1, "maxItems": 7, "unique": true, "default": ["time", "priority", "text", "value", "state"], "group": "display" },
        { "name": "maxRows", "kind": "int", "min": 1, "max": 50, "default": 8, "group": "display" },
        { "name": "showAck", "kind": "bool", "default": true, "group": "display" }
      ],
      "events": [] },
    { "id": "alarm-count", "group": "alarm", "label": "widget.alarm-count",
      "defaultSize": [120, 48], "minSize": [48, 32],
      "slots": [],
      "props": [
        { "name": "areas", "kind": "array", "items": { "kind": "string", "maxLength": 32 }, "maxItems": 64, "default": [], "group": "general" },
        { "name": "minPriority", "kind": "enum", "options": ["advisory", "minor", "major", "critical"], "default": "advisory", "group": "general" },
        { "name": "mode", "kind": "enum", "options": ["unacked", "active"], "default": "unacked", "group": "display" },
        { "name": "target", "kind": "object", "fields": [
            { "name": "kind", "kind": "enum", "options": ["alarms", "screen", "none"], "default": "alarms" },
            { "name": "screen", "kind": "string", "maxLength": 64, "requiredWhen": { "kind": "screen" } } ],
          "default": { "kind": "alarms" }, "group": "general" }
      ],
      "events": [] }
  ]
}
```

- Giá trị mới của danh mục (so với 0.3.0): `group` = `alarm`; thuộc tính `array` có `minItems` và `unique`; `requiredWhen` trong `fields` của `object`. Khóa lạ trong `props` là `E_WIDGET_PROP`. Tham chiếu khu vực hoặc lớp không có trong project: **cảnh báo** `W_WIDGET_ALARM_REF` (không lỗi: màn hình có thể dựng trước khi định nghĩa alarm, và alarm bị xóa không làm hỏng màn hình); `target.screen` sai loại: `E_ACTION_TARGET`.
- Toolbox của Studio nhóm "Alarm" (khóa `tc.group.alarm`): hai mục, nhãn `widget.alarm-list` "Bảng alarm", `widget.alarm-count` "Số alarm".
- Hai validator (TS `rules-05.ts`, C++ `rules_04.cpp`) cho cùng kết luận trên vector `tests/widget-catalog-vectors/` (một ca hợp lệ và một ca vi phạm cho mỗi mã mới, mỗi thuộc tính ở giá trị biên; SC-014).
- `README` của `@mat/ui-components` sinh từ danh mục (`tools/gen-widget-docs.mjs`) có thêm hai widget.

## 14. Bảng chuỗi i18n chính

Mọi chuỗi giao diện nằm ở bảng chuỗi tiếng Việt, không chuỗi cứng trong mã (lint, FR-067, SC-024). Phần dùng chung của widget ở `packages/ui-components/src/i18n/vi.ts`; phần của trang ở `apps/runtime-web/src/i18n/vi.ts`; phần của Studio ở `apps/studio/src/i18n/vi.ts` ([studio-alarm-editor.md](studio-alarm-editor.md) §12). Khóa chính của giao diện vận hành:

| Khóa | Chữ |
|---|---|
| `alarm.menu` | Alarm |
| `alarm.menu.history` | Lịch sử alarm |
| `alarm.page.title` | Alarm |
| `alarm.tab.active` | Đang có ({n}) |
| `alarm.tab.shelved` | Tạm ẩn ({n}) |
| `alarm.priority.critical` | Khẩn cấp |
| `alarm.priority.major` | Quan trọng |
| `alarm.priority.minor` | Nhỏ |
| `alarm.priority.advisory` | Lưu ý |
| `alarm.state.ACTIVE_UNACK` | Đang có, chưa xác nhận |
| `alarm.state.ACTIVE_ACK` | Đang có, đã xác nhận |
| `alarm.state.RTN_UNACK` | Đã hết, chưa xác nhận |
| `alarm.state.NORMAL` | Bình thường |
| `alarm.state.shelved` | Tạm ẩn |
| `alarm.state.disabled` | Vô hiệu |
| `alarm.state.inputBad` | đầu vào BAD |
| `alarm.col.time` | Thời gian bật |
| `alarm.col.priority` | Ưu tiên |
| `alarm.col.area` | Khu vực |
| `alarm.col.text` | Nội dung |
| `alarm.col.value` | Giá trị lúc bật |
| `alarm.col.state` | Trạng thái |
| `alarm.col.ackUser` | Người xác nhận |
| `alarm.col.remaining` | Còn lại |
| `alarm.area.general` | Chung |
| `alarm.banner.summary` | {priority} · {text} · {n} chưa xác nhận |
| `alarm.banner.returnOnly` | {n} đã hết, chưa xác nhận |
| `alarm.banner.offline` | Mất kết nối tới thiết bị: danh sách alarm có thể đã cũ |
| `alarm.unsupported` | Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0) |
| `alarm.empty` | Không có alarm |
| `alarm.empty.noSource` | Không có dữ liệu alarm |
| `alarm.empty.noConfig` | Không có alarm cấu hình |
| `alarm.ack` | Xác nhận |
| `alarm.ackAll` | Xác nhận tất cả |
| `alarm.ackAll.confirm` | Xác nhận {n} alarm đang hiện{filter}? |
| `alarm.ack.result.ACKED` | Đã xác nhận |
| `alarm.ack.result.ALREADY_ACKED` | Đã được xác nhận |
| `alarm.ack.result.NOT_ACTIVE` | Alarm đã hết |
| `alarm.ack.result.STALE` | Alarm đã bật lại lần mới, xem lại trước khi xác nhận |
| `alarm.ack.result.SHELVED` | Alarm đang tạm ẩn |
| `alarm.ack.result.NOT_FOUND` | Alarm không còn trong project |
| `alarm.ack.skippedNewer` | {n} alarm mới bật chưa được xác nhận |
| `alarm.lock.NO_SESSION` | Cần đăng nhập với role operator |
| `alarm.lock.ROLE` | Cần đăng nhập với role operator |
| `alarm.lock.LIVE_LOST` | Mất kết nối tới thiết bị |
| `alarm.lock.SHELVED` | Alarm đang tạm ẩn |
| `alarm.shelve` | Tạm ẩn… |
| `alarm.shelve.reason` | Lý do (bắt buộc) |
| `alarm.shelve.duration` | Thời gian tạm ẩn |
| `alarm.shelve.hint` | Alarm vẫn được ghi lịch sử nhưng không hiện ở banner và không có tiếng |
| `alarm.unshelve` | Gỡ tạm ẩn |
| `alarm.err.AUDIT_UNAVAILABLE` | Thiết bị không ghi được nhật ký kiểm toán nên chưa xác nhận được. Thử lại hoặc báo quản trị viên |
| `alarm.err.RATE_LIMITED` | Thao tác quá nhanh, thử lại sau {n} giây |
| `alarm.err.SHELVE_RANGE` | Lý do 1 đến 120 ký tự; thời gian từ 1 phút đến 8 giờ; tối đa 50 alarm tạm ẩn |
| `alarm.err.ALARM_DISABLED` | Alarm đang bị vô hiệu |
| `alarm.err.NETWORK` | Không gửi được tới thiết bị. Kiểm tra trạng thái rồi thử lại |
| `alarm.sound.off` | Âm thanh đang tắt, bấm để bật |
| `alarm.sound.on` | Âm thanh đang bật |
| `alarm.sound.mute` | Tắt tiếng |
| `alarm.history.title` | Lịch sử alarm |
| `alarm.history.range.1h` | 1 giờ |
| `alarm.history.range.8h` | 8 giờ |
| `alarm.history.range.24h` | 24 giờ |
| `alarm.history.range.7d` | 7 ngày |
| `alarm.history.range.30d` | 30 ngày |
| `alarm.history.more` | Tải thêm |
| `alarm.history.follow` | Theo dõi |
| `alarm.history.exportCsv` | Xuất CSV |
| `alarm.history.csvTruncated` | Đã cắt còn {n} dòng; hãy thu hẹp khoảng thời gian |
| `alarm.history.clockUnsynced` | giờ chưa đồng bộ |
| `alarm.closed.config` | Đóng do đổi cấu hình |
| `alarm.closed.disabled` | Đóng do vô hiệu |
| `alarm.closed.restartLost` | Đóng do khởi động lại |
| `alarm.a11y.badge` | {n} alarm chưa xác nhận |
| `alarm.a11y.newCritical` | Khẩn cấp: {text} |
| `alarm.widget.list` | Bảng alarm |
| `alarm.widget.count` | Số alarm |

## 15. DOM an toàn

- Mọi chuỗi do project cung cấp (`name`, `text`, tên khu vực và lớp, `reason`, `ackUser`) và dữ liệu thiết bị vào DOM bằng `textContent`, `setAttribute` với giá trị tĩnh được kiểm, hoặc thuộc tính an toàn (`aria-label` bằng chuỗi đã thoát bởi trình duyệt). Không `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `unsafeHTML`; lint (T008 của 007) áp cho thư mục mới `apps/runtime-web/src/alarm/` và `packages/ui-components/src/alarm/`.
- Nội dung có HTML hoặc `<script>` hiện **nguyên văn như chữ** (bộ mẫu XSS ≥ 20 chuỗi trong test, SC-020).
- CSV chống công thức (§12.1). Màu, biểu tượng và lớp CSS chỉ lấy từ **bảng liệt kê** (`AlarmColor`, `AlarmPriority`), không ghép từ chuỗi của project vào tên lớp CSS hoặc thuộc tính `style`.
- Không `eval`, không `new Function`; CSP `kCspRuntime` giữ nguyên (không nguồn mới: âm thanh là Web Audio, không tệp).
- `localStorage`, `sessionStorage` luôn bọc `try/catch`; trang chạy đúng khi không có (cửa sổ riêng tư).

## 16. Test

Vitest (jsdom), `puppeteer-core` cho e2e:

- `packages/ui-components`: `alarm-format.test.ts` (sắp xếp, `foldVi` bảng ca có dấu, lọc, `topUnacked` hòa, `shelvedRemaining`), `alarm-table.test.ts` (cập nhật theo `id`, khóa, trạng thái trống, XSS ≥ 20 chuỗi, `aria-sort`), `mat-alarm-list.test.ts`, `mat-alarm-count.test.ts` (màu theo mức, nhấp nháy, `target`), `memory-source.test.ts`; vector danh mục (hai widget).
- `apps/runtime-web`: `alarm-client.test.ts` (chọn `status` từ `hello`, ghép mảnh, `sequence` đứt xin lại snapshot, kết nối lại thay hoàn toàn), `banner.test.ts` (mọi hàng bảng §6), `badge.test.ts`, `csv.test.ts` (BOM, CRLF, RFC 4180, ví dụ §12.1, ≥ 30 chuỗi nguy hiểm, số âm), `sound.test.ts` (chọn kiểu theo luật §9.2, giả `AudioContext`: không phát khi `suspended`, tắt tiếng không xác nhận), `menu.test.ts` mở rộng.
- e2e Chrome headless (`apps/runtime-web/tests/e2e/alarm-*.e2e.mjs`, axe-core hai theme): banner, trang Alarm (lọc, sắp xếp, xác nhận, xác nhận tất cả, tạm ẩn), menu và tiêu đề tab, lịch sử và CSV (50.000 dòng ≤ 10 s), widget, giảm chuyển động, mất kết nối, đo "đổi Tag → DOM đổi" (SC-003).

## Điểm cần sửa spec

- **`unsupported` và `none`.** Spec FR-063 chỉ nói "thiết bị không có `features.alarms` thì hiện 'chưa hỗ trợ'"; không phân biệt thiết bị 1.2.0 (không hỗ trợ) với thiết bị 1.3.0 project không có alarm (không banner, US1 kịch bản 12). Hợp đồng phân biệt bằng `protocolVersion` ([live-protocol-1.3.md](live-protocol-1.3.md) §9). Đề nghị sửa FR-063.
- **`unshelveAlarm` trong `ActionHost`.** FR-069 liệt kê `ackAlarms`, `shelveAlarm`; tab "Tạm ẩn" và US3 kịch bản 10 cần gỡ tạm ẩn từ trang, nên thêm `unshelveAlarm`. Đề nghị sửa FR-069.
- **`AlarmSource.areas()` và `now()`.** FR-069 chỉ nêu `snapshot()`, `subscribe`, `counts()`, `classes()`, `status()`; lọc theo khu vực và đếm ngược hạn tạm ẩn cần `areas()` (đã có trong digest) và `now()`.
- **CSV: số âm.** Đã xử lý trong spec (FR-061: chỉ vô hiệu hóa ô chuỗi).
- **CSV và Excel vi-VN:** số thập phân ghi dấu chấm; Excel đặt vùng Việt Nam có thể đọc `91.2` như chữ hoặc ngày. Cần thử tay (quickstart §7); nếu hỏng, đề nghị một tùy chọn dấu thập phân.
- **Thuộc tính `target` của `alarm-count`** mô tả là "hành động điều hướng" nhưng danh mục 0.3 chỉ có `events`; hợp đồng đặt `target` là thuộc tính đối tượng. Cần khớp [project-format-0.5.md](project-format-0.5.md) và `schemas/widgets.catalog.json`.
- **Xác nhận một hàng không có hộp:** US1 kịch bản "hộp nhỏ không cần nhập lý do" có thể hiểu là hộp xác nhận; hợp đồng chọn không hộp cho một hàng, có hộp cho "Xác nhận tất cả". Cần người dùng duyệt khi tự duyệt mockup.
