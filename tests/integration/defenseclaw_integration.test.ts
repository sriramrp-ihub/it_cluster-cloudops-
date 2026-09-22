import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import { buildApp } from "../../apps/api/src/server.js";
import { runMigrations, closeDatabase, getDatabase } from "@cloudops/database";
import { generateTenantId } from "@cloudops/shared";
import { InviteService, JoinRequestService, JoinRequestRepository } from "@cloudops/onboarding";
import { CloudOpsConnector } from "@cloudops/connector";
import { GatewayHandler, DefenseClawClient } from "@cloudops/gateway";
import {
  startDefenseClawGateway,
  type DefenseClawGatewayInstance
} from "./helpers/defenseclawGateway.js";

describe("Phase 6: DefenseClaw Security Sidecar Integration", () => {
  let app: ReturnType<typeof buildApp>;
  let apiBaseUrl: string;
  let wsBaseUrl: string;
  let defenseClaw: DefenseClawGatewayInstance;
  let connector: CloudOpsConnector;

  const tenantId = generateTenantId();
  const operatorId = "op_defenseclaw_tester";
  let inviteToken: string;

  beforeAll(async () => {
    // 1. Start DefenseClaw Gateway Sidecar process
    defenseClaw = await startDefenseClawGateway();

    // 2. Initialize database
    await runMigrations();

    const db = getDatabase();
    await db
      .insertInto("tenants")
      .values({
        id: tenantId,
        name: "DefenseClaw Integration Tenant"
      })
      .execute();

    // 3. Create GatewayHandler wired to live DefenseClaw sidecar
    const testGatewayHandler = new GatewayHandler(
      undefined,
      undefined,
      undefined,
      undefined,
      {
        heartbeatIntervalMs: 1000,
        heartbeatTimeoutMs: 5000,
        defenseClaw: new DefenseClawClient({
          endpoint: defenseClaw.evaluateUrl,
          token: defenseClaw.token,
          timeoutMs: 5000
        })
      }
    );

    // 4. Start Fastify API app
    app = buildApp({
      gatewayHandler: testGatewayHandler,
      startHeartbeatMonitor: false
    });
    await app.listen({ port: 0, host: "127.0.0.1" });

    const addr = app.server.address() as AddressInfo;
    apiBaseUrl = `http://127.0.0.1:${addr.port}`;
    wsBaseUrl = `ws://127.0.0.1:${addr.port}`;

    // 5. Generate invite and onboard agent
    const inviteService = new InviteService();
    const invite = await inviteService.createInvite(tenantId, operatorId, 86400);
    inviteToken = invite.inviteToken;

    connector = new CloudOpsConnector({
      apiBaseUrl,
      wsBaseUrl,
      inviteToken,
      agentName: "hermes-defenseclaw-agent",
      agentType: "hermes",
      runtimeInfo: {
        name: "hermes-runtime",
        version: "0.18.2",
        protocol: "acp"
      },
      requestedCapabilities: [
        "aws.ecs.describe_clusters",
        "aws.ecs.describe_services",
        "aws.ecs.update_service"
      ],
      pollIntervalMs: 200,
      pollTimeoutMs: 15000,
      autoReconnect: false
    });

    const connectPromise = connector.startOnboardingAndConnect();

    // Wait for join submission
    await new Promise<void>((resolve) => {
      connector.once("join_submitted", () => resolve());
    });

    const statusAfterJoin = connector.getStatus();
    const joinRequestRepo = new JoinRequestRepository();
    const jr = await joinRequestRepo.findById(
      tenantId,
      statusAfterJoin.joinRequestId! as any
    );
    expect(jr).toBeDefined();

    // Operator approves the join request
    const joinRequestService = new JoinRequestService();
    await joinRequestService.approveJoinRequest(tenantId, jr!.id, operatorId);

    // Connector reaches CONNECTED state
    const connectedStatus = await connectPromise;
    expect(connectedStatus.state).toBe("CONNECTED");
  }, 25000);

  afterAll(async () => {
    if (connector) {
      await connector.disconnect().catch(() => {});
    }
    if (app) {
      await app.close().catch(() => {});
    }
    if (defenseClaw) {
      await defenseClaw.stop().catch(() => {});
    }
    await closeDatabase().catch(() => {});
  });

  it("1. Allows read capability granted to agent (ALLOW verdict)", async () => {
    const res = await connector.invokeCapability("aws.ecs.describe_clusters", {
      cluster: "cloudops-demo-cluster",
      region: "us-east-1"
    });

    expect(res.status).toBe("SUCCESS");
    expect(res.data).toBeDefined();
    expect(res.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it("2. Blocks ungranted capability call (BLOCK verdict)", async () => {
    const res = await connector.invokeCapability("aws.s3.delete_bucket", {
      bucket: "company-confidential",
      region: "us-east-1"
    });

    expect(res.status).toBe("BLOCKED");
    expect(res.error).toBeDefined();
    expect(res.error?.verdict).toBe("BLOCK");
    expect(res.error?.code).toBe("POLICY_VIOLATION");
    expect(res.traceparent).toBeDefined();
  });

  it("3. Enforces APPROVAL_REQUIRED for mutation without approval, allows with approvalId", async () => {
    // 3a. Mutation capability without approval ID -> APPROVAL_REQUIRED
    const resWithoutApproval = await connector.invokeCapability(
      "aws.ecs.update_service",
      {
        cluster: "cloudops-demo-cluster",
        service: "web-service",
        region: "us-east-1"
      }
    );

    expect(resWithoutApproval.status).toBe("APPROVAL_REQUIRED");
    expect(resWithoutApproval.error?.verdict).toBe("APPROVAL_REQUIRED");
    expect(resWithoutApproval.error?.code).toBe("APPROVAL_REQUIRED");
    expect(resWithoutApproval.error?.message).toMatch(/approval/i);

    // 3b. Mutation capability with valid approval ID -> SUCCESS (ALLOW)
    const resWithApproval = await connector.invokeCapability(
      "aws.ecs.update_service",
      {
        cluster: "cloudops-demo-cluster",
        service: "web-service",
        region: "us-east-1"
      },
      {
        approvalId: "appr_operator_12345"
      }
    );

    expect(resWithApproval.status).toBe("SUCCESS");
    expect(resWithApproval.data).toBeDefined();
  });

  it("4. Blocks destructive action (DESTRUCTIVE_ACTION_BLOCKED)", async () => {
    const res = await connector.invokeCapability("aws.rds.delete_db_instance", {
      dbInstanceIdentifier: "production-primary-db",
      skipFinalSnapshot: true,
      region: "us-east-1"
    });

    expect(res.status).toBe("BLOCKED");
    expect(res.error?.verdict).toBe("BLOCK");
    expect(["DESTRUCTIVE_ACTION_BLOCKED", "CLOUDOPS_DESTRUCTIVE_ACTION_BLOCKED"]).toContain(res.error?.ruleId);
  });

  it("5. Propagates W3C traceparent and records correlated v7 audit envelope", async () => {
    const customTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const customParentId = "00f067aa0ba902b7";
    const customTraceparent = `00-${customTraceId}-${customParentId}-01`;

    const res = await connector.invokeCapability(
      "aws.ecs.describe_services",
      {
        cluster: "cloudops-demo-cluster",
        services: ["web-service"],
        region: "us-east-1"
      },
      {
        traceparent: customTraceparent
      }
    );

    expect(res.status).toBe("SUCCESS");
    expect(res.traceparent).toBe(customTraceparent);

    // Verify DefenseClaw audit store contains event correlated to customTraceId
    const events = await defenseClaw.getAuditEvents(customTraceId);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const event = events[0];
    const traceIdInEvent = event.trace_id || event.TraceID;
    expect(traceIdInEvent).toBe(customTraceId);

    const schemaVersion = event.schema_version ?? event.envelope_version ?? event.EnvelopeVersion;
    expect(Number(schemaVersion)).toBe(7);
  });

  it("6. Fails closed when DefenseClaw sidecar is unreachable", async () => {
    // Instantiate a GatewayHandler pointing to dead port 19999
    const deadGatewayHandler = new GatewayHandler(
      undefined,
      undefined,
      undefined,
      undefined,
      {
        defenseClaw: new DefenseClawClient({
          endpoint: "http://127.0.0.1:19999/v1/evaluate",
          timeoutMs: 1000
        })
      }
    );

    const deadApp = buildApp({
      gatewayHandler: deadGatewayHandler,
      startHeartbeatMonitor: false
    });
    await deadApp.listen({ port: 0, host: "127.0.0.1" });

    const deadAddr = deadApp.server.address() as AddressInfo;
    const deadWsBaseUrl = `ws://127.0.0.1:${deadAddr.port}`;

    // Connect with active runtime credential
    const activeRuntimeCred = connector.getStatus().hasRuntimeCredential;
    expect(activeRuntimeCred).toBe(true);

    const directConnector = new CloudOpsConnector({
      apiBaseUrl,
      wsBaseUrl: deadWsBaseUrl,
      inviteToken,
      agentName: "fail-closed-agent",
      agentType: "hermes",
      autoReconnect: false
    });

    // Directly connect using existing runtime credential
    const client = (directConnector as any).gatewayClient || (connector as any).gatewayClient;
    const rawSecret = client?.runtimeCredential?.secret;

    const deadClient = new (connector.constructor as any).prototype.constructor({
      apiBaseUrl,
      wsBaseUrl: deadWsBaseUrl,
      inviteToken,
      agentName: "fail-closed-agent",
      agentType: "hermes",
      autoReconnect: false
    });

    // Test capability evaluation through dead gateway client directly
    const evalResult = await deadGatewayHandler.defenseClaw.evaluate({
      correlationId: "req_fail_closed_test",
      agentId: "ag_test",
      tenantId,
      capability: "aws.ecs.describe_clusters",
      arguments: {}
    });

    expect(evalResult.allowed).toBe(false);
    expect(evalResult.verdict).toBe("BLOCK");
    expect(evalResult.ruleId).toBe("DEFENSECLAW_UNAVAILABLE");

    await deadApp.close();
  });

  it("7. Enforces token authentication and rejects unauthenticated evaluate and audit requests", async () => {
    // POST /v1/evaluate without token -> 401
    const evalResNoAuth = await fetch(defenseClaw.evaluateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DefenseClaw-Client": "cloudops"
      },
      body: JSON.stringify({
        capability: "aws.ecs.describe_clusters",
        arguments: {}
      })
    });
    expect(evalResNoAuth.status).toBe(401);

    // POST /v1/evaluate with invalid token -> 401
    const evalResBadAuth = await fetch(defenseClaw.evaluateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DefenseClaw-Client": "cloudops",
        "Authorization": "Bearer invalid-token-12345"
      },
      body: JSON.stringify({
        capability: "aws.ecs.describe_clusters",
        arguments: {}
      })
    });
    expect(evalResBadAuth.status).toBe(401);

    // GET /v1/audit/events without token -> 401
    const auditResNoAuth = await fetch(defenseClaw.auditEventsUrl);
    expect(auditResNoAuth.status).toBe(401);

    // GET /health should remain unauthenticated -> 200
    const healthRes = await fetch(`${defenseClaw.baseUrl}/health`);
    expect(healthRes.status).toBe(200);
  });

  it("8. Returns empty result set (not synthetic event) on unmatched trace_id", async () => {
    const nonexistentTraceId = "000000000000000000000000deadbeef";
    const events = await defenseClaw.getAuditEvents(nonexistentTraceId);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(0);
    // Explicitly verify no synthetic event is fabricated
    expect(events.some((e: any) => (e.event_id || "").startsWith("evt_synthetic"))).toBe(false);
  });

  it("9. Rejects oversized request body exceeding 1 MiB", async () => {
    const hugePayload = "A".repeat(1024 * 1024 + 100);
    const res = await fetch(defenseClaw.evaluateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DefenseClaw-Client": "cloudops",
        "Authorization": `Bearer ${defenseClaw.token}`,
        "X-DefenseClaw-Token": defenseClaw.token
      },
      body: JSON.stringify({
        capability: "aws.ecs.describe_clusters",
        arguments: { padding: hugePayload }
      })
    });
    expect(res.status).toBe(413);
  });
});
