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

describe("Phase 3 Integration: Gateway Concurrency & Race Conditions", () => {
  let app: ReturnType<typeof buildApp>;
  let wsUrl: string;
  const tenantId = generateTenantId();
  const operatorId = "op_concurrency_tester";

  beforeAll(async () => {
    await runMigrations();

    app = buildApp({ startHeartbeatMonitor: false });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const addr = app.server.address() as AddressInfo;
    wsUrl = `ws://127.0.0.1:${addr.port}/v1/gateway/ws`;

    const db = getDatabase();
    await db.insertInto("tenants").values({
      id: tenantId,
      name: "Concurrency Test Corp"
    }).execute();
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

  it("handles 5 concurrent bootstrap attempts on the same claim token: exactly 1 succeeds, 4 fail", async () => {
    // 1. Create invite
    const inviteRes = await app.inject({
      method: "POST",
      url: "/v1/agent-invites",
      headers: { "x-tenant-id": tenantId, "x-operator-id": operatorId },
      payload: { expiresInSeconds: 3600 }
    });
    const inviteToken = JSON.parse(inviteRes.body).inviteToken;

    // 2. Submit join request
    const joinRes = await app.inject({
      method: "POST",
      url: `/v1/onboarding/${inviteToken}/join`,
      payload: {
        agent: { name: "race-agent", type: "hermes" },
        runtime: { name: "hermes-agent", version: "1.0.0" }
      }
    });
    const joinRequestId = JSON.parse(joinRes.body).joinRequestId;

    // 3. Approve
    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/agent-join-requests/${joinRequestId}/approve`,
      headers: { "x-tenant-id": tenantId, "x-operator-id": operatorId }
    });
    const agentId = JSON.parse(approveRes.body).agentId;

    // 4. Claim bootstrap credential
    const claimRes = await app.inject({
      method: "POST",
      url: "/v1/onboarding/claim",
      payload: { inviteToken, joinRequestId }
    });
    const claimCredential = JSON.parse(claimRes.body).claimCredential;

    // 5. Open 5 simultaneous WebSockets
    const sockets = await Promise.all(
      Array.from({ length: 5 }).map(async () => {
        const ws = new WebSocket(wsUrl);
        await new Promise((res) => ws.once("open", res));
        return ws;
      })
    );

    // 6. Fire AUTH simultaneously across all 5 sockets
    const authPromises = sockets.map(async (ws) => {
      await sendJson(ws, {
        type: "AUTH",
        authType: "BOOTSTRAP",
        credential: claimCredential
      });
      return waitForMessage(ws);
    });

    const results = await Promise.all(authPromises);

    // Close all sockets
    for (const ws of sockets) {
      ws.close();
    }

    const successes = results.filter((r) => r.type === "AUTH_SUCCESS");
    const failures = results.filter((r) => r.type === "AUTH_FAILED");

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(4);

    expect(successes[0].agentId).toBe(agentId);
    expect(successes[0].runtimeCredential).toBeDefined();

    for (const fail of failures) {
      expect(fail.message).toMatch(/already been exchanged|Invalid or unknown/i);
    }

    // Verify DB integrity
    const db = getDatabase();
    const credRows = await db
      .selectFrom("agent_credentials")
      .selectAll()
      .where("agent_id", "=", agentId)
      .execute();
    // Exactly 1 runtime credential issued
    expect(credRows).toHaveLength(1);
    expect(credRows[0].status).toBe("ACTIVE");
  });
});
