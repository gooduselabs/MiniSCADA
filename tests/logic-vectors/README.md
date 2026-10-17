# Bộ vector logic v2 (`tests/logic-vectors/`)

Dùng chung cho hai bản cài đặt: TypeScript (`packages/logic-engine`, validator `packages/project-schema/src/rules-logic.ts`) và C++ (`core/logic`, validator `core/project-manager/rules_logic`, task T134, T135). Cả hai phải cho **cùng kết luận ở 100 % ca** (FR-092, FR-093, SC-024). Hợp đồng gốc: [contracts/logic-engine.md](../../specs/011-pilot-hardening/contracts/logic-engine.md) §12; mục "Quyết định" dưới đây chốt các chỗ contract chưa nói rõ (cả hai bản MUST theo).

Sinh bằng `node tests/logic-vectors/generate.mjs` (tất định, không import engine; kỳ vọng suy từ contract, totalizer và giờ chạy tính bằng công thức tham chiếu viết riêng trong script). Không sửa tay tệp `.json`: sửa script rồi sinh lại. Bộ chạy TS: `packages/logic-engine/src/vectors.test.ts`.

## Tệp

| Tệp | Nhóm (§12) | Số ca |
|---|---|---|
| `rules.json` | luật: hold, cạnh, fireOnStart, repeatMs, SUSPENDED, thứ tự, hành động, edgeId | 43 |
| `timers.json` | ton, tof, tp, làm tròn pt, đầu vào unknown | 30 |
| `counters.json` | cạnh, preset, down, reset, unknown, tràn | 26 |
| `totalizers.json` | hình thang, đơn vị, cutoff, khoảng trống, rolloverAt, reset | 27 |
| `runhours.json` | giờ, số lần khởi động, due, reset | 16 |
| `schedules.json` | khung, nửa đêm, ngoại lệ, múi giờ, đồng bộ giờ | 56 |
| `writes.json` | ghi PLC và giới hạn (minIntervalMs, maxPerHour, maxWritesPerMin, off, allowed) | 16 |
| `static.json` | kiểm tra tĩnh: mỗi mã `E_LOGIC_*` ≥ 1 ca sai và ≥ 1 ca đúng gần nó; mọi `W_LOGIC_*` | 57 |
| `retain.json` | lưu trạng thái qua khởi động lại | 12 |

Tổng 283 ca. Mỗi tệp: `{ "group": "<nhóm>", "cases": [ … ] }`, mỗi ca một dòng.

## Một ca

```json
{
  "id": "rule-hold-rise-1000", "group": "rules", "description": "…",
  "doc": { "schemaVersion": "1.0.0", "writes": [ … ], "rules": [ … ] },
  "tags": { "LEVEL": { "type": "FLOAT64", "kind": "external", "writable": false }, … },
  "config": { "scanMs": 100, "tzOffsetMin": 420, "writes": "on", "maxWritesPerMin": 20 },
  "retain": { "logic/c/value": "41" },
  "steps": [ { "t": 0, "set": { "LEVEL": 50 } }, { "t": 1000, "set": { "LEVEL": 10 } },
             { "t": 2000, "expect": { "actions": [ { "rule": "low", "do": "write", "write": "w_cmd", "tag": "CMD",
                                                      "value": true, "result": "QUEUED", "edgeId": 1, "t": 2000 } ] } } ],
  "expectErrors": [],
  "expectWarnings": ["W_LOGIC_DISABLED"]
}
```

- `doc`: nội dung `logic.json`, đã qua schema (`schemas/logic.schema.json`); bộ chạy KHÔNG chạy schema, chỉ luật.
- `tags`: Tag của `tags.json`: `type` (kiểu 006), `kind` (`external` mặc định, `internal`, `calculated`), `writable` (mặc định `false`; `true` = access `RW`), `expression` (Tag tính toán; dùng cho `E_LOGIC_SELF_TRIGGER` gián tiếp).
- `config`: `scanMs`, `tzOffsetMin` (thiết bị), `writes` (`on`/`off` = `logic.writes`), `maxWritesPerMin`; tùy chọn `flushS` (chỉ validator, mặc định 60) và `deviceWrites` (chỉ validator: trạng thái `logic.writes` của thiết bị đích; vắng thì không kiểm `W_LOGIC_WRITES_OFF`). Validator nhận `scanMs` (cho `W_LOGIC_PT_ROUNDED`).
- `retain` (tùy chọn): kho retain lúc khởi động đầu tiên (đối tượng khóa → giá trị), hoặc `"lost"` (kho hỏng).
- `expectErrors`: TẬP mã lỗi validator phải trả (so tập, không thứ tự, không đường dẫn). Khác rỗng thì không chạy `steps`.
- `expectWarnings` (tùy chọn): TẬP mã cảnh báo; vắng thì không so cảnh báo.

