import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDatabase, runMigrations, closeDatabase } from "@cloudops/database";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { generateTenantId, generateAgentId, ValidationError } from "@cloudops/shared";

describe("Phase 1.4 — TTL Expiry and Escalation on Pending Approvals", () => {
  let approvalService: ApprovalService;
  const tenantId = generateTenantId();
  const agentId = generateAgentId();
  let operatorKeyPair: ReturnType<typeof OperatorSignatureService.generateKeyPair>;

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();
    await db
      .insertInto("tenants")
      .values({ id: tenantId, name: "Lifecycle & Escalation Tenant" })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    await db
      .insertInto("agents")
      .values({
        id: agentId,
        tenant_id: tenantId,
        name: "Agent Lifecycle Test",
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

  it("automatically transitions expired approvals to EXPIRED status", async () => {
    // Create an approval with 1 second TTL
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "prod", service: "web" },
      expiresInSeconds: 1 // 1 second TTL
    });

    expect(approval.status).toBe("PENDING");

    // Wait 1.1 seconds for TTL expiration
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Fetching approval should auto-expire it
    const fetched = await approvalService.getApproval(tenantId, approval.id);
    expect(fetched?.status).toBe("EXPIRED");
  });

  it("blocks operator from approving an expired approval", async () => {
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "prod", service: "web" },
      expiresInSeconds: 1
    });

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const signedAt = new Date();
    const signature = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      operatorKeyPair.privateKeyPem
    );

    // Operator clicking approve on stale UI must be rejected
    await expect(
      approvalService.approve(tenantId, approval.id, {
        reviewedBy: "op_stale_clicker",
        signature,
        publicKeyPem: operatorKeyPair.publicKeyPem,
        signedAt
      })
    ).rejects.toThrow(ValidationError);
  });

  it("escalates unactioned pending approvals past configured threshold", async () => {
    const db = getDatabase();

    // Create an approval and manually backdate created_at by 45 minutes
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "prod", service: "database" },
      expiresInSeconds: 14400 // 4 hours
    });

    const fortyFiveMinsAgo = new Date(Date.now() - 45 * 60 * 1000);
    await db
      .updateTable("approvals")
      .set({ created_at: fortyFiveMinsAgo })
      .where("id", "=", approval.id)
      .execute();

    // Run escalation engine with 30-minute threshold
    const escalated = await approvalService.escalatePendingApprovals(tenantId, 30);
    expect(escalated.some((a) => a.id === approval.id)).toBe(true);

    const reChecked = await approvalService.getApproval(tenantId, approval.id);
    expect(reChecked?.escalatedAt).not.toBeNull();
  });
});
