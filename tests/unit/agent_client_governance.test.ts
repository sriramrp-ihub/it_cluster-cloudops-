import { describe, it, expect, vi, beforeEach } from "vitest";
import { CloudOpsAgentClient } from "../../apps/web/src/lib/agentClient.js";
import * as api from "../../apps/web/src/lib/api.js";

describe("CloudOpsAgentClient Governance & Ground-Truth Contract", () => {
  let client: CloudOpsAgentClient;

  beforeEach(() => {
    client = new CloudOpsAgentClient();
    vi.restoreAllMocks();
  });

  it("fails truthfully when no agent is registered or connected", async () => {
    vi.spyOn(api, "fetchAgents").mockResolvedValue([]);

    const result = await client.executeQuery("is starvision-motors healthy?", {});
    expect(result.status).toBe("error");
    expect(result.text).toContain("CloudOps Agent is currently offline");
  });

  it("never fabricates a 95% confidence 'Nominal Operations' card for unprovisioned services", async () => {
    vi.spyOn(api, "fetchAgents").mockResolvedValue([
      {
        id: "ag_test",
        name: "test-agent",
        type: "hermes",
        version: "1.0",
        status: "CONNECTED",
        tenantId: "ten_test",
        runtimeProtocol: "acp",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);
    vi.spyOn(api, "fetchCloudAccounts").mockResolvedValue([]);
    vi.spyOn(api, "fetchIncidents").mockResolvedValue({ items: [], total: 0 });

    const result = await client.executeQuery("investigate starvision-motors", { service: "starvision-motors" });

    expect(result.text).not.toContain("Nominal Operations — Zero Critical Anomalies");
    expect(result.text).toContain('Workload "starvision-motors" was not found in connected cloud accounts');
    expect(result.structuredCard).toBeUndefined();
  });

  it("strictly blocks direct mutation via chat and enforces Policy Engine / Approval Workflow", async () => {
    vi.spyOn(api, "fetchAgents").mockResolvedValue([
      {
        id: "ag_test",
        name: "test-agent",
        type: "hermes",
        version: "1.0",
        status: "CONNECTED",
        tenantId: "ten_test",
        runtimeProtocol: "acp",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);
    vi.spyOn(api, "fetchCloudAccounts").mockResolvedValue([]);

    const result = await client.executeQuery("scale checkout-service to 5 tasks", {});

    expect(result.text).toContain("Direct infrastructure mutation via chat is strictly prohibited under CloudOps Governance");
    expect(result.text).toContain("Policy Engine");
    expect(result.text).toContain("Approvals Queue");
  });

  it("routes investigation requests through real startInvestigation API when an incident exists", async () => {
    vi.spyOn(api, "fetchAgents").mockResolvedValue([
      {
        id: "ag_test",
        name: "hermes-sre",
        type: "hermes",
        version: "1.0",
        status: "CONNECTED",
        tenantId: "ten_test",
        runtimeProtocol: "acp",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ]);
    vi.spyOn(api, "fetchCloudAccounts").mockResolvedValue([]);
    vi.spyOn(api, "fetchIncidents").mockResolvedValue({
      items: [
        {
          id: "inc_ecs_crashloop",
          tenantId: "ten_test",
          provider: "aws",
          accountId: "123456789012",
          region: "us-east-1",
          service: "checkout-service",
          resourceId: "service/checkout",
          severity: "CRITICAL",
          title: "ECS CrashLoop at ALB",
          alertDescription: "503 errors at target group",
          status: "OPEN",
          createdAt: new Date().toISOString()
        }
      ],
      total: 1
    });

    const startSpy = vi.spyOn(api, "startInvestigation").mockResolvedValue({
      investigation: {
        id: "inv_123",
        incidentId: "inc_ecs_crashloop",
        tenantId: "ten_test",
        agentId: "ag_test",
        sessionId: "sess_456",
        status: "INVESTIGATING",
        startedAt: new Date().toISOString()
      },
      session: {
        sessionId: "sess_456",
        status: "ACTIVE",
        startedAt: new Date().toISOString()
      }
    });

    const result = await client.executeQuery("investigate checkout-service", {});

    expect(startSpy).toHaveBeenCalledWith("inc_ecs_crashloop", "ag_test");
    expect(result.text).toContain('Started autonomous investigation for incident "ECS CrashLoop at ALB"');
    expect(result.text).toContain("sess_456");
  });
});
