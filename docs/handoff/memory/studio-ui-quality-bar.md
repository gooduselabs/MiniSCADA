---
name: studio-ui-quality-bar
description: User rejects plain form-style UI for mAT Studio; expects a polished IDE-like engineering tool modeled on TIA Portal
metadata:
  node_type: memory
  type: feedback
  originSessionId: 08bc1575-ac24-4f61-bbbb-190542d6abe7
  modified: 2026-10-10T10:49:27.714Z
---

The user called the Sprint 1 Studio (one page, 5 tabs of forms) "too ugly, too basic" and asked to learn UI design from TIA Portal and similar tools.

**Why:** Studio is the product's face for automation engineers who are used to TIA Portal / WinCC / Ignition; a bare form looks unprofessional.
**How to apply:** for any Studio UI work, follow `docs/architecture/studio-ux.md` (project tree, tabbed editors, inspector, task cards, status bar, online mode with orange frame, Accessible-devices / Download-preview / Compare flows, design tokens, light+dark themes). Prefer showing a mockup before building a new layout. Related: [[roadmap-v2-proposal]].
