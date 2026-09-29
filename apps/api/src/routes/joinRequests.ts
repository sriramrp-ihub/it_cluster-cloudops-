import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { JoinRequestService } from "@cloudops/onboarding";
import { requireOperatorAuth } from "../middleware/auth.js";
import { type JoinRequestId } from "@cloudops/shared";

const RejectBodySchema = z.object({
  reason: z.string().optional()
});

/** ADR-0007 Phase C1b: optional at approval time — omitted (the vast
 * majority of onboardings today) defaults to 'generalist' in
 * JoinRequestService.approveJoinRequest() itself. */
const ApproveBodySchema = z.object({
  role: z.enum(["generalist", "investigator", "verifier", "synthesizer"]).optional()
});

export const joinRequestRoutes: FastifyPluginAsync = async (fastify) => {
  const joinRequestService = new JoinRequestService();

  /**
   * GET /v1/agent-join-requests
   * Operator lists join requests for their tenant.
   */
  fastify.get<{ Querystring: { status?: string } }>(
    "/v1/agent-join-requests",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const items = await joinRequestService.listJoinRequests(operator.tenantId, request.query.status);
      return reply.status(200).send({ items });
    }
  );

  /**
   * POST /v1/agent-join-requests/:id/approve
   * Operator approves an agent join request, creating stable agent identity (ag_...).
   */
  fastify.post<{ Params: { id: string }; Body?: { role?: string } }>(
    "/v1/agent-join-requests/:id/approve",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      const parseResult = ApproveBodySchema.safeParse(request.body || {});
      if (!parseResult.success) {
        return reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: parseResult.error.issues[0]?.message || "Invalid role" }
        });
      }

      const result = await joinRequestService.approveJoinRequest(
        operator.tenantId,
        id as JoinRequestId,
        operator.operatorId,
        parseResult.data.role
      );

      return reply.status(200).send(result);
    }
  );

  /**
   * POST /v1/agent-join-requests/:id/reject
   * Operator rejects an agent join request.
   */
  fastify.post<{ Params: { id: string } }>(
    "/v1/agent-join-requests/:id/reject",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      const parseResult = RejectBodySchema.safeParse(request.body || {});
      const reason = parseResult.success ? parseResult.data.reason : undefined;

      await joinRequestService.rejectJoinRequest(
        operator.tenantId,
        id as JoinRequestId,
        operator.operatorId,
        reason
      );

      return reply.status(200).send({
        joinRequestId: id,
        status: "REJECTED"
      });
    }
  );
};
