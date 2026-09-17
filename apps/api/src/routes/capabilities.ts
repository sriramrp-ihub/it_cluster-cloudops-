import type { FastifyPluginAsync } from "fastify";
import { requireOperatorAuth } from "../middleware/auth.js";

export interface Capability {
  id: string;
  name: string;
  description: string;
  tier: "read" | "mutate" | "deploy";
  category: string;
  provider: "aws" | "gcp" | "azure";
}

export const CANONICAL_CAPABILITIES: Capability[] = [
  {
    id: "aws.ecs.describe_clusters",
    name: "ECS Cluster & Task Read",
    description: "List and inspect ECS clusters, container task definitions, and running services",
    tier: "read",
    category: "ecs",
    provider: "aws"
  },
  {
    id: "aws.ecs.describe_services",
    name: "ECS Services Read",
    description: "Query ECS services and Fargate task counts",
    tier: "read",
    category: "ecs",
    provider: "aws"
  },
  {
    id: "aws.ecs.describe_stopped_tasks",
    name: "ECS Stopped Tasks Read",
    description: "Query task exit codes, stop codes, and container crash diagnostics",
    tier: "read",
    category: "ecs",
    provider: "aws"
  },
  {
    id: "aws.ecs.list_tasks",
    name: "ECS Task List",
    description: "Discover container tasks running across clusters",
    tier: "read",
    category: "ecs",
    provider: "aws"
  },
  {
    id: "aws.cloudwatch.get_metric_data",
    name: "CloudWatch Metrics",
    description: "Query CPU, memory, and error telemetry time-series",
    tier: "read",
    category: "cloudwatch",
    provider: "aws"
  },
  {
    id: "aws.cloudwatch.put_metric_alarm",
    name: "CloudWatch Alarm Management",
    description: "Create or update CloudWatch alarm thresholds and actions",
    tier: "mutate",
    category: "cloudwatch",
    provider: "aws"
  },
  {
    id: "aws.logs.filter_log_events",
    name: "CloudWatch Logs Stream",
    description: "Filter and stream container stdout/stderr log events",
    tier: "read",
    category: "logs",
    provider: "aws"
  },
  {
    id: "aws.ecs.update_service",
    name: "ECS Service Scale / Update",
    description: "Mutate desired task count or trigger rolling deployment",
    tier: "mutate",
    category: "ecs",
    provider: "aws"
  },
  {
    id: "aws.rds.reboot_db_instance",
    name: "RDS Reboot & Failover",
    description: "Initiate database instance reboot or multi-AZ failover",
    tier: "mutate",
    category: "rds",
    provider: "aws"
  },
  {
    id: "aws.ecs.deploy_service",
    name: "ECS Service Deployment",
    description: "Deploy new container image revisions to ECS clusters",
    tier: "deploy",
    category: "ecs",
    provider: "aws"
  },
  {
    id: "aws.ecs.rollback_service",
    name: "ECS Service Rollback",
    description: "Roll back ECS service to prior stable revision with zero downtime",
    tier: "deploy",
    category: "ecs",
    provider: "aws"
  },
  {
    id: "aws.ecs.register_task_definition",
    name: "ECS Register Task Definition",
    description: "Register new container image task definition revision",
    tier: "deploy",
    category: "ecs",
    provider: "aws"
  },
  {
    id: "gcp.run.services_list",
    name: "Cloud Run Services List",
    description: "List GCP Cloud Run service instances and traffic allocations",
    tier: "read",
    category: "cloudrun",
    provider: "gcp"
  },
  {
    id: "gcp.monitoring.time_series_query",
    name: "Cloud Monitoring Query",
    description: "Query GCP Cloud Monitoring metrics and time series",
    tier: "read",
    category: "monitoring",
    provider: "gcp"
  },
  {
    id: "gcp.run.services_restart",
    name: "Cloud Run Service Restart",
    description: "Restart or redeploy Cloud Run service revision",
    tier: "mutate",
    category: "cloudrun",
    provider: "gcp"
  },
  {
    id: "azure.container_apps.list",
    name: "Azure Container Apps List",
    description: "List Azure Container Apps environment instances",
    tier: "read",
    category: "container_apps",
    provider: "azure"
  },
  {
    id: "azure.monitor.metrics_query",
    name: "Azure Monitor Metrics Query",
    description: "Query Azure Monitor time-series metrics and alerts",
    tier: "read",
    category: "monitoring",
    provider: "azure"
  },
  {
    id: "azure.container_apps.restart",
    name: "Azure Container App Restart",
    description: "Restart Azure Container App revision",
    tier: "mutate",
    category: "container_apps",
    provider: "azure"
  }
];

export const capabilityRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/capabilities
   * Returns canonical capability registry categorized by tier, category, and provider.
   */
  fastify.get("/v1/capabilities", { preHandler: [requireOperatorAuth] }, async (_request, reply) => {
    return reply.status(200).send({
      capabilities: CANONICAL_CAPABILITIES
    });
  });
};
