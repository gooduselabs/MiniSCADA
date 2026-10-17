# Data Model: Hoàn thiện và pilot, trình vẽ SVG, logic v2

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · Định dạng chi tiết: [contracts/](contracts/)

Mô tả dữ liệu mới của feature 011, theo nơi lưu. Mọi lược đồ JSON có `schemaVersion`; mọi tệp ghi bằng "ghi tạm, fsync tệp, đổi tên, fsync thư mục" (như 005, 006) trừ khi nói khác.

## 1. Trên thiết bị (`<dataDir>` = `/var/lib/mat-runtime`)

### 1.1 `pulse.journal` (FR-018, FR-019)

Tệp thêm cuối (append-only) theo dòng JSON, mỗi lần ghi một dòng rồi `fdatasync`; mở `O_APPEND`, mode 0600, thuộc `matscada`. Gọn lại (rewrite) khi khởi động và khi số dòng > 256.

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `v` | số | 1 |
| `op` | `"arm"` hoặc `"done"` | `arm` ghi **trước** khi ghi giá trị bật; `done` ghi sau khi nhả được thiết bị xác nhận |
| `rid` | chuỗi UUID | mã yêu cầu của lệnh xung |
| `tag` | chuỗi | Tag id |
| `rel` | BOOL/số/chuỗi | giá trị nhả |
| `dueMono` | số (ms) | hạn nhả theo monotonic (chỉ có nghĩa trong cùng lần chạy) |
| `dueWall` | chuỗi ISO 8601 | hạn nhả theo giờ thực (dùng sau khởi động lại) |
| `src` | `"api"`, `"web"`, `"logic"` | nguồn lệnh |
| `by` | chuỗi | tài khoản hoặc `logic:<ruleId>` |
| `seq` | số nguyên ≥ 0 | thứ tự tăng |
| `ch`, `dev`, `addr` | chuỗi | (dòng `arm`, từ T062) kênh, thiết bị trường, địa chỉ nguồn của Tag lúc bật bit (`""` khi Tag không phải external). Dòng cũ không có ba trường này vẫn đọc được (không đối chiếu) |

Trạng thái mục: `armed` (có `arm` chưa có `done`). Khởi động: mỗi mục `armed` là một xung dở. Lỗi ghi `arm` ⇒ lệnh `FAILED` `PULSE_JOURNAL_FAILED`, chưa ghi gì xuống thiết bị.

Đọc chặt (T062): dòng có trường sai kiểu (`v` không phải số 1, `seq` âm/lẻ/chuỗi, `dueMono` không phải số nguyên, `dueWall`/`src`/`by`/`op` không phải chuỗi, chỉ có một phần của `ch`/`dev`/`addr`) là dòng không đọc được: bỏ qua và đếm, không bao giờ làm runtime dừng. Lệnh bật hỏng được thiết bị trả lời (`DEVICE_EXCEPTION`) hoặc chưa gửi (`NOT_SENT_*`) thì đóng mục; `READBACK_ERROR`, `READBACK_MISMATCH` (thiết bị đã nhận lệnh, bit có thể đã bật) thì mục giữ lại và runtime nhả khi tới hạn xung, thử lại mỗi 5 s như lệnh nhả hỏng. Khi phục hồi, Tag nay trỏ kênh, thiết bị hay địa chỉ khác với dòng `arm` thì không ghi gì: `PULSE_STUCK`.

### 1.2 `update/` (FR-057 đến FR-066)

```text
<dataDir>/update/
  incoming/<id>.part          # đang nhận (0600, matscada)
  ready/<id>.matupdate        # đã qua kiểm sơ bộ của runtime
  request.json                # yêu cầu áp dụng (kích hoạt mat-updater.path)
  ops/<id>.json               # trạng thái từng bước
  last.json                   # kết quả gần nhất (do mat-updater ghi, runtime đọc)
/var/lib/mat-updater/<id>/    # bản sao của root (0700), chỉ tồn tại trong lúc áp dụng
/opt/mat-runtime{,.new,.prev,.failed}
/etc/mat-runtime/trusted-keys/*.pem
```

`request.json`:

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `updateId` | chuỗi `^upd_[0-9a-f]{16}$` | |
| `sha256` | hex 64 | băm của `ready/<id>.matupdate` |
| `by` | chuỗi | tài khoản administrator |
| `requestedAt` | ISO 8601 | |
| `planned` | bool | cập nhật có kế hoạch (loại khỏi uptime) |

`ops/<id>.json`: `{"updateId", "from", "to", "step": 1..8, "name", "at", "result": null | "committed" | "rolled-back" | "failed", "reason": null | "..."}`; mỗi bước đổi là một lần ghi tạm rồi đổi tên.

`last.json`: `{"updateId", "result": "committed"|"rolled-back"|"failed", "from", "to", "releaseSeq", "finishedAt", "reason", "audited": false, "planned": true}`.

### 1.3 `logic-state.json` và `retain/logic/` (FR-082, FR-083, FR-090)

`logic-state.json` (ghi khi administrator dừng ghi, hoặc khi `edgeId` đổi nếu `flush`): 

