import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CloudOpsMcpServer, CANONICAL_TOOLS } from "@cloudops/tools";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { getDatabase, runMigrations, closeDatabase } from "@cloudops/database";
import { generateTenantId, generateAgentId } from "@cloudops/shared";

describe("CloudOps Governed MCP Server", () => {
  const tenantId = generateTenantId();
  const agentId = generateAgentId();
  let approvalService: ApprovalService;

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();
    await db.insertInto("tenants").values({
      id: tenantId,
      name: "MCP Test Corp"
    }).execute();

    await db.insertInto("agents").values({
      id: agentId,
      tenant_id: tenantId,
      name: "test-mcp-agent",
      type: "hermes",
      version: "1.0.0",
      runtime_protocol: "acp",
      status: "CONNECTED"
    }).execute();

    approvalService = new ApprovalService();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("registers canonical tools for AWS, GCP, and Azure", () => {
    expect(CANONICAL_TOOLS.length).toBeGreaterThanOrEqual(10);
    const awsTools = CANONICAL_TOOLS.filter((t) => t.provider === "aws");
    const gcpTools = CANONICAL_TOOLS.filter((t) => t.provider === "gcp");
    const azureTools = CANONICAL_TOOLS.filter((t) => t.provider === "azure");

    expect(awsTools.length).toBeGreaterThanOrEqual(4);
    expect(gcpTools.length).toBeGreaterThanOrEqual(3);
    expect(azureTools.length).toBeGreaterThanOrEqual(3);
  });

  it("filters tools based on agent authorized capabilities", () => {
    const mcpServer = new CloudOpsMcpServer({
      agentId,
      tenantId,
      authorizedCapabilities: ["aws.ecs.describe_clusters"],
      approvalService
    });

    expect(mcpServer).toBeDefined();
    expect(mcpServer.getMcpServer()).toBeDefined();
  });

  it("executes read-only tool directly without requiring approval", async () => {
    const ecsTool = CANONICAL_TOOLS.find((t) => t.name === "aws_ecs_describe_clusters")!;
    expect(ecsTool.requiresApproval).toBe(false);

    const result = await ecsTool.handler({ region: "us-east-1" }, { agentId, tenantId });
    expect(result.provider).toBe("aws");
    expect(result.clusters).toBeDefined();
    expect(result.clusters[0].status).toBe("ACTIVE");
  });

  it("intercepts high-risk mutation and creates an approval request", async () => {
    const updateServiceTool = CANONICAL_TOOLS.find((t) => t.name === "aws_ecs_update_service")!;
    expect(updateServiceTool.requiresApproval).toBe(true);

    const payload = {
      cluster: "prod-cluster",
      service: "payment-service",
      forceNewDeployment: true
    };

    const approval = await approvalService.createApprovalRequest({
      tenantId,
      agentId,
      toolName: updateServiceTool.name,
      rawPayload: payload,
      operationType: "MUTATION"
    });

    expect(approval.id).toBeDefined();
    expect(approval.status).toBe("PENDING");
    expect(approval.operationPayloadHash).toBeDefined();

    // Verify retrieval
    const retrieved = await approvalService.getApproval(tenantId, approval.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.toolName).toBe("aws_ecs_update_service");

    // Human operator signs and approves
    const keyPair = OperatorSignatureService.generateKeyPair();
    const signedAt = new Date();
    const signature = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      keyPair.privateKeyPem
    );

    const approved = await approvalService.approve(tenantId, approval.id, {
      reviewedBy: "op_security_admin",
      signature,
      publicKeyPem: keyPair.publicKeyPem,
      signedAt
    });
    expect(approved.status).toBe("APPROVED");
    expect(approved.reviewedBy).toBe("op_security_admin");
    expect(approved.signature).toBe(signature);
  });
});
