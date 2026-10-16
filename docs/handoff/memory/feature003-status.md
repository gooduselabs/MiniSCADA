---
name: feature003-status
description: "State of specs/003-data-logging (historian + forwarding to MySQL/MSSQL/PG/InfluxDB) as of 2026-10-11: three review rounds fixed, user decisions taken, BL335 deploy done; what is left and the traps"
metadata:
  node_type: memory
  type: project
  originSessionId: 08bc1575-ac24-4f61-bbbb-190542d6abe7
  modified: 2026-10-10T19:11:24.661Z
---

Feature 003 (tag data logging) in D:\ATPro\RD\MiniSCADA: done on x64, three review rounds (code + security, then a re-review of the round-2 fixes) all fixed test-first; tables in docs/reports/003-acceptance.md §6. Device work in §8.

- **User decisions 2026-10-10** ("xử lí cả đi nhé"): (1) T075–T078 allowed on BL335; (2) Claude chose the TLS default → SQL connections default `verify-full` (Constitution V), SQL Server cert refusal now reads `tls` (classifyMssqlOpen 20002); (3) `synchronous=FULL` for the mark-clear transaction approved → Constitution 1.1.1.
- **Exactly-once now uses compare-and-set**: writeBatch(sourceId, table, rows, prevSeq, lastSeq); the cursor moves only from the value read (MySQL: UPDATE…AND last_seq=prev + SELECT FOR UPDATE; MSSQL: IF @@ROWCOUNT/THROW 51000; PG: DO block, ERRCODE 40001). Proven with a real late-committing transaction in all 3 DBs (IT 39/39).
- **SQLite 3.54.0 has a 32-bit heap overflow** (sqlite3VdbeMakeReady nFree): first BL335 deploy crashed `free(): invalid pointer`, deploy.sh rolled back. Patched (third_party/sqlite/PATCHES.md); CI step `armhf smoke (qemu)` (deployment/toolchain/smoke-armhf.sh, qemu-user in the toolchain image) catches 32-bit faults x64 tests cannot. When upgrading SQLite re-check that patch.
- **Device traps:** BL335 has no `sudo` → `runuser -u matscada -- …`; Docker Desktop here has no arm binfmt (qemu-user inside the toolchain container works, but copy files out of the Windows bind mount first); ASan armhf build: `-fsanitize=address,undefined -static-libasan -marm` in build/armhf-asan, run by hand on the device in /var/tmp.
- **New CLI:** `mat-runtime --check-history` (integrity_check + rows per table; exit 0/4/6); export exits 5 on output failure.
- **BL335 state 2026-10-11 02:10 (+07):** 0.3.0 `tank-demo` active, no DB connections, client libs (libmariadb3, libsybdb5, libpq5, libcurl4) installed and kept, no secrets.json; T075/T076/T078 [X] (SC-001 100 % rows, RSS ≤ 13.7 MB, CPU avg 11.7 %; SC-002 ≤ 71 ms; T078 via SSH reverse tunnel to test DBs, exact counts).
- **Left for the user:** real power cuts ≥3 (T077 stays [ ]) need someone at the device; a 10-minute run to the user's real DB needs its connection info (dev machine is not on the device LAN). Port 13306 on the dev machine is taken by another process: the T078 tunnel used 23306.
- **Re-run IT:** `docker compose -p mat-hist-it down -v` first, then `& D:\ATPro\RD\MiniSCADA\tools\historian-it.ps1 -Scenario forward|reliability|retention`.
- Git: no commits for 003 yet; ask before committing.

**Why:** next session must not redo finished work or repeat the traps above.
**How to apply:** read §6/§8 of the acceptance report and tasks.md notes first; touch the device only within the user's permission and log every change in docs/reports/device-changes.md.

Related: [[sprint1-handoff]], [[bl335-ssh-access]], [[dev-machine-env]]
