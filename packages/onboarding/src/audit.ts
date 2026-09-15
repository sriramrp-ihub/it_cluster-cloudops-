import { Kysely, Transaction } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import { type AgentId, type TenantId } from "@cloudops/shared";
import { AuditService } from "@cloudops/audit";

export type AuditAction =
  | "INVITE_CREATED"
  | "INVITE_REVOKED"
  | "JOIN_REQUEST_SUBMITTED"
  | "JOIN_REQUEST_APPROVED"
  | "JOIN_REQUEST_REJECTED"
  | "CLAIM_CREDENTIAL_ISSUED"
  | "CLAIM_CREDENTIAL_CONSUMED";

export interface RecordAuditParams {
  tenantId: string;
  eventType: AuditAction;
  actorType: "OPERATOR" | "AGENT" | "SYSTEM";
  actorId: string;
  payload: Record<string, unknown>;
  agentId?: AgentId;
  runId?: string;
  ipAddress?: string;
}

const auditService = new AuditService();

/**
 * Append-only tamper-evident audit logger for onboarding and identity actions.
 * Explicitly excludes secrets from payloads and maintains cryptographic hash chaining.
 */
export async function recordAuditEvent(
  params: RecordAuditParams,
  tx?: Transaction<DatabaseSchema>,
  db: Kysely<DatabaseSchema> = getDatabase()
): Promise<string> {
  // Safety filter: strip any accidental secret fields
  const safePayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params.payload)) {
    const lower = key.toLowerCase();
    if (lower.includes("token") || lower.includes("secret") || lower.includes("credential") || lower.includes("password")) {
      // do not store secret tokens
      continue;
    }
    safePayload[key] = value;
  }

  const record = await auditService.recordEvent(
    {
      tenantId: params.tenantId,
      eventType: params.eventType,
      actorType: params.actorType,
      actorId: params.actorId,
      agentId: params.agentId || null,
      runId: params.runId || null,
      payload: safePayload,
      ipAddress: params.ipAddress || null
    },
    tx || db
  );

  return record.id;
}
