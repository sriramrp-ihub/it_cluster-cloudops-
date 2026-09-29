import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId, hashToken } from "@cloudops/shared";

describe("Phase 2 Onboarding Lifecycle & Validation Edge Cases", () => {
  let app: ReturnType<typeof buildApp>;
  const tenantId = generateTenantId();
  const operatorId = "op_test_qa_lead";
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
      name: "Lifecycle Edge Cases Inc"
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
    await closeDatabase();
  });

  describe("Invite Lifecycle & Security", () => {
    it("creates an invite with high entropy and stores only its hash in the database", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/agent-invites",
        headers: operatorHeaders,
        payload: { expiresInSeconds: 1800 }
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.inviteToken.startsWith("co_inv_")).toBe(true);
      expect(body.inviteToken.length).toBeGreaterThanOrEqual(50);

      const db = getDatabase();
      const inviteRecord = await db.selectFrom("agent_invites")
        .selectAll()
        .where("id", "=", body.id)
        .executeTakeFirst();

      expect(inviteRecord).toBeDefined();
      expect(inviteRecord?.token_hash).toBe(hashToken(body.inviteToken));
      expect(inviteRecord?.status).toBe("ACTIVE");
      // Raw token is NEVER persisted in the database record
      expect(JSON.stringify(inviteRecord)).not.toContain(body.inviteToken);
    });

    it("rejects invalid or non-existent tokens with 401 AuthenticationError", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/onboarding/co_inv_0000000000000000000000000000000000000000000000000000000000000000"
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("AUTHENTICATION_ERROR");
      expect(body.error.message).toContain("Invalid or unknown onboarding invite token");
    });

    it("rejects expired tokens", async () => {
      const db = getDatabase();
      // Create an invite already expired
      const expiredToken = "co_inv_expired_test_token_12345678901234567890123456789012";
      const expiredHash = hashToken(expiredToken);
      const inviteId = "inv_expired_test_id";

      await db.insertInto("agent_invites").values({
        id: inviteId,
        token_hash: expiredHash,
        tenant_id: tenantId,
        status: "ACTIVE",
        expires_at: new Date(Date.now() - 60000), // 1 min ago
        created_by: operatorId
      }).execute();

      const res = await app.inject({
        method: "GET",
        url: `/v1/onboarding/${expiredToken}`
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("AUTHENTICATION_ERROR");
      expect(body.error.message).toContain("expired");
    });

    it("rejects revoked tokens", async () => {
      const db = getDatabase();
      const revokedToken = "co_inv_revoked_test_token_12345678901234567890123456789012";
      const revokedHash = hashToken(revokedToken);
      const inviteId = "inv_revoked_test_id";

      await db.insertInto("agent_invites").values({
        id: inviteId,
        token_hash: revokedHash,
        tenant_id: tenantId,
        status: "REVOKED",
        expires_at: new Date(Date.now() + 3600000),
        created_by: operatorId
      }).execute();

      const res = await app.inject({
        method: "GET",
        url: `/v1/onboarding/${revokedToken}`
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("AUTHENTICATION_ERROR");
      expect(body.error.message).toContain("revoked");
    });
  });

  describe("Declarative Join Request & Agent Types", () => {
    let activeToken: string;

    beforeAll(async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/agent-invites",
        headers: operatorHeaders,
        payload: { expiresInSeconds: 3600 }
      });
      activeToken = JSON.parse(res.body).inviteToken;
    });

    it("rejects join requests with unsupported agent types", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${activeToken}/join`,
        payload: {
          agent: {
            name: "alien-agent",
            type: "skynet" // Unsupported
          },
          runtime: {
            name: "unknown-runtime",
            version: "1.0.0"
          },
          requestedCapabilities: []
        }
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects join requests with invalid payload structure", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${activeToken}/join`,
        payload: {
          invalid: true
        }
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("accepts supported agent types: hermes, openclaw, custom", async () => {
      const agentTypes = ["hermes", "openclaw", "custom"] as const;

      for (const agentType of agentTypes) {
        // Create an invite for each test
        const invRes = await app.inject({
          method: "POST",
          url: "/v1/agent-invites",
          headers: operatorHeaders,
          payload: { expiresInSeconds: 3600 }
        });
        const token = JSON.parse(invRes.body).inviteToken;

        const joinRes = await app.inject({
          method: "POST",
          url: `/v1/onboarding/${token}/join`,
          payload: {
            agent: {
              name: `test-agent-${agentType}`,
              type: agentType
            },
            runtime: {
              name: `${agentType}-runtime`,
              version: "1.0.0"
            },
            requestedCapabilities: ["aws.s3.list"]
          }
        });

        expect(joinRes.statusCode).toBe(201);
        const joinBody = JSON.parse(joinRes.body);
        expect(joinBody.status).toBe("PENDING_APPROVAL");
      }
    });

    it("enforces duplicate join protection (one active join request per invite)", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/v1/agent-invites",
        headers: operatorHeaders,
        payload: { expiresInSeconds: 3600 }
      });
      const token = JSON.parse(invRes.body).inviteToken;

      const payload = {
        agent: { name: "agent-first", type: "custom" },
        runtime: { name: "custom-runtime", version: "1.0.0" },
        requestedCapabilities: []
      };

      const firstRes = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${token}/join`,
        payload
      });
      expect(firstRes.statusCode).toBe(201);

      // Attempt second join on the same invite
      const secondRes = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${token}/join`,
        payload: {
          agent: { name: "agent-second", type: "custom" },
          runtime: { name: "custom-runtime", version: "1.0.0" },
          requestedCapabilities: []
        }
      });

      expect(secondRes.statusCode).toBe(409);
      const body = JSON.parse(secondRes.body);
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.message).toContain("An active join request already exists");
    });
  });

  describe("ADR-0007 Phase C1b: agent orchestration role (approve-with-role + PATCH role)", () => {
    /**
     * `agent_claim_credentials.claim_token_hash` carries a GLOBAL UNIQUE
     * constraint (database/migrations/001_initial_schema.sql), and
     * approveJoinRequest() inserts a literal `"PENDING_CLAIM"` placeholder
     * there — only replaced with a real unique hash once the bootstrap
     * credential is actually claimed via the real `/v1/onboarding/claim`
     * flow. That real flow also triggers `HermesProfileService
     * .provisionProfile()` — genuine `hermes` CLI subprocess calls,
     * including an MCP live-connectivity check that's slow (~15-20s) and,
     * under Fastify's in-process `app.inject()` (no real listening port),
     * always fails its own connectivity probe. Both facts are pre-existing
     * and entirely orthogonal to this ADR's role work — calling the real
     * claim endpoint here would only be testing Hermes provisioning
     * incidentally, at real cost, not role assignment. Each test below
     * instead does the ONE thing that actually matters for the
     * global-uniqueness constraint: retires its own placeholder row with a
     * fast, precisely-scoped DB update (to a per-test-unique value, never
     * touching any other row) immediately after a successful approve.
     */
    async function retireClaimPlaceholder(joinRequestId: string) {
      const db = getDatabase();
      await db
        .updateTable("agent_claim_credentials")
        .set({ claim_token_hash: `test_retired_${joinRequestId}_${randomUUID()}` } as any)
        .where("join_request_id", "=", joinRequestId)
        .execute();
    }

    it("defaults a newly-approved agent to role 'generalist' when no role is supplied at approval time (default/unchanged onboarding behavior)", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/v1/agent-invites",
        headers: operatorHeaders,
        payload: { expiresInSeconds: 3600 }
      });
      const token = JSON.parse(invRes.body).inviteToken;

      const joinRes = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${token}/join`,
        payload: {
          agent: { name: "default-role-agent", type: "hermes" },
          runtime: { name: "hermes-agent", version: "1.0.0" },
          requestedCapabilities: []
        }
      });
      const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

      // No `role` in the approve body at all — the vast majority of
      // real-world approvals today.
      const approveRes = await app.inject({
        method: "POST",
        url: `/v1/agent-join-requests/${joinRequestId}/approve`,
        headers: operatorHeaders
      });
      expect(approveRes.statusCode).toBe(200);
      const approveBody = JSON.parse(approveRes.body);
      expect(approveBody.agent.role).toBe("generalist");
      await retireClaimPlaceholder(joinRequestId);

      const getRes = await app.inject({
        method: "GET",
        url: `/v1/agents/${approveBody.agentId}`,
        headers: operatorHeaders
      });
      expect(getRes.statusCode).toBe(200);
      expect(JSON.parse(getRes.body).role).toBe("generalist");
    });

    it("approves a join request with an explicit orchestration role", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/v1/agent-invites",
        headers: operatorHeaders,
        payload: { expiresInSeconds: 3600 }
      });
      const token = JSON.parse(invRes.body).inviteToken;

      const joinRes = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${token}/join`,
        payload: {
          agent: { name: "investigator-agent", type: "hermes" },
          runtime: { name: "hermes-agent", version: "1.0.0" },
          requestedCapabilities: []
        }
      });
      const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

      const approveRes = await app.inject({
        method: "POST",
        url: `/v1/agent-join-requests/${joinRequestId}/approve`,
        headers: operatorHeaders,
        payload: { role: "investigator" }
      });
      expect(approveRes.statusCode).toBe(200);
      const approveBody = JSON.parse(approveRes.body);
      expect(approveBody.agent.role).toBe("investigator");
      await retireClaimPlaceholder(joinRequestId);

      const getRes = await app.inject({
        method: "GET",
        url: `/v1/agents/${approveBody.agentId}`,
        headers: operatorHeaders
      });
      expect(JSON.parse(getRes.body).role).toBe("investigator");
    });

    it("rejects approval with an unsupported role value", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/v1/agent-invites",
        headers: operatorHeaders,
        payload: { expiresInSeconds: 3600 }
      });
      const token = JSON.parse(invRes.body).inviteToken;

      const joinRes = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${token}/join`,
        payload: {
          agent: { name: "bad-role-agent", type: "hermes" },
          runtime: { name: "hermes-agent", version: "1.0.0" },
          requestedCapabilities: []
        }
      });
      const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

      const approveRes = await app.inject({
        method: "POST",
        url: `/v1/agent-join-requests/${joinRequestId}/approve`,
        headers: operatorHeaders,
        payload: { role: "supreme-overlord" }
      });
      expect(approveRes.statusCode).toBe(400);
    });

    it("PATCH /v1/agents/:id/role re-assigns an already-onboarded agent's role at any time", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/v1/agent-invites",
        headers: operatorHeaders,
        payload: { expiresInSeconds: 3600 }
      });
      const token = JSON.parse(invRes.body).inviteToken;

      const joinRes = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${token}/join`,
        payload: {
          agent: { name: "role-reassign-agent", type: "hermes" },
          runtime: { name: "hermes-agent", version: "1.0.0" },
          requestedCapabilities: []
        }
      });
      const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

      const approveRes = await app.inject({
        method: "POST",
        url: `/v1/agent-join-requests/${joinRequestId}/approve`,
        headers: operatorHeaders
      });
      const agentId = JSON.parse(approveRes.body).agentId;
      await retireClaimPlaceholder(joinRequestId);

      // Re-assign generalist -> verifier.
      const patchRes = await app.inject({
        method: "PATCH",
        url: `/v1/agents/${agentId}/role`,
        headers: operatorHeaders,
        payload: { role: "verifier" }
      });
      expect(patchRes.statusCode).toBe(200);
      expect(JSON.parse(patchRes.body).role).toBe("verifier");

      const getRes = await app.inject({
        method: "GET",
        url: `/v1/agents/${agentId}`,
        headers: operatorHeaders
      });
      expect(JSON.parse(getRes.body).role).toBe("verifier");

      // Re-assign again -> synthesizer, proving it's mutable at any time
      // (unlike declared_capabilities, which is write-once outside
      // syncCapabilities).
      const patchAgain = await app.inject({
        method: "PATCH",
        url: `/v1/agents/${agentId}/role`,
        headers: operatorHeaders,
        payload: { role: "synthesizer" }
      });
      expect(patchAgain.statusCode).toBe(200);
      expect(JSON.parse(patchAgain.body).role).toBe("synthesizer");
    });

    it("PATCH /v1/agents/:id/role rejects an unsupported role value, leaving the agent's role unchanged", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/v1/agent-invites",
        headers: operatorHeaders,
        payload: { expiresInSeconds: 3600 }
      });
      const token = JSON.parse(invRes.body).inviteToken;

      const joinRes = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${token}/join`,
        payload: {
          agent: { name: "role-patch-invalid-agent", type: "hermes" },
          runtime: { name: "hermes-agent", version: "1.0.0" },
          requestedCapabilities: []
        }
      });
      const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

      const approveRes = await app.inject({
        method: "POST",
        url: `/v1/agent-join-requests/${joinRequestId}/approve`,
        headers: operatorHeaders
      });
      const agentId = JSON.parse(approveRes.body).agentId;
      await retireClaimPlaceholder(joinRequestId);

      const patchRes = await app.inject({
        method: "PATCH",
        url: `/v1/agents/${agentId}/role`,
        headers: operatorHeaders,
        payload: { role: "supreme-overlord" }
      });
      expect(patchRes.statusCode).toBe(400);

      const getRes = await app.inject({
        method: "GET",
        url: `/v1/agents/${agentId}`,
        headers: operatorHeaders
      });
      expect(JSON.parse(getRes.body).role).toBe("generalist");
    });
  });

  describe("Operator Approval & State Transitions", () => {
    it("fails claim before operator approval with 409 ConflictError", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/v1/agent-invites",
        headers: operatorHeaders,
        payload: { expiresInSeconds: 3600 }
      });
      const token = JSON.parse(invRes.body).inviteToken;

      const joinRes = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${token}/join`,
        payload: {
          agent: { name: "premature-claimer", type: "hermes" },
          runtime: { name: "hermes-agent", version: "1.0.0" },
          requestedCapabilities: []
        }
      });
      const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

      // Attempt claim while join request is still PENDING_APPROVAL
      const claimRes = await app.inject({
        method: "POST",
        url: "/v1/onboarding/claim",
        payload: {
          inviteToken: token,
          joinRequestId
        }
      });

      expect(claimRes.statusCode).toBe(409);
      const claimBody = JSON.parse(claimRes.body);
      expect(claimBody.error.code).toBe("CONFLICT");
      expect(claimBody.error.message).toContain("PENDING_APPROVAL");
    });

    it("rejects approval by unauthorized operator (missing headers)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/agent-join-requests/jr_some_id/approve"
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("AUTHENTICATION_ERROR");
    });

    it("prevents double-approval of an already approved join request", async () => {
      const invRes = await app.inject({
        method: "POST",
        url: "/v1/agent-invites",
        headers: operatorHeaders,
        payload: { expiresInSeconds: 3600 }
      });
      const token = JSON.parse(invRes.body).inviteToken;

      const joinRes = await app.inject({
        method: "POST",
        url: `/v1/onboarding/${token}/join`,
        payload: {
          agent: { name: "double-approve-agent", type: "openclaw" },
          runtime: { name: "openclaw-runtime", version: "2.0.0" },
          requestedCapabilities: []
        }
      });
      const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

      const firstApprove = await app.inject({
        method: "POST",
        url: `/v1/agent-join-requests/${joinRequestId}/approve`,
        headers: operatorHeaders
      });
      expect(firstApprove.statusCode).toBe(200);

      const secondApprove = await app.inject({
        method: "POST",
        url: `/v1/agent-join-requests/${joinRequestId}/approve`,
        headers: operatorHeaders
      });
      expect(secondApprove.statusCode).toBe(409);
      const body = JSON.parse(secondApprove.body);
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.message).toContain("Cannot approve join request with status 'APPROVED'");
    });
  });

});
