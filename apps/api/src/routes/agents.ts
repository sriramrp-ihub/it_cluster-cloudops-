import type { FastifyPluginAsync } from "fastify";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabase } from "@cloudops/database";
import { InviteService, JoinRequestService } from "@cloudops/onboarding";
import { AgentService } from "@cloudops/identity";
import { createAgentAdapter, extractJsonFromLlmOutput, HermesProfileService, type AgentAdapter } from "@cloudops/runtime";
import { PolicyEngine, BlastRadiusSimulator } from "@cloudops/policy";
import { TenantService } from "@cloudops/auth";
import { CloudAccountService, IncidentService, tenantMemoryService } from "@cloudops/adapters";
import { CANONICAL_TOOLS, captureSnapshotForRevert, expandCanonicalCapabilities } from "@cloudops/tools";
import { ApprovalService } from "@cloudops/approvals";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { requireOperatorAuth } from "../middleware/auth.js";
import { createChatRateLimitPreHandler, defaultChatRateLimitPreHandler } from "../middleware/rateLimit.js";
import { resolveAuthorizedCapabilities } from "../lib/resolveAuthorizedCapabilities.js";
import type { RedisRateLimiter } from "@cloudops/shared";

interface DiscoveredWorkloadRef {
  name: string;
  type: string;
  cluster?: string | undefined;
  region: string;
}

export interface ChatToolCallRecord {
  name: string;
  status: "completed" | "denied" | "failed";
  summary: string;
}

/**
 * Turns the chat model's raw output into the actual final response text.
 * Plain prose passes straight through unchanged. A "clarify" action becomes
 * the question itself (no protocol change needed on the client — it just
 * displays whatever text comes back, so the clarify/resolve loop happens
 * naturally across chat turns). A "propose_mutation" action is where the
 * real work happens: the target resource is validated against what's
 * actually connected (never trusted from the model's own claim), then run
 * through the exact same PolicyEngine.evaluate() -> BlastRadiusSimulator ->
 * captureSnapshotForRevert() -> ApprovalService.createApprovalRequest()
 * pipeline every other mutating tool call in this system goes through
 * (packages/tools/src/mcpServer.ts). Chat can describe a mutation in prose
 * all day; this is what makes "scale it to 4" actually create a real,
 * governed, human-signable approval instead of just talking about one.
 */
/** The ECS-service target a read/mutation request resolved to, matched against real discovered workloads — never trusted from the model's own claim. */
function resolveEcsServiceTarget(
  rawParameters: Record<string, unknown>,
  discoveredWorkloads: DiscoveredWorkloadRef[]
): { match: DiscoveredWorkloadRef } | { clarify: string } | { notFound: string } {
  const claimedName =
    (rawParameters.service as string) ||
    (rawParameters.serviceName as string) ||
    (Array.isArray(rawParameters.services) ? (rawParameters.services[0] as string) : undefined);

  const ecsServices = discoveredWorkloads.filter((w) => w.type === "ECS_SERVICE");

  if (claimedName) {
    const match = ecsServices.find((w) => w.name === claimedName);
    if (match) return { match };
    return {
      clarify: ecsServices.length > 0
        ? `I don't see an ECS service called "${claimedName}" among your connected resources — did you mean one of: ${ecsServices.map((w) => w.name).join(", ")}?`
        : `There are no ECS services discovered for this tenant yet — connect an AWS account under Infrastructure first.`
    };
  }

  if (ecsServices.length === 1) return { match: ecsServices[0]! };
  if (ecsServices.length === 0) return { notFound: `There are no ECS services discovered for this tenant yet — connect an AWS account under Infrastructure first.` };
  return { clarify: `Which ECS service did you mean: ${ecsServices.map((w) => w.name).join(", ")}?` };
}

const READ_ONLY_CHAT_TOOLS = [
  "aws_ecs_describe_clusters",
  "aws_ecs_list_clusters",
  "aws_ecs_describe_services",
  "aws_ecs_list_services",
  "aws_ecs_describe_stopped_tasks",
  "aws_ecs_list_tasks",
  "aws_ecs_list_task_definition_revisions",
  "aws_ecs_describe_capacity_providers",
  "aws_ecs_describe_autoscaling",
  "aws_ecs_describe_task_definition_config",
  "aws_cloudwatch_get_metric_data",
  "aws_logs_describe_log_groups",
  "aws_logs_filter_log_events",
  "aws_s3_list_buckets",
  "aws_s3_list_objects",
  "aws_s3_create_upload_url",
  "aws_s3_create_download_url",
  "aws_ec2_describe_instances",
  "aws_ec2_describe_security_groups",
  "aws_ec2_describe_volumes",
  "aws_rds_describe_db_instances"
];

const DESTRUCTIVE_MUTATION_TOOLS = ["aws_ecs_delete_service", "aws_ecs_delete_cluster", "aws_ecs_deregister_task_definition"];
const EXPLICIT_DELETE_INTENT = /\b(delete|permanently|deregister|destroy|tear down|remove permanently)\b/i;

