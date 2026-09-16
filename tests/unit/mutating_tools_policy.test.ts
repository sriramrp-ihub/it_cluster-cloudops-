import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine, isMutatingTool } from "@cloudops/policy";

describe("CO-018: Policy Engine & Mutating Tools Hard Constraint", () => {
  let engine: PolicyEngine;
  const tenantId = "ten_default_tenant";
  const agentId = "ag_sre_001";

  // Comprehensive list of mutating tools
  const ALL_MUTATING_TOOLS = [
    "aws_ecs_restart_service",
    "aws_ec2_reboot_instances",
    "aws_ecs_scale_service",
    "aws_ecs_deploy_service",
    "aws_rds_delete_db_instance",
    "aws_ecs_delete_service",
    "aws_security_group_modify_rule",
    "aws_ecs_rollback_service",
    "aws_ecs_update_service",
    "aws_ec2_terminate_instances",
    "aws_ecs_stop_task"
  ];

  const READ_ONLY_TOOLS = [
    "aws_ecs_describe_clusters",
    "aws_ecs_list_tasks",
    "aws_ecs_describe_stopped_tasks",
    "aws_cloudwatch_get_metric_data",
    "aws_alb_get_target_health",
    "aws_ecr_describe_images"
  ];

  beforeEach(() => {
    engine = new PolicyEngine({
      allowedRegions: ["us-east-1", "us-west-2", "eu-west-1"],
      allowedEnvironments: ["production", "staging", "development"],
      maxConcurrentDeployments: 3,
      monthlyBudgetLimitUsd: 500
    });
  });

  describe("HARD CONSTRAINT: Mutating tools NEVER evaluate to ALLOW", () => {
    for (const toolName of ALL_MUTATING_TOOLS) {
      it(`asserts mutating tool '${toolName}' strictly evaluates to APPROVAL_REQUIRED or DENY, NEVER ALLOW`, async () => {
        expect(isMutatingTool(toolName)).toBe(true);

        // Scenario 1: Agent has full wildcard capability
        const resWithWildcard = await engine.evaluate({
          agentId,
          tenantId,
          toolName,
          operationType: "MUTATION",
          arguments: {
            cluster: "cloudops-demo-cluster",
            service: "checkout-service",
            region: "us-east-1"
          },
          authorizedCapabilities: ["*"]
        });

        // Non-negotiable acceptance criteria: Never ALLOW
        expect(resWithWildcard.decision).not.toBe("ALLOW");
        expect(["APPROVAL_REQUIRED", "DENY"]).toContain(resWithWildcard.decision);

        // Scenario 2: Agent has specific capability granted
        const normalizedCap = toolName.replace(/_/g, ".");
        const resWithSpecificCap = await engine.evaluate({
          agentId,
          tenantId,
          toolName,
          operationType: "MUTATION",
          arguments: {
            cluster: "cloudops-demo-cluster",
            service: "checkout-service",
            region: "us-east-1"
          },
          authorizedCapabilities: [normalizedCap, "deploy", "mutate"]
        });

        expect(resWithSpecificCap.decision).not.toBe("ALLOW");
        expect(["APPROVAL_REQUIRED", "DENY"]).toContain(resWithSpecificCap.decision);
      });
    }
  });

  describe("Read-Only Inspection Tools Evaluation", () => {
    for (const toolName of READ_ONLY_TOOLS) {
      it(`asserts read-only tool '${toolName}' evaluates to ALLOW within authorized capability scope`, async () => {
        expect(isMutatingTool(toolName, "READ_ONLY")).toBe(false);

        const normalizedCap = toolName.replace(/_/g, ".");
        const res = await engine.evaluate({
          agentId,
          tenantId,
          toolName,
          operationType: "READ_ONLY",
          arguments: {
            cluster: "cloudops-demo-cluster",
            region: "us-east-1"
          },
          authorizedCapabilities: [normalizedCap]
        });

        expect(res.decision).toBe("ALLOW");
      });
    }
  });

  describe("Scope Fencing & Security Boundary Enforcement", () => {
    it("evaluates to DENY when target region is outside allowed list", async () => {
      const res = await engine.evaluate({
        agentId,
        tenantId,
        toolName: "aws_ecs_describe_clusters",
        operationType: "READ_ONLY",
        arguments: {
          region: "ap-northeast-1" // not in allowedRegions
        },
        authorizedCapabilities: ["aws.ecs.describe.clusters"]
      });

      expect(res.decision).toBe("DENY");
      expect(res.ruleId).toBe("FENCE_REGION_ALLOWLIST");
    });

    it("evaluates to DENY when agent lacks required capability grant", async () => {
      const res = await engine.evaluate({
        agentId,
        tenantId,
        toolName: "aws_ecs_describe_clusters",
        operationType: "READ_ONLY",
        arguments: { region: "us-east-1" },
        authorizedCapabilities: ["aws.s3.list_buckets"] // missing ecs
      });

      expect(res.decision).toBe("DENY");
    });
  });
});
