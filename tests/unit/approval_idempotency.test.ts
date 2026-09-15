import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDatabase, runMigrations, closeDatabase } from "@cloudops/database";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { generateTenantId, generateAgentId, IdempotencyConflictError, ValidationError } from "@cloudops/shared";

describe("Phase 1.5 — Execution Idempotency & In-Flight State", () => {
  let approvalService: ApprovalService;
  const tenantId = generateTenantId();
  const agentId = generateAgentId();
  let operatorKeyPair: ReturnType<typeof OperatorSignatureService.generateKeyPair>;

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();
    await db
      .insertInto("tenants")
      .values({ id: tenantId, name: "Idempotency Tenant" })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    await db
      .insertInto("agents")
      .values({
        id: agentId,
        tenant_id: tenantId,
        name: "Agent Idempotency Test",
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

  async function createAndApprove(payload: Record<string, unknown>) {
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: payload
    });

    const signedAt = new Date();
    const signature = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      operatorKeyPair.privateKeyPem
    );

    return approvalService.approve(tenantId, approval.id, {
      reviewedBy: "op_lead",
      signature,
      publicKeyPem: operatorKeyPair.publicKeyPem,
      signedAt
    });
  }

  it("transitions to EXECUTING with idempotency key before cloud dispatch and sets EXECUTED on completion", async () => {
    const approved = await createAndApprove({ cluster: "prod", service: "api", desiredCount: 4 });

    let stateDuringDispatch: string | undefined;
    let receivedIdempKey: string | undefined;

    const result = await approvalService.executeApproval(tenantId, approved.id, async (_payload, idempKey) => {
      receivedIdempKey = idempKey;
      // Inspect database while executor is running
      const during = await approvalService.getApproval(tenantId, approved.id);
      stateDuringDispatch = during?.status;
      return { success: true, count: 4 };
    });

    expect(stateDuringDispatch).toBe("EXECUTING");
    expect(receivedIdempKey).toBe(`idemp_${approved.id}`);
    expect(result.success).toBe(true);

    const completed = await approvalService.getApproval(tenantId, approved.id);
    expect(completed?.status).toBe("EXECUTED");
    expect(completed?.idempotencyKey).toBe(`idemp_${approved.id}`);
    expect(completed?.executionResult).toEqual({ success: true, count: 4 });
  });

  it("guards against double-execution: replaying an already executed approval throws IdempotencyConflictError", async () => {
    const approved = await createAndApprove({ cluster: "prod", service: "cart", desiredCount: 2 });

    let callCount = 0;
    const cloudExecutor = async () => {
      callCount++;
      return { status: "RESTARTED" };
    };

    // First execution
    await approvalService.executeApproval(tenantId, approved.id, cloudExecutor);
    expect(callCount).toBe(1);

    // Replay attempt must be rejected
    await expect(
      approvalService.executeApproval(tenantId, approved.id, cloudExecutor)
    ).rejects.toThrow(IdempotencyConflictError);

    // Verify executor was NOT called again
    expect(callCount).toBe(1);
  });

  it("simulates crash during dispatch: restarts/retries refuse to re-execute an in-flight EXECUTING approval", async () => {
    const approved = await createAndApprove({ cluster: "prod", service: "checkout", desiredCount: 3 });
    const db = getDatabase();

    // Simulate crash after transition to EXECUTING
    await db
      .updateTable("approvals")
      .set({
        status: "EXECUTING",
        idempotency_key: `idemp_${approved.id}`
      })
      .where("id", "=", approved.id)
      .execute();

    let retryExecuted = false;
    const retryExecutor = async () => {
      retryExecuted = true;
      return { success: true };
    };

    // Retry after crash must be blocked because status is already EXECUTING
    await expect(
      approvalService.executeApproval(tenantId, approved.id, retryExecutor)
    ).rejects.toThrow(IdempotencyConflictError);

    expect(retryExecuted).toBe(false);
  });

  it("detects payload tampering: re-verifies payload hash before execution and aborts if tampered", async () => {
    const approved = await createAndApprove({ cluster: "prod", service: "billing", desiredCount: 2 });
    const db = getDatabase();

    // Attacker tampers with the raw payload in DB from 2 to 999
    await db
      .updateTable("approvals")
      .set({
        raw_payload: JSON.stringify({ cluster: "prod", service: "billing", desiredCount: 999 }) as any
      })
      .where("id", "=", approved.id)
      .execute();

    let executed = false;
    await expect(
      approvalService.executeApproval(tenantId, approved.id, async () => {
        executed = true;
        return { success: true };
      })
    ).rejects.toThrow(ValidationError);

    expect(executed).toBe(false);
  });
});
