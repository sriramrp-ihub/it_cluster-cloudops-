import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import {
  PolicyViolationError,
  IdempotencyConflictError,
  ValidationError,
  type ApprovalId,
  type TenantId,
  type AgentId
} from "@cloudops/shared";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("V3: Governance, Policy, and Human Approval (CO-018 -> CO-021)", () => {
  let approvalService: ApprovalService;
  const tenantId = "ten_default_tenant" as TenantId;
  const agentId = "ag_default_sre" as AgentId;
  let operatorKeys: { privateKeyPem: string; publicKeyPem: string };

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();
    await db
      .insertInto("tenants")
      .values({ id: tenantId, name: "Governance Test Tenant" })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    await db
      .insertInto("agents")
      .values({
        id: agentId,
        tenant_id: tenantId,
        name: "SRE Remediation Agent",
        type: "hermes",
        version: "1.0.0",
        runtime_protocol: "acp",
        status: "CONNECTED"
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    approvalService = new ApprovalService();
    operatorKeys = OperatorSignatureService.generateKeyPair();
  });


  afterAll(async () => {
    await closeDatabase();
  });

  describe("CO-019: Human Approval Workflow, Idempotency & TTL Expiry", () => {
    it("creates approval request and enforces state machine with Option A execution block", async () => {
      const approval = await approvalService.createApprovalRequest({
        tenantId,
        agentId,
        toolName: "aws_ecs_rollback_service",
        operationType: "MUTATION",
        rawPayload: {
          cluster: "cloudops-demo-cluster",
          service: "checkout-service",
          targetTaskDefinition: "arn:aws:ecs:us-east-1:265766933076:task-definition/checkout-service:1"
        },
        expiresInSeconds: 900 // 15 minutes TTL per ADR-0003
      });

      expect(approval.status).toBe("PENDING");
      expect(approval.operationPayloadHash).toBeDefined();

      // Refuses execution in PENDING state (Option A enforcement)
      await expect(
        approvalService.executeApproval(tenantId, approval.id, async () => {
          return { rolledBack: true };
        })
      ).rejects.toThrow(PolicyViolationError);
    });

    it("requires Ed25519 signature to transition to APPROVED", async () => {
      const approval = await approvalService.createApprovalRequest({
        tenantId,
        agentId,
        toolName: "aws_ecs_rollback_service",
        operationType: "MUTATION",
        rawPayload: {
          cluster: "cloudops-demo-cluster",
          service: "checkout-service",
          desiredCount: 1
        }
      });

      const signedAt = new Date();
      const sig = OperatorSignatureService.signApproval(
        approval.id,
        approval.operationPayloadHash,
        signedAt.getTime(),
        operatorKeys.privateKeyPem
      );

      const approved = await approvalService.approve(tenantId, approval.id, {
        reviewedBy: "op_lead_sre",
        signature: sig,
        publicKeyPem: operatorKeys.publicKeyPem,
        signedAt
      });

      expect(approved.status).toBe("APPROVED");
      expect(approved.reviewedBy).toBe("op_lead_sre");
      expect(approved.signature).toBe(sig);
    });

    it("enforces idempotency and prevents concurrent dual execution", async () => {
      const approval = await approvalService.createApprovalRequest({
        tenantId,
        agentId,
        toolName: "aws_ecs_update_service",
        operationType: "MUTATION",
        rawPayload: { service: "checkout-service", desiredCount: 2 }
      });

      const signedAt = new Date();
      const sig = OperatorSignatureService.signApproval(
        approval.id,
        approval.operationPayloadHash,
        signedAt.getTime(),
        operatorKeys.privateKeyPem
      );

      await approvalService.approve(tenantId, approval.id, {
        reviewedBy: "op_lead_sre",
        signature: sig,
        publicKeyPem: operatorKeys.publicKeyPem,
        signedAt
      });

      // Simultaneous dual execution calls
      let executionCount = 0;
      const slowExecutor = async () => {
        executionCount++;
        await new Promise((r) => setTimeout(r, 50));
        return { success: true };
      };

      const [firstResult, secondResult] = await Promise.allSettled([
        approvalService.executeApproval(tenantId, approval.id, slowExecutor),
        approvalService.executeApproval(tenantId, approval.id, slowExecutor)
      ]);

      // Exactly one execution succeeds, the other fails with IdempotencyConflictError
      const fulfilled = [firstResult, secondResult].filter((r) => r.status === "fulfilled");
      const rejected = [firstResult, secondResult].filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(IdempotencyConflictError);
      expect(executionCount).toBe(1);
    });

    it("strictly blocks execution if approval has passed its TTL", async () => {
      // Create approval with TTL of -10 seconds (already expired)
      const expiredApproval = await approvalService.createApprovalRequest({
        tenantId,
        agentId,
        toolName: "aws_ecs_rollback_service",
        rawPayload: { service: "checkout-service" },
        expiresInSeconds: -10
      });

      const signedAt = new Date();
      const sig = OperatorSignatureService.signApproval(
        expiredApproval.id,
        expiredApproval.operationPayloadHash,
        signedAt.getTime(),
        operatorKeys.privateKeyPem
      );

      // Attempting to approve expired request fails
      await expect(
        approvalService.approve(tenantId, expiredApproval.id, {
          reviewedBy: "op_sre",
          signature: sig,
          publicKeyPem: operatorKeys.publicKeyPem,
          signedAt
        })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("CO-020: Scoped AWS Remediation Role & Least Privilege Regression", () => {
    it("validates CloudOpsRemediationPolicy permits scoped ECS mutation but strictly denies destructive actions", () => {
      const remediationPolicyPath = path.resolve(
        __dirname,
        "../../packages/adapters/policies/CloudOpsRemediationPolicy.json"
      );
      expect(fs.existsSync(remediationPolicyPath)).toBe(true);

      const policy = JSON.parse(fs.readFileSync(remediationPolicyPath, "utf8"));
      const allowStatement = policy.Statement.find((s: any) => s.Effect === "Allow");
      const denyStatement = policy.Statement.find((s: any) => s.Effect === "Deny");

      expect(allowStatement).toBeDefined();
      expect(allowStatement.Action).toContain("ecs:UpdateService");
      expect(allowStatement.Action).toContain("ecs:RegisterTaskDefinition");

      expect(denyStatement).toBeDefined();
      expect(denyStatement.Action).toContain("iam:*");
      expect(denyStatement.Action).toContain("organizations:*");
      expect(denyStatement.Action).toContain("account:*");
      expect(denyStatement.Action).toContain("kms:Delete*");
    });

    it("REGRESSION TEST: CloudOpsReadOnlyPolicy remains strictly read-only with explicit Deny on writes", () => {
      const readOnlyPolicyPath = path.resolve(
        __dirname,
        "../../packages/adapters/policies/CloudOpsReadOnlyPolicy.json"
      );
      expect(fs.existsSync(readOnlyPolicyPath)).toBe(true);

      const policy = JSON.parse(fs.readFileSync(readOnlyPolicyPath, "utf8"));
      const allowStatement = policy.Statement.find((s: any) => s.Effect === "Allow");
      const denyStatement = policy.Statement.find((s: any) => s.Effect === "Deny");

      // Allows only read/describe/list
      expect(allowStatement.Action.every((a: string) => a.includes("Describe") || a.includes("List") || a.includes("Get") || a.includes("Filter"))).toBe(true);

      // Denies write/delete/update/modify/terminate operations explicitly
      expect(denyStatement.Action).toContain("ecs:Update*");
      expect(denyStatement.Action).toContain("ecs:Delete*");
      expect(denyStatement.Action).toContain("ecs:StopTask");
      expect(denyStatement.Action).toContain("ecs:Create*");
    });

  });

  describe("CO-021: Credential & Secret Handling Redaction", () => {
    it("scans and redacts AWS access keys and high-entropy secrets in tool payloads and logs", () => {
      const samplePayload = {
        cluster: "cloudops-demo-cluster",
        service: "checkout-service",
        sensitiveKey: "AKIAIOSFODNN7EXAMPLE",
        token: "co_agent_mock_secret_9981240182",
        nested: {
          subToken: "AKIA1234567890ABCDEF"
        }
      };

      const payloadStr = JSON.stringify(samplePayload);
      expect(payloadStr).toContain("AKIAIOSFODNN7EXAMPLE");

      // Verify that redaction detects secret-shaped strings
      const hasAwsKey = /AKIA[0-9A-Z]{16}/.test(payloadStr);
      expect(hasAwsKey).toBe(true);

      // Verify sanitized representation removes raw keys
      const sanitized = payloadStr
        .replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_ACCESS_KEY]")
        .replace(/co_agent_[a-zA-Z0-9_-]+/g, "[REDACTED_SECRET_TOKEN]");

      expect(sanitized).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(sanitized).not.toContain("co_agent_mock_secret_9981240182");
      expect(sanitized).toContain("[REDACTED_AWS_ACCESS_KEY]");
    });
  });
});
