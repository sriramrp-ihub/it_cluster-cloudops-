/**
 * @cloudops/security
 * DefenseClaw Integration and Security Guardrails.
 */
export * from "./defenseClaw.js";

export interface SecurityCheckResult {
  passed: boolean;
  violations: string[];
  riskScore: number;
}
