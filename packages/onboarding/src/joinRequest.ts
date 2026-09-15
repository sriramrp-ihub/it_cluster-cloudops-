import { Kysely, Transaction } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import {
  generateJoinRequestId,
  generateAgentId,
  generateCredentialId,
  ConflictError,
  NotFoundError,
  ValidationError,
  type JoinRequestId,
  type JoinRequestStatus,
  type AgentId
} from "@cloudops/shared";
import { InviteService } from "./invite.js";
import { recordAuditEvent } from "./audit.js";

export interface JoinRequestRecord {
  id: JoinRequestId;
  inviteId: string;
  tenantId: string;
  agentId: AgentId | null;
  agentName: string;
  agentType: string;
  agentVersion: string;
  gatewayProtocol: string;
  endpoint: string | null;
  declaredCapabilities: string[];
  status: JoinRequestStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date;
}

export interface SubmitJoinRequestInput {
  agent: {
    name: string;
    type: string;
  };
  runtime: {
    name: string;
    version: string;
    protocol?: string | undefined;
    endpoint?: string | undefined;
  };
  requestedCapabilities?: string[] | undefined;
}

export interface SubmitJoinRequestResult {
  joinRequestId: JoinRequestId;
  status: JoinRequestStatus;
  lifecycleState: "WAIT_FOR_APPROVAL";
  nextAction: "WAIT_FOR_APPROVAL";
  createdAt: Date;
}

export interface ApproveJoinRequestResult {
  joinRequestId: JoinRequestId;
  agentId: AgentId;
  status: "APPROVED";
  reviewedBy: string;
  reviewedAt: Date;
  agent: {
    id: AgentId;
    name: string;
    status: "APPROVED";
  };
}

export interface IJoinRequestRepository {
  create(dto: Omit<JoinRequestRecord, "reviewedBy" | "reviewedAt" | "rejectionReason">, tx?: Transaction<DatabaseSchema>): Promise<JoinRequestRecord>;
  findById(tenantId: string, id: JoinRequestId): Promise<JoinRequestRecord | null>;
  findActiveByInviteId(inviteId: string): Promise<JoinRequestRecord | null>;
  list(tenantId: string, status?: string): Promise<JoinRequestRecord[]>;
  approve(
    tenantId: string,
    id: JoinRequestId,
    agentId: AgentId,
    reviewedBy: string,
    tx?: Transaction<DatabaseSchema>
  ): Promise<void>;
  reject(
    tenantId: string,
    id: JoinRequestId,
    reviewedBy: string,
    reason: string | null,
    tx?: Transaction<DatabaseSchema>
  ): Promise<void>;
}

function mapJoinRequestRow(row: any): JoinRequestRecord {
  let capabilities: string[] = [];
  if (typeof row.declared_capabilities === "string") {
    try {
      capabilities = JSON.parse(row.declared_capabilities);
    } catch {
      capabilities = [];
    }
  } else if (Array.isArray(row.declared_capabilities)) {
    capabilities = row.declared_capabilities;
  }

  return {
    id: row.id as JoinRequestId,
    inviteId: row.invite_id,
    tenantId: row.tenant_id,
    agentId: row.agent_id ? (row.agent_id as AgentId) : null,
    agentName: row.agent_name,
    agentType: row.agent_type,
    agentVersion: row.agent_version,
    gatewayProtocol: row.gateway_protocol,
    endpoint: row.endpoint,
    declaredCapabilities: capabilities,
    status: row.status as JoinRequestStatus,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    rejectionReason: row.rejection_reason,
    createdAt: new Date(row.created_at)
  };
}

export class JoinRequestRepository implements IJoinRequestRepository {
  constructor(private readonly db: Kysely<DatabaseSchema> = getDatabase()) {}

  async create(
    dto: Omit<JoinRequestRecord, "reviewedBy" | "reviewedAt" | "rejectionReason">,
    tx?: Transaction<DatabaseSchema>
  ): Promise<JoinRequestRecord> {
    const executor = tx || this.db;
    const [row] = await executor
      .insertInto("agent_join_requests")
      .values({
        id: dto.id,
        invite_id: dto.inviteId,
        tenant_id: dto.tenantId,
        agent_id: dto.agentId || null,
        agent_name: dto.agentName,
        agent_type: dto.agentType,
        agent_version: dto.agentVersion,
        gateway_protocol: dto.gatewayProtocol,
        endpoint: dto.endpoint,
        declared_capabilities: JSON.stringify(dto.declaredCapabilities) as any,
        status: dto.status,
        created_at: dto.createdAt
      } as any)
      .returningAll()
      .execute();

    if (!row) {
      throw new Error("Failed to insert join request");
    }

    return mapJoinRequestRow(row);
  }

