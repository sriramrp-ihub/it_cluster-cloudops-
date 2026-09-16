# CloudOps Incident Investigation Skill (ECS Fargate & Web Services)

> **Audience:** Autonomous CloudOps Agents (Hermes SRE, OpenClaw, and platform operators)  
> **Classification:** Read-Only Investigation Standard Operating Procedure (SOP)  
> **Governance Mode:** Investigation Boundary (Write/Mutation actions strictly prohibited)

---

## 1. Investigation Objective
When an alert fires or an incident is triggered in an Amazon ECS Fargate environment (e.g. elevated 5xx error rates, failed task deployments, stopped containers), follow a structured, deterministic root-cause investigation. Do not guess or propose remediation actions without verifiable, evidence-backed observations.

---

## 2. Mandatory Ordered Inspection Sequence

Always execute evidence collection in the following sequential order:

### Step 1: Cluster Health & Service Status
- **Tool:** `aws_ecs_describe_clusters`
- **Objective:** Determine cluster-level health, total active services, desired task counts, running task counts, and pending task counts.
- **Evidence Target:** Identify whether the cluster is experiencing a cluster-wide failure or an isolated service-level degradation.

### Step 2: Task Listing & Allocation
- **Tool:** `aws_ecs_list_tasks`
- **Objective:** List active tasks for the targeted service name.
- **Evidence Target:** Check if `runningTasksCount == 0` or if desired task count differs from running task count.

### Step 3: Stopped Task Failure Diagnostics
- **Tool:** `aws_ecs_describe_stopped_tasks`
- **Objective:** Retrieve the last stopped tasks for the service, inspecting task stop codes, container exit codes, and stop reasons.
- **Evidence Target:** Look for critical container exit reasons:
  - `CannotPullContainerError: repository not found or tag does not exist` -> Container image failure.
  - `EssentialContainerExited: exit code 1 / 137` -> CrashLoop / OOMKilled.
  - `TaskFailedToStart: resource constraint` -> CPU/Memory exhaustion.

### Step 4: Application & System Telemetry (CloudWatch)
- **Tool:** `aws_cloudwatch_get_metric_data`
- **Objective:** Query CPUUtilization, MemoryUtilization, and 5xx error metrics over the last 15–30 minutes.
- **Evidence Target:** Correlate task drops with traffic spikes or sudden metric dropoffs.

### Step 5: Load Balancer & Target Health
- **Tool:** `aws_alb_get_target_health`
- **Objective:** Inspect Application Load Balancer target group health states.
- **Evidence Target:** Verify if targets are `Unhealthy` due to `Target.ResponseCodeMismatch` (503 / 502) or `Target.Timeout`.

### Step 6: Container Registry Verification (ECR)
- **Tool:** `aws_ecr_describe_images`
- **Objective:** Validate whether the container image tag defined in the active ECS task definition revision actually exists and has an image digest.
- **Evidence Target:** Detect if a broken, missing, or corrupt image tag was referenced in a recent task definition deployment.

---

## 3. Evidence Collection & Root-Cause Synthesis Contract

Every finding must produce an evidence-backed Root-Cause Analysis (RCA) payload conforming to the following structure:

```json
{
  "type": "root_cause_analysis",
  "finding": "ContainerImageNotFound",
  "rootCause": "The task definition revision references a container image tag that does not exist in the target ECR repository.",
  "confidence": 0.99,
  "evidenceIds": [
    "ev_ecs_stopped_task_error",
    "ev_ecr_tag_missing",
    "ev_alb_targets_unhealthy"
  ],
  "affectedResources": [
    "arn:aws:ecs:us-east-1:265766933076:service/production-cluster/checkout-service"
  ],
  "recommendedRemediation": {
    "toolName": "aws_ecs_rollback_service",
    "arguments": {
      "cluster": "production-cluster",
      "service": "checkout-service",
      "targetTaskDefinition": "arn:aws:ecs:us-east-1:265766933076:task-definition/checkout-service:1"
    },
    "riskLevel": "HIGH",
    "requiresApproval": true
  }
}
```

---

## 4. Operational Invariants During Investigation

### Read-Only Identity Boundary
1. **Strict Read-Only Enforcement:** The agent MUST NOT attempt to restart, update, delete, or modify any resource during the investigation phase. The IAM identity actively used during this turn is `CloudOpsReadOnlyRole`. Any write attempt will trigger a `403 POLICY_VIOLATION`.
2. **Deterministic Evidence Traceability:** No conclusion can be reported without citing at least one specific evidence reference collected during the inspection sequence.
3. **Remediation Separation:** Recommended remediations are proposals ONLY. They are handed off to the Human Approval Gateway before any execution takes place.

