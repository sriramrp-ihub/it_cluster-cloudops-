import { z } from "zod";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Attempt to load .env from root workspace if present
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config();

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.string().transform(v => parseInt(v, 10)).default("3000"),
  API_HOST: z.string().default("0.0.0.0"),
  API_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGIN: z.string().default("http://localhost:3001"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").default("postgres://localhost:5432/cloudops"),
  DATABASE_SSL: z.string().transform(v => v === "true").default("false"),
  DATABASE_POOL_MIN: z.string().transform(v => parseInt(v, 10)).default("2"),
  DATABASE_POOL_MAX: z.string().transform(v => parseInt(v, 10)).default("10")
});

export type AppConfig = z.infer<typeof EnvironmentSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = EnvironmentSchema.safeParse(env);
  if (!result.success) {
    const errorDetails = result.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new Error(`Configuration validation failed: ${errorDetails}`);
  }
  return result.data;
}

export const config = loadConfig();