```json
{ "schemaVersion": "1.0.0", "writesStopped": true, "stoppedAt": "…", "stoppedBy": "quanly",
  "edges": { "pump_low_level": 41 }, "lastFired": { "pump_low_level": "…" } }
```

Tệp có mà không đọc được (không mở được, không phải JSON object, `writesStopped` không phải boolean) thì runtime khởi động với ghi PLC từ logic **dừng** (`stoppedBy: "system"`, `stopReason: "STATE_UNREADABLE"`, cảnh báo `LOGIC_WRITES_OFF` có `detail.reason`, audit `logic.writes.disabled` tài khoản `system`); chỉ root bỏ được bằng `mat-runtime --logic-writes-reset` (T062). Tệp không có là lần chạy đầu. Tệp được ghi ngoài khóa của engine (ảnh chụp lấy dưới khóa, ghi dưới khóa riêng theo thứ tự ảnh chụp): fsync không giữ vòng quét Tag Engine.

`retain/` (kho của 006) thêm khóa `logic/<id>/<trường>`:

| Khối | Trường lưu |
|---|---|
| counter | `value` (INT64), `overflow` (bool) |
| totalizer | `total` (FLOAT64), `gapSeconds` (FLOAT64) |
| runhours | `hours` (FLOAT64), `starts` (INT64), `lastRun` (bool) |
| luật | `edgeId` (INT64) |

### 1.4 Bộ nhớ (không lưu đĩa)

| Cấu trúc | Khóa | Giá trị |
|---|---|---|
| `LoginGuard.pair` | (tên NFC, IP) | `fails`, `lockUntilMono`, `lockCount`, `lastFailMono` (LRU 4.096) |
| `LoginGuard.ip` | IP | `failsWindow` (10 phút), `lockUntilMono` |
| `LoginGuard.name` | tên | cửa sổ 10 phút: số lần sai, tập IP (≤ 8) cho phát hiện phân tán |
| `ConnLimiter` | IP nguồn | số kết nối đang mở (HTTP, HTTPS, WS) |
| `HostPolicy` | | tập tên (`gethostname`, `.local`, `allowedHosts`), `hostCheck` |
| `LogicRuntime` | id khối | trạng thái từng khối (`stable`, `candidate`, `since`, `lastRise`, `repeatAt`, `state`, `reason`), bộ đếm, bộ chặn tần suất |
| `UpdateSession` | `updateId` | `plan`, `receivedAt`, `verifiedAt`, hết hạn 30 phút |

### 1.5 Audit mới (`audit.db`, lược đồ không đổi; thêm loại bản ghi)

Cột `kind` có thêm các giá trị (chuỗi): `access.denied` (với `detail.reason` = `host`), `auth.distributed_attack`, `tag.write` (với `detail.source` thêm `pulse-recovery`, `logic`), `system.update.*`, `system.keys.updated`, `logic.write`, `logic.write.suppressed`, `logic.throttled`, `logic.writes.disabled`, `logic.reset`, `logic.retain.lost`. Bản ghi `logic.write` có `detail`: `{"rule", "write", "tag", "old", "new", "inputs": [["TANK01.LEVEL", 19.0]…≤ 8], "result"}`. Không có bí mật (mật khẩu xác nhận không bao giờ vào audit).

### 1.6 `diagnostics` (bộ đếm trong runtime)

`ioWriteBytesToday` theo thành phần: bộ đếm byte ghi do chính mã runtime phát ra (`HistorySink`, `AuditStore`, `RetainStore`, logic flush, `LogFile`, project/state) cộng với `/proc/self/io write_bytes` làm tổng; bộ đếm đặt lại lúc 00:00 giờ địa phương (`tzOffsetMin`).

## 2. `logic.json`

Xem [contracts/logic-engine.md](contracts/logic-engine.md) §1. Thực thể: `Write` (id, tag, allowed, minIntervalMs, maxPerHour), `Rule`, `Timer`, `Counter`, `Totalizer`, `RunHours`, `Schedule`, `Action` (`setTag`, `toggle`, `write`, `pulse`). Quan hệ: `Rule.actions → Write.id` (ghi/xung), `* → Tag id` (đầu vào), `Block.out → Tag logic` (đầu ra, duy nhất toàn project).

## 3. Project (Studio và thiết bị)

| Tệp | Thêm | Ghi chú |
|---|---|---|
| `project.json` | `logic`, `templates` | contracts/project-format-1.0.md §2 |
| `logic.json` | mới | §2 |
| `templates/<id>.template.json` | mới | contracts/project-format-1.0.md §3 |
| `screens/*.screen.json` | `tpl` (item), `params` (popup), `args` (hành động `popup`) | §4, §5 |
| `svg/*.svg` | `data-mat-layer`, `data-mat-name` | §8 |

## 4. Studio (không vào gói)

```text
<project>/.mat-backup/                     # có từ 007: bản sao trước khi nâng cấp
<project>/.mat-editor/
  svg-state.json                           # lớp ẩn/khóa, đường gióng (contracts/svg-editor.md §6)
  autosave/<tệp>.<yyyyMMddTHHmmss>.svg     # tự lưu, tối đa 3 bản/tệp
  logic-ui.json                            # trạng thái giao diện (mục đang mở, bộ lọc); tùy chọn
```

