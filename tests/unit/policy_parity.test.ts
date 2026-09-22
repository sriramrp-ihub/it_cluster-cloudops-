/**
 * Phase 0 — Task 0.5: Policy-parity test skeleton
 *
 * PURPOSE
 * -------
 * This file is the CI gate for Phase 1.1's "done when" criterion:
 *   "In-process check and the external DefenseClaw gateway evaluate from
 *    the same policy source; CI fails if they diverge."
 *
 * HOW TO USE
 * ----------
 * 1. Phase 1.1 implements `evaluateInProcess(payload)` using OPA-WASM loaded
 *    from defence_claw/defenseclaw/policies/rego/cloudops/.
 * 2. Remove the `.skip` modifier from each `describe.skip` block when ready.
 * 3. External DefenseClaw must be running for Suites B and C.
 *
 * CURRENT STATUS: Suites A/B/C are SKIPPED. Suite D runs now as a sanity check.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CapabilityRequestPayload {
  agent_id: string;
  tenant_id: string;
  capability: string;
  arguments: Record<string, unknown>;
  granted_capabilities: string[];
  approval_granted: boolean;
  resource_tenant: string;
}

interface PolicyVerdict {
  verdict: "ALLOW" | "BLOCK" | "APPROVAL_REQUIRED";
  rule_id: string;
}

/**
 * STUB — Phase 1.1 replaces with real OPA-WASM in-process evaluator.
 * Loaded from: defence_claw/defenseclaw/policies/rego/cloudops/
 */
async function evaluateInProcess(_payload: CapabilityRequestPayload): Promise<PolicyVerdict> {
  throw new Error(
    "NOT_IMPLEMENTED: evaluateInProcess() is the Phase 1.1 deliverable. " +
    "Implement via @open-policy-agent/opa-wasm loaded from the Rego bundle."
  );
}

/**
 * Calls the external DefenseClaw Go gateway.
 * Requires DEFENSECLAW_ENDPOINT (default: http://localhost:8080/v1/evaluate).
 */
