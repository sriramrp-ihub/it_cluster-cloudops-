/**
 * @cloudops/policy
 * Dynamic Policy Fencing and Blast-Radius Simulation Engine.
 * 
 * Enforces pre-approval safety gates:
 * 1. Region allow-list
 * 2. Environment allow-list
 * 3. Strict capability tier isolation (deploy vs mutate vs read)
 * 4. Tenant-level concurrency limits
 * 5. Budget caps and spend alerts
 * 6. Blast-radius dry-run diff calculation for mutations & deployments
 */
import {
  type AgentId,
  type PolicyDecision,
  type RiskLevel,
  PolicyViolationError,
  CapabilityTier,
  ToolOperationType
} from "@cloudops/shared";

export interface PolicyEvaluationContext {
  agentId: AgentId | string;
  tenantId: string;
  toolName: string;
  operationType: ToolOperationType | string;
  arguments: Record<string, unknown>;
  environment?: string | undefined;
  authorizedCapabilities?: string[] | undefined;
  activeDeploymentsCount?: number | undefined;
}

export interface PolicyEvaluationResult {
  decision: PolicyDecision;
  reason: string;
  ruleId?: string | undefined;
  requiresBudgetOverride?: boolean | undefined;
}

export interface PolicyFencingConfig {
  allowedRegions: string[];
  allowedEnvironments: string[];
  maxConcurrentDeployments: number;
  monthlyBudgetLimitUsd: number;
}

export const DEFAULT_POLICY_FENCING_CONFIG: PolicyFencingConfig = {
  allowedRegions: ["us-east-1", "us-west-2", "eu-west-1"],
  allowedEnvironments: ["development", "staging", "production"],
  maxConcurrentDeployments: 3,
  monthlyBudgetLimitUsd: 500.00
};

export interface DryRunDiff {
  [key: string]: unknown;
  action: string;
  targetResource: string;
  cluster?: string;
  service?: string;
  taskDefinition?: string;
  previousTaskDefinition?: string;
  desiredCount?: number;
  cpu?: number;
  memory?: number;
  estimatedMonthlyCostUsd: number;
  riskLevel: RiskLevel;
  budgetCapExceeded?: boolean;
  summary: string;
  changes: string[];
  rollbackAvailable: boolean;
  rollbackTarget?: string;
}

/**
 * Blast-Radius Simulator: Computes structured dry-run diffs, cost impact, and rollback targets.
 */
export class BlastRadiusSimulator {
  /**
   * Estimates monthly USD cost based on vCPU and RAM hours (AWS Fargate baseline).
   */
  static estimateMonthlyCost(cpu: number = 512, memoryMb: number = 1024, count: number = 1): number {
    const vCpu = cpu / 1024;
    const gb = memoryMb / 1024;
    const hourlyPerTask = (vCpu * 0.04048) + (gb * 0.004445);
    const monthlyPerTask = hourlyPerTask * 730;
    return Math.round(monthlyPerTask * count * 100) / 100;
  }

