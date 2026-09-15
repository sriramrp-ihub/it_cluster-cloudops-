/**
 * @cloudops/tools
 * Canonical Tool Contracts, Registry, and Governed MCP Server.
 */
export * from "./registry.js";
export * from "./mcpServer.js";

import type { RiskLevel, ToolOperationType } from "@cloudops/shared";
import type { ZodType } from "zod";

export interface ToolContract<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  operationType: ToolOperationType;
  riskLevel: RiskLevel;
  requiredCapability: string;
  inputSchema: ZodType<TInput>;
  outputSchema: ZodType<TOutput>;
}
