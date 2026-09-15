import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId } from "@cloudops/shared";
import { RuntimeSessionService } from "@cloudops/runtime";

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

describe("Phase 3 Integration: Gateway Sessions, Heartbeats & Disconnect", () => {
  let app: ReturnType<typeof buildApp>;
  let wsUrl: string;
  const tenantId = generateTenantId();
  const operatorId = "op_session_tester";
  let agentId: string;
  let rawClaimCredential: string;
  let runtimeSecret: string;

  beforeAll(async () => {
    await runMigrations();
    app = buildApp({ startHeartbeatMonitor: false });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const addr = app.server.address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${addr.port}/v1/gateway/ws`;

    const db = getDatabase();
    await db.insertInto("tenants").values({
      id: tenantId,
      name: "Sessions Testing Corp"
    }).execute();

    // Invite -> Join -> Approve -> Claim flow
    const inviteRes = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: { "x-tenant-id": tenantId, "x-operator-id": operatorId },
      payload: { expiresInSeconds: 3600 }
    });
    const inviteToken = JSON.parse(inviteRes.body).inviteToken;

    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/onboarding/${inviteToken}/join`,
      payload: {
        agent: { name: "session-agent", type: "openclaw" },
        runtime: { name: "openclaw-runtime", version: "2.1.0" },
        requestedCapabilities: ["aws.s3.read"]
      }
    });
    const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinRequestId}/approve`,
      headers: { "x-tenant-id": tenantId, "x-operator-id": operatorId }
    });
    agentId = JSON.parse(approveRes.body).agentId;

    const claimRes = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: { inviteToken, joinRequestId }
    });
    rawClaimCredential = JSON.parse(claimRes.body).claimCredential;

    // Perform initial bootstrap connection to get runtime credential
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.once("open", res));

    await sendJson(ws, {
      type: "AUTH",
      authType: "BOOTSTRAP",
      credential: rawClaimCredential
    });
    const authRes = await waitForMessage(ws);
    runtimeSecret = authRes.runtimeCredential.secret;
    ws.close();

    // Wait 50ms for socket close cleanup
    await new Promise((res) => setTimeout(res, 50));
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

  it("handles heartbeat exchange and updates last_heartbeat_at", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.once("open", res));

    await sendJson(ws, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: runtimeSecret,
      agentId
    });
    const authRes = await waitForMessage(ws);
    const sessionId = authRes.sessionId;

    const db = getDatabase();
    const initialSession = await db.selectFrom("agent_sessions").selectAll().where("id", "=", sessionId).executeTakeFirst();
    const initialHeartbeat = new Date(initialSession!.last_heartbeat_at).getTime();

    // Small delay to ensure timestamp change
    await new Promise((res) => setTimeout(res, 20));

    // Send heartbeat
    await sendJson(ws, {
      type: "HEARTBEAT",
      sessionId
    });

    const ack = await waitForMessage(ws);
    expect(ack.type).toBe("HEARTBEAT_ACK");
    expect(ack.sessionId).toBe(sessionId);

    // Verify database record was updated
    const updatedSession = await db.selectFrom("agent_sessions").selectAll().where("id", "=", sessionId).executeTakeFirst();
    const updatedHeartbeat = new Date(updatedSession!.last_heartbeat_at).getTime();
    expect(updatedHeartbeat).toBeGreaterThanOrEqual(initialHeartbeat);

    ws.close();
    await new Promise((res) => setTimeout(res, 50));
  });

  it("enforces duplicate connection policy: terminates 1st session when 2nd connection arrives", async () => {
    // Open connection 1
    const ws1 = new WebSocket(wsUrl);
    await new Promise((res) => ws1.once("open", res));

    await sendJson(ws1, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: runtimeSecret,
      agentId
    });
    const auth1 = await waitForMessage(ws1);
    const session1Id = auth1.sessionId;

    // Attach listener to ws1 BEFORE sending connection 2 so we don't miss SESSION_TERMINATED
    const termMsgPromise = waitForMessage(ws1);

    // Open connection 2 for the SAME agent
    const ws2 = new WebSocket(wsUrl);
    await new Promise((res) => ws2.once("open", res));

    await sendJson(ws2, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: runtimeSecret,
      agentId
    });
    const auth2 = await waitForMessage(ws2);
    const session2Id = auth2.sessionId;

    expect(session2Id).not.toBe(session1Id);

    // Connection 1 should have received SESSION_TERMINATED
    const termMsg = await termMsgPromise;
    expect(termMsg.type).toBe("SESSION_TERMINATED");
    expect(termMsg.reason).toBe("REPLACED_BY_NEW_CONNECTION");

    // Verify database status of session 1
    const db = getDatabase();
    const s1Record = await db.selectFrom("agent_sessions").selectAll().where("id", "=", session1Id).executeTakeFirst();
    expect(s1Record?.status).toBe("DISCONNECTED");
    expect(s1Record?.disconnect_reason).toBe("REPLACED_BY_NEW_CONNECTION");

    // Verify session 2 is CONNECTED
    const s2Record = await db.selectFrom("agent_sessions").selectAll().where("id", "=", session2Id).executeTakeFirst();
    expect(s2Record?.status).toBe("CONNECTED");

    // Agent remains CONNECTED
    const agent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(agent?.status).toBe("CONNECTED");

    ws2.close();
    await new Promise((res) => setTimeout(res, 50));
  });

  it("transitions agent from CONNECTED to REGISTERED upon clean disconnect", async () => {
    const ws = new WebSocket(wsUrl);
    await new Promise((res) => ws.once("open", res));

    await sendJson(ws, {
      type: "AUTH",
      authType: "RUNTIME",
      credential: runtimeSecret,
      agentId
    });
    const authRes = await waitForMessage(ws);
    const sessionId = authRes.sessionId;

    const db = getDatabase();
    let agent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(agent?.status).toBe("CONNECTED");

    // Client initiates clean disconnect
    await sendJson(ws, {
      type: "DISCONNECT",
      sessionId
    });

    await new Promise((res) => setTimeout(res, 50));

    // Verify session is DISCONNECTED
    const sessionRecord = await db.selectFrom("agent_sessions").selectAll().where("id", "=", sessionId).executeTakeFirst();
    expect(sessionRecord?.status).toBe("DISCONNECTED");
    expect(sessionRecord?.disconnect_reason).toBe("CLIENT_DISCONNECT");

    // Verify agent transitioned back to REGISTERED
    agent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(agent?.status).toBe("REGISTERED");
  });

  it("handles stale session timeout sweep and transitions agent back to REGISTERED", async () => {
    const credService = new (await import("@cloudops/runtime")).RuntimeCredentialService();
    const cred = await credService.issueInitialCredential(tenantId, agentId as any);

    const sessionService = new RuntimeSessionService();
    // Create an active session in the database with a valid credentialId
    const { session } = await sessionService.createSession(tenantId, agentId as any, cred.credentialId);

    const db = getDatabase();
    let agent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(agent?.status).toBe("CONNECTED");

    // Force last_heartbeat_at to 2 minutes ago
    await db
      .updateTable("agent_sessions")
      .set({ last_heartbeat_at: new Date(Date.now() - 120000) } as any)
      .where("id", "=", session.id)
      .execute();

    // Run sweep with 30s timeout
    const swept = await sessionService.sweepStaleSessions(30000);
    expect(swept).toContain(session.id);

    // Verify session state in DB
    const sessionRecord = await db.selectFrom("agent_sessions").selectAll().where("id", "=", session.id).executeTakeFirst();
    expect(sessionRecord?.status).toBe("DISCONNECTED");
    expect(sessionRecord?.disconnect_reason).toBe("HEARTBEAT_TIMEOUT");

    // Verify agent is REGISTERED
    agent = await db.selectFrom("agents").selectAll().where("id", "=", agentId).executeTakeFirst();
    expect(agent?.status).toBe("REGISTERED");

    // Verify audit event AGENT_SESSION_TIMEOUT was recorded
    const auditEvents = await db
      .selectFrom("audit_events")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("event_type", "=", "AGENT_SESSION_TIMEOUT")
      .execute();

    expect(auditEvents.length).toBeGreaterThan(0);
  });
});
