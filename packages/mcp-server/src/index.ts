#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "child_process";
import { resolve } from "path";
import { existsSync } from "fs";
import { notifyUser } from "./tools/notify.js";
import { askUser } from "./tools/ask.js";
import { listSessions } from "./tools/listSessions.js";
import { checkReplies } from "./tools/checkReplies.js";
import { notifyAndWait } from "./tools/notifyAndWait.js";

const CLAWPILOT_SERVER_URL =
  process.env.CLAWPILOT_SERVER_URL ?? "http://localhost:3978";

// ── Auto-start helpers ───────────────────────────────────────
async function isServerHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${CLAWPILOT_SERVER_URL}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function resolveServerEntry(): string | undefined {
  // 1. Monorepo layout: sibling packages/server/
  const distPath = resolve(__dirname, "..", "..", "server", "dist", "index.js");
  if (existsSync(distPath)) return distPath;
  const srcPath = resolve(__dirname, "..", "..", "server", "src", "index.ts");
  if (existsSync(srcPath)) return srcPath;

  // 2. npm-installed: @clawpilot/server in node_modules
  try {
    return require.resolve("@clawpilot/server");
    // Note: only works in monorepo context where @clawpilot/server is a workspace link
  } catch {
    // not installed
  }

  return undefined;
}

async function startServer(): Promise<{ started: boolean; message: string }> {
  if (await isServerHealthy()) {
    return { started: true, message: "HTTP server already running." };
  }

  const entry = resolveServerEntry();
  if (!entry) {
    return {
      started: false,
      message:
        "Cannot find ClawPilot HTTP server. Expected sibling package at packages/server/. " +
        "Start it manually: cd <clawpilot-repo> && npm start",
    };
  }

  const useTsx = entry.endsWith(".ts");
  const command = useTsx ? "npx" : "node";
  const args = useTsx ? ["tsx", entry] : [entry];

  const repoRoot = resolve(__dirname, "..", "..", "..");

  console.error(
    `[ClawPilot] Starting HTTP server: ${command} ${args.join(" ")}`
  );

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    cwd: repoRoot,
    env: { ...process.env },
    shell: process.platform === "win32",
  });
  child.unref();

  // Poll for health up to 30 seconds
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isServerHealthy()) {
      return { started: true, message: "HTTP server started successfully." };
    }
  }

  return {
    started: false,
    message:
      "HTTP server process was spawned but did not become healthy within 30 s. " +
      "Check the ClawPilot server logs for errors.",
  };
}

const server = new McpServer({
  name: "clawpilot",
  version: "0.1.0",
});

// ── notify_user ──────────────────────────────────────────────
server.tool(
  "notify_user",
  "Send a notification to the user in Microsoft Teams. Use this when a task is complete, an error occurred, or you want to provide a status update. The user will see an Adaptive Card in Teams with your message.",
  {
    sessionId: z
      .string()
      .describe(
        "A unique identifier for this Copilot session. Use a consistent ID across calls within the same session."
      ),
    message: z
      .string()
      .describe("The notification message to send to the user."),
    label: z
      .string()
      .optional()
      .describe(
        "Human-friendly label for this session shown in Teams cards, e.g. 'DevBox-1 / ClawPilot' or 'CLI / my-project'. Include machine name and workspace/repo name to help users identify which agent this is."
      ),
    priority: z
      .enum(["low", "normal", "high"])
      .optional()
      .describe("Priority level. 'high' will mention the user in Teams."),
    source: z
      .enum(["vscode", "cli"])
      .optional()
      .describe("Where this session is running. Defaults to 'vscode'."),
  },
  async (args) => {
    const result = await notifyUser(args);
    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? "Notification sent to Teams successfully."
            : "Failed to send notification.",
        },
      ],
    };
  }
);

