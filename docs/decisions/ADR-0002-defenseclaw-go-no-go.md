# ADR-0002: DefenseClaw Governance Integration Spike — Go/No-Go Decision

**Status:** Accepted (Verdict: GO)  
**Date:** 2026-09-16  
**Related CO-IDs:** CO-005, CO-018, CO-024, CO-107

## Context

Ground Rule 2 mandates a formal go/no-go gate at the conclusion of V0 on CO-005 (DefenseClaw Integration Spike):
- **Go:** DefenseClaw observes/intercepts the Mock Agent Adapter's tool activity, blocks a representative high-risk action, and produces usable audit evidence. Proceed with DefenseClaw as the governance layer for V1–V4, flagging that live-agent re-validation is required before CO-107.
- **No-go:** Document the failure explicitly; fall back to a custom policy interception layer as part of CO-018.

## Evidence & Verification

1. **Compilation & Binary Provenance:**
   - The DefenseClaw source tree located in `defence_claw/defenseclaw` was verified and compiled natively on macOS ARM64 using Go 1.26.5:
     ```bash
     cd defence_claw/defenseclaw && go build -o /tmp/defenseclaw ./cmd/defenseclaw
     ```
   - The resulting executable (`/tmp/defenseclaw`) initializes cleanly and exposes sidecar commands (`audit`, `policy`, `scan`, `status`, `watchdog`).
2. **Mock Agent Adapter Interception:**
   - Evaluated via automated test suite [`tests/unit/defenseclaw_spike.test.ts`](file:///Users/user/Desktop/cloud_ops/tests/unit/defenseclaw_spike.test.ts).
   - Safe read-only tool calls (`aws_ecs_describe_clusters`) passed inspection with risk score $\le 0.2$.
   - Destructive action (`aws_rds_delete_db_instance` with `skipFinalSnapshot: true`) was demonstrably intercepted and blocked (`action: "BLOCK"`, risk score $0.95$, reason: `DESTRUCTIVE_ACTION_FORBIDDEN`).
   - Capability boundary violations were intercepted and blocked (`CAPABILITY_BOUNDARY_VIOLATION`).
3. **Audit Evidence Usability:**
   - DefenseClaw produces structured audit events containing unique event IDs (`dc_evt_...`), timestamps, agent/tenant identifiers, risk scores, and specific triggered guardrails.
   - The evidence format maps cleanly into CloudOps's normalized audit schema (`packages/audit`).

## Decision

**VERDICT: GO**

We adopt DefenseClaw as the primary security inspection and governance layer for V1–V4. 
- The `@cloudops/security` package provides the TypeScript inspection bridge and guardrail service.
- The DefenseClaw audit trail will feed directly into CloudOps's immutable SHA-256 hash chain (`CO-024`).

## Flags & Constraints for Later Milestones

1. **Live-Agent Re-validation Requirement (CO-107):**
   - This spike confirms DefenseClaw's ability to govern deterministic tool calls emitted by the Mock Agent Adapter.
   - Real Hermes LLM inference (multi-turn reasoning, prompt injection susceptibility, MCP stdio pipe latency) must be re-validated under DefenseClaw before production rollout at CO-107.
2. **Fallback Safety:**
   - In the event that an external DefenseClaw daemon process disconnects in production, the embedded policy engine in `@cloudops/policy` (`CO-018`) maintains secondary defense-in-depth enforcement to fail closed.
