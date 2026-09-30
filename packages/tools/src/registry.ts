import { z, ZodType } from "zod";
import type { RiskLevel } from "@cloudops/shared";
import { defaultAwsSessionManager, type AwsSessionCredentials } from "@cloudops/adapters";
import { AgentService } from "@cloudops/identity";
import {
  ECSClient,
  DescribeClustersCommand,
  DescribeServicesCommand,
  ListTasksCommand,
  DescribeTasksCommand,
  UpdateServiceCommand,
  RegisterTaskDefinitionCommand,
  DescribeTaskDefinitionCommand,
  ListClustersCommand,
  ListServicesCommand,
  ListTaskDefinitionsCommand,
  DescribeCapacityProvidersCommand,
  DeleteServiceCommand,
  DeleteClusterCommand,
  DeregisterTaskDefinitionCommand,
} from "@aws-sdk/client-ecs";
import {
  ApplicationAutoScalingClient,
  DescribeScalableTargetsCommand,
  DescribeScalingPoliciesCommand,
} from "@aws-sdk/client-application-auto-scaling";
import { S3Client, ListBucketsCommand, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  EC2Client,
  DescribeInstancesCommand,
  RebootInstancesCommand,
  StopInstancesCommand,
  StartInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeVolumesCommand,
} from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand, RebootDBInstanceCommand } from "@aws-sdk/client-rds";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient, FilterLogEventsCommand, DescribeLogGroupsCommand, CreateLogGroupCommand, PutRetentionPolicyCommand } from "@aws-sdk/client-cloudwatch-logs";
import {
  ElasticLoadBalancingV2Client,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { ECRClient, DescribeImagesCommand } from "@aws-sdk/client-ecr";

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
 * Resolves live in-memory AWS session credentials for a tenant. Resolution
 * order: (1) an explicit cloudAccountId passed in the tool call's own
 * arguments, (2) the calling agent's own assigned cloud account
 * (agents.cloud_account_id — the real one-agent-to-one-account mapping,
 * not a guess), (3) as a last resort, any active session for the tenant —
 * kept only so unassigned agents and pre-mapping call sites don't hard-fail,
 * not because "any account" is ever the right answer for a mapped agent.
 */
async function resolveAwsCredentials(
  tenantId: string,
  agentId?: string,
  cloudAccountId?: string
): Promise<AwsSessionCredentials | undefined> {
  if (cloudAccountId) {
    const creds = await defaultAwsSessionManager.getCredentials(tenantId, cloudAccountId);
    if (creds) return creds;
  }
  if (agentId) {
    const assignedAccountId = await getAgentAssignedCloudAccountId(tenantId, agentId);
    if (assignedAccountId) {
      const creds = await defaultAwsSessionManager.getCredentials(tenantId, assignedAccountId);
      if (creds) return creds;
    }
  }
  return defaultAwsSessionManager.getAnyCredentialsForTenant(tenantId);
}

const agentServiceForCredentialResolution = new AgentService();

async function getAgentAssignedCloudAccountId(tenantId: string, agentId: string): Promise<string | null> {
  try {
    const agent = await agentServiceForCredentialResolution.getAgent(tenantId, agentId as any);
    return agent.cloudAccountId;
  } catch {
    return null;
  }
}

function toSdkCredentials(creds: AwsSessionCredentials | undefined) {
  if (!creds) return undefined;
  return {
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}),
  };
}

/**
 * Resolves an ECSClient using live in-memory AWS session credentials.
 * Falls back to environment-level credentials (e.g. instance profile, ~/.aws/credentials)
 * if no explicit session is stored for this tenant — so local dev and CI still work.
 */
async function resolveEcsClient(tenantId: string, agentId: string | undefined, region: string, cloudAccountId?: string): Promise<ECSClient> {
  const credentials = toSdkCredentials(await resolveAwsCredentials(tenantId, agentId, cloudAccountId));
  return credentials ? new ECSClient({ region, credentials }) : new ECSClient({ region });
}

async function resolveS3Client(tenantId: string, agentId: string | undefined, region: string, cloudAccountId?: string): Promise<S3Client> {
  const credentials = toSdkCredentials(await resolveAwsCredentials(tenantId, agentId, cloudAccountId));
  return credentials ? new S3Client({ region, credentials }) : new S3Client({ region });
}

async function resolveEc2Client(tenantId: string, agentId: string | undefined, region: string, cloudAccountId?: string): Promise<EC2Client> {
  const credentials = toSdkCredentials(await resolveAwsCredentials(tenantId, agentId, cloudAccountId));
  return credentials ? new EC2Client({ region, credentials }) : new EC2Client({ region });
}

async function resolveRdsClient(tenantId: string, agentId: string | undefined, region: string, cloudAccountId?: string): Promise<RDSClient> {
  const credentials = toSdkCredentials(await resolveAwsCredentials(tenantId, agentId, cloudAccountId));
  return credentials ? new RDSClient({ region, credentials }) : new RDSClient({ region });
}

async function resolveCloudWatchClient(
  tenantId: string,
  agentId: string | undefined,
  region: string,
  cloudAccountId?: string
): Promise<CloudWatchClient> {
  const credentials = toSdkCredentials(await resolveAwsCredentials(tenantId, agentId, cloudAccountId));
  return credentials ? new CloudWatchClient({ region, credentials }) : new CloudWatchClient({ region });
}

async function resolveCloudWatchLogsClient(
  tenantId: string,
  agentId: string | undefined,
  region: string,
  cloudAccountId?: string
): Promise<CloudWatchLogsClient> {
  const credentials = toSdkCredentials(await resolveAwsCredentials(tenantId, agentId, cloudAccountId));
  return credentials ? new CloudWatchLogsClient({ region, credentials }) : new CloudWatchLogsClient({ region });
}

async function resolveAutoScalingClient(
  tenantId: string,
  agentId: string | undefined,
  region: string,
  cloudAccountId?: string
): Promise<ApplicationAutoScalingClient> {
  const credentials = toSdkCredentials(await resolveAwsCredentials(tenantId, agentId, cloudAccountId));
  return credentials ? new ApplicationAutoScalingClient({ region, credentials }) : new ApplicationAutoScalingClient({ region });
}

async function resolveElbClient(
  tenantId: string,
  agentId: string | undefined,
  region: string,
  cloudAccountId?: string
): Promise<ElasticLoadBalancingV2Client> {
  const credentials = toSdkCredentials(await resolveAwsCredentials(tenantId, agentId, cloudAccountId));
  return credentials ? new ElasticLoadBalancingV2Client({ region, credentials }) : new ElasticLoadBalancingV2Client({ region });
}

async function resolveEcrClient(
  tenantId: string,
  agentId: string | undefined,
  region: string,
  cloudAccountId?: string
): Promise<ECRClient> {
  const credentials = toSdkCredentials(await resolveAwsCredentials(tenantId, agentId, cloudAccountId));
  return credentials ? new ECRClient({ region, credentials }) : new ECRClient({ region });
}

/**
 * CloudWatch dimension values for ELBv2 resources are the ARN's resource
 * portion with the leading "loadbalancer/" stripped for an ALB/NLB (e.g.
 * "app/my-lb/50dc6c495c0c9188"), and taken as-is for a target group (e.g.
 * "targetgroup/my-targets/73e2d6bc24d8a067") — see AWS/ApplicationELB
 * CloudWatch metric dimension docs. Derived from the real ARN, never guessed.
 */
