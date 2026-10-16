---
name: v2-gd1-status
description: "Roadmap v2 progress (2026-10-13): 004+005 done; 006 (GĐ 2) code done 188/228, ci-local green, Studio 0.4.0 built; remaining = BL335/PLC/RS485/human items; GĐ 3-6 not started"
metadata:
  node_type: memory
  type: project
  originSessionId: 08bc1575-ac24-4f61-bbbb-190542d6abe7
  modified: 2026-10-12T09:45:46.821Z
---

State 2026-10-12. The user approved the UI and gave full authority ([[user-full-authority]]). The user wants **batches**: many features per agent, targeted tests in between, ONE full verification at the end (not after each task).

**004 Studio shell:** done 86/86.

**005 device-online:** dev complete, 11 local commits on branch `003-data-logging` (never pushed).
- Security checkpoint reached 2026-10-12 (x64 + qemu armhf); `tools/ci-local.ps1` all green; Studio 0.3.0 installer built: `C:\build\mat-studio\release\bundle\nsis\mAT Studio_0.3.0_x64-setup.exe`; real-Studio smoke PASS.
- Counts: ctest 1184, cargo 126, Vitest ~821, e2e 228.
- Measured on x64:
  - deploy 4.1 s (median, 30 round trips identical);
  - kill 24/24;
  - rollback after crash 7.9 s, after hang 20 s;
  - diagnostics poll +0.1% CPU.
- Open, needing the user or the device:
  - T158–T165: SSH to BL335 is denied by the auto-mode classifier, so these wait;
  - T161 needs someone on site; T162 needs a Windows machine on the LAN; T165 needs an engineer to try it;
  - T055 auth-bench on the device.
- Review leftovers (Medium, recorded in `docs/reports/005-acceptance.md` §9):
  - extra files in a package make the digest differ → `HEALTH_TIMEOUT` rollback (safe, but the validator should reject them);
  - live WS on HTTPS without login can hold the 8 workers;
  - `persist()` holds a mutex during fsync.

**006 tags-modbus (GĐ 2):** spec (61 FR, 22 SC), plan (R1–R25, 8 contracts, ADR 014–018), tasks (228) done; plan questions answered.
- Decisions:
  - unit sandbox `DevicePolicy=closed` + `DeviceAllow` + `dialout`;
  - SQLite `HAVE_FDATASYNC=1` as the first foundational task;
  - 20 write commands/min for the whole BL335;
  - Studio 0.4.0, runtime 0.5.0, live 1.2.0, API 1.1.0;
  - viewer serves private ranges only (`viewerAccess` private|any|off).
- Started 2026-10-12: agent in a git worktree doing mockup + shared vectors + TS libs (merge the branch after reviewing).
- RS485 port facts unknown (need the read-only commands from `specs/006-tags-modbus/quickstart.md` §8).

**Environment:**
- Docker disk image was moved to F: (2026-10-12); C: now has ~77 GB free, F: ~140 GB.
- D: has ~9 GB free; never build there.
- ASan runs can write huge logs and blow up the Docker VM: avoid.
- Build dirs live in `C:\build\mat-x64-e2`, `mat-armhf-e2`, `mat-studio`.

**Traps (keep):**
- Light DOM makes CSS global: scope by tag name. A `<mat-shell>` upgrades before `.app` is set → use `AppElement.attached()`.
- axe: no button inside `role=tab`; empty `role=tree` is a violation; muted text on `--sel` needs ≥ 4.5:1.
- Handlers must read live state. `HTMLElement` already has `title` and `hidden`.
- Bash heredocs lose backslashes: use forward slashes.
- ctest `-Filter` matches GoogleTest names (wrong regex = 0 tests, exit 0). A prettier/eslint glob that matches no file exits 2.
- API session limits stop agents mid-run; resume them with SendMessage after the reset.
- A ci-local started from a background shell can be cut off: launch it detached with `Start-Process` and watch the log.

**Next:** merge the 006 worktree branch, then run 006 in large batches (foundation → Modbus TCP read → write → RTU → calc tags → diagnostics → simulation), one full check per batch.
**Related:** [[roadmap-v2-proposal]], [[feature003-status]], [[sprint1-handoff]], [[studio-ui-quality-bar]], [[bl335-ssh-access]].

**Update 2026-10-13 (overnight run):**
- 006 (GĐ 2): device side (Tag Engine, Modbus TCP/RTU, write path, diagnostics, retain) and Studio side (lưới, Kết nối, Bảng Tag, Bảng giá trị, Tag tính toán, Bảng theo dõi, Chẩn đoán, Mô phỏng) are done and committed (14+ local commits, never pushed). `ci-local` green.
- Studio 0.4.0 installer: `C:\build\mat-studio\release\bundle\nsis\mAT Studio_0.4.0_x64-setup.exe`; real-Studio smoke PASS.
- Measured on x64: 800 tags / 10 clients CPU 0.5%; write → CONFIRMED ~209 ms; write IO ~30 KB per command (834 MB/day at 20/min); grid 2000 rows open 0.1 s.
- Still open (needs the user/device): T006 RS485 facts, T169 unit sandbox, T215 human IME test, T216 engineer trial, T217–T225 BL335/PLC/RS485/power-cut/4G, SC-010, SC-011 on eMMC.
- Final polish agent (k7): review, ASan fuzz 1 h, docs, ADR → Accepted.
- GĐ 3a–6 not started (screens/widgets, SVG import, alarm, history charts/reports, pilot).
