import { Kysely, Transaction } from "kysely";
import type { DatabaseSchema, AgentTable } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import type { AgentId, AgentStatus, AgentGovernanceStatus } from "@cloudops/shared";

export interface AgentRecord {
  id: AgentId;
  tenantId: string;
  name: string;
  type: string;
  version: string;
  runtimeProtocol: string;
  status: AgentStatus;
  cloudAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** ADR-0008 Phase A: governed Hermes profile lockdown tracking. */
  hermesProfileName: string | null;
  governanceStatus: AgentGovernanceStatus;
  governanceVerifiedAt: Date | null;
  mcpRegistered: boolean;
}

/** Patch accepted by IAgentRepository.updateGovernance — see HermesProfileService. */
export interface AgentGovernancePatch {
  hermesProfileName: string | null;
  governanceStatus: AgentGovernanceStatus;
  governanceVerifiedAt: Date | null;
  mcpRegistered: boolean;
}

export interface CreateAgentDto {
  id: AgentId;
  tenantId: string;
  name: string;
  type: string;
  version: string;
  runtimeProtocol: string;
  status?: AgentStatus;
}

function mapAgentRow(row: any): AgentRecord {
  return {
    id: row.id as AgentId,
    tenantId: row.tenant_id,
    name: row.name,
    type: row.type,
    version: row.version,
    runtimeProtocol: row.runtime_protocol,
    status: row.status as AgentStatus,
    cloudAccountId: row.cloud_account_id ?? null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    hermesProfileName: row.hermes_profile_name ?? null,
    governanceStatus: (row.governance_status as AgentGovernanceStatus) ?? "PENDING",
    governanceVerifiedAt: row.governance_verified_at ? new Date(row.governance_verified_at) : null,
    mcpRegistered: Boolean(row.mcp_registered)
  };
}

export interface IAgentRepository {
  create(dto: CreateAgentDto, tx?: Transaction<DatabaseSchema>): Promise<AgentRecord>;
  findById(tenantId: string, id: AgentId): Promise<AgentRecord | null>;
  updateStatus(tenantId: string, id: AgentId, status: AgentStatus, tx?: Transaction<DatabaseSchema>): Promise<void>;
  updateCloudAccount(tenantId: string, id: AgentId, cloudAccountId: string | null): Promise<void>;
  updateGovernance(tenantId: string, id: AgentId, patch: AgentGovernancePatch): Promise<void>;
  list(tenantId: string): Promise<AgentRecord[]>;
  delete(tenantId: string, id: AgentId, tx?: Transaction<DatabaseSchema>): Promise<boolean>;
}

export class AgentRepository implements IAgentRepository {
  constructor(private readonly db: Kysely<DatabaseSchema> = getDatabase()) {}

  async create(dto: CreateAgentDto, tx?: Transaction<DatabaseSchema>): Promise<AgentRecord> {
    const executor = tx || this.db;
    const [row] = await executor
      .insertInto("agents")
      .values({
        id: dto.id,
        tenant_id: dto.tenantId,
        name: dto.name,
        type: dto.type,
        version: dto.version,
        runtime_protocol: dto.runtimeProtocol,
        status: dto.status || "APPROVED",
        created_at: new Date(),
        updated_at: new Date()
      } as any)
      .returningAll()
      .execute();

    if (!row) {
      throw new Error("Failed to create agent record");
    }

    return mapAgentRow(row);
  }

  async findById(tenantId: string, id: AgentId): Promise<AgentRecord | null> {
    const row = await this.db
      .selectFrom("agents")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();

    return row ? mapAgentRow(row) : null;
  }

  async updateStatus(
    tenantId: string,
    id: AgentId,
    status: AgentStatus,
    tx?: Transaction<DatabaseSchema>
  ): Promise<void> {
    const executor = tx || this.db;
    await executor
      .updateTable("agents")
      .set({
        status,
        updated_at: new Date()
      } as any)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .execute();
  }

  async updateCloudAccount(tenantId: string, id: AgentId, cloudAccountId: string | null): Promise<void> {
    await this.db
      .updateTable("agents")
      .set({
        cloud_account_id: cloudAccountId,
        updated_at: new Date()
      } as any)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .execute();
  }

  /**
   * ADR-0008 Phase A: records the outcome of (re-)provisioning this agent's
   * governed Hermes profile — see HermesProfileService.provisionProfile()/
   * verifyGovernance(). Intentionally a plain field update, not gated on
   * current status, so a re-verification that finds a previously
   * LOCKED_DOWN profile has drifted (e.g. a toolset was re-enabled out of
   * band) can flip it back to FAILED.
   */
  async updateGovernance(tenantId: string, id: AgentId, patch: AgentGovernancePatch): Promise<void> {
    await this.db
      .updateTable("agents")
      .set({
        hermes_profile_name: patch.hermesProfileName,
        governance_status: patch.governanceStatus,
        governance_verified_at: patch.governanceVerifiedAt,
        mcp_registered: patch.mcpRegistered,
        updated_at: new Date()
      } as any)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .execute();
  }

  async list(tenantId: string): Promise<AgentRecord[]> {
    const rows = await this.db
      .selectFrom("agents")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .execute();

    return rows.map(mapAgentRow);
  }

  async delete(tenantId: string, id: AgentId, tx?: Transaction<DatabaseSchema>): Promise<boolean> {
    const runInTx = async (trx: Transaction<DatabaseSchema>) => {
      // 1. Check if agent exists
      const existing = await trx
        .selectFrom("agents")
        .select(["id", "name"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .executeTakeFirst();

      if (!existing) {
        return false;
      }

      // 2. Unlink investigations (set agent_id to NULL to preserve incident history)
      try {
        await trx
          .updateTable("investigations")
          .set({ agent_id: null } as any)
          .where("tenant_id", "=", tenantId)
          .where("agent_id", "=", id)
          .execute();
      } catch {
        // Table might not exist in early tests or different environments
      }

      // 3. Unlink join requests
      await trx
        .updateTable("agent_join_requests")
        .set({ agent_id: null } as any)
        .where("tenant_id", "=", tenantId)
        .where("agent_id", "=", id)
        .execute();

      // 4. Delete runs (which cascades to tool_executions)
      await trx
        .deleteFrom("runs")
        .where("tenant_id", "=", tenantId)
        .where("agent_id", "=", id)
        .execute();

      // 5. Delete approvals associated with this agent
      await trx
        .deleteFrom("approvals")
        .where("tenant_id", "=", tenantId)
        .where("agent_id", "=", id)
        .execute();

      // 6. Delete credentials & sessions (explicit cleanup)
      await trx
        .deleteFrom("agent_sessions")
        .where("agent_id", "=", id)
        .execute();

      await trx
        .deleteFrom("agent_credentials")
        .where("agent_id", "=", id)
        .execute();

      // 7. Delete agent row
      const deleteResult = await trx
        .deleteFrom("agents")
        .where("tenant_id", "=", tenantId)
        .where("id", "=", id)
        .executeTakeFirst();

      return Number(deleteResult.numDeletedRows || 0) > 0;
    };

    if (tx) {
      return runInTx(tx);
    }
    return this.db.transaction().execute(runInTx);
  }
}
