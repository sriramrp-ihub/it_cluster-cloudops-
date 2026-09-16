import { describe, it, expect, vi } from "vitest";
import { MockAgentAdapter, type AgentEvent } from "@cloudops/runtime";
import { ValidationError, NotFoundError } from "@cloudops/shared";

describe("MockAgentAdapter Lifecycle and Fixtures (CO-001 & Step 0.5)", () => {
  const tenantId = "ten_mock_test";
  const agentId = "ag_mock_001";

  it("1. Successfully starts a session and emits initial status event", async () => {
    const adapter = new MockAgentAdapter();
    const events: AgentEvent[] = [];

    const session = await adapter.start({ tenantId, agentId });
    expect(session.sessionId).toMatch(/^sess_/);
    expect(session.status).toBe("ACTIVE");
    expect(session.tenantId).toBe(tenantId);
    expect(session.agentId).toBe(agentId);

    adapter.onEvent(session.sessionId, (e) => events.push(e));

    const retrieved = adapter.getSession(session.sessionId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.status).toBe("ACTIVE");
  });

  it("2. Fails closed if tenantId or agentId is missing", async () => {
    const adapter = new MockAgentAdapter();
    await expect(adapter.start({ tenantId: "", agentId })).rejects.toThrow(ValidationError);
    await expect(adapter.start({ tenantId, agentId: "" })).rejects.toThrow(ValidationError);
  });

  it("3. Drives full ECS investigation sequence and outputs ground-truth root cause", async () => {
    const adapter = new MockAgentAdapter();
    const session = await adapter.start({ tenantId, agentId });

    const capturedSteps: number[] = [];
    const capturedEvidence: string[] = [];

    adapter.onEvent(session.sessionId, (e) => {
      if (e.type === "STEP") capturedSteps.push(e.data.step as number);
      if (e.type === "EVIDENCE") capturedEvidence.push(e.data.evidenceId as string);
    });

    const rootCause = await adapter.runInvestigation(session.sessionId);

    // Verify all 6 steps executed in order
    expect(capturedSteps).toEqual([1, 2, 3, 4, 5, 6]);
    expect(capturedEvidence).toContain("ev_ecs_stopped_task_error");
    expect(capturedEvidence).toContain("ev_ecr_tag_missing");
    expect(capturedEvidence).toContain("ev_alb_targets_unhealthy");

    // Verify root cause output matches ground truth
    expect(rootCause.type).toBe("root_cause_analysis");
    expect(rootCause.finding).toBe("ContainerImageNotFound");
    expect(rootCause.confidence).toBeGreaterThanOrEqual(0.95);
    expect(session.status).toBe("COMPLETED");
  });

  it("4. Proposes remediation and handles AWAITING_APPROVAL state transition", async () => {
    const adapter = new MockAgentAdapter();
    const session = await adapter.start({ tenantId, agentId });

    const proposalResult = await adapter.proposeRemediation(session.sessionId);

    expect(proposalResult.status).toBe("AWAITING_APPROVAL");
    expect(proposalResult.approvalId).toBeDefined();
    expect(session.status).toBe("WAITING_APPROVAL");
    expect(session.pendingApprovalId).toBe(proposalResult.approvalId);
  });

  it("5. Correctly handles all four terminal approval outcomes (EXECUTED, EXECUTION_FAILED, EXPIRED, REJECTED)", async () => {
    const adapter = new MockAgentAdapter();

    // 5a. EXECUTED
    const s1 = await adapter.start({ tenantId, agentId });
    await adapter.proposeRemediation(s1.sessionId);
    const reaction1 = await adapter.handleApprovalOutcome(s1.sessionId, "EXECUTED");
    expect(s1.status).toBe("COMPLETED");
    expect(reaction1).toContain("post-remediation verification");

    // 5b. EXECUTION_FAILED
    const s2 = await adapter.start({ tenantId, agentId });
    await adapter.proposeRemediation(s2.sessionId);
    const reaction2 = await adapter.handleApprovalOutcome(s2.sessionId, "EXECUTION_FAILED");
    expect(s2.status).toBe("FAILED");
    expect(reaction2).toContain("escalate permission fault");

    // 5c. EXPIRED
    const s3 = await adapter.start({ tenantId, agentId });
    await adapter.proposeRemediation(s3.sessionId);
    const reaction3 = await adapter.handleApprovalOutcome(s3.sessionId, "EXPIRED");
    expect(s3.status).toBe("TERMINATED");
    expect(reaction3).toContain("Abandon pending remediation");

    // 5d. REJECTED
    const s4 = await adapter.start({ tenantId, agentId });
    await adapter.proposeRemediation(s4.sessionId);
    const reaction4 = await adapter.handleApprovalOutcome(s4.sessionId, "REJECTED");
    expect(s4.status).toBe("TERMINATED");
    expect(reaction4).toContain("cease mutating actions");
  });

  it("6. Explicitly terminates session with specified reason", async () => {
    const adapter = new MockAgentAdapter();
    const session = await adapter.start({ tenantId, agentId });

    await adapter.terminate(session.sessionId, "OPERATOR_OVERRIDE");
    expect(session.status).toBe("TERMINATED");
    expect(session.disconnectReason).toBe("OPERATOR_OVERRIDE");
    expect(session.terminatedAt).toBeDefined();
  });
});