### Bước (`steps`, `t` tăng ngặt, là bội của `scanMs`)

Khóa của một bước: `t` (ms monotonic), `restart`, `wall`, `timeSynced`, `set`, `writeResult`, `flush`, `expect`. Bộ chạy xử lý bước tại `t` theo thứ tự:

1. **Quét bù**: nếu bước KHÔNG có `restart`: quét ở mọi bội của `scanMs` trong (lần quét trước, `t`) với đầu vào cũ. Quét đầu tiên của ca ở `t = 0`.
2. **`restart`**: `true` hoặc `{ "doc"?, "retain"? }`. Engine mới (tài liệu mới nếu có `doc`: nạp xuống giữ khối theo id); kho Tag trống (mọi Tag chưa có giá trị); kho retain = lần `flush` gần nhất (`"flushed"`, mặc định; chưa flush lần nào: kho trống, KHÔNG phải hỏng), `"lost"` (hỏng: mọi khối về 0, `retainLost = true`) hoặc đối tượng cho sẵn. Không quét bù khoảng tắt máy: quét đầu của engine mới ở chính `t`. Đồng hồ giả, giờ thực và `timeSynced` giữ nguyên.
3. **Đầu vào**: `wall` (giờ thực ISO 8601 `YYYY-MM-DDTHH:MM:SS(.fff)?(Z|±HH:MM)`; từ đây `wallMs(t') = wallMs + (t' - t)`, trôi cùng đồng hồ monotonic; chưa có `wall` thì giờ thực vắng = chưa đồng bộ), `timeSynced` (mặc định `true`), `set` (Tag → giá trị), `writeResult` (`{rule, result}`: kết quả cuối của lệnh ghi do WriteCoordinator báo lại, ghi vào `lastError`).
4. **Quét** ở `t`; sau mỗi quét (cả quét bù) bộ chạy áp hành động `setTag`/`toggle` có `result = "OK"` vào kho Tag (có hiệu lực từ quét sau).
5. **`flush`**: chụp kho retain sau quét ở `t`.
6. **`expect`** (so sau quét ở `t`).

Giá trị trong `set`: số, BOOL, chuỗi, `null` (chưa có giá trị, BAD), hoặc `{ "value", "quality": "GOOD"|"UNCERTAIN"|"BAD", "reason"? }`. Tag chưa từng đặt: chưa có giá trị.

### Kỳ vọng (`expect`)

- `actions`: danh sách ĐẦY ĐỦ, có thứ tự, các hành động phát sinh **kể từ lần so `actions` trước** (hoặc từ đầu ca), gồm cả quét bù; so xong thì xóa. Mỗi phần tử so các trường nêu: `t`, `rule`, `edgeId`, `edge` (`rise`/`fall`), `index`, `do`, `tag` (Tag đích; với write/pulse là Tag của mục `writes`), `write`, `value`, `ms`, `result`.
- `outputs`: Tag → giá trị. Giá trị trần: Tag phải GOOD và bằng giá trị đó; đối tượng `{ "value"?, "quality"?, "reason"? }`: so các trường nêu. Tag logic so đầu ra của engine; Tag khác so kho Tag của bộ chạy (để kiểm setTag/toggle).
- `state`: id khối → chuỗi trạng thái (`OK`, `SUSPENDED`, `THROTTLED`, `DISABLED`) hoặc đối tượng so từng trường nêu: `state`, `reason`, `stable` (`null` trước lần quét hợp lệ đầu), `edgeId`, `lastError` (`null` khi chưa lỗi), `degraded` (timer), `overflow` (counter).
- `retain`: ảnh chụp kho retain hiện tại, so ĐÚNG tập khóa và từng giá trị.
- `retainLost`: cờ kho hỏng của engine hiện tại.

So số: INT64 (`value` của counter) có thể viết bằng chuỗi thập phân hoặc số; số thực so **từng bit** (kỳ vọng do script tính đúng thứ tự phép toán; JSON in số ngắn nhất khứ hồi, bản C++ đọc bằng `strtod`).

### Kho retain

Khóa `logic/<id>/<trường>`: counter `value` (chuỗi thập phân INT64), `overflow` (bool); totalizer `total`, `gapSeconds` (số); giờ chạy `hours` (số), `starts` (số), `lastRun` (bool, chỉ khi đã biết); luật `edgeId` (số, mọi luật). Khối `retain: false` không có khóa. Timer và lịch không retain. Khóa thiếu hoặc sai kiểu: 0.

