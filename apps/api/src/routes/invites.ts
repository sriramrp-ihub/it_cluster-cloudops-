import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { InviteService } from "@cloudops/onboarding";
import { requireOperatorAuth } from "../middleware/auth.js";
import { ValidationError } from "@cloudops/shared";
import { config } from "../config.js";

const CreateInviteBodySchema = z.object({
  expiresInSeconds: z.number().int().positive().optional(),
  ttlSeconds: z.number().int().positive().optional(),
  agentName: z.string().trim().min(1).max(128).optional(),
  agentType: z.enum(["hermes", "openclaw", "custom"]).or(z.string().trim().min(1).max(64)).optional().default("hermes"),
  instructions: z.string().trim().max(4000).optional()
}).transform((data) => ({
  expiresInSeconds: data.ttlSeconds ?? data.expiresInSeconds ?? 86400,
  agentName: data.agentName,
  agentType: data.agentType,
  instructions: data.instructions
}));

export const inviteRoutes: FastifyPluginAsync = async (fastify) => {
  const inviteService = new InviteService();

  /**
   * POST /v1/agent-invites
   * Operator creates an onboarding invitation token and complete onboarding prompt.
   * The raw invite token (co_inv_...) is returned ONCE and stored as a hash.
   */
  fastify.post("/v1/agent-invites", { preHandler: [requireOperatorAuth] }, async (request, reply) => {
    const operator = request.operator!;

    const parseResult = CreateInviteBodySchema.safeParse(request.body || {});
    if (!parseResult.success) {
      throw new ValidationError(
        parseResult.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ")
      );
    }

    const { expiresInSeconds, agentName, agentType, instructions } = parseResult.data;

    // Derive server URLs from incoming request or configuration
    const host = request.headers.host || `${config.API_HOST === "0.0.0.0" ? "localhost" : config.API_HOST}:${config.API_PORT}`;
    const protocol = request.protocol || "http";
    const wsProtocol = protocol === "https" ? "wss" : "ws";
    const apiBaseUrl = `${protocol}://${host}`;
    const wsBaseUrl = `${wsProtocol}://${host}`;

    const result = await inviteService.createInvite(
      operator.tenantId,
      operator.operatorId,
      expiresInSeconds,
      {
        agentName,
        agentType,
        instructions,
        apiBaseUrl,
        wsBaseUrl
      }
    );

    return reply.status(201).send(result);
  });
};
