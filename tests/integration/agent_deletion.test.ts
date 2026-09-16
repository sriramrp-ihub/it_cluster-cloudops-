import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { AgentService } from "@cloudops/identity";
import { generateTenantId, generateAgentId } from "@cloudops/shared";

describe("Agent Deletion Lifecycle & Reference Cleanup (DELETE /v1/agents/:id)", () => {
  let app: ReturnType<typeof buildApp>;
  const agentService = new AgentService();
  const tenantId = generateTenantId();
  const otherTenantId = generateTenantId();
  const operatorId = "op_test_deleter";

  beforeAll(async () => {
    await runMigrations();
    const db = getDatabase();

    await db.insertInto("tenants").values([
      { id: tenantId, name: "Deletion Test Corp" },
      { id: otherTenantId, name: "Other Tenant Corp" }
    ]).execute();

    app = buildApp({
      startHeartbeatMonitor: false
    });
  });

  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  it("1. Rejects unauthenticated DELETE request with 401", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/agents/ag_dummy"
    });

    expect(res.statusCode).toBe(401);
  });

  it("2. Returns 404 when deleting an agent that belongs to another tenant (Tenant Isolation)", async () => {
    const foreignAgent = await agentService.createAgent({
      tenantId: otherTenantId,
      name: "foreign-agent",
      type: "hermes",
      version: "1.0.0",
      runtimeProtocol: "acp"
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/agents/${foreignAgent.id}`,
      headers: {
        "x-tenant-id": tenantId,
        "x-operator-id": operatorId
      }
    });

    expect(res.statusCode).toBe(404);
  });

  it("3. Successfully deletes agent and cleans up credentials, sessions, and unlinks references", async () => {
    const db = getDatabase();

    // 1. Create agent
    const agent = await agentService.createAgent({
      tenantId,
      name: "agent-to-delete",
      type: "hermes",
      version: "1.0.0",
      runtimeProtocol: "acp"
    });

    // 2. Create associated records: credentials, session, join request, investigation
    const uniqueSuffix = Math.random().toString(36).substring(2);
    const credId = `cred_${uniqueSuffix}`;
    await db.insertInto("agent_credentials").values({
      id: credId,
      agent_id: agent.id,
      tenant_id: tenantId,
      credential_hash: `hash_${uniqueSuffix}`,
      salt: `salt_${uniqueSuffix}`,
      status: "ACTIVE",
      expires_at: new Date(Date.now() + 86400000)
    }).execute();

    await db.insertInto("agent_sessions").values({
      id: `sess_${uniqueSuffix}`,
      agent_id: agent.id,
      tenant_id: tenantId,
      credential_id: credId,
      session_token_hash: `sesshash_${uniqueSuffix}`,
      status: "ACTIVE"
    }).execute();

    const inviteId = `invid_${uniqueSuffix}`;
    await db.insertInto("agent_invites").values({
      id: inviteId,
      token_hash: `tokenhash_${uniqueSuffix}`,
      tenant_id: tenantId,
      status: "CLAIMED",
      expires_at: new Date(Date.now() + 86400000),
      created_by: operatorId
    }).execute();

    const joinReqId = `jr_${Date.now()}`;
    await db.insertInto("agent_join_requests").values({
      id: joinReqId,
      invite_id: inviteId,
      tenant_id: tenantId,
      agent_id: agent.id,
      agent_name: agent.name,
      agent_type: agent.type,
      agent_version: agent.version,
      gateway_protocol: "acp",
      declared_capabilities: JSON.stringify(["ecs.read"]),
      status: "APPROVED"
    }).execute();

    // 3. Delete the agent via API
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/agents/${agent.id}`,
      headers: {
        "x-tenant-id": tenantId,
        "x-operator-id": operatorId
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.deletedAgentId).toBe(agent.id);
    expect(body.message).toContain("agent-to-delete");

    // 4. Verify agent row is gone
    const agentRow = await db
      .selectFrom("agents")
      .selectAll()
      .where("id", "=", agent.id)
      .executeTakeFirst();
    expect(agentRow).toBeUndefined();

    // 5. Verify sessions & credentials are cleaned up
    const sessions = await db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("agent_id", "=", agent.id)
      .execute();
    expect(sessions).toHaveLength(0);

    const creds = await db
      .selectFrom("agent_credentials")
      .selectAll()
      .where("agent_id", "=", agent.id)
      .execute();
    expect(creds).toHaveLength(0);

    // 6. Verify join request unlinked (agent_id set to NULL)
    const jrRow = await db
      .selectFrom("agent_join_requests")
      .selectAll()
      .where("id", "=", joinReqId)
      .executeTakeFirst();
    expect(jrRow?.agent_id).toBeNull();

    // 7. Verify subsequent GET /v1/agents/:id returns 404
    const getRes = await app.inject({
      method: "GET",
      url: `/v1/agents/${agent.id}`,
      headers: {
        "x-tenant-id": tenantId,
        "x-operator-id": operatorId
      }
    });
    expect(getRes.statusCode).toBe(404);
  });
});
