import { createHash } from "node:crypto";
import { getDatabase } from "@cloudops/database";
import { generateAuditId, type AgentId, type RunId, type TenantId } from "@cloudops/shared";

export const GENESIS_PREV_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export interface CreateAuditEventParams {
  tenantId: TenantId | string;
  agentId?: AgentId | string | null | undefined;
  runId?: RunId | string | null | undefined;
  eventType: string;
  actorType: "USER" | "AGENT" | "SYSTEM" | "OPERATOR";
  actorId: string;
  payload: Record<string, unknown>;
  ipAddress?: string | null | undefined;
}

export interface AuditEventRecord {
  id: string;
  tenantId: string;
  agentId: string | null;
  runId: string | null;
  eventType: string;
  actorType: string;
  actorId: string;
  payload: Record<string, unknown>;
  ipAddress: string | null;
  prevHash: string;
  rowHash: string;
  createdAt: Date;
}

export interface VerifyChainResult {
  valid: boolean;
  totalChecked: number;
  error?: string | undefined;
  brokenRowId?: string | undefined;
}

export class AuditService {
  /**
   * Deterministically canonicalizes a JSON object by sorting keys.
   */
  static canonicalize(obj: Record<string, unknown>): string {
    const keys = Object.keys(obj).sort();
    const sortedObj: Record<string, unknown> = {};
    for (const key of keys) {
      const val = obj[key];
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        sortedObj[key] = JSON.parse(AuditService.canonicalize(val as Record<string, unknown>));
      } else {
        sortedObj[key] = val;
      }
    }
    return JSON.stringify(sortedObj);
  }

  /**
   * Computes deterministic SHA-256 hash for an audit row:
   * row_hash = sha256(prev_hash + ":" + canonical_data)
   */
  static computeRowHash(prevHash: string, data: {
    id: string;
    tenantId: string;
    eventType: string;
    actorType: string;
    actorId: string;
    payload: Record<string, unknown>;
  }): string {
    const canonicalPayload = AuditService.canonicalize(data.payload);
    const serializedData = `${data.id}:${data.tenantId}:${data.eventType}:${data.actorType}:${data.actorId}:${canonicalPayload}`;
    return createHash("sha256")
      .update(`${prevHash}:${serializedData}`)
      .digest("hex");
  }

  /**
   * Appends an immutable, hash-chained audit event to the ledger.
   */
  async recordEvent(params: CreateAuditEventParams, customDb?: any): Promise<AuditEventRecord> {
    const db = customDb || getDatabase();
    const id = generateAuditId();

    // Retrieve the immediate previous row for this tenant by atomic sequence number
    const lastRow = await db
      .selectFrom("audit_events")
      .select(["id", "row_hash"])
      .where("tenant_id", "=", params.tenantId)
      .orderBy("seq_num", "desc")
      .limit(1)
      .executeTakeFirst();

    const prevHash = lastRow?.row_hash || GENESIS_PREV_HASH;

    const rowHash = AuditService.computeRowHash(prevHash, {
      id,
      tenantId: params.tenantId,
      eventType: params.eventType,
      actorType: params.actorType,
      actorId: params.actorId,
      payload: params.payload
    });

    const now = new Date();

    await db
      .insertInto("audit_events")
      .values({
        id,
        tenant_id: params.tenantId,
        agent_id: params.agentId || null,
        run_id: params.runId || null,
        event_type: params.eventType,
        actor_type: params.actorType,
        actor_id: params.actorId,
        payload: JSON.stringify(params.payload) as any,
        ip_address: params.ipAddress || null,
        prev_hash: prevHash,
        row_hash: rowHash,
        created_at: now
      })
      .execute();

    return {
      id,
      tenantId: params.tenantId,
      agentId: params.agentId || null,
      runId: params.runId || null,
      eventType: params.eventType,
      actorType: params.actorType,
      actorId: params.actorId,
      payload: params.payload,
      ipAddress: params.ipAddress || null,
      prevHash,
      rowHash,
      createdAt: now
    };
  }

  /**
   * Verifies the cryptographic integrity of the audit chain for a specific tenant or all tenants.
   */
  async verifyChain(tenantId?: string): Promise<VerifyChainResult> {
    const db = getDatabase();

    if (!tenantId) {
      const tenants = await db
        .selectFrom("audit_events")
        .select("tenant_id")
        .distinct()
        .execute();

      let totalChecked = 0;
      for (const t of tenants) {
        const result = await this.verifyChain(t.tenant_id);
        if (!result.valid) {
          return result;
        }
        totalChecked += result.totalChecked;
      }
      return {
        valid: true,
        totalChecked
      };
    }

    const rows = await db
      .selectFrom("audit_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("seq_num", "asc")
      .execute();

    if (rows.length === 0) {
      return { valid: true, totalChecked: 0 };
    }

    let expectedPrevHash = GENESIS_PREV_HASH;
    let index = 0;

    for (const row of rows) {
      // 1. Check prev_hash linkage
      if (row.prev_hash !== expectedPrevHash) {
        return {
          valid: false,
          totalChecked: index,
          brokenRowId: row.id,
          error: `Broken chain linkage in tenant ${tenantId} at row ${row.id}: expected prev_hash ${expectedPrevHash}, but found ${row.prev_hash}`
        };
      }

      // 2. Recompute row hash from contents
      const rawPayload = typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload || {});
      const recomputedHash = AuditService.computeRowHash(row.prev_hash, {
        id: row.id,
        tenantId: row.tenant_id,
        eventType: row.event_type,
        actorType: row.actor_type,
        actorId: row.actor_id,
        payload: rawPayload
      });

      if (row.row_hash !== recomputedHash) {
        return {
          valid: false,
          totalChecked: index,
          brokenRowId: row.id,
          error: `Tampered row detected in tenant ${tenantId} at ${row.id}: stored row_hash ${row.row_hash} does not match computed hash ${recomputedHash}`
        };
      }

      expectedPrevHash = row.row_hash;
      index++;
    }

    return {
      valid: true,
      totalChecked: rows.length
    };
  }
}
