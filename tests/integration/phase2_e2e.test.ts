import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId, hashToken } from "@cloudops/shared";

describe("Phase 2 Acceptance Test: End-to-End Onboarding Lifecycle", () => {
  let app: ReturnType<typeof buildApp>;
  const tenantId = generateTenantId();
  const operatorId = "op_compliance_officer_01";

  beforeAll(async () => {
    await runMigrations();
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
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

  it("executes the full 20-step Phase 2 onboarding acceptance flow", async () => {
    const db = getDatabase();

    // Step 1: Create tenant
    await db.insertInto("tenants").values({
      id: tenantId,
      name: "Acme Cloud Logistics"
    }).execute();

    // Step 2: Create operator context (headers used for admin endpoints)
    const operatorHeaders = {
      "x-tenant-id": tenantId,
      "x-operator-id": operatorId
    };

    // Step 3: Create invite
    const inviteRes = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: operatorHeaders,
      payload: {
        expiresInSeconds: 3600
      }
    });
    expect(inviteRes.statusCode).toBe(201);
    const inviteBody = JSON.parse(inviteRes.body);

    // Step 4: Receive raw invite token
    const rawInviteToken = inviteBody.inviteToken;
    expect(rawInviteToken).toBeDefined();
    expect(rawInviteToken.startsWith("co_inv_")).toBe(true);
    expect(rawInviteToken.length).toBeGreaterThanOrEqual(40);

    // Step 5: Resolve onboarding manifest
    const manifestRes = await app.inject({
      method: "GET",
      url: `/v1/onboarding/${rawInviteToken}`
    });
    expect(manifestRes.statusCode).toBe(200);
    const manifest = JSON.parse(manifestRes.body);
    expect(manifest.onboardingVersion).toBe("1.0");
    expect(manifest.lifecycleState).toBe("INVITE_ACTIVE");
    expect(manifest.nextAction).toBe("SUBMIT_JOIN_REQUEST");
    expect(manifest.tenantId).toBe(tenantId);
    expect(manifest.supportedAgentTypes).toContain("hermes");
    expect(manifest.supportedAgentTypes).toContain("openclaw");
    expect(manifest.supportedAgentTypes).toContain("custom");
    // Ensure no secrets leaked in manifest
    expect(manifestRes.body).not.toContain("hash");
    expect(manifestRes.body).not.toContain("password");
    expect(manifestRes.body).not.toContain("secret");

    // Step 6: Submit join request
    const requestedCapabilities = ["aws.ecs.describe_clusters", "aws.ecs.list_tasks"];
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/onboarding/${rawInviteToken}/join`,
      payload: {
        agent: {
          name: "production-autopilot",
          type: "hermes"
        },
        runtime: {
          name: "hermes-runtime",
          version: "0.20.1",
          protocol: "acp"
        },
        requestedCapabilities
      }
    });
    expect(joinRes.statusCode).toBe(201);
    const joinBody = JSON.parse(joinRes.body);

    // Step 7: Verify join request is PENDING_APPROVAL
    const joinRequestId = joinBody.joinRequestId;
    expect(joinRequestId.startsWith("jr_")).toBe(true);
    expect(joinBody.status).toBe("PENDING_APPROVAL");
    expect(joinBody.nextAction).toBe("WAIT_FOR_APPROVAL");

    // Manifest should now reflect PENDING_APPROVAL
    const manifestAfterJoin = await app.inject({
      method: "GET",
      url: `/v1/onboarding/${rawInviteToken}`
    });
    const manifestAfterJoinBody = JSON.parse(manifestAfterJoin.body);
    expect(manifestAfterJoinBody.lifecycleState).toBe("PENDING_APPROVAL");
    expect(manifestAfterJoinBody.nextAction).toBe("WAIT_FOR_APPROVAL");

    // Step 8: Operator lists join requests
    const listRes = await app.inject({
      method: "GET",
      url: "/v1/agent-join-requests",
      headers: operatorHeaders
    });
    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    const found = listBody.items.find((item: any) => item.id === joinRequestId);
    expect(found).toBeDefined();
    expect(found.status).toBe("PENDING_APPROVAL");
    expect(found.agentName).toBe("production-autopilot");

    // Step 9: Operator approves join request
    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinRequestId}/approve`,
      headers: operatorHeaders
    });
    expect(approveRes.statusCode).toBe(200);
    const approveBody = JSON.parse(approveRes.body);

    // Step 10: Verify agent created with ag_<...>
    const agentId = approveBody.agentId;
    expect(agentId).toBeDefined();
    expect(agentId.startsWith("ag_")).toBe(true);

    const agentRecord = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(agentRecord).toBeDefined();
    expect(agentRecord?.tenant_id).toBe(tenantId);
    expect(agentRecord?.name).toBe("production-autopilot");
    expect(agentRecord?.type).toBe("hermes");
    expect(agentRecord?.status).toBe("APPROVED");

    // Step 11: Verify join request APPROVED
    expect(approveBody.status).toBe("APPROVED");
    const updatedJoinRequest = await db.selectFrom("agent_join_requests").selectAll().where("id", "=", joinRequestId).executeTakeFirst();
    expect(updatedJoinRequest?.status).toBe("APPROVED");
    expect(updatedJoinRequest?.agent_id).toBe(agentId);

    // Manifest should now reflect APPROVED and CLAIM_CREDENTIAL
    const manifestAfterApprove = await app.inject({
      method: "GET",
      url: `/v1/onboarding/${rawInviteToken}`
    });
    const manifestAfterApproveBody = JSON.parse(manifestAfterApprove.body);
    expect(manifestAfterApproveBody.lifecycleState).toBe("APPROVED");
    expect(manifestAfterApproveBody.nextAction).toBe("CLAIM_CREDENTIAL");

    // Step 12: Claim bootstrap credential
    const claimRes = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: {
        inviteToken: rawInviteToken,
        joinRequestId: joinRequestId
      }
    });
    expect(claimRes.statusCode).toBe(200);
    const claimBody = JSON.parse(claimRes.body);

    // Step 13: Verify raw co_agent_<...> credential returned
    const rawClaimCredential = claimBody.claimCredential;
    expect(rawClaimCredential).toBeDefined();
    expect(rawClaimCredential.startsWith("co_agent_")).toBe(true);
    expect(claimBody.status).toBe("CLAIMED");
    expect(claimBody.nextAction).toBe("REGISTER_GATEWAY");

    // Step 14: Verify database contains only hash
    const expectedHash = hashToken(rawClaimCredential);
    const credentialRecord = await db.selectFrom("agent_claim_credentials").selectAll().where("agent_id", "=", agentId).executeTakeFirst();
    expect(credentialRecord).toBeDefined();
    expect(credentialRecord?.claim_token_hash).toBe(expectedHash);
    expect(credentialRecord?.status).toBe("CONSUMED");
    expect(credentialRecord?.consumed_at).not.toBeNull();
    // Verify plaintext credential is NOT in the database record anywhere
    expect(JSON.stringify(credentialRecord)).not.toContain(rawClaimCredential);

    // Step 15: Attempt second claim
    const secondClaimRes = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: {
        inviteToken: rawInviteToken,
        joinRequestId: joinRequestId
      }
    });

    // Step 16: Verify failure
    expect(secondClaimRes.statusCode).toBe(409);
    const secondClaimBody = JSON.parse(secondClaimRes.body);
    expect(secondClaimBody.error.code).toBe("CONFLICT");

    // Step 17: Verify agent is NOT CONNECTED
    const finalAgent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(finalAgent?.status).toBe("REGISTERED");
    expect(finalAgent?.status).not.toBe("CONNECTED");
    expect(finalAgent?.status).not.toBe("ACTIVE");

    // Step 18: Verify no runtime session exists
    // Database check: no sessions table or runtime records created
    const tables = await db.introspection.getTables();
    const tableNames = tables.map(t => t.name);
    if (tableNames.includes("sessions") || tableNames.includes("gateway_sessions")) {
      const sessions = await (db as any).selectFrom("gateway_sessions").selectAll().where("agent_id", "=", agentId).execute();
      expect(sessions.length).toBe(0);
    }

    // Step 19: Verify no cloud credential exists
    if (tableNames.includes("cloud_credentials")) {
      const creds = await (db as any).selectFrom("cloud_credentials").selectAll().where("agent_id", "=", agentId).execute();
      expect(creds.length).toBe(0);
    }

    // Step 20: Verify audit trail
    const auditEvents = await db.selectFrom("audit_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();

    const actionTypes = auditEvents.map(e => e.event_type);
    expect(actionTypes).toContain("INVITE_CREATED");
    expect(actionTypes).toContain("JOIN_REQUEST_SUBMITTED");
    expect(actionTypes).toContain("JOIN_REQUEST_APPROVED");
    expect(actionTypes).toContain("CLAIM_CREDENTIAL_ISSUED");
    expect(actionTypes).toContain("CLAIM_CREDENTIAL_CONSUMED");

    // Verify audit records contain NO raw secrets
    for (const event of auditEvents) {
      const detailsStr = typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload);
      expect(detailsStr).not.toContain(rawInviteToken);
      expect(detailsStr).not.toContain(rawClaimCredential);
    }
  });
});
