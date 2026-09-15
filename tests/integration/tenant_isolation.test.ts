import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId } from "@cloudops/shared";

describe("Phase 2 Tenant Isolation Security Tests", () => {
  let app: ReturnType<typeof buildApp>;
  const tenantAId = generateTenantId();
  const tenantBId = generateTenantId();
  const operatorAId = "op_admin_tenant_a";
  const operatorBId = "op_admin_tenant_b";

  let inviteTokenA: string;
  let joinRequestIdA: string;

  beforeAll(async () => {
    await runMigrations();
    app = buildApp();
    await app.ready();

    const db = getDatabase();
    // 1. Create Tenant A and Tenant B
    await db.insertInto("tenants").values([
      { id: tenantAId, name: "Tenant Alpha Corp" },
      { id: tenantBId, name: "Tenant Beta Corp" }
    ]).execute();

    // 2. Create Invite for Tenant A
    const inviteRes = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      },
      payload: {
        expiresInSeconds: 3600
      }
    });
    expect(inviteRes.statusCode).toBe(201);
    inviteTokenA = JSON.parse(inviteRes.body).inviteToken;

    // 3. Submit Join Request for Tenant A
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/onboarding/${inviteTokenA}/join`,
      payload: {
        agent: {
          name: "agent-alpha",
          type: "hermes"
        },
        runtime: {
          name: "hermes-agent",
          version: "1.0.0"
        },
        requestedCapabilities: ["aws.s3.read"]
      }
    });
    expect(joinRes.statusCode).toBe(201);
    joinRequestIdA = JSON.parse(joinRes.body).joinRequestId;
  });

  afterAll(async () => {
    const db = getDatabase();
    for (const tid of [tenantAId, tenantBId]) {
      await db.deleteFrom("agent_claim_credentials").where("tenant_id", "=", tid).execute();
      await db.deleteFrom("agent_join_requests").where("tenant_id", "=", tid).execute();
      await db.deleteFrom("agent_invites").where("tenant_id", "=", tid).execute();
      await db.deleteFrom("audit_events").where("tenant_id", "=", tid).execute();
      await db.deleteFrom("agents").where("tenant_id", "=", tid).execute();
      await db.deleteFrom("tenants").where("id", "=", tid).execute();
    }
    await app.close();
    await closeDatabase();
  });

  it("ensures Operator B cannot list or view Tenant A join requests", async () => {
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/agent-join-requests",
      headers: {
        "x-tenant-id": tenantBId,
        "x-operator-id": operatorBId
      }
    });
    expect(listRes.statusCode).toBe(200);
    const body = JSON.parse(listRes.body);
    expect(body.items.length).toBe(0);
    const found = body.items.find((jr: any) => jr.id === joinRequestIdA);
    expect(found).toBeUndefined();
  });

  it("ensures Operator B cannot approve Tenant A join request", async () => {
    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinRequestIdA}/approve`,
      headers: {
        "x-tenant-id": tenantBId,
        "x-operator-id": operatorBId
      }
    });
    // Must return 404 NOT_FOUND to prevent leaking resource existence across tenants
    expect(approveRes.statusCode).toBe(404);
    const body = JSON.parse(approveRes.body);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("ensures Operator B cannot reject Tenant A join request", async () => {
    const rejectRes = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinRequestIdA}/reject`,
      headers: {
        "x-tenant-id": tenantBId,
        "x-operator-id": operatorBId
      },
      payload: {
        reason: "Malicious rejection attempt by tenant B"
      }
    });
    expect(rejectRes.statusCode).toBe(404);
    const body = JSON.parse(rejectRes.body);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("ensures Operator A can approve Tenant A join request", async () => {
    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinRequestIdA}/approve`,
      headers: {
        "x-tenant-id": tenantAId,
        "x-operator-id": operatorAId
      }
    });
    expect(approveRes.statusCode).toBe(200);
    const body = JSON.parse(approveRes.body);
    expect(body.status).toBe("APPROVED");
    expect(body.agentId.startsWith("ag_")).toBe(true);
  });

  it("ensures Tenant B invite token cannot be mixed with Tenant A join request on claim", async () => {
    // Create an invite for Tenant B
    const inviteBRes = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: {
        "x-tenant-id": tenantBId,
        "x-operator-id": operatorBId
      },
      payload: { expiresInSeconds: 3600 }
    });
    expect(inviteBRes.statusCode).toBe(201);
    const inviteTokenB = JSON.parse(inviteBRes.body).inviteToken;

    // Attempt claim using Tenant B's invite token for Tenant A's approved join request
    const claimCrossRes = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: {
        inviteToken: inviteTokenB,
        joinRequestId: joinRequestIdA
      }
    });
    expect(claimCrossRes.statusCode).toBe(401);
    const body = JSON.parse(claimCrossRes.body);
    expect(body.error.code).toBe("AUTHENTICATION_ERROR");
    expect(
      body.error.message.includes("does not match the provided onboarding context") ||
      body.error.message.includes("Tenant context mismatch")
    ).toBe(true);
  });
});