## Quyết định cho chỗ contract chưa nói rõ (cả hai bản MUST theo)

**Luật (§2)**

1. Lần quét hợp lệ đầu tiên (sau khởi động hoặc `restart`) đặt `stable = cond` NGAY, không chờ `hold`; chỉ chạy `onRise` nếu `fireOnStart` và `cond = true`.
2. `candidate` có mốc là quét đầu tiên thấy nó; thành `stable` ở quét đầu tiên có `now - mốc ≥ hold`. `cond = stable` thì hủy `candidate`. `unknown` hủy `candidate` (hold tính lại từ 0 khi trở lại).
3. `unknown` khi kết quả biểu thức không GOOD (kể cả UNCERTAIN, STALE, chưa có giá trị). Lý do: `TIME_NOT_SYNCED` nếu một đầu vào là đầu ra BAD `TIME_NOT_SYNCED` của lịch; `INPUT_BAD` nếu một đầu vào không GOOD hoặc chưa có giá trị; còn lại `EXPR_ERROR` (chia 0, tràn…).
4. `edgeId` tăng 1 cho MỖI lần bắn (cạnh lên, cạnh xuống, lần lặp `repeatMs`), kể cả khi danh sách hành động rỗng. Mọi hành động của một lần bắn mang cùng `edgeId`.
5. `repeatMs`: chỉ sau khi `onRise` đã thực sự chạy (cạnh lên hoặc `fireOnStart`); lần lặp khi `now - lần chạy onRise trước ≥ repeatMs`, không trong quét vừa bắn cạnh; cạnh xuống xóa mốc.
6. Thứ tự quét: sắp xếp tô-pô (Kahn) trên đồ thị khối (A → B khi biểu thức của B đọc đầu ra của A), hòa thì id nhỏ nhất (so byte ASCII). Khối đọc đầu ra của khối đứng trước thấy giá trị của chính quét đó; Tag khác đọc từ ảnh chụp đầu quét.
7. Kết quả hành động (`result`): `OK` (setTag/toggle), `QUEUED` (giao WriteCoordinator), `SUPPRESSED` (`logic.writes = off`), `RATE_LIMITED`, `OUT_OF_LIMITS` (giá trị biểu thức ngoài `allowed`), `EXPR_ERROR` (biểu thức của giá trị không tính được: không gửi, không đặt), `NO_VALUE` (toggle Tag chưa có giá trị GOOD). `lastError` = kết quả lỗi gần nhất (`RATE_LIMITED`, `OUT_OF_LIMITS`, `EXPR_ERROR`, `NO_VALUE`, hoặc `writeResult`); `SUPPRESSED` không phải lỗi.
8. Giá trị biểu thức của hành động gán theo kiểu Tag đích như Tag tính toán (ADR-015: số nguyên làm tròn nửa xa 0); hằng giữ nguyên.
9. Chuỗi kiểm của write/pulse: giá trị → `allowed` → `logic.writes` → `minIntervalMs` (so với lệnh QUEUED trước của mục `writes`) → `maxPerHour` (số lệnh QUEUED có `now - t < 3.600.000`) → token bucket toàn thiết bị. Chỉ lệnh QUEUED được tính. Token bucket: dung lượng `maxWritesPerMin` lượt, đầy lúc khởi động, nạp liên tục `maxWritesPerMin` lượt/60 s (tính số nguyên: một lượt = 60.000 đơn vị, nạp `maxWritesPerMin` đơn vị mỗi ms). Bộ chặn không retain.
10. `THROTTLED` khi `now - lần bị RATE_LIMITED cuối < 60.000`; ưu tiên `DISABLED` > `SUSPENDED` > `THROTTLED` > `OK`.

**Timer (§3)**: `in` trước lần quét hợp lệ đầu coi là `false` (như PLC). `et` cộng khoảng giữa hai quét hợp lệ LIÊN TIẾP (khoảng có quét unknown không tính); `pt < scanMs` dùng `scanMs`. `ton`: cạnh lên đặt `et = 0`, `q = et ≥ pt`. `tof`: cạnh xuống đặt `et = 0` và bắt đầu đếm; `q = false` khi `et ≥ pt`; `et` giữ `pt` sau khi xong. `tp`: cạnh lên khi không chạy: `q = true`, `et = 0`; đang chạy bỏ qua `in`; `et ≥ pt` thì `q = false` (`et = pt` ở quét đó); không chạy và `in = false` thì `et = 0`. Đầu vào unknown: giữ đầu ra, `degraded = true`.

