---
name: user-full-authority
description: "On 2026-10-11 the user approved the Studio UI and delegated full decision authority — work autonomously, self-evaluate, finish roadmap v2"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 08bc1575-ac24-4f61-bbbb-190542d6abe7
  modified: 2026-10-11T11:10:17.063Z
---

On 2026-10-11 the user said: "tôi check ròi giao diện ok nhé, sau bạn cứ chạy lên tự đánh giá luôn nhé. tôi giao bạn toàn quyền quyết định nhé. hoàn thành giúp tôi nhé".

**Why:** the user does not want to be the bottleneck. Earlier they kept asking "xong chưa?" and did not answer design questions.

**How to apply — decisions:**
- Decide open questions myself: spec/plan questions, roadmap decisions 3/5/6, mockup choices.
- Record each decision and its reason in the spec, plan or ADR, noting "người dùng giao toàn quyền 2026-10-11".

**How to apply — acceptance:**
- Run the software myself (e2e, real Studio exe, x64/armhf, BL335 via web/SSH) and write the acceptance verdict myself. No waiting for user reviews.

**How to apply — commits:**
- Allowed as milestone commits, local only, never push. Each commit should build.

**How to apply — BL335:**
- Allowed: deploying `mat-runtime`, measuring, read-only checks.
- Log every change in `docs/reports/device-changes.md` with an undo command.
- Still never touch `atscada-*` units or `piano-edtech-*` containers.
- Disruptive whole-device actions (reboot, power cuts) still need a person on site or a maintenance window. Flag them instead of doing them silently.
- **2026-10-11:** the auto-mode permission classifier denied even a read-only SSH to BL335 (RS485/serial check). Do not try to work around it.
  - Device steps (005 T055, T158–T165; the GĐ 2 RS485 check) wait until the user adds a permission rule for SSH or runs them.
  - Tell the user which commands are needed.
- See [[bl335-ssh-access]].

**How to apply — pacing:**
- Keep going phase after phase (005 → GĐ 2 … GĐ 6) without asking "should I continue?".
- Give short progress reports.
- Quality bar stays: [[studio-ui-quality-bar]], Constitution, test-first.
