import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    include: [
      "tests/**/*.test.ts",
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "database/**/*.test.ts"
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", ".next/", "tests/"]
    },
    alias: {
      "@cloudops/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@cloudops/database": path.resolve(__dirname, "database/src/index.ts"),
      "@cloudops/identity": path.resolve(__dirname, "packages/identity/src/index.ts"),
      "@cloudops/onboarding": path.resolve(__dirname, "packages/onboarding/src/index.ts"),
      "@cloudops/gateway": path.resolve(__dirname, "packages/gateway/src/index.ts"),
      "@cloudops/runtime": path.resolve(__dirname, "packages/runtime/src/index.ts"),
      "@cloudops/capabilities": path.resolve(__dirname, "packages/capabilities/src/index.ts"),
      "@cloudops/policy": path.resolve(__dirname, "packages/policy/src/index.ts"),
      "@cloudops/approvals": path.resolve(__dirname, "packages/approvals/src/index.ts"),
      "@cloudops/tools": path.resolve(__dirname, "packages/tools/src/index.ts"),
      "@cloudops/adapters": path.resolve(__dirname, "packages/adapters/src/index.ts"),
      "@cloudops/security": path.resolve(__dirname, "packages/security/src/index.ts"),
      "@cloudops/events": path.resolve(__dirname, "packages/events/src/index.ts"),
      "@cloudops/audit": path.resolve(__dirname, "packages/audit/src/index.ts"),
      "@cloudops/connector": path.resolve(__dirname, "packages/connector/src/index.ts")
    }
  }
});
