import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { createLogger, formatErrorResponse, sanitizeLogString } from "@cloudops/shared";
import { closeDatabase, runMigrations } from "@cloudops/database";
import { config } from "./config.js";
import { healthRoutes } from "./routes/health.js";
import { inviteRoutes } from "./routes/invites.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { joinRequestRoutes } from "./routes/joinRequests.js";
import { agentRoutes } from "./routes/agents.js";
import { gatewayRoutes } from "./routes/gateway.js";
import { cloudAccountRoutes } from "./routes/cloudAccounts.js";
import { mcpRoutes } from "./routes/mcp.js";
import { approvalRoutes } from "./routes/approvals.js";
import { investigationRoutes } from "./routes/investigations.js";
import { CloudAccountService, IncidentService } from "@cloudops/adapters";
import { GatewayHandler } from "@cloudops/gateway";
import { ApprovalService } from "@cloudops/approvals";
import { HermesAgentAdapter, type AgentAdapter } from "@cloudops/runtime";
import fastifyWebsocket from "@fastify/websocket";

const apiLogger = createLogger("cloudops-api", {
  serializers: {
    req(req: any) {
      return {
        method: req.method,
        url: sanitizeLogString(req.url || ""),
        headers: req.headers,
        remoteAddress: req.socket?.remoteAddress,
        remotePort: req.socket?.remotePort
      };
    }
  }
});

export interface BuildAppOptions {
  gatewayHandler?: GatewayHandler | undefined;
  startHeartbeatMonitor?: boolean | undefined;
  cloudAccountService?: CloudAccountService | undefined;
  approvalService?: ApprovalService | undefined;
  incidentService?: IncidentService | undefined;
  agentAdapter?: AgentAdapter | undefined;
}

export function buildApp(opts: BuildAppOptions = {}) {
  const app = Fastify({
    loggerInstance: apiLogger,
    genReqId: () => `req_${randomUUID()}`
  });

  const gatewayHandler = opts.gatewayHandler || new GatewayHandler();
  const approvalService = opts.approvalService || new ApprovalService();
  const agentAdapter = opts.agentAdapter || new HermesAgentAdapter({ enableLiveInference: true });

  if (opts.startHeartbeatMonitor !== false) {
    gatewayHandler.connectionManager.startHeartbeatMonitor(10000, 30000);
  }

  // Graceful shutdown of gateway sessions on app close
  app.addHook("onClose", async () => {
    await gatewayHandler.connectionManager.shutdown();
  });

  // Enable CORS
  app.register(cors, {
    origin: [config.CORS_ORIGIN, "http://localhost:3000", "http://localhost:3001"],
    credentials: true
  });

  // Register WebSocket plugin
  app.register(fastifyWebsocket);

  // Register Routes
  app.register(healthRoutes);
  app.register(inviteRoutes);
  app.register(onboardingRoutes);
  app.register(joinRequestRoutes);
  app.register(agentRoutes, { agentAdapter });
  app.register(gatewayRoutes, { gatewayHandler });
  app.register(cloudAccountRoutes, { cloudAccountService: opts.cloudAccountService });
  app.register(mcpRoutes, { approvalService });
  app.register(approvalRoutes, { approvalService });
  app.register(investigationRoutes, {
    incidentService: opts.incidentService,
    agentAdapter,
    approvalService,
    cloudAccountService: opts.cloudAccountService
  });

  // Global Error Handler: safely formats all errors without leaking stack traces or secrets
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, reqId: request.id }, "Request error encountered");
    const { statusCode, payload } = formatErrorResponse(error);
    return reply.status(statusCode).send(payload);
  });

  // 404 handler
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `Route ${request.method}:${request.url} not found`
      }
    });
  });

  return app;
}

export async function start() {
  try {
    // Ensure migrations and default seeds are applied on startup
    await runMigrations();
  } catch (migErr) {
    apiLogger.warn({ migErr }, "Auto-migration check skipped or failed on startup");
  }

  const app = buildApp();

  const handleShutdown = async (signal: string) => {
    app.log.info({ signal }, "Initiating graceful shutdown...");
    try {
      await app.close();
      await closeDatabase();
      app.log.info("Shutdown completed successfully.");
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "Error during graceful shutdown");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  try {
    await app.listen({ port: config.API_PORT, host: config.API_HOST });
    app.log.info(`CloudOps API server running at http://${config.API_HOST}:${config.API_PORT}`);
    return app;
  } catch (err) {
    app.log.fatal({ err }, "Failed to start CloudOps API server");
    process.exit(1);
  }
}

// Start if executed directly
if (process.env["NODE_ENV"] !== "test" && process.argv[1]?.includes("server")) {
  start();
}
