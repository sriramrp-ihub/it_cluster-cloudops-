# Apollo[Claw] Product Benchmark — Recommendations for CloudOps

**Date:** 2026-09-29
**Scope:** Product/architecture benchmark of Apollo[Claw] (apolloclaw.ai), translated into grounded, repo-verified recommendations for CloudOps.
**Method:** Public web research (WebFetch/WebSearch against apolloclaw.ai and related sources, all cited) + direct reading of the CloudOps repository at `/Users/user/Desktop/cloud_ops` (branch `feat/defenseclaw-hardening-and-parity`) — every "CloudOps already has X" claim below is backed by a file path the author actually read this session, not a description or memory of the codebase.

**Evidence key used throughout:**
- **[DOCUMENTED]** — stated verbatim or near-verbatim on a live apolloclaw.ai page, with URL cited.
- **[INFERRED]** — not stated outright, but a reasonable reading of Apollo's positioning language; flagged as inference, not fact.
- **[PROPOSED]** — the author's own adaptation for CloudOps; not an Apollo claim at all.
- **[VERIFIED]** — a CloudOps repository fact, confirmed by reading the cited file this session.

---

## 1. Executive Summary

**The headline finding, stated plainly up front: Apollo[Claw] is not an autonomous cloud-infrastructure operations product, and its public documentation is thin.** apolloclaw.ai is a boutique AI-agent consultancy (NYC/Long Island, founder David Oralevich) that builds custom, persona-based "Chief of Staff" agents — CEO Agent, CFO Agent, Sales Agent, Recruiting Agent, Law/Insurance/Medical/Real Estate/Personal Agents — for small and mid-sized businesses, deployed on a dedicated VPS or client-owned Mac Mini, sold through a white-glove consulting engagement ("Book a Discovery Call," no public pricing). It has no public product surface resembling CloudOps's problem space (AWS infrastructure, incident response, tool-call governance). Six pages were fetched directly (home, `/about`, `/security`, `/enterprise`, `/integrations`, `/case-studies`) and none of them contain a dashboard screenshot, an API reference, a described approval-workflow UI, an agent-fleet monitoring concept, a cost/spend-control mechanism, or any agent-operational metric (task success rate, uptime, tool-call count, error rate). What exists publicly is almost entirely: (a) business-outcome case-study numbers aimed at a buyer, and (b) generic infrastructure/compliance security posture (encryption, ISO 27001, SOC 2 Type I on request, MFA).

**Per this project's own ground rules, that thinness is reported honestly rather than papered over.** This report leans hard on category 2 (inferred from positioning) and category 3 (CloudOps-specific proposals) for anything resembling agent mechanics, autonomy configuration, or a performance dashboard — because Apollo simply does not document those mechanisms publicly. Every Apollo claim below carries a source URL; every "CloudOps already has X" claim cites the exact file this session read to confirm it, consistent with the standing norm in `docs/benchmarks/manual-engineer-baseline.md` against fabricated metrics.

**What actually turned out to be useful from this exercise is not a feature list to copy — it's a product-communication gap Apollo exposes by contrast.** Apollo talks fluently in outcome metrics ("10–20 hours a week back," "month-end close cut from 11 days to 6," "no-shows down from 18% to under 6%") and gives every agent a name and a dedicated environment, which makes even a fairly simple assistant *feel* like a hired specialist doing real, trackable work. CloudOps has the opposite profile: a materially deeper and harder safety architecture — a governed MCP-only execution boundary (ADR-0008), a four-stage `PolicyEngine` (IaC gate → DefenseClaw/OPA → blast-radius/scope fencing → mandatory-approval classification), cryptographically signed human approvals with tamper-evident payload hashing and a full revert chain, and a hash-chained immutable audit ledger — none of which currently surfaces as a legible, trust-building, outcome-oriented product experience. The recommendations in Section 14 target closing exactly that gap, without touching the safety boundary itself.

**Security stance, stated once here and held throughout:** nothing in this report proposes any path from Hermes to AWS that bypasses `PolicyEngine.evaluate()`, DefenseClaw, human approval for mutations, or the audit ledger. ADR-0008's decision — every capability CloudOps turns on for an agent is reachable only as an MCP call to CloudOps's own server, native toolsets stay disabled permanently — is treated as a hard constraint on every recommendation, not a suggestion to weigh against Apollo's pattern. Where Apollo's own positioning ("message your agent directly, the same way you'd message a trusted colleague," with no documented approval gate) would, if copied literally, suggest an ungated direct-action model, Section 16 says explicitly why CloudOps must not adopt that shape for anything that mutates infrastructure.

---

## 2. What Apollo[Claw] Actually Provides

Confirmed directly from apolloclaw.ai pages fetched this session (home, `/about`, `/security`, `/enterprise`, `/integrations`, `/case-studies`):

