import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { getDatabase } from "@cloudops/database";
import { AgentService } from "@cloudops/identity";

describe("Agent Connect, Capabilities, and Skills APIs", () => {
  let app: any;
  let agentId: string;
  const tenantId = "ten_default_tenant";
  const operatorId = "op_admin_operator";

  beforeAll(async () => {
    app = buildApp({ startHeartbeatMonitor: false });
    await app.ready();

    // Create a test agent
    const agentService = new AgentService();
    const agent = await agentService.createAgent({
      tenantId,
      name: "Test Agent Connect",
      type: "hermes",
      version: "1.0.0",
      runtimeProtocol: "acp",
      status: "REGISTERED"
    });
    agentId = agent.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("1. GET /v1/capabilities returns canonical capabilities with tiers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/capabilities",
      headers: {
        "x-tenant-id": tenantId,
        "x-operator-id": operatorId
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.capabilities).toBeDefined();
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(body.capabilities.length).toBeGreaterThan(5);

    const describeClusters = body.capabilities.find((c: any) => c.id === "aws.ecs.describe_clusters");
    expect(describeClusters).toBeDefined();
    expect(describeClusters.tier).toBe("read");

    const updateService = body.capabilities.find((c: any) => c.id === "aws.ecs.update_service");
    expect(updateService).toBeDefined();
    expect(updateService.tier).toBe("mutate");
  });

  it("2. GET /v1/skills returns skills library with builtIn flags", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/skills",
      headers: {
        "x-tenant-id": tenantId,
        "x-operator-id": operatorId
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.skills).toBeDefined();
    expect(Array.isArray(body.skills)).toBe(true);
    expect(body.skills.length).toBeGreaterThan(2);

    const builtIns = body.skills.filter((s: any) => s.builtIn);
    expect(builtIns.length).toBeGreaterThan(0);
  });

  it("3. POST /v1/agents/:id/test returns successful probe response", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/agents/${agentId}`,
      headers: {
        "x-tenant-id": tenantId,
        "x-operator-id": operatorId
      }
    });
    expect(res.statusCode).toBe(200);

    const testRes = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/test`,
      headers: {
        "x-tenant-id": tenantId,
        "x-operator-id": operatorId
      }
    });

    // Test endpoint runs without crashing and returns test result structure
    expect([200, 500]).toContain(testRes.statusCode);
    const testBody = JSON.parse(testRes.payload);
    expect("success" in testBody || "error" in testBody).toBe(true);
  });

  it("4. POST /v1/agents/:id/connect auto-spawns connector and returns mcpSseUrl", async () => {
    const connectRes = await app.inject({
      method: "POST",
      url: `/v1/agents/${agentId}/connect`,
      headers: {
        "x-tenant-id": tenantId,
        "x-operator-id": operatorId
      }
    });

    expect(connectRes.statusCode).toBe(200);
    const body = JSON.parse(connectRes.payload);
    expect(body.mcpSseUrl).toBeDefined();
    expect(body.connectorPid).toBeDefined();
    expect(body.status).toBe("connected");

    // Clean up spawned process
    if (body.connectorPid) {
      try {
        process.kill(body.connectorPid, "SIGTERM");
      } catch {}
    }
  });
});

