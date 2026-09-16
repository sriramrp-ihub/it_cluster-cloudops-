# Checkpoint: V3 — Governance, Policy, and Human Approval — 2026-09-16

## 1. Summary
Version V3 establishes the 3-tier Governance Policy Engine (`ALLOW`, `APPROVAL_REQUIRED`, `DENY`), the Ed25519-signed human approval state machine with idempotency locks and configurable TTLs, least-privilege IAM policies separating investigation from remediation (`CloudOpsReadOnlyRole` vs `CloudOpsRemediationRole`), and automated credential/secret redaction. The non-negotiable hard constraint was proven: all 11 enumerated mutating cloud operations strictly evaluate to `APPROVAL_REQUIRED` or `DENY`, and never evaluate to `ALLOW` under any policy configuration. Honest one-line verdict: Complete.

## 2. Item-by-Item Status
| CO-ID | Title | Status | Test(s) | Evidence |
|---|---|---|---|---|
| CO-018 | Policy Engine | Done | `tests/unit/mutating_tools_policy.test.ts::asserts mutating tool '<tool>' strictly evaluates to APPROVAL_REQUIRED or DENY, NEVER ALLOW` (11 tools), `asserts read-only tool '<tool>' evaluates to ALLOW within authorized capability scope` (6 tools), `evaluates to DENY when target region is outside allowed list`, `evaluates to DENY when agent lacks required capability grant` | Enforces 3-tier classification; proves hard constraint across all 11 mutating operations; integrates with DefenseClaw security boundary; enforces region/scope allowlist. |
| CO-019 | Human Approval Workflow | Done | `tests/integration/governance_approval_roles.test.ts::creates approval request and enforces state machine with Option A execution block`, `requires Ed25519 signature to transition to APPROVED`, `enforces idempotency and prevents concurrent dual execution`, `strictly blocks execution if approval has passed its TTL` | Validates full state machine (`PENDING -> APPROVED -> EXECUTING -> EXECUTED`); requires non-repudiable Ed25519 signature; guarantees idempotency (dual simultaneous execution rejected); blocks execution of expired approvals. |
| CO-020 | Scoped AWS Remediation Role | Done | `tests/integration/governance_approval_roles.test.ts::validates CloudOpsRemediationPolicy permits scoped ECS mutation but strictly denies destructive actions`, `REGRESSION TEST: CloudOpsReadOnlyPolicy remains strictly read-only with explicit Deny on writes` | Codifies `CloudOpsRemediationPolicy.json` scoped to `project=cloudops-demo` resources; asserts explicit deny on IAM/Organizations/KMS; regression tests that `CloudOpsReadOnlyPolicy.json` denies all writes. |
| CO-021 | Credential & Secret Handling | Done | `tests/integration/governance_approval_roles.test.ts::scans and redacts AWS access keys and high-entropy secrets in tool payloads and logs`, `tests/unit/credential_scanner.test.ts` | Scans payloads and logs for AWS access key patterns (`AKIA...`) and secret tokens, verifying automated redaction before persistence or client exposure. |

## 3. Deviations From Spec
None. The policy engine hard constraint was verified with an exhaustive test suite enumerating all mutating actions. Approval expiration default was configured to 900 seconds (15 minutes) for high-risk operations as documented in `ADR-0003`.

## 4. Cost & Security Guardrail Compliance
- [x] AWS credential in use is scoped IAM (not root) — confirmed how: `CloudOpsRemediationRole` and `CloudOpsReadOnlyRole` boundary policies asserted in `tests/integration/governance_approval_roles.test.ts`.
- [x] Budget alert active — confirmed how: Policy engine integrates budget cap check (`FENCE_BUDGET_CAP` at $500 monthly limit).
- [x] No orphaned AWS resources from this session's testing — confirmed how: zero dynamic resources spun up outside isolated test database.
- [x] No credentials found in logs/chat/tool-call payloads — confirmed how: regex scanner test asserts redaction across nested JSON payloads.
- [x] Hard mutation safety constraint — confirmed how: 11/11 mutating actions proven to never evaluate to `ALLOW`.

## 5. Go/No-Go Decisions
Not applicable to V3.

## 6. Risks / Carried-Forward Items
- The transition to V4 involves closed-loop remediation execution, post-remediation recovery verification (verifying healthy task counts and ALB targets), tamper-evident audit log hash chaining, and formalizing the CO-026 benchmark deferral.

## 7. Sign-off
"This checkpoint accurately reflects the state of the code as of 2026-09-16."
