import { describe, it, expect } from "vitest";
import { CANONICAL_TOOLS } from "@cloudops/tools";
import { buildApp } from "../../apps/api/src/server.js";

describe("Phase 1.8 — Tool Parity Claims & Catalog Status", () => {
  it("every canonical tool definition has an explicit readiness status", () => {
    expect(CANONICAL_TOOLS.length).toBeGreaterThanOrEqual(11);

    for (const tool of CANONICAL_TOOLS) {
      expect(["live", "contract_only"]).toContain(tool.status);
    }
  });

  it("AWS tools are marked 'live' whereas GCP and Azure are marked 'contract_only'", () => {
    const awsTools = CANONICAL_TOOLS.filter((t) => t.provider === "aws");
    const gcpTools = CANONICAL_TOOLS.filter((t) => t.provider === "gcp");
    const azureTools = CANONICAL_TOOLS.filter((t) => t.provider === "azure");

    expect(awsTools.length).toBeGreaterThan(0);
    expect(gcpTools.length).toBeGreaterThan(0);
    expect(azureTools.length).toBeGreaterThan(0);

    for (const tool of awsTools) {
      expect(tool.status).toBe("live");
    }

    for (const tool of gcpTools) {
      expect(tool.status).toBe("contract_only");
    }

    for (const tool of azureTools) {
      expect(tool.status).toBe("contract_only");
    }
  });

  it("GET /v1/mcp/tools API surfaces the status field to prevent mock misinterpretation", async () => {
    const app = buildApp({ startHeartbeatMonitor: false });
    const res = await app.inject({
      method: "GET",
      url: "/v1/mcp/tools"
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.count).toBe(CANONICAL_TOOLS.length);

    for (const tool of body.tools) {
      expect(tool.status).toBeDefined();
      expect(["live", "contract_only"]).toContain(tool.status);
    }

    await app.close();
  });
});
