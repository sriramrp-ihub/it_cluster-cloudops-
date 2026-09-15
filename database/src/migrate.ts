import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabasePool, getDatabaseConfig } from "./client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(): Promise<MigrationResult> {
  const pool = createDatabasePool(getDatabaseConfig());
  const client = await pool.connect();
  const applied: string[] = [];
  const skipped: string[] = [];

  try {
    // Ensure migrations metadata table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations_meta (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Locate migrations directory
    const migrationsDir = path.resolve(__dirname, "../migrations");
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter(f => f.endsWith(".sql")).sort();

    // Query already applied migrations
    const existing = await client.query("SELECT name FROM _migrations_meta");
    const appliedSet = new Set(existing.rows.map(r => r.name));

    for (const file of sqlFiles) {
      if (appliedSet.has(file)) {
        skipped.push(file);
        continue;
      }

      console.log(`[Migration] Applying ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, "utf-8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations_meta (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
        console.log(`[Migration] Successfully applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[Migration] Error applying ${file}:`, err);
        throw err;
      }
    }

    return { applied, skipped };
  } finally {
    client.release();
    await pool.end();
  }
}

// Direct execution entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(res => {
      console.log(`[Migration] Complete. Applied: ${res.applied.length}, Skipped: ${res.skipped.length}`);
      process.exit(0);
    })
    .catch(err => {
      console.error("[Migration] Fatal migration error:", err);
      process.exit(1);
    });
}
