import { Kysely } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import {
  AuthenticationError,
  ConflictError,
  hashToken,
  type AgentId,
  type CredentialId,
  type SessionId,
  type RuntimeCredentialToken
} from "@cloudops/shared";
import {
  RuntimeCredentialService,
  RuntimeSessionService,
  recordAuditEvent,
  type RuntimeSessionRecord
} from "@cloudops/runtime";
import type { AuthMessage } from "./protocol.js";

export interface GatewayAuthResult {
  session: RuntimeSessionRecord;
  previousSessionId?: SessionId | undefined;
  runtimeCredential?: {
    credentialId: CredentialId;
    secret: RuntimeCredentialToken;
    expiresAt: string;
  } | undefined;
  authType: "BOOTSTRAP" | "RUNTIME";
  agentName?: string | undefined;
  grantedCapabilities?: string[] | undefined;
}

export class GatewayAuthenticator {
  constructor(
    private readonly credentialService: RuntimeCredentialService = new RuntimeCredentialService(),
    private readonly sessionService: RuntimeSessionService = new RuntimeSessionService(),
    private readonly db: Kysely<DatabaseSchema> = getDatabase()
  ) {}

  /**
   * Authenticate an inbound WebSocket connection.
   * Supports both one-time BOOTSTRAP exchange and ongoing RUNTIME authentication.
   */
  async authenticate(
    msg: AuthMessage,
    gatewayNodeId: string = "node-1"
  ): Promise<GatewayAuthResult> {
    if (msg.authType === "BOOTSTRAP") {
      return this.authenticateBootstrap(msg, gatewayNodeId);
    } else {
      return this.authenticateRuntime(msg, gatewayNodeId);
    }
  }

  /**
   * Handle one-time bootstrap credential exchange (co_agent_<64hex> -> cred_<64hex>).
   * Strict single-use guarantee: atomically marks exchanged_at inside a transaction.
   */
  private async authenticateBootstrap(
    msg: AuthMessage,
    gatewayNodeId: string
  ): Promise<GatewayAuthResult> {
    const rawCredential = msg.credential;
    if (!rawCredential.startsWith("co_agent_")) {
      throw new AuthenticationError("Invalid bootstrap credential format");
    }

    const tokenHash = hashToken(rawCredential);

    return this.db.transaction().execute(async (tx) => {
      // Find and lock claim credential row
      const claimRow = await tx
        .selectFrom("agent_claim_credentials")
        .selectAll()
        .where("claim_token_hash", "=", tokenHash)
        .forUpdate()
        .executeTakeFirst();

      if (!claimRow || claimRow.status !== "CONSUMED") {
        await recordAuditEvent(
          {
            tenantId: "unknown",
            eventType: "GATEWAY_AUTHENTICATION_FAILED",
            actorType: "SYSTEM",
            actorId: gatewayNodeId,
            payload: {
              authType: "BOOTSTRAP",
              reason: "UNKNOWN_OR_UNCONSUMED_BOOTSTRAP_TOKEN"
            }
          },
          tx,
          this.db
        );
        throw new AuthenticationError("Invalid or unknown bootstrap credential");
      }

      // Replay check
      if (claimRow.exchanged_at) {
        await recordAuditEvent(
          {
            tenantId: claimRow.tenant_id,
            eventType: "GATEWAY_AUTHENTICATION_FAILED",
            actorType: "AGENT",
            actorId: claimRow.agent_id,
            agentId: claimRow.agent_id,
            payload: {
              authType: "BOOTSTRAP",
              reason: "BOOTSTRAP_ALREADY_EXCHANGED"
            }
          },
          tx,
          this.db
        );
        throw new ConflictError("Bootstrap credential has already been exchanged for a runtime credential");
      }

      // Expiration check
      const now = new Date();
      if (new Date(claimRow.expires_at).getTime() <= now.getTime()) {
        await recordAuditEvent(
          {
            tenantId: claimRow.tenant_id,
            eventType: "GATEWAY_AUTHENTICATION_FAILED",
            actorType: "AGENT",
            actorId: claimRow.agent_id,
            agentId: claimRow.agent_id,
            payload: {
              authType: "BOOTSTRAP",
              reason: "BOOTSTRAP_EXPIRED"
            }
          },
          tx,
          this.db
        );
        throw new AuthenticationError("Bootstrap credential has expired");
      }

      const tenantId = claimRow.tenant_id;
      const agentId = claimRow.agent_id as AgentId;

      // Mark bootstrap credential as exchanged
      await tx
        .updateTable("agent_claim_credentials")
        .set({ exchanged_at: now } as any)
        .where("id", "=", claimRow.id)
        .execute();

      // Issue initial runtime credential (cred_...)
      const runtimeCred = await this.credentialService.issueInitialCredential(
        tenantId,
        agentId,
        30 * 24 * 3600, // 30 days
        tx
      );

      // Create runtime session and transition agent to CONNECTED
      const { session, previousSessionId } = await this.sessionService.createSession(
        tenantId,
        agentId,
        runtimeCred.credentialId,
        gatewayNodeId,
        tx
      );

      await recordAuditEvent(
        {
          tenantId,
          eventType: "AGENT_BOOTSTRAP_EXCHANGED",
          actorType: "AGENT",
          actorId: agentId,
          agentId,
          payload: {
            sessionId: session.id,
            credentialId: runtimeCred.credentialId
          }
        },
        tx,
        this.db
      );

      await recordAuditEvent(
        {
          tenantId,
          eventType: "AGENT_GATEWAY_AUTHENTICATED",
          actorType: "AGENT",
          actorId: agentId,
          agentId,
          payload: {
            authType: "BOOTSTRAP",
            sessionId: session.id,
            credentialId: runtimeCred.credentialId,
            agentName: msg.runtimeInfo?.name || "unknown"
          }
        },
        tx,
        this.db
      );

      const joinRequest = await tx
        .selectFrom("agent_join_requests")
        .select(["agent_name", "declared_capabilities"])
        .where("id", "=", claimRow.join_request_id)
        .executeTakeFirst();

      let grantedCapabilities: string[] = [];
      if (joinRequest?.declared_capabilities) {
        try {
          grantedCapabilities = typeof joinRequest.declared_capabilities === "string"
            ? JSON.parse(joinRequest.declared_capabilities)
            : joinRequest.declared_capabilities;
        } catch {
          grantedCapabilities = [];
        }
      }
      const agentName = joinRequest?.agent_name || msg.runtimeInfo?.name || "agent";

      return {
        session,
        previousSessionId,
        runtimeCredential: {
          credentialId: runtimeCred.credentialId,
          secret: runtimeCred.secret,
          expiresAt: runtimeCred.expiresAt.toISOString()
        },
        authType: "BOOTSTRAP",
        agentName,
        grantedCapabilities
      };
    });
  }

