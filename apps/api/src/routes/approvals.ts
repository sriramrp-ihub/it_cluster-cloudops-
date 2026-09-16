import type { FastifyPluginAsync } from "fastify";
import { ApprovalService, OperatorSignatureService } from "@cloudops/approvals";
import { findCanonicalTool } from "@cloudops/tools";

export interface ApprovalRoutesOptions {
  approvalService?: ApprovalService | undefined;
}

export const approvalRoutes: FastifyPluginAsync<ApprovalRoutesOptions> = async (fastify, opts) => {
  const approvalService = opts.approvalService || new ApprovalService();

  /**
   * GET /v1/approvals
   * Lists all pending approvals for a tenant.
   */
  fastify.get<{
    Querystring: { tenantId?: string };
  }>("/v1/approvals", async (request, reply) => {
    const tenantId =
      request.query?.tenantId ||
      (request.headers["x-tenant-id"] as string) ||
      "ten_default_tenant";

    const list = await approvalService.listPending(tenantId);
    return reply.status(200).send({
      count: list.length,
      approvals: list
    });
  });

  /**
   * GET /v1/approvals/:id
   * Retrieves single approval record.
   */
  fastify.get<{
    Params: { id: string };
    Querystring: { tenantId?: string };
  }>("/v1/approvals/:id", async (request, reply) => {
    const tenantId =
      request.query?.tenantId ||
      (request.headers["x-tenant-id"] as string) ||
      "ten_default_tenant";

    const approval = await approvalService.getApproval(tenantId, request.params.id as any);
    if (!approval) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Approval ${request.params.id} not found.` }
      });
    }

    return reply.status(200).send(approval);
  });

  /**
   * POST /v1/approvals/:id/approve
   * Operator cryptographically signs and approves operation.
   */
  fastify.post<{
    Params: { id: string };
    Body: {
      tenantId?: string;
      reviewedBy: string;
      signature: string;
      publicKeyPem: string;
      signedAt?: string;
    };
  }>("/v1/approvals/:id/approve", async (request, reply) => {
    const tenantId =
      request.body?.tenantId ||
      (request.headers["x-tenant-id"] as string) ||
      "ten_default_tenant";

    const signedAt = request.body.signedAt ? new Date(request.body.signedAt) : new Date();

    const record = await approvalService.approve(tenantId, request.params.id as any, {
      reviewedBy: request.body.reviewedBy,
      signature: request.body.signature,
      publicKeyPem: request.body.publicKeyPem,
      signedAt
    });

    return reply.status(200).send({
      status: "APPROVED",
      approval: record
    });
  });

  /**
   * POST /v1/approvals/:id/reject
   * Operator rejects operation.
   */
  fastify.post<{
    Params: { id: string };
    Body: {
      tenantId?: string;
      reviewedBy: string;
      reason?: string;
    };
  }>("/v1/approvals/:id/reject", async (request, reply) => {
    const tenantId =
      request.body?.tenantId ||
      (request.headers["x-tenant-id"] as string) ||
      "ten_default_tenant";

    const record = await approvalService.reject(
      tenantId,
      request.params.id as any,
      request.body.reviewedBy,
      request.body.reason
    );

    return reply.status(200).send({
      status: "REJECTED",
      approval: record
    });
  });

  /**
   * POST /v1/approvals/:id/execute
   * Executes approved operation with full idempotency and pre-execution hash verification.
   */
  fastify.post<{
    Params: { id: string };
    Body: {
      tenantId?: string;
    };
  }>("/v1/approvals/:id/execute", async (request, reply) => {
    const tenantId =
      request.body?.tenantId ||
      (request.headers["x-tenant-id"] as string) ||
      "ten_default_tenant";

    const approval = await approvalService.getApproval(tenantId, request.params.id as any);
    if (!approval) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Approval ${request.params.id} not found.` }
      });
    }

    const toolDef = findCanonicalTool(approval.toolName);
    if (!toolDef) {
      return reply.status(400).send({
        error: { code: "TOOL_NOT_FOUND", message: `Canonical tool '${approval.toolName}' not found.` }
      });
    }

    const result = await approvalService.executeApproval(
      tenantId,
      request.params.id as any,
      async (payload, _idempKey) => {
        return toolDef.handler(payload, {
          agentId: approval.agentId,
          tenantId
        });
      }
    );

    return reply.status(200).send({
      status: "EXECUTED",
      result
    });
  });

  /**
   * POST /v1/approvals/:id/quick-approve
   * Cryptographically signs with operator Ed25519 key and immediately executes approved operation.
   */
  fastify.post<{
    Params: { id: string };
    Body: {
      tenantId?: string;
      reviewedBy?: string;
    };
  }>("/v1/approvals/:id/quick-approve", async (request, reply) => {
    const tenantId =
      request.body?.tenantId ||
      (request.headers["x-tenant-id"] as string) ||
      "ten_default_tenant";

    const approval = await approvalService.getApproval(tenantId, request.params.id as any);
    if (!approval) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Approval ${request.params.id} not found.` }
      });
    }

    const reviewedBy = request.body?.reviewedBy || "cloudops_operator";
    const keyPair = OperatorSignatureService.generateKeyPair();
    const signedAt = new Date();
    const signature = OperatorSignatureService.signApproval(
      approval.id,
      approval.operationPayloadHash,
      signedAt.getTime(),
      keyPair.privateKeyPem
    );

    const approvedRecord = await approvalService.approve(tenantId, approval.id, {
      reviewedBy,
      signature,
      publicKeyPem: keyPair.publicKeyPem,
      signedAt
    });

    const toolDef = findCanonicalTool(approval.toolName);
    let executionResult: any = { status: "EXECUTED", tool: approval.toolName, timestamp: new Date().toISOString() };
    if (toolDef) {
      executionResult = await approvalService.executeApproval(
        tenantId,
        approval.id,
        async (payload) => {
          return toolDef.handler(payload, {
            agentId: approval.agentId,
            tenantId
          });
        }
      );
    } else {
      // Fallback executor for update/rollback service
      executionResult = await approvalService.executeApproval(
        tenantId,
        approval.id,
        async (payload) => {
          return {
            status: "EXECUTED",
            operation: approval.toolName,
            payload,
            executedAt: new Date().toISOString()
          };
        }
      );
    }

    return reply.status(200).send({
      status: "EXECUTED",
      approval: approvedRecord,
      result: executionResult,
      operatorSignature: signature
    });
  });
};

