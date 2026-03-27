# ClawPilot — Codebase Inventory for Test Planning

## 1. Project Overview

- **Monorepo name:** `clawpilot` v0.1.0
- **Description:** Bridge GitHub Copilot sessions (VS Code & CLI) with Microsoft Teams
- **Package manager:** npm workspaces
- **Node requirement:** >=18.0.0

### Root package.json scripts

| Script  | Command                            |
|---------|------------------------------------|
| `build` | `npm run build --workspaces`       |
| `clean` | `npm run clean --workspaces`       |
| `start` | `npm run start -w packages/server` |
| `dev`   | `npm run dev -w packages/server`   |
| `lint`  | `eslint packages/*/src/**/*.ts`    |

**No `test` script exists at any level.**

---

## 2. Packages

### 2a. `@clawpilot/shared` (`packages/shared`)

**Purpose:** Shared TypeScript types and enums used by both server and MCP server.

| File            | Exports                                                                                                                                                                                        | Description             |
|-----------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------|
| `src/types.ts`  | `SessionId` (type), `CorrelationId` (type), `SessionSource` (enum), `NotificationPriority` (enum), `SessionStatus` (enum), `CopilotSession` (interface), `NotifyPayload`, `AskPayload`, `UserResponse`, `PendingAsk`, `ApiResponse<T>` | All shared domain types |
| `src/index.ts`  | Re-exports all from `types.ts` — 3 value exports + 8 type exports                                                                                                                             | Barrel file             |

**Dependencies:** None  
**Scripts:** `build`, `clean` only

---

### 2b. `@clawpilot/server` (`packages/server`)

**Purpose:** Express HTTP server — middleware between MCP tools and Teams. Handles notifications, questions, replies, sessions, heartbeat monitoring, and the web-based response UI.

**Dependencies:** `@clawpilot/shared`, `dotenv`, `express@4`, `uuid`  
**Dev deps:** `@types/express`, `@types/uuid`  
**Scripts:** `build`, `clean`, `start`, `dev`

#### Source files

| File                        | Key Exports                                                                 | Description |
|-----------------------------|-----------------------------------------------------------------------------|-------------|
| `src/index.ts`              | *(entry point — no exports)*                                                | Bootstraps Express app; creates `SessionManager`, `MessageQueue`, `ReplyInbox`, `HeartbeatMonitor`; defines `sendNotification()` + `sendQuestion()`; mounts routers; starts server |
| `src/sessions.ts`           | `class SessionManager`                                                     | In-memory session store. Methods: `getOrCreate()`, `updateStatus()`, `get()`, `touch()`, `listAll()`, `remove()` |
| `src/messageQueue.ts`       | `class MessageQueue`                                                       | Correlates ask_user requests with user responses. Methods: `addPending()`, `getPending()`, `listPending()`, `submitResponse()`, `getResponse()`. Auto-expires pending/responses via setTimeout |
| `src/replyInbox.ts`         | `interface InboxReply`, `class ReplyInbox`                                 | Reply inbox for Teams messages. Methods: `add()`, `waitForReply()` (long-poll with AbortSignal), `drain()`, `peek()`, `abortAllPollers()`. Tracks active poller count |
| `src/heartbeat.ts`          | `interface HeartbeatPayload`, `class HeartbeatMonitor`                     | Watchdog that sends Teams alert when agent goes silent. Methods: `start()`, `stop()`, `beat()`, `getStatus()`. Configurable deadline (default 2 min) and check interval (default 30s) |
| `src/webhook.ts`            | `sendTeamsWebhook()`, `getThreadId()`, `clearThreadId()`                   | Sends Adaptive Cards to Teams via webhook. Builds notification + question cards. Manages thread ID for reply threading. Module-level state: `currentThreadId` |
| `src/routes/api.ts`         | `interface RoutesDeps`, `createApiRouter()`                                | Express router: `POST /api/notify`, `POST /api/ask`, `GET /api/ask/:id/response`, `POST /api/respond`, `POST /api/reply`, `GET /api/replies`, `GET /api/replies/peek`, `GET /api/replies/wait`, `GET /api/sessions`, `POST /api/heartbeat`, `GET /api/heartbeat`, `GET /api/health`, `DELETE /api/replies/pollers` |
| `src/routes/outgoingWebhook.ts` | `interface OutgoingWebhookDeps`, `createOutgoingWebhookRouter()`       | Teams outgoing webhook handler (`POST /api/outgoing-webhook`). HMAC validation, AAD identity check, HTML entity decoding, correlation ID extraction from parent message metadata |
| `src/routes/respond.ts`     | `interface RespondRoutesDeps`, `createRespondRouter()`                     | Web UI for responding to questions. `GET /respond/:id` → HTML form; `POST /respond/:id` → accept answer. Helpers: `escapeHtml()`, `renderPage()` |

---

### 2c. `@clawpilot/mcp-server` (`packages/mcp-server`)

**Purpose:** MCP (Model Context Protocol) server — standalone stdio process that GitHub Copilot invokes. Bridges to the Express server via HTTP.