  /**
   * Generates a pre-execution dry-run diff for a requested operation.
   */
  static simulate(
    toolName: string,
    args: Record<string, unknown>,
    currentState?: Record<string, unknown>
  ): DryRunDiff {
    if (toolName === "aws_ecs_deploy_service") {
      const cluster = (args.cluster as string) || "production-cluster";
      const service = (args.service as string) || "app-service";
      const taskDef = (args.taskDefinition as string) || `arn:aws:ecs:us-east-1:123456789012:task-definition/${service}:1`;
      const desiredCount = Number(args.desiredCount ?? 2);
      const prevTaskDef = (currentState?.taskDefinition as string) || (args.previousTaskDefinition as string) || `arn:aws:ecs:us-east-1:123456789012:task-definition/${service}:prior`;
      const estimatedCost = BlastRadiusSimulator.estimateMonthlyCost(512, 1024, desiredCount);

      return {
        action: "DEPLOY_SERVICE",
        targetResource: `arn:aws:ecs:us-east-1:123456789012:service/${cluster}/${service}`,
        cluster,
        service,
        taskDefinition: taskDef,
        previousTaskDefinition: prevTaskDef,
        desiredCount,
        estimatedMonthlyCostUsd: estimatedCost,
        riskLevel: "CRITICAL",
        summary: `Deploying task definition '${taskDef}' to ECS service '${service}' in cluster '${cluster}' with ${desiredCount} tasks.`,
        changes: [
          `Provision or update ECS service '${service}' in cluster '${cluster}'`,
          `Set active task definition to '${taskDef}'`,
          `Configure desired task capacity to ${desiredCount} instances`,
          `Estimated infrastructure cost delta: $${estimatedCost.toFixed(2)} USD/month`,
          `Rolling zero-downtime deployment strategy enabled`
        ],
        rollbackAvailable: true,
        rollbackTarget: prevTaskDef
      };
    }

    if (toolName === "aws_ecs_register_task_definition") {
      const family = (args.family as string) || "app-task";
      const cpu = Number(args.cpu ?? 512);
      const memory = Number(args.memory ?? 1024);
      const containerName = (args.containerName as string) || "web";
      const image = (args.image as string) || "public.ecr.aws/docker/library/node:20";
      const costPerTask = BlastRadiusSimulator.estimateMonthlyCost(cpu, memory, 1);

      return {
        action: "REGISTER_TASK_DEFINITION",
        targetResource: `arn:aws:ecs:us-east-1:123456789012:task-definition/${family}:new`,
        taskDefinition: `${family}:new`,
        cpu,
        memory,
        estimatedMonthlyCostUsd: costPerTask,
        riskLevel: "HIGH",
        summary: `Registering new ECS task definition revision for family '${family}' with image '${image}'.`,
        changes: [
          `Register new revision in task definition family '${family}'`,
          `Container '${containerName}' configured with image '${image}'`,
          `Resource allocation: ${cpu} CPU units (${cpu / 1024} vCPU), ${memory} MB RAM`,
          `Estimated baseline cost per task instance: $${costPerTask.toFixed(2)} USD/month`
        ],
        rollbackAvailable: false
      };
    }

    if (toolName === "aws_ecs_rollback_service") {
      const cluster = (args.cluster as string) || "production-cluster";
      const service = (args.service as string) || "app-service";
      const targetTaskDef = (args.targetTaskDefinition as string) || (currentState?.taskDefinition as string) || `arn:aws:ecs:us-east-1:123456789012:task-definition/${service}:prior`;

      return {
        action: "ROLLBACK_SERVICE",
        targetResource: `arn:aws:ecs:us-east-1:123456789012:service/${cluster}/${service}`,
        cluster,
        service,
        taskDefinition: targetTaskDef,
        estimatedMonthlyCostUsd: 0,
        riskLevel: "HIGH",
        summary: `Rolling back ECS service '${service}' in cluster '${cluster}' to prior stable revision '${targetTaskDef}'.`,
        changes: [
          `Initiate rollback for ECS service '${service}' in cluster '${cluster}'`,
          `Revert active task definition to prior snapshot '${targetTaskDef}'`,
          `Zero-downtime rolling convergence to prior stable state`
        ],
        rollbackAvailable: true,
        rollbackTarget: targetTaskDef
      };
    }

    if (toolName === "aws_ecs_update_service") {
      const cluster = (args.cluster as string) || "production-cluster";
      const service = (args.service as string) || "payment-api";
      const desiredCount = Number(args.desiredCount ?? 2);
      const estimatedCost = BlastRadiusSimulator.estimateMonthlyCost(512, 1024, desiredCount);

      return {
        action: "UPDATE_SERVICE",
        targetResource: `arn:aws:ecs:us-east-1:123456789012:service/${cluster}/${service}`,
        cluster,
        service,
        desiredCount,
        estimatedMonthlyCostUsd: estimatedCost,
        riskLevel: "HIGH",
        summary: `Updating ECS service '${service}' in cluster '${cluster}' (desiredCount: ${desiredCount}).`,
        changes: [
          `Scale service '${service}' to ${desiredCount} desired tasks`,
          args.forceNewDeployment ? "Trigger rolling task redeployment" : "Maintain existing task instances",
          `Projected monthly cost: $${estimatedCost.toFixed(2)} USD`
        ],
        rollbackAvailable: true,
        rollbackTarget: (currentState?.taskDefinition as string) || `arn:aws:ecs:us-east-1:123456789012:task-definition/${service}:prior`
      };
    }

    // Default simulation for other mutation tools
    return {
      action: "MUTATE_INFRASTRUCTURE",
      targetResource: toolName,
      estimatedMonthlyCostUsd: 0,
      riskLevel: "HIGH",
      summary: `Execution of mutation tool '${toolName}'.`,
      changes: [`Invoke tool '${toolName}' with arguments: ${JSON.stringify(args)}`],
      rollbackAvailable: false
    };
  }
}

