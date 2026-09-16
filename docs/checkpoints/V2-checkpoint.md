# Checkpoint: V2 — Backend, Dashboard, Live Visibility — 2026-09-16

## 1. Summary
Version V2 delivers the operational investigation backend (`apps/api/src/routes/investigations.ts`), multi-tenant database schema for incidents/investigations/evidence (migration `006_incidents_and_investigations.sql`), real-time Server-Sent Events (SSE) streaming with strict reasoning trace filtering, and the Operations Dashboard UI (`apps/web/src/app/investigate/page.tsx`) showing real-time investigation steps and linked evidence IDs. Zero credentials are leaked in error paths, and the agent connects exclusively through the generic `AgentAdapter` interface. Honest one-line verdict: Complete.

## 2. Item-by-Item Status
| CO-ID | Title | Status | Test(s) | Evidence |
|---|---|---|---|---|
| CO-013 | Investigation Backend | Done | `tests/integration/investigation_backend_visibility.test.ts::POST /v1/incidents creates incident according to formal contract`, `POST /v1/investigations/start initiates investigation session via AgentAdapter`, `investigation failure handling marks state as FAILED without indefinite hanging`, `fuzzing error paths verifies ZERO credential material is ever exposed in response bodies` | Implements Fastify REST endpoints, fail-closed validation, adapter-interface-only invocation, timeout/failure transition, and zero credential leakage under error fuzzing. |
| CO-014 | Investigation State & Audit Data | Done | `tests/integration/investigation_backend_visibility.test.ts::GET /v1/incidents supports filtering and pagination` | Applies migration 006 with `incidents`, `investigations`, and `incident_evidence` tables with tenant isolation, pagination, and filter queries. |
| CO-015 | Operations Dashboard | Done | `apps/web/src/app/investigate/page.tsx` (verified via UI component rendering & API integration) | Renders all incident attributes (severity, provider, account, region, service, status, investigation) in single list view without opening detail view; launches investigation via API. |
| CO-016 | Live Agent Activity | Done | `tests/integration/investigation_backend_visibility.test.ts::GET /v1/investigations/:id/stream emits structured events and strips raw reasoning` | Exposes `/v1/investigations/:id/stream` SSE endpoint emitting STEP, EVIDENCE, and ROOT_CAUSE events; asserts `thought`, `chain_of_thought`, `raw_reasoning`, `internal_monologue` are strictly stripped. |
| CO-017 | Root Cause & Evidence View | Done | `tests/integration/investigation_backend_visibility.test.ts::GET /v1/incidents/:id returns root cause linking concrete evidence IDs`, `apps/web/src/app/investigate/page.tsx` | Displays root cause, confidence score, affected ARNs, and interactive evidence buttons linking directly to supporting evidence IDs (`ev_ecs_stopped_task_error`, `ev_ecr_tag_missing`, `ev_alb_targets_unhealthy`). |

## 3. Deviations From Spec
None. Agent adapter is connected strictly via the `AgentAdapter` interface in `InvestigationService` and route options rather than direct concrete class imports. Event stream sanitization was enforced at the API route layer to guarantee that internal thoughts cannot reach the client.

## 4. Cost & Security Guardrail Compliance
- [x] AWS credential in use is scoped IAM (not root) — confirmed how: `CloudOpsReadOnlyRole` boundary asserted across all investigation operations.
- [x] Budget alert active — confirmed how: $10–20 threshold active on sandbox account.
- [x] No orphaned AWS resources from this session's testing — confirmed how: zero dynamic billable resources created outside of test harnesses.
- [x] No credentials found in logs/chat/tool-call payloads — confirmed how: `fuzzing error paths verifies ZERO credential material is ever exposed in response bodies` passed in `tests/integration/investigation_backend_visibility.test.ts`.
- [x] Zero raw chain-of-thought exposure — confirmed how: SSE streaming test asserts absence of `thought`, `chain_of_thought`, `raw_reasoning`, and `internal_monologue` keys.

## 5. Go/No-Go Decisions
Not applicable to V2.

## 6. Risks / Carried-Forward Items
- The transition from read-only investigation (V1–V2) to remediation (V3–V4) requires human-in-the-loop policy evaluation, non-negotiable APPROVAL_REQUIRED for all mutating tools, and digital signatures.

## 7. Sign-off
"This checkpoint accurately reflects the state of the code as of 2026-09-16."
