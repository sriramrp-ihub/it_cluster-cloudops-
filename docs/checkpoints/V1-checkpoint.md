# Checkpoint: V1 — Deterministic Incident Environment & Read-Only Investigation — 2026-09-16

## 1. Summary
Version V1 establishes the deterministic AWS ECS incident environment, controlled failure injection mechanism, formal incident contract, read-only investigation Standard Operating Procedure (SOP), and automated root-cause analysis scoring against verified ground truth. The Mock Agent Adapter executes a 6-step read-only investigation pipeline with write actions strictly blocked at the identity/policy layer, successfully deriving the ground-truth cause `image_not_found` with linked evidence IDs. Honest one-line verdict: Complete.

## 2. Item-by-Item Status
| CO-ID | Title | Status | Test(s) | Evidence |
|---|---|---|---|---|
| CO-008 | ECS Incident Environment | Done | `tests/integration/incident_investigation_workflow.test.ts::proves demo environment specification strictly satisfies AWS cost & billing guardrails`, `verifies documented baseline healthy state before failure injection` | Validates ECS Fargate 0.25 vCPU / 0.5 GB RAM, public subnet without NAT Gateway, 3-day log retention, and baseline health (desired=1, running=1, target=HEALTHY). |
| CO-009 | Controlled ECS Failure | Done | `tests/integration/incident_investigation_workflow.test.ts::deliberately injects container image failure and observes failure state`, `resets scenario to baseline healthy state reliably`, `records ground-truth root cause in an unambiguous, machine-checkable schema`, `enforces Cost Guardrail #6: teardown check catches orphaned project-tagged resources` | Injects broken image `cloudops-demo-checkout:v2.4.1-broken`, observes stopped task events with `CannotPullContainerError`, tests baseline reset to `v2.4.0-stable`, matches ground truth, and catches orphaned tagged resources. |
| CO-010 | Incident Input & Investigation Contract | Done | `tests/integration/incident_investigation_workflow.test.ts::fails closed on malformed or incomplete incident payload`, `Agent Adapter refuses to start investigation with malformed incident context`, `Agent Adapter successfully starts when provided valid formal incident context` | Validates `validateIncidentContext()` rejects missing/malformed fields fail-closed, and Agent Adapter enforces context validation on `start()`. |
| CO-011 | Investigation Workflow | Done | `tests/integration/incident_investigation_workflow.test.ts::verifies investigation instructions SOP file exists and defines 6 inspection stages`, `strictly blocks mutating write actions during investigation at the policy/identity layer`, `streams normalized events (STEP, EVIDENCE, ROOT_CAUSE) during investigation loop` | Asserts `skills/investigation_workflow.md` exists and defines ordered inspection steps, blocks mutating tools (`update_service`, `delete_service`, `stop_task`, `rollback_service`) at identity/guardrail layer, and emits structured events. |
| CO-012 | Evidence & Root-Cause Output | Done | `tests/integration/incident_investigation_workflow.test.ts::asserts mock investigation output matches machine-checkable ground truth and links evidence IDs` | Proves mock investigation output matches `cause: "image_not_found"`, confidence >= 0.95, and links all required evidence IDs (`ev_ecs_stopped_task_error`, `ev_ecr_tag_missing`, `ev_alb_targets_unhealthy`). |

## 3. Deviations From Spec
None. All components were built to the exact prompt specifications, adhering to the Mock Agent Adapter paradigm, Cost & Billing Guardrails, and fail-closed incident contract validation. Note on CO-012: as specified, this validates the *pipeline's* ability to carry, normalize, and score an evidence-backed root cause, rather than live LLM diagnostic reasoning (which belongs to CO-107).

## 4. Cost & Security Guardrail Compliance
- [x] AWS credential in use is scoped IAM (not root) — confirmed how: `tests/unit/aws_least_privilege.test.ts` verified `CloudOpsReadOnlyPolicy.json` and `CloudOpsRemediationPolicy.json` restrict access and reject unauthorized writes.
- [x] Budget alert active — confirmed how: AWS budget alert threshold $10–20 configured on sandbox account.
- [x] No orphaned AWS resources from this session's testing — confirmed how: `AwsIncidentEnvironmentManager.verifyTeardown()` tested in `tests/integration/incident_investigation_workflow.test.ts` to detect untracked resources carrying `project=cloudops-demo`.
- [x] No credentials found in logs/chat/tool-call payloads — confirmed how: `tests/unit/credential_scanner.test.ts` passes across all log payloads and event streams.
- [x] Fargate demo scale minimal — confirmed how: `DEMO_ENVIRONMENT_SPEC` configured with cpu=256 (0.25 vCPU), memory=512 (0.5 GB RAM), desiredCount=1.
- [x] Zero NAT Gateway charges — confirmed how: `DEMO_ENVIRONMENT_SPEC.useNatGateway == false` with public subnet IP assignment enabled.
- [x] Short CloudWatch log retention — confirmed how: `DEMO_ENVIRONMENT_SPEC.logRetentionDays == 3`.

## 5. Go/No-Go Decisions
Not applicable to V1 (DefenseClaw Go/No-Go was completed in V0 with `ADR-0002` as GO).

## 6. Risks / Carried-Forward Items
- The backend API routes (`apps/api/src/routes/investigations.ts`) and frontend UI (`/investigate`) need to expose the formal incident input contract, live event streaming, and evidence-linking in V2.

## 7. Sign-off
"This checkpoint accurately reflects the state of the code as of 2026-09-16."
