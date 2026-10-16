---
name: sprint1-handoff
description: "Where Sprint 1 (002-vertical-slice) stands: dev work closed in GĐ 0 on 2026-10-11 (audit fully handled); only user/device items remain"
metadata:
  node_type: memory
  type: project
  originSessionId: 08bc1575-ac24-4f61-bbbb-190542d6abe7
  modified: 2026-10-11T05:00:04.601Z
---

Sprint 1 handoff lives in the repo at `docs/handoff/sprint1.md`. It has an "Cập nhật 2026-10-11 (GĐ 0)" block at the top.

**Done on 2026-10-11 (GĐ 0 of roadmap v2):**
- All 93 findings of the completeness-audit workflow `wf_bea101bb-082` were verified and handled. The workflow had stopped with only 11 verified; a two-agent pass finished the rest.
- T063 `startup_test`, CivetWeb transport tests, validator parity, the live-client gap fix, and the Studio form key-order fix are done; `ci-local.ps1` is green.

**Still open, all needing the user:**
- T078: Chrome on ≥ 2 machines.
- T088: Studio GUI run.
- T074: reboot BL335.
- One real `rollback.sh` run.
- Confirming the SC-006 downgrade to "Đạt một phần".

**Why:** the next session must not redo the audit, and must not treat the user items as done.
**How to apply:** for current v2 work read [[v2-gd1-status]] first. Device access: [[bl335-ssh-access]]; machine quirks: [[dev-machine-env]].
