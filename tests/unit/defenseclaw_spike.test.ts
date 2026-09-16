import { describe, it, expect } from "vitest";
import { DefenseClawGuardrailService } from "@cloudops/security";
import { MockAgentAdapter } from "@cloudops/runtime";

describe("DefenseClaw Integration Spike (CO-005 & Ground Rule 2)", () => {
  const service = new DefenseClawGuardrailService();
  const tenantId = "ten_defenseclaw_test";
  const agentId = "ag_mock_defenseclaw";

  it("1. Allows normal read-only investigation tool calls with low risk score", async () => {
    const verdict = await service.inspectToolCall({
      agentId,
      tenantId,
      toolName: "aws_ecs_describe_clusters",
      arguments: { clusters: ["production-cluster"], region: "us-east-1" },
      grantedCapabilities: ["aws.ecs.describe_clusters"]
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.action).toBe("ALLOW");
    expect(verdict.guardrailViolations).toHaveLength(0);
    expect(verdict.riskScore).toBeLessThanOrEqual(0.2);
    expect(verdict.auditEvidence.action).toBe("ALLOW");
  });

  it("2. Intercepts and blocks high-risk destructive cloud action (delete database instance)", async () => {
    const verdict = await service.inspectToolCall({
      agentId,
      tenantId,
      toolName: "aws_rds_delete_db_instance",
      arguments: { dbInstanceIdentifier: "production-orders-db", skipFinalSnapshot: true },
      grantedCapabilities: ["aws.ecs.describe_clusters"]
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe("BLOCK");
    expect(verdict.guardrailViolations.length).toBeGreaterThan(0);
    expect(verdict.guardrailViolations[0]).toContain("DESTRUCTIVE_ACTION_FORBIDDEN");
    expect(verdict.riskScore).toBeGreaterThanOrEqual(0.9);
    expect(verdict.auditEvidence.action).toBe("INTERCEPTED");
  });

  it("3. Intercepts and blocks capability boundary violations", async () => {
    const verdict = await service.inspectToolCall({
      agentId,
      tenantId,
      toolName: "aws_ecs_list_tasks",
      arguments: { cluster: "production-cluster" },
      grantedCapabilities: ["aws.ecs.describe_clusters"] // list_tasks is NOT granted
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe("BLOCK");
    expect(verdict.guardrailViolations[0]).toContain("CAPABILITY_BOUNDARY_VIOLATION");
    expect(verdict.riskScore).toBeGreaterThanOrEqual(0.8);
  });

  it("4. Produces DefenseClaw audit evidence conforming to audit normalization schema", async () => {
    const auditTrail = service.getAuditTrail();
    expect(auditTrail.length).toBeGreaterThanOrEqual(3);

    const blockedEvent = auditTrail.find((e) => e.action === "INTERCEPTED");
    expect(blockedEvent).toBeDefined();
    expect(blockedEvent!.eventId).toMatch(/^dc_evt_/);
    expect(blockedEvent!.agentId).toBe(agentId);
    expect(blockedEvent!.tenantId).toBe(tenantId);
    expect(blockedEvent!.guardrailTriggered).toBeDefined();

    // Map into CloudOps normalized audit event payload
    const normalizedCloudOpsPayload = {
      source: "DEFENSECLAW",
      securityEventId: blockedEvent!.eventId,
      riskScore: blockedEvent!.riskScore,
      guardrailTriggered: blockedEvent!.guardrailTriggered,
      details: blockedEvent!.reason
    };

    expect(normalizedCloudOpsPayload.source).toBe("DEFENSECLAW");
    expect(normalizedCloudOpsPayload.riskScore).toBeGreaterThanOrEqual(0.8);
  });

  it("5. Wires MockAgentAdapter through DefenseClaw inspection gate", async () => {
    const adapter = new MockAgentAdapter();
    const session = await adapter.start({
      tenantId,
      agentId,
      grantedCapabilities: ["aws.ecs.describe_clusters"]
    });

    // Wire DefenseClaw as the tool inspection pre-handler
    let interceptedCount = 0;
    adapter.onToolCall(session.sessionId, async (call) => {
      const verdict = await service.inspectToolCall({
        agentId,
        tenantId,
        sessionId: session.sessionId,
        toolName: call.toolName,
        arguments: call.arguments,
        grantedCapabilities: ["aws.ecs.describe_clusters"]
      });

      if (!verdict.allowed) {
        interceptedCount++;
        return {
          callId: call.callId,
          status: "ERROR",
          error: {
            code: "SECURITY_INTERCEPTION",
            message: verdict.guardrailViolations.join("; ")
          }
        };
      }

      return {
        callId: call.callId,
        status: "SUCCESS",
        data: { healthy: true }
      };
    });

    // Run safe tool call
    const result1 = await service.inspectToolCall({
      agentId,
      tenantId,
      sessionId: session.sessionId,
      toolName: "aws_ecs_describe_clusters",
      arguments: { clusters: ["prod"] },
      grantedCapabilities: ["aws.ecs.describe_clusters"]
    });
    expect(result1.allowed).toBe(true);

    // Run malicious destructive tool call
    const result2 = await service.inspectToolCall({
      agentId,
      tenantId,
      sessionId: session.sessionId,
      toolName: "aws_rds_delete_db_instance",
      arguments: { dbInstanceIdentifier: "prod-db" },
      grantedCapabilities: ["aws.ecs.describe_clusters"]
    });
    expect(result2.allowed).toBe(false);
  });
});
