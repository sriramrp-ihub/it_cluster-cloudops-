import { getDatabase, closeDatabase } from "@cloudops/database";
import { AuditService, GENESIS_PREV_HASH } from "@cloudops/audit";
import { sql } from "kysely";

async function backfill() {
  const db = getDatabase();

  console.log("[Audit Backfill] Disabling immutability trigger for backfill...");
  await sql`ALTER TABLE audit_events DISABLE TRIGGER trg_audit_events_immutable;`.execute(db);

  try {
    const tenants = await db
      .selectFrom("audit_events")
      .select("tenant_id")
      .distinct()
      .execute();

    for (const { tenant_id } of tenants) {
      console.log(`[Audit Backfill] Processing tenant ${tenant_id}...`);
      const rows = await db
        .selectFrom("audit_events")
        .selectAll()
        .where("tenant_id", "=", tenant_id)
        .orderBy("created_at", "asc")
        .orderBy("id", "asc")
        .execute();

      let prevHash = GENESIS_PREV_HASH;

      for (const row of rows) {
        if (!row.row_hash || row.row_hash === "") {
          const rawPayload = typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload || {});
          const computedHash = AuditService.computeRowHash(prevHash, {
            id: row.id,
            tenantId: row.tenant_id,
            eventType: row.event_type,
            actorType: row.actor_type,
            actorId: row.actor_id,
            payload: rawPayload
          });

          await db
            .updateTable("audit_events")
            .set({
              prev_hash: prevHash,
              row_hash: computedHash
            })
            .where("id", "=", row.id)
            .execute();

          prevHash = computedHash;
        } else {
          prevHash = row.row_hash;
        }
      }
    }

    console.log("[Audit Backfill] Backfill complete.");
  } finally {
    console.log("[Audit Backfill] Re-enabling immutability trigger...");
    await sql`ALTER TABLE audit_events ENABLE TRIGGER trg_audit_events_immutable;`.execute(db);
    await closeDatabase();
  }
}

backfill().catch(console.error);
