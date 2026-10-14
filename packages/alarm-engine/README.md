# @mat/alarm-engine

Động cơ alarm ISA-18.2 bằng TypeScript, cùng ngữ nghĩa với `core/alarm/` (C++) trên thiết bị. Dùng cho mô phỏng trong Studio (`apps/studio/src/model/alarm-sim.ts`) và để kiểm hai bản cho cùng chuỗi sự kiện trên bộ vector chung `tests/alarm-vectors/` (FR-016, SC-004).

- **Thuần:** không DOM, không I/O, không đọc đồng hồ. Thời gian là tham số: `step(nowMonoMs, nowEpochMs, tags)`.
- **Đầu vào:** `compileAlarms(project)` bung `alarms.json` + `alarm-classes.json` (project 0.5) thành `AlarmDefs`; `engine.load(defs, tagInfo, ctx)`; mỗi tick dựng `TagSample[]` theo `engine.watchedTags()` rồi gọi `step`, nhận `AlarmEvent[]`.
- **Lệnh:** `submit({ kind: 'ack' | 'shelve' | 'unshelve' | 'disable' | 'enable', ... })`; áp dụng ở `step` kế tiếp, kết quả là sự kiện `command`.
- **Đọc:** `view()` (ảnh chụp: `counts`, `items`), `previewAck(req)` cho "xác nhận tất cả".
- **Văn bản:** `formatAlarmText`, `foldText`, `shortestDouble`, `fingerprintHex` khớp từng ký tự với bản C++.
- **Vector:** `runVector(vector)` chạy một ca theo [alarm-engine.md §14](../../specs/009-alarms/contracts/alarm-engine.md); phần bổ sung và các quyết định ở [tests/alarm-vectors/README.md](../../tests/alarm-vectors/README.md).

```sh
npm test -w @mat/alarm-engine        # vitest: vector, bảng ISA 40 ô, văn bản
npm run typecheck -w @mat/alarm-engine
```

Hợp đồng đầy đủ: `specs/009-alarms/contracts/alarm-engine.md`. Phiên bản 0.1.0.
