import { Kysely } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  generateCredentialId,
  generateRuntimeCredentialToken,
  generateSalt,
  hashToken,
  verifyTokenHash,
  type AgentId,
  type CredentialId,
  type RuntimeCredentialToken
} from "@cloudops/shared";
import type {
  IssuedRuntimeCredential,
  RuntimeCredentialRecord,
  RuntimeCredentialStatus
} from "./types.js";
import { recordAuditEvent } from "./audit.js";

export class RuntimeCredentialService {
  constructor(private readonly db: Kysely<DatabaseSchema> = getDatabase()) {}

  /**
   * Issue an initial runtime credential for a registered agent.
   * Cryptographically random 256 bits of entropy. Plaintext is returned once; only hash is stored.
   */
  async issueInitialCredential(
    tenantId: string,
    agentId: AgentId,
    ttlSeconds: number = 30 * 24 * 3600, // Default 30 days
    tx?: Kysely<DatabaseSchema>
  ): Promise<IssuedRuntimeCredential> {
    const db = tx || this.db;
    const credentialId = generateCredentialId();
    const rawSecret = generateRuntimeCredentialToken();
    const salt = generateSalt();
    const credentialHash = hashToken(rawSecret, salt);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    await db
      .insertInto("agent_credentials")
      .values({
        id: credentialId,
        agent_id: agentId,
        tenant_id: tenantId,
        credential_hash: credentialHash,
        salt,
        status: "ACTIVE",
        issued_at: now,
        expires_at: expiresAt,
        created_at: now,
        revoked_at: null,
        rotated_at: null,
        replaced_by_credential_id: null,
        last_used_at: null
      } as any)
      .execute();

    await recordAuditEvent(
      {
        tenantId,
        eventType: "RUNTIME_CREDENTIAL_ISSUED",
        actorType: "SYSTEM",
        actorId: "cloudops-runtime",
        agentId,
        payload: {
          credentialId,
          agentId,
          expiresAt: expiresAt.toISOString()
        }
      },
      tx,
      this.db
    );

    return {
      credentialId,
      secret: rawSecret,
      expiresAt
    };
  }

  /**
   * Validate a supplied runtime credential token against the active credentials for an agent.
   * Constant-time comparison ensures timing-attack safety.
   */
  async validateCredential(
    token: string,
    agentId?: AgentId,
    tx?: Kysely<DatabaseSchema>
  ): Promise<RuntimeCredentialRecord> {
    const db = tx || this.db;

    if (!token || !token.startsWith("cred_")) {
      throw new AuthenticationError("Invalid or malformed runtime credential format");
    }

    let query = db
      .selectFrom("agent_credentials")
      .selectAll()
      .where("status", "=", "ACTIVE");

    if (agentId) {
      query = query.where("agent_id", "=", agentId);
    }

    const rows = await query.execute();

    let matchedRow: typeof rows[0] | undefined;
    for (const row of rows) {
      if (verifyTokenHash(token, row.credential_hash, row.salt)) {
        matchedRow = row;
        break;
      }
    }

    if (!matchedRow) {
      throw new AuthenticationError("Invalid or unknown runtime credential");
    }

    const now = new Date();
    if (new Date(matchedRow.expires_at).getTime() <= now.getTime()) {
      throw new AuthenticationError("Runtime credential has expired");
    }

    // Update last_used_at
    await db
      .updateTable("agent_credentials")
      .set({ last_used_at: now } as any)
      .where("id", "=", matchedRow.id)
      .execute();

    return {
      id: matchedRow.id as CredentialId,
      agentId: matchedRow.agent_id as AgentId,
      tenantId: matchedRow.tenant_id || "",
      credentialHash: matchedRow.credential_hash,
      salt: matchedRow.salt,
      status: matchedRow.status as RuntimeCredentialStatus,
      issuedAt: new Date(matchedRow.issued_at),
      expiresAt: new Date(matchedRow.expires_at),
      createdAt: new Date(matchedRow.created_at),
      revokedAt: matchedRow.revoked_at ? new Date(matchedRow.revoked_at) : null,
      rotatedAt: matchedRow.rotated_at ? new Date(matchedRow.rotated_at) : null,
      replacedByCredentialId: matchedRow.replaced_by_credential_id,
      lastUsedAt: now
    };
  }

