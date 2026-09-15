import { Kysely } from "kysely";
import type { DatabaseSchema } from "@cloudops/database";
import { getDatabase } from "@cloudops/database";
import { generateCloudAccountId } from "@cloudops/shared";

export interface CloudAccountRecord {
  id: string;
  tenantId: string;
  provider: string;
  accountId: string;
  roleArn: string | null;
  region: string;
  status: string;
  createdAt: Date;
}

export interface CreateCloudAccountDto {
  id?: string | undefined;
  tenantId: string;
  provider: string;
  accountId: string;
  roleArn?: string | null | undefined;
  region: string;
  status?: string | undefined;
}

function mapRow(row: any): CloudAccountRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    accountId: row.account_id,
    roleArn: row.role_arn,
    region: row.region,
    status: row.status,
    createdAt: new Date(row.created_at)
  };
}

export interface ICloudAccountRepository {
  create(dto: CreateCloudAccountDto): Promise<CloudAccountRecord>;
  getById(tenantId: string, id: string): Promise<CloudAccountRecord | null>;
  listByTenant(tenantId: string): Promise<CloudAccountRecord[]>;
  findExisting(tenantId: string, provider: string, accountId: string, region: string): Promise<CloudAccountRecord | null>;
  updateStatus(tenantId: string, id: string, status: string, roleArn?: string | null): Promise<CloudAccountRecord | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
}

export class CloudAccountRepository implements ICloudAccountRepository {
  constructor(private readonly db: Kysely<DatabaseSchema> = getDatabase()) {}

  async create(dto: CreateCloudAccountDto): Promise<CloudAccountRecord> {
    const id = dto.id || generateCloudAccountId();
    const [row] = await this.db
      .insertInto("cloud_accounts")
      .values({
        id,
        tenant_id: dto.tenantId,
        provider: dto.provider,
        account_id: dto.accountId,
        role_arn: dto.roleArn ?? null,
        region: dto.region,
        status: dto.status || "CONNECTED",
        created_at: new Date()
      } as any)
      .returningAll()
      .execute();

    if (!row) {
      throw new Error("Failed to insert cloud account record");
    }

    return mapRow(row);
  }

  async getById(tenantId: string, id: string): Promise<CloudAccountRecord | null> {
    const row = await this.db
      .selectFrom("cloud_accounts")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();

    return row ? mapRow(row) : null;
  }

  async listByTenant(tenantId: string): Promise<CloudAccountRecord[]> {
    const rows = await this.db
      .selectFrom("cloud_accounts")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .execute();

    return rows.map(mapRow);
  }

  async findExisting(
    tenantId: string,
    provider: string,
    accountId: string,
    region: string
  ): Promise<CloudAccountRecord | null> {
    const row = await this.db
      .selectFrom("cloud_accounts")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("provider", "=", provider)
      .where("account_id", "=", accountId)
      .where("region", "=", region)
      .executeTakeFirst();

    return row ? mapRow(row) : null;
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: string,
    roleArn?: string | null
  ): Promise<CloudAccountRecord | null> {
    const updatePayload: Record<string, unknown> = { status };
    if (roleArn !== undefined) {
      updatePayload["role_arn"] = roleArn;
    }

    const [updated] = await this.db
      .updateTable("cloud_accounts")
      .set(updatePayload as any)
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .returningAll()
      .execute();

    return updated ? mapRow(updated) : null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("cloud_accounts")
      .where("tenant_id", "=", tenantId)
      .where("id", "=", id)
      .executeTakeFirst();

    return Number(result.numDeletedRows) > 0;
  }
}
