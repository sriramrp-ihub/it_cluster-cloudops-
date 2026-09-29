import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CANONICAL_TOOLS, expandCanonicalCapabilities, type CanonicalToolDefinition, type ToolExecutionContext } from "./registry.js";
import { captureSnapshotForRevert } from "./revertPlanner.js";
import { ApprovalService } from "@cloudops/approvals";
import { PolicyEngine, PolicyFencingService, BlastRadiusSimulator } from "@cloudops/policy";
import { TenantService } from "@cloudops/auth";
import { RunService, ToolExecutionService } from "@cloudops/adapters";
import { recordAuditEvent } from "@cloudops/runtime";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface CloudOpsMcpServerOptions {
  agentId: string;
  tenantId: string;
  authorizedCapabilities?: string[] | undefined;
  approvalService?: ApprovalService | undefined;
  policyEngine?: PolicyEngine | undefined;
  runService?: RunService | undefined;
  toolExecutionService?: ToolExecutionService | undefined;
  /**
   * ADR-0008 Phase B (§4.4): the investigation run every tool_executions/
   * audit_events row this connection produces should be attributed to.
   * Optional because most callers of this server (an SSE connection
   * authenticated by a runtime credential, in `apps/api/src/routes/mcp.ts`)
   * don't necessarily know at connect-time which run — if any — the Hermes
   * process on the other end is about to drive. When omitted, each tool
   * call resolves its own run lazily via `RunService.findActiveRunId()` and
   * caches the result for the lifetime of this server instance (one
   * instance per SSE connection — see mcp.ts — which in practice means one
   * instance per Hermes CLI invocation, i.e. per investigation attempt, so
   * caching the first resolution is correct, not just an optimization: the
   * ADR's own modeling is "at most one active run per investigation
   * session"). If no active run is found (e.g. a bare `/v1/agents/:id/test`
   * connectivity probe with no investigation in flight), tool_executions
   * persistence is skipped for that call — its schema requires a non-null
   * run_id — but audit_events is still recorded with a null run_id, since
   * that table already tolerates one and losing run-level correlation is
   * preferable to losing the audit trail entirely.
   */
  runId?: string | undefined;
}

export class CloudOpsMcpServer {
  private server: McpServer;
  private approvalService: ApprovalService;
  private policyEngine: PolicyEngine;
  private policyFencingService: PolicyFencingService;
  private tenantService: TenantService;
  private runService: RunService;
  private toolExecutionService: ToolExecutionService;
  private agentId: string;
  private tenantId: string;
  private authorizedCapabilities: string[] | null;
  private readonly explicitRunId: string | undefined;
  private resolvedRunId: Promise<string | undefined> | null = null;

  constructor(opts: CloudOpsMcpServerOptions) {
    this.server = new McpServer({
      name: "CloudOps-Control-Plane",
      version: "0.1.0"
    });
    this.approvalService = opts.approvalService || new ApprovalService();
    this.policyEngine = opts.policyEngine || new PolicyEngine();
    this.policyFencingService = new PolicyFencingService();
    this.tenantService = new TenantService();
    this.runService = opts.runService || new RunService();
    this.toolExecutionService = opts.toolExecutionService || new ToolExecutionService();
    this.agentId = opts.agentId;
    this.tenantId = opts.tenantId;
    this.explicitRunId = opts.runId;
    // Capabilities may arrive over the wire in either naming convention (an
    // external MCP client's x-capabilities header, the stdio bridge's
    // CLOUDOPS_CAPABILITIES env var) — normalize once here so exact-match
    // capability checks below and the PolicyEngine.evaluate() call don't
    // silently reject a legitimately-granted capability declared in the
    // "other" form.
    this.authorizedCapabilities = opts.authorizedCapabilities
      ? expandCanonicalCapabilities(opts.authorizedCapabilities)
      : null;

    this.registerAuthorizedTools();
  }

