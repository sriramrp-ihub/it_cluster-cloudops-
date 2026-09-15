import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId, hashToken } from "@cloudops/shared";
import { RuntimeCredentialService } from "@cloudops/runtime";

function sendJson(ws: WebSocket, data: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(JSON.stringify(data), (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function waitForMessage(ws: WebSocket, timeoutMs: number = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for WebSocket message after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.once("message", (raw) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(raw.toString("utf-8"));
        resolve(parsed);
      } catch (e) {
        reject(e);
      }
    });
  });
}

describe("Phase 3 Integration: Gateway Authentication & Credential Exchange", () => {
  let app: ReturnType<typeof buildApp>;
  let wsUrl: string;
  const tenantId = generateTenantId();
  const operatorId = "op_gateway_tester";
  let agentId: string;
  let rawClaimCredential: string;

  beforeAll(async () => {
    await runMigrations();

    // Disable automatic background heartbeat monitor in test app to avoid interference
    app = buildApp({ startHeartbeatMonitor: false });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const addr = app.server.address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${addr.port}/v1/gateway/ws`;

    const db = getDatabase();
    // 1. Create tenant
    await db.insertInto("tenants").values({
      id: tenantId,
      name: "Gateway Testing Corp"
    }).execute();

    // 2. Create invite
    const inviteRes = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: { "x-tenant-id": tenantId, "x-operator-id": operatorId },
      payload: { expiresInSeconds: 3600 }
    });
    const inviteToken = JSON.parse(inviteRes.body).inviteToken;

    // 3. Submit join request
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/onboarding/${inviteToken}/join`,
      payload: {
        agent: { name: "gateway-agent", type: "hermes" },
        runtime: { name: "hermes-agent", version: "1.0.0" },
        requestedCapabilities: ["aws.ecs.read"]
      }
    });
    const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

    // 4. Operator approves
    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinRequestId}/approve`,
      headers: { "x-tenant-id": tenantId, "x-operator-id": operatorId }
    });
    agentId = JSON.parse(approveRes.body).agentId;

    // 5. Claim bootstrap credential (Phase 2 flow)
    const claimRes = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: { inviteToken, joinRequestId }
    });
    rawClaimCredential = JSON.parse(claimRes.body).claimCredential;

    // Verify agent is REGISTERED (Phase 2 invariant)
    const agentRow = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(agentRow?.status).toBe("REGISTERED");
  });

  afterAll(async () => {
    const db = getDatabase();
    await db.deleteFrom("agent_sessions").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("agent_credentials").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("agent_claim_credentials").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("agent_join_requests").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("agent_invites").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("audit_events").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("agents").where("tenant_id", "=", tenantId).execute();
    await db.deleteFrom("tenants").where("id", "=", tenantId).execute();

    await app.close();
    await closeDatabase();
  });

  let issuedRuntimeSecret: string;
  let issuedCredentialId: string;

  it("successfully authenticates with bootstrap credential and exchanges it for a runtime credential", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.once("open", res));

    // Send AUTH message with bootstrap credential
    await sendJson(ws, {
      type: "AUTH",
      authType: "BOOTSTRAP",
      credential: rawClaimCredential,
      runtimeInfo: {
        name: "hermes-agent",
        version: "1.0.0"
      }
    });

    const response = await waitForMessage(ws);
    expect(response.type).toBe("AUTH_SUCCESS");
    expect(response.authType).toBe("BOOTSTRAP");
    expect(response.agentId).toBe(agentId);
    expect(response.tenantId).toBe(tenantId);
    expect(response.sessionId.startsWith("sess_")).toBe(true);

    // Verify runtime credential was issued
    expect(response.runtimeCredential).toBeDefined();
    expect(response.runtimeCredential.secret.startsWith("cred_")).toBe(true);
    expect(response.runtimeCredential.credentialId.startsWith("cred_")).toBe(true);

    issuedRuntimeSecret = response.runtimeCredential.secret;
    issuedCredentialId = response.runtimeCredential.credentialId;

    // Verify agent status transitioned to CONNECTED
    const db = getDatabase();
    const agent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(agent?.status).toBe("CONNECTED");

    // Verify bootstrap credential marked exchanged_at
    const claimRow = await db.selectFrom("agent_claim_credentials").selectAll().where("agent_id", "=", agentId).executeTakeFirst();
    expect(claimRow?.exchanged_at).not.toBeNull();

    // Verify database stores ONLY the runtime credential hash
    const credRow = await db.selectFrom("agent_credentials").selectAll().where("id", "=", issuedCredentialId).executeTakeFirst();
    expect(credRow).toBeDefined();
    expect(credRow?.status).toBe("ACTIVE");
    expect(JSON.stringify(credRow)).not.toContain(issuedRuntimeSecret);

    ws.close();
  });

  it("prevents bootstrap replay: cannot reuse the same co_agent_... credential", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.once("open", res));

    // Attempt second connection with the already exchanged bootstrap credential
    await sendJson(ws, {
      type: "AUTH",
      authType: "BOOTSTRAP",
      credential: rawClaimCredential
    });

    const response = await waitForMessage(ws);
    expect(response.type).toBe("AUTH_FAILED");
    expect(response.message).toContain("already been exchanged");

    ws.close();
  });

  it("successfully authenticates subsequent connections with the issued runtime credential", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.once("open", res));

    // Authenticate with the runtime credential secret
    await sendJson(ws, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: issuedRuntimeSecret,
      agentId
    });

    const response = await waitForMessage(ws);
    expect(response.type).toBe("AUTH_SUCCESS");
    expect(response.authType).toBe("RUNTIME");
    expect(response.agentId).toBe(agentId);
    expect(response.sessionId.startsWith("sess_")).toBe(true);
    // Runtime auth does not issue another new credential
    expect(response.runtimeCredential).toBeUndefined();

    // Verify agent is CONNECTED
    const db = getDatabase();
    const agent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(agent?.status).toBe("CONNECTED");

    ws.close();
  });

  it("rejects invalid or corrupted runtime credential", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.once("open", res));

    await sendJson(ws, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: "cred_0000000000000000000000000000000000000000000000000000000000000000",
      agentId
    });

    const response = await waitForMessage(ws);
    expect(response.type).toBe("AUTH_FAILED");

    ws.close();
  });

  it("rejects revoked runtime credential", async () => {
    // Revoke the credential
    const credService = new RuntimeCredentialService();
    await credService.revokeCredential(tenantId, agentId as any, issuedCredentialId as any);

    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.once("open", res));

    await sendJson(ws, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: issuedRuntimeSecret,
      agentId
    });

    const response = await waitForMessage(ws);
    expect(response.type).toBe("AUTH_FAILED");

    ws.close();
  });
});
