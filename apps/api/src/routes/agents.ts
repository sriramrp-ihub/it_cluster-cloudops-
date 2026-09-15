import type { FastifyPluginAsync } from "fastify";
import { AgentService } from "@cloudops/identity";
import { requireOperatorAuth } from "../middleware/auth.js";

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  const agentService = new AgentService();

  /**
   * GET /v1/agents
   * Operator lists all registered agents for their tenant.
   */
  fastify.get("/v1/agents", { preHandler: [requireOperatorAuth] }, async (request, reply) => {
    const operator = request.operator!;

    const agents = await agentService.listAgents(operator.tenantId);

    return reply.status(200).send({
      items: agents.map((agent) => ({
        id: agent.id,
        tenantId: agent.tenantId,
        name: agent.name,
        type: agent.type,
        version: agent.version,
        runtimeProtocol: agent.runtimeProtocol,
        status: agent.status,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString()
      }))
    });
  });

  /**
   * GET /v1/agents/:id
   * Operator retrieves a single agent by ID.
   */
  fastify.get<{ Params: { id: string } }>(
    "/v1/agents/:id",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      const agent = await agentService.getAgent(operator.tenantId, id as any);

      return reply.status(200).send({
        id: agent.id,
        tenantId: agent.tenantId,
        name: agent.name,
        type: agent.type,
        version: agent.version,
        runtimeProtocol: agent.runtimeProtocol,
        status: agent.status,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString()
      });
    }
  );
};