// ── ask_user ─────────────────────────────────────────────────
server.tool(
  "ask_user",
  "Ask the user a question via Microsoft Teams and wait for their response. Use this when you need input, approval, or clarification. The user will see an Adaptive Card with your question and can type a response or pick from options you provide. This call blocks until the user responds or the timeout expires.",
  {
    sessionId: z
      .string()
      .describe(
        "A unique identifier for this Copilot session."
      ),
    question: z.string().describe("The question to ask the user."),
    label: z
      .string()
      .optional()
      .describe(
        "Human-friendly label for this session shown in Teams cards, e.g. 'DevBox-1 / ClawPilot'."
      ),
    source: z
      .enum(["vscode", "cli"])
      .optional()
      .describe("Where this session is running. Defaults to 'vscode'."),
    options: z
      .array(z.string())
      .optional()
      .describe(
        "Optional list of suggested answers the user can pick from (shown as buttons)."
      ),
    timeoutMs: z
      .number()
      .optional()
      .describe(
        "How long to wait for a response in milliseconds. Defaults to 300000 (5 minutes)."
      ),
  },
  async (args) => {
    const result = await askUser(args);
    return {
      content: [
        {
          type: "text" as const,
          text: `User responded: ${result.response}`,
        },
      ],
    };
  }
);

// ── list_sessions ────────────────────────────────────────────
server.tool(
  "list_sessions",
  "List all active Copilot sessions currently tracked by ClawPilot. Returns session IDs, sources, statuses, and timestamps.",
  {},
  async () => {
    const result = await listSessions();
    return {
      content: [
        {
          type: "text" as const,
          text:
            result.sessions.length === 0
              ? "No active sessions."
              : JSON.stringify(result.sessions, null, 2),
        },
      ],
    };
  }
);

// ── check_replies ────────────────────────────────────────────
server.tool(
  "check_replies",
  "Check for any replies from the Teams channel. Drains the inbox and returns all pending messages sent via @ClawPilot in Teams. Use this to pick up user feedback or responses to notifications.",
  {},
  async () => {
    const result = await checkReplies();
    return {
      content: [
        {
          type: "text" as const,
          text:
            result.replies.length === 0
              ? "No new replies."
              : result.replies
                  .map((r) => `[${r.receivedAt}] ${r.response}`)
                  .join("\n"),
        },
      ],
    };
  }
);

// ── notify_and_wait ──────────────────────────────────────────
server.tool(
  "notify_and_wait",
  "Send a notification to the user in Teams and wait for them to reply via @ClawPilot in the channel. This is the full round-trip: sends notification, polls for a reply, and returns the user's response. Use this when you need acknowledgement or feedback on a notification.",
  {
    sessionId: z
      .string()
      .describe("A unique identifier for this Copilot session."),
    message: z
      .string()
      .describe("The notification message to send to the user."),
    label: z
      .string()
      .optional()
      .describe(
        "Human-friendly label for this session shown in Teams cards, e.g. 'DevBox-1 / ClawPilot'."
      ),
    priority: z
      .enum(["low", "normal", "high"])
      .optional()
      .describe("Priority level."),
    source: z
      .enum(["vscode", "cli"])
      .optional()
      .describe("Where this session is running."),
    timeoutMs: z
      .number()
      .optional()
      .describe(
        "How long to wait for a reply in milliseconds. Defaults to 300000 (5 minutes)."
      ),
  },
  async (args) => {
    const result = await notifyAndWait(args);
    return {
      content: [
        {
          type: "text" as const,
          text: result.timedOut
            ? "Notification sent but no reply received before timeout."
            : `User replied: ${result.response}`,
        },
      ],
    };
  }
);

// ── start_server ─────────────────────────────────────────────
server.tool(
  "start_server",
  "Start (or restart) the ClawPilot HTTP server if it is not running. " +
    "The server is normally auto-started when this MCP process launches, " +
    "but call this tool if tool calls are failing with connection errors.",
  {},
  async () => {
    const result = await startServer();
    return {
      content: [
        {
          type: "text" as const,
          text: result.message,
        },
      ],
    };
  }
);

// ── Start ────────────────────────────────────────────────────
async function main() {
  // Auto-start the HTTP server if it's not already running
  const { started, message } = await startServer();
  console.error(`[ClawPilot] ${message}`);
  if (!started) {
    console.error(
      "[ClawPilot] Warning: HTTP server is not running — tool calls will fail until it is started."
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("ClawPilot MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
