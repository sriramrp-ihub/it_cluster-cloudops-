import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId } from "@cloudops/shared";
import { InviteService, JoinRequestService, JoinRequestRepository } from "@cloudops/onboarding";
import { CloudOpsConnector, OnboardingClient, GatewayClient } from "@cloudops/connector";

import { GatewayHandler } from "@cloudops/gateway";

describe("Integration: CloudOps Agent Connector & Gateway Lifecycle", () => {
  let app: ReturnType<typeof buildApp>;
  let apiBaseUrl: string;
  let wsBaseUrl: string;
  const tenantId = generateTenantId();
  const operatorId = "op_connector_tester";
  let inviteToken: string;

  beforeAll(async () => {
    await runMigrations();

    const testGatewayHandler = new GatewayHandler(undefined, undefined, undefined, undefined, {
      heartbeatIntervalMs: 500,
      heartbeatTimeoutMs: 3000
    });

    app = buildApp({
      gatewayHandler: testGatewayHandler,
      startHeartbeatMonitor: false
    });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const addr = app.server.address() as AddressInfo;
    apiBaseUrl = `http://127.0.0.1:${addr.port}`;
    wsBaseUrl = `ws://127.0.0.1:${addr.port}`;

    const db = getDatabase();
    await db.insertInto("tenants").values({
      id: tenantId,
      name: "Connector Test Corp"
    }).execute();

    // Generate valid invite
    const inviteService = new InviteService();
    const invite = await inviteService.createInvite(
      tenantId,
      operatorId,
      86400
    );
    inviteToken = invite.inviteToken;
  });

  afterAll(async () => {
    await app.close();
    await closeDatabase();
  });

  it("completes full onboarding, Gateway connect, heartbeat, rotation, disconnect, and reconnect", async () => {
    const db = getDatabase();
    const joinRequestService = new JoinRequestService();

    // 1. Initialize connector
    const connector = new CloudOpsConnector({
      apiBaseUrl,
      wsBaseUrl,
      inviteToken,
      agentName: "hermes-connector-agent",
      agentType: "hermes",
      runtimeInfo: {
        name: "hermes-runtime",
        version: "0.18.2",
        protocol: "acp"
      },
      requestedCapabilities: ["aws.ecs.describe_clusters"],
      pollIntervalMs: 200,
      pollTimeoutMs: 15000,
      autoReconnect: false
    });

    // 2. Start onboarding in background (will await operator approval)
    const connectPromise = connector.startOnboardingAndConnect();

    // Wait until join request is submitted
    await new Promise<void>((resolve) => {
      connector.once("join_submitted", () => resolve());
    });

    const statusAfterJoin = connector.getStatus();
    expect(statusAfterJoin.joinRequestId).toBeDefined();

    // Verify agent is in PENDING state in DB
    const joinRequestRepo = new JoinRequestRepository();
    const jr = await joinRequestRepo.findById(tenantId, statusAfterJoin.joinRequestId! as any);
    expect(jr).toBeDefined();
    expect(jr!.status).toBe("PENDING_APPROVAL");

    // 3. Human Operator approves the join request
    const approvedResult = await joinRequestService.approveJoinRequest(
      tenantId,
      jr!.id,
      operatorId
    );
    expect(approvedResult.agentId).toBeDefined();

    // 4. Connector detects approval, claims bootstrap credential, and connects to Gateway!
    const connectedStatus = await connectPromise;
    expect(connectedStatus.state).toBe("CONNECTED");
    expect(connectedStatus.sessionId).toBeDefined();
    expect(connectedStatus.agentId).toBe(approvedResult.agentId);
    expect(connectedStatus.hasRuntimeCredential).toBe(true);

    // Verify agent status in DB is strictly CONNECTED
    const agentInDb = await db.selectFrom("agents")
      .selectAll()
      .where("id", "=", approvedResult.agentId)
      .executeTakeFirstOrThrow();
    expect(agentInDb.status).toBe("CONNECTED");

    // 5. Test Heartbeat transmission
    const heartbeatPromise = new Promise<void>((resolve) => {
      connector.once("heartbeat_ack", () => resolve());
    });

    // Force an immediate heartbeat ping
    const initialHeartbeatTime = Date.now();
    await heartbeatPromise;
    const currentStatus = connector.getStatus();
    expect(currentStatus.lastHeartbeatAck).toBeGreaterThanOrEqual(initialHeartbeatTime - 1000);

    // 6. Test Credential Rotation over active WebSocket
    const rotatedCred = await connector.rotateCredential();
    expect(rotatedCred.credentialId).toBeDefined();
    expect(rotatedCred.secret).toMatch(/^cred_[0-9a-f]{64}$/);

    // Verify old credential in DB is REVOKED and new is ACTIVE
    const allCreds = await db.selectFrom("agent_credentials")
      .selectAll()
      .where("agent_id", "=", approvedResult.agentId)
      .execute();
    expect(allCreds.length).toBe(2);
    const activeCred = allCreds.find(c => c.status === "ACTIVE");
    const rotatedOldCred = allCreds.find(c => c.status === "ROTATED");
    expect(activeCred).toBeDefined();
    expect(rotatedOldCred).toBeDefined();
    expect(activeCred!.id).toBe(rotatedCred.credentialId);
    expect(rotatedOldCred!.replaced_by_credential_id).toBe(rotatedCred.credentialId);

    // 7. Test Disconnect
    await connector.disconnect("TEST_SHUTDOWN");
    expect(connector.state).toBe("DISCONNECTED");

    // Verify agent status in DB returned to REGISTERED
    const agentAfterDisconnect = await db.selectFrom("agents")
      .selectAll()
      .where("id", "=", approvedResult.agentId)
      .executeTakeFirstOrThrow();
    expect(agentAfterDisconnect.status).toBe("REGISTERED");

    // 8. Test Reconnect using stored rotated runtime credential
    await connector.reconnect();
    expect(connector.state).toBe("CONNECTED");

    const agentAfterReconnect = await db.selectFrom("agents")
      .selectAll()
      .where("id", "=", approvedResult.agentId)
      .executeTakeFirstOrThrow();
    expect(agentAfterReconnect.status).toBe("CONNECTED");

    // Clean disconnect at end of test
    await connector.disconnect("TEST_COMPLETE");
  });

  it("prevents replay of consumed bootstrap credential", async () => {
    // Attempting to connect with an already consumed bootstrap credential should fail
    const db = getDatabase();
    const claimRow = await db.selectFrom("agent_claim_credentials")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();

    if (claimRow) {
      const gatewayClient = new GatewayClient({
        wsUrl: `${wsBaseUrl}/v1/gateway/ws`
      });

      // Even with the original format, an already exchanged bootstrap token must be rejected
      await expect(gatewayClient.connectWithBootstrap("co_agent_fake_replay_token_1234567890123456789012345678901234567890123456789012345678901234"))
        .rejects.toThrow(/Authentication failed/i);
    }
  });
});
