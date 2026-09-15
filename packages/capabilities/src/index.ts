/**
 * @cloudops/capabilities
 * Placeholder package for Capability Authorization (Phase 5).
 * Invariant: Authorized Capabilities ⊆ Declared Capabilities.
 */
import type { AgentId } from "@cloudops/shared";

export interface CapabilityDefinition {
  id: string;
  name: string;
  provider: string;
  service: string;
  action: string;
  riskLevel: string;
}

export interface CapabilityProfile {
  agentId: AgentId;
  declaredCapabilities: string[];
  authorizedCapabilities: string[];
}
