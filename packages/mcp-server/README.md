# @clawpilot/mcp-server

MCP server that bridges GitHub Copilot agent sessions with Microsoft Teams.

## Setup

### 1. Start the ClawPilot middleware server

The middleware server (Express.js) handles Teams webhooks and manages sessions. Run it on any machine that's reachable from Teams:

```bash
cd /path/to/ClawPilot
npm install
npm run build
npm start
```

### 2. Configure your repo's `.vscode/mcp.json`

Add the ClawPilot MCP server to any VS Code workspace:

**Option A — Local path (if you have the repo cloned):**
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

**Option B — After npm publish:**
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

### 3. Reload VS Code

After adding `mcp.json`, reload the VS Code window (Ctrl+Shift+P → "Developer: Reload Window"). The 5 MCP tools will appear in Copilot agent mode.

## Tools

| Tool | Description |
|------|-------------|
| `notify_user` | Send a fire-and-forget notification to Teams |
| `ask_user` | Ask a question and block until the user responds |
| `notify_and_wait` | Send notification + wait for @ClawPilot reply (full round-trip) |
| `check_replies` | Drain all pending replies from the inbox |
| `list_sessions` | List all active Copilot sessions |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWPILOT_SERVER_URL` | `http://localhost:3978` | URL of the ClawPilot middleware server |
