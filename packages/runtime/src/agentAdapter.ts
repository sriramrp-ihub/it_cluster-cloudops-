import type { AgentId, TenantId } from "@cloudops/shared";

export type AgentSessionStatus =
  | "ACTIVE"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "TERMINATED";

export interface AgentExecutionContext {
  tenantId: TenantId | string;
  agentId: AgentId | string;
  scenarioId?: string | undefined;
  incidentContext?: Record<string, unknown> | undefined;
  grantedCapabilities?: string[] | undefined;
}

export interface AgentSession {
  sessionId: string;
  agentId: string;
  tenantId: string;
  status: AgentSessionStatus;
  startedAt: Date;
  terminatedAt?: Date | null | undefined;
  disconnectReason?: string | null | undefined;
  currentStep?: number | undefined;
  evidenceCollected?: string[] | undefined;
  pendingApprovalId?: string | null | undefined;
}

export interface AgentEvent {
  type: "STEP" | "OBSERVATION" | "EVIDENCE" | "ROOT_CAUSE" | "PROPOSAL" | "STATUS" | "ERROR";
  sessionId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface AgentToolCall {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  timestamp: Date;
}

export interface AgentToolResult {
  callId: string;
  status: "SUCCESS" | "AWAITING_APPROVAL" | "ERROR";
  data?: unknown;
  error?: { code: string; message: string } | undefined;
  approvalId?: string | undefined;
}

/**
 * Common Agent Adapter Interface.
 * Encapsulates agent lifecycle, event streaming, and tool execution.
 * Kept strictly free of agent-specific SDK imports or assumptions.
 */
export interface AgentAdapter {
  readonly adapterType: string;
  readonly protocol: "acp" | "mcp";

  start(context: AgentExecutionContext): Promise<AgentSession>;
  onEvent(sessionId: string, callback: (event: AgentEvent) => void): () => void;
  onToolCall(
    sessionId: string,
    callback: (call: AgentToolCall) => Promise<AgentToolResult>
  ): () => void;
  terminate(sessionId: string, reason: string): Promise<void>;
  getSession(sessionId: string): AgentSession | undefined;
}
