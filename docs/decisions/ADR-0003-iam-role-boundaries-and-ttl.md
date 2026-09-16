# ADR-0003: AWS IAM Dual-Role Architecture, Permission Boundaries, and Session TTL

**Status:** Accepted  
**Date:** 2026-09-16  
**Related CO-IDs:** CO-003, CO-004, CO-006, CO-020, CO-021

## Context

Cloud operations agents must never operate with standing, unconstrained, or shared credentials. Historically, systems start with a single privileged administrative role and attempt to divide it later, which inevitably fails because existing workflows develop hidden dependencies on elevated permissions. 

Furthermore, Step 0 pre-flight checks discovered that the credential in `.env` was `arn:aws:iam::265766933076:root`, which is a severe violation of least-privilege principles and Cost & Billing Guardrail #1.

## Decision

### 1. Dual-Role Architecture From Day 1

We mandate two separate, dedicated IAM roles for CloudOps operations:

```text
┌────────────────────────────────────────────────────────┐
│               CloudOps Dual-Role Model                │
├───────────────────────────┬────────────────────────────┤
│   CloudOpsReadOnlyRole    │  CloudOpsRemediationRole   │
│ (Investigation / Reading) │   (Governed Mutation)      │
├───────────────────────────┼────────────────────────────┤
│ • ecs:Describe*           │ • ecs:UpdateService        │
│ • ecs:List*               │ • ecs:DeployService        │
│ • logs:FilterLogEvents    │ • ecs:RegisterTaskDef      │
│ • cloudwatch:GetMetric*   │ • (Scoped to demo cluster) │
│ • elasticloadbalancing:*  │                            │
│ • ecr:DescribeImages      │                            │
│ • Explicit Deny on writes │ • Deny on IAM / Account    │
└───────────────────────────┴────────────────────────────┘
```

1. **`CloudOpsReadOnlyRole` (`arn:aws:iam::<account>:role/CloudOpsReadOnlyRole`):**
   - Strictly restricted to inspection APIs (ECS describe/list, CloudWatch metrics/logs, ALB describe, ECR describe).
   - Contains explicit `Deny` statements on all write, update, scale, reboot, and delete APIs.
   - Assigned by default to all incoming agent sessions and investigation tasks.
2. **`CloudOpsRemediationRole` (`arn:aws:iam::<account>:role/CloudOpsRemediationRole`):**
   - Scoped strictly to mutating resources tagged `project=cloudops-demo`.
   - Dispensed strictly **Just-In-Time (JIT)** via STS `AssumeRole` only after a signed, unexpired human approval with verified payload hash is confirmed by the Gateway.
   - Credentials expire immediately after use and are never exposed to agents, logs, or UI.

### 2. Session TTL Configuration & Rationale

- **Default Session TTL:** **3,600 seconds (1 hour)**.
- **Investigation Sessions:** Configured for 1 hour. This accommodates complete multi-step log and metric analyses without requiring credential refresh mid-turn, while ensuring that any transient credential automatically becomes invalid if abandoned.
- **Remediation Sessions:** Configured for the minimum supported STS duration (**900 seconds / 15 minutes**). Since remediations are point-in-time actions (e.g. initiating a rolling rollback or update), a 15-minute window minimizes the blast radius of any ephemeral session token.

### 3. Root Credential Elimination

The `.env` root credential will be used exclusively as the initial bootstrapper to generate these two scoped roles and a restricted IAM operator (`cloudops-operator`), after which root keys must be revoked and removed from all application configuration.

## Consequences

- Agents have mathematically zero ability to mutate cloud infrastructure during investigations, enforced by AWS IAM policy.
- Ephemeral credentials cannot be replayed past their 15-minute / 1-hour window.
- Complies with Cost & Billing Guardrail #1.