**Counter (§4)**: cạnh lên khi giá trị hợp lệ trước đó là `false` và hiện tại `true`; mốc trước chỉ cập nhật khi hợp lệ; lần thấy hợp lệ đầu không phải cạnh. Cùng quét: reset (bỏ up và down) > up > down. `overflow` đặt khi một cạnh up bị bỏ vì đã ở max; reset xóa `overflow`. `reached` chỉ khi có `preset`.

**Totalizer (§5)**: `total = total + ((factor * ((r0 + r1) / 2)) * (dtMs / 1000)) / unitSeconds` (đúng thứ tự, không FMA: C++ biên dịch `-ffp-contract=off`), `r = rate < cutoff ? 0 : rate`. Khoảng có đầu mút unknown hoặc `dtMs > maxGapMs` (mặc định 5.000): cộng `dtMs` vào khoảng trống (ms nguyên; `gapSeconds = gapMs / 1000`). Quét đầu của engine chỉ ghi mốc (khoảng tắt máy không cộng và không là khoảng trống). Cùng quét: cộng → `rolloverAt` (trừ một lần) → cạnh lên reset (`total = 0`, `gap = 0`). Mặc định `factor` 1, `cutoff` 0.

**Giờ chạy (§6)**: khoảng (k-1, k] tính khi cả hai quét hợp lệ và `run` ở k-1 là `true`; giữ bằng ms nguyên, `hours = runMs / 3.600.000`; retain `hours` khôi phục `runMs = round(hours × 3.600.000)`. `starts` theo cạnh lên (mốc trước = `lastRun` của retain nếu có). Cùng quét: cộng → đếm khởi động → cạnh lên reset (`hours = 0`; `starts` giữ).

**Lịch (§7)**: giờ địa phương = UTC + `tzOffsetMin` (khối, không thì thiết bị). Ngày civil theo thuật toán days-from-civil (H. Hinnant), 1970-01-01 là thứ Năm. Phút trong ngày = `floor(ms trong ngày / 60.000)`. Ngoại lệ đè TOÀN BỘ ngày địa phương của nó. Khung `from > to`: phần trước nửa đêm thuộc ngày trong `days`; phần sau nửa đêm (`phút < to`) thuộc ngày hôm trước, chỉ tính khi ngày hôm trước có trong `days` và KHÔNG có ngoại lệ. Chưa đồng bộ: `{value: giá trị cuối hoặc null, quality: BAD, reason: TIME_NOT_SYNCED}`; trước quét đầu cũng vậy.

**Đầu ra trước quét đầu**: timer `q = false`, `et = 0`; counter `value` (retain hoặc 0); totalizer, giờ chạy từ retain hoặc 0; tất cả GOOD.

**Validator (§11)** (thứ tự kiểm ở đầu `rules-logic.ts`; vector chỉ so tập mã):

