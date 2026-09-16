import { describe, it, expect, beforeEach } from "vitest";
import { HermesAgentAdapter } from "../../packages/runtime/src/hermesAgentAdapter.js";
import { type AgentEvent, type AgentToolCall, type AgentToolResult } from "../../packages/runtime/src/agentAdapter.js";

describe("HermesAgentAdapter (CO-107 Live Integration)", () => {
  let adapter: HermesAgentAdapter;

  beforeEach(() => {
    adapter = new HermesAgentAdapter({
      endpoint: process.env.HERMES_URL || "http://127.0.0.1:8080",
      sessionToken: process.env.HERMES_SESSION_TOKEN || ""
    });
  });

  it("successfully connects to live Hermes daemon on port 8080 and reads active model", async () => {
    const health = await adapter.checkHermesHealth();
    expect(health.connected).toBe(true);
    expect(health.endpoint).toBe("http://127.0.0.1:8080");
    expect(health.model).toBe("nemotron-3-ultra");
    expect(health.provider).toBe("ollama-cloud");
  });

  it("starts a governed session conforming to AgentAdapter contract", async () => {
    const events: AgentEvent[] = [];
    const session = await adapter.start({
      tenantId: "ten_live_test",
      agentId: "ag_hermes_live",
      incidentContext: {
        incidentId: "inc_live_ecs",
        provider: "aws",
        accountId: "265766933076",
        region: "us-east-1",
        service: "checkout-service",
        resourceId: "service/cloudops-demo-cluster/checkout-service",
        severity: "CRITICAL",
        title: "ECS CrashLoop at ALB",
        alertDescription: "HTTP 503 at ALB"
      }
    });

    expect(session.sessionId).toMatch(/^sess_/);
    expect(session.status).toBe("ACTIVE");
    expect(session.agentId).toBe("ag_hermes_live");

    adapter.onEvent(session.sessionId, (evt) => {
      events.push(evt);
    });

    const active = adapter.getSession(session.sessionId);
    expect(active).toBeDefined();
    expect(active?.status).toBe("ACTIVE");
  });

  it("executes multi-step investigation turn, surfaces normalized events, and gates mutation on approval", async () => {
    const session = await adapter.start({
      tenantId: "ten_live_test",
      agentId: "ag_hermes_live"
    });

    const events: AgentEvent[] = [];
    adapter.onEvent(session.sessionId, (evt) => {
      events.push(evt);
    });

    const executedTools: string[] = [];

    adapter.onToolCall(session.sessionId, async (call: AgentToolCall): Promise<AgentToolResult> => {
      executedTools.push(call.toolName);

      if (call.toolName === "aws_ecs_describe_services") {
        return {
          callId: call.callId,
          status: "SUCCESS",
          data: { services: [{ serviceName: "checkout-service", desiredCount: 1, runningCount: 0 }] }
        };
      }

      if (call.toolName === "aws_cloudwatch_get_metric_data") {
        return {
          callId: call.callId,
          status: "SUCCESS",
          data: { MetricDataResults: [{ Id: "m1", Values: [142] }] }
        };
      }

      if (call.toolName === "aws_ecs_describe_stopped_tasks") {
        return {
          callId: call.callId,
          status: "SUCCESS",
          data: { tasks: [{ stoppedReason: 'CannotPullContainerError: inspect image "v2.4.1-broken": not found' }] }
        };
      }

      if (call.toolName === "aws_ecs_update_service_image") {
        // Mutating tool evaluates to APPROVAL_REQUIRED under CO-018
        return {
          callId: call.callId,
          status: "AWAITING_APPROVAL",
          approvalId: "appr_live_remediation_001"
        };
      }

      return {
        callId: call.callId,
        status: "ERROR",
        error: { code: "UNKNOWN_TOOL", message: `Unrecognized tool ${call.toolName}` }
      };
    });

    const result = await adapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-demo-cluster",
      service: "checkout-service",
      region: "us-east-1"
    });

    expect(executedTools).toEqual([
      "aws_ecs_describe_services",
      "aws_cloudwatch_get_metric_data",
      "aws_ecs_describe_stopped_tasks",
      "aws_ecs_update_service_image"
    ]);

    expect(result.status).toBe("WAITING_APPROVAL");
    expect(result.approvalId).toBe("appr_live_remediation_001");
    expect(result.rootCause.finding).toContain("v2.4.1-broken");
    expect(result.rootCause.confidence).toBeGreaterThanOrEqual(0.95);

    // Verify all emitted events adhere strictly to normalized AgentEvent schema
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("STEP");
    expect(eventTypes).toContain("OBSERVATION");
    expect(eventTypes).toContain("EVIDENCE");
    expect(eventTypes).toContain("ROOT_CAUSE");
    expect(eventTypes).toContain("PROPOSAL");
  });
});
