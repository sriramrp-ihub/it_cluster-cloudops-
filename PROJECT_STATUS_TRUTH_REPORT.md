# CloudOps Project Reality Audit & Status Truth Report
**Date:** September 16, 2026  
**Auditor:** Antigravity AI Engineering Assistant  
**Objective:** 100% transparent, unvarnished disclosure of what is **real and dynamic** versus what is **scripted, heuristic, or mocked** in the CloudOps platform.

---

## 1. Executive Summary & The Direct Answer

> [!CAUTION]
> **Direct Answer to Your Core Question:**  
> **Does the "investigate" prompt flow from the UI through CloudOps and Gateway to Hermes so that the Hermes LLM model autonomously reasons about the incident and picks tools dynamically?**  
> 
> **NO, it does NOT currently do that.**  
> 
> While Hermes is running locally as a daemon (`./hermes dashboard --port 8080`) and CloudOps successfully checks its health and model name (`nemotron-3-ultra` via `ollama-cloud`), **the prompt is NOT passed to the Hermes LLM for neural reasoning.**  
> 
> Instead, the investigation is executed by a **deterministic, programmatic TypeScript state-machine** inside [`packages/runtime/src/hermesAgentAdapter.ts`](file:///Users/user/Desktop/cloud_ops/packages/runtime/src/hermesAgentAdapter.ts). It executes a hardcoded 4-step sequence (`describe_services` $\to$ `get_metric_data` $\to$ `describe_stopped_tasks` $\to$ heuristic `if/else` synthesis) and emits events over Server-Sent Events (SSE). The LLM itself never reads the prompt or chooses the tools.

---

## 2. Action Flow: Desired Vision vs. Actual Code Reality

```
========================================================================================
DESIRED ARCHITECTURE (Vision)
========================================================================================
[User Prompt in UI]
       │
       ▼
[CloudOps Backend / Gateway]
       │
       ▼ (ACP Protocol / WebSocket)
[Hermes Agent Daemon (LLM: nemotron-3-ultra)]
       │
       ├─► 1. LLM dynamically interprets prompt
       ├─► 2. LLM reasons about what telemetry is needed
       ├─► 3. LLM autonomously invokes tools via Gateway/MCP
       ├─► 4. LLM analyzes returned JSON/logs
       └─► 5. LLM forms root cause conclusion & proposes remediation
       │
       ▼
[Policy Engine & DefenseClaw Guardrails]
       │
       ▼
[Human Operator Ed25519 Approval]
```

```
========================================================================================
ACTUAL CODE IMPLEMENTATION (Current Reality)
========================================================================================
[User Prompt in UI or "Simulate Failure" button]
       │
       ▼
[Chat Drawer: apps/web/src/lib/agentClient.ts]
       │ (Evaluated by local TypeScript regex: `normalized.includes("investigate")`)
       ▼
[HTTP POST /v1/incidents/simulate-failure or /v1/investigations/start]
       │ (Creates incident record in PostgreSQL)
       ▼
[HermesAgentAdapter: packages/runtime/src/hermesAgentAdapter.ts]
       │
       ├─► checkHermesHealth(): GET http://127.0.0.1:8080/api/model/auxiliary
       │   (Only confirms daemon is online; returns "nemotron-3-ultra")
       │
       ├─► Step 1 (Fixed): Calls aws_ecs_describe_services
       ├─► Step 2 (Fixed): Calls aws_cloudwatch_get_metric_data
       ├─► Step 3 (Fixed): Calls aws_ecs_describe_stopped_tasks
       └─► Step 4 (Fixed): TypeScript heuristic:
           `if (hasStoppedTasks && (containerError || stopReason)) { ... }`
       │
       ▼
[Approval Service: packages/approvals/src/service.ts]
       │ (Creates mutation approval row in PostgreSQL)
       ▼
[SSE Stream: /v1/investigations/:id/stream]
       │ (Pushes Step, Observation, and Root Cause to React UI)
       ▼
[UI Renders Steps & Root Cause Card]
```

---

## 3. Comprehensive Component Reality Matrix

| Component | What it Promises to Do | How it is Actually Implemented | Reality Status | Relevant File(s) |
| :--- | :--- | :--- | :--- | :--- |
| **Hermes Reasoning** | LLM dynamically analyzes incident and decides actions | Heuristic TypeScript state machine; probes Hermes HTTP only for health/model name | ⚠️ **Scripted / Heuristic** | [hermesAgentAdapter.ts](file:///Users/user/Desktop/cloud_ops/packages/runtime/src/hermesAgentAdapter.ts#L200-L500) |
| **Gateway WebSocket** | Live Hermes agent connects to CloudOps Gateway | Separate Node.js script (`agent-daemon.ts`) connects and sends 15s heartbeats | ⚠️ **Emulated Daemon** | [agent-daemon.ts](file:///Users/user/Desktop/cloud_ops/scripts/agent-daemon.ts) |
| **Frontend Chat Drawer** | Conversational AI chat with connected agent | Client-side TypeScript `if/else` keyword matching (`normalized.includes(...)`) | ⚠️ **Rule-Based Routing** | [agentClient.ts](file:///Users/user/Desktop/cloud_ops/apps/web/src/lib/agentClient.ts#L160-L330) |
| **Failure Simulation** | Injects real infrastructure failure in AWS | Writes an incident record to PostgreSQL with synthetic error metadata | ⚠️ **Database Simulation** | [investigations.ts](file:///Users/user/Desktop/cloud_ops/apps/api/src/routes/investigations.ts#L57-L85) |
| **AWS STS Connection** | Securely assumes scoped IAM roles in AWS | Live AWS STS `GetCallerIdentity` and `AssumeRole` calls to AWS Account `265766933076` | ✅ **100% REAL** | [cloudAccountService.ts](file:///Users/user/Desktop/cloud_ops/packages/adapters/src/cloudAccountService.ts), [awsStsService.ts](file:///Users/user/Desktop/cloud_ops/packages/adapters/src/awsStsService.ts) |
| **Secret Isolation** | Zero cloud secrets stored in PostgreSQL or client | Keys only exist in `.env` and in-memory STS cache; zero secret columns in DB | ✅ **100% REAL** | [schema.ts](file:///Users/user/Desktop/cloud_ops/database/src/schema.ts), [.env](file:///Users/user/Desktop/cloud_ops/.env) |
| **PostgreSQL Database** | Persistent relational state across all entities | Real PostgreSQL schema with Kysely query builder; 6 active migrations | ✅ **100% REAL** | [migrations/](file:///Users/user/Desktop/cloud_ops/database/migrations/) |
| **Ed25519 Signatures** | Cryptographic proof of human operator approval | Native Node `crypto` Ed25519 keypair generation, signature, and verification | ✅ **100% REAL** | [signatures.ts](file:///Users/user/Desktop/cloud_ops/packages/approvals/src/signatures.ts) |
| **Audit Hash Chain** | Immutable SHA-256 tamper-evident log | Cryptographic hash chaining (`sha256(prev_hash + row)`) with DB update triggers | ✅ **100% REAL** | [service.ts](file:///Users/user/Desktop/cloud_ops/packages/audit/src/service.ts) |
| **DefenseClaw Engine** | Intercepts high-risk/destructive cloud tools | Analyzes tool names, SQL commands, CLI args; blocks dangerous actions ($\ge 0.90$) | ✅ **100% REAL** | [defenseClaw.ts](file:///Users/user/Desktop/cloud_ops/packages/security/src/defenseClaw.ts) |
| **Approvals Workflow** | Gating high-risk mutations behind human consent | Real database records, status transitions (`PENDING` $\to$ `APPROVED`/`REJECTED`) | ✅ **100% REAL** | [approvals.ts](file:///Users/user/Desktop/cloud_ops/apps/api/src/routes/approvals.ts) |
| **Server-Sent Events** | Real-time live streaming of investigation progress | Standard SSE endpoint (`text/event-stream`) feeding live steps to React state | ✅ **100% REAL** | [investigate/page.tsx](file:///Users/user/Desktop/cloud_ops/apps/web/src/app/investigate/page.tsx#L168-L220) |

---

## 4. In-Depth Truth Breakdown

### A. What is GENUINELY REAL and Fully Functional?

1. **Real AWS IAM & STS Operations:**
   - When you connect AWS in [Cloud Settings](file:///Users/user/Desktop/cloud_ops/apps/web/src/app/infrastructure/page.tsx) or run [`tests/integration/real_aws_live_connection.test.ts`](file:///Users/user/Desktop/cloud_ops/tests/integration/real_aws_live_connection.test.ts), the backend executes **real HTTP calls against live AWS STS**.
   - It verifies the scoped IAM user `cloudops-operator` in AWS account `265766933076` in region `eu-north-1`.
   - It performs live STS `AssumeRole` into `arn:aws:iam::265766933076:role/CloudOpsReadOnlyRole` and `arn:aws:iam::265766933076:role/CloudOpsRemediationRole`, receiving real temporary session credentials (`ASIA...`).
   - Raw secrets are **never written to PostgreSQL**.

2. **Real PostgreSQL Data Layer:**
   - PostgreSQL genuinely stores and manages tenants, cloud accounts, agent profiles, incident logs, investigations, approvals, and audit events.
   - All migrations (`001` through `006`) run cleanly.

3. **Real Cryptographic Governance:**
   - **Ed25519 Approvals:** When an operator approves an action in [/approvals](file:///Users/user/Desktop/cloud_ops/apps/web/src/app/approvals/page.tsx), the backend genuinely generates or verifies an Ed25519 digital signature over the canonical payload hash (`approvalId:payloadHash:timestamp`).
   - **SHA-256 Audit Chain:** Every event is cryptographically linked to the previous row hash. Modifying any audit record breaks the cryptographic verification.

4. **Real DefenseClaw Guardrails:**
   - If an agent or test attempts to call destructive tools (`aws_rds_delete_db_instance`, `DROP TABLE`, `rm -rf`), `DefenseClawGuardrailService` genuinely analyzes the payload, calculates a risk score $\ge 0.90$, blocks execution, and records a security incident.

---

### B. What is MOCKED, SCRIPTED, or HEURISTIC?

1. **Hermes LLM Reasoning is NOT Connected to Investigations:**
   - The Hermes dashboard/daemon is running on `http://127.0.0.1:8080`.
   - The adapter checks `GET http://127.0.0.1:8080/api/model/auxiliary` which returns:
     ```json
     { "main": { "model": "nemotron-3-ultra", "provider": "ollama-cloud" } }
     ```
   - **That is the only interaction with Hermes.**
   - In [`packages/runtime/src/hermesAgentAdapter.ts`](file:///Users/user/Desktop/cloud_ops/packages/runtime/src/hermesAgentAdapter.ts#L250-L460):
     - Step 1 always calls `aws_ecs_describe_services`.
     - Step 2 always calls `aws_cloudwatch_get_metric_data`.
     - Step 3 always calls `aws_ecs_describe_stopped_tasks`.
     - Step 4 analyzes the JSON outputs using hardcoded TypeScript heuristics:
       ```typescript
       if (hasStoppedTasks && (containerError || stopReason)) {
         finding = `ECS Tasks failing to start for '${targetService}': "${errorDetail}"`;
         remediationToolName = "aws_ecs_update_service_image";
         riskLevel = "CRITICAL";
       }
       ```
     - **The Nemotron-3 LLM never saw the prompt and never decided which tools to invoke.**

2. **Gateway WebSocket is Emulated by a Node Script:**
   - The UI displays an agent as `CONNECTED (Live Daemon Heartbeat)`.
   - That connection is maintained by running [`scripts/agent-daemon.ts`](file:///Users/user/Desktop/cloud_ops/scripts/agent-daemon.ts), which runs in Node.js, connects via WebSocket to `ws://127.0.0.1:3000/v1/gateway/ws`, and sends `HEARTBEAT` messages every 15 seconds.
   - The Python Hermes agent itself does not implement the CloudOps Autonomous Control Protocol (ACP) over WebSocket.

3. **Chat Drawer Uses Local Heuristic Pattern Matching:**
   - In [`apps/web/src/lib/agentClient.ts`](file:///Users/user/Desktop/cloud_ops/apps/web/src/lib/agentClient.ts):
     - When you type `"investigate checkout-service"`, it checks `normalized.includes("investigate")` and calls the `/v1/investigations/start` API.
     - When you type `"is starvision-motors healthy?"`, it checks `normalized.includes("healthy")` and reads the status from the database.
     - When you type `"scale checkout-service"`, it checks `normalized.includes("scale")` and returns a hardcoded governance warning.
   - It is not a conversational AI agent; it is a client-side command dispatcher.

4. **Failure Simulation is Synthetic:**
   - When you click "Launch SRE Failure Simulation" in the UI, it calls `POST /v1/incidents/simulate-failure`.
   - This endpoint **does not touch AWS ECS**. It creates an incident row in PostgreSQL with pre-set strings:
     - `title: "ECS CrashLoop on starvision-motors: Tasks failing steady-state check"`
     - `alertDescription: "CannotPullContainerError: Container image manifest missing..."`

---

## 5. Summary Scorecard

```
┌────────────────────────────────────────┬─────────────┬──────────────────────────────────────────────────┐
│ Feature / Capability                   │ Status      │ Implementation Reality                           │
├────────────────────────────────────────┼─────────────┼──────────────────────────────────────────────────┤
│ AWS IAM Least-Privilege Dual Roles     │ REAL (100%) │ Real STS calls against AWS Account 265766933076  │
│ Zero-Secret Database Architecture      │ REAL (100%) │ .env + in-memory STS sessions; 0 secrets in DB  │
│ Ed25519 Human Approval Signing         │ REAL (100%) │ Native crypto digital signatures verified        │
│ SHA-256 Append-Only Audit Ledger       │ REAL (100%) │ Cryptographic hash chaining enforced             │
│ DefenseClaw Destructive Interception   │ REAL (100%) │ Real policy risk scoring and blocking            │
│ PostgreSQL Relational Schema           │ REAL (100%) │ Full Kysely ORM + migrations                     │
│ Next.js Web UI & Real-Time SSE Stream  │ REAL (100%) │ Live reactive multi-page dashboard               │
├────────────────────────────────────────┼─────────────┼──────────────────────────────────────────────────┤
│ Dynamic Hermes LLM Neural Reasoning    │ NOT DONE    │ Scripted 4-step TypeScript state machine         │
│ Autonomous Tool Selection by LLM       │ NOT DONE    │ Hardcoded tool sequence in adapter               │
│ Native Hermes WebSocket ACP Connection │ NOT DONE    │ Node.js emulator daemon script                   │
│ Conversational Chat Drawer             │ NOT DONE    │ Client-side regex/keyword string routing         │
│ Live AWS ECS Crash Injection           │ NOT DONE    │ Database row with synthetic error message        │
└────────────────────────────────────────┴─────────────┴──────────────────────────────────────────────────┘
```

---

## 6. What Is Required to Make the Flow 100% Dynamic

To replace the scripted heuristics with true end-to-end Hermes LLM reasoning:

1. **Wire Hermes LLM Prompt Inference:**
   - Instead of running the static 4-step sequence in `HermesAgentAdapter`, send a system prompt containing incident details to Hermes's OpenAI-compatible chat completions API:
     ```
     POST http://127.0.0.1:8080/v1/chat/completions
     ```
   - Supply the Canonical Tool definitions (`aws_ecs_describe_services`, etc.) as function-calling schemas.

2. **Enable Autonomous Tool-Calling Loop:**
   - When Hermes returns a tool call (`tool_calls: [{ name: "aws_ecs_describe_services", arguments: {...} }]`), pass it through the **Policy Engine & DefenseClaw**.
   - If allowed, execute the tool against real AWS and feed the tool result back to Hermes.
   - Let Hermes decide when it has enough evidence to output the root cause and propose remediation.

3. **Bridge Hermes Daemon to Gateway WebSocket:**
   - Implement a lightweight bridge inside the Hermes Python daemon or as a sidecar that proxies Hermes's native tool execution directly through the CloudOps Gateway.

4. **Replace Chat Drawer Keyword Matching with Streaming LLM Proxy:**
   - Direct user chat queries from `apps/web` to a backend route `POST /v1/agent/chat` that streams tokens directly from Hermes (`nemotron-3-ultra`).
