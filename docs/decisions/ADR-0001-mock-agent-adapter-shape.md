# ADR-0001: Mock Agent Adapter Architecture & Event Shape

**Status:** Accepted  
**Date:** 2026-09-16  
**Related CO-IDs:** CO-001, CO-002, CO-010, CO-011, CO-012, CO-018, CO-019, CO-022

## Context

Backlog item CO-001 originally specified "Hermes Runtime Setup" and CO-002 specified "Agent Adapter Interface." A prior status report claimed real Hermes integration was functional based on `tests/integration/real_hermes_e2e.test.ts`, but Step 0 audit revealed that test bypassed actual LLM execution via a silent fallback.

Furthermore, autonomous cloud operations control planes must be validated deterministically. Relying on live LLM inference during unit/integration development introduces non-determinism, model latency, external API costs, flaky assertions, and unpredictable behavior. 

Per Step 0.5 instructions, all development and evaluation for CO-001 through CO-028 must execute against a deterministic **Mock Agent Adapter** governed by versioned test fixtures rather than real inference. Real agent execution is strictly deferred to CO-107 ("Real Hermes Operational Turn," Week 8/V9).

> **Reference Note Regarding Live Hermes Instance:**  
> During environment inspection, a live Hermes instance was observed running locally and reachable at `http://127.0.0.1:8080/sessions`. As instructed, this instance will **not** be connected to, queried, or utilized anywhere in CO-001–CO-028. This note is recorded solely to inform the future engineer implementing CO-107 that a live daemon endpoint was present at this stage of the system.

## Decision

We define a provider-neutral `AgentAdapter` interface and an accompanying `MockAgentAdapter` in `@cloudops/runtime`.

### 1. Architectural Interface (`AgentAdapter`)

The interface abstracts all agent runtimes behind four foundational capabilities:
```typescript
export interface AgentAdapter {
  readonly adapterType: string;
  readonly protocol: "acp" | "mcp";

  start(context: AgentExecutionContext): Promise<AgentSession>;
  onEvent(sessionId: string, callback: (event: AgentEvent) => void): () => void;
  onToolCall(sessionId: string, callback: (call: AgentToolCall) => Promise<AgentToolResult>): () => void;
  terminate(sessionId: string, reason: string): Promise<void>;
  getSession(sessionId: string): AgentSession | undefined;
}
```

### 2. Event & Tool-Calling Shapes (Derived from ACP & MCP Specs)

The event shapes conform directly to the Agent Control Protocol (ACP) and Model Context Protocol (MCP) standards referenced in Nous Research Hermes and OpenClaw documentation:

1. **Session Lifecycle:**
   - Status states: `ACTIVE`, `WAITING_APPROVAL`, `COMPLETED`, `FAILED`, `TERMINATED`.
   - `start(context)` validates required fields (tenantId, agentId, incident/task context) and returns a unique `sessionId` (`sess_...`).
2. **Tool-Calling Loop:**
   - Follows JSON-RPC 2.0 / MCP schema:
     ```json
     {
       "callId": "call_12345",
       "toolName": "aws_ecs_describe_clusters",
       "arguments": { "clusters": ["production-cluster"], "region": "us-east-1" },
       "timestamp": "2026-09-16T10:00:00.000Z"
     }
     ```
3. **Investigation Sequence Fixture:**
   - Implements the exact recommended inspection sequence for an ECS incident:
     1. `aws_ecs_describe_clusters`
     2. `aws_ecs_list_tasks`
     3. `aws_ecs_describe_stopped_tasks`
     4. `aws_cloudwatch_get_metric_data`
     5. `aws_alb_get_target_health`
     6. `aws_ecr_describe_images`
   - Concludes with a structured root-cause payload linking evidence IDs:
     ```json
     {
       "type": "root_cause_analysis",
       "finding": "ContainerImageNotFound",
       "rootCause": "Task definition references non-existent ECR image tag 'v2.4.1-broken'",
       "confidence": 0.98,
       "evidenceIds": ["ev_ecs_task_event_stopped", "ev_ecr_image_not_found"],
       "recommendedRemediation": {
         "toolName": "aws_ecs_update_service",
         "arguments": { "cluster": "production-cluster", "service": "api-service", "desiredCount": 2 }
       }
     }
     ```
4. **Remediation Proposal & Approval Handling:**
   - Mutating tool invocations return `{ "status": "AWAITING_APPROVAL", "approvalId": "appr_..." }`.
   - The mock transitions to `WAITING_APPROVAL` without assuming execution success.
   - Evaluates all four terminal approval outcomes: `EXECUTED`, `EXECUTION_FAILED`, `EXPIRED`, and `REJECTED`.
5. **Adversarial Security Fixtures:**
   - Disallowed capability invocation (e.g. `aws_rds_delete_db_instance`) -> asserted to fail closed at policy engine.
   - Approval replay (re-submitting an already `EXECUTED` approval ID) -> asserted to fail with `IdempotencyConflictError`.
   - Payload tampering (modifying JSON payload after approval signature) -> asserted to fail with `SignatureVerificationError`.

## Alternatives Considered

1. **Connecting directly to the live Hermes instance at `127.0.0.1:8080`:**
   - *Rejected:* Introduces non-deterministic LLM sampling, requires external model keys, cannot reliably test adversarial edge cases (e.g. simulating a prompt injection or malformed payload on demand), and violates prompt instructions.
2. **Hardcoding mock responses directly in test files:**
   - *Rejected:* Hardcoding responses inline couples tests to static values and prevents reusing identical scenarios across the CLI, backend API, WebSocket gateway, and UI. Externalizing to versioned JSON fixtures in `packages/runtime/fixtures` allows both the mock agent and future integration suites to share ground truth.

## Consequences

- **Enables 100% Deterministic Testing:** All 28 backlog items in V0–V4 can be tested with sub-second execution speeds and guaranteed repeatability.
- **Isolates Agent Dependencies:** No Hermes or OpenClaw proprietary SDKs leak into the core control plane.
- **Clean Seam for CO-107:** At Week 8/V9, adding real Hermes requires only creating `HermesAgentAdapter` implementing this same `AgentAdapter` interface, requiring zero changes to the gateway, policy, approvals, or cloud execution layers.
