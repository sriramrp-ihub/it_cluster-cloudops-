import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { loadPolicy } from "@open-policy-agent/opa-wasm";

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

export interface CapabilityRequestPayload {
  agent_id: string;
  tenant_id: string;
  capability: string;
  arguments?: Record<string, unknown> | undefined;
  granted_capabilities?: string[] | undefined;
  approval_granted?: boolean | undefined;
  resource_tenant?: string | undefined;
  budget_override?: boolean | undefined;
  traceparent?: string | undefined;
  correlation_id?: string | undefined;
}

export interface PolicyVerdict {
  verdict: "ALLOW" | "BLOCK" | "APPROVAL_REQUIRED";
  rule_id: string;
  reason: string;
}

/**
 * Module-scoped OPA-WASM policy loader.
 * Loads cloudops_policy.wasm once to eliminate per-call load latency (~20–80ms).
 */
let policyPromise: Promise<any> | null = null;

function resolveWasmPath(): string {
  try {
    const candidate1 = fileURLToPath(new URL("./cloudops_policy.wasm", import.meta.url));
    if (fs.existsSync(candidate1)) {
      return candidate1;
    }
  } catch {
    // Ignore error if import.meta.url is not available or non-file
  }

  const candidate2 = path.resolve(process.cwd(), "packages/security/src/cloudops_policy.wasm");
  if (fs.existsSync(candidate2)) {
    return candidate2;
  }

  const candidate3 = path.resolve(process.cwd(), "packages/security/dist/cloudops_policy.wasm");
  if (fs.existsSync(candidate3)) {
    return candidate3;
  }

  throw new Error(
    "cloudops_policy.wasm not found. Please run `scripts/build-rego-wasm.sh` before running in-process policy evaluations."
  );
}

function getPolicy(): Promise<any> {
  if (!policyPromise) {
    const wasmPath = resolveWasmPath();
    const wasmBuffer = fs.readFileSync(wasmPath);
    policyPromise = loadPolicy(wasmBuffer);
  }
  return policyPromise;
}

// Warm the module-scope policy cache asynchronously at startup
getPolicy().catch(() => {
  // If the wasm is not yet compiled at import time (e.g. during build pre-check), defer until evaluateInProcess() is called.
});

/**
 * In-process OPA-WASM policy evaluator.
 * Evaluates against the exact same Rego bundle used by the external DefenseClaw gateway.
 */
export async function evaluateInProcess(payload: CapabilityRequestPayload): Promise<PolicyVerdict> {
  const policy = await getPolicy();

  const rawGranted = payload.granted_capabilities ?? [];
  const expandedGranted = new Set<string>();
  for (const cap of rawGranted) {
    expandedGranted.add(cap);
    if (cap.includes(".")) {
      expandedGranted.add(cap.replace(/\./g, "_"));
    }
    if (cap.includes("_")) {
      expandedGranted.add(cap.replace(/_/g, "."));
    }
  }

  const resourceTenant = payload.resource_tenant || payload.tenant_id;
  const input = {
    agent_id: payload.agent_id,
    tenant_id: payload.tenant_id,
    agent_tenant: payload.tenant_id,
    resource_tenant: resourceTenant,
    capability: payload.capability,
    arguments: payload.arguments ?? {},
    granted_capabilities: Array.from(expandedGranted),
    approval_granted: Boolean(payload.approval_granted),
    budget_override: Boolean(payload.budget_override),
    traceparent: payload.traceparent ?? "",
    timestamp: new Date().toISOString(),
  };

  const vRes = policy.evaluate(input, "cloudops/authz/verdict");
  const rRes = policy.evaluate(input, "cloudops/authz/rule_id");
  const reRes = policy.evaluate(input, "cloudops/authz/reason");

  const verdict = (vRes?.[0]?.result ?? "BLOCK") as PolicyVerdict["verdict"];
  let rule_id = (rRes?.[0]?.result ?? "") as string;
  let reason = (reRes?.[0]?.result ?? "Policy evaluation failed") as string;

  if (verdict === "BLOCK" && !rule_id) {
    rule_id = "UNCLASSIFIED_CAPABILITY_BLOCKED";
  }

  return {
    verdict,
    rule_id,
    reason,
  };
}

/**
 * Built-in DefenseClaw Guardrail Service for Cloud Operations.
 * Uses in-process OPA-WASM evaluation against the canonical Rego bundle.
 * The previous hand-maintained HIGH_RISK_DESTRUCTIVE_PATTERNS regex array has been deleted.
 */
export class DefenseClawGuardrailService {
  private auditEvents: DefenseClawAuditEvent[] = [];

  /**
   * Evaluates an agent tool call against DefenseClaw security policies and guardrails.
   */
  async inspectToolCall(ctx: DefenseClawInspectionContext): Promise<DefenseClawVerdict> {
    const policyResult = await evaluateInProcess({
      agent_id: ctx.agentId,
      tenant_id: ctx.tenantId,
      capability: ctx.toolName,
      arguments: ctx.arguments,
      granted_capabilities: ctx.grantedCapabilities,
      approval_granted: false,
    });

    const violations: string[] = [];
    let riskScore = 0.1;

    if (policyResult.verdict === "BLOCK" || policyResult.verdict === "APPROVAL_REQUIRED") {
      let violationCode = policyResult.rule_id || "POLICY_VIOLATION";

      // Maintain backward-compatible violation strings expected by callers and audit trail
      if (violationCode === "DESTRUCTIVE_ACTION_BLOCKED") {
        violationCode = "DESTRUCTIVE_ACTION_FORBIDDEN";
        riskScore = 0.95;
      } else if (violationCode === "CAPABILITY_NOT_GRANTED") {
        violationCode = "CAPABILITY_BOUNDARY_VIOLATION";
        riskScore = 0.85;
      } else if (policyResult.verdict === "APPROVAL_REQUIRED") {
        riskScore = 0.5;
      } else {
        riskScore = 0.9;
      }

      violations.push(`Triggered guardrail: ${violationCode} (${policyResult.reason})`);

      // If a capability is also outside granted scope, record boundary violation for callers inspecting scope
      if (ctx.grantedCapabilities && ctx.grantedCapabilities.length > 0) {
        const normalizedTool = ctx.toolName.replace(/[\._]/g, "");
        const isGranted = ctx.grantedCapabilities.some(
          (cap) => cap.replace(/[\._]/g, "") === normalizedTool
        );
        if (!isGranted && violationCode !== "CAPABILITY_BOUNDARY_VIOLATION") {
          violations.push(
            `Triggered guardrail: CAPABILITY_BOUNDARY_VIOLATION (${ctx.toolName} not in granted scope)`
          );
        }
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
      reason: isBlocked ? violations.join("; ") : policyResult.reason || "Passed all DefenseClaw security checks",
    };

    this.auditEvents.push(auditEvent);

    return {
      allowed: !isBlocked,
      action,
      guardrailViolations: violations,
      riskScore,
      auditEvidence: auditEvent,
    };
  }

  getAuditTrail(): DefenseClawAuditEvent[] {
    return [...this.auditEvents];
  }

  clearAuditTrail(): void {
    this.auditEvents = [];
  }
}
