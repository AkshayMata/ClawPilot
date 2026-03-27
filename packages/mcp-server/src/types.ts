/**
 * Shared types for ClawPilot MCP server.
 * Inlined from @clawpilot/shared so this package is self-contained.
 */

export type SessionId = string;
export type CorrelationId = string;

export enum SessionSource {
  VSCode = "vscode",
  CLI = "cli",
}

export enum NotificationPriority {
  Low = "low",
  Normal = "normal",
  High = "high",
}

export enum SessionStatus {
  Active = "active",
  WaitingForInput = "waiting_for_input",
  Completed = "completed",
  Error = "error",
}

export interface CopilotSession {
  id: SessionId;
  source: SessionSource;
  label: string;
  status: SessionStatus;
  createdAt: string;
  lastActivityAt: string;
}

export interface NotifyPayload {
  sessionId: SessionId;
  message: string;
  priority: NotificationPriority;
  source: SessionSource;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface AskPayload {
  correlationId: CorrelationId;
  sessionId: SessionId;
  question: string;
  source: SessionSource;
  label?: string;
  options?: string[];
  timeoutMs?: number;
}

export interface UserResponse {
  correlationId: CorrelationId;
  sessionId: SessionId;
  response: string;
  respondedAt: string;
}

export interface PendingAsk {
  correlationId: CorrelationId;
  sessionId: SessionId;
  question: string;
  options?: string[];
  askedAt: string;
  timeoutMs: number;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
