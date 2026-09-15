import { describe, it, expect } from "vitest";
import {
  PolicyFencingService,
  BlastRadiusSimulator,
  DEFAULT_POLICY_FENCING_CONFIG
} from "@cloudops/policy";

describe("Phase 2 — Dynamic Policy Fencing and Blast-Radius Simulation", () => {
  const policyFencing = new PolicyFencingService();

  describe("1. Region and Environment Allow-List Fencing", () => {
    it("allows execution within allowed regions and environments", () => {
      const result = policyFencing.evaluateFencing({
        agentId: "ag_deployer",
        tenantId: "ten_test",
        toolName: "aws_ecs_describe_clusters",
        operationType: "READ_ONLY",
        arguments: { region: "us-east-1" },
        environment: "production"
      });

      expect(result.decision).toBe("ALLOW");
    });

    it("rejects execution outside allowed regions before approval queue", () => {
      const result = policyFencing.evaluateFencing({
        agentId: "ag_deployer",
        tenantId: "ten_test",
        toolName: "aws_ecs_deploy_service",
        operationType: "DEPLOY",
        arguments: {
          cluster: "prod-cluster",
          service: "payment-api",
          region: "ap-southeast-1" // Disallowed region
        }
      });

      expect(result.decision).toBe("DENY");
      expect(result.ruleId).toBe("FENCE_REGION_ALLOWLIST");
      expect(result.reason).toContain("Region 'ap-southeast-1' is not in the allowed regions list");
    });

    it("rejects execution outside allowed environments", () => {
      const result = policyFencing.evaluateFencing({
        agentId: "ag_deployer",
        tenantId: "ten_test",
        toolName: "aws_ecs_deploy_service",
        operationType: "DEPLOY",
        arguments: { region: "us-east-1" },
        environment: "unauthorized_external_env"
      });

      expect(result.decision).toBe("DENY");
      expect(result.ruleId).toBe("FENCE_ENV_ALLOWLIST");
    });
  });

  describe("2. Strict Capability Tier Isolation (deploy vs mutate)", () => {
    it("denies deployment tool when agent only possesses 'mutate' capability tier", () => {
      const result = policyFencing.evaluateFencing({
        agentId: "ag_operator",
        tenantId: "ten_test",
        toolName: "aws_ecs_deploy_service",
        operationType: "DEPLOY",
        arguments: {
          cluster: "prod-cluster",
          service: "payment-api",
          region: "us-east-1"
        },
        authorizedCapabilities: ["mutate", "aws.ecs.update_service"] // Only mutate!
      });

      expect(result.decision).toBe("DENY");
      expect(result.ruleId).toBe("FENCE_CAPABILITY_TIER_ISOLATION");
      expect(result.reason).toContain("Agent has 'mutate' capability tier, but 'deploy'");
    });

    it("allows deployment when agent has explicit 'deploy' tier", () => {
      const result = policyFencing.evaluateFencing({
        agentId: "ag_deployer",
        tenantId: "ten_test",
        toolName: "aws_ecs_deploy_service",
        operationType: "DEPLOY",
        arguments: {
          cluster: "prod-cluster",
          service: "payment-api",
          region: "us-east-1"
        },
        authorizedCapabilities: ["deploy", "aws.ecs.deploy_service"]
      });

      expect(result.decision).toBe("ALLOW");
    });
  });

  describe("3. Concurrency Limits", () => {
    it("denies deployment when tenant reaches max concurrent in-flight deployments", () => {
      const result = policyFencing.evaluateFencing({
        agentId: "ag_deployer",
        tenantId: "ten_test",
        toolName: "aws_ecs_deploy_service",
        operationType: "DEPLOY",
        arguments: { region: "us-east-1" },
        authorizedCapabilities: ["deploy"],
        activeDeploymentsCount: 3 // Max limit is 3
      });

      expect(result.decision).toBe("DENY");
      expect(result.ruleId).toBe("FENCE_MAX_CONCURRENCY");
      expect(result.reason).toContain("Maximum concurrent deployments limit (3) reached");
    });
  });

  describe("4. Budget Caps & Spend Alert Fencing", () => {
    it("flags deployment exceeding monthly budget cap without override", () => {
      // 20 tasks * ~$36/month = ~$720/month > $500 cap
      const result = policyFencing.evaluateFencing({
        agentId: "ag_deployer",
        tenantId: "ten_test",
        toolName: "aws_ecs_deploy_service",
        operationType: "DEPLOY",
        arguments: {
          region: "us-east-1",
          desiredCount: 30
        },
        authorizedCapabilities: ["deploy"]
      });

      expect(result.decision).toBe("DENY");
      expect(result.ruleId).toBe("FENCE_BUDGET_CAP");
      expect(result.requiresBudgetOverride).toBe(true);
      expect(result.reason).toContain("exceeds configured monthly budget cap ($500.00)");
    });

    it("permits high-cost deployment when operator passes budgetOverride: true", () => {
      const result = policyFencing.evaluateFencing({
        agentId: "ag_deployer",
        tenantId: "ten_test",
        toolName: "aws_ecs_deploy_service",
        operationType: "DEPLOY",
        arguments: {
          region: "us-east-1",
          desiredCount: 30,
          budgetOverride: true
        },
        authorizedCapabilities: ["deploy"]
      });

      expect(result.decision).toBe("ALLOW");
    });
  });

  describe("5. Blast-Radius Simulation & Dry-Run Diff Calculation", () => {
    it("computes accurate dry-run diff and rollback targets for aws_ecs_deploy_service", () => {
      const diff = BlastRadiusSimulator.simulate("aws_ecs_deploy_service", {
        cluster: "prod-cluster",
        service: "payment-api",
        taskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:5",
        previousTaskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:4",
        desiredCount: 4
      });

      expect(diff.action).toBe("DEPLOY_SERVICE");
      expect(diff.riskLevel).toBe("CRITICAL");
      expect(diff.desiredCount).toBe(4);
      expect(diff.estimatedMonthlyCostUsd).toBeGreaterThan(0);
      expect(diff.previousTaskDefinition).toBe("arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:4");
      expect(diff.rollbackAvailable).toBe(true);
      expect(diff.rollbackTarget).toBe("arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:4");
      expect(diff.changes.length).toBeGreaterThan(3);
    });

    it("computes accurate dry-run diff for aws_ecs_rollback_service", () => {
      const diff = BlastRadiusSimulator.simulate("aws_ecs_rollback_service", {
        cluster: "prod-cluster",
        service: "payment-api",
        targetTaskDefinition: "arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:4"
      });

      expect(diff.action).toBe("ROLLBACK_SERVICE");
      expect(diff.riskLevel).toBe("HIGH");
      expect(diff.taskDefinition).toBe("arn:aws:ecs:us-east-1:123456789012:task-definition/payment-api:4");
      expect(diff.rollbackAvailable).toBe(true);
    });
  });
});
