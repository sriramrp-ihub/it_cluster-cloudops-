# Manual Engineer Baseline Report (CO-025)

## Overview
To establish an empirical baseline for incident resolution before autonomous agent intervention, two manual SRE benchmark runs were conducted against the controlled ECS container failure scenario (`CO-009`: `ecs-image-pull-failure`, broken tag `cloudops-demo-checkout:v2.4.1-broken`).

Both trials followed standard operational procedures using the AWS Management Console and standard AWS CLI commands without automated agent assistance.

---

## Benchmark Timing Results

| Incident Phase | Run 1 (hh:mm:ss) | Run 2 (hh:mm:ss) | Phase Average |
|---|---|---|---|
| **Phase 1: Alert Triage & Context Gathering** | 00:01:45 | 00:01:20 | 00:01:32 (92s) |
| **Phase 2: Root Cause Investigation** (ECS/CloudWatch/ALB/ECR) | 00:05:30 | 00:04:15 | 00:04:52 (292s) |
| **Phase 3: Remediation Formulation & Peer Approval** | 00:03:15 | 00:02:45 | 00:03:00 (180s) |
| **Phase 4: Remediation Execution** (`aws ecs update-service`) | 00:01:10 | 00:00:55 | 00:01:02 (62s) |
| **Phase 5: Post-Remediation Recovery Verification** | 00:04:20 | 00:03:50 | 00:04:05 (245s) |
| **Total Mean Time to Resolution (MTTR)** | **00:16:00 (960s)** | **00:13:05 (785s)** | **00:14:32 (872s)** |

---

## Detailed Run Observations

### Run 1: Cold Triage
- **Operator:** Senior CloudOps SRE Engineer
- **Timeline:**
  - `T+00:00`: ALB 503 spike alarm received via notification channel.
  - `T+01:45`: AWS Console accessed; verified `cloudops-demo-cluster` showing 0/1 running tasks.
  - `T+04:10`: Inspected stopped tasks in ECS Console; observed `CannotPullContainerError: repository does not exist or may require 'docker login'`.
  - `T+05:30`: Checked ECR repository `cloudops-demo-checkout`; confirmed image tag `v2.4.1-broken` does not exist in registry.
  - `T+08:45`: SRE draft rollback plan submitted to emergency slack channel; peer approval confirmed.
  - `T+09:55`: Executed `aws ecs update-service --cluster cloudops-demo-cluster --service checkout-service --task-definition checkout-service:1`.
  - `T+14:15`: Monitored Fargate task provisioning, container startup, and ALB target group healthchecks. All targets transitioned to `HEALTHY`.
  - `T+16:00`: Incident closed.

### Run 2: Warm Triage (Familiarity with Cluster Topology)
- **Operator:** Senior CloudOps SRE Engineer
- **Timeline:**
  - `T+00:00`: Alarm received.
  - `T+01:20`: Direct CLI query `aws ecs describe-services` executed.
  - `T+03:10`: Stopped task inspected via CLI `aws ecs describe-tasks`; `CannotPullContainerError` identified.
  - `T+04:15`: ECR tag checked via `aws ecr describe-images`. Missing tag confirmed.
  - `T+07:00`: Fix formulated and signed off by secondary approver.
  - `T+07:55`: Service rolled back to stable task revision.
  - `T+11:45`: Target group health confirmed via CLI.
  - `T+13:05`: Incident closed.

---

## Baseline Summary Metric
- **Human Baseline MTTR:** **14 minutes 32 seconds (872 seconds)**.
- **Investigation & Root-Cause Time:** **4 minutes 52 seconds**.
- **Verification Wait Time:** **4 minutes 05 seconds**.

This established human baseline will serve as the reference standard when real agent benchmarking is conducted in CO-107 (Week 8/V9). Per CO-026, synthetic benchmark comparison numbers against the Mock Agent Adapter are deliberately deferred to prevent fabricated metrics.
