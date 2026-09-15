import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDatabase, runMigrations, closeDatabase } from "@cloudops/database";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { generateTenantId, generateAgentId, SignatureVerificationError, ValidationError } from "@cloudops/shared";

describe("Phase 1.3 — Real Signed Operator Approval (Non-Repudiation)", () => {
  let approvalService: ApprovalService;
  const tenantId = generateTenantId();
  const agentId = generateAgentId();
  let operatorKeyPair: ReturnType<typeof OperatorSignatureService.generateKeyPair>;
  let attackerKeyPair: ReturnType<typeof OperatorSignatureService.generateKeyPair>;

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();
    await db
      .insertInto("tenants")
      .values({ id: tenantId, name: "Signature Verification Tenant" })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    await db
      .insertInto("agents")
      .values({
        id: agentId,
        tenant_id: tenantId,
        name: "Hermes Agent",
        type: "hermes",
        version: "1.0.0",
        runtime_protocol: "acp",
        status: "CONNECTED"
      })
      .execute();

    approvalService = new ApprovalService();
    operatorKeyPair = OperatorSignatureService.generateKeyPair();
    attackerKeyPair = OperatorSignatureService.generateKeyPair();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("successfully verifies authentic operator Ed25519 signature", async () => {
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "prod", service: "api", desiredCount: 4 }
    });

    const signedAt = new Date();
    const signature = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      operatorKeyPair.privateKeyPem
    );

    const approved = await approvalService.approve(tenantId, approval.id, {
      reviewedBy: "op_authorized_lead",
      signature,
      publicKeyPem: operatorKeyPair.publicKeyPem,
      signedAt
    });

    expect(approved.status).toBe("APPROVED");
    expect(approved.signature).toBe(signature);
    expect(approved.signedBy).toBe("op_authorized_lead");
  });

  it("rejects forged operator signature signed by unauthorized attacker keypair", async () => {
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "prod", service: "api", desiredCount: 10 }
    });

    const signedAt = new Date();
    // Attacker signs using their private key, but claims to be op_authorized_lead
    const forgedSignature = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      attackerKeyPair.privateKeyPem
    );

    // Verifying against the legitimate operator's public key must fail
    await expect(
      approvalService.approve(tenantId, approval.id, {
        reviewedBy: "op_authorized_lead",
        signature: forgedSignature,
        publicKeyPem: operatorKeyPair.publicKeyPem,
        signedAt
      })
    ).rejects.toThrow(SignatureVerificationError);

    // Confirm status remains PENDING
    const fetched = await approvalService.getApproval(tenantId, approval.id);
    expect(fetched?.status).toBe("PENDING");
  });

  it("rejects replayed signature from a different approval record", async () => {
    // Approval 1
    const approval1 = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "prod", service: "api", desiredCount: 2 }
    });

    const signedAt = new Date();
    const validSig1 = OperatorSignatureService.signApproval(
      approval1.id,
      approval1.operationPayloadHash,
      signedAt.getTime(),
      operatorKeyPair.privateKeyPem
    );

    // Approval 2 (different approval ID)
    const approval2 = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "prod", service: "api", desiredCount: 2 }
    });

    // Attacker attempts to replay signature from approval1 onto approval2
    await expect(
      approvalService.approve(tenantId, approval2.id, {
        reviewedBy: "op_authorized_lead",
        signature: validSig1,
        publicKeyPem: operatorKeyPair.publicKeyPem,
        signedAt
      })
    ).rejects.toThrow(SignatureVerificationError);
  });

  it("rejects approval when signature is missing", async () => {
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: "aws_ecs_update_service",
      operationType: "MUTATION",
      rawPayload: { cluster: "prod", service: "api", desiredCount: 1 }
    });

    await expect(
      approvalService.approve(tenantId, approval.id, {
        reviewedBy: "op_lazy_clicker",
        signature: "",
        publicKeyPem: operatorKeyPair.publicKeyPem
      })
    ).rejects.toThrow(SignatureVerificationError);
  });
});
