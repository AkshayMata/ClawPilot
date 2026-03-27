# ClawPilot Workspace Instructions

## Teams Communication (MANDATORY)

Use the ClawPilot MCP tools for all Teams communication. The MCP server is registered in `.vscode/mcp.json`.

### Immediate acknowledgment (MANDATORY)

When the user gives you a task, **immediately** send a `mcp_clawpilot_notify_user` before doing any work:
```
mcp_clawpilot_notify_user: "On it — [brief description of what you're about to do]."
```
This tells the user you received the task and aren't stuck.

### After every action → `notify_and_wait`

After completing **every** user-facing action (code changes, builds, restarts, tests, config updates, etc.), call `mcp_clawpilot_notify_and_wait` as the **final step** to:
1. Send a summary notification to Teams
2. Wait for the user's reply via @ClawPilot

**Parameters to always include:**
- `sessionId`: `"copilot-agent"`
- `message`: Concise 1-3 sentence summary of what was done
- `label`: `"DevBox-1 / ClawPilot"`
- `source`: `"vscode"`
- `timeoutMs`: `300000` (5 minutes) for routine updates, `600000` (10 minutes) if waiting for user input

### Fire-and-forget notifications → `notify_user`

Use `mcp_clawpilot_notify_user` for intermediate status updates where you don't need a reply (e.g. "build started, will notify when done").

### Periodic progress updates (MANDATORY)

During multi-step work (implementing features, writing tests, debugging, refactoring), send `mcp_clawpilot_notify_user` updates **every 2-3 actions** so the user always knows what's happening from Teams. Examples:
- "Starting task: writing 9 test files for full coverage"
- "Progress: 5/9 test files written, moving to MCP tools tests"
- "All tests written, running `vitest run` now..."
- "134/134 tests pass. Summarizing results."

**The user may be away from the machine and relies on Teams to track progress.** If the agent is silent for more than a few minutes, the user has no visibility. Proactive updates prevent this.

### Checking for missed replies → `check_replies`

If you suspect a reply was missed or you need to check the inbox, call `mcp_clawpilot_check_replies`.

### Rules
- **ALWAYS** send an immediate acknowledgment when starting a task
- **ALWAYS** end your turn with `notify_and_wait` — the user relies on Teams for awareness and replies
- **ALWAYS** run `npx vitest run` after code changes and report pass/fail in your notification
- Keep messages concise — 1-3 sentences summarizing what changed
- If the MCP tool fails (server not running), mention it to the user but don't block on it
- Do NOT skip the final `notify_and_wait` — this is how the user communicates with the agent

## Heartbeat & Pre-flight Warnings

### Background heartbeat
At the start of every session, start a background terminal heartbeat loop:
```powershell
while ($true) { try { Invoke-RestMethod -Uri http://localhost:3978/api/heartbeat -Method Post -ContentType "application/json" -Body '{"status":"active"}' -TimeoutSec 5 | Out-Null } catch { }; Start-Sleep -Seconds 30 }
```
This keeps the watchdog happy. If the agent goes silent for 2 minutes, the server auto-notifies Teams.

### Pre-flight warnings
Before starting any long-running operation (builds, installs, large refactors), send a fire-and-forget notification:
```
mcp_clawpilot_notify_user: "Starting long operation: [description]. If I go quiet, this is probably why."
```
