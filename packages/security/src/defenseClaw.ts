import type { RiskLevel } from "@cloudops/shared";

export interface DefenseClawInspectionContext {
  agentId: string;
  tenantId: string;
  sessionId?: string | undefined;
  toolName: string;
  arguments: Record<string, unknown>;
  grantedCapabilities?: string[] | undefined;
}

export interface DefenseClawAuditEvent {
  eventId: string;
  timestamp: string;
  action: "ALLOW" | "BLOCK" | "INTERCEPTED";
  agentId: string;
  tenantId: string;
  toolName: string;
  guardrailTriggered?: string | undefined;
  riskScore: number;
  reason: string;
}

export interface DefenseClawVerdict {
  allowed: boolean;
  action: "ALLOW" | "BLOCK";
  guardrailViolations: string[];
  riskScore: number;
  auditEvidence: DefenseClawAuditEvent;
}

/**
 * Built-in DefenseClaw Guardrail Patterns for Cloud Operations.
 */
const HIGH_RISK_DESTRUCTIVE_PATTERNS = [
  /delete_db_instance/i,
  /terminate_instances/i,
  /delete_cluster/i,
  /delete_bucket/i,
  /rm\s+-rf/i,
  /drop\s+table/i,
  /drop\s+database/i,
  /admin_escalation/i
];

export class DefenseClawGuardrailService {
  private auditEvents: DefenseClawAuditEvent[] = [];

  /**
   * Evaluates an agent tool call against DefenseClaw security policies and guardrails.
   */
  async inspectToolCall(ctx: DefenseClawInspectionContext): Promise<DefenseClawVerdict> {
    const violations: string[] = [];
    let riskScore = 0.1;

    // Guardrail 1: Check destructive tool names or parameter patterns
    const serializedArgs = JSON.stringify(ctx.arguments);
    for (const pattern of HIGH_RISK_DESTRUCTIVE_PATTERNS) {
      if (pattern.test(ctx.toolName) || pattern.test(serializedArgs)) {
        violations.push(`Triggered guardrail: DESTRUCTIVE_ACTION_FORBIDDEN (${pattern.source})`);
        riskScore = 0.95;
      }
    }

    // Guardrail 2: Check capability bounds if grantedCapabilities provided
    if (ctx.grantedCapabilities && ctx.grantedCapabilities.length > 0) {
      const normalizedTool = ctx.toolName.replace(/[\._]/g, "");
      const isGranted = ctx.grantedCapabilities.some(
        (cap) => cap.replace(/[\._]/g, "") === normalizedTool
      );
      if (!isGranted) {
        violations.push(`Triggered guardrail: CAPABILITY_BOUNDARY_VIOLATION (${ctx.toolName} not in granted scope)`);
        riskScore = Math.max(riskScore, 0.85);
      }
    }

    const isBlocked = violations.length > 0;
    const action = isBlocked ? "BLOCK" : "ALLOW";

    const auditEvent: DefenseClawAuditEvent = {
      eventId: `dc_evt_${Math.random().toString(36).substring(2, 10)}`,
      timestamp: new Date().toISOString(),
      action: isBlocked ? "INTERCEPTED" : "ALLOW",
      agentId: ctx.agentId,
      tenantId: ctx.tenantId,
      toolName: ctx.toolName,
      guardrailTriggered: violations[0],
      riskScore,
      reason: isBlocked ? violations.join("; ") : "Passed all DefenseClaw security checks"
    };

    this.auditEvents.push(auditEvent);

    return {
      allowed: !isBlocked,
      action,
      guardrailViolations: violations,
      riskScore,
      auditEvidence: auditEvent
    };
  }

  getAuditTrail(): DefenseClawAuditEvent[] {
    return [...this.auditEvents];
  }

  clearAuditTrail(): void {
    this.auditEvents = [];
  }
}