**Company & product model** [DOCUMENTED]
- AI implementation consultancy, NYC/Long Island, founded by David Oralevich, serving businesses nationwide. ([apolloclaw.ai/about](https://apolloclaw.ai/about))
- Custom-build model, not subscription SaaS: *"Most businesses are using AI like a search engine. Apollo[Claw] builds something different: custom AI agents tailored to your operation."* ([apolloclaw.ai/about](https://apolloclaw.ai/about))
- Sales motion is consulting-style ("Book a Discovery Call"); no public pricing page content was retrievable beyond a `/pricing` link reference. ([apolloclaw.ai](https://apolloclaw.ai/))

**Agent catalog** [DOCUMENTED] — nine function/vertical-specific starting agents: CEO Agent, CFO Agent, Sales Agent, Recruiting Agent, Law Agent, Insurance Agent, Medical Agent, Real Estate Agent, Personal Agent, plus a College Agent mentioned on `/about`. ([apolloclaw.ai](https://apolloclaw.ai/), [apolloclaw.ai/about](https://apolloclaw.ai/about))

**Deployment model** [DOCUMENTED] — two options:
- Cloud-hosted: *"One VPS per agent — never shared, multi-tenant compute"*, full-volume LUKS2 disk encryption, key-based SSH only. ([apolloclaw.ai/security](https://apolloclaw.ai/security))
- Self-hosted: *"One Mac mini, client-owned, assigned to you and no one else"*, FileVault/AES-128-XTS, no inbound access, outbound HTTPS only. ([apolloclaw.ai/security](https://apolloclaw.ai/security))

**Security/compliance posture** [DOCUMENTED] — TLS+HSTS in transit, AES-256-GCM/LUKS2/FileVault at rest, ISO 27001 (runtime infra), SOC 2 Type I "available on request," PCI DSS SAQ-A scope via Stripe, GDPR/CCPA/FERPA support, MFA + enforced step-up on admin actions, row-level security, "No Data Resale. Ever." ([apolloclaw.ai/security](https://apolloclaw.ai/security), [apolloclaw.ai/enterprise](https://apolloclaw.ai/enterprise))

**Integrations** [DOCUMENTED] — 48 integrations across Google Workspace, Microsoft 365, file storage (Dropbox, Box), task tools (Notion, Asana, Linear, Jira, Trello, Airtable, Todoist), meetings (Zoom, Calendly), CRM (Salesforce, HubSpot, LinkedIn). Agents communicate via email, Slack, or Telegram. ([apolloclaw.ai/integrations](https://apolloclaw.ai/integrations), [apolloclaw.ai](https://apolloclaw.ai/))

**Onboarding/timeline** [DOCUMENTED] — pilot live in "about two weeks," 30 days of hands-on training, then ongoing support; "our team handles the full setup and every connection" (white-glove, not self-serve). ([apolloclaw.ai](https://apolloclaw.ai/), [apolloclaw.ai/enterprise](https://apolloclaw.ai/enterprise))

**Case-study outcome metrics** [DOCUMENTED] — all business-outcome numbers, not agent-operational numbers:
| Vertical | Metric | Before → After |
|---|---|---|
| Finance | Month-end close cycle | 11 days → 6 days |
| Medical | No-show rate | 18% → under 6% |
| Medical | Online review rating | 3.6 → 4.4 stars (60 days) |
| Real Estate | Lead conversion | 12% → 20%+ (first month) |
| Law | Retained cases | up 40% (200 monthly intake inquiries) |
| Law | Billable hours recovered | 10 hours/week |
| Recruiting | Time-to-interview | cut by more than half (first month) |
| Professional Services | NDA turnaround | one week → same afternoon |
| General | Time recovered | "10–20 hours a week within the first month" |

(Source: [apolloclaw.ai/case-studies](https://apolloclaw.ai/case-studies), [apolloclaw.ai](https://apolloclaw.ai/))

**What is explicitly NOT documented anywhere on the site** — confirmed absent across all six fetched pages, stated here as an absence-of-evidence finding, not a claim that Apollo lacks these internally:
- No dashboard screenshot or described agent-monitoring UI.
- No API documentation.
- No described approval-workflow or human-in-the-loop mechanism (beyond one unverified search-snippet phrase, see Section 5).
- No autonomy-level or permission-configuration concept.
- No agent-fleet view (multi-agent status/health across a deployment).
- No cost/spend-control, LLM-usage, or "cost per task" concept.
- No audit-log, compliance-trail, or tamper-evidence concept for agent actions specifically (only generic infra compliance).
- No uptime/SLA numbers, no agent health/status vocabulary, no tool/action taxonomy.

---

## 3. Apollo Agent/Product Model

- **Agent = a personified, dedicated specialist**, not a generic chatbot. Naming agents after job titles ("CEO Agent," "CFO Agent") and describing them as remembering "how you work" is a deliberate personification strategy. [DOCUMENTED tone, apolloclaw.ai]
- **No public multi-agent "fleet" concept.** Each engagement appears to provision 1–9 named agents on dedicated infrastructure for one client; there's no documented shared orchestration layer, task board, or cross-agent coordination model. [INFERRED absence — could exist internally and simply not be publicized]
- **Persistent memory is claimed but the mechanism is undocumented**: *"It remembers everything"* and *"What your business learns stays with your business."* [DOCUMENTED claim, apolloclaw.ai; INFERRED mechanism — no vector store, no memory architecture, nothing technical is described]
- **Onboarding is human-consultant-run, not self-serve**: *"Our team handles the full setup and every connection"*, 30 days hands-on training. [DOCUMENTED]
- **Interaction model is conversational and always-available**: agents respond over email/Slack/Telegram "the same way you'd message a trusted colleague." [DOCUMENTED, apolloclaw.ai] This implies an agent identity a human addresses directly and expects a response from, rather than a tool invoked on demand — the closest thing to an architectural pattern in Apollo's public materials, and the one worth actually adapting (see Section 14, idea 3).
- **No visible task/work-item model.** There is no documented "task," "ticket," or per-unit-of-work status the way an operations platform needs (e.g., "3 tasks in progress, 1 awaiting your input"). Case-study numbers are aggregate business KPIs over a time window, not per-task telemetry.

---

## 4. Apollo Metrics & KPIs

Every metric found in Apollo's public materials is a **business-outcome metric aimed at a buyer**, never an **agent-operational metric** aimed at someone running the system day to day:

| Apollo metric type | Examples found | Evidence |
|---|---|---|
| Time/effort recovered | "10–20 hours a week," "10 hours weekly recovered" | [DOCUMENTED] |
| Cycle-time reduction | Close cycle 11→6 days, NDA turnaround 1 week→same afternoon, time-to-interview cut >50% | [DOCUMENTED] |
| Quality/satisfaction | Review rating 3.6→4.4 stars | [DOCUMENTED] |
| Conversion/retention | Lead conversion 12%→20%+, retained cases up 40%, no-show rate 18%→<6% | [DOCUMENTED] |

**Zero agent-operational metrics were found**: no task success rate, no autonomous completion rate, no human intervention rate, no tool-call count, no uptime/availability figure, no error rate, no cost-per-task or LLM-spend figure. This is either because Apollo doesn't productize that telemetry for prospects, or because (given the white-glove/dedicated-infra model) there simply isn't a multi-tenant dashboard product to show it in. Either way, **it cannot be cited as something Apollo "has" and CloudOps lacks** — the honest statement is: *Apollo has not published agent-operational KPIs; this report treats "what would agent-operational KPIs look like for CloudOps" as a first-party design problem, not a copy job.*

**Implication for Section 8**: CloudOps should pair Apollo's proven buyer-facing framing (time/effort saved, cycle-time reduction) with the operational trust metrics an SRE/engineering-manager buyer actually needs (success rate, intervention rate, MTTR, safety metrics) — because CloudOps's buyer is different from Apollo's (an engineering leader evaluating whether to trust an agent with production infrastructure, not a small-business owner buying back their own time).

---

## 5. Apollo Autonomy & Approval Model

**No public approval-workflow, autonomy-level configuration, or human-in-the-loop UI was found on any of the six pages fetched** (home, about, security, enterprise, integrations, case-studies). This was checked specifically, since it's central to this benchmark.

- A web-search result snippet (not a page this session could fetch and verify directly) described Apollo agents as connecting to tools and shipping "real work with your approval" — this is flagged **[INFERRED, weakly sourced]**: it appeared in a search-engine summary, not in the text WebFetch retrieved from the pages themselves, so it is reported here as a hint that *some* approval concept may exist for certain actions, not as a confirmed mechanism. No approval UI, approval states, signature model, or escalation behavior is described anywhere that was independently verified.
- The closest **documented** control is organizational/infrastructural, not behavioral: *"Least-Privilege Access,"* row-level security, MFA + step-up for admin actions. ([apolloclaw.ai/security](https://apolloclaw.ai/security)) These govern who can log into Apollo's own admin systems — they say nothing about what the *agent itself* is allowed to autonomously do to a client's calendar, inbox, CRM, or bank account once deployed.

**This is the single clearest place CloudOps is already ahead, verifiably, not by inference:**

- `packages/approvals/src/service.ts` [VERIFIED] implements a full human-in-the-loop approval lifecycle: `createApprovalRequest()` with a SHA-256 payload hash bound to the exact operation, a 4-hour default TTL, `approve()` requiring a real Ed25519 signature verified via `OperatorSignatureService.assertValidSignature()`, `executeApproval()` with an atomic `EXECUTING` lock, pre-execution payload-hash re-verification ("tamper attempt detected" check), `reject()`, `escalatePendingApprovals()` (auto-escalates unactioned approvals past a configurable age), and a full revert chain (`revertsApprovalId`, `findRevertOf()`).
- `packages/tools/src/mcpServer.ts` [VERIFIED] shows every mutating tool call is intercepted *before* execution: a live pre-execution snapshot is captured (`captureSnapshotForRevert()`), a blast-radius dry-run diff is computed (`BlastRadiusSimulator.simulate()`), and the call returns `AWAITING_APPROVAL` with the diff attached — the agent never executes a mutation directly, ever, regardless of how confident its own reasoning is.
- Nothing here should be read as "adopt Apollo's approval model" — there is no public Apollo approval model to adopt. The opportunity is entirely on the **presentation** side: CloudOps has a materially more rigorous mechanism than anything Apollo has shown, and it is currently visible mostly to engineers reading source code, not to an operator or an engineering manager evaluating the product (Section 14, ideas 1 and 4).

---

## 6. Apollo Security/Guardrail Model

**What's documented is infrastructure/compliance security, not agent-behavior governance:**

| Apollo control | What it protects | Evidence |
|---|---|---|
| One VPS/Mac Mini per client, never shared | Multi-tenant data isolation at the compute layer | [DOCUMENTED, /security] |
| LUKS2 / FileVault / AES-256-GCM, TLS+HSTS | Data at rest and in transit | [DOCUMENTED, /security] |
| ISO 27001, SOC 2 Type I (on request), PCI DSS SAQ-A, GDPR/CCPA/FERPA | Compliance posture for the hosting business | [DOCUMENTED, /security, /enterprise] |
| MFA + step-up, row-level security, least-privilege | Who can access Apollo's own admin/account systems | [DOCUMENTED, /security] |
| "No Data Resale. Ever." | Data-use policy | [DOCUMENTED, /security] |

**None of the following — the layer that actually matters for an agent operating on live systems — appears anywhere in Apollo's public materials**: a policy engine or rule language governing what actions an agent may take; tool/action allow-listing; blast-radius or dry-run simulation before a mutating action; tamper-evident/hash-chained action logging; prompt-injection or adversarial-input defenses; an agent "kill switch" or containment mechanism; a described distinction between read-only and mutating actions. This is stated as an absence of evidence, not proof of absence — a boutique consultancy selling calendar/inbox/CRM automation to small businesses may reasonably not need (or choose not to publish) this layer the way an infrastructure-mutation platform does.

**CloudOps governs the harder, different layer — agent *behavior*, not just infrastructure access** — and this is verified in code, not inferred:

- `packages/policy/src/index.ts`'s `PolicyEngine.evaluate()` [VERIFIED] runs, in strict order: (1) `IacGateService` (blocks Terraform-managed resources before anything else), (2) `DefenseClawGuardrailService.inspectToolCall()` (OPA/Rego security interception), (3) `PolicyFencingService.evaluateFencing()` (region allow-list, environment allow-list, capability-tier isolation — a `mutate`-tier grant cannot execute a `deploy`-tier action, `defence_claw/defenseclaw/policies/rego/cloudops/capability_tiers.rego` classifies irreversible deletions at the same elevated tier as deploy — and budget-cap enforcement), (4) mandatory human-approval classification for any mutating tool, with zero exceptions in the code path.
- `AuditService` (`packages/audit/src/service.ts`) [VERIFIED] implements a genuinely hash-chained ledger: `row_hash = sha256(prev_hash + ":" + canonical_data)`, with `verifyChain()` re-computing every hash to detect tampering or broken linkage — not a soft "audit log" but a cryptographically checkable one.
- `docs/decisions/ADR-0008-governed-runtime-mcp-only-execution.md` [VERIFIED] documents a specific, named threat this architecture defends against: Hermes's own native toolsets (`terminal`, `file`, `code_execution`, `browser`, `computer_use`, `delegation`, `cronjob`) are enabled by default in the underlying agent runtime and would bypass every guardrail above if ever reached — the ADR's decision is that every one of those stays "explicitly disabled, permanently, not by convention," and every capability is reachable only as an MCP call to CloudOps's own server, where `PolicyEngine` sits.

**Conclusion for this section, stated directly so it isn't lost in translation later: Apollo is not a security benchmark for CloudOps's agent-governance layer.** It documents good infra-security hygiene for a hosting business; CloudOps solves a materially harder problem (what may an autonomous agent be allowed to *do*) that Apollo's public materials don't address at all. Section 9's security requirement in the original brief is fully consistent with this: nothing here should ever suggest relaxing CloudOps's guardrails to match Apollo's documented posture, because Apollo's documented posture doesn't reach that layer.

---

## 7. Apollo → CloudOps Capability Mapping

| # | Apollo Concept | Evidence Class | CloudOps Equivalent | Existing CloudOps Implementation | Missing Capability | Recommendation |
|---|---|---|---|---|---|---|
| 1 | Named persona agent ("CEO Agent," "CFO Agent") | [DOCUMENTED] | Agent identity/type | `agents` table: `id, name, type, version` — `type` is one of `hermes/openclaw/custom` (`packages/identity/src/service.ts` `SUPPORTED_AGENT_TYPES`) [VERIFIED] | No user-facing "role/specialty" framing beyond raw `type` | Add an optional operator-set label (e.g. "ECS Remediation Specialist") displayed on the agent card, backed by existing `capability_grants` — no schema change, cosmetic + a nullable column |
| 2 | Dedicated private server/Mac Mini per agent | [DOCUMENTED] | Per-agent governed runtime isolation | `HermesProfileService` (`packages/runtime/src/hermesProfileService.ts`), `agents.hermes_profile_name`, `governance_status` (ADR-0008 Phase A) [VERIFIED] | CloudOps's isolation (process/profile + MCP-only tool surface, independently re-verifiable) is already more rigorous than Apollo's documented VM-level isolation | Surface the existing "Governed Runtime Lockdown" panel (currently on `apps/web/src/app/agents/diagnostics/page.tsx`) more prominently on the main per-agent page, not only in a diagnostics tool |
| 3 | "It remembers everything" | [DOCUMENTED claim] / [INFERRED mechanism] | Tenant/incident memory | `TenantMemoryTable`, `KnowledgeEmbeddingTable` (pgvector), `packages/adapters/src/tenantMemoryService.ts`, `packages/embeddings` [VERIFIED] | No UI surfacing *what* the agent has retained (transparency) | Add an "Agent Memory" view listing `tenant_memory` rows tied to incidents/resources — pure read, existing data |
| 4 | "Message your agent like a colleague" | [DOCUMENTED] | Conversational agent chat | `apps/web/src/components/agent/CloudOpsAgentChat.tsx`, `apps/api/src/routes/agents.ts`'s chat action resolver (`resolveChatAction`) — every `propose_mutation` still routes through `PolicyEngine.evaluate()` before anything executes [VERIFIED] | None structural — already implemented and more governed than what Apollo documents | No architectural change; UX polish only |
| 5 | "Ships real work with your approval" | [INFERRED, weakly sourced — search snippet only] | Human-in-the-loop approval | `ApprovalService` (`packages/approvals/src/service.ts`): signed, hash-verified, TTL, revert chain [VERIFIED] | CloudOps's version is already deeper than anything documented about Apollo | No mechanism change; expose approval SLA/aging metrics (Section 8) |
| 6 | Case-study outcome metrics (hours saved, days-to-close) | [DOCUMENTED] | "Time saved" / manual-effort-avoided | `docs/benchmarks/manual-engineer-baseline.md` (one-off human MTTR baseline), `packages/shared/src/benchmark.ts` (`BenchmarkTimingTracker`, explicitly `isSyntheticMock`-flagged) [VERIFIED] | No live, continuously computed "hours saved" figure in the product — only a one-off benchmark doc and a test-only tracker | Derive a per-incident "estimated manual effort avoided" metric from real phase durations (Section 8, metric 14) — must stay honest per this project's own CO-026 anti-fabrication rule |
| 7 | 48-tool integration marketplace | [DOCUMENTED] | MCP tool registry | `CANONICAL_TOOLS` (`packages/tools/src/registry.ts`) [VERIFIED] | Not a gap — CloudOps's tool surface is deliberately narrow (governed AWS actions only, MCP-only per ADR-0008); breadth is not the goal | Do not chase integration count; scope is a deliberate product decision, not an oversight |
| 8 | ISO 27001 / SOC 2 / PCI DSS compliance | [DOCUMENTED] | Compliance posture | No compliance-certification documentation found in the repository | Real gap, but a business/GTM gap, not a product-architecture one | Out of scope for this engineering benchmark; flagged for awareness only |
| 9 | "Least-Privilege Access" / row-level security | [DOCUMENTED] | Tenant scoping | Every service call takes `tenantId` and scopes queries `where tenant_id = ...` (seen throughout `packages/adapters`, `packages/approvals`, `packages/audit`) [VERIFIED] | None found | Already implemented at the data-access layer |
| 10 | No public autonomy-level toggle (absence) | — | Capability tiers (read/mutate/deploy) | `capabilities`/`capability_grants` tables, `defence_claw/defenseclaw/policies/rego/cloudops/capability_tiers.rego` (`read_tier`/`mutate_tier`/`deploy_tier`) [VERIFIED] | CloudOps already has a *more* granular, per-capability autonomy model than a single Apollo-style toggle would be — but it isn't surfaced to operators as a coherent "autonomy" concept | See Section 14, idea 1 — do not copy a single-toggle model; expose the existing tiered model as a first-class UI concept |
| 11 | No public agent-fleet dashboard (absence) | — | Multi-agent status view | Only per-agent pages exist today: `apps/web/src/app/agents/page.tsx` (list) + `apps/web/src/app/agents/[id]` (detail) [VERIFIED] | No cross-agent operational rollup exists in either product | See Section 9's proposed dashboard |
| 12 | "Live in about two weeks," white-glove onboarding | [DOCUMENTED] | Agent onboarding | `packages/onboarding` (`InviteService`, `JoinRequestService`), `apps/web/src/app/onboarding/page.tsx` [VERIFIED] | None — CloudOps's onboarding is already self-serve, arguably faster than Apollo's consultant-run model | Not a gap |

---

## 8. Metrics CloudOps Should Add

### 8.1 Candidate metric sweep (per the brief's six categories)

This table answers, compactly, for every candidate metric: what it is, whether Apollo exposes/implies it, and what CloudOps would need. "Existing data source" cites a real file/table confirmed by reading it this session; "—" means genuinely nothing exists yet.

**Agent effectiveness**

| Metric | Apollo status | CloudOps computable today? | Existing data source | Additional telemetry needed |
|---|---|---|---|---|
| Tasks completed | Not exposed publicly | Yes, proxy via `runs`/`investigations` count | `runs` table (status), `investigations` table (status) [VERIFIED] | None for a count; needs a clear "task" definition (a run? an investigation? an approval?) |
| Task success rate | Not exposed publicly | Partially | `investigations.status = 'COMPLETED'` vs `'FAILED'` [VERIFIED] | None structural |
| Autonomous completion rate | Not exposed publicly | Partially | `investigations` + `approvals` joined by `run_id` [VERIFIED] | A clear definition of "no human touched this run beyond signing the approval" |
| Human intervention rate | Not exposed publicly | Yes | `approvals.status = 'REJECTED'` / total [VERIFIED] | None |
| Approval rate | Not exposed publicly | Yes | `ApprovalService.listHistory()` [VERIFIED] | None |
| Failure rate | Not exposed publicly | Yes | `tool_executions.status = 'ERROR'`, `investigations.status = 'FAILED'` [VERIFIED] | None |
| Escalation rate | Not exposed publicly | Yes | `approvals.escalated_at IS NOT NULL` (`ApprovalService.escalatePendingApprovals()`) [VERIFIED] | None |
| Rework rate | Not exposed publicly | Partially | `approvals.reverts_approval_id` (revert chain) [VERIFIED] | A "rework" definition distinct from a legitimate operator-initiated revert |

**Operational efficiency**

| Metric | Apollo status | CloudOps computable today? | Existing data source | Additional telemetry needed |
|---|---|---|---|---|
| Time saved | [DOCUMENTED] as buyer-facing headline ("10–20 hrs/week") | Only per-scenario, not live | `packages/shared/src/benchmark.ts` (`BenchmarkTimingTracker`, test-only) + `docs/benchmarks/manual-engineer-baseline.md` [VERIFIED] | Production wiring of phase timestamps into `runs`/`investigations`, generalized beyond the one demo scenario |
| Mean time to detect (MTTD) | Not exposed | No | — (no alert-ingestion timestamp captured today) | Timestamp on incident creation vs. underlying alert firing time |
| Mean time to investigate (MTTI) | Not exposed | Yes | `investigations.started_at` / `completed_at` [VERIFIED] | None |
| Mean time to remediate (MTTR-remediate) | Not exposed | Yes | `approvals.reviewed_at` → `consumed_at` (EXECUTED) [VERIFIED] | None |
| Mean time to resolution (full MTTR) | [DOCUMENTED] indirectly via cycle-time case studies | Yes, per-incident | `incidents.created_at` → `resolved_at` [VERIFIED] | None structural, needs aggregation |
| Manual effort avoided | [DOCUMENTED] ("10 hours weekly recovered") | Only via the one-off baseline doc | `docs/benchmarks/manual-engineer-baseline.md` [VERIFIED] | A repeatable, scenario-tagged baseline library, not a single 2-run sample |
| Automation rate | Not exposed | Yes | `investigations` with no `REJECTED` approval / total | None |
| Incidents resolved autonomously | Not exposed | Yes | `incidents.status = 'RESOLVED'` joined to investigations with no manual remediation step | None |

**Agent activity**

| Metric | Apollo status | CloudOps computable today? | Existing data source | Additional telemetry needed |
|---|---|---|---|---|
| Tasks executed | Not exposed | Yes | `runs` count [VERIFIED] | None |
| Tool calls | Not exposed | Yes | `tool_executions` count [VERIFIED] | None |
| AWS actions | Not exposed | Yes | `tool_executions.tool_name LIKE 'aws_%'` [VERIFIED] | None |
| Investigations | Not exposed | Yes | `investigations` count [VERIFIED] | None |
| Remediations | Not exposed | Yes | `approvals` with `operation_type IN ('MUTATION','DEPLOY')` and `status='EXECUTED'` [VERIFIED] | None |
| Approvals requested/granted/rejected | Not exposed | Yes | `approvals.status` [VERIFIED] | None |
| Blocked actions | Not exposed | Yes | `audit_events.event_type = 'TOOL_CALL_DENIED'` (`packages/tools/src/mcpServer.ts`'s `record()`) [VERIFIED] | None |
| Active agents | Not exposed | Yes | `agent_sessions.status`, `last_heartbeat_at` [VERIFIED] | None |
| Idle agents | Not exposed | Yes | `agent_sessions` with stale `last_heartbeat_at` or no `RUNNING` run | None |

**Reliability**

| Metric | Apollo status | CloudOps computable today? | Existing data source | Additional telemetry needed |
|---|---|---|---|---|
| Agent availability | Not exposed | Partially | `agent_sessions.connected_at/disconnected_at` [VERIFIED] | Continuous uptime aggregation, not just instantaneous status |
| Agent health | Not exposed | Partially | `agents.governance_status`, `agent_sessions.status` [VERIFIED] | A composite "health" definition combining governance + connectivity + recent error rate |
| Execution success rate | Not exposed | Yes | `tool_executions.status = 'SUCCESS'` / total [VERIFIED] | None |
| Tool failure rate | Not exposed | Yes | `tool_executions.status = 'ERROR'` [VERIFIED] | None |
| Investigation failure rate | Not exposed | Yes | `investigations.status = 'FAILED'` [VERIFIED] | None |
| Remediation failure rate | Not exposed | Yes | `approvals.status = 'EXECUTION_FAILED'` [VERIFIED] | None |
| Verification success rate | Not exposed | Only for one demo scenario | `RemediationVerificationService.verifyRecovery()` (`packages/adapters/src/remediationVerificationService.ts`) — hard-coded to `ECS_INCIDENT_GROUND_TRUTH` criteria [VERIFIED] | **Architectural**: generalize verification criteria beyond the single ECS demo scenario before this is a trustworthy fleet-wide metric — see Section 11 |

**Security/governance**

| Metric | Apollo status | CloudOps computable today? | Existing data source | Additional telemetry needed |
|---|---|---|---|---|
| Policy violations | Not exposed | Yes | `audit_events` with `TOOL_CALL_DENIED`, `ruleId` field in payload [VERIFIED] | None |
| Blocked actions | Not exposed | Yes | Same as above | None |
| Approval-required actions | Not exposed | Yes | `audit_events.event_type = 'TOOL_CALL_AWAITING_APPROVAL'` [VERIFIED] | None |
| High-risk actions | Not exposed | Yes | `approvals.dry_run_diff.riskLevel` (`BlastRadiusSimulator` sets `HIGH`/`CRITICAL`) [VERIFIED] | None |
| Unauthorized tool attempts | Not exposed | Yes | `CloudOpsMcpServer.isCapabilityAuthorized()` rejections (tool simply not registered for an unauthorized capability) — currently silent (tool not exposed at all), not logged as a distinct event | A dedicated audit event for "capability not granted" attempts, if the MCP client ever tries a tool name outside its authorized set |
| Prompt-injection/security events | Not exposed | Partially | `DefenseClawGuardrailService.inspectToolCall()` verdicts (`packages/policy/src/index.ts`) [VERIFIED] | DefenseClaw-side detail on *why* a call was flagged (rule taxonomy) surfaced up to CloudOps's own audit payload, not just a boolean block |
| Permission violations | Not exposed | Yes | `ruleId = 'FENCE_CAPABILITY_TIER_ISOLATION'` events [VERIFIED] | None |
| Credential/access issues | Not exposed | Partially | `agent_credentials.status`, `revoked_at`, `rotated_at` [VERIFIED] | Explicit audit events on credential rotation/revocation failures |
| Agent containment events | Not exposed | Yes | `agents.governance_status = 'FAILED'` (ADR-0008 fail-closed state) [VERIFIED] | None |
| Security interventions | Not exposed | Yes | `ruleId = 'DEFENSECLAW_SECURITY_FENCE'` [VERIFIED] | None |

**Cost**

| Metric | Apollo status | CloudOps computable today? | Existing data source | Additional telemetry needed |
|---|---|---|---|---|
| Agent usage (LLM calls) | Not exposed | No | — | No metering exists at all: Hermes is invoked as a CLI subprocess (`hermes -z ...`), not a metered API call CloudOps' own code makes — token/cost accounting has nowhere to attach today |
| Model usage | Not exposed | No | — | Same gap as above |
| Spend / spend limits | [DOCUMENTED, generic — "least-privilege," no spend language found] | Yes, for AWS-mutation spend only | `tenants.monthly_budget_limit_usd`, `PolicyFencingService` budget-cap fence [VERIFIED] | LLM spend is a separate, currently untracked category |
| Cost per task | Not exposed | Partially | `approvals.dry_run_diff.estimatedMonthlyCostUsd` (`BlastRadiusSimulator`) [VERIFIED] | This is *estimated infra* cost, not actual LLM inference cost — the two must not be conflated in the UI |
| Cost per successful task | Not exposed | Partially | Same as above, filtered to `EXECUTED` | Same caveat |
| AWS cost impact | Not exposed | Yes — real integration exists | `AwsScannerService` uses `CostExplorerClient`/`GetCostAndUsageCommand` (`packages/adapters/src/awsScannerService.ts`) [VERIFIED] | Wiring this into a per-agent/per-incident rollup (it currently exists as account-level scanning, not incident-correlated) |
| Cost avoided / infrastructure savings | [DOCUMENTED, generic buyer framing, no dollar mechanism shown] | No | — | Needs a defined baseline (e.g., cost of resource left mis-scaled without remediation) — a genuinely new calculation, not just new telemetry |
| Cost of failed remediation | Not exposed | Partially | `approvals.status = 'EXECUTION_FAILED'` joined to `dry_run_diff.estimatedMonthlyCostUsd` [VERIFIED] | None structural |

### 8.2 Recommended CloudOps Production Metrics (prioritized deep dive)

These are the subset of the above worth building first — chosen because they're computable largely from data that already exists, and because they answer the brief's trust questions ("is the agent actually useful," "how often does it need humans," "is it safe," "is it reliable," "is it faster than manual ops," "can an engineering manager trust it"). Every "Example value" below is explicitly illustrative, not a real measurement — consistent with this project's own rule against presenting synthetic numbers as real ones.

---

**1. Autonomous Resolution Rate**
- **Definition:** Share of investigations that reached a resolved incident without any approval being rejected or requiring manual override beyond the sign-off itself.
- **Formula:** `COUNT(incidents WHERE status='RESOLVED' AND all linked approvals.status IN ('EXECUTED')) / COUNT(incidents WHERE status='RESOLVED')`
- **Data source:** `incidents`, `investigations`, `approvals` (joined via `run_id`) — all exist [VERIFIED].
- **Backend changes required:** None to schema; one new aggregation query/service method.
- **API required:** `GET /v1/metrics/investigations/autonomous-resolution-rate` (new, read-only).
- **UI location:** Dashboard "Autonomous Operations" section (Section 9).
- **Example value:** "78% of resolved incidents in the last 30 days" (illustrative only).
- **Why it matters:** This is the single number closest to "is the agent actually doing cloud-engineering work, or is a human doing all of it while the agent narrates."

**2. Human Intervention Rate**
- **Definition:** Share of approvals rejected or requiring escalation.
- **Formula:** `COUNT(approvals WHERE status='REJECTED' OR escalated_at IS NOT NULL) / COUNT(approvals)`
- **Data source:** `approvals.status`, `approvals.escalated_at` [VERIFIED].
- **Backend changes required:** None.
- **API required:** Extend `GET /v1/costs/summary`-style aggregation route or new `GET /v1/metrics/approvals/summary`.
- **UI location:** Dashboard "Security & Governance" and "Autonomous Operations" sections.
- **Example value:** "12% of proposed actions needed operator rejection or escalation" (illustrative).
- **Why it matters:** Directly answers "how often does it need humans" — the brief's own framing.

**3. Approval Grant Rate**
- **Definition:** `APPROVED+EXECUTED / (APPROVED+EXECUTED+REJECTED)` — excludes expired/pending.
- **Data source:** `ApprovalService.listHistory()` [VERIFIED].
- **Backend changes required:** None — a query over existing data.
- **API required:** Same new metrics route as above.
- **UI location:** Approvals page header stat, and dashboard.
- **Why it matters:** A low grant rate signals the agent is proposing actions operators don't trust — an early warning the current Approvals page (list view only) doesn't surface as a trend.

**4. Mean Time to Investigate (MTTI)**
- **Definition:** Average `investigations.completed_at - investigations.started_at`.
- **Data source:** `investigations` table [VERIFIED].
- **Backend changes required:** None.
- **API required:** New aggregation endpoint.
- **UI location:** Dashboard "Autonomous Operations."
- **Why it matters:** Isolates the piece of MTTR the agent fully controls (investigation), separate from the piece it doesn't (human approval latency) — important because `docs/benchmarks/live-hermes-agent-benchmark.md` already found that, once approval wait time is included honestly, it dominates total time-to-resolution.

**5. Mean Time to Approval Decision (the real bottleneck, per the project's own prior benchmark)**
- **Definition:** Average `approvals.reviewed_at - approvals.created_at` for non-expired approvals.
- **Data source:** `approvals.created_at`, `approvals.reviewed_at` [VERIFIED].
- **Backend changes required:** None.
- **API required:** New aggregation endpoint.
- **UI location:** Approvals page + dashboard.
- **Why it matters:** `docs/benchmarks/live-hermes-agent-benchmark.md` [VERIFIED, read this session] already states the honest caveat that "in production with human approvers, Phase 2 MTTR is bounded by the human operator's time... typically 30–60 seconds" — this metric turns that caveat into a tracked, real number instead of a footnote, and is exactly the kind of metric that keeps an engineering manager's trust ("show me the humans aren't the bottleneck, or show me clearly where they are").

**6. Escalation Rate**
- **Definition:** `COUNT(approvals.escalated_at IS NOT NULL) / COUNT(approvals)`.
- **Data source:** `ApprovalService.escalatePendingApprovals()` already computes and records this via `APPROVAL_ESCALATED` audit events [VERIFIED].
- **Backend changes required:** None — this is already computed, just not exposed as a rate.
- **API required:** New aggregation endpoint.
- **UI location:** Dashboard "Security & Governance."
- **Why it matters:** A rising escalation rate means approvals are sitting unactioned — an operational-health signal about the human side of the loop, not just the agent side.

**7. Policy Block Rate**
- **Definition:** `COUNT(audit_events.event_type='TOOL_CALL_DENIED') / COUNT(audit_events.event_type LIKE 'TOOL_CALL_%')`.
- **Data source:** `audit_events`, written by `CloudOpsMcpServer`'s `record()` closure [VERIFIED].
- **Backend changes required:** None.
- **API required:** New aggregation endpoint.
- **UI location:** Dashboard "Security & Governance," Audit page summary header.
- **Why it matters:** A safety-visibility metric — shows the guardrails are actually firing, not just present in code.

**8. Tool Failure Rate**
- **Definition:** `COUNT(tool_executions.status='ERROR') / COUNT(tool_executions)`.
- **Data source:** `tool_executions` table [VERIFIED].
- **Backend changes required:** None.
- **API required:** New aggregation endpoint.
- **UI location:** Dashboard "Reliability."
- **Why it matters:** Distinguishes "the agent proposed something bad" (policy block) from "the agent's tooling broke" (tool failure) — two different problems that look similar without this split.

**9. Verification/Recovery Success Rate — flagged with an honesty caveat**
- **Definition:** Share of executed remediations that passed `RemediationVerificationService.verifyRecovery()`'s multi-point criteria.
- **Data source:** `RemediationVerificationService` (`packages/adapters/src/remediationVerificationService.ts`) [VERIFIED].
- **Backend changes required — architectural, not small:** the current implementation's `DEFAULT_RECOVERY_CRITERIA` is hard-coded to one demo scenario (`ECS_INCIDENT_GROUND_TRUTH.healthyImageTag`, fixed `requiredDesiredCount: 1`) — see `packages/adapters/src/awsIncidentEnvironment.ts`. It cannot honestly report a fleet-wide "verification success rate" until verification criteria are parameterized per-incident/per-service rather than fixed to one scenario. This is called out explicitly rather than glossed over, per this project's own anti-fabrication norm.
- **API required:** None until the generalization work above lands.
- **UI location:** Dashboard "Reliability," once generalized.
- **Why it matters:** This is exactly the kind of metric that builds or destroys trust — a fabricated or scenario-locked "success rate" presented as general would be worse than not showing the metric at all.

**10. Active vs. Idle Agents**
- **Definition:** Agents with a `CONNECTED` session and recent `last_heartbeat_at` vs. agents with none.
- **Data source:** `agent_sessions.status`, `last_heartbeat_at` (heartbeat monitor in `packages/gateway/src/connectionManager.ts`) [VERIFIED].
- **Backend changes required:** None.
- **API required:** New `GET /v1/agents/status-summary`.
- **UI location:** Dashboard "Agent Overview."
- **Why it matters:** The most basic "is anything actually running" signal — currently only visible per-agent, not as a fleet count.

**11. Governance Lockdown Coverage**
- **Definition:** `COUNT(agents.governance_status='LOCKED_DOWN') / COUNT(agents)`.
- **Data source:** `agents.governance_status` (ADR-0008 Phase A) [VERIFIED].
- **Backend changes required:** None.
- **API required:** New aggregation endpoint.
- **UI location:** Dashboard "Security & Governance" — this is a CloudOps-native metric (not Apollo-inspired), but it pairs naturally with the security section and is uniquely CloudOps's to show.
- **Why it matters:** Answers "can an engineering manager trust it" at the architecture level — a fleet where every agent is verifiably MCP-only-locked-down is a materially different trust story than one where some agents are still `PENDING`/`FAILED`.

**12. Cost per Executed Incident**
- **Definition:** `SUM(approvals.dry_run_diff.estimatedMonthlyCostUsd WHERE status='EXECUTED') / COUNT(incidents.status='RESOLVED')` for a given window.
- **Data source:** `apps/api/src/routes/costs.ts`'s existing `/v1/costs/summary` rollup logic, joined to `incidents` [VERIFIED].
- **Backend changes required:** Small — extend `costs.ts`'s aggregation to join against incidents, not just approvals/agents.
- **API required:** Extend `GET /v1/costs/summary` or add `GET /v1/costs/by-incident`.
- **UI location:** Costs page, dashboard "Cost & Efficiency."
- **Why it matters:** Turns the existing cost rollup (currently per-agent/per-account only) into the per-incident framing an engineering manager actually thinks in.

**13. AWS Cost Impact (real Cost Explorer data)**
- **Definition:** Actual AWS spend delta on affected resources, from the real AWS Cost Explorer integration.
- **Data source:** `AwsScannerService` (`packages/adapters/src/awsScannerService.ts`) already calls `CostExplorerClient`/`GetCostAndUsageCommand` [VERIFIED] — this is real infrastructure spend data, not an estimate.
- **Backend changes required:** Small — currently account-level scanning; needs correlation to a specific incident/remediation window.
- **API required:** New `GET /v1/costs/aws-impact?incidentId=...`.
- **UI location:** Costs page, incident detail view.
- **Why it matters:** This is the one cost metric CloudOps can make more credible than `BlastRadiusSimulator`'s estimates, because it's real billing data, not a formula.

**14. Estimated Engineering Hours Saved — the direct analogue of Apollo's headline metric, built honestly**
- **Definition:** Per-incident-type, `(manual baseline MTTR) - (actual autonomous MTTR including real approval wait time)`, expressed in engineer-hours.
- **Data source:** `docs/benchmarks/manual-engineer-baseline.md` (human baseline, 2 real trials) + `packages/shared/src/benchmark.ts`'s `BenchmarkTimingTracker` (already computes `timeSavedMs`/`timeSavedPercent` but is explicitly flagged `isSyntheticMock` and used only in `tests/integration/hermes_live_benchmark.test.ts`) [VERIFIED].
- **Backend changes required — architectural:** productionize `BenchmarkTimingTracker`'s phase-timing pattern into the real `runs`/`investigations`/`approvals` write paths (not just a test harness), and build out a library of per-scenario human baselines beyond the single 2-trial ECS sample that exists today. Until more baselines exist, this metric must stay scoped per-scenario, exactly as `manual-engineer-baseline.md` itself insists ("deliberately deferred to prevent fabricated metrics").
- **API required:** New `GET /v1/metrics/time-saved?scenario=...` once baselines exist for more than one scenario.
- **UI location:** Dashboard "Cost & Efficiency," framed the way Apollo frames it ("X hours of manual SRE effort avoided this month") — but only ever shown per-scenario/per-baseline, never as a blanket claim, and only once the underlying baseline library is broad enough not to mislead.
- **Why it matters:** This is the metric most directly modeled on Apollo's strongest product-communication pattern — but it is the one metric in this entire report where copying Apollo's confident framing without CloudOps's own rigor would violate this project's explicit house rule against fabricated benchmark numbers. Ship the mechanism before the marketing number.

**15. Blocked / High-Risk Action Count**
- **Definition:** Count of `audit_events` with `ruleId` in `{DEFENSECLAW_SECURITY_FENCE, FENCE_REGION_ALLOWLIST, FENCE_ENV_ALLOWLIST, FENCE_CAPABILITY_TIER_ISOLATION, FENCE_MAX_CONCURRENCY, FENCE_BUDGET_CAP, IAC_MANAGED_RESOURCE_BLOCKED}`.
- **Data source:** `audit_events.payload.ruleId`, all real rule IDs confirmed in `packages/policy/src/index.ts` and `packages/policy/src/iacGate.ts` [VERIFIED].
- **Backend changes required:** None — a filter/aggregation over existing data.
- **API required:** New `GET /v1/metrics/security/blocked-actions`.
- **UI location:** Dashboard "Security & Governance," Audit page.
- **Why it matters:** A concrete, rule-attributed count — not a vague "security events" number — showing exactly which guardrail fired and how often, which is the level of specificity an engineering manager needs to trust the safety story.

---

## 9. CloudOps Dashboard Proposal

A single `apps/web/src/app/dashboard/page.tsx` (new) or an expanded `/observability` landing view, composed of six sections. Every widget below cites the real backend source it would read from; anything requiring a new endpoint is marked **(new endpoint)**.

### Agent Overview
- Status (CONNECTED/DISCONNECTED), current task (active `run`), health (governance_status + session status), uptime (`agent_sessions.connected_at`), last activity (`MAX(tool_executions.created_at)` per agent), tasks completed, success rate.
- Sources: `agents`, `agent_sessions` [VERIFIED]. **(new endpoint: `GET /v1/agents/:id/overview`)**

### Autonomous Operations
- Incidents handled/resolved autonomously, autonomous resolution rate (metric 1), human intervention rate (metric 2), average resolution time (`incidents.created_at`→`resolved_at`), time saved (metric 14, shown only where a scenario baseline exists).
- Sources: `incidents`, `investigations`, `approvals` [VERIFIED]. **(new endpoint: `GET /v1/metrics/investigations/summary`)**

### Security & Governance
- Actions blocked (metric 15), approval requests (pending/granted/rejected counts from `ApprovalService.listHistory()`), high-risk actions (`dry_run_diff.riskLevel IN ('HIGH','CRITICAL')`), policy violations (metric 7), security events (DefenseClaw-sourced `ruleId`s), credential/access issues (`agent_credentials.status`), governance lockdown coverage (metric 11).
- Sources: `audit_events`, `approvals`, `agent_credentials`, `agents.governance_status` [VERIFIED]. **(new endpoint: `GET /v1/metrics/security/summary`)**

### Reliability
- Execution success rate (metric 8's complement), failed executions (`tool_executions.status='ERROR'`), verification success rate (metric 9, shown with its scenario-scope caveat visible in the UI, not hidden), tool errors, agent errors.
- Sources: `tool_executions`, `RemediationVerificationService` [VERIFIED]. **(new endpoint: `GET /v1/metrics/reliability/summary`)**

### Cost & Efficiency
- Agent usage (flagged as "not yet metered" until LLM usage tracking exists — see Section 11), model cost (same caveat), AWS impact (metric 13, real Cost Explorer data), cost per incident (metric 12), estimated engineering hours saved (metric 14).
- Sources: existing `apps/api/src/routes/costs.ts` `/v1/costs/summary`, `AwsScannerService` [VERIFIED]. **(extend existing endpoint + new `GET /v1/costs/aws-impact`)**

### Recent Activity
- A real operational timeline reconstructed from `audit_events` + `tool_executions`, exactly the shape `apps/api/src/routes/runs.ts`'s `getFullTrace()` already builds for a single run [VERIFIED] — extended to a cross-run, tenant-wide feed. Example shape drawn from real event types already emitted in code (not fabricated):
  ```
  10:32:04  INCIDENT_DETECTED       incidents row created (severity=HIGH)
  10:32:11  TOOL_CALL_SUCCESS       aws_ecs_describe_services
  10:32:19  TOOL_CALL_AWAITING_APPROVAL  aws_ecs_rollback_service (dry-run diff attached)
  10:34:02  APPROVAL_GRANTED        signed by operator, ECDSA verified
  10:34:05  CLOUD_OPERATION_STARTED
  10:34:41  CLOUD_OPERATION_COMPLETED
  10:38:50  INCIDENT_RESOLVED
  ```
  Every event type shown (`TOOL_CALL_SUCCESS`, `TOOL_CALL_AWAITING_APPROVAL`, `APPROVAL_GRANTED`, `CLOUD_OPERATION_STARTED`, `CLOUD_OPERATION_COMPLETED`) is a real `event_type` string confirmed in `packages/tools/src/mcpServer.ts` and `packages/approvals/src/service.ts` [VERIFIED]; `INCIDENT_DETECTED`/`INCIDENT_RESOLVED` would need to be added as explicit audit event types (small change — `IncidentService` currently updates `incidents.status` without also emitting a matching audit event).
- **(new endpoint: `GET /v1/audit-events/timeline?tenantId=...` — a thin wrapper over the existing `AuditService.listEvents()`)**

This is deliberately not a fake/static mock: every section names the real table or service it reads from, and every gap that would require new telemetry (LLM cost, generalized verification, incident-level audit events) is called out rather than silently assumed to exist.

---

## 10. Existing Backend Support

Confirmed by direct reading this session — this is what CloudOps already has that the above dashboard/metrics can build on with little or no new architecture:

- **Full incident/investigation/evidence model**: `incidents`, `investigations`, `incident_evidence` tables (`database/src/schema.ts` lines 256–298) [VERIFIED], read/write via `IncidentService` (`packages/adapters/src/incidentService.ts`).
- **Full run/tool-execution trace model**: `runs`, `tool_executions` tables, with a working reconstruction endpoint (`GET /v1/runs/:id/trace`, `apps/api/src/routes/runs.ts`) that already redacts secrets and stitches tool calls to approvals to audit events [VERIFIED].
- **Cryptographically signed, tamper-evident approval lifecycle**: `ApprovalService` (`packages/approvals/src/service.ts`) — creation, TTL, escalation, Ed25519-signed approval, atomic execution lock, revert chain [VERIFIED].
- **Hash-chained audit ledger with a working integrity verifier**: `AuditService.verifyChain()` (`packages/audit/src/service.ts`), plus a live read endpoint (`GET /v1/audit-events`, `GET /v1/audit-events/verify`, `apps/api/src/routes/audit.ts`) [VERIFIED].
- **A real four-stage policy engine already wired into every tool call**: `PolicyEngine.evaluate()` (`packages/policy/src/index.ts`), invoked from `CloudOpsMcpServer.registerAuthorizedTools()` (`packages/tools/src/mcpServer.ts`) before any tool executes [VERIFIED].
- **Existing per-agent, per-cloud-account cost rollup**: `GET /v1/costs/summary` (`apps/api/src/routes/costs.ts`), already joining approvals' `dry_run_diff.estimatedMonthlyCostUsd` against agents and cloud accounts [VERIFIED].
- **Real AWS Cost Explorer integration**: `AwsScannerService` (`packages/adapters/src/awsScannerService.ts`) already calls `CostExplorerClient`/`GetCostAndUsageCommand` [VERIFIED] — actual billing data, not just estimates.
- **Governance/lockdown tracking already in the agent record**: `agents.governance_status`, `governance_verified_at`, `mcp_registered`, `hermes_profile_name` (migration `019_hermes_governed_profiles.sql`) [VERIFIED], with a working re-verify endpoint and UI panel (`apps/web/src/app/agents/diagnostics/page.tsx`).
- **Session/connectivity telemetry**: `agent_sessions.status`, `last_heartbeat_at`, `connected_at`/`disconnected_at`, with an active heartbeat monitor (`packages/gateway/src/connectionManager.ts`) [VERIFIED].
- **OpenTelemetry tracing and metrics plumbing already exists**: `packages/adapters/src/tracing.ts`, `packages/gateway/src/metrics.ts` (OTLP exporter, Grafana/Tempo already wired for trace deep-links in `apps/web/src/app/observability/page.tsx`) [VERIFIED] — the export pipeline for new metrics doesn't need to be built from scratch.

**Can implement immediately (pure aggregation over existing tables, no schema change):** metrics 1–8, 10–12, 15 from Section 8.2; the Security & Governance and most of the Reliability dashboard sections; the Recent Activity timeline (modulo the two new incident-level audit event types noted below).

**Requires small backend changes (new columns/service methods, no new architecture):** cost-per-incident join (metric 12), AWS cost-impact correlation to a specific incident window (metric 13), `INCIDENT_DETECTED`/`INCIDENT_RESOLVED` audit event emission from `IncidentService`, an "agent role/specialty" label column.

**Requires architectural changes:** LLM usage/cost metering (nothing meters the Hermes CLI subprocess invocation today — see Section 11), generalizing `RemediationVerificationService` beyond the single ECS demo scenario (metric 9), productionizing `BenchmarkTimingTracker` beyond its current test-only usage (metric 14).

---

## 11. Backend Gaps

### Gap Analysis Table

Priority ordered per the brief's stated criteria: 1. Safety, 2. Operational visibility, 3. Trust, 4. Measurable business value, 5. Product usability.

| Apollo Capability | Apollo Evidence | CloudOps Equivalent | Existing? | Gap | Recommendation | Priority |
|---|---|---|---|---|---|---|
| Positioning implies always-gated, approved actions ("ships real work with your approval") | [INFERRED, weak] | Human approval on every mutation | Yes — `ApprovalService` + `PolicyEngine` enforce this unconditionally [VERIFIED] | None — CloudOps already exceeds this | Do not weaken; make it *visible* (SLA/aging metrics) | P0 (safety, already met — preserve) |
| No documented policy-violation/security-event telemetry | Absence | Policy Block Rate, Blocked Action Count | Data exists (`audit_events`), no aggregation endpoint | No dashboard surfaces this today | Ship metrics 7, 15 + Security & Governance dashboard section | P0 (safety visibility) |
| No documented generalized verification concept | Absence | Verification Success Rate | Exists but scenario-locked (`RemediationVerificationService`) | Cannot honestly report fleet-wide reliability | Generalize verification criteria beyond the ECS demo before exposing as a trust metric | P0 (trust — a wrong metric here is worse than none) |
| Persona-based, per-agent identity | [DOCUMENTED] | Agent role labeling | Partial (`type` field only) | No operator-facing specialty framing | Add optional role label (Section 7, row 1) | P1 (product usability) |
| No fleet-level dashboard (either product) | Absence both sides | Cross-agent operational view | No | Real shared gap | Build Section 9's dashboard | P1 (operational visibility) |
| Case-study time/cost-saved framing | [DOCUMENTED] | Estimated engineering hours saved | Only a one-off test-only tracker | Not productionized, single scenario | Productionize `BenchmarkTimingTracker`, build a baseline library | P1 (measurable business value) |
| Dedicated infra per agent | [DOCUMENTED] | Per-agent Hermes profile isolation | Yes, and arguably stronger [VERIFIED, ADR-0008] | Under-surfaced in UI (buried in diagnostics) | Promote governance panel to main agent page | P1 (trust) |
| No LLM cost/usage metric documented (either product) | Absence both sides | Agent/model usage cost | No — Hermes runs as an unmetered CLI subprocess | No telemetry pipeline exists at all for LLM spend | New `llm_usage` tracking (architectural — see Section 12) | P2 (business value, but real architectural gap) |
| "Remembers everything" | [DOCUMENTED claim] | Tenant memory transparency | Data exists (`tenant_memory`, embeddings), no UI | No visibility into what's retained | Add read-only "Agent Memory" view | P2 (product usability / trust) |
| Cost-per-incident framing | Implied by case studies | Cost per incident | Partial (`/v1/costs/summary` is per-agent/account, not per-incident) | Missing incident join | Extend costs route | P2 (business value) |
| No described unauthorized-tool-attempt logging | Absence | Distinct audit event for out-of-scope tool attempts | Currently silent (tool simply not registered) | No signal if a client ever probes for an unauthorized capability | Add explicit audit event on capability-mismatch at the MCP layer | P2 (security completeness) |

---

## 12. API/Data Model Changes Required

**New read-only aggregation endpoints (no schema change required):**
- `GET /v1/metrics/investigations/summary` — autonomous resolution rate, MTTI, human intervention rate (metrics 1, 2, 4).
- `GET /v1/metrics/approvals/summary` — approval grant rate, mean time to decision, escalation rate (metrics 3, 5, 6).
- `GET /v1/metrics/security/summary` — policy block rate, blocked/high-risk action counts (metrics 7, 15).
- `GET /v1/metrics/reliability/summary` — execution success rate, tool failure rate (metric 8 and complement).
- `GET /v1/agents/status-summary` — active/idle agent counts (metric 10).
- `GET /v1/audit-events/timeline` — thin wrapper over existing `AuditService.listEvents()` for the cross-run activity feed (Section 9).

**Small schema/service changes:**
- `IncidentService.markResolved()` (and incident-creation path) should also call `AuditService.recordEvent()` with `INCIDENT_DETECTED`/`INCIDENT_RESOLVED` event types — currently `incidents.status` changes without a corresponding audit row, an inconsistency with how every other state transition in the system (approvals, tool calls) is already logged.
- `agents` table: optional nullable `role_label` (or reuse `type` more expressively) for Section 7's persona-labeling idea.
- `costs.ts`'s aggregation extended to join `incidents` for per-incident cost rollup (metric 12) — no new table, just a broader join in an existing route.
- New service method `RunService`/`IncidentService`: correlate `AwsScannerService`'s Cost Explorer calls to a specific incident's time window (metric 13) — currently account-level scanning with no incident correlation.

**Architectural changes (real new work, correctly scoped as such):**
- **LLM usage/cost metering**: does not exist today in any form, because `HermesAgentAdapter.executeHermesInference()` shells out to the `hermes` CLI as a subprocess (`hermes -z "<prompt>" --ignore-rules`, per ADR-0008) rather than calling a metered LLM API from CloudOps's own code. A new `llm_usage` table (model, tokens in/out if obtainable from Hermes's own output, wall-clock duration, `run_id`) would be a genuinely new capability, not a gap in existing plumbing — flagged honestly rather than assumed trivial.
- **Generalized remediation verification**: `RemediationVerificationService`'s `DEFAULT_RECOVERY_CRITERIA` is hard-coded to the one ECS demo scenario (`packages/adapters/src/awsIncidentEnvironment.ts`'s `ECS_INCIDENT_GROUND_TRUTH`). Making "verification success rate" a real fleet-wide metric requires parameterizing verification criteria per service/resource type — a real architectural project, not a query change.
- **Productionized time-saved tracking**: `BenchmarkTimingTracker` (`packages/shared/src/benchmark.ts`) is well-designed and already anti-fabrication-conscious (`isSyntheticMock` flag, explicit deferral language) but is only wired into `tests/integration/hermes_live_benchmark.test.ts`, not into the real `runs`/`investigations` write path. Productionizing it — and building more than the current single 2-trial human baseline — is real work before metric 14 can be shown live.

---

## 13. UI Changes Required

- **New `apps/web/src/app/dashboard/page.tsx`** implementing Section 9's six sections, or an expanded `/observability` landing view if the team prefers to extend rather than add a page (the existing `apps/web/src/app/observability/page.tsx` [VERIFIED] already has the run-picker/trace-reconstruction machinery Section 9's "Recent Activity" needs).
- **`apps/web/src/app/agents/[id]/tabs/`** — the existing per-agent tab structure (`config.tsx` and siblings, currently under active edit per the git status of this branch) is the natural home for a new "Performance" or "Metrics" tab surfacing metrics 1, 2, 4, 8, 10 scoped to that one agent.
- **Promote the "Governed Runtime Lockdown" panel** currently on `apps/web/src/app/agents/diagnostics/page.tsx` [VERIFIED] to the main per-agent detail page — it's real, already-computed governance data (Section 7, row 2) that's currently one click too deep for the trust story it tells.
- **`apps/web/src/app/approvals/page.tsx`** — add an aging/SLA indicator per pending approval (data already computed via `escalatePendingApprovals()`'s `ageMinutes`), surfacing metric 5/6 inline rather than only in a separate dashboard.
- **`apps/web/src/app/costs/page.tsx`** — add the per-incident cost view (metric 12) and AWS Cost Explorer impact (metric 13) alongside the existing per-agent/per-account rollup.
- **`apps/web/src/app/audit/page.tsx`** — add filter presets for policy-violation/security-event `ruleId`s (metric 15), turning the existing raw event list into a security-review surface.
- **New read-only "Agent Memory" view** (new route, e.g. `apps/web/src/app/agents/[id]/tabs/memory.tsx`) listing `tenant_memory` rows for transparency (Section 7, row 3).

---

## 14. Top 5–10 Recommended Improvements

**1. Surface capability tiers as a first-class "Autonomy" concept**
- Apollo concept: implied autonomy/trust framing, no documented mechanism.
- Why it works: buyers (and operators) want a simple mental model for "how much can this agent do on its own."
- CloudOps adaptation: CloudOps already has a strictly better mechanism — per-capability tiers (`read`/`mutate`/`deploy`) enforced in Rego and `PolicyFencingService` — that is more granular than a single toggle would be. Don't build a single autonomy slider; build a UI that makes the existing tiered grant model legible.
- Implementation location: `apps/web/src/app/capabilities/page.tsx` (extend), backed by existing `capabilities`/`capability_grants` tables and `defence_claw/defenseclaw/policies/rego/cloudops/capability_tiers.rego`.
- Expected user value: an operator can answer "what could this agent do right now, unattended" in one glance.
- Complexity: Low (UI-only, data already exists).
- Dependencies: None.

**2. Ship the Agent Performance Dashboard (Section 9)**
- Apollo concept: implied by case-study outcome framing, no visible mechanism.
- Why it works: it's the single artifact that turns "trust me, it's governed" into "look, here's the evidence."
- CloudOps adaptation: the six-section dashboard specified in Section 9, built entirely from real tables/services already read this session.
- Implementation location: new `apps/web/src/app/dashboard/page.tsx` + the new aggregation endpoints in Section 12.
- Expected user value: the primary artifact an engineering manager would actually look at before trusting the system with production infrastructure.
- Complexity: Medium (mostly aggregation queries + a UI build; no new architecture for most sections).
- Dependencies: New metrics endpoints (Section 12); the Reliability section's verification metric should ship with its scenario-scope caveat visible until Section 11's generalization work lands.

**3. Approval SLA & aging visibility ("Everything Stays on Track," done honestly)**
- Apollo concept: *"Everything Stays on Track"* even during busy periods [DOCUMENTED].
- Why it works: it reassures the buyer that nothing falls through the cracks — directly transferable to "no approval sits ignored."
- CloudOps adaptation: surface `escalatePendingApprovals()`'s already-computed `ageMinutes` directly on the Approvals page per pending item, plus the aggregate metrics 5/6 on the dashboard.
- Implementation location: `apps/web/src/app/approvals/page.tsx`, `packages/approvals/src/service.ts` (no service change needed, just consumption of existing data).
- Expected user value: operators see at a glance which approvals are aging toward auto-escalation, closing the loop Apollo's language gestures at.
- Complexity: Low.
- Dependencies: None.

**4. Governance Lockdown as a visible trust badge**
- Apollo concept: dedicated, isolated infrastructure per agent [DOCUMENTED].
- Why it works: "this agent's environment is isolated and verified" is a concrete trust claim, not a vague security-posture sentence.
- CloudOps adaptation: CloudOps already computes and independently re-verifies exactly this (`governance_status = 'LOCKED_DOWN'`, ADR-0008 Phase A) — promote it from a diagnostics-page panel to a badge on every agent card, fleet-wide dashboard, and the main agent detail page.
- Implementation location: `apps/web/src/app/agents/page.tsx`, `apps/web/src/app/agents/[id]/`, reusing `agents.governance_status`/`governance_verified_at` already returned by `GET /v1/agents`.
- Expected user value: turns a real, hard-won architectural guarantee (ADR-0008) into product-visible trust, instead of leaving it in a diagnostics tool only engineers open.
- Complexity: Low (data and endpoint already exist).
- Dependencies: None.

**5. Cost-per-incident rollup**
- Apollo concept: outcome-framed business metrics (though Apollo never shows a cost mechanism specifically).
- Why it works: "this incident cost $X to resolve, and would have cost $Y in engineer-hours manually" is the exact register an engineering manager budgets in.
- CloudOps adaptation: extend the existing `/v1/costs/summary` (already real, already joining approvals to agents/accounts) to also join incidents, and surface real AWS Cost Explorer data (`AwsScannerService`) per incident window.
- Implementation location: `apps/api/src/routes/costs.ts`, `apps/web/src/app/costs/page.tsx`.
- Expected user value: cost visibility scoped the way a manager actually thinks (per-incident), not just per-agent/per-account.
- Complexity: Low–Medium.
- Dependencies: Cost Explorer call correlation to incident time windows (Section 12).

**6. Recent Activity operational timeline**
- Apollo concept: implied "everything stays on track" continuity, no visible mechanism.
- Why it works: a live, readable narrative of what the fleet is doing right now is the clearest way to make an autonomous agent feel like "a real production worker rather than a chatbot" — the brief's own framing.
- CloudOps adaptation: generalize the existing single-run trace reconstruction (`GET /v1/runs/:id/trace`, already real) into a cross-run, tenant-wide feed built from `audit_events` + `tool_executions`.
- Implementation location: `apps/api/src/routes/audit.ts` (extend) or new `runs.ts` endpoint, `apps/web/src/app/observability/page.tsx` or the new dashboard.
- Expected user value: the single most legible artifact for "what is my agent actually doing," addressing the brief's "chatbot vs. real worker" distinction directly.
- Complexity: Low–Medium (mostly assembling data that already exists into a merged, time-ordered feed).
- Dependencies: `INCIDENT_DETECTED`/`INCIDENT_RESOLVED` audit events (Section 12) for a complete narrative.

**7. Agent Memory transparency view**
- Apollo concept: *"It remembers everything... What your business learns stays with your business"* [DOCUMENTED claim].
- Why it works: makes persistent memory a visible asset instead of an opaque claim — Apollo states the claim but shows no mechanism; CloudOps can actually show the mechanism.
- CloudOps adaptation: a read-only view over `tenant_memory` and `knowledge_embeddings`, scoped to what an agent has retained about a tenant's incidents/resources.
- Implementation location: new tab under `apps/web/src/app/agents/[id]/tabs/`, backed by existing `TenantMemoryService` (`packages/adapters/src/tenantMemoryService.ts`) and `packages/embeddings`.
- Expected user value: transparency into what shapes the agent's future recommendations — a trust feature Apollo only asserts, that CloudOps could actually demonstrate.
- Complexity: Low (read-only view over existing data).
- Dependencies: None.

**8. Security & Governance dashboard section as its own first-class surface**
- Apollo concept: none directly (Apollo's security section is infra/compliance-only) — this idea exists precisely *because* Apollo's public materials don't address agent-behavior governance at all, and CloudOps's advantage here should not stay invisible.
- Why it works: makes CloudOps's actual differentiator (governing agent *behavior*, not just infrastructure) into the product's most prominent screen, not a byproduct of an audit log.
- CloudOps adaptation: metrics 7, 11, 15 plus a live feed of `DEFENSECLAW_SECURITY_FENCE`/`FENCE_*` rule firings, as its own dashboard section (already specified in Section 9).
- Implementation location: new `GET /v1/metrics/security/summary` (Section 12), dashboard section (Section 9), `apps/web/src/app/audit/page.tsx` filter presets.
- Expected user value: the strongest, most differentiated trust artifact CloudOps can ship, because it's backed by real enforcement code (`PolicyEngine`, DefenseClaw, the IaC gate) that has no equivalent in Apollo's public materials at all.
- Complexity: Medium.
- Dependencies: New aggregation endpoint only; all underlying data exists.

---

## 15. Implementation Priority

**P0 — safety and trust-critical, do first**
1. Security & Governance metrics + dashboard section (policy block rate, blocked/high-risk actions, governance lockdown coverage) — idea 8, metrics 7/11/15.
2. `INCIDENT_DETECTED`/`INCIDENT_RESOLVED` audit event emission (closes a real logging inconsistency, and is a prerequisite for the Recent Activity timeline).
3. Do **not** ship a "verification success rate" metric until `RemediationVerificationService`'s criteria are generalized beyond the single ECS demo scenario — shipping it early, scenario-locked but presented as general, would actively damage trust. Treat the generalization work itself as P0 precisely because the metric is otherwise unsafe to expose.

**P1 — high operational-visibility and trust value**
4. Agent Performance Dashboard core (Agent Overview, Autonomous Operations, Reliability sections) — idea 2.
5. Governance Lockdown trust badge promoted to main agent views — idea 4.
6. Approval SLA/aging visibility on the Approvals page — idea 3.
7. Autonomy/capability-tier visibility on the Capabilities page — idea 1.
8. Recent Activity operational timeline — idea 6.

**P2 — measurable business value and product polish**
9. Cost-per-incident rollup + AWS Cost Explorer correlation — idea 5.
10. Agent Memory transparency view — idea 7.
11. Productionized "estimated engineering hours saved" metric, gated on building a real multi-scenario baseline library first (do not ship a headline number off a single 2-trial baseline).
12. LLM usage/cost metering — genuinely new architecture; lowest priority not because it's unimportant but because nothing today even partially covers it, so it has the longest lead time relative to its trust/safety payoff.

---

## 16. Final Product Recommendations

**The core takeaway: CloudOps does not need a single new safety mechanism inspired by Apollo[Claw] — it needs to make the safety mechanisms it already has legible as product experience.** Every governance primitive Apollo's public materials gesture at in marketing language (dedicated isolation, "with your approval," "everything stays on track," "least-privilege access") already exists in CloudOps's codebase in a more rigorous, independently verifiable form (ADR-0008's governed MCP-only boundary, cryptographically signed approvals with a revert chain, a hash-chained audit ledger, a four-stage policy engine). The highest-leverage work identified in this report is turning that already-built rigor into the kind of dashboard, badge, and metric surface an engineering manager would actually look at before trusting an agent with production AWS infrastructure — Sections 9 and 14 above.

**What NOT to take from Apollo[Claw], stated explicitly:**
- **Do not adopt an ungated, "message your agent directly" action model for anything that mutates infrastructure.** Apollo's own positioning language — communicate with your agent "the same way you'd message a trusted colleague" — with no documented approval gate, is precisely the shape ADR-0008 exists to prevent: an agent acting on a live system without an independent policy/approval checkpoint in between. CloudOps's chat surface (`apps/api/src/routes/agents.ts`'s `resolveChatAction()`) already gets this right by routing every `propose_mutation` through the same `PolicyEngine.evaluate()` → `ApprovalService` pipeline every other tool call uses — that design must not be weakened to feel more "conversational."
- **Do not treat Apollo's documented infra/compliance security (encryption, ISO 27001, SOC 2) as a benchmark for CloudOps's agent-behavior governance.** They are different layers solving different problems; Apollo's public materials simply don't address the harder layer (what may an autonomous agent *do*) at all, so there is nothing there to benchmark against on that axis, and no reason to believe matching Apollo's documented posture would be sufficient for CloudOps's problem.
- **Do not introduce a "fast path" or "trusted action" shortcut for repeat or low-risk actions**, even though Apollo's white-glove, dedicated-per-client model might tempt an analogous "this agent has proven itself, let it act faster" pattern. Per this project's own standing rule (`docs/decisions/ADR-0008-governed-runtime-mcp-only-execution.md`), every tool execution must stay MCP-only through `PolicyEngine`, with no exception carved out for trust accumulated over time. Nothing in this benchmark proposes otherwise, and any future proposal along these lines should be checked against this report's Section 9 (of the original brief) explicitly.
- **Do not publish a headline "hours saved" or "X% faster" number until the underlying baseline library is broad enough to support it honestly.** `docs/benchmarks/manual-engineer-baseline.md` and `docs/benchmarks/live-hermes-agent-benchmark.md` are both scoped, single-scenario documents that say so themselves; Apollo's confident case-study framing is a communication *pattern* worth adapting, not a license to publish a number before CloudOps has done the same rigor Apollo presumably did (but does not show) behind its own case studies.
- **Do not chase Apollo's integration breadth (48 tools, general-purpose office/CRM connectors).** CloudOps's narrow, governed AWS/MCP tool surface is a deliberate scope decision (ADR-0007, ADR-0008), not a gap to close by adding more integrations for their own sake.

**In one sentence:** Apollo[Claw] is a thin public benchmark on mechanism but a useful one on product communication — the work worth doing is not architectural, it's making CloudOps's already-real safety and governance architecture as visible, measurable, and trust-inspiring to the people who need to rely on it as Apollo's marketing makes its own (unverified) mechanisms sound.

---

## Sources

**Apollo[Claw]:**
- [apolloclaw.ai](https://apolloclaw.ai/) — home page
- [apolloclaw.ai/about](https://apolloclaw.ai/about) — company/product model
- [apolloclaw.ai/security](https://apolloclaw.ai/security) — security/compliance posture
- [apolloclaw.ai/enterprise](https://apolloclaw.ai/enterprise) — enterprise/deployment model
- [apolloclaw.ai/integrations](https://apolloclaw.ai/integrations) — integration catalog
- [apolloclaw.ai/case-studies](https://apolloclaw.ai/case-studies) — outcome metrics

**CloudOps repository (all read directly this session):**
- `database/src/schema.ts`
- `packages/policy/src/index.ts`, `packages/policy/src/iacGate.ts`
- `packages/tools/src/mcpServer.ts`, `packages/tools/src/registry.ts`
- `packages/approvals/src/service.ts`
- `packages/audit/src/service.ts`
- `packages/adapters/src/incidentService.ts`, `remediationVerificationService.ts`, `awsScannerService.ts`, `toolExecutionService.ts`
- `packages/identity/src/service.ts`, `repository.ts`
- `packages/shared/src/types.ts`, `benchmark.ts`
- `packages/gateway/src/connectionManager.ts`, `metrics.ts`, `defenseClawClient.ts`
- `defence_claw/defenseclaw/policies/rego/cloudops/capability_tiers.rego`
- `apps/api/src/routes/agents.ts`, `costs.ts`, `runs.ts`, `audit.ts`, `capabilities.ts`
- `apps/web/src/app/observability/page.tsx`, `operations/page.tsx`, `agents/diagnostics/page.tsx`
- `docs/decisions/ADR-0008-governed-runtime-mcp-only-execution.md`, `ADR-0008-phase-b-design-notes.md`
- `docs/benchmarks/manual-engineer-baseline.md`, `live-hermes-agent-benchmark.md`
