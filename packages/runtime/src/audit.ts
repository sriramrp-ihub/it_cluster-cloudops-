import { Kysely } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import { AuditService } from "@cloudops/audit";

export interface AuditEventInput {
  tenantId: string;
  eventType: string;
  actorType: "SYSTEM" | "OPERATOR" | "AGENT";
  actorId: string;
  agentId?: string | undefined;
  runId?: string | undefined;
  payload: Record<string, unknown>;
  ipAddress?: string | undefined;
}

const auditService = new AuditService();

/**
 * Append-only security audit event recorder for Phase 3 Gateway & Runtime.
 * Strictly sanitizes payloads and maintains cryptographic hash chaining.
 */
export async function recordAuditEvent(
  input: AuditEventInput,
  tx?: Kysely<DatabaseSchema>,
  dbInstance?: Kysely<DatabaseSchema>
): Promise<void> {
  // If tenant is unknown or empty, cannot insert into tenant-scoped audit table
  if (!input.tenantId || input.tenantId === "unknown") {
    return;
  }

  // Redact potential secrets from audit payloads
  const sanitizedPayload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.payload)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("token") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("password") ||
      lowerKey.includes("credential") ||
      lowerKey.includes("hash")
    ) {
      if (key === "credentialId") {
        sanitizedPayload[key] = value; // Safe reference identifier
      } else {
        sanitizedPayload[key] = "[REDACTED]";
      }
    } else {
      sanitizedPayload[key] = value;
    }
  }

  await auditService.recordEvent(
    {
      tenantId: input.tenantId,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId,
      agentId: input.agentId || null,
      runId: input.runId || null,
      payload: sanitizedPayload,
      ipAddress: input.ipAddress || null
    },
    tx || dbInstance
  );
}
