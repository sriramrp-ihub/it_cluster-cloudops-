import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { getDatabase, runMigrations } from "@cloudops/database";
import { generateTenantId } from "@cloudops/shared";

describe("Onboarding Prompt API & Lifecycle Integration", () => {
  let app: ReturnType<typeof buildApp>;
  const tenantId = generateTenantId();
  const operatorId = "op_admin_operator";
  const operatorHeaders = {
    "x-tenant-id": tenantId,
    "x-operator-id": operatorId
  };

  beforeAll(async () => {
    await runMigrations();
    app = buildApp();
    await app.ready();

    const db = getDatabase();
    await db.insertInto("tenants").values({
      id: tenantId,
      name: "Prompt Test Org"
    }).execute();
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
  });

  it("POST /v1/agent-invites returns an authoritative server-generated onboarding prompt", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: operatorHeaders,
      payload: {
        agentName: "prompt-test-worker",
        agentType: "hermes",
        instructions: "Operate AWS ECS clusters in production.",
        expiresInSeconds: 3600
      }
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.id).toMatch(/^inv_/);
    expect(body.inviteToken).toMatch(/^co_inv_/);
    expect(body.tenantId).toBe(tenantId);
    expect(body.status).toBe("ACTIVE");
    expect(body.expiresAt).toBeDefined();

    // Verify onboardingPrompt content
    expect(body.onboardingPrompt).toBeDefined();
    expect(typeof body.onboardingPrompt).toBe("string");
    expect(body.onboardingPrompt).toContain("prompt-test-worker");
    expect(body.onboardingPrompt).toContain("hermes");
    expect(body.onboardingPrompt).toContain(body.inviteToken);
    expect(body.onboardingPrompt).toContain("Operate AWS ECS clusters in production.");
    expect(body.onboardingPrompt).toContain("Declared Capabilities ≠ Authorized Privileges");

    // Security check: ensure no hash is exposed in prompt
    expect(body.onboardingPrompt).not.toContain("token_hash");
    expect(body.onboardingPrompt).not.toContain("agent_invites");
  });

  it("full onboarding handshake succeeds using information from onboarding prompt", async () => {
    // 1. Operator creates invite and generates prompt
    const inviteRes = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: operatorHeaders,
      payload: {
        agentName: "e2e-prompt-agent",
        agentType: "openclaw",
        instructions: "Monitor RDS and EC2 metrics."
      }
    });

    expect(inviteRes.statusCode).toBe(201);
    const invite = JSON.parse(inviteRes.body);
    const inviteToken = invite.inviteToken;

    // 2. Agent fetches manifest
    const manifestRes = await app.inject({
      method: "GET",
      url: `/v1/onboarding/${inviteToken}`
    });
    expect(manifestRes.statusCode).toBe(200);
    const manifest = JSON.parse(manifestRes.body);
    expect(manifest.tenantId).toBe(tenantId);
    expect(manifest.lifecycleState).toBe("INVITE_ACTIVE");

    // 3. Agent submits declarative join request
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/onboarding/${inviteToken}/join`,
      payload: {
        agent: {
          name: "e2e-prompt-agent",
          type: "openclaw"
        },
        runtime: {
          name: "openclaw-runtime",
          version: "1.0.0",
          protocol: "acp"
        },
        requestedCapabilities: ["aws.ec2.describe_instances", "aws.rds.describe_db_instances"]
      }
    });
    expect(joinRes.statusCode).toBe(201);
    const joinData = JSON.parse(joinRes.body);
    expect(joinData.status).toBe("PENDING_APPROVAL");
    const joinRequestId = joinData.joinRequestId;

    // 4. Operator approves join request
    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinRequestId}/approve`,
      headers: operatorHeaders
    });
    expect(approveRes.statusCode).toBe(200);
    const approveData = JSON.parse(approveRes.body);
    expect(approveData.status).toBe("APPROVED");
    expect(approveData.agentId).toMatch(/^ag_/);

    // 5. Agent claims bootstrap credential
    const claimRes = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: {
        inviteToken,
        joinRequestId
      }
    });
    expect(claimRes.statusCode).toBe(200);
    const claimData = JSON.parse(claimRes.body);
    expect(claimData.status).toBe("CLAIMED");
    expect(claimData.claimCredential).toMatch(/^co_agent_/);
    expect(claimData.nextAction).toBe("REGISTER_GATEWAY");

    // 6. Verify invite cannot be reused (single-use invariant preserved)
    const replayClaim = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: {
        inviteToken,
        joinRequestId
      }
    });
    expect(replayClaim.statusCode).toBe(409); // Conflict: already consumed
  });
});
