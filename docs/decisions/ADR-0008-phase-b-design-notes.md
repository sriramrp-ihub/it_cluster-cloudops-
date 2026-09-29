# ADR-0008 Phase B — Design Notes: Replacing the Fixed 3-Step Investigation Script

**Status:** Design only — not implemented. Phase A (per-agent governed Hermes profile lifecycle) is implemented; see the "Implementation status" section ADR-0008 itself now carries.

**Scope:** decision item 4 from ADR-0008 — "Replace the fixed 3-step investigation script with a real Hermes-driven MCP-only tool loop." This document is the precise design the task explicitly said was preferable to a rushed, half-working implementation.

## 1. What exists today, re-confirmed by reading the code this session

`HermesAgentAdapter.runInvestigation()` (`packages/runtime/src/hermesAgentAdapter.ts`) is NOT a loop at all. It:

1. Calls `handler()` — the `onToolCall` callback injected by `apps/api/src/routes/investigations.ts`'s `buildToolCallHandler()` — exactly three times, in a fixed order: `aws_ecs_describe_services`, `aws_cloudwatch_get_metric_data`, `aws_ecs_describe_stopped_tasks`.
2. Every `STEP`/`OBSERVATION`/`EVIDENCE` `AgentEvent` is synthesized directly in TypeScript from each call's real result data — Hermes is not consulted at all during this phase.
3. Only once, at the end, does it call `executeHermesInference()` (a one-shot `hermes -z "<prompt>" --ignore-rules` subprocess) to narrate a root cause from the three already-collected observations.
4. `buildToolCallHandler()`'s handler is what actually enforces `PolicyEngine.evaluate()` per call today — **not** an MCP server. This TypeScript-side handler is a stand-in for MCP that predates this ADR's governed-runtime work; it exists because, until Phase A, no Hermes profile had a governed MCP server to call through at all.

This confirms the ADR's own framing: **Hermes never calls a tool today.** The "investigation" is a scripted TypeScript walk through fixed AWS SDK calls, narrated once at the end.

## 2. What Phase A now provides for Phase B to build on

- Every onboarded agent (once `HermesProfileService.provisionProfile()` succeeds) has its own Hermes profile with:
  - Every native toolset (`terminal`, `file`, `code_execution`, `browser`, `computer_use`, `delegation`, `cronjob`) disabled and independently re-verifiable (`verifyGovernance()`).
  - CloudOps's own MCP server (`apps/api`'s `/v1/mcp/sse`) registered as the profile's **only** MCP server, authenticated with a real `cred_...` runtime credential scoped to that agent.
  - `agents.governance_status = 'LOCKED_DOWN'` is the fail-closed signal that both hold.
- `HermesAgentAdapter.hermesProfileName` (settable field, mirroring the existing `agentName`/`activeModel` mutable-field pattern) makes `executeHermesInference()` pass `-p <profile>` — i.e., **the plumbing to address a specific agent's own governed profile from a CLI call already exists and is wired into both the chat route and `investigations.ts`'s `applyGovernedProfile()`.**

Phase B's job is narrower than it looks: it is not "build MCP support" (Phase A did that) — it's "stop hand-writing the investigation script in TypeScript and let Hermes's own loop, talking to that MCP server, decide what to check."

## 3. The core mechanism: does `-z` (oneshot) actually run a tool-calling loop?

Live-checked against the installed `hermes` v0.18.2's own CLI help this session (not assumed): `-z, --oneshot PROMPT` is described as *"send a single prompt and print ONLY the final response text to stdout. No banner, no spinner, no tool previews, no session_id line. **Tools, memory, rules, and AGENTS.md in the CWD are loaded as normal**; approvals are auto-bypassed."*

Read literally, this means `-z` **does** run Hermes's normal multi-turn agent loop — including calling any tools it has available (native toolsets, or, once Phase A registers one, its MCP server) — and only suppresses the CLI's own turn-by-turn chrome from stdout, printing just the final answer. This is consistent with `--ignore-rules` (used everywhere today) being a *separate* flag that only skips AGENTS.md/memory/skill injection, not tool use.

