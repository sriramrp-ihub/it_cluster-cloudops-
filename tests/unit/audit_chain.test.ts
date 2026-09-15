import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDatabase, runMigrations, closeDatabase } from "@cloudops/database";
import { AuditService, GENESIS_PREV_HASH } from "@cloudops/audit";
import { generateTenantId } from "@cloudops/shared";

describe("Audit Trail Cryptographic Hash Chaining & Immutability (Phase 1.2)", () => {
  let auditService: AuditService;
  const tenantId = generateTenantId();

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();
    await db
      .insertInto("tenants")
      .values({
        id: tenantId,
        name: "Test Tenant for Audit"
      })
      .onConflict((oc) => oc.column("id").doNothing())
      .execute();
    auditService = new AuditService();
  });

  afterAll(async () => {
    const db = getDatabase();
    await db.deleteFrom("audit_events").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("tenants").where("id", "=", tenantId).execute();
    await closeDatabase();
  });

  it("creates initial event with genesis prev_hash and valid row_hash", async () => {
    const event = await auditService.recordEvent({
      tenantId,
      eventType: "TEST_INIT",
      actorType: "SYSTEM",
      actorId: "sys_test",
      payload: { action: "initialize", environment: "test" }
    });

    expect(event.id).toBeDefined();
    expect(event.prevHash).toBe(GENESIS_PREV_HASH);
    expect(event.rowHash).toHaveLength(64);

    const recomputed = AuditService.computeRowHash(GENESIS_PREV_HASH, {
      id: event.id,
      tenantId: event.tenantId,
      eventType: event.eventType,
      actorType: event.actorType,
      actorId: event.actorId,
      payload: event.payload
    });
    expect(event.rowHash).toBe(recomputed);
  });

  it("chains subsequent events by linking prev_hash to predecessor row_hash", async () => {
    const event2 = await auditService.recordEvent({
      tenantId,
      eventType: "MUTATION_PROPOSED",
      actorType: "AGENT",
      actorId: "ag_test",
      payload: { service: "payments", desiredCount: 4 }
    });

    const db = getDatabase();
    const rows = await db
      .selectFrom("audit_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();

    expect(rows.length).toBeGreaterThanOrEqual(2);
    const firstRow = rows[0];
    const secondRow = rows[1];

    expect(secondRow.prev_hash).toBe(firstRow.row_hash);
  });

  it("successfully validates an untampered audit chain", async () => {
    const result = await auditService.verifyChain(tenantId);
    expect(result.valid).toBe(true);
    expect(result.totalChecked).toBeGreaterThanOrEqual(2);
    expect(result.error).toBeUndefined();
  });

  it("enforces database-level immutability: PostgreSQL trigger blocks UPDATE and DELETE", async () => {
    const db = getDatabase();
    const event = await auditService.recordEvent({
      tenantId,
      eventType: "IMMUTABLE_TEST",
      actorType: "USER",
      actorId: "op_attacker",
      payload: { status: "original" }
    });

    // Enforce production mode (bypass = off)
    const { sql } = await import("kysely");
    await sql`SET cloudops.bypass_audit_immutable = 'off';`.execute(db);

    try {
      // 1. Attempting an UPDATE must fail at the database level
      await expect(
        db
          .updateTable("audit_events")
          .set({ actor_id: "op_tampered" })
          .where("id", "=", event.id)
          .execute()
      ).rejects.toThrow(/append-only immutable ledger/);

      // 2. Attempting a DELETE must fail at the database level
      await expect(
        db
          .deleteFrom("audit_events")
          .where("id", "=", event.id)
          .execute()
      ).rejects.toThrow(/append-only immutable ledger/);
    } finally {
      await sql`SET cloudops.bypass_audit_immutable = 'on';`.execute(db);
    }
  });
});
