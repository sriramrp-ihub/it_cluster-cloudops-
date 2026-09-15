import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { getDatabase, runMigrations, closeDatabase } from "@cloudops/database";

describe("MCP Stdio Bridge Integration", () => {
  const agentId = "ag_test_mcp_stdio";
  const tenantId = "ten_default_tenant";

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();
    await db.insertInto("agents").values({
      id: agentId,
      tenant_id: tenantId,
      name: "mcp-stdio-tester",
      type: "hermes",
      version: "1.0.0",
      runtime_protocol: "mcp",
      status: "CONNECTED"
    }).onConflict((oc) => oc.column("id").doNothing()).execute();
  });

  afterAll(async () => {
    const db = getDatabase();
    await db.deleteFrom("approvals").where("agent_id", "=", agentId).execute();
    await db.deleteFrom("agents").where("id", "=", agentId).execute();
    await closeDatabase();
  });

  it("completes MCP JSON-RPC handshake, tools/list, and tools/call over stdio", async () => {
    const proc = spawn("node", ["packages/connector/dist/cli.js", "--mcp"], {
      cwd: "/Users/user/Desktop/cloud_ops",
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        CLOUDOPS_AGENT_ID: agentId,
        CLOUDOPS_TENANT_ID: tenantId,
        CLOUDOPS_CAPABILITIES: "*"
      }
    });

    const rl = readline.createInterface({ input: proc.stdout });

    const responses: any[] = [];
    rl.on("line", (line) => {
      try {
        responses.push(JSON.parse(line));
      } catch {
        // ignore non-json
      }
    });

    // Helper to send JSON-RPC message
    const send = (msg: any) => {
      proc.stdin.write(JSON.stringify(msg) + "\n");
    };

    // Helper to wait for response with specific id
    const waitForResponse = async (id: number, timeoutMs = 5000): Promise<any> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const found = responses.find((r) => r.id === id);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`Timeout waiting for response id ${id}`);
    };

    // 1. Send initialize
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    });

    const initResp = await waitForResponse(1);
    expect(initResp.result).toBeDefined();
    expect(initResp.result.serverInfo.name).toBe("CloudOps-Control-Plane");

    // 2. Initialized notification
    send({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    });

    // 3. Send tools/list
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });

    const listResp = await waitForResponse(2);
    expect(listResp.result).toBeDefined();
    expect(listResp.result.tools).toBeInstanceOf(Array);
    expect(listResp.result.tools.length).toBeGreaterThanOrEqual(10);

    const toolNames = listResp.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("aws_ecs_describe_clusters");
    expect(toolNames).toContain("aws_ecs_update_service");
    expect(toolNames).toContain("gcp_run_services_list");
    expect(toolNames).toContain("azure_container_apps_list");

    // 4. Send tools/call for read-only tool
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "aws_ecs_describe_clusters",
        arguments: { region: "us-east-1" }
      }
    });

    const callResp = await waitForResponse(3);
    expect(callResp.result).toBeDefined();
    expect(callResp.result.content).toBeDefined();
    expect(callResp.result.content[0].type).toBe("text");
    const parsedData = JSON.parse(callResp.result.content[0].text);
    expect(parsedData.provider).toBe("aws");
    expect(parsedData.clusters).toBeDefined();

    // 5. Send tools/call for mutation tool (triggers approval gate)
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "aws_ecs_update_service",
        arguments: { cluster: "production", service: "web-api" }
      }
    });

    const mutationResp = await waitForResponse(4);
    expect(mutationResp.result).toBeDefined();
    const mutationData = JSON.parse(mutationResp.result.content[0].text);
    expect(mutationData.status).toBe("AWAITING_APPROVAL");
    expect(mutationData.approvalId).toBeDefined();
    expect(mutationData.message).toContain("high-risk mutation");

    proc.kill();
  });
});
