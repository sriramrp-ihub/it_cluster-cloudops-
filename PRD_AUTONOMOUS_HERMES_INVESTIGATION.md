# Product Requirements Document (PRD)
# Autonomous Hermes Incident Investigation & Remediation Platform

**Document Version:** 1.0.0  
**Status:** Draft / Approved Roadmap  
**Author:** Antigravity AI Engineering Assistant  
**Target Repository:** `sriramrp-ihub/it_cluster-cloudops-`  
**Date:** September 16, 2026  

---

## 1. Executive Summary & Objective

### 1.1 Objective
Transform CloudOps from its current state—where investigation steps and root-cause synthesis are driven by a **deterministic TypeScript state-machine**—into a **fully autonomous AI SRE platform** where:
1. Operational prompts flow directly from the user interface through the CloudOps control plane into the live local **Hermes Agent** (`nemotron-3-ultra` on port 8080).
2. The Hermes LLM autonomously **reasons, plans, and selects diagnostic tools** dynamically based on live AWS telemetry.
3. Every tool call is governed by **DefenseClaw** and the **Policy Engine**; all mutating actions are securely halted until signed by a human operator using **Ed25519 cryptographic keys**.
4. 100% of the proven security, least-privilege AWS STS, audit hash-chaining, and zero-secret foundations are strictly preserved.

---

## 2. Foundations to KEEP vs. Components to EVOLVE

A critical requirement of this transition is **maintaining architectural integrity**. We must not throw away the solid cryptographic and cloud security foundations that have already been validated.

### 2.1 What Must Be KEPT (Non-Negotiable Core)

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                          FOUNDATIONS TO KEEP (100% REAL)                       │
├────────────────────────────────┬───────────────────────────────────────────────┤
│ AWS IAM Least-Privilege Dual   │ STS AssumeRole into CloudOpsReadOnlyRole and  │
│ Roles (CO-003, CO-006)         │ CloudOpsRemediationRole in account 265766933076│
├────────────────────────────────┼───────────────────────────────────────────────┤
│ Zero-Secret Persistence        │ In-memory STS credential caching only; keys   │
│ Architecture (CO-021)          │ reside strictly in .env (never in DB/client)  │
├────────────────────────────────┼───────────────────────────────────────────────┤
│ Ed25519 Cryptographic Human    │ Digital signature validation over canonical   │
│ Approvals (CO-018, CO-019)     │ approval payload hashes (approvalId:hash:time) │
├────────────────────────────────┼───────────────────────────────────────────────┤
│ SHA-256 Tamper-Evident Audit   │ Append-only cryptographic hash chaining with  │
│ Ledger (CO-020)                │ PostgreSQL immutability triggers               │
├────────────────────────────────┼───────────────────────────────────────────────┤
│ DefenseClaw Security Engine    │ Real AST parsing and command risk scoring;    │
│ (CO-107, ADR-0005)             │ blocks destructive actions with score ≥ 0.90   │
├────────────────────────────────┼───────────────────────────────────────────────┤
│ PostgreSQL Relational Store    │ Kysely queries, schemas, and migrations 001–006│
├────────────────────────────────┼───────────────────────────────────────────────┤
│ Next.js 15 Web Dashboard       │ Infrastructure, Agents, Approvals, Investigate │
│ & Server-Sent Events (SSE)     │ multi-page UI with real-time SSE streaming    │
└────────────────────────────────┴───────────────────────────────────────────────┘
```

### 2.2 What Must Be EVOLVED / REPLACED

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                         COMPONENTS TO EVOLVE / REPLACE                         │
├────────────────────────────────┬───────────────────────────────────────────────┤
│ Current Implementation         │ Target Implementation                         │
├────────────────────────────────┼───────────────────────────────────────────────┤
│ Scripted 4-Step Sequence in    │ Dynamic Hermes Session Inference via Hermes   │
│ `HermesAgentAdapter.ts`        │ `/api/sessions/{id}/messages` or OpenAI proxy  │
├────────────────────────────────┼───────────────────────────────────────────────┤
│ Heuristic Root-Cause Synthesis │ LLM Neural Reasoning & Tool Output Synthesis   │
│ (`if hasStoppedTasks ...`)     │ by Nemotron-3-Ultra based on live data        │
├────────────────────────────────┼───────────────────────────────────────────────┤
│ Emulated Node.js Gateway       │ Hermes Model Context Protocol (MCP) Client    │
│ Daemon (`agent-daemon.ts`)     │ connecting directly to CloudOps MCP Server    │
├────────────────────────────────┼───────────────────────────────────────────────┤
│ Client-side Chat Drawer Regex  │ Real-time Chat Proxy streaming LLM tokens     │
│ (`normalized.includes(...)`)   │ from Hermes to the browser drawer             │
├────────────────────────────────┼───────────────────────────────────────────────┤
│ Synthetic Database Failure     │ Controlled Real AWS Sandbox Task Injection     │
│ (`simulate-failure` row only)  │ (safe invalid ECR tag on sandbox cluster)     │
└────────────────────────────────┴───────────────────────────────────────────────┘
```

