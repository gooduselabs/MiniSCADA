---
name: dev-machine-env
description: "Facts about the Windows dev machine for mAT SCADA (disk space, installed toolchains, Inkscape, quirks) — check before building Studio or rendering SVG"
metadata:
  node_type: memory
  type: reference
  originSessionId: 72c3b746-7604-453a-bba5-daf0e78ff7fb
  modified: 2026-10-10T09:16:19.445Z
---

State as of 2026-10-10 (verify before relying on it):
- Project drive D: is nearly full (~1 GB free); C: has ~40 GB. Put Rust build output on C: via `CARGO_TARGET_DIR=C:\build\mat-studio` (Studio installer ends up in `C:\build\mat-studio\release\bundle\nsis\`).
- Installed: Rust 1.99 MSVC (rustup via winget), Visual Studio 2026 **Insiders** with the C++ workload (MSVC 14.44/14.51, Windows SDK 22621/26100; the user added it themselves), plus VS 2019 Community without C++. vswhere needs `-prerelease` to see the Insiders instance. VS-bundled CMake 4.3.1 + Ninja live under `...\18\Insiders\Common7\IDE\CommonExtensions\Microsoft\CMake` (need vcvars64.bat for `project(C CXX)`).
- Installing system-wide software (e.g. winget VS Build Tools with admin) was blocked by the harness permission classifier — ask the user to install such things themselves.
- Inkscape 1.4.3 at `C:\Program Files\Inkscape\bin\inkscape.exe` (CLI export to PNG works; useful to diff Inkscape vs Chrome rendering). Chrome 154 at the default path is used by puppeteer-core tools.
- Docker Desktop is available; other projects' containers (piano-edtech-*) run there — don't touch them.
- Bash tool quirk: double backslashes inside heredoc/inline scripts get collapsed (`\\` → `\`); write scripts containing regex backslashes with the Write tool instead.
- Bash tool quirk 2 (bit me 4× in Sprint 1): inside `node -e "…"` any backtick or `${…}` is expanded by bash (runs commands!), and `\\n` in JS strings may become a real newline. For file content with backticks/template literals/Markdown code, use Write/Edit, never `node -e` or unquoted heredocs. Also `grep -v` in a `&&` chain returns 1 when it filters everything — append `|| true`.
- Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI: keep Write-Host messages ASCII (Vietnamese comments are fine).
- Public device web: Docker Desktop's port proxy stalls both directions when a client stops reading — do slow-client tests against the real device, not localhost Docker.

Related: [[bl335-ssh-access]]