async function evaluateExternal(payload: CapabilityRequestPayload): Promise<PolicyVerdict> {
  const endpoint = process.env.DEFENSECLAW_ENDPOINT ?? "http://localhost:8080/v1/evaluate";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ correlation_id: "parity-test", ...payload }),
  });
  if (!res.ok) {
    throw new Error(`DefenseClaw HTTP ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { verdict: string; rule_id: string };
  return { verdict: body.verdict as PolicyVerdict["verdict"], rule_id: body.rule_id };
}

// ---------------------------------------------------------------------------
// Representative sample payloads — one per logical branch in main.rego
// ---------------------------------------------------------------------------

const SAMPLE_PAYLOADS: Array<{
  name: string;
  payload: CapabilityRequestPayload;
  expectedVerdict: PolicyVerdict["verdict"];
}> = [
  {
    name: "READ capability within granted scope -> ALLOW",
    payload: {
      agent_id: "ag_parity_test",
      tenant_id: "ten_default_tenant",
      capability: "aws.ecs.describe_services",
      arguments: {},
      granted_capabilities: ["aws.ecs.describe_services"],
      approval_granted: false,
      resource_tenant: "ten_default_tenant",
    },
    expectedVerdict: "ALLOW",
  },
  {
    name: "MUTATE capability, no approval -> APPROVAL_REQUIRED",
    payload: {
      agent_id: "ag_parity_test",
      tenant_id: "ten_default_tenant",
      capability: "aws.ecs.update_service",
      arguments: {},
      granted_capabilities: ["aws.ecs.update_service"],
      approval_granted: false,
      resource_tenant: "ten_default_tenant",
    },
    expectedVerdict: "APPROVAL_REQUIRED",
  },
  {
    name: "MUTATE capability with approval -> ALLOW",
    payload: {
      agent_id: "ag_parity_test",
      tenant_id: "ten_default_tenant",
      capability: "aws.ecs.update_service",
      arguments: {},
      granted_capabilities: ["aws.ecs.update_service"],
      approval_granted: true,
      resource_tenant: "ten_default_tenant",
    },
    expectedVerdict: "ALLOW",
  },
  {
    name: "Capability not in granted scope -> BLOCK",
    payload: {
      agent_id: "ag_parity_test",
      tenant_id: "ten_default_tenant",
      capability: "aws.ecs.delete_cluster",
      arguments: {},
      granted_capabilities: ["aws.ecs.describe_services"],
      approval_granted: false,
      resource_tenant: "ten_default_tenant",
    },
    expectedVerdict: "BLOCK",
  },
  {
    name: "Destructive action without approval -> BLOCK",
    payload: {
      agent_id: "ag_parity_test",
      tenant_id: "ten_default_tenant",
      capability: "aws_ec2_terminate_instances",
      arguments: {},
      granted_capabilities: ["aws_ec2_terminate_instances"],
      approval_granted: false,
      resource_tenant: "ten_default_tenant",
    },
    expectedVerdict: "BLOCK",
  },
  {
    name: "Destructive action WITH approval -> ALLOW",
    payload: {
      agent_id: "ag_parity_test",
      tenant_id: "ten_default_tenant",
      capability: "aws_ec2_terminate_instances",
      arguments: {},
      granted_capabilities: ["aws_ec2_terminate_instances"],
      approval_granted: true,
      resource_tenant: "ten_default_tenant",
    },
    expectedVerdict: "ALLOW",
  },
  {
    name: "Cross-tenant access (resource_tenant differs) -> BLOCK",
    payload: {
      agent_id: "ag_parity_test",
      tenant_id: "ten_default_tenant",
      capability: "aws.ecs.describe_services",
      arguments: {},
      granted_capabilities: ["aws.ecs.describe_services"],
      approval_granted: false,
      resource_tenant: "ten_other_tenant",
    },
    expectedVerdict: "BLOCK",
  },
  {
    name: "Unknown capability (not in any tier) -> BLOCK",
    payload: {
      agent_id: "ag_parity_test",
      tenant_id: "ten_default_tenant",
      capability: "aws.unknown.do_something",
      arguments: {},
      granted_capabilities: ["aws.unknown.do_something"],
      approval_granted: false,
      resource_tenant: "ten_default_tenant",
    },
    expectedVerdict: "BLOCK",
  },
];

// ---------------------------------------------------------------------------
// Suite A: In-process OPA-WASM vs expected verdict (Phase 1.1 — SKIPPED)
// ---------------------------------------------------------------------------

describe.skip("Policy parity — in-process OPA-WASM [Phase 1.1 — remove skip when implemented]", () => {
  for (const { name, payload, expectedVerdict } of SAMPLE_PAYLOADS) {
    it(`[in-process] ${name}`, async () => {
      const result = await evaluateInProcess(payload);
      expect(result.verdict).toBe(expectedVerdict);
    });
  }
});

// ---------------------------------------------------------------------------
// Suite B: External DefenseClaw gateway vs expected verdict (Phase 1.1 — SKIPPED)
// Requires: docker compose up defenseclaw
// ---------------------------------------------------------------------------

describe.skip("Policy parity — external DefenseClaw gateway smoke [Phase 1.1 — remove skip]", () => {
  for (const { name, payload, expectedVerdict } of SAMPLE_PAYLOADS) {
    it(`[external] ${name}`, async () => {
      const result = await evaluateExternal(payload);
      expect(result.verdict).toBe(expectedVerdict);
    });
  }
});

// ---------------------------------------------------------------------------
// Suite C: Parity gate — in-process MUST match external (Phase 1.1 done-when gate)
// ---------------------------------------------------------------------------

describe.skip("Policy parity — in-process === external [Phase 1.1 done-when gate — remove skip]", () => {
  for (const { name, payload } of SAMPLE_PAYLOADS) {
    it(`[parity] ${name}`, async () => {
      const [inProc, external] = await Promise.all([
        evaluateInProcess(payload),
        evaluateExternal(payload),
      ]);
      expect(inProc.verdict).toBe(external.verdict);
      expect(inProc.rule_id).toBe(external.rule_id);
    });
  }
});

// ---------------------------------------------------------------------------
// Suite D: Structural sanity — not skipped, runs now to validate fixture health
// ---------------------------------------------------------------------------

describe("Policy parity — fixture sanity [Phase 0, always runs]", () => {
  it("all sample payloads have required fields", () => {
    for (const { name, payload, expectedVerdict } of SAMPLE_PAYLOADS) {
      expect(payload.agent_id, `${name}: agent_id`).toBeTruthy();
      expect(payload.tenant_id, `${name}: tenant_id`).toBeTruthy();
      expect(payload.capability, `${name}: capability`).toBeTruthy();
      expect(payload.granted_capabilities, `${name}: granted_capabilities`).toBeInstanceOf(Array);
      expect(typeof payload.approval_granted, `${name}: approval_granted`).toBe("boolean");
      expect(typeof payload.resource_tenant, `${name}: resource_tenant`).toBe("string");
      expect(["ALLOW", "BLOCK", "APPROVAL_REQUIRED"]).toContain(expectedVerdict);
    }
    expect(SAMPLE_PAYLOADS.length).toBeGreaterThanOrEqual(8);
  });

  it("sample payloads cover all three verdict outcomes", () => {
    const verdicts = new Set(SAMPLE_PAYLOADS.map((s) => s.expectedVerdict));
    expect(verdicts).toContain("ALLOW");
    expect(verdicts).toContain("BLOCK");
    expect(verdicts).toContain("APPROVAL_REQUIRED");
  });

  it("sample payloads include at least one cross-tenant case", () => {
    const crossTenant = SAMPLE_PAYLOADS.filter(
      (s) => s.payload.tenant_id !== s.payload.resource_tenant
    );
    expect(crossTenant.length).toBeGreaterThanOrEqual(1);
  });

  it("sample payloads include at least one destructive action case", () => {
    const destructive = SAMPLE_PAYLOADS.filter(
      (s) =>
        s.payload.capability.includes("terminate") ||
        s.payload.capability.includes("delete") ||
        s.payload.capability.includes("deregister")
    );
    expect(destructive.length).toBeGreaterThanOrEqual(1);
  });
});
