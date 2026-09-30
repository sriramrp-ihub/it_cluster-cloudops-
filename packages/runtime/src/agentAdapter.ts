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
  /**
   * "PROGRESS" (added for the live swarm/adaptive-stage progress feature —
   * see packages/runtime/src/swarmProgressPoller.ts) is purely additive: it
   * reports a tool call that has already been persisted to `tool_executions`
   * by a still-in-flight `runHermesOneshotForProfile()`/`executeHermesInference()`
   * call, so operators aren't staring at a static "Running" card for up to
   * `swarmStageTimeoutMs`. It never replaces or redefines STEP/OBSERVATION —
   * any consumer that doesn't know about "PROGRESS" (the historical
   * swarm-trace view, older frontend builds) simply never receives it and
   * keeps working exactly as before.
   */
  type: "STEP" | "OBSERVATION" | "EVIDENCE" | "ROOT_CAUSE" | "PROPOSAL" | "STATUS" | "ERROR" | "PROGRESS";
  sessionId: string;
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface AgentToolCall {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  timestamp: Date;
  /**
   * Phase 3.5: why this specific call is being made right now — persisted
   * verbatim into tool_executions.reasoning_snippet by the executing route,
   * not reconstructed after the fact from the final investigation summary.
   * Optional because not every AgentAdapter has a reasoning narrative to
   * offer for every call (e.g. a raw MCP client-issued call has none).
   */
  reasoning?: string | undefined;
  /** Evidence IDs already collected that informed this call, if any. */
  evidenceRefs?: string[] | undefined;
}

export interface AgentToolResult {
  callId: string;
  status: "SUCCESS" | "AWAITING_APPROVAL" | "ERROR";
  data?: unknown;
  error?: { code: string; message: string } | undefined;
  approvalId?: string | undefined;
}

export interface InvestigationDriveContext {
  cluster?: string | undefined;
  service?: string | undefined;
  region?: string | undefined;
  alertDescription?: string | undefined;
  liveInference?: boolean | undefined;
  /**
   * ADR-0007 Phase C1b: the caller's own outer `runs` row id (created via
   * `RunService.createRun()` BEFORE `runInvestigation()` is invoked), if
   * known — purely optional, additive metadata so a swarm investigation's
   * per-worker/verifier/synthesizer sub-runs can be linked back to it via
   * `runs.parent_run_id`. Every existing caller that never sets this keeps
   * working exactly as before; swarm sub-runs simply get `parent_run_id:
   * null` when it's absent.
   */
  runId?: string | undefined;
}

export interface InvestigationDriveResult {
  status: string;
  rootCause: Record<string, unknown>;
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

  /**
   * Drives one full investigation turn on an already-started session: issues
   * tool calls (via the onToolCall handler), collects evidence, and resolves
   * once a root cause has been synthesized (and, for high-risk findings, a
   * remediation proposal has been submitted for approval).
   */
  runInvestigation(
    sessionId: string,
    context?: InvestigationDriveContext
  ): Promise<InvestigationDriveResult>;
}
