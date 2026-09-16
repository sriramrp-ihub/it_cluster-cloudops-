import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CloudOpsMcpServer } from "@cloudops/tools";

export interface McpStdioBridgeOptions {
  agentId?: string | undefined;
  tenantId?: string | undefined;
  authorizedCapabilities?: string[] | undefined;
}

/**
 * Runs the CloudOps MCP Server over standard I/O (stdio).
 * Enables any external agent runtime (Hermes, Claude Desktop, Cursor, OpenClaw)
 * to connect directly via JSON-RPC.
 */
export async function runMcpStdioBridge(opts: McpStdioBridgeOptions = {}): Promise<CloudOpsMcpServer> {
  const agentId = opts.agentId || process.env.CLOUDOPS_AGENT_ID || "ag_mcp_standalone";
  const tenantId = opts.tenantId || process.env.CLOUDOPS_TENANT_ID || "ten_default_tenant";

  const serverOpts: {
    agentId: string;
    tenantId: string;
    authorizedCapabilities?: string[] | undefined;
  } = {
    agentId,
    tenantId
  };

  if (opts.authorizedCapabilities) {
    serverOpts.authorizedCapabilities = opts.authorizedCapabilities;
  } else if (process.env.CLOUDOPS_CAPABILITIES) {
    serverOpts.authorizedCapabilities = process.env.CLOUDOPS_CAPABILITIES.split(",").map((c) => c.trim()).filter(Boolean);
  } else {
    // Default authorized canonical capabilities for governed agent inspection
    serverOpts.authorizedCapabilities = [
      "aws.ecs.describe_clusters",
      "aws.ecs.describe_services",
      "aws.ecs.describe_stopped_tasks",
      "aws.ecs.list_tasks",
      "aws.cloudwatch.get_metric_data",
      "aws.logs.filter_log_events",
      "aws.ecs.update_service",
      "aws.ecs.rollback_service"
    ];
  }

  const server = new CloudOpsMcpServer(serverOpts);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return server;
}
