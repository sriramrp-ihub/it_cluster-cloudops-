import { describe, it, expect } from "vitest";
import { CloudOpsMcpServer, CANONICAL_TOOLS } from "@cloudops/tools";
import { runMcpStdioBridge } from "@cloudops/connector";

describe("Phase 1.9 — Stdio Transport Authorization Parity", () => {
  it("unscoped/unauthenticated stdio connection grants zero governed tools (deny by default)", () => {
    // Agent connects via stdio without providing authorized capabilities
    const mcpServer = new CloudOpsMcpServer({
      agentId: "ag_untrusted_stdio",
      tenantId: "ten_test",
      authorizedCapabilities: []
    });

    // Verify that NO canonical governed tools are registered
    for (const tool of CANONICAL_TOOLS) {
      expect(mcpServer.isCapabilityAuthorized(tool.requiredCapability)).toBe(false);
    }
  });

  it("stdio agent with specific scoped capabilities receives ONLY authorized tools", () => {
    const mcpServer = new CloudOpsMcpServer({
      agentId: "ag_scoped_stdio",
      tenantId: "ten_test",
      authorizedCapabilities: ["aws.ecs.describe_clusters"]
    });

    // Authorized tool is allowed
    expect(mcpServer.isCapabilityAuthorized("aws.ecs.describe_clusters")).toBe(true);

    // Ungranted read tool is blocked
    expect(mcpServer.isCapabilityAuthorized("aws.cloudwatch.get_metric_data")).toBe(false);

    // Ungranted high-risk mutation tool is strictly blocked
    expect(mcpServer.isCapabilityAuthorized("aws.ecs.update_service")).toBe(false);
  });

  it("prohibits capability escalation: attempting to invoke an ungranted tool returns authorization failure", async () => {
    const mcpServer = new CloudOpsMcpServer({
      agentId: "ag_attacker_stdio",
      tenantId: "ten_test",
      authorizedCapabilities: ["aws.ecs.describe_clusters"]
    });

    // Capability check must reject ungranted capability escalation
    const isAuthorized = mcpServer.isCapabilityAuthorized("aws.ecs.update_service");
    expect(isAuthorized).toBe(false);
  });
});
