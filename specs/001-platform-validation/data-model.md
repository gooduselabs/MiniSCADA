# Data Model — Sprint 0

| Thực thể | Trường chính | Quan hệ / ghi chú |
|---|---|---|
| DeviceProfile | id, collectedAt, arch, osRelease, kernel, glibc, ramTotalMb, storage[], serialPorts[], rtc, tempC, emmcLife? | Một bản mỗi lần thu thập; lưu `docs/reports/device-profile.md` |
| ToolchainBuild | id, image, compilerVersion, targetTriple, gitRev | Sinh ra Binary |
| Measurement | id, scenarioId, deviceId, binaryId, startedAt, durationS, samples[] | samples: `{t, rssMb, memAvailMb, cpuPct}` |
| LoadScenario | id, clients, tags, intervalMs, durationS, serverKind (`civetweb`/`drogon`) | Một Measurement thuộc đúng một scenario |
| ClientResult | scenarioId, clientIndex, accepted, closeCode?, updatesReceived, seqGaps, p95LatencyMs | Client thứ 11: `accepted=false`, `closeCode=4429` |
| GoNoGoCriterion | id, name, threshold, measured, verdict (`GO`/`NO_GO`), fallback | 7 tiêu chí của Master Plan §13 |
| Adr | id, title, status, context, decision, consequences | 5 file trong `docs/adr/` |
| SvgFixture | file, sourceApp, features[], loadTimeMs? | Trong `tests/fixtures/svg/` |

**Quy tắc kiểm tra**: `clients ≤ 10` chấp nhận, client thứ 11 phải `accepted=false`; `verdict=GO` chỉ khi `measured` thỏa `threshold`; Measurement bị loại nếu thiết bị khởi động lại giữa lúc đo.

**Trạng thái session (PoC)**: `CONNECTING → ACTIVE → (SLOW → RESYNC_REQUIRED → CLOSED) | CLOSED`; slot chỉ được giải phóng khi `CLOSED` hoặc heartbeat timeout 15 s.