async function resolveChatAction(params: {
  rawResponse: string;
  operatorPrompt: string;
  tenantId: string;
  agentId: string;
  discoveredWorkloads: DiscoveredWorkloadRef[];
  authorizedCapabilities: string[];
  policyEngine: PolicyEngine;
  approvalService: ApprovalService;
  tenantService: TenantService;
}): Promise<{
  text: string;
  toolCalls: ChatToolCallRecord[];
  readToolResult?: { toolName: string; result: unknown };
  pendingApproval?: { id: string; toolName: string; rawPayload: Record<string, unknown>; dryRunDiff: Record<string, unknown> };
}> {
  const { rawResponse, operatorPrompt, tenantId, agentId, discoveredWorkloads, authorizedCapabilities, policyEngine, approvalService, tenantService } = params;
  const toolCalls: ChatToolCallRecord[] = [];

  const parsed = extractJsonFromLlmOutput(rawResponse);
  if (!parsed || typeof parsed !== "object" || !parsed.action) {
    return { text: rawResponse, toolCalls };
  }

  if (parsed.action === "clarify") {
    const text = typeof parsed.question === "string" && parsed.question.trim()
      ? parsed.question
      : "Could you say more about what you'd like me to do?";
    return { text, toolCalls };
  }

  if (parsed.action === "read_tool_call") {
    // Defensive: the model occasionally echoes prompt placeholder syntax
    // literally (e.g. "<aws_s3_list_objects>") instead of substituting a
    // real tool name — strip stray angle brackets rather than failing the
    // lookup on a cosmetic mistake.
    const readToolName = typeof parsed.tool === "string" ? parsed.tool.replace(/^<|>$/g, "").trim() : parsed.tool;
    const readTool = CANONICAL_TOOLS.find((t) => t.name === readToolName && t.status === "live" && READ_ONLY_CHAT_TOOLS.includes(t.name));
    if (!readTool) {
      return { text: `I don't have a read-only tool called "${readToolName}" — nothing was fetched.`, toolCalls };
    }

    const rawReadParams = (parsed.parameters && typeof parsed.parameters === "object" ? parsed.parameters : {}) as Record<string, unknown>;
    let resolvedReadParams: Record<string, unknown> = { ...rawReadParams };

    if (["aws_ecs_describe_services", "aws_ecs_describe_stopped_tasks", "aws_ecs_list_tasks", "aws_cloudwatch_get_metric_data", "aws_ecs_describe_autoscaling"].includes(readToolName)) {
      const resolved = resolveEcsServiceTarget(rawReadParams, discoveredWorkloads);
      if ("clarify" in resolved) return { text: resolved.clarify, toolCalls };
      if ("notFound" in resolved) return { text: resolved.notFound, toolCalls };
      const { match } = resolved;
      const cluster = match.cluster || "default";
      if (readToolName === "aws_ecs_describe_services") {
        resolvedReadParams = { ...rawReadParams, services: [match.name], cluster, region: match.region };
      } else if (readToolName === "aws_ecs_list_tasks") {
        resolvedReadParams = { ...rawReadParams, serviceName: match.name, cluster, region: match.region };
      } else {
        resolvedReadParams = { ...rawReadParams, service: match.name, cluster, region: match.region };
      }
    } else if (readToolName === "aws_ecs_describe_task_definition_config") {
      // An explicit taskDefinition (ARN or family:revision) is trusted as-is
      // — it's just a describe call, not a mutation target. Only resolve a
      // service+cluster when no explicit taskDefinition was given.
      if (!rawReadParams.taskDefinition) {
        const resolved = resolveEcsServiceTarget(rawReadParams, discoveredWorkloads);
        if ("clarify" in resolved) return { text: resolved.clarify, toolCalls };
        if ("notFound" in resolved) return { text: resolved.notFound, toolCalls };
        resolvedReadParams = { ...rawReadParams, service: resolved.match.name, cluster: resolved.match.cluster || "default", region: resolved.match.region };
      }
    } else if (readToolName === "aws_ecs_list_services") {
      const claimedCluster = rawReadParams.cluster as string;
      const clusters = Array.from(new Set(discoveredWorkloads.filter((w) => w.type === "ECS_SERVICE" && w.cluster).map((w) => w.cluster as string)));
      const match = claimedCluster && clusters.includes(claimedCluster)
        ? claimedCluster
        : clusters.length === 1
          ? clusters[0]
          : undefined;
      if (!match) {
        const text = clusters.length > 0
          ? `Which cluster did you mean: ${clusters.join(", ")}?`
          : `I don't have a known cluster name to list services from — try "list ECS clusters" first, or tell me the exact cluster name.`;
        return { text, toolCalls };
      }
      resolvedReadParams = { ...rawReadParams, cluster: match, region: rawReadParams.region || discoveredWorkloads[0]?.region || "us-east-1" };
    } else if (readToolName === "aws_ecs_list_task_definition_revisions") {
      if (!rawReadParams.familyPrefix) {
        const resolved = resolveEcsServiceTarget({}, discoveredWorkloads);
        if ("match" in resolved) {
          resolvedReadParams = { ...rawReadParams, familyPrefix: resolved.match.name, region: resolved.match.region };
        } else {
          return { text: `Which task definition family did you want the revision history for?`, toolCalls };
        }
      }
    } else if (["aws_s3_list_objects", "aws_s3_create_upload_url", "aws_s3_create_download_url"].includes(readToolName)) {
      const claimedBucket = rawReadParams.bucket as string;
      const buckets = discoveredWorkloads.filter((w) => w.type === "S3_BUCKET");
      const match = claimedBucket
        ? buckets.find((w) => w.name === claimedBucket)
        : buckets.length === 1
          ? buckets[0]
          : undefined;
      if (!match) {
        const text = buckets.length > 0
          ? `Which S3 bucket did you mean: ${buckets.map((w) => w.name).join(", ")}?`
          : `There are no S3 buckets discovered for this tenant yet.`;
        return { text, toolCalls };
      }
      if (["aws_s3_create_upload_url", "aws_s3_create_download_url"].includes(readToolName) && !rawReadParams.key) {
        return { text: `What filename/key should I use in "${match.name}"?`, toolCalls };
      }
      resolvedReadParams = { ...rawReadParams, bucket: match.name, region: match.region };
    } else if (readToolName === "aws_ec2_describe_instances") {
      const claimedIds = Array.isArray(rawReadParams.instanceIds) ? (rawReadParams.instanceIds as unknown[]) : [];
      const known = discoveredWorkloads.filter((w) => w.type === "EC2_INSTANCE").map((w) => w.name);
      const matched = claimedIds.filter((id) => known.includes(id as string));
      // No specific instance requested (or none matched) — list everything discovered rather than refusing, since this is a harmless read.
      resolvedReadParams = { ...rawReadParams, instanceIds: matched.length > 0 ? matched : undefined, region: rawReadParams.region || discoveredWorkloads[0]?.region || "us-east-1" };
    } else if (["aws_ec2_describe_security_groups", "aws_ec2_describe_volumes"].includes(readToolName)) {
      // No discovered-resource correlation for SGs/volumes yet — these are
      // harmless list/describe calls, so pass through whatever filter (if
      // any) the model gave rather than requiring an exact match first.
      resolvedReadParams = { ...rawReadParams, region: rawReadParams.region || discoveredWorkloads[0]?.region || "us-east-1" };
    } else if (readToolName === "aws_logs_filter_log_events" && !rawReadParams.logGroupName) {
      return { text: `Which CloudWatch log group should I search? Call "list log groups" first if you're not sure of the exact name.`, toolCalls };
    } else if (readToolName === "aws_rds_describe_db_instances") {
      const claimedId = rawReadParams.dbInstanceIdentifier as string;
      const known = discoveredWorkloads.filter((w) => w.type === "RDS_DATABASE").map((w) => w.name);
      resolvedReadParams = {
        ...rawReadParams,
        dbInstanceIdentifier: claimedId && known.includes(claimedId) ? claimedId : undefined,
        region: rawReadParams.region || discoveredWorkloads[0]?.region || "us-east-1"
      };
    }

    const readPolicyResult = await policyEngine.evaluate({
      agentId,
      tenantId,
      toolName: readTool.name,
      operationType: "READ_ONLY",
      arguments: resolvedReadParams,
      authorizedCapabilities
    });

    if (readPolicyResult.decision === "DENY") {
      toolCalls.push({ name: readTool.name, status: "denied", summary: readPolicyResult.reason || "Denied by policy" });
      return { text: `That lookup was blocked by policy: ${readPolicyResult.reason || "denied"}.`, toolCalls };
    }

    try {
      const result = await readTool.handler(resolvedReadParams as any, { agentId, tenantId });
      toolCalls.push({ name: readTool.name, status: "completed", summary: `Fetched live data via ${readTool.name}` });
      return { text: "", toolCalls, readToolResult: { toolName: readTool.name, result } };
    } catch (err: any) {
      toolCalls.push({ name: readTool.name, status: "failed", summary: err?.message || "Tool call failed" });
      return { text: `I tried to fetch that live data but hit an error: ${err?.message || "unknown error"}.`, toolCalls };
    }
  }

  if (parsed.action !== "propose_mutation") {
    return { text: rawResponse, toolCalls };
  }

  const toolName = typeof parsed.tool === "string" ? parsed.tool.replace(/^<|>$/g, "").trim() : parsed.tool;
  const tool = CANONICAL_TOOLS.find((t) => t.name === toolName && t.status === "live" && t.requiresApproval);
  if (!tool) {
    return { text: `I don't have a governed action called "${toolName}" — nothing was executed or proposed.`, toolCalls };
  }

  // Defense-in-depth beyond the prompt instruction: an irreversible deletion
  // must never be proposed unless the operator's own words this turn
  // actually said so — never inferred from a vague "remove"/"clean up" or
  // reused from an earlier turn's different intent.
  if (DESTRUCTIVE_MUTATION_TOOLS.includes(toolName) && !EXPLICIT_DELETE_INTENT.test(operatorPrompt)) {
    return {
      text: `"${toolName}" permanently deletes a real resource — I only propose that when you explicitly say to delete/deregister/destroy it. Please confirm explicitly if that's really what you want.`,
      toolCalls
    };
  }

  const rawParameters = (parsed.parameters && typeof parsed.parameters === "object" ? parsed.parameters : {}) as Record<string, unknown>;

  // Never trust the model's claimed target — re-resolve it against what's
  // actually connected, exactly like the investigation resolve-target flow.
  let resolvedParameters: Record<string, unknown> = { ...rawParameters };
  if (toolName === "aws_ecs_update_service") {
    const match = discoveredWorkloads.find((w) => w.type === "ECS_SERVICE" && w.name === rawParameters.service);
    if (!match) {
      const options = discoveredWorkloads.filter((w) => w.type === "ECS_SERVICE").map((w) => w.name);
      const text = options.length > 0
        ? `I don't see an ECS service called "${rawParameters.service}" among your connected resources — did you mean one of: ${options.join(", ")}?`
        : `There are no ECS services discovered for this tenant yet — connect an AWS account under Infrastructure first.`;
      return { text, toolCalls };
    }
    if (rawParameters.desiredCount === undefined && !rawParameters.forceNewDeployment) {
      return { text: `How many tasks should "${match.name}" be scaled to?`, toolCalls };
    }
    resolvedParameters = { ...rawParameters, service: match.name, cluster: match.cluster || "default", region: match.region };
  } else if (toolName === "aws_ecs_rollback_service") {
    const match = discoveredWorkloads.find((w) => w.type === "ECS_SERVICE" && w.name === rawParameters.service);
    if (!match) {
      const options = discoveredWorkloads.filter((w) => w.type === "ECS_SERVICE").map((w) => w.name);
      const text = options.length > 0
        ? `I don't see an ECS service called "${rawParameters.service}" among your connected resources — did you mean one of: ${options.join(", ")}?`
        : `There are no ECS services discovered for this tenant yet — connect an AWS account under Infrastructure first.`;
      return { text, toolCalls };
    }
    if (!rawParameters.targetTaskDefinition) {
      return { text: `I can't guess which prior task definition to roll "${match.name}" back to from chat alone. If a specific approval caused the issue, go to the Approvals page and use "Revert" on that approval instead — it knows the exact prior state. Otherwise, tell me the exact task definition ARN/revision to roll back to.`, toolCalls };
    }
    resolvedParameters = { ...rawParameters, service: match.name, cluster: match.cluster || "default", region: match.region };
  } else if (toolName === "aws_ecs_enable_cloudwatch_logging") {
    const match = discoveredWorkloads.find((w) => w.type === "ECS_SERVICE" && w.name === rawParameters.service);
    if (!match) {
      const options = discoveredWorkloads.filter((w) => w.type === "ECS_SERVICE").map((w) => w.name);
      const text = options.length > 0
        ? `I don't see an ECS service called "${rawParameters.service}" among your connected resources — did you mean one of: ${options.join(", ")}?`
        : `There are no ECS services discovered for this tenant yet — connect an AWS account under Infrastructure first.`;
      return { text, toolCalls };
    }
    resolvedParameters = { ...rawParameters, service: match.name, cluster: match.cluster || "default", region: match.region };
  } else if (toolName === "aws_ecs_delete_service") {
    const match = discoveredWorkloads.find((w) => w.type === "ECS_SERVICE" && w.name === rawParameters.service);
    if (!match) {
      const options = discoveredWorkloads.filter((w) => w.type === "ECS_SERVICE").map((w) => w.name);
      const text = options.length > 0
        ? `I don't see an ECS service called "${rawParameters.service}" among your connected resources — did you mean one of: ${options.join(", ")}?`
        : `There are no ECS services discovered for this tenant yet.`;
      return { text, toolCalls };
    }
    resolvedParameters = { ...rawParameters, service: match.name, cluster: match.cluster || "default", region: match.region };
  } else if (toolName === "aws_ecs_delete_cluster") {
    const claimedCluster = rawParameters.cluster as string;
    const clusters = Array.from(new Set(discoveredWorkloads.filter((w) => w.type === "ECS_SERVICE" && w.cluster).map((w) => w.cluster as string)));
    if (!claimedCluster || !clusters.includes(claimedCluster)) {
      const text = clusters.length > 0
        ? `Which cluster do you mean: ${clusters.join(", ")}? Note it must have no active services first — AWS will reject the deletion otherwise.`
        : `I don't have a known cluster name to delete — tell me the exact cluster name.`;
      return { text, toolCalls };
    }
    resolvedParameters = { ...rawParameters, cluster: claimedCluster, region: rawParameters.region || discoveredWorkloads[0]?.region || "us-east-1" };
  } else if (toolName === "aws_ecs_deregister_task_definition") {
    if (!rawParameters.taskDefinition) {
      return { text: `Which exact task definition (family:revision or ARN) should I deregister?`, toolCalls };
    }
  } else if (["aws_ec2_reboot_instances", "aws_ec2_stop_instances", "aws_ec2_start_instances"].includes(toolName)) {
    const instanceIds = Array.isArray(rawParameters.instanceIds) ? rawParameters.instanceIds : [];
    const known = discoveredWorkloads.filter((w) => w.type === "EC2_INSTANCE").map((w) => w.name);
    const matched = instanceIds.filter((id: unknown) => known.includes(id as string));
    if (matched.length === 0) {
      const text = known.length > 0
        ? `I don't see an EC2 instance matching that among your connected resources — did you mean one of: ${known.join(", ")}?`
        : `There are no EC2 instances discovered for this tenant yet.`;
      return { text, toolCalls };
    }
    resolvedParameters = { ...rawParameters, instanceIds: matched };
  } else if (toolName === "aws_rds_reboot_db_instance") {
    const match = discoveredWorkloads.find((w) => w.type === "RDS_DATABASE" && w.name === rawParameters.dbInstanceIdentifier);
    if (!match) {
      const options = discoveredWorkloads.filter((w) => w.type === "RDS_DATABASE").map((w) => w.name);
      const text = options.length > 0
        ? `I don't see an RDS instance called "${rawParameters.dbInstanceIdentifier}" among your connected resources — did you mean one of: ${options.join(", ")}?`
        : `There are no RDS instances discovered for this tenant yet.`;
      return { text, toolCalls };
    }
    resolvedParameters = { ...rawParameters, dbInstanceIdentifier: match.name };
  }

  const operationType = (tool.operationType as any) || "MUTATION";
  const tenantMonthlyBudgetLimitUsd = await tenantService
    .getBudget(tenantId)
    .then((b) => b.monthlyBudgetLimitUsd)
    .catch(() => undefined);
  const policyResult = await policyEngine.evaluate({
    agentId,
    tenantId,
    toolName: tool.name,
    operationType,
    arguments: resolvedParameters,
    authorizedCapabilities,
    tenantMonthlyBudgetLimitUsd
  });

  toolCalls.push({
    name: "policy_evaluate",
    status: policyResult.decision === "DENY" ? "denied" : "completed",
    summary: `PolicyEngine.evaluate(${tool.name}) -> ${policyResult.decision}${policyResult.ruleId ? ` (rule: ${policyResult.ruleId})` : ""}`
  });

  if (policyResult.decision === "DENY") {
    const costNote = policyResult.ruleId === "FENCE_BUDGET_CAP" && policyResult.estimatedMonthlyCostUsd !== undefined
      ? ` This action is estimated at **$${policyResult.estimatedMonthlyCostUsd.toFixed(2)}/month**, above your tenant's **$${(policyResult.budgetLimitUsd ?? 0).toFixed(2)}/month** budget cap. An operator can raise the cap in Settings, or re-request this action with an explicit budget override.`
      : "";
    return {
      text: `That action was blocked by policy: ${policyResult.reason || "denied"} (rule: ${policyResult.ruleId || "n/a"}).${costNote} Nothing was executed or proposed.`,
      toolCalls
    };
  }

  try {
    const previousStateSnapshot = await captureSnapshotForRevert(
      tool.name,
      resolvedParameters,
      { agentId, tenantId }
    );
    toolCalls.push({
      name: "capture_snapshot_for_revert",
      status: "completed",
      summary: previousStateSnapshot ? "Captured live pre-mutation state for revert" : "No prior state snapshot available"
    });

    const dryRunDiff = BlastRadiusSimulator.simulate(tool.name, resolvedParameters, previousStateSnapshot || undefined);
    if (policyResult.budgetLimitUsd !== undefined) {
      dryRunDiff.budgetCapExceeded = dryRunDiff.estimatedMonthlyCostUsd > policyResult.budgetLimitUsd;
    }
    toolCalls.push({ name: "blast_radius_simulate", status: "completed", summary: `Computed dry-run diff for ${tool.name}` });

    const approval = await approvalService.createApprovalRequest({
      tenantId: tenantId as any,
      agentId: agentId as any,
      toolName: tool.name,
      rawPayload: resolvedParameters,
      operationType,
      dryRunDiff,
      previousStateSnapshot,
      operatorPrompt
    });
    toolCalls.push({
      name: "create_approval_request",
      status: "completed",
      summary: `Created pending approval ${approval.id} for ${tool.name}`
    });

    const costLine = dryRunDiff.estimatedMonthlyCostUsd > 0
      ? `\n\n**Estimated cost impact:** $${dryRunDiff.estimatedMonthlyCostUsd.toFixed(2)}/month (tenant budget cap: $${(policyResult.budgetLimitUsd ?? 0).toFixed(2)}/month).`
      : "";
    return {
      text: `I've created a real pending approval (${approval.id}) for **${tool.name}** with ${JSON.stringify(resolvedParameters)}.${costLine}\n\nYou can approve or reject it right here, or on the Approvals page.`,
      toolCalls,
      pendingApproval: {
        id: approval.id,
        toolName: tool.name,
        rawPayload: resolvedParameters,
        dryRunDiff
      }
    };
  } catch (err: any) {
    toolCalls.push({ name: "create_approval_request", status: "failed", summary: err?.message || "Approval creation failed" });
    return {
      text: `I tried to propose that mutation but hit an error creating the approval request: ${err?.message || "unknown error"}. Nothing was executed.`,
      toolCalls
    };
  }
}

