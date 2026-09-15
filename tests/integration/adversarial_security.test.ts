import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDatabase, runMigrations, closeDatabase } from "@cloudops/database";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { CloudOpsMcpServer, CANONICAL_TOOLS } from "@cloudops/tools";
import { buildApp } from "../../apps/api/src/server.js";
import {
  generateTenantId,
  generateAgentId,
  ValidationError,
  IdempotencyConflictError
} from "@cloudops/shared";

describe("Phase 1.11 — Adversarial Security Tests", () => {
  let app: ReturnType<typeof buildApp>;
  let approvalService: ApprovalService;
  const tenantId = generateTenantId();
  const agentId = generateAgentId();
  let operatorKeyPair: ReturnType<typeof OperatorSignatureService.generateKeyPair>;

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();
    await db
      .insertInto("tenants")
      .values({ id: tenantId, name: "Adversarial Test Tenant" })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    await db
      .insertInto("agents")
      .values({
        id: agentId,
        tenant_id: tenantId,
        name: "Adversarial Agent",
        type: "hermes",
        version: "1.0.0",
        runtime_protocol: "acp",
        status: "CONNECTED"
      })
      .execute();

    approvalService = new ApprovalService();
    operatorKeyPair = OperatorSignatureService.generateKeyPair();
    app = buildApp({
      approvalService,
      startHeartbeatMonitor: false
    });
  });

  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  it("Attack Vector 1: Hash-tamper attempt on queued approval payload is rejected at execution time", async () => {
    const db = getDatabase();

    // 1. Agent queues mutation: desiredCount = 2
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "prod", service: "auth", desiredCount: 2 }
    });

    // 2. Operator reviews and signs the legitimate payload
    const signedAt = new Date();
    const signature = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      operatorKeyPair.privateKeyPem
    );

    await approvalService.approve(tenantId, approval.id, {
      reviewedBy: "op_lead",
      signature,
      publicKeyPem: operatorKeyPair.publicKeyPem,
      signedAt
    });

    // 3. ATTACK: Malicious actor mutates raw_payload in database to desiredCount = 500
    await db
      .updateTable("approvals")
      .set({
        raw_payload: JSON.stringify({ cluster: "prod", service: "auth", desiredCount: 500 }) as any
      })
      .where("id", "=", approval.id)
      .execute();

    // 4. Execution attempt must be rejected because payload hash doesn't match
    let cloudExecuted = false;
    await expect(
      approvalService.executeApproval(tenantId, approval.id, async () => {
        cloudExecuted = true;
        return { success: true };
      })
    ).rejects.toThrow(/tamper attempt detected/i);

    expect(cloudExecuted).toBe(false);
  });

  it("Attack Vector 2: Replayed/reused approval token is rejected", async () => {
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "prod", service: "orders", desiredCount: 3 }
    });

    const signedAt = new Date();
    const signature = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      operatorKeyPair.privateKeyPem
    );

    await approvalService.approve(tenantId, approval.id, {
      reviewedBy: "op_lead",
      signature,
      publicKeyPem: operatorKeyPair.publicKeyPem,
      signedAt
    });

    // Execute once legitimately
    let execCount = 0;
    await approvalService.executeApproval(tenantId, approval.id, async () => {
      execCount++;
      return { success: true };
    });
    expect(execCount).toBe(1);

    // ATTACK: Replay execution of already executed approval
    await expect(
      approvalService.executeApproval(tenantId, approval.id, async () => {
        execCount++;
        return { success: true };
      })
    ).rejects.toThrow(IdempotencyConflictError);

    expect(execCount).toBe(1);
  });

  it("Attack Vector 3: Capability-escalation attempt (tool outside granted scope) is blocked at policy layer", () => {
    // Agent only granted read capability
    const mcpServer = new CloudOpsMcpServer({
      agentId,
      tenantId,
      authorizedCapabilities: ["aws.ecs.describe_clusters"],
      approvalService
    });

    // ATTACK: Agent attempts to invoke ungranted high-risk mutation tool
    const isEscalationAllowed = mcpServer.isCapabilityAuthorized("aws.ecs.update_service");
    expect(isEscalationAllowed).toBe(false);

    // ATTACK: Agent attempts to invoke ungranted read tool
    const isOtherReadAllowed = mcpServer.isCapabilityAuthorized("aws.ecs.list_tasks");
    expect(isOtherReadAllowed).toBe(false);
  });
});
