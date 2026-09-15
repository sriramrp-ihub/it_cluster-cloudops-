import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDatabase, runMigrations, closeDatabase } from "@cloudops/database";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { generateTenantId, generateAgentId, PolicyViolationError } from "@cloudops/shared";

describe("Phase 1.1 — Auto-Remediation Option A Enforcement", () => {
  let approvalService: ApprovalService;
  const tenantId = generateTenantId();
  const agentId = generateAgentId();
  let operatorKeyPair: ReturnType<typeof OperatorSignatureService.generateKeyPair>;

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();
    await db
      .insertInto("tenants")
      .values({ id: tenantId, name: "Auto-Remediation Safety Tenant" })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    await db
      .insertInto("agents")
      .values({
        id: agentId,
        tenant_id: tenantId,
        name: "Hermes Remediation Agent",
        type: "hermes",
        version: "1.0.0",
        runtime_protocol: "acp",
        status: "CONNECTED"
      })
      .execute();

    approvalService = new ApprovalService();
    operatorKeyPair = OperatorSignatureService.generateKeyPair();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("permits auto-remediation to PROPOSE a runbook by creating a pending approval request", async () => {
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: {
        cluster: "production-cluster",
        service: "payments-service",
        desiredCount: 5,
        reason: "Incident auto-remediation runbook: scale up crashed container replica set"
      }
    });

    expect(approval.id).toBeDefined();
    expect(approval.status).toBe("PENDING");
    expect(approval.reviewedBy).toBeNull();
    expect(approval.signature).toBeNull();
  });

  it("STRICTLY BLOCKS direct execution from PENDING: auto-remediation cannot bypass HITL", async () => {
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: {
        cluster: "production-cluster",
        service: "payments-service",
        desiredCount: 6
      }
    });

    let cloudExecuted = false;
    const cloudExecutor = async () => {
      cloudExecuted = true;
      return { status: "SCALED" };
    };

    // Must throw PolicyViolationError asserting direct execution is prohibited
    await expect(
      approvalService.executeApproval(tenantId, approval.id, cloudExecutor)
    ).rejects.toThrow(PolicyViolationError);

    // Verify cloud call was NOT executed
    expect(cloudExecuted).toBe(false);

    // Verify approval remains in PENDING
    const fetched = await approvalService.getApproval(tenantId, approval.id);
    expect(fetched?.status).toBe("PENDING");
  });

  it("permits execution ONLY after a human operator reviews and cryptographically signs approval", async () => {
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: {
        cluster: "production-cluster",
        service: "payments-service",
        desiredCount: 8
      }
    });

    const signedAt = new Date();
    const signature = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      operatorKeyPair.privateKeyPem
    );

    // Human signs off
    const approved = await approvalService.approve(tenantId, approval.id, {
      reviewedBy: "op_lead_sre",
      signature,
      publicKeyPem: operatorKeyPair.publicKeyPem,
      signedAt
    });
    expect(approved.status).toBe("APPROVED");
    expect(approved.signature).toBe(signature);

    // Now execution succeeds
    let executionCalled = false;
    const result = await approvalService.executeApproval(tenantId, approval.id, async (payload, idempKey) => {
      executionCalled = true;
      return { scaled: true, count: payload["desiredCount"], idempKey };
    });

    expect(executionCalled).toBe(true);
    expect(result.scaled).toBe(true);
    expect(result.count).toBe(8);

    const executedApproval = await approvalService.getApproval(tenantId, approval.id);
    expect(executedApproval?.status).toBe("EXECUTED");
  });
});
