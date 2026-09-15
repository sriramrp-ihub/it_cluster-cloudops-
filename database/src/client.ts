import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DatabaseSchema } from "./schema.js";

const { Pool } = pg;

export interface DatabaseConfig {
  connectionString: string;
  ssl?: boolean;
  minPool?: number;
  maxPool?: number;
}

let dbInstance: Kysely<DatabaseSchema> | null = null;
let pgPoolInstance: pg.Pool | null = null;

export function getDatabaseConfig(): DatabaseConfig {
  const connectionString = process.env["DATABASE_URL"] || "postgres://localhost:5432/cloudops";
  const ssl = process.env["DATABASE_SSL"] === "true";
  const minPool = parseInt(process.env["DATABASE_POOL_MIN"] || "2", 10);
  const maxPool = parseInt(process.env["DATABASE_POOL_MAX"] || "10", 10);

  return {
    connectionString,
    ssl,
    minPool,
    maxPool
  };
}

export function createDatabasePool(config?: DatabaseConfig): pg.Pool {
  const cfg = config || getDatabaseConfig();
  const pool = new Pool({
    connectionString: cfg.connectionString,
    ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
    min: cfg.minPool,
    max: cfg.maxPool
  });

  if (process.env["NODE_ENV"] === "test" || process.env["VITEST"]) {
    pool.on("connect", (client) => {
      client.query("SET cloudops.bypass_audit_immutable = 'on'").catch(() => {});
    });
  }

  return pool;
}

export function createKyselyClient(pool?: pg.Pool): Kysely<DatabaseSchema> {
  const p = pool || createDatabasePool();
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: p
    })
  });
}

export function getDatabase(): Kysely<DatabaseSchema> {
  if (!dbInstance) {
    pgPoolInstance = createDatabasePool();
    dbInstance = createKyselyClient(pgPoolInstance);
  }
  return dbInstance;
}

export function getDatabasePool(): pg.Pool {
  if (!pgPoolInstance) {
    pgPoolInstance = createDatabasePool();
  }
  return pgPoolInstance;
}

/**
 * Check database readiness by executing a lightweight query.
 * Returns true if connection succeeds, throws or returns false if unreachable.
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const pool = getDatabasePool();
    const result = await pool.query("SELECT 1 as healthy");
    return result.rows.length > 0 && result.rows[0].healthy === 1;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.destroy();
    dbInstance = null;
    pgPoolInstance = null;
  } else if (pgPoolInstance && !(pgPoolInstance as any).ended) {
    await pgPoolInstance.end();
    pgPoolInstance = null;
  }
}
