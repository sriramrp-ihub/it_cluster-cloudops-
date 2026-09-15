import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId } from "@cloudops/shared";

describe("Phase 2 Concurrency: Atomic Single-Use Credential Claim", () => {
  let app: ReturnType<typeof buildApp>;
  const tenantId = generateTenantId();
  const operatorId = "op_concurrency_admin";
  let inviteToken: string;
  let joinRequestId: string;

  beforeAll(async () => {
    await runMigrations();
    app = buildApp();
    await app.ready();

    // 1. Create Tenant
    const db = getDatabase();
    await db.insertInto("tenants").values({
      id: tenantId,
      name: "Concurrency Testing Corp"
    }).execute();

    // 2. Create Invite
    const inviteRes = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: {
        "x-tenant-id": tenantId,
        "x-operator-id": operatorId
      },
      payload: {
        expiresInSeconds: 3600
      }
    });
    expect(inviteRes.statusCode).toBe(201);
    inviteToken = JSON.parse(inviteRes.body).inviteToken;

    // 3. Submit Join Request
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/onboarding/${inviteToken}/join`,
      payload: {
        agent: {
          name: "concurrency-agent",
          type: "hermes"
        },
        runtime: {
          name: "hermes-agent",
          version: "0.18.2"
        },
        requestedCapabilities: ["aws.ecs.list_clusters"]
      }
    });
    expect(joinRes.statusCode).toBe(201);
    joinRequestId = JSON.parse(joinRes.body).joinRequestId;

    // 4. Approve Join Request
    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinRequestId}/approve`,
      headers: {
        "x-tenant-id": tenantId,
        "x-operator-id": operatorId
      }
    });
    expect(approveRes.statusCode).toBe(200);
  });

  afterAll(async () => {
    // Clean up test data
    const db = getDatabase();
    await db.deleteFrom("agent_claim_credentials").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("agent_join_requests").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("agent_invites").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("audit_events").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("agents").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("tenants").where("id", "=", tenantId).execute();

    await app.close();
    await closeDatabase();
  });

  it("ensures exactly ONE claim succeeds out of 10 concurrent requests against real PostgreSQL", async () => {
    const concurrentCount = 10;
    const claimPayload = {
      inviteToken,
      joinRequestId
    };

    // Fire 10 simultaneous HTTP claim requests
    const claimPromises = Array.from({ length: concurrentCount }, () =>
      app.inject({
        method: "POST",
        url: "/v1/onboarding/claim",
        payload: claimPayload
      })
    );

    const responses = await Promise.all(claimPromises);

    const successes = responses.filter(r => r.statusCode === 200);
    const conflicts = responses.filter(r => r.statusCode === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(concurrentCount - 1);

    // Verify successful claim response payload
    const successBody = JSON.parse(successes[0]!.body);
    expect(successBody.status).toBe("CLAIMED");
    expect(successBody.claimCredential.startsWith("co_agent_")).toBe(true);
    expect(successBody.nextAction).toBe("REGISTER_GATEWAY");

    // Verify all 9 conflict responses
    for (const conflict of conflicts) {
      const conflictBody = JSON.parse(conflict.body);
      expect(conflictBody.error.code).toBe("CONFLICT");
      expect(
        conflictBody.error.message.includes("already been claimed") ||
        conflictBody.error.message.includes("already been consumed")
      ).toBe(true);
    }
  });
});
