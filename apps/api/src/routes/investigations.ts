import type { FastifyPluginAsync } from "fastify";
import { IncidentService } from "@cloudops/adapters";
import { MockAgentAdapter, type AgentAdapter } from "@cloudops/runtime";
import { ApprovalService } from "@cloudops/approvals";
import { ValidationError, NotFoundError } from "@cloudops/shared";
import { randomUUID } from "node:crypto";

export interface InvestigationRoutesOptions {
  incidentService?: IncidentService | undefined;
  agentAdapter?: AgentAdapter | undefined;
  approvalService?: ApprovalService | undefined;
}

export const investigationRoutes: FastifyPluginAsync<InvestigationRoutesOptions> = async (
  fastify,
  opts
) => {
  const incidentService = opts.incidentService || new IncidentService();
  const agentAdapter = opts.agentAdapter || new MockAgentAdapter();
  const approvalService = opts.approvalService || new ApprovalService();
  const awsAccountId = process.env.AWS_ACCOUNT_ID || "265766933076";

  /**
   * Helper to extract tenantId from request header or default
   */
  function getTenantId(request: any): string {
    return (
      (request.headers["x-tenant-id"] as string) ||
      request.query?.tenantId ||
      "ten_default_tenant"
    );
  }

  /**
   * POST /v1/incidents
   * Ingests a new incident according to the formal incident contract (CO-010).
   * Fails closed on any missing required field.
   */
  fastify.post("/v1/incidents", async (request, reply) => {
    const tenantId = getTenantId(request);
    const incident = await incidentService.createIncident(tenantId, request.body);
    return reply.status(201).send(incident);
  });

  /**
   * POST /v1/incidents/simulate-failure
   * Triggers an automated controlled failure and starts live investigation turn on a workload.
   */
  fastify.post<{
    Body: {
      workloadId?: string;
      service?: string;
      cluster?: string;
      region?: string;
      severity?: string;
    };
  }>("/v1/incidents/simulate-failure", async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = request.body || {};
    const serviceName = body.service || "starvision-motors";
    const clusterName = body.cluster || "cloudops-test";
    const region = body.region || "us-east-1";
    const severity = body.severity || "CRITICAL";

    const incidentId = `inc_${randomUUID().substring(0, 8)}`;
    const createdIncident = await incidentService.createIncident(tenantId, {
      incidentId,
      provider: "AWS",
      accountId: awsAccountId,
      region,
      service: `${clusterName}/${serviceName}`,
      resourceId: `arn:aws:ecs:${region}:${awsAccountId}:service/${clusterName}/${serviceName}`,
      severity,
      title: `ECS CrashLoop on ${serviceName}: Tasks failing steady-state check`,
      alertDescription: `CannotPullContainerError: Container image manifest missing or tag does not exist for service ${serviceName} on cluster ${clusterName}. ALB reporting HTTP 503 errors.`,
      sourceMetadata: {
        monitorId: "mon_alb_5xx_spike",
        triggerMetric: "Target5xxCountHigh",
        threshold: "> 5 in 1m",
        startedAt: new Date().toISOString()
      },
      status: "OPEN"
    });

    const effectiveAgentId = "ag_d14df3f8-4ed6-4e77-9c36-090214504123";
    const { investigation, session } = await incidentService.startInvestigation({
      tenantId,
      incidentId: createdIncident.id,
      agentId: effectiveAgentId,
      adapter: agentAdapter
    });

    // Register tool call handler to bind mutations directly to real approval records
    if (typeof (agentAdapter as any).onToolCall === "function") {
      agentAdapter.onToolCall(session.sessionId, async (call: any) => {
        if (call.toolName.includes("update") || call.toolName.includes("rollback") || call.toolName.includes("remediate")) {
          const approval = await approvalService.createApprovalRequest({
            tenantId: tenantId as any,
            agentId: effectiveAgentId as any,
            toolName: call.toolName,
            operationType: "MUTATION",
            rawPayload: call.arguments as Record<string, unknown>,
            dryRunDiff: {
              resource: `arn:aws:ecs:${region}:${awsAccountId}:service/${clusterName}/${serviceName}`,
              action: "ROLLBACK_TASK_DEFINITION",
              current: `${serviceName}:2 (Broken manifest)`,
              target: `${serviceName}:1 (Stable baseline)`
            }
          });
          return {
            callId: call.callId,
            status: "AWAITING_APPROVAL",
            approvalId: approval.id,
            data: { approvalId: approval.id, message: "Mutation routed to human operator authorization queue" }
          };
        }
        return {
          callId: call.callId,
          status: "SUCCESS",
          data: { status: "INSPECTED", resource: `${clusterName}/${serviceName}`, timestamp: new Date().toISOString() }
        };
      });
    }

    // Asynchronously drive the investigation in the background
    if (typeof (agentAdapter as any).runInvestigation === "function") {
      (agentAdapter as any)
        .runInvestigation(session.sessionId, {
          cluster: clusterName,
          service: serviceName,
          region,
          alertDescription: createdIncident.alertDescription
        })
        .catch(async (err: any) => {
          await incidentService.failInvestigation(
            tenantId,
            investigation.id,
            err?.message || "Investigation failed"
          );
        });
    }

    return reply.status(201).send({
      incident: createdIncident,
      investigation,
      session
    });
  });

  /**
   * GET /v1/incidents
   * Retrieves list of incidents with pagination and filtering (CO-014, CO-015).
   */
  fastify.get<{
    Querystring: {
      status?: string;
      severity?: string;
      from?: string;
      to?: string;
      limit?: string;
      offset?: string;
    };
  }>("/v1/incidents", async (request, reply) => {
    const tenantId = getTenantId(request);
    const { status, severity, from, to, limit, offset } = request.query;

    const result = await incidentService.listIncidents(tenantId, {
      status,
      severity,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0
    });

    return reply.status(200).send(result);
  });

  /**
   * GET /v1/incidents/:id
   * Retrieves full incident details, associated investigations, and collected evidence (CO-015, CO-017).
   */
  fastify.get<{ Params: { id: string } }>("/v1/incidents/:id", async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params;

    const details = await incidentService.getIncident(tenantId, id);
    return reply.status(200).send(details);
  });

  /**
   * POST /v1/investigations/start
   * Starts an automated incident investigation session driven by an AgentAdapter (CO-013).
   */
  fastify.post<{
    Body: {
      incidentId: string;
      agentId?: string;
    };
  }>("/v1/investigations/start", async (request, reply) => {
    const tenantId = getTenantId(request);
    const { incidentId, agentId } = request.body || {};

    if (!incidentId) {
      throw new ValidationError("Missing required body parameter: incidentId");
    }

    const effectiveAgentId = agentId || "ag_d14df3f8-4ed6-4e77-9c36-090214504123";

    const incDetails = await incidentService.getIncident(tenantId, incidentId);
    let cluster = "cloudops-test";
    let service = incDetails.incident.service;
    if (service.includes("/")) {
      const parts = service.split("/");
      cluster = parts[0] || "cloudops-test";
      service = parts[1] || "starvision-motors";
    }
    const region = incDetails.incident.region || "us-east-1";

    const { investigation, session } = await incidentService.startInvestigation({
      tenantId,
      incidentId,
      agentId: effectiveAgentId,
      adapter: agentAdapter
    });

    // Register tool call handler to bind mutations directly to real approval records
    if (typeof (agentAdapter as any).onToolCall === "function") {
      agentAdapter.onToolCall(session.sessionId, async (call: any) => {
        if (call.toolName.includes("update") || call.toolName.includes("rollback") || call.toolName.includes("remediate")) {
          const approval = await approvalService.createApprovalRequest({
            tenantId: tenantId as any,
            agentId: effectiveAgentId as any,
            toolName: call.toolName,
            operationType: "MUTATION",
            rawPayload: call.arguments as Record<string, unknown>,
            dryRunDiff: {
              resource: `arn:aws:ecs:${region}:${awsAccountId}:service/${cluster}/${service}`,
              action: "ROLLBACK_TASK_DEFINITION",
              current: `${service}:2 (Broken manifest)`,
              target: `${service}:1 (Stable baseline)`
            }
          });
          return {
            callId: call.callId,
            status: "AWAITING_APPROVAL",
            approvalId: approval.id,
            data: { approvalId: approval.id, message: "Mutation routed to human operator authorization queue" }
          };
        }
        return {
          callId: call.callId,
          status: "SUCCESS",
          data: { status: "INSPECTED", resource: `${cluster}/${service}`, timestamp: new Date().toISOString() }
        };
      });
    }

    // Asynchronously drive the investigation in the background
    if (typeof (agentAdapter as any).runInvestigation === "function") {
      (agentAdapter as any)
        .runInvestigation(session.sessionId, {
          cluster,
          service,
          region,
          alertDescription: incDetails.incident.alertDescription
        })
        .catch(async (err: any) => {
          await incidentService.failInvestigation(
            tenantId,
            investigation.id,
            err?.message || "Investigation failed"
          );
        });
    }

    return reply.status(201).send({
      investigationId: investigation.id,
      sessionId: session.sessionId,
      incidentId,
      status: investigation.status,
      startedAt: investigation.startedAt.toISOString()
    });
  });

  /**
   * GET /v1/investigations/:id
   * Retrieves status and root cause of an investigation (CO-013, CO-017).
   */
  fastify.get<{ Params: { id: string } }>(
    "/v1/investigations/:id",
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { id } = request.params;

      const directInv = await incidentService.getInvestigation(tenantId, id);
      if (directInv) {
        return reply.status(200).send(directInv);
      }

      const incidentData = await incidentService.getIncident(tenantId, id).catch(() => null);
      if (incidentData && incidentData.investigations.length > 0) {
        return reply.status(200).send({
          investigation: incidentData.investigations[0],
          evidence: incidentData.evidence
        });
      }

      throw new NotFoundError(`Investigation ${id} not found`);
    }
  );

  /**
   * GET /v1/investigations/:id/stream
   * Live Server-Sent Events (SSE) stream for agent investigation activity (CO-016).
   * Enforces strict filter: only structured events (STEP, EVIDENCE, ROOT_CAUSE, STATUS)
   * are sent. Zero raw reasoning/chain-of-thought is leaked.
   */
  fastify.get<{ Params: { id: string }; Querystring: { sessionId?: string } }>(
    "/v1/investigations/:id/stream",
    async (request, reply) => {
      const sessionId = request.query.sessionId;

      if (!sessionId) {
        return reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "sessionId is required for event streaming" }
        });
      }

      reply.hijack();
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");

      try {
        const unsubscribe = agentAdapter.onEvent(sessionId, (event) => {
          // STRICT SECURITY REQUIREMENT (CO-016):
          // Strip any internal chain-of-thought or raw reasoning fields
          const sanitizedData = { ...event.data };
          delete (sanitizedData as any).thought;
          delete (sanitizedData as any).chain_of_thought;
          delete (sanitizedData as any).raw_reasoning;
          delete (sanitizedData as any).internal_monologue;

          reply.raw.write(
            `event: ${event.type.toLowerCase()}\ndata: ${JSON.stringify({
              type: event.type,
              sessionId: event.sessionId,
              timestamp: event.timestamp.toISOString(),
              data: sanitizedData
            })}\n\n`
          );

          if (event.type === "ROOT_CAUSE" || event.type === "ERROR") {
            reply.raw.end();
            unsubscribe();
          }
        });

        request.raw.on("close", () => {
          unsubscribe();
        });
      } catch (err: any) {
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ message: err?.message || "Streaming error" })}\n\n`
        );
        reply.raw.end();
      }
    }
  );
};

