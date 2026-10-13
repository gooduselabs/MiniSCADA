# Data Model: Nhập SVG, gắn Tag cho phần tử SVG, animation và sự kiện

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Research**: [research.md](research.md)

Feature này đổi định dạng project lên **0.4.0** (binding mở rộng, sự kiện SVG, trần 64 item `svg`; chi tiết và ví dụ: [contracts/project-format-0.4.md](contracts/project-format-0.4.md)) và thêm:

- thực thể của importer (báo cáo, thông tin phần tử, kết quả đối chiếu);
- thực thể của thư viện ký hiệu;
- trạng thái trên trang runtime và xem trước Studio (hoạt ảnh, sự kiện);
- trạng thái trong Studio (tài liệu SVG, vùng chọn phần tử, hộp thoại).

**Phía thiết bị (BL335): không có thực thể mới.** Runtime chỉ kiểm thêm luật 0.4 lúc nạp project; `system/info.schemaVersions` thêm `"0.4"`; không có bảng, endpoint hay trạng thái bền mới.

Thời điểm dạng ms UTC (`…Ms`). Đơn vị vị trí và cỡ của item là **đơn vị thiết kế** (số nguyên, như 007); số trong binding SVG ở **đơn vị người dùng của SVG** (hệ tọa độ của phần tử).

## 1. Binding của item `svg` (file `*.bindings.json`)

| Trường | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|
| `schemaVersion` | chuỗi | có | `0.4.x`, bằng `project.json` |
| `screenId` | chuỗi | có | id màn hình chứa item |
| `itemId` | chuỗi | không (khuyến nghị) | nếu có phải bằng `id` của item `svg` trỏ tới file này |
| `elements` | mảng `ElementEntry` | có | ≤ 2.000; `elementUid` duy nhất |

**`ElementEntry`:**

| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `elementUid` | chuỗi | `^el_[a-z0-9_]{3,40}$`; có trong `elements` của item |
| `bindings` | mảng `Binding04` | 1–16; mỗi nhóm đích tối đa một |
| `events` | `{ click?: ElementAction }` | tối đa một sự kiện |
| (ràng buộc) | | ít nhất một trong `bindings`, `events` |

**`Binding04`**: `id`, `target`, `source` (`{ type: 'tag', tagId }`), `transform`, `onBadQuality?`, và tham số theo đích (bảng ở [contracts/binding-animation.md](contracts/binding-animation.md) §1–§2).

**`ElementAction`**: một trong 6 hành động (`write`, `toggle`, `pulse`, `navigate`, `popup`, `closePopup`) kèm `tag`, `confirm`, `minRole`, `label` cho ba hành động ghi ([contracts/svg-events.md](contracts/svg-events.md) §2).

**Quan hệ:** mỗi item `svg` có đúng một file binding; mỗi `ElementEntry` trỏ một phần tử của file SVG của item; `source.tagId`, `valueTable`, `tag`, `screen` trỏ tới Tag, bảng giá trị, màn hình của project (kiểm bởi validator). Không có tham chiếu ngược trong SVG.

## 2. Item `svg` (không đổi cấu trúc)

Như 0.3 ([data-model.md của 007](../007-screens-widgets/data-model.md) §2). Khác biệt dùng: ≤ 64 item `svg` mỗi màn hình; `elements[]` liệt kê UID có binding, sự kiện hoặc tên riêng; `svgFile` có thể nằm ở `graphics/…` hoặc `graphics/symbols/…`.

**File SVG** (đã làm sạch): chỉ phần tử và thuộc tính trong allowlist ([contracts/svg-import.md](contracts/svg-import.md) §2–§3); mỗi phần tử gắn được có `data-mat-uid`, phần tử có nhãn có `data-mat-name`; không `style` block, không `class`, không `script`.

## 3. Importer

**`ImportReport`**: xem [contracts/svg-import.md](contracts/svg-import.md) §6. Thực thể chỉ sống trong Studio và CLI (không vào project, không vào gói).

**`ElementInfo`**: `{ uid, tag, name, parent, depth, label? }`; dựng cây phần tử của Studio; không lưu.

**`MatchResult`** (nhập lại):

| Trường | Ý nghĩa |
|---|---|
| `pairs` | `{ newPath, oldUid, step: 1\|2\|3\|4, d }`: khớp tự động |
| `ambiguous` | `{ newPath, candidates: [{ oldUid, d }] }` (≤ 3): cần chọn |
| `added` | đường dẫn phần tử mới (nhận UID mới) |
| `orphans` | `{ oldUid, name, hasBinding, hasEvent }`: phần tử cũ không còn |

Bất biến: mỗi `oldUid` xuất hiện tối đa một lần trong `pairs`; `ambiguous` và `pairs` rời nhau; `added` ∪ `pairs` ∪ `ambiguous` = mọi phần tử gắn được của bản mới.

**Máy trạng thái hộp thoại Nhập SVG:** `idle → reading (svg_open) → importing (Worker) → preview | error → committed | cancelled`. `preview → importing` khi đổi tùy chọn Tối ưu. Chỉ `committed` đổi tài liệu.

**Máy trạng thái Nhập lại:** `idle → reading → importing → matching → resolve (còn ambiguous hoặc orphan) → applied | cancelled`; `resolve → applied` khi bấm Áp dụng (mọi dòng đã chọn hoặc mặc định).

## 4. Thư viện ký hiệu

