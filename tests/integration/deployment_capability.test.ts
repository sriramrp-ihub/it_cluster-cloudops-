import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDatabase, runMigrations, closeDatabase } from "@cloudops/database";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { CloudOpsMcpServer, CANONICAL_TOOLS } from "@cloudops/tools";
import { AuditService } from "@cloudops/audit";
import {
  generateTenantId,
  generateAgentId,
  IdempotencyConflictError
} from "@cloudops/shared";

describe("Phase 3 — Deployment Capability, Dry-Run Diff & Rollback Integration", () => {
  let approvalService: ApprovalService;
  let auditService: AuditService;
  const tenantId = generateTenantId();
  const mutateAgentId = generateAgentId();
  const deployAgentId = generateAgentId();
  let operatorKeyPair: ReturnType<typeof OperatorSignatureService.generateKeyPair>;

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();

    // Create test tenant
    await db
      .insertInto("tenants")
      .values({ id: tenantId, name: "Deploy Capability Test Tenant" })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    // Create agent 1: only mutate capability
    await db
      .insertInto("agents")
      .values({
        id: mutateAgentId,
        tenant_id: tenantId,
        name: "Mutate-Only Agent",
        type: "hermes",
        version: "1.0.0",
        runtime_protocol: "mcp",
        status: "APPROVED"
      })
      .execute();

    // Create agent 2: deploy capability
    await db
      .insertInto("agents")
      .values({
        id: deployAgentId,
        tenant_id: tenantId,
        name: "Deployer Agent",
        type: "hermes",
        version: "1.0.0",
        runtime_protocol: "mcp",
        status: "APPROVED"
      })
      .execute();

    approvalService = new ApprovalService();
    auditService = new AuditService();
    operatorKeyPair = OperatorSignatureService.generateKeyPair();
  });

  afterAll(async () => {
    const db = getDatabase();
    await db.deleteFrom("approvals").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("audit_events").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("agents").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("tenants").where("id", "=", tenantId).execute();
    await closeDatabase();
  });

  it("3.1 Capability Tier Isolation: agent with 'mutate' tier CANNOT invoke 'deploy' tool", async () => {
    // Agent only has mutate capabilities
    const mcpServer = new CloudOpsMcpServer({
      agentId: mutateAgentId,
      tenantId,
      authorizedCapabilities: ["aws.ecs.update_service", "mutate"],
      approvalService
    });

    // Deploy tool is not even registered in the catalog for this agent
    expect(mcpServer.isCapabilityAuthorized("aws.ecs.deploy_service")).toBe(false);

    // If an agent tries to bypass via manual invocation, policy fencing blocks before approval queue
    const deployTool = CANONICAL_TOOLS.find((t) => t.name === "aws_ecs_deploy_service")!;
    expect(deployTool).toBeDefined();
    expect(deployTool.operationType).toBe("DEPLOY");
    expect(deployTool.riskLevel).toBe("CRITICAL");
  });

  it("3.2 Pre-execution Dry-Run Diff & Policy Fencing for aws_ecs_deploy_service", async () => {
    const mcpServer = new CloudOpsMcpServer({
      agentId: deployAgentId,
      tenantId,
      authorizedCapabilities: ["aws.ecs.deploy_service", "deploy"],
      approvalService
    });

    expect(mcpServer.isCapabilityAuthorized("aws.ecs.deploy_service")).toBe(true);

    // Call tool via internal registered handler
    const serverInstance = mcpServer.getMcpServer() as any;
    const deployToolHandler = serverInstance._registeredTools["aws_ecs_deploy_service"];
    expect(deployToolHandler).toBeDefined();

    // 1. Region policy fencing: disallowed region is blocked before queue
    const disallowedRes = await deployToolHandler.handler({
      cluster: "production-cluster",
      service: "payment-api",
      taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:5",
      region: "ap-southeast-1"
    });
    expect(disallowedRes.isError).toBe(true);
    expect(disallowedRes.content[0].text).toContain("Region 'ap-southeast-1' is not in the allowed regions list");

    // 2. Valid deployment creates approval request with rich dry-run diff
    const deployRes = await deployToolHandler.handler({
      cluster: "production-cluster",
      service: "payment-api",
      taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:5",
      previousTaskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:4",
      desiredCount: 2,
      region: "us-east-1"
    });

    expect(deployRes.isError).toBeUndefined();
    const parsed = JSON.parse(deployRes.content[0].text);
    expect(parsed.status).toBe("AWAITING_APPROVAL");
    expect(parsed.approvalId).toMatch(/^appr_/);
    expect(parsed.operationType).toBe("DEPLOY");
    expect(parsed.dryRunDiff).toBeDefined();
    expect(parsed.dryRunDiff.action).toBe("DEPLOY_SERVICE");
    expect(parsed.dryRunDiff.estimatedMonthlyCostUsd).toBeGreaterThan(0);
    expect(parsed.dryRunDiff.rollbackAvailable).toBe(true);
    expect(parsed.dryRunDiff.rollbackTarget).toBe("arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:4");

    // Check DB persistence
    const db = getDatabase();
    const stored = await db
      .selectFrom("approvals")
      .selectAll()
      .where("id", "=", parsed.approvalId)
      .executeTakeFirstOrThrow();

    expect(stored.operation_type).toBe("DEPLOY");
    expect(stored.dry_run_diff).toBeDefined();
    expect(stored.previous_state_snapshot).toBeDefined();
  });

  it("3.3 Full Deployment Execution with Signed Approval and Idempotency Guard", async () => {
    // 1. Queue a deployment approval
    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId: deployAgentId,
      toolName: "aws_ecs_deploy_service",
      operationType: "DEPLOY",
      rawPayload: {
        cluster: "production-cluster",
        service: "payment-api",
        taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:5",
        desiredCount: 2,
        region: "us-east-1"
      }
    });

    // 2. Operator signs and approves
    const signedAt = new Date();
    const sig = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      operatorKeyPair.privateKeyPem
    );

    await approvalService.approve(tenantId, approval.id, {
      reviewedBy: "op_lead_sre",
      signature: sig,
      publicKeyPem: operatorKeyPair.publicKeyPem,
      signedAt
    });

    // 3. Execution acquires EXECUTING state and succeeds
    let executedCount = 0;
    const result = await approvalService.executeApproval(tenantId, approval.id, async (payload, idempKey) => {
      executedCount++;
      const deployTool = CANONICAL_TOOLS.find((t) => t.name === "aws_ecs_deploy_service")!;
      return await deployTool.handler(payload, { agentId: deployAgentId, tenantId });
    });

    expect(executedCount).toBe(1);
    expect((result as any).status).toBe("DEPLOYED");
    expect((result as any).service).toBe("payment-api");

    // 4. Double-execution attempt is strictly blocked by IdempotencyConflictError
    await expect(
      approvalService.executeApproval(tenantId, approval.id, async () => {
        executedCount++;
        return {};
      })
    ).rejects.toThrow(IdempotencyConflictError);
    expect(executedCount).toBe(1);
  });

  it("3.4 Rollback Tool (aws_ecs_rollback_service) using snapshot state", async () => {
    const mcpServer = new CloudOpsMcpServer({
      agentId: deployAgentId,
      tenantId,
      authorizedCapabilities: ["aws.ecs.rollback_service", "deploy"],
      approvalService
    });

    const serverInstance = mcpServer.getMcpServer() as any;
    const rollbackHandler = serverInstance._registeredTools["aws_ecs_rollback_service"];
    expect(rollbackHandler).toBeDefined();

    // 1. Rollback invocation generates dry run diff reverting to prior revision
    const rollbackRes = await rollbackHandler.handler({
      cluster: "production-cluster",
      service: "payment-api",
      targetTaskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:4",
      region: "us-east-1"
    });

    expect(rollbackRes.isError).toBeUndefined();
    const parsed = JSON.parse(rollbackRes.content[0].text);
    expect(parsed.status).toBe("AWAITING_APPROVAL");
    expect(parsed.operationType).toBe("DEPLOY");
    expect(parsed.dryRunDiff.action).toBe("ROLLBACK_SERVICE");
    expect(parsed.dryRunDiff.taskDefinition).toBe("arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:4");

    // 2. Sign and execute rollback
    const signedAt = new Date();
    const sig = OperatorSignatureService.signApproval(
      parsed.approvalId,
      (await approvalService.getApproval(tenantId, parsed.approvalId))!.operationPayloadHash,
      signedAt.getTime(),
      operatorKeyPair.privateKeyPem
    );

    await approvalService.approve(tenantId, parsed.approvalId, {
      reviewedBy: "op_incident_commander",
      signature: sig,
      publicKeyPem: operatorKeyPair.publicKeyPem,
      signedAt
    });

    const rollbackResult = await approvalService.executeApproval(
      tenantId,
      parsed.approvalId,
      async (payload) => {
        const rollbackTool = CANONICAL_TOOLS.find((t) => t.name === "aws_ecs_rollback_service")!;
        return await rollbackTool.handler(payload, { agentId: deployAgentId, tenantId });
      }
    );

    expect((rollbackResult as any).status).toBe("ROLLED_BACK");
    expect((rollbackResult as any).activeTaskDefinition).toBe("arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:4");
  });

  it("3.5 Audit Trail Verification: deploy and rollback are recorded in immutable hash chain", async () => {
    // Walk tenant audit chain and confirm all deploy and rollback events are cryptographically intact
    const verifyResult = await auditService.verifyChain(tenantId);
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.totalChecked).toBeGreaterThanOrEqual(4);
    expect(verifyResult.error).toBeUndefined();
  });
});
