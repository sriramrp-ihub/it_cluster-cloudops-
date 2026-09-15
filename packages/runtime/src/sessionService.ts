import { Kysely } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import {
  generateSessionId,
  hashToken,
  type AgentId,
  type CredentialId,
  type SessionId
} from "@cloudops/shared";
import { randomBytes } from "node:crypto";
import type {
  DisconnectReason,
  RuntimeSessionRecord,
  SessionStatus
} from "./types.js";
import { recordAuditEvent } from "./audit.js";

export class RuntimeSessionService {
  constructor(private readonly db: Kysely<DatabaseSchema> = getDatabase()) {}

  /**
   * Create an authenticated runtime session.
   * Enforces single active session per agent: terminates any existing active session
   * with disconnectReason 'REPLACED_BY_NEW_CONNECTION'.
   * Transitions agent status to CONNECTED.
   */
  async createSession(
    tenantId: string,
    agentId: AgentId,
    credentialId: CredentialId,
    gatewayNodeId: string = "node-1",
    tx?: Kysely<DatabaseSchema>
  ): Promise<{ session: RuntimeSessionRecord; previousSessionId?: SessionId | undefined }> {
    const executeLogic = async (trx: Kysely<DatabaseSchema>) => {
      const now = new Date();

      // 1. Check for existing active sessions for this agent and terminate them
      const activeSessions = await trx
        .selectFrom("agent_sessions")
        .selectAll()
        .where("agent_id", "=", agentId)
        .where("status", "=", "CONNECTED")
        .forUpdate()
        .execute();

      let previousSessionId: SessionId | undefined;
      for (const prev of activeSessions) {
        previousSessionId = prev.id as SessionId;
        await trx
          .updateTable("agent_sessions")
          .set({
            status: "DISCONNECTED",
            disconnect_reason: "REPLACED_BY_NEW_CONNECTION",
            disconnected_at: now
          } as any)
          .where("id", "=", prev.id)
          .execute();

        await recordAuditEvent(
          {
            tenantId,
            eventType: "AGENT_SESSION_DISCONNECTED",
            actorType: "SYSTEM",
            actorId: gatewayNodeId,
            agentId,
            payload: {
              sessionId: prev.id,
              reason: "REPLACED_BY_NEW_CONNECTION"
            }
          },
          trx,
          this.db
        );
      }

      // 2. Insert new session
      const sessionId = generateSessionId();
      const sessionTokenHash = hashToken(randomBytes(32).toString("hex"));

      await trx
        .insertInto("agent_sessions")
        .values({
          id: sessionId,
          agent_id: agentId,
          tenant_id: tenantId,
          credential_id: credentialId,
          session_token_hash: sessionTokenHash,
          status: "CONNECTED",
          client_nonce: null,
          server_nonce: null,
          disconnect_reason: null,
          gateway_node_id: gatewayNodeId,
          last_heartbeat_at: now,
          connected_at: now,
          disconnected_at: null
        } as any)
        .execute();

      // 3. Transition agent to CONNECTED
      await trx
        .updateTable("agents")
        .set({
          status: "CONNECTED",
          updated_at: now
        } as any)
        .where("id", "=", agentId)
        .where("tenant_id", "=", tenantId)
        .execute();

      // 4. Audit events
      await recordAuditEvent(
        {
          tenantId,
          eventType: "AGENT_SESSION_CONNECTED",
          actorType: "AGENT",
          actorId: agentId,
          agentId,
          payload: {
            sessionId,
            credentialId,
            gatewayNodeId
          }
        },
        trx,
        this.db
      );

      return {
        session: {
          id: sessionId,
          agentId,
          tenantId,
          credentialId,
          status: "CONNECTED" as SessionStatus,
          disconnectReason: null,
          gatewayNodeId,
          lastHeartbeatAt: now,
          connectedAt: now,
          disconnectedAt: null
        },
        previousSessionId
      };
    };

    if (tx) {
      return executeLogic(tx);
    } else {
      return this.db.transaction().execute(executeLogic);
    }
  }