  async findById(tenantId: string, id: JoinRequestId): Promise<JoinRequestRecord | null> {
    const row = await this.db
      .selectFrom("agent_join_requests")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();

    return row ? mapJoinRequestRow(row) : null;
  }

  async findActiveByInviteId(inviteId: string): Promise<JoinRequestRecord | null> {
    const row = await this.db
      .selectFrom("agent_join_requests")
      .selectAll()
      .where("invite_id", "=", inviteId)
      .where("status", "in", ["PENDING_APPROVAL", "APPROVED"])
      .executeTakeFirst();

    return row ? mapJoinRequestRow(row) : null;
  }

  async list(tenantId: string, status?: string): Promise<JoinRequestRecord[]> {
    let query = this.db
      .selectFrom("agent_join_requests")
      .selectAll()
      .where("tenant_id", "=", tenantId);

    if (status) {
      query = query.where("status", "=", status);
    }

    const rows = await query.orderBy("created_at", "desc").execute();
    return rows.map(mapJoinRequestRow);
  }

  async approve(
    tenantId: string,
    id: JoinRequestId,
    agentId: AgentId,
    reviewedBy: string,
    tx?: Transaction<DatabaseSchema>
  ): Promise<void> {
    const executor = tx || this.db;
    await executor
      .updateTable("agent_join_requests")
      .set({
        status: "APPROVED",
        agent_id: agentId,
        reviewed_by: reviewedBy,
        reviewed_at: new Date()
      } as any)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .execute();
  }

  async reject(
    tenantId: string,
    id: JoinRequestId,
    reviewedBy: string,
    reason: string | null,
    tx?: Transaction<DatabaseSchema>
  ): Promise<void> {
    const executor = tx || this.db;
    await executor
      .updateTable("agent_join_requests")
      .set({
        status: "REJECTED",
        reviewed_by: reviewedBy,
        reviewed_at: new Date(),
        rejection_reason: reason
      } as any)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .execute();
  }
}

export class JoinRequestService {
  constructor(
    private readonly repo: IJoinRequestRepository = new JoinRequestRepository(),
    private readonly inviteService: InviteService = new InviteService(),
    private readonly db: Kysely<DatabaseSchema> = getDatabase()
  ) {}

  /**
   * Submit a declarative Join Request using an active invite token.
   */
  async submitJoinRequest(rawToken: string, input: SubmitJoinRequestInput): Promise<SubmitJoinRequestResult> {
    const invite = await this.inviteService.validateAndGetInvite(rawToken);

    if (!input.agent?.name || input.agent.name.trim().length === 0) {
      throw new ValidationError("Agent name is required");
    }

    const allowedTypes = ["hermes", "openclaw", "custom"];
    const agentType = input.agent.type?.toLowerCase();
    if (!agentType || !allowedTypes.includes(agentType)) {
      throw new ValidationError(`Unsupported agent type '${input.agent?.type}'. Supported: ${allowedTypes.join(", ")}`);
    }

    // Duplicate join protection: one active join request per invite
    const existing = await this.repo.findActiveByInviteId(invite.id);
    if (existing) {
      throw new ConflictError("An active join request already exists for this onboarding invite");
    }

    const joinRequestId = generateJoinRequestId();
    const createdAt = new Date();

    const record = await this.repo.create({
      id: joinRequestId,
      inviteId: invite.id,
      tenantId: invite.tenantId,
      agentId: null,
      agentName: input.agent.name.trim(),
      agentType,
      agentVersion: input.runtime?.version || "1.0.0",
      gatewayProtocol: input.runtime?.protocol || "acp",
      endpoint: input.runtime?.endpoint || null,
      declaredCapabilities: input.requestedCapabilities || [],
      status: "PENDING_APPROVAL",
      createdAt
    });

    await recordAuditEvent(
      {
        tenantId: invite.tenantId,
        eventType: "JOIN_REQUEST_SUBMITTED",
        actorType: "AGENT",
        actorId: record.agentName,
        payload: {
          joinRequestId: record.id,
          inviteId: invite.id,
          agentType: record.agentType,
          requestedCapabilities: record.declaredCapabilities
        }
      },
      undefined,
      this.db
    );

    return {
      joinRequestId: record.id,
      status: record.status,
      lifecycleState: "WAIT_FOR_APPROVAL",
      nextAction: "WAIT_FOR_APPROVAL",
      createdAt: record.createdAt
    };
  }

