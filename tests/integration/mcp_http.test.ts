import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { closeDatabase, runMigrations, getDatabase } from "@cloudops/database";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { CANONICAL_TOOLS } from "@cloudops/tools";

describe("MCP HTTP/SSE Integration Tests", () => {
  let app: ReturnType<typeof buildApp>;
  let serverUrl: string;
  const testTenantId = "ten_default_tenant";
  const testAgentId = "agent_mcp_sse_test";

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();

    // Ensure test agent exists for foreign key constraints
    await db
      .insertInto("agents")
      .values({
        id: testAgentId,
        tenant_id: testTenantId,
        name: "MCP SSE Test Agent",
        type: "hermes",
        version: "1.0.0",
        runtime_protocol: "mcp",
        status: "APPROVED"
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    app = buildApp({ startHeartbeatMonitor: false });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address() as any;
    serverUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    const db = getDatabase();
    await db.deleteFrom("approvals").where("agent_id", "=", testAgentId).execute();
    await db.deleteFrom("agents").where("id", "=", testAgentId).execute();
    if (app) {
      await app.close();
    }
    await closeDatabase();
  });

  it("GET /v1/mcp/tools returns all canonical tools across AWS, GCP, and Azure", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/mcp/tools"
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.count).toBe(CANONICAL_TOOLS.length);
    expect(body.tools.length).toBe(CANONICAL_TOOLS.length);

    const providers = new Set(body.tools.map((t: any) => t.provider));
    expect(providers.has("aws")).toBe(true);
    expect(providers.has("gcp")).toBe(true);
    expect(providers.has("azure")).toBe(true);
  });

  it("connects via standard MCP SSE Client, lists tools, executes read tool and intercepts mutation", async () => {
    const sseUrl = new URL(
      `${serverUrl}/v1/mcp/sse?agentId=${testAgentId}&tenantId=${testTenantId}`
    );
    const transport = new SSEClientTransport(sseUrl);
    const client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await client.connect(transport);

    // 1. List tools over SSE transport
    const toolList = await client.listTools();
    expect(toolList.tools.length).toBeGreaterThan(0);
    const toolNames = toolList.tools.map((t) => t.name);
    expect(toolNames).toContain("aws_ecs_describe_clusters");
    expect(toolNames).toContain("aws_ecs_update_service");
    expect(toolNames).toContain("gcp_run_services_list");
    expect(toolNames).toContain("azure_container_apps_list");

    // 2. Call read-only tool (low risk, immediate telemetry)
    const readResult = (await client.callTool({
      name: "aws_ecs_describe_clusters",
      arguments: { clusters: ["prod-app-cluster"], region: "us-east-1" }
    })) as any;

    expect(readResult.content).toBeDefined();
    expect(readResult.content[0].type).toBe("text");
    const parsedData = JSON.parse(readResult.content[0].text);
    expect(parsedData.provider).toBe("aws");
    expect(parsedData.clusters[0].clusterName).toBe("prod-app-cluster");

    // 3. Call high-risk mutation tool (enforces human approval gate)
    const mutationResult = (await client.callTool({
      name: "aws_ecs_update_service",
      arguments: {
        cluster: "prod-app-cluster",
        service: "payment-api",
        desiredCount: 5,
        region: "us-east-1"
      }
    })) as any;

    expect(mutationResult.content).toBeDefined();
    const parsedMutation = JSON.parse(mutationResult.content[0].text);
    expect(parsedMutation.status).toBe("AWAITING_APPROVAL");
    expect(parsedMutation.approvalId).toMatch(/^appr_/);
    expect(parsedMutation.tool).toBe("aws_ecs_update_service");

    await client.close();
  });
});