  /**
   * Resolves (and caches) the run this connection's tool calls should be
   * attributed to. Never throws — a lookup failure resolves to `undefined`,
   * the same as "no active run found", so a transient DB error here can
   * never break tool execution itself (see the `record()` closure below,
   * which already treats a missing run id as "skip tool_executions, still
   * audit").
   */
  private resolveRunId(): Promise<string | undefined> {
    if (this.explicitRunId) {
      return Promise.resolve(this.explicitRunId);
    }
    if (!this.resolvedRunId) {
      this.resolvedRunId = this.runService
        .findActiveRunId(this.tenantId, this.agentId)
        .then((id) => id ?? undefined)
        .catch(() => undefined);
    }
    return this.resolvedRunId;
  }

  public isCapabilityAuthorized(requiredCapability: string): boolean {
    if (this.authorizedCapabilities === null || this.authorizedCapabilities.includes("*")) {
      return true;
    }
    return this.authorizedCapabilities.includes(requiredCapability);
  }

  private registerAuthorizedTools() {
    for (const tool of CANONICAL_TOOLS) {
      // Enforce strict capability authorization check
      if (!this.isCapabilityAuthorized(tool.requiredCapability)) {
        continue;
      }

      const shape = tool.inputSchema instanceof z.ZodObject ? tool.inputSchema.shape : {};

      this.server.tool(
        tool.name,
        tool.description,
        shape,
        async (args: any) => {
          const startedAt = Date.now();

          // ADR-0008 Phase B (§4.4): moved here from investigations.ts's
          // TypeScript-side buildToolCallHandler() — that shim persisted
          // tool_executions/audit_events for calls IT drove, but a Hermes
          // adaptive loop talking to this MCP server directly over SSE never
          // touches that shim at all. This is now the one place every caller
          // of this server (an adaptive investigation, the /v1/agents/:id/test
          // probe, any future external MCP client) gets identical, complete
          // tracing, right alongside the policyEngine.evaluate() call below.
          //
          // reasoningSnippet is always undefined here: the MCP protocol's
          // CallToolRequest carries no reasoning-equivalent field (checked
          // against the installed SDK's CallToolRequestParamsSchema and
          // RequestHandlerExtra — both carry only _meta's standard
          // progressToken/related-task keys, nothing for a caller's
          // rationale). See HermesAgentAdapter.runAdaptiveInvestigation()'s
          // investigationNarrative handling for how Phase B recovers an
          // equivalent narrative after the fact instead.
          const record = async (status: string, outputPayload: unknown, errorMessage?: string) => {
            const runId = await this.resolveRunId();
            const auditPayload: Record<string, unknown> = {
              toolName: tool.name,
              verdict: status
            };
            if (outputPayload && typeof outputPayload === "object") {
              const o = outputPayload as Record<string, unknown>;
              if ("ruleId" in o) auditPayload.ruleId = o.ruleId;
              if ("reason" in o) auditPayload.reason = o.reason;
            }
            if (errorMessage) auditPayload.errorMessage = errorMessage;

            await Promise.all([
              runId
                ? this.toolExecutionService
                    .recordExecution({
                      runId,
                      agentId: this.agentId,
                      toolName: tool.name,
                      inputPayload: args || {},
                      outputPayload,
                      status,
                      durationMs: Date.now() - startedAt,
                      errorMessage,
                      reasoningSnippet: undefined,
                      evidenceRefs: []
                    })
                    .catch(() => {
                      // Never let observability persistence break tool execution itself.
                    })
                : Promise.resolve(),
              recordAuditEvent({
                tenantId: this.tenantId,
                agentId: this.agentId,
                runId,
                eventType: `TOOL_CALL_${status}`,
                actorType: "AGENT",
                actorId: this.agentId,
                payload: auditPayload
              }).catch(() => {})
            ]);
          };

          const resolvedRunId = await this.resolveRunId();
          const ctx: ToolExecutionContext = {
            agentId: this.agentId,
            tenantId: this.tenantId,
            ...(resolvedRunId !== undefined ? { runId: resolvedRunId } : {})
          };

          // 1. Unified Policy Engine Evaluation (IaC Gate -> DefenseClaw -> Scope Fencing -> Classification)
          const tenantMonthlyBudgetLimitUsd = await this.tenantService
            .getBudget(this.tenantId)
            .then((b) => b.monthlyBudgetLimitUsd)
            .catch(() => undefined);
          const policyResult = await this.policyEngine.evaluate({
            agentId: this.agentId,
            tenantId: this.tenantId,
            toolName: tool.name,
            operationType: tool.operationType || (tool.requiresApproval ? "MUTATION" : "READ_ONLY"),
            arguments: args || {},
            authorizedCapabilities: this.authorizedCapabilities ?? undefined,
            tenantMonthlyBudgetLimitUsd
          });

          if (policyResult.decision === "DENY") {
            await record("DENIED", { ruleId: policyResult.ruleId, reason: policyResult.reason }, policyResult.reason);
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    status: "DENIED",
                    ruleId: policyResult.ruleId,
                    reason: policyResult.reason,
                    requiresBudgetOverride: policyResult.requiresBudgetOverride ?? false
                  }, null, 2)
                }
              ]
            };
          }

          // 2. If high-risk mutation or deploy, intercept and enforce human approval
          if (tool.requiresApproval) {
            try {
              // Phase 3.4: a live-captured snapshot (via the same
              // aws_ecs_describe_services call any read path uses), not a
              // client-supplied or fabricated placeholder — revert_approval
              // depends on this being the resource's actual prior state.
              // Captured BEFORE simulate() so cost estimation can use the
              // real current cpu/memory instead of assuming Fargate defaults.
              const previousStateSnapshot = await captureSnapshotForRevert(tool.name, args || {}, ctx);
              const dryRunDiff = BlastRadiusSimulator.simulate(tool.name, args || {}, previousStateSnapshot || undefined);
              if (policyResult.budgetLimitUsd !== undefined) {
                dryRunDiff.budgetCapExceeded = dryRunDiff.estimatedMonthlyCostUsd > policyResult.budgetLimitUsd;
              }

              const opType = (tool.operationType as any) || "MUTATION";
              const approval = await this.approvalService.createApprovalRequest({
                tenantId: this.tenantId as any,
                agentId: this.agentId as any,
                toolName: tool.name,
                rawPayload: args || {},
                operationType: opType,
                dryRunDiff,
                previousStateSnapshot
              });

              await record("AWAITING_APPROVAL", { approvalId: approval.id, dryRunDiff });

              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify({
                      status: "AWAITING_APPROVAL",
                      approvalId: approval.id,
                      tool: tool.name,
                      operationType: opType,
                      dryRunDiff,
                      message: `Operation '${tool.name}' (${opType}) is a high-risk mutation and requires human operator approval. A pending approval request (${approval.id}) has been created with pre-execution dry-run diff. Execution paused pending operator sign-off.`
                    }, null, 2)
                  }
                ]
              };
            } catch (err: any) {
              await record("ERROR", { error: err?.message }, err?.message || "Approval interception error");
              return {
                isError: true,
                content: [
                  {
                    type: "text" as const,
                    text: `Approval interception error: ${err.message}`
                  }
                ]
              };
            }
          }

          // Execute read-only tool
          try {
            const output = await tool.handler(args, ctx);
            await record("SUCCESS", output);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(output, null, 2)
                }
              ]
            };
          } catch (err: any) {
            await record("ERROR", { error: err?.message }, err?.message || "Tool execution failed");
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: `Tool execution failed: ${err.message}`
                }
              ]
            };
          }
        }
      );
    }
  }

  getMcpServer(): McpServer {
    return this.server;
  }

  async connect(transport: Transport): Promise<void> {
    await this.server.connect(transport);
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}
