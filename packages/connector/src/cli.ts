#!/usr/bin/env node
import { CloudOpsConnector } from "./connector.js";
import type { ConnectorConfig } from "./types.js";

interface ParsedCliArgs {
  inviteToken?: string | undefined;
  apiBaseUrl?: string | undefined;
  wsBaseUrl?: string | undefined;
  agentName?: string | undefined;
  agentType?: string | undefined;
  isMcp?: boolean | undefined;
  agentId?: string | undefined;
  tenantId?: string | undefined;
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

  if (parsed.isMcp) {
    const { runMcpStdioBridge } = await import("./mcpStdioBridge.js");
    const mcpOpts: { agentId?: string | undefined; tenantId?: string | undefined } = {};
    if (parsed.agentId !== undefined) mcpOpts.agentId = parsed.agentId;
    if (parsed.tenantId !== undefined) mcpOpts.tenantId = parsed.tenantId;
    await runMcpStdioBridge(mcpOpts);
    return;
  }

  const inviteToken = parsed.inviteToken || process.env.CLOUDOPS_INVITE_TOKEN;
  if (!inviteToken) {
    console.error("Error: Missing invite token. Specify --invite <token> or set CLOUDOPS_INVITE_TOKEN. (Or run with --mcp for MCP Server mode)");
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

  connector.on("heartbeat_ack", (d) => {
    // Heartbeat received
  });

  connector.on("error", (err) => {
    console.error(`[CloudOps Connector] Error: ${err.message}`);
  });

  // Handle graceful shutdown
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
