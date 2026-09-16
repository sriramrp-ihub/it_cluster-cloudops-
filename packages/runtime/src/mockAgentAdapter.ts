import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentAdapter,
  type AgentExecutionContext,
  type AgentSession,
  type AgentEvent,
  type AgentToolCall,
  type AgentToolResult
} from "./agentAdapter.js";
import {
  ValidationError,
  NotFoundError,
  validateIncidentContext
} from "@cloudops/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MockAgentConfig {
  fixturesDir?: string | undefined;
  simulatedLatencyMs?: number | undefined;
}

export class MockAgentAdapter implements AgentAdapter {
  readonly adapterType = "mock-agent";
  readonly protocol = "acp" as const;

  private sessions = new Map<string, AgentSession>();
  private eventListeners = new Map<string, Set<(event: AgentEvent) => void>>();
  private toolCallHandlers = new Map<
    string,
    (call: AgentToolCall) => Promise<AgentToolResult>
  >();
  private fixturesDir: string;
  private latencyMs: number;

  constructor(config: MockAgentConfig = {}) {
    this.fixturesDir =
      config.fixturesDir ||
      path.resolve(__dirname, "../fixtures");
    this.latencyMs = config.simulatedLatencyMs ?? 0;
  }

  async start(context: AgentExecutionContext): Promise<AgentSession> {
    if (!context.tenantId) {
      throw new ValidationError("Cannot start agent session: tenantId is required");
    }
    if (!context.agentId) {
      throw new ValidationError("Cannot start agent session: agentId is required");
    }

    if (context.incidentContext !== undefined) {
      const validation = validateIncidentContext(context.incidentContext);
      if (!validation.valid) {
        throw new ValidationError(`Invalid incident context: ${validation.errors?.join("; ")}`);
      }
    } else if (
      context.scenarioId === "investigation" ||
      context.scenarioId === "ecs-image-pull-failure"
    ) {
      throw new ValidationError("Investigation scenario requires a valid incidentContext");
    }

    const sessionId = `sess_${randomUUID()}`;
    const session: AgentSession = {
      sessionId,
      agentId: context.agentId,
      tenantId: context.tenantId,
      status: "ACTIVE",
      startedAt: new Date(),
      currentStep: 0,
      evidenceCollected: []
    };

    this.sessions.set(sessionId, session);
    this.eventListeners.set(sessionId, new Set());

    this.emitEvent(sessionId, {
      type: "STATUS",
      sessionId,
      timestamp: new Date(),
      data: { status: "ACTIVE", message: "Mock Agent session initialized" }
    });

    return session;
  }

  onEvent(sessionId: string, callback: (event: AgentEvent) => void): () => void {
    const listeners = this.eventListeners.get(sessionId);
    if (!listeners) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  }

  onToolCall(
    sessionId: string,
    callback: (call: AgentToolCall) => Promise<AgentToolResult>
  ): () => void {
    this.toolCallHandlers.set(sessionId, callback);
    return () => {
      this.toolCallHandlers.delete(sessionId);
    };
  }

  async terminate(sessionId: string, reason: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundError(`Session not found: ${sessionId}`);
    }

    session.status = "TERMINATED";
    session.terminatedAt = new Date();
    session.disconnectReason = reason;