/**
 * Dynamic Policy Fencing Service: Validates operations against fences prior to approval queueing.
 */
export class PolicyFencingService {
  private config: PolicyFencingConfig;

  constructor(config: Partial<PolicyFencingConfig> = {}) {
    this.config = { ...DEFAULT_POLICY_FENCING_CONFIG, ...config };
  }

  /**
   * Evaluates policy fences for a tool invocation request.
   * Throws PolicyViolationError or returns DENY if any fence is breached.
   */
  evaluateFencing(ctx: PolicyEvaluationContext): PolicyEvaluationResult {
    const { toolName, arguments: args, authorizedCapabilities, activeDeploymentsCount = 0 } = ctx;

    // 1. Region Allow-List Fence
    const region = (args.region as string) || "us-east-1";
    if (!this.config.allowedRegions.includes(region)) {
      const reason = `Policy fencing violation: Region '${region}' is not in the allowed regions list [${this.config.allowedRegions.join(", ")}]. Request denied.`;
      return {
        decision: "DENY",
        reason,
        ruleId: "FENCE_REGION_ALLOWLIST"
      };
    }

    // 2. Environment Allow-List Fence
    if (ctx.environment && !this.config.allowedEnvironments.includes(ctx.environment)) {
      const reason = `Policy fencing violation: Environment '${ctx.environment}' is not in the allowed environments list [${this.config.allowedEnvironments.join(", ")}]. Request denied.`;
      return {
        decision: "DENY",
        reason,
        ruleId: "FENCE_ENV_ALLOWLIST"
      };
    }

    // 3. Strict Capability Tier Isolation (deploy vs mutate vs read)
    const isDeployTool =
      ctx.operationType === "DEPLOY" ||
      toolName.startsWith("aws_ecs_deploy") ||
      toolName.startsWith("aws_ecs_register_task_definition") ||
      toolName.startsWith("aws_ecs_rollback");

    if (isDeployTool && authorizedCapabilities && authorizedCapabilities.length > 0) {
      const hasWildcard = authorizedCapabilities.includes("*");
      const hasDeployTier =
        authorizedCapabilities.includes("deploy") ||
        authorizedCapabilities.includes("deploy:*") ||
        authorizedCapabilities.some((c) => c.startsWith("aws.ecs.deploy") || c.startsWith("aws.ecs.register") || c.startsWith("aws.ecs.rollback"));

      if (!hasWildcard && !hasDeployTier) {
        const hasMutateOnly = authorizedCapabilities.includes("mutate") || authorizedCapabilities.some((c) => c.startsWith("aws.ecs.update"));
        const tierMsg = hasMutateOnly
          ? "Agent has 'mutate' capability tier, but 'deploy' (resource creation/deployment) requires explicit 'deploy' tier grant."
          : "Agent has not been granted the 'deploy' capability tier.";

        const reason = `Policy fencing violation: Unauthorized capability tier for tool '${toolName}'. ${tierMsg} Request denied before approval queue.`;
        return {
          decision: "DENY",
          reason,
          ruleId: "FENCE_CAPABILITY_TIER_ISOLATION"
        };
      }
    }

    // 4. Concurrency Limits
    if (isDeployTool && activeDeploymentsCount >= this.config.maxConcurrentDeployments) {
      const reason = `Policy fencing violation: Maximum concurrent deployments limit (${this.config.maxConcurrentDeployments}) reached for tenant. Request denied.`;
      return {
        decision: "DENY",
        reason,
        ruleId: "FENCE_MAX_CONCURRENCY"
      };
    }

    // 5. Budget Caps & Spend Alert Fence
    const diff = BlastRadiusSimulator.simulate(toolName, args);
    if (diff.estimatedMonthlyCostUsd > this.config.monthlyBudgetLimitUsd) {
      if (!args.budgetOverride) {
        const reason = `Policy fencing violation: Estimated monthly cost ($${diff.estimatedMonthlyCostUsd.toFixed(2)}) exceeds configured monthly budget cap ($${this.config.monthlyBudgetLimitUsd.toFixed(2)}). Explicit budget override required.`;
        return {
          decision: "DENY",
          reason,
          ruleId: "FENCE_BUDGET_CAP",
          requiresBudgetOverride: true
        };
      }
    }

    // All fences passed
    return {
      decision: "ALLOW",
      reason: "All dynamic policy fences passed successfully."
    };
  }
}
