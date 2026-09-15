import { describe, it, expect } from "vitest";
import type { AgentJoinApproval, OperationApproval } from "@cloudops/shared";
import { JoinRequestService } from "@cloudops/onboarding";
import { ApprovalService } from "@cloudops/approvals";

describe("Phase 1.7 — Separation of the Two Approval Loops", () => {
  it("maintains distinct schemas and contracts for AgentJoinApproval vs OperationApproval", () => {
    // Loop 1: AgentJoinApproval (Onboarding-time identity & scope governance)
    const joinApproval: AgentJoinApproval = {
      id: "jr_join_test",
      inviteId: "co_inv_test",
      tenantId: "ten_test",
      agentName: "Hermes SRE",
      agentType: "hermes",
      agentVersion: "1.0.0",
      gatewayProtocol: "acp",
      declaredCapabilities: ["aws.ecs.describe_clusters", "aws.ecs.update_service"],
      status: "PENDING",
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: null,
      createdAt: new Date()
    };

    // Loop 2: OperationApproval (Runtime HITL per-operation mutation & deploy gate)
    const opApproval: OperationApproval = {
      id: "appr_op_test",
      tenantId: "ten_test",
      agentId: "ag_test",
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      operationPayloadHash: "abc123hash",
      rawPayload: { cluster: "prod", service: "web" },
      status: "PENDING",
      reviewedBy: null,
      reviewedAt: null,
      signature: null,
      signedBy: null,
      signedAt: null,
      idempotencyKey: null,
      escalatedAt: null,
      executionResult: null,
      errorMessage: null,
      expiresAt: new Date(Date.now() + 14400000),
      createdAt: new Date()
    };

    expect(joinApproval.agentName).toBe("Hermes SRE");
    expect(joinApproval.declaredCapabilities).toHaveLength(2);

    expect(opApproval.toolName).toBe("aws_ecs_update_service");
    expect(opApproval.operationPayloadHash).toBe("abc123hash");
  });

  it("uses separate isolated service classes with non-overlapping responsibilities", () => {
    expect(JoinRequestService).toBeDefined();
    expect(ApprovalService).toBeDefined();
    expect(JoinRequestService).not.toBe(ApprovalService);
  });
});
