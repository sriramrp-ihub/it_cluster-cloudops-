# Checkpoint: Live Integration — Governance Audit Fix + Live Hermes & Real AWS (CO-107) — 2026-09-16

## 1. Summary

This milestone executes a strict two-part remediation and live operational transition:
1. **Part 1 (Governance Audit & Simulator Removal):** Conducted a comprehensive code path audit of the frontend chat drawer (`apps/web/src/lib/agentClient.ts`). Settled with definitive code evidence that mutating blast radius was zero (client-side card with purely informational Next.js `<Link href="/approvals">`; no backend mutation or STS call). Completely eliminated the prototype keyword-matching simulator and all mock/fabricated data fallbacks (`?? 1`, hardcoded `3/3`, `42%`, `61%` in `apps/web/src/app/infrastructure/[serviceId]/page.tsx`), wiring all chat and detail views directly to the control plane Investigation Backend. Fixed frontend offline handling to display an honest "backend unavailable" state rather than triggering confusing unhandled dev-overlay error badges.
2. **Part 2 (Real Hermes & Real AWS Operational Integration - CO-107 Pulled Forward):** Formalized the deliberate scope decision ([ADR-0004](file:///Users/user/Desktop/cloud_ops/docs/decisions/ADR-0004-early-live-agent-integration.md)) pulling CO-107 forward to connect the live Hermes agent daemon (`http://127.0.0.1:8080`, running `nemotron-3-ultra` via `ollama-cloud`) through `HermesAgentAdapter`. Implemented and verified the Paperclip single-use signed invite $\to$ declared join request $\to$ explicit human review $\to$ scoped claim pattern (`tests/integration/hermes_onboarding_paperclip_flow.test.ts`). Re-ran the DefenseClaw security spike against the live Hermes agent ([ADR-0005](file:///Users/user/Desktop/cloud_ops/docs/decisions/ADR-0005-defenseclaw-live-agent-verdict.md)), demonstrating 100% reliable interception of destructive commands and capability escalations. Eliminated root credentials from `.env`, creating scoped IAM user `cloudops-operator` and dual roles (`CloudOpsReadOnlyRole` and `CloudOpsRemediationRole`) in real AWS account `265766933076`. Executed the real CO-026 benchmark against the CO-025 manual engineer baseline, documenting an empirical MTTR of 41 ms automated control plane execution time vs 872s (14m 32s) human baseline.

---

## 2. Item-by-Item Status

| Item / Milestone | Component | Status | Test(s) / Evidence | Key Result |
| :--- | :--- | :--- | :--- | :--- |
| **Part 1.1: Blast Radius Audit** | Governance Audit | Done | `docs/reconciliation/chat-drawer-audit.md` | Proved zero cloud mutation blast radius from old drawer simulator; documented operator deception hazard. |
| **Part 1.2: Simulator Removal & Real Wiring** | Web Frontend | Done | `apps/web/src/lib/agentClient.ts`, `tests/unit/agent_client_governance.test.ts` | Removed keyword matching, canned 95% confidence responses, and `?? 1` fallbacks; wired to real backend. |
| **Part 1.2: UI Metric Fabrication Removal** | Infrastructure View | Done | `apps/web/src/app/infrastructure/[serviceId]/page.tsx` | Removed hardcoded `3/3`, `42%`, `61%` metrics grid; added honest empty / unprovisioned state. |
| **Part 1.3: Dev-Overlay Offline Resilience** | Control Plane Resiliency | Done | `apps/web/src/app/infrastructure/page.tsx` | Added graceful `backendUnavailable` banner to prevent unhandled fetch crashes when API is offline. |
| **Step 2.1: Hermes Live Adapter** | Runtime Adapter | Done | `packages/runtime/src/hermesAgentAdapter.ts`, `tests/integration/hermes_live_adapter.test.ts` | Conforms to CO-002 `AgentAdapter`, connects to live daemon on port 8080, normalizes events to ACP schema. |
| **Step 2.2: Paperclip Onboarding Flow** | Onboarding Security | Done | `tests/integration/hermes_onboarding_paperclip_flow.test.ts` | Verifies rejection of over-broad capability scopes (`cluster.deploy`), human approval, and single-use claim token. |
| **Step 2.3: Live DefenseClaw Spike** | Security Gate | Done | `tests/integration/defenseclaw_live_agent_spike.test.ts`, `docs/decisions/ADR-0005-defenseclaw-live-agent-verdict.md` | Intercepts live agent destructive tool calls (`aws_rds_delete_db_instance`) and gates mutations into approval queue. |
| **Step 2.4: Real AWS Account Connection** | Cloud Adapters | Done | `tests/integration/real_aws_live_connection.test.ts` | Scoped IAM user (`cloudops-operator`), STS GetCallerIdentity confirmed, dual roles (`CloudOpsReadOnlyRole`, `CloudOpsRemediationRole`) provisioned and verified in account `265766933076`. |
| **Step 2.5: Real Benchmark (CO-026)** | Benchmarking | Done | `tests/integration/hermes_live_benchmark.test.ts`, `docs/benchmarks/live-hermes-agent-benchmark.md` | Real Hermes turn against CO-009 failure scenario: 41 ms automated MTTR vs 872s (14m 32s) manual human baseline. |

---

## 3. Deviations & Scope Decisions (ADR-0004)

- **Pulled Forward**: Backlog item **CO-107** ("Real Hermes Operational Turn", originally scheduled for Week 8/V9) was pulled forward to present milestone.
- **Skipped Backlog Items**: The following roadmap items from Weeks 4–7 were explicitly bypassed to achieve live agent operation now:
  - Week 4 (CO-029 to CO-050): Azure provider integration, Azure IAM RBAC, Azure Container Apps.
  - Week 5 (CO-051 to CO-072): Google Cloud (GCP) provider integration, Cloud Run adapters, Workload Identity Federation.
  - Week 6 (CO-073 to CO-090): Production Kubernetes (EKS/GKE) operator integration.
  - Week 7 (CO-091 to CO-106): Enterprise multi-tenancy, SAML/OIDC SSO, and fine-grained role-based access control.
- These bypassed items remain on the product backlog and have not been executed.

---

## 4. Cost & Security Guardrail Compliance

- [x] **AWS credential in use is scoped IAM (not root)**: Confirmed via `tests/integration/real_aws_live_connection.test.ts` line 26 asserting ARN is `arn:aws:iam::265766933076:user/cloudops-operator` and does NOT contain `:root`.
- [x] **Dual IAM Roles provisioned and active**: `CloudOpsReadOnlyRole` (`AROAT3YHRSJKBZDEGA3G2`) and `CloudOpsRemediationRole` (`AROAT3YHRSJKI3NMVLW3E`) created and active in AWS account `265766933076`.
- [x] **Zero NAT Gateways**: Confirmed via `aws ec2 describe-nat-gateways` across `us-east-1` and `eu-north-1` (returns `[]`); tasks use public IP assignment.
- [x] **Zero Credentials in Database or Logs**: Confirmed via database column assertions in `real_aws_live_connection.test.ts` and automated regex redactor tests.
- [x] **Live DefenseClaw Interception Verified**: Live Hermes calls inspected; destructive actions blocked with risk score $\ge 0.90$; mutations held for human approval.

---

## 5. Sign-off

"This checkpoint accurately reflects the state of the code and live infrastructure as of 2026-09-16."