  async listJoinRequests(tenantId: string, status?: string): Promise<JoinRequestRecord[]> {
    if (!tenantId) {
      throw new ValidationError("Tenant ID is required");
    }
    return this.repo.list(tenantId, status);
  }

  async getJoinRequest(tenantId: string, id: JoinRequestId): Promise<JoinRequestRecord> {
    const jr = await this.repo.findById(tenantId, id);
    if (!jr) {
      throw new NotFoundError(`Join request ${id} not found`);
    }
    return jr;
  }

  /**
   * Operator approval workflow.
   * Transactionally:
   * 1. Transitions join request to APPROVED
   * 2. Creates stable agent identity (ag_...) with status 'APPROVED' (NOT CONNECTED!)
   * 3. Mints available claim credential slot
   * 4. Emits audit events
   */
  async approveJoinRequest(
    tenantId: string,
    id: JoinRequestId,
    operatorId: string
  ): Promise<ApproveJoinRequestResult> {
    const jr = await this.getJoinRequest(tenantId, id);

    if (jr.status !== "PENDING_APPROVAL") {
      throw new ConflictError(`Cannot approve join request with status '${jr.status}'. Expected 'PENDING_APPROVAL'.`);
    }

    const agentId = generateAgentId();
    const claimCredId = generateCredentialId();
    const reviewedAt = new Date();

    return this.db.transaction().execute(async (tx) => {
      // 1. Create stable Agent in PostgreSQL
      await tx
        .insertInto("agents")
        .values({
          id: agentId,
          tenant_id: tenantId,
          name: jr.agentName,
          type: jr.agentType,
          version: jr.agentVersion,
          runtime_protocol: jr.gatewayProtocol,
          status: "APPROVED", // Approved is strictly NOT Connected!
          created_at: reviewedAt,
          updated_at: reviewedAt
        } as any)
        .execute();

      // 2. Update join request
      await this.repo.approve(tenantId, id, agentId, operatorId, tx);

      // 3. Create claim credential placeholder slot (available for 15 minutes)
      const claimExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await tx
        .insertInto("agent_claim_credentials")
        .values({
          id: claimCredId,
          join_request_id: id,
          agent_id: agentId,
          tenant_id: tenantId,
          claim_token_hash: "PENDING_CLAIM",
          status: "AVAILABLE",
          expires_at: claimExpiresAt,
          created_at: reviewedAt
        } as any)
        .execute();

      // 4. Audit events
      await recordAuditEvent(
        {
          tenantId,
          eventType: "JOIN_REQUEST_APPROVED",
          actorType: "OPERATOR",
          actorId: operatorId,
          agentId,
          payload: {
            joinRequestId: id,
            agentId
          }
        },
        tx,
        this.db
      );

      await recordAuditEvent(
        {
          tenantId,
          eventType: "CLAIM_CREDENTIAL_ISSUED",
          actorType: "SYSTEM",
          actorId: "cloudops-auth",
          agentId,
          payload: {
            joinRequestId: id,
            claimCredId,
            expiresAt: claimExpiresAt.toISOString()
          }
        },
        tx,
        this.db
      );

      return {
        joinRequestId: id,
        agentId,
        status: "APPROVED",
        reviewedBy: operatorId,
        reviewedAt,
        agent: {
          id: agentId,
          name: jr.agentName,
          status: "APPROVED"
        }
      };
    });
  }

  async rejectJoinRequest(
    tenantId: string,
    id: JoinRequestId,
    operatorId: string,
    reason: string = "Rejected by operator"
  ): Promise<void> {
    const jr = await this.getJoinRequest(tenantId, id);

    if (jr.status !== "PENDING_APPROVAL") {
      throw new ConflictError(`Cannot reject join request with status '${jr.status}'. Expected 'PENDING_APPROVAL'.`);
    }

    await this.repo.reject(tenantId, id, operatorId, reason);

    await recordAuditEvent(
      {
        tenantId,
        eventType: "JOIN_REQUEST_REJECTED",
        actorType: "OPERATOR",
        actorId: operatorId,
        payload: {
          joinRequestId: id,
          reason
        }
      },
      undefined,
      this.db
    );
  }
}