---

## 3. The Completed Feature: Target User Experience & Flow

### 3.1 Operator Experience (What the User Sees & Does)

1. **Initiating an Investigation:**
   - The operator opens the **Chat Drawer** or navigates to [/investigate](file:///Users/user/Desktop/cloud_ops/apps/web/src/app/investigate/page.tsx).
   - The operator types:  
     `"checkout-service is experiencing elevated 5xx error rates on cluster cloudops-demo-cluster. Please investigate the cause and propose a fix."`
   - Alternatively, a CloudWatch alarm webhook automatically files an incident.

2. **Real-Time Autonomous Reasoning Stream:**
   - The UI immediately displays a live streaming trace with progressive event cards:
     - 🧠 **Hermes Thought:** *"Operator reports elevated 5xx errors on checkout-service. I will begin by inspecting service task counts and recent CloudWatch target group metrics."*
     - 🔧 **Tool Invocation:** `aws_ecs_describe_services({ cluster: "cloudops-demo-cluster", services: ["checkout-service"] })`
     - 👁️ **Observation:** `desiredCount: 1, runningCount: 0, pendingCount: 0. Tasks failing to reach running state.`
     - 🧠 **Hermes Thought:** *"The service has 0 running tasks. I need to inspect the stopped tasks and container exit codes to determine why the tasks exited."*
     - 🔧 **Tool Invocation:** `aws_ecs_describe_stopped_tasks({ cluster: "cloudops-demo-cluster", service: "checkout-service" })`
     - 👁️ **Observation:** `Task stoppedReason: 'CannotPullContainerError: inspect image "v2.4.1-broken": not found in ECR'`
     - 🧠 **Hermes Thought:** *"The ECS agent cannot pull image 'v2.4.1-broken'. This is the root cause of the 503 errors. The previous stable task definition was revision 1. I will propose rolling back to revision 1."*

3. **Governance & Human Approval Interception:**
   - Hermes attempts to execute remediation:  
     `aws_ecs_rollback_service({ cluster: "cloudops-demo-cluster", service: "checkout-service", targetRevision: 1 })`
   - **DefenseClaw** intercepts the call: evaluates operation as `MUTATION` / `HIGH RISK`.
   - The tool call is **suspended**. CloudOps creates an approval item (`appr_...`) in PostgreSQL.
   - The Investigation UI displays:  
     `Proposed Remediation: Rollback checkout-service to revision 1 (Awaiting Human Approval)`.

4. **Operator Cryptographic Authorization:**
   - The operator navigates to [/approvals](file:///Users/user/Desktop/cloud_ops/apps/web/src/app/approvals/page.tsx).
   - Inspects the structured dry-run diff (`checkout-service:2` $\to$ `checkout-service:1`).
   - Clicks **"Authorize Remediation"**. The browser requests an Ed25519 digital signature from the operator key.
   - Backend verifies signature and assumes `CloudOpsRemediationRole`.

5. **Closed-Loop Verification:**
   - The rollback executes against AWS ECS.
   - Hermes or the verification service polls until steady-state (`runningCount === desiredCount === 1`, ALB target healthy).
   - Incident is marked `RESOLVED`. An append-only audit event is cryptographically sealed in the ledger.

---

## 4. End-to-End System Architecture Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Human Operator
    participant UI as CloudOps Web UI (Next.js)
    participant API as CloudOps API (Fastify)
    participant Hermes as Hermes Daemon (:8080)
    participant MCP as CloudOps MCP Server
    participant DefenseClaw as DefenseClaw Security Engine
    participant AWS as AWS ECS / CloudWatch
    participant DB as PostgreSQL Ledger

    Note over Operator, UI: 1. Launch Autonomous Investigation
    Operator->>UI: Enter prompt: "Investigate checkout-service 5xx spike"
    UI->>API: POST /v1/investigations/start (prompt, incidentId)
    API->>DB: INSERT INTO investigations (status: 'INVESTIGATING')
    
    Note over API, Hermes: 2. Real LLM Inference & Autonomous Tool Cycle
    API->>Hermes: POST /api/sessions/{id}/messages (System prompt + Tools + Incident)
    Hermes-->>API: SSE Stream: LLM Thought ("I will inspect ECS service health")
    API-->>UI: SSE Push: Step 1 (Thinking)
    
    Hermes->>MCP: Call Tool: aws_ecs_describe_services
    MCP->>DefenseClaw: Pre-execution Risk Check (Score: 0.10 - READ ONLY)
    DefenseClaw-->>MCP: ALLOWED
    MCP->>AWS: ECSClient.DescribeServices (STS ReadOnlyRole)
    AWS-->>MCP: { desiredCount: 1, runningCount: 0 }
    MCP-->>Hermes: Tool Result JSON
    
    Hermes-->>API: SSE Stream: LLM Thought ("Zero running tasks; querying stopped tasks")
    Hermes->>MCP: Call Tool: aws_ecs_describe_stopped_tasks
    MCP->>AWS: ECSClient.DescribeTasks (Stopped reason)
    AWS-->>MCP: { stoppedReason: "CannotPullContainerError: v2.4.1-broken not found" }
    MCP-->>Hermes: Tool Result JSON
    
    Note over Hermes, DefenseClaw: 3. Root Cause Synthesis & Gated Mutation
    Hermes-->>API: SSE Stream: Root Cause ("ECR image pull failure on v2.4.1-broken")
    Hermes->>MCP: Call Tool: aws_ecs_rollback_service (targetRevision: 1)
    MCP->>DefenseClaw: Pre-execution Risk Check (Score: 0.85 - MUTATION)
    DefenseClaw-->>MCP: INTERCEPT: Human Authorization Required
    MCP->>DB: INSERT INTO approvals (status: 'PENDING_APPROVAL', dryRunDiff)
    MCP-->>Hermes: { status: "AWAITING_APPROVAL", approvalId: "appr_123" }
    API-->>UI: SSE Push: ROOT_CAUSE + PROPOSAL (Awaiting Approval)
    
    Note over Operator, API: 4. Cryptographic Authorization & Remediation
    Operator->>UI: Click "Authorize Remediation"
    UI->>API: POST /v1/approvals/appr_123/approve (Ed25519 signature)
    API->>API: Verify Ed25519 Signature over canonical payload hash
    API->>AWS: ECSClient.UpdateService (STS RemediationRole)
    AWS-->>API: Service update dispatched
    
    Note over API, DB: 5. Closed-Loop Verification & Audit Sealing
    API->>AWS: Poll ECS steady state & target group health
    AWS-->>API: All tasks healthy, 0 5xx errors
    API->>DB: UPDATE investigations (status: 'RESOLVED')
    API->>DB: INSERT INTO audit_events (SHA-256 hash chained)
    API-->>UI: Incident Resolved Notification
```

---

## 5. Technical Specification & Implementation Plan

### Phase 1: Connect Hermes to CloudOps MCP Server
**Objective:** Enable Hermes to natively discover and call CloudOps AWS tools using standard Model Context Protocol (MCP).

- **Current State:** CloudOps already implements a compliant MCP Server in [`packages/tools/src/mcpServer.ts`](file:///Users/user/Desktop/cloud_ops/packages/tools/src/mcpServer.ts) and [`apps/api/src/routes/mcp.ts`](file:///Users/user/Desktop/cloud_ops/apps/api/src/routes/mcp.ts). Hermes already has native MCP support (`/api/mcp/servers`).
- **Implementation:**
  1. Register CloudOps MCP endpoint (`http://127.0.0.1:3000/v1/mcp`) in Hermes's MCP configuration.
  2. Verify Hermes detects the canonical tool list:
     - `aws_ecs_describe_clusters`
     - `aws_ecs_describe_services`
     - `aws_ecs_describe_stopped_tasks`
     - `aws_cloudwatch_get_metric_data`
     - `aws_logs_filter_events`
     - `aws_ecs_update_service`
     - `aws_ecs_rollback_service`

### Phase 2: Dynamic LLM Investigation Loop in `HermesAgentAdapter`
**Objective:** Replace the hardcoded 4-step sequence in `HermesAgentAdapter.runInvestigation()` with real Hermes session orchestration.

- **Current State:** `runInvestigation()` runs Step 1 $\to$ Step 2 $\to$ Step 3 $\to$ TypeScript heuristics in code.
- **Implementation:**
  1. Initialize an active Hermes chat session via `POST http://127.0.0.1:8080/api/sessions`.
  2. Send the SRE Investigation Prompt:
     ```markdown
     You are the CloudOps SRE Agent investigating an incident on AWS.
     Target Service: {serviceName}
     Cluster: {clusterName}
     Region: {region}
     Alert: {alertDescription}

     Your goal:
     1. Analyze telemetry using available read-only AWS tools.
     2. Identify the exact root cause.
     3. Propose the safest, least-privilege remediation.
     Do not attempt direct mutations without operator approval.
     ```
  3. Stream Hermes's response via Hermes SSE (`/api/sessions/{session_id}/messages`).
  4. Normalize Hermes events into CloudOps `AgentEvent` schema (`THOUGHT`, `STEP`, `OBSERVATION`, `EVIDENCE`, `ROOT_CAUSE`, `PROPOSAL`).
  5. Route incoming tool calls through DefenseClaw and the Approval Service.

### Phase 3: Conversational Chat Drawer Proxy
**Objective:** Replace client-side regex matching in `apps/web/src/lib/agentClient.ts` with direct LLM streaming.

- **Current State:** `agentClient.ts` uses `normalized.includes("investigate")`.
- **Implementation:**
  1. Add API route: `POST /v1/agent/chat` in `apps/api/src/routes/agents.ts`.
  2. Route passes operator messages directly to Hermes session.
  3. Stream tokens directly to the Chat Drawer UI with Markdown and syntax highlighting.
  4. Retain DefenseClaw guardrail notice if operator tries to execute destructive bash commands via chat.

### Phase 4: Controlled Real AWS Failure Sandbox (Optional / Safe)
**Objective:** Replace database-only synthetic incidents with safe, real AWS sandbox experiments.

- **Current State:** `simulate-failure` writes a row to PostgreSQL.
- **Implementation:**
  1. Deploy a single Fargate demo task (`checkout-service:v2.4.0`) in `eu-north-1` using the scoped `cloudops-operator` user.
  2. Trigger failure safely by updating task definition to reference non-existent tag `v2.4.1-broken` (cost: 0 NAT Gateway, 0.25 vCPU = pennies/hour).
  3. Real CloudWatch metrics and ECS event bridge capture the real failure.
  4. Hermes investigates the real stopped task in AWS, diagnoses it, and rolls it back.

---

## 6. Security, Governance & Risk Mitigations

```
┌───────────────────────────┬─────────────────────────────────────────────────────────────┐
│ Risk Category             │ Enforced Platform Defense                                   │
├───────────────────────────┼─────────────────────────────────────────────────────────────┤
│ Prompt Injection          │ DefenseClaw analyzes AST/intent of tool calls before        │
│                           │ execution, independent of LLM persona.                      │
├───────────────────────────┼─────────────────────────────────────────────────────────────┤
│ Hallucinated Root Causes  │ Root-cause synthesis requires at least 1 validated          │
│                           │ cryptographic EvidenceRecord stored in PostgreSQL.         │
├───────────────────────────┼─────────────────────────────────────────────────────────────┤
│ Destructive Cloud Actions │ Commands matching DROP, TRUNCATE, rm -rf, or delete_*        │
│                           │ receive Risk Score ≥ 0.90 and are immediately terminated.   │
├───────────────────────────┼─────────────────────────────────────────────────────────────┤
│ Unauthorized Mutations    │ Any update/rollback requires an Ed25519 digital signature   │
│                           │ from an authorized human operator keypair.                  │
├───────────────────────────┼─────────────────────────────────────────────────────────────┤
│ Secret Exposure           │ Real AWS STS credentials expire automatically (1h TTL)     │
│                           │ and are never persisted to PostgreSQL, logs, or UI.         │
└───────────────────────────┴─────────────────────────────────────────────────────────────┘
```

---

## 7. Acceptance Criteria & Definition of Done

The feature will be considered **Complete and Production-Ready** only when:

- [ ] **1. Real Neural Reasoning:** The prompt from the UI is proven to reach the Nemotron-3 model running inside Hermes, and the investigation steps are chosen by the LLM (not by hardcoded TypeScript step indices).
- [ ] **2. Autonomous Tool Selection:** Hermes dynamically decides which AWS tools to call and in what order based on returned observations.
- [ ] **3. Interception Reliability:** 100% of mutating tool calls generated by Hermes are intercepted by DefenseClaw and held in the Approvals Queue.
- [ ] **4. Cryptographic Proof:** No mutation can be applied to AWS without a verified Ed25519 signature from a registered operator key.
- [ ] **5. Audit Immutability:** All session steps, tool inputs, outputs, approvals, and outcomes are chained in the SHA-256 audit ledger.
- [ ] **6. Zero Hardcoded Secrets:** All credentials continue to reside exclusively in `.env`, with zero keys present in code or committed artifacts.
- [ ] **7. Automated E2E Test Suite:** A complete integration test (`tests/integration/hermes_autonomous_investigation.test.ts`) verifies the entire loop from prompt submission to human approval and closed-loop verification.

---

*This document serves as the formal specification and blueprint for completing the autonomous Hermes investigation capability.*
