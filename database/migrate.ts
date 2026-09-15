export * from "./src/migrate.js";

import { runMigrations } from "./src/migrate.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