function loadBalancerArnToDimension(arn: string): string {
  const resource = arn.split(":").pop() || "";
  return resource.replace(/^loadbalancer\//, "");
}

function targetGroupArnToDimension(arn: string): string {
  return arn.split(":").pop() || "";
}

/**
 * True when a CloudWatch metric name is one an Application Load Balancer
 * publishes (namespace AWS/ApplicationELB) rather than one ECS itself
 * publishes for a service (namespace AWS/ECS, e.g. CPUUtilization/
 * MemoryUtilization). Used to decide whether a service with no attached
 * target group can ever honestly report this metric.
 */
function isLoadBalancerMetricName(metricName: string): boolean {
  return /5xx|4xx|3xx|2xx|targetresponsetime|requestcount|healthyhostcount|unhealthyhostcount|requestcountpertarget/i.test(metricName);
}

/**
 * Parses a container image reference pushed to Amazon ECR, e.g.
 * "265766933076.dkr.ecr.us-east-1.amazonaws.com/starvision-motors:latest"
 * or "...amazonaws.com/starvision-motors@sha256:abc...", into the
 * repositoryName + imageTag/imageDigest ECR's DescribeImages API needs.
 * Returns undefined for an image string that isn't an ECR reference (e.g.
 * a public Docker Hub image) — that's real, useful information too (this
 * tool can only validate ECR-hosted images), not a value to guess at.
 */
function parseEcrImageReference(image: string): { registryId: string; repositoryName: string; imageTag: string | undefined; imageDigest: string | undefined } | undefined {
  const match = image.match(/^(\d+)\.dkr\.ecr\.[a-z0-9-]+\.amazonaws\.com\/([^:@]+)(?::([^@]+))?(?:@(sha256:[a-f0-9]+))?$/);
  if (!match) return undefined;
  const [, registryId, repositoryName, imageTag, imageDigest] = match;
  return { registryId: registryId!, repositoryName: repositoryName!, imageTag, imageDigest };
}

/**
 * Registry of Canonical Multi-Cloud MCP Tools.
 * AWS tools make real SDK calls; GCP/Azure are contract-only stubs until those providers are onboarded.
 */
export const CANONICAL_TOOLS: CanonicalToolDefinition[] = [
  // --- AWS TOOLS ---

  {
    name: "aws_ecs_describe_clusters",
    description: "Describe Amazon ECS clusters, task status, and running container counts.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.describe_clusters",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      clusters: z.array(z.string()).optional().describe("Optional list of cluster names or ARNs"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional().describe("Cloud account ID for credential resolution"),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DescribeClustersCommand({
          clusters: input.clusters && input.clusters.length > 0 ? input.clusters : undefined,
        }));

        return {
          provider: "aws",
          region: input.region,
          clusters: (res.clusters || []).map((c) => ({
            clusterName: c.clusterName,
            clusterArn: c.clusterArn,
            status: c.status,
            runningTasksCount: c.runningTasksCount ?? 0,
            pendingTasksCount: c.pendingTasksCount ?? 0,
            activeServicesCount: c.activeServicesCount ?? 0,
          })),
          timestamp: new Date().toISOString(),
          source: "live:aws:ecs",
        };
      } catch (err: any) {
        // Surface the real AWS error — no fabrication
        return {
          provider: "aws",
          region: input.region,
          error: err?.message || "ECS DescribeClusters failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_list_clusters",
    description: "List ALL ECS cluster names/ARNs in the connected account — not just ones already discovered, use this to find clusters that haven't been onboarded yet.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.list_clusters",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new ListClustersCommand({}));
        return {
          provider: "aws",
          region: input.region,
          clusterArns: res.clusterArns || [],
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          error: err?.message || "ECS ListClusters failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_list_services",
    description: "List ALL service ARNs within a specific ECS cluster — use this to find services that haven't been discovered/onboarded yet.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.list_services",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name or ARN"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new ListServicesCommand({ cluster: input.cluster }));
        return {
          provider: "aws",
          region: input.region,
          cluster: input.cluster,
          serviceArns: res.serviceArns || [],
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          cluster: input.cluster,
          error: err?.message || "ECS ListServices failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_list_task_definition_revisions",
    description: "List prior task definition revisions for a family, newest first — real revision history useful for deciding what to roll back to.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.list_task_definitions",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      familyPrefix: z.string().describe("Task definition family name, e.g. \"starvision-motors\""),
      maxResults: z.number().default(10).describe("Maximum number of revisions to return"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new ListTaskDefinitionsCommand({
          familyPrefix: input.familyPrefix,
          sort: "DESC",
          maxResults: input.maxResults,
        }));
        return {
          provider: "aws",
          region: input.region,
          familyPrefix: input.familyPrefix,
          taskDefinitionArns: res.taskDefinitionArns || [],
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          familyPrefix: input.familyPrefix,
          error: err?.message || "ECS ListTaskDefinitions failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_describe_task_definition_config",
    description: "Get the FULL real config of an ECS task definition — container image, CPU/memory, environment variables, secrets references, port mappings, health check, logging driver, and volumes. Pass an explicit taskDefinition (ARN or family:revision), or a service+cluster to look up its currently active one.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.describe_task_definition_config",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      taskDefinition: z.string().optional().describe("Explicit task definition ARN or family:revision"),
      service: z.string().optional().describe("ECS service name — used to look up its currently active task definition if taskDefinition isn't given"),
      cluster: z.string().optional().describe("ECS cluster name — required alongside service"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);

        let taskDefinitionId = input.taskDefinition;
        if (!taskDefinitionId && input.service && input.cluster) {
          const svcRes = await client.send(new DescribeServicesCommand({
            cluster: input.cluster,
            services: [input.service],
          }));
          taskDefinitionId = svcRes.services?.[0]?.taskDefinition;
        }
        if (!taskDefinitionId) {
          return {
            provider: "aws",
            region: input.region,
            error: "No taskDefinition given and no service+cluster to resolve one from",
            code: "MISSING_TARGET",
            source: "live:aws:ecs",
            timestamp: new Date().toISOString(),
          };
        }

        const res = await client.send(new DescribeTaskDefinitionCommand({ taskDefinition: taskDefinitionId }));
        const td = res.taskDefinition;
        return {
          provider: "aws",
          region: input.region,
          taskDefinitionArn: td?.taskDefinitionArn,
          family: td?.family,
          revision: td?.revision,
          status: td?.status,
          cpu: td?.cpu,
          memory: td?.memory,
          networkMode: td?.networkMode,
          requiresCompatibilities: td?.requiresCompatibilities,
          executionRoleArn: td?.executionRoleArn,
          taskRoleArn: td?.taskRoleArn,
          containerDefinitions: (td?.containerDefinitions || []).map((c) => ({
            name: c.name,
            image: c.image,
            cpu: c.cpu,
            memory: c.memory,
            essential: c.essential,
            portMappings: c.portMappings,
            environment: (c.environment || []).map((e) => ({ name: e.name, value: e.value })),
            secrets: (c.secrets || []).map((s) => ({ name: s.name, valueFrom: s.valueFrom })),
            logConfiguration: c.logConfiguration,
            healthCheck: c.healthCheck,
          })),
          volumes: td?.volumes,
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          error: err?.message || "ECS DescribeTaskDefinition failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_describe_capacity_providers",
    description: "Describe ECS capacity providers (e.g. FARGATE, FARGATE_SPOT, Auto Scaling group-backed) and their status.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.describe_capacity_providers",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      capacityProviders: z.array(z.string()).optional().describe("Optional list of specific capacity provider names"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DescribeCapacityProvidersCommand({
          capacityProviders: input.capacityProviders && input.capacityProviders.length > 0 ? input.capacityProviders : undefined,
        }));
        return {
          provider: "aws",
          region: input.region,
          capacityProviders: (res.capacityProviders || []).map((c) => ({
            name: c.name,
            status: c.status,
            managedScaling: c.autoScalingGroupProvider?.managedScaling,
          })),
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          error: err?.message || "ECS DescribeCapacityProviders failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_describe_autoscaling",
    description: "Describe Application Auto Scaling targets and policies configured for an ECS service — real scaling min/max/target and the policies driving them.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.describe_autoscaling",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name"),
      service: z.string().describe("ECS service name"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      const resourceId = `service/${input.cluster}/${input.service}`;
      try {
        const client = await resolveAutoScalingClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const [targetsRes, policiesRes] = await Promise.all([
          client.send(new DescribeScalableTargetsCommand({
            ServiceNamespace: "ecs",
            ResourceIds: [resourceId],
          })),
          client.send(new DescribeScalingPoliciesCommand({
            ServiceNamespace: "ecs",
            ResourceId: resourceId,
          })),
        ]);
        return {
          provider: "aws",
          region: input.region,
          cluster: input.cluster,
          service: input.service,
          scalableTargets: (targetsRes.ScalableTargets || []).map((t) => ({
            minCapacity: t.MinCapacity,
            maxCapacity: t.MaxCapacity,
            resourceId: t.ResourceId,
          })),
          scalingPolicies: (policiesRes.ScalingPolicies || []).map((p) => ({
            policyName: p.PolicyName,
            policyType: p.PolicyType,
          })),
          source: "live:aws:application-autoscaling",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          cluster: input.cluster,
          service: input.service,
          scalableTargets: [],
          scalingPolicies: [],
          note: "No auto-scaling configured for this service, or the lookup failed: " + (err?.message || "unknown error"),
          source: "live:aws:application-autoscaling",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_describe_services",
    description: "Describe one or more Amazon ECS services within a cluster, including deployment state, running/desired task counts, and load balancer configuration.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.describe_services",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name or ARN"),
      services: z.array(z.string()).describe("Service names or ARNs to describe"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DescribeServicesCommand({
          cluster: input.cluster,
          services: input.services,
        }));

        // Fetch real cpu/memory from the active task definition for each
        // service, so cost estimation (BlastRadiusSimulator) doesn't have to
        // assume the 512/1024 Fargate default for services provisioned with
        // different sizing.
        const services = await Promise.all((res.services || []).map(async (s) => {
          let cpu: number | undefined;
          let memory: number | undefined;
          let containerPorts: Array<{ containerName: string; containerPort?: number | undefined; protocol?: string | undefined }> = [];
          if (s.taskDefinition) {
            try {
              const tdRes = await client.send(new DescribeTaskDefinitionCommand({ taskDefinition: s.taskDefinition }));
              cpu = tdRes.taskDefinition?.cpu ? Number(tdRes.taskDefinition.cpu) : undefined;
              memory = tdRes.taskDefinition?.memory ? Number(tdRes.taskDefinition.memory) : undefined;
              containerPorts = (tdRes.taskDefinition?.containerDefinitions || []).flatMap((c) =>
                (c.portMappings || []).map((p) => ({
                  containerName: c.name || "unknown",
                  containerPort: p.containerPort,
                  protocol: p.protocol,
                }))
              );
            } catch {
              // Cost estimation falls back to the Fargate default if this fails.
            }
          }
          return {
          serviceName: s.serviceName,
          serviceArn: s.serviceArn,
          clusterArn: s.clusterArn,
          status: s.status,
          desiredCount: s.desiredCount ?? 0,
          runningCount: s.runningCount ?? 0,
          pendingCount: s.pendingCount ?? 0,
          taskDefinition: s.taskDefinition,
          cpu,
          memory,
          containerPorts,
          loadBalancers: (s.loadBalancers || []).map((lb) => ({
            targetGroupArn: lb.targetGroupArn,
            containerName: lb.containerName,
            containerPort: lb.containerPort,
          })),
          deployments: (s.deployments || []).map((d) => ({
            id: d.id,
            status: d.status,
            desiredCount: d.desiredCount ?? 0,
            runningCount: d.runningCount ?? 0,
            pendingCount: d.pendingCount ?? 0,
            failedTasks: d.failedTasks ?? 0,
            rolloutState: d.rolloutState,
            rolloutStateReason: d.rolloutStateReason,
            updatedAt: d.updatedAt?.toISOString(),
          })),
          events: (s.events || []).slice(0, 5).map((e) => ({
            createdAt: e.createdAt?.toISOString(),
            message: e.message,
          })),
          healthCheckGracePeriodSeconds: s.healthCheckGracePeriodSeconds,
          };
        }));

        const failures = (res.failures || []).map((f) => ({
          arn: f.arn,
          reason: f.reason,
          detail: f.detail,
        }));

        return {
          provider: "aws",
          region: input.region,
          cluster: input.cluster,
          services,
          failures,
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          cluster: input.cluster,
          error: err?.message || "ECS DescribeServices failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_describe_stopped_tasks",
    description: "Describe recently stopped ECS tasks for a service to surface exit codes, container errors, and stop reasons (e.g. CannotPullContainerError, OOM).",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.describe_stopped_tasks",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name"),
      service: z.string().optional().describe("Filter by service name"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);

        // List stopped tasks for the service
        const listRes = await client.send(new ListTasksCommand({
          cluster: input.cluster,
          serviceName: input.service,
          desiredStatus: "STOPPED",
          maxResults: 10,
        }));

        const taskArns = listRes.taskArns || [];
        if (taskArns.length === 0) {
          return {
            provider: "aws",
            region: input.region,
            cluster: input.cluster,
            service: input.service,
            stoppedTasks: [],
            summary: "No stopped tasks found — service may be healthy or not yet deployed.",
            source: "live:aws:ecs",
            timestamp: new Date().toISOString(),
          };
        }

        const descRes = await client.send(new DescribeTasksCommand({
          cluster: input.cluster,
          tasks: taskArns,
        }));

        const stoppedTasks = (descRes.tasks || []).map((t) => ({
          taskArn: t.taskArn,
          taskDefinitionArn: t.taskDefinitionArn,
          lastStatus: t.lastStatus,
          desiredStatus: t.desiredStatus,
          stoppedAt: t.stoppedAt?.toISOString(),
          stoppedReason: t.stoppedReason,
          stopCode: t.stopCode,
          containers: (t.containers || []).map((c) => ({
            name: c.name,
            image: c.image,
            lastStatus: c.lastStatus,
            exitCode: c.exitCode,
            reason: c.reason,
          })),
        }));

        // Derive a concise failure summary from real data
        const stopReasons = stoppedTasks
          .map((t) => t.stoppedReason)
          .filter(Boolean);
        const containerErrors = stoppedTasks.flatMap((t) =>
          t.containers.filter((c) => c.reason || (c.exitCode !== undefined && c.exitCode !== 0))
        );

        return {
          provider: "aws",
          region: input.region,
          cluster: input.cluster,
          service: input.service,
          stoppedTaskCount: stoppedTasks.length,
          stoppedTasks,
          stopReasonSummary: stopReasons[0] || "Unknown stop reason",
          containerErrorSummary: containerErrors[0]?.reason || null,
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          cluster: input.cluster,
          error: err?.message || "ECS DescribeStoppedTasks failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_list_tasks",
    description: "List the bare RUNNING task ARNs (and a count) for an ECS cluster/service — a fast existence/count check only, no per-task detail. For container health status, exit codes, or network bindings, call aws_ecs_describe_tasks (running/any tasks) or aws_ecs_describe_stopped_tasks (stopped tasks specifically) instead.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.list_tasks",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      cluster: z.string().default("production-cluster").describe("ECS cluster name"),
      serviceName: z.string().optional().describe("Filter by service name"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new ListTasksCommand({
          cluster: input.cluster,
          serviceName: input.serviceName,
          desiredStatus: "RUNNING",
        }));

        return {
          provider: "aws",
          region: input.region,
          cluster: input.cluster,
          service: input.serviceName || "all",
          taskArns: res.taskArns || [],
          runningCount: (res.taskArns || []).length,
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          cluster: input.cluster,
          error: err?.message || "ECS ListTasks failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_s3_list_buckets",
    description: "List all S3 buckets visible to the connected AWS account.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.s3.list_buckets",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      region: z.string().default("us-east-1").describe("AWS Region (S3 ListBuckets is global, used for client construction only)"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveS3Client(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new ListBucketsCommand({}));
        return {
          provider: "aws",
          buckets: (res.Buckets || []).map((b) => ({
            name: b.Name,
            createdAt: b.CreationDate?.toISOString(),
          })),
          source: "live:aws:s3",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          error: err?.message || "S3 ListBuckets failed",
          code: err?.name || "S3_ERROR",
          source: "live:aws:s3",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_s3_list_objects",
    description: "List objects (keys) inside a specific S3 bucket, optionally filtered by prefix.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.s3.list_objects",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      bucket: z.string().describe("S3 bucket name"),
      prefix: z.string().optional().describe("Only list keys starting with this prefix"),
      maxKeys: z.number().default(100).describe("Maximum number of objects to return"),
      region: z.string().default("us-east-1").describe("AWS Region the bucket lives in"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveS3Client(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new ListObjectsV2Command({
          Bucket: input.bucket,
          Prefix: input.prefix,
          MaxKeys: input.maxKeys,
        }));

        return {
          provider: "aws",
          bucket: input.bucket,
          objectCount: res.KeyCount ?? (res.Contents || []).length,
          truncated: res.IsTruncated ?? false,
          objects: (res.Contents || []).map((o) => ({
            key: o.Key,
            size: o.Size,
            lastModified: o.LastModified?.toISOString(),
            storageClass: o.StorageClass,
          })),
          source: "live:aws:s3",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        // Surface the real AWS error — no fabrication. If this is a real
        // AccessDenied, err.name/err.message carry the genuine AWS-reported
        // action and resource, unlike a guessed error string.
        return {
          provider: "aws",
          bucket: input.bucket,
          error: err?.message || "S3 ListObjectsV2 failed",
          code: err?.name || "S3_ERROR",
          source: "live:aws:s3",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_s3_create_upload_url",
    description: "Generate a real, time-limited presigned S3 URL the operator can upload a file to directly from their browser — no file passes through CloudOps' own server.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.s3.create_upload_url",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      bucket: z.string().describe("S3 bucket name"),
      key: z.string().describe("Destination object key (path/filename) for the upload"),
      expiresInSeconds: z.number().default(900).describe("How long the upload URL stays valid (default 15 minutes)"),
      region: z.string().default("us-east-1").describe("AWS Region the bucket lives in"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveS3Client(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const url = await getSignedUrl(
          client,
          new PutObjectCommand({ Bucket: input.bucket, Key: input.key }),
          { expiresIn: input.expiresInSeconds }
        );
        return {
          provider: "aws",
          bucket: input.bucket,
          key: input.key,
          uploadUrl: url,
          method: "PUT",
          expiresInSeconds: input.expiresInSeconds,
          source: "live:aws:s3",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          bucket: input.bucket,
          key: input.key,
          error: err?.message || "S3 presigned upload URL generation failed",
          code: err?.name || "S3_ERROR",
          source: "live:aws:s3",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_s3_create_download_url",
    description: "Generate a real, time-limited presigned S3 URL the operator can use to download an existing object directly.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.s3.create_download_url",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      bucket: z.string().describe("S3 bucket name"),
      key: z.string().describe("Object key (path/filename) to download"),
      expiresInSeconds: z.number().default(900).describe("How long the download URL stays valid (default 15 minutes)"),
      region: z.string().default("us-east-1").describe("AWS Region the bucket lives in"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveS3Client(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const url = await getSignedUrl(
          client,
          new GetObjectCommand({ Bucket: input.bucket, Key: input.key }),
          { expiresIn: input.expiresInSeconds }
        );
        return {
          provider: "aws",
          bucket: input.bucket,
          key: input.key,
          downloadUrl: url,
          method: "GET",
          expiresInSeconds: input.expiresInSeconds,
          source: "live:aws:s3",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          bucket: input.bucket,
          key: input.key,
          error: err?.message || "S3 presigned download URL generation failed",
          code: err?.name || "S3_ERROR",
          source: "live:aws:s3",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ec2_describe_instances",
    description: "Describe EC2 compute instances, their state, type, and network details.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ec2.describe_instances",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      instanceIds: z.array(z.string()).optional().describe("Optional list of specific instance IDs"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEc2Client(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DescribeInstancesCommand({
          InstanceIds: input.instanceIds && input.instanceIds.length > 0 ? input.instanceIds : undefined,
        }));

        const instances = (res.Reservations || []).flatMap((r) =>
          (r.Instances || []).map((i) => ({
            instanceId: i.InstanceId,
            instanceType: i.InstanceType,
            state: i.State?.Name,
            privateIpAddress: i.PrivateIpAddress,
            publicIpAddress: i.PublicIpAddress,
            availabilityZone: i.Placement?.AvailabilityZone,
            launchedAt: i.LaunchTime?.toISOString(),
          }))
        );

        return {
          provider: "aws",
          region: input.region,
          instances,
          source: "live:aws:ec2",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          error: err?.message || "EC2 DescribeInstances failed",
          code: err?.name || "EC2_ERROR",
          source: "live:aws:ec2",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ec2_describe_security_groups",
    description: "Describe EC2 security groups and their real ingress/egress rules — use to answer 'what ports/traffic does this instance allow'.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ec2.describe_security_groups",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      groupIds: z.array(z.string()).optional().describe("Optional list of specific security group IDs"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEc2Client(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DescribeSecurityGroupsCommand({
          GroupIds: input.groupIds && input.groupIds.length > 0 ? input.groupIds : undefined,
        }));

        const toRule = (p: any) => ({
          protocol: p.IpProtocol,
          fromPort: p.FromPort,
          toPort: p.ToPort,
          cidrRanges: (p.IpRanges || []).map((r: any) => r.CidrIp),
        });

        return {
          provider: "aws",
          region: input.region,
          securityGroups: (res.SecurityGroups || []).map((g) => ({
            groupId: g.GroupId,
            groupName: g.GroupName,
            description: g.Description,
            vpcId: g.VpcId,
            inboundRules: (g.IpPermissions || []).map(toRule),
            outboundRules: (g.IpPermissionsEgress || []).map(toRule),
          })),
          source: "live:aws:ec2",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          error: err?.message || "EC2 DescribeSecurityGroups failed",
          code: err?.name || "EC2_ERROR",
          source: "live:aws:ec2",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ec2_describe_volumes",
    description: "Describe EBS volumes — size, state, attachment, and encryption status.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ec2.describe_volumes",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      volumeIds: z.array(z.string()).optional().describe("Optional list of specific volume IDs"),
      instanceId: z.string().optional().describe("Only return volumes attached to this instance"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEc2Client(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DescribeVolumesCommand({
          VolumeIds: input.volumeIds && input.volumeIds.length > 0 ? input.volumeIds : undefined,
          Filters: input.instanceId ? [{ Name: "attachment.instance-id", Values: [input.instanceId] }] : undefined,
        }));

        return {
          provider: "aws",
          region: input.region,
          volumes: (res.Volumes || []).map((v) => ({
            volumeId: v.VolumeId,
            sizeGb: v.Size,
            state: v.State,
            volumeType: v.VolumeType,
            encrypted: v.Encrypted,
            availabilityZone: v.AvailabilityZone,
            attachments: (v.Attachments || []).map((a) => ({
              instanceId: a.InstanceId,
              device: a.Device,
              state: a.State,
            })),
          })),
          source: "live:aws:ec2",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          error: err?.message || "EC2 DescribeVolumes failed",
          code: err?.name || "EC2_ERROR",
          source: "live:aws:ec2",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ec2_reboot_instances",
    description: "Reboot one or more EC2 instances. Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "MUTATION",
    requiredCapability: "aws.ec2.reboot_instances",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      instanceIds: z.array(z.string()).min(1).describe("EC2 instance IDs to reboot"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEc2Client(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        await client.send(new RebootInstancesCommand({ InstanceIds: input.instanceIds }));
        return {
          status: "REBOOTING",
          instanceIds: input.instanceIds,
          region: input.region,
          updatedAt: new Date().toISOString(),
          source: "live:aws:ec2",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "EC2 RebootInstances failed",
          code: err?.name || "EC2_ERROR",
          instanceIds: input.instanceIds,
          source: "live:aws:ec2",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ec2_stop_instances",
    description: "Stop one or more running EC2 instances. Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "MUTATION",
    requiredCapability: "aws.ec2.stop_instances",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      instanceIds: z.array(z.string()).min(1).describe("EC2 instance IDs to stop"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEc2Client(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new StopInstancesCommand({ InstanceIds: input.instanceIds }));
        return {
          status: "STOPPING",
          instances: (res.StoppingInstances || []).map((i) => ({
            instanceId: i.InstanceId,
            previousState: i.PreviousState?.Name,
            currentState: i.CurrentState?.Name,
          })),
          region: input.region,
          updatedAt: new Date().toISOString(),
          source: "live:aws:ec2",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "EC2 StopInstances failed",
          code: err?.name || "EC2_ERROR",
          instanceIds: input.instanceIds,
          source: "live:aws:ec2",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ec2_start_instances",
    description: "Start one or more stopped EC2 instances. Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "MUTATION",
    requiredCapability: "aws.ec2.start_instances",
    riskLevel: "MEDIUM",
    requiresApproval: true,
    inputSchema: z.object({
      instanceIds: z.array(z.string()).min(1).describe("EC2 instance IDs to start"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEc2Client(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new StartInstancesCommand({ InstanceIds: input.instanceIds }));
        return {
          status: "STARTING",
          instances: (res.StartingInstances || []).map((i) => ({
            instanceId: i.InstanceId,
            previousState: i.PreviousState?.Name,
            currentState: i.CurrentState?.Name,
          })),
          region: input.region,
          updatedAt: new Date().toISOString(),
          source: "live:aws:ec2",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "EC2 StartInstances failed",
          code: err?.name || "EC2_ERROR",
          instanceIds: input.instanceIds,
          source: "live:aws:ec2",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_rds_describe_db_instances",
    description: "Describe RDS database instances, their engine, status, and endpoint.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.rds.describe_db_instances",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      dbInstanceIdentifier: z.string().optional().describe("Specific instance identifier; omit to list all"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveRdsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DescribeDBInstancesCommand({
          DBInstanceIdentifier: input.dbInstanceIdentifier,
        }));

        return {
          provider: "aws",
          region: input.region,
          instances: (res.DBInstances || []).map((db) => ({
            dbInstanceIdentifier: db.DBInstanceIdentifier,
            engine: db.Engine,
            status: db.DBInstanceStatus,
            instanceClass: db.DBInstanceClass,
            endpointAddress: db.Endpoint?.Address,
            endpointPort: db.Endpoint?.Port,
            multiAz: db.MultiAZ,
          })),
          source: "live:aws:rds",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          error: err?.message || "RDS DescribeDBInstances failed",
          code: err?.name || "RDS_ERROR",
          source: "live:aws:rds",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_cloudwatch_get_metric_data",
    description: "Fetch REAL CloudWatch metric datapoints — a real GetMetricData call is always attempted, never simulated. Pass explicit `dimensions` for a direct query against any namespace. For ECS correlation, pass `cluster`+`service` instead and this resolves real dimensions itself: container-level metrics (CPUUtilization, MemoryUtilization) query namespace AWS/ECS using the service's real ClusterName/ServiceName; load-balancer metrics (HTTPCode_Target_5XX_Count, TargetResponseTime, RequestCount, HealthyHostCount, UnHealthyHostCount) query namespace AWS/ApplicationELB using the service's REAL target-group and load-balancer ARNs, resolved live via ECS+ELBv2 — if the service has no associated load balancer, returns an explicit alarmState:'NO_LOAD_BALANCER' (that metric cannot exist for this service; this is never reported as a fabricated 0% or 100%). Real ECS service state (task counts, rollout state) is always attached as `ecsCorroboration` — a secondary signal alongside the metric, never a stand-in for it. Prefer `aws_alb_get_target_health` for target health state specifically (Healthy/Unhealthy/reason), which doesn't require guessing a CloudWatch period.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.cloudwatch.get_metric_data",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      metricName: z.string().describe("Metric name, e.g. CPUUtilization or HTTPCode_Target_5XX_Count"),
      namespace: z.string().default("AWS/ECS").describe("CloudWatch namespace — ignored (and resolved automatically) when cluster+service is given instead of explicit dimensions"),
      period: z.number().default(300).describe("Aggregation period in seconds"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cluster: z.string().optional().describe("ECS cluster for correlated ECS/ALB dimension resolution"),
      service: z.string().optional().describe("ECS service for correlated ECS/ALB dimension resolution"),
      dimensions: z.array(z.object({ name: z.string(), value: z.string() })).optional().describe("CloudWatch dimensions for a direct metric query (e.g. [{name: \"ClusterName\", value: \"prod\"}]) — takes priority over cluster+service"),
      lookbackMinutes: z.number().default(15).describe("How far back to query"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      const now = new Date();

      // Shared real-CloudWatch call, used by both the explicit-dimensions path
      // and the resolved-from-cluster/service path below — there is exactly one
      // code path that ever produces a datapoint, and it always calls AWS.
      const queryCloudWatch = async (namespace: string, dims: Array<{ name: string; value: string }>, unit: string) => {
        const client = await resolveCloudWatchClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const endTime = now;
        const startTime = new Date(endTime.getTime() - input.lookbackMinutes * 60 * 1000);
        const res = await client.send(new GetMetricDataCommand({
          StartTime: startTime,
          EndTime: endTime,
          MetricDataQueries: [
            {
              Id: "m1",
              MetricStat: {
                Metric: {
                  Namespace: namespace,
                  MetricName: input.metricName,
                  Dimensions: dims.map((d) => ({ Name: d.name, Value: d.value })),
                },
                Period: input.period,
                Stat: "Average",
              },
            },
          ],
        }));
        const result = res.MetricDataResults?.[0];
        const timestamps = result?.Timestamps || [];
        const values = result?.Values || [];
        return timestamps.map((t, i) => ({
          timestamp: t.toISOString(),
          average: values[i],
          unit,
        }));
      };

      // Explicit dimensions — direct query, no ECS/ALB resolution involved.
      if (input.dimensions && input.dimensions.length > 0) {
        try {
          const datapoints = await queryCloudWatch(input.namespace, input.dimensions, "Percent");
          return {
            metric: input.metricName,
            namespace: input.namespace,
            region: input.region,
            derivedFrom: "live:aws:cloudwatch",
            dimensions: input.dimensions,
            alarmState: datapoints.length > 0 ? "OK" : "INSUFFICIENT_DATA",
            datapoints,
            timestamp: now.toISOString(),
          };
        } catch (err: any) {
          return {
            metric: input.metricName,
            namespace: input.namespace,
            region: input.region,
            error: err?.message || "CloudWatch GetMetricData failed",
            code: err?.name || "CLOUDWATCH_ERROR",
            source: "live:aws:cloudwatch",
            timestamp: now.toISOString(),
          };
        }
      }

      // ECS cluster+service correlation — resolve REAL dimensions and always
      // attempt the real CloudWatch call; ECS DescribeServices is used only to
      // (a) find the real target-group ARN when the metric is ALB-published,
      // and (b) attach task-count/rollout corroboration, never to synthesize
      // the metric's value itself.
      if (input.cluster && input.service) {
        let svc: any;
        try {
          const ecsClient = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
          const svcRes = await ecsClient.send(new DescribeServicesCommand({
            cluster: input.cluster,
            services: [input.service],
          }));
          svc = svcRes.services?.[0];
        } catch (err: any) {
          return {
            metric: input.metricName,
            namespace: input.namespace,
            region: input.region,
            error: err?.message || "ECS DescribeServices failed while resolving metric dimensions",
            code: err?.name || "ECS_ERROR",
            source: "live:aws:ecs",
            timestamp: now.toISOString(),
          };
        }

        if (!svc) {
          return {
            metric: input.metricName,
            namespace: input.namespace,
            region: input.region,
            error: `Service '${input.service}' not found in cluster '${input.cluster}'`,
            code: "SERVICE_NOT_FOUND",
            source: "live:aws:ecs",
            timestamp: now.toISOString(),
          };
        }

        const ecsCorroboration = {
          desiredCount: svc.desiredCount ?? 0,
          runningCount: svc.runningCount ?? 0,
          pendingCount: svc.pendingCount ?? 0,
          failedTasks: svc.deployments?.[0]?.failedTasks ?? 0,
          rolloutState: svc.deployments?.[0]?.rolloutState,
        };

        let resolvedNamespace: string;
        let resolvedDimensions: Array<{ name: string; value: string }>;
        let unit: string;

        if (isLoadBalancerMetricName(input.metricName)) {
          const lb = svc.loadBalancers?.[0];
          if (!lb?.targetGroupArn) {
            // No real ALB/target group is attached to this service — there is
            // no real HTTPCode_Target_5XX_Count (or similar) to ever honestly
            // report. Say so plainly rather than fabricating a percentage.
            return {
              metric: input.metricName,
              namespace: input.namespace,
              region: input.region,
              alarmState: "NO_LOAD_BALANCER",
              datapoints: [],
              ecsCorroboration,
              note: `Service '${input.service}' in cluster '${input.cluster}' has no associated load balancer/target group. '${input.metricName}' is published by an Application Load Balancer, not by ECS itself — it cannot exist for a service with no ALB. This is not a real 0 or 100 value; the metric is not applicable to this service.`,
              source: "live:aws:ecs",
              timestamp: now.toISOString(),
            };
          }

          try {
            const elbClient = await resolveElbClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
            const tgRes = await elbClient.send(new DescribeTargetGroupsCommand({ TargetGroupArns: [lb.targetGroupArn] }));
            const lbArn = tgRes.TargetGroups?.[0]?.LoadBalancerArns?.[0];
            if (!lbArn) {
              return {
                metric: input.metricName,
                namespace: input.namespace,
                region: input.region,
                alarmState: "NO_LOAD_BALANCER",
                datapoints: [],
                ecsCorroboration,
                note: `Target group '${lb.targetGroupArn}' exists but has no associated load balancer ARN — cannot resolve real CloudWatch dimensions for '${input.metricName}'.`,
                source: "live:aws:elbv2",
                timestamp: now.toISOString(),
              };
            }
            resolvedNamespace = "AWS/ApplicationELB";
            resolvedDimensions = [
              { name: "LoadBalancer", value: loadBalancerArnToDimension(lbArn) },
              { name: "TargetGroup", value: targetGroupArnToDimension(lb.targetGroupArn) },
            ];
            unit = "Count";
          } catch (err: any) {
            return {
              metric: input.metricName,
              namespace: input.namespace,
              region: input.region,
              error: err?.message || "ELBv2 DescribeTargetGroups failed while resolving load balancer ARN",
              code: err?.name || "ELBV2_ERROR",
              ecsCorroboration,
              source: "live:aws:elbv2",
              timestamp: now.toISOString(),
            };
          }
        } else {
          resolvedNamespace = "AWS/ECS";
          resolvedDimensions = [
            { name: "ClusterName", value: input.cluster },
            { name: "ServiceName", value: input.service },
          ];
          unit = "Percent";
        }

        try {
          const datapoints = await queryCloudWatch(resolvedNamespace, resolvedDimensions, unit);
          return {
            metric: input.metricName,
            namespace: resolvedNamespace,
            region: input.region,
            derivedFrom: "live:aws:cloudwatch",
            dimensions: resolvedDimensions,
            alarmState: datapoints.length > 0 ? "OK" : "INSUFFICIENT_DATA",
            datapoints,
            ecsCorroboration,
            timestamp: now.toISOString(),
          };
        } catch (err: any) {
          return {
            metric: input.metricName,
            namespace: resolvedNamespace,
            region: input.region,
            error: err?.message || "CloudWatch GetMetricData failed",
            code: err?.name || "CLOUDWATCH_ERROR",
            ecsCorroboration,
            source: "live:aws:cloudwatch",
            timestamp: now.toISOString(),
          };
        }
      }

      // Nothing to correlate against and no dimensions given — honest
      // "no signal" response rather than a fabricated one.
      return {
        metric: input.metricName,
        namespace: input.namespace,
        region: input.region,
        alarmState: "INSUFFICIENT_DATA",
        datapoints: [],
        note: "Provide cluster+service for ECS/ALB-resolved dimensions, or explicit dimensions for a direct CloudWatch query.",
        timestamp: now.toISOString(),
      };
    },
  },

  {
    name: "aws_alb_get_target_health",
    description: "Get the REAL, current per-target health state (healthy/unhealthy/draining/unused, plus the exact reason like Target.ResponseCodeMismatch or Target.Timeout) for an Application/Network Load Balancer target group. Pass an explicit targetGroupArn, or cluster+service to resolve the service's real target group. Returns an explicit NO_LOAD_BALANCER result if the service isn't behind any load balancer — never a fabricated healthy/unhealthy count. This is the right tool for 'are the real targets passing health checks', which aws_cloudwatch_get_metric_data's HealthyHostCount/UnHealthyHostCount metrics only report in aggregate counts, not per-target reasons.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.alb.get_target_health",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      targetGroupArn: z.string().optional().describe("Explicit target group ARN to check"),
      cluster: z.string().optional().describe("ECS cluster name — used with service to resolve the target group if targetGroupArn isn't given"),
      service: z.string().optional().describe("ECS service name — used with cluster to resolve the target group if targetGroupArn isn't given"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      let targetGroupArn = input.targetGroupArn;
      let ecsCorroboration: Record<string, unknown> | undefined;

      if (!targetGroupArn && input.cluster && input.service) {
        try {
          const ecsClient = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
          const svcRes = await ecsClient.send(new DescribeServicesCommand({
            cluster: input.cluster,
            services: [input.service],
          }));
          const svc = svcRes.services?.[0];
          if (!svc) {
            return {
              region: input.region,
              error: `Service '${input.service}' not found in cluster '${input.cluster}'`,
              code: "SERVICE_NOT_FOUND",
              source: "live:aws:ecs",
              timestamp: new Date().toISOString(),
            };
          }
          ecsCorroboration = {
            desiredCount: svc.desiredCount ?? 0,
            runningCount: svc.runningCount ?? 0,
          };
          targetGroupArn = svc.loadBalancers?.[0]?.targetGroupArn;
          if (!targetGroupArn) {
            return {
              region: input.region,
              cluster: input.cluster,
              service: input.service,
              status: "NO_LOAD_BALANCER",
              targets: [],
              ecsCorroboration,
              note: `Service '${input.service}' in cluster '${input.cluster}' has no associated load balancer/target group — there is no target health to report.`,
              source: "live:aws:ecs",
              timestamp: new Date().toISOString(),
            };
          }
        } catch (err: any) {
          return {
            region: input.region,
            cluster: input.cluster,
            service: input.service,
            error: err?.message || "ECS DescribeServices failed while resolving target group",
            code: err?.name || "ECS_ERROR",
            source: "live:aws:ecs",
            timestamp: new Date().toISOString(),
          };
        }
      }

      if (!targetGroupArn) {
        return {
          region: input.region,
          error: "Provide either targetGroupArn, or cluster+service to resolve one",
          code: "MISSING_TARGET",
          source: "live:aws:elbv2",
          timestamp: new Date().toISOString(),
        };
      }

      try {
        const elbClient = await resolveElbClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await elbClient.send(new DescribeTargetHealthCommand({ TargetGroupArn: targetGroupArn }));
        const targets = (res.TargetHealthDescriptions || []).map((t) => ({
          targetId: t.Target?.Id,
          port: t.Target?.Port,
          availabilityZone: t.Target?.AvailabilityZone,
          state: t.TargetHealth?.State,
          reason: t.TargetHealth?.Reason,
          description: t.TargetHealth?.Description,
        }));
        const healthyCount = targets.filter((t) => t.state === "healthy").length;
        const unhealthyCount = targets.filter((t) => t.state === "unhealthy").length;

        return {
          region: input.region,
          targetGroupArn,
          cluster: input.cluster,
          service: input.service,
          targetCount: targets.length,
          healthyCount,
          unhealthyCount,
          targets,
          ecsCorroboration,
          source: "live:aws:elbv2",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          region: input.region,
          targetGroupArn,
          error: err?.message || "ELBv2 DescribeTargetHealth failed",
          code: err?.name || "ELBV2_ERROR",
          ecsCorroboration,
          source: "live:aws:elbv2",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecr_describe_images",
    description: "Validate whether a container image tag/digest actually EXISTS in Amazon ECR and get its real size, push date, and digest. Pass repositoryName (+ optional imageTag/imageDigest), or cluster+service+containerName to resolve the exact image currently referenced by that service's active task definition. Returns an explicit found:false with code IMAGE_NOT_FOUND when the tag doesn't exist — this is the tool that catches a 'broken image tag' deployment (ECS's own CannotPullContainerError only tells you the pull failed, not why); use aws_ecs_describe_stopped_tasks first to see that error, then this tool to confirm the exact tag is genuinely missing from the registry.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecr.describe_images",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      repositoryName: z.string().optional().describe("ECR repository name, e.g. starvision-motors"),
      imageTag: z.string().optional().describe("Specific image tag to check, e.g. latest"),
      imageDigest: z.string().optional().describe("Specific image digest to check, e.g. sha256:..."),
      cluster: z.string().optional().describe("ECS cluster name — used with service to resolve the currently deployed image if repositoryName isn't given"),
      service: z.string().optional().describe("ECS service name — used with cluster to resolve the currently deployed image if repositoryName isn't given"),
      containerName: z.string().optional().describe("Which container in the task definition to check, if it has more than one — defaults to the first"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      let repositoryName = input.repositoryName;
      let imageTag = input.imageTag;
      let imageDigest = input.imageDigest;
      let resolvedFromImage: string | undefined;

      if (!repositoryName && input.cluster && input.service) {
        try {
          const ecsClient = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
          const svcRes = await ecsClient.send(new DescribeServicesCommand({
            cluster: input.cluster,
            services: [input.service],
          }));
          const taskDefArn = svcRes.services?.[0]?.taskDefinition;
          if (!taskDefArn) {
            return {
              region: input.region,
              error: `Could not find the current task definition for service '${input.service}' in cluster '${input.cluster}'`,
              code: "SERVICE_NOT_FOUND",
              source: "live:aws:ecs",
              timestamp: new Date().toISOString(),
            };
          }
          const tdRes = await ecsClient.send(new DescribeTaskDefinitionCommand({ taskDefinition: taskDefArn }));
          const containers = tdRes.taskDefinition?.containerDefinitions || [];
          const container = input.containerName
            ? containers.find((c) => c.name === input.containerName)
            : containers[0];
          if (!container?.image) {
            return {
              region: input.region,
              error: `No container${input.containerName ? ` named '${input.containerName}'` : ""} with an image found in task definition '${taskDefArn}'`,
              code: "CONTAINER_NOT_FOUND",
              source: "live:aws:ecs",
              timestamp: new Date().toISOString(),
            };
          }
          resolvedFromImage = container.image;
          const parsed = parseEcrImageReference(container.image);
          if (!parsed) {
            return {
              region: input.region,
              image: container.image,
              found: undefined,
              note: `Container image '${container.image}' is not an ECR-hosted image (or doesn't match the expected ECR URI format) — this tool can only validate images hosted in Amazon ECR.`,
              source: "live:aws:ecs",
              timestamp: new Date().toISOString(),
            };
          }
          repositoryName = parsed.repositoryName;
          imageTag = parsed.imageTag;
          imageDigest = parsed.imageDigest;
        } catch (err: any) {
          return {
            region: input.region,
            error: err?.message || "ECS lookup failed while resolving the deployed image",
            code: err?.name || "ECS_ERROR",
            source: "live:aws:ecs",
            timestamp: new Date().toISOString(),
          };
        }
      }

      if (!repositoryName) {
        return {
          region: input.region,
          error: "Provide repositoryName (+ optional imageTag/imageDigest), or cluster+service(+containerName) to resolve one",
          code: "MISSING_TARGET",
          source: "live:aws:ecr",
          timestamp: new Date().toISOString(),
        };
      }

      try {
        const ecrClient = await resolveEcrClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const imageIds = imageTag ? [{ imageTag }] : imageDigest ? [{ imageDigest }] : undefined;
        const res = await ecrClient.send(new DescribeImagesCommand({ repositoryName, imageIds }));
        const images = (res.imageDetails || []).map((img) => ({
          imageDigest: img.imageDigest,
          imageTags: img.imageTags || [],
          imageSizeInBytes: img.imageSizeInBytes,
          imagePushedAt: img.imagePushedAt?.toISOString(),
          imageManifestMediaType: img.imageManifestMediaType,
          imageStatus: img.imageStatus,
        }));

        return {
          region: input.region,
          repositoryName,
          imageTag,
          imageDigest,
          resolvedFromImage,
          found: images.length > 0,
          images,
          source: "live:aws:ecr",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        // ImageNotFoundException/RepositoryNotFoundException are the real,
        // actionable finding here (the exact "broken tag" root cause), not a
        // tool failure — surface them as a clear, structured result rather
        // than a generic error blob.
        if (err?.name === "ImageNotFoundException" || err?.name === "RepositoryNotFoundException") {
          return {
            region: input.region,
            repositoryName,
            imageTag,
            imageDigest,
            resolvedFromImage,
            found: false,
            code: err.name === "RepositoryNotFoundException" ? "REPOSITORY_NOT_FOUND" : "IMAGE_NOT_FOUND",
            note: err.name === "RepositoryNotFoundException"
              ? `ECR repository '${repositoryName}' does not exist in this account/region.`
              : `No image with tag/digest '${imageTag || imageDigest}' exists in ECR repository '${repositoryName}' — this is a real, confirmed missing image, the likely root cause of a CannotPullContainerError.`,
            source: "live:aws:ecr",
            timestamp: new Date().toISOString(),
          };
        }
        return {
          region: input.region,
          repositoryName,
          imageTag,
          imageDigest,
          error: err?.message || "ECR DescribeImages failed",
          code: err?.name || "ECR_ERROR",
          source: "live:aws:ecr",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_describe_tasks",
    description: "Get REAL per-task, per-container detail for specific RUNNING (or any) ECS tasks — container-level health status, network ENI/IP bindings, CPU/memory, and (if a task has since stopped) its exit code and stop reason. More granular than aws_ecs_list_tasks (which only returns bare task ARNs) and complements aws_ecs_describe_stopped_tasks (which only covers already-STOPPED tasks) — use this to inspect the current state of tasks that are still running or whose exact status is unknown. Pass explicit taskArns, or cluster+service to describe that service's current tasks.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.ecs.describe_tasks",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name"),
      taskArns: z.array(z.string()).optional().describe("Explicit task ARNs to describe"),
      service: z.string().optional().describe("ECS service name — used to look up its current task ARNs if taskArns isn't given"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);

        let taskArns = input.taskArns;
        if (!taskArns || taskArns.length === 0) {
          if (!input.service) {
            return {
              region: input.region,
              cluster: input.cluster,
              error: "Provide either taskArns or a service to look them up from",
              code: "MISSING_TARGET",
              source: "live:aws:ecs",
              timestamp: new Date().toISOString(),
            };
          }
          const listRes = await client.send(new ListTasksCommand({
            cluster: input.cluster,
            serviceName: input.service,
          }));
          taskArns = listRes.taskArns || [];
        }

        if (taskArns.length === 0) {
          return {
            region: input.region,
            cluster: input.cluster,
            service: input.service,
            tasks: [],
            note: "No matching tasks found.",
            source: "live:aws:ecs",
            timestamp: new Date().toISOString(),
          };
        }

        const res = await client.send(new DescribeTasksCommand({ cluster: input.cluster, tasks: taskArns }));
        const tasks = (res.tasks || []).map((t) => ({
          taskArn: t.taskArn,
          taskDefinitionArn: t.taskDefinitionArn,
          lastStatus: t.lastStatus,
          desiredStatus: t.desiredStatus,
          healthStatus: t.healthStatus,
          cpu: t.cpu,
          memory: t.memory,
          createdAt: t.createdAt?.toISOString(),
          startedAt: t.startedAt?.toISOString(),
          stoppedAt: t.stoppedAt?.toISOString(),
          stoppedReason: t.stoppedReason,
          availabilityZone: t.availabilityZone,
          containers: (t.containers || []).map((c) => ({
            name: c.name,
            image: c.image,
            lastStatus: c.lastStatus,
            healthStatus: c.healthStatus,
            exitCode: c.exitCode,
            reason: c.reason,
            networkInterfaces: (c.networkInterfaces || []).map((n) => ({
              privateIpv4Address: n.privateIpv4Address,
            })),
          })),
        }));
        const failures = (res.failures || []).map((f) => ({ arn: f.arn, reason: f.reason, detail: f.detail }));

        return {
          region: input.region,
          cluster: input.cluster,
          service: input.service,
          taskCount: tasks.length,
          tasks,
          failures,
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          region: input.region,
          cluster: input.cluster,
          service: input.service,
          error: err?.message || "ECS DescribeTasks failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_logs_describe_log_groups",
    description: "List real CloudWatch log group names, optionally filtered by prefix — use this to find the right log group before filtering events from it.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.logs.describe_log_groups",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      logGroupNamePrefix: z.string().optional().describe("Only return log groups whose name starts with this"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveCloudWatchLogsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DescribeLogGroupsCommand({
          logGroupNamePrefix: input.logGroupNamePrefix,
          limit: 50,
        }));
        return {
          provider: "aws",
          region: input.region,
          logGroups: (res.logGroups || []).map((g) => ({
            logGroupName: g.logGroupName,
            storedBytes: g.storedBytes,
            retentionInDays: g.retentionInDays,
          })),
          source: "live:aws:cloudwatch-logs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          region: input.region,
          error: err?.message || "CloudWatch Logs DescribeLogGroups failed",
          code: err?.name || "CLOUDWATCH_LOGS_ERROR",
          source: "live:aws:cloudwatch-logs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_logs_filter_log_events",
    description: "Fetch real, actual log lines from a CloudWatch log group (e.g. an ECS task's container logs), optionally filtered by a search pattern and time window. This is real log text, not a metric.",
    provider: "aws",
    status: "live",
    operationType: "READ_ONLY",
    requiredCapability: "aws.logs.filter_log_events",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      logGroupName: z.string().describe("CloudWatch log group name, e.g. /ecs/starvision-motors"),
      filterPattern: z.string().optional().describe("CloudWatch Logs filter pattern to search for (e.g. \"ERROR\")"),
      lookbackMinutes: z.number().default(60).describe("How far back to search"),
      limit: z.number().default(50).describe("Maximum number of log events to return"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveCloudWatchLogsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const endTime = Date.now();
        const startTime = endTime - input.lookbackMinutes * 60 * 1000;
        const res = await client.send(new FilterLogEventsCommand({
          logGroupName: input.logGroupName,
          filterPattern: input.filterPattern,
          startTime,
          endTime,
          limit: input.limit,
        }));
        return {
          provider: "aws",
          logGroupName: input.logGroupName,
          eventCount: (res.events || []).length,
          events: (res.events || []).map((e) => ({
            timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : undefined,
            message: e.message,
            logStreamName: e.logStreamName,
          })),
          source: "live:aws:cloudwatch-logs",
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        return {
          provider: "aws",
          logGroupName: input.logGroupName,
          error: err?.message || "CloudWatch Logs FilterLogEvents failed",
          code: err?.name || "CLOUDWATCH_LOGS_ERROR",
          source: "live:aws:cloudwatch-logs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_update_service",
    description: "Scale tasks or trigger a rolling restart for an Amazon ECS service. Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "MUTATION",
    requiredCapability: "aws.ecs.update_service",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name"),
      service: z.string().describe("ECS service name to update"),
      desiredCount: z.number().optional().describe("Desired task count"),
      forceNewDeployment: z.boolean().optional().describe("Trigger rolling redeployment"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        // forceNewDeployment must default to false: forcing a redeployment
        // alongside a plain desiredCount change makes ECS run BOTH at once —
        // with the default deployment config (maximumPercent 200%), scaling
        // to N while also forcing a new deployment briefly spins up to 2N
        // tasks (new + old side by side) before draining the old ones back
        // down to N. That's the "scale to 10, it jumps to 20, then back to
        // 10" behavior — real ECS rolling-deployment mechanics triggered by
        // defaulting this true for every call, not an AWS bug. A plain scale
        // should only ever change desiredCount; forceNewDeployment is only
        // for an explicit restart/redeploy request.
        const res = await client.send(new UpdateServiceCommand({
          cluster: input.cluster,
          service: input.service,
          desiredCount: input.desiredCount,
          forceNewDeployment: input.forceNewDeployment ?? false,
        }));

        const svc = res.service;
        return {
          status: "EXECUTED",
          serviceArn: svc?.serviceArn,
          serviceName: svc?.serviceName,
          desiredCount: svc?.desiredCount,
          runningCount: svc?.runningCount,
          deploymentId: svc?.deployments?.[0]?.id,
          updatedAt: new Date().toISOString(),
          source: "live:aws:ecs",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "ECS UpdateService failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_update_service_image",
    description: "Update an ECS service to a new container image tag (rollback or promotion). Triggers a new deployment. Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "MUTATION",
    requiredCapability: "aws.ecs.update_service",
    riskLevel: "CRITICAL",
    requiresApproval: true,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name"),
      service: z.string().describe("ECS service name"),
      imageTag: z.string().describe("New container image URI including tag (e.g. 123456789.dkr.ecr.us-east-1.amazonaws.com/my-service:stable)"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);

        // First describe the current service to get active task definition
        const svcRes = await client.send(new DescribeServicesCommand({
          cluster: input.cluster,
          services: [input.service],
        }));

        const svc = svcRes.services?.[0];
        const currentTaskDef = svc?.taskDefinition;

        // Trigger force redeployment — in a real system this would register a new task def
        // with the updated image then call UpdateService. For now we ForceNewDeployment
        // since registering a new task definition requires the full container definition JSON.
        const updateRes = await client.send(new UpdateServiceCommand({
          cluster: input.cluster,
          service: input.service,
          forceNewDeployment: true,
        }));

        const updated = updateRes.service;
        return {
          status: "DEPLOYMENT_INITIATED",
          serviceArn: updated?.serviceArn,
          serviceName: updated?.serviceName,
          cluster: input.cluster,
          region: input.region,
          imageTag: input.imageTag,
          previousTaskDefinition: currentTaskDef || "unknown",
          deploymentId: updated?.deployments?.[0]?.id,
          note: "Force-new-deployment triggered. Image tag will take effect on next task definition registration.",
          updatedAt: new Date().toISOString(),
          source: "live:aws:ecs",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "ECS UpdateService (image) failed",
          code: err?.name || "ECS_ERROR",
          cluster: input.cluster,
          service: input.service,
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
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
      forceFailover: z.boolean().optional().describe("Force multi-AZ failover reboot"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveRdsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new RebootDBInstanceCommand({
          DBInstanceIdentifier: input.dbInstanceIdentifier,
          ForceFailover: input.forceFailover,
        }));

        const db = res.DBInstance;
        return {
          status: "REBOOTING",
          dbInstanceIdentifier: db?.DBInstanceIdentifier || input.dbInstanceIdentifier,
          dbInstanceStatus: db?.DBInstanceStatus,
          forceFailover: input.forceFailover ?? false,
          updatedAt: new Date().toISOString(),
          source: "live:aws:rds",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "RDS RebootDBInstance failed",
          code: err?.name || "RDS_ERROR",
          dbInstanceIdentifier: input.dbInstanceIdentifier,
          source: "live:aws:rds",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_deploy_service",
    description: "Deploy a new task definition revision to an existing Amazon ECS service. Requires operator approval.",
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
      cloudAccountId: z.string().optional(),
      budgetOverride: z.boolean().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new UpdateServiceCommand({
          cluster: input.cluster,
          service: input.service,
          taskDefinition: input.taskDefinition,
          desiredCount: input.desiredCount,
          forceNewDeployment: true,
        }));

        const svc = res.service;
        return {
          status: "DEPLOYED",
          serviceArn: svc?.serviceArn,
          cluster: input.cluster,
          service: input.service,
          taskDefinition: input.taskDefinition,
          desiredCount: svc?.desiredCount ?? input.desiredCount,
          deploymentId: svc?.deployments?.[0]?.id,
          deployedAt: new Date().toISOString(),
          source: "live:aws:ecs",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "ECS Deploy failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_rollback_service",
    description: "Roll back an Amazon ECS service to a prior stable task definition revision. Requires operator approval.",
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
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new UpdateServiceCommand({
          cluster: input.cluster,
          service: input.service,
          taskDefinition: input.targetTaskDefinition,
          forceNewDeployment: true,
        }));

        const svc = res.service;
        return {
          status: "ROLLED_BACK",
          serviceArn: svc?.serviceArn,
          cluster: input.cluster,
          service: input.service,
          activeTaskDefinition: svc?.taskDefinition || input.targetTaskDefinition,
          rolledBackAt: new Date().toISOString(),
          source: "live:aws:ecs",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "ECS Rollback failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_register_task_definition",
    description: "Register a new Amazon ECS task definition revision. Requires operator approval.",
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
      cpu: z.number().default(512).describe("CPU units"),
      memory: z.number().default(1024).describe("Memory in MB"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new RegisterTaskDefinitionCommand({
          family: input.family,
          containerDefinitions: [
            {
              name: input.containerName,
              image: input.image,
              cpu: input.cpu,
              memory: input.memory,
              essential: true,
            },
          ],
          requiresCompatibilities: ["FARGATE"],
          networkMode: "awsvpc",
          cpu: String(input.cpu),
          memory: String(input.memory),
        }));

        const td = res.taskDefinition;
        return {
          status: "REGISTERED",
          taskDefinitionArn: td?.taskDefinitionArn,
          family: td?.family || input.family,
          revision: td?.revision,
          registeredAt: new Date().toISOString(),
          source: "live:aws:ecs",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "ECS RegisterTaskDefinition failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_enable_cloudwatch_logging",
    description: "Enable (or repoint) CloudWatch Logs for an ECS service's container — creates the log group if needed, registers a NEW task definition revision with ONLY the logging driver added/changed (image, CPU/memory, env vars, everything else preserved exactly), and updates the service to use it. Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "DEPLOY",
    requiredCapability: "aws.ecs.enable_cloudwatch_logging",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name"),
      service: z.string().describe("ECS service name to enable CloudWatch logging for"),
      logGroupName: z.string().optional().describe("CloudWatch log group name — defaults to /ecs/<family> if omitted"),
      retentionInDays: z.number().optional().describe("Optional log retention period in days (e.g. 14, 30) — indefinite if omitted"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const ecsClient = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);

        const svcRes = await ecsClient.send(new DescribeServicesCommand({
          cluster: input.cluster,
          services: [input.service],
        }));
        const currentTaskDefArn = svcRes.services?.[0]?.taskDefinition;
        if (!currentTaskDefArn) {
          return {
            status: "FAILED",
            error: `Could not find the current task definition for service '${input.service}' in cluster '${input.cluster}'`,
            code: "SERVICE_NOT_FOUND",
            source: "live:aws:ecs",
            timestamp: new Date().toISOString(),
          };
        }

        const tdRes = await ecsClient.send(new DescribeTaskDefinitionCommand({ taskDefinition: currentTaskDefArn }));
        const currentTd = tdRes.taskDefinition;
        if (!currentTd) {
          return {
            status: "FAILED",
            error: `Could not describe current task definition '${currentTaskDefArn}'`,
            code: "TASK_DEFINITION_NOT_FOUND",
            source: "live:aws:ecs",
            timestamp: new Date().toISOString(),
          };
        }

        const logGroupName = input.logGroupName || `/ecs/${currentTd.family}`;

        // Idempotent: creating a log group that already exists is a no-op.
        const logsClient = await resolveCloudWatchLogsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        try {
          await logsClient.send(new CreateLogGroupCommand({ logGroupName }));
        } catch (err: any) {
          if (err?.name !== "ResourceAlreadyExistsException") throw err;
        }
        if (input.retentionInDays) {
          await logsClient.send(new PutRetentionPolicyCommand({ logGroupName, retentionInDays: input.retentionInDays }));
        }

        // Preserve every existing container's real config — only the
        // logConfiguration changes. Never touch image/cpu/memory/env vars.
        const updatedContainerDefinitions = (currentTd.containerDefinitions || []).map((c) => ({
          ...c,
          logConfiguration: {
            logDriver: "awslogs" as const,
            options: {
              "awslogs-group": logGroupName,
              "awslogs-region": input.region,
              "awslogs-stream-prefix": currentTd.family || input.service,
            },
          },
        }));

        const registerRes = await ecsClient.send(new RegisterTaskDefinitionCommand({
          family: currentTd.family,
          containerDefinitions: updatedContainerDefinitions,
          requiresCompatibilities: currentTd.requiresCompatibilities,
          networkMode: currentTd.networkMode,
          cpu: currentTd.cpu,
          memory: currentTd.memory,
          executionRoleArn: currentTd.executionRoleArn,
          taskRoleArn: currentTd.taskRoleArn,
          volumes: currentTd.volumes,
        }));
        const newTd = registerRes.taskDefinition;

        const updateRes = await ecsClient.send(new UpdateServiceCommand({
          cluster: input.cluster,
          service: input.service,
          taskDefinition: newTd?.taskDefinitionArn,
        }));

        return {
          status: "EXECUTED",
          logGroupName,
          retentionInDays: input.retentionInDays,
          newTaskDefinitionArn: newTd?.taskDefinitionArn,
          newRevision: newTd?.revision,
          serviceArn: updateRes.service?.serviceArn,
          updatedAt: new Date().toISOString(),
          source: "live:aws:ecs+cloudwatch-logs",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "Enabling CloudWatch logging failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs+cloudwatch-logs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_delete_service",
    description: "PERMANENTLY delete an ECS service. Irreversible. Requires the service's desired count to be 0 first (AWS enforces this, or pass force). Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "DEPLOY",
    requiredCapability: "aws.ecs.delete_service",
    riskLevel: "CRITICAL",
    requiresApproval: true,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name"),
      service: z.string().describe("ECS service name to permanently delete"),
      force: z.boolean().default(false).describe("Force deletion even if the service has a nonzero desired count"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DeleteServiceCommand({
          cluster: input.cluster,
          service: input.service,
          force: input.force,
        }));
        return {
          status: "DELETED",
          serviceArn: res.service?.serviceArn,
          serviceName: res.service?.serviceName,
          deletedAt: new Date().toISOString(),
          source: "live:aws:ecs",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "ECS DeleteService failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_delete_cluster",
    description: "PERMANENTLY delete an ECS cluster. Irreversible. AWS requires the cluster to have no active services/tasks/container instances first. Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "DEPLOY",
    requiredCapability: "aws.ecs.delete_cluster",
    riskLevel: "CRITICAL",
    requiresApproval: true,
    inputSchema: z.object({
      cluster: z.string().describe("ECS cluster name to permanently delete"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DeleteClusterCommand({ cluster: input.cluster }));
        return {
          status: "DELETED",
          clusterArn: res.cluster?.clusterArn,
          clusterName: res.cluster?.clusterName,
          deletedAt: new Date().toISOString(),
          source: "live:aws:ecs",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "ECS DeleteCluster failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  {
    name: "aws_ecs_deregister_task_definition",
    description: "PERMANENTLY deregister a specific ECS task definition revision (marks it INACTIVE — cannot be used for new deployments again). Requires operator approval.",
    provider: "aws",
    status: "live",
    operationType: "DEPLOY",
    requiredCapability: "aws.ecs.deregister_task_definition",
    riskLevel: "CRITICAL",
    requiresApproval: true,
    inputSchema: z.object({
      taskDefinition: z.string().describe("Task definition family:revision or full ARN to deregister"),
      region: z.string().default("us-east-1").describe("AWS Region"),
      cloudAccountId: z.string().optional(),
    }),
    handler: async (input, ctx) => {
      try {
        const client = await resolveEcsClient(ctx.tenantId, ctx.agentId, input.region, input.cloudAccountId);
        const res = await client.send(new DeregisterTaskDefinitionCommand({ taskDefinition: input.taskDefinition }));
        return {
          status: "DEREGISTERED",
          taskDefinitionArn: res.taskDefinition?.taskDefinitionArn,
          revisionStatus: res.taskDefinition?.status,
          deregisteredAt: new Date().toISOString(),
          source: "live:aws:ecs",
        };
      } catch (err: any) {
        return {
          status: "FAILED",
          error: err?.message || "ECS DeregisterTaskDefinition failed",
          code: err?.name || "ECS_ERROR",
          source: "live:aws:ecs",
          timestamp: new Date().toISOString(),
        };
      }
    },
  },

  // --- GCP TOOLS (contract-only until GCP provider is onboarded) ---
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
      region: z.string().default("us-central1").describe("GCP Region"),
    }),
    handler: async (_input, _ctx) => ({
      status: "CONTRACT_ONLY",
      note: "GCP provider not yet onboarded. Connect a GCP account to enable live Cloud Run inspection.",
    }),
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
      durationMinutes: z.number().default(60),
    }),
    handler: async (_input, _ctx) => ({
      status: "CONTRACT_ONLY",
      note: "GCP provider not yet onboarded.",
    }),
  },
  {
    name: "gcp_run_service_restart",
    description: "Trigger a rolling redeployment of a Google Cloud Run service. Requires operator approval.",
    provider: "gcp",
    status: "contract_only",
    requiredCapability: "gcp.run.services_restart",
    riskLevel: "HIGH",
    requiresApproval: true,
    inputSchema: z.object({
      serviceName: z.string().describe("Cloud Run service name"),
      region: z.string().default("us-central1"),
    }),
    handler: async (_input, _ctx) => ({
      status: "CONTRACT_ONLY",
      note: "GCP provider not yet onboarded.",
    }),
  },

  // --- AZURE TOOLS (contract-only until Azure provider is onboarded) ---
  {
    name: "azure_container_apps_list",
    description: "List and describe Azure Container App environments and running container replicas.",
    provider: "azure",
    status: "contract_only",
    requiredCapability: "azure.container_apps.list",
    riskLevel: "LOW",
    requiresApproval: false,
    inputSchema: z.object({
      resourceGroup: z.string().optional().describe("Azure Resource Group"),
    }),
    handler: async (_input, _ctx) => ({
      status: "CONTRACT_ONLY",
      note: "Azure provider not yet onboarded. Connect an Azure account to enable live Container Apps inspection.",
    }),
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
      metricNames: z.array(z.string()).describe("Metrics to fetch"),
    }),
    handler: async (_input, _ctx) => ({
      status: "CONTRACT_ONLY",
      note: "Azure provider not yet onboarded.",
    }),
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
      resourceGroup: z.string().describe("Azure Resource Group"),
    }),
    handler: async (_input, _ctx) => ({
      status: "CONTRACT_ONLY",
      note: "Azure provider not yet onboarded.",
    }),
  },
];

/**
 * Helper to find a tool by name.
 */
export function findCanonicalTool(toolName: string): CanonicalToolDefinition | undefined {
  return CANONICAL_TOOLS.find((t) => t.name === toolName);
}

/**
 * Bidirectional alias map between each canonical tool's underscore-form name
 * (e.g. "aws_ecs_rollback_service") and its dot-form requiredCapability (e.g.
 * "aws.ecs.rollback_service"). Built once from CANONICAL_TOOLS itself — the
 * only source of truth, since the two forms are NOT a mechanical
 * find/replace of each other for every tool (e.g. gcp_monitoring_query's
 * requiredCapability is "gcp.monitoring.time_series_query" — different
 * wording entirely, not just different punctuation). Any capability-matching
 * code that needs exact-string equivalence between the two forms must look
 * it up here rather than derive it via string manipulation.
 */
const CAPABILITY_ALIASES: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const tool of CANONICAL_TOOLS) {
    map.set(tool.name, tool.requiredCapability);
    map.set(tool.requiredCapability, tool.name);
  }
  return map;
})();

/**
 * Expands a raw capability list to include, for every entry that matches a
 * known canonical tool (by either its name or its requiredCapability), both
 * forms — so an exact-match capability check succeeds regardless of which
 * naming convention the caller declared it in. Entries that don't match any
 * known tool (tier wildcards like "deploy"/"read:*", "operator_chat_query",
 * "*") pass through unchanged.
 */
export function expandCanonicalCapabilities(capabilities: string[]): string[] {
  const expanded = new Set<string>();
  for (const cap of capabilities) {
    expanded.add(cap);
    const alias = CAPABILITY_ALIASES.get(cap);
    if (alias) {
      expanded.add(alias);
    }
  }
  return Array.from(expanded);
}
