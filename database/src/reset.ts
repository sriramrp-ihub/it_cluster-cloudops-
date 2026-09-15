import { createDatabasePool, getDatabaseConfig } from "./client.js";
import { runMigrations } from "./migrate.js";

async function resetDatabase() {
  const pool = createDatabasePool(getDatabaseConfig());
  const client = await pool.connect();

  try {
    console.log("[DB Reset] Dropping all tables and resetting schema...");
    await client.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO public;
    `);
    console.log("[DB Reset] Schema reset successfully.");
  } finally {
    client.release();
    await pool.end();
  }

  console.log("[DB Reset] Re-running all migrations...");
  const result = await runMigrations();
  console.log(`[DB Reset] Complete. Applied migrations: ${result.applied.join(", ")}`);
}

resetDatabase()
  .then(() => {
    console.log("[DB Reset] Database successfully reset and ready.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[DB Reset] Failed to reset database:", err);
    process.exit(1);
  });
