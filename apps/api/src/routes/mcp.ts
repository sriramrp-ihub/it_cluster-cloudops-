import type { FastifyPluginAsync } from "fastify";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CloudOpsMcpServer, CANONICAL_TOOLS } from "@cloudops/tools";
import { ApprovalService } from "@cloudops/approvals";

interface SessionEntry {
  transport: SSEServerTransport;
  mcpServer: CloudOpsMcpServer;
  agentId: string;
  tenantId: string;
  createdAt: number;
}

export interface McpRouteOptions {
  approvalService?: ApprovalService | undefined;
}

export const mcpRoutes: FastifyPluginAsync<McpRouteOptions> = async (fastify, opts) => {
  const approvalService = opts.approvalService || new ApprovalService();
  const activeSessions = new Map<string, SessionEntry>();

  // Cleanup stale sessions older than 2 hours periodically
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, entry] of activeSessions.entries()) {
      if (now - entry.createdAt > 2 * 60 * 60 * 1000) {
        entry.transport.close().catch(() => {});
        entry.mcpServer.close().catch(() => {});
        activeSessions.delete(sessionId);
      }
    }
  }, 60000);

  fastify.addHook("onClose", () => {
    clearInterval(cleanupInterval);
    for (const entry of activeSessions.values()) {
      entry.transport.close().catch(() => {});
      entry.mcpServer.close().catch(() => {});
    }
    activeSessions.clear();
  });

  /**
   * GET /v1/mcp/sse
   * Establishes an SSE stream for MCP protocol JSON-RPC transport.
   * Directs the client to POST JSON-RPC messages to /v1/mcp/messages?sessionId=<id>.
   */
  fastify.get<{
    Querystring: {
      agentId?: string;
      tenantId?: string;
      capabilities?: string;
    };
  }>("/v1/mcp/sse", async (request, reply) => {
    const query = request.query || {};
    const agentId =
      query.agentId ||
      (request.headers["x-agent-id"] as string) ||
      "agent_mcp_client";
    const tenantId =
      query.tenantId ||
      (request.headers["x-tenant-id"] as string) ||
      "ten_default_tenant";

    const capabilitiesParam = query.capabilities || (request.headers["x-capabilities"] as string);
    const authorizedCapabilities = capabilitiesParam
      ? capabilitiesParam.split(",").map((c) => c.trim()).filter(Boolean)
      : undefined;

    reply.hijack();

    const transport = new SSEServerTransport("/v1/mcp/messages", reply.raw);
    const mcpServer = new CloudOpsMcpServer({
      agentId,
      tenantId,
      authorizedCapabilities,
      approvalService
    });

    const sessionId = transport.sessionId;
    activeSessions.set(sessionId, {
      transport,
      mcpServer,
      agentId,
      tenantId,
      createdAt: Date.now()
    });

    let isClosing = false;
    transport.onclose = () => {
      if (isClosing) return;
      isClosing = true;
      activeSessions.delete(sessionId);
      mcpServer.close().catch(() => {});
    };

    request.log.info(
      { sessionId, agentId, tenantId, authorizedCapabilities },
      "MCP SSE connection established"
    );

    await mcpServer.connect(transport);
  });

  /**
   * POST /v1/mcp/messages
   * Receives incoming JSON-RPC client messages for an established SSE session.
   */
  fastify.post<{
    Querystring: {
      sessionId?: string;
    };
  }>("/v1/mcp/messages", async (request, reply) => {
    const sessionId = request.query?.sessionId;

    if (!sessionId || !activeSessions.has(sessionId)) {
      return reply.status(404).send({
        error: {
          code: "SESSION_NOT_FOUND",
          message: `MCP session '${sessionId ?? "undefined"}' not found or has expired.`
        }
      });
    }

    const session = activeSessions.get(sessionId)!;
    reply.hijack();

    try {
      await session.transport.handlePostMessage(request.raw, reply.raw, request.body);
    } catch (err: any) {
      request.log.error({ err, sessionId }, "Failed to handle MCP POST message");
    }
  });

  /**
   * GET /v1/mcp/tools
   * Lists all available canonical multi-cloud tools registered in CloudOps MCP Server.
   * Exposes operational readiness status ('live' vs 'contract_only').
   */
  fastify.get("/v1/mcp/tools", async (_request, reply) => {
    const tools = CANONICAL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      provider: t.provider,
      status: t.status,
      riskLevel: t.riskLevel,
      requiresApproval: t.requiresApproval,
      requiredCapability: t.requiredCapability
    }));

    return reply.status(200).send({
      count: tools.length,
      tools
    });
  });

  /**
   * GET /v1/mcp/approvals/:id
   * Polling and status query endpoint for agents awaiting human operator approval.
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { tenantId?: string };
  }>("/v1/mcp/approvals/:id", async (request, reply) => {
    const approvalId = request.params.id;
    const tenantId =
      request.query?.tenantId ||
      (request.headers["x-tenant-id"] as string) ||
      "ten_default_tenant";

    const approval = await approvalService.getApproval(tenantId, approvalId as any);
    if (!approval) {
      return reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: `Approval request '${approvalId}' not found.`
        }
      });
    }

    return reply.status(200).send({
      approvalId: approval.id,
      status: approval.status,
      toolName: approval.toolName,
      operationType: approval.operationType,
      operationPayloadHash: approval.operationPayloadHash,
      idempotencyKey: approval.idempotencyKey,
      reviewedBy: approval.reviewedBy,
      reviewedAt: approval.reviewedAt?.toISOString() ?? null,
      signedBy: approval.signedBy,
      signedAt: approval.signedAt?.toISOString() ?? null,
      result: approval.executionResult,
      errorMessage: approval.errorMessage,
      dryRunDiff: approval.dryRunDiff,
      expiresAt: approval.expiresAt.toISOString(),
      createdAt: approval.createdAt.toISOString()
    });
  });
};
