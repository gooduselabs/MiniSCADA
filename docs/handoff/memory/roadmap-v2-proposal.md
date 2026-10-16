---
name: roadmap-v2-proposal
description: "Roadmap v2 (full SCADA, Option B) was approved by the user on 2026-10-11 ('làm v2 đi chứ'); Constitution 2.0.0; GĐ 1 split into specs 004-studio-shell and 005-device-online; decisions 3/5/6 settled 2026-10-11"
metadata:
  node_type: memory
  type: project
  originSessionId: 08bc1575-ac24-4f61-bbbb-190542d6abe7
  modified: 2026-10-11T10:37:30.976Z
---

On 2026-10-10 the user widened scope to a full SCADA (Studio scan/upload/download, many drivers, internal/calculated tags, DB logging, alarms, value maps, web widgets, SVG import + binding). Plan: `docs/plans/roadmap-v2.md` (+ `docs/architecture/studio-ux.md`).

**2026-10-11:** the user said "làm v2 đi chứ" → recorded as approval of Option B "SCADA first, free-form SVG editor later". Constitution amended to 2.0.0 (VII = scope by phases GĐ 0–6; V = download/write-tag APIs only with HTTPS + login + roles + audit). Master Plan §0/§12.2/§13/§15 carry "thay bởi lộ trình v2" notes.

Decisions 3, 5 and 6 were settled on 2026-10-11 under the user's full authority (recorded in roadmap §7):
- (3) Driver order: Modbus → S7 → MC/SLMP → FINS → MQTT → OPC UA, with simulators in CI.
- (5) Remote work goes over a VPN, an SSH tunnel or a port-forward. No ports are opened automatically. The public 9080 viewer stays until GĐ 2.
- (6) The petrol accent and the "m" logo were approved together with the UI.

The Constitution was later amended to 2.0.1 (audit.db runs `synchronous=FULL`).

GĐ 1 split: `specs/004-studio-shell` (new IDE-like Studio frame, migrate Sprint 1 functions; mockup first) and `specs/005-device-online` (discovery, HTTPS, auth/audit, .matscada, download/upload/compare). GĐ 0 = Sprint 1 audit fixes (93 findings of wf_bea101bb-082, only 11 had been verified).

**Why:** the user wants visible progress on v2; the scope change needed a governance record.
**How to apply:** follow the phase order in roadmap §4; pulling a later phase forward needs a user decision recorded in the roadmap. UI work follows [[studio-ui-quality-bar]]; device work follows [[bl335-ssh-access]] rules. Related: [[sprint1-handoff]], [[feature003-status]].
