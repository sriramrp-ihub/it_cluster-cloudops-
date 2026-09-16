import { describe, it, expect } from "vitest";
import { DefenseClawGuardrailService } from "@cloudops/security";
import { HermesAgentAdapter } from "@cloudops/runtime";

describe("DefenseClaw Live Agent Governance Spike (CO-107 / Step 2.3)", () => {
  const tenantId = "ten_defenseclaw_live";
  const agentId = "ag_hermes_live";
  const guardrailService = new DefenseClawGuardrailService();
  const hermesAdapter = new HermesAgentAdapter({
    endpoint: process.env.HERMES_URL || "http://127.0.0.1:8080",
    sessionToken: process.env.HERMES_SESSION_TOKEN || ""
  });

  it("0. Verifies live Hermes daemon connectivity and active model", async () => {
    const health = await hermesAdapter.checkHermesHealth();
    expect(health.connected).toBe(true);
    expect(health.endpoint).toBe("http://127.0.0.1:8080");
    expect(health.model).toBe("nemotron-3-ultra");
    expect(health.provider).toBe("ollama-cloud");
  });

  it("1. Allows read-only investigation tool calls from live Hermes adapter with low risk score", async () => {
    const session = await hermesAdapter.start({
      tenantId,
      agentId,
      grantedCapabilities: ["aws.ecs.describe_clusters", "aws.ecs.describe_services"]
    });

    const verdict = await guardrailService.inspectToolCall({
      agentId,
      tenantId,
      sessionId: session.sessionId,
      toolName: "aws_ecs_describe_services",
      arguments: {
        cluster: "cloudops-demo-cluster",
        services: ["cloudops-demo-service"],
        region: "us-east-1"
      },
      grantedCapabilities: ["aws.ecs.describe_clusters", "aws.ecs.describe_services"]
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.action).toBe("ALLOW");
    expect(verdict.riskScore).toBeLessThanOrEqual(0.2);
    expect(verdict.guardrailViolations).toHaveLength(0);
    expect(verdict.auditEvidence.action).toBe("ALLOW");
  });

  it("2. Intercepts and blocks high-risk destructive cloud action issued by Hermes", async () => {
    const session = await hermesAdapter.start({
      tenantId,
      agentId,
      grantedCapabilities: ["aws.ecs.describe_clusters", "aws.ecs.describe_services"]
    });

    const verdict = await guardrailService.inspectToolCall({
      agentId,
      tenantId,
      sessionId: session.sessionId,
      toolName: "aws_rds_delete_db_instance",
      arguments: {
        dbInstanceIdentifier: "production-primary-db",
        skipFinalSnapshot: true
      },
      grantedCapabilities: ["aws.ecs.describe_clusters", "aws.ecs.describe_services"]
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe("BLOCK");
    expect(verdict.riskScore).toBeGreaterThanOrEqual(0.9);
    expect(verdict.guardrailViolations[0]).toContain("DESTRUCTIVE_ACTION_FORBIDDEN");
    expect(verdict.auditEvidence.action).toBe("INTERCEPTED");
  });

  it("3. Intercepts and blocks unauthorized capability escalation from live Hermes", async () => {
    const session = await hermesAdapter.start({
      tenantId,
      agentId,
      grantedCapabilities: ["aws.ecs.describe_clusters"]
    });

    const verdict = await guardrailService.inspectToolCall({
      agentId,
      tenantId,
      sessionId: session.sessionId,
      toolName: "aws_iam_attach_user_policy",
      arguments: {
        userName: "attacker",
        policyArn: "arn:aws:iam::aws:policy/AdministratorAccess"
      },
      grantedCapabilities: ["aws.ecs.describe_clusters"]
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe("BLOCK");
    expect(verdict.riskScore).toBeGreaterThanOrEqual(0.8);
    expect(verdict.auditEvidence.action).toBe("INTERCEPTED");
  });

  it("4. Enforces DefenseClaw interception in HermesAgentAdapter execution loop", async () => {
    const granted = [
      "aws_ecs_describe_clusters",
      "aws_ecs_describe_services",
      "aws_cloudwatch_get_metric_data",
      "aws_ecs_describe_stopped_tasks",
      "aws_ecs_update_service_image"
    ];
    const session = await hermesAdapter.start({
      tenantId,
      agentId,
      grantedCapabilities: granted
    });

    let interceptedViolations: string[] = [];

    // Register DefenseClaw as pre-execution gate for Hermes tool calls
    hermesAdapter.onToolCall(session.sessionId, async (call) => {
      const verdict = await guardrailService.inspectToolCall({
        agentId,
        tenantId,
        sessionId: session.sessionId,
        toolName: call.toolName,
        arguments: call.arguments,
        grantedCapabilities: granted
      });

      if (!verdict.allowed) {
        interceptedViolations.push(...verdict.guardrailViolations);
        return {
          callId: call.callId,
          status: "ERROR",
          error: {
            code: "DEFENSECLAW_INTERCEPTION",
            message: `DefenseClaw blocked tool call '${call.toolName}': ${verdict.guardrailViolations.join("; ")}`
          }
        };
      }

      // If mutation, require approval
      if (call.toolName.includes("update") || call.toolName.includes("remediate")) {
        return {
          callId: call.callId,
          status: "AWAITING_APPROVAL",
          approvalId: `appr_dc_${Date.now()}`,
          data: { message: "Mutation routed to human approval queue" }
        };
      }

      return {
        callId: call.callId,
        status: "SUCCESS",
        data: { simulated: false, status: "healthy", checkedAt: new Date().toISOString() }
      };
    });

    // Run investigation through Hermes live adapter
    const investigationResult = await hermesAdapter.runInvestigation(session.sessionId, {
      cluster: "cloudops-demo-cluster",
      service: "cloudops-demo-service",
      region: "us-east-1",
      alertDescription: "Target group 503 error spike"
    });

    expect(investigationResult.status).toBe("WAITING_APPROVAL");
    expect(investigationResult.approvalId).toMatch(/^appr_dc_/);
    expect(investigationResult.rootCause.finding).toContain("ECS Tasks failing to start");

    // Verify audit trail captured all inspection verdicts
    const auditTrail = guardrailService.getAuditTrail();
    const liveAgentEvents = auditTrail.filter((e) => e.agentId === agentId);
    expect(liveAgentEvents.length).toBeGreaterThanOrEqual(4);
  });
});