**Dependencies:** `@modelcontextprotocol/sdk`, `zod`  
**Scripts:** `build`, `clean`, `start`  
**Binary:** `clawpilot-mcp` → `dist/index.js`

#### Source files

| File                        | Key Exports       | Description |
|-----------------------------|-------------------|-------------|
| `src/index.ts`              | *(entry point)*   | Creates `McpServer`, registers 5 tools with Zod schemas, connects via `StdioServerTransport` |
| `src/types.ts`              | Same types as `@clawpilot/shared` | Duplicated types — package is self-contained (no dep on shared) |
| `src/tools/notify.ts`       | `notifyUser()`    | `POST /api/notify` — fire-and-forget |
| `src/tools/ask.ts`          | `askUser()`       | `POST /api/ask` + polls `GET /api/ask/:id/response` every 2s until timeout (default 5 min) |
| `src/tools/checkReplies.ts` | `checkReplies()`  | `GET /api/replies` — drains inbox |
| `src/tools/listSessions.ts` | `listSessions()`  | `GET /api/sessions` |
| `src/tools/notifyAndWait.ts`| `notifyAndWait()` | Sends notification, kills zombie pollers, long-polls `/api/replies/wait` (10 min per cycle, 8 hour default deadline) |

---

## 3. Test Infrastructure Status

| Item                             | Status             |
|----------------------------------|--------------------|
| Test files (`.test.ts`, `.spec.ts`) | **None**        |
| Test directories (`__tests__/`, `test/`) | **None**   |
| Test scripts in any `package.json` | **None**         |
| Testing framework deps            | **None installed** |
| Test config files                  | **None**          |

---

## 4. tsconfig Structure

| File                             | Role |
|----------------------------------|------|
| `tsconfig.base.json`            | Base: ES2022 target, Node16 module resolution, strict, composite, declaration + sourceMap |
| `tsconfig.json`                 | Root references: `shared`, `mcp-server`, `server` (also refs `packages/fabric` — doesn't exist) |
| `packages/shared/tsconfig.json` | Extends base, no references |
| `packages/server/tsconfig.json` | Extends base, references `../shared` |
| `packages/mcp-server/tsconfig.json` | Extends base, no references (self-contained) |

---

## 5. Testability Analysis

### Tier 1 — Pure Logic (no mocking needed)

| Class/Module      | Package | Notes |
|-------------------|---------|-------|
| `SessionManager`  | server  | Pure in-memory Map operations. Easy to test all CRUD methods |
| `MessageQueue`    | server  | Map operations + setTimeout auto-expiry. Needs fake timers for expiry tests |
| `ReplyInbox`      | server  | Map + poll loop with AbortSignal. Needs fake timers for `waitForReply()` |
| Shared types/enums | shared | Enum value verification, interface shape validation |

### Tier 2 — Timer-dependent (needs fake timers)

| Class/Module       | Package | Notes |
|--------------------|---------|-------|
| `HeartbeatMonitor` | server  | setInterval-based watchdog. Needs fake timers + mock `sendTeamsWebhook` |
| `MessageQueue` (expiry) | server | setTimeout for auto-expiry of pending asks and responses |
| `ReplyInbox.waitForReply()` | server | setInterval poll loop with configurable timeout |

### Tier 3 — HTTP Handlers (needs supertest or request mocking)

| Router Function                | Package | Notes |
|--------------------------------|---------|-------|
| `createApiRouter()`           | server  | 13 endpoints. Dependencies injected via `RoutesDeps` interface — easy to mock |
| `createRespondRouter()`       | server  | 2 endpoints + HTML rendering. Deps injected via `RespondRoutesDeps` |
| `createOutgoingWebhookRouter()` | server | 1 endpoint. HMAC validation, AAD check, HTML parsing. Deps injected |

### Tier 4 — External HTTP (needs fetch mocking)

| Function           | Package    | Notes |
|--------------------|------------|-------|
| `sendTeamsWebhook()` | server  | Outbound fetch to Teams webhook URL. Module-level `currentThreadId` state |
| `notifyUser()`     | mcp-server | Calls `/api/notify` |
| `askUser()`        | mcp-server | Calls `/api/ask` + polls `/api/ask/:id/response` |
| `checkReplies()`   | mcp-server | Calls `/api/replies` |
| `listSessions()`   | mcp-server | Calls `/api/sessions` |
| `notifyAndWait()`  | mcp-server | Calls `/api/notify` + `/api/health` + `/api/replies/wait` |

### Tier 5 — Integration / E2E

| Scenario | Notes |
|----------|-------|
| Full notify round-trip | MCP tool → server → webhook mock → verify card payload |
| Full ask round-trip | MCP ask → server → webhook mock → simulate response → MCP receives answer |
| Outgoing webhook → reply inbox | Simulate Teams POST with HMAC → verify reply lands in inbox |
| Heartbeat watchdog | Start monitor, let deadline pass, verify alert sent |

### Tier 6 — Sync verification

| Check | Notes |
|-------|-------|
| Type parity | `mcp-server/src/types.ts` vs `shared/src/types.ts` — verify they stay in sync |
