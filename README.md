# ClawPilot 🦀🤖

**Bridge GitHub Copilot agent sessions with Microsoft Teams.**

When Copilot finishes a task, hits an error, or needs your input — you get a Teams message. Reply directly in Teams via `@ClawPilot`, and your answer flows back into the Copilot session. No tab switching needed.

```
┌─────────────────┐  MCP (stdio)  ┌──────────────┐  Adaptive Card  ┌───────────┐
│  GitHub Copilot  │ ◄───────────► │  ClawPilot   │ ──────────────► │  Teams    │
│  (VS Code / CLI) │               │  Middleware   │                 │  Channel  │
└─────────────────┘               └──────┬───────┘                 └─────┬─────┘
                                         │  @ClawPilot reply             │
                                         │◄──────────────────────────────┘
```

## Features

- **Notifications** — Copilot sends status updates, errors, and task completions to Teams
- **Questions** — Copilot asks for input; you respond from any device via Teams or a web form
- **Round-trip messaging** — `notify_and_wait` sends a notification and blocks until you `@ClawPilot` with a reply
- **Heartbeat watchdog** — Detects when the agent goes silent and alerts you in Teams
- **AAD identity auth** — Only the logged-in machine user can send commands (auto-detected via `az cli`)
- **Multi-agent support** — Each machine instance gets its own `AGENT_NAME` and callback URL

## Quick Start

### Prerequisites

- **Node.js 18+**
- **VS Code** (for Copilot agent mode and dev tunnels)
- **devtunnel CLI** — installed automatically on first run, or manually: `winget install Microsoft.devtunnel`
  - One-time login: `devtunnel user login`
- A **Microsoft Teams** channel
- **Azure CLI** (`az`) signed in (optional, for AAD identity auth)

### 1. Clone & install

```bash
git clone https://github.com/AkshayMata/ClawPilot.git
cd ClawPilot
npm install
npm run build
```

### 2. Set up Power Automate webhook (outbound: server → Teams)

This is how ClawPilot sends notifications to your Teams channel.

