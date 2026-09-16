# Chat Drawer Governance & Blast Radius Audit Report

**Date:** 2026-09-16  
**Auditor:** CloudOps Autonomous Control Plane Security & Governance Suite  
**Scope:** `apps/web/src/lib/agentClient.ts`, `apps/web/src/context/AgentChatContext.tsx`, `apps/web/src/components/agent/CloudOpsAgentChat.tsx`, and `apps/web/src/app/infrastructure/[serviceId]/page.tsx`  
**Classification:** Forensics & Remediation Verification

---

## 1. Executive Summary & Definite Blast Radius Verdict

A forensic audit was conducted on the web UI's right-hand chat drawer (`useAgentChat` / `CloudOpsAgentClient.executeQuery`) to determine whether user input typed into the chat could trigger unauthorized AWS mutations, reach the execution layer, or assume the CO-020 remediation role without passing through CO-018's Policy Engine and CO-019's Approval Workflow.

### **Definitive Verdict: No Mutating Action Reachable (Air-Gapped Client Prototype)**
- **Mutating Blast Radius:** **ZERO**. There is **no code path** in `agentClient.ts`, `AgentChatContext.tsx`, or `CloudOpsAgentChat.tsx` that invokes any mutating API endpoint (`/v1/tools/execute`, `/v1/approvals/execute`, `/v1/investigations/remediate`), calls AWS STS `AssumeRole`, or utilizes the CO-020 remediation role.
- **Deception / Operator Integrity Severity:** **HIGH**. While no cloud mutation was possible, the component was acting as an uncoupled client-side simulator. It performed keyword matching (e.g. matching `"investigate"` to a canned card claiming `95% Confidence` and `Nominal Operations — Zero Critical Anomalies`), and used fallback values (`targetWorkload?.runningCount ?? 1`) instead of real infrastructure state. This created a deceptive illusion of an active AI agent when none was attached.

---

## 2. Exhaustive Code Path Trace

### 2.1 Trace 1: `CloudOpsAgentClient.executeQuery` Call Graph
In `apps/web/src/lib/agentClient.ts`:
1. `checkAgentStatus()`:
   - Calls `fetchAgents(tenantId, operatorId)` (`GET /v1/agents`).
   - If no agent with status `CONNECTED` exists, returns an informational error string: *"CloudOps Agent is currently unavailable... Please connect an agent daemon"*.
   - **Network action**: Read-only `GET`.
2. `getDiscoveredWorkloads()`:
   - Calls `fetchCloudAccounts()` (`GET /v1/cloud-accounts`).
   - Calls `fetchAccountWorkloads()` (`GET /v1/cloud-accounts/:id/workloads`).
   - **Network action**: Read-only `GET`.
3. Keyword Dispatch Table:
   - `normalized.includes("health")`: Generates an in-memory JSON object `structuredCard: { type: "health", cpuPercent: 18, memoryPercent: 34, ... }`.
   - `normalized.includes("checklist")`: Generates an in-memory JSON object `structuredCard: { type: "checklist", ... }`.
   - `normalized.includes("investigate")`: Generates an in-memory JSON object `structuredCard: { type: "investigation", cause: "Nominal Operations...", confidence: 95, ... }`.
   - `normalized.includes("scale") || normalized.includes("mutate")`: Generates an in-memory JSON object `structuredCard: { type: "mutation_approval", action: "Scale ECS Service", ... }`.
   - Default: Returns an in-memory informational string.

### 2.2 Trace 2: Card Consumer in `CloudOpsAgentChat.tsx`
In `apps/web/src/components/agent/CloudOpsAgentChat.tsx` lines 410–448:
When `card.type === "mutation_approval"` is received:
```tsx
<div className="structured-card">
  <div className="structured-card-tag">ACTION REQUIRES APPROVAL</div>
  <div>{card.action}</div>
  <Link href="/approvals" onClick={onCloseDrawer} className="btn-primary">
    Review in Approvals Queue →
  </Link>
</div>
```
- **Evidence**: The button is an HTML navigation hyperlink (`<Link href="/approvals">`).
- It does **not** call `POST /v1/approvals`.
- It does **not** generate an approval ID or insert a record into the database.
- It does **not** execute any mutation.
- When the user navigates to `/approvals`, that page queries the PostgreSQL database via `GET /v1/approvals`. Because no approval record was created in the database, the synthetic card has zero persistence or execution impact.

---

## 3. Discovered Placeholder & Fallback Contaminations

The following fabricated or fallback values were identified across the UI scaffolding:
1. `apps/web/src/lib/agentClient.ts` line 203:
   `const tasksRunning = targetWorkload?.runningCount ?? 1;`
   Fallback masked unprovisioned services by claiming `1` running task.
2. `apps/web/src/lib/agentClient.ts` lines 234–235:
   `cpuPercent: 18, memoryPercent: 34`
   Fabricated metric percentages hardcoded in the health card.
3. `apps/web/src/lib/agentClient.ts` line 289:
   `confidence: 95`
   Fabricated statistical confidence on a canned investigation.
4. `apps/web/src/app/infrastructure/[serviceId]/page.tsx` lines 99–123:
   `Running Tasks: 3 / 3`, `CPU Utilization: 42%`, `Memory Utilization: 61%`.
   Hardcoded placeholder metrics grid on the service detail page.
5. `apps/web/src/app/infrastructure/[serviceId]/page.tsx` lines 130–145 & 217–220:
   Synthetic deployment timestamps and simulated container log stdout lines.

---

## 4. Remediation Strategy

1. **Remove All Keyword Simulation**:
   Dismantle the regex/includes matching in `agentClient.ts`.
2. **Unify Under Single Governed Pipeline**:
   Route all investigation queries directly through `POST /v1/investigations/start` and SSE `/v1/investigations/:id/stream`.
3. **Truthful Infrastructure Data**:
   Bind `apps/web/src/app/infrastructure/[serviceId]/page.tsx` to live discovered workload telemetry from `fetchAccountWorkloads`. If no live container tasks exist or the account has no such workload, render an explicit unprovisioned empty state.
4. **Resilient Error Recovery**:
   Prevent API connectivity drops from triggering uncaught Next.js console errors.
