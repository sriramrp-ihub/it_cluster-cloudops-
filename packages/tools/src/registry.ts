import { z, ZodType } from "zod";
import type { RiskLevel } from "@cloudops/shared";

export interface ToolExecutionContext {
  agentId: string;
  tenantId: string;
  runId?: string;
  credentials?: unknown;
}

export interface CanonicalToolDefinition<TInput = any, TOutput = any> {
  name: string;
  description: string;
  provider: "aws" | "gcp" | "azure";
  status: "live" | "contract_only";
  operationType?: "READ_ONLY" | "MUTATION" | "DEPLOY";
  requiredCapability: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  inputSchema: ZodType<TInput>;
  handler: (input: TInput, ctx: ToolExecutionContext) => Promise<TOutput>;
}

/**
 * Registry of Canonical Multi-Cloud MCP Tools.
 */
export const CANONICAL_TOOLS: CanonicalToolDefinition[] = [
  // --- AWS TOOLS ---
  {
    name: "aws_ecs_describe_clusters",
    description: "Describe Amazon ECS clusters, task status, and running container counts.",
    provider: "aws",
    status: "live",
    requiredCapability: "aws.ecs.describe_clusters",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      clusters: z.array(z.string()).optional().describe("Optional list of cluster names or ARNs"),
      region: z.string().default("us-east-1").describe("AWS Region")
    }),
    handler: async (input, ctx) => {
      return {
        provider: "aws",
        region: input.region,
        clusters: [
          {
            clusterName: input.clusters?.[0] || "production-cluster",
            status: "ACTIVE",
            runningTasksCount: 14,
            pendingTasksCount: 0,
            activeServicesCount: 5
          }
        ],
        timestamp: new Date().toISOString()
      };
    }
  },
  {
    name: "aws_ecs_list_tasks",
    description: "List active tasks and container instances within an ECS cluster.",
    provider: "aws",
    status: "live",
    requiredCapability: "aws.ecs.list_tasks",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      cluster: z.string().default("production-cluster").describe("ECS cluster name"),
      serviceName: z.string().optional().describe("Filter by service name"),
      region: z.string().default("us-east-1").describe("AWS Region")
    }),
    handler: async (input, ctx) => {
      return {
        cluster: input.cluster,
        service: input.serviceName || "all",
        taskArns: [
          `arn:aws:ecs:${input.region}:123456789012:task/${input.cluster}/task-01`,
          `arn:aws:ecs:${input.region}:123456789012:task/${input.cluster}/task-02`
        ],
        status: "RUNNING"
      };
    }
  },
  {
    name: "aws_cloudwatch_get_metric_data",
    description: "Fetch CloudWatch metric telemetry (CPUUtilization, MemoryUtilization, ErrorCount).",
    provider: "aws",
    status: "live",
    requiredCapability: "aws.cloudwatch.get_metric_data",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      metricName: z.string().describe("Metric name, e.g. CPUUtilization"),
      namespace: z.string().default("AWS/ECS").describe("CloudWatch namespace"),
      period: z.number().default(300).describe("Aggregation period in seconds"),
      region: z.string().default("us-east-1").describe("AWS Region")
    }),
    handler: async (input, ctx) => {
      return {
        metric: input.metricName,
        namespace: input.namespace,
        datapoints: [
          { timestamp: new Date(Date.now() - 300000).toISOString(), average: 64.2, unit: "Percent" },
          { timestamp: new Date().toISOString(), average: 78.5, unit: "Percent" }
        ],
        alarmState: "OK"
      };
    }
  },
  {
    name: "aws_ecs_update_service",
    description: "Scale tasks or trigger a rolling restart for an Amazon ECS service. Requires operator approval.",
    provider: "aws",
    status: "live",
    requiredCapability: "aws.ecs.update_service",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name"),
      service: z.string().describe("ECS service name to update"),
      desiredCount: z.number().optional().describe("Desired task count"),
      forceNewDeployment: z.boolean().optional().describe("Trigger rolling redeployment")
    }),
    handler: async (input, ctx) => {
      return {
        status: "EXECUTED",
        serviceArn: `arn:aws:ecs:us-east-1:123456789012:service/${input.cluster}/${input.service}`,
        desiredCount: input.desiredCount ?? 2,
        deploymentTriggered: input.forceNewDeployment ?? true,
        updatedAt: new Date().toISOString()
      };
    }
  },
  {
    name: "aws_rds_reboot_db_instance",
    description: "Reboot an Amazon RDS database instance or initiate failover. Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "MUTATION",
    requiredCapability: "aws.rds.reboot_db_instance",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      dbInstanceIdentifier: z.string().describe("RDS database instance identifier"),
      forceFailover: z.boolean().optional().describe("Force multi-AZ failover reboot")
    }),
    handler: async (input, ctx) => {
      return {
        status: "REBOOTING",
        dbInstanceIdentifier: input.dbInstanceIdentifier,
        failover: input.forceFailover ?? false,
        rebootTriggeredAt: new Date().toISOString()
      };
    }
  },
  {
    name: "aws_ecs_deploy_service",
    description: "Deploy a new task definition revision to an existing Amazon ECS service or provision a new service. Requires operator approval and dry-run diff review.",
    provider: "aws",
    status: "live",
    operationType: "DEPLOY",
    requiredCapability: "aws.ecs.deploy_service",
    riskLevel: "CRITICAL",
    requiresApproval: true,
    inputSchema: z.object({
      cluster: z.string().default("production-cluster").describe("ECS cluster name"),
      service: z.string().describe("ECS service name to deploy"),
      taskDefinition: z.string().describe("Target task definition family:revision or ARN"),
      desiredCount: z.number().default(2).describe("Desired running task count"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      budgetOverride: z.boolean().optional().describe("Explicit operator budget override if deploy exceeds budget limits")
    }),
    handler: async (input, ctx) => {
      return {
        status: "DEPLOYED",
        serviceArn: `arn:aws:ecs:${input.region}:123456789012:service/${input.cluster}/${input.service}`,
        cluster: input.cluster,
        service: input.service,
        taskDefinition: input.taskDefinition,
        desiredCount: input.desiredCount ?? 2,
        deploymentId: `dep_${Math.random().toString(36).substring(2, 10)}`,
        deployedAt: new Date().toISOString()
      };
    }
  },
  {
    name: "aws_ecs_register_task_definition",
    description: "Register a new Amazon ECS task definition revision (container image, cpu, memory, environment). Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "DEPLOY",
    requiredCapability: "aws.ecs.register_task_definition",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      family: z.string().describe("Task definition family name"),
      containerName: z.string().default("web").describe("Container name"),
      image: z.string().describe("Container image URL"),
      cpu: z.number().default(512).describe("CPU units (e.g. 256, 512, 1024)"),
      memory: z.number().default(1024).describe("Memory in MB"),
      region: z.string().default("us-east-1").describe("AWS Region")
    }),
    handler: async (input, ctx) => {
      return {
        status: "REGISTERED",
        taskDefinitionArn: `arn:aws:ecs:${input.region}:123456789012:task-definition/${input.family}:1`,
        family: input.family,
        revision: 1,
        registeredAt: new Date().toISOString()
      };
    }
  },
  {
    name: "aws_ecs_rollback_service",
    description: "Roll back an Amazon ECS service to its prior stable task definition revision using previous state snapshot. Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "DEPLOY",
    requiredCapability: "aws.ecs.rollback_service",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      cluster: z.string().default("production-cluster").describe("ECS cluster name"),
      service: z.string().describe("ECS service name to roll back"),
      targetTaskDefinition: z.string().optional().describe("Specific prior task definition ARN to revert to"),
      region: z.string().default("us-east-1").describe("AWS Region")
    }),
    handler: async (input, ctx) => {
      return {
        status: "ROLLED_BACK",
        serviceArn: `arn:aws:ecs:${input.region}:123456789012:service/${input.cluster}/${input.service}`,
        cluster: input.cluster,
        service: input.service,
        activeTaskDefinition: input.targetTaskDefinition || `arn:aws:ecs:${input.region}:123456789012:task-definition/${input.service}:prior`,
        rolledBackAt: new Date().toISOString()
      };
    }
  },

  // --- GCP TOOLS ---
  {
    name: "gcp_run_services_list",
    description: "List and inspect serverless Cloud Run services, active revisions, and traffic allocations.",
    provider: "gcp",
    status: "contract_only",
    requiredCapability: "gcp.run.services_list",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      project: z.string().optional().describe("GCP Project ID"),
      region: z.string().default("us-central1").describe("GCP Region")
    }),
    handler: async (input, ctx) => {
      return {
        provider: "gcp",
        services: [
          {
            serviceName: "cloudops-ingress",
            region: input.region,
            status: "READY",
            latestRevision: "cloudops-ingress-00042",
            trafficAllocation: [{ percent: 100, revision: "cloudops-ingress-00042" }]
          }
        ]
      };
    }
  },
  {
    name: "gcp_monitoring_query",
    description: "Query Google Cloud Monitoring metrics and time-series telemetry.",
    provider: "gcp",
    status: "contract_only",
    requiredCapability: "gcp.monitoring.time_series_query",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      metricType: z.string().default("run.googleapis.com/container/cpu/utilizations"),
      durationMinutes: z.number().default(60)
    }),
    handler: async (input, ctx) => {
      return {
        metric: input.metricType,
        values: [0.38, 0.44, 0.51, 0.49],
        status: "HEALTHY"
      };
    }
  },
  {
    name: "gcp_run_service_restart",
    description: "Trigger a rolling redeployment or restart of a Google Cloud Run service. Requires operator approval.",
    provider: "gcp",
    status: "contract_only",
    requiredCapability: "gcp.run.services_restart",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      serviceName: z.string().describe("Cloud Run service name"),
      region: z.string().default("us-central1")
    }),
    handler: async (input, ctx) => {
      return {
        status: "RESTART_INITIATED",
        serviceName: input.serviceName,
        region: input.region,
        timestamp: new Date().toISOString()
      };
    }
  },

  // --- AZURE TOOLS ---
  {
    name: "azure_container_apps_list",
    description: "List and describe Azure Container App environments and running container replicas.",
    provider: "azure",
    status: "contract_only",
    requiredCapability: "azure.container_apps.list",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      resourceGroup: z.string().optional().describe("Azure Resource Group")
    }),
    handler: async (input, ctx) => {
      return {
        provider: "azure",
        resourceGroup: input.resourceGroup || "rg-production",
        containerApps: [
          {
            name: "aca-api-gateway",
            provisioningState: "Succeeded",
            runningReplicas: 3,
            fqdn: "aca-api-gateway.politecliff-12345.eastus.azurecontainerapps.io"
          }
        ]
      };
    }
  },
  {
    name: "azure_monitor_metrics_query",
    description: "Query Azure Monitor resource metrics and alert evaluations.",
    provider: "azure",
    status: "contract_only",
    requiredCapability: "azure.monitor.metrics_query",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      resourceUri: z.string().describe("Azure Resource ID URI"),
      metricNames: z.array(z.string()).describe("Metrics to fetch, e.g. UsageNanoCores")
    }),
    handler: async (input, ctx) => {
      return {
        resourceUri: input.resourceUri,
        metrics: input.metricNames.map((name: string) => ({
          name,
          average: 42000000,
          unit: "NanoCores"
        }))
      };
    }
  },
  {
    name: "azure_container_app_restart",
    description: "Trigger revision restart for an Azure Container App. Requires operator approval.",
    provider: "azure",
    status: "contract_only",
    requiredCapability: "azure.container_apps.restart",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      containerAppName: z.string().describe("Container app name"),
      resourceGroup: z.string().describe("Azure Resource Group")
    }),
    handler: async (input, ctx) => {
      return {
        status: "REVISION_RESTARTED",
        containerAppName: input.containerAppName,
        resourceGroup: input.resourceGroup,
        restartedAt: new Date().toISOString()
      };
    }
  }
];

/**
 * Helper to find a tool by name.
 */
export function findCanonicalTool(toolName: string): CanonicalToolDefinition | undefined {
  return CANONICAL_TOOLS.find((t) => t.name === toolName);
}
