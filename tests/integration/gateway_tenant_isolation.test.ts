import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId } from "@cloudops/shared";
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

describe("Phase 3 Integration: Gateway Tenant Isolation", () => {
  let app: ReturnType<typeof buildApp>;
  let wsUrl: string;

  const tenantA = generateTenantId();
  const tenantB = generateTenantId();
  const operatorA = "op_tenant_a";
  const operatorB = "op_tenant_b";

  let agentAId: string;
  let claimCredA: string;
  let runtimeCredA: string;
  let credIdA: string;

  let agentBId: string;
  let claimCredB: string;
  let runtimeCredB: string;
  let credIdB: string;

  beforeAll(async () => {
    await runMigrations();

    app = buildApp({ startHeartbeatMonitor: false });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const addr = app.server.address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${addr.port}/v1/gateway/ws`;

    const db = getDatabase();

    // Create Tenant A & B
    await db.insertInto("tenants").values([
      { id: tenantA, name: "Tenant A Corp" },
      { id: tenantB, name: "Tenant B Corp" }
    ]).execute();

    // Setup Agent A
    const inviteResA = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: { "x-tenant-id": tenantA, "x-operator-id": operatorA },
      payload: { expiresInSeconds: 3600 }
    });
    const inviteTokenA = JSON.parse(inviteResA.body).inviteToken;

    const joinResA = await app.inject({
      method: "POST",
      url: `/v1/onboarding/${inviteTokenA}/join`,
      payload: {
        agent: { name: "agent-a", type: "hermes" },
        runtime: { name: "hermes-agent", version: "1.0.0" }
      }
    });
    const joinReqIdA = JSON.parse(joinResA.body).joinRequestId;

    const approveResA = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinReqIdA}/approve`,
      headers: { "x-tenant-id": tenantA, "x-operator-id": operatorA }
    });
    agentAId = JSON.parse(approveResA.body).agentId;

    const claimResA = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: { inviteToken: inviteTokenA, joinRequestId: joinReqIdA }
    });
    claimCredA = JSON.parse(claimResA.body).claimCredential;

    // Exchange Agent A claim credential via Gateway
    const wsA = new WebSocket(wsUrl);
    await new Promise((res) => wsA.once("open", res));
    await sendJson(wsA, {
      type: "AUTH",
      authType: "BOOTSTRAP",
      credential: claimCredA
    });
    const authResA = await waitForMessage(wsA);
    expect(authResA.type).toBe("AUTH_SUCCESS");
    expect(authResA.tenantId).toBe(tenantA);
    runtimeCredA = authResA.runtimeCredential.secret;
    credIdA = authResA.runtimeCredential.credentialId;
    wsA.close();

    // Setup Agent B
    const inviteResB = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: { "x-tenant-id": tenantB, "x-operator-id": operatorB },
      payload: { expiresInSeconds: 3600 }
    });
    const inviteTokenB = JSON.parse(inviteResB.body).inviteToken;

    const joinResB = await app.inject({
      method: "POST",
      url: `/v1/onboarding/${inviteTokenB}/join`,
      payload: {
        agent: { name: "agent-b", type: "hermes" },
        runtime: { name: "hermes-agent", version: "1.0.0" }
      }
    });
    const joinReqIdB = JSON.parse(joinResB.body).joinRequestId;

    const approveResB = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinReqIdB}/approve`,
      headers: { "x-tenant-id": tenantB, "x-operator-id": operatorB }
    });
    agentBId = JSON.parse(approveResB.body).agentId;

    const claimResB = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: { inviteToken: inviteTokenB, joinRequestId: joinReqIdB }
    });
    claimCredB = JSON.parse(claimResB.body).claimCredential;

    // Exchange Agent B claim credential via Gateway
    const wsB = new WebSocket(wsUrl);
    await new Promise((res) => wsB.once("open", res));
    await sendJson(wsB, {
      type: "AUTH",
      authType: "BOOTSTRAP",
      credential: claimCredB
    });
    const authResB = await waitForMessage(wsB);
    expect(authResB.type).toBe("AUTH_SUCCESS");
    expect(authResB.tenantId).toBe(tenantB);
    runtimeCredB = authResB.runtimeCredential.secret;
    credIdB = authResB.runtimeCredential.credentialId;
    wsB.close();
  });

  afterAll(async () => {
    const db = getDatabase();
    for (const tid of [tenantA, tenantB]) {
      await db.deleteFrom("agent_sessions").where("tenant_id", "=", tid).execute();
      await db.deleteFrom("agent_credentials").where("tenant_id", "=", tid).execute();
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

  it("rejects authentication when agentId belongs to a different tenant", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.once("open", res));

    // Agent A tries to authenticate presenting Agent A's runtime secret but Agent B's agentId
    await sendJson(ws, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: runtimeCredA,
      agentId: agentBId // Cross-tenant agentId spoofing attempt!
    });

    const response = await waitForMessage(ws);
    expect(response.type).toBe("AUTH_FAILED");
    expect(response.message).toMatch(/credential/i);

    ws.close();
  });

  it("rejects cross-tenant credential rotation at service layer", async () => {
    const credService = new RuntimeCredentialService();

    // Tenant B attempts to rotate Tenant A's credential
    await expect(
      credService.rotateCredential(tenantB, agentAId as any, credIdA as any)
    ).rejects.toThrow();
  });

  it("ensures duplicate connection logic only replaces sessions for the same tenant and agent", async () => {
    // Connect Agent A
    const wsA = new WebSocket(wsUrl);
    await new Promise((res) => wsA.once("open", res));
    await sendJson(wsA, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: runtimeCredA,
      agentId: agentAId
    });
    const authA = await waitForMessage(wsA);
    expect(authA.type).toBe("AUTH_SUCCESS");

    // Connect Agent B
    const wsB = new WebSocket(wsUrl);
    await new Promise((res) => wsB.once("open", res));
    await sendJson(wsB, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: runtimeCredB,
      agentId: agentBId
    });
    const authB = await waitForMessage(wsB);
    expect(authB.type).toBe("AUTH_SUCCESS");

    // Verify Agent A is still open and responsive
    await sendJson(wsA, { type: "HEARTBEAT", sessionId: authA.sessionId });
    const ackA = await waitForMessage(wsA);
    expect(ackA.type).toBe("HEARTBEAT_ACK");

    // Verify Agent B is also open and responsive
    await sendJson(wsB, { type: "HEARTBEAT", sessionId: authB.sessionId });
    const ackB = await waitForMessage(wsB);
    expect(ackB.type).toBe("HEARTBEAT_ACK");

    wsA.close();
    wsB.close();
  });
});
