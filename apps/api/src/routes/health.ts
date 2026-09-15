import type { FastifyPluginAsync } from "fastify";
import { checkDatabaseHealth } from "@cloudops/database";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Liveness probe: verifies that the HTTP server process is running and responding.
   */
  fastify.get("/healthz", async (_request, reply) => {
    return reply.status(200).send({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  /**
   * Readiness probe: checks required dependencies (PostgreSQL).
   * Reports truthfully: returns 503 if PostgreSQL is unavailable.
   */
  fastify.get("/readyz", async (_request, reply) => {
    const isDbHealthy = await checkDatabaseHealth();

    if (!isDbHealthy) {
      return reply.status(503).send({
        status: "not_ready",
        timestamp: new Date().toISOString(),
        dependencies: {
          database: "unreachable"
        }
      });
    }

    return reply.status(200).send({
      status: "ready",
      timestamp: new Date().toISOString(),
      dependencies: {
        database: "connected"
      }
    });
  });
};
