#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import { CloudOpsConnector } from "./connector.js";
import type { ConnectorConfig } from "./types.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CloudOpsMcpServer } from "@cloudops/tools";

interface ParsedCliArgs {
  inviteToken?: string | undefined;
  apiBaseUrl?: string | undefined;
  wsBaseUrl?: string | undefined;
  agentName?: string | undefined;
  agentType?: string | undefined;
  isMcp?: boolean | undefined;
  agentId?: string | undefined;
  tenantId?: string | undefined;
  daemon?: boolean | undefined;
  mcpPort?: number | undefined;
  pidFile?: string | undefined;
  runtimeCredential?: string | undefined;
}

function parseArgs(args: string[]): ParsedCliArgs {
  const config: ParsedCliArgs = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--invite" && i + 1 < args.length) {
      config.inviteToken = args[++i];
    } else if (arg === "--url" && i + 1 < args.length) {
      config.apiBaseUrl = args[++i];
    } else if (arg === "--ws-url" && i + 1 < args.length) {
      config.wsBaseUrl = args[++i];
    } else if (arg === "--name" && i + 1 < args.length) {
      config.agentName = args[++i];
    } else if (arg === "--type" && i + 1 < args.length) {
      config.agentType = args[++i];
    } else if (arg === "--mcp") {
      config.isMcp = true;
    } else if (arg === "--daemon") {
      config.daemon = true;
    } else if (arg === "--mcp-port" && i + 1 < args.length) {
      config.mcpPort = parseInt(args[++i] || "0", 10);
    } else if (arg === "--pid-file" && i + 1 < args.length) {
      config.pidFile = args[++i];
    } else if (arg === "--runtime-credential" && i + 1 < args.length) {
      config.runtimeCredential = args[++i];
    } else if (arg === "--agent-id" && i + 1 < args.length) {
      config.agentId = args[++i];
    } else if (arg === "--tenant-id" && i + 1 < args.length) {
      config.tenantId = args[++i];
    }
  }
  return config;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  // 1. Standalone stdio MCP bridge mode
  if (parsed.isMcp && !parsed.daemon) {
    const { runMcpStdioBridge } = await import("./mcpStdioBridge.js");
    const mcpOpts: { agentId?: string | undefined; tenantId?: string | undefined } = {};
    if (parsed.agentId !== undefined) mcpOpts.agentId = parsed.agentId;
    if (parsed.tenantId !== undefined) mcpOpts.tenantId = parsed.tenantId;
    await runMcpStdioBridge(mcpOpts);
    return;
  }

  // 2. Daemon Mode: Host MCP SSE server + background sidecar
  if (parsed.daemon) {
    const portToListen = parsed.mcpPort !== undefined && !isNaN(parsed.mcpPort) ? parsed.mcpPort : 0;
    const activeTransports = new Map<string, SSEServerTransport>();

    const server = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-agent-id, x-tenant-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && (url.pathname === "/sse" || url.pathname === "/v1/mcp/sse")) {
        const sseTransport = new SSEServerTransport("/messages", res);
        const mcpServer = new CloudOpsMcpServer({
          agentId: parsed.agentId || "ag_mcp_standalone",
          tenantId: parsed.tenantId || "ten_default_tenant"
        });
        activeTransports.set(sseTransport.sessionId, sseTransport);
        sseTransport.onclose = () => {
          activeTransports.delete(sseTransport.sessionId);
        };
        await mcpServer.connect(sseTransport);
        return;
      }

      if (req.method === "POST" && (url.pathname === "/messages" || url.pathname === "/v1/mcp/messages")) {
        const sessionId = url.searchParams.get("sessionId");
        const sseTransport = sessionId ? activeTransports.get(sessionId) : Array.from(activeTransports.values())[0];
        if (sseTransport) {
          await sseTransport.handlePostMessage(req, res);
          return;
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Session not found" }));
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", pid: process.pid, agentId: parsed.agentId }));
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    server.listen(portToListen, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : portToListen;
      const mcpSseUrl = `http://localhost:${actualPort}/sse`;

      if (parsed.pidFile) {
        try {
          fs.writeFileSync(parsed.pidFile, String(process.pid), "utf-8");
        } catch (err) {
          console.error(`[CloudOps Connector Daemon] Failed to write PID file: ${err}`);
        }
      }

      // Output JSON to stdout for process coordinator
      console.log(JSON.stringify({ mcpSseUrl, pid: process.pid, port: actualPort }));
    });

    let connector: CloudOpsConnector | null = null;
    const inviteToken = parsed.inviteToken || process.env.CLOUDOPS_INVITE_TOKEN;
    if (inviteToken) {
      const apiBaseUrl = parsed.apiBaseUrl || process.env.CLOUDOPS_URL || "http://localhost:3000";
      const wsBaseUrl = parsed.wsBaseUrl || apiBaseUrl.replace(/^http/, "ws");
      const agentName = parsed.agentName || process.env.AGENT_NAME || "hermes-agent";
      const agentType = parsed.agentType || process.env.AGENT_TYPE || "hermes";

      connector = new CloudOpsConnector({
        apiBaseUrl,
        wsBaseUrl,
        inviteToken,
        agentName,
        agentType,
        autoReconnect: true
      });

      connector.on("state_changed", (state) => {
        console.error(`[CloudOps Connector Daemon] State -> ${state}`);
      });
      connector.on("error", (err) => {
        console.error(`[CloudOps Connector Daemon] Error: ${err.message}`);
      });

      connector.startOnboardingAndConnect().catch((err) => {
        console.error(`[CloudOps Connector Daemon] Onboarding warning: ${err.message}`);
      });
    }

    const shutdown = async () => {
      console.error("\n[CloudOps Connector Daemon] Shutting down...");
      if (parsed.pidFile && fs.existsSync(parsed.pidFile)) {
        try {
          fs.unlinkSync(parsed.pidFile);
        } catch {
          // ignore
        }
      }
      server.close();
      if (connector) {
        try {
          await connector.disconnect("PROCESS_SHUTDOWN");
        } catch {
          // ignore
        }
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  // 3. Normal CLI Connector Execution
  const inviteToken = parsed.inviteToken || process.env.CLOUDOPS_INVITE_TOKEN;
  if (!inviteToken) {
    console.error("Error: Missing invite token. Specify --invite <token> or set CLOUDOPS_INVITE_TOKEN. (Or run with --mcp or --daemon)");
    process.exit(1);
  }

  const apiBaseUrl = parsed.apiBaseUrl || process.env.CLOUDOPS_URL || "http://localhost:3000";
  const wsBaseUrl = parsed.wsBaseUrl || apiBaseUrl.replace(/^http/, "ws");
  const agentName = parsed.agentName || process.env.AGENT_NAME || "hermes-agent";
  const agentType = parsed.agentType || process.env.AGENT_TYPE || "hermes";

  const connector = new CloudOpsConnector({
    apiBaseUrl,
    wsBaseUrl,
    inviteToken,
    agentName,
    agentType,
    autoReconnect: true
  });

  connector.on("state_changed", (state) => {
    console.log(`[CloudOps Connector] State -> ${state}`);
  });

  connector.on("manifest_discovered", (d) => {
    console.log(`[CloudOps Connector] Manifest discovered for tenant: ${d.tenantId}`);
  });

  connector.on("join_submitted", (d) => {
    console.log(`[CloudOps Connector] Join request submitted: ${d.joinRequestId}`);
  });

  connector.on("approval_granted", (d) => {
    console.log(`[CloudOps Connector] Operator approval granted for agent: ${d.agentId}`);
  });

  connector.on("connected", (d) => {
    console.log(`[CloudOps Connector] Connected to Gateway! Session: ${d.sessionId}`);
  });

  connector.on("error", (err) => {
    console.error(`[CloudOps Connector] Error: ${err.message}`);
  });

  const shutdown = async () => {
    console.log("\n[CloudOps Connector] Shutting down...");
    try {
      await connector.disconnect("PROCESS_SHUTDOWN");
    } catch {
      // Ignore
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    console.log(`[CloudOps Connector] Starting onboarding for agent '${agentName}'...`);
    await connector.startOnboardingAndConnect();
    console.log("[CloudOps Connector] Gateway session is active and healthy.");
  } catch (err: any) {
    console.error(`[CloudOps Connector] Failed to connect: ${err.message}`);
    process.exit(1);
  }
}

main();
