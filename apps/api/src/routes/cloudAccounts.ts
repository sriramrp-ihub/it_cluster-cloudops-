import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CloudAccountService, isValidAwsRoleArn } from "@cloudops/adapters";
import { ValidationError } from "@cloudops/shared";
import { findCanonicalTool } from "@cloudops/tools";
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

  /**
   * GET /v1/cloud-accounts/:id/ecs-service-detail
   * Real, live drill-down for a single ECS service, for the operator-facing
   * Infrastructure detail view. Calls the SAME canonical tool handlers used
   * everywhere else (aws_ecs_describe_services, aws_ecs_describe_task_definition_config,
   * aws_ecs_describe_tasks, aws_alb_get_target_health, aws_cloudwatch_get_metric_data)
   * directly — NOT through the MCP/agent tool-call or approval path, since this
   * is an authenticated operator reading real infrastructure state, not an
   * agent investigation. Every section is fetched independently so one
   * section's real AWS error (e.g. no permission, no load balancer) never
   * blanks out the others.
   */
  fastify.get<{ Params: { id: string }; Querystring: { cluster?: string; service?: string; region?: string } }>(
    "/v1/cloud-accounts/:id/ecs-service-detail",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id: cloudAccountId } = request.params;
      const { cluster, service, region } = request.query;

      if (!cluster || !service) {
        throw new ValidationError("Query parameters 'cluster' and 'service' are required");
      }
      const resolvedRegion = region || "us-east-1";
      const ctx = { agentId: "infrastructure-detail-view", tenantId: operator.tenantId };

      const callTool = async (name: string, args: Record<string, unknown>) => {
        const tool = findCanonicalTool(name);
        if (!tool) {
          return { error: `Canonical tool '${name}' not found in registry`, code: "TOOL_NOT_FOUND" };
        }
        try {
          // Tool handlers are only ever invoked with SDK/MCP-validated input in
          // every other entry point (the MCP SDK applies each tool's zod schema,
          // including its defaults like period/lookbackMinutes, before calling
          // the handler) — calling tool.handler() directly here would skip that
          // and silently pass `undefined` for any field the caller doesn't set,
          // so parse through the same schema first to get the same real behavior.
          const parsedInput = tool.inputSchema.parse({ ...args, cluster, service, region: resolvedRegion, cloudAccountId });
          return await tool.handler(parsedInput, ctx);
        } catch (err: any) {
          // Every canonical tool handler already catches its own AWS errors
          // and returns them as data — this only guards against a truly
          // unexpected throw (e.g. a programming error), so this view can
          // never break entirely because of one failed section.
          return { error: err?.message || `${name} failed unexpectedly`, code: err?.name || "UNEXPECTED_ERROR" };
        }
      };

      const [serviceDetail, taskDefinition, tasks, targetHealth, cpuMetric, memoryMetric, imageCheck] = await Promise.all([
        callTool("aws_ecs_describe_services", { services: [service] }),
        callTool("aws_ecs_describe_task_definition_config", {}),
        callTool("aws_ecs_describe_tasks", {}),
        callTool("aws_alb_get_target_health", {}),
        callTool("aws_cloudwatch_get_metric_data", { metricName: "CPUUtilization", namespace: "AWS/ECS" }),
        callTool("aws_cloudwatch_get_metric_data", { metricName: "MemoryUtilization", namespace: "AWS/ECS" }),
        callTool("aws_ecr_describe_images", {})
      ]);

      return reply.status(200).send({
        cluster,
        service,
        region: resolvedRegion,
        serviceDetail,
        taskDefinition,
        tasks,
        targetHealth,
        metrics: { cpu: cpuMetric, memory: memoryMetric },
        imageCheck,
        fetchedAt: new Date().toISOString()
      });
    }
  );
};
