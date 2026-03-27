/** Unique identifier for a Copilot agent session */
export type SessionId = string;

/** Unique identifier for a message/correlation */
export type CorrelationId = string;

/** The source of a Copilot session */
export enum SessionSource {
  VSCode = "vscode",
  CLI = "cli",
}

/** Priority levels for notifications */
export enum NotificationPriority {
  Low = "low",
  Normal = "normal",
  High = "high",
}

/** Status of a Copilot session */
export enum SessionStatus {
  Active = "active",
  WaitingForInput = "waiting_for_input",
  Completed = "completed",
  Error = "error",
}

/** A tracked Copilot agent session */
export interface CopilotSession {
  id: SessionId;
  source: SessionSource;
  label: string;
  status: SessionStatus;
  createdAt: string;
  lastActivityAt: string;
}

/** Payload sent from MCP server → middleware for notify_user */
export interface NotifyPayload {
  sessionId: SessionId;
  message: string;
  priority: NotificationPriority;
  source: SessionSource;
  /** Human-friendly label for this session (e.g. "DevBox-1 / ClawPilot") */
  label?: string;
  /** Optional structured data (e.g., file diffs, errors) */
  metadata?: Record<string, unknown>;
}

/** Payload sent from MCP server → middleware for ask_user */
export interface AskPayload {
  correlationId: CorrelationId;
  sessionId: SessionId;
  question: string;
  source: SessionSource;
  /** Human-friendly label for this session */
  label?: string;
  /** Suggested options the user can pick from */
  options?: string[];
  /** Timeout in ms before the ask expires (default: 5 min) */
  timeoutMs?: number;
}

/** Response from the user (Teams → middleware → MCP server) */
export interface UserResponse {
  correlationId: CorrelationId;
  sessionId: SessionId;
  response: string;
  respondedAt: string;
}

/** Shape of a pending ask waiting for user response */
export interface PendingAsk {
  correlationId: CorrelationId;
  sessionId: SessionId;
  question: string;
  options?: string[];
  askedAt: string;
  timeoutMs: number;
}

/** API response envelope */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
