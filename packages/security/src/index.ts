/**
 * @cloudops/security
 * Placeholder package for DefenseClaw Integration and Security Guardrails (Phase 5).
 */
export interface SecurityCheckResult {
  passed: boolean;
  violations: string[];
  riskScore: number;
}
