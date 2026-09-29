# ADR-0008: The Governed Runtime — MCP-Only Execution Boundary for Hermes

**Status:** Accepted — Phase A (decision items 1–3, per-agent governed profile lifecycle) implemented; Phase B (decision item 4, adaptive MCP-driven investigation loop) designed but not implemented — see "Implementation status" below and [ADR-0008 Phase B design notes](ADR-0008-phase-b-design-notes.md).
**Date:** 2026-09-28
**Related:** [ADR-0007](ADR-0007-multi-connector-enterprise-platform-future-scope.md) (multi-connector future scope), the Hermes CLI capability audit (this date), `packages/runtime/src/hermesAgentAdapter.ts`, `packages/policy` (`PolicyEngine`)

## Context

CloudOps's entire security model rests on one rule: no cloud mutation happens without passing through `PolicyEngine.evaluate()` — IaC ownership check, DefenseClaw (OPA/Rego) policy, scope fencing, human approval, hash-chained audit log. That rule only holds if every tool call the agent can make is an MCP call to CloudOps's own governed MCP server, because that server is the only path `PolicyEngine` sits on.

A capability audit of the installed Hermes CLI (`hermes --help`, every subcommand's `--help`, `hermes tools list`, `hermes plugins list`, `hermes doctor`, plus a live create → write → recall → isolate → delete test of the `profile` mechanism) found that CloudOps currently uses almost none of what Hermes ships — every call in the codebase is a single invocation shape: `hermes -z "<prompt>" --ignore-rules`, a stateless one-shot completion. Everything else — Hermes's own multi-turn tool-calling loop, its native toolsets, MCP client/server support, memory, skills, cron, webhooks, and multi-profile orchestration — is either deliberately suppressed or simply never reached.

This ADR records the architecture that lets CloudOps use far more of Hermes's real capability while keeping the one guarantee the product can't compromise on, and the market evidence that this is the industry's own answer to the same problem, not a defensive compromise unique to this project.

## The core finding: native tool execution and full trace are mutually exclusive

Hermes draws a hard structural line between two execution paths, confirmed directly from `hermes tools --help`: *"Built-in toolsets use plain names (e.g. web, memory). MCP tools use server:tool notation (e.g. github:create_issue)."*

- **MCP tools** — Hermes sends a tool-call request over the MCP protocol to an external server. The server executes it and returns a result. Every hop is a message CloudOps controls and logs. This is the path `PolicyEngine` sits on.
- **Native toolsets** (`terminal`, `file`, `code_execution`, `browser`, `computer_use`, `delegation`, `cronjob`) — built directly into Hermes's own runtime. When the model calls one, Hermes executes it in-process, on whatever host it's running on. There is no server in between, no MCP message, nothing for CloudOps to intercept.

Confirmed live via `hermes tools list`: `terminal`, `file`, `code_execution`, `browser`, `computer_use`, and `delegation` are **enabled by default** on the profile CloudOps uses. They're dormant today only because CloudOps always calls `-z` without `--yolo` — a process discipline, not a config guarantee. A future change that adds an agentic flag would hand the model host shell/file access with no `PolicyEngine` in between.

**Decision: every capability CloudOps turns on for an agent must be reachable only as an MCP call to CloudOps's own server. Every native toolset stays explicitly disabled, permanently, not by convention.**

## The architecture

Scoped per onboarded agent, since every trace table CloudOps has (`tool_executions`, `runs`, `audit_events`, `approvals`) is already keyed by `agent_id`:

1. **Onboarding provisions an isolated Hermes profile per agent.** `hermes profile create ag_<id> --clone --no-alias`. Live-verified this session: a real profile was created, told a secret fact, confirmed to recall it, confirmed the default profile had no knowledge of it, then deleted with no artifacts left behind. Separate `config.yaml`, memory, skills, and auth per profile — a real isolation mechanism, not a per-tenant convention layered on shared state.
2. **That profile's only tool surface is CloudOps's own MCP server**, registered via `hermes mcp add`. Every native toolset listed above is explicitly disabled on the profile.
3. **Hermes runs its real multi-turn reasoning loop** against that one tool surface, replacing today's hardcoded 3-step script. Confirmed by rereading `hermesAgentAdapter.ts`'s `runInvestigation()`: it always calls `aws_ecs_describe_services` → `aws_cloudwatch_get_metric_data` → `aws_ecs_describe_stopped_tasks`, in that exact fixed order, and only invokes Hermes once at the end to synthesize a narrative from evidence the TypeScript already decided to collect. The model never decides what to check next. Switching to a real MCP-only tool-calling loop means Hermes actually drives the investigation — adaptive, evidence-driven — instead of narrating a fixed script's output.
4. **Every tool call still lands on `PolicyEngine`** — IaC gate, DefenseClaw, scope fencing, classification, budget cap, human approval for anything mutating. Unchanged from today, because the enforcement point never moved.
5. **Full trace falls out of the design, not bolted on after.** Same `tool_executions` / `audit_events` / `runs` tables, now populated by a real variable-length reasoning loop instead of three fixed rows — plus the model's own turn-by-turn reasoning becomes visible for the first time, instead of only a synthesized narrative.

## What's gained without touching the execution boundary

All of the following operate one layer above tool execution and are fully usable under the MCP-only constraint (full detail in the companion Hermes Capability Map):

| Capability | What it gives CloudOps |
|---|---|
| Real agentic loop | Adaptive investigation instead of a fixed script — the single biggest capability gap found in the audit |
| Tool-loop guardrails | Warn/hard-stop thresholds for repeated failures and no-progress loops, already configured in `config.yaml` — the safety net that makes an autonomous loop viable |
| Context compaction | Automatic history compression tuned for long sessions, so a multi-tool investigation doesn't blow its context window |
| Profile isolation | One Hermes instance per agent, own memory/config/auth — verified working, solves multi-tenant isolation natively |
| Provider abstraction + fallback | Two dozen+ model providers behind one interface, automatic failover on outage — a config change, not an integration project |
| Kanban task board | Durable, atomic cross-profile task claiming and dependency graphs — real substrate for the future multi-agent vision ([ADR-0007](ADR-0007-multi-connector-enterprise-platform-future-scope.md)), provided every worker profile stays MCP-only |

## Market proof

### MCP is not a niche or defensive choice

- MCP server downloads grew from ~100,000 (Nov 2024) to over 8 million (Apr 2025); 5,800+ public MCP servers and 300+ MCP clients now exist. — *The New Stack, guptadeepak.com*
- OpenAI adopted MCP across its Agents SDK, Responses API, and ChatGPT desktop starting March 2025. Microsoft embedded it into Azure AI services. Google DeepMind confirmed support in the Gemini SDK. Production deployments are documented at Block, Bloomberg, Amazon, and hundreds of Fortune 500 companies. — *The New Stack, "Why the Model Context Protocol Won"*
- In December 2025, Anthropic donated MCP to the Linux Foundation's newly formed Agentic AI Foundation — it is now jointly stewarded, not single-vendor. — *Pento, "A Year of MCP"*

### Human-in-the-loop is the industry's own answer for AI-driven IT operations

- PagerDuty's SRE Agent (launched October 2025) runs a six-step loop — diagnose, surface context, analyze, suggest remediation, **run only approved actions automatically**, learn — the same shape as CloudOps's approval pipeline. A fintech company using this pattern cut MTTR from 45 minutes to under 5, with humans kept in the loop for every production change.
- The EU AI Act (Article 14) and NIST's AI Risk Management Framework both require human oversight that is trained, measurable, and provable for high-risk automated systems.
- Gartner projects 70% of enterprises will run agentic AI in IT infrastructure operations by 2029, up from under 5% in 2025 — but also estimates **more than 40% of agentic AI projects could be cancelled by 2027**, citing unclear value, rising cost, and **weak governance** as the causes. McKinsey data puts only 23% of organizations as having actually scaled an agentic system to production, versus 62% "engaged" at some level — governance, not model capability, is the gap between those numbers.

### Hermes specifically, and why not OpenClaw

Hermes Agent (Nous Research) and OpenClaw are two separate, competing open-source agent runtimes — not two names for the same product, despite being referenced together earlier in this project's own discussion.

- Nous Research was raising at least $75M at a $1.5B valuation as of July 2026 (led by Robot Ventures, USV participating). `nousresearch/hermes-agent` has ~214,000 GitHub stars and ~40,000 forks. — *TechCrunch, 2026-07-13*
- Nous Research already sells **Hermes Enterprise** — the same self-improving agent stack deployed on-prem or in the customer's own cloud, explicitly for security operations, compliance automation, and developer productivity at "some of the world's largest companies." This is the same deployment shape CloudOps needs (private infrastructure, compliance-sensitive, enterprise IT) as a funded, supported product tier — not a repurposed personal-assistant tool. — *AlphaSignal, TechCrunch*

**Security comparison** (Composio, "OpenClaw vs Hermes Agent: The best agent harness in 2026"):

| | Hermes Agent | OpenClaw |
|---|---|---|
| Process model | Sandboxed: Docker with hardened flags, no privileged mode, no sensitive mounts by default; read-only root filesystems; dropped capabilities; namespace isolation | Single process, broad host permissions — tools, integrations, and adapters share one address space |
| Pre-execution checks | Tirith pre-execution scanner; MCP credential filtering (subprocesses get only explicitly-approved env vars) | Sandboxing off by default (configurable, not the shipped posture) |
| CVE record | Zero agent CVEs to date | **CVE-2026-25253**: unauthenticated remote code execution, CVSS 8.8 (runZero, Feb 2026) — "tens of thousands of unpatched instances compromised before the patch caught up" |

**The exact failure mode this architecture prevents — already measured, not hypothetical.** From Hermes's own published user stories (`hermes-agent.nousresearch.com/docs/user-stories`): an operator ran root-cause-analysis audits against 129 real Hermes agent sessions over 23 days specifically to check compliance with approval gates, and found **112 violations** — a ~87% violation rate on approval-gate compliance in a real deployment that wasn't built with a single, unavoidable MCP-only enforcement boundary. This is the concrete version of the general argument above: giving an agent native tool access because it's "more capable" doesn't fail occasionally — in a documented real case, it failed on the overwhelming majority of sessions audited. An MCP-only boundary with `PolicyEngine` as the single choke point isn't defense-in-depth layered on top of trusting the model to behave; it's the only version of this with a compliance number worth trusting.

## Decision

Adopt the governed-runtime architecture described above as the standing direction for how CloudOps uses Hermes going forward. Concretely, in priority order:

1. **Lock the native toolsets off, explicitly, per profile.** Not "unused by convention" — `hermes tools disable terminal file code_execution browser computer_use delegation cronjob` on every agent profile, enforced at onboarding, not assumed.
2. **Provision one Hermes profile per onboarded agent**, in current AWS scope, not deferred to ADR-0007's future work — the isolation mechanism is verified and the multi-tenant need already exists today.
3. **Register each profile's MCP client against CloudOps's own server, and nothing else.** This is the one rule everything above depends on holding.
4. **Replace the fixed 3-step investigation script with a real Hermes-driven MCP-only tool loop.** The single largest untapped capability found in the audit — scope as its own piece of work, since it changes how investigations make decisions, not just how they execute them.
5. **Apply the same rule with no exceptions to future orchestration and connector work** ([ADR-0007](ADR-0007-multi-connector-enterprise-platform-future-scope.md)): kanban workers, and Salesforce/ServiceNow/SAP tools alike, must be MCP-only.

## Implementation status

Phase A (decision items 1–3) is implemented. Phase B (decision item 4) is designed but not implemented — see [ADR-0008 Phase B design notes](ADR-0008-phase-b-design-notes.md) for the full design, the concrete gaps it found, and why it was deliberately left unimplemented rather than rushed.

### Phase A — implemented

- **`packages/runtime/src/hermesProfileService.ts`** (`HermesProfileService`): provisions one isolated Hermes profile per onboarded agent (`hermes profile create <agentId> --clone --no-alias`), explicitly disables the native toolsets named in this ADR (`terminal`, `file`, `code_execution`, `browser`, `computer_use`, `delegation`, `cronjob`) and independently re-verifies via a fresh `hermes tools list` parse, strips any inherited/extra MCP server and registers CloudOps's own `/v1/mcp/sse` as the only one (authenticated with a real `cred_...` runtime credential minted via the existing `RuntimeCredentialService` — no new auth path), and independently re-verifies that too via `hermes mcp list` + `hermes mcp test`. Fails closed throughout: `governance_status` is only ever `LOCKED_DOWN` when every check passed; any failure anywhere leaves it `FAILED`. `verifyGovernance()` re-runs the same two checks on demand (drift after provisioning — a toolset re-enabled, an extra MCP server added out of band — is caught, not just the initial attempt). `deprovisionProfile()` tears down the profile on agent deletion.
- **`database/migrations/019_hermes_governed_profiles.sql`**, **`database/src/schema.ts`**: `agents.hermes_profile_name`, `agents.governance_status` (`PENDING`/`LOCKED_DOWN`/`FAILED`), `agents.governance_verified_at`, `agents.mcp_registered`.
- **`packages/identity/src/repository.ts`, `service.ts`**: `AgentRecord`/`AgentService` surface the governance fields; `updateGovernance()` for writes.
- **Wired into the real onboarding lifecycle**: `packages/onboarding/src/claim.ts`'s `claimBootstrapCredential()` provisions the governed profile right after the credential-claim transaction commits (the point an agent's identity becomes real) — best-effort/non-blocking to the claim response, fail-closed on the governance record. `apps/api/src/routes/agents.ts`'s `DELETE /v1/agents/:id` tears it down first. `POST /v1/agents/:id/verify-governance` re-verifies on demand; `GET /v1/agents` and `GET /v1/agents/:id` surface the fields; `apps/web`'s agent diagnostics page shows a "Governed Runtime Lockdown" panel with a per-agent Re-verify action.
- **`HermesAgentAdapter`** (`packages/runtime/src/hermesAgentAdapter.ts`) gained a settable `hermesProfileName` field (mirroring the existing `agentName`/`activeModel` mutable-field pattern) that makes `executeHermesInference()` pass `-p <profile>` — wired in behind an explicit `governance_status === 'LOCKED_DOWN'` check in both `investigations.ts` (`applyGovernedProfile()`) and the `/v1/agent/chat` route, so a session for a given agent talks through its own governed profile once one exists, with zero behavior change for any agent that doesn't have one (the pre-existing shared/default-profile dev/test path is untouched).
- Tests: `tests/unit/hermes_governed_profile.test.ts` (15 cases covering the happy path and every fail-closed branch: profile-creation failure, toolset-disable-didn't-stick, MCP-unreachable, drift re-detected on re-verification, CLI-binary-missing, teardown-is-non-fatal).

### Phase B — designed, not implemented

Replacing `runInvestigation()`'s fixed 3-step script with a real Hermes-driven adaptive loop. See the companion design notes for: why `-z` (oneshot) likely already runs Hermes's full tool-calling loop against whatever MCP server a profile has registered (live-checked against the installed CLI's own `--help` text, not end-to-end verified against a running `apps/api`+Hermes pair); the proposed `runAdaptiveInvestigation()` fallback shape that preserves 100% backward compatibility; the real tool-loop-guardrail config keys (`agent.max_turns`, `tool_loop_guardrails.*`) live-verified as settable per profile; and — the most important finding — that `CloudOpsMcpServer` (`packages/tools/src/mcpServer.ts`) does not persist `tool_executions`/`audit_events` today, so an adaptive loop calling it directly over MCP would silently lose trace visibility unless that persistence moves into the MCP server itself first.

## Sources

- The New Stack — ["Why the Model Context Protocol Won"](https://thenewstack.io/why-the-model-context-protocol-won/)
- Pento — ["A Year of MCP: From Internal Experiment to Industry Standard"](https://www.pento.ai/blog/a-year-of-mcp-2025-review)
- guptadeepak.com — ["MCP Enterprise Adoption Guide 2026"](https://guptadeepak.com/research/mcp-enterprise-guide-2025/)
- DevOps.com — ["MCP-Powered Agentic AI in DevOps"](https://devops.com/mcp-powered-agentic-ai-in-devops-building-secure-scalable-multi-agent-pipelines-for-autonomous-sre-and-observability/)
- Gartner — ["Predicts 40% of Enterprise Apps Will Feature Task-Specific AI Agents by 2026"](https://www.gartner.com/en/newsroom/press-releases/2025-08-26-gartner-predicts-40-percent-of-enterprise-apps-will-feature-task-specific-ai-agents-by-2026-up-from-less-than-5-percent-in-2025); 2026 CIO and Technology Executive Survey; 2026 Hype Cycle for Agentic AI
- McKinsey — agentic AI production-scaling data, via industry aggregation
- TechCrunch — ["Hermes agent maker Nous Research in talks for new funding at $1.5B valuation"](https://techcrunch.com/2026/07/13/hermes-agent-maker-nous-research-in-talks-for-new-funding-at-1-5b-valuation/) (2026-07-13)
- GitHub — [nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent)
- [Hermes Agent User Stories & Use Cases](https://hermes-agent.nousresearch.com/docs/user-stories)
- Composio — ["OpenClaw vs Hermes Agent: The best agent harness in 2026"](https://composio.dev/content/openclaw-vs-hermes-agent)
- docs.openclaw.ai — ["OpenClaw and Hermes Agent"](https://docs.openclaw.ai/start/why-openclaw/openclaw-and-hermes-agent) (self-comparison)
