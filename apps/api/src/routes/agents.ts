import type { FastifyPluginAsync } from "fastify";
import { AgentService } from "@cloudops/identity";
import { DefenseClawGuardrailService } from "@cloudops/security";
import { HermesAgentAdapter, type AgentAdapter } from "@cloudops/runtime";
import { requireOperatorAuth } from "../middleware/auth.js";

export interface AgentRoutesOptions {
  agentService?: AgentService | undefined;
  agentAdapter?: AgentAdapter | undefined;
}

export const agentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (fastify, opts) => {
  const agentService = opts.agentService || new AgentService();
  const agentAdapter = opts.agentAdapter || new HermesAgentAdapter();
  const defenseClaw = new DefenseClawGuardrailService();

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

  /**
   * DELETE /v1/agents/:id
   * Operator deletes/removes an agent and cleans up associated credentials, sessions, and references.
   */
  fastify.delete<{ Params: { id: string } }>(
    "/v1/agents/:id",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      const result = await agentService.deleteAgent(operator.tenantId, id as any);

      return reply.status(200).send({
        success: true,
        message: `Agent '${result.name}' (${result.id}) was successfully deleted`,
        deletedAgentId: result.id
      });
    }
  );

  /**
   * POST /v1/agent/chat
   * Operator sends an operational or architectural query directly to the live Hermes AI agent.
   * Prompts are analyzed by DefenseClaw before reaching the model.
   */
  fastify.post<{
    Body: {
      prompt: string;
      agentId?: string;
      context?: {
        environment?: string;
        service?: string;
        cluster?: string;
        region?: string;
      };
    };
  }>("/v1/agent/chat", { preHandler: [requireOperatorAuth] }, async (request, reply) => {
    const operator = request.operator!;
    const { prompt, agentId, context } = request.body || {};

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Prompt is required" }
      });
    }

    // 1. DefenseClaw Pre-execution Guardrail Analysis
    const verdict = await defenseClaw.inspectToolCall({
      agentId: agentId || "agent-live-chat",
      tenantId: operator.tenantId,
      toolName: "operator_chat_query",
      arguments: { prompt, context }
    });

    if (!verdict.allowed) {
      return reply.status(403).send({
        error: {
          code: "DEFENSECLAW_GUARDRAIL_VIOLATION",
          message: `Query intercepted by DefenseClaw security fence: ${verdict.guardrailViolations.join("; ")}`,
          riskScore: verdict.riskScore
        }
      });
    }

    // 2. Resolve Agent and Model dynamically
    let agentName = "CloudOps Autonomous SRE Agent";
    let agentType = "hermes";
    if (agentId) {
      try {
        const ag = await agentService.getAgent(operator.tenantId, agentId as any);
        if (ag) {
          agentName = ag.name;
          agentType = ag.type;
        }
      } catch {
        // Fallback
      }
    } else {
      const agents = await agentService.listAgents(operator.tenantId);
      const active = agents.find((a) => a.status === "CONNECTED") || agents[0];
      if (active) {
        agentName = active.name;
        agentType = active.type;
      }
    }

    const localAdapter = agentAdapter || new HermesAgentAdapter();
    let discoveredModel = "agent-runtime";
    let discoveredProvider = "local-daemon";
    if (typeof (localAdapter as any).checkHermesHealth === "function") {
      try {
        const health = await (localAdapter as any).checkHermesHealth();
        if (health?.model) discoveredModel = health.model;
        if (health?.provider) discoveredProvider = health.provider;
      } catch {
        // use defaults
      }
    }

    // 3. Build contextual prompt dynamically
    const ctxString = context?.service
      ? `\nActive Operational Context: Workload '${context.service}', Cluster '${context.cluster || "default"}', Region '${context.region || "us-east-1"}', Env '${context.environment || "production"}'.`
      : "";

    const hermesPrompt = `You are ${agentName} (${discoveredModel}).
You assist Site Reliability Engineers and Cloud Platform Operators with real-time AWS troubleshooting, architecture guidance, ECS failure diagnostics, CloudWatch alarms, and governance policies.
${ctxString}

Operator Query:
${prompt}

Provide an authoritative, concise, and structured SRE response (maximum 2-3 short paragraphs or bullet points). If recommending a mutating cloud action (like updating a service or scaling), explicitly state that in CloudOps, mutating actions require human operator Ed25519 cryptographic authorization.`;

    try {
      let responseText = "";
      if (typeof (localAdapter as any).executeHermesInference === "function") {
        responseText = await (localAdapter as any).executeHermesInference(hermesPrompt, 45000);
      } else {
        const fallbackAdapter = new HermesAgentAdapter();
        responseText = await fallbackAdapter.executeHermesInference(hermesPrompt, 45000);
      }

      return reply.status(200).send({
        response: responseText.trim(),
        model: discoveredModel,
        provider: discoveredProvider,
        agentName,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      request.log.error({ err }, "Hermes chat inference error");
      return reply.status(500).send({
        error: {
          code: "HERMES_INFERENCE_ERROR",
          message: err?.message || "Failed to execute Hermes agent inference"
        }
      });
    }
  });
};
