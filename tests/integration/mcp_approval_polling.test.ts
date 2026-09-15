import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDatabase, runMigrations, closeDatabase } from "@cloudops/database";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { buildApp } from "../../apps/api/src/server.js";
import { generateTenantId, generateAgentId } from "@cloudops/shared";

describe("Phase 1.6 — Agent Notification and Approval Polling Path", () => {
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
      .values({ id: tenantId, name: "Polling Integration Tenant" })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    await db
      .insertInto("agents")
      .values({
        id: agentId,
        tenant_id: tenantId,
        name: "Polling Agent",
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

  it("agent polls GET /v1/mcp/approvals/:id and observes state progression with zero skipped states", async () => {
    // 1. Agent submits high-risk mutation to queue
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "production", service: "web", desiredCount: 5 }
    });

    // 2. Immediate synchronous poll: PENDING
    const poll1 = await app.inject({
      method: "GET",
      url: `/v1/mcp/approvals/${approval.id}?tenantId=${tenantId}`
    });
    expect(poll1.statusCode).toBe(200);
    const body1 = JSON.parse(poll1.body);
    expect(body1.approvalId).toBe(approval.id);
    expect(body1.status).toBe("PENDING");
    expect(body1.toolName).toBe("aws_ecs_update_service");
    expect(body1.result).toBeNull();

    // 3. Human Operator reviews and cryptographically signs
    const signedAt = new Date();
    const signature = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      operatorKeyPair.privateKeyPem
    );

    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/approvals/${approval.id}/approve`,
      payload: {
        tenantId,
        reviewedBy: "op_oncall_engineer",
        signature,
        publicKeyPem: operatorKeyPair.publicKeyPem,
        signedAt: signedAt.toISOString()
      }
    });
    expect(approveRes.statusCode).toBe(200);

    // 4. Agent polls again: sees APPROVED
    const poll2 = await app.inject({
      method: "GET",
      url: `/v1/mcp/approvals/${approval.id}?tenantId=${tenantId}`
    });
    expect(poll2.statusCode).toBe(200);
    const body2 = JSON.parse(poll2.body);
    expect(body2.status).toBe("APPROVED");
    expect(body2.signedBy).toBe("op_oncall_engineer");

    // 5. Execution engine triggers mutation execution
    const execRes = await app.inject({
      method: "POST",
      url: `/v1/approvals/${approval.id}/execute`,
      payload: { tenantId }
    });
    expect(execRes.statusCode).toBe(200);
    const execBody = JSON.parse(execRes.body);
    expect(execBody.status).toBe("EXECUTED");

    // 6. Final poll by agent: sees EXECUTED with result
    const poll3 = await app.inject({
      method: "GET",
      url: `/v1/mcp/approvals/${approval.id}?tenantId=${tenantId}`
    });
    expect(poll3.statusCode).toBe(200);
    const body3 = JSON.parse(poll3.body);
    expect(body3.status).toBe("EXECUTED");
    expect(body3.result).toBeDefined();
    expect(body3.idempotencyKey).toBe(`idemp_${approval.id}`);
  });

  it("returns 404 for unknown approval ID", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/mcp/approvals/appr_nonexistent?tenantId=${tenantId}`
    });
    expect(res.statusCode).toBe(404);
  });
});
