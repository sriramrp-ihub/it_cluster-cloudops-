import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ManifestService, JoinRequestService, ClaimService } from "@cloudops/onboarding";
import { ValidationError } from "@cloudops/shared";

const JoinRequestSchema = z.object({
  agent: z.object({
    name: z.string().min(1, "Agent name is required"),
    type: z.string().min(1, "Agent type is required")
  }),
  runtime: z.object({
    name: z.string().min(1, "Runtime name is required"),
    version: z.string().min(1, "Runtime version is required"),
    protocol: z.string().optional(),
    endpoint: z.string().optional()
  }),
  requestedCapabilities: z.array(z.string()).optional().default([])
});

const ClaimCredentialSchema = z.object({
  inviteToken: z.string().min(1, "inviteToken is required"),
  joinRequestId: z.string().min(1, "joinRequestId is required")
});

export const onboardingRoutes: FastifyPluginAsync = async (fastify) => {
  const manifestService = new ManifestService();
  const joinRequestService = new JoinRequestService();
  const claimService = new ClaimService();

  /**
   * GET /v1/onboarding/:token
   * Resolves invite token and serves the machine-readable onboarding manifest.
   */
  fastify.get<{ Params: { token: string } }>("/v1/onboarding/:token", async (request, reply) => {
    const { token } = request.params;
    const manifest = await manifestService.getManifest(token);
    return reply.status(200).send(manifest);
  });

  /**
   * POST /v1/onboarding/:token/join
   * Agent submits a declarative join request declaring its identity and requested capabilities.
   */
  fastify.post<{ Params: { token: string } }>("/v1/onboarding/:token/join", async (request, reply) => {
    const { token } = request.params;

    const parseResult = JoinRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError(
        parseResult.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ")
      );
    }

    const result = await joinRequestService.submitJoinRequest(token, parseResult.data);
    return reply.status(201).send(result);
  });

  /**
   * POST /v1/onboarding/claim
   * Agent claims one-time bootstrap credential after operator approval.
   * Atomic consumption guaranteed by PostgreSQL row locking.
   */
  fastify.post("/v1/onboarding/claim", async (request, reply) => {
    const parseResult = ClaimCredentialSchema.safeParse(request.body);
    if (!parseResult.success) {
      throw new ValidationError(
        parseResult.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ")
      );
    }

    const result = await claimService.claimBootstrapCredential(parseResult.data);
    return reply.status(200).send(result);
  });
};
