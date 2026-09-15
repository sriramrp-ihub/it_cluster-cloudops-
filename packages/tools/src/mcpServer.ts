import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CANONICAL_TOOLS, type CanonicalToolDefinition, type ToolExecutionContext } from "./registry.js";
import { ApprovalService } from "@cloudops/approvals";
import { PolicyFencingService, BlastRadiusSimulator } from "@cloudops/policy";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface CloudOpsMcpServerOptions {
  agentId: string;
  tenantId: string;
  authorizedCapabilities?: string[] | undefined;
  approvalService?: ApprovalService | undefined;
}

export class CloudOpsMcpServer {
  private server: McpServer;
  private approvalService: ApprovalService;
  private policyFencingService: PolicyFencingService;
  private agentId: string;
  private tenantId: string;
  private authorizedCapabilities: string[] | null;

  constructor(opts: CloudOpsMcpServerOptions) {
    this.server = new McpServer({
      name: "CloudOps-Control-Plane",
      version: "0.1.0"
    });
    this.approvalService = opts.approvalService || new ApprovalService();
    this.policyFencingService = new PolicyFencingService();
    this.agentId = opts.agentId;
    this.tenantId = opts.tenantId;
    this.authorizedCapabilities = opts.authorizedCapabilities ?? null;

    this.registerAuthorizedTools();
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
          const ctx: ToolExecutionContext = {
            agentId: this.agentId,
            tenantId: this.tenantId
          };

          // 1. Dynamic Policy Fencing Check (runs before approval queueing)
          const fencingResult = this.policyFencingService.evaluateFencing({
            agentId: this.agentId,
            tenantId: this.tenantId,
            toolName: tool.name,
            operationType: tool.operationType || (tool.requiresApproval ? "MUTATION" : "READ_ONLY"),
            arguments: args || {},
            authorizedCapabilities: this.authorizedCapabilities ?? undefined
          });

          if (fencingResult.decision === "DENY") {
            return {
              isError: true,
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    status: "DENIED",
                    ruleId: fencingResult.ruleId,
                    reason: fencingResult.reason,
                    requiresBudgetOverride: fencingResult.requiresBudgetOverride ?? false
                  }, null, 2)
                }
              ]
            };
          }

          // 2. If high-risk mutation or deploy, intercept and enforce human approval
          if (tool.requiresApproval) {
            try {
              const dryRunDiff = BlastRadiusSimulator.simulate(tool.name, args || {});
              const previousStateSnapshot = tool.name === "aws_ecs_deploy_service"
                ? {
                    taskDefinition: args.previousTaskDefinition || `arn:aws:ecs:${args.region || "us-east-1"}:123456789012:task-definition/${args.service || "app"}:prior`,
                    desiredCount: args.desiredCount || 2
                  }
                : null;

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
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(output, null, 2)
                }
              ]
            };
          } catch (err: any) {
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