export interface AgentRoutesOptions {
  agentService?: AgentService | undefined;
  agentAdapter?: AgentAdapter | undefined;
  rateLimiter?: RedisRateLimiter | undefined;
  policyEngine?: PolicyEngine | undefined;
  cloudAccountService?: CloudAccountService | undefined;
  incidentService?: IncidentService | undefined;
  approvalService?: ApprovalService | undefined;
  tenantService?: TenantService | undefined;
  joinRequestService?: JoinRequestService | undefined;
  hermesProfileService?: HermesProfileService | undefined;
}

export const agentRoutes: FastifyPluginAsync<AgentRoutesOptions> = async (fastify, opts) => {
  const agentService = opts.agentService || new AgentService();
  const agentAdapter = opts.agentAdapter || createAgentAdapter("hermes");
  const policyEngine = opts.policyEngine || new PolicyEngine();
  const cloudAccountService = opts.cloudAccountService || new CloudAccountService();
  const incidentService = opts.incidentService || new IncidentService();
  const approvalService = opts.approvalService || new ApprovalService();
  const tenantService = opts.tenantService || new TenantService();
  const joinRequestService = opts.joinRequestService || new JoinRequestService();
  const hermesProfileService = opts.hermesProfileService || new HermesProfileService();
  const chatRateLimit = opts.rateLimiter ? createChatRateLimitPreHandler(opts.rateLimiter) : defaultChatRateLimitPreHandler;

  /**
   * GET /v1/agents
   * Operator lists all registered agents for their tenant.
   */
  fastify.get("/v1/agents", { preHandler: [requireOperatorAuth] }, async (request, reply) => {
    const operator = request.operator!;

    const agents = await agentService.listAgents(operator.tenantId);

    return reply.status(200).send({
      items: agents.map((agent) => ({
        id: agent.id,
        tenantId: agent.tenantId,
        name: agent.name,
        type: agent.type,
        version: agent.version,
        runtimeProtocol: agent.runtimeProtocol,
        status: agent.status,
        cloudAccountId: agent.cloudAccountId,
        hermesProfileName: agent.hermesProfileName,
        governanceStatus: agent.governanceStatus,
        governanceVerifiedAt: agent.governanceVerifiedAt?.toISOString() ?? null,
        mcpRegistered: agent.mcpRegistered,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString()
      }))
    });
  });

  /**
   * GET /v1/agents/:id
   * Operator retrieves a single agent by ID.
   */
  fastify.get<{ Params: { id: string } }>(
    "/v1/agents/:id",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      const agent = await agentService.getAgent(operator.tenantId, id as any);

      return reply.status(200).send({
        id: agent.id,
        tenantId: agent.tenantId,
        name: agent.name,
        type: agent.type,
        version: agent.version,
        runtimeProtocol: agent.runtimeProtocol,
        status: agent.status,
        cloudAccountId: agent.cloudAccountId,
        hermesProfileName: agent.hermesProfileName,
        governanceStatus: agent.governanceStatus,
        governanceVerifiedAt: agent.governanceVerifiedAt?.toISOString() ?? null,
        mcpRegistered: agent.mcpRegistered,
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString()
      });
    }
  );

  /**
   * POST /v1/agents/:id/verify-governance
   * ADR-0008 Phase A: independently re-checks (not just re-reads the
   * last-recorded status of) this agent's governed Hermes profile —
   * native toolsets still disabled, CloudOps's own MCP server still the
   * only one registered and reachable. Always 200 with a success/failure
   * flag in the body, matching the existing /v1/agents/:id/test convention
   * — a governance check that's FALSE is a normal, expected result to
   * display, not a server error.
   */
  fastify.post<{ Params: { id: string } }>(
    "/v1/agents/:id/verify-governance",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      await agentService.getAgent(operator.tenantId, id as any);
      const result = await hermesProfileService.verifyGovernance(operator.tenantId, id);

      return reply.status(200).send(result);
    }
  );

  /**
   * PATCH /v1/agents/:id/cloud-account
   * Assigns (or clears, with cloudAccountId: null) the single cloud account
   * this agent runs against. Real tool-call credential resolution
   * (packages/tools/src/registry.ts) reads this mapping instead of falling
   * back to "any" active session for the tenant.
   */
  fastify.patch<{ Params: { id: string }; Body: { cloudAccountId: string | null } }>(
    "/v1/agents/:id/cloud-account",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;
      const { cloudAccountId } = request.body || ({} as any);

      if (cloudAccountId !== null && typeof cloudAccountId !== "string") {
        return reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "cloudAccountId must be a string or null" }
        });
      }

      if (cloudAccountId) {
        const accounts = await cloudAccountService.listAccounts(operator.tenantId);
        const account = accounts.find((a) => a.id === cloudAccountId);
        if (!account) {
          return reply.status(404).send({
            error: { code: "CLOUD_ACCOUNT_NOT_FOUND", message: `Cloud account '${cloudAccountId}' not found for this tenant` }
          });
        }
      }

      const agent = await agentService.assignCloudAccount(operator.tenantId, id as any, cloudAccountId);

      return reply.status(200).send({
        id: agent.id,
        cloudAccountId: agent.cloudAccountId
      });
    }
  );

  /**
   * POST /v1/agents/:id/sync-capabilities
   * Re-syncs this agent's granted capability scope to the full current
   * canonical tool catalog. Needed because declared_capabilities is
   * otherwise write-once at onboarding time — an agent onboarded before a
   * new tool (e.g. the S3/EC2/RDS tools) is permanently stuck unable to use
   * it, with no other way to widen its grant.
   */
  fastify.post<{ Params: { id: string } }>(
    "/v1/agents/:id/sync-capabilities",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      await agentService.getAgent(operator.tenantId, id as any);

      const fullCatalog = expandCanonicalCapabilities(CANONICAL_TOOLS.map((t) => t.name));
      const { updatedRows } = await joinRequestService.syncCapabilities(operator.tenantId, id as any, fullCatalog, operator.operatorId);

      return reply.status(200).send({
        id,
        capabilities: fullCatalog,
        updatedRows
      });
    }
  );

  /**
   * DELETE /v1/agents/:id
   * Operator deletes/removes an agent and cleans up associated credentials, sessions, and references.
   */
  fastify.delete<{ Params: { id: string } }>(
    "/v1/agents/:id",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      // ADR-0008 Phase A: tear down this agent's governed Hermes profile
      // BEFORE the agent row (and its hermes_profile_name) is gone. Best
      // effort — a profile that's already missing, or a Hermes CLI hiccup,
      // must never block the operator from actually deleting the agent.
      try {
        await hermesProfileService.deprovisionProfile(operator.tenantId, id);
      } catch (err: any) {
        request.log.warn({ err, agentId: id }, "Hermes profile deprovisioning failed during agent deletion (non-fatal)");
      }

      // Stop any active connector child processes
      const db = getDatabase();
      try {
        const connectors = await db
          .selectFrom("agent_connectors")
          .selectAll()
          .where("agent_id", "=", id)
          .where("tenant_id", "=", operator.tenantId)
          .execute();

        for (const c of connectors) {
          if (c.pid) {
            try {
              process.kill(c.pid, "SIGTERM");
            } catch {
              // ignore
            }
          }
        }

        await db
          .updateTable("agent_connectors")
          .set({ status: "stopped", stopped_at: new Date() })
          .where("agent_id", "=", id)
          .where("tenant_id", "=", operator.tenantId)
          .execute();
      } catch {
        // non-fatal
      }

      const result = await agentService.deleteAgent(operator.tenantId, id as any);

      return reply.status(200).send({
        success: true,
        message: `Agent '${result.name}' (${result.id}) was successfully deleted`,
        deletedAgentId: result.id
      });
    }
  );

  /**
   * POST /v1/agents/:id/connect
   * Auto-spawns connector sidecar process, tracks in agent_connectors, and updates status to CONNECTED.
   */
  fastify.post<{
    Params: { id: string };
    Body?: { autoApprove?: boolean };
  }>(
    "/v1/agents/:id/connect",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      const agent = await agentService.getAgent(operator.tenantId, id as any);
      const db = getDatabase();

      // 1. Check for existing alive connector
      const existing = await db
        .selectFrom("agent_connectors")
        .selectAll()
        .where("agent_id", "=", agent.id)
        .where("tenant_id", "=", operator.tenantId)
        .where("status", "in", ["starting", "connected"])
        .orderBy("started_at", "desc")
        .executeTakeFirst();

      if (existing && existing.pid) {
        let isAlive = false;
        try {
          process.kill(existing.pid, 0);
          isAlive = true;
        } catch {
          isAlive = false;
        }

        if (isAlive && existing.mcp_sse_url) {
          if (agent.status !== "CONNECTED") {
            await agentService.updateStatus(operator.tenantId, agent.id as any, "CONNECTED");
          }
          return reply.status(200).send({
            mcpSseUrl: existing.mcp_sse_url,
            connectorPid: existing.pid,
            status: "connected"
          });
        }
      }

      // 2. Generate invite token for connector onboarding
      const inviteService = new InviteService();
      const port = Number(process.env.API_PORT || 3000);
      const invite = await inviteService.createInvite(
        operator.tenantId,
        operator.operatorId,
        86400,
        {
          agentName: agent.name,
          agentType: agent.type as any,
          apiBaseUrl: `http://localhost:${port}`
        }
      );

      // 3. Resolve connector CLI script path relative to this module's own
      // location, not process.cwd() — the API is normally started via
      // `npm run dev --workspace=apps/api`, which npm runs with cwd set to
      // apps/api, not the monorepo root, so a cwd-relative path here
      // silently pointed at a nonexistent file and made every onboarding
      // attempt fail with a generic "exited with code 1".
      const thisDir = path.dirname(fileURLToPath(import.meta.url));
      const cliPath = path.resolve(thisDir, "../../../../packages/connector/dist/cli.js");

      // 3b. Resolve this agent's real, DB-backed capability grant before
      // spawning — the daemon's inline MCP server trusts whatever it's
      // handed via CLOUDOPS_CAPABILITIES, so this must be the real grant,
      // never omitted (an unset value there means "every tool authorized").
      const daemonCapabilities = await resolveAuthorizedCapabilities(operator.tenantId, agent.id);

      // 4. Spawn connector daemon child process
      const child = spawn("node", [
        cliPath,
        "--daemon",
        "--agent-id", agent.id,
        "--tenant-id", operator.tenantId,
        "--invite", invite.inviteToken,
        "--url", `http://localhost:${port}`,
        "--mcp-port", "0"
      ], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV || "development",
          CLOUDOPS_CAPABILITIES: daemonCapabilities.join(",")
        }
      });

      child.unref();

      // 5. Wait for stdout JSON: { mcpSseUrl, pid, port }
      const connectorReadyPromise = new Promise<{ mcpSseUrl: string; pid: number; port: number }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connector daemon did not report MCP ready within 10 seconds"));
        }, 10000);

        let buffer = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("{") && trimmed.includes("mcpSseUrl")) {
              clearTimeout(timeout);
              try {
                const parsed = JSON.parse(trimmed);
                resolve(parsed);
                return;
              } catch {
                // keep reading
              }
            }
          }
        });

        child.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        child.on("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Connector daemon exited prematurely with code ${code}`));
        });
      });

      try {
        const result = await connectorReadyPromise;

        // 6. Record in agent_connectors
        await db
          .insertInto("agent_connectors")
          .values({
            agent_id: agent.id,
            tenant_id: operator.tenantId,
            pid: result.pid,
            mcp_port: result.port,
            mcp_sse_url: result.mcpSseUrl,
            status: "connected",
            started_at: new Date()
          })
          .execute();

        // 7. Update agent status to CONNECTED
        await agentService.updateStatus(operator.tenantId, agent.id as any, "CONNECTED");

        return reply.status(200).send({
          mcpSseUrl: result.mcpSseUrl,
          connectorPid: result.pid,
          status: "connected"
        });
      } catch (err: any) {
        request.log.error({ err }, "Failed to auto-spawn connector daemon");
        return reply.status(500).send({
          error: {
            code: "CONNECTOR_SPAWN_FAILED",
            message: err?.message || "Failed to start connector daemon"
          }
        });
      }
    }
  );

  /**
   * POST /v1/agents/:id/test
   * Validates agent connection by connecting to its MCP SSE endpoint, listing tools, and probing a read capability.
   */
  fastify.post<{
    Params: { id: string };
  }>(
    "/v1/agents/:id/test",
    { preHandler: [requireOperatorAuth] },
    async (request, reply) => {
      const operator = request.operator!;
      const { id } = request.params;

      const agent = await agentService.getAgent(operator.tenantId, id as any);
      const db = getDatabase();

      // 1. Get agent's MCP SSE URL
      const conn = await db
        .selectFrom("agent_connectors")
        .selectAll()
        .where("agent_id", "=", agent.id)
        .where("tenant_id", "=", operator.tenantId)
        .where("status", "=", "connected")
        .orderBy("started_at", "desc")
        .executeTakeFirst();

      const port = Number(process.env.API_PORT || 3000);
      const sseUrl = conn?.mcp_sse_url || `http://localhost:${port}/v1/mcp/sse?agentId=${agent.id}&tenantId=${operator.tenantId}`;

      // 2. Connect via MCP client
      try {
        const transport = new SSEClientTransport(new URL(sseUrl));
        const client = new Client(
          { name: "cloudops-verifier", version: "1.0.0" },
          { capabilities: {} }
        );

        await client.connect(transport);
        const toolsList = await client.listTools();
        const mcpTools = toolsList.tools.map((t) => t.name);

        // 3. Call read-only capability (e.g. aws_ecs_describe_clusters)
        if (mcpTools.includes("aws_ecs_describe_clusters")) {
          try {
            await client.callTool({
              name: "aws_ecs_describe_clusters",
              arguments: { region: "us-east-1" }
            });
          } catch {
            // Read-only probe call non-fatal
          }
        }

        await client.close();

        return reply.status(200).send({
          success: true,
          mcpTools
        });
      } catch (err: any) {
        request.log.warn({ err, sseUrl }, "Agent test connection probe failed");
        return reply.status(200).send({
          success: false,
          error: err?.message || "Failed to connect to agent MCP endpoint"
        });
      }
    }
  );


  /**
   * GET /v1/agents/runtime-endpoint
   * Probes active agent runtime endpoint, health status, discovered model, and provider
   */
  fastify.get("/v1/agents/runtime-endpoint", { preHandler: [requireOperatorAuth] }, async (_request, reply) => {
    const localAdapter = agentAdapter || createAgentAdapter("hermes");
    if (typeof (localAdapter as any).checkHermesHealth === "function") {
      const health = await (localAdapter as any).checkHermesHealth();
      return reply.status(200).send(health);
    }
    return reply.status(200).send({
      connected: true,
      endpoint: "builtin-runtime",
      model: "autonomous-agent"
    });
  });

  /**
   * POST /v1/agents/runtime-endpoint
   * Dynamically configures the active agent runtime daemon endpoint and session token in real time
   */
  fastify.post<{
    Body: {
      endpoint: string;
      sessionToken?: string;
    };
  }>("/v1/agents/runtime-endpoint", { preHandler: [requireOperatorAuth] }, async (request, reply) => {
    const { endpoint, sessionToken } = request.body || {};
    if (!endpoint || typeof endpoint !== "string" || endpoint.trim().length === 0) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "endpoint URL is required" }
      });
    }

    const localAdapter = agentAdapter || createAgentAdapter("hermes");
    if (typeof (localAdapter as any).setEndpoint === "function") {
      (localAdapter as any).setEndpoint(endpoint, sessionToken);
    }

    let healthInfo = { connected: false, endpoint };
    if (typeof (localAdapter as any).checkHermesHealth === "function") {
      healthInfo = await (localAdapter as any).checkHermesHealth();
    }

    return reply.status(200).send({
      success: true,
      message: "Agent runtime endpoint updated dynamically",
      runtime: healthInfo
    });
  });

  /**
   * POST /v1/agent/chat
   * Operator sends an operational or architectural query directly to the live Hermes AI agent.
   * Prompts are analyzed by DefenseClaw before reaching the model.
   */
  fastify.post<{
    Body: {
      prompt: string;
      agentId?: string;
      endpoint?: string;
      sessionToken?: string;
      history?: Array<{ role: "operator" | "agent"; text: string }>;
      context?: {
        environment?: string;
        service?: string;
        cluster?: string;
        region?: string;
      };
    };
  }>("/v1/agent/chat", { preHandler: [requireOperatorAuth, chatRateLimit] }, async (request, reply) => {
    const operator = request.operator!;
    const { prompt, agentId, endpoint, sessionToken, context, history } = request.body || {};

    if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
      return reply.status(400).send({
        error: { code: "VALIDATION_ERROR", message: "Prompt is required" }
      });
    }

    // 1. Resolve Agent and Model dynamically — done before the policy check
    // (Phase 3.1) so evaluate() runs against the actual target agent's
    // identity and declared capability grant, not a placeholder.
    let agentName = "CloudOps Autonomous SRE Agent";
    let agentType = "hermes";
    let effectiveAgentId = agentId || "agent-live-chat";
    // ADR-0008 Phase A: only set when independently on record as
    // LOCKED_DOWN — see the identical fail-closed rationale in
    // investigations.ts's applyGovernedProfile().
    let governedHermesProfileName: string | undefined;
    if (agentId) {
      // An explicitly-requested agentId that doesn't resolve (deleted,
      // wrong tenant, typo) must fail clearly here — silently falling
      // through with a placeholder name while keeping the invalid ID used
      // to defer the failure to a cryptic FK constraint error much later,
      // deep inside approval creation.
      const ag = await agentService.getAgent(operator.tenantId, agentId as any).catch(() => null);
      if (!ag) {
        return reply.status(404).send({
          error: { code: "AGENT_NOT_FOUND", message: `Agent '${agentId}' was not found for this tenant — it may have been deleted. Pick an active agent and try again.` }
        });
      }
      agentName = ag.name;
      agentType = ag.type;
      effectiveAgentId = ag.id;
      governedHermesProfileName = ag.governanceStatus === "LOCKED_DOWN" ? ag.hermesProfileName ?? undefined : undefined;
    } else {
      const agents = await agentService.listAgents(operator.tenantId);
      const active = agents.find((a) => a.status === "CONNECTED") || agents[0];
      if (active) {
        agentName = active.name;
        agentType = active.type;
        effectiveAgentId = active.id;
        governedHermesProfileName = active.governanceStatus === "LOCKED_DOWN" ? active.hermesProfileName ?? undefined : undefined;
      }
    }

    // 2. PolicyEngine.evaluate() — the same single choke point every other
    // capability request goes through (Phase 3.1's "no side door" for chat).
    // "operator_chat_query" is a real, classified read-tier capability
    // (defence_claw/.../capability_tiers.rego); being an authenticated
    // operator is what grants it, on top of whatever the target agent
    // itself declared at onboarding.
    const authorizedCapabilities = Array.from(
      new Set([...(await resolveAuthorizedCapabilities(operator.tenantId, effectiveAgentId)), "operator_chat_query"])
    );

    const policyResult = await policyEngine.evaluate({
      agentId: effectiveAgentId,
      tenantId: operator.tenantId,
      toolName: "operator_chat_query",
      operationType: "READ_ONLY",
      arguments: { promptLength: prompt.length, hasContext: Boolean(context) },
      authorizedCapabilities
    });

    if (policyResult.decision === "DENY") {
      return reply.status(403).send({
        error: {
          code: "DEFENSECLAW_GUARDRAIL_VIOLATION",
          message: policyResult.reason,
          ruleId: policyResult.ruleId
        }
      });
    }

    if (policyResult.decision === "APPROVAL_REQUIRED") {
      return reply.status(403).send({
        error: {
          code: "APPROVAL_REQUIRED",
          message: policyResult.reason,
          ruleId: policyResult.ruleId
        }
      });
    }

    // Unlike the runtime-endpoint probes above, a target agent (and its
    // registered type) is already resolved here — select its adapter through
    // the same factory the onboarding record's agentType feeds, rather than
    // always defaulting to Hermes regardless of which agent is being asked.
    const localAdapter = opts.agentAdapter || createAgentAdapter(agentType);
    if (endpoint && typeof (localAdapter as any).setEndpoint === "function") {
      (localAdapter as any).setEndpoint(endpoint, sessionToken);
    }
    if ("hermesProfileName" in (localAdapter as any)) {
      (localAdapter as any).hermesProfileName = governedHermesProfileName;
    }
    let discoveredModel = "agent-runtime";
    let discoveredProvider = "local-daemon";
    if (typeof (localAdapter as any).checkHermesHealth === "function") {
      try {
        const health = await (localAdapter as any).checkHermesHealth();
        if (health?.model) discoveredModel = health.model;
        if (health?.provider) discoveredProvider = health.provider;
      } catch {
        // use defaults
      }
    }

    // 3. Ground the model in real state before it ever reasons — the same
    // "fetch real data via governed read tools, then hand it to the LLM as
    // context" pattern the investigation pipeline already uses (see
    // synthesizeRootCause's telemetry section above). Read-only, so this
    // never touches the approval gate: it's exactly what "Read-only
    // investigation never requires operator sign-off" already promises.
    // Every real backend action taken this turn, surfaced back to the
    // operator so chat isn't a black box — the same "what did it actually
    // do" visibility the Observability page gives investigations.
    const toolCalls: ChatToolCallRecord[] = [];

    let telemetrySection = "";
    let discoveredWorkloads: Array<{
      name: string;
      type: string;
      cluster?: string | undefined;
      region: string;
    }> = [];
    try {
      const accounts = await cloudAccountService.listAccounts(operator.tenantId);
      const connectedAccounts = accounts.filter((a) => a.status === "CONNECTED");

      const workloadLines: string[] = [];
      for (const acc of connectedAccounts) {
        try {
          const { workloads } = await cloudAccountService.discoverWorkloads(operator.tenantId, acc.id);
          for (const w of workloads) {
            discoveredWorkloads.push({ name: w.name, type: w.type, cluster: w.cluster, region: w.region });
            workloadLines.push(
              `- ${w.name} (${w.type}) in ${w.region}${w.cluster ? `, cluster "${w.cluster}"` : ""}: ${w.status}` +
                (w.runningCount !== undefined ? `, ${w.runningCount}/${w.desiredCount} tasks running` : "")
            );
          }
          toolCalls.push({
            name: "aws_discovery",
            status: "completed",
            summary: `Discovered ${workloadLines.length} workload(s) on connected account ${acc.accountId} (${acc.region})`
          });
        } catch (err: any) {
          toolCalls.push({ name: "aws_discovery", status: "failed", summary: err?.message || "Discovery call failed" });
        }
      }

      const { items: openIncidents } = await incidentService.listIncidents(operator.tenantId, { status: "OPEN" });
      const incidentLines = openIncidents.map(
        (inc) => `- [${inc.severity}] ${inc.title} (service: ${inc.service}, id: ${inc.id})`
      );
      toolCalls.push({
        name: "list_incidents",
        status: "completed",
        summary: `Checked open incidents: ${openIncidents.length} found`
      });

      const zeroWorkloadsGuardrail = workloadLines.length === 0
        ? "\nCRITICAL: zero workloads discovered. This tenant has no real resource for you to reference right now — the AWS session may have expired (they refresh hourly) or no account is connected. Do NOT name any service, cluster, or resource — not even as a hypothetical example. Reply only that no workloads are currently discovered and the operator should reconnect their AWS account (Infrastructure page) or check the connection, then stop."
        : "";
      telemetrySection = `\n\nLive Telemetry (real, just fetched — not a guess):\nDiscovered workloads (${workloadLines.length}):\n${
        workloadLines.length > 0 ? workloadLines.join("\n") : `(none discovered — no cloud account connected, or nothing running)${zeroWorkloadsGuardrail}`
      }\n\nOpen incidents (${incidentLines.length}):\n${
        incidentLines.length > 0 ? incidentLines.join("\n") : "(none)"
      }`;
    } catch (err: any) {
      request.log.warn({ err }, "Chat telemetry grounding failed; answering without live data");
      telemetrySection = "\n\n(Live telemetry fetch failed — answer honestly that current cloud state is unavailable rather than guessing.)";
      toolCalls.push({ name: "aws_discovery", status: "failed", summary: err?.message || "Telemetry grounding failed" });
    }

    // Task 1 (Restore Memory & Persistence Loop): surface the tenant's own
    // durable memory (past RCA summaries) rather than relying on Hermes's
    // global memory file, which is unsafe to share across tenants. Best
    // effort — a memory lookup failure must never block the chat turn.
    let memorySection = "";
    try {
      const resourceRefs = discoveredWorkloads.map((w) => w.name);
      const memories = await tenantMemoryService.getTopRelevantMemories(operator.tenantId, {
        resourceRefs,
        limit: 3
      });
      if (memories.length > 0) {
        const memoryLines = memories.map(
          (m) => `- ${m.resourceRef ? `[${m.resourceRef}] ` : ""}${m.summary}`
        );
        memorySection = `\n\nRelevant historical insights from past investigations (this tenant only):\n${memoryLines.join("\n")}`;
      }
    } catch (err: any) {
      request.log.warn({ err }, "Tenant memory lookup failed; answering without historical insights");
    }

    // 4. Build contextual prompt dynamically
    const ctxString = context?.service
      ? `\nActive Operational Context: Workload '${context.service}', Cluster '${context.cluster || "default"}', Region '${context.region || "us-east-1"}', Env '${context.environment || "production"}'.`
      : "";

    const MUTATION_TOOLS = CANONICAL_TOOLS.filter(
      (t) => t.status === "live" && t.requiresApproval && [
        "aws_ecs_update_service", "aws_ecs_rollback_service", "aws_ecs_enable_cloudwatch_logging",
        "aws_ec2_reboot_instances", "aws_ec2_stop_instances",
        "aws_ec2_start_instances", "aws_rds_reboot_db_instance",
        ...DESTRUCTIVE_MUTATION_TOOLS
      ].includes(t.name)
    );
    const mutationToolList = MUTATION_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n");

    // Hierarchical memory: a hard cutoff after N messages was silently
    // "forgetting" anything earlier — real multi-turn agents keep recent
    // turns verbatim and summarize everything older rather than dropping it
    // outright. The client now sends the whole session; this is the one
    // place that decides how much survives into the prompt.
    const HISTORY_VERBATIM_WINDOW = 10;
    const fullHistory = history || [];
    const recentHistory = fullHistory.slice(-HISTORY_VERBATIM_WINDOW);
    const olderHistory = fullHistory.slice(0, -HISTORY_VERBATIM_WINDOW);

    let olderSummary = "";
    if (olderHistory.length > 0) {
      try {
        const summarizePrompt = `Summarize the earlier part of an ongoing SRE operations chat in 2-4 short bullet points: which resources were discussed, what was concluded or decided, and any pending approval IDs mentioned. Be terse — this is background context for a later turn, not a report.\n\n${olderHistory
          .map((m) => `${m.role === "operator" ? "Operator" : "Agent"}: ${m.text}`)
          .join("\n")}`;
        const summaryText = typeof (localAdapter as any).executeHermesInference === "function"
          ? await (localAdapter as any).executeHermesInference(summarizePrompt, 20000)
          : "";
        olderSummary = summaryText?.trim() || "";
      } catch {
        // Best-effort — if summarization fails, proceed without it rather than failing the whole turn.
      }
    }

    const recentHistoryText = recentHistory.length > 0
      ? `Recent conversation (most recent last — use this to understand what "approved", "yes", "go ahead", "reject that" etc. are reacting to):\n${recentHistory
          .map((m) => `${m.role === "operator" ? "Operator" : "Agent"}: ${m.text}`)
          .join("\n")}`
      : "";
    const historySection = (olderSummary || recentHistoryText)
      ? `\n\n${olderSummary ? `Summary of earlier conversation:\n${olderSummary}\n\n` : ""}${recentHistoryText}`
      : "";

    const readToolList = READ_ONLY_CHAT_TOOLS.map((name) => {
      const t = CANONICAL_TOOLS.find((ct) => ct.name === name);
      return t ? `- ${t.name}: ${t.description}` : `- ${name}`;
    }).join("\n");

    const agentPrompt = `You are ${agentName} (${discoveredModel}), an SRE assistant for real-time AWS troubleshooting and operations.
${ctxString}${telemetrySection}${memorySection}${historySection}

Operator Query:
${prompt}

Rules:
- Use Live Telemetry above as real, current fact. If it shows nothing relevant, say so — never invent an incident/service/error the operator didn't mention. Greetings get a plain greeting, not a diagnosis.
- "What can you do" → list only the tools below. Never claim Lambda, Auto Scaling, IAM audits, ticketing, or anything not listed.
- Need data not in Live Telemetry (metrics, ports, load balancer, stopped-task reasons, log lines, S3/EC2/RDS/security-group/volume detail)? Emit ONLY this JSON, nothing else, with "tool" set to exactly one real tool name from the Read-only tools list below (no angle brackets, no placeholder text):
{"action": "read_tool_call", "tool": "aws_ecs_describe_services", "parameters": {...}}
  Omit cluster/service/bucket/region if there's one obvious match in Live Telemetry. For logs, call aws_logs_describe_log_groups first if you don't know the exact log group name. For file transfer, use aws_s3_create_upload_url/create_download_url (returns a real presigned URL, not a file you handle).
- ECS ops are NOT interchangeable:
  scale (count only) = aws_ecs_update_service, no forceNewDeployment
  restart (same image) = aws_ecs_update_service + forceNewDeployment:true
  rollback = aws_ecs_rollback_service, needs an exact targetTaskDefinition (ask, or point to Approvals page "Revert")
  enable/connect CloudWatch logging = aws_ecs_enable_cloudwatch_logging — creates the log group if needed and deploys a new task-def revision with ONLY the logging driver changed (image/cpu/memory/env vars untouched)
  new image/task-def deploy (changing the image, env vars, cpu/memory) = not available from chat yet, say so
  PERMANENT DELETE (aws_ecs_delete_service / aws_ecs_delete_cluster / aws_ecs_deregister_task_definition) = only ever propose these when the operator's own words explicitly say delete/deregister/destroy/permanently remove — never infer this from a vague "remove" or "clean up", and never reuse it from an earlier unrelated turn.
- Operator wants a mutation (scale/restart/reboot/stop/start/delete) on a real resource above, with concrete params? Emit ONLY this JSON, with "tool" set to exactly one real tool name from the Mutation tools list below (no angle brackets, no placeholder text):
{"action": "propose_mutation", "tool": "aws_ecs_update_service", "parameters": {...}}
  NEVER guess a numeric value (desiredCount, etc.) the operator didn't literally state — "scale down"/"scale up" alone with no number is NOT enough to act on, even if 0 or some other value seems like a reasonable default. Missing a detail? Emit ONLY: {"action": "clarify", "question": "..."}
  Operator explicitly says override the budget/proceed anyway after a budget-cap denial? Re-emit the same propose_mutation with "budgetOverride": true added — never add it unsolicited.
- You cannot sign or execute approvals no matter what's said here. If asked to "approve"/"do it" after you proposed a mutation, say sign-off only happens on the Approvals page, citing the approval ID — don't claim to have done it.
- Otherwise: plain prose, no JSON, 2-3 short paragraphs or bullets max.

Read-only tools:
${readToolList}

Mutation tools:
${mutationToolList}`;

    // The underlying model/provider occasionally returns something that
    // isn't a real answer at all: an empty string, a malformed internal
    // tool-calling artifact ("Model generated invalid tool call: ..."), or
    // the inference CLI's own transport-layer error text ("API call failed
    // after N retries: Service temporarily overloaded") surfacing as if it
    // were the model's actual response. All three have been observed in
    // production, none reproducible on demand — treated identically as a
    // failed generation worth one retry rather than shown to the operator
    // as if it were a real, honest answer.
    const looksLikeFailedGeneration = (text: string): boolean =>
      !text || !text.trim() ||
      /model generated invalid tool call/i.test(text) ||
      /api call failed after \d+ retries/i.test(text) ||
      /service (is )?temporarily overloaded/i.test(text) ||
      /rate limit(ed)?/i.test(text);

    try {
      const runInference = async (promptText: string): Promise<string> => {
        if (typeof (localAdapter as any).executeHermesInference === "function") {
          return (localAdapter as any).executeHermesInference(promptText, 45000);
        }
        // The resolved adapter has no direct-inference capability of its own
        // (e.g. a mock or a future non-Hermes runtime) — this falls back to
        // Hermes specifically rather than degrading gracefully. That's a
        // real gap for Phase 3.1 to close, not something papered over here.
        const fallbackAdapter = createAgentAdapter("hermes") as any;
        return fallbackAdapter.executeHermesInference(promptText, 45000);
      };

      // A hung/timed-out Hermes process throws (SIGTERM after 45s with zero
      // output) rather than resolving with empty text — that used to bypass
      // the retry below entirely and fall straight to the 500 handler on a
      // single slow provider response. Treat a throw the same as empty
      // output: worth exactly one retry before giving up honestly.
      const runInferenceSafe = async (promptText: string): Promise<string> => {
        try {
          return await runInference(promptText);
        } catch (err) {
          request.log.warn({ err }, "Inference call threw (likely a timeout) — treating as empty for retry purposes");
          return "";
        }
      };

      let responseText = await runInferenceSafe(agentPrompt);
      if (looksLikeFailedGeneration(responseText)) {
        request.log.warn({ agentId: effectiveAgentId }, "Failed/empty inference output, retrying once");
        responseText = await runInferenceSafe(agentPrompt);
      }
      if (looksLikeFailedGeneration(responseText)) {
        return reply.status(200).send({
          response: "The reasoning model didn't return a usable response for that — could you try rephrasing or asking again?",
          toolCalls,
          model: discoveredModel,
          provider: discoveredProvider,
          agentName,
          timestamp: new Date().toISOString()
        });
      }

      const actionResult = await resolveChatAction({
        rawResponse: responseText.trim(),
        operatorPrompt: prompt,
        tenantId: operator.tenantId,
        agentId: effectiveAgentId,
        discoveredWorkloads,
        authorizedCapabilities,
        policyEngine,
        approvalService,
        tenantService
      });

      let finalText = actionResult.text;
      const actionToolCalls = actionResult.toolCalls;

      // A read_tool_call fetched real data but hasn't been turned into an
      // answer yet — do a second, tool-free inference pass so the operator
      // gets a real prose answer grounded in that data, not a raw JSON blob.
      if (actionResult.readToolResult) {
        const synthesisPrompt = `You are ${agentName} (${discoveredModel}), answering a follow-up in the same conversation.

Operator asked: "${prompt}"

You just called the real tool "${actionResult.readToolResult.toolName}" and got this live result:
${JSON.stringify(actionResult.readToolResult.result, null, 2)}

Answer the operator's question using only this real data. Respond in plain prose only — no JSON, no markdown code fences. If this data doesn't actually contain the answer to their question, say so honestly rather than guessing. Keep it to 2-3 short sentences or a short bullet list.`;

        let synthesisText = await runInferenceSafe(synthesisPrompt);
        if (looksLikeFailedGeneration(synthesisText)) {
          synthesisText = await runInferenceSafe(synthesisPrompt);
        }
        finalText = looksLikeFailedGeneration(synthesisText)
          ? `Here's the raw data I fetched from ${actionResult.readToolResult.toolName} (couldn't summarize it just now): ${JSON.stringify(actionResult.readToolResult.result)}`
          : synthesisText.trim();
      }

      return reply.status(200).send({
        response: finalText,
        toolCalls: [...toolCalls, ...actionToolCalls],
        pendingApproval: actionResult.pendingApproval,
        model: discoveredModel,
        provider: discoveredProvider,
        agentName,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      // A failed subprocess (e.g. the Hermes CLI) attaches its full stdout —
      // which can include internal plugin-registration traces, unrelated
      // toolset output, or worse — directly onto err.message. That must
      // never reach the client as-is; log the full detail server-side only,
      // and send back a short, generic message.
      request.log.error({ err }, "Agent chat inference error");
      return reply.status(500).send({
        error: {
          code: "AGENT_INFERENCE_ERROR",
          message: "Failed to execute agent inference — the reasoning model or its runtime hit an error. Check server logs for detail."
        }
      });
    }
  });
};