  /**
   * Atomically rotate an existing runtime credential.
   * Invalidates current credential (ROTATED) and issues a new one within a transaction.
   */
  async rotateCredential(
    tenantId: string,
    agentId: AgentId,
    currentCredentialId: CredentialId,
    ttlSeconds: number = 30 * 24 * 3600
  ): Promise<IssuedRuntimeCredential> {
    return this.db.transaction().execute(async (tx) => {
      // Lock current credential row to prevent race conditions
      const current = await tx
        .selectFrom("agent_credentials")
        .selectAll()
        .where("id", "=", currentCredentialId)
        .where("tenant_id", "=", tenantId)
        .where("agent_id", "=", agentId)
        .forUpdate()
        .executeTakeFirst();

      if (!current) {
        throw new NotFoundError("Runtime credential not found for rotation");
      }

      if (current.status !== "ACTIVE") {
        throw new ConflictError(`Cannot rotate credential with status '${current.status}'. Must be 'ACTIVE'.`);
      }

      const now = new Date();
      if (new Date(current.expires_at).getTime() <= now.getTime()) {
        throw new ConflictError("Cannot rotate expired credential");
      }

      const newCredentialId = generateCredentialId();
      const newSecret = generateRuntimeCredentialToken();
      const newSalt = generateSalt();
      const newHash = hashToken(newSecret, newSalt);
      const newExpiresAt = new Date(now.getTime() + ttlSeconds * 1000);

      // 1. Insert new active credential first to satisfy foreign key constraint
      await tx
        .insertInto("agent_credentials")
        .values({
          id: newCredentialId,
          agent_id: agentId,
          tenant_id: tenantId,
          credential_hash: newHash,
          salt: newSalt,
          status: "ACTIVE",
          issued_at: now,
          expires_at: newExpiresAt,
          created_at: now,
          revoked_at: null,
          rotated_at: null,
          replaced_by_credential_id: null,
          last_used_at: null
        } as any)
        .execute();

      // 2. Invalidate and link old credential
      await tx
        .updateTable("agent_credentials")
        .set({
          status: "ROTATED",
          rotated_at: now,
          replaced_by_credential_id: newCredentialId
        } as any)
        .where("id", "=", currentCredentialId)
        .execute();

      await recordAuditEvent(
        {
          tenantId,
          eventType: "RUNTIME_CREDENTIAL_ROTATED",
          actorType: "AGENT",
          actorId: agentId,
          agentId,
          payload: {
            oldCredentialId: currentCredentialId,
            newCredentialId,
            expiresAt: newExpiresAt.toISOString()
          }
        },
        tx,
        this.db
      );

      return {
        credentialId: newCredentialId,
        secret: newSecret,
        expiresAt: newExpiresAt
      };
    });
  }

  /**
   * Revoke an existing runtime credential.
   */
  async revokeCredential(
    tenantId: string,
    agentId: AgentId,
    credentialId: CredentialId
  ): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const current = await tx
        .selectFrom("agent_credentials")
        .selectAll()
        .where("id", "=", credentialId)
        .where("tenant_id", "=", tenantId)
        .where("agent_id", "=", agentId)
        .forUpdate()
        .executeTakeFirst();

      if (!current) {
        throw new NotFoundError("Runtime credential not found for revocation");
      }

      const now = new Date();
      await tx
        .updateTable("agent_credentials")
        .set({
          status: "REVOKED",
          revoked_at: now
        } as any)
        .where("id", "=", credentialId)
        .execute();

      await recordAuditEvent(
        {
          tenantId,
          eventType: "RUNTIME_CREDENTIAL_REVOKED",
          actorType: "OPERATOR",
          actorId: "operator",
          agentId,
          payload: {
            credentialId,
            agentId
          }
        },
        tx,
        this.db
      );
    });
  }
}
