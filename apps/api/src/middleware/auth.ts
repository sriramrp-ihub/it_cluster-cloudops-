import type { FastifyRequest, FastifyReply } from "fastify";
import { AuthenticationError, ValidationError } from "@cloudops/shared";

export interface OperatorContext {
  operatorId: string;
  tenantId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    operator?: OperatorContext;
  }
}

/**
 * Clean operator authorization abstraction.
 * Enforces authenticated operator identity and tenant context for administrative endpoints.
 * Operates via x-operator-id and x-tenant-id headers or Bearer token.
 */
export async function requireOperatorAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const operatorHeader = request.headers["x-operator-id"] as string | undefined;
  const tenantHeader = request.headers["x-tenant-id"] as string | undefined;
  const authHeader = request.headers["authorization"];

  let operatorId = operatorHeader;
  let tenantId = tenantHeader;

  // Support Bearer operator token if provided
  if (authHeader && authHeader.startsWith("Bearer op_")) {
    operatorId = operatorId || authHeader.replace("Bearer ", "").trim();
  }

  if (!operatorId) {
    throw new AuthenticationError("Administrative operation requires valid operator authentication (x-operator-id header or Bearer operator token)");
  }

  if (!tenantId) {
    throw new ValidationError("Administrative operation requires tenant context (x-tenant-id header)");
  }

  request.operator = {
    operatorId,
    tenantId
  };
}
