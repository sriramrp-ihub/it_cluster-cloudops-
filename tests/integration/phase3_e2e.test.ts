import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId } from "@cloudops/shared";

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

describe("Phase 3 Acceptance Test: End-to-End Gateway & Runtime Registration", () => {
  let app: ReturnType<typeof buildApp>;
  let wsUrl: string;
  const tenantId = generateTenantId();
  const operatorId = "op_compliance_officer_phase3";

  beforeAll(async () => {
    await runMigrations();

    app = buildApp({ startHeartbeatMonitor: false });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const addr = app.server.address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${addr.port}/v1/gateway/ws`;
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

  it("executes the full canonical 24-step Phase 3 Gateway & Runtime lifecycle", async () => {
    const db = getDatabase();

    // Step 1: Create tenant
    await db.insertInto("tenants").values({
      id: tenantId,
      name: "Phase 3 Operational Systems Corp"
    }).execute();

    const operatorHeaders = {
      "x-tenant-id": tenantId,
      "x-operator-id": operatorId
    };

    // Step 2: Create invite
    const inviteRes = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: operatorHeaders,
      payload: { expiresInSeconds: 3600 }
    });
    expect(inviteRes.statusCode).toBe(201);
    const rawInviteToken = JSON.parse(inviteRes.body).inviteToken;

    // Step 3: Resolve onboarding manifest
    const manifestRes = await app.inject({
      method: "GET",
      url: `/v1/onboarding/${rawInviteToken}`
    });
    expect(manifestRes.statusCode).toBe(200);

    // Step 4: Submit join request
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/onboarding/${rawInviteToken}/join`,
      payload: {
        agent: { name: "runtime-autopilot-01", type: "hermes" },
        runtime: { name: "hermes-runtime", version: "1.0.0" }
      }
    });
    expect(joinRes.statusCode).toBe(201);
    const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

    // Step 5: Operator approves join request
    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinRequestId}/approve`,
      headers: operatorHeaders
    });
    expect(approveRes.statusCode).toBe(200);
    const agentId = JSON.parse(approveRes.body).agentId;

    // Step 6: Invariant verification: APPROVED != CONNECTED
    const approvedAgent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(approvedAgent?.status).toBe("APPROVED");
    expect(approvedAgent?.status).not.toBe("CONNECTED");

    // No sessions exist
    const sessionsPrior = await db.selectFrom("agent_sessions").selectAll().where("agent_id", "=", agentId).execute();
    expect(sessionsPrior.length).toBe(0);

    // Step 7: Agent claims one-time bootstrap credential
    const claimRes = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: { inviteToken: rawInviteToken, joinRequestId }
    });
    expect(claimRes.statusCode).toBe(200);
    const rawClaimCredential = JSON.parse(claimRes.body).claimCredential;
    expect(rawClaimCredential.startsWith("co_agent_")).toBe(true);

    // Step 8: Invariant verification: REGISTERED != CONNECTED
    const registeredAgent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(registeredAgent?.status).toBe("REGISTERED");
    expect(registeredAgent?.status).not.toBe("CONNECTED");

    // Step 9: Agent connects to WebSocket Gateway
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.once("open", res));

    // Step 10: Agent sends AUTH with BOOTSTRAP credential
    await sendJson(ws, {
      type: "AUTH",
      authType: "BOOTSTRAP",
      credential: rawClaimCredential,
      runtimeInfo: {
        name: "hermes-agent",
        version: "1.0.0"
      }
    });

    // Step 11 & 12: Gateway validates, exchanges bootstrap token, returns AUTH_SUCCESS
    const authSuccess = await waitForMessage(ws);
    expect(authSuccess.type).toBe("AUTH_SUCCESS");
    expect(authSuccess.authType).toBe("BOOTSTRAP");
    expect(authSuccess.agentId).toBe(agentId);
    expect(authSuccess.tenantId).toBe(tenantId);
    expect(authSuccess.sessionId.startsWith("sess_")).toBe(true);

    const firstRuntimeCredential = authSuccess.runtimeCredential;
    expect(firstRuntimeCredential).toBeDefined();
    expect(firstRuntimeCredential.secret.startsWith("cred_")).toBe(true);
    expect(firstRuntimeCredential.credentialId.startsWith("cred_")).toBe(true);

    const sessionId = authSuccess.sessionId;

    // Step 13: Invariant verification: Agent status is now CONNECTED
    const connectedAgent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(connectedAgent?.status).toBe("CONNECTED");

    // Step 14: Bootstrap replay verification
    const wsReplay = new WebSocket(wsUrl);
    await new Promise((res) => wsReplay.once("open", res));
    await sendJson(wsReplay, {
      type: "AUTH",
      authType: "BOOTSTRAP",
      credential: rawClaimCredential
    });
    const replayRes = await waitForMessage(wsReplay);
    expect(replayRes.type).toBe("AUTH_FAILED");
    expect(replayRes.message).toMatch(/already been exchanged/i);
    wsReplay.close();

    // Step 15: Agent sends HEARTBEAT
    await sendJson(ws, {
      type: "HEARTBEAT",
      sessionId
    });

    // Step 16: Gateway returns HEARTBEAT_ACK and updates DB
    const hbAck = await waitForMessage(ws);
    expect(hbAck.type).toBe("HEARTBEAT_ACK");
    expect(hbAck.sessionId).toBe(sessionId);

    const sessionInDb = await db.selectFrom("agent_sessions").selectAll().where("id", "=", sessionId).executeTakeFirst();
    expect(sessionInDb?.status).toBe("CONNECTED");
    expect(sessionInDb?.last_heartbeat_at).toBeDefined();

    // Step 17: Agent requests ROTATE_CREDENTIAL
    await sendJson(ws, {
      type: "ROTATE_CREDENTIAL",
      sessionId
    });

    // Step 18: Gateway issues new runtime credential, marks previous ROTATED
    const rotateRes = await waitForMessage(ws);
    expect(rotateRes.type).toBe("CREDENTIAL_ROTATED");
    expect(rotateRes.newRuntimeCredential).toBeDefined();
    expect(rotateRes.newRuntimeCredential.secret.startsWith("cred_")).toBe(true);
    expect(rotateRes.newRuntimeCredential.credentialId).not.toBe(firstRuntimeCredential.credentialId);

    const secondRuntimeCredential = rotateRes.newRuntimeCredential;

    // Verify in DB that old credential is marked ROTATED with replaced_by_credential_id
    const oldCredInDb = await db
      .selectFrom("agent_credentials")
      .selectAll()
      .where("id", "=", firstRuntimeCredential.credentialId)
      .executeTakeFirst();
    expect(oldCredInDb?.status).toBe("ROTATED");
    expect(oldCredInDb?.rotated_at).not.toBeNull();
    expect(oldCredInDb?.replaced_by_credential_id).toBe(secondRuntimeCredential.credentialId);

    // Step 19: Agent sends DISCONNECT
    await sendJson(ws, {
      type: "DISCONNECT",
      sessionId,
      reason: "Planned client maintenance"
    });

    // Wait for connection to close
    await new Promise((res) => {
      if (ws.readyState === WebSocket.CLOSED) res(undefined);
      else ws.once("close", res);
    });

    // Step 20: Invariant verification: session DISCONNECTED, agent status is REGISTERED
    const sessionAfterDisconnect = await db
      .selectFrom("agent_sessions")
      .selectAll()
      .where("id", "=", sessionId)
      .executeTakeFirst();
    expect(sessionAfterDisconnect?.status).toBe("DISCONNECTED");
    expect(sessionAfterDisconnect?.disconnect_reason).toBe("CLIENT_DISCONNECT");

    const agentAfterDisconnect = await db
      .selectFrom("agents")
      .selectAll()
      .where("id", "=", agentId)
      .executeTakeFirst();
    expect(agentAfterDisconnect?.status).toBe("REGISTERED");

    // Step 21: Reconnection attempt with OLD rotated credential MUST FAIL
    const wsOld = new WebSocket(wsUrl);
    await new Promise((res) => wsOld.once("open", res));
    await sendJson(wsOld, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: firstRuntimeCredential.secret,
      agentId
    });
    const oldAuthRes = await waitForMessage(wsOld);
    expect(oldAuthRes.type).toBe("AUTH_FAILED");
    wsOld.close();

    // Step 22: Reconnection attempt with NEW rotated credential MUST SUCCEED
    const wsNew = new WebSocket(wsUrl);
    await new Promise((res) => wsNew.once("open", res));
    await sendJson(wsNew, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: secondRuntimeCredential.secret,
      agentId
    });
    const newAuthRes = await waitForMessage(wsNew);
    expect(newAuthRes.type).toBe("AUTH_SUCCESS");
    expect(newAuthRes.authType).toBe("RUNTIME");
    expect(newAuthRes.agentId).toBe(agentId);
    expect(newAuthRes.sessionId.startsWith("sess_")).toBe(true);

    const reconnectedAgent = await db
      .selectFrom("agents")
      .selectAll()
      .where("id", "=", agentId)
      .executeTakeFirst();
    expect(reconnectedAgent?.status).toBe("CONNECTED");

    // Step 23: Disconnect cleanly again
    await sendJson(wsNew, {
      type: "DISCONNECT",
      sessionId: newAuthRes.sessionId
    });
    await new Promise((res) => {
      if (wsNew.readyState === WebSocket.CLOSED) res(undefined);
      else wsNew.once("close", res);
    });

    // Step 24: Complete audit trail verification and secret redaction
    const auditEvents = await db
      .selectFrom("audit_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "asc")
      .execute();

    const eventTypes = auditEvents.map((e) => e.event_type);
    expect(eventTypes).toContain("INVITE_CREATED");
    expect(eventTypes).toContain("JOIN_REQUEST_SUBMITTED");
    expect(eventTypes).toContain("JOIN_REQUEST_APPROVED");
    expect(eventTypes).toContain("CLAIM_CREDENTIAL_ISSUED");
    expect(eventTypes).toContain("CLAIM_CREDENTIAL_CONSUMED");
    expect(eventTypes).toContain("AGENT_BOOTSTRAP_EXCHANGED");
    expect(eventTypes).toContain("AGENT_GATEWAY_AUTHENTICATED");
    expect(eventTypes).toContain("AGENT_SESSION_CONNECTED");
    expect(eventTypes).toContain("RUNTIME_CREDENTIAL_ROTATED");
    expect(eventTypes).toContain("AGENT_SESSION_DISCONNECTED");

    // Comprehensive secret redaction check across all recorded audit rows
    for (const row of auditEvents) {
      const payloadStr = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
      expect(payloadStr).not.toContain(rawInviteToken);
      expect(payloadStr).not.toContain(rawClaimCredential);
      expect(payloadStr).not.toContain(firstRuntimeCredential.secret);
      expect(payloadStr).not.toContain(secondRuntimeCredential.secret);
    }
  });
});
