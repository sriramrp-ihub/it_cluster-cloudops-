import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CloudAccountService, isValidAwsRoleArn } from "@cloudops/adapters";
import { ValidationError } from "@cloudops/shared";
import { requireOperatorAuth } from "../middleware/auth.js";

const ConnectAwsBodySchema = z.object({
  provider: z.literal("aws", {
    errorMap: () => ({ message: "Only 'aws' provider is currently supported for connection" })
  }),
  region: z.string().trim().min(1, "AWS Region is required"),
  accessKeyId: z.string().trim().min(16, "AWS Access Key ID must be at least 16 characters").max(128),
  secretAccessKey: z.string().trim().min(16, "AWS Secret Access Key is required"),
  sessionToken: z.string().trim().optional(),
  assumeRoleArn: z
    .string()
    .trim()
    .refine((val) => !val || isValidAwsRoleArn(val), {
      message: "Invalid Assume Role ARN format. Expected: arn:aws:iam::<12-digit-account-id>:role/<role-name>"
    })
    .optional(),
  externalId: z.string().trim().optional()
});

export interface CloudAccountRouteOptions {
  cloudAccountService?: CloudAccountService | undefined;
}

export const cloudAccountRoutes: FastifyPluginAsync<CloudAccountRouteOptions> = async (fastify, opts) => {
  const service = opts.cloudAccountService || new CloudAccountService();

  /**
   * POST /v1/cloud-accounts
   * Connect and authenticate an AWS cloud account using temporary in-memory credentials.
   * Validates credentials against AWS STS GetCallerIdentity (and optional AssumeRole).
   * Safe account metadata is persisted in PostgreSQL.
   * Raw secrets are NEVER persisted, logged, or returned in response.
   */
  fastify.post("/v1/cloud-accounts", { preHandler: [requireOperatorAuth] }, async (request, reply) => {
    const operator = request.operator!;

    const parseResult = ConnectAwsBodySchema.safeParse(request.body || {});
    if (!parseResult.success) {
      throw new ValidationError(
        parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")
      );
    }

    const { region, accessKeyId, secretAccessKey, sessionToken, assumeRoleArn, externalId } = parseResult.data;

    const account = await service.connectAws({
      tenantId: operator.tenantId,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken: sessionToken || undefined,
      assumeRoleArn: assumeRoleArn || undefined,
      externalId: externalId || undefined
    });

    return reply.status(201).send({
      id: account.id,
      provider: account.provider,
      accountId: account.accountId,
      region: account.region,
      roleArn: account.roleArn,
      status: account.status,
      createdAt: account.createdAt.toISOString()
    });
  });

  /**
   * GET /v1/cloud-accounts
   * List all connected cloud accounts for the authenticated operator's tenant.
   * Returns only safe metadata.
   */
  fastify.get("/v1/cloud-accounts", { preHandler: [requireOperatorAuth] }, async (request, reply) => {
    const operator = request.operator!;

    const accounts = await service.listAccounts(operator.tenantId);

    const safeAccounts = accounts.map((acc) => ({
      id: acc.id,
      provider: acc.provider,
      accountId: acc.accountId,
      region: acc.region,
      roleArn: acc.roleArn,
      status: acc.status,
      createdAt: acc.createdAt.toISOString()
    }));

    return reply.status(200).send(safeAccounts);
  });

  /**
   * DELETE /v1/cloud-accounts/:id
   * Disconnect an AWS cloud account:
   * 1. Invalidates and clears the in-memory temporary session
   * 2. Deletes account record from database
   */
  fastify.delete<{ Params: { id: string } }>(
    "/v1/cloud-accounts/:id",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      const result = await service.disconnectAccount(operator.tenantId, id);

      return reply.status(200).send(result);
    }
  );

  /**
   * GET /v1/cloud-accounts/:id/workloads
   * Discover real running services, container tasks, and compute instances
   * using the temporary in-memory credentials from the active AWS session.
   * Does NOT expose any secrets.
   */
  fastify.get<{ Params: { id: string } }>(
    "/v1/cloud-accounts/:id/workloads",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      const result = await service.discoverWorkloads(operator.tenantId, id);

      return reply.status(200).send(result);
    }
  );
};
