import type { FastifyPluginAsync } from "fastify";
import { IncidentService, CloudAccountService, RunService, ToolExecutionService } from "@cloudops/adapters";
import { getDatabase } from "@cloudops/database";
import { createAgentAdapter, recordAuditEvent, extractJsonFromLlmOutput, type AgentAdapter } from "@cloudops/runtime";
import { ApprovalService } from "@cloudops/approvals";
import { AgentService } from "@cloudops/identity";
import { CANONICAL_TOOLS, captureSnapshotForRevert } from "@cloudops/tools";
import { PolicyEngine, BlastRadiusSimulator } from "@cloudops/policy";
import { TenantService } from "@cloudops/auth";
import { ValidationError, NotFoundError } from "@cloudops/shared";
import { randomUUID } from "node:crypto";
import { resolveAuthorizedCapabilities } from "../lib/resolveAuthorizedCapabilities.js";

/**
 * Alertmanager's `severity` label is free text convention (commonly
 * "critical"/"page", "warning", "info"), not the fixed enum CloudOps's own
 * IncidentContext requires (CRITICAL/HIGH/MEDIUM/LOW per
 * validateIncidentContext in @cloudops/shared) — this maps one onto the
 * other instead of passing the label through and failing incident creation
 * on an unrecognized value.
 */
function mapAlertmanagerSeverity(label: string | undefined): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  switch ((label || "").toLowerCase()) {
    case "critical":
    case "page":
      return "CRITICAL";
    case "warning":
      return "HIGH";
    case "info":
    case "notice":
      return "LOW";
    default:
      return "MEDIUM";
  }
}

export interface InvestigationRoutesOptions {
  incidentService?: IncidentService | undefined;
  agentAdapter?: AgentAdapter | undefined;
  approvalService?: ApprovalService | undefined;
  agentService?: AgentService | undefined;
  cloudAccountService?: CloudAccountService | undefined;
  policyEngine?: PolicyEngine | undefined;
  runService?: RunService | undefined;
  toolExecutionService?: ToolExecutionService | undefined;
  tenantService?: TenantService | undefined;
}