`SymbolManifest { schemaVersion, license, categories[], symbols[] }`; `Symbol { id, name, category, file, viewBox, defaultSize, keywords[], parts[], ports[], variants? }`; `Part { role, uid, label, suggest[] }`; `Port { id, x, y, dir, kind }` ([contracts/symbol-library.md](contracts/symbol-library.md) §2). Chỉ sống trong package; project chỉ chứa tệp SVG đã sao và item.

**Thể hiện**: item `svg` có `svgFile` = `graphics/symbols/<tệp>`; không lưu quan hệ với ký hiệu gốc (Studio nhận ra thể hiện bằng `svgFile` khớp tệp của manifest để hiện **Gắn nhanh**).

## 5. Trang runtime và xem trước (`@mat/ui-components`, `@mat/binding-engine`)

| Thực thể | Trường | Ghi chú |
|---|---|---|
| `TransformState` | `tx, ty, rot, spinRps, sx, sy, M0, bbox, pivotRot, pivotScale` | một cho mỗi phần tử có binding transform; `M0`, `bbox` đo một lần |
| `AnimSlot` | `kind: 'spin'\|'blink'\|'flow'`, `animation: Animation`, `period?`, `rate?` | một cho mỗi phần tử và loại |
| `ClipSlot` | `clipPathId`, `rect`, `bbox`, `direction` | cho `geometry.clipLevel` |
| `SvgEventBinding` | `uid`, `controller?: ControlController`, `lock: Lock \| null`, `handlers` | một cho mỗi phần tử có sự kiện |
| `StatusSink` | `show(message, kind)` | vùng `role="status"` của `<mat-screen>` |
| `AnimationRegistry` | `count()` | đếm hoạt ảnh vô hạn của màn hình (đo và cảnh báo) |

Tất cả là trạng thái bộ nhớ của trang, hủy khi đổi màn hình (`dispose`), không lưu.

## 6. Studio

| Thực thể | Trường | Ghi chú |
|---|---|---|
| `SvgDoc` (theo item) | `text` (SVG đã nhập), `tree: ElementInfo[]`, `names: Map<uid,string>`, `dirty` | nạp lười từ file; ghi đĩa khi Lưu |
| `SvgBindingDoc` (theo item) | `elements: ElementEntry[]`, `dirty` | thao tác thuần (`addBinding`…) |
| `EditorSvgState` | `enteredItemId?`, `selectedUids[]`, `testValues: Map<tagId, value>` | thuộc phiên làm việc, không lưu vào project |
| `AnimationRow` | `id`, `target(s)`, `elementKinds`, `tagTypes`, `transforms[]`, `params[]` | dữ liệu của `animation-catalog.ts` |
| `Suggestion` | `rowId`, `tagId`, `transform`, `params`, `reason` | tính theo bảng ở contract §6 |
| `ImportDialogState` | trạng thái §3, `options`, `result?` | |
| `ReimportState` | trạng thái §3, `choices: Map<newPath, oldUid \| 'new'>`, `orphanChoices: Map<oldUid, 'keep'\|'drop'>` | |

Lịch sử hoàn tác dùng `history.ts` có sẵn: mỗi lệnh một bước; nhập, nhập lại, áp dụng đối chiếu là một bước (đổi nhiều file trong một bước).

## 7. Quy tắc nhất quán (validator, TS và C++ chung trừ khi ghi TS)

1. Mọi `elementUid` của `bindings`/`events` có trong `elements` của item (`E_REF_UID`); ở TS còn kiểm có trong SVG (`W_UID_NOT_IN_SVG`).
2. Mỗi phần tử: tối đa một binding mỗi nhóm đích (`E_DUP_BINDING`).
3. Đích, phép biến đổi, tham số theo bảng đích (`E_BIND_TRANSFORM`, `E_BIND_PARAM`, `E_TYPE_MISMATCH`).
4. `rangeMap`: khoảng không chồng, `from` < `to` (`E_RANGE`).
5. Sự kiện: hành động, Tag, màn hình đích, `confirm`, `minRole` (`E_EVENT_*`).
6. Giới hạn: ≤ 64 item `svg`, ≤ 256 hoạt ảnh vô hạn mỗi màn hình (`E_LIMIT`), cảnh báo > 64 (`W_ANIM_MANY`).
7. SVG (TS): qua allowlist, trong giới hạn (`E_SVG_UNSAFE`, `E_SVG_LIMIT`, `W_SVG_HEAVY`).
8. UID: duy nhất trong file SVG của item (TS); `data-mat-uid` khớp mẫu.

## 8. Tên file

| File | Mẫu | Ví dụ |
|---|---|---|
| SVG nhập | `graphics/<slug>.svg` | `graphics/so-do-bon.svg` |
| SVG ký hiệu | `graphics/symbols/<tệp>.svg` | `graphics/symbols/pump-centrifugal.svg` |
| Binding của item | `screens/<màn hình>.<item>.bindings.json` | `screens/bon-nuoc.svg_bom1.bindings.json` |
| Báo cáo import (ngoài project) | `<tên>.import-report.json` / `.md` | do người dùng chọn nơi lưu |

`<slug>`: chữ thường, số, dấu gạch ngang từ tên file gốc (bỏ dấu tiếng Việt), ≤ 48 ký tự; trùng thêm `-2`, `-3`. Tổng đường dẫn ≤ 128 byte.