Studio loại `.mat-editor/` và `.mat-backup/` khi đóng gói. Mất `.mat-editor/` không làm mất dữ liệu thiết kế.

**Mô hình tài liệu (bộ nhớ):** `DrawDoc`, `DrawNode`, `Command`, `Batch`, `UndoStack` (`depth = 100`): contracts/svg-editor.md §2, §3.

## 5. Phát hành (`release/<ver>/`, không commit)

| Tệp | Nội dung chính |
|---|---|
| `mAT Studio_<ver>_x64-setup.exe` | bộ cài đã ký |
| `mat-runtime-armhf.tar.gz`, `.sha256` | gói runtime (như 0.6) |
| `mat-runtime-<ver>.matupdate` | gói cập nhật (contracts/update-package.md) |
| `SHA256SUMS`, `SHA256SUMS.sig` | băm mọi tệp và chữ ký ECDSA |
| `sbom.cdx.json` | CycloneDX 1.5: `components[]` (`type`, `name`, `version`, `purl`, `licenses[]`, `hashes[]` nếu có), `dependencies[]` |
| `licenses.md` | bảng thành phần, license, nơi dùng, ghi chú LGPL động |
| `build-info.json` | `version`, `releaseSeq`, `commit`, `dirty`, `builtAt`, `tools` (phiên bản compiler, node, rust), `release` (bool), `signing` (`mode`, `thumbprint`, `timestampUrl`) |
| `signing-log.json` | mỗi lần ký: tệp, thời điểm, dấu vân tay, chủ thể, URL dấu thời gian (không có bí mật) |
| `RELEASE-NOTES.md` | ghi chú phát hành |

`releaseSeq` được ghi vào `build-info.json` trong cây cài (`/opt/mat-runtime/build-info.json`) và `system/info`.

## 6. Pilot

**Mẫu thu (`<site>/<ngày>.jsonl`)**: mỗi dòng `{"t": "ISO", "site": "…", "info": {version, releaseSeq, bootId, uptimeS, warnings[codes]}, "diag": {restarts, rssMb, cpuPct, fdCount, ioWriteBytesToday, emmcLife, liveLagP95Ms, clients, timeSynced}}`; không có tên Tag, giá trị, địa chỉ công cộng.

**Sự cố (`incident-log.md`)**: bảng Markdown với cột cố định: `ID`, `Phát hiện`, `Mức`, `Mô tả`, `Tác động`, `Nguyên nhân`, `Xử lý`, `Bản vá`, `Hồi quy`, `Đóng`, `Loại trừ uptime` (`site-power` / `planned` / không).

**KPI (`kpi.mjs` đầu ra)**: `{"site", "from", "to", "uptime": {"ratio", "downtimeMin", "excluded": [...]}, "restarts": [...], "rss": {...}, "cpu": {...}, "ioWrite": {"perDay": [...], "maxDayBytes"}, "liveLag": {"weeklyMaxP95Ms": [...]}, "emmc": {"start", "end", "stepsIncreased"}, "incidents": {"S1": 0, "S2": 1, ...}, "criteria": {"X1": "Đạt", ...}}`.

**Kết quả vòng mất điện (`011-powercut.json`)**: mảng `{ "n", "kind": "random|D1..D5", "cutAt", "readyS", "checkData": {"code", "dbs": {...}}, "auditMissing": 0, "pulseRecovered": true|false|null, "notes" }`.

## 7. Mã nguồn dùng chung

| Gói | Vai trò |
|---|---|
| `packages/logic-engine` (mới, TS) | engine logic cho mô phỏng Studio; cùng vector với `core/logic` |
| `packages/svg-edit` (mới, TS) | mô hình tài liệu SVG, lệnh, hình học (không DOM) |
| `packages/project-schema` | validator và migration 1.0.0; `substituteParams` dùng chung với `ui-components` |
| `core/logic` (mới, C++) | engine runtime, validator logic C++ |
| `server/updater/` (mới) | `mat-update-verify`, `mat-updater`, unit systemd |
| `server/pulse_journal.*`, `server/host_policy.*`, `core/auth/login_guard.*` | hardening US1 |

## 8. Vòng đời trạng thái chính

**Luật**: `OK` ⇄ `SUSPENDED` (đầu vào xấu / chưa đồng bộ giờ / lỗi biểu thức); `OK` → `THROTTLED` (60 s) → `OK`; `DISABLED` khi `enabled: false`.

**Cập nhật**: `idle` → `receiving` → `verified` → (`apply`) `applying` → `committed` | `rolled-back` | `failed`; `verified` → `cancelled` | hết hạn.

**Xung**: `armed` → `done` (bình thường) | `armed` → (khởi động lại) `recovering` → `done` | `stuck`.

**Khóa đăng nhập**: `ok` → `counting` (1 đến 4 lần sai) → `locked` (5 phút, nhân đôi, ≤ 60 phút) → `ok` (hết hạn hoặc `--user-unlock`).