  /**
   * Handle subsequent runtime credential authentication (cred_<64hex>).
   */
  private async authenticateRuntime(
    msg: AuthMessage,
    gatewayNodeId: string
  ): Promise<GatewayAuthResult> {
    const rawCredential = msg.credential;
    if (!rawCredential.startsWith("cred_")) {
      throw new AuthenticationError("Invalid runtime credential format");
    }

    try {
      const credRecord = await this.credentialService.validateCredential(
        rawCredential,
        msg.agentId as AgentId | undefined
      );

      const { session, previousSessionId } = await this.sessionService.createSession(
        credRecord.tenantId,
        credRecord.agentId,
        credRecord.id,
        gatewayNodeId
      );

      const joinRequest = await this.db
        .selectFrom("agent_join_requests")
        .select(["agent_name", "declared_capabilities"])
        .where("agent_id", "=", credRecord.agentId)
        .executeTakeFirst();

      let grantedCapabilities: string[] = [];
      if (joinRequest?.declared_capabilities) {
        try {
          grantedCapabilities = typeof joinRequest.declared_capabilities === "string"
            ? JSON.parse(joinRequest.declared_capabilities)
            : joinRequest.declared_capabilities;
        } catch {
          grantedCapabilities = [];
        }
      }
      const agentName = joinRequest?.agent_name || msg.runtimeInfo?.name || "agent";

      await recordAuditEvent(
        {
          tenantId: credRecord.tenantId,
          eventType: "AGENT_GATEWAY_AUTHENTICATED",
          actorType: "AGENT",
          actorId: credRecord.agentId,
          agentId: credRecord.agentId,
          payload: {
            authType: "RUNTIME",
            sessionId: session.id,
            credentialId: credRecord.id
          }
        },
        undefined,
        this.db
      );

      return {
        session,
        previousSessionId,
        runtimeCredential: undefined,
        authType: "RUNTIME",
        agentName,
        grantedCapabilities
      };
    } catch (err: any) {
      await recordAuditEvent(
        {
          tenantId: "unknown",
          eventType: "GATEWAY_AUTHENTICATION_FAILED",
          actorType: "SYSTEM",
          actorId: gatewayNodeId,
          payload: {
            authType: "RUNTIME",
            reason: err?.message || "AUTHENTICATION_FAILED"
          }
        },
        undefined,
        this.db
      );
      throw err;
    }
  }
}