  /**
   * Record a heartbeat from an active session, updating last_heartbeat_at.
   */
  async recordHeartbeat(sessionId: SessionId): Promise<boolean> {
    const now = new Date();
    const result = await this.db
      .updateTable("agent_sessions")
      .set({
        last_heartbeat_at: now
      } as any)
      .where("id", "=", sessionId)
      .where("status", "=", "CONNECTED")
      .executeTakeFirst();

    return Number(result.numUpdatedRows || 0) > 0;
  }

  /**
   * Terminate an active session idempotently.
   * If already disconnected, gracefully returns without error.
   * If agent has no other active sessions, transitions agent status to REGISTERED.
   */
  async terminateSession(
    sessionId: SessionId,
    reason: DisconnectReason,
    actorId: string = "gateway"
  ): Promise<boolean> {
    return this.db.transaction().execute(async (tx) => {
      const session = await tx
        .selectFrom("agent_sessions")
        .selectAll()
        .where("id", "=", sessionId)
        .forUpdate()
        .executeTakeFirst();

      if (!session) {
        return false;
      }

      // Idempotency: if already disconnected, do not re-terminate
      if (session.status === "DISCONNECTED") {
        return true;
      }

      const now = new Date();
      await tx
        .updateTable("agent_sessions")
        .set({
          status: "DISCONNECTED",
          disconnect_reason: reason,
          disconnected_at: now
        } as any)
        .where("id", "=", sessionId)
        .execute();

      // Check if agent has any remaining active connected sessions
      const remainingActive = await tx
        .selectFrom("agent_sessions")
        .select("id")
        .where("agent_id", "=", session.agent_id)
        .where("status", "=", "CONNECTED")
        .execute();

      if (remainingActive.length === 0) {
        // Transition agent status back to REGISTERED
        await tx
          .updateTable("agents")
          .set({
            status: "REGISTERED",
            updated_at: now
          } as any)
          .where("id", "=", session.agent_id)
          .execute();
      }

      const eventType =
        reason === "HEARTBEAT_TIMEOUT" ? "AGENT_SESSION_TIMEOUT" : "AGENT_SESSION_DISCONNECTED";

      await recordAuditEvent(
        {
          tenantId: session.tenant_id || "",
          eventType,
          actorType: "SYSTEM",
          actorId,
          agentId: session.agent_id,
          payload: {
            sessionId,
            reason
          }
        },
        tx,
        this.db
      );

      return true;
    });
  }

  /**
   * Sweep stale sessions whose last heartbeat exceeds the timeout window.
   */
  async sweepStaleSessions(timeoutMs: number): Promise<SessionId[]> {
    const cutoff = new Date(Date.now() - timeoutMs);

    const staleSessions = await this.db
      .selectFrom("agent_sessions")
      .select(["id", "agent_id", "tenant_id"])
      .where("status", "=", "CONNECTED")
      .where("last_heartbeat_at", "<", cutoff)
      .execute();

    const terminatedIds: SessionId[] = [];
    for (const session of staleSessions) {
      await this.terminateSession(session.id as SessionId, "HEARTBEAT_TIMEOUT", "heartbeat-monitor");
      terminatedIds.push(session.id as SessionId);
    }

    return terminatedIds;
  }

  /**
   * Get session details by ID.
   */
  async getSession(sessionId: SessionId): Promise<RuntimeSessionRecord | null> {
    const row = await this.db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("id", "=", sessionId)
      .executeTakeFirst();

    if (!row) {
      return null;
    }

    return {
      id: row.id as SessionId,
      agentId: row.agent_id as AgentId,
      tenantId: row.tenant_id || "",
      credentialId: row.credential_id as CredentialId,
      status: row.status as SessionStatus,
      disconnectReason: row.disconnect_reason,
      gatewayNodeId: row.gateway_node_id,
      lastHeartbeatAt: new Date(row.last_heartbeat_at),
      connectedAt: new Date(row.connected_at),
      disconnectedAt: row.disconnected_at ? new Date(row.disconnected_at) : null
    };
  }
}