**This was not end-to-end verified against a live apps/api + Hermes daemon pair together in this session** (no combined live rig was stood up — see ADR-0008's "What's real vs. designed" section). The design below should be validated with one real, disposable run (governed profile provisioned against a running `apps/api`, then one `hermes -p <profile> -z "<investigation prompt>"` call, inspecting `tool_executions`/`audit_events` afterward for evidence Hermes actually called the MCP server) before this is trusted for production traffic.

## 4. Proposed design

### 4.1 New adapter method shape (keep `runInvestigation()`'s contract frozen)

`runInvestigation()`'s existing signature, `AgentEvent` union (`STEP | OBSERVATION | EVIDENCE | ROOT_CAUSE | PROPOSAL | STATUS | ERROR`), and `InvestigationDriveResult` shape (`{status, rootCause, approvalId?}`) are the external contract `apps/api/src/routes/investigations.ts` and the web investigation view depend on. Phase B must not change any of this — only what happens *inside* `runInvestigation()`.

```
async runInvestigation(sessionId, incidentContext?): Promise<InvestigationDriveResult> {
  if (this.hermesProfileName && governed-and-reachable) {
    try {
      return await this.runAdaptiveInvestigation(sessionId, incidentContext);
    } catch (err) {
      logger.warn(..., "Adaptive investigation loop failed, falling back to grounded script");
      // fall through to today's existing fixed-script path, unchanged
    }
  }
  return this.runFixedScriptInvestigation(sessionId, incidentContext); // today's code, renamed, byte-identical behavior
}
```

This preserves the exact "degrades the same way the current code does" requirement: no governed profile, or the adaptive path throwing for any reason, and the caller gets today's behavior, unchanged.

### 4.2 What `runAdaptiveInvestigation()` actually does

1. Emit `STATUS`/`STEP` events marking the investigation as adaptive-mode-started (for UI parity with today's per-step events).
2. Build a single task prompt describing the incident (cluster/service/region/alertDescription — the same `InvestigationDriveContext` fields used today) and instructing Hermes to investigate using its available tools, then respond with the same strict JSON schema `runInvestigation()` already asks the LLM for at synthesis time today (`finding`, `rootCause`, `confidence`, `remediationTool`, `remediationParams`, `riskLevel`, `requiresApproval`) — reusing the exact schema/prompt-construction code already in `hermesAgentAdapter.ts` rather than inventing a second one.
3. Call `executeHermesInference(prompt, timeoutMs)` **once**, with `this.hermesProfileName` set (so it runs `-p <profile> -z "<prompt>" --ignore-rules`). Hermes's own loop (per §3) is what decides which MCP tools to call, how many times, and in what order, against the ONE server its profile has (`cloudops-control-plane`) — this is what makes it adaptive rather than the fixed order today.
4. Parse the final JSON exactly as `extractJsonFromLlmOutput()` already does. Build the same `rootCause` object shape `runInvestigation()` returns today.
5. For `riskLevel` HIGH/CRITICAL, emit `PROPOSAL` and call the SAME `handler()` (`onToolCall`) the fixed-script path uses today, so the mutation proposal still goes through the identical approval-creation code in `investigations.ts` — Phase B changes *investigation*, not *remediation proposal*, which was never adaptive to begin with and doesn't need to be.

### 4.3 Turn budget and no-progress/repeated-failure guardrails (live-verified this session)

Hermes ships exactly the guardrail primitives ADR-0008 pointed at, confirmed by reading the installed CLI's own `hermes_cli/config.py` `DEFAULT_CONFIG` this session (not guessed):

```yaml
agent:
  max_turns: 90        # global default; per-profile override verified via:
                        #   hermes -p <profile> config set agent.max_turns 20

tool_loop_guardrails:
  warnings_enabled: true        # on by default
  hard_stop_enabled: false      # OFF by default — interactive sessions keep flowing
  warn_after:
    exact_failure: 2
    same_tool_failure: 3
    idempotent_no_progress: 2
  hard_stop_after:
    exact_failure: 5
    same_tool_failure: 8
    idempotent_no_progress: 5
```

Live-verified this session in a scratch profile: `hermes -p <profile> config set agent.max_turns 20` and `hermes -p <profile> config set tool_loop_guardrails.hard_stop_enabled true` both succeed and persist to that profile's `config.yaml` (`✓ Set ... in .../config.yaml`).

**Design decision:** `HermesProfileService.provisionProfile()` should gain one more step (additive, does not change Phase A's already-shipped behavior since it doesn't affect `governance_status`) that sets, on every governed profile:
- `agent.max_turns` → a bounded value for autonomous investigations (suggest 20 — generous enough for a real multi-tool investigation, small enough to bound worst-case cost/latency; this is a product/ops tuning call, not an architectural one).
- `tool_loop_guardrails.hard_stop_enabled` → `true` (autonomous, unattended investigation sessions should hard-stop on repeated failure/no-progress; the CLI's own `false` default is deliberately for interactive human sessions, which this is not).

This is intentionally its own, separate provisioning step — not folded into the toolset-disable/MCP-registration invariants Phase A's `governance_status` tracks — because a mis-set turn budget is a cost/quality concern, not a security boundary; it should not be able to flip an otherwise-correctly-locked-down agent to `FAILED`.

### 4.4 The real gap Phase B must close: trace persistence moves to the MCP server

This is the least obvious finding from actually reading the code, and the reason a half-implemented Phase B would be worse than none: **`CloudOpsMcpServer.registerAuthorizedTools()` (`packages/tools/src/mcpServer.ts`) does not write to `tool_executions` or `audit_events` at all today.** Every tool call reaching it today (probe calls from `/v1/agents/:id/test`, or an external MCP client) runs `PolicyEngine.evaluate()` and, for mutations, `ApprovalService.createApprovalRequest()` — but never persists a `tool_executions` row. That persistence exists only in `investigations.ts`'s `buildToolCallHandler()` — the TypeScript-side shim `runAdaptiveInvestigation()` above bypasses entirely, since Hermes will be calling the MCP server directly over its SSE transport, not through that handler.

Without a fix, an adaptive investigation would lose the very thing ADR-0008 promises: *"Full trace falls out of the design, not bolted on after... the model's own turn-by-turn reasoning becomes visible for the first time."* Losing `tool_executions` rows for MCP-originated calls is a regression from today's fixed-script path (which does persist each of its 3 calls via the handler), not neutral.

**Design decision:** move `tool_executions`/`audit_events` persistence into `CloudOpsMcpServer.registerAuthorizedTools()`'s handler itself — right alongside the existing `policyEngine.evaluate()` call, before the read/approval branches. This is the correct home for it regardless of Phase B: it makes every caller of the MCP server (Hermes's adaptive loop, the `/v1/agents/:id/test` probe, any future external MCP client) get identical, complete tracing, rather than only the one caller (`investigations.ts`) that happens to also maintain its own TypeScript-side shim. Needs:
- A `runId` threaded into `CloudOpsMcpServerOptions` (or resolved via a lookup keyed by `agentId` — there should be at most one active `run` per investigation session) so `tool_executions.run_id` still correlates the way `RunService.createRun()` already establishes today.
- The exact same `reasoning_snippet`-capture behavior `buildToolCallHandler()` has today — but an MCP tool call arriving over the wire has no `AgentToolCall.reasoning` field the way today's TypeScript-constructed calls do (see `agentAdapter.ts`'s `AgentToolCall.reasoning` — MCP protocol's `CallToolRequest` has no equivalent field). This needs either (a) accepting that MCP-originated `reasoning_snippet` will be null/empty until Hermes is prompted to prefix its tool-call rationale into a way CloudOps can capture it (there is no standard MCP mechanism for this — sampling/logging extensions in the MCP spec could work but add real client-support risk), or (b) a follow-up prompt asking Hermes to narrate its own reasoning trail as its final JSON output's own field (e.g. `investigationNarrative: string[]`) reconstructed after the fact from the model's own summary rather than captured live per-call. (b) is more realistic short-term and should be the Phase B v1 approach; (a) is a real MCP-ecosystem gap, not a CloudOps one, worth revisiting only if MCP's spec grows a standard way to carry it.

### 4.5 Approval gating is unchanged, by design

Every tool call — adaptive or fixed-script — still lands on `CloudOpsMcpServer`'s single `policyEngine.evaluate()` call site. Nothing about Phase B weakens this: whether the calling agent is TypeScript's `buildToolCallHandler()` (today) or Hermes's own MCP client (Phase B), both paths for a real governed profile ultimately execute against the SAME `CloudOpsMcpServer` instance behind `apps/api`'s `/v1/mcp/sse` — the identical `IacGateService` → `DefenseClawGuardrailService` → `PolicyFencingService` → mandatory-approval-for-mutations pipeline runs either way. This is the entire point of Phase A's MCP-only boundary: Phase B changes *who decides what to check next*, never *what's allowed to execute unapproved*.

### 4.6 Backward compatibility checklist

- `AgentAdapter.runInvestigation()` signature: unchanged.
- `AgentEvent` union and payload shapes: unchanged (adaptive mode still emits `STEP`/`OBSERVATION`/`EVIDENCE`/`ROOT_CAUSE`/`PROPOSAL` — just with variable count/order instead of fixed 3).
- `InvestigationDriveResult`: unchanged.
- `apps/api/src/routes/investigations.ts`: no changes required to its external HTTP contract; internal wiring (`applyGovernedProfile()`, `buildToolCallHandler()` for the proposal step) already Phase-A-ready.
- `MockAgentAdapter` and every test built on it (`tests/integration/incident_investigation_workflow.test.ts`, `tests/unit/agent_adapter_contract.test.ts`): untouched — the mock's own fixed-script behavior is a deliberate deterministic test fixture, not something Phase B should touch.
- No live Hermes daemon + `apps/api` pair was run together this session to end-to-end verify §3's core assumption (that `-z` truly loops on tools) or §4.4's MCP-server trace gap in a live investigation — both should be the first things verified, with a disposable governed profile against a running dev `apps/api`, before writing the `runAdaptiveInvestigation()` code above.

## 5. What's explicitly NOT in scope here (per ADR-0007)

No connector work, no multi-agent orchestration, no cloud deployment of the Hermes runtime. This stays exactly what ADR-0008 scoped: one agent's own investigation loop, against its own governed MCP server, still gated by the one shared `PolicyEngine`.
