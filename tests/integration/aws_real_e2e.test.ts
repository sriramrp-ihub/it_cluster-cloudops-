import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId } from "@cloudops/shared";

const isRealE2eEnabled = process.env.CLOUDOPS_AWS_E2E === "true";

/**
 * Isolated Real AWS Integration Test Suite
 * 
 * Runs ONLY when explicitly enabled via:
 *   CLOUDOPS_AWS_E2E=true
 * 
 * Requires environment variables:
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_REGION (defaults to us-east-1)
 *   AWS_SESSION_TOKEN (optional)
 *   AWS_ASSUME_ROLE_ARN (optional)
 */
describe("Real AWS Integration Tests (E2E)", () => {
  let app: ReturnType<typeof buildApp>;
  const testTenantId = generateTenantId();
  const testOperatorId = "op_real_aws_tester";

  beforeAll(async () => {
    if (!isRealE2eEnabled) return;

    await runMigrations();
    const db = getDatabase();
    await db.insertInto("tenants").values({
      id: testTenantId,
      name: "Real AWS E2E Tenant"
    }).execute();

    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (!isRealE2eEnabled) return;

    const db = getDatabase();
    await db.deleteFrom("cloud_accounts").where("tenant_id", "=", testTenantId).execute();
    await db.deleteFrom("tenants").where("id", "=", testTenantId).execute();

    if (app) await app.close();
    await closeDatabase();
  });

  it.skipIf(!isRealE2eEnabled)(
    "verifies real AWS connection lifecycle against AWS STS",
    async () => {
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      const region = process.env.AWS_REGION || "us-east-1";
      const sessionToken = process.env.AWS_SESSION_TOKEN;
      const assumeRoleArn = process.env.AWS_ASSUME_ROLE_ARN;

      if (!accessKeyId || !secretAccessKey) {
        throw new Error("CLOUDOPS_AWS_E2E is true but AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY is missing");
      }

      // 1. Connect
      const connectRes = await app.inject({
        method: "POST",
        url: "/v1/cloud-accounts",
        headers: {
          "x-tenant-id": testTenantId,
          "x-operator-id": testOperatorId
        },
        payload: {
          provider: "aws",
          region,
          accessKeyId,
          secretAccessKey,
          sessionToken,
          assumeRoleArn
        }
      });

      expect(connectRes.statusCode).toBe(201);
      const accountData = JSON.parse(connectRes.body);

      // Verify safe response format
      expect(accountData.id).toBeDefined();
      expect(accountData.provider).toBe("aws");
      expect(accountData.accountId).toMatch(/^\d{12}$/); // Real 12-digit AWS account ID from STS
      expect(accountData.status).toBe("CONNECTED");
      expect(accountData.region).toBe(region);

      // 2. Verify PostgreSQL persistence: only safe metadata, NO secret keys
      const db = getDatabase();
      const dbRow = await db
        .selectFrom("cloud_accounts")
        .selectAll()
        .where("id", "=", accountData.id)
        .executeTakeFirst();

      expect(dbRow).toBeDefined();
      const stringifiedRow = JSON.stringify(dbRow);
      expect(stringifiedRow).not.toContain(accessKeyId);
      expect(stringifiedRow).not.toContain(secretAccessKey);

      // 3. Disconnect
      const disconnectRes = await app.inject({
        method: "DELETE",
        url: `/v1/cloud-accounts/${accountData.id}`,
        headers: {
          "x-tenant-id": testTenantId,
          "x-operator-id": testOperatorId
        }
      });
      expect(disconnectRes.statusCode).toBe(200);
    }
  );
});