    this.emitEvent(sessionId, {
      type: "STATUS",
      sessionId,
      timestamp: new Date(),
      data: { status: "TERMINATED", reason }
    });
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Drives the full deterministic investigation scenario from the fixture.
   */
  async runInvestigation(sessionId: string): Promise<Record<string, unknown>> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`Session ${sessionId} not found`);

    const fixturePath = path.join(this.fixturesDir, "investigation-ecs-scenario.json");
    const fixtureData = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const toolCallHandler = this.toolCallHandlers.get(sessionId);

    for (const step of fixtureData.toolCallSequence) {
      if (this.latencyMs > 0) {
        await new Promise((r) => setTimeout(r, this.latencyMs));
      }

      session.currentStep = step.step;

      this.emitEvent(sessionId, {
        type: "STEP",
        sessionId,
        timestamp: new Date(),
        data: { step: step.step, toolName: step.toolName }
      });

      let toolResult: AgentToolResult;
      if (toolCallHandler) {
        const callId = `call_${randomUUID()}`;
        toolResult = await toolCallHandler({
          callId,
          toolName: step.toolName,
          arguments: step.arguments,
          timestamp: new Date()
        });
      } else {
        toolResult = {
          callId: `call_${randomUUID()}`,
          status: "SUCCESS",
          data: { observation: step.expectedObservation }
        };
      }

      session.evidenceCollected?.push(step.evidenceId);

      this.emitEvent(sessionId, {
        type: "EVIDENCE",
        sessionId,
        timestamp: new Date(),
        data: {
          evidenceId: step.evidenceId,
          observation: step.expectedObservation,
          result: toolResult.data
        }
      });
    }

    session.status = "COMPLETED";

    const rootCause = fixtureData.expectedRootCause;
    this.emitEvent(sessionId, {
      type: "ROOT_CAUSE",
      sessionId,
      timestamp: new Date(),
      data: rootCause
    });

    return rootCause;
  }

  /**
   * Proposes a mutating remediation action and expects AWAITING_APPROVAL.
   */
  async proposeRemediation(sessionId: string): Promise<AgentToolResult> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`Session ${sessionId} not found`);

    const fixturePath = path.join(this.fixturesDir, "remediation-proposal.json");
    const fixtureData = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const toolCallHandler = this.toolCallHandlers.get(sessionId);

    const callId = `call_${randomUUID()}`;
    const call: AgentToolCall = {
      callId,
      toolName: fixtureData.proposal.toolName,
      arguments: fixtureData.proposal.arguments,
      timestamp: new Date()
    };

    let result: AgentToolResult;
    if (toolCallHandler) {
      result = await toolCallHandler(call);
    } else {
      result = {
        callId,
        status: "AWAITING_APPROVAL",
        approvalId: fixtureData.initialGatewayResponse.approvalId,
        data: fixtureData.initialGatewayResponse
      };
    }

    if (result.status === "AWAITING_APPROVAL") {
      session.status = "WAITING_APPROVAL";
      session.pendingApprovalId = result.approvalId;
    }

    this.emitEvent(sessionId, {
      type: "PROPOSAL",
      sessionId,
      timestamp: new Date(),
      data: {
        toolName: call.toolName,
        status: result.status,
        approvalId: result.approvalId,
        dryRunDiff: (result.data as any)?.dryRunDiff
      }
    });

    return result;
  }

  /**
   * Simulates agent reaction to one of the four terminal approval outcomes.
   */
  async handleApprovalOutcome(
    sessionId: string,
    outcome: "EXECUTED" | "EXECUTION_FAILED" | "EXPIRED" | "REJECTED"
  ): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundError(`Session ${sessionId} not found`);

    const fixturePath = path.join(this.fixturesDir, "approval-outcomes.json");
    const fixtureData = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const outcomeData = fixtureData.outcomes[outcome];

    if (!outcomeData) {
      throw new ValidationError(`Unknown outcome: ${outcome}`);
    }

    if (outcome === "EXECUTED") {
      session.status = "COMPLETED";
      session.pendingApprovalId = null;
    } else if (outcome === "EXECUTION_FAILED") {
      session.status = "FAILED";
    } else if (outcome === "EXPIRED" || outcome === "REJECTED") {
      session.status = "TERMINATED";
      session.disconnectReason = outcomeData.rejectionReason || outcomeData.errorMessage;
    }

    this.emitEvent(sessionId, {
      type: "STATUS",
      sessionId,
      timestamp: new Date(),
      data: {
        outcome,
        reaction: outcomeData.agentReaction,
        details: outcomeData
      }
    });

    return outcomeData.agentReaction;
  }

  private emitEvent(sessionId: string, event: AgentEvent): void {
    const listeners = this.eventListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (err) {
          console.error(`Error in event listener for session ${sessionId}:`, err);
        }
      }
    }
  }
}
