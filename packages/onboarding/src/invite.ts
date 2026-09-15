import { Kysely, Transaction } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import {
  AuthenticationError,
  ConflictError,
  generateInviteToken,
  hashToken,
  NotFoundError,
  ValidationError,
  type InviteToken,
  type InviteStatus
} from "@cloudops/shared";
import { recordAuditEvent } from "./audit.js";
import { generateOnboardingPrompt } from "./prompt.js";
import { randomUUID } from "node:crypto";

export interface InviteRecord {
  id: string;
  tokenHash: string;
  tenantId: string;
  status: InviteStatus;
  expiresAt: Date;
  createdBy: string;
  claimedAt: Date | null;
  createdAt: Date;
}

export interface CreateInviteOptions {
  agentName?: string | undefined;
  agentType?: "hermes" | "openclaw" | "custom" | string | undefined;
  instructions?: string | undefined;
  apiBaseUrl?: string | undefined;
  wsBaseUrl?: string | undefined;
}

export interface CreateInviteResult {
  id: string;
  inviteToken: InviteToken;
  tenantId: string;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
  onboardingPrompt: string;
}

export interface IInviteRepository {
  create(dto: Omit<InviteRecord, "claimedAt">, tx?: Transaction<DatabaseSchema>): Promise<InviteRecord>;
  findByHash(tokenHash: string): Promise<InviteRecord | null>;
  findById(tenantId: string, id: string): Promise<InviteRecord | null>;
  markConsumed(id: string, tx?: Transaction<DatabaseSchema>): Promise<void>;
  revoke(tenantId: string, id: string): Promise<void>;
}

function mapInviteRow(row: any): InviteRecord {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    tenantId: row.tenant_id,
    status: row.status as InviteStatus,
    expiresAt: new Date(row.expires_at),
    createdBy: row.created_by,
    claimedAt: row.claimed_at ? new Date(row.claimed_at) : null,
    createdAt: new Date(row.created_at)
  };
}

export class InviteRepository implements IInviteRepository {
  constructor(private readonly db: Kysely<DatabaseSchema> = getDatabase()) {}

  async create(dto: Omit<InviteRecord, "claimedAt">, tx?: Transaction<DatabaseSchema>): Promise<InviteRecord> {
    const executor = tx || this.db;
    const [row] = await executor
      .insertInto("agent_invites")
      .values({
        id: dto.id,
        token_hash: dto.tokenHash,
        tenant_id: dto.tenantId,
        status: dto.status,
        expires_at: dto.expiresAt,
        created_by: dto.createdBy,
        created_at: dto.createdAt
      } as any)
      .returningAll()
      .execute();

    if (!row) {
      throw new Error("Failed to insert invite record");
    }

    return mapInviteRow(row);
  }

  async findByHash(tokenHash: string): Promise<InviteRecord | null> {
    const row = await this.db
      .selectFrom("agent_invites")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .executeTakeFirst();

    return row ? mapInviteRow(row) : null;
  }

  async findById(tenantId: string, id: string): Promise<InviteRecord | null> {
    const row = await this.db
      .selectFrom("agent_invites")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();

    return row ? mapInviteRow(row) : null;
  }

  async markConsumed(id: string, tx?: Transaction<DatabaseSchema>): Promise<void> {
    const executor = tx || this.db;
    await executor
      .updateTable("agent_invites")
      .set({
        status: "CLAIMED",
        claimed_at: new Date()
      } as any)
      .where("id", "=", id)
      .execute();
  }

  async revoke(tenantId: string, id: string): Promise<void> {
    await this.db
      .updateTable("agent_invites")
      .set({
        status: "REVOKED"
      } as any)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .execute();
  }
}

export class InviteService {
  constructor(
    private readonly repo: IInviteRepository = new InviteRepository(),
    private readonly db: Kysely<DatabaseSchema> = getDatabase()
  ) {}

  /**
   * Create an onboarding invitation for an agent.
   * Generates a high-entropy invite token (co_inv_...) and stores ONLY its SHA-256 hash.
   * Returns the raw token exactly once.
   */
  async createInvite(
    tenantId: string,
    createdBy: string,
    expiresInSeconds: number = 86400,
    options?: CreateInviteOptions
  ): Promise<CreateInviteResult> {
    if (!tenantId) {
      throw new ValidationError("Tenant ID is required for invite creation");
    }

    const tenant = await this.db
      .selectFrom("tenants")
      .select("id")
      .where("id", "=", tenantId)
      .executeTakeFirst();

    if (!tenant) {
      throw new NotFoundError(`Tenant '${tenantId}' does not exist`);
    }

    if (expiresInSeconds <= 0 || expiresInSeconds > 7 * 86400) {
      throw new ValidationError("Expiration must be between 1 second and 7 days");
    }

    const inviteId = `inv_${randomUUID()}`;
    const rawToken = generateInviteToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const createdAt = new Date();

    const record = await this.repo.create({
      id: inviteId,
      tokenHash,
      tenantId,
      status: "ACTIVE",
      expiresAt,
      createdBy,
      createdAt
    });

    await recordAuditEvent(
      {
        tenantId,
        eventType: "INVITE_CREATED",
        actorType: "OPERATOR",
        actorId: createdBy,
        payload: {
          inviteId: record.id,
          expiresAt: record.expiresAt.toISOString()
        }
      },
      undefined,
      this.db
    );

    const onboardingPrompt = generateOnboardingPrompt({
      inviteToken: rawToken,
      tenantId: record.tenantId,
      expiresAt: record.expiresAt,
      apiBaseUrl: options?.apiBaseUrl,
      wsBaseUrl: options?.wsBaseUrl,
      agentName: options?.agentName,
      agentType: options?.agentType,
      instructions: options?.instructions
    });

    return {
      id: record.id,
      inviteToken: rawToken,
      tenantId: record.tenantId,
      status: record.status,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      onboardingPrompt
    };
  }

  /**
   * Validate and resolve an invite token.
   * Checks expiration server-side and enforces lifecycle state.
   */
  async validateAndGetInvite(rawToken: string): Promise<InviteRecord> {
    if (!rawToken || !rawToken.startsWith("co_inv_")) {
      throw new AuthenticationError("Invalid or malformed onboarding invite token");
    }

    const tokenHash = hashToken(rawToken);
    const invite = await this.repo.findByHash(tokenHash);

    if (!invite) {
      throw new AuthenticationError("Invalid or unknown onboarding invite token");
    }

    if (invite.status === "REVOKED") {
      throw new AuthenticationError("Onboarding invite has been revoked");
    }

    if (invite.status === "CLAIMED") {
      throw new ConflictError("Onboarding invite has already been consumed");
    }

    if (invite.status === "EXPIRED" || invite.expiresAt.getTime() <= Date.now()) {
      throw new AuthenticationError("Onboarding invite has expired");
    }

    return invite;
  }

  async revokeInvite(tenantId: string, inviteId: string, operatorId: string): Promise<void> {
    const invite = await this.repo.findById(tenantId, inviteId);
    if (!invite) {
      throw new NotFoundError(`Invite ${inviteId} not found`);
    }

    await this.repo.revoke(tenantId, inviteId);

    await recordAuditEvent(
      {
        tenantId,
        eventType: "INVITE_REVOKED",
        actorType: "OPERATOR",
        actorId: operatorId,
        payload: {
          inviteId
        }
      },
      undefined,
      this.db
    );
  }
}
