import { randomBytes } from "crypto";

export interface DefenseClawEvalRequest {
  correlationId: string;
  agentId: string;
  tenantId: string;
  capability: string;
  arguments: Record<string, unknown>;
  grantedCapabilities?: string[] | undefined;
  traceparent?: string | undefined;
  approvalGranted?: boolean | undefined;
  budgetOverride?: boolean | undefined;
  resourceTenant?: string | undefined;
}

export interface DefenseClawEvalResponse {
  allowed: boolean;
  verdict: "ALLOW" | "BLOCK" | "APPROVAL_REQUIRED";
  reason: string;
  ruleId?: string | undefined;
  auditEvent: any; // v7 GatewayEventEnvelope
}

export interface DefenseClawClientConfig {
  endpoint?: string | undefined;
  timeoutMs?: number | undefined;
}

export function generateTraceparent(): string {
  const traceId = randomBytes(16).toString("hex");
  const parentId = randomBytes(8).toString("hex");
  return `00-${traceId}-${parentId}-01`;
}

export function isValidTraceparent(tp?: string): boolean {
  if (!tp) return false;
  return /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(tp);
}

export class DefenseClawClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(config: DefenseClawClientConfig = {}) {
    this.endpoint = config.endpoint || process.env.DEFENSECLAW_ENDPOINT || "http://localhost:8080/v1/evaluate";
    this.timeoutMs = config.timeoutMs ?? 5000;
  }

  async evaluate(req: DefenseClawEvalRequest): Promise<DefenseClawEvalResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "traceparent": req.traceparent || ""
        },
        body: JSON.stringify({
          correlation_id: req.correlationId,
          agent_id: req.agentId,
          tenant_id: req.tenantId,
          capability: req.capability,
          arguments: req.arguments,
          granted_capabilities: req.grantedCapabilities,
          traceparent: req.traceparent,
          approval_granted: req.approvalGranted,
          budget_override: req.budgetOverride,
          resource_tenant: req.resourceTenant || (req.arguments?.tenant_id as string) || req.tenantId
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`DefenseClaw HTTP ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as any;
      return {
        allowed: Boolean(data.allowed),
        verdict: data.verdict || (data.allowed ? "ALLOW" : "BLOCK"),
        reason: data.reason || "Policy evaluated",
        ruleId: data.rule_id,
        auditEvent: data.audit_event
      };
    } catch (err: any) {
      clearTimeout(timeout);
      // Fail-closed: block on DefenseClaw unavailable
      return {
        allowed: false,
        verdict: "BLOCK",
        reason: `DefenseClaw evaluation failed: ${err.message}`,
        ruleId: "DEFENSECLAW_UNAVAILABLE",
        auditEvent: null
      };
    }
  }
}

