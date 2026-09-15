import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  runMigrations,
  getDatabase,
  checkDatabaseHealth,
  closeDatabase
} from "@cloudops/database";
import { generateTenantId, generateAgentId } from "@cloudops/shared";

describe("Database Integration & Relational Schema", () => {
  beforeAll(async () => {
    // Run migrations before executing database tests
    await runMigrations();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("reports healthy connection to PostgreSQL database", async () => {
    const isHealthy = await checkDatabaseHealth();
    expect(isHealthy).toBe(true);
  });

  it("verifies all foundational CloudOps tables exist in PostgreSQL schema", async () => {
    const db = getDatabase();
    const result = await db
      .selectFrom("information_schema.tables" as any)
      .select(["table_name" as any])
      .where("table_schema" as any, "=", "public")
      .execute();

    const tableNames = new Set((result as any[]).map(r => r.table_name));

    const expectedTables = [
      "tenants",
      "agents",
      "agent_credentials",
      "agent_sessions",
      "agent_invites",
      "agent_join_requests",
      "agent_claim_credentials",
      "runtimes",
      "runtime_sessions",
      "capabilities",
      "capability_grants",
      "policies",
      "approvals",
      "runs",
      "tool_executions",
      "cloud_accounts",
      "audit_events",
      "domain_events"
    ];

    for (const table of expectedTables) {
      expect(tableNames.has(table), `Table '${table}' should exist in database`).toBe(true);
    }
  });

  it("supports transactional insert and query across tenant and agent", async () => {
    const db = getDatabase();
    const tenantId = generateTenantId();
    const agentId = generateAgentId();

    // Insert tenant
    await db
      .insertInto("tenants")
      .values({
        id: tenantId,
        name: "Test Operations Corp"
      })
      .execute();

    // Insert agent associated with tenant
    await db
      .insertInto("agents")
      .values({
        id: agentId,
        tenant_id: tenantId,
        name: "integration-test-agent",
        type: "hermes",
        version: "1.0.0",
        runtime_protocol: "acp",
        status: "INVITED"
      })
      .execute();

    // Query agent back
    const retrieved = await db
      .selectFrom("agents")
      .selectAll()
      .where("id", "=", agentId)
      .executeTakeFirst();

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(agentId);
    expect(retrieved?.tenant_id).toBe(tenantId);
    expect(retrieved?.name).toBe("integration-test-agent");
    expect(retrieved?.status).toBe("INVITED");

    // Clean up test records
    await db.deleteFrom("agents").where("id", "=", agentId).execute();
    await db.deleteFrom("tenants").where("id", "=", tenantId).execute();
  });
});
