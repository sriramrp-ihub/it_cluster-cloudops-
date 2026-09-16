import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PolicyStatement {
  Sid?: string;
  Effect: "Allow" | "Deny";
  Action: string[];
  Resource: string;
}

interface IamPolicy {
  Version: string;
  Statement: PolicyStatement[];
}

/**
 * Deterministic IAM Policy Evaluator simulating AWS IAM policy engine
 */
class IamPolicySimulator {
  constructor(private policy: IamPolicy) {}

  evaluate(action: string): "ALLOWED" | "DENIED" {
    // 1. Explicit Deny always wins
    for (const stmt of this.policy.Statement) {
      if (stmt.Effect === "Deny") {
        if (stmt.Action.some((a) => this.matchesAction(a, action))) {
          return "DENIED";
        }
      }
    }

    // 2. Must have explicit Allow
    for (const stmt of this.policy.Statement) {
      if (stmt.Effect === "Allow") {
        if (stmt.Action.some((a) => this.matchesAction(a, action))) {
          return "ALLOWED";
        }
      }
    }

    // 3. Default Deny
    return "DENIED";
  }

  private matchesAction(pattern: string, action: string): boolean {
    if (pattern === "*") return true;
    const regexStr = "^" + pattern.replace(/\*/g, ".*") + "$";
    return new RegExp(regexStr, "i").test(action);
  }
}

describe("AWS Least-Privilege Baseline Evaluation (CO-006)", () => {
  const policyPath = path.resolve(__dirname, "../../packages/adapters/policies/CloudOpsReadOnlyPolicy.json");
  const policy: IamPolicy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  const simulator = new IamPolicySimulator(policy);

  it("1. Confirms all required ECS read operations are explicitly ALLOWED", () => {
    const ecsReads = [
      "ecs:DescribeClusters",
      "ecs:DescribeServices",
      "ecs:DescribeTasks",
      "ecs:DescribeTaskDefinition",
      "ecs:ListClusters",
      "ecs:ListServices",
      "ecs:ListTasks",
      "ecs:ListTaskDefinitions"
    ];

    for (const action of ecsReads) {
      expect(simulator.evaluate(action)).toBe("ALLOWED");
    }
  });

  it("2. Confirms all required CloudWatch and Logs read operations are explicitly ALLOWED", () => {
    const logReads = [
      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
      "cloudwatch:GetMetricData",
      "cloudwatch:GetMetricStatistics",
      "cloudwatch:ListMetrics"
    ];

    for (const action of logReads) {
      expect(simulator.evaluate(action)).toBe("ALLOWED");
    }
  });

  it("3. Confirms ALB and ECR read operations are explicitly ALLOWED", () => {
    const albEcrReads = [
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeTargetGroups",
      "elasticloadbalancing:DescribeTargetHealth",
      "ecr:DescribeRepositories",
      "ecr:DescribeImages",
      "ecr:ListImages"
    ];

    for (const action of albEcrReads) {
      expect(simulator.evaluate(action)).toBe("ALLOWED");
    }
  });

  it("4. Confirms mutating ECS operations are explicitly DENIED by defense-in-depth policy", () => {
    const ecsWrites = [
      "ecs:CreateService",
      "ecs:UpdateService",
      "ecs:DeleteService",
      "ecs:RunTask",
      "ecs:StopTask",
      "ecs:RegisterTaskDefinition",
      "ecs:DeregisterTaskDefinition"
    ];

    for (const action of ecsWrites) {
      expect(simulator.evaluate(action)).toBe("DENIED");
    }
  });

  it("5. Confirms high-impact administrative and IAM operations are explicitly DENIED", () => {
    const dangerousActions = [
      "iam:CreateUser",
      "iam:AttachRolePolicy",
      "logs:DeleteLogGroup",
      "cloudwatch:DeleteAlarms",
      "ecr:DeleteRepository",
      "organizations:DeleteOrganization"
    ];

    for (const action of dangerousActions) {
      expect(simulator.evaluate(action)).toBe("DENIED");
    }
  });
});