1. `schemaVersion` không khớp `^1\.0\.\d+$`: chỉ `E_LOGIC_VERSION`. (Trong project 1.0: mới hơn 1.0.x là `E_LOGIC_VERSION`; khác phiên bản project là `E_SCHEMA_VERSION` như mọi tệp; xem `tests/project-vectors/README-011.md`.)
2. `E_LOGIC_LIMIT`: cỡ tệp > 512 KiB, số mục mỗi mảng (200/100/100/50/50/50, writes 100), > 8 hành động mỗi luật (onRise + onFall), > 16 khung hoặc > 64 ngoại lệ mỗi lịch, `hold` ngoài 0…86.400.000, `repeatMs` khác 0 và ngoài 10.000…86.400.000, `minIntervalMs` thiếu hoặc < 1.000, `maxPerHour` thiếu hoặc < 1, `serviceEveryHours` ≤ 0, biểu thức vượt giới hạn của 006 (`E_EXPR_LIMIT`).
3. `E_LOGIC_ID`: id mọi mục (writes và khối chung một không gian) sai `^[a-z][a-z0-9_]{0,47}$` hoặc trùng; Tag đầu ra sai dạng Tag id của 006.
4. `E_LOGIC_TAG_COLLISION`: đầu ra trùng Tag của `tags.json` hoặc đầu ra trước đó (theo thứ tự rules, timers, counters, totalizers, runhours, schedules; trong khối theo thứ tự trường).
5. Biểu thức (môi trường: Tag của `tags.json` + Tag logic hợp lệ; kiểu đích BOOL cho `when`, `in`, `up`, `down`, `reset`, `run`, FLOAT64 cho `source`, kiểu Tag đích cho giá trị `{expr}`): `E_EXPR_UNKNOWN_TAG` → `E_LOGIC_TAG_REF`; `E_EXPR_LIMIT` → `E_LOGIC_LIMIT`; `E_EXPR_TYPE` mà biểu thức biên dịch được với một trong BOOL/FLOAT64/STRING → `E_LOGIC_TYPE`; còn lại → `E_LOGIC_EXPR`.
6. `writes`: Tag không có → `E_LOGIC_TAG_REF`; là Tag logic, hoặc không phải `external` + `RW` → `E_LOGIC_WRITE_TARGET`; `allowed.values` sai kiểu Tag, `min/max` trên Tag không phải số, `min > max` → `E_LOGIC_WRITE_VALUE`.
7. Hành động: `do` lạ, thiếu hoặc thừa khóa (setTag: tag, value; toggle: tag; write: write, value; pulse: write, value, ms), `ms` ngoài 100…10.000, setTag/toggle vào Tag logic hoặc Tag không phải `internal` → `E_LOGIC_ACTION`; Tag không có → `E_LOGIC_TAG_REF`; toggle Tag không BOOL, hằng setTag sai kiểu → `E_LOGIC_TYPE`; `write` không có trong `writes` → `E_LOGIC_WRITE_UNDECLARED`; hằng write/pulse sai kiểu hoặc ngoài `allowed` → `E_LOGIC_WRITE_VALUE`. Hằng hợp kiểu: BOOL ↔ boolean, STRING ↔ chuỗi, số nguyên trong miền kiểu, số thực hữu hạn.
8. `E_LOGIC_TIMER`: `kind` ∉ {ton, tof, tp}, `pt` không nguyên hoặc ngoài 1…86.400.000. `E_LOGIC_COUNTER`: `preset` không null và không nguyên ≥ 1; `reached` khi `preset` null. `E_LOGIC_TOTALIZER`: `rateUnit` ∉ {s, min, h, d}, `factor` ≤ 0 hoặc không hữu hạn, `cutoff` < 0, `maxGapMs` ngoài 1…86.400.000, `rolloverAt` ≤ 0. `E_LOGIC_SCHEDULE`: `tzOffsetMin` ngoài −720…840, `days` rỗng/ngoài 1…7/trùng, `from`/`to` không `HH:MM` (00:00…23:59), `from = to`, ngày ngoại lệ không có thật hoặc trùng, `mode` ∉ {on, off}.
9. `E_LOGIC_CYCLE`: mỗi thành phần liên thông mạnh có vòng (kể cả tự vòng) một lỗi. Biểu thức không biên dịch được không góp cạnh.
10. `E_LOGIC_SELF_TRIGGER`: từ các Tag mà `when` đọc, đi tiếp qua đầu vào của khối tạo ra Tag logic và qua biểu thức của Tag tính toán; gặp Tag mà setTag/toggle của chính luật đó đặt là lỗi. (Tag do luật KHÁC đặt không tính.)
11. Cảnh báo: `W_LOGIC_PT_ROUNDED` (`pt < scanMs`); `W_LOGIC_DISABLED` (`enabled: false`); `W_LOGIC_NO_HOLD` (`hold` = 0 hoặc vắng, luật có write/pulse, `when` đọc trực tiếp Tag `external` kiểu số); `W_LOGIC_WRITE_CONFLICT` (hai hành động setTag/write/pulse cùng Tag đích, cùng danh sách cạnh `onRise`/`onFall`, cùng `when` sau khi bỏ khoảng trắng, giá trị khác nhau theo JSON); `W_LOGIC_RETAIN_IO` (`(số khối retain × 24 + 512 + 4096) × floor(86400 / flushS) > 100 × 1024 × 1024`, khối retain = mọi luật + counter/totalizer/giờ chạy `retain ≠ false`); `W_LOGIC_WRITES_OFF` (`deviceWrites = off` và có ≥ 1 mục `writes`).

## Bản C++ (T134)

- Đọc từng tệp `*.json` ở đây (trừ không có tệp khác), duyệt `cases`. Cùng bộ chạy như trên; đồng hồ giả, giờ thực tiêm vào.
- Validator chạy trên `doc` với `tags`, `config.scanMs`, `config.flushS`, `config.deviceWrites`; so TẬP mã.
- Biểu thức qua `core/expression` (cùng vector với `@mat/expression`). INT64 của counter là `int64_t`; kỳ vọng là chuỗi hoặc số.
- Thứ tự hành động, `edgeId`, `result` phải trùng; số thực so bằng `==` (bit).
