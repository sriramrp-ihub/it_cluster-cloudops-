import { RuntimeCredentialService } from "../packages/runtime/src/credentialService.js";
import { GatewayClient } from "../packages/connector/src/gatewayClient.js";
import { createLogger } from "@cloudops/shared";
import { getDatabase } from "../database/src/client.js";

const logger = createLogger("agent-daemon");

async function main() {
  const agentId = process.env.AGENT_ID || "ag_d14df3f8-4ed6-4e77-9c36-090214504123";
  const tenantId = process.env.TENANT_ID || "ten_default_tenant";
  const wsUrl = process.env.GATEWAY_WS_URL || "ws://127.0.0.1:3000/v1/gateway/ws";

  logger.info({ agentId, tenantId, wsUrl }, "Starting CloudOps Agent Daemon...");

  const db = getDatabase();
  const agent = await db
    .selectFrom("agents")
    .select(["id", "name", "type", "version", "runtime_protocol"])
    .where("id", "=", agentId)
    .where("tenant_id", "=", tenantId)
    .executeTakeFirst();

  if (!agent) {
    logger.error({ agentId, tenantId }, "Agent not found in database.");
    process.exit(1);
  }

  const credService = new RuntimeCredentialService();
  const issued = await credService.issueInitialCredential(tenantId, agentId);
  logger.info({ credentialId: issued.credentialId }, "Issued fresh runtime credential for daemon session");

  const client = new GatewayClient({
    wsUrl,
    agentId,
    runtimeInfo: {
      name: agent.name,
      version: agent.version,
      protocol: agent.runtime_protocol
    },
    autoReconnect: true,
    reconnectIntervalMs: 3000
  });

  client.on("connected", (session) => {
    logger.info({ sessionId: session.sessionId }, "Agent actively CONNECTED to CloudOps Gateway with live heartbeats");
  });

  client.on("heartbeat_ack", (msg) => {
    logger.debug({ timestamp: msg.timestamp }, "Heartbeat ACK received from Gateway");
  });

  client.on("disconnected", (info) => {
    logger.warn({ info }, "Agent disconnected from Gateway; reconnecting...");
  });

  client.on("error", (err) => {
    logger.error({ err }, "Gateway client error");
  });

  const auth = await client.connectWithRuntime(issued.secret);
  logger.info({ sessionId: auth.sessionId, agentName: agent.name }, "Successfully established persistent connection! Agent is now CONNECTED in UI.");

  const shutdown = async () => {
    logger.info("Graceful shutdown received, closing connection...");
    client.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "Failed to start agent daemon");
  process.exit(1);
});
