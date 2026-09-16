/**
 * @cloudops/adapters
 * Multi-Cloud Provider Adapters and AWS STS Connection Module
 */
export * from "./awsStsService.js";
export * from "./awsSessionManager.js";
export * from "./cloudAccountRepository.js";
export * from "./cloudAccountService.js";
export * from "./awsDiscoveryService.js";
export * from "./awsIncidentEnvironment.js";
export * from "./incidentService.js";
export * from "./remediationVerificationService.js";

import type { CloudProvider } from "@cloudops/shared";

export interface CloudProviderAdapter {
  readonly provider: CloudProvider;
  executeOperation(operation: string, parameters: Record<string, unknown>, credentials: unknown): Promise<unknown>;
}