export const investigationRoutes: FastifyPluginAsync<InvestigationRoutesOptions> = async (
  fastify,
  opts
) => {
  const incidentService = opts.incidentService || new IncidentService();
  // NOTE: this single adapter instance is shared across every investigation this
  // plugin drives, regardless of which agent triggered it, because the
  // /v1/investigations/:id/stream endpoint below looks up sessions on this same
  // instance by sessionId. Fully keying adapter selection on each agent's own
  // registered type would require session-ownership-aware routing across
  // multiple concrete adapters — real additional work, called out in the audit
  // rather than built speculatively here. The default below still resolves
  // through the extensible registry (createAgentAdapter) instead of a
  // hardcoded class import, so a differently-typed default can be swapped in
  // globally without touching this route.
  const agentAdapter = opts.agentAdapter || createAgentAdapter("hermes", { enableLiveInference: true });
  const approvalService = opts.approvalService || new ApprovalService();
  const agentService = opts.agentService || new AgentService();
  const cloudAccountService = opts.cloudAccountService || new CloudAccountService();
  const policyEngine = opts.policyEngine || new PolicyEngine();
  const runService = opts.runService || new RunService();
  const toolExecutionService = opts.toolExecutionService || new ToolExecutionService();
  const tenantService = opts.tenantService || new TenantService();

  /**
   * Dynamically resolves the effective agent to dispatch for this investigation session
   */
  async function resolveEffectiveAgent(
    tenantId: string,
    requestedAgentId?: string
  ): Promise<{ id: string; name: string; type: string; hermesProfileName: string | null; governanceStatus: string }> {
    if (requestedAgentId) {
      try {
        const agent = await agentService.getAgent(tenantId, requestedAgentId as any);
        if (agent) {
          return {
            id: agent.id,
            name: agent.name,
            type: agent.type,
            hermesProfileName: agent.hermesProfileName,
            governanceStatus: agent.governanceStatus
          };
        }
      } catch {
        // Fall back to tenant agent discovery
      }
    }

    const agents = await agentService.listAgents(tenantId);
    const active = agents.find((a) => a.status === "CONNECTED") || agents[0];
    if (active) {
      return {
        id: active.id,
        name: active.name,
        type: active.type,
        hermesProfileName: active.hermesProfileName,
        governanceStatus: active.governanceStatus
      };
    }

    const fallbackId = requestedAgentId || "ag_autonomous_sre";
    const fallbackName = "CloudOps Autonomous SRE";
    const fallbackType = "hermes";

    // Phase 3.5: runs/tool_executions FK-reference agents(id). No agent is
    // onboarded yet for this tenant, so persist the synthetic fallback as a
    // real (unmanaged) agent row rather than letting the FK reject every
    // write downstream of an investigation nothing has actually onboarded.
    const db = getDatabase();
    await db
      .insertInto("agents")
      .values({
        id: fallbackId,
        tenant_id: tenantId,
        name: fallbackName,
        type: fallbackType,
        version: "0.0.0",
        runtime_protocol: "acp",
        status: "CONNECTED"
      } as any)
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();

    return { id: fallbackId, name: fallbackName, type: fallbackType, hermesProfileName: null, governanceStatus: "PENDING" };
  }

  /**
   * ADR-0008 Phase A: points the shared adapter instance's inference calls
   * at this agent's own governed Hermes profile, ONLY when that profile is
   * independently on record as LOCKED_DOWN — an agent with no provisioned
   * profile, or one that failed lockdown, falls back to the adapter's
   * existing shared/default-profile behavior exactly as before this ADR,
   * rather than risk invoking `-p <profile>` against a profile that was
   * never safely locked down (or doesn't exist at all).
   */
  function applyGovernedProfile(effectiveAgent: { hermesProfileName: string | null; governanceStatus: string }): void {
    (agentAdapter as any).hermesProfileName =
      effectiveAgent.governanceStatus === "LOCKED_DOWN" ? effectiveAgent.hermesProfileName ?? undefined : undefined;
  }

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
   * Builds an active tool call execution handler that connects agent tool calls
   * directly to canonical AWS SDK commands and registers mutations into the Approvals service.
   *
   * Every call is routed through the same PolicyEngine.evaluate() choke point the
   * MCP tool-serving path uses (packages/tools/src/mcpServer.ts) — IaC gate, DefenseClaw,
   * and scope fencing all run here too, before an approval ticket is ever created.
   *
   * Phase 3.5: every call is also persisted to tool_executions — what was
   * called, why (call.reasoning, if the driving adapter supplied one), what
   * evidence justified it (call.evidenceRefs), and the outcome — captured at
   * the moment of the call, not reconstructed from the final summary.
   */
  function buildToolCallHandler(
    tenantId: string,
    effectiveAgentId: string,
    runId: string,
    _cluster: string,
    _service: string,
    _region: string,
    _effectiveAccountId: string,
    options: { readOnlyOnly?: boolean | undefined } = {}
  ) {
    return async (call: any) => {
      const startedAt = Date.now();
      // Phase 3.6: every governed decision — not just approval-gated ones —
      // gets an audit_events row threaded by run_id, alongside the
      // tool_executions row. Together with approvals.run_id (already
      // threaded at creation), a single run_id join across all three tables
      // reconstructs the full action trace (RunService.getFullTrace).
      const record = (status: string, outputPayload: unknown, errorMessage?: string) => {
        const auditPayload: Record<string, unknown> = {
          toolName: call.toolName,
          verdict: status
        };
        if (outputPayload && typeof outputPayload === "object") {
          const o = outputPayload as Record<string, unknown>;
          if ("ruleId" in o) auditPayload.ruleId = o.ruleId;
          if ("reason" in o) auditPayload.reason = o.reason;
        }
        if (errorMessage) auditPayload.errorMessage = errorMessage;

        return Promise.all([
          toolExecutionService
            .recordExecution({
              runId,
              agentId: effectiveAgentId,
              toolName: call.toolName,
              inputPayload: call.arguments || {},
              outputPayload,
              status,
              durationMs: Date.now() - startedAt,
              errorMessage,
              reasoningSnippet: call.reasoning,
              evidenceRefs: call.evidenceRefs || []
            })
            .catch(() => {
              // Never let observability persistence break the investigation itself.
            }),
          recordAuditEvent({
            tenantId,
            agentId: effectiveAgentId,
            runId,
            eventType: `TOOL_CALL_${status}`,
            actorType: "AGENT",
            actorId: effectiveAgentId,
            payload: auditPayload
          }).catch(() => {})
        ]);
      };

      const toolDef = CANONICAL_TOOLS.find((t) => t.name === call.toolName);

      if (!toolDef) {
        const errorMessage = `Tool '${call.toolName}' not found in canonical tool registry`;
        await record("ERROR", { error: errorMessage }, errorMessage);
        return {
          callId: call.callId,
          status: "ERROR" as const,
          error: { code: "TOOL_NOT_FOUND", message: errorMessage },
          data: { error: `Tool ${call.toolName} not found`, toolName: call.toolName }
        };
      }

      const operationType = toolDef.operationType || (toolDef.requiresApproval ? "MUTATION" : "READ_ONLY");

      // Task 3 (Wire Event-Driven Proactive Execution): background triage
      // triggered by an unattended alert (no human has looked at this
      // incident yet) is restricted to read-only tools — stronger than the
      // normal "mutations require approval" gate below, since here even
      // *proposing* a mutation is refused outright rather than queued.
      if (options.readOnlyOnly && operationType !== "READ_ONLY") {
        const errorMessage = `Tool '${call.toolName}' is a mutating action; this is an unattended background triage session restricted to read-only tools. Findings will be posted to the incident for a human to review before any mutation is proposed.`;
        await record("DENIED", { reason: errorMessage }, errorMessage);
        return {
          callId: call.callId,
          status: "ERROR" as const,
          error: { code: "READ_ONLY_TRIAGE_RESTRICTION", message: errorMessage },
          data: { status: "DENIED", reason: errorMessage, toolName: call.toolName }
        };
      }

      const authorizedCapabilities = await resolveAuthorizedCapabilities(tenantId, effectiveAgentId);
      const tenantMonthlyBudgetLimitUsd = await tenantService
        .getBudget(tenantId)
        .then((b) => b.monthlyBudgetLimitUsd)
        .catch(() => undefined);

      const policyResult = await policyEngine.evaluate({
        agentId: effectiveAgentId,
        tenantId,
        toolName: toolDef.name,
        operationType,
        arguments: call.arguments || {},
        authorizedCapabilities,
        tenantMonthlyBudgetLimitUsd
      });

      if (policyResult.decision === "DENY") {
        await record("DENIED", { ruleId: policyResult.ruleId, reason: policyResult.reason }, policyResult.reason);
        return {
          callId: call.callId,
          status: "ERROR" as const,
          error: { code: policyResult.ruleId || "POLICY_DENIED", message: policyResult.reason },
          data: {
            status: "DENIED",
            ruleId: policyResult.ruleId,
            reason: policyResult.reason,
            toolName: call.toolName
          }
        };
      }

      if (policyResult.decision === "APPROVAL_REQUIRED") {
        const previousStateSnapshot = await captureSnapshotForRevert(toolDef.name, call.arguments || {}, {
          agentId: effectiveAgentId,
          tenantId
        });
        const dryRunDiff = BlastRadiusSimulator.simulate(toolDef.name, call.arguments || {}, previousStateSnapshot || undefined);
        const approval = await approvalService.createApprovalRequest({
          tenantId: tenantId as any,
          agentId: effectiveAgentId as any,
          toolName: call.toolName,
          operationType: (toolDef.operationType as any) || "MUTATION",
          rawPayload: call.arguments as Record<string, unknown>,
          runId: runId as any,
          dryRunDiff,
          previousStateSnapshot
        });
        await record("AWAITING_APPROVAL", { approvalId: approval.id, dryRunDiff: approval.dryRunDiff });
        return {
          callId: call.callId,
          status: "AWAITING_APPROVAL" as const,
          approvalId: approval.id,
          data: {
            approvalId: approval.id,
            toolName: call.toolName,
            status: "AWAITING_APPROVAL",
            message: "Mutation routed to human operator authorization queue",
            dryRunDiff: approval.dryRunDiff
          }
        };
      }

      // Verdict is ALLOW — execute canonical AWS tool using live AWS SDK
      try {
        const toolResult = await toolDef.handler(call.arguments || {}, {
          agentId: effectiveAgentId,
          tenantId
        });
        await record("SUCCESS", toolResult);
        return {
          callId: call.callId,
          status: "SUCCESS" as const,
          data: toolResult
        };
      } catch (err: any) {
        const errorMessage = err?.message || `Execution of ${call.toolName} failed`;
        await record("ERROR", { error: err?.message }, errorMessage);
        return {
          callId: call.callId,
          status: "ERROR" as const,
          error: { code: "TOOL_EXECUTION_FAILED", message: errorMessage },
          data: { error: err?.message, toolName: call.toolName }
        };
      }
    };
  }

  /**
   * Helper to handle dynamic incident trigger and autonomous investigation dispatch
   */
  async function handleTriggerInvestigation(request: any, reply: any) {
    const tenantId = getTenantId(request);
    const body = request.body || {};
    const serviceName = body.service || "starvision-motors";
    const clusterName = body.cluster || "cloudops-test";

    // Dynamically resolve cloud account from connected accounts in database
    const accounts = await cloudAccountService.listAccounts(tenantId);
    const activeAccount = accounts.find((a) => a.status === "CONNECTED") || accounts[0];
    const effectiveAccountId = body.accountId || activeAccount?.accountId || "unconnected";
    const region = body.region || activeAccount?.region || "us-east-1";
    const severity = body.severity || "CRITICAL";
    const title = body.title || `ECS Incident on ${serviceName}: Tasks failing steady-state check`;
    const alertDescription =
      body.alertDescription ||
      `Service health anomaly on ${serviceName} in cluster ${clusterName} (${region}). Tasks failing steady-state verification.`;

    const incidentId = `inc_${randomUUID().substring(0, 8)}`;
    const createdIncident = await incidentService.createIncident(tenantId, {
      incidentId,
      provider: "AWS",
      accountId: effectiveAccountId,
      region,
      service: `${clusterName}/${serviceName}`,
      resourceId: `arn:aws:ecs:${region}:${effectiveAccountId}:service/${clusterName}/${serviceName}`,
      severity,
      title,
      alertDescription,
      sourceMetadata: {
        monitorId: "mon_alb_5xx_spike",
        triggerMetric: "Target5xxCountHigh",
        threshold: "> 5 in 1m",
        startedAt: new Date().toISOString()
      },
      status: "OPEN"
    });

    const effectiveAgent = await resolveEffectiveAgent(tenantId, body.agentId);
    const effectiveAgentId = effectiveAgent.id;
    if (typeof (agentAdapter as any).agentName !== "undefined") {
      (agentAdapter as any).agentName = effectiveAgent.name;
    }
    applyGovernedProfile(effectiveAgent);

    const { investigation, session } = await incidentService.startInvestigation({
      tenantId,
      incidentId: createdIncident.id,
      agentId: effectiveAgentId,
      adapter: agentAdapter
    });

    // Phase 3.5/3.6: one run per investigation — the correlation point every
    // tool_execution (and, from Phase 3.6, every approval/audit_event/trace)
    // threads back to.
    const run = await runService.createRun({
      tenantId,
      agentId: effectiveAgentId,
      userPrompt: createdIncident.alertDescription
    });

    // Wire live tool handler that executes canonical AWS SDK commands
    if (typeof (agentAdapter as any).onToolCall === "function") {
      agentAdapter.onToolCall(
        session.sessionId,
        buildToolCallHandler(tenantId, effectiveAgentId, run.id, clusterName, serviceName, region, effectiveAccountId)
      );
    }

    // Asynchronously drive the investigation in the background with live inference
    agentAdapter
      .runInvestigation(session.sessionId, {
        cluster: clusterName,
        service: serviceName,
        region,
        alertDescription: createdIncident.alertDescription,
        liveInference: true,
        runId: run.id
      })
      .then(async (result) => {
        await runService.completeRun(run.id, "COMPLETED", JSON.stringify(result.rootCause));
      })
      .catch(async (err: any) => {
        await runService.completeRun(run.id, "FAILED", err?.message || "Investigation failed").catch(() => {});
        await incidentService.failInvestigation(
          tenantId,
          investigation.id,
          err?.message || "Investigation failed"
        );
      });

    return reply.status(201).send({
      incident: createdIncident,
      investigation,
      session,
      runId: run.id
    });
  }

  /**
   * POST /v1/investigations/resolve-target
   * Conversational front-door for triggering a real investigation: the
   * operator describes a symptom in free text instead of filling out a
   * cluster/service/region form. Grounded in the tenant's real discovered
   * ECS services — the model is never allowed to invent a target that
   * isn't in that real list — and asks a clarifying question back rather
   * than guessing when the symptom or target service is ambiguous.
   */
  fastify.post<{
    Body: { conversation?: Array<{ role: "operator" | "agent"; text: string }> };
  }>("/v1/investigations/resolve-target", async (request, reply) => {
    const tenantId = getTenantId(request);
    const conversation = request.body?.conversation || [];
    const latest = conversation[conversation.length - 1];

    if (!latest || latest.role !== "operator" || !latest.text?.trim()) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "conversation must end with a non-empty operator message" }
      });
    }

    // Real discovered ECS services for this tenant — the only valid targets.
    const accounts = await cloudAccountService.listAccounts(tenantId);
    const connectedAccounts = accounts.filter((a) => a.status === "CONNECTED");
    const ecsWorkloads: Array<{ name: string; cluster: string; region: string }> = [];
    for (const acc of connectedAccounts) {
      try {
        const { workloads } = await cloudAccountService.discoverWorkloads(tenantId, acc.id);
        for (const w of workloads) {
          if (w.type === "ECS_SERVICE") {
            ecsWorkloads.push({ name: w.name, cluster: w.cluster || "default", region: w.region });
          }
        }
      } catch {
        // one account's discovery failing shouldn't block the others
      }
    }

    if (ecsWorkloads.length === 0) {
      return reply.status(200).send({
        needsClarification: true,
        question:
          "There are no ECS services discovered for this tenant yet — connect an AWS account under Infrastructure first, then I can investigate a real service."
      });
    }

    const history = conversation
      .slice(0, -1)
      .map((m) => `${m.role === "operator" ? "Operator" : "Agent"}: ${m.text}`)
      .join("\n");
    const workloadList = ecsWorkloads.map((w) => `- ${w.name} (cluster: ${w.cluster}, region: ${w.region})`).join("\n");

    const resolverPrompt = `You are an SRE triage assistant helping an operator start a real investigation.

Real ECS services currently discovered for this tenant (these are the ONLY valid targets — never invent a name not in this list):
${workloadList}
${history ? `\nConversation so far:\n${history}\n` : ""}
Operator's latest message: "${latest.text}"

Decide: do you have enough information to identify exactly ONE service from the list above, and a clear description of the symptom?

Respond with ONLY valid JSON, no markdown, no backticks, matching exactly one of these two shapes:

If you need more information (ambiguous which service, or no real symptom described yet):
{"needsClarification": true, "question": "<a single, specific clarifying question to ask the operator>"}

If you have enough to proceed:
{"needsClarification": false, "service": "<exact name from the list above>", "cluster": "<its cluster>", "region": "<its region>", "severity": "<CRITICAL|HIGH|MEDIUM|LOW>", "alertDescription": "<a concise technical restatement of the symptom for the investigation log>"}`;

    try {
      const raw = await (agentAdapter as any).executeHermesInference(resolverPrompt, 30000);
      const parsed = extractJsonFromLlmOutput(raw);

      if (!parsed) {
        return reply.status(200).send({
          needsClarification: true,
          question: "I couldn't quite parse that — which service is affected, and what are you seeing (errors, high latency, crash loops)?"
        });
      }

      if (parsed.needsClarification) {
        return reply.status(200).send({
          needsClarification: true,
          question: parsed.question || "Which service should I investigate?"
        });
      }

      // Never trust free-form invention — the model must have picked a real,
      // currently-discovered service, not a plausible-sounding fake one.
      const matched = ecsWorkloads.find((w) => w.name === parsed.service);
      if (!matched) {
        return reply.status(200).send({
          needsClarification: true,
          question: `I want to target the right service — did you mean one of: ${ecsWorkloads.map((w) => w.name).join(", ")}?`
        });
      }

      return reply.status(200).send({
        needsClarification: false,
        service: matched.name,
        cluster: matched.cluster,
        region: matched.region,
        severity: parsed.severity || "HIGH",
        alertDescription: parsed.alertDescription || latest.text
      });
    } catch (err: any) {
      request.log.error({ err }, "resolve-target inference failed");
      return reply.status(200).send({
        needsClarification: true,
        question: "I'm having trouble reaching the reasoning model right now — could you specify the exact service name to investigate?"
      });
    }
  });

  /**
   * POST /v1/incidents/simulate-failure
   * Triggers an automated controlled failure and starts live investigation turn on a workload.
   */
  fastify.post("/v1/incidents/simulate-failure", handleTriggerInvestigation);

  /**
   * POST /v1/incidents/trigger
   * Direct dynamic trigger for an autonomous SRE investigation on any workload.
   */
  fastify.post("/v1/incidents/trigger", handleTriggerInvestigation);

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
   * POST /v1/incidents/:id/resolve
   * Operator marks an incident resolved — the real closure action this
   * product never had until now (incidents could be created and
   * investigated but never closed). Records a real, append-only audit
   * event; never touches the hash-chained ledger's existing rows.
   */
  fastify.post<{ Params: { id: string }; Body: { resolvedBy?: string } }>(
    "/v1/incidents/:id/resolve",
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { id } = request.params;
      const resolvedBy = request.body?.resolvedBy || (request.headers["x-operator-id"] as string) || "unknown_operator";

      const incident = await incidentService.resolveIncident(tenantId, id);

      await recordAuditEvent({
        tenantId,
        eventType: "INCIDENT_RESOLVED",
        actorType: "OPERATOR",
        actorId: resolvedBy,
        payload: { incidentId: id, service: incident.service }
      }).catch(() => {});

      return reply.status(200).send({ incident });
    }
  );

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

    const effectiveAgent = await resolveEffectiveAgent(tenantId, agentId);
    const effectiveAgentId = effectiveAgent.id;
    if (typeof (agentAdapter as any).agentName !== "undefined") {
      (agentAdapter as any).agentName = effectiveAgent.name;
    }
    applyGovernedProfile(effectiveAgent);

    const incDetails = await incidentService.getIncident(tenantId, incidentId);
    let cluster = "cloudops-test";
    let service = incDetails.incident.service;
    if (service.includes("/")) {
      const parts = service.split("/");
      cluster = parts[0] || "cloudops-test";
      service = parts[1] || "starvision-motors";
    }
    const region = incDetails.incident.region || "us-east-1";
    const accountId = incDetails.incident.accountId || "unconnected";

    const { investigation, session } = await incidentService.startInvestigation({
      tenantId,
      incidentId,
      agentId: effectiveAgentId,
      adapter: agentAdapter
    });

    const run = await runService.createRun({
      tenantId,
      agentId: effectiveAgentId,
      userPrompt: incDetails.incident.alertDescription
    });

    // Wire live tool handler that executes canonical AWS SDK commands
    if (typeof (agentAdapter as any).onToolCall === "function") {
      agentAdapter.onToolCall(
        session.sessionId,
        buildToolCallHandler(tenantId, effectiveAgentId, run.id, cluster, service, region, accountId)
      );
    }

    // Asynchronously drive the investigation in the background with live inference
    agentAdapter
      .runInvestigation(session.sessionId, {
        cluster,
        service,
        region,
        alertDescription: incDetails.incident.alertDescription,
        liveInference: true,
        runId: run.id
      })
      .then(async (result) => {
        await runService.completeRun(run.id, "COMPLETED", JSON.stringify(result.rootCause));
      })
      .catch(async (err: any) => {
        await runService.completeRun(run.id, "FAILED", err?.message || "Investigation failed").catch(() => {});
        await incidentService.failInvestigation(
          tenantId,
          investigation.id,
          err?.message || "Investigation failed"
        );
      });

    return reply.status(201).send({
      investigationId: investigation.id,
      sessionId: session.sessionId,
      incidentId,
      status: investigation.status,
      startedAt: investigation.startedAt.toISOString(),
      runId: run.id
    });
  });

  /**
   * POST /v1/webhooks/alertmanager
   * Task 3 (Wire Event-Driven Proactive Execution): the entry point that
   * makes CloudOps event-driven instead of purely operator-initiated. Maps
   * an incoming Prometheus Alertmanager webhook payload into a real
   * incident and kicks off a background investigation restricted to
   * read-only MCP tools — findings land on the incident for a human to
   * review before any mutation is ever proposed (see buildToolCallHandler's
   * readOnlyOnly gate above).
   */
  fastify.post<{
    Body: {
      status?: string;
      alerts?: Array<{
        status?: string;
        labels?: Record<string, string>;
        annotations?: Record<string, string>;
        startsAt?: string;
      }>;
    };
  }>("/v1/webhooks/alertmanager", async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = request.body || {};
    const firingAlerts = (body.alerts || []).filter((a) => (a.status || body.status) === "firing");

    if (firingAlerts.length === 0) {
      return reply.status(200).send({ status: "IGNORED", reason: "No firing alerts in payload" });
    }

    const accounts = await cloudAccountService.listAccounts(tenantId);
    const activeAccount = accounts.find((a) => a.status === "CONNECTED") || accounts[0];

    const created: Array<{ incidentId: string; investigationId: string; sessionId: string }> = [];

    for (const alert of firingAlerts) {
      const labels = alert.labels || {};
      const annotations = alert.annotations || {};

      const clusterName = labels.cluster || "cloudops-test";
      const serviceName = labels.service || labels.job || labels.alertname || "unknown-service";
      const region = labels.region || activeAccount?.region || "us-east-1";
      const accountId = labels.account_id || activeAccount?.accountId || "unconnected";
      const severity = mapAlertmanagerSeverity(labels.severity);
      const title = annotations.summary || labels.alertname || "Alertmanager alert";
      const alertDescription =
        annotations.description ||
        annotations.summary ||
        `Alertmanager fired '${labels.alertname || "alert"}' on ${serviceName} (${clusterName}).`;

      const incidentId = `inc_${randomUUID().substring(0, 8)}`;
      const createdIncident = await incidentService.createIncident(tenantId, {
        incidentId,
        provider: "AWS",
        accountId,
        region,
        service: `${clusterName}/${serviceName}`,
        resourceId: `arn:aws:ecs:${region}:${accountId}:service/${clusterName}/${serviceName}`,
        severity,
        title,
        alertDescription,
        sourceMetadata: {
          source: "alertmanager",
          labels,
          annotations,
          startsAt: alert.startsAt
        },
        status: "OPEN"
      });

      const effectiveAgent = await resolveEffectiveAgent(tenantId, undefined);
      const effectiveAgentId = effectiveAgent.id;
      if (typeof (agentAdapter as any).agentName !== "undefined") {
        (agentAdapter as any).agentName = effectiveAgent.name;
      }
      applyGovernedProfile(effectiveAgent);

      const { investigation, session } = await incidentService.startInvestigation({
        tenantId,
        incidentId: createdIncident.id,
        agentId: effectiveAgentId,
        adapter: agentAdapter
      });

      const run = await runService.createRun({
        tenantId,
        agentId: effectiveAgentId,
        userPrompt: createdIncident.alertDescription
      });

      if (typeof (agentAdapter as any).onToolCall === "function") {
        agentAdapter.onToolCall(
          session.sessionId,
          buildToolCallHandler(tenantId, effectiveAgentId, run.id, clusterName, serviceName, region, accountId, {
            readOnlyOnly: true
          })
        );
      }

      // Background, unattended: no human has looked at this incident yet.
      agentAdapter
        .runInvestigation(session.sessionId, {
          cluster: clusterName,
          service: serviceName,
          region,
          alertDescription: createdIncident.alertDescription,
          liveInference: true,
          runId: run.id
        })
        .then(async (result) => {
          await runService.completeRun(run.id, "COMPLETED", JSON.stringify(result.rootCause));
        })
        .catch(async (err: any) => {
          await runService.completeRun(run.id, "FAILED", err?.message || "Investigation failed").catch(() => {});
          await incidentService.failInvestigation(
            tenantId,
            investigation.id,
            err?.message || "Investigation failed"
          );
        });

      created.push({
        incidentId: createdIncident.id,
        investigationId: investigation.id,
        sessionId: session.sessionId
      });
    }

    return reply.status(201).send({ status: "ACCEPTED", created });
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

