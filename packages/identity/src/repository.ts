import { Kysely, Transaction } from "kysely";
import type { DatabaseSchema, AgentTable } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import type { AgentId, AgentStatus } from "@cloudops/shared";

export interface AgentRecord {
  id: AgentId;
  tenantId: string;
  name: string;
  type: string;
  version: string;
  runtimeProtocol: string;
  status: AgentStatus;
  createdAt: Date;
  updatedAt: Date;
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
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

export interface IAgentRepository {
  create(dto: CreateAgentDto, tx?: Transaction<DatabaseSchema>): Promise<AgentRecord>;
  findById(tenantId: string, id: AgentId): Promise<AgentRecord | null>;
  updateStatus(tenantId: string, id: AgentId, status: AgentStatus, tx?: Transaction<DatabaseSchema>): Promise<void>;
  list(tenantId: string): Promise<AgentRecord[]>;
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

  async list(tenantId: string): Promise<AgentRecord[]> {
    const rows = await this.db
      .selectFrom("agents")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .execute();

    return rows.map(mapAgentRow);
  }
}
