#!/usr/bin/env tsx
import { MockAgentAdapter } from "./mockAgentAdapter.js";
import { createLogger } from "@cloudops/shared";

const logger = createLogger("mock-agent-cli");

async function main() {
  const tenantId = process.env.MOCK_AGENT_TENANT_ID || "ten_default_tenant";
  const agentId = process.env.MOCK_AGENT_AGENT_ID || "ag_mock_operator";
  const latencyMs = process.env.MOCK_AGENT_LATENCY_MS
    ? parseInt(process.env.MOCK_AGENT_LATENCY_MS, 10)
    : 0;

  logger.info({ tenantId, agentId, latencyMs }, "Starting Mock Agent Adapter process");

  const adapter = new MockAgentAdapter({
    simulatedLatencyMs: latencyMs
  });

  const session = await adapter.start({ tenantId, agentId });
  logger.info({ sessionId: session.sessionId }, "Session started successfully");

  adapter.onEvent(session.sessionId, (event) => {
    logger.info({ eventType: event.type, data: event.data }, "Mock Agent Event emitted");
  });

  logger.info("Executing default ECS incident investigation scenario...");
  const rootCause = await adapter.runInvestigation(session.sessionId);
  logger.info({ rootCause }, "Investigation completed with root-cause analysis");

  logger.info("Proposing rollback remediation...");
  const proposal = await adapter.proposeRemediation(session.sessionId);
  logger.info({ proposal }, "Remediation proposed; awaiting operator approval");

  await adapter.terminate(session.sessionId, "SCENARIO_RUN_FINISHED");
  logger.info("Mock Agent session terminated cleanly");
}

main().catch((err) => {
  logger.error({ err }, "Mock Agent process failed");
  process.exit(1);
});