1. Open [Power Automate](https://make.powerautomate.com/) → **Create** → **Instant cloud flow**
2. Trigger: **When a HTTP request is received**
   - Method: POST
   - Add a sample JSON body so it generates the schema:
     ```json
     { "type": "message", "attachments": [{ "contentType": "string", "content": {} }] }
     ```
3. Add action: **Post card in a chat or channel** (Microsoft Teams)
   - Post as: Flow bot
   - Post in: Channel
   - Team & Channel: *your ClawPilot channel*
   - Card: Select the `attachments` array from dynamic content
4. **Save** the flow → copy the **HTTP POST URL** from the trigger

### 3. Set up Teams outgoing webhook (inbound: Teams → server)

This is how replies from `@ClawPilot` in Teams reach your server.

1. Open Teams → go to the team that has your channel
2. Click **•••** next to the team name → **Manage team** → **Apps**
3. Bottom-right corner → **Create an outgoing webhook**
4. Name: `ClawPilot` — Description: anything
5. Callback URL: `https://<your-public-url>/api/outgoing-webhook`
   - You need a dev tunnel for this (see step 5 below)
6. **Create** → copy the **HMAC security token**

### 4. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
AGENT_NAME=DevBox-1
TEAMS_WEBHOOK_URL=https://prod-XX.westus.logic.azure.com:443/workflows/...
OUTGOING_WEBHOOK_SECRET=<paste HMAC token from step 3>
```

> **Note:** You do NOT need to set `PUBLIC_URL`. The server auto-provisions a dev tunnel on startup.
> If you prefer a manual tunnel, set `PUBLIC_URL` in `.env` and the server will use it instead.

### 5. Start the server

```bash
npm start
```

The server will:
1. Auto-start a **devtunnel** on port 3978 (public URL printed in console)
2. If devtunnel isn't installed, attempt `winget install Microsoft.devtunnel`
3. If that fails, fall back to `PUBLIC_URL` from `.env`
4. If nothing works, print clear setup instructions

Verify it's running: `http://localhost:3978/api/health`

> **First time?** Run `devtunnel user login` once before starting the server.

### 6. Test it

In VS Code agent mode, try: *"Use notify_user to send me a test message in Teams"*

## Adding ClawPilot to Another Repo

You don't need to clone ClawPilot into every repo. Just point the MCP config to the built server.

### Option A — Local path (recommended)

Create `.vscode/mcp.json` in your other repo:

```json
{
  "servers": {
    "clawpilot": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/ClawPilot/packages/mcp-server/dist/index.js"],
      "env": {
        "CLAWPILOT_SERVER_URL": "http://localhost:3978"
      }
    }
  }
}
```

### Option B — After npm publish

```json
{
  "servers": {
    "clawpilot": {
      "type": "stdio",
      "command": "npx",
      "args": ["@clawpilot/mcp-server"],
      "env": {
        "CLAWPILOT_SERVER_URL": "http://localhost:3978"
      }
    }
  }
}
```

### For Copilot CLI

Copy `mcp-config.example.json` to `~/.github/copilot/mcp.json` and update the path.

### Add agent instructions (optional but recommended)

Copy [`.github/copilot-instructions.md`](.github/copilot-instructions.md) into your repo's `.github/` folder. This tells the agent to:
- Send an immediate acknowledgment when starting a task
- Send periodic progress updates via Teams
- Always end with `notify_and_wait` so you can reply from Teams
- Run tests after every code change

## Project Structure

```
ClawPilot/
├── packages/
│   ├── shared/          # Shared TypeScript types and interfaces
│   ├── mcp-server/      # MCP server (Copilot-facing, self-contained)
│   └── server/          # Express middleware + webhook sender + heartbeat
├── .vscode/mcp.json     # MCP server registration for VS Code
├── .github/copilot-instructions.md  # Agent behavior rules
├── mcp-config.example.json          # MCP config template for CLI
├── .env.example         # Environment variable template
├── vitest.config.ts     # Test configuration
└── package.json         # Monorepo workspace root
```

## MCP Tools Reference

### `notify_user`
Send a fire-and-forget notification to Teams.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | yes | Unique session identifier |
| `message` | string | yes | Notification text |
| `label` | string | no | Human-friendly session label (e.g. "DevBox-1 / ClawPilot") — shown in Teams cards |
| `priority` | `low` \| `normal` \| `high` | no | Priority level (default: normal) |
| `source` | `vscode` \| `cli` | no | Session source (default: vscode) |

### `ask_user`
Ask a question and block until the user responds in Teams.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | yes | Unique session identifier |
| `question` | string | yes | The question to ask |
| `label` | string | no | Human-friendly session label |
| `options` | string[] | no | Quick-reply button labels |
| `timeoutMs` | number | no | Timeout in ms (default: 300000 = 5 min) |
| `source` | `vscode` \| `cli` | no | Session source (default: vscode) |

### `notify_and_wait`
Send a notification and wait for a reply via @ClawPilot in the channel. Full round-trip.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | yes | Unique session identifier |
| `message` | string | yes | Notification text |
| `label` | string | no | Human-friendly session label |
| `priority` | `low` \| `normal` \| `high` | no | Priority level |
| `timeoutMs` | number | no | How long to wait for reply (default: 8 hours) |
| `source` | `vscode` \| `cli` | no | Session source |

### `check_replies`
Drain all pending replies from the inbox. No parameters.

### `list_sessions`
List all active Copilot sessions. No parameters.

## Testing

```bash
npm test             # Run all tests
npm run test:watch   # Watch mode
npm run test:coverage # Coverage report
```

134 tests across 14 files covering all packages.

## Roadmap

- [ ] Message threading (single thread per agent session)
- [ ] npm publish for `@clawpilot/mcp-server`
- [ ] Rich file diff views in response UI
- [ ] Multi-tenant support

## Troubleshooting

### "Sorry, there was a problem encountered with your request"

This usually means Teams can't reach your server via the outgoing webhook.

1. **Dev tunnel not running** — In VS Code: `Ctrl+Shift+P` → "Forward a Port" → port `3978`
2. **Dev tunnel not public** — Right-click the forwarded port → set visibility to **Public**
3. **Outgoing webhook URL wrong** — The callback URL in Teams must be `https://<your-tunnel>/api/outgoing-webhook` (not just the root)
4. **Outgoing webhook not added to channel** — Go to the Teams channel → Apps → find your outgoing webhook and make sure it's installed in the **standard channel** (not a private channel or group chat)
5. **Server not running** — Run `npm start` or check `http://localhost:3978/api/health`

### Power Automate flow suspended

Flows get suspended after inactivity or errors. Go to [Power Automate](https://make.powerautomate.com/) → My Flows → find the ClawPilot flow → **Turn on**.

### Outgoing webhook HMAC mismatch

If you recreated the outgoing webhook, the secret changed. Update `OUTGOING_WEBHOOK_SECRET` in `.env` with the new value and restart the server.

### Notifications not appearing in Teams

1. Check that `TEAMS_WEBHOOK_URL` in `.env` is correct and the flow is active
2. Test with: `curl -X POST http://localhost:3978/api/notify -H "Content-Type: application/json" -d '{"sessionId":"test","message":"hello","priority":"normal","source":"vscode"}'`
3. Check server logs for `[Webhook] POST failed` errors

### Agent appears stuck / no heartbeat

The server monitors agent heartbeats. If the agent goes silent for >2 minutes, a Teams notification is sent automatically. Common causes:
- VS Code interrupted the Copilot session (long-running task timeout)
- Terminal command hung
- Network disconnection

The agent will send a "back online" notification when it reconnects.

### Replies from Teams not reaching the agent

1. Make sure you're @mentioning **@ClawPilot** in the standard channel (not a DM or private channel)
2. Verify the dev tunnel is public and forwarding to port 3978
3. Check `http://localhost:3978/api/replies/peek` to see if replies are in the inbox
4. Outgoing webhooks only work in **standard channels** — not private channels or group chats

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run `npm test` — all tests must pass
5. Submit a PR

## License

MIT
